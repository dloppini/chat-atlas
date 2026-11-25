'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../src/core');
const projects = require('../media/projects');

test('Batch status persists only known selected cards and maintains completion timestamps', async t => {
  const sessions = ['one', 'two', 'other'].map(id => ({ key: `codex:${id}`, provider: 'codex', project: 'Fixture', cwd: '/fixture', title: id, preview: '', createdAt: 1, updatedAt: 2 }));
  const h = await extensionHarness(t, {}, sessions);
  await h.send({ type: 'batchStatus', keys: ['codex:one', 'codex:two', 'missing', 'codex:one'], status: 'Done' });
  const cards = h.latest().sessions;
  assert.equal(cards.find(s => s.key === 'codex:one').status, 'Done');
  assert.equal(cards.find(s => s.key === 'codex:two').status, 'Done');
  assert.equal(cards.find(s => s.key === 'codex:other').status, 'Inbox');
  assert.ok(cards.find(s => s.key === 'codex:one').completedAt > 0);
  await h.send({ type: 'batchStatus', keys: ['codex:one'], status: 'In progress' });
  assert.equal(h.latest().sessions.find(s => s.key === 'codex:one').completedAt, null);
  await h.send({ type: 'batchStatus', keys: ['codex:two'], status: 'Invalid' });
  assert.equal(h.latest().sessions.find(s => s.key === 'codex:two').status, 'Done');
});

async function extensionHarness(t, stored = {}, sessions = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-folder-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'Project with spaces');
  await fs.mkdir(path.join(folder, 'Subfolder'), { recursive: true });
  const file = path.join(root, 'file.txt');
  await fs.writeFile(file, 'fixture');
  const messages = [], errors = [], pickerCalls = [], openedFolders = [], chats = [], commands = new Map(), intervals = [], timeouts = [], watchers = [], subscriptions = [];
  const storage = structuredClone(stored);
  let uriHandler, tileAction, selectedFolder, receive, inputValue, activityResult, scanCount = 0, disposePanel, feedbackChoice, browserResult = true;
  const feedbackPickers = [];
  const uri = folderPath => ({ scheme: 'file', fsPath: folderPath, path: folderPath, toString: () => folderPath });
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    version:'1.96.0-test',
    env: { clipboard:{writeText:async value => chats.push(['clipboard', value])}, openExternal: async value => { openedFolders.push(value.fsPath); return browserResult; } },
    Uri: { file: uri, parse: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    ViewColumn: { One: 1 }, StatusBarAlignment: { Left: 1 },
    workspace: { onDidChangeConfiguration: () => ({}), workspaceFolders: [{ uri: uri(root) }], getWorkspaceFolder: () => ({ uri: uri(root) }), getConfiguration: () => ({ get: (key, fallback) => key === 'claudeTileAction' ? tileAction : key === 'codexHome' ? path.join(root, 'codex') : key === 'claudeHome' ? path.join(root, 'claude') : fallback }) },
    commands: { executeCommand: async (...args) => chats.push(args), registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; } },
    window: { registerFileDecorationProvider: () => ({}),
      terminals: [],
      createTerminal(options) {
        const terminal = { ...options, sends: [], shows: 0, sendText(value) { this.sends.push(value); }, show() { this.shows++; } };
        this.terminals.push(terminal);
        return terminal;
      },
      registerUriHandler: handler => { uriHandler = handler; return { dispose() {} }; },
      registerWebviewPanelSerializer: () => ({ dispose() {} }),
      showErrorMessage: text => errors.push(text),
      showInputBox: async options => { pickerCalls.push(options); return inputValue; },
      showQuickPick: async (items,options) => { feedbackPickers.push({items,options}); return items.find(item => item.id === feedbackChoice); },
      showOpenDialog: async options => { pickerCalls.push(options); return selectedFolder; },
      createStatusBarItem: () => ({ show() {}, dispose() {} }),
      createWebviewPanel: () => ({
        visible: true, reveal() {},
        webview: { cspSource: 'fixture', asWebviewUri: value => value, postMessage: m => messages.push(structuredClone(m)), onDidReceiveMessage: callback => { receive = callback; } },
        onDidChangeViewState() {}, onDidDispose: callback => { disposePanel = callback; }, dispose: () => disposePanel?.()
      })
    }
  };
  const module = { exports: {} };
  const source = await fs.readFile(path.join(__dirname, '../src/extension.js'), 'utf8');
  vm.runInNewContext(source, {
    module, process, structuredClone, Buffer,
    setInterval: (callback, ms) => { const timer = { callback, ms }; intervals.push(timer); return timer; }, clearInterval: timer => { if (timer) timer.cleared = true; },
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timeouts.push(timer); return timer; }, clearTimeout: timer => { if (timer) timer.cleared = true; },
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === './engineering') return require('../src/engineering');
      if (name === './core') return { ...core, SessionIndex: class {
        async scan() { scanCount++; return { sessions: structuredClone(sessions), sources: [], errors: [] }; }
        async refreshActivity(current) { return activityResult ? await activityResult(current) : structuredClone(sessions); }
      } };
      if (name === 'node:fs') return { watch: (root, options, callback) => { const watcher = { root, options, callback, on() {}, close() { this.closed = true; } }; watchers.push(watcher); return watcher; } };
      if (name === './providers') return { openNativeSession: async (_, session) => { chats.push(['native', session]); return true; }, openNewProjectChat: (...args) => chats.push(args.slice(1, 3)) };
      if (['./chat-files', './explorer-menu'].includes(name)) return require('../src/' + name.slice(2));
      if (name === './git') return require('../src/git');
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
  return { root, folder, file, messages, errors, pickerCalls, openedFolders, chats, storage, api, intervals, timeouts, watchers, subscriptions,
    vscode, commands, uriHandler, tileAction: value => { tileAction = value; }, send: m => receive(m), pick: value => { selectedFolder = value; }, input: value => { inputValue = value; }, latest: () => messages.findLast(m => m.type === 'data'),
    setSessions: value => { sessions = value; }, setActivity: value => { activityResult = value; }, scanCount: () => scanCount, trust: () => { vscode.workspace.isTrusted = true; },
    feedbackPickers, chooseFeedback: value => { feedbackChoice = value; }, failBrowser: () => { browserResult = false; } };
}

