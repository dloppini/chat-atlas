'use strict';
const { UUID } = require('./core');
const { canonicalProjectPath } = require('../media/projects');
const { codexBinary, createCodexProjectChat } = require('./codex-chat');
const { openClaudeProjectTab } = require('./claude-tabs');

function isProjectWorkspace(vscode, cwd) {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.scheme === 'file' && canonicalProjectPath(folders[0].uri.fsPath) === canonicalProjectPath(cwd);
}

// These provider-owned routes are version-sensitive. Keep all native routing here.
async function openNativeSession(vscode, session, editor = false) {
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
    if (session.cwd && !isProjectWorkspace(vscode, session.cwd)) {
      await openClaudeProjectTab(vscode, claude, session.cwd, session.id, editor);
      return true;
    }
    await claude.activate();
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('claude-vscode.editor.open') && commands.includes('claude-vscode.sidebar.open')) {
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
  if (provider === 'claude') {
    if (!isProjectWorkspace(vscode, cwd)) {
      const extension = vscode.extensions.getExtension('anthropic.claude-code');
      if (!extension) throw new Error('Install the Claude Code VS Code extension to start a chat in its UI.');
      await openClaudeProjectTab(vscode, extension, cwd);
      return;
    }
    await startNativeChat(vscode, provider);
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

module.exports = { openNativeSession, openNewProjectChat };
