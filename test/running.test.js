'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseSession, parseLines, publicSessions, reconcile, SessionIndex, sample } = require('../src/core');

const id = '12345678-1234-1234-1234-123456789abc';
const now = Date.now();
const stamp = value => new Date(value).toISOString();
const stat = { mtimeMs: now, birthtimeMs: now - 3600000, size: 1000 };
const meta = { type: 'session_meta', payload: { id, cwd: '/fictional/project' } };
const event = (type, timestamp = now) => ({ type: 'event_msg', timestamp: stamp(timestamp), payload: { type } });
const response = (type, properties = {}) => ({ type: 'response_item', timestamp: stamp(now), payload: { type, ...properties } });
const user = { type: 'user', sessionId: id, timestamp: stamp(now), message: { content: 'Build the board' } };
const claude = (content, stop_reason = null) => ({ type: 'assistant', sessionId: id, timestamp: stamp(now), message: { content, stop_reason } });
const running = (provider, records, time = now, timeout) => {
  const session = parseSession(provider, `${id}.jsonl`, provider === 'codex' ? [meta, ...records] : [user, ...records], stat);
  return publicSessions([session], reconcile([session], {}), time, timeout)[0].running;
};

test('Codex detects prompts, reasoning and both tool formats when task-start markers are absent', () => {
  const prompt = response('message', { role: 'user', content: [{ type: 'input_text', text: 'Fix the board' }] });
  for (const record of [prompt, response('reasoning'), response('function_call'), response('function_call_output'), response('custom_tool_call'), response('custom_tool_call_output'), event('exec_command_begin'), event('patch_apply_end')]) {
    assert.equal(running('codex', [record]), true, JSON.stringify(record.payload));
  }
  assert.equal(running('codex', [{ type: 'event_msg', timestamp: stamp(now), payload: { type: 'user_message', message: 'Build the board' } }]), true);
  assert.equal(running('codex', [response('message', { role: 'user', content: '<environment_context>Context only</environment_context>' })]), false);
});

test('Final phases, completion and interruption stop Codex without reopening on trailing output', () => {
  for (const end of [event('task_complete'), event('turn_aborted'), response('message', { role: 'assistant', phase: 'final_answer' }), response('message', { role: 'assistant', channel: 'final' })]) {
    assert.equal(running('codex', [event('task_started'), response('reasoning'), end, response('function_call_output'), event('token_count')]), false);
    assert.equal(running('codex', [end, event('task_started'), response('reasoning')]), true);
  }
  assert.equal(running('codex', [response('message', { role: 'assistant', phase: 'commentary' })]), true);
  assert.equal(running('codex', [response('message', { role: 'assistant' })]), false);
  assert.equal(running('codex', [response('message', { role: 'assistant' }), response('function_call')]), true);
});

test('Sampling gaps discard obsolete head markers and recover active work from the tail', () => {
  const gap = { type: 'atlas_sample_gap' };
  assert.equal(running('codex', [event('task_complete'), gap, response('reasoning'), response('custom_tool_call_output')]), true);
  assert.equal(running('codex', [event('task_started'), gap, event('thread_settings_applied')]), false);
  assert.equal(running('codex', [event('task_started'), gap, response('message', { role: 'assistant', phase: 'final_answer' })]), false);
  assert.equal(running('claude', [claude([], 'end_turn'), gap, claude([{ type: 'thinking', thinking: 'fixture' }])]), true);
});

test('Claude recognizes thinking, tool results, turn duration and user interruptions', () => {
  const thinking = claude([{ type: 'thinking', thinking: 'fixture' }]);
  const tool = claude([{ type: 'tool_use', id: 'fixture-tool' }]);
  const result = { ...user, message: { content: [{ type: 'tool_result', tool_use_id: 'fixture-tool', content: 'fixture output' }] } };
  assert.equal(running('claude', [thinking]), true);
  assert.equal(running('claude', [tool, result]), true);
  assert.equal(running('claude', [thinking, { type: 'system', subtype: 'turn_duration', timestamp: stamp(now) }, result]), false);
  assert.equal(running('claude', [tool, { ...user, message: { content: '[Request interrupted by user for tool use]' } }]), false);
  for (const stop of ['end_turn', 'stop_sequence', 'max_tokens', 'refusal']) {
    assert.equal(running('claude', [claude([{ type: 'thinking' }], stop), result]), false);
  }
  assert.equal(running('claude', [claude([], 'end_turn'), user]), true);
  const metadata = { ...user, isMeta: true, timestamp: stamp(now), message: { content: 'Internal context' } };
  assert.equal(running('claude', [claude([], 'end_turn'), metadata]), false);
});

