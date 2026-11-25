'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readOnlyGit } = require('./git');

const excluded = /(?:^|[/\\])(?:node_modules|dist|build|coverage|\.next|\.git)(?:[/\\]|$)/i;
const scriptSource = /\.[cm]?[jt]sx?$/i;
const cSource = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|ino)$/i;
const pySource = /\.py$/i;
const source = /\.(?:[cm]?[jt]sx?|c|cc|cpp|cxx|h|hh|hpp|hxx|ino|py)$/i;
const header = /\.(?:h|hh|hpp|hxx)$/i;
const stem = file => file.replace(/\.[^./]+$/, '');
const config = /(?:^|\/)(?:[jt]sconfig\.json|package\.json)$/i;
const maxFiles = 4500;
const maxEdges = 18000;
const maxBytes = 24 * 1024 * 1024;
const testFile = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:spec|test)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+$|_test\.(?:py|c|cc|cpp)$/i;
const moduleName = file => file.includes('/') ? file.split('/')[0] : '(root)';
const folderOf = file => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '(root)';
const normalize = file => file.split(path.sep).join('/');

async function containedFile(root, file) {
  if (typeof file !== 'string' || path.isAbsolute(file) || file.split('/').some(part => !part || part === '..' || part === '.') || /[\\:\0]/.test(file)) return;
  const target = path.join(root, file);
  const canonical = await fs.realpath(target).catch(() => '');
  if (!canonical) return;
  const relative = path.relative(root, canonical);
  if (relative !== file.split('/').join(path.sep) || !(await fs.lstat(target)).isFile()) return;
  return canonical;
}

