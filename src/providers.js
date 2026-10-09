'use strict';
const { UUID } = require('./core');

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
async function openNewProjectChat(vscode, provider, cwd) {
  if (!['codex', 'claude'].includes(provider) || typeof cwd !== 'string' || !cwd) throw new Error('Invalid new-chat target.');
  // New-chat commands use this window's workspace. Keep the user's current window.
  await startNativeChat(vscode, provider);
}
module.exports = { openNativeSession, openNewProjectChat };
