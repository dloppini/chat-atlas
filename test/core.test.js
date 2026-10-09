'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { classify, parseSession, reconcile, SessionIndex, sample, publicSessions } = require('../src/core');
const { openNativeSession, openNewProjectChat } = require('../src/providers');
const { canonicalProjectPath, originalProjectKey, projectGroupKey, projectCatalog, linkProjectFolder, remapProjectKeys, effectiveSubfolder, groupSubfolders, groupProjects, resolveProjectSelection, orderedProjects, moveProject } = require('../media/projects');
const id = '12345678-1234-1234-1234-123456789abc';
const meta = { type: 'session_meta', payload: { id, cwd: 'C:/Code/example', timestamp: '2026-10-01T12:00:00Z' } };
const prompt = text => ({ type: 'response_item', timestamp: '2026-10-01T12:01:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
const answer = text => ({ ...prompt(text), payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
const toolCall = workdir => ({ type: 'response_item', payload: { type: 'function_call', arguments: JSON.stringify({ workdir }) } });
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
test('Subfolder hints use a clear working directory and preserve parent project grouping', () => {
  const records = [meta, prompt('Fix the model'), toolCall('c:\\CODE\\example\\CarModel'), toolCall('C:/Code/example/CarModel/src'), toolCall('C:/Code/example/CarModel/test'), toolCall('C:/Code/example/DataAccess')];
  const s = parseSession('codex', `${id}.jsonl`, records, stat);
  assert.equal(s.subfolderHint, 'CarModel');
  assert.equal(projectGroupKey(s), 'path:c:/code/example');
  assert.equal(parseSession('codex', `${id}.jsonl`, [meta, toolCall('C:/Code/example/CarModel'), toolCall('C:/Code/example/DataAccess')], stat).subfolderHint, '');
  const folders = { 'path:c:/code/example': ['CarModel', 'DataAccess'] };
  const sessions = [s, { ...s, subfolder: 'DataAccess' }, { ...s, subfolder: '' }];
  assert.equal(effectiveSubfolder(s, folders[projectGroupKey(s)]), 'CarModel');
  assert.equal(effectiveSubfolder(sessions[2], folders[projectGroupKey(s)]), '');
  const grouped = groupSubfolders(sessions, folders).get(projectGroupKey(s));
  assert.deepEqual([...grouped.folders], [['CarModel', 1], ['DataAccess', 1]]);
  assert.equal(grouped.unassigned, 1);
  assert.equal(groupProjects(sessions).get(projectGroupKey(s)).count, 3);
  const state = { topics: [{ id: 'general', name: 'General' }], cards: { [s.key]: { topic: 'general', subfolder: 'DataAccess' } } };
  reconcile([s], state);
  assert.equal(publicSessions([s], state)[0].subfolder, 'DataAccess');
});
test('Manual project placement changes board grouping while retaining the recorded folder', () => {
  const s = parseSession('codex', `${id}.jsonl`, [meta, prompt('Build Chat Atlas')], stat);
  const state = { topics: [{ id: 'general', name: 'General' }], customProjects: [{ id, name: 'Chat Atlas' }], cards: { [s.key]: { topic: 'general', projectOverride: `custom:${id}` } } };
  const placed = publicSessions([s], state)[0];
  assert.equal(placed.project, 'Chat Atlas');
  assert.equal(placed.cwd, 'C:/Code/example');
  assert.equal(originalProjectKey(placed), 'path:c:/code/example');
  assert.equal(projectGroupKey(placed), `custom:${id}`);
  const catalog = projectCatalog([s], state.customProjects);
  const groups = groupProjects([placed], catalog);
  assert.equal(groups.get('path:c:/code/example').count, 0);
  assert.equal(groups.get(`custom:${id}`).count, 1);
  assert.equal(groups.get(`custom:${id}`).name, 'Chat Atlas');
  const other = { ...s, key: 'codex:other', cwd: 'C:/Code/other', project: 'other' };
  state.cards[s.key].projectOverride = 'path:c:/code/other';
  const moved = publicSessions([s, other], state)[0];
  assert.equal(moved.project, 'other');
  assert.equal(moved.cwd, 'C:/Code/example');
  assert.equal(groupProjects([moved, other], projectCatalog([s, other], state.customProjects)).get('path:c:/code/other').count, 2);
  delete state.cards[s.key].projectOverride;
  const automatic = publicSessions([s], state)[0];
  assert.equal(projectGroupKey(automatic), 'path:c:/code/example');
  assert.equal(automatic.project, 'example');
});
test('A folder-backed project collects future chats started in that folder', () => {
  const current = parseSession('codex', `${id}.jsonl`, [meta, prompt('Update Chat Atlas')], stat);
  const folder = 'C:/Code/chat-atlas';
  const future = { ...current, key: 'codex:future', cwd: folder, project: 'chat-atlas' };
  const state = { customProjects: [{ id, name: 'Chat Atlas', cwd: folder }], cards: { [current.key]: { projectOverride: 'path:c:/code/chat-atlas' }, [future.key]: {} } };
  const sessions = publicSessions([current, future], state);
  assert.equal(sessions[0].cwd, 'C:/Code/example');
  assert.equal(sessions[1].project, 'Chat Atlas');
  assert.equal(projectGroupKey(sessions[0]), projectGroupKey(sessions[1]));
  assert.equal(groupProjects(sessions, projectCatalog([current, future], state.customProjects)).get('path:c:/code/chat-atlas').count, 2);
});

test('Linking a folder preserves project metadata and placements, including cards outside the scan', () => {
  const current = parseSession('codex', `${id}.jsonl`, [meta, prompt('Build Chat Atlas')], stat);
  const previousKey = `custom:${id}`, cwd = 'C:/Code/Chat Atlas';
  const state = { customProjects: [{ id, name: 'Chat Atlas' }], cards: {
    [current.key]: { projectOverride: previousKey, note: 'Keep this', topic: 'features', status: 'Done', pinned: true },
    unscanned: { projectOverride: previousKey, subfolder: 'Old folder', note: 'Still assigned' },
    unrelated: { projectOverride: 'path:/elsewhere', subfolder: 'Keep folder' }
  } };
  const key = linkProjectFolder(state, previousKey, cwd);
  const restored = JSON.parse(JSON.stringify(state));
  const future = { ...current, key: 'codex:future', cwd: 'c:/code/chat atlas/', project: 'chat atlas' };
  const sessions = publicSessions([current, future], restored);
  assert.equal(key, 'path:c:/code/chat atlas');
  assert.equal(sessions[0].cwd, 'C:/Code/example');
  assert.equal(sessions[0].note, 'Keep this');
  assert.equal(sessions[0].status, 'Done');
  assert.equal(sessions[0].pinned, true);
  assert.equal(projectGroupKey(sessions[0]), key);
  assert.equal(sessions[1].project, 'Chat Atlas');
  assert.equal(restored.cards.unscanned.projectOverride, key);
  assert.equal(restored.cards.unscanned.subfolder, undefined);
  assert.equal(restored.cards.unrelated.subfolder, 'Keep folder');
  const groups = groupProjects(sessions, projectCatalog([current, future], restored.customProjects));
  assert.equal(groups.get(key).count, 2);
  assert.deepEqual([...groups.get(key).folders.values()], ['c:/code/chat atlas/']);
  assert.equal(groups.has(previousKey), false);
  assert.deepEqual(remapProjectKeys(['path:/other', previousKey, key], previousKey, key), ['path:/other', key]);
  assert.deepEqual(remapProjectKeys([previousKey], previousKey, key), [key]);
});

test('Linking rejects missing projects, empty folders and another custom project with the same folder', () => {
  const state = { customProjects: [{ id, name: 'Unlinked' }, { id: 'linked', name: 'Linked', cwd: 'C:/Code/Example' }], cards: {} };
  const snapshot = structuredClone(state);
  assert.throws(() => linkProjectFolder(state, 'custom:missing', '/code/new'), /without a linked folder/);
  assert.throws(() => linkProjectFolder(state, `custom:${id}`, ''), /existing folder/);
  assert.throws(() => linkProjectFolder(state, `custom:${id}`, 'c:\\CODE\\example\\'), /already linked/);
  assert.throws(() => linkProjectFolder(state, 'custom:linked', '/code/new'), /without a linked folder/);
  assert.deepEqual(state, snapshot);
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
test('Running indicator follows Codex task markers and expires stale activity', () => {
  const event = type => ({ type: 'event_msg', payload: { type } });
  const started = parseSession('codex', `${id}.jsonl`, [meta, prompt('Build board'), event('task_started')], stat);
  const state = reconcile([started], {});
  assert.equal(publicSessions([started], state, stat.mtimeMs + 30000)[0].running, true);
  assert.equal(publicSessions([started], state, stat.mtimeMs + 11 * 60000)[0].running, true);
  assert.equal(publicSessions([started], state, stat.mtimeMs + 61 * 60000)[0].running, false);
  const completed = parseSession('codex', `${id}.jsonl`, [meta, event('task_started'), event('task_complete'), event('thread_settings_applied')], stat);
  assert.equal(publicSessions([completed], state, stat.mtimeMs + 1000)[0].running, false);
  const aborted = parseSession('codex', `${id}.jsonl`, [meta, event('task_started'), event('turn_aborted')], stat);
  assert.equal(publicSessions([aborted], state, stat.mtimeMs + 1000)[0].running, false);
});
test('Running indicator treats recent unfinished Claude turns conservatively', () => {
  const user = { type: 'user', sessionId: id, cwd: '/code/demo', message: { content: [{ type: 'text', text: 'Build the dashboard' }] } };
  const toolResult = { ...user, sourceToolAssistantUUID: 'tool-1', message: { content: [{ type: 'tool_result', content: 'done' }] } };
  const assistant = stop_reason => ({ type: 'assistant', sessionId: id, message: { content: [{ type: 'text', text: 'Working' }], stop_reason } });
  const started = parseSession('claude', `${id}.jsonl`, [user], stat);
  const state = reconcile([started], {});
  assert.equal(publicSessions([started], state, stat.mtimeMs + 30000)[0].running, true);
  assert.equal(publicSessions([started], state, stat.mtimeMs + 3 * 60000)[0].running, true);
  assert.equal(publicSessions([started], state, stat.mtimeMs + 61 * 60000)[0].running, false);
  const working = parseSession('claude', `${id}.jsonl`, [user, assistant('tool_use'), toolResult], stat);
  assert.equal(publicSessions([working], state, stat.mtimeMs + 30000)[0].running, true);
  const finished = parseSession('claude', `${id}.jsonl`, [user, assistant('end_turn'), toolResult], stat);
  assert.equal(publicSessions([finished], state, stat.mtimeMs + 30000)[0].running, false);
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
test('Missing native extensions return false and untrusted session IDs are rejected', async () => {
  const vscode = { extensions: { getExtension: () => undefined } };
  assert.equal(await openNativeSession(vscode, { provider: 'claude', id }), false);
  await assert.rejects(openNativeSession(vscode, { provider: 'codex', id: 'x;calc' }), /Invalid session/);
});
function newChatFixture(cwd = 'C:/Code/chat-atlas') {
  const calls = [], storage = new Map();
  const context = { globalState: { get: (key, fallback) => storage.get(key) ?? fallback, update: async (key, value) => { storage.set(key, value); } } };
  const vscode = {
    workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: cwd } }] },
    extensions: { getExtension: () => ({ activate: async () => {} }) },
    commands: {
      getCommands: async () => ['chatgpt.openSidebar', 'chatgpt.newChat', 'claude-vscode.editor.open'],
      executeCommand: async (...args) => calls.push(args)
    },
    Uri: { file: fsPath => ({ scheme: 'file', fsPath }) },
    window: { createTerminal: () => assert.fail('New chats must use the provider UI') }
  };
  return { vscode, context, calls, storage };
}
test('New Codex and Claude chats use their native UIs in the current project', async () => {
  const { vscode, context, calls, storage } = newChatFixture();
  await openNewProjectChat(vscode, 'codex', 'c:\\code\\chat-atlas\\', 'Chat Atlas', context);
  assert.deepEqual(calls, [['chatgpt.openSidebar'], ['chatgpt.newChat']]);
  calls.length = 0;
  await openNewProjectChat(vscode, 'claude', 'C:/Code/chat-atlas', 'Chat Atlas', context);
  assert.deepEqual(calls, [['claude-vscode.editor.open']]);
  assert.equal(storage.size, 0);
  await assert.rejects(openNewProjectChat(vscode, 'invalid', 'C:/Code/chat-atlas', 'Chat Atlas', context), /Invalid new-chat target/);
});
test('Missing provider extensions or UI commands fail without a terminal fallback', async () => {
  const { vscode, context, calls } = newChatFixture();
  vscode.extensions.getExtension = () => undefined;
  await assert.rejects(openNewProjectChat(vscode, 'codex', 'C:/Code/chat-atlas', 'Chat Atlas', context), /Install the Codex VS Code extension/);
  vscode.extensions.getExtension = () => ({ activate: async () => {} });
  vscode.commands.getCommands = async () => [];
  await assert.rejects(openNewProjectChat(vscode, 'claude', 'C:/Code/chat-atlas', 'Chat Atlas', context), /new-chat UI is unavailable/);
  assert.deepEqual(calls, []);
});
test('A different project opens both provider UIs in the current window', async () => {
  const { vscode, context, calls, storage } = newChatFixture();
  const originalFolders = structuredClone(vscode.workspace.workspaceFolders);
  await openNewProjectChat(vscode, 'codex', 'C:/Code/other', 'Other', context);
  assert.deepEqual(calls, [['chatgpt.openSidebar'], ['chatgpt.newChat']]);
  calls.length = 0;
  await openNewProjectChat(vscode, 'claude', 'C:/Code/other', 'Other', context);
  assert.deepEqual(calls, [['claude-vscode.editor.open']]);
  assert.deepEqual(vscode.workspace.workspaceFolders, originalFolders);
  assert.equal(storage.size, 0);
});
test('Provider UI launch failures propagate without opening a project window', async () => {
  const { vscode, context, storage } = newChatFixture();
  vscode.commands.executeCommand = async () => { throw new Error('Chat launch failed'); };
  await assert.rejects(openNewProjectChat(vscode, 'codex', 'C:/Code/other', 'Other', context), /Chat launch failed/);
  assert.equal(storage.size, 0);
});
test('A window without a workspace still opens the selected provider UI there', async () => {
  const { vscode, context, calls, storage } = newChatFixture();
  vscode.workspace.workspaceFolders = undefined;
  await openNewProjectChat(vscode, 'codex', 'C:/Code/other', 'Other', context);
  assert.deepEqual(calls, [['chatgpt.openSidebar'], ['chatgpt.newChat']]);
  calls.length = 0;
  await openNewProjectChat(vscode, 'claude', 'C:/Code/other', 'Other', context);
  assert.deepEqual(calls, [['claude-vscode.editor.open']]);
  assert.equal(storage.size, 0);
});
