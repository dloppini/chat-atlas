'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { SessionIndex, reconcile, publicSessions, UUID } = require('./core');
const { openNativeSession, openNewProjectChat } = require('./providers');
const { projectGroupKey, originalProjectKey, projectCatalog, linkProjectFolder, remapProjectKeys } = require('../media/projects');

function activate(context) {
  let panel, timer, activityTimer, activityWakeTimer, current = { sessions: [], sources: [], errors: [] }, subfolders = {}, busy = false, activityBusy = false, disposed = false;
  let historyWatchers = [], watchedRoots = '', publishedRunning = new Map(), discoveryPending = false;
  let state = context.globalState.get('boardState', { topics: null, cards: {} });
  let sidebarPreferences = context.globalState.get('sidebarPreferences', { projectSort: 'alphabetical', projectOrder: [], hiddenProjects: [], showSubfolders: false });
  const index = new SessionIndex();
  let writeQueue = Promise.resolve();
  const save = () => { const snapshot = structuredClone(state); writeQueue = writeQueue.then(() => context.globalState.update('boardState', snapshot)); return writeQueue; };
  const post = data => panel?.webview.postMessage(data);
  function settings() {
    const c = vscode.workspace.getConfiguration('chatAtlas');
    return { codexHome: c.get('codexHome') || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), claudeHome: c.get('claudeHome') || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), maxSessions: c.get('maxSessions', 1000) };
  }
  const visibleSessions = () => {
    const minutes = vscode.workspace.getConfiguration('chatAtlas').get('runningTimeoutMinutes', 60);
    const timeout = Number.isFinite(minutes) ? Math.max(5, Math.min(1440, minutes)) * 60000 : 60 * 60000;
    return publicSessions(current.sessions, state, Date.now(), timeout);
  };
  const publish = () => {
    const sessions = visibleSessions();
    publishedRunning = new Map(sessions.map(s => [s.key, s.running]));
    post({ type: 'data', ...current, sessions, topics: state.topics || [], projectCatalog: projectCatalog(current.sessions, state.customProjects || []), sidebarPreferences, subfolders, busy });
  };
  async function refreshActivity() {
    if (disposed || busy || activityBusy || !panel?.visible) return;
    activityBusy = true;
    const snapshot = current;
    try {
      const sessions = await index.refreshActivity(snapshot.sessions);
      // A full scan may have finished while the lightweight activity check was reading.
      if (disposed || current !== snapshot || busy) return;
      current = { ...current, sessions };
      const changes = visibleSessions().filter(s => publishedRunning.get(s.key) !== s.running).map(s => ({ key: s.key, running: s.running }));
      if (changes.length) {
        for (const s of changes) publishedRunning.set(s.key, s.running);
        post({ type: 'activity', sessions: changes });
      }
    } finally { activityBusy = false; }
  }
  function closeHistoryWatchers() {
    for (const watcher of historyWatchers) watcher.close();
    historyWatchers = []; watchedRoots = '';
    clearTimeout(activityWakeTimer); activityWakeTimer = undefined;
    discoveryPending = false;
  }
  function watchHistory() {
    const config = settings();
    const roots = [path.join(config.codexHome, 'sessions'), path.join(config.claudeHome, 'projects')];
    const signature = JSON.stringify(roots);
    if (watchedRoots === signature) return;
    closeHistoryWatchers(); watchedRoots = signature;
    for (const root of roots) {
      try {
        const watcher = watch(root, { recursive: true }, (_event, filename) => {
          if (!panel?.visible || (filename && !filename.toString().endsWith('.jsonl'))) return;
          const file = filename ? path.join(root, filename.toString()) : '';
          const known = file && current.sessions.some(s => s.file === file);
          discoveryPending ||= !known;
          if (activityWakeTimer) return;
          activityWakeTimer = setTimeout(() => {
            activityWakeTimer = undefined;
            const discover = discoveryPending; discoveryPending = false;
            if (panel?.visible) void (discover ? refresh() : refreshActivity());
          }, 300);
        });
        watcher.on('error', () => { watcher.close(); watchedRoots = ''; });
        historyWatchers.push(watcher);
      } catch { watchedRoots = ''; /* Missing folders and unsupported watchers use the polling fallback. */ }
    }
  }
  async function validateProjectFolder(value, required = false) {
    const folder = typeof value === 'string' ? value.trim() : '';
    if (!folder) {
      if (required) throw new Error('Choose an existing folder to link.');
      return '';
    }
    if (folder.length > 4096 || !path.isAbsolute(folder)) throw new Error('Enter an absolute folder path.');
    const cwd = path.resolve(folder);
    let stat;
    try { stat = await fs.stat(cwd); } catch { throw new Error('That project folder cannot be found.'); }
    if (!stat.isDirectory()) throw new Error('The project path must be a folder.');
    return cwd;
  }
  async function scanSubfolders(sessions) {
    const roots = new Map(sessions.filter(s => s.cwd).map(s => [projectGroupKey(s), s.cwd]));
    for (const item of state.customProjects || []) if (item.cwd) roots.set(originalProjectKey(item), item.cwd);
    const found = {};
    await Promise.all([...roots].map(async ([key, cwd]) => {
      try {
        const entries = await fs.readdir(cwd, { withFileTypes: true });
        found[key] = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort((a, b) => a.localeCompare(b));
      } catch { found[key] = []; }
    }));
    return found;
  }
  async function refresh() {
    if (busy || disposed) return;
    busy = true; publish();
    try { current = await index.scan(settings()); subfolders = await scanSubfolders(current.sessions); reconcile(current.sessions, state); await save(); }
    catch (e) { current.errors = [`Refresh failed: ${e.message}`]; }
    finally { busy = false; if (!disposed) { publish(); if (panel) watchHistory(); } }
  }
  async function openSession(s, editor = false, terminalOnly = false) {
    if (!UUID.test(s.id)) throw new Error('Invalid session identifier.');
    if (!terminalOnly) {
      if (await openNativeSession(vscode, s, editor)) return;
      throw new Error(`The ${s.provider === 'claude' ? 'Claude Code' : 'Codex'} chat UI is unavailable. Choose "Start in hidden terminal" if you want the CLI.`);
    }
    const command = s.provider === 'claude' ? `claude --resume ${s.id}` : `codex resume ${s.id}`;
    const existing = vscode.window.terminals.find(t => t.name === `Atlas: ${s.id.slice(0, 8)}`);
    if (existing) {
      post({ type: 'notice', text: 'This session is already running in a hidden terminal. Open the Terminal panel to interact with it.' });
      return;
    }
    // Only a validated UUID enters the shell. Conversation text never becomes a command.
    let cwd;
    try { if (s.cwd && (await fs.stat(s.cwd)).isDirectory()) cwd = s.cwd; } catch { /* Original project may have moved. */ }
    const terminal = vscode.window.createTerminal({ name: `Atlas: ${s.id.slice(0, 8)}`, cwd });
    terminal.sendText(command, true);
    post({ type: 'notice', text: `Started ${s.provider === 'claude' ? 'Claude Code' : 'Codex'} in a hidden terminal. Open the Terminal panel to interact with it.` });
  }
  async function onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    try {
      if (m.type === 'ready') { publish(); await refresh(); return; }
      if (m.type === 'refresh') { await refresh(); return; }
      if (m.type === 'settings') { await vscode.commands.executeCommand('workbench.action.openSettings', 'chatAtlas'); return; }
      if (m.type === 'sidebarPreferences') {
        const p = m.preferences || {};
        const keys = value => Array.isArray(value) ? [...new Set(value.filter(key => typeof key === 'string' && key.length <= 4096).slice(0, 20000))] : [];
        const sidebarWidth = typeof p.sidebarWidth === 'number' && Number.isFinite(p.sidebarWidth) ? Math.round(Math.max(180, Math.min(520, p.sidebarWidth))) : null;
        sidebarPreferences = { projectSort: p.projectSort === 'manual' ? 'manual' : 'alphabetical', projectOrder: keys(p.projectOrder), hiddenProjects: keys(p.hiddenProjects), sidebarWidth, showSubfolders: p.showSubfolders === true };
        const snapshot = structuredClone(sidebarPreferences);
        writeQueue = writeQueue.then(() => context.globalState.update('sidebarPreferences', snapshot));
        await writeQueue; return;
      }
      if (m.type === 'addTopic') {
        const name = typeof m.name === 'string' ? m.name.trim().slice(0, 50) : '';
        if (!name || state.topics.some(t => t.name.toLowerCase() === name.toLowerCase())) return;
        state.topics.push({ id: crypto.randomUUID(), name, color: '#a69cf6', keywords: typeof m.keywords === 'string' ? m.keywords.slice(0, 300) : name });
        await save(); publish(); return;
      }
      if (m.type === 'pickProjectFolder') {
        const folder = typeof m.folder === 'string' ? m.folder.trim() : '';
        const defaultUri = folder && folder.length <= 4096 && path.isAbsolute(folder) ? vscode.Uri.file(folder) : vscode.workspace.workspaceFolders?.[0]?.uri;
        const selected = await vscode.window.showOpenDialog({ title: 'Select project folder', openLabel: 'Select folder', canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri });
        if (selected?.[0]) {
          if (selected[0].scheme !== 'file') throw new Error('Choose a local project folder.');
          post({ type: 'projectFolderSelected', requestId: m.requestId, folder: selected[0].fsPath });
        }
        return;
      }
      if (m.type === 'linkProjectFolder') {
        const cwd = await validateProjectFolder(m.folder, true);
        const key = linkProjectFolder(state, m.projectKey, cwd);
        sidebarPreferences = { ...sidebarPreferences, projectOrder: remapProjectKeys(sidebarPreferences.projectOrder, m.projectKey, key), hiddenProjects: remapProjectKeys(sidebarPreferences.hiddenProjects, m.projectKey, key) };
        await save();
        const snapshot = structuredClone(sidebarPreferences);
        writeQueue = writeQueue.then(() => context.globalState.update('sidebarPreferences', snapshot));
        await writeQueue;
        subfolders = await scanSubfolders(current.sessions);
        publish(); post({ type: 'projectFolderLinked', previousKey: m.projectKey, key }); return;
      }
      if (m.type === 'newChat') {
        const project = projectCatalog(current.sessions, state.customProjects || []).find(item => item.key === m.projectKey);
        if (!project?.cwd) throw new Error('Link this project to an existing folder before starting a chat.');
        let stat;
        try { stat = await fs.stat(project.cwd); } catch { throw new Error('The project folder is unavailable.'); }
        if (!stat.isDirectory()) throw new Error('The project path must be a folder.');
        await openNewProjectChat(vscode, m.provider, project.cwd, project.name);
        return;
      }
      if (m.type === 'createProject') {
        const s = m.key ? current.sessions.find(s => s.key === m.key) : null;
        if (m.key && !s) return;
        const name = typeof m.name === 'string' ? m.name.trim() : '';
        if (!name || name.length > 80) throw new Error('Choose a project name of 1 to 80 characters.');
        const cwd = await validateProjectFolder(m.folder);
        const existing = projectCatalog(current.sessions, state.customProjects || []);
        const key = cwd ? originalProjectKey({ cwd }) : '';
        if (cwd && existing.some(p => p.key === key)) {
          if (s) { if (key === originalProjectKey(s)) delete state.cards[s.key].projectOverride; else state.cards[s.key].projectOverride = key; delete state.cards[s.key].subfolder; await save(); }
          await publish(); post({ type: 'projectCreated', key }); return;
        }
        if (!cwd && existing.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('A project with that name already exists. Select it instead.');
        if ((state.customProjects || []).length >= 200) throw new Error('The custom project limit has been reached.');
        state.customProjects ||= [];
        const id = crypto.randomUUID();
        state.customProjects.push({ id, name, ...(cwd ? { cwd } : {}) });
        const createdKey = cwd ? key : `custom:${id}`;
        if (s) { state.cards[s.key].projectOverride = createdKey; delete state.cards[s.key].subfolder; }
        if (cwd) subfolders = await scanSubfolders(current.sessions);
        await save(); await publish(); post({ type: 'projectCreated', key: createdKey }); return;
      }
      const s = current.sessions.find(s => s.key === m.key);
      if (!s) return;
      const card = state.cards[s.key];
      if (m.type === 'select') {
        card.seenAt = s.updatedAt; await save();
        post({ type: 'detail', key: s.key, messages: s.messages, sampled: s.sampled }); publish();
      }
      if (m.type === 'open') { await openSession(s, m.editor === true, m.terminal === true); card.seenAt = s.updatedAt; await save(); publish(); }
      if (m.type === 'update') {
        const p = m.patch || {};
        if (p.projectOverride === null) { delete card.projectOverride; delete card.subfolder; }
        else if (typeof p.projectOverride === 'string' && projectCatalog(current.sessions, state.customProjects || []).some(item => item.key === p.projectOverride)) {
          if (p.projectOverride === originalProjectKey(s)) delete card.projectOverride;
          else card.projectOverride = p.projectOverride;
          delete card.subfolder;
        }
        if (p.subfolder === null) delete card.subfolder;
        else if (typeof p.subfolder === 'string' && (p.subfolder === '' || (subfolders[card.projectOverride || originalProjectKey(s)] || []).includes(p.subfolder))) card.subfolder = p.subfolder;
        if (typeof p.done === 'boolean') { card.status = p.done ? 'Done' : 'Inbox'; card.completedAt = p.done ? Date.now() : null; }
        if (['Inbox', 'In progress', 'Waiting', 'Done'].includes(p.status)) { card.status = p.status; card.completedAt = p.status === 'Done' ? Date.now() : null; }
        if (typeof p.pinned === 'boolean') card.pinned = p.pinned;
        if (typeof p.note === 'string') card.note = p.note.slice(0, 5000);
        if (typeof p.title === 'string') card.title = p.title.trim().slice(0, 150);
        if (typeof p.topic === 'string' && state.topics.some(t => t.id === p.topic)) { card.topic = p.topic; card.manualTopic = true; }
        await save(); publish();
      }
    } catch (e) {
      post({ type: ['createProject', 'linkProjectFolder', 'pickProjectFolder'].includes(m.type) ? 'projectError' : 'notice', text: e.message });
      vscode.window.showErrorMessage(`Chat Atlas: ${e.message}`);
    }
  }
  async function open() {
    if (panel) { panel.reveal(); void refresh(); return; }
    panel = vscode.window.createWebviewPanel('chatAtlas.board', 'Chat Atlas', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    const webview = panel.webview;
    let html = await fs.readFile(path.join(context.extensionPath, 'media', 'board.html'), 'utf8');
    const nonce = crypto.randomBytes(24).toString('hex');
    html = html.replaceAll('{{cspSource}}', webview.cspSource).replaceAll('{{nonce}}', nonce)
      .replace('{{version}}', require('../package.json').version)
      .replace('{{styleUri}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'board.css')).toString())
      .replace('{{scriptUri}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'board.js')).toString())
      .replace('{{projectsUri}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'projects.js')).toString())
      .replaceAll('{{iconUri}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png')).toString());
    webview.onDidReceiveMessage(onMessage, null, context.subscriptions);
    webview.html = html;
    timer = setInterval(() => { if (panel?.visible) void refresh(); }, Math.max(10, vscode.workspace.getConfiguration('chatAtlas').get('refreshSeconds', 20)) * 1000);
    activityTimer = setInterval(() => { void refreshActivity(); }, 2000);
    watchHistory();
    panel.onDidChangeViewState(e => { if (e.webviewPanel.visible) void refresh(); });
    panel.onDidDispose(() => { clearInterval(timer); clearInterval(activityTimer); closeHistoryWatchers(); panel = undefined; });
  }
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
  status.text = '$(layout) Chat Atlas'; status.command = 'chatAtlas.open'; status.tooltip = 'Open your conversation board'; status.show();
  context.subscriptions.push(status, vscode.commands.registerCommand('chatAtlas.open', open), vscode.commands.registerCommand('chatAtlas.refresh', refresh), { dispose() { disposed = true; clearInterval(timer); clearInterval(activityTimer); closeHistoryWatchers(); panel?.dispose(); } });
  return { refresh, getSnapshot: () => ({ ...current, sessions: visibleSessions(), topics: state.topics }) };
}
module.exports = { activate };
