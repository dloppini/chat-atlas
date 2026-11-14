'use strict';
const { UUID } = require('./core');
const { canonicalProjectPath } = require('../media/projects');
const { codexBinary, createCodexProjectChat } = require('./codex-chat');
const fs = require('node:fs/promises');
const path = require('node:path');

function isProjectWorkspace(vscode, cwd) {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.scheme === 'file' && canonicalProjectPath(folders[0].uri.fsPath) === canonicalProjectPath(cwd);
}

// These provider-owned routes are version-sensitive. Keep all native routing here.
async function openNativeSession(vscode, session, editor = false, options = {}) {
  if (!UUID.test(session.id)) throw new Error('Invalid session identifier.');
  if (session.provider === 'codex' && vscode.extensions.getExtension('openai.chatgpt')) {
    if (editor) {
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.from({ scheme: 'openai-codex', authority: 'route', path: `/local/${session.id}` }), 'chatgpt.conversationEditor', { viewColumn: vscode.ViewColumn.Beside, preview: false });
    } else {
      const opened = await vscode.env.openExternal(vscode.Uri.parse(`${vscode.env.uriScheme}://openai.chatgpt/local/${session.id}`));
      if (!opened) throw new Error('Codex did not accept the session link. Try Open beside board.');
    }
    return true;
  }
  const claude = session.provider === 'claude' && vscode.extensions.getExtension('anthropic.claude-code');
  if (claude) {
    await claude.activate();
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('claude-vscode.editor.open') && commands.includes('claude-vscode.sidebar.open')) {
      if (session.cwd && !isProjectWorkspace(vscode, session.cwd)) {
        await switchClaudeProject(vscode, { cwd: session.cwd, id: session.id, editor }, options);
        return true;
      }
      if (!editor) await vscode.commands.executeCommand('claude-vscode.sidebar.open');
      // Anthropic 2.1.323 takes routing options as the sixth positional argument.
      await vscode.commands.executeCommand('claude-vscode.editor.open', session.id, undefined, undefined, undefined, false, editor ? undefined : { programmatic: 'honor-preferred-location' });
      return true;
    }
  }
  return false;
}
async function newChatCommands(vscode, provider) {
  const extension = vscode.extensions.getExtension(provider === 'codex' ? 'openai.chatgpt' : 'anthropic.claude-code');
  const name = provider === 'codex' ? 'Codex' : 'Claude Code';
  if (!extension) throw new Error(`Install the ${name} VS Code extension to start a chat in its UI.`);
  await extension.activate();
  const required = provider === 'codex' ? ['chatgpt.openSidebar', 'chatgpt.newChat'] : ['claude-vscode.sidebar.open', 'claude-vscode.newConversation'];
  const available = await vscode.commands.getCommands(true);
  if (!required.every(command => available.includes(command))) throw new Error(`The ${name} new-chat UI is unavailable. Update its VS Code extension and try again.`);
  return required;
}
async function startNativeChat(vscode, provider) {
  for (const command of await newChatCommands(vscode, provider)) await vscode.commands.executeCommand(command);
}
async function openNewProjectChat(vscode, provider, cwd, options = {}) {
  if (!['codex', 'claude'].includes(provider) || typeof cwd !== 'string' || !cwd) throw new Error('Invalid new-chat target.');
  if (provider === 'claude' && isProjectWorkspace(vscode, cwd)) {
    await startNativeChat(vscode, provider);
    return;
  }
  if (provider === 'claude') {
    await newChatCommands(vscode, provider);
    await switchClaudeProject(vscode, { cwd }, options);
    return;
  }
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  if (!extension) throw new Error('Install the Codex VS Code extension to start a chat in its UI.');
  await extension.activate();
  if (vscode.workspace.getConfiguration('chatgpt').get('runCodexInWindowsSubsystemForLinux', false)) throw new Error('Background project chat creation requires the local Codex runtime. Disable Codex in WSL or open the project in a WSL workspace.');
  const binary = await (options.findBinary || codexBinary)(extension.extensionPath);
  const session = await (options.createChat || createCodexProjectChat)(binary, cwd, options);
  if (!await openNativeSession(vscode, session)) throw new Error('The project chat was created, but the Codex sidebar could not open it.');
}

