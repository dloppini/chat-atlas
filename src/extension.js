'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { SessionIndex, reconcile, publicSessions, UUID } = require('./core');
const { openNativeSession } = require('./providers');

function activate(context) {
  let panel, timer, current = { sessions: [], sources: [], errors: [] }, busy = false, disposed = false;
  let state = context.globalState.get('boardState', { topics: null, cards: {} });
  const index = new SessionIndex();
  let writeQueue = Promise.resolve();
  const save = () => { const snapshot = structuredClone(state); writeQueue = writeQueue.then(() => context.globalState.update('boardState', snapshot)); return writeQueue; };
  const post = data => panel?.webview.postMessage(data);
  function settings() {
    const c = vscode.workspace.getConfiguration('chatAtlas');
    return { codexHome: c.get('codexHome') || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), claudeHome: c.get('claudeHome') || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), maxSessions: c.get('maxSessions', 1000) };
  }
  const publish = () => post({ type: 'data', ...current, sessions: publicSessions(current.sessions, state), topics: state.topics || [], busy });
  async function refresh() {
    if (busy || disposed) return;
    busy = true; publish();
    try { current = await index.scan(settings()); reconcile(current.sessions, state); await save(); }
    catch (e) { current.errors = [`Refresh failed: ${e.message}`]; }
    finally { busy = false; if (!disposed) publish(); }
  }
  async function openSession(s, editor = false, terminalOnly = false) {
    if (!UUID.test(s.id)) throw new Error('Invalid session identifier.');
    if (!terminalOnly && await openNativeSession(vscode, s, editor)) return;
    const command = s.provider === 'claude' ? `claude --resume ${s.id}` : `codex resume ${s.id}`;
    const existing = vscode.window.terminals.find(t => t.name === `Atlas: ${s.id.slice(0, 8)}`);
    if (existing) { existing.show(); return; }
    // Only a validated UUID enters the shell. Conversation text never becomes a command.
    let cwd;
    try { if (s.cwd && (await fs.stat(s.cwd)).isDirectory()) cwd = s.cwd; } catch { /* Original project may have moved. */ }
    const terminal = vscode.window.createTerminal({ name: `Atlas: ${s.id.slice(0, 8)}`, cwd });
    terminal.show(); terminal.sendText(command, true);
    post({ type: 'notice', text: `Opened ${s.provider === 'claude' ? 'Claude Code' : 'Codex'} in the terminal. The corresponding CLI must be installed and signed in.` });
  }
  async function onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    try {
      if (m.type === 'ready') { publish(); await refresh(); return; }
      if (m.type === 'refresh') { await refresh(); return; }
      if (m.type === 'settings') { await vscode.commands.executeCommand('workbench.action.openSettings', 'chatAtlas'); return; }
      if (m.type === 'addTopic') {
        const name = typeof m.name === 'string' ? m.name.trim().slice(0, 50) : '';
        if (!name || state.topics.some(t => t.name.toLowerCase() === name.toLowerCase())) return;
        state.topics.push({ id: crypto.randomUUID(), name, color: '#a69cf6', keywords: typeof m.keywords === 'string' ? m.keywords.slice(0, 300) : name });
        await save(); publish(); return;
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
        if (typeof p.done === 'boolean') { card.status = p.done ? 'Done' : 'Inbox'; card.completedAt = p.done ? Date.now() : null; }
        if (['Inbox', 'In progress', 'Waiting', 'Done'].includes(p.status)) { card.status = p.status; card.completedAt = p.status === 'Done' ? Date.now() : null; }
        if (typeof p.pinned === 'boolean') card.pinned = p.pinned;
        if (typeof p.note === 'string') card.note = p.note.slice(0, 5000);
        if (typeof p.title === 'string') card.title = p.title.trim().slice(0, 150);
        if (typeof p.topic === 'string' && state.topics.some(t => t.id === p.topic)) { card.topic = p.topic; card.manualTopic = true; }
        await save(); publish();
      }
    } catch (e) { post({ type: 'notice', text: e.message }); vscode.window.showErrorMessage(`Chat Atlas: ${e.message}`); }
  }
  async function open() {
    if (panel) { panel.reveal(); return; }
    panel = vscode.window.createWebviewPanel('chatAtlas.board', 'Chat Atlas', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    const webview = panel.webview;
    let html = await fs.readFile(path.join(context.extensionPath, 'media', 'board.html'), 'utf8');
    const nonce = crypto.randomBytes(24).toString('hex');
    html = html.replaceAll('{{cspSource}}', webview.cspSource).replaceAll('{{nonce}}', nonce)
      .replace('{{styleUri}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'board.css')).toString())
      .replace('{{scriptUri}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'board.js')).toString())
      .replace('{{projectsUri}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'projects.js')).toString())
      .replaceAll('{{iconUri}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png')).toString());
    webview.onDidReceiveMessage(onMessage, null, context.subscriptions);
    webview.html = html;
    timer = setInterval(() => { if (panel?.visible) void refresh(); }, Math.max(10, vscode.workspace.getConfiguration('chatAtlas').get('refreshSeconds', 20)) * 1000);
    panel.onDidDispose(() => { clearInterval(timer); panel = undefined; });
  }
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
  status.text = '$(layout) Chat Atlas'; status.command = 'chatAtlas.open'; status.tooltip = 'Open your conversation board'; status.show();
  context.subscriptions.push(status, vscode.commands.registerCommand('chatAtlas.open', open), vscode.commands.registerCommand('chatAtlas.refresh', refresh), { dispose() { disposed = true; clearInterval(timer); panel?.dispose(); } });
  return { refresh, getSnapshot: () => ({ ...current, sessions: publicSessions(current.sessions, state), topics: state.topics }) };
}
module.exports = { activate };