test('Long tools retain their indicator while stale tasks expire using activity time and configurable limits', () => {
  for (const provider of ['codex', 'claude']) {
    const records = provider === 'codex' ? [event('task_started')] : [claude([], 'tool_use')];
    assert.equal(running(provider, records, now + 30 * 60000), true);
    assert.equal(running(provider, records, now + 61 * 60000), false);
    assert.equal(running(provider, records, now + 61 * 60000, 2 * 60 * 60000), true);
    assert.equal(running(provider, records, now + 6 * 60000, 5 * 60000), false);
  }
  assert.equal(running('codex', [event('task_started', now - 2 * 3600000), { type: 'event_msg', timestamp: stamp(now), payload: { type: 'thread_settings_applied' } }]), false);
  assert.equal(running('codex', [event('task_started', now + 5 * 60000)]), true);
});

test('Live activity refresh preserves state through partial and oversized writes and stops on completion', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-running-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', `${id}.jsonl`);
  await fs.writeFile(file, [meta, event('task_complete')].map(JSON.stringify).join('\n') + '\n');
  const index = new SessionIndex();
  const snapshot = await index.scan({ codexHome: root, claudeHome: path.join(root, 'absent') });
  let sessions = snapshot.sessions;
  assert.equal(publicSessions(sessions, reconcile(sessions, {}))[0].running, false);
  await fs.appendFile(file, JSON.stringify(event('task_started')) + '\n' + '{"type":"response_item","payload":{"type":"custom_tool_call","arguments":"');
  sessions = await index.refreshActivity(sessions);
  assert.equal(sessions[0].activeTurnSignal, true);
  const observedAt = sessions[0].activeTurnAt;
  await fs.appendFile(file, 'x'.repeat(600000));
  sessions = await index.refreshActivity(sessions);
  assert.equal(sessions[0].activeTurnSignal, true);
  assert.ok(sessions[0].activeTurnAt >= observedAt);
  await fs.appendFile(file, '"}}\n' + JSON.stringify(event('task_complete')) + '\n');
  sessions = await index.refreshActivity(sessions);
  assert.equal(sessions[0].activeTurnSignal, false);
  await fs.rename(file, path.join(root, 'rotated.jsonl'));
  const unavailable = await index.refreshActivity(sessions);
  assert.deepEqual(unavailable, sessions);
});

test('A new turn remains detectable when a single large append hides its start outside the tail', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-large-append-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', `${id}.jsonl`);
  await fs.writeFile(file, [meta, event('task_complete')].map(JSON.stringify).join('\n') + '\n');
  const index = new SessionIndex();
  const snapshot = await index.scan({ codexHome: root, claudeHome: path.join(root, 'absent') });
  await fs.appendFile(file, JSON.stringify(event('task_started')) + '\n' + '{"type":"response_item","payload":{"type":"custom_tool_call","arguments":"' + 'x'.repeat(600000));
  const sessions = await index.refreshActivity(snapshot.sessions);
  assert.equal(sessions[0].activeTurnSignal, true);
  assert.equal(publicSessions(sessions, reconcile(sessions, {}))[0].running, true);
});

test('Malformed non-record JSON lines do not suppress valid activity records', () => {
  const records = parseLines('null\n17\n[]\n"text"\n' + JSON.stringify(meta) + '\n' + JSON.stringify(event('task_started')) + '\n{"incomplete":');
  assert.equal(records.length, 2);
  const session = parseSession('codex', `${id}.jsonl`, records, stat);
  assert.equal(session.activeTurnSignal, true);
});

test('Observed new work tolerates clock skew while metadata-only writes cannot revive stale tasks', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-clock-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', `${id}.jsonl`);
  await fs.writeFile(file, [meta, event('task_started', now - 2 * 3600000)].map(JSON.stringify).join('\n') + '\n');
  const index = new SessionIndex();
  const snapshot = await index.scan({ codexHome: root, claudeHome: path.join(root, 'absent') });
  const state = reconcile(snapshot.sessions, {});
  assert.equal(publicSessions(snapshot.sessions, state)[0].running, false);
  await fs.appendFile(file, JSON.stringify(event('thread_settings_applied')) + '\n');
  let sessions = await index.refreshActivity(snapshot.sessions);
  assert.equal(publicSessions(sessions, state)[0].running, false);
  await fs.appendFile(file, JSON.stringify({ ...response('reasoning'), timestamp: stamp(now - 2 * 3600000 + 1000) }) + '\n');
  sessions = await index.refreshActivity(sessions);
  assert.equal(publicSessions(sessions, state)[0].running, true);
  assert.ok(sessions[0].activeTurnAt >= now);
  const observedAt = sessions[0].activeTurnAt;
  await fs.appendFile(file, JSON.stringify(event('thread_settings_applied')) + '\n');
  sessions = await index.refreshActivity(sessions);
  assert.equal(sessions[0].activeTurnAt, observedAt);
});

