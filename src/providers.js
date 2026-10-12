'use strict';
const { UUID } = require('./core');
const { canonicalProjectPath } = require('../media/projects');
const { codexBinary, createCodexProjectChat } = require('./codex-chat');

function isProjectWorkspace(vscode, cwd) {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.length === 1 && folders[0].uri.scheme === 'file' && canonicalProjectPath(folders[0].uri.fsPath) === canonicalProjectPath(cwd);
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
    await claude.activate();
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('claude-vscode.editor.open') && commands.includes('claude-vscode.sidebar.open')) {
      await vscode.commands.executeCommand('claude-vscode.sidebar.open');
      // Observed in Anthropic 2.1.289: session ID is the first positional argument;
      // argument six asks the editor command to honor the sidebar preference.
      await vscode.commands.executeCommand('claude-vscode.editor.open', session.id, undefined, undefined, undefined, false, { programmatic: 'honor-preferred-location' });
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
  const required = provider === 'codex' ? ['chatgpt.openSidebar', 'chatgpt.newChat'] : ['claude-vscode.editor.open'];
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
  if (provider === 'claude') throw new Error('Claude Code cannot start a chat in another folder in this window. Use Codex here, or open the project folder in VS Code first.');
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  if (!extension) throw new Error('Install the Codex VS Code extension to start a chat in its UI.');
  await extension.activate();
  if (vscode.workspace.getConfiguration('chatgpt').get('runCodexInWindowsSubsystemForLinux', false)) throw new Error('Background project chat creation requires the local Codex runtime. Disable Codex in WSL or open the project in a WSL workspace.');
  const binary = await (options.findBinary || codexBinary)(extension.extensionPath);
  const session = await (options.createChat || createCodexProjectChat)(binary, cwd, options);
  if (!await openNativeSession(vscode, session)) throw new Error('The project chat was created, but the Codex sidebar could not open it.');
}
module.exports = { openNativeSession, openNewProjectChat };
