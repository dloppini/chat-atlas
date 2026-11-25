'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { UUID } = require('./core');
const { canonicalProjectPath } = require('../media/projects');

const scope = new AsyncLocalStorage();
let queue = Promise.resolve();
const verified = new Map();
// shortcut: private Claude panel construction; replace with an official cwd argument when available.
const supportedHashes = {
  '2.1.323': 'cdc6cc5caf6a677dffe798c3805266a9e0612d0fe722b240a87bc9ce5e20060e',
  '2.1.325': '1f94855dd66098c4ef63cc54b20f14fc08483c7a766249cb16500a3f5bbff12f',
  '2.1.326': '0e3b4f5b76cc0ff00f99175410881f73cb146ecf37687807851d51141eb9f9c7',
  '2.1.327': 'ad50c87a7f56bc35777d24051cf9316961dac6ea7a986eb2e6f01e635bc6e775',
  '2.1.328': 'b8b324836541e5315a86fe0da5600404846819d08f32066d531c472f391bd653',
  '2.1.329': '52b02f9e956efe2a696ba61d0b80cd7305aa7b929e7c5e0f4bb606bd4853ecec',
  '2.1.330': 'd7d997a0dfd6634830268bb34f6292466f9a0d5a62e4c6f4d3302c3854c59089'
};

function openClaudeProjectTab(vscode, extension, cwd, sessionId) {
  const operation = queue.then(async () => {
    if (sessionId !== undefined && !UUID.test(sessionId)) throw new Error('Invalid session identifier.');
    if (vscode.workspace.isTrusted === false) throw new Error('Trust this workspace before opening Claude.');
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('Claude requires an existing absolute project directory.');
    const target = await fs.promises.realpath(cwd);
    if (!(await fs.promises.stat(target)).isDirectory()) throw new Error('The Claude project path must be a directory.');
    const first = vscode.workspace.workspaceFolders?.[0];
    if (first && first.uri.scheme !== 'file') throw new Error('Claude project tabs currently require a local Windows workspace.');
    const source = await fs.promises.realpath(path.join(extension.extensionPath, 'extension.js'));
    if (!verified.has(source)) {
      const hash = createHash('sha256').update(await fs.promises.readFile(source)).digest('hex');
      if (process.platform !== 'win32' || hash !== supportedHashes[extension.packageJSON.version]) {
        throw new Error(`Cross-project Claude tabs need a compatibility update for Claude ${extension.packageJSON.version}. Supported Windows builds: ${Object.keys(supportedHashes).join(', ')}. No chat or workspace was changed.`);
      }
      verified.set(source, true);
    }
    await extension.activate();
    if (!(await vscode.commands.getCommands(true)).includes('claude-vscode.editor.open')) throw new Error('Claude editor command is unavailable.');
    const root = canonicalProjectPath(first?.uri.fsPath || os.homedir());
    const original = fs.realpathSync;
    const token = {};
    let intercepted = false;
    function bridge(value, ...args) {
      if (scope.getStore() === token && typeof value === 'string' && canonicalProjectPath(value) === root) {
        const stack = new Error().stack || '';
        if (stack.toLowerCase().includes(`.setuppanel (${source.toLowerCase()}:`)) {
          intercepted = true;
          fs.realpathSync = original;
          return original.call(fs, target, ...args);
        }
      }
      return original.call(fs, value, ...args);
    }
    Object.assign(bridge, original);
    const groups = vscode.window.tabGroups;
    const sideGroup = groups.all.find(group => group !== groups.activeTabGroup &&
      group.tabs.some(tab => tab.input?.viewType === 'mainThreadWebview-claudeVSCodePanel'));
    fs.realpathSync = bridge;
    try {
      // An explicit column keeps panel construction synchronous; other sessions retain their own cwd.
      await scope.run(token, () => vscode.commands.executeCommand('claude-vscode.editor.open', sessionId, undefined,
        sideGroup?.viewColumn ?? vscode.ViewColumn.Beside, undefined, true));
      if (!intercepted && sessionId === undefined) throw new Error('Claude did not create a project tab. Close the unused tab, if any, and try again.');
    } finally {
      if (fs.realpathSync === bridge) fs.realpathSync = original;
    }
  });
  queue = operation.catch(() => {});
  return operation;
}

module.exports = { openClaudeProjectTab };
