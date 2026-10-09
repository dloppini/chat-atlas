'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../src/core');
const projects = require('../media/projects');

async function extensionHarness(t, stored = {}, sessions = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-folder-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'Project with spaces');
  await fs.mkdir(path.join(folder, 'Subfolder'), { recursive: true });
  const file = path.join(root, 'file.txt');
  await fs.writeFile(file, 'fixture');
  const messages = [], errors = [], pickerCalls = [], chats = [], commands = new Map(), intervals = [], timeouts = [], watchers = [], subscriptions = [];
  const storage = structuredClone(stored);
  let receive, selectedFolder, activityResult, scanCount = 0, disposePanel;
  const uri = folderPath => ({ scheme: 'file', fsPath: folderPath, toString: () => folderPath });
  const vscode = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    ViewColumn: { One: 1 }, StatusBarAlignment: { Left: 1 },
    workspace: { workspaceFolders: [{ uri: uri(root) }], getConfiguration: () => ({ get: (key, fallback) => key === 'codexHome' ? path.join(root, 'codex') : key === 'claudeHome' ? path.join(root, 'claude') : fallback }) },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; } },
    window: {
      showErrorMessage: text => errors.push(text),
      showOpenDialog: async options => { pickerCalls.push(options); return selectedFolder; },
      createStatusBarItem: () => ({ show() {}, dispose() {} }),
      createWebviewPanel: () => ({
        visible: true,
        webview: { cspSource: 'fixture', asWebviewUri: value => value, postMessage: m => messages.push(structuredClone(m)), onDidReceiveMessage: callback => { receive = callback; } },
        onDidChangeViewState() {}, onDidDispose: callback => { disposePanel = callback; }, dispose: () => disposePanel?.()
      })
    }
  };
  const module = { exports: {} };
  const source = await fs.readFile(path.join(__dirname, '../src/extension.js'), 'utf8');
  vm.runInNewContext(source, {
    module, process, structuredClone,
    setInterval: (callback, ms) => { const timer = { callback, ms }; intervals.push(timer); return timer; }, clearInterval: timer => { if (timer) timer.cleared = true; },
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timeouts.push(timer); return timer; }, clearTimeout: timer => { if (timer) timer.cleared = true; },
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === './core') return { ...core, SessionIndex: class {
        async scan() { scanCount++; return { sessions: structuredClone(sessions), sources: [], errors: [] }; }
        async refreshActivity(current) { return activityResult ? await activityResult(current) : structuredClone(sessions); }
      } };
      if (name === 'node:fs') return { watch: (root, options, callback) => { const watcher = { root, options, callback, on() {}, close() { this.closed = true; } }; watchers.push(watcher); return watcher; } };
      if (name === './providers') return { openNewProjectChat: (...args) => chats.push(args.slice(1, 4)) };
      if (name === '../media/projects') return projects;
      return require(name);
    }
  }, { filename: 'extension.js' });
  const extensionPath = path.resolve(__dirname, '..');
  const api = module.exports.activate({
    extensionPath, extensionUri: uri(extensionPath), subscriptions,
    globalState: { get: (key, fallback) => storage[key] || fallback, update: async (key, value) => { storage[key] = structuredClone(value); } }
  });
  await commands.get('chatAtlas.open')();
  await api.refresh();
  return { root, folder, file, messages, errors, pickerCalls, chats, storage, api, intervals, timeouts, watchers, subscriptions,
    send: m => receive(m), pick: value => { selectedFolder = value; }, latest: () => messages.findLast(m => m.type === 'data'),
    setSessions: value => { sessions = value; }, setActivity: value => { activityResult = value; }, scanCount: () => scanCount };
}