async function indexFiles(repo, ts, signal) {
  const root = await fs.realpath(repo.root);
  const listing = await readOnlyGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], signal);
  const files = [...new Set(listing.split('\0').filter(file => file && !excluded.test(file)))].sort();
  const inputs = files.filter(file => source.test(file) || config.test(file));
  const text = new Map();
  const fingerprint = createHash('sha256');
  const generated = new Set();
  let skipped = 0, bytes = 0;
  // Per-file latency dominates on synced or scanned folders, so stat in parallel batches and apply results in listing order.
  const batch = inputs.slice(0, maxFiles);
  for (let start = 0; start < batch.length; start += 16) {
    signal.throwIfAborted();
    const found = await Promise.all(batch.slice(start, start + 16).map(async file => {
      try {
        const target = await containedFile(root, file);
        return target && { file, target, size: (await fs.stat(target)).size };
      } catch { return null; }
    }));
    const wanted = [];
    for (const item of found) {
      if (!item) { skipped++; continue; }
      // Large C sources are converted images, fonts and audio; list them without reading their data.
      if (cSource.test(item.file) && item.size > 128 * 1024) { generated.add(item.file); continue; }
      if (item.size > 512 * 1024 || bytes + item.size > maxBytes) { skipped++; continue; }
      bytes += item.size;
      wanted.push(item);
    }
    const contents = await Promise.all(wanted.map(item => fs.readFile(item.target).catch(() => null)));
    for (const [index, content] of contents.entries()) {
      if (!content || content.includes(0)) { skipped++; continue; }
      text.set(normalize(wanted[index].target), content.toString('utf8'));
      fingerprint.update(JSON.stringify([wanted[index].file, createHash('sha256').update(content).digest('hex')]));
    }
  }
  // Commit counts per path over a bounded recent window; churn x complexity marks change-prone code.
  const churn = {};
  const log = await readOnlyGit(root, ['log', '-z', '-n', '400', '--since=180.days', '--no-renames', '--format=', '--name-only'], signal).catch(() => '');
  signal.throwIfAborted();
  for (const file of log.split('\0')) { const name = file.trim(); if (name) churn[name] = (churn[name] || 0) + 1; }
  const edges = [], unresolved = {}, metrics = {}, functions = [];
  const sourceFiles = [...text.keys()].filter(file => source.test(file));
  let references = 0, unresolvedCount = 0, capped = false;
  const host = { fileExists: file => text.has(normalize(file)), readFile: file => text.get(normalize(file)),
    useCaseSensitiveFileNames: true, getCurrentDirectory: () => normalize(root) };
  const options = new Map();
  function compilerOptions(file) {
    for (let dir = path.dirname(file); dir.startsWith(normalize(root)); dir = path.dirname(dir)) {
      if (options.has(dir)) return options.get(dir);
      const raw = text.get(dir + '/tsconfig.json') || text.get(dir + '/jsconfig.json');
      if (raw) {
        const parsed = ts.parseConfigFileTextToJson('tsconfig.json', raw);
        const converted = ts.convertCompilerOptionsFromJson(parsed.config?.compilerOptions || {}, dir);
        options.set(dir, { moduleResolution: ts.ModuleResolutionKind.Node10, ...converted.options, configFilePath: dir + '/tsconfig.json' });
        return options.get(dir);
      }
      if (dir === normalize(root) || dir === path.dirname(dir)) break;
    }
    return { moduleResolution: ts.ModuleResolutionKind.Node10, allowJs: true };
  }
  if (ts) for (const [index, file] of sourceFiles.filter(file => scriptSource.test(file)).entries()) {
    if (index % 32 === 0) await new Promise(resolve => setImmediate(resolve));
    signal.throwIfAborted();
    const content = text.get(file), from = normalize(path.relative(root, file));
    const parsed = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const measured = measure(ts, parsed, from);
    metrics[from] = { loc: lines(content), complexity: measured.complexity, churn: churn[from] || 0 };
    functions.push(...measured.functions);
    const imports = ts.preProcessFile(content, true, /\.[cm]?jsx?$/i.test(file)).importedFiles;
    const opts = compilerOptions(file);
    for (const item of imports) {
      if (references++ >= maxEdges) { capped = true; break; }
      const name = item.fileName;
      const resolved = ts.resolveModuleName(name, file, opts, host).resolvedModule?.resolvedFileName;
      if (!resolved || !scriptSource.test(resolved) || !text.has(normalize(resolved))) {
        unresolvedCount++;
        if ((unresolved[from] ||= []).length < 12) unresolved[from].push(name.slice(0, 200));
        continue;
      }
      const location = parsed.getLineAndCharacterOfPosition(item.pos);
      edges.push({ from, to: normalize(path.relative(root, resolved)), line: location.line + 1, column: location.character + 1 });
    }
    if (capped) break;
  }
  // C/C++/Arduino and Python: lexical scan, no compiler or interpreter runs.
  const known = new Set([...sourceFiles.map(file => normalize(path.relative(root, file))), ...generated]);
  const byName = new Map();
  for (const file of known) { const name = file.slice(file.lastIndexOf('/') + 1).toLowerCase(); byName.set(name, [...(byName.get(name) || []), file]); }
  const entries = new Set();
  for (const [index, from] of [...known].filter(file => !scriptSource.test(file) && !generated.has(file)).entries()) {
    if (capped) break;
    if (index % 32 === 0) await new Promise(resolve => setImmediate(resolve));
    signal.throwIfAborted();
    const scanned = scanSource(from, text.get(normalize(path.join(root, from))));
    metrics[from] = { loc: scanned.loc, complexity: scanned.complexity, churn: churn[from] || 0 };
    functions.push(...scanned.functions);
    if (scanned.entry) entries.add(from);
    for (const item of scanned.imports) {
      if (references++ >= maxEdges) { capped = true; break; }
      const to = resolveImport(from, item, known, byName);
      if (to && to !== from) edges.push({ from, to, line: item.line, column: 1 });
      else if (!to) {
        unresolvedCount++;
        if ((unresolved[from] ||= []).length < 12) unresolved[from].push(item.name.slice(0, 200));
      }
    }
  }
  const nodes = files.slice(0, maxFiles).filter(file => !source.test(file) || generated.has(file) || text.has(normalize(path.resolve(root, file))));
  const indexed = new Set(nodes);
  const visibleEdges = edges.filter(edge => indexed.has(edge.from) && indexed.has(edge.to));
  for (const file of sourceFiles) {
    const name = normalize(path.relative(root, file));
    metrics[name] ||= { loc: lines(text.get(file)), complexity: null, churn: churn[name] || 0 };
  }
  for (const file of entryPoints(text, root)) entries.add(file);
  const languages = [...new Set([...known].map(file => scriptSource.test(file) ? (ts ? 'JS/TS' : '') : cSource.test(file) ? 'C/C++' : 'Python'))].filter(Boolean);
  const insights = analyze(nodes, visibleEdges, metrics, functions, entries, !!ts || languages.length > 0);
  return {
    nodes, edges: visibleEdges, unresolved, metrics, insights, generated: [...generated], fingerprint: fingerprint.digest('hex'), engine: ts?.version,
    summary: { files: nodes.length, sourceFiles: sourceFiles.length, generated: generated.size, edges: visibleEdges.length, modules: new Set(nodes.map(moduleName)).size,
      languages, unresolved: languages.length ? unresolvedCount : null, partial: (!ts && [...known].some(file => scriptSource.test(file))) || !sourceFiles.length || capped || skipped > 0 || files.length > maxFiles || inputs.length > maxFiles }
  };
}