test('Feedback opens editable GitHub drafts, excludes conversation data and preserves cancellation', async t => {
  const h = await extensionHarness(t, {}, [{key:'codex:private',provider:'codex',project:'Private Project',cwd:'/private/client',title:'Confidential chat',preview:'Private conversation',createdAt:1,updatedAt:2}]);
  await h.send({type:'feedback'}); assert.equal(h.openedFolders.length,0);
  assert.equal(h.feedbackPickers[0].items.length,3); assert.match(h.feedbackPickers[0].options.placeHolder,/Public GitHub/);
  for (const kind of ['bug','feature']) {
    h.chooseFeedback(kind);
    await h.send({type:'feedback',url:'https://evil.invalid',body:'Private conversation'});
    const url = new URL(h.openedFolders.at(-1));
    assert.equal(url.origin,'https://github.com'); assert.equal(url.pathname,'/dloppini/chat-atlas/issues/new');
    assert.equal(url.searchParams.get('title'),kind === 'bug' ? '[Bug] ' : '[Feature] ');
    const body = url.searchParams.get('body');
    assert.ok(body.includes('Chat Atlas: '+require('../package.json').version)); assert.match(body,/VS Code: 1\.96\.0-test/);
    assert.ok(body.includes(kind === 'bug' ? 'Steps to reproduce' : 'Why would this help?'));
    assert.doesNotMatch(body,/Confidential chat|Private conversation|private\/client|Private Project/);
  }
  h.chooseFeedback('browse'); await h.send({type:'feedback'});
  assert.equal(h.openedFolders.at(-1),'https://github.com/dloppini/chat-atlas/issues');
  h.failBrowser(); await h.send({type:'feedback'});
  assert.match(h.messages.at(-1).text,/Could not open GitHub/); assert.match(h.errors.at(-1),/Could not open GitHub/);
});

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
  assert.deepEqual(h.chats[0], ['codex', h.folder]);
  await h.send({ type: 'newChat', projectKey: key, provider: 'claude' });
  assert.deepEqual(h.chats[1], ['claude', h.folder]);
  assert.equal(h.vscode.window.terminals.length, 0);
  h.tileAction('terminal');
  await h.send({ type: 'newChat', projectKey: key, provider: 'claude' });
  const terminal = h.vscode.window.terminals.at(-1);
  assert.equal(h.chats.length, 2, 'the terminal preference bypasses the Claude chat UI');
  assert.deepEqual([terminal.cwd, terminal.sends, terminal.shows], [h.folder, ['claude'], 1]);
  assert.equal(terminal.env.CLAUDE_CONFIG_DIR, path.join(h.root, 'claude'));
  await h.send({ type: 'newChat', projectKey: key, provider: 'codex' });
  assert.deepEqual(h.chats[2], ['codex', h.folder], 'Codex keeps its own chat UI');
  h.tileAction(undefined);
  const future ={ ...session, key: 'codex:future', cwd: h.folder, project: 'Automatic name' };
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

