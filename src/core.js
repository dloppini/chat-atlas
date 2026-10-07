'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_TOPICS = [
  { id: 'interface', name: 'Interface & UX', color: '#a69cf6', keywords: 'ui ux layout sidebar dropdown mobile responsive design styling button chart' },
  { id: 'fixes', name: 'Bugs & fixes', color: '#f2ad79', keywords: 'bug fix broken error crash regression failing failure repair' },
  { id: 'features', name: 'Features', color: '#7abfea', keywords: 'feature implement add build create integration support' },
  { id: 'research', name: 'Research & planning', color: '#d6ba73', keywords: 'research investigate compare explore plan architecture explain analysis review audit' },
  { id: 'release', name: 'Release & operations', color: '#72cbb4', keywords: 'deploy release changelog commit push publish version hosting' },
  { id: 'general', name: 'General', color: '#a2abbc', keywords: '' }
];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function parseLines(text) {
  return text.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}
function textOf(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(b => ['text', 'input_text', 'output_text'].includes(b.type)).map(b => b.text || '').join('\n') : '';
}
function cleanMessage(text) {
  return text.replace(/<(environment_context|permissions instructions|recommended_plugins|system-reminder|ide_opened_file|ide_selection|external_codex_apps_open_page|codex_apps_open_page_instructions|codex_apps_client_time_context|oai-mem-citation)[\s\S]*?<\/\1>/gi, '').trim();
}
function isHumanPrompt(text) {
  return text && !/^(# AGENTS\.md|<INSTRUCTIONS>|<environment_context>|<permissions instructions>|<system-reminder>|\[Request interrupted)/i.test(text.trim());
}
function dateMs(value, fallback = 0) { const n = Date.parse(value); return Number.isFinite(n) ? n : fallback; }
function projectName(cwd) { return cwd ? cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : 'Other conversations'; }
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
function parseSession(provider, file, records, stat, titleEntry) {
  const meta = records.find(r => r.type === 'session_meta')?.payload;
  if (provider === 'codex' && (meta?.source?.subagent || meta?.thread_source?.subagent)) return null;
  if (provider === 'claude' && records.some(r => r.isSidechain === true)) return null;
  const id = provider === 'codex' ? meta?.id || meta?.session_id || path.basename(file).match(/([a-f0-9-]{36})\.jsonl$/i)?.[1] : records.find(r => r.sessionId)?.sessionId || path.basename(file, '.jsonl');
  if (!UUID.test(id || '')) return null;
  const cwd = meta?.cwd || records.find(r => typeof r.cwd === 'string')?.cwd || '';
  const messages = [];
  for (const r of records) {
    const p = r.payload;
    let role, content;
    if (provider === 'codex' && r.type === 'response_item' && p?.type === 'message') { role = p.role; content = textOf(p.content); }
    if (provider === 'claude' && ['user', 'assistant'].includes(r.type)) { role = r.type; content = textOf(r.message?.content); }
    if (!['user', 'assistant'].includes(role)) continue;
    content = cleanMessage(content);
    if (!content || (role === 'user' && !isHumanPrompt(content))) continue;
    if (messages.at(-1)?.text === content) continue;
    messages.push({ role, text: content.slice(0, 12000), timestamp: r.timestamp || '' });
  }
  const first = messages.find(m => m.role === 'user')?.text || '';
  const customTitle = [...records].reverse().find(r => r.type === 'custom-title')?.customTitle;
  const summary = [...records].reverse().find(r => r.type === 'summary')?.summary;
  const title = titleEntry?.thread_name || customTitle || summary || first.replace(/\s+/g, ' ').slice(0, 100) || 'Untitled conversation';
  const createdAt = dateMs(meta?.timestamp || records.find(r => r.timestamp)?.timestamp, stat.birthtimeMs || stat.mtimeMs);
  return { key: `${provider}:${id}`, id, provider, title, cwd, project: projectName(cwd), createdAt,
    updatedAt: Math.max(stat.mtimeMs, dateMs(titleEntry?.updated_at)), preview: (messages.at(-1)?.text || '').slice(0, 700),
    messages: messages.slice(-12), file, sampled: stat.size > 384 * 1024 };
}
async function sample(file, size) {
  const handle = await fs.open(file, 'r');
  try {
    const headSize = Math.min(size, 256 * 1024), tailStart = Math.max(headSize, size - 128 * 1024);
    const head = Buffer.alloc(headSize); await handle.read(head, 0, headSize, 0);
    if (headSize === size) return parseLines(head.toString());
    const tail = Buffer.alloc(size - tailStart); await handle.read(tail, 0, tail.length, tailStart);
    const h = head.toString(), t = tail.toString();
    return parseLines(h.slice(0, h.lastIndexOf('\n')) + '\n' + t.slice(t.indexOf('\n') + 1));
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
              let cached = this.cache.get(file);
              if (!cached || cached.mtime !== stat.mtimeMs || cached.size !== stat.size) {
                cached = { mtime: stat.mtimeMs, size: stat.size, session: parseSession(provider, file, await sample(file, stat.size), stat) };
                this.cache.set(file, cached);
              }
              if (cached.session) {
                const s = { ...cached.session }, title = titles.get(s.id);
                if (title?.thread_name) s.title = title.thread_name;
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
  state.topics ||= structuredClone(DEFAULT_TOPICS); state.cards ||= {};
  const topicIds = new Set(state.topics.map(t => t.id));
  for (const s of sessions) {
    const old = state.cards[s.key];
    if (!old) state.cards[s.key] = { topic: classify(s.title, s.preview, state.topics), status: 'Inbox', pinned: false, note: '', seenAt: 0 };
    else if (!topicIds.has(old.topic)) old.topic = 'general';
  }
  return state;
}
function publicSessions(sessions, state) {
  return sessions.map(({ file, messages, ...s }) => ({ ...s, ...state.cards[s.key], title: state.cards[s.key]?.title || s.title }));
}
module.exports = { DEFAULT_TOPICS, UUID, parseLines, parseSession, sample, classify, reconcile, publicSessions, SessionIndex };