const lines = content => content.split('\n').filter(line => line.trim()).length;

// Cyclomatic-style decision points for the file and for each function body.
function measure(ts, sf, file) {
  const K = ts.SyntaxKind;
  const branching = new Set([K.IfStatement, K.ConditionalExpression, K.ForStatement, K.ForInStatement, K.ForOfStatement, K.WhileStatement, K.DoStatement, K.CaseClause, K.CatchClause]);
  const logical = new Set([K.AmpersandAmpersandToken, K.BarBarToken, K.QuestionQuestionToken]);
  const lineOf = pos => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const nameOf = node => {
    const parent = node.parent;
    if (node.name) return node.name.getText(sf);
    if (node.kind === K.Constructor) return 'constructor';
    if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))) return parent.name.getText(sf);
    if (parent && ts.isCallExpression(parent)) return parent.expression.getText(sf).slice(0, 48) + ' callback';
    return '(anonymous)';
  };
  let complexity = 1;
  const functions = [], stack = [];
  const visit = node => {
    const fn = ts.isFunctionLike(node) && !!node.body;
    if (fn) stack.push(1);
    if (branching.has(node.kind) || (ts.isBinaryExpression(node) && logical.has(node.operatorToken.kind))) {
      complexity++;
      if (stack.length) stack[stack.length - 1]++;
    }
    ts.forEachChild(node, visit);
    if (fn) {
      const start = lineOf(node.getStart(sf));
      functions.push({ file, name: nameOf(node).slice(0, 80), line: start, lines: lineOf(node.end) - start + 1, complexity: stack.pop() });
    }
  };
  visit(sf);
  return { complexity, functions: functions.filter(item => item.complexity >= 10 || item.lines >= 60) };
}

// Files named by package.json main/bin/exports/scripts are entry points, not orphans.
function entryPoints(text, root) {
  const entries = new Set();
  for (const [file, raw] of text) {
    if (!file.endsWith('/package.json')) continue;
    const dir = path.relative(root, path.dirname(file));
    const add = value => { if (typeof value === 'string') entries.add(normalize(path.join(dir, value))); };
    const walk = value => { if (typeof value === 'string') add(value); else if (value && typeof value === 'object') Object.values(value).forEach(walk); };
    try {
      const pkg = JSON.parse(raw);
      add(pkg.main); add(pkg.module); walk(pkg.bin); walk(pkg.exports);
      for (const script of Object.values(pkg.scripts || {})) for (const match of String(script).matchAll(/[\w./@-]+\.[cm]?[jt]sx?\b/g)) add(match[0]);
    } catch { /* An invalid manifest adds no entry points. */ }
  }
  return entries;
}

// Tarjan's strongly connected components: members of one component import each other in a loop.
function components(ids, next) {
  let counter = 0;
  const index = new Map(), low = new Map(), stack = [], onStack = new Set(), result = [];
  const connect = id => {
    index.set(id, counter); low.set(id, counter++); stack.push(id); onStack.add(id);
    for (const other of next(id)) {
      if (!index.has(other)) { connect(other); low.set(id, Math.min(low.get(id), low.get(other))); }
      else if (onStack.has(other)) low.set(id, Math.min(low.get(id), index.get(other)));
    }
    if (low.get(id) !== index.get(id)) return;
    const group = [];
    let member;
    do { member = stack.pop(); onStack.delete(member); group.push(member); } while (member !== id);
    result.push(group);
  };
  for (const id of ids) if (!index.has(id)) connect(id);
  return result;
}

