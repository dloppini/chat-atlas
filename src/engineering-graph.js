'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readOnlyGit } = require('./git');

const excluded = /(?:^|[/\\])(?:node_modules|dist|build|coverage|vendor|\.next|\.git)(?:[/\\]|$)/i;
const scriptSource = /\.[cm]?[jt]sx?$/i;
const cSource = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|ino|mm)$/i;
const pySource = /\.py$/i;
const header = /\.(?:h|hh|hpp|hxx)$/i;
const stem = file => file.replace(/\.[^./]+$/, '');
const config = /(?:^|\/)(?:[jt]sconfig\.json|package\.json)$/i;
const maxFiles = 4500;
const maxEdges = 18000;
const maxBytes = 24 * 1024 * 1024;
const maxFileBytes = 4 * 1024 * 1024;
const testFile = { test: file => /(?:^|\/)(?:tests?|__tests__|spec|testthat)\/|[._-](?:spec|test)s?\.\w+$|(?:^|\/)test[_-][^/]+$/i.test(file) || /[a-z\d](?:Tests?|Spec)\.\w+$|(?:^|\/)test[A-Z]\w*\.m$/.test(file) };
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
      if (item.size > maxFileBytes || bytes + item.size > maxBytes) { skipped++; continue; }
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
  // Every other language: lexical scan, no compiler or interpreter runs.
  const known = new Set([...sourceFiles.map(file => normalize(path.relative(root, file))), ...generated]);
  const byName = new Map();
  for (const file of known) { const name = file.slice(file.lastIndexOf('/') + 1).toLowerCase(); byName.set(name, [...(byName.get(name) || []), file]); }
  const entries = new Set();
  const languages = new Set(ts && [...known].some(file => scriptSource.test(file)) ? ['JS/TS'] : []);
  if (generated.size) languages.add('C/C++');
  for (const [index, from] of [...known].filter(file => !scriptSource.test(file) && !generated.has(file)).entries()) {
    if (capped) break;
    if (index % 32 === 0) await new Promise(resolve => setImmediate(resolve));
    signal.throwIfAborted();
    const scanned = scanSource(from, text.get(normalize(path.join(root, from))));
    metrics[from] = { loc: scanned.loc, complexity: scanned.complexity, churn: churn[from] || 0, ...(scanned.selfTested && { selfTested: true }) };
    functions.push(...scanned.functions);
    languages.add(scanned.language);
    if (scanned.entry) entries.add(from);
    for (const item of scanned.imports) {
      const to = resolveImport(from, item, known, byName);
      // By-name candidates that match no file are ordinary identifiers, not unresolved imports.
      if (item.implicit && !to) continue;
      if (references++ >= maxEdges) { capped = true; break; }
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
  const insights = analyze(nodes, visibleEdges, metrics, functions, entries, !!ts || languages.size > 0);
  return {
    nodes, edges: visibleEdges, unresolved, metrics, insights, generated: [...generated], fingerprint: fingerprint.digest('hex'), engine: ts?.version,
    summary: { files: nodes.length, sourceFiles: sourceFiles.length, generated: generated.size, edges: visibleEdges.length, modules: new Set(nodes.map(moduleName)).size,
      languages: [...languages], unresolved: languages.size ? unresolvedCount : null, partial: (!ts && [...known].some(file => scriptSource.test(file))) || !sourceFiles.length || capped || skipped > 0 || files.length > maxFiles || inputs.length > maxFiles }
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
const noise = (...parts) => new RegExp(parts.join('|'), 'g');
const slashes = String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*`, triple = '"""[\\s\\S]*?"""';
const dq = String.raw`"(?:\\.|[^"\\\n])*"`, sq = String.raw`'(?:\\.|[^'\\\n])*'`, ch = String.raw`'(?:\\.|[^'\\\n])'`;
const cNoise = noise(slashes, dq, sq);
const cBranch = /\b(?:if|for|while|case|catch)\b|&&|\|\||\?/g;
const braceBranch = /\b(?:if|for|foreach|while|case|catch|when|guard)\b|&&|\|\||\s\?\s/g;
const hashBranch = /\b(?:if|elsif|elseif|unless|for|while|until|when|rescue|catch)\b|&&|\|\||\band\b|\bor\b/g;
// Function headers. Brace bodies take the first defined capture as the name; indented bodies capture (indent, name).
const signatureFunction = /^[ \t]*[\w:<>,*&~@\[\].? \t]*?\b(~?[A-Za-z_][\w:]*)[ \t]*\((?:[^;{}()]|\([^()]*\))*\)/gm;
const keywordFunction = /\b(?:func|fn|fun|function|def)[ \t]+(?:\((?:[^()]|\([^()]*\))*\)[ \t]*)?(?:<[^>\n]*>[ \t]*)?((?:[A-Za-z_]\w*\.)*[A-Za-z_$][\w$]*)[ \t]*(?:<[^(\n]*>)?[ \t]*\((?:[^()]|\([^()]*\))*\)/g;
const keyword = /^(?:if|for|while|switch|catch|return|sizeof|else|do|foreach|using|lock|synchronized|when|match|new|throw|use|fixed|elif|until)$/;
const count = (text, pattern) => (text.match(pattern) || []).length;
const withExt = (name, ext) => /\.\w+$/.test(name.slice(name.lastIndexOf('/') + 1)) ? name : name + ext;
const mainEntry = (file, code) => /\bstatic\s+(?:async\s+)?[\w<>]+\s+[Mm]ain\s*\(|\b(?:fun|def)\s+main\s*\(|\bextends\s+App\b|\bvoid\s+main\s*\(/.test(code);
// JVM imports name a package path; try the class file, then the enclosing file for static or nested members.
const jvmImport = [/^\s*import\s+(?:static\s+)?([\w.]+?)\s*(?:\s+as\s+\w+)?\s*;?\s*$/, name => {
  const parts = name.split('.');
  return { name, candidates: [parts, parts.slice(0, -1)].filter(list => list.length > 1).flatMap(list => ['.java', '.kt', '.scala'].map(ext => list.join('/') + ext)) };
}];
// pattern: file extensions; imports: [row pattern, (name, file) => item]; implicit: references by name ('folder': same-folder class files, 'path': MATLAB path);
// orphans: files are only reached through resolvable references, so a file nobody references is suspect.
const lexicon = [
  { name: 'C/C++', ext: 'c|cc|cpp|cxx|h|hh|hpp|hxx|ino|mm', noise: cNoise, branch: cBranch, fn: signatureFunction, orphans: true,
    imports: [[/^\s*#\s*(?:include|import)\s*([<"][^>"]+)[>"]/, name => ({ name: name.slice(1).trim(), system: name[0] === '<' })]],
    entry: (file, code) => /\.ino$/i.test(file) || /\b(?:int|void)\s+(?:main|setup)\s*\(/.test(code) },
  { name: 'Python', ext: 'py', noise: /"""[\s\S]*?"""|'''[\s\S]*?'''|#[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, branch: /\b(?:if|elif|for|while|except|and|or|case)\b/g, orphans: true,
    entry: (file, code, content) => /if\s+__name__\s*==\s*['"]__main__['"]/.test(content) },
  { name: 'Java', ext: 'java', noise: noise(slashes, triple, dq, ch), branch: braceBranch, fn: signatureFunction, imports: [jvmImport], implicit: 'folder', entry: mainEntry },
  { name: 'Kotlin', ext: 'kt|kts', noise: noise(slashes, triple, dq, ch), branch: braceBranch, fn: keywordFunction, imports: [jvmImport], implicit: 'folder', entry: mainEntry },
  { name: 'Scala', ext: 'scala|sc', noise: noise(slashes, triple, dq, ch), branch: braceBranch, fn: keywordFunction, imports: [jvmImport], implicit: 'folder', entry: mainEntry },
  { name: 'C#', ext: 'cs', noise: noise(slashes, '@"(?:""|[^"])*"', triple, dq, ch), branch: braceBranch, fn: signatureFunction, implicit: 'folder', entry: mainEntry },
  { name: 'Go', ext: 'go', noise: noise(slashes, '`[^`]*`', dq, ch), branch: braceBranch, fn: keywordFunction, entry: (file, code) => /^\s*package\s+main\b/m.test(code) },
  { name: 'Rust', ext: 'rs', noise: noise(slashes, 'r#*"[\\s\\S]*?"#*', dq, ch), branch: braceBranch, fn: keywordFunction, orphans: true, selfTested: /#\[(?:cfg\()?test\b/,
    // `mod x;` loads x.rs or x/mod.rs beside a mod.rs/main.rs/lib.rs, else inside the declaring file's own folder.
    imports: [[/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/, (name, file) => ({ name, relative: true,
      candidates: [name + '.rs', name + '/mod.rs', ...(/(?:^|\/)(?:mod|main|lib)\.rs$/.test(file) ? [] : [stem(file.slice(file.lastIndexOf('/') + 1)) + '/' + name + '.rs'])] })]],
    entry: file => /(?:^|\/)(?:main|lib|build)\.rs$|(?:^|\/)(?:bin|examples|benches)\//.test(file) },
  { name: 'Swift', ext: 'swift', noise: noise(slashes, triple, dq), branch: braceBranch, fn: keywordFunction, implicit: 'folder',
    entry: (file, code) => /(?:^|\/)main\.swift$/.test(file) || /@main\b/.test(code) },
  { name: 'Dart', ext: 'dart', noise: noise(slashes, "'''[\\s\\S]*?'''", triple, dq, sq), branch: braceBranch, fn: signatureFunction, orphans: true, entry: mainEntry,
    imports: [[/^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/, name => name.startsWith('dart:') ? null
      : name.startsWith('package:') ? { name, candidates: ['lib/' + name.slice(name.indexOf('/') + 1)] } : { name, candidates: [name], relative: true }]] },
  { name: 'PHP', ext: 'php', noise: noise(slashes, '#(?!\\[)[^\\n]*', dq, sq), branch: braceBranch, fn: keywordFunction,
    imports: [[/^\s*(?:require|include)(?:_once)?\b[\s(]*(?:__DIR__\s*\.\s*)?['"]\/?([^'"]+)['"]/, name => ({ name, candidates: [name] })],
      [/^\s*use\s+(?:function\s+|const\s+)?\\?([\w\\]+)\s*(?:as\s+\w+\s*)?;/, name => ({ name, candidates: [name.replace(/\\/g, '/') + '.php'] })]] },
  { name: 'Ruby', ext: 'rb|rake', noise: noise('#[^\\n]*', dq, sq), branch: hashBranch, fn: /^([ \t]*)def[ \t]+(?:self\.)?([\w?!=]+)/, body: 'indent',
    imports: [[/^\s*require_relative\s*\(?\s*['"]([^'"]+)['"]/, name => ({ name, candidates: [withExt(name, '.rb')], relative: true })],
      [/^\s*(?:require|load)\s*\(?\s*['"]([^'"]+)['"]/, name => ({ name, candidates: [withExt(name, '.rb')] })]] },
  { name: 'Lua', ext: 'lua', noise: noise('--\\[(=*)\\[[\\s\\S]*?\\]\\1\\]', '--[^\\n]*', dq, sq), branch: hashBranch, fn: /^([ \t]*)(?:local[ \t]+)?function[ \t]+([\w.:]+)/, body: 'indent',
    imports: [[/\brequire\s*\(?\s*['"]([\w./-]+)['"]/, name => ({ name, candidates: [name.replace(/\./g, '/') + '.lua', name.replace(/\./g, '/') + '/init.lua'] })]] },
  { name: 'R', ext: 'r', noise: noise('#[^\\n]*', dq, sq), branch: /\b(?:if|for|while|repeat)\b|&&|\|\|/g, fn: /^[ \t]*([\w.]+)[ \t]*(?:<-|=)[ \t]*function[ \t]*\((?:[^()]|\([^()]*\))*\)/gm,
    imports: [[/\bsource\s*\(\s*['"]([^'"]+)['"]/, name => ({ name, candidates: [name] })]] },
  { name: 'Julia', ext: 'jl', noise: noise('#=[\\s\\S]*?=#', '#[^\\n]*', triple, dq), branch: hashBranch, fn: /^([ \t]*)function[ \t]+([\w.!]+)/, body: 'indent',
    imports: [[/\binclude\s*\(\s*"([^"]+)"/, name => ({ name, candidates: [name], relative: true })]] },
  { name: 'MATLAB', ext: 'm', noise: noise('%\\{[\\s\\S]*?%\\}', '%[^\\n]*', '\\.\\.\\.[^\\n]*', '"(?:""|[^"\\n])*"', "(?<![\\w)\\]}.'])'(?:''|[^'\\n])*'"),
    branch: /\b(?:if|elseif|for|parfor|while|case|catch)\b|&&|\|\|/g, fn: /^([ \t]*)function[ \t]+(?:(?:\[[^\]\n]*\]|\w+)[ \t]*=[ \t]*)?([A-Za-z][\w.]*)/, body: 'next',
    // Scripts (no leading function or classdef) run from the command line, so they are entry points.
    implicit: 'path', orphans: true, entry: (file, code) => !/^\s*(?:function|classdef)\b/.test(code) },
  { name: 'Shell', ext: 'sh|bash|zsh', noise: noise('(?<![$\\\\\\w{])#[^\\n]*', dq, "'[^']*'"), branch: /\b(?:if|elif|for|while|until)\b|&&|\|\||;;/g,
    fn: /^[ \t]*(?:function[ \t]+([A-Za-z_][\w:.-]*)|([A-Za-z_][\w:.-]*)[ \t]*\(\s*\))/gm,
    imports: [[/^\s*(?:source|\.)\s+["']?(?:\$\{?\w+\}?\/)?([\w./-]+\.(?:sh|bash|zsh))/, name => ({ name, candidates: [name] })]] }
];
for (const lang of lexicon) lang.pattern = new RegExp(`\\.(?:${lang.ext})$`, 'i');
const source = new RegExp(`\\.(?:[cm]?[jt]sx?|${lexicon.map(lang => lang.ext).join('|')})$`, 'i');
const objectiveC = /^\s*(?:#\s*(?:import|include)|@(?:interface|implementation|import|protocol))\b/m;
// .m is MATLAB unless the file reads as Objective-C.
const languageOf = (file, content) => /\.m$/i.test(file) && objectiveC.test(content) ? lexicon[0] : lexicon.find(lang => lang.pattern.test(file));

// Lexical scan: imports, decision points and function bodies; no compiler or interpreter runs.
function scanSource(file, content) {
  const lang = languageOf(file, content);
  const code = content.replace(lang.noise, blank);
  const rows = code.split('\n');
  const imports = [], functions = [], defined = new Set();
  const starts = [0];
  for (let index = code.indexOf('\n'); index >= 0; index = code.indexOf('\n', index + 1)) starts.push(index + 1);
  const lineAt = offset => { let low = 0, high = starts.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid] <= offset) low = mid; else high = mid - 1; } return low + 1; };
  const add = (name, line, lines, complexity) => { defined.add(name); functions.push({ file, name: name.slice(0, 80), line, lines, complexity }); };
  if (lang.name === 'Python') {
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
      add(fn[2], index + 1, end - index + 1, 1 + count(rows.slice(index, end + 1).join('\n'), lang.branch));
    });
  } else {
    // Imports are read from the original row (string paths survive) only where the stripped row keeps the keyword, so commented-out imports are skipped.
    content.split('\n').forEach((row, index) => {
      const kept = rows[index].trimStart();
      if (!kept || kept[0] !== row.trimStart()[0]) return;
      for (const [pattern, map] of lang.imports || []) {
        const match = pattern.exec(row), item = match && map(match[1], file);
        if (item) imports.push({ ...item, line: index + 1 });
      }
    });
    if (!lang.body) {
      lang.fn.lastIndex = 0;
      for (let match; (match = lang.fn.exec(code));) {
        const name = match.slice(1).find(Boolean), after = match.index + match[0].length;
        // The body brace follows the header; `;` (declaration) or `= expr` (expression body) means there is none.
        const gap = /^[^;{}=]*?(?:=\s*)?\{/.exec(code.slice(after, after + 400));
        if (!gap || keyword.test(name) || /\b(?:func|fn|fun|def|function)\s/.test(gap[0])) continue;
        const open = after + gap[0].length - 1;
        let depth = 0, close = open;
        for (; close < code.length; close++) { if (code[close] === '{') depth++; else if (code[close] === '}' && !--depth) break; }
        const begin = lineAt(match.index + match[0].search(/\S/));
        add(name, begin, lineAt(close) - begin + 1, 1 + count(code.slice(open, close), lang.branch));
        lang.fn.lastIndex = close + 1;
      }
    } else rows.forEach((row, index) => {
      const match = lang.fn.exec(row);
      if (!match) return;
      const indent = match[1].length;
      let end = index;
      for (let next = index + 1; next < rows.length; next++) {
        if (!rows[next].trim()) continue;
        const depth = /^\s*/.exec(rows[next])[0].length;
        // shortcut: MATLAB bodies run to the next function at the same indent (top-level bodies are often unindented); nested `end` counting would be exact.
        if (lang.body === 'next') { if (depth <= indent && lang.fn.test(rows[next])) break; }
        else if (depth <= indent && !/^\s*(?:rescue|ensure)\b/.test(rows[next])) { if (/^\s*end\b/.test(rows[next])) end = next; break; }
        end = next;
      }
      add(match[2], index + 1, end - index + 1, 1 + count(rows.slice(index, end + 1).join('\n'), lang.branch));
    });
  }
  // Same-folder classes (JVM, C#, Swift) and MATLAB path functions are used by name without an import; candidates resolve only when a file matches.
  if (lang.implicit) {
    const seen = new Set([stem(file.slice(file.lastIndexOf('/') + 1)), ...defined]);
    for (const match of code.matchAll(lang.implicit === 'folder' ? /\b[A-Z]\w*/g : /(?<![\w.])[A-Za-z]\w*(?:\.[A-Za-z]\w*)*/g)) {
      if (!seen.has(match[0])) { seen.add(match[0]); imports.push({ name: match[0], line: lineAt(match.index), implicit: lang.implicit }); }
    }
  }
  return { language: lang.name, loc: lines(content), complexity: 1 + count(code, lang.branch), imports, entry: !!lang.entry?.(file, code, content), selfTested: !!lang.selfTested?.test(code),
    functions: functions.filter(item => item.complexity >= 10 || item.lines >= 60) };
}

const sharedDepth = (a, b) => { const x = a.split('/'), y = b.split('/'); let depth = 0; while (depth < x.length && x[depth] === y[depth]) depth++; return depth; };
// Resolves an import, include or by-name reference to an indexed file; external and system modules stay unresolved.
function resolveImport(from, item, known, byName) {
  const dir = path.posix.dirname(from);
  const nearest = (name, keep) => (byName.get(name.toLowerCase()) || []).filter(keep).sort((a, b) => sharedDepth(b, from) - sharedDepth(a, from))[0];
  if (item.implicit === 'folder') { const to = path.posix.join(dir, item.name + path.posix.extname(from)); return known.has(to) ? to : undefined; }
  if (item.implicit === 'path') {
    // pkg.fn lives in +pkg/fn.m; a bare name never reaches into a package folder.
    const parts = item.name.split('.'), name = parts.pop() + '.m', wanted = '/' + parts.map(part => '+' + part + '/').join('') + name;
    return nearest(name, file => ('/' + file).endsWith(wanted) && (parts.length > 0 || !/(?:^|\/)\+/.test(file)));
  }
  if (pySource.test(from)) {
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
    return;
  }
  for (const name of item.candidates || [item.name]) {
    const relative = path.posix.normalize(path.posix.join(dir, name));
    if (known.has(relative)) return relative;
    if (item.relative) continue;
    // Include and source paths are unknown without the build system; match the path suffix, nearest folder first.
    // <system> includes only match inside the includer's top-level folder, so test stubs elsewhere never stand in for the SDK.
    const wanted = '/' + name.toLowerCase();
    const found = nearest(name.split('/').pop(), file => ('/' + file).toLowerCase().endsWith(wanted) && (!item.system || sharedDepth(file, from) > 0));
    if (found) return found;
  }
}

// C/C++/Objective-C: a header and its same-named implementation are one unit; code using the header uses the implementation.
const companion = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm)$/i;
function companionsOf(files) {
  const stems = new Map();
  for (const file of files) if (companion.test(file)) { const key = stem(file).toLowerCase(); stems.set(key, [...(stems.get(key) || []), file]); }
  return file => companion.test(file) ? (stems.get(stem(file).toLowerCase()) || []).filter(other => other !== file) : [];
}

function analyze(nodes, edges, metrics, functions, entries, compiled) {
  const sources = nodes.filter(file => source.test(file) && metrics[file]);
  const outgoing = new Map(sources.map(file => [file, new Set()])), incoming = new Map(sources.map(file => [file, new Set()]));
  for (const edge of edges) if (outgoing.has(edge.from) && outgoing.has(edge.to)) { outgoing.get(edge.from).add(edge.to); incoming.get(edge.to).add(edge.from); }
  const cycles = components(sources, file => outgoing.get(file))
    .filter(group => group.length > 1 || outgoing.get(group[0]).has(group[0]))
    .sort((a, b) => b.length - a.length);
  const importLine = new Map();
  for (const edge of edges) if (!importLine.has(edge.from + '\n' + edge.to)) importLine.set(edge.from + '\n' + edge.to, edge.line);
  // Shortest import chain from the alphabetically first member back to itself, with the line of each import.
  const loopOf = group => {
    const members = new Set(group), start = [...group].sort()[0], prev = new Map();
    for (const queue = [start]; queue.length;) {
      const file = queue.shift();
      for (const next of outgoing.get(file)) {
        if (next === start) {
          const chain = [file];
          while (chain[0] !== start) chain.unshift(prev.get(chain[0]));
          chain.push(start);
          return chain.slice(0, -1).map((from, index) => ({ from, to: chain[index + 1], line: importLine.get(from + '\n' + chain[index + 1]) }));
        }
        if (members.has(next) && !prev.has(next)) { prev.set(next, file); queue.push(next); }
      }
    }
  };
  const tests =sources.filter(file => testFile.test(file));
  const companions = companionsOf(sources);
  // Outside JS/TS, Python and C, tests rarely import what they test by path: a test also covers its same-named source (FooTest.java → Foo.java),
  // a Go test its package folder, and a Rust file with #[test] itself.
  const linkedTest = /\.(?:[cm]?[jt]sx?|py|c|cc|cpp|cxx|h|hh|hpp|hxx|ino)$/i;
  const base = file => stem(file.slice(file.lastIndexOf('/') + 1));
  const bare = file => { const name = base(file).replace(/[._-]?(?:test|spec)s?$/i, ''); return name !== base(file) ? name : name.replace(/^test[_-]?/i, ''); };
  const byStem = new Map();
  for (const file of sources) { const key = (base(file) + path.posix.extname(file)).toLowerCase(); byStem.set(key, [...(byStem.get(key) || []), file]); }
  const seeds = sources.filter(file => metrics[file]?.selfTested);
  for (const test of tests) if (!linkedTest.test(test)) {
    seeds.push(...(byStem.get((bare(test) + path.posix.extname(test)).toLowerCase()) || []));
    if (/\.go$/i.test(test)) seeds.push(...sources.filter(file => folderOf(file) === folderOf(test)));
  }
  const covered = new Set([...tests, ...seeds]);
  for (const queue = [...covered]; queue.length;) {
    const file = queue.pop();
    for (const next of [...(outgoing.get(file) || []), ...companions(file)]) if (!covered.has(next)) { covered.add(next); queue.push(next); }
  }
  const production = sources.filter(file => !testFile.test(file));
  const tooling = /(?:^|\/)(?:scripts?|bin|tools)\/|(?:^|\/)[^/]*\.config\.[cm]?[jt]s$/i;
  // Only languages whose every use is a resolvable reference can have orphans. C/C++ implementation files are compiled and linked, never included,
  // so only headers can; JVM, C#, Go, Ruby or PHP code is also reached by package, autoload or framework wiring the scan cannot see.
  const orphanable = file => scriptSource.test(file) || (!!lexicon.find(lang => lang.pattern.test(file))?.orphans && !/\.(?:c|cc|cpp|cxx|mm)$/i.test(file));
  const orphans = compiled ? production.filter(file => !incoming.get(file).size && !companions(file).some(other => incoming.get(other)?.size) && !entries.has(file) && !tooling.test(file) && orphanable(file)) : [];
  const untested = compiled && (tests.length || seeds.length) ? production.filter(file => !covered.has(file) && !tooling.test(file)) : [];
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
    cycles: cycles.slice(0, 20).map(group => ({ size: group.length, files: group.sort().slice(0, 12), loop: loopOf(group) })),
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
