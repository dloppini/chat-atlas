/* global acquireVsCodeApi, groupProjects, groupSubfolders, effectiveSubfolder, originalProjectKey, projectGroupKey, remapProjectKeys, resolveProjectSelection, orderedProjects, moveProject */
'use strict';
const host = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : window.atlasPreview;
const saved = host.getState() || {};
let data = { sessions: [], topics: [], sources: [], errors: [], projectCatalog: [], subfolders: {}, busy: true };
let view = 'timeline', project = saved.project || '', provider = saved.provider || 'all', query = saved.query || '', showDone = saved.showDone || false, selected = saved.selected || '';
let subfolderFilter = typeof saved.subfolderFilter === 'string' ? saved.subfolderFilter : null;
let detailKey = '', excerpts = [], sampled = false, noticeTimer, newChatTarget = null;
let projectDialogKey = '', projectDialogTarget = '', folderRequestId = 0;
let focusedGroup = saved.view === 'timeline' ? saved.focusedGroup || '' : '';
let sidebarHidden = saved.sidebarHidden === true;
let sidebarWidth = typeof saved.sidebarWidth === 'number' && Number.isFinite(saved.sidebarWidth) ? saved.sidebarWidth : null;
let sidebarDrag = null;
let projectSort = saved.projectSort === 'manual' ? 'manual' : 'alphabetical';
let projectOrder = Array.isArray(saved.projectOrder) ? saved.projectOrder : [];
let hiddenProjects = Array.isArray(saved.hiddenProjects) ? saved.hiddenProjects : [];
let showSubfolders = saved.showSubfolders === true;
let sidebarPreferencesLoaded = false;
const columnScroll = new Map();
const $ = id => document.getElementById(id);
const send = message => host.postMessage(message);
function showNotice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 15000); }
const persist = () => host.setState({ view, project, subfolderFilter, provider, query, showDone, selected, focusedGroup, sidebarHidden, sidebarWidth, projectSort, projectOrder, hiddenProjects, showSubfolders });
const persistSidebar = () => { persist(); send({ type: 'sidebarPreferences', preferences: { projectSort, projectOrder, hiddenProjects, sidebarWidth, showSubfolders } }); };
function sidebarBounds() { return { min: 180, max: Math.max(180, Math.min(520, window.innerWidth - 480)) }; }
function applySidebarWidth() {
  const { min, max } = sidebarBounds();
  if (sidebarWidth === null) document.documentElement.style.removeProperty('--sidebar-width');
  else document.documentElement.style.setProperty('--sidebar-width', `${Math.round(Math.max(min, Math.min(max, sidebarWidth)))}px`);
  const resizer = $('sidebar-resizer');
  const width = Math.round($('project-sidebar').getBoundingClientRect().width || (window.innerWidth <= 1100 ? 180 : 222));
  resizer.setAttribute('aria-valuemin', String(min)); resizer.setAttribute('aria-valuemax', String(max));
  resizer.setAttribute('aria-valuenow', String(width)); resizer.setAttribute('aria-valuetext', `${width} pixels`);
}
function setSidebarWidth(width) { const { min, max } = sidebarBounds(); sidebarWidth = Math.round(Math.max(min, Math.min(max, width))); applySidebarWidth(); }
function finishSidebarResize(cancel = false) {
  if (!sidebarDrag) return;
  const drag = sidebarDrag; sidebarDrag = null;
  if (cancel) { sidebarWidth = drag.preferredWidth; applySidebarWidth(); }
  else persistSidebar();
  document.body.classList.remove('sidebar-resizing');
  if ($('sidebar-resizer').hasPointerCapture(drag.pointerId)) $('sidebar-resizer').releasePointerCapture(drag.pointerId);
}
function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
function button(text, className, fn, title) { const b = el('button', className, text); b.type = 'button'; b.addEventListener('click', fn); if (title) { b.title = title; b.setAttribute('aria-label', title); } return b; }
function shortDate(ms) { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function fullDate(ms) { return new Date(ms).toLocaleString(); }
function providerName(id) { return id === 'codex' ? 'Codex' : 'Claude Code'; }
function openNewChatDialog(key) {
  const target = data.projectCatalog.find(p => p.key === key);
  if (!target?.cwd) {
    if (target?.key.startsWith('custom:')) openProjectDialog('', target.key);
    else showNotice('This project needs an existing folder to start a chat.');
    return;
  }
  newChatTarget = { projectKey: key };
  $('new-chat-title').textContent = `New chat in ${target.name}`;
  $('new-chat-location').textContent = target.cwd;
  $('new-chat-dialog').showModal();
}
function startNewChat(provider) {
  if (!newChatTarget) return;
  send({ type: 'newChat', ...newChatTarget, provider });
  $('new-chat-dialog').close();
}
function openProjectDialog(key = '', targetKey = '') {
  projectDialogKey = key;
  projectDialogTarget = targetKey;
  folderRequestId++;
  const target = data.projectCatalog.find(p => p.key === targetKey);
  $('project-form').reset();
  $('project-name').value = target?.name || '';
  $('project-name').readOnly = !!targetKey;
  $('project-folder').required = !!targetKey;
  $('project-dialog-title').textContent = targetKey ? 'Link project folder' : 'New project';
  $('project-folder-label').textContent = targetKey ? 'Existing folder' : 'Existing folder (optional)';
  $('project-submit').textContent = targetKey ? 'Link folder' : 'Create project';
  $('project-submit').disabled = false;
  $('project-error').hidden = true;
  $('project-dialog-note').textContent = targetKey ? 'Link an existing folder to this project. Its chats stay assigned, and future chats started there join automatically.' : key ? 'This chat will move to the new project on the board. Its original working directory stays unchanged. Add a folder so future chats started there join automatically, or leave it blank for a board-only label.' : 'Leave the folder blank for a board-only label. A folder-backed project will also receive future chats started there.';
  $('project-dialog').showModal(); $(targetKey ? 'project-folder' : 'project-name').focus();
}
function removeProject(key) {
  hiddenProjects = [...new Set([...hiddenProjects, key])];
  if (project === key) { project = ''; subfolderFilter = null; }
  persistSidebar(); render(); $('hidden-projects').focus();
}
function reorderProject(source, target, after = false) {
  const present = orderedProjects(groupProjects(data.sessions, data.projectCatalog), 'manual', projectOrder).map(([key]) => key);
  projectOrder = moveProject([...projectOrder, ...present.filter(key => !projectOrder.includes(key))], source, target, after);
  persistSidebar(); render();
  [...$('projects').children].find(row => row.dataset.project === source)?.querySelector('.nav')?.focus();
}
function renderHiddenProjects(projects) {
  const hidden = orderedProjects(projects, 'alphabetical').filter(([key]) => hiddenProjects.includes(key));
  $('hidden-projects').hidden = !hidden.length;
  $('hidden-projects').textContent = `Hidden projects (${hidden.length})`;
  $('hidden-project-list').replaceChildren(...hidden.map(([key, p]) => {
    const row = el('div', 'hidden-project-row'), label = el('div', 'project-label');
    label.append(el('span', 'project-name', p.name), el('span', 'project-path', [...p.folders.values()][0] || (p.isBoardProject ? 'Board project' : 'No project folder')));
    const identity = `${p.name}${p.showPath && p.folders.size ? ` (${[...p.folders.keys()][0]})` : ''}`;
    row.append(label, button('Restore', 'quiet', () => { hiddenProjects = hiddenProjects.filter(value => value !== key); persistSidebar(); render(); if (!$('hidden-project-list').children.length) $('hidden-projects-dialog').close(); else $('hidden-project-list').querySelector('button')?.focus(); }, `Restore ${identity}`));
    return row;
  }));
}
function focusGroup(id) {
  const previous = focusedGroup;
  focusedGroup = id; persist(); render();
  [...document.querySelectorAll('.column')].find(c => c.dataset.group === (id || previous))?.querySelector('.column-focus')?.focus({ preventScroll: true });
}
function update(s, patch) {
  Object.assign(s, patch); if (typeof patch.done === 'boolean') s.status = patch.done ? 'Done' : 'Inbox';
  if (Object.hasOwn(patch, 'projectOverride')) {
    s.project = data.projectCatalog.find(p => p.key === (patch.projectOverride || originalProjectKey(s)))?.name || s.project;
    delete s.subfolder;
  }
  send({ type: 'update', key: s.key, patch }); render();
}
function select(s, open = false) {
  selected = s.key; persist();
  if (!open) { detailKey = s.key; excerpts = []; $('detail').hidden = false; renderDetail(); }
  send({ type: open ? 'open' : 'select', key: s.key }); render();
}
function setCardRunning(c, running) {
  c.classList.toggle('running', running === true);
  const previous = c.querySelector('.run-indicator');
  if (!running) { previous?.remove(); return; }
  if (previous) return;
  const indicator = el('span', 'run-indicator', 'Running');
  indicator.setAttribute('role', 'img'); indicator.setAttribute('aria-label', 'Running');
  indicator.title = 'Unfinished task detected from local conversation activity';
  const meta = c.querySelector('.card-meta');
  meta.insertBefore(indicator, meta.querySelector('time'));
}
function card(s) {
  const c = el('article', `card${s.status === 'Done' ? ' done' : ''}${selected === s.key ? ' selected' : ''}${s.running ? ' running' : ''}`);
  c.dataset.key = s.key; c.draggable = true;
  c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', s.key); e.dataTransfer.effectAllowed = 'move'; });
  const meta = el('div', 'card-meta');
  meta.append(el('span', `provider-icon ${s.provider}`, s.provider === 'codex' ? 'C' : '✳'), el('span', '', providerName(s.provider)));
  const time = el('time', '', shortDate(s.createdAt)); time.dateTime = new Date(s.createdAt).toISOString(); time.title = `Created ${fullDate(s.createdAt)} · Last activity ${fullDate(s.updatedAt)}`; meta.append(time);
  const title = button(s.title, 'card-open', () => select(s, true), `Resume ${s.title}`); title.dataset.action = 'open';
  const preview = el('p', 'card-preview', s.preview || s.note || 'Open this conversation to continue.');
  const bottom = el('div', 'card-bottom'), label = el('label');
  const checkbox = el('input', 'done-checkbox'); checkbox.type = 'checkbox'; checkbox.checked = s.status === 'Done'; checkbox.setAttribute('aria-label', `Mark ${s.title} ${checkbox.checked ? 'unfinished' : 'done'}`); checkbox.dataset.action = 'done';
  checkbox.addEventListener('change', () => update(s, { done: checkbox.checked })); label.append(checkbox, document.createTextNode('Done')); bottom.append(label);
  if (s.status !== 'Inbox' && s.status !== 'Done') bottom.append(el('span', 'status', s.status));
  if (s.seenAt > 0 && s.updatedAt > s.seenAt) bottom.append(el('span', 'activity', 'Updated'));
  const info = button('Details', 'info', () => select(s), `Details for ${s.title}`); info.dataset.action = 'detail';
  const pin = button(s.pinned ? '★' : '☆', '', () => update(s, { pinned: !s.pinned }), `${s.pinned ? 'Unpin' : 'Pin'} ${s.title}`); pin.dataset.action = 'pin'; pin.setAttribute('aria-pressed', String(!!s.pinned));
  bottom.append(info, pin);
  const folder = showSubfolders ? effectiveSubfolder(s, data.subfolders?.[projectGroupKey(s)] || []) : '';
  c.append(meta, title, preview, el('div', 'card-project', folder ? `${s.project} / ${folder}` : s.project), bottom);
  setCardRunning(c, s.running);
  return c;
}
function render() {
  const board = $('board');
  for (const c of board.querySelectorAll('.column')) columnScroll.set(`${board.dataset.view}:${board.dataset.mode}:${c.dataset.group}`, c.querySelector('.column-cards')?.scrollTop || 0);
  const activeEl = document.activeElement;
  const focusKey = activeEl?.closest('.card')?.dataset.key, focusAction = activeEl?.dataset.action;
  const focusColumn = activeEl?.classList.contains('column-focus') ? activeEl.closest('.column').dataset.group : '';
  $('project-sidebar').hidden = sidebarHidden;
  applySidebarWidth();
  const sidebarLabel = sidebarHidden ? 'Show project sidebar' : 'Hide project sidebar';
  $('sidebar-toggle').title = sidebarLabel;
  $('sidebar-toggle').setAttribute('aria-label', sidebarLabel);
  $('sidebar-toggle').setAttribute('aria-expanded', String(!sidebarHidden));
  const projects = groupProjects(data.sessions, data.projectCatalog);
  const folderGroups = groupSubfolders(data.sessions, data.subfolders || {});
  const resolvedProject = resolveProjectSelection(project, data.sessions, projects);
  if (resolvedProject !== project) { project = resolvedProject; persist(); }
  if (hiddenProjects.includes(project)) { project = ''; subfolderFilter = null; persist(); }
  if (!data.busy && project && subfolderFilter !== null) {
    const folders = folderGroups.get(project);
    if (!showSubfolders || !folders || (subfolderFilter ? !folders.folders.has(subfolderFilter) : !folders.unassigned)) { subfolderFilter = null; persist(); }
  }
  const ordered = orderedProjects(projects, projectSort, projectOrder);
  if (projectSort === 'manual' && data.sessions.length) {
    const nextOrder = [...projectOrder, ...ordered.map(([key]) => key).filter(key => !projectOrder.includes(key))];
    if (JSON.stringify(nextOrder) !== JSON.stringify(projectOrder)) { projectOrder = nextOrder; persistSidebar(); }
  }
  const sidebarProjects = ordered.filter(([key, p]) => !hiddenProjects.includes(key) && (p.count > 0 || p.created));
  $('project-sort').value = projectSort;
  $('subfolder-toggle').textContent = showSubfolders ? 'Hide subfolders' : 'Show subfolders';
  $('subfolder-toggle').setAttribute('aria-pressed', String(showSubfolders));
  $('projects').replaceChildren(...sidebarProjects.flatMap(([key, p], index) => {
    const row = el('div', 'project-entry'); row.dataset.project = key;
    const b = button('', `nav${project === key && subfolderFilter === null ? ' active' : ''}`, () => { project = key; subfolderFilter = null; persist(); render(); });
    b.title = [p.name, ...p.folders.values()].join('\n');
    b.setAttribute('aria-label', `${p.name}${p.showPath && p.folders.size ? `, ${[...p.folders.keys()][0]}` : ''}, ${p.count} conversations`);
    const label = el('span', 'project-label');
    label.append(el('span', 'project-name', p.name));
    if (p.showPath) label.append(el('span', 'project-path', [...p.folders.keys()][0] || (p.isBoardProject ? 'Board project' : 'No project folder')));
    b.append(el('span', 'project-dot', '◆'), label, el('span', 'project-count', String(p.count)));
    const actions = el('div', 'project-actions');
    const identity = `${p.name}${p.showPath && p.folders.size ? ` (${[...p.folders.keys()][0]})` : ''}`;
    if (projectSort === 'manual') {
      const up = button('↑', 'project-action', () => reorderProject(key, sidebarProjects[index - 1][0]), `Move ${identity} up`);
      const down = button('↓', 'project-action', () => reorderProject(key, sidebarProjects[index + 1][0], true), `Move ${identity} down`);
      up.disabled = index === 0; down.disabled = index === sidebarProjects.length - 1; actions.append(up, down);
      row.draggable = true;
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-chat-atlas-project', key); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('application/x-chat-atlas-project')) { e.preventDefault(); row.classList.add('drag-over'); } });
      row.addEventListener('dragleave', e => { if (!row.contains(e.relatedTarget)) row.classList.remove('drag-over'); });
      row.addEventListener('dragend', () => document.querySelectorAll('.project-entry.drag-over').forEach(entry => entry.classList.remove('drag-over')));
      row.addEventListener('drop', e => { const source = e.dataTransfer.getData('application/x-chat-atlas-project'); if (!source) return; e.preventDefault(); const bounds = row.getBoundingClientRect(); reorderProject(source, key, e.clientY > bounds.top + bounds.height / 2); });
    }
    actions.append(button('+', 'project-action', () => openNewChatDialog(key), `New chat in ${identity}`));
    actions.append(button('×', 'project-action', () => removeProject(key), `Remove ${identity} from sidebar`));
    row.append(b, actions);
    const children = [], folders = folderGroups.get(key);
    if (showSubfolders && (folders?.folders.size || (data.subfolders?.[key]?.length && folders?.unassigned))) {
      const childRow = (name, label, count) => {
        const child = el('div', 'subfolder-entry');
        const nav = button('', `nav${project === key && subfolderFilter === name ? ' active' : ''}`, () => { project = key; subfolderFilter = name; persist(); render(); }, `${p.name} / ${label}, ${count} conversations`);
        nav.append(el('span', 'subfolder-arrow', '↳'), el('span', 'subfolder-name', label), el('span', 'project-count', String(count)));
        child.append(nav); return child;
      };
      for (const [name, count] of [...folders.folders].sort((a, b) => a[0].localeCompare(b[0]))) {
        children.push(childRow(name, name, count));
      }
      if (folders.unassigned) children.push(childRow('', 'Project root', folders.unassigned));
    }
    return [row, ...children];
  }));
  renderHiddenProjects(projects);
  $('total').textContent = data.sessions.length;
  $('all-projects').classList.toggle('active', !project);
  const projectName = projects.get(project)?.name || 'Project conversations';
  $('heading').textContent = project ? `${projectName}${subfolderFilter === null ? '' : ` / ${subfolderFilter || 'Project root'}`}` : 'All conversations';
  const projectFolder = data.projectCatalog.find(p => p.key === project)?.cwd || '';
  $('project-location').hidden = !project;
  $('project-folder-path').textContent = projectFolder || 'No folder linked';
  $('project-folder-path').title = projectFolder;
  $('link-project-folder').hidden = !project.startsWith('custom:') || !!projectFolder;
  $('new-chat').hidden = !project;
  $('new-chat').title = projectFolder ? `New chat in ${projectName}` : 'Link a folder to start a chat';
  const scoped = data.sessions.filter(s => !project || (projectGroupKey(s) === project && (subfolderFilter === null || effectiveSubfolder(s, data.subfolders?.[project] || []) === subfolderFilter)));
  const done = scoped.filter(s => s.status === 'Done').length;
  $('summary').textContent = data.busy && !data.sessions.length ? 'Reading local conversations…' : `${scoped.length - done} open conversations · ${done} finished · ${ordered.filter(([, p]) => p.count > 0 || p.created).length} projects`;
  $('done-count').textContent = done;
  $('refresh').disabled = data.busy; $('refresh').textContent = data.busy ? '↻ Syncing…' : '↻ Refresh';
  $('new-topic').disabled = !data.topics.length;
  $('sources').replaceChildren(...data.sources.map(s => {
    const n = el('div', `source ${s.state}`); n.append(el('span', 'source-dot'), el('span', '', s.state === 'ready' ? `${providerName(s.provider)} · ${s.count} chats${s.limited ? ` (latest ${s.total} files capped)` : ''}` : `${providerName(s.provider)} · ${s.state === 'missing' ? 'No local history found' : 'Cannot read history'}`));
    if (s.state !== 'ready' || s.limited) n.append(button('Settings', '', () => send({ type: 'settings' }))); return n;
  }));
  document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
  document.querySelectorAll('[data-provider]').forEach(b => { b.classList.toggle('active', b.dataset.provider === provider); b.setAttribute('aria-pressed', String(b.dataset.provider === provider)); });
  $('show-done').checked = showDone;
  const pins = scoped.filter(s => s.pinned && (showDone || s.status !== 'Done')).sort((a, b) => a.createdAt - b.createdAt);
  $('focus-strip').hidden = pins.length === 0;
  $('focus-strip').replaceChildren(el('span', '', 'PINNED'), ...pins.map(s => button(`★ ${s.title}`, `focus-item${s.key === selected ? ' selected' : ''}`, () => select(s, true), `Resume ${s.title}`)));
  $('errors').textContent = data.errors.join(' ');
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible = scoped.filter(s => (provider === 'all' || s.provider === provider) && (showDone || s.status !== 'Done') && words.every(word => `${s.title} ${s.preview} ${s.project} ${effectiveSubfolder(s, data.subfolders?.[projectGroupKey(s)] || [])} ${s.note} ${data.topics.find(t => t.id === s.topic)?.name || ''}`.toLowerCase().includes(word))).sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key));
  const groups = view === 'topics' ? data.topics.map(t => ({ id: t.id, name: t.name, sessions: visible.filter(s => s.topic === t.id) })) : view === 'workflow' ? ['Inbox', 'In progress', 'Waiting', 'Done'].map(status => ({ id: status, name: status, sessions: visible.filter(s => s.status === status) })) : [...new Set(visible.map(s => new Date(s.createdAt).toLocaleDateString()))].map(day => ({ id: day, name: day, sessions: visible.filter(s => new Date(s.createdAt).toLocaleDateString() === day) }));
  if (focusedGroup && !data.busy && !groups.some(g => g.id === focusedGroup)) { focusedGroup = ''; persist(); }
  const shownGroups = focusedGroup ? groups.filter(g => g.id === focusedGroup) : groups;
  $('visible-count').textContent = `${focusedGroup ? shownGroups.reduce((n, g) => n + g.sessions.length, 0) : visible.length} conversations shown`;
  $('focus-strip').hidden = pins.length === 0 || !!focusedGroup;
  board.className = `board${view === 'timeline' ? ' timeline' : ''}${focusedGroup ? ' focused' : ''}`;
  board.dataset.view = view; board.dataset.mode = focusedGroup ? 'focused' : 'overview';
  $('board').replaceChildren();
  if (!visible.length && !focusedGroup) {
    const empty = el('div', 'empty-state');
    empty.append(el('h2', '', data.busy ? 'Gathering your conversations…' : data.sessions.length ? 'A clear board.' : 'Your conversations belong here.'), el('p', '', data.busy ? 'The first scan can take a moment. Subsequent scans reuse the local index.' : data.sessions.length ? 'Try another project, change your search, or show completed chats.' : 'Start a chat in Codex or Claude Code, then refresh. You can also choose your history folders in Settings.'));
    if (!data.busy && !data.sessions.length) empty.append(button('Choose history folders', 'quiet', () => send({ type: 'settings' })));
    $('board').append(empty);
  } else for (const group of shownGroups) {
    const i = groups.indexOf(group);
    const column = el('section', `column tone-${i % 6}`); column.dataset.group = group.id;
    const head = el('div', 'column-head');
    const focus = button(focusedGroup ? 'Exit focus' : 'Focus', 'column-focus quiet', () => focusGroup(focusedGroup ? '' : group.id), focusedGroup ? 'Exit focus mode (Escape)' : `Focus on ${group.name}`);
    focus.setAttribute('aria-pressed', String(!!focusedGroup));
    head.append(el('span', 'topic-dot'), el('h2', '', group.name), el('span', 'count', String(group.sessions.length)), focus); column.append(head);
    const list = el('div', 'column-cards'); list.append(...group.sessions.map(card));
    if (!group.sessions.length) list.append(el('div', 'empty-column', view === 'workflow' && group.id === 'Done' && !showDone ? 'Tick “Show done” to see finished chats.' : focusedGroup ? 'No conversations match the current filters in this group.' : 'Drop a conversation here'));
    column.append(list);
    if (view !== 'timeline') {
      column.addEventListener('dragover', e => { e.preventDefault(); column.classList.add('drag-over'); });
      column.addEventListener('dragleave', e => { if (!column.contains(e.relatedTarget)) column.classList.remove('drag-over'); });
      column.addEventListener('drop', e => { e.preventDefault(); column.classList.remove('drag-over'); const s = data.sessions.find(s => s.key === e.dataTransfer.getData('text/plain')); if (s) update(s, view === 'topics' ? { topic: group.id } : { status: group.id }); });
    }
    $('board').append(column);
    list.scrollTop = columnScroll.get(`${view}:${board.dataset.mode}:${group.id}`) || 0;
  }
  if (focusKey && focusAction) {
    const c = [...document.querySelectorAll('.card')].find(n => n.dataset.key === focusKey);
    c?.querySelector(`[data-action="${focusAction}"]`)?.focus({ preventScroll: true });
  }
  if (focusColumn) [...board.querySelectorAll('.column')].find(c => c.dataset.group === focusColumn)?.querySelector('.column-focus')?.focus({ preventScroll: true });
}
function renderDetail() {
  const s = data.sessions.find(s => s.key === detailKey); if (!s) return;
  const root = $('detail'); root.replaceChildren();
  const head = el('div', 'detail-head'); head.append(el('span', '', `${providerName(s.provider)} / CONVERSATION`), button('×', '', closeDetail, 'Close details')); root.append(head, el('h2', '', s.title));
  const availableFolders = data.subfolders?.[projectGroupKey(s)] || [];
  const info = el('div', 'meta', `${s.project}\nCreated ${fullDate(s.createdAt)}\nLast activity ${fullDate(s.updatedAt)}${s.completedAt ? `\nFinished ${fullDate(s.completedAt)}` : ''}`); root.append(info);
  root.append(button(`Resume in ${s.provider === 'codex' ? 'Codex sidebar' : 'Claude Code'}`, 'primary', () => select(s, true)));
  if (s.provider === 'codex') root.append(button('Open beside board', 'quiet', () => send({ type: 'open', key: s.key, editor: true })));
  root.append(button('Start in hidden terminal', 'quiet', () => send({ type: 'open', key: s.key, terminal: true })));
  const titleLabel = el('label', '', 'Board title'); const titleInput = el('input'); titleInput.value = s.title; titleInput.maxLength = 150; titleInput.addEventListener('change', () => update(s, { title: titleInput.value })); titleLabel.append(titleInput); root.append(titleLabel);
  const projectLabel = el('label', '', 'Project'), projectSelect = el('select');
  const automatic = data.projectCatalog.find(p => p.key === originalProjectKey(s))?.name || s.project;
  const choices = [['', `Automatic (${automatic})`], ...data.projectCatalog.filter(p => p.key !== originalProjectKey(s) && (!hiddenProjects.includes(p.key) || p.key === s.projectOverride)).sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.key, `${p.name}${p.cwd ? ` — ${p.cwd}` : ' (board project)'}`]), ['__create__', '+ Create project…']];
  for (const [value, text] of choices) { const option = el('option', '', text); option.value = value; projectSelect.append(option); }
  projectSelect.value = s.projectOverride || '';
  projectSelect.addEventListener('change', () => {
    if (projectSelect.value === '__create__') { projectSelect.value = s.projectOverride || ''; openProjectDialog(s.key); return; }
    const target = projectSelect.value || originalProjectKey(s);
    update(s, { projectOverride: projectSelect.value || null });
    project = target; subfolderFilter = null; persist(); render(); renderDetail();
  });
  projectLabel.append(projectSelect); root.append(projectLabel);
  root.append(el('p', 'manual-project-warning', `Manual project choices change only this board. Automatic follows the recorded working folder: ${s.cwd || 'unknown'}. Resuming the chat still uses that folder.`));
  if (availableFolders.length) {
    const label = el('label', '', 'Subfolder within project'), selectInput = el('select');
    const suggested = effectiveSubfolder({ ...s, subfolder: null }, availableFolders);
    const options = [['', `Automatic (${suggested || 'project root'})`], ['', 'Project root'], ...availableFolders.map(name => [name, name])];
    for (const [value, text] of options) { const option = el('option', '', text); option.value = value; selectInput.append(option); }
    selectInput.selectedIndex = s.subfolder == null ? 0 : s.subfolder === '' ? 1 : Math.max(1, availableFolders.indexOf(s.subfolder) + 2);
    selectInput.addEventListener('change', () => update(s, { subfolder: selectInput.selectedIndex === 0 ? null : selectInput.value }));
    label.append(selectInput); root.append(label);
  }
  for (const [name, field, options] of [['Topic', 'topic', data.topics.map(t => [t.id, t.name])], ['Progress', 'status', ['Inbox', 'In progress', 'Waiting', 'Done'].map(v => [v, v])]]) {
    const label = el('label', '', name), selectInput = el('select');
    for (const [value, text] of options) { const option = el('option', '', text); option.value = value; selectInput.append(option); }
    selectInput.value = s[field]; selectInput.addEventListener('change', () => update(s, { [field]: selectInput.value })); label.append(selectInput); root.append(label);
  }
  const noteLabel = el('label', '', 'Your handoff note'), note = el('textarea'); note.value = s.note || ''; note.maxLength = 5000; note.placeholder = 'Where did you leave off?'; note.addEventListener('change', () => update(s, { note: note.value })); noteLabel.append(note); root.append(noteLabel);
  root.append(el('h3', '', 'Conversation excerpts'), el('p', 'meta', sampled ? 'Sampled from the beginning and end of the local transcript. Open the conversation for the full history.' : 'Recent messages from the local transcript.'));
  if (!excerpts.length) root.append(el('p', 'meta', 'Loading excerpts…'));
  for (const message of excerpts) { const item = el('div', 'excerpt'); item.append(el('b', '', message.role === 'user' ? 'YOU' : providerName(s.provider).toUpperCase()), el('p', '', message.text)); root.append(item); }
}
function closeDetail() { $('detail').hidden = true; const key = detailKey; detailKey = ''; [...document.querySelectorAll('.card')].find(n => n.dataset.key === key)?.querySelector('.info')?.focus(); }
window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'activity' && Array.isArray(m.sessions)) {
    const activity = new Map(m.sessions.map(s => [s.key, s.running === true]));
    for (const session of data.sessions) if (activity.has(session.key)) session.running = activity.get(session.key);
    for (const card of document.querySelectorAll('article.card')) if (activity.has(card.dataset.key)) setCardRunning(card, activity.get(card.dataset.key));
    return;
  }
  if (m.type === 'data') {
    if (!sidebarPreferencesLoaded && m.sidebarPreferences) {
      projectSort = m.sidebarPreferences.projectSort === 'manual' ? 'manual' : 'alphabetical';
      projectOrder = m.sidebarPreferences.projectOrder || [];
      hiddenProjects = m.sidebarPreferences.hiddenProjects || [];
      sidebarWidth = typeof m.sidebarPreferences.sidebarWidth === 'number' && Number.isFinite(m.sidebarPreferences.sidebarWidth) ? m.sidebarPreferences.sidebarWidth : null;
      showSubfolders = m.sidebarPreferences.showSubfolders === true;
      sidebarPreferencesLoaded = true; persist();
    }
    data = m; render();
  }
  if (m.type === 'detail' && m.key === detailKey) { excerpts = m.messages; sampled = m.sampled; renderDetail(); }
  if (m.type === 'projectCreated') {
    if ($('project-dialog').open) $('project-dialog').close();
    if (detailKey) closeDetail();
    project = m.key; subfolderFilter = null; persist(); render();
  }
  if (m.type === 'projectFolderLinked') {
    if ($('project-dialog').open) $('project-dialog').close();
    projectOrder = remapProjectKeys(projectOrder, m.previousKey, m.key);
    hiddenProjects = remapProjectKeys(hiddenProjects, m.previousKey, m.key);
    project = m.key; subfolderFilter = null; persist(); render(); renderDetail();
  }
  if (m.type === 'projectFolderSelected' && $('project-dialog').open && m.requestId === folderRequestId) {
    $('project-folder').value = m.folder; $('project-folder').focus();
  }
  if (m.type === 'projectError') {
    if ($('project-dialog').open) {
      $('project-error').textContent = m.text; $('project-error').hidden = false; $('project-submit').disabled = false;
    } else showNotice(m.text);
  }
  if (m.type === 'notice') showNotice(m.text);
});
$('search').value = query;
$('search').addEventListener('input', e => { query = e.target.value; persist(); render(); });
$('show-done').addEventListener('change', e => { showDone = e.target.checked; persist(); render(); });
$('all-projects').addEventListener('click', () => { project = ''; subfolderFilter = null; persist(); render(); });
$('refresh').addEventListener('click', () => send({ type: 'refresh' }));
$('new-chat').addEventListener('click', () => openNewChatDialog(project));
$('new-chat-codex').addEventListener('click', () => startNewChat('codex'));
$('new-chat-claude').addEventListener('click', () => startNewChat('claude'));
$('close-new-chat').addEventListener('click', () => $('new-chat-dialog').close());
$('new-chat-dialog').addEventListener('close', () => { newChatTarget = null; });
$('settings').addEventListener('click', () => send({ type: 'settings' }));
$('sidebar-toggle').addEventListener('click', () => { sidebarHidden = !sidebarHidden; persist(); render(); });
$('project-sort').addEventListener('change', e => { projectSort = e.target.value; persistSidebar(); render(); });
$('new-project').addEventListener('click', () => openProjectDialog());
$('link-project-folder').addEventListener('click', () => openProjectDialog('', project));
$('browse-project-folder').addEventListener('click', () => send({ type: 'pickProjectFolder', requestId: ++folderRequestId, folder: $('project-folder').value }));
$('cancel-project').addEventListener('click', () => $('project-dialog').close());
$('project-dialog').addEventListener('close', () => { projectDialogKey = ''; projectDialogTarget = ''; folderRequestId++; $('project-form').reset(); });
$('project-form').addEventListener('submit', e => {
  e.preventDefault(); $('project-error').hidden = true; $('project-submit').disabled = true;
  send(projectDialogTarget ? { type: 'linkProjectFolder', projectKey: projectDialogTarget, folder: $('project-folder').value } : { type: 'createProject', key: projectDialogKey, name: $('project-name').value, folder: $('project-folder').value });
});
$('subfolder-toggle').addEventListener('click', () => { showSubfolders = !showSubfolders; subfolderFilter = null; persistSidebar(); render(); });
$('hidden-projects').addEventListener('click', () => $('hidden-projects-dialog').showModal());
$('close-hidden-projects').addEventListener('click', () => $('hidden-projects-dialog').close());
const sidebarResizer = $('sidebar-resizer');
sidebarResizer.addEventListener('pointerdown', e => {
  if (e.button !== 0 || sidebarDrag) return;
  e.preventDefault(); sidebarResizer.focus();
  sidebarDrag = { pointerId: e.pointerId, x: e.clientX, width: $('project-sidebar').getBoundingClientRect().width, preferredWidth: sidebarWidth };
  sidebarResizer.setPointerCapture(e.pointerId); document.body.classList.add('sidebar-resizing');
});
sidebarResizer.addEventListener('pointermove', e => { if (sidebarDrag?.pointerId === e.pointerId) setSidebarWidth(sidebarDrag.width + e.clientX - sidebarDrag.x); });
sidebarResizer.addEventListener('pointerup', e => { if (sidebarDrag?.pointerId === e.pointerId) finishSidebarResize(); });
sidebarResizer.addEventListener('pointercancel', () => finishSidebarResize(true));
sidebarResizer.addEventListener('lostpointercapture', () => finishSidebarResize());
sidebarResizer.addEventListener('dblclick', () => { sidebarWidth = null; applySidebarWidth(); persistSidebar(); });
sidebarResizer.addEventListener('keydown', e => {
  const { min, max } = sidebarBounds(), width = $('project-sidebar').getBoundingClientRect().width;
  if (e.key === 'Escape' && sidebarDrag) { e.preventDefault(); e.stopPropagation(); finishSidebarResize(true); return; }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(e.key)) return;
  e.preventDefault();
  if (e.key === 'Enter') { sidebarWidth = null; applySidebarWidth(); }
  else setSidebarWidth(e.key === 'Home' ? min : e.key === 'End' ? max : width + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 32 : 16));
  persistSidebar();
});
window.addEventListener('resize', applySidebarWidth);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { if (view !== b.dataset.view) focusedGroup = ''; view = b.dataset.view; persist(); render(); }));
document.querySelectorAll('[data-provider]').forEach(b => b.addEventListener('click', () => { provider = b.dataset.provider; persist(); render(); }));
$('new-topic').addEventListener('click', () => $('topic-dialog').showModal());
$('cancel-topic').addEventListener('click', () => $('topic-dialog').close());
$('topic-form').addEventListener('submit', e => { e.preventDefault(); send({ type: 'addTopic', name: $('topic-name').value, keywords: $('topic-keywords').value }); $('topic-dialog').close(); $('topic-form').reset(); });
document.addEventListener('keydown', e => {
  if ($('topic-dialog').open || $('hidden-projects-dialog').open || $('project-dialog').open || $('new-chat-dialog').open) return;
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); $('search').focus(); }
  if (e.key === 'Escape') {
    if (!$('detail').hidden) closeDetail();
    else if (focusedGroup) focusGroup('');
  }
});
render(); send({ type: 'ready' });