test('Bounded sampling keeps complete records that cross the contiguous head/tail boundary', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-boundary-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'boundary.jsonl');
  const prefix = JSON.stringify(meta) + '\n' + JSON.stringify({ type: 'metadata', padding: 'x'.repeat(260000) }) + '\n';
  const final = response('message', { role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'x'.repeat(10000) }] });
  await fs.writeFile(file, prefix + JSON.stringify(final) + '\n');
  const stat = await fs.stat(file);
  const records = await sample(file, stat.size);
  assert.equal(records.at(-1).payload.phase, 'final_answer');
  assert.equal(records.some(r => r.type === 'atlas_sample_gap'), false);
});

test('Reported file activity follows each provider and clears on new turns and completion', () => {
  const patch = response('custom_tool_call', { name: 'apply_patch', input: '*** Begin Patch\n*** Update File: board.js\n*** End Patch' });
  const files = (provider, records) => parseSession(provider, id + '.jsonl', provider === 'codex' ? [meta, ...records] : [user, ...records], stat).activeFiles;
  assert.deepEqual(files('codex', [patch]), ['board.js']);
  assert.deepEqual(files('codex', [patch, event('turn_aborted')]), []);
  const read = claude([{ type: 'tool_use', name: 'Read', input: { file_path: 'src/core.js' } }]);
  assert.deepEqual(files('claude', [read]), ['src/core.js']);
  assert.deepEqual(files('claude', [read, user]), []);
  assert.deepEqual(files('claude', [read, claude([], 'end_turn')]), []);
});

test('Explorer marks only project files and clears them after the last active chat', () => {
  const { registerActivity } = require('../src/chat-files');
  const uri = fsPath => ({ scheme: 'file', fsPath });
  const vscode = { EventEmitter: class { fire() {} }, ThemeColor: class {}, Uri: { file: uri }, window: { registerFileDecorationProvider() {} } };
  const activity = registerActivity(vscode, { subscriptions: [] });
  const cwd = path.resolve('fixture');
  const session = { cwd, running: true, activeFiles: ['board.js', '../outside.js'] };
  activity.update(['claude', 'codex'].map(provider => ({ ...session, provider })));
  const mark = activity.lookup(uri(path.join(cwd, 'board.js')));
  assert.equal(mark.badge, '\u25cf');
  assert.match(mark.tooltip, /Claude and Codex/);
  assert.equal(activity.lookup(uri(path.resolve(cwd, '../outside.js'))), undefined);
  activity.update([]);
  assert.equal(activity.lookup(uri(path.join(cwd, 'board.js'))), undefined);
});

test('A pending question marks the chat as asking you until it is answered, superseded or interrupted', () => {
  const ask = response('function_call', { name: 'request_user_input_async', call_id: 'ask-1' });
  const answer = response('function_call_output', { call_id: 'ask-1' });
  const prompt = response('message', { role: 'user', content: [{ type: 'input_text', text: 'Go on' }] });
  const attention = (provider, records) => {
    const session = parseSession(provider, `${id}.jsonl`, provider === 'codex' ? [meta, ...records] : [user, ...records], stat);
    return publicSessions([session], reconcile([session], {}), now)[0].attention;
  };
  assert.equal(attention('codex', [ask]), 'question');
  assert.equal(attention('codex', [ask, event('task_complete')]), 'question'); // Codex asks asynchronously; the turn may end first.
  assert.equal(attention('codex', [ask, answer, event('task_complete')]), 'finished');
  assert.equal(attention('codex', [ask, prompt]), '');
  assert.equal(attention('codex', [ask, event('turn_aborted')]), 'finished');
  const claudeAsk = claude([{ type: 'tool_use', id: 'toolu_1', name: 'AskUserQuestion', input: {} }], 'tool_use');
  const claudeAnswer = { type: 'user', sessionId: id, timestamp: stamp(now), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Option A' }] } };
  assert.equal(attention('claude', [claudeAsk]), 'question');
  assert.equal(attention('claude', [claudeAsk, claudeAnswer]), '');
  assert.equal(attention('claude', [claudeAsk, { ...user, message: { content: '[Request interrupted by user]' } }]), 'finished');
});

test('A finished turn asks for review until the card is opened, and the flag expires after the running timeout', () => {
  const finished = parseSession('codex', `${id}.jsonl`, [meta, response('message', { role: 'user', content: [{ type: 'input_text', text: 'Fix it' }] }), event('task_complete', now - 60000)], stat);
  const state = reconcile([finished], {});
  assert.equal(publicSessions([finished], state, now)[0].attention, 'finished');
  assert.equal(publicSessions([finished], state, now + 2 * 3600000)[0].attention, '');
  state.cards[finished.key].seenAt = now;
  assert.equal(publicSessions([finished], state, now)[0].attention, '');
  state.cards[finished.key].seenAt = 0; state.cards[finished.key].status = 'Done';
  assert.equal(publicSessions([finished], state, now)[0].attention, '');
  const active = parseSession('codex', `${id}.jsonl`, [meta, event('task_started')], stat);
  assert.equal(publicSessions([active], reconcile([active], {}), now)[0].attention, '');
});
