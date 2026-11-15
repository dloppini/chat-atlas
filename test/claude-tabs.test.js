'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fixture() {
  const filename = path.resolve(__dirname, '../src/claude-tabs.js');
  const nativeSource = path.resolve('fixture-claude/extension.js');
  const root = path.resolve('fixture-project-a'), target = path.resolve('fixture-project-b');
  const calls = [], realpaths = [];
  const original = Object.assign(value => { realpaths.push(value); return value; }, { native: () => 'native' });
  const fakeFs = {
    realpathSync: original,
    promises: { realpath: async value => value, stat: async () => ({ isDirectory: () => true }), readFile: async () => 'bundle' }
  };
  let hash = 'cdc6cc5caf6a677dffe798c3805266a9e0612d0fe722b240a87bc9ce5e20060e';
  const localRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, process: { platform: 'win32' }, Buffer,
    require: name => name === 'node:fs' ? fakeFs : name === 'node:crypto' ? { createHash: () => ({ update: () => ({ digest: () => hash }) }) } : localRequire(name)
  }, { filename });
  const panel = vm.runInNewContext('({setupPanel() { return fs.realpathSync(root); }})', { fs: fakeFs, root }, { filename: nativeSource });
  const extension = { extensionPath: path.dirname(nativeSource), packageJSON: { version: '2.1.323' }, activate: async () => calls.push('activate') };
  const vscode = {
    workspace: { isTrusted: true, workspaceFolders: [{ uri: { scheme: 'file', fsPath: root } }] },
    ViewColumn: { Active: -1, Beside: -2 },
    commands: { getCommands: async () => ['claude-vscode.editor.open'], executeCommand: async (...args) => {
      calls.push(args);
      assert.equal(fakeFs.realpathSync.native, original.native);
      assert.equal(fakeFs.realpathSync(root), root, 'unrelated reads of workspace root are not redirected');
      calls.push({ cwd: panel.setupPanel() });
      assert.equal(fakeFs.realpathSync, original, 'restore immediately after the one interception');
    } }
  };
  return { open: module.exports.openClaudeProjectTab, vscode, extension, fakeFs, original, calls, realpaths, root, target, panel, setHash: value => { hash = value; } };
}

test('Claude tabs isolate simultaneous requests and preserve native session IDs and workspace', async () => {
  const f = fixture(), roots = structuredClone(f.vscode.workspace.workspaceFolders);
  const second = path.resolve('fixture-project-c');
  await Promise.all([f.open(f.vscode, f.extension, f.target, id), f.open(f.vscode, f.extension, second)]);
  const commands = f.calls.filter(Array.isArray);
  assert.deepEqual(commands.map(args => Array.from(args)), [
    ['claude-vscode.editor.open', id, undefined, -1, undefined, true],
    ['claude-vscode.editor.open', undefined, undefined, -1, undefined, true]
  ]);
  assert.deepEqual(f.calls.filter(x => x.cwd).map(x => x.cwd), [f.target, second]);
  assert.deepEqual(f.vscode.workspace.workspaceFolders, roots);
  assert.equal(f.fakeFs.realpathSync, f.original);
});

test('Claude bridge restores after failure, accepts native reuse and continues the queue', async () => {
  const f = fixture();
  f.vscode.commands.executeCommand = async () => { throw new Error('command failed'); };
  await assert.rejects(f.open(f.vscode, f.extension, f.target, id), /command failed/);
  assert.equal(f.fakeFs.realpathSync, f.original);
  f.vscode.commands.executeCommand = async () => {}; // Native already owns this session.
  await f.open(f.vscode, f.extension, f.target, id);
  await assert.rejects(f.open(f.vscode, f.extension, f.target), /did not create a project tab/);
  assert.equal(f.fakeFs.realpathSync, f.original);
  f.vscode.commands.executeCommand = async (...args) => { assert.equal(args[3], -2); assert.equal(f.panel.setupPanel(), f.target); };
  await f.open(f.vscode, f.extension, f.target, id, true);
});

test('Claude refuses unverified bundles and invalid targets before any native command', async () => {
  for (const change of [
    f => f.setHash('updated-bundle'),
    f => { f.extension.packageJSON.version = '2.1.324'; },
    f => { f.vscode.workspace.isTrusted = false; },
    f => { f.fakeFs.promises.stat = async () => ({ isDirectory: () => false }); },
    f => { f.vscode.workspace.workspaceFolders[0].uri.scheme = 'vscode-remote'; },
    f => { f.fakeFs.promises.realpath = async () => { throw new Error('Missing project'); }; }
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.open(f.vscode, f.extension, f.target, id));
    assert.deepEqual(f.calls, []);
    assert.equal(f.fakeFs.realpathSync, f.original);
  }
  const f = fixture();
  await assert.rejects(f.open(f.vscode, f.extension, f.target, 'bad;id'), /Invalid session/);
  await assert.rejects(f.open(f.vscode, f.extension, 'relative', id), /absolute project directory/);
  assert.deepEqual(f.calls, []);
});

test('Claude directory bridge does not redirect a concurrent call outside the initiating async context', async () => {
  const f = fixture();
  let release, outside;
  const waiting = new Promise(resolve => { release = resolve; }).then(() => { outside = f.panel.setupPanel(); });
  f.vscode.commands.executeCommand = async () => {
    release(); await waiting;
    assert.equal(outside, f.root);
    assert.equal(f.panel.setupPanel(), f.target);
  };
  await f.open(f.vscode, f.extension, f.target, id);
});

test('Provider cross-project create/resume routes to native tabs without workspace or reload commands', async () => {
  const filename = path.resolve(__dirname, '../src/providers.js'), calls = [];
  const module = { exports: {} }, localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => name === './claude-tabs' ? { openClaudeProjectTab: (...args) => calls.push(args) } : localRequire(name) }, { filename });
  const f = fixture(); f.vscode.extensions = { getExtension: () => f.extension };
  f.vscode.commands.executeCommand = () => assert.fail('No direct native or reload command');
  await module.exports.openNewProjectChat(f.vscode, 'claude', f.target);
  assert.equal(await module.exports.openNativeSession(f.vscode, { provider: 'claude', cwd: f.target, id }, true), true);
  assert.equal(calls[0][2], f.target);
  assert.equal(calls[1][3], id);
  assert.equal(calls[1][4], true);
});