test('Folder picker selects a local directory, starts at the workspace and preserves cancellation', async t => {
  const h = await extensionHarness(t);
  h.pick([{ scheme: 'file', fsPath: h.folder }]);
  await h.send({ type: 'pickProjectFolder', requestId: 7 });
  assert.equal(h.pickerCalls[0].canSelectFolders, true);
  assert.equal(h.pickerCalls[0].canSelectFiles, false);
  assert.equal(h.pickerCalls[0].canSelectMany, false);
  assert.equal(h.pickerCalls[0].defaultUri.fsPath, h.root);
  assert.deepEqual(h.messages.at(-1), { type: 'projectFolderSelected', requestId: 7, folder: h.folder });
  const count = h.messages.length;
  h.pick(undefined);
  await h.send({ type: 'pickProjectFolder', requestId: 8, folder: h.folder });
  assert.equal(h.messages.length, count);
  assert.equal(h.pickerCalls[1].defaultUri.fsPath, h.folder);
  h.pick([{ scheme: 'vscode-remote', fsPath: '/remote' }]);
  await h.send({ type: 'pickProjectFolder', requestId: 9 });
  assert.equal(h.messages.at(-1).type, 'projectError');
  assert.match(h.messages.at(-1).text, /local project folder/);
});

test('Project creation accepts an optional existing folder and reports invalid paths without saving', async t => {
  const h = await extensionHarness(t);
  for (const [folder, error] of [['relative/path', /absolute/], [path.join(h.root, 'missing'), /cannot be found/], [h.file, /must be a folder/]]) {
    await h.send({ type: 'createProject', name: 'Invalid', folder });
    assert.equal(h.messages.at(-1).type, 'projectError');
    assert.match(h.messages.at(-1).text, error);
    assert.equal(h.storage.boardState.customProjects.length, 0);
  }
  await h.send({ type: 'createProject', name: 'Folder project', folder: h.folder });
  assert.equal(h.messages.at(-1).type, 'projectCreated');
  assert.equal(h.latest().projectCatalog.find(p => p.name === 'Folder project').cwd, h.folder);
  await h.send({ type: 'createProject', name: 'Link later', folder: '' });
  assert.match(h.messages.at(-1).key, /^custom:/);
  assert.equal(h.latest().projectCatalog.find(p => p.name === 'Link later').cwd, '');
});

test('Linking after creation persists chats and sidebar preferences, joins folder chats and enables new chat', async t => {
  const previousKey = 'custom:unlinked';
  const session = { key: 'codex:fixture', project: 'Original', cwd: '/original', provider: 'codex', title: 'Fixture', preview: '', createdAt: 1, updatedAt: 2 };
  const h = await extensionHarness(t, {
    boardState: { customProjects: [{ id: 'unlinked', name: 'My project' }], cards: { [session.key]: { projectOverride: previousKey, note: 'Saved note', status: 'Done', topic: 'general' }, unscanned: { projectOverride: previousKey } } },
    sidebarPreferences: { projectSort: 'manual', projectOrder: ['path:/original', previousKey], hiddenProjects: [previousKey] }
  }, [session]);
  await h.send({ type: 'linkProjectFolder', projectKey: previousKey, folder: h.file });
  assert.equal(h.messages.at(-1).type, 'projectError');
  assert.equal(h.storage.boardState.customProjects[0].cwd, undefined);
  await h.send({ type: 'linkProjectFolder', projectKey: previousKey, folder: h.folder });
  const key = projects.originalProjectKey({ cwd: h.folder });
  assert.deepEqual(h.messages.at(-1), { type: 'projectFolderLinked', previousKey, key });
  assert.equal(h.storage.boardState.cards.unscanned.projectOverride, key);
  assert.deepEqual(h.storage.sidebarPreferences.projectOrder, ['path:/original', key]);
  assert.deepEqual(h.storage.sidebarPreferences.hiddenProjects, [key]);
  assert.equal(h.latest().sessions[0].cwd, '/original');
  assert.equal(h.latest().sessions[0].note, 'Saved note');
  assert.equal(h.latest().sessions[0].status, 'Done');
  assert.equal(h.latest().sessions[0].projectOverride, key);
  assert.deepEqual(h.latest().subfolders[key], ['Subfolder']);
  await h.send({ type: 'newChat', projectKey: key, provider: 'codex' });
  assert.deepEqual(h.chats[0], ['codex', h.folder, 'My project']);
  const future = { ...session, key: 'codex:future', cwd: h.folder, project: 'Automatic name' };
  const restarted = await extensionHarness(t, h.storage, [session, future]);
  assert.equal(restarted.latest().projectCatalog.some(p => p.key === previousKey), false);
  assert.equal(restarted.latest().sessions[1].project, 'My project');
  assert.equal(projects.groupProjects(restarted.latest().sessions, restarted.latest().projectCatalog).get(key).count, 2);
});

