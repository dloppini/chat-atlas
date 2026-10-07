'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
async function run() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, '.test-output');
  await fs.mkdir(path.join(output, 'history', 'sessions'), { recursive: true });
  const id = '12345678-1234-1234-1234-123456789abc';
  await fs.writeFile(path.join(output, 'history', 'sessions', `${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id, cwd: root, timestamp: '2026-10-06T00:00:00Z' } }) + '\n' + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build a topic board' }] } }) + '\n');
  const c = vscode.workspace.getConfiguration('chatAtlas');
  await c.update('codexHome', path.join(output, 'history'), vscode.ConfigurationTarget.Global);
  await c.update('claudeHome', path.join(output, 'missing'), vscode.ConfigurationTarget.Global);
  const manifest = require('../package.json');
  const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`); assert.ok(extension);
  const api = await extension.activate(); await api.refresh();
  const snapshot = api.getSnapshot(); assert.equal(snapshot.sessions.length, 1); assert.equal(snapshot.sessions[0].title, 'Build a topic board');
  assert.equal(snapshot.sessions[0].topic, 'features'); assert.equal(snapshot.sources[1].state, 'missing');
  await vscode.commands.executeCommand('chatAtlas.open');
  for (let attempt = 0; attempt < 50 && !vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.label === 'Chat Atlas')); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.label === 'Chat Atlas')));
  await fs.writeFile(path.join(output, 'extension-host.json'), JSON.stringify({ passed: true, tests: ['extension activation', 'real VS Code settings', 'scan and persisted metadata', 'board command opens webview tab'], vscodeVersion: vscode.version }, null, 2));
}
module.exports = { run };
