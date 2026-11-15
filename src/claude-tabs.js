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
const supportedHash = 'cdc6cc5caf6a677dffe798c3805266a9e0612d0fe722b240a87bc9ce5e20060e';

function openClaudeProjectTab(vscode, extension, cwd, sessionId, beside = false) {
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
      if (process.platform !== 'win32' || extension.packageJSON.version !== '2.1.323' || hash !== supportedHash) {
        throw new Error('Cross-project Claude tabs need a compatibility update for this Claude build. The tested build is Windows 2.1.323. No chat or workspace was changed.');
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
    fs.realpathSync = bridge;
    try {
      // An explicit column keeps panel construction synchronous; other sessions retain their own cwd.
      await scope.run(token, () => vscode.commands.executeCommand('claude-vscode.editor.open', sessionId, undefined,
        beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, undefined, true));
      if (!intercepted && sessionId === undefined) throw new Error('Claude did not create a project tab. Close the unused tab, if any, and try again.');
    } finally {
      if (fs.realpathSync === bridge) fs.realpathSync = original;
    }
  });
  queue = operation.catch(() => {});
  return operation;
}

module.exports = { openClaudeProjectTab };
