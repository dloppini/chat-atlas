'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { UUID } = require('./core');
const { canonicalProjectPath } = require('../media/projects');

async function codexBinary(extensionPath) {
  const platforms = { win32: ['windows-x86_64', 'windows-aarch64'], darwin: ['macos-aarch64', 'macos-x86_64', 'darwin-arm64', 'darwin-x64'], linux: ['linux-x86_64', 'linux-aarch64'] };
  const folders = (platforms[process.platform] || []).filter(folder => process.arch === 'arm64' ? /arm64|aarch64/.test(folder) : /x64|x86_64/.test(folder));
  for (const folder of folders) {
    const binary = path.join(extensionPath, 'bin', folder, process.platform === 'win32' ? 'codex.exe' : 'codex');
    try { if ((await fs.stat(binary)).isFile()) return binary; } catch { /* Try the next shipped platform spelling. */ }
  }
  throw new Error('The installed Codex extension has no compatible local runtime. Update the extension and try again.');
}

async function createCodexProjectChat(binary, cwd, options = {}) {
  const child = (options.spawn || spawn)(binary, ['app-server', '--stdio'], {
    cwd, env: { ...process.env, ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {}) },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const pending = new Map(); let nextId = 0;
  const rejectPending = error => { for (const wait of pending.values()) wait.reject(error); pending.clear(); };
  child.on('error', rejectPending);
  child.once('exit', () => rejectPending(new Error('Codex closed before creating the project chat.')));
  child.stdin.on('error', rejectPending); child.stderr.resume();
  const reader = readline.createInterface({ input: child.stdout });
  reader.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const wait = pending.get(message?.id); if (!wait) return;
    pending.delete(message.id);
    message.error ? wait.reject(new Error(message.error.message || 'Codex could not create the project chat.')) : wait.resolve(message.result);
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const timeout = setTimeout(() => rejectPending(new Error('Codex took too long to create the project chat.')), options.timeoutMs || 30000);
  try {
    await request('initialize', { clientInfo: { name: 'chat_atlas', title: 'Chat Atlas', version: require('../package.json').version } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const result = await request('thread/start', { cwd, ephemeral: false });
    const thread = result?.thread;
    if (!UUID.test(thread?.id || '') || canonicalProjectPath(thread.cwd) !== canonicalProjectPath(cwd)) throw new Error('Codex did not create the chat in the selected project folder.');
    // Materialize the empty thread without assigning a custom name.
    await request('thread/archive', { threadId: thread.id });
    await request('thread/unarchive', { threadId: thread.id });
    return { provider: 'codex', id: thread.id, cwd: thread.cwd };
  } finally {
    clearTimeout(timeout); child.stdin.end();
    const stop = setTimeout(() => child.kill(), 1000);
    // The persisted thread can open while its helper shuts down.
    void closed.then(() => { clearTimeout(stop); reader.close(); });
  }
}
module.exports = { codexBinary, createCodexProjectChat };