test('Two-second activity checks send changes without a full scan and discard readings superseded by a full refresh', async t => {
  const session = { key: 'codex:fixture', id: 'fixture', project: 'Fixture', cwd: '/fixture', provider: 'codex', title: 'Fixture', preview: '', createdAt: 1, updatedAt: 2, activeTurnSignal: false, lastWriteAt: Date.now() };
  const h = await extensionHarness(t, {}, [session]);
  const tick = h.intervals.find(timer => timer.ms === 2000);
  assert.ok(tick);
  const scans = h.scanCount();
  h.setSessions([{ ...session, activeTurnSignal: true }]);
  tick.callback(); await new Promise(setImmediate);
  assert.deepEqual(h.messages.at(-1), { type: 'activity', sessions: [{ key: session.key, running: true }] });
  assert.equal(h.api.getSnapshot().sessions[0].running, true);
  assert.equal(h.scanCount(), scans);
  const count = h.messages.length;
  tick.callback(); await new Promise(setImmediate);
  assert.equal(h.messages.length, count);
  let resolveReading;
  h.setActivity(() => new Promise(resolve => { resolveReading = resolve; }));
  tick.callback();
  h.setSessions([{ ...session, activeTurnSignal: false }]);
  await h.api.refresh();
  resolveReading([{ ...session, activeTurnSignal: true }]);
  await new Promise(setImmediate);
  assert.equal(h.api.getSnapshot().sessions[0].running, false);
  assert.equal(h.messages.at(-1).type, 'data');
});

test('History notifications coalesce writes, discover new chats and release watchers and timers on disposal', async t => {
  const h = await extensionHarness(t);
  const file = path.join(h.root, 'codex', 'sessions', 'known.jsonl');
  const session = { key: 'codex:fixture', id: 'fixture', file, project: 'Fixture', cwd: '/fixture', provider: 'codex', title: 'Fixture', preview: '', createdAt: 1, updatedAt: 2, activeTurnSignal: false, lastWriteAt: Date.now() };
  h.setSessions([session]); await h.api.refresh();
  const watcher = h.watchers.find(watcher => watcher.root === path.dirname(file));
  assert.equal(watcher.options.recursive, true);
  const scans = h.scanCount();
  h.setSessions([{ ...session, activeTurnSignal: true }]);
  watcher.callback('change', 'known.jsonl');
  watcher.callback('change', 'known.jsonl');
  assert.equal(h.timeouts.length, 1);
  h.timeouts.at(-1).callback(); await new Promise(setImmediate);
  assert.equal(h.messages.at(-1).type, 'activity');
  assert.equal(h.scanCount(), scans);
  watcher.callback('change', 'known.jsonl');
  watcher.callback('rename', 'new-chat.jsonl');
  h.timeouts.at(-1).callback(); await new Promise(setImmediate);
  assert.equal(h.scanCount(), scans + 1);
  assert.equal(h.messages.at(-1).type, 'data');
  h.subscriptions.at(-1).dispose();
  assert.equal(h.watchers.every(watcher => watcher.closed), true);
  assert.equal(h.intervals.every(timer => timer.cleared), true);
});
