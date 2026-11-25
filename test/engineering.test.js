'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { writeFileSync, unlinkSync, utimesSync } = require('node:fs');
const { createEngineering } = require('../src/engineering');
const { indexFiles, queryGraph } = require('../src/engineering-graph');
const compilerPath = process.env.ATLAS_TEST_TYPESCRIPT;

test('Engineering snapshots stay scoped to their project and Git worktree', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-engineering-'));
  const a = path.join(root, 'a', 'project'), b = path.join(root, 'b', 'project');
  const git = (...args) => execFileSync('git', args, { cwd: a, stdio: 'pipe' });
  await fs.mkdir(a, { recursive: true });
  await fs.mkdir(path.dirname(b), { recursive: true });
  git('init', '-b', 'main');
  await fs.writeFile(path.join(a, 'main.js'), 'module.exports = 1;\n');
  await fs.writeFile(path.join(a, '.gitignore'), 'scratch.tmp\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Initial');
  git('worktree', 'add', '-b', 'review', b);
  await fs.writeFile(path.join(b, 'extra.js'), 'module.exports = 2;\n');
  const source = path.join(a, 'main.js');
  const originalTime = new Date('2025-01-01T00:00:00Z');
  await fs.utimes(source, originalTime, originalTime);
  let duringIndex;
  const messages = [], stored = new Map(), clipboard = [], opened = [];
  const options = { catalog: () => [{ key:'a', name:'Project A', cwd:a }, { key:'b', name:'Project B', cwd:b }], storage: {
    get: key => stored.get(key), update: async (key, value) => stored.set(key, structuredClone(value))
  }, local:true, post: message => messages.push(message), copy: async value => clipboard.push(value),
    compiler: () => { duringIndex?.(); },
    openFile: async (file, line) => opened.push({ file, line }) };
  const engineering = createEngineering(options);
  t.after(async () => { engineering.dispose(); await fs.rm(root, { recursive:true, force:true, maxRetries:10, retryDelay:100 }); });
  const request = (type, projectKey, requestId = 1) => engineering.handle({ type, projectKey, requestId });
  await Promise.all([request('engineeringRefresh', 'a'), request('engineeringRead', 'b')]);
  assert.equal(messages.find(item => item.projectKey === 'b').state, 'Never analyzed');
  await request('engineeringRefresh', 'b');
  const snapshot = key => messages.find(item => item.projectKey === key && item.snapshot).snapshot;
  assert.equal(snapshot('a').repo.branch, 'main');
  assert.equal(snapshot('b').repo.branch, 'review');
  assert.equal(snapshot('a').repo.commonDir, snapshot('b').repo.commonDir);
  assert.notEqual(snapshot('a').repo.worktree, snapshot('b').repo.worktree);
  assert.equal(snapshot('b').repo.counts.untracked, 1);
  await engineering.handle({ type:'engineeringCopy', projectKey:'b', requestId:2, target:'extra.js' });
  assert.match(clipboard[0], /Project: Project B/);
  assert.match(clipboard[0], /Branch \/ HEAD: review/);
  await engineering.handle({ type:'engineeringOpen', projectKey:'b', requestId:3, target:'extra.js' });
  assert.deepEqual(opened, [{ file:path.join(b, 'extra.js'), line:1 }]);
  const restored = createEngineering(options);
  await restored.handle({ type:'engineeringRead', projectKey:'b', requestId:4 });
  assert.equal(messages.at(-1).state, 'Stale');
  assert.equal(messages.at(-1).snapshot.repo.branch, 'review');
  restored.dispose();
  await request('engineeringClear', 'b');
  await request('engineeringRead', 'a', 2);
  assert.equal(messages.at(-1).snapshot.repo.branch, 'main');
  const invalid = { type:'engineeringOpen', projectKey:'a', requestId:3, target:'../private.js' };
  await engineering.handle(invalid);
  assert.match(messages.at(-1).text, /indexed snapshot/);
  await fs.writeFile(path.join(a, 'main.js'), 'module.exports = 3;\n');
  for (let i = 0; i < 80 && !messages.some(item => item.projectKey === 'a' && item.state === 'Stale'); i++) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(messages.some(item => item.projectKey === 'a' && item.state === 'Stale'));
  const refreshing = request('engineeringRefresh', 'a', 5);
  for (let i = 0; i < 80 && !messages.some(item => item.requestId === 5 && item.state === 'Analyzing'); i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await request('engineeringCancel', 'a', 6);
  await refreshing;
  assert.equal(messages.at(-1).state, 'Canceled');
  await request('engineeringRead', 'a', 7);
  assert.equal(messages.at(-1).snapshot.time, snapshot('a').time);
  duringIndex = () => {
    const lock = path.join(a, '.git', 'index.lock');
    writeFileSync(lock, '', { flag: 'wx' });
    unlinkSync(lock);
    writeFileSync(path.join(a, 'scratch.tmp'), 'ignored build output');
    if (process.platform === 'win32') utimesSync(source, new Date(), originalTime);
  };
  await request('engineeringRefresh', 'a', 8);
  assert.equal(messages.at(-1).state, 'Current');
  const refreshed = messages.at(-1).snapshot;
  duringIndex = () => writeFileSync(source, 'module.exports = 4;\n');
  await request('engineeringRefresh', 'a', 9);
  assert.equal(messages.at(-1).state, 'Stale');
  await request('engineeringRead', 'a', 10);
  assert.equal(messages.at(-1).snapshot.time, refreshed.time);
});