test('Explorer opens the selected project or known subfolder and rejects unavailable targets', async t => {
  const h = await extensionHarness(t);
  await h.send({ type: 'createProject', name: 'Explorer project', folder: h.folder });
  const projectKey = projects.originalProjectKey({ cwd: h.folder });
  await h.send({ type: 'openProjectFolder', projectKey });
  await h.send({ type: 'openProjectFolder', projectKey, subfolder: 'Subfolder' });
  assert.deepEqual(h.openedFolders, [h.folder, path.join(h.folder, 'Subfolder')]);
  for (const subfolder of ['../', 'missing', h.root]) {
    await h.send({ type: 'openProjectFolder', projectKey, subfolder });
    assert.match(h.messages.at(-1).text, /subfolder is unavailable/);
  }
  await fs.rmdir(path.join(h.folder, 'Subfolder'));
  await h.send({ type: 'openProjectFolder', projectKey, subfolder: 'Subfolder' });
  assert.match(h.messages.at(-1).text, /cannot be found/);
  assert.equal(h.openedFolders.length, 2);
  await h.send({ type: 'openProjectFolder', projectKey: 'custom:missing' });
  assert.match(h.messages.at(-1).text, /Link this project/);
});


test('Project renames persist without changing keys, folders, placements or sidebar preferences', async t => {
  const session = { key: 'codex:rename', project: 'Original', cwd: '/original', provider: 'codex', title: 'Chat', preview: '', createdAt: 1, updatedAt: 2 };
  const h = await extensionHarness(t, { sidebarPreferences: { projectSort: 'manual', projectOrder: ['path:/original'], hiddenProjects: [] } }, [session]);
  h.input('  New name  ');
  await h.send({ type: 'renameProject', projectKey: 'path:/original' });
  assert.equal(h.latest().sessions[0].project, 'New name');
  assert.equal(h.latest().sessions[0].cwd, '/original');
  assert.equal(h.latest().projectCatalog[0].key, 'path:/original');
  assert.equal(h.pickerCalls.at(-1).value, 'Original');
  assert.match(h.pickerCalls.at(-1).validateInput(' '), /1 to 80/);
  assert.match(h.pickerCalls.at(-1).validateInput('x'.repeat(81)), /1 to 80/);
  assert.equal(h.pickerCalls.at(-1).validateInput('Good'), null);
  const restarted = await extensionHarness(t, h.storage, [session]);
  assert.equal(restarted.latest().sessions[0].project, 'New name');
  assert.deepEqual(restarted.storage.sidebarPreferences, h.storage.sidebarPreferences);
  restarted.input(undefined);
  await restarted.send({ type: 'renameProject', projectKey: 'path:/original' });
  assert.equal(restarted.latest().sessions[0].project, 'New name');
  restarted.input(' ');
  await restarted.send({ type: 'renameProject', projectKey: 'path:/original' });
  assert.match(restarted.messages.at(-1).text, /1 to 80/);
  await restarted.send({ type: 'renameProject', projectKey: 'custom:missing' });
  assert.match(restarted.messages.at(-1).text, /unavailable/);
});

