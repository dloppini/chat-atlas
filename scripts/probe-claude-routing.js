'use strict';
// Read-only compatibility probe: executes selected installed methods with inert fixtures, never activates Claude.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

async function run(extensionPath) {
  if (!extensionPath) throw new Error('Usage: node scripts/probe-claude-routing.js <installed Claude extension folder>');
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf8'));
  const host = fs.readFileSync(path.join(extensionPath, 'extension.js'), 'utf8');
  const web = fs.readFileSync(path.join(extensionPath, 'webview/index.js'), 'utf8');
  function between(source, start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Claude ${manifest.version}: source boundary changed: ${start}`);
    return source.slice(from, to);
  }
  const findings = [];
  const routeSource = between(host, 'function gke(', 'var Frt=');
  const route = vm.runInNewContext(`(${routeSource.trim()})`);
  assert.equal(route({ programmatic: 'honor-preferred-location', preferredLocation: 'sidebar', sessionAlreadyOpenInPanel: false }).target, 'sidebar');
  assert.equal(route({ programmatic: 'honor-preferred-location', preferredLocation: 'sidebar', sessionAlreadyOpenInPanel: true }).target, 'panel');
  findings.push('Sidebar preference works, but a session already in an editor is routed back to that editor.');

  const calls = [];
  const callback = between(host, 'registerCommand("claude-vscode.editor.open",', ')),e.subscriptions.push(Te.commands.registerCommand("claude-vscode.primaryEditor.open"').replace(/^registerCommand\("claude-vscode.editor.open",/, '');
  const open = vm.runInNewContext(`(${callback})`, {
    gke: route, n: { getPreferredLocation: () => 'sidebar' }, f: true,
    c: { hasPanelForSession: () => false, activateInSidebar: (...args) => calls.push(args) },
    Te: { commands: { executeCommand: async () => {} } }
  });
  const id = '12345678-1234-1234-1234-123456789abc';
  await open(id, undefined, undefined, undefined, false, { programmatic: 'honor-preferred-location', cwd: 'C:/project-b' });
  assert.equal(calls[0][0], id);
  assert.equal(calls[0].length, 2);
  findings.push('The real editor command discards cwd even when supplied in its options.');

  const notifySource = between(host, 'async notifyActivateSession(e,t){', 'notifyToggleDictation(){');
  const notify = vm.runInNewContext(`({${notifySource}}).notifyActivateSession`);
  let activation;
  await notify.call({ clientReady: Promise.resolve(), send: value => { activation = value; } }, id, undefined, 'C:/project-b');
  assert.equal(activation.request.type, 'activate_session');
  assert.equal(activation.request.sessionId, id);
  assert.equal('cwd' in activation.request, false);
  findings.push('The native sidebar activation message contains no working directory.');

  class Session {
    constructor() {
      this.isExplicit = {}; this.permissionMode = {}; this.worktree = {}; this.cwd = {};
    }
  }
  const createSource = between(web, 'async createSession(e={}){', 'listedSessions(){');
  const create = vm.runInNewContext(`({${createSource}}).createSession`, { V0: Session, rZe: () => false, console: { log() {} } });
  const sessions = {
    context: {}, getConnection: async () => ({ config: { value: {} } }), watch() {},
    createdByUser: new Set(), sessions: { value: [] }, activeSession: {}, seedSelectionIfUnset() {}
  };
  const ignored = await create.call(sessions, { cwd: 'C:/project-b' });
  assert.equal(ignored.cwd.value, undefined);
  const a = await create.call(sessions, { existingWorktree: { name: 'a', path: 'C:/project-a' } });
  const b = await create.call(sessions, { existingWorktree: { name: 'b', path: 'C:/project-b' } });
  assert.equal(a.cwd.value, 'C:/project-a');
  assert.equal(b.cwd.value, 'C:/project-b');
  assert.notEqual(a, b);
  findings.push('The real frontend can retain different per-session directories through its internal worktree path; a plain cwd option is ignored.');

  const launchSource = between(web, 'async launchClaude(e){', 'freshStartIfUnresumable(){');
  const launch = vm.runInNewContext(`({${launchSource}}).launchClaude`, { Rq: 'fixture-error', hr: action => action(), performance });
  const launches = [];
  async function launchSession(cwd) {
    const session = {
      cwd: { value: cwd }, error: {}, startupFailureReason: {}, retiredChannelIds: new Set(),
      modelSelection: { value: 'fixture-model' }, modelSelectionProvisional: {}, sessionId: {}, permissionMode: {}, thinkingLevel: {},
      teleportedFromSessionId: {}, isSupersededChannel: () => false, freshStartIfUnresumable: () => false,
      getConnection: async () => ({ launchClaude: (...args) => { launches.push(args); return []; } }),
      readMessages() {}, flushPendingReplayEvictionTelemetry() {}, flushPendingRebuildSkipTelemetry() {}
    };
    await launch.call(session);
  }
  await launchSession(a.cwd.value);
  await launchSession(b.cwd.value);
  assert.deepEqual(launches.map(args => args[2]), ['C:/project-a', 'C:/project-b']);
  findings.push('The real frontend launch method sends each session directory separately to the backend.');
  assert.ok(host.includes('let r=Ue.workspace.workspaceFolders?.map((c)=>c.uri.fsPath)||[],o=vH(r)'));
  assert.ok(host.includes('defaultCwd:this.cwd'));
  findings.push('Sidebar initialization uses the first workspace folder and publishes it as defaultCwd.');
  console.log(JSON.stringify({ version: manifest.version, kind: 'installed-source methods with inert fixtures; no live UI or model requests', findings }, null, 2));
}

run(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
