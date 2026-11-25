'use strict';
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');
const path = require('node:path');
const { originalProjectKey, projectCatalog } = require('../media/projects');

const DEFAULT_TOPICS = [
  { id: 'interface', name: 'Interface & UX', color: '#a69cf6', keywords: 'ui ux layout sidebar dropdown mobile responsive design styling button chart' },
  { id: 'fixes', name: 'Bugs & fixes', color: '#f2ad79', keywords: 'bug fix broken error crash regression failing failure repair' },
  { id: 'features', name: 'Features', color: '#7abfea', keywords: 'feature implement add build create integration support' },
  { id: 'research', name: 'Research & planning', color: '#d6ba73', keywords: 'research investigate compare explore plan architecture explain analysis review audit' },
  { id: 'release', name: 'Release & operations', color: '#72cbb4', keywords: 'deploy release changelog commit push publish version hosting' },
  { id: 'general', name: 'General', color: '#a2abbc', keywords: '' }
];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DEFAULT_RUNNING_TIMEOUT_MS = 60 * 60 * 1000;
function parseLines(text) {
  return text.split(/\r?\n/).flatMap(line => {
    try { const record = JSON.parse(line); return record && typeof record === 'object' && !Array.isArray(record) ? [record] : []; }
    catch { return []; }
  });
}
function textOf(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(b => ['text', 'input_text', 'output_text'].includes(b.type)).map(b => b.text || '').join('\n') : '';
}
function cleanMessage(text) {
  return text.replace(/<(environment_context|permissions instructions|recommended_plugins|system-reminder|ide_opened_file|ide_selection|external_codex_apps_open_page|external_codex_apps_selected_page(?:_part_\d+_of_\d+)?|codex_apps_open_page_instructions|codex_apps_client_time_context|oai-mem-citation)[\s\S]*?<\/\1>/gi, '').trim();
}
function isHumanPrompt(text) {
  return text && !/^(# AGENTS\.md|<INSTRUCTIONS>|<environment_context>|<permissions instructions>|<system-reminder>|\[Request interrupted)/i.test(text.trim());
}
function conversationTitle(text) {
  if (typeof text !== 'string' || /^\s*<skill>/i.test(text)) return '';
  text = cleanMessage(text);
  if (/^(?:<external_codex_apps_(?:selected_page|open_page)|Companion Page snapshot part \d+ of \d+:)/i.test(text)) return '';
  const title = text.replace(/^Atlas handoff from (?:codex|claude):[a-f0-9-]{36}\s*/i, '').replace(/\[\$[^\]]+\]\((?:[^()]|\([^)]*\))*\)/g, '')
    .replace(/^\s*(?:\$[a-z_][\w:-]*(?:\s+|$))+/i, '').replace(/\s+/g, ' ').trim();
  return /^(?:untitled(?: conversation| chat)?|new chat)$/i.test(title) ? '' : title;
}
function turnActivity(provider, records, lastWriteAt, previous = {}) {
  let active = previous.activeTurnSignal ?? null, terminal = previous.activeTurnClosed === true, activityAt = previous.activeTurnAt || 0;
  let activeFiles = previous.activeFiles || [];
  const signal = (value, record, force = false) => {
    if (value && terminal && !force) return;
    if (!value || force) activeFiles = [];
    active = value; terminal = !value;
    activityAt = Math.min(dateMs(record.timestamp, lastWriteAt), lastWriteAt, Date.now());
  };
  for (const record of records) {
    // Activity in the head belongs to an older turn when the middle is omitted.
    if (record.type === 'atlas_sample_gap') { activeFiles = []; active = null; terminal = false; activityAt = 0; continue; }
    const payload = record.payload;
    if (provider === 'codex') {
      if (record.type === 'event_msg') {
        const kind = payload?.type;
        if (kind === 'task_started') signal(true, record, true);
        else if (['task_complete', 'task_completed', 'turn_aborted', 'task_aborted'].includes(kind)) signal(false, record);
        else if (kind === 'user_message' && isHumanPrompt(cleanMessage(textOf(payload.message)))) signal(true, record, true);
        else if (['agent_reasoning', 'exec_command_begin', 'exec_command_end', 'patch_apply_begin', 'patch_apply_end', 'mcp_tool_call_begin', 'mcp_tool_call_end', 'web_search_begin', 'web_search_end'].includes(kind)) signal(true, record);
      }
      if (active && record.type === 'event_msg' && ['exec_command_begin', 'exec_command_end'].includes(payload?.type)) {
        activeFiles = (Array.isArray(payload.parsed_cmd) ? payload.parsed_cmd : [])
          .filter(cmd => cmd?.type === 'read' && typeof cmd.path === 'string')
          .map(cmd => payload.cwd && path.isAbsolute(payload.cwd) ? path.resolve(payload.cwd, cmd.path) : cmd.path);
      }
      if (active && record.type === 'event_msg' && ['patch_apply_begin', 'patch_apply_end'].includes(payload?.type)) {
        activeFiles = Object.keys(payload.changes || {});
      }
      if (record.type === 'response_item') {
        if (payload?.type === 'message' && payload.role === 'user' && isHumanPrompt(cleanMessage(textOf(payload.content)))) signal(true, record, true);
        if (payload?.type === 'message' && payload.role === 'assistant') {
          const phase = payload.phase || payload.channel;
          if (phase === 'final_answer' || phase === 'final' || !phase) {
            signal(false, record);
            // Older transcripts omit phases even for intermediate assistant messages.
            if (!phase) terminal = false;
          }
          else if (phase === 'commentary' || phase === 'analysis') signal(true, record);
        }
        if (['reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(payload?.type)) signal(true, record);
        if (active && ['function_call', 'custom_tool_call'].includes(payload?.type)) {
          activeFiles = [];
          if (payload.name === 'apply_patch' && typeof payload.input === 'string') {
            activeFiles = Array.from(payload.input.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm), match => match[1].trim());
          }
        }
      }
    }
    if (provider === 'claude') {
      const content = record.message?.content;
      if (record.type === 'user' && !record.isMeta) {
        const prompt = cleanMessage(textOf(content));
        const toolResult = record.sourceToolAssistantUUID || (Array.isArray(content) && content.some(block => block.type === 'tool_result'));
        if (toolResult) signal(true, record);
        else if (/^\[Request interrupted/i.test(prompt)) signal(false, record);
        else if (isHumanPrompt(prompt)) signal(true, record, true);
      }
      if (record.type === 'assistant') {
        const stop = record.message?.stop_reason;
        if (['end_turn', 'stop_sequence', 'max_tokens', 'refusal'].includes(stop)) signal(false, record);
        else if (stop === 'tool_use' || (Array.isArray(content) && content.some(block => ['thinking', 'tool_use'].includes(block.type)))) signal(true, record);
      }
      if (active && record.type === 'assistant' && Array.isArray(content)) {
        const calls = content.filter(block => block.type === 'tool_use');
        if (calls.length) activeFiles = calls.flatMap(call => typeof call.input?.file_path === 'string' ? [call.input.file_path] : []);
      }
      if (record.type === 'system' && record.subtype === 'turn_duration') signal(false, record);
    }
  }
  return { activeFiles, activeTurnSignal: active, activeTurnAt: activityAt, activeTurnClosed: terminal };
}
function dateMs(value, fallback = 0) { const n = Date.parse(value); return Number.isFinite(n) ? n : fallback; }
function projectName(cwd) { return cwd ? cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : 'Other conversations'; }
function claudeProjectPrompt(cwd) {
  return `Work in ${cwd}.\nRead the project instructions there and use that folder for files, commands, and tests.\n\n`;
}
function subfolderHint(records, cwd) {
  if (!cwd) return '';
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const windows = /^[a-z]:\//i.test(root) || root.startsWith('//');
  const counts = new Map();
  for (const record of records) {
    const payload = record.type === 'response_item' ? record.payload : null;
    if (payload?.type !== 'function_call') continue;
    let args;
    try { args = typeof payload.arguments === 'string' ? JSON.parse(payload.arguments) : payload.arguments; } catch { continue; }
    const workdir = args?.workdir || args?.cwd;
    if (typeof workdir !== 'string') continue;
    const folder = workdir.replace(/\\/g, '/');
    const prefix = `${root}/`;
    if (windows ? !folder.toLowerCase().startsWith(prefix.toLowerCase()) : !folder.startsWith(prefix)) continue;
    const name = folder.slice(prefix.length).split('/')[0];
    if (!name || name.startsWith('.') || name === '..') continue;
    const key = windows ? name.toLowerCase() : name;
    const entry = counts.get(key) || { name, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
  return ranked.length === 1 || (ranked[0] && ranked[0].count >= 3 * ranked[1].count) ? ranked[0].name : '';
}
function classify(title, preview, topics = DEFAULT_TOPICS) {
  const words = value => new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const main = words(title), extra = words(preview.slice(0, 600));
  let best = 'general', score = 0;
  for (const topic of topics) {
    const keys = words(topic.keywords || '');
    const candidate = [...keys].reduce((n, word) => n + (main.has(word) ? 5 : extra.has(word) ? 1 : 0), 0);
    if (candidate > score) { best = topic.id; score = candidate; }
  }
  return best;
}
function conversationText(provider, r) {
  if (!r || typeof r !== 'object') return null;
  const p = r.payload;
  let role, content;
  if (provider === 'codex' && r.type === 'response_item' && p?.type === 'message') { role = p.role; content = textOf(p.content); }
  if (provider === 'claude' && ['user', 'assistant'].includes(r.type)) { role = r.type; content = textOf(r.message?.content); }
  if (!['user', 'assistant'].includes(role)) return null;
  content = cleanMessage(content);
  if (!content || (role === 'user' && !isHumanPrompt(content))) return null;
  return { role, text: content, timestamp: r.timestamp || '' };
}
function searchableMessage(provider, record) {
  const message = conversationText(provider, record);
  if (message) return message;
  const event = record?.payload;
  if (provider !== 'codex' || record.type !== 'event_msg' || !['user_message', 'agent_message'].includes(event?.type)) return null;
  const role = event.type === 'user_message' ? 'user' : 'assistant';
  const text = cleanMessage(textOf(event.message));
  return text && (role !== 'user' || isHumanPrompt(text)) ? { role, text } : null;
}
async function* transcriptRecords(file) {
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record && typeof record === 'object') yield record;
    }
  } finally { lines.close(); input.destroy(); }
}
function pathKey(file) {
  return process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file);
}
function indexRecord(index, provider, record) {
  const message = searchableMessage(provider, record);
  if (message) index.parts.add(message.text.toLowerCase());
  const p = record.payload;
  if (record.type === 'turn_context' && typeof p?.cwd === 'string') index.cwd = p.cwd;
  const root = p?.cwd || record.cwd || index.cwd;
  function add(file, kind, evidence) {
    if (typeof file !== 'string' || (!path.isAbsolute(file) && !(typeof root === 'string' && path.isAbsolute(root)))) return;
    const key = pathKey(path.isAbsolute(file) ? file : path.resolve(root, file));
    const previous = index.files.get(key);
    if (previous?.kind !== 'Edited' || kind === 'Edited') index.files.set(key, { kind, evidence:String(evidence).slice(0,240) });
  }
  if (provider === 'claude' && record.type === 'assistant' && Array.isArray(record.message?.content)) {
    for (const block of record.message.content) {
      if (block?.type !== 'tool_use') continue;
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read'].includes(block.name))
        add(block.input?.file_path || block.input?.notebook_path, block.name === 'Read' ? 'Read' : 'Edited', block.input?.new_string || block.input?.content || block.name);
    }
  }
  if (provider !== 'codex') return;
  if (record.type === 'event_msg' && p?.type === 'patch_apply_end' && p.success !== false) {
    for (const [file, change] of Object.entries(p.changes || {})) {
      const excerpt = typeof change?.unified_diff === 'string' && /^\+(?!\+\+).*$/m.exec(change.unified_diff)?.[0];
      add(file, 'Edited', excerpt || 'Patch'); add(change?.move_path, 'Edited', 'Patch move');
    }
  }
  if (record.type === 'event_msg' && p?.type === 'exec_command_end' && !p.exit_code) {
    for (const cmd of Array.isArray(p.parsed_cmd) ? p.parsed_cmd : []) if (cmd?.type === 'read') add(cmd.path, 'Read', cmd.cmd || 'Read');
  }
  if (record.type === 'response_item' && p?.name === 'apply_patch' && typeof p.input === 'string') {
    for (const match of p.input.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) add(match[1].trim(), 'Edited', 'Patch requested');
  }
}
async function fileMatch(session, target, currentFolder = session.cwd, token) {
  const relative = currentFolder && path.relative(currentFolder, target);
  const inside = relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
  const original = inside && session.cwd ? path.resolve(session.cwd, relative) : target;
  const recorded = session.fileEvidence?.get(pathKey(original));
  if (recorded) return { ...recorded, evidence: recorded.evidence + ' · ' + (inside ? relative : target) };
  const candidates = (inside ? [original, './' + relative, relative] : [target]).map(name => name.replaceAll('\\', '/'));
  if (!(session.searchText || '').includes(path.basename(target).toLowerCase())) return null;
  for await (const record of transcriptRecords(session.file)) {
    if (token?.isCancellationRequested) return null;
    const text = searchableMessage(session.provider, record)?.text;
    if (!text) continue;
    const content = text.replaceAll('\\', '/');
    const haystack = process.platform === 'win32' ? content.toLowerCase() : content;
    for (const name of candidates) {
      const needle = process.platform === 'win32' ? name.toLowerCase() : name;
      let start = 0;
      while ((start = haystack.indexOf(needle, start)) !== -1) {
        const end = start + needle.length;
        if (!/[\w./\\:-]/.test(content[start - 1] || '') && !/^(?:[\w/\\-]|\.\w)/.test(content.slice(end,end+2)))
          return { kind:'Mentioned', evidence:text.slice(Math.max(0,start-45),end+65).replace(/\s+/g,' ').trim() };
        start = end;
      }
    }
  }
  return null;
}
async function passages(session, query, targetLine) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = [];
  let previous, line = 0, found;
  for await (const record of transcriptRecords(session.file)) {
    line++;
    const message = searchableMessage(session.provider, record);
    if (!message || (message.text === previous?.text && message.role === previous.role)) continue;
    if (found) { found.after = message; break; }
    if (targetLine === line) found = { before:previous, message };
    if (targetLine === undefined && words.length) {
      const lower = message.text.toLowerCase();
      if (words.every(word => lower.includes(word))) {
        const offset = lower.indexOf(words[0]);
        matches.push({ line, label:message.text.slice(Math.max(0,offset-45),offset+155).replace(/\s+/g,' '), description:message.role });
      }
    }
    previous = message;
  }
  return targetLine === undefined ? matches : found;
}
function parseSession(provider, file, records, stat, titleEntry) {
  const meta = records.find(r => r.type === 'session_meta')?.payload;
  if (provider === 'codex' && (meta?.source?.subagent || meta?.thread_source?.subagent)) return null;
  if (provider === 'claude' && records.some(r => r.isSidechain === true)) return null;
  const id = provider === 'codex' ? meta?.id || meta?.session_id || path.basename(file).match(/([a-f0-9-]{36})\.jsonl$/i)?.[1] : records.find(r => r.sessionId)?.sessionId || path.basename(file, '.jsonl');
  if (!UUID.test(id || '')) return null;
  const cwd = meta?.cwd || records.find(r => typeof r.cwd === 'string')?.cwd || '';
  const messages = [];
  const history = { parts:new Set(), files:new Map(), cwd };
  for (const r of records) {
    const message = conversationText(provider, r);
    indexRecord(history, provider, r);
    if (!message) continue;
    const { role, text: content } = message;
    if (messages.at(-1)?.text === content) continue;
    messages.push({ role, text: content.slice(0, 12000), timestamp: r.timestamp || '' });
  }
  const userMessages = messages.filter(m => m.role === 'user');
  const opening = userMessages[0]?.text.replace(/\r\n/g, '\n') || '';
  const folder = provider === 'claude' && /^Work in ([^\n]+)\.\n/.exec(opening)?.[1];
  const starter = folder && claudeProjectPrompt(folder).trimEnd();
  const projectDraft = starter && opening.startsWith(starter);
  const task = projectDraft ? opening.slice(starter.length).trimStart() : opening;
  const handoffFrom = /^Atlas handoff from ((?:codex|claude):[a-f0-9-]{36})(?:\n|$)/i.exec(task)?.[1];
  const first = userMessages.map((m, i) => conversationTitle(i === 0 && projectDraft ? opening.slice(starter.length) : m.text)).find(Boolean) || '';
  const customTitle = [...records].reverse().find(r => r.type === 'custom-title')?.customTitle;
  const summary = [...records].reverse().find(r => r.type === 'summary')?.summary;
  const title = conversationTitle(titleEntry?.thread_name) || conversationTitle(customTitle) || conversationTitle(summary) || first.slice(0, 100) || 'Untitled conversation';
  const createdAt = dateMs(meta?.timestamp || records.find(r => r.timestamp)?.timestamp, stat.birthtimeMs || stat.mtimeMs);
  return { key: `${provider}:${id}`, id, provider, title, cwd, ...(handoffFrom && UUID.test(handoffFrom.split(':')[1]) ? { handoffFrom } : {}), project: projectName(cwd), ...(projectDraft ? { starterProjectKey: originalProjectKey({ cwd: folder }) } : {}), subfolderHint: subfolderHint(records, cwd), ...turnActivity(provider, records, stat.mtimeMs), lastWriteAt: stat.mtimeMs, createdAt,
    updatedAt: Math.max(stat.mtimeMs, dateMs(titleEntry?.updated_at)), preview: (messages.at(-1)?.text || '').slice(0, 700),
    fileEvidence: history.files, searchText: [...history.parts].join('\n'), messages: messages.slice(-12), file, sampled: stat.size > 384 * 1024 };
}
async function sample(file, size) {
  const handle = await fs.open(file, 'r');
  try {
    const headSize = Math.min(size, 256 * 1024), tailStart = Math.max(headSize, size - 128 * 1024);
    const head = Buffer.alloc(headSize); await handle.read(head, 0, headSize, 0);
    if (headSize === size) return parseLines(head.toString());
    const tail = Buffer.alloc(size - tailStart); await handle.read(tail, 0, tail.length, tailStart);
    const h = head.toString(), t = tail.toString();
    if (tailStart === headSize) return parseLines(Buffer.concat([head, tail]).toString());
    const headRecords = parseLines(h.slice(0, h.lastIndexOf('\n')));
    const tailRecords = parseLines(t.slice(t.indexOf('\n') + 1));
    return [...headRecords, { type: 'atlas_sample_gap' }, ...tailRecords];
  } finally { await handle.close(); }
}
async function appendedActivity(file, offset, stat, previous) {
  const handle = await fs.open(file, 'r');
  try {
    // Capture a new turn's start even when one large tool record pushes it out of the tail.
    const start = Math.max(0, offset - 1), buffer = Buffer.alloc(Math.min(stat.size - start, 64 * 1024));
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString();
    const newline = text.indexOf('\n');
    const records = parseLines(offset ? newline < 0 ? '' : text.slice(newline + 1) : text);
    return turnActivity(previous.provider, records, stat.mtimeMs, previous);
  } finally { await handle.close(); }
}
async function walk(folder, depth = 0) {
  if (depth > 5) return [];
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === 'subagents') continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file, depth + 1));
    else if (entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent-')) files.push(file);
  }
  return files;
}
class SessionIndex {
  cache = new Map();
  async readSession(provider, file, stat) {
    let cached = this.cache.get(file);
    if (!cached || cached.mtime !== stat.mtimeMs || cached.size !== stat.size) {
      const session = parseSession(provider, file, await sample(file, stat.size), stat);
      if (session?.sampled) {
        const history = { parts:new Set(), files:new Map(), cwd:session.cwd };
        for await (const record of transcriptRecords(file)) indexRecord(history, provider, record);
        session.searchText = [...history.parts].join('\n');
        session.fileEvidence = history.files;
      }
      const evidenceAt = session?.activeTurnAt || 0;
      const missingEvidence = session?.activeTurnSignal === null;
      // A partial append or an oversized record can leave no complete activity evidence.
      // Retain the previous observation until a complete record supersedes it or it expires.
      if (session && session.activeTurnSignal === null && cached?.session?.id === session.id) {
        const previous = cached.session;
        const activity = stat.size > cached.size ? await appendedActivity(file, cached.size, stat, previous) : previous;
        session.activeFiles = activity.activeFiles;
        session.activeTurnSignal = activity.activeTurnSignal;
        session.activeTurnClosed = activity.activeTurnClosed;
        session.activeTurnAt = activity.activeTurnAt;
      }
      if (session?.activeTurnSignal === true && cached?.session?.id === session.id) {
        const grew = stat.size > cached.size;
        const newActivity = missingEvidence || evidenceAt > (cached.evidenceAt || 0) || cached.session.activeTurnSignal !== true;
        // Observe new work on this host's clock: provider timestamps can be skewed.
        if (grew && newActivity) session.activeTurnAt = Date.now();
        else if (evidenceAt === cached.evidenceAt && cached.session.activeTurnSignal === true) session.activeTurnAt = cached.session.activeTurnAt;
      }
      cached = { mtime: stat.mtimeMs, size: stat.size, session, evidenceAt };
      this.cache.set(file, cached);
    }
    return cached.session;
  }
  async refreshActivity(sessions) {
    const refreshed = [];
    for (let start = 0; start < sessions.length; start += 32) {
      refreshed.push(...await Promise.all(sessions.slice(start, start + 32).map(async session => {
        try {
          const stat = await fs.stat(session.file);
          const latest = await this.readSession(session.provider, session.file, stat);
          if (latest?.id === session.id) return { ...session, activeFiles: latest.activeFiles, activeTurnSignal: latest.activeTurnSignal, activeTurnAt: latest.activeTurnAt, activeTurnClosed: latest.activeTurnClosed, lastWriteAt: latest.lastWriteAt };
        } catch { /* Keep the prior observation during rotation or a partial write. */ }
        return session;
      })));
    }
    return refreshed;
  }
  async scan({ codexHome, claudeHome, maxSessions = 1000 }) {
    const sessions = [], sources = [], errors = [];
    for (const [provider, home, suffix] of [['codex', codexHome, 'sessions'], ['claude', claudeHome, 'projects']]) {
      const folder = path.join(home, suffix);
      try {
        const titles = new Map();
        if (provider === 'codex') {
          try { for (const r of parseLines(await fs.readFile(path.join(home, 'session_index.jsonl'), 'utf8'))) titles.set(r.id, r); }
          catch (e) { if (e.code !== 'ENOENT') errors.push('Codex titles could not be read. Conversation previews are used.'); }
        }
        const files = await walk(folder), stats = [];
        for (let start = 0; start < files.length; start += 32) {
          await Promise.all(files.slice(start, start + 32).map(async file => { try { stats.push({ file, stat: await fs.stat(file) }); } catch { /* Rotating logs can disappear. */ } }));
        }
        stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
        const selected = stats.slice(0, maxSessions); let count = 0, failed = 0;
        for (let start = 0; start < selected.length; start += 12) {
          await Promise.all(selected.slice(start, start + 12).map(async ({ file, stat }) => {
            try {
              const session = await this.readSession(provider, file, stat);
              if (session) {
                const s = { ...session }, title = titles.get(s.id);
                s.title = conversationTitle(title?.thread_name) || s.title;
                if (title?.updated_at) s.updatedAt = Math.max(s.updatedAt, dateMs(title.updated_at));
                sessions.push(s); count++;
              }
            } catch { failed++; }
          }));
        }
        sources.push({ provider, state: 'ready', count, total: stats.length, limited: stats.length > maxSessions });
        if (failed) errors.push(`${provider}: ${failed} conversation files could not be read.`);
      } catch (e) {
        sources.push({ provider, state: e.code === 'ENOENT' ? 'missing' : 'error', count: 0 });
        if (e.code !== 'ENOENT') errors.push(`${provider}: cannot read conversation folder (${e.code || 'unknown error'}).`);
      }
    }
    const unique = new Map();
    for (const session of sessions) if (!unique.has(session.key) || unique.get(session.key).updatedAt < session.updatedAt) unique.set(session.key, session);
    return { sessions: [...unique.values()], sources, errors };
  }
}
function reconcile(sessions, state) {
  state.topics ||= structuredClone(DEFAULT_TOPICS); state.cards ||= {}; state.customProjects ||= [];
  const topicIds = new Set(state.topics.map(t => t.id));
  const knownProjects = new Set(projectCatalog(sessions, state.customProjects).map(p => p.key));
  for (const s of sessions) {
    const old = state.cards[s.key];
    if (!old) state.cards[s.key] = { topic: classify(s.title, s.preview, state.topics), status: 'Inbox', pinned: false, note: '', seenAt: 0 };
    else if (!topicIds.has(old.topic)) old.topic = 'general';
    const card = state.cards[s.key];
    if (s.handoffFrom && s.handoffFrom !== s.key) card.handoffFrom = s.handoffFrom;
    if (s.starterProjectKey && !card.starterFiled && knownProjects.has(s.starterProjectKey)) {
      if (!card.projectOverride && s.starterProjectKey !== originalProjectKey(s)) card.projectOverride = s.starterProjectKey;
      card.starterFiled = true;
    }
  }
  return state;
}
function publicSessions(sessions, state, now = Date.now(), runningTimeoutMs = DEFAULT_RUNNING_TIMEOUT_MS) {
  const projects = new Map(projectCatalog(sessions, state.customProjects || [], state.projectNames).map(p => [p.key, p]));
  return sessions.map(({ file, fileEvidence, messages, activeTurnSignal, activeTurnAt, activeTurnClosed, lastWriteAt, ...s }) => {
    const { projectOverride, ...card } = state.cards[s.key] || {};
    const target = projects.get(projectOverride);
    const automatic = projects.get(originalProjectKey(s));
    const age = Math.max(0, now - (activeTurnAt || lastWriteAt));
    const running = activeTurnSignal === true && age <= runningTimeoutMs;
    return { ...s, ...card, running, title: card.title || s.title, project: target?.name || automatic?.name || s.project, ...(target ? { projectOverride } : {}) };
  });
}
module.exports = { passages, fileMatch, DEFAULT_TOPICS, DEFAULT_RUNNING_TIMEOUT_MS, UUID, claudeProjectPrompt, parseLines, parseSession, sample, classify, reconcile, publicSessions, SessionIndex };