test('Renamed board projects retain their names when linked to a folder', async t => {
  const h = await extensionHarness(t, { boardState: { customProjects: [{ id: 'label', name: 'Label' }], cards: {} } });
  h.input('Renamed label');
  await h.send({ type: 'renameProject', projectKey: 'custom:label' });
  await h.send({ type: 'linkProjectFolder', projectKey: 'custom:label', folder: h.folder });
  assert.equal(h.latest().projectCatalog[0].name, 'Renamed label');
  h.input('Folder alias');
  await h.send({ type: 'renameProject', projectKey: projects.originalProjectKey({ cwd: h.folder }) });
  assert.equal(h.latest().projectCatalog[0].name, 'Folder alias');
});

test('Git dashboard rejects unknown project keys and correlates error replies', async t => {
  const h = await extensionHarness(t);
  await h.send({ type: 'gitDashboard', projectKey: 'unknown', requestId: 42 });
  const reply = h.messages.at(-1);
  assert.equal(reply.type, 'gitDashboard');
  assert.equal(reply.projectKey, 'unknown');
  assert.equal(reply.requestId, 42);
  assert.match(reply.error, /Link this project/);
  assert.equal(h.errors.length, 0);
});

test('Git operations reject unknown projects and require workspace trust with correlated replies', async t => {
  const h=await extensionHarness(t);
  await h.send({type:'gitOperation',projectKey:'missing',requestId:91,action:'push'});
  assert.match(h.messages.at(-1).error,/Link this project/);
  await h.send({type:'createProject',name:'Git project',folder:h.folder});
  const projectKey=h.messages.at(-1).key;
  await h.send({type:'gitOperation',projectKey,requestId:92,action:'fetch'});
  const reply=h.messages.at(-1);
  assert.equal(reply.type,'gitOperation');assert.equal(reply.requestId,92);assert.equal(reply.projectKey,projectKey);
  assert.match(reply.error,/Trust this workspace/);
});