test('Bundled compiler resolves aliases and traces cycles and transitive dependents', { skip: !compilerPath && 'Set ATLAS_TEST_TYPESCRIPT to VS Code’s bundled typescript.js.' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-graph-'));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  execFileSync('git', ['init'], { cwd:root, stdio:'pipe' });
  const samples = {
    'tsconfig.json': '{"compilerOptions":{"paths":{"@app/*":["./*"]}}}',
    'a.ts': 'export {b} from "@app/b";\nimport "missing-package";',
    'b.ts': 'import "./a";\nexport const b = 1;',
    'top.test.ts': 'import "./b";',
    'removed.ts': 'export {};'
  };
  for (const [file, source] of Object.entries(samples)) await fs.writeFile(path.join(root, file), source);
  execFileSync('git', ['add', '.'], { cwd:root, stdio:'pipe' });
  await fs.unlink(path.join(root, 'removed.ts'));
  const ts = require(compilerPath);
  const graph = await indexFiles({root}, ts, new AbortController().signal);
  const result = queryGraph(graph, {target:'a.ts', depth:3});
  assert.equal(result.dependencies[0].to, 'b.ts');
  assert.equal(result.dependencies[0].line, 1);
  assert.deepEqual(result.dependents.map(item => [item.from, item.distance]), [['b.ts', 1], ['top.test.ts', 2]]);
  assert.deepEqual(result.tests, ['top.test.ts']);
  assert.deepEqual(result.unresolved, ['missing-package']);
  assert.equal(result.cycle, true);
  assert.equal(queryGraph(graph, {target:'removed.ts'}).selected, undefined);
  const fallback = await indexFiles({root}, undefined, new AbortController().signal);
  assert.equal(fallback.summary.partial, true);
  assert.equal(fallback.summary.unresolved, null);
});

test('Quality insights find cycles, test reach, orphans and a layered folder map', () => {
  const { analyze, architectureMap } = require('../src/engineering-graph');
  const nodes = ['src/a.js', 'src/b.js', 'src/lib/c.js', 'src/unused.js', 'main.js', 'test/a.test.js', 'scripts/tool.js'];
  const link = (from, to) => ({ from, to, line: 1, column: 1 });
  const edges = [link('main.js', 'src/a.js'), link('src/a.js', 'src/b.js'), link('src/b.js', 'src/a.js'), link('src/a.js', 'src/lib/c.js'), link('test/a.test.js', 'src/lib/c.js')];
  const metrics = Object.fromEntries(nodes.map((file, index) => [file, { loc: 10 * (index + 1), complexity: index + 1, churn: file === 'src/a.js' ? 10 : 0 }]));
  const insights = analyze(nodes, edges, metrics, [], new Set(['main.js']), true);
  assert.deepEqual(insights.cycles, [{ size: 2, files: ['src/a.js', 'src/b.js'] }]);
  assert.deepEqual(insights.orphans.files, ['src/unused.js']);
  assert.deepEqual(insights.untested.files.sort(), ['main.js', 'src/a.js', 'src/b.js', 'src/unused.js']);
  assert.equal(insights.hotspots[0].file, 'src/a.js');
  assert.deepEqual(insights.folders.find(folder => folder.folder === 'src/lib'), { folder: 'src/lib', files: 1, loc: 30, complexity: 3, afferent: 2, efferent: 0, instability: 0 });
  const map = architectureMap({ nodes, edges, metrics, insights }, 'src');
  const layer = id => map.nodes.find(node => node.id === id).layer;
  assert.equal(layer('src/lib/'), 0);
  assert.ok(layer('src/a.js') > layer('src/lib/') && layer('src/a.js') === layer('src/b.js'));
  assert.ok(map.nodes.find(node => node.id === 'src/a.js').cyclic);
  assert.deepEqual(map.nodes.find(node => node.id === 'src/lib/').external, { in: 1, out: 0 });
  assert.ok(map.edges.some(edge => edge.from === 'src/a.js' && edge.to === 'src/b.js' && edge.cyclic));
});

