'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fixture(extensionPath = 'fixture-claude') {
  const filename = path.resolve(__dirname, '../src/claude-tabs.js');
  const nativeSource = path.resolve(extensionPath, 'extension.js');
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
    window: { tabGroups: { all: [], activeTabGroup: undefined } },
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
    ['claude-vscode.editor.open', id, undefined, -2, undefined, true],
    ['claude-vscode.editor.open', undefined, undefined, -2, undefined, true]
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
  await f.open(f.vscode, f.extension, f.target, id);
});

test('Claude refuses unverified bundles and invalid targets before any native command', async () => {
  for (const change of [
    f => f.setHash('updated-bundle'),
    f => { f.extension.packageJSON.version = '2.1.324'; },
    f => { f.extension.packageJSON.version = '2.1.325'; }, // The old fingerprint must not authorize a newer version.
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

test('Claude 2.1.325 supports cross-project resume and creation with its own fingerprint', async () => {
  const f = fixture();
  f.extension.packageJSON.version = '2.1.325';
  f.setHash('1f94855dd66098c4ef63cc54b20f14fc08483c7a766249cb16500a3f5bbff12f');
  await f.open(f.vscode, f.extension, f.target, id);
  await f.open(f.vscode, f.extension, f.target);
  assert.deepEqual(f.calls.filter(x => x.cwd).map(x => x.cwd), [f.target, f.target]);
  assert.equal(f.fakeFs.realpathSync, f.original);
});

test('Cross-project chats reuse a separate Claude group beside the active board', async () => {
  const f = fixture();
  const tab = { input: { viewType: 'mainThreadWebview-claudeVSCodePanel' } };
  const activeTabGroup = { viewColumn: 1, tabs: [tab] };
  f.vscode.window.tabGroups = { activeTabGroup, all: [activeTabGroup, { viewColumn: 3, tabs: [tab] }] };
  await f.open(f.vscode, f.extension, f.target, id);
  assert.equal(f.calls.find(Array.isArray)[3], 3);
});

test('Installed Claude panel directory code works with the bridge', {
  skip: !process.env.CLAUDE_TEST_EXTENSION
}, async () => {
  const extensionPath = process.env.CLAUDE_TEST_EXTENSION;
  const filename = path.resolve(extensionPath, 'extension.js');
  const source = fs.readFileSync(filename, 'utf8');
  const f = fixture(extensionPath);
  f.extension.packageJSON = JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf8'));
  f.setHash(require('node:crypto').createHash('sha256').update(source).digest('hex'));
  // Preserve the installed call chain and stack frame while allowing minified names to vary.
  // 2.1.332 reads folders through a file/remote-scheme filter helper instead of workspaceFolders directly.
  const setup = source.match(/setupPanel\(e,t,n,r,o,s=!1\)\{this\.panelFullEditor\.set\(e,!!r\);let (?:[\w$]+=[^,;]*,)?([\w$]+)=(?:([\w$]+)\.workspace\.workspaceFolders\?\.map\(\(\w+\)=>\w+\.uri\.fsPath\)\|\|\[\]|([\w$]+)\(\)\.map\(\((\w+)\)=>\4\.uri\.fsPath\)),([\w$]+)=([\w$]+)\(\1\)/);
  assert.ok(setup, 'Installed panel directory construction changed');
  const context = {};
  let folders = '';
  if (setup[3]) {
    const list = source.slice(source.indexOf(`function ${setup[3]}(){`)).match(/^function [\w$]+\(\)\{return\(([\w$]+)\.workspace\.workspaceFolders\?\?\[\]\)\.filter\(([\w$]+)\)\}/);
    assert.ok(list, 'Installed workspace folder helper changed');
    const filter = source.slice(source.indexOf(`function ${list[2]}(e){`)).match(/^function [\w$]+\(e\)\{return e\.uri\.scheme==="file"\|\|e\.uri\.scheme==="vscode-remote"&&([\w$]+)\.env\.remoteName!==void 0\}/);
    assert.ok(filter && filter[1] === list[1], 'Installed workspace folder filter changed');
    folders = `${list[0]};${filter[0]};`;
    context[list[1]] = f.vscode;
  } else context[setup[2]] = f.vscode;
  const directory = source.slice(source.indexOf(`function ${setup[6]}(e){`)).match(/^function [\w$]+\(e\)\{return ([\w$]+)\(e\[0\]\|\|([\w$]+)\.homedir\(\)\)\}/);
  assert.ok(directory, 'Installed workspace directory helper changed');
  const canonical = source.slice(source.indexOf(`function ${directory[1]}(e){`)).match(/^function [\w$]+\(e\)\{let t=e;try\{t=([\w$]+)\.realpathSync\(e\)\}catch\{\}return process\.platform==="darwin"\?t\.normalize\("NFC"\):t\}/);
  assert.ok(canonical, 'Installed realpath helper changed');
  const panel = vm.runInNewContext(`${canonical[0]};${directory[0]};${folders}({${setup[0]};return ${setup[5]};}})`, {
    ...context, [canonical[1]]: f.fakeFs, process, [directory[2]]: require('node:os')
  }, { filename });
  f.vscode.commands.executeCommand = async () => {
    assert.equal(panel.setupPanel.call({ panelFullEditor: new Map() }, {}), f.target);
    assert.equal(f.fakeFs.realpathSync, f.original);
  };
  await f.open(f.vscode, f.extension, f.target, id);
  await f.open(f.vscode, f.extension, f.target);
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

test('Provider cross-project resume keeps the original ID and directory in a native tab', async () => {
  const filename = path.resolve(__dirname, '../src/providers.js'), calls = [];
  const module = { exports: {} }, localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => name === './claude-tabs' ? { openClaudeProjectTab: (...args) => calls.push(args) } : localRequire(name) }, { filename });
  const f = fixture(); f.vscode.extensions = { getExtension: () => f.extension };
  f.vscode.commands.executeCommand = () => assert.fail('No direct native or reload command');
  assert.equal(await module.exports.openNativeSession(f.vscode, { provider: 'claude', cwd: f.target, id }, true), true);
  assert.equal(calls[0][2], f.target);
  assert.equal(calls[0][3], id);
  assert.equal(calls.length, 1);
});