test('Git host forwards staged commits and opens only a host-derived Azure PR form', async t => {
  const h=await extensionHarness(t);h.trust();
  const git=(...args)=>require('node:child_process').execFileSync('git',args,{cwd:h.folder,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','feature');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  await h.send({type:'createProject',name:'Git project',folder:h.folder});const projectKey=h.messages.at(-1).key;
  await fs.writeFile(path.join(h.folder,'file.txt'),'change');
  const operation=async(action,options={})=>{
    const repo=await require('../src/git').readGitDashboard(h.folder);
    await h.send({type:'gitOperation',projectKey,requestId:100,action,head:repo.head,branch:repo.branch,indexVersion:repo.indexVersion,...options});
    return h.messages.at(-1);
  };
  assert.match((await operation('stage',{files:['file.txt']})).message,/staged/);
  assert.match((await operation('commit',{message:'Commit from webview'})).message,/Commit complete/);
  assert.equal(git('log','-1','--format=%s'),'Commit from webview');
  git('remote','add','origin','https://dev.azure.com/example/project/_git/repo');git('update-ref','refs/remotes/origin/feature',git('rev-parse','HEAD'));
  const reply=await operation('createPr',{remote:'origin',url:'https://evil.invalid'});
  assert.equal(reply.requestId,100);assert.match(reply.message,/Azure PR form opened/);
  assert.equal(h.openedFolders.at(-1),'https://dev.azure.com/example/project/_git/repo/pullrequestcreate?sourceRef=feature');
});

test('Claude tile preference focuses a single terminal while Details keeps explicit routes', async t => {
  const id = '12345678-1234-4234-8234-123456789abc';
  const h = await extensionHarness(t);
  const session = { key: 'claude:' + id, id, provider: 'claude', cwd: h.folder, project: 'Project', title: 'Conversation', updatedAt: 1 };
  h.setSessions([session]); await h.api.refresh();
  const open = { type: 'open', key: session.key };
  await h.send(open);
  assert.equal(h.chats[0][0], 'native');
  await h.send({ ...open, terminal: true });
  const [terminal] = h.vscode.window.terminals;
  assert.equal(terminal.shows, 0);
  h.tileAction('terminal');
  await h.send(open); await h.send(open);
  assert.equal(h.vscode.window.terminals.length, 1);
  assert.deepEqual(terminal.sends, ['claude --resume ' + id]);
  assert.equal(terminal.shows, 2);
  await h.send({ ...open, native: true });
  assert.equal(h.chats.length, 2);
});

test('Reconnecting a folder preserves history identity, board metadata and launch cwd across scans', async t => {
  const id = '12345678-1234-4234-8234-123456789abc', key = 'claude:' + id;
  const session = { key, id, provider: 'claude', cwd: '/old', project: 'Old', title: 'Conversation', updatedAt: 1 };
  const h = await extensionHarness(t, { boardState: { cards: { [key]: { note: 'Keep me' } }, projectNames: { 'path:/old': 'Custom' } } }, [session]);
  await h.send({ type: 'linkProjectFolder', projectKey: 'path:/old', folder: h.folder });
  const restarted = await extensionHarness(t, h.storage, [session]);
  assert.equal(restarted.latest().projectCatalog.length, 1);
  const [card] = restarted.latest().sessions;
  assert.equal(card.project, 'Custom'); assert.equal(card.note, 'Keep me');
  assert.equal(card.cwd, h.folder); assert.equal(card.id, id);
  restarted.tileAction('terminal');
  await restarted.send({ type: 'open', key });
  assert.equal(restarted.vscode.window.terminals[0].cwd, h.folder);
  await restarted.send({ type: 'update', key, patch: { subfolder: 'Subfolder' } });
  await restarted.send({ type: 'browseSessionFiles', key, folder: '/ignored' });
  assert.equal(restarted.chats.at(-1)[0], 'revealInExplorer');
  assert.equal(restarted.chats.at(-1)[1].fsPath, path.join(h.folder, 'Subfolder'));
});

test('Explorer URI opens a prefilled draft only once the board is ready', async t => {
  const h = await extensionHarness(t);
  const folder = path.join(h.root, 'Project #1 & 100%');
  const query = Buffer.from(folder).toString('base64url');
  await h.uriHandler.handleUri({ path: '/new-project', query });
  assert.equal(h.messages.some(m => m.type === 'draftProject'), false);
  await h.send({ type: 'ready' });
  assert.deepEqual(h.messages.find(m => m.type === 'draftProject'), { type: 'draftProject', folder, name: 'Project #1 & 100%' });
  await h.uriHandler.handleUri({ path: '/new-project', query: '!!' });
  assert.equal(h.messages.filter(m => m.type === 'draftProject').length, 1);
  assert.equal(h.storage.boardState.customProjects.length, 0);
});
test('External chat files use a native Explorer tree and open files in the current window', async t => {
  const h = await extensionHarness(t);
  const vscode = h.vscode;
  vscode.workspace.getWorkspaceFolder = () => undefined;
  let provider;
  vscode.window.createTreeView = (id, options) => { assert.equal(id, 'chatAtlas.files'); provider = options.treeDataProvider; return {}; };
  vscode.workspace.fs = { readDirectory: async uri => (await fs.readdir(uri.fsPath, { withFileTypes: true })).map(e => [e.name, e.isDirectory() ? 2 : 1]) };
  vscode.FileType = { Directory: 2 };
  vscode.TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  vscode.TreeItem = class { constructor(uri, state) { this.resourceUri = uri; this.collapsibleState = state; } };
  await fs.writeFile(path.join(h.folder, 'notes.txt'), 'fixture');
  h.setSessions([{ key: 'claude:files', title: 'Browse files', preview: '', cwd: h.folder, project: 'Project', provider: 'claude', updatedAt: 1 }]); await h.api.refresh();
  await h.send({ type: 'browseSessionFiles', key: 'claude:files' });
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.chats.at(-1), ['chatAtlas.files.focus']);
  const [root] = await provider.getChildren(); assert.equal(root.uri.fsPath, h.folder);
  const [directory, file] = await provider.getChildren(root);
  assert.equal(directory.folder, true);
  assert.equal(provider.getTreeItem(file).command.command, 'vscode.open');
  assert.equal(file.uri.fsPath, path.join(h.folder, 'notes.txt'));
  assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath, h.root);
});