// Blanks comments and string literals, keeping newlines, so keyword counts and brace matching ignore them.
const blank = match => match.replace(/[^\n]/g, ' ');
const cNoise = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
const pyNoise = /"""[\s\S]*?"""|'''[\s\S]*?'''|#[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
const cBranch = /\b(?:if|for|while|case|catch)\b|&&|\|\||\?/g;
const pyBranch = /\b(?:if|elif|for|while|except|and|or|case)\b/g;
const cFunction = /^[ \t]*[\w:<>,*&~ \t]*?\b(~?[A-Za-z_][\w:]*)[ \t]*\((?:[^;{}()]|\([^()]*\))*\)\s*(?:const\b\s*)?(?:noexcept\b\s*)?(?:override\b\s*)?(?::[^;{]*)?\{/gm;
const keyword = /^(?:if|for|while|switch|catch|return|sizeof|else|do)$/;
const count = (text, pattern) => (text.match(pattern) || []).length;

// Lexical scan for C/C++/Arduino and Python: imports, decision points and function bodies.
function scanSource(file, content) {
  const python = pySource.test(file);
  const code = content.replace(python ? pyNoise : cNoise, blank);
  const rows = code.split('\n');
  const imports = [], functions = [];
  if (python) {
    rows.forEach((row, index) => {
      let match = /^\s*from\s+(\.*[\w.]*)\s+import\s+(.+)/.exec(row);
      if (match) imports.push({ name: match[1], line: index + 1, names: match[2].replace(/[()\\]/g, '').split(',').map(name => name.trim().split(/\s+/)[0]).filter(name => /^\w+$/.test(name)) });
      else if ((match = /^\s*import\s+(.+)/.exec(row))) {
        for (const part of match[1].split(',')) { const name = part.trim().split(/\s+/)[0]; if (/^[\w.]+$/.test(name)) imports.push({ name, line: index + 1 }); }
      }
      const fn = /^(\s*)(?:async\s+)?def\s+(\w+)/.exec(row);
      if (!fn) return;
      let start = index;
      while (start < rows.length - 1 && !/:\s*$/.test(rows[start])) start++;
      let end = start;
      for (let next = start + 1; next < rows.length; next++) {
        if (!rows[next].trim()) continue;
        if (/^\s*/.exec(rows[next])[0].length <= fn[1].length) break;
        end = next;
      }
      functions.push({ file, name: fn[2], line: index + 1, lines: end - index + 1, complexity: 1 + count(rows.slice(index, end + 1).join('\n'), pyBranch) });
    });
  } else {
    content.split('\n').forEach((row, index) => {
      const match = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/.exec(row);
      if (match && /^\s*#/.test(rows[index])) imports.push({ name: match[2].trim(), line: index + 1, system: match[1] === '<' });
    });
    const starts = [0];
    for (let index = code.indexOf('\n'); index >= 0; index = code.indexOf('\n', index + 1)) starts.push(index + 1);
    const lineAt = offset => { let low = 0, high = starts.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid] <= offset) low = mid; else high = mid - 1; } return low + 1; };
    cFunction.lastIndex = 0;
    for (let match; (match = cFunction.exec(code));) {
      const open = match.index + match[0].length - 1;
      let depth = 0, close = open;
      for (; close < code.length; close++) { if (code[close] === '{') depth++; else if (code[close] === '}' && !--depth) break; }
      if (keyword.test(match[1])) continue;
      const begin = lineAt(match.index + match[0].search(/\S/));
      functions.push({ file, name: match[1], line: begin, lines: lineAt(close) - begin + 1, complexity: 1 + count(code.slice(open, close), cBranch) });
      cFunction.lastIndex = close + 1;
    }
  }
  const entry = /\.ino$/i.test(file) || (python ? /if\s+__name__\s*==\s*['"]__main__['"]/.test(content) : /\b(?:int|void)\s+(?:main|setup)\s*\(/.test(code));
  return { loc: lines(content), complexity: 1 + count(code, python ? pyBranch : cBranch), imports, entry,
    functions: functions.filter(item => item.complexity >= 10 || item.lines >= 60) };
}

const sharedDepth = (a, b) => { const x = a.split('/'), y = b.split('/'); let depth = 0; while (depth < x.length && x[depth] === y[depth]) depth++; return depth; };
// Resolves a C include or Python import to an indexed file; external and system modules stay unresolved.
function resolveImport(from, item, known, byName) {
  const dir = path.posix.dirname(from);
  if (!pySource.test(from)) {
    const relative = path.posix.normalize(path.posix.join(dir, item.name));
    if (known.has(relative)) return relative;
    // Include paths are unknown without the build system; match the path suffix, nearest folder first.
    const wanted = '/' + item.name.toLowerCase();
    // <system> includes only match inside the includer's top-level folder, so test stubs elsewhere never stand in for the SDK.
    return (byName.get(item.name.split('/').pop().toLowerCase()) || []).filter(file => ('/' + file).toLowerCase().endsWith(wanted) && (!item.system || sharedDepth(file, from) > 0))
      .sort((a, b) => sharedDepth(b, from) - sharedDepth(a, from))[0];
  }
  const dots = /^\.*/.exec(item.name)[0].length;
  const parts = item.name.slice(dots).split('.').filter(Boolean);
  let bases = [dir, '.', 'src'];
  if (dots) { let base = dir; for (let level = 1; level < dots; level++) base = path.posix.dirname(base); bases = [base]; }
  for (const base of bases) {
    const prefix = [base === '.' ? '' : base, ...parts].filter(Boolean).join('/');
    for (const module of [...(item.names || []).map(name => [prefix, name].filter(Boolean).join('/')), prefix]) {
      if (module && known.has(module + '.py')) return module + '.py';
      if (module && known.has(module + '/__init__.py')) return module + '/__init__.py';
    }
  }
}

// C/C++: a header and its same-named implementation are one unit; code using the header uses the implementation.
function companionsOf(files) {
  const stems = new Map();
  for (const file of files) if (cSource.test(file) && !/\.ino$/i.test(file)) { const key = stem(file).toLowerCase(); stems.set(key, [...(stems.get(key) || []), file]); }
  return file => cSource.test(file) ? (stems.get(stem(file).toLowerCase()) || []).filter(other => other !== file) : [];
}

function analyze(nodes, edges, metrics, functions, entries, compiled) {
  const sources = nodes.filter(file => source.test(file) && metrics[file]);
  const outgoing = new Map(sources.map(file => [file, new Set()])), incoming = new Map(sources.map(file => [file, new Set()]));
  for (const edge of edges) if (outgoing.has(edge.from) && outgoing.has(edge.to)) { outgoing.get(edge.from).add(edge.to); incoming.get(edge.to).add(edge.from); }
  const cycles = components(sources, file => outgoing.get(file))
    .filter(group => group.length > 1 || outgoing.get(group[0]).has(group[0]))
    .sort((a, b) => b.length - a.length);
  const tests = sources.filter(file => testFile.test(file));
  const companions = companionsOf(sources);
  const covered = new Set(tests);
  for (const queue = [...tests]; queue.length;) {
    const file = queue.pop();
    for (const next of [...(outgoing.get(file) || []), ...companions(file)]) if (!covered.has(next)) { covered.add(next); queue.push(next); }
  }
  const production = sources.filter(file => !testFile.test(file));
  const tooling = /(?:^|\/)(?:scripts?|bin|tools)\/|(?:^|\/)[^/]*\.config\.[cm]?[jt]s$/i;
  // C/C++ implementation files are compiled and linked, never included, so only headers can be orphans.
  const orphans = compiled ? production.filter(file => !incoming.get(file).size && !companions(file).some(other => incoming.get(other)?.size) && !entries.has(file) && !tooling.test(file) && !/\.(?:c|cc|cpp|cxx)$/i.test(file)) : [];
  const untested = compiled && tests.length ? production.filter(file => !covered.has(file) && !tooling.test(file)) : [];
  const folders = new Map();
  for (const file of sources) {
    const name = folderOf(file), folder = folders.get(name) || { folder: name, files: 0, loc: 0, complexity: 0, afferent: new Set(), efferent: new Set() };
    folder.files++; folder.loc += metrics[file]?.loc || 0; folder.complexity += metrics[file]?.complexity || 0;
    for (const other of outgoing.get(file)) if (folderOf(other) !== name) folder.efferent.add(other);
    for (const other of incoming.get(file)) if (folderOf(other) !== name) folder.afferent.add(other);
    folders.set(name, folder);
  }
  const score = file => (metrics[file]?.complexity ?? Math.round((metrics[file]?.loc || 0) / 10)) * (1 + (metrics[file]?.churn || 0));
  const ranked = production.filter(file => score(file) > 0).sort((a, b) => score(b) - score(a));
  // Relative cut-off: only files carrying at least a tenth of the top score count as hotspots.
  const hotspots = ranked.filter(file => score(file) >= score(ranked[0]) / 10).slice(0, 12)
    .map(file => ({ file, score: score(file), ...metrics[file], importers: incoming.get(file).size, imports: outgoing.get(file).size }));
  return {
    loc: sources.reduce((sum, file) => sum + (metrics[file]?.loc || 0), 0),
    tests: tests.length,
    churn: sources.some(file => metrics[file]?.churn),
    cycles: cycles.slice(0, 20).map(group => ({ size: group.length, files: group.sort().slice(0, 12) })),
    cycleFiles: cycles.flat(),
    hotspots,
    functions: functions.sort((a, b) => b.complexity - a.complexity || b.lines - a.lines).slice(0, 20),
    orphans: { total: orphans.length, files: orphans.slice(0, 40) },
    untested: { total: untested.length, files: untested.sort((a, b) => (metrics[b]?.loc || 0) - (metrics[a]?.loc || 0)).slice(0, 40) },
    folders: [...folders.values()].sort((a, b) => b.loc - a.loc).slice(0, 40).map(({ afferent, efferent, ...folder }) => ({
      ...folder, afferent: afferent.size, efferent: efferent.size,
      instability: afferent.size + efferent.size ? +(efferent.size / (afferent.size + efferent.size)).toFixed(2) : null }))
  };
}

// Dependency map of one folder's direct children (subfolders and files), layered so dependencies sit below their dependents.
function architectureMap(graph, scope) {
  const metrics = graph.metrics || {}, cyclic = new Set(graph.insights?.cycleFiles || []);
  const hot = new Set((graph.insights?.hotspots || []).map(item => item.file));
  const prefix = scope ? scope + '/' : '';
  const childOf = file => {
    if (!source.test(file) || !file.startsWith(prefix)) return;
    const slash = file.indexOf('/', prefix.length);
    if (slash >= 0) return file.slice(0, slash + 1);
    return cSource.test(file) && !/\.ino$/i.test(file) ? stem(file).toLowerCase() + '.*' : file;
  };
  const children = new Map();
  for (const file of graph.nodes) {
    const id = childOf(file);
    if (!id) continue;
    const node = children.get(id) || { id, name: id.slice(prefix.length).replace(/\/$/, ''), kind: id.endsWith('/') ? 'folder' : 'file', paths: [],
      files: 0, loc: 0, complexity: 0, churn: 0, cycles: 0, hotspots: 0, external: { in: 0, out: 0 } };
    node.files++; node.loc += metrics[file]?.loc || 0; node.complexity += metrics[file]?.complexity || 0; node.churn += metrics[file]?.churn || 0;
    node.cycles += cyclic.has(file); node.hotspots += hot.has(file);
    if (node.kind === 'file') {
      node.paths.push(file);
      node.target = node.paths.find(item => !header.test(item)) || node.paths[0];
      node.name = file.slice(prefix.length).replace(/\.[^.]+$/, '') + node.paths.map(item => item.slice(item.lastIndexOf('.'))).join('/');
    }
    children.set(id, node);
  }
  const kept = [...children.values()].sort((a, b) => b.loc - a.loc || a.name.localeCompare(b.name)).slice(0, 60);
  const ids = new Set(kept.map(node => node.id));
  const links = new Map(), next = new Map(kept.map(node => [node.id, new Set()]));
  for (const edge of graph.edges) {
    const from = childOf(edge.from), to = childOf(edge.to);
    if (from && to && from !== to && ids.has(from) && ids.has(to)) {
      const key = from + '\0' + to;
      links.set(key, (links.get(key) || 0) + 1);
      next.get(from).add(to);
    } else if (from && !to && ids.has(from)) children.get(from).external.out++;
    else if (!from && to && ids.has(to)) children.get(to).external.in++;
  }
  const groups = components([...ids], id => next.get(id));
  const groupOf = new Map(groups.flatMap((group, index) => group.map(id => [id, index])));
  const depth = new Map();
  // Longest path to a foundation (a group importing nothing else in scope); components are acyclic, so this terminates.
  const layer = index => {
    if (depth.has(index)) return depth.get(index);
    let value = 0;
    for (const id of groups[index]) for (const other of next.get(id)) if (groupOf.get(other) !== index) value = Math.max(value, layer(groupOf.get(other)) + 1);
    depth.set(index, value);
    return value;
  };
  return {
    scope, hidden: children.size - kept.length,
    nodes: kept.map(node => ({ ...node, layer: layer(groupOf.get(node.id)), cyclic: groups[groupOf.get(node.id)].length > 1 })),
    edges: [...links].map(([key, count]) => { const [from, to] = key.split('\0'); return { from, to, count, cyclic: groupOf.get(from) === groupOf.get(to) }; })
  };
}

function queryGraph(graph, { query, target, depth, module, offset }) {
  const search = typeof query === 'string' ? query.slice(0, 256).toLowerCase() : '';
  const requested = typeof module === 'string' ? module.slice(0, 512) : '';
  const group = requested === '(root)' || graph.nodes.some(file => file.startsWith(requested + '/')) ? requested : '';
  const inGroup = file => !group || (group === '(root)' ? !file.includes('/') : file.startsWith(group + '/'));
  const start = Number.isSafeInteger(offset) ? Math.max(0, offset) : 0;
  const matching = graph.nodes.filter(file => inGroup(file) && file.toLowerCase().includes(search));
  const files = matching.slice(start, start + 60);
  const modules = [...new Set(graph.nodes.map(moduleName))].sort().slice(0, 100);
  const selected = typeof target === 'string' && graph.nodes.includes(target) ? target : '';
  const map = architectureMap(graph, group === '(root)' ? '' : group);
  const unanalyzed = files.filter(file => !graph.metrics?.[file]);
  if (!selected) return { files, unanalyzed, modules, total: matching.length, map };

  const outgoing = new Map(), incoming = new Map();
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }
  const maxDepth = Number.isSafeInteger(depth) ? Math.max(1, Math.min(6, depth)) : 3;
  const seen = new Set([selected]), dependents = [];
  let frontier = [selected], capped = false, cycle = false;
  visit: for (let distance = 1; distance <= maxDepth && frontier.length; distance++) {
    const next = [];
    for (const file of frontier) for (const edge of incoming.get(file) || []) {
      if (edge.from === selected) cycle = true;
      if (seen.has(edge.from)) continue;
      if (dependents.length === 100) { capped = true; break visit; }
      seen.add(edge.from);
      next.push(edge.from);
      dependents.push({ ...edge, distance });
    }
    frontier = next;
  }
  const dependencies = outgoing.get(selected) || [];
  const direct = incoming.get(selected) || [];
  const tests = [...seen].filter(file => testFile.test(file));
  return { files, unanalyzed, modules, total: matching.length, map, selected, metrics: graph.metrics?.[selected], companions: companionsOf(graph.nodes)(selected), dependencies: dependencies.slice(0, 30), direct: direct.slice(0, 30), dependents, tests,
    affected: [...new Set([...seen].map(moduleName))], cycle, unresolved: graph.unresolved[selected] || [],
    capped: capped || dependencies.length > 30 || direct.length > 30 };
}
module.exports = { analyze, architectureMap, containedFile, excluded, indexFiles, queryGraph, resolveImport, scanSource };
