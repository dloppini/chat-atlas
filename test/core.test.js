'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { classify, parseSession, reconcile, SessionIndex, sample, publicSessions } = require('../src/core');
const { openNativeSession } = require('../src/providers');
const { canonicalProjectPath, projectGroupKey, groupProjects, resolveProjectSelection, orderedProjects, moveProject } = require('../media/projects');
const id = '12345678-1234-1234-1234-123456789abc';
const meta = { type: 'session_meta', payload: { id, cwd: 'C:/Code/example', timestamp: '2026-10-01T12:00:00Z' } };
const prompt = text => ({ type: 'response_item', timestamp: '2026-10-01T12:01:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
const answer = text => ({ ...prompt(text), payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
const stat = { birthtimeMs: 1, mtimeMs: 1791000000000, size: 1000 };
test('Manual project sorting survives alphabetical mode and appends new projects without losing saved order', () => {
  const groups = groupProjects([{ project: 'Zulu', cwd: '/z' }, { project: 'Alpha', cwd: '/a' }, { project: 'Beta', cwd: '/b' }]);
  const keys = (mode, order) => orderedProjects(groups, mode, order).map(([key]) => key);
  const order = ['path:/z', 'path:/a'];
  assert.deepEqual(keys('manual', order), ['path:/z', 'path:/a', 'path:/b']);
  assert.deepEqual(keys('alphabetical', order), ['path:/a', 'path:/b', 'path:/z']);
  assert.deepEqual(order, ['path:/z', 'path:/a']);
  const moved = moveProject(keys('manual', order), 'path:/b', 'path:/z');
  assert.deepEqual(moved, ['path:/b', 'path:/z', 'path:/a']);
  assert.deepEqual(moveProject(moved, 'path:/b', 'path:/a', true), ['path:/z', 'path:/a', 'path:/b']);
  assert.deepEqual(moveProject(moved, 'missing', 'path:/a'), moved);
  assert.deepEqual(moveProject(moved, 'path:/b', 'path:/b'), moved);
  assert.deepEqual(keys('manual', JSON.parse(JSON.stringify(moved))), moved);
});
test('Sidebar combines equivalent Windows paths and distinguishes folders with matching names', () => {
  const sessions = [
    { project: 'Example', cwd: 'C:\\Code\\Example' },
    { project: 'Example', cwd: 'c:/Code/Example/' },
    { project: 'Example', cwd: '\\\\?\\C:\\Code\\Example' },
    { project: 'example', cwd: 'D:/Archive/example' },
    { project: 'Other conversations', cwd: '' },
    { project: 'Other conversations', cwd: 'C:/Code/Other conversations' }
  ];
  const groups = groupProjects(sessions);
  assert.equal(groups.size, 4);
  assert.equal(groups.get('path:c:/code/example').count, 3);
  assert.equal(groups.get('path:c:/code/example').folders.size, 1);
  assert.equal(groups.get('path:c:/code/example').showPath, true);
  assert.equal(groups.get('path:d:/archive/example').count, 1);
  assert.equal(resolveProjectSelection('C:\\Code\\Example', sessions, groups), 'path:c:/code/example');
  assert.equal(resolveProjectSelection('path:c:/code/example', sessions, groups), 'path:c:/code/example');
  assert.equal(resolveProjectSelection('C:/Code/Unavailable', sessions, groups), 'C:/Code/Unavailable');
  assert.equal(sessions.filter(s => projectGroupKey(s) === 'path:c:/code/example').length, 3);
  assert.equal(sessions[0].cwd, 'C:\\Code\\Example');
  assert.equal(canonicalProjectPath('/code/Example/'), '/code/Example');
  assert.notEqual(canonicalProjectPath('/code/Example'), canonicalProjectPath('/code/example'));
  assert.equal(canonicalProjectPath('/'), '/');
  assert.equal(canonicalProjectPath('C:\\'), 'c:/');
  assert.equal(canonicalProjectPath('\\\\?\\UNC\\Server\\Share\\Example\\'), '//server/share/example');
  assert.equal(groupProjects([{ project: 'Unique', cwd: '/code/unique' }]).get('path:/code/unique').showPath, false);
});
test('Codex prompt excludes instructions, preserves identity and reads user text', () => {
  const s = parseSession('codex', `${id}.jsonl`, [meta, prompt('# AGENTS.md instructions\nDo stuff'), prompt('Fix the broken login')], stat);
  assert.equal(s.title, 'Fix the broken login'); assert.equal(s.cwd, 'C:/Code/example'); assert.equal(s.messages.length, 1);
  assert.equal(classify(s.title, s.preview), 'fixes');
});
test('Claude extracts text only, title and project, excludes tool output', () => {
  const records = [{ type: 'user', sessionId: id, cwd: '/code/demo', timestamp: '2026-10-01T12:00:00Z', message: { content: [{ type: 'tool_result', content: 'secret tool output' }, { type: 'text', text: 'Create dashboard layout' }] } }, { type: 'custom-title', customTitle: 'Dashboard UX' }];
  const s = parseSession('claude', `${id}.jsonl`, records, stat);
  assert.equal(s.title, 'Dashboard UX'); assert.equal(s.preview, 'Create dashboard layout'); assert.equal(s.project, 'demo');
  assert.equal(s.key, `claude:${id}`);
});
test('Codex previews the latest conversation text and ignores page context before and after it', () => {
  const page = '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>';
  const context = '<codex_apps_open_page_instructions>Internal page context.</codex_apps_open_page_instructions>';
  const s = parseSession('codex', `${id}.jsonl`, [meta, prompt(page), prompt('Fix telemetry map overlay'), answer('Both maps now show recorded paths.'), prompt(page), prompt(context)], stat);
  assert.equal(s.title, 'Fix telemetry map overlay');
  assert.equal(s.preview, 'Both maps now show recorded paths.');
  assert.deepEqual(s.messages.map(m => m.text), ['Fix telemetry map overlay', 'Both maps now show recorded paths.']);
  const followUp = parseSession('codex', `${id}.jsonl`, [meta, prompt('Initial task'), answer('Completed.'), prompt(`${page}\nPlease check the latest chat preview.`)], stat);
  assert.equal(followUp.preview, 'Please check the latest chat preview.');
});
test('Message cleanup preserves conversation markup and removes internal citation blocks', () => {
  const text = 'Use <section>Latest message</section> in the card.';
  const s = parseSession('codex', `${id}.jsonl`, [meta, prompt('Build card'), answer(`${text}\n<oai-mem-citation>Internal references</oai-mem-citation>`)], stat);
  assert.equal(s.preview, text);
  assert.equal(s.messages.at(-1).text, text);
  const empty = parseSession('codex', `${id}.jsonl`, [meta, prompt('<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>')], stat);
  assert.equal(empty.preview, '');
  assert.equal(empty.title, 'Untitled conversation');
});
test('Claude previews the latest assistant or user message rather than the opening prompt', () => {
  const user = { type: 'user', sessionId: id, message: { content: 'Create dashboard layout' } };
  const assistant = { type: 'assistant', sessionId: id, message: { content: [{ type: 'text', text: 'The dashboard layout is ready.' }] } };
  const tool = { type: 'user', sessionId: id, message: { content: [{ type: 'tool_result', content: 'Tool-only output' }] } };
  const s = parseSession('claude', `${id}.jsonl`, [user, assistant, tool], stat);
  assert.equal(s.title, 'Create dashboard layout');
  assert.equal(s.preview, 'The dashboard layout is ready.');
});
test('Subagents and invalid identifiers do not become main conversation cards', () => {
  assert.equal(parseSession('codex', 'x', [{ ...meta, payload: { ...meta.payload, source: { subagent: {} } } }], stat), null);
  assert.equal(parseSession('claude', 'x.jsonl', [{ sessionId: 'x;calc.exe', type: 'user' }], stat), null);
});
test('Completion, notes and manual topic persist across new messages and restarts', () => {
  const s = parseSession('codex', `${id}.jsonl`, [meta, prompt('Add sidebar')], stat);
  const state = reconcile([s], {}); Object.assign(state.cards[s.key], { status: 'Done', topic: 'research', note: 'Shipped', pinned: true, completedAt: 50 });
  const reloaded = JSON.parse(JSON.stringify(state)); reconcile([{ ...s, title: 'Fix deployment', updatedAt: 9999999999999 }], reloaded);
  assert.deepEqual(reloaded.cards[s.key], state.cards[s.key]);
  const result = publicSessions([s], reloaded)[0]; assert.equal(result.status, 'Done'); assert.equal(result.file, undefined); assert.equal(result.messages, undefined);
});
test('Custom topic keywords work and classification stays stable on title updates', () => {
  const state = { topics: [{ id: 'general', keywords: '' }, { id: 'engineer', keywords: 'telemetry engineer' }] };
  const s = { key: 'codex:a', title: 'Improve telemetry', preview: '' }; reconcile([s], state);
  assert.equal(state.cards[s.key].topic, 'engineer'); reconcile([{ ...s, title: 'Other title' }], state); assert.equal(state.cards[s.key].topic, 'engineer');
});
test('Scanner tolerates incomplete lines, updates cached files, applies index titles and reports missing providers', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'sessions'), { recursive: true });
  const file = path.join(dir, 'sessions', `${id}.jsonl`);
  await fs.writeFile(file, [meta, prompt('Initial task')].map(JSON.stringify).join('\n') + '\n{"unfinished":');
  await fs.writeFile(path.join(dir, 'session_index.jsonl'), JSON.stringify({ id, thread_name: 'Human title' }));
  const index = new SessionIndex(), opts = { codexHome: dir, claudeHome: path.join(dir, 'absent') };
  let r = await index.scan(opts); assert.equal(r.sessions.length, 1); assert.equal(r.sessions[0].title, 'Human title'); assert.equal(r.sources[1].state, 'missing');
  await fs.appendFile(file, '\n' + JSON.stringify(prompt('Follow-up')) + '\n');
  r = await index.scan(opts); assert.equal(r.sessions[0].messages.at(-1).text, 'Follow-up');
  assert.equal(r.sessions[0].preview, 'Follow-up');
});
test('Bounded samples retain the start and end without interpreting partial records', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-sample-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'large.jsonl');
  await fs.writeFile(file, JSON.stringify(meta) + '\n' + JSON.stringify(prompt('First')) + '\n' + JSON.stringify({ type: 'tool_result', text: 'x'.repeat(500000) }) + '\n' + JSON.stringify(prompt('Last')) + '\n');
  const r = await sample(file, (await fs.stat(file)).size);
  assert.equal(r[0].type, 'session_meta'); assert.equal(r.at(-1).payload.content[0].text, 'Last');
  const s = parseSession('codex', file, r, await fs.stat(file));
  assert.equal(s.title, 'First'); assert.equal(s.preview, 'Last');
});
test('Codex routes the exact session to sidebar or beside the board', async () => {
  const calls = [];
  const vscode = { extensions: { getExtension: name => name === 'openai.chatgpt' }, commands: { executeCommand: (...args) => calls.push(args) }, Uri: { from: v => v, parse: v => v }, ViewColumn: { Beside: -2 }, env: { uriScheme: 'vscode', openExternal: uri => { calls.push(uri); return true; } } };
  assert.equal(await openNativeSession(vscode, { provider: 'codex', id }), true);
  assert.equal(calls[0], `vscode://openai.chatgpt/local/${id}`);
  await openNativeSession(vscode, { provider: 'codex', id }, true);
  assert.equal(calls[1][1].path, `/local/${id}`); assert.equal(calls[1][3].viewColumn, -2);
});
test('Claude activates extension and requests the exact session in preferred sidebar', async () => {
  const calls = []; let activated = false;
  const vscode = { extensions: { getExtension: name => name === 'anthropic.claude-code' ? { activate: async () => { activated = true; } } : undefined }, commands: { getCommands: async () => ['claude-vscode.editor.open', 'claude-vscode.sidebar.open'], executeCommand: async (...args) => calls.push(args) } };
  assert.equal(await openNativeSession(vscode, { provider: 'claude', id }), true); assert.ok(activated);
  assert.equal(calls[0][0], 'claude-vscode.sidebar.open'); assert.equal(calls[1][1], id); assert.equal(calls[1][6].programmatic, 'honor-preferred-location');
});
test('Missing native extensions use fallback and untrusted session IDs are rejected', async () => {
  const vscode = { extensions: { getExtension: () => undefined } };
  assert.equal(await openNativeSession(vscode, { provider: 'claude', id }), false);
  await assert.rejects(openNativeSession(vscode, { provider: 'codex', id: 'x;calc' }), /Invalid session/);
});