test('C/C++/Arduino and Python sources yield imports, branches and function bodies', () => {
  const { scanSource, resolveImport, analyze } = require('../src/engineering-graph');
  const known = new Set(['app/main.ino', 'app/page.h', 'app/page.cpp', 'lib/util.h', 'tests/Arduino.h', 'tools/run.py', 'tools/helpers/__init__.py', 'tools/helpers/fmt.py']);
  const byName = new Map();
  for (const file of known) { const name = file.split('/').pop().toLowerCase(); byName.set(name, [...(byName.get(name) || []), file]); }
  const c = scanSource('app/page.cpp', [
    '#include "page.h"', '#include <Arduino.h>', '#include "util.h"', '// #include "ghost.h"',
    'void draw(int x) {', '  if (x > 0 && x < 9) { show("{"); }', '  for (;;) {}', '}',
    'static int Page::count() const { return 1; }'
  ].join('\n'));
  assert.deepEqual(c.imports.map(item => item.name), ['page.h', 'Arduino.h', 'util.h']);
  assert.equal(c.complexity, 4);
  assert.equal(resolveImport('app/page.cpp', c.imports[0], known, byName), 'app/page.h');
  assert.equal(resolveImport('app/page.cpp', c.imports[1], known, byName), undefined, 'system include must not resolve to a stub in another top-level folder');
  assert.equal(resolveImport('app/page.cpp', c.imports[2], known, byName), 'lib/util.h');
  const functions = scanSource('app/page.cpp', 'int setup() {\n' + '  if (a) {}\n'.repeat(12) + '}\n').functions;
  assert.deepEqual(functions.map(fn => [fn.name, fn.line, fn.lines, fn.complexity]), [['setup', 1, 14, 13]]);
  assert.ok(scanSource('app/main.ino', 'void loop() {}').entry);
  const py = scanSource('tools/run.py', 'import os, json\nfrom .helpers import fmt\nfrom helpers.fmt import Pretty\n"""from fake import x"""\ndef main(\n  a,\n):\n    if a and b:\n        pass\n\nif __name__ == "__main__":\n    main()\n');
  assert.deepEqual(py.imports.map(item => item.name), ['os', 'json', '.helpers', 'helpers.fmt']);
  assert.equal(resolveImport('tools/run.py', py.imports[2], known, byName), 'tools/helpers/fmt.py');
  assert.equal(resolveImport('tools/run.py', py.imports[3], known, byName), 'tools/helpers/fmt.py');
  assert.equal(resolveImport('tools/run.py', py.imports[0], known, byName), undefined);
  assert.ok(py.entry);
  // A .cpp is reached through its header: not an orphan, and covered when a test includes the header.
  const metrics = Object.fromEntries(['app/page.h', 'app/page.cpp', 'app/main.ino', 'tests/page_test.cpp'].map(file => [file, { loc: 1, complexity: 1, churn: 0 }]));
  const insights = analyze(Object.keys(metrics), [{ from: 'app/main.ino', to: 'app/page.h' }, { from: 'tests/page_test.cpp', to: 'app/page.h' }], metrics, [], new Set(['app/main.ino']), true);
  assert.deepEqual(insights.orphans.files, []);
  assert.deepEqual(insights.untested.files, ['app/main.ino']);
});