function pendingClaudeKey(vscode) {
  if (!vscode.env.sessionId) throw new Error('The VS Code window identity is unavailable.');
  return `claudeProjectOpen:${vscode.env.sessionId}`;
}

async function switchClaudeProject(vscode, request, options) {
  if (!options.globalState || !options.workspaceState) throw new Error('The project chat handoff is unavailable.');
  if (!path.isAbsolute(request.cwd) || !(await fs.stat(request.cwd).catch(() => null))?.isDirectory()) throw new Error('The chat project folder is unavailable.');
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.some(folder => folder.uri.scheme !== 'file')) throw new Error('Claude project switching requires a local VS Code workspace.');
  const key = pendingClaudeKey(vscode);
  const pending = options.globalState.get(key);
  if (pending && Date.now() - pending.createdAt < 120000) throw new Error('A Claude project switch is already in progress.');
  const target = folders.find(folder => canonicalProjectPath(folder.uri.fsPath) === canonicalProjectPath(request.cwd));
  const ordered = [target || { uri: vscode.Uri.file(request.cwd) }, ...folders.filter(folder => folder !== target)].map(({ uri, name }) => ({ uri, ...(name ? { name } : {}) }));
  // Persist before changing roots: VS Code may terminate this host immediately.
  await options.globalState.update(key, { ...request, createdAt: Date.now() });
  try { await options.beforeWorkspaceSwitch?.(); }
  catch (error) { await options.globalState.update(key, undefined); throw error; }
  // Existing multi-root workspaces emit a change without restarting their extensions.
  const changed = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    if (!isProjectWorkspace(vscode, request.cwd)) return;
    changed.dispose();
    void resumePendingProjectChats(vscode, options).catch(async error => {
      await options.globalState.update(key, undefined);
      vscode.window.showErrorMessage(`Chat Atlas: Could not reload Claude's project: ${error.message}`);
    });
  });
  try {
    if (!vscode.workspace.updateWorkspaceFolders(0, folders.length, ...ordered)) throw new Error('VS Code could not select the project folder.');
  } catch (error) {
    changed.dispose();
    await options.globalState.update(key, undefined);
    throw error;
  }
}

async function resumePendingProjectChats(vscode, options) {
  const workspaceKey = 'claudeProjectOpen';
  const restored = options.workspaceState?.get(workspaceKey);
  const key = restored ? workspaceKey : pendingClaudeKey(vscode);
  const storage = restored ? options.workspaceState : options.globalState;
  const request = storage.get(key);
  if (!request) return;
  const age = Date.now() - request.createdAt;
  if (!Number.isFinite(age) || age < 0 || age > 120000 || typeof request.cwd !== 'string') {
    await storage.update(key, undefined);
    return;
  }
  if (!vscode.workspace.isTrusted || !isProjectWorkspace(vscode, request.cwd)) return;
  // A window reload restores webview message handlers as well as Claude's project context.
  if (!request.reloaded) {
    // sessionId changes on reload; workspaceState follows this window's new workspace.
    await options.workspaceState.update(workspaceKey, { ...request, reloaded: true });
    await storage.update(key, undefined);
    try { await vscode.commands.executeCommand('workbench.action.reloadWindow'); }
    catch (error) { await options.workspaceState.update(workspaceKey, undefined); throw error; }
    return;
  }
  await storage.update(key, undefined);
  if (!(await fs.stat(request.cwd).catch(() => null))?.isDirectory()) throw new Error('The chat project folder is unavailable.');
  if (request.id !== undefined) {
    if (!await openNativeSession(vscode, { provider: 'claude', id: request.id, cwd: request.cwd }, request.editor === true)) throw new Error('The Claude Code chat UI is unavailable.');
  } else await startNativeChat(vscode, 'claude');
}

module.exports = { openNativeSession, openNewProjectChat, resumePendingProjectChats };
