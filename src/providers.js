'use strict';
const path = require('node:path');
const { UUID, claudeProjectPrompt } = require('./core');
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
      await openClaudeProjectTab(vscode, claude, session.cwd, session.id);
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
async function newClaudeChat(vscode, cwd) {
  const extension = vscode.extensions.getExtension('anthropic.claude-code');
  if (!extension) throw new Error('Install the Claude Code VS Code extension to start a chat in its UI.');
  if (vscode.workspace.isTrusted === false) throw new Error('Trust this workspace before opening Claude.');
  const first = vscode.workspace.workspaceFolders?.[0];
  if (first && first.uri.scheme !== 'file') throw new Error('Open a local workspace to start a Claude project chat.');
  const sameProject = isProjectWorkspace(vscode, cwd);
  if (!sameProject && !path.isAbsolute(cwd)) throw new Error('Claude requires an absolute project folder.');
  await extension.activate();
  const sidebar = 'claude-vscode.sidebar.open';
  const prompt = sameProject ? undefined : claudeProjectPrompt(cwd);
  const [major, minor, patch] = (extension.packageJSON?.version || '').split('.').map(Number);
  const directDraft = prompt && (major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 330))));
  const next = prompt ? 'claude-vscode.editor.open' : 'claude-vscode.newConversation';
  const available = await vscode.commands.getCommands(true);
  if (!available.includes(sidebar) || (!directDraft && !available.includes(next))) throw new Error('The Claude Code new-chat UI is unavailable. Check the installed Claude Code extension.');
  if (directDraft) return vscode.commands.executeCommand(sidebar, { prompt });
  if (!prompt) {
    await vscode.commands.executeCommand(sidebar);
    return vscode.commands.executeCommand(next);
  }
  // Older sidebar.open commands save this preference in the background, racing editor.open.
  const config = vscode.workspace.getConfiguration('claudeCode');
  if (config.get('preferredLocation') !== 'sidebar') {
    if (config.inspect('preferredLocation')?.workspaceValue === 'panel') throw new Error('Set Claude Code: Preferred Location to Sidebar in this workspace to open a project draft with this Claude version.');
    await config.update('preferredLocation', 'sidebar', true);
    if (vscode.workspace.getConfiguration('claudeCode').get('preferredLocation') !== 'sidebar') throw new Error('Claude Code could not use the sidebar preference in this workspace.');
  }
  return vscode.commands.executeCommand(next, undefined, prompt, undefined, undefined, false, { programmatic: 'honor-preferred-location' });
}
async function openNewProjectChat(vscode, provider, cwd, options = {}) {
  if (!['codex', 'claude'].includes(provider) || typeof cwd !== 'string' || !cwd) throw new Error('Invalid new-chat target.');
  if (provider === 'claude') return newClaudeChat(vscode, cwd);
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  if (!extension) throw new Error('Install the Codex VS Code extension to start a chat in its UI.');
  await extension.activate();
  if (vscode.workspace.getConfiguration('chatgpt').get('runCodexInWindowsSubsystemForLinux', false)) throw new Error('Background project chat creation requires the local Codex runtime. Disable Codex in WSL or open the project in a WSL workspace.');
  const binary = await (options.findBinary || codexBinary)(extension.extensionPath);
  const session = await (options.createChat || createCodexProjectChat)(binary, cwd, options);
  if (!await openNativeSession(vscode, session)) throw new Error('The project chat was created, but the Codex sidebar could not open it.');
}

module.exports = { openNativeSession, openNewProjectChat };
