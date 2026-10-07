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
module.exports = { openNativeSession };
