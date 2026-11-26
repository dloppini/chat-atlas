'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { execFileSync, spawn } = require('node:child_process');

test('MCP server answers quality, impact and architecture questions over stdio', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-mcp-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main');
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'core.py'), 'def run(x):\n    return x\n');
  await fs.writeFile(path.join(root, 'app.py'), 'import core\nimport helpers\n');
  await fs.writeFile(path.join(root, 'helpers.py'), 'import app\n');
  await fs.writeFile(path.join(root, 'tests', 'test_core.py'), 'import core\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Initial');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'mcp.js')], { cwd: root, env: { ...process.env, ATLAS_TYPESCRIPT: '' } });
  t.after(async () => { child.kill(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line); // Any non-JSON stdout would break MCP clients.
    pending.get(message.id)(message);
  });
  let next = 0;
  const call = (method, params) => new Promise(resolve => {
    const id = ++next;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const tool = async (name, args) => {
    const { result } = await call('tools/call', { name, arguments: args });
    return result.isError ? result.content[0].text : JSON.parse(result.content[0].text);
  };

  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.deepEqual((await call('tools/list')).result.tools.map(item => item.name), ['quality_report', 'file_impact', 'architecture']);

  const quality = await tool('quality_report', {});
  assert.equal(quality.cached, false);
  assert.deepEqual(quality.insights.cycles, [{ size: 2, files: ['app.py', 'helpers.py'], loop: [{ from: 'app.py', to: 'helpers.py', line: 2 }, { from: 'helpers.py', to: 'app.py', line: 1 }] }]);
  assert.deepEqual(quality.insights.untested.files.sort(), ['app.py', 'helpers.py']);
  assert.equal((await tool('quality_report', { path: root })).cached, true);

  const impact = await tool('file_impact', { file: path.join(root, 'core.py'), depth: 2 });
  assert.equal(impact.selected, 'core.py');
  assert.deepEqual(impact.tests, ['tests/test_core.py']);
  assert.deepEqual(impact.dependents.map(edge => edge.from).sort(), ['app.py', 'helpers.py', 'tests/test_core.py']);
  assert.match(await tool('file_impact', { file: 'src/core.py' }), /Did you mean: core\.py/);

  const map = await tool('architecture', {});
  assert.equal(map.nodes.find(node => node.id === 'core.py').layer, 0);
  assert.match(await tool('architecture', { folder: 'missing' }), /no indexed files/);
  assert.equal((await call('nope')).error.code, -32601);
});