test('board Settings opens the graphical editor filtered to this extension', async t => {
  const h = await extensionHarness(t);
  await h.send({ type: 'settings' });
  const [command, options] = h.chats.at(-1);
  assert.equal(command, 'workbench.action.openSettings2');
  assert.equal(options.query, '@ext:lpx.lpx-conversation-board');
});

test('Handoff copies the reviewed source link before opening the selected provider in the chat folder', async t => {
  const key = 'codex:11111111-1111-4111-8111-111111111111';
  const sessions = [{key, id:key.slice(6), provider:'codex', cwd:process.cwd(), project:'Atlas', title:'Source', preview:''}];
  const h = await extensionHarness(t, {}, sessions);
  await h.send({type:'handoff',key,requestId:7,provider:'claude',text:'Next step: verify focus'});
  assert.deepEqual(h.chats[0], ['clipboard','Atlas handoff from ' + key + '\n\nNext step: verify focus']);
  assert.equal(h.chats[1][0], 'claude');
  assert.equal(h.chats[1][1], process.cwd());
  assert.equal(h.messages.at(-1).type, 'handoffStarted');
  await h.send({type:'handoff',key,requestId:8,provider:'other',text:'Invalid'});
  assert.equal(h.chats.length,2);
  assert.ok(h.messages.some(m => m.type === 'handoffError' && m.requestId === 8));
});

test('Explorer resumes the matching historical chat and passage search selects the exact exchange', async t => {
  const h = await extensionHarness(t);
  const id='11111111-1111-4111-8111-111111111111', file=path.join(h.root,id+'.jsonl');
  const messages=['Before the fix','Restore focus to the project picker.','Test on a narrow screen.'];
  await fs.writeFile(file,[
    {type:'session_meta',payload:{id,cwd:h.folder}},
    ...messages.map((text,i)=>({type:'response_item',payload:{type:'message',role:i===1?'assistant':'user',content:text}})),
    {type:'event_msg',payload:{type:'patch_apply_end',changes:{'board.js':{}}}}
  ].map(r=>JSON.stringify(r)).join('\n'));
  const s=await new core.SessionIndex().readSession('codex',file,await fs.stat(file));
  h.setSessions([s]);
  const picks=[];
  h.vscode.ProgressLocation={Notification:15};
  h.vscode.window.withProgress=(_,run)=>run({},{isCancellationRequested:false});
  h.vscode.window.showQuickPick=items=>{picks.push(items);return items[0];};
  await h.commands.get('chatAtlas.findChatsForFile')(h.vscode.Uri.file(path.join(h.folder,'board.js')));
  assert.match(picks[0][0].description,/Edited/);
  assert.equal(h.chats.at(-1)[1].key,s.key);
  let shown;
  h.vscode.Range=class { constructor(start,end){this.start=start;this.end=end;} };
  h.vscode.workspace.openTextDocument=({content})=>({content,positionAt:offset=>offset});
  h.vscode.window.showTextDocument=(doc,opts)=>{shown={doc,range:opts.selection};};
  await h.send({type:'passages',key:s.key,query:'focus'});
  assert.equal(shown.doc.content.slice(shown.range.start,shown.range.end),'focus');
  for(const text of messages) assert.ok(shown.doc.content.includes(text));
});
