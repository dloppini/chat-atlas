/* global acquireVsCodeApi, activityAge, groupProjects, groupSubfolders, effectiveSubfolder, originalProjectKey, projectGroupKey, remapProjectKeys, resolveProjectSelection, orderedProjects, moveProject */
'use strict';
const host = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : window.atlasPreview;
const saved = host.getState() || {};
let themeMigrated = saved.themeMigrated === true;
let theme = ['system', 'pearl', 'dark'].includes(saved.theme) ? saved.theme : 'system';
document.body.dataset.theme = theme;
let data = { sessions: [], topics: [], sources: [], errors: [], projectCatalog: [], subfolders: {}, busy: true };
let view = 'timeline', project = saved.project || '', provider = saved.provider || 'all', query = saved.query || '', showDone = saved.showDone || false, selected = saved.selected || '';
let cardSort = saved.cardSort === 'updated' ? 'updated' : 'created';
const sortTime = s => cardSort === 'updated' ? s.updatedAt || s.createdAt : s.createdAt;
let subfolderFilter = typeof saved.subfolderFilter === 'string' ? saved.subfolderFilter : null;
let gitOperation = null, gitOperationId = 0, gitOperationNotice = '';
const gitCommitDrafts = new Map(Object.entries(saved.gitCommitDrafts || {}).filter(([,text]) => typeof text === 'string' && text.length <= 10000)), gitRemotes = new Map();
let gitOperationFocus = '';
let gitDiffId = 0, gitSelection = { mode: 'all' }, gitDiffResult = null;
let gitAutoFit = saved.gitAutoFit !== false, gitHideHistory = saved.gitHideHistory === true, gitWrap = saved.gitWrap === true;
let gitDiffScroll = { file: '', top: 0, left: 0, list: 0 };
let gitDocked = saved.gitDocked === true, gitDockHeight = Number.isFinite(saved.gitDockHeight) ? saved.gitDockHeight : 320, gitLive = false, gitWatchKey = null, gitDockDrag = null;
const gitHeights = { tree: 300, diff: 640 };
for (const key of Object.keys(gitHeights)) if (Number.isFinite(saved.gitHeights?.[key])) gitHeights[key] = Math.max(160, Math.min(1200, saved.gitHeights[key]));
const gitBranchFocus = saved.gitBranchFocus && typeof saved.gitBranchFocus === 'object' && !Array.isArray(saved.gitBranchFocus) ? saved.gitBranchFocus : {};
let gitFocusPending = false;
let gitOpen = false, gitProject = '', gitRequestId = 0, gitResult = null;
let engineeringOpen = saved.engineeringOpen === true, engineeringProject = '', engineeringRequestId = 0;
let engineeringView = ['architecture', 'quality', 'impact'].includes(saved.engineeringView) ? saved.engineeringView : 'overview';
const engineeringPreferences = new Map(Object.entries(saved.engineeringPreferences || {}));
const engineeringResults = new Map();
let engineeringGraph = null, engineeringQueryId = 0;
let detailKey = '', excerpts = null, sampled = false, noticeTimer, newChatTarget = null;
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
const batchSelection = new Set();
const statuses = ['Inbox', 'In progress', 'Waiting', 'Done'];
const $ = id => document.getElementById(id);
const send = message => host.postMessage(message);
const narrowWorkspace = window.matchMedia('(max-width: 680px)');
const sidebar = $('project-sidebar'), drawer = $('project-drawer');
const dayHeading = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
function captureScrollPosition() {
  const pageScroll = { left: window.scrollX, top: window.scrollY }, board = $('board');
  for (const column of board.querySelectorAll('.column')) columnScroll.set(`${board.dataset.view}:${board.dataset.mode}:${column.dataset.group}`, column.querySelector('.column-cards').scrollTop);
  return pageScroll;
}
function restoreScrollPosition(pageScroll) {
  const board = $('board');
  for (const column of board.querySelectorAll('.column')) column.querySelector('.column-cards').scrollTop = columnScroll.get(`${board.dataset.view}:${board.dataset.mode}:${column.dataset.group}`) || 0;
  window.scrollTo({ ...pageScroll, behavior: 'instant' });
}
function showNotice(message) {
  const pageScroll = { left: window.scrollX, top: window.scrollY };
  $('notice').textContent = message; $('notice').hidden = false;
  window.scrollTo({ ...pageScroll, behavior: 'instant' });
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    const pageScroll = { left: window.scrollX, top: window.scrollY };
    $('notice').hidden = true;
    window.scrollTo({ ...pageScroll, behavior: 'instant' });
  }, 15000);
}
const persist = () => host.setState({ engineeringOpen, engineeringView, engineeringPreferences: Object.fromEntries(engineeringPreferences), gitCommitDrafts:Object.fromEntries(gitCommitDrafts), gitAutoFit, gitHideHistory, gitWrap, gitDocked, gitDockHeight, themeMigrated, theme, gitBranchFocus, gitHeights, view, cardSort, project, subfolderFilter, provider, query, showDone, selected, focusedGroup, sidebarHidden, sidebarWidth, projectSort, projectOrder, hiddenProjects, showSubfolders });
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
function syncSidebar() {
  const narrow = narrowWorkspace.matches;
  if (narrow && sidebar.parentElement !== drawer) drawer.append(sidebar);
  if (!narrow && sidebar.parentElement === drawer) {
    drawer.close();
    $('main').before(sidebar);
  }
  sidebar.hidden = !narrow && sidebarHidden;
  const expanded = narrow ? drawer.open : !sidebarHidden;
  const toggle = $('sidebar-toggle');
  toggle.title = expanded ? 'Hide project sidebar' : 'Show project sidebar';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-controls', narrow ? drawer.id : sidebar.id);
  if (narrow) toggle.setAttribute('aria-haspopup', 'dialog');
  else toggle.removeAttribute('aria-haspopup');
  applySidebarWidth();
}
function chooseProject(key, folder = null) {
  project = key;
  subfolderFilter = folder;
  if (drawer.open) drawer.close();
  persist();
  render();
}
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
  if (target?.cwd) {
    $('project-dialog-title').textContent = 'Reconnect project folder';
    $('project-folder').value = target.cwd;
    $('project-submit').textContent = 'Reconnect folder';
    $('project-dialog-note').textContent = 'Choose the new location of this project after a move or rename. Its conversations will use the new path in Atlas. Provider history stays in place.';
  }
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
function requestGit(resetDiff = true, live = false) {
  if (gitProject !== project) gitOperationNotice = '';
  gitProject = project; gitLive = live;
  if (!live) gitResult = null;
  if (resetDiff) { gitDiffResult = null; gitDiffId++; gitSelection = { mode: 'all' }; }
  send({ type: 'gitDashboard', projectKey: project, focusRef: gitBranchFocus[project] || '', requestId: ++gitRequestId });
}
function focusGitBranch(ref) {
  gitFocusPending = true; gitBranchFocus[project] = ref; persist(); requestGit(false); renderGit();
}
function startGitOperation(action, options = {}) {
  if (gitOperation || !gitResult?.dashboard) return;
  const repo = gitResult.dashboard;
  gitOperation = { projectKey: project, requestId: ++gitOperationId, action, ...options };
  gitOperationNotice = '';
  send({ type: 'gitOperation', ...gitOperation, head: repo.head, branch: repo.branch, indexVersion: repo.indexVersion }); renderGit();
}
function applyGitLayout() {
  document.body.classList.toggle('git-auto-fit', gitAutoFit);
  document.body.classList.toggle('git-hide-history', gitHideHistory);
  document.body.classList.toggle('git-wrap', gitWrap);
  for (const [selector, pressed] of [['.git-fit', gitAutoFit], ['.git-focus', gitHideHistory], ['.git-wrap-toggle', gitWrap]]) {
    document.querySelector(selector)?.setAttribute('aria-pressed', String(pressed));
  }
}
function gitHeightControl(key, label) {
  const field = el('label', 'git-height', label + ' height');
  const input = el('input'); input.type = 'number'; input.min = '160'; input.max = '1200'; input.step = '20';
  input.name = key + '-height'; input.value = gitHeights[key]; input.setAttribute('aria-label', label + ' height in pixels');
  input.addEventListener('change', () => {
    if (!input.validity.valid || !input.value) { input.value = gitHeights[key]; return; }
    gitHeights[key] = Number(input.value); $('git-dashboard').style.setProperty('--git-' + key + '-height', gitHeights[key] + 'px'); persist();
  });
  field.append(input, el('span', '', 'px')); return field;
}
function gitGraphLayout(commits) {
  const lanes = [], positions = [], byHash = new Map(), colors = new Map();
  let nextColor = 0, maxLanes = 1;
  for (const [index, commit] of commits.entries()) {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) { lane = lanes.indexOf(null); if (lane < 0) lane = lanes.length; lanes[lane] = commit.hash; }
    if (!colors.has(commit.hash)) colors.set(commit.hash, nextColor++);
    const color = colors.get(commit.hash);
    const position = { lane, index, commit, color }; positions.push(position); byHash.set(commit.hash, position);
    lanes[lane] = null;
    for (const [parentIndex, parent] of commit.parents.entries()) if (!lanes.includes(parent)) {
      let target = parentIndex === 0 ? lane : lanes.indexOf(null);
      if (target < 0) target = lanes.length;
      lanes[target] = parent;
      if (!colors.has(parent)) colors.set(parent, parentIndex === 0 ? color : nextColor++);
    }
    maxLanes = Math.max(maxLanes, lanes.length);
  }
  return { positions, byHash, maxLanes };
}
function syncGitWatch(key) {
  if (gitWatchKey !== key) { gitWatchKey = key; send({ type: 'gitWatch', projectKey: key }); }
}
function gitDockHandle() {
  const handle = el('div', 'git-dock-resizer'); handle.tabIndex = 0; handle.title = 'Drag to resize · Arrow keys adjust';
  handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'horizontal'); handle.setAttribute('aria-label', 'Resize Git panel');
  handle.setAttribute('aria-valuemin', '160'); handle.setAttribute('aria-valuenow', String(gitDockHeight));
  const resize = height => {
    gitDockHeight = Math.round(Math.max(160, Math.min(height, window.innerHeight * .8)));
    $('git-dashboard').style.setProperty('--git-dock-height', gitDockHeight + 'px'); handle.setAttribute('aria-valuenow', String(gitDockHeight));
  };
  handle.addEventListener('pointerdown', e => { if (e.button) return; e.preventDefault(); gitDockDrag = { y: e.clientY, height: $('git-dashboard').getBoundingClientRect().height }; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', e => { if (gitDockDrag) resize(gitDockDrag.height + gitDockDrag.y - e.clientY); });
  handle.addEventListener('lostpointercapture', () => { gitDockDrag = null; persist(); });
  handle.addEventListener('keydown', e => {
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); resize(gitDockHeight + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 64 : 16)); persist();
  });
  return handle;
}
function toggleGitDock() {
  gitDocked = !gitDocked; persist();
  if (gitDocked && gitOpen) selectProjectView(false); else render();
  document.querySelector('.git-dock')?.focus({ preventScroll: true });
}
function renderGit(rebuild = true) {
  const active = gitOpen && !!project;
  const engineering = engineeringOpen && !!project;
  const docked = gitDocked && !!project && !active;
  document.body.classList.toggle('git-mode', active);
  document.body.classList.toggle('git-docked', docked);
  applyGitLayout();
  if (!active) document.querySelectorAll('#sources, .toolbar, .filterbar, #board, main > footer').forEach(node => { node.hidden = false; });
  $('project-views').hidden = !project;
  $('conversation-switch').setAttribute('aria-pressed', String(!active && !engineering));
  $('engineering-switch').setAttribute('aria-pressed', String(engineering));
  $('engineering-switch').hidden = !project;
  $('git-switch').setAttribute('aria-pressed', String(active));
  $('git-dashboard').hidden = !active && !docked;
  syncGitWatch(active || docked ? project : '');
  document.querySelectorAll('#sources, #focus-strip, .toolbar, .filterbar, #batch-actions, #board, main > footer').forEach(node => {
    if (active || engineering) node.hidden = true;
  });
  $('engineering-panel').hidden = !engineering;
  if (engineering) {
    $('detail').hidden = true;
    if (engineeringProject !== project) {
      engineeringProject = project;
      engineeringGraph = null;
      renderEngineering();
      requestEngineering('engineeringRead');
      queryEngineering();
    }
  } else engineeringProject = '';
  const section = $('git-dashboard'), layout = project + (active ? ':full' : ':dock');
  if (!active && !docked) { delete section.dataset.layout; return; }
  if (active) $('detail').hidden = true;
  if (gitProject !== project) requestGit();
  // Conversation renders (search, filters, polling) must not rebuild the docked repository view.
  else if (!rebuild && section.dataset.layout === layout) return;
  section.dataset.layout = layout;
  const historyScroll = document.querySelector('.git-history-scroll');
  const messageSelection = document.activeElement?.id === 'git-commit-message' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const scrollPosition = { top: historyScroll?.scrollTop || 0, left: historyScroll?.scrollLeft || 0 };
  section.replaceChildren();
  section.style.setProperty('--git-dock-height', gitDockHeight + 'px');
  if (docked) section.append(gitDockHandle());
  section.setAttribute('aria-busy', String(!gitResult));
  if (!gitResult || gitResult.error) {
    const message = el('p', 'notice', gitResult?.error || 'Reading repository...');
    message.setAttribute('role', 'status');
    if (gitResult?.error && gitBranchFocus[project]) message.append(button('Show all branches', 'quiet', () => focusGitBranch('')));
    section.append(message); return;
  }
  const repo = gitResult.dashboard;
  const repoHead = el('div', 'git-repo-heading');
  repoHead.append(el('h2', '', 'Git'), el('span', 'git-branch-name', repo.branch), el('span', 'git-root', repo.root));
  const layoutActions = el('div', 'git-layout-actions');
  const sync = el('div', 'git-sync-actions'); sync.setAttribute('role', 'group'); sync.setAttribute('aria-label', 'Repository synchronization');
  const currentBranch = repo.branchRefs?.find(ref => ref.ref === 'refs/heads/' + repo.branch);
  const remote = repo.remotes?.includes(gitRemotes.get(project)) ? gitRemotes.get(project) : currentBranch?.remote || repo.remotes?.[0] || '';
  if (repo.remotes?.length > 1 && repo.azureRemotes?.length || repo.remotes?.length && !repo.upstream) {
    const label = el('label', 'git-remote', repo.upstream ? 'PR remote' : 'Remote'); const select = el('select'); select.name = 'git-remote';
    for (const name of repo.remotes) { const option = el('option', '', name); option.value = name; select.append(option); }
    select.value = remote; select.disabled = !!gitOperation;
    select.addEventListener('change', () => { gitRemotes.set(project, select.value); renderGit(); document.querySelector('.git-remote select')?.focus(); });
    label.append(select); sync.append(label);
  }
  for (const action of ['fetch', 'pull', 'push']) {
    const label = action[0].toUpperCase() + action.slice(1);
    const reason = !repo.remotes?.length ? 'No remote configured' : action !== 'fetch' && (!repo.head || repo.branch === 'Detached HEAD') ? 'Check out a branch first' : action === 'pull' && !repo.upstream ? 'Push to publish this branch first' : action === 'pull' && repo.changes.length ? 'Commit or stash local changes first' : '';
    const control = button(gitOperation?.action === action && gitOperation.projectKey === project ? label + '...' : label, 'quiet', () => startGitOperation(action, { remote }));
    control.disabled = !!gitOperation || !!reason;
    control.title = reason || (action === 'fetch' ? 'Fetch all configured remotes' : action === 'push' && !repo.upstream ? `Publish ${repo.branch} to ${remote} and set upstream` : label + (action === 'pull' ? ' fast-forward from ' : ' to ') + repo.upstream);
    sync.append(control);
  }
  if (repo.azureRemotes?.length) {
    const pr = button('Create PR', 'quiet', () => startGitOperation('createPr', { remote }));
    const reason = !repo.head || repo.branch === 'Detached HEAD' ? 'Check out a branch with a commit first' : !repo.azureRemotes.some(item => item.name === remote) ? 'Select an Azure remote' : '';
    pr.disabled = !!gitOperation || !!reason; pr.title = reason || `Open Azure DevOps PR form for ${repo.branch} on ${remote}`; sync.append(pr);
  }
  repoHead.append(sync);
  const fit = button('Fit window', 'quiet git-fit', () => { gitAutoFit = !gitAutoFit; applyGitLayout(); persist(); });
  const focus = button('Hide history', 'quiet git-focus', () => { gitHideHistory = !gitHideHistory; applyGitLayout(); persist(); });
  const dock = button('Keep at bottom', 'quiet git-dock', toggleGitDock);
  dock.title = 'Keep Git docked below conversations, updating live';
  focus.setAttribute('aria-controls', 'git-history'); dock.setAttribute('aria-pressed', String(gitDocked));
  if (docked) layoutActions.append(button('Expand', 'quiet', () => selectProjectView(true)));
  else layoutActions.append(fit);
  layoutActions.append(focus, dock); repoHead.append(layoutActions); section.append(repoHead);
  for (const key of Object.keys(gitHeights)) section.style.setProperty('--git-' + key + '-height', gitHeights[key] + 'px');
  const position = el('div', 'git-position');
  const current = el('strong', 'git-checkout', repo.head ? `Checked out: ${repo.branch} @ ${repo.head.slice(0,7)}` : `${repo.branch} | No commits yet`);
  position.append(current);
  position.append(el('span', '', repo.upstream ? `${repo.upstream} | ${repo.tracking ? `${repo.tracking[0]} ahead / ${repo.tracking[1]} behind` : 'tracking ref unavailable'} | last fetched state` : repo.branch === 'Detached HEAD' ? 'Detached: new commits are not on a branch' : 'No upstream configured'));
  if (repo.focusRef) position.append(el('span', '', `Viewing ${repo.focusRef.replace(/^refs\/(heads|remotes)\//, '')}${repo.comparison ? ` | ${repo.comparison[0]} commits only on HEAD / ${repo.comparison[1]} only on this branch` : ''}`));
  if (repo.head && !(repo.commits || []).some(c => c.hash === repo.head)) position.append(button('Show current branch', 'quiet', () => { gitHideHistory = false; focusGitBranch(repo.branch === 'Detached HEAD' ? '' : 'refs/heads/' + repo.branch); }));
  // Docked: the Pull button's tooltip carries this reason, and the status shares the heading row to leave room for the tree.
  if (repo.changes.length && repo.upstream && !docked) position.append(el('span', '', 'Pull requires a clean working tree'));
  if (docked) repoHead.insertBefore(position, sync); else section.append(position);
  if (gitOperation || gitOperationNotice) { const notice = el('div', 'git-operation-status', gitOperation ? `Running ${gitOperation.action}...` : gitOperationNotice); notice.setAttribute('role','status'); section.append(notice); }
  const history = el('section', 'git-history'); history.id = 'git-history';
  const toolbar = el('div', 'git-heading');
  toolbar.append(el('h3', '', 'History'));
  const focusLabel = el('label', 'git-branch-focus', 'Branch');
  const branchSelect = el('select'); branchSelect.id = 'git-branch-focus'; branchSelect.name = 'git-branch-focus';
  const all = el('option', '', 'All branches'); all.value = ''; branchSelect.append(all);
  for (const branch of repo.branchRefs || []) { const option = el('option', '', branch.name); option.value = branch.ref; branchSelect.append(option); }
  branchSelect.value = repo.focusRef || '';
  branchSelect.addEventListener('change', () => focusGitBranch(branchSelect.value));
  focusLabel.append(branchSelect);
  toolbar.append(focusLabel, el('span', 'git-caption', 'Latest 100 commits'), gitHeightControl('tree', 'Tree'));
  toolbar.append(button('Local changes (' + repo.changes.length + ')', 'quiet', () => selectGitDiff({ mode: 'all' })));
  history.append(toolbar);
  const commits = repo.commits || [];
  const { positions, byHash, maxLanes } = gitGraphLayout(commits);
  const graphWidth = maxLanes * 22 + 24, rowHeight = 32;
  const scroll = el('div', 'git-history-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Commit history');
  const graph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  graph.setAttribute('width', graphWidth); graph.setAttribute('height', commits.length * rowHeight); graph.setAttribute('aria-hidden', 'true'); graph.classList.add('git-lanes');
  const shape = (name, attrs) => { const n = document.createElementNS(graph.namespaceURI, name); for (const [k,v] of Object.entries(attrs)) n.setAttribute(k, v); graph.append(n); };
  for (const { lane, index, commit, color } of positions) {
    const x = lane * 22 + 14, y = index * rowHeight + rowHeight / 2;
    for (const [parentIndex, parent] of commit.parents.entries()) {
      const target = byHash.get(parent), endX = target ? target.lane * 22 + 14 : x, endY = target ? target.index * rowHeight + rowHeight / 2 : commits.length * rowHeight;
      shape('path', { d: `M ${x} ${y} C ${x} ${y+rowHeight/2}, ${endX} ${endY-rowHeight/2}, ${endX} ${endY}`, class: `git-edge lane-${(parentIndex > 0 && target ? target.color : color)%6}` });
    }
  }
  for (const {lane, index, color} of positions) {
    shape('circle', { cx:lane * 22 + 14, cy:index * rowHeight + rowHeight / 2, r:4, class:`git-node lane-${color%6}${positions[index].commit.hash === repo.head ? ' git-head-node' : ''}` });
  }
  // shortcut: six theme colors repeat for larger histories; ref names remain the identity.
  const rows = el('div', 'git-commit-rows');
  for (const {commit, color} of positions) {
    const row = button('', 'git-commit', () => selectGitDiff({mode:'commit', commit:commit.hash}));
    row.dataset.commit = commit.hash;
    row.classList.toggle('git-head-commit', commit.hash === repo.head);
    if (commit.hash === repo.head) row.setAttribute('aria-current', 'true');
    row.setAttribute('aria-pressed', String(gitSelection.commit === commit.hash));
    row.title = commit.subject + '\n' + commit.hash + '\nParents: ' + (commit.parents.join(', ') || 'Root commit');
    const subject = el('span', 'git-subject');
    if (commit.hash === repo.head) subject.append(el('span', 'git-head-label', 'HEAD - You are here'));
    for (const ref of (commit.refs || '').split(',').map(ref => ref.trim()).filter(Boolean)) subject.append(el('span', 'git-ref lane-' + color%6, ref));
    subject.append(el('span', 'git-message', commit.subject));
    row.append(subject, el('code', '', commit.hash.slice(0,7)), el('span', 'git-author', commit.author), el('time', '', new Date(commit.date).toLocaleDateString()));
    rows.append(row);
  }
  scroll.append(graph, rows); history.append(commits.length ? scroll : el('p', '', 'No commits yet.'));
  const branches = el('details', 'git-branch-list'); branches.append(el('summary', '', 'All branches'));
  const branchLabels = el('div', 'git-branch-labels');
  for (const branch of repo.branchRefs || []) {
    const name = branch.name;
    const tip = positions.find(({commit}) => (commit.refs || '').split(',').some(ref => ref.trim().replace(/^HEAD -> /, '') === name.replace(/^remotes\//, '')));
    const control = button(name, 'git-ref' + (tip ? ' lane-' + tip.color%6 : ''), () => focusGitBranch(branch.ref), 'Focus branch ' + name);
    control.title = `${name} | ${branch.hash?.slice(0,7) || ''}${branch.ref === 'refs/heads/' + repo.branch ? ' | checked out' : ''}`;
    control.setAttribute('aria-pressed', String(repo.focusRef === branch.ref)); branchLabels.append(control);
  }
  branches.append(branchLabels);
  repoHead.insertBefore(branches, layoutActions); section.append(history);
  scroll.scrollTop = scrollPosition.top; scroll.scrollLeft = scrollPosition.left;
  const inspector = el('section', 'git-inspector'); inspector.id = 'git-inspector'; section.append(inspector);
  renderGitDiff();
  applyGitLayout();
  if (messageSelection && $('git-commit-message')) { $('git-commit-message').focus({preventScroll:true}); $('git-commit-message').setSelectionRange(...messageSelection); }
}
function requestEngineering(type, options = {}) {
  const requestId = type === 'engineeringQuery' ? ++engineeringQueryId : ++engineeringRequestId;
  send({ ...options, type, projectKey: project, requestId });
}
function engineeringFilters() {
  return engineeringPreferences.get(project) || { query: '', module: '', target: '', depth: 3, offset: 0 };
}
function queryEngineering() {
  if (['architecture', 'impact'].includes(engineeringView) && engineeringResults.get(project)?.snapshot?.graph) requestEngineering('engineeringQuery', engineeringFilters());
}
function updateEngineering(patch) {
  engineeringPreferences.set(project, { ...engineeringFilters(), ...patch });
  persist();
  queryEngineering();
}
function switchEngineering(view) {
  engineeringView = view;
  persist();
  renderEngineering();
  queryEngineering();
}
function engineeringList(parent, heading, rows) {
  parent.append(el('h2', '', heading));
  const list = el('ul', 'engineering-list');
  for (const row of rows) { const item = el('li'); item.append(row); list.append(item); }
  parent.append(rows.length ? list : el('p', '', 'None in this snapshot.'));
}
function engineeringFile(file) {
  return button(file, 'quiet engineering-file', () => updateEngineering({ target: file }), 'Inspect ' + file);
}
const compact = n => n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
const svgNode = (name, attrs = {}) => { const n = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const linkObservers = new WeakMap();
// Draws SVG connectors between laid-out elements of one container and redraws when the container resizes.
function drawLinks(container, links) {
  const svg = svgNode('svg', { class: 'eng-links', 'aria-hidden': 'true' });
  container.prepend(svg);
  const paint = () => {
    // Read every rect before touching the SVG so one paint costs one layout.
    const box = container.getBoundingClientRect();
    const rects = links.map(link => [link.from.getBoundingClientRect(), link.to.getBoundingClientRect()]);
    svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
    const marker = svgNode('marker', { id: 'eng-arrow', viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '8', markerHeight: '8', markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' });
    marker.append(svgNode('path', { d: 'M0 0L8 4L0 8z', fill: 'context-stroke' }));
    const defs = svgNode('defs'); defs.append(marker);
    svg.replaceChildren(defs);
    for (const [index, link] of links.entries()) {
      const [a, b] = rects[index];
      if (!a.width || !b.width) continue;
      let d;
      if (link.horizontal) {
        // Single-column (narrow) layout stacks the lists; headings carry the direction instead of lines.
        if (a.right > b.left + 1) continue;
        const x1 = a.right - box.left, y1 = a.top + a.height / 2 - box.top, x2 = b.left - box.left, y2 = b.top + b.height / 2 - box.top, mid = (x1 + x2) / 2;
        d = `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
      } else if (Math.abs(a.top - b.top) < 4) {
        const x1 = a.left + a.width / 2 - box.left, x2 = b.left + b.width / 2 - box.left, y = a.top - box.top, lift = Math.min(36, 10 + Math.abs(x2 - x1) / 6);
        d = `M${x1} ${y}C${x1} ${y - lift} ${x2} ${y - lift} ${x2} ${y}`;
      } else {
        const down = a.top < b.top;
        const x1 = a.left + a.width / 2 - box.left, y1 = (down ? a.bottom : a.top) - box.top, x2 = b.left + b.width / 2 - box.left, y2 = (down ? b.top : b.bottom) - box.top, mid = (y1 + y2) / 2;
        d = `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
      }
      const path = svgNode('path', { d, class: 'eng-link' + (link.className ? ' ' + link.className : ''), 'marker-end': 'url(#eng-arrow)' });
      if (link.weight) path.style.strokeWidth = String(link.weight);
      if (link.key) path.dataset.key = link.key;
      svg.append(path);
    }
  };
  paint();
  linkObservers.get(container)?.disconnect();
  const observer = new ResizeObserver(() => requestAnimationFrame(paint));
  observer.observe(container);
  linkObservers.set(container, observer);
}
function inspectEngineeringFile(file) {
  engineeringPreferences.set(project, { ...engineeringFilters(), target: file });
  switchEngineering('architecture');
}
function renderEngineeringMap(content, map, selected) {
  const section = el('section', 'eng-map');
  const head = el('div', 'eng-map-head');
  const crumbs = el('nav', 'eng-crumbs'); crumbs.setAttribute('aria-label', 'Map folder');
  const parts = map.scope ? map.scope.split('/') : [];
  crumbs.append(button(groupProjects(data.sessions, data.projectCatalog).get(project)?.name || 'Project', 'quiet', () => updateEngineering({ module: '', offset: 0 }), 'Show the whole project'));
  parts.forEach((part, index) => {
    const scope = parts.slice(0, index + 1).join('/');
    crumbs.append(el('span', 'eng-crumb-sep', '/'), index === parts.length - 1 ? el('strong', '', part) : button(part, 'quiet', () => updateEngineering({ module: scope, offset: 0 }), 'Show ' + scope));
  });
  const legend = el('p', 'eng-legend');
  legend.append(el('span', 'eng-key eng-key-cycle', 'Import cycle'), el('span', 'eng-key eng-key-hot', 'Hotspot'), el('span', 'eng-key eng-key-size', 'Bar: share of lines'));
  head.append(el('h2', '', 'Dependency map'), crumbs);
  section.append(head, el('p', 'eng-caption', 'Each arrow points from code to what it imports, so foundations sit at the bottom. Select a folder to open it or a file to inspect it.'), legend);
  if (!map.nodes.length) { section.append(el('p', '', 'No JS or TS sources in this folder.')); content.append(section); return; }
  const canvas = el('div', 'eng-map-canvas');
  const maxLoc = Math.max(1, ...map.nodes.map(node => node.loc));
  const rows = new Map();
  for (const node of map.nodes) { if (!rows.has(node.layer)) rows.set(node.layer, []); rows.get(node.layer).push(node); }
  const elements = new Map();
  const degree = id => map.edges.filter(edge => edge.from === id || edge.to === id).length;
  for (const layer of [...rows.keys()].sort((a, b) => b - a)) {
    const row = el('div', 'eng-map-row');
    for (const node of rows.get(layer).sort((a, b) => degree(b) - degree(a) || b.loc - a.loc)) {
      const uses = map.edges.filter(edge => edge.from === node.id).length, usedBy = map.edges.filter(edge => edge.to === node.id).length;
      const folder = node.kind === 'folder';
      const label = `${node.name}${folder ? ' folder' : ''}, ${folder ? node.files + ' files, ' : ''}${node.loc} lines, imports ${uses}, imported by ${usedBy}` +
        (node.external.in || node.external.out ? `, ${node.external.in} importers and ${node.external.out} imports outside this folder` : '') +
        (node.cyclic ? ', in an import cycle' : '') + (node.hotspots ? ', contains a hotspot' : '') + (folder ? '. Open folder' : '. Inspect file');
      const item = button('', 'eng-node ' + node.kind, () => folder ? updateEngineering({ module: node.id.slice(0, -1), offset: 0 }) : updateEngineering({ target: node.target || node.id }), label);
      item.classList.toggle('cyclic', node.cyclic || node.cycles > 0);
      item.classList.toggle('hot', node.hotspots > 0);
      item.classList.toggle('selected', !!selected && ((node.paths || [node.id]).includes(selected) || (folder && selected.startsWith(node.id))));
      const name = el('span', 'eng-node-name', node.name + (folder ? '/' : ''));
      const meta = el('span', 'eng-node-meta', [folder && node.files + ' files', compact(node.loc) + ' lines', node.complexity && 'cx ' + compact(node.complexity)].filter(Boolean).join(' · '));
      const bar = el('span', 'eng-node-bar'); bar.style.inlineSize = Math.max(4, Math.round(node.loc / maxLoc * 100)) + '%';
      item.append(name, meta, bar);
      item.dataset.id = node.id;
      elements.set(node.id, item);
      row.append(item);
    }
    canvas.append(row);
  }
  if (map.hidden) canvas.append(el('p', 'eng-caption', `${map.hidden} smaller items are hidden. Open a folder to see them.`));
  section.append(canvas);
  content.append(section);
  const weight = count => 1.25 + Math.min(3, Math.log2(count));
  drawLinks(canvas, map.edges.map(edge => ({ from: elements.get(edge.from), to: elements.get(edge.to), weight: weight(edge.count), key: edge.from + '\0' + edge.to, className: edge.cyclic ? 'cyclic' : '' })));
  const highlight = id => {
    canvas.classList.toggle('tracing', !!id);
    const linked = new Set([id]);
    for (const edge of map.edges) if (edge.from === id || edge.to === id) { linked.add(edge.from); linked.add(edge.to); }
    for (const [key, node] of elements) node.classList.toggle('linked', !!id && linked.has(key));
    for (const path of canvas.querySelectorAll('.eng-link')) {
      const [from, to] = path.dataset.key.split('\0');
      path.classList.toggle('out', from === id); path.classList.toggle('in', to === id);
    }
  };
  for (const [id, node] of elements) {
    node.addEventListener('pointerenter', () => highlight(id)); node.addEventListener('focus', () => highlight(id));
    node.addEventListener('pointerleave', () => highlight(document.activeElement?.dataset?.id && elements.has(document.activeElement.dataset.id) ? document.activeElement.dataset.id : ''));
    node.addEventListener('blur', () => highlight(''));
  }
}
function engineeringTable(columns, rows) {
  const wrap = el('div', 'eng-table-wrap'), table = el('table', 'eng-table'), head = el('tr');
  for (const [label, numeric] of columns) { const cell = el('th', numeric ? 'num' : '', label); cell.scope = 'col'; head.append(cell); }
  const thead = el('thead'); thead.append(head);
  const body = el('tbody');
  for (const cells of rows) {
    const tr = el('tr');
    cells.forEach((cell, index) => { const td = el('td', columns[index][1] ? 'num' : ''); td.append(cell instanceof Node ? cell : document.createTextNode(String(cell))); tr.append(td); });
    body.append(tr);
  }
  table.append(thead, body); wrap.append(table);
  return wrap;
}
function meter(value, max, className = '') {
  const bar = el('span', 'eng-meter ' + className), fill = el('span');
  fill.style.inlineSize = Math.max(2, Math.round(Math.min(1, value / (max || 1)) * 100)) + '%';
  bar.append(fill);
  return bar;
}
function renderEngineeringQuality(content, summary) {
  const q = summary.insights;
  if (!q) { content.append(el('p', '', 'Refresh analysis to compute quality insights for this snapshot.')); return; }
  if (!engineeringEvidence(summary)) content.append(el('p', 'eng-caption', `No supported source files: complexity, cycles and test reach cover ${engineeringLanguages}. Line counts and commit history are shown.`));
  if (summary.generated) content.append(el('p', 'eng-caption', `${summary.generated} large generated data files (images, fonts, sounds) are listed but excluded from these figures.`));
  const untestedHot = q.hotspots.filter(item => q.untested.files.includes(item.file));
  const stats = el('dl', 'eng-stats');
  for (const [label, value, tone] of [
    ['Source lines', compact(q.loc)], ['Import cycles', q.cycles.length, q.cycles.length && 'bad'], ['Hotspots', q.hotspots.length, q.hotspots.length && 'warn'],
    ['Complex functions', q.functions.filter(fn => fn.complexity >= 20).length], ['No static importers', q.orphans.total],
    ['Not reached by tests', q.tests ? q.untested.total : 'No tests', untestedHot.length && 'warn'], ['Unresolved imports', summary.unresolved ?? 'n/a']
  ]) {
    const item = el('div', tone ? 'eng-stat ' + tone : 'eng-stat');
    item.append(el('dt', '', label), el('dd', '', String(value)));
    stats.append(item);
  }
  content.append(stats);

  const steps = [];
  for (const cycle of q.cycles.slice(0, 2)) {
    const loop = cycle.loop;
    if (!loop) { steps.push(['bad', `Break the import cycle across ${cycle.size} files`, cycle.files.slice(0, 4).join(', ') + (cycle.size > 4 ? ' …' : '') + '. Refresh analysis to see the import order and lines.', () => inspectEngineeringFile(cycle.files[0]), 'Inspect']); continue; }
    // Show the shared folder once so the chain reads as file names.
    let dir = loop[0].from.slice(0, loop[0].from.lastIndexOf('/') + 1);
    while (dir && !loop.every(edge => edge.from.startsWith(dir))) dir = dir.slice(0, dir.lastIndexOf('/', dir.length - 2) + 1);
    const name = file => file.slice(dir.length);
    const hops = loop.slice(0, 6).map(edge => `${name(edge.from)}:${edge.line}`).join(' → ') + (loop.length > 6 ? ' → …' : '') + ` → back to ${name(loop[0].from)}`;
    steps.push(['bad', loop.length === 1 ? `${loop[0].from} imports itself` : `Import cycle: ${loop.length} files load each other`,
      `${dir ? `In ${dir}: ` : ''}${hops}. Each file:line is where that file imports the next.${cycle.size > loop.length ? ` ${cycle.size} files are tangled in total; this is the shortest loop.` : ''}`,
      () => requestEngineering('engineeringOpen', { target: loop[0].from, line: loop[0].line }), 'Open',
      'Why it matters: whichever file loads first sees the others half-initialised, so imports can be undefined or throw “Cannot access before initialization”, and the outcome changes with load order. None of them can be tested, reused or code-split alone. Fix: cut the least-needed import by moving what both sides use into a new module, or make it type-only or a lazy import().']);
  }
  for (const item of untestedHot.slice(0, 2)) steps.push(['warn', `Add tests around ${item.file}`, `A hotspot with no test reaching it: ${item.loc} lines, complexity ${item.complexity ?? 'n/a'}, ${item.churn} recent commits.`, () => inspectEngineeringFile(item.file), 'Inspect',
    'Why it matters: it changes often and nothing catches a regression; start with tests for the paths that changed most recently.']);
  for (const fn of q.functions.filter(fn => fn.complexity >= 25).slice(0, 2)) steps.push(['warn', `Split ${fn.name}`, `${fn.file}:${fn.line} · ${fn.lines} lines with ${fn.complexity} branches.`, () => requestEngineering('engineeringOpen', { target: fn.file, line: fn.line }), 'Open',
    'Why it matters: every branch is a path to test, and bugs hide in combinations nobody runs; in a component it also re-renders as one unit. Fix: extract the independent cases into named helpers or child components.']);
  for (const item of q.hotspots.filter(item => !untestedHot.includes(item)).slice(0, 1)) steps.push(['warn', `Reduce change risk in ${item.file}`, `Among the most complex code and changed often (${item.churn} commits in 180 days).`, () => inspectEngineeringFile(item.file), 'Inspect',
    'Why it matters: each change touches code that is hard to reason about, so this is where regressions most likely come from. Fix: split it along the parts that change together, and cover them with tests first.']);
  if (q.orphans.total) steps.push(['info', `Review ${q.orphans.total} files with no static importer`, 'Nothing imports them, so they are dead code unless loaded at runtime (HTML, config, framework routes, dynamic import).', () => { const details = $('eng-orphans'); details.open = true; details.scrollIntoView({ block: 'nearest' }); }, 'Show',
    'Why it matters: dead files still get reviewed, updated and searched, and mislead readers about what runs. Fix: confirm the runtime loader or delete them.']);
  if (summary.unresolved) steps.push(['info', `Check ${summary.unresolved} unresolved imports`, 'Packages and runtime paths stay unresolved; local ones may point to missing files.', () => switchEngineering('architecture'), 'Architecture']);
  content.append(el('h2', '', 'Where to start'));
  if (!steps.length) content.append(el('p', '', 'No cycles, hotspots or untested complex code found in this snapshot.'));
  else {
    const list = el('ol', 'eng-steps');
    for (const [tone, title, detail, action, actionLabel, why] of steps.slice(0, 6)) {
      const item = el('li', 'eng-step ' + tone), text = el('div');
      text.append(el('strong', '', title), el('p', '', detail));
      if (why) text.append(el('p', '', why));
      item.append(text, button(actionLabel, 'quiet', action, `${actionLabel}: ${title}`));
      list.append(item);
    }
    content.append(list);
  }

  content.append(el('h2', '', 'Hotspots'), el('p', 'eng-caption', q.churn ? 'Complexity × commits in the last 180 days. High scores change often and are hard to change safely.' : 'Ranked by complexity. Commit history was unavailable.'));
  const top = q.hotspots[0]?.score || 1;
  content.append(q.hotspots.length ? engineeringTable([['File'], ['Lines', 1], ['Complexity', 1], ['Commits', 1], ['Imported by', 1], ['Risk']],
    q.hotspots.map(item => [engineeringFileButton(item.file), item.loc, item.complexity ?? '–', item.churn, item.importers, meter(item.score, top, 'warn')])) : el('p', '', 'None in this snapshot.'));

  content.append(el('h2', '', 'Complex functions'), el('p', 'eng-caption', 'Branch count (if, loops, cases, catch, &&, ||, ??) per function body. Above 20 is hard to test exhaustively.'));
  const maxFn = q.functions[0]?.complexity || 1;
  content.append(q.functions.length ? engineeringTable([['Function'], ['Location'], ['Lines', 1], ['Branches', 1], ['']],
    q.functions.slice(0, 12).map(fn => [fn.name, button(`${fn.file}:${fn.line}`, 'quiet engineering-file', () => requestEngineering('engineeringOpen', { target: fn.file, line: fn.line }), `Open ${fn.name} in ${fn.file} at line ${fn.line}`),
      fn.lines, fn.complexity, meter(fn.complexity, maxFn, fn.complexity >= 20 ? 'warn' : '')])) : el('p', '', 'No function exceeds 60 lines or 10 branches.'));

  content.append(el('h2', '', 'Folder coupling'), el('p', 'eng-caption', 'Instability = imports out ÷ (imports in + out). Near 0 is a stable foundation others rely on; keep its API small. Near 1 depends on others and is cheap to change.'));
  content.append(engineeringTable([['Folder'], ['Files', 1], ['Lines', 1], ['Used by', 1], ['Uses', 1], ['Instability']],
    q.folders.map(folder => {
      const cell = el('span', 'eng-instability');
      cell.append(meter(folder.instability ?? 0, 1), el('span', '', folder.instability == null ? 'isolated' : folder.instability.toFixed(2)));
      return [button(folder.folder, 'quiet engineering-file', () => { engineeringPreferences.set(project, { ...engineeringFilters(), module: folder.folder === '(root)' ? '' : folder.folder, offset: 0 }); switchEngineering('architecture'); }, 'Show ' + folder.folder + ' on the dependency map'),
        folder.files, compact(folder.loc), folder.afferent, folder.efferent, cell];
    })));

  content.append(el('h2', '', 'Import cycles'));
  if (!q.cycles.length) content.append(el('p', '', engineeringEvidence(summary) ? 'No import cycles found.' : 'Unavailable without supported source files.'));
  else {
    const list = el('ul', 'engineering-list');
    for (const cycle of q.cycles) {
      const item = el('li', 'eng-cycle');
      cycle.files.forEach((file, index) => { if (index) item.append(el('span', 'eng-crumb-sep', '→')); item.append(engineeringFileButton(file)); });
      if (cycle.size > cycle.files.length) item.append(el('span', 'eng-caption', `+${cycle.size - cycle.files.length} more`));
      list.append(item);
    }
    content.append(list);
  }
  for (const [id, title, set, caption] of [
    ['eng-orphans', 'No static importers', q.orphans, 'Not imported by any indexed file and not a package.json entry. Runtime-loaded files appear here too.'],
    ['eng-untested', 'Not reached by tests', q.untested, q.tests ? 'No test file imports these, directly or transitively. Largest first.' : 'No test files were detected.']
  ]) {
    const details = el('details', 'eng-details'); details.id = id;
    const summaryRow = el('summary', '', `${title} · ${set.total}`);
    details.append(summaryRow, el('p', 'eng-caption', caption));
    const list = el('ul', 'engineering-list');
    for (const file of set.files) { const item = el('li'); item.append(engineeringFileButton(file)); list.append(item); }
    if (set.files.length) details.append(list);
    if (set.total > set.files.length) details.append(el('p', 'eng-caption', `Showing ${set.files.length} of ${set.total}.`));
    content.append(details);
  }
}
function engineeringFileButton(file) {
  return button(file, 'quiet engineering-file', () => inspectEngineeringFile(file), 'Inspect ' + file + ' on the Architecture view');
}
const engineeringLanguages = 'JS/TS, Python, C/C++, Java, Kotlin, C#, Go, Rust, Swift, PHP, Ruby, MATLAB and other common languages';
const engineeringEvidence = summary => !!(summary.engine && summary.sourceFiles) || !!summary.languages?.length;
function unanalyzedReason(file) {
  if (/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|ino)$/i.test(file)) return 'Large generated data (over 128 KB, such as an image, font or sound array): listed but not analyzed.';
  if (/\.[cm]?[jt]sx?$/i.test(file)) return 'JS and TS analysis needs the TypeScript compiler bundled with VS Code, which this snapshot could not load.';
  const ext = /\.([^./]+)$/.exec(file)?.[1];
  return `${ext ? '.' + ext + ' files are' : 'This file is'} not analyzed. Dependencies and quality cover ${engineeringLanguages}.`;
}
function renderEngineeringGraph(content, graph, indexed) {
  const evidence = engineeringEvidence(indexed);
  if (engineeringView === 'architecture' && graph?.map && evidence) renderEngineeringMap(content, graph.map, graph.selected);
  if (!engineeringGraph?.selected) {
    content.append(el('p', '', engineeringView === 'impact' ? 'Select a target file to trace its dependents.' : 'Select a file to explore its dependency neighborhood.'));
  }
  if (!graph) { content.append(el('p', '', 'Reading indexed files…')); return; }
  const filters = engineeringFilters();
  const { selected } = graph;
  if (!selected && filters.target) content.append(el('p', '', 'The target is absent from this snapshot. Impact for deleted or renamed paths requires earlier evidence.'));
  if (selected) {
    const toolbar = el('div', 'engineering-toolbar engineering-target');
    const actions = el('div', 'engineering-actions');
    actions.append(button('Open file', 'quiet', () => requestEngineering('engineeringOpen', { target: selected })));
    const analyzed = evidence && !!graph.metrics;
    if (engineeringView === 'architecture' && analyzed) actions.append(button('Analyze impact', 'quiet', () => switchEngineering('impact')));
    if (engineeringView === 'impact' && analyzed) actions.append(button('Copy agent brief', 'quiet', () => requestEngineering('engineeringCopy', filters)));
    toolbar.append(el('h2', 'engineering-path', engineeringView === 'architecture' ? 'Dependency neighborhood' : selected), actions);
    content.append(toolbar);
    if (!evidence) {
      content.append(el('p', 'eng-notice', indexed.sourceFiles ? unanalyzedReason('.js') : `No supported source files in this snapshot. Dependencies and quality cover ${engineeringLanguages}.`));
    } else if (!graph.metrics && indexed.languages) {
      content.append(el('p', 'eng-notice', unanalyzedReason(selected)));
    } else {
      const relationship = (edge, other, distance) => {
        const row = el('div', 'engineering-relationship');
        row.append(engineeringFile(other), button(`${edge.from}:${edge.line}${distance ? ' · depth ' + distance : ''}`, 'quiet engineering-file',
          () => requestEngineering('engineeringOpen', { target: edge.from, destination: edge.to, line: edge.line }), `Open import evidence in ${edge.from} at line ${edge.line}`));
        return row;
      };
      if (engineeringView === 'architecture') {
        const neighborhood = el('div', 'engineering-neighborhood');
        const dependents = el('section'), focus = el('section', 'eng-focus'), dependencies = el('section');
        engineeringList(dependents, `Imported by · ${graph.direct.length}`, graph.direct.map(edge => relationship(edge, edge.from)));
        focus.append(el('h2', '', 'Selected file'), el('p', 'engineering-path', selected));
        const m = graph.metrics;
        if (m) focus.append(el('p', 'eng-meta', [m.loc + ' lines', m.complexity != null && 'complexity ' + m.complexity, m.churn + ' commits in 180 days'].filter(Boolean).join(' · ')));
        if (graph.companions?.length) {
          // Headers carry the importers of a C/C++ unit; link the pair so both sides are one click away.
          const pair = el('p', 'eng-meta', 'Paired with ');
          graph.companions.forEach(file => pair.append(engineeringFile(file)));
          focus.append(pair);
        }
        engineeringList(dependencies, `Imports · ${graph.dependencies.length}`, graph.dependencies.map(edge => relationship(edge, edge.to)));
        neighborhood.append(dependents, focus, dependencies);
        content.append(neighborhood);
        // Connect each relationship row to the selected file: importers flow in from the left, imports flow out to the right.
        drawLinks(neighborhood, [
          ...[...dependents.querySelectorAll('li')].map(item => ({ from: item, to: focus, horizontal: true })),
          ...[...dependencies.querySelectorAll('li')].map(item => ({ from: focus, to: item, horizontal: true }))
        ]);
      } else {
        engineeringList(content, 'Direct dependencies', graph.dependencies.map(edge => relationship(edge, edge.to)));
        engineeringList(content, 'Dependents by depth', graph.dependents.map(edge => relationship(edge, edge.from, edge.distance)));
        engineeringList(content, 'Candidate tests', graph.tests.map(engineeringFile));
        content.append(el('p', '', 'Affected folders · ' + graph.affected.join(', ')),
          el('p', '', 'Risk requires review of runtime behavior, external callers and missing historical evidence.'));
      }
      if (graph.cycle) content.append(el('p', '', 'A dependency cycle reaches the selected file within the trace depth.'));
      if (graph.unresolved.length) engineeringList(content, 'Unresolved or external references', graph.unresolved);
      if (graph.capped) content.append(el('p', '', 'The trace reached its display limit.'));
    }
  }
  const unanalyzed = new Set(graph.unanalyzed || []);
  engineeringList(content, 'Indexed files', graph.files.map(file => {
    if (!unanalyzed.has(file)) return engineeringFile(file);
    const row = el('span', 'eng-unanalyzed');
    row.append(engineeringFile(file), el('span', 'eng-tag', 'not analyzed'));
    return row;
  }));
  if (graph.total > 60) {
    const pages = el('div', 'engineering-actions');
    const offset = filters.offset || 0;
    pages.append(button('Previous', 'quiet', () => updateEngineering({ offset: offset - 60 })),
      el('span', '', `${offset + 1}–${Math.min(offset + 60, graph.total)} of ${graph.total}`),
      button('Next', 'quiet', () => updateEngineering({ offset: offset + 60 })));
    pages.firstChild.disabled = !offset;
    pages.lastChild.disabled = offset + 60 >= graph.total;
    content.append(pages);
  }
}
function renderEngineering() {
  const result = engineeringResults.get(project);
  const snapshot = result?.snapshot;
  const state = result?.state === 'Current' && snapshot?.graph?.partial ? 'Partial coverage' : result?.state;
  $('engineering-status').textContent = [state || 'Reading snapshot…', snapshot && fullDate(snapshot.time), result?.error].filter(Boolean).join(' · ');
  $('engineering-refresh').disabled = ['Analyzing', 'Unsupported'].includes(result?.state);
  $('engineering-cancel').hidden = result?.state !== 'Analyzing';
  $('engineering-clear').hidden = !snapshot || result?.state === 'Analyzing';
  for (const tab of document.querySelectorAll('[data-engineering-view]')) tab.setAttribute('aria-pressed', String(tab.dataset.engineeringView === engineeringView));
  const useGraph = ['architecture', 'impact'].includes(engineeringView) && !!snapshot?.graph;
  $('engineering-brief').hidden = engineeringView !== 'quality' || !snapshot?.graph?.insights;
  $('engineering-mcp').hidden = result?.state === 'Unsupported';
  const filters = engineeringFilters();
  $('engineering-filters').hidden = !useGraph;
  $('engineering-depth-label').hidden = engineeringView !== 'impact';
  $('engineering-search').value = filters.query;
  $('engineering-depth').value = String(filters.depth);
  const folders = engineeringGraph?.modules || [];
  $('engineering-module').replaceChildren(new Option('All folders', ''), ...folders.map(name => new Option(name, name)),
    ...(filters.module && !folders.includes(filters.module) ? [new Option(filters.module, filters.module)] : []));
  $('engineering-module').value = filters.module;
  const content = $('engineering-content');
  const previousFocus = content.contains(document.activeElement) && document.activeElement.getAttribute('aria-label');
  content.replaceChildren();
  if (!snapshot) {
    if (result?.state === 'Never analyzed') content.append(el('p', '', 'Refresh analysis to capture local repository evidence.'));
    return;
  }
  if (engineeringView === 'quality') {
    if (snapshot.graph) renderEngineeringQuality(content, snapshot.graph);
    else content.append(el('p', '', 'Quality insights require a local Git worktree with an analysis snapshot.'));
    return;
  }
  if (engineeringView !== 'overview') {
    if (useGraph) renderEngineeringGraph(content, engineeringGraph, snapshot.graph);
    else content.append(el('p', '', 'File indexing requires a local Git worktree with an analysis snapshot.'));
    if (previousFocus) [...content.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === previousFocus)?.focus({ preventScroll: true });
    return;
  }
  const repo = snapshot.repo;
  content.append(el('h2', '', 'Repository'), el('p', 'engineering-path', repo?.root || snapshot.cwd));
  if (!repo) { content.append(el('p', '', 'No Git repository found.')); return; }
  content.append(el('p', '', [repo.branch || 'Unborn branch', repo.head?.slice(0, 12), repo.subject].filter(Boolean).join(' · ')));
  const counts = Object.entries(repo.counts).filter(([, count]) => count).map(([name, count]) => count + ' ' + name);
  content.append(button(counts.join(' · ') || 'Clean working tree', 'quiet', () => selectProjectView(true), 'Review working tree changes'));
  if (snapshot.graph) {
    const summary = snapshot.graph;
    content.append(el('h2', '', 'Architecture'),
      button(`${summary.files} files · ${summary.modules} folders${engineeringEvidence(summary) ? ' · ' + summary.edges + ' resolved imports' : ''}`, 'quiet', () => switchEngineering('architecture')),
      el('p', '', engineeringEvidence(summary)
        ? `${(summary.languages || ['JS/TS']).join(', ')}${summary.engine ? ' (TypeScript ' + summary.engine + ')' : ''} · ${summary.unresolved} unresolved or external imports${summary.partial ? ' · Partial coverage' : ''}`
        : 'File metadata available. Static JS/TS dependency evidence is unavailable.'));
    const q = summary.insights;
    if (q) content.append(el('h2', '', 'Code quality'), button([
      q.cycles.length ? q.cycles.length + ' import cycles' : 'No import cycles', q.hotspots.length + ' hotspots',
      q.functions.filter(fn => fn.complexity >= 20).length + ' complex functions', q.tests ? q.untested.total + ' files not reached by tests' : 'No tests detected'
    ].join(' · '), 'quiet', () => switchEngineering('quality'), 'Review code quality'));
  }
  const recent = data.sessions.filter(session => projectGroupKey(session) === project).sort((a,b) => b.updatedAt - a.updatedAt).slice(0, 4);
  engineeringList(content, 'Recent conversations', recent.map(session => button(session.title, 'quiet engineering-file', () => {
    selectProjectView(false);
    select(session);
  })));
}
function selectGitDiff(selection) {
  gitSelection = selection; gitDiffResult = null;
  send({type:'gitDiff',projectKey:project,requestId:++gitDiffId,...selection});
  renderGit();
  const target = selection.mode === 'commit' ? [...document.querySelectorAll('.git-commit')].find(n => n.dataset.commit === selection.commit) : document.querySelector(`#git-inspector [data-diff-mode="${selection.mode}"]`);
  target?.focus({preventScroll:true});
}
function gitFileStatus(code) {
  if (/^(DD|AU|UD|UA|DU|AA|UU)$/.test(code)) return ['U', 'Unmerged'];
  if (code === '??' || code.includes('A')) return ['N', 'New'];
  for (const [letter, label] of [['R','Renamed'],['C','Copied'],['D','Deleted'],['T','Type changed'],['M','Modified']]) {
    if (code.includes(letter)) return [letter, label];
  }
  return [];
}
function renderGitDiff() {
  const inspector = $('git-inspector'); if (!inspector) return;
  const messageSelection = document.activeElement?.id === 'git-commit-message' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const focused = inspector.contains(document.activeElement) ? document.activeElement : null;
  inspector.replaceChildren();
  const head = el('div', 'git-heading'); head.append(el('h3', '', gitSelection.mode === 'commit' ? 'Viewing commit ' + gitSelection.commit.slice(0,7) : 'Local changes'));
  const controls = el('div', 'segments');
  controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Local change comparison');
  for (const [mode,label] of [['all','All'],['working','Unstaged'],['staged','Staged'],['untracked','Untracked']]) {
    const control = button(label, gitSelection.mode===mode?'active':'', () => selectGitDiff({mode}));
    control.setAttribute('aria-pressed',String(gitSelection.mode===mode)); control.dataset.diffMode = mode; controls.append(control);
  }
  head.append(gitHeightControl('diff', 'Diff'), controls); inspector.append(head);
  const repo = gitResult?.dashboard;
  let candidates = [];
  if (repo && gitSelection.mode !== 'commit') {
    const staged = repo.changes.filter(change => ![' ', '?'].includes(change.code[0]));
    const unstaging = gitSelection.mode === 'staged';
    candidates = repo.changes.filter(({code}) => unstaging ? ![' ', '?'].includes(code[0])
      : code === '??' ? gitSelection.mode !== 'working' : gitSelection.mode !== 'untracked' && code[1] !== ' ');
    const all = button(unstaging ? 'Unstage all' : 'Stage all', 'quiet', () => startGitOperation(unstaging ? 'unstage' : 'stage', {files:candidates.map(change => change.file)}));
    all.disabled = !!gitOperation || !candidates.length; all.title = unstaging ? 'Unstage all staged files; keep working files' : 'Stage all files in this comparison'; head.append(all);
    const form = el('form', 'git-commit-form');
    const label = el('label', '', 'Commit message'); label.htmlFor = 'git-commit-message';
    const message = el('textarea'); message.id = 'git-commit-message'; message.name = 'commit-message'; message.rows = 2; message.maxLength = 10000; message.required = true;
    message.placeholder = 'Describe your changes'; message.autocomplete = 'off'; message.value = gitCommitDrafts.get(project) || '';
    const submit = el('button', 'primary', `Commit staged (${staged.length})`); submit.type = 'submit';
    const reason = repo.branch === 'Detached HEAD' ? 'Check out a branch before committing' : staged.length ? '' : 'Stage files to include in this commit';
    submit.title = reason || `Commit staged changes on ${repo.branch}`;
    const update = () => { submit.disabled = !!gitOperation || !!reason || !message.value.trim(); };
    message.addEventListener('input', () => { gitCommitDrafts.set(project, message.value); persist(); update(); }); update();
    form.addEventListener('submit', event => { event.preventDefault(); if (!submit.disabled) startGitOperation('commit', {message:message.value}); });
    const field = el('div', 'git-commit-field'); field.append(label, message); form.append(field, submit); inspector.append(form);
    if (messageSelection) { message.focus({preventScroll:true}); message.setSelectionRange(...messageSelection); }
  }
  if (focused?.dataset.diffMode) [...controls.children].find(item => item.dataset.diffMode === focused.dataset.diffMode)?.focus({preventScroll:true});
  if (gitSelection.mode === 'commit') inspector.append(el('p','git-caption','Changes against the first parent; root commits show all additions.'));
  if (!gitDiffResult || gitDiffResult.error) {
    const notice = el('p','notice',gitDiffResult?.error || 'Loading comparison...'); notice.setAttribute('role','status'); inspector.append(notice); return;
  }
  const diff = gitDiffResult.diff;
  if (!diff.files.length) { inspector.append(el('p','notice','No files changed in this comparison.')); return; }
  const pane = el('div','git-diff-layout'), files = el('nav','git-files');
  files.append(el('div', 'git-files-heading', `Changed files (${diff.files.length})`)); files.setAttribute('aria-label','Changed files');
  const codes = new Map((diff.changes || []).map(({file, code}) => [file, code]));
  for (const file of diff.files) {
    const item = button('', file===diff.file?'active':'', () => selectGitDiff({...gitSelection,file}));
    const [letter, label] = gitFileStatus(codes.get(file) || '');
    item.dataset.diffFile = file;
    item.title = label ? `${file} · ${label}` : file;
    item.setAttribute('aria-current',String(file===diff.file));
    if (letter) {
      const badge = el('span', 'git-file-status', letter);
      badge.dataset.status = letter;
      badge.setAttribute('aria-hidden', 'true');
      item.setAttribute('aria-label', `${file}, ${label}`);
      item.append(badge);
    }
    item.append(el('span', 'git-file-path', file)); files.append(item);
  }
  const content = el('div','git-diff-content'), fileHead = el('div', 'git-file-heading');
  fileHead.append(el('h4','',diff.file));
  fileHead.append(button('Analyze impact', 'quiet', () => {
    engineeringPreferences.set(project, { ...engineeringFilters(), target: diff.file });
    engineeringView = 'impact';
    engineeringOpen = true;
    gitOpen = false;
    persist();
    render();
  }));
  if (gitSelection.mode !== 'commit') {
    const unstaging = gitSelection.mode === 'staged' || (gitSelection.mode === 'all' && !candidates.some(change => change.file === diff.file));
    const stage = button(unstaging ? 'Unstage file' : 'Stage file', 'quiet git-stage-file', () => startGitOperation(unstaging ? 'unstage' : 'stage', {files:[diff.file]}));
    stage.disabled = !!gitOperation || (unstaging && gitSelection.mode === 'all' && !repo?.changes.some(({file, code}) => file === diff.file && ![' ', '?'].includes(code[0])));
    fileHead.append(stage);
  }
  const wrap = button('Wrap lines', 'quiet git-wrap-toggle', () => { gitWrap = !gitWrap; applyGitLayout(); persist(); });
  wrap.setAttribute('aria-pressed', String(gitWrap)); fileHead.append(wrap); content.append(fileHead);
  if (diff.truncated) content.append(el('p','notice','Preview limited to 512 KB. Open the file in your editor to inspect the rest.'));
  const patch = el('pre','git-patch'); patch.tabIndex=0; patch.setAttribute('aria-label','File diff');
  let oldLine=0,newLine=0, additions=0, deletions=0, inHunk=false;
  const lines = (diff.patch || 'No text changes (the file may have only metadata changes).').split('\n');
  const hasHunks = lines.some(line => /^@@ /.test(line));
  for (const line of lines) {
    if (hasHunks && !inHunk && !line.startsWith('@@ ')) continue;
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (hunk) { oldLine=Number(hunk[1]);newLine=Number(hunk[2]); inHunk=true; }
    if (line.startsWith('@@ New untracked')) { newLine=1; inHunk=true; }
    const added=inHunk&&line.startsWith('+'), removed=inHunk&&line.startsWith('-'), context=inHunk&&line.startsWith(' ');
    if (added) additions++; if (removed) deletions++;
    const row=el('span', 'git-diff-line'+(added?' added':removed?' removed':hunk?' hunk':''));
    row.append(el('span','git-line-number',(removed||context)&&oldLine?String(oldLine++):''),el('span','git-line-number',(added||context)&&newLine?String(newLine++):''),el('span','git-code',line)); patch.append(row);
  }
  const stats = el('span', 'git-diff-stats'); stats.setAttribute('aria-label', `${additions} added lines, ${deletions} deleted lines in preview`);
  stats.append(el('span', 'git-added-count', '+' + additions), el('span', 'git-removed-count', '-' + deletions)); fileHead.append(stats);
  content.append(patch); pane.append(files,content); inspector.append(pane);
  // Live refreshes rebuild this pane; keep the reader's place in the same file.
  if (gitDiffScroll.file === diff.file) { content.scrollTop = gitDiffScroll.top; content.scrollLeft = gitDiffScroll.left; files.scrollTop = gitDiffScroll.list; }
  else gitDiffScroll = { file: diff.file, top: 0, left: 0, list: 0 };
  content.addEventListener('scroll', () => { gitDiffScroll.top = content.scrollTop; gitDiffScroll.left = content.scrollLeft; }, { passive: true });
  files.addEventListener('scroll', () => { gitDiffScroll.list = files.scrollTop; }, { passive: true });
  const focusFile = focused?.dataset.diffFile || (focused?.dataset.diffMode === gitSelection.mode && gitSelection.file);
  const nextFocus = focusFile ? [...files.querySelectorAll('button')].find(item => item.dataset.diffFile === focusFile)
    : focused && !focused.dataset.diffMode && [...inspector.querySelectorAll('button')].find(item => item.textContent === focused.textContent);
  if (nextFocus) nextFocus.focus({preventScroll:true});
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
  const pageScroll = captureScrollPosition();
  selected = s.key; persist();
  if (!open) { detailKey = s.key; excerpts = null; sampled = false; $('detail').hidden = false; renderDetail(); }
  send({ type: open ? 'open' : 'select', key: s.key }); render(pageScroll);
  if (!open) $('detail').querySelector('.detail-head button').focus({ preventScroll: true });
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
  meta.insertBefore(indicator, meta.querySelector('.card-times'));
}
function syncProjectRunning() {
  const counts = new Map();
  for (const session of data.sessions) if (session.running) {
    const key = projectGroupKey(session); counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const row of $('projects').querySelectorAll('.project-entry')) {
    const count = counts.get(row.dataset.project) || 0;
    const previous = row.querySelector('.project-run-indicator');
    const nav = row.querySelector('.nav'), status = `${count} running ${count === 1 ? 'task' : 'tasks'}`;
    nav.setAttribute('aria-label', `${nav.dataset.projectLabel}${count ? `, ${status}` : ''}`);
    if (!count) { previous?.remove(); continue; }
    const indicator = previous || el('span', 'run-indicator project-run-indicator');
    indicator.setAttribute('role', 'img'); indicator.setAttribute('aria-label', status); indicator.title = status;
    if (!previous) row.querySelector('.project-name-row').append(indicator);
  }
}
function card(s) {
  const c = el('article', `card${s.status === 'Done' ? ' done' : ''}${selected === s.key ? ' selected' : ''}${s.running ? ' running' : ''}`);
  c.dataset.key = s.key; c.draggable = true;
  c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', s.key); e.dataTransfer.effectAllowed = 'move'; });
  const meta = el('div', 'card-meta');
  const pick = el('input', 'task-select'); pick.type = 'checkbox'; pick.checked = batchSelection.has(s.key);
  pick.dataset.action = 'batch'; pick.setAttribute('aria-label', `Select ${s.title}`);
  pick.addEventListener('change', () => { if (pick.checked) batchSelection.add(s.key); else batchSelection.delete(s.key); render(); });
  c.classList.toggle('batch-selected', batchSelection.has(s.key));
  meta.append(el('span', `provider-icon ${s.provider}`, s.provider === 'codex' ? 'C' : '✳'), el('span', '', providerName(s.provider)));
  const time = el('time', 'card-created', shortDate(s.createdAt)); time.dateTime = new Date(s.createdAt).toISOString();
  const updatedAt = s.updatedAt || s.createdAt, updated = el('time', 'card-updated', `Active ${activityAge(updatedAt)}`); updated.dateTime = new Date(updatedAt).toISOString();
  const times = el('span', 'card-times'); times.append(time, updated);
  meta.title = `Created ${fullDate(s.createdAt)} · Last activity ${fullDate(updatedAt)}`; meta.append(times);
  const title = button(s.title, 'card-open', () => select(s, true), `Resume ${s.title}`); title.dataset.action = 'open';
  const body = el('div', 'card-body');
  body.append(title);
  const nextStep = project && s.note && ['Waiting','In progress'].includes(s.status);
  if (nextStep) body.append(el('p', 'card-preview', 'Next · ' + s.note));
  else if (s.preview || s.note) body.append(el('p', 'card-preview', s.preview || s.note));
  const bottom = el('div', 'card-bottom'), label = el('label');
  const checkbox = el('input', 'done-checkbox'); checkbox.type = 'checkbox'; checkbox.checked = s.status === 'Done'; checkbox.setAttribute('aria-label', `Mark ${s.title} ${checkbox.checked ? 'unfinished' : 'done'}`); checkbox.dataset.action = 'done';
  checkbox.addEventListener('change', () => update(s, { done: checkbox.checked })); label.append(checkbox, document.createTextNode('Done')); bottom.append(label);
  const info = button('Details', 'info', () => select(s), `Details for ${s.title}`); info.dataset.action = 'detail';
  const pin = button(s.pinned ? '★' : '☆', '', () => update(s, { pinned: !s.pinned }), `${s.pinned ? 'Unpin' : 'Pin'} ${s.title}`); pin.dataset.action = 'pin'; pin.setAttribute('aria-pressed', String(!!s.pinned));
  if (query.trim() && query.trim().toLowerCase().split(/\s+/).some(word => s.searchText?.includes(word))) {
    bottom.append(button('Passages','info',() => send({type:'passages',key:s.key,query}), 'Find matching passages in ' + s.title));
  }
  bottom.append(info, pin);
  const folder = showSubfolders ? effectiveSubfolder(s, data.subfolders?.[projectGroupKey(s)] || []) : '';
  const projectName = folder ? `${s.project} / ${folder}` : s.project;
  const projectLabel = el('div', 'card-project');
  projectLabel.append(el('span', 'card-project-name', projectName));
  projectLabel.title = projectName;
  if (s.status !== 'Inbox' && s.status !== 'Done') projectLabel.append(el('span', 'status', s.status));
  if (s.seenAt > 0 && s.updatedAt > s.seenAt) projectLabel.append(el('span', 'activity', 'Updated'));
  c.append(pick, body, projectLabel, meta, bottom);
  setCardRunning(c, s.running);
  return c;
}
function render(pageScroll = captureScrollPosition()) {
  const board = $('board');
  const activeEl = document.activeElement;
  const focusKey = activeEl?.closest('.card')?.dataset.key, focusAction = activeEl?.dataset.action;
  const focusColumn = activeEl?.classList.contains('column-focus') ? activeEl.closest('.column').dataset.group : '';
  const projectFocus = activeEl?.closest('#projects') && activeEl.getAttribute('aria-label');
  syncSidebar();
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
  const sidebarProjects = ordered.filter(([key, p]) => !hiddenProjects.includes(key) && (p.count > 0 || p.created || key === project));
  $('project-sort').value = projectSort;
  $('subfolder-toggle').textContent = showSubfolders ? 'Hide subfolders' : 'Show subfolders';
  $('subfolder-toggle').setAttribute('aria-pressed', String(showSubfolders));
  $('projects').replaceChildren(...sidebarProjects.flatMap(([key, p], index) => {
    const row = el('div', 'project-entry'); row.dataset.project = key;
    const b = button('', `nav${project === key && subfolderFilter === null ? ' active' : ''}`, () => chooseProject(key));
    if (project === key && subfolderFilter === null) b.setAttribute('aria-current', 'true');
    b.title = [p.name, ...p.folders.values()].join('\n');
    b.setAttribute('aria-label', `${p.name}${p.showPath && p.folders.size ? `, ${[...p.folders.keys()][0]}` : ''}, ${p.count} conversations`);
    b.dataset.projectLabel = b.getAttribute('aria-label');
    const label = el('span', 'project-label');
    const nameRow = el('span', 'project-name-row'); nameRow.append(el('span', 'project-name', p.name));
    label.append(nameRow);
    if (p.showPath) label.append(el('span', 'project-path', [...p.folders.keys()][0] || (p.isBoardProject ? 'Board project' : 'No project folder')));
    b.append(label, el('span', 'project-count', String(p.count)));
    const actions = el('div', 'project-actions');
    const identity = `${p.name}${p.showPath && p.folders.size ? ` (${[...p.folders.keys()][0]})` : ''}`;
    if (projectSort === 'manual') {
      b.title += '\nDrag to reorder · Alt+Up/Down moves this project';
      b.addEventListener('keydown', e => {
        if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const after = e.key === 'ArrowDown', target = sidebarProjects[index + (after ? 1 : -1)];
        if (target) reorderProject(key, target[0], after);
      });
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
        const nav = button('', `nav${project === key && subfolderFilter === name ? ' active' : ''}`, () => chooseProject(key, name), `${p.name} / ${label}, ${count} conversations`);
        if (project === key && subfolderFilter === name) nav.setAttribute('aria-current', 'true');
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
  syncProjectRunning();
  if (projectFocus) [...$('projects').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === projectFocus)?.focus({ preventScroll: true });
  renderHiddenProjects(projects);
  $('total').textContent = data.sessions.length;
  $('all-projects').classList.toggle('active', !project);
  $('all-projects').setAttribute('aria-current', String(!project));
  const projectName = projects.get(project)?.name || 'Project conversations';
  $('heading').textContent = project ? `${projectName}${subfolderFilter === null ? '' : ` / ${subfolderFilter || 'Project root'}`}` : 'All conversations';
  const projectFolder = data.projectCatalog.find(p => p.key === project)?.cwd || '';
  $('project-location').hidden = !project;
  const shownFolder = projectFolder && subfolderFilter ? `${projectFolder.replace(/[\\/]+$/, '')}/${subfolderFilter}` : projectFolder;
  $('open-project-folder').hidden = !projectFolder;
  $('open-project-folder').title = shownFolder ? `Open ${shownFolder} in Windows Explorer` : '';
  $('project-folder-path').textContent = shownFolder || 'No folder linked';
  $('project-folder-path').title = shownFolder;
  $('link-project-folder').hidden = !project.startsWith('custom:') && !projectFolder;
  $('link-project-folder').textContent = projectFolder ? 'Reconnect folder\u2026' : 'Link folder\u2026';
  $('new-chat').hidden = !project;
  $('new-chat').title = projectFolder ? `New chat in ${projectName}` : 'Link a folder to start a chat';
  const scoped = data.sessions.filter(s => !project || (projectGroupKey(s) === project && (subfolderFilter === null || effectiveSubfolder(s, data.subfolders?.[project] || []) === subfolderFilter)));
  const done = scoped.filter(s => s.status === 'Done').length;
  const projectCount = ordered.filter(([, p]) => p.count > 0 || p.created).length;
  const open = scoped.length - done;
  $('summary').textContent = data.busy && !data.sessions.length ? 'Reading local conversations…'
    : `${open} open · ${done} finished${project ? '' : ` · ${projectCount} project${projectCount === 1 ? '' : 's'}`}`;
  $('done-count').textContent = done;
  $('refresh').disabled = data.busy;
  $('refresh').title = data.busy ? 'Syncing…' : 'Refresh';
  $('refresh').setAttribute('aria-label', $('refresh').title);
  $('new-topic').disabled = !data.topics.length;
  $('sources').replaceChildren(...data.sources.map(s => {
    const n = el('div', `source ${s.state}`); n.append(el('span', 'source-dot'), el('span', '', s.state === 'ready' ? `${providerName(s.provider)} · ${s.count} chats${s.limited ? ` (latest ${s.total} files capped)` : ''}` : `${providerName(s.provider)} · ${s.state === 'missing' ? 'No local history found' : 'Cannot read history'}`));
    if (s.state !== 'ready' || s.limited) n.append(button('Settings', '', () => send({ type: 'settings' }))); return n;
  }));
  document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
  document.querySelectorAll('[data-provider]').forEach(b => { b.classList.toggle('active', b.dataset.provider === provider); b.setAttribute('aria-pressed', String(b.dataset.provider === provider)); });
  $('show-done').checked = showDone;
  $('card-sort').value = cardSort;
  const pins = scoped.filter(s => s.pinned && (showDone || s.status !== 'Done')).sort((a, b) => a.createdAt - b.createdAt);
  $('focus-strip').hidden = pins.length === 0;
  $('focus-strip').replaceChildren(el('span', '', 'Pinned'), ...pins.map(s => button(s.title, `focus-item${s.key === selected ? ' selected' : ''}`, () => select(s, true), `Resume ${s.title}`)));
  $('errors').textContent = data.errors.join(' ');
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible = scoped.filter(s => (provider === 'all' || s.provider === provider) && (showDone || s.status !== 'Done') && words.every(word => (s.searchText || '').includes(word) || `${s.title} ${s.preview} ${s.project} ${effectiveSubfolder(s, data.subfolders?.[projectGroupKey(s)] || [])} ${s.note} ${data.topics.find(t => t.id === s.topic)?.name || ''}`.toLowerCase().includes(word))).sort((a, b) => sortTime(b) - sortTime(a) || a.key.localeCompare(b.key));
  const groups = view === 'topics' ? data.topics.map(t => ({ id: t.id, name: t.name, sessions: visible.filter(s => s.topic === t.id) })) : view === 'workflow' ? ['Inbox', 'In progress', 'Waiting', 'Done'].map(status => ({ id: status, name: status, sessions: visible.filter(s => s.status === status) })) : [...new Set(visible.map(s => new Date(sortTime(s)).toLocaleDateString()))].map(day => ({ id: day, name: day, sessions: visible.filter(s => new Date(sortTime(s)).toLocaleDateString() === day) }));
  if (focusedGroup && !data.busy && !groups.some(g => g.id === focusedGroup)) { focusedGroup = ''; persist(); }
  const shownGroups = focusedGroup ? groups.filter(g => g.id === focusedGroup) : groups;
  const selectable = new Set(shownGroups.flatMap(g => g.sessions.map(s => s.key)));
  for (const key of batchSelection) if (!selectable.has(key)) batchSelection.delete(key);
  $('batch-actions').hidden = !batchSelection.size;
  $('batch-count').textContent = `${batchSelection.size} selected`;
  const visibleCount = focusedGroup ? shownGroups[0]?.sessions.length || 0 : visible.length;
  $('visible-count').textContent = `${visibleCount} conversation${visibleCount === 1 ? '' : 's'} shown`;
  $('focus-strip').hidden = pins.length === 0 || !!focusedGroup;
  board.className = `board${view === 'timeline' ? ' timeline' : ''}${focusedGroup ? ' focused' : ''}`;
  board.dataset.view = view; board.dataset.mode = focusedGroup ? 'focused' : 'overview';
  // Build offscreen so measuring a new column cannot collapse the page mid-render.
  const content = document.createDocumentFragment();
  if (!visible.length && !focusedGroup) {
    const empty = el('div', 'empty-state');
    empty.append(el('h2', '', data.busy ? 'Reading local conversations…' : data.sessions.length ? 'No matching conversations' : 'No conversations yet'), el('p', '', data.busy ? 'The first scan can take a moment.' : data.sessions.length ? 'Try another project, change your search, or show completed chats.' : 'Start a chat in Codex or Claude Code, then refresh. You can also choose your history folders in Settings.'));
    if (!data.busy && !data.sessions.length) empty.append(button('Choose history folders', 'quiet', () => send({ type: 'settings' })));
    content.append(empty);
  } else for (const group of shownGroups) {
    const i = groups.indexOf(group);
    const column = el('section', `column tone-${i % 6}`); column.dataset.group = group.id;
    const head = el('div', 'column-head');
    const focus = button(focusedGroup ? 'Exit focus' : 'Focus', 'column-focus quiet', () => focusGroup(focusedGroup ? '' : group.id), focusedGroup ? 'Exit focus mode (Escape)' : `Focus on ${group.name}`);
    focus.setAttribute('aria-pressed', String(!!focusedGroup));
    const pickAll = el('input', 'section-select'); pickAll.type = 'checkbox';
    const count = group.sessions.filter(s => batchSelection.has(s.key)).length;
    pickAll.checked = !!group.sessions.length && count === group.sessions.length;
    pickAll.indeterminate = count > 0 && count < group.sessions.length;
    pickAll.disabled = !group.sessions.length;
    pickAll.dataset.groupSelect = group.id;
    pickAll.title = `${pickAll.checked ? 'Deselect' : 'Select'} all in ${group.name}`;
    pickAll.setAttribute('aria-label', pickAll.title);
    pickAll.addEventListener('change', () => { for (const s of group.sessions) { if (pickAll.checked) batchSelection.add(s.key); else batchSelection.delete(s.key); } render(); [...board.querySelectorAll('.section-select')].find(n => n.dataset.groupSelect === group.id)?.focus({ preventScroll: true }); });
    const groupTitle = view === 'timeline' ? dayHeading.format(sortTime(group.sessions[0])) : group.name;
    head.append(pickAll, el('span', 'topic-dot'), el('h2', '', groupTitle), el('span', 'count', String(group.sessions.length)), focus); column.append(head);
    const list = el('div', 'column-cards'); list.append(...group.sessions.map(card));
    if (!group.sessions.length) list.append(el('div', 'empty-column', view === 'workflow' && group.id === 'Done' && !showDone ? 'Tick “Show done” to see finished chats.' : focusedGroup ? 'No conversations match the current filters in this group.' : 'Drop a conversation here'));
    column.append(list);
    if (view !== 'timeline') {
      column.addEventListener('dragover', e => { e.preventDefault(); column.classList.add('drag-over'); });
      column.addEventListener('dragleave', e => { if (!column.contains(e.relatedTarget)) column.classList.remove('drag-over'); });
      column.addEventListener('drop', e => { e.preventDefault(); column.classList.remove('drag-over'); const s = data.sessions.find(s => s.key === e.dataTransfer.getData('text/plain')); if (s) update(s, view === 'topics' ? { topic: group.id } : { status: group.id }); });
    }
    content.append(column);
  }
  board.replaceChildren(content);
  if (focusKey && focusAction) {
    const c = [...document.querySelectorAll('.card')].find(n => n.dataset.key === focusKey);
    c?.querySelector(`[data-action="${focusAction}"]`)?.focus({ preventScroll: true });
  }
  if (focusColumn) [...board.querySelectorAll('.column')].find(c => c.dataset.group === focusColumn)?.querySelector('.column-focus')?.focus({ preventScroll: true });
  // Keep the viewport steady after layout changes and browser scroll anchoring.
  renderGit(false);
  restoreScrollPosition(pageScroll);
}
let handoffRequest = 0;
function handoffText() {
  return [['Decision','handoff-decision'], ['Files','handoff-paths'], ['Next step','handoff-next']]
    .filter(([,id]) => $(id).value.trim()).map(([label,id]) => label + '\n' + $(id).value.trim()).join('\n\n');
}
function previewHandoff() {
  $('handoff-preview').textContent = 'Atlas handoff from ' + $('handoff-dialog').dataset.key + '\n\n' + handoffText();
}
function loadHandoffExcerpts() {
  const picker = $('handoff-excerpt');
  picker.replaceChildren(new Option('Write your own decision',''));
  for (const message of excerpts || []) picker.add(new Option(message.text.slice(0,100),message.text.slice(0,12000)));
}
function openHandoff(session) {
  handoffRequest++;
  $('handoff-dialog').dataset.key = session.key;
  $('handoff-form').reset();
  $('handoff-form').querySelector('details').open = false;
  $('handoff-submit').disabled = false;
  $('handoff-error').textContent = '';
  loadHandoffExcerpts();
  $('handoff-next').value = session.note || '';
  previewHandoff();
  $('handoff-dialog').showModal();
}
$('handoff-excerpt').addEventListener('change', e => { $('handoff-decision').value = e.target.value; previewHandoff(); });
$('handoff-form').addEventListener('input', previewHandoff);
$('handoff-files').addEventListener('click', () => send({type:'handoffFiles',key:$('handoff-dialog').dataset.key,requestId:handoffRequest}));
$('handoff-form').addEventListener('submit', e => {
  e.preventDefault();
  if (!$('handoff-next').value.trim()) { $('handoff-next').focus(); return; }
  $('handoff-submit').disabled = true;
  send({type:'handoff', key:$('handoff-dialog').dataset.key, requestId:handoffRequest, provider:$('handoff-provider').value, text:handoffText()});
});
$('handoff-close').addEventListener('click', () => $('handoff-dialog').close());
$('pickup').addEventListener('click', () => {
  const list = $('pickup-list'); list.replaceChildren();
  // A chat with a running task belongs here whatever its board status; it is listed once, under Running.
  const sessions = data.sessions.filter(s => projectGroupKey(s) === project && (s.running || ['In progress','Waiting'].includes(s.status)));
  for (const status of ['Running','In progress','Waiting']) {
    const group = sessions.filter(s => status === 'Running' ? s.running : !s.running && s.status === status);
    if (!group.length) continue;
    list.append(el('h3','',status));
    for (const s of group) {
      const item = el('div','pickup-row');
      item.append(button(s.title,'card-open',() => { $('pickup-dialog').close(); if (gitOpen || engineeringOpen) selectProjectView(false); select(s); }), el('p','',s.note || 'Add a next step in the handoff note.'));
      list.append(item);
    }
  }
  if (!sessions.length) list.append(el('p','','Chats with a running task, or marked In progress or Waiting, will appear here.'));
  $('pickup-dialog').showModal();
});
$('pickup-close').addEventListener('click', () => $('pickup-dialog').close());
function renderDetail() {
  const s = data.sessions.find(s => s.key === detailKey); if (!s) return;
  const root = $('detail'); root.replaceChildren();
  const head = el('div', 'detail-head'); head.append(el('span', '', providerName(s.provider)), button('×', '', closeDetail, 'Close details')); root.append(head, el('h2', '', s.title));
  const availableFolders = data.subfolders?.[projectGroupKey(s)] || [];
  const info = el('div', 'meta', `${s.project}\nCreated ${fullDate(s.createdAt)}\nLast activity ${fullDate(s.updatedAt)}${s.completedAt ? `\nFinished ${fullDate(s.completedAt)}` : ''}`); root.append(info);
  const actions = el('div', 'detail-actions');
  actions.append(button(s.provider === 'codex' ? 'Codex sidebar' : 'Claude chat', 'primary', () => send({ type: 'open', key: s.key, native: true })));
  if (s.provider === 'codex') actions.append(button('Open beside board', 'quiet', () => send({ type: 'open', key: s.key, editor: true })));
  actions.append(button('Hidden terminal', 'quiet', () => send({ type: 'open', key: s.key, terminal: true }), 'Start in hidden terminal'));
  if (s.cwd) actions.append(button('Browse files in VS Code', 'quiet', () => send({ type: 'browseSessionFiles', key: s.key })));
  actions.append(button('Find passage…','quiet',() => send({type:'passages',key:s.key,query})),
    button('Hand off…','quiet',() => openHandoff(s)));
  root.append(actions);
  const related = data.sessions.filter(other => other.key === s.handoffFrom || other.handoffFrom === s.key);
  if (related.length) {
    root.append(el('h3','','Linked conversations'));
    for (const other of related) root.append(button((other.key === s.handoffFrom ? 'From · ' : 'To · ') + other.title,'linked-chat',() => select(other)));
  }
  const titleLabel = el('label', '', 'Board title'); const titleInput = el('input'); titleInput.value = s.title; titleInput.maxLength = 150; titleInput.addEventListener('change', () => update(s, { title: titleInput.value })); titleLabel.append(titleInput); root.append(titleLabel);
  const projectLabel = el('label', '', 'Project'), projectSelect = el('select');
  const automatic = data.projectCatalog.find(p => p.key === originalProjectKey(s))?.name || s.project;
  const choices = [['', `Automatic (${automatic})`], ...data.projectCatalog.filter(p => p.key !== originalProjectKey(s) && (!hiddenProjects.includes(p.key) || p.key === s.projectOverride)).sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.key, `${p.name}${p.cwd ? ` — ${p.cwd}` : ' (board project)'}`]), ['__create__', '+ Create project…']];
  for (const [value, text] of choices) { const option = el('option', '', text); option.value = value; projectSelect.append(option); }
  projectSelect.value = s.projectOverride || '';
  projectSelect.addEventListener('change', () => {
    if (projectSelect.value === '__create__') { projectSelect.value = s.projectOverride || ''; openProjectDialog(s.key); return; }
    update(s, { projectOverride: projectSelect.value || null });
    renderDetail();
  });
  projectLabel.append(projectSelect); root.append(projectLabel);
  root.append(el('p', 'manual-project-warning', `Manual project choices change only this board. Automatic follows the working folder: ${s.cwd || 'unknown'}. Resuming the chat still uses that folder.`));
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
  const transcript = el('section'); transcript.id = 'detail-excerpts'; root.append(transcript);
  renderExcerpts(s);
}
function renderExcerpts(s) {
  const root = $('detail-excerpts');
  root.replaceChildren(el('h3', '', 'Conversation excerpts'), el('p', 'meta', sampled ? 'Sampled from the beginning and end of the local transcript. Open the conversation for the full history.' : 'Recent messages from the local transcript.'));
  if (!excerpts?.length) root.append(el('p', 'meta', excerpts ? 'No excerpts available.' : 'Loading excerpts…'));
  for (const message of excerpts || []) { const item = el('div', 'excerpt'); item.append(el('b', '', message.role === 'user' ? 'YOU' : providerName(s.provider).toUpperCase()), el('p', '', message.text)); root.append(item); }
}
function closeDetail() {
  const pageScroll = captureScrollPosition();
  $('detail').hidden = true; const key = detailKey; detailKey = '';
  [...document.querySelectorAll('.card')].find(n => n.dataset.key === key)?.querySelector('.info')?.focus({ preventScroll: true });
  restoreScrollPosition(pageScroll);
}
window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'activity' && Array.isArray(m.sessions)) {
    const activity = new Map(m.sessions.map(s => [s.key, s.running === true]));
    for (const session of data.sessions) if (activity.has(session.key)) session.running = activity.get(session.key);
    for (const card of document.querySelectorAll('article.card')) if (activity.has(card.dataset.key)) setCardRunning(card, activity.get(card.dataset.key));
    syncProjectRunning();
    return;
  }
  if (m.type === 'theme' && ['system', 'pearl', 'dark'].includes(m.theme)) {
    themeMigrated = true;
    theme = m.theme;
    document.body.dataset.theme = theme;
    persist();
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
  if (m.type === 'gitOperation' && gitOperation && m.projectKey === gitOperation.projectKey && m.requestId === gitOperation.requestId) {
    const operation = gitOperation;
    if (!m.error && operation.action === 'commit' && gitCommitDrafts.get(m.projectKey) === operation.message) { gitCommitDrafts.delete(m.projectKey); persist(); }
    gitOperation = null;
    if (m.projectKey === project) {
      gitOperationFocus = ['stage','unstage','commit'].includes(operation.action) ? 'git-commit-message' : operation.action === 'createPr' ? 'Create PR' : operation.action[0].toUpperCase() + operation.action.slice(1);
      gitOperationNotice = m.error || m.message;
      gitDiffResult = null; gitDiffId++; gitSelection = { mode: gitSelection.mode === 'all' || gitSelection.mode === 'commit' ? 'all' : operation.action === 'stage' ? 'staged' : operation.action === 'unstage' ? 'working' : gitSelection.mode };
      requestGit(false); renderGit();
    } else renderGit();
  }
  if (m.type === 'gitChanged' && m.projectKey === project && m.projectKey === gitWatchKey && !gitOperation && !gitDockDrag) requestGit(false, true);
  if (m.type === 'gitDiff' && m.projectKey === project && m.requestId === gitDiffId) {
    const same = gitDiffResult && JSON.stringify(gitDiffResult.diff) === JSON.stringify(m.diff) && gitDiffResult.error === m.error;
    gitDiffResult = m; if (!same) renderGitDiff();
  }
  if (m.type === 'gitDashboard' && m.projectKey === project && m.requestId === gitRequestId) {
    const live = gitLive; gitLive = false;
    // Live refreshes only touch the DOM when the repository actually changed.
    if (live && gitResult && JSON.stringify(gitResult.dashboard) === JSON.stringify(m.dashboard) && gitResult.error === m.error) return;
    gitResult = m; renderGit();
    if (live && !m.error && gitDiffResult && gitSelection.mode !== 'commit') {
      // A file that was committed or reverted meanwhile falls back to the first remaining change.
      if (gitSelection.file && !m.dashboard.changes.some(change => change.file === gitSelection.file)) { const { file, ...rest } = gitSelection; gitSelection = rest; }
      send({ type: 'gitDiff', projectKey: project, requestId: ++gitDiffId, ...gitSelection });
    }
    else if (!m.error && !gitDiffResult) selectGitDiff(gitSelection);
    if (!m.error && gitFocusPending) $('git-branch-focus')?.focus({preventScroll:true}); gitFocusPending = false;
    if (gitOperationFocus) { ($(gitOperationFocus) || [...document.querySelectorAll('.git-sync-actions button')].find(n => n.textContent === gitOperationFocus))?.focus({preventScroll:true}); gitOperationFocus = ''; }
  }
  if (m.requestId === handoffRequest && m.key === $('handoff-dialog').dataset.key && $('handoff-dialog').open) {
    if (m.type === 'handoffFiles') {
      const paths = [...new Set([...$('handoff-paths').value.split(/\r?\n/), ...m.files].filter(Boolean))].join('\n');
      if (paths.length <= 8000) { $('handoff-paths').value = paths; previewHandoff(); }
      else $('handoff-error').textContent = 'Choose fewer files or shorten the list.';
    }
    if (m.type === 'handoffStarted') { $('handoff-dialog').close(); showNotice('Handoff copied. Paste it into the new chat.'); }
    if (m.type === 'handoffError') { $('handoff-submit').disabled = false; $('handoff-error').textContent = m.text; }
  }
  if ((m.type === 'engineeringResult' && m.projectKey === project && m.requestId === engineeringRequestId) || m.type === 'engineeringState') {
    const previous = engineeringResults.get(m.projectKey);
    engineeringResults.set(m.projectKey, m.type === 'engineeringState' ? { ...m, snapshot: m.snapshot || previous?.snapshot } : m);
    if (engineeringOpen && m.projectKey === project) {
      if (m.snapshot?.time !== previous?.snapshot?.time && (m.snapshot || m.type === 'engineeringResult')) {
        engineeringGraph = null;
        engineeringQueryId++;
        queryEngineering();
      }
      renderEngineering();
    }
  }
  if (m.type === 'engineeringGraph' && engineeringOpen && m.projectKey === project && m.requestId === engineeringQueryId) {
    engineeringGraph = m.graph;
    renderEngineering();
    if (m.error) showNotice(m.error);
  }
  if (m.type === 'detail' && m.key === detailKey && !gitOpen && !engineeringOpen) {
    excerpts = m.messages; sampled = m.sampled;
    const session = data.sessions.find(s => s.key === detailKey);
    if (session) renderExcerpts(session);
    if ($('handoff-dialog').open && $('handoff-dialog').dataset.key === m.key && $('handoff-excerpt').options.length === 1) loadHandoffExcerpts();
  }
  if (m.type === 'draftProject') {
    if ($('project-dialog').open) { showNotice('Finish the open project form, then choose the folder again in Explorer.'); return; }
    openProjectDialog();
    $('project-name').value = m.name.slice(0, 80);
    $('project-folder').value = m.folder;
  }
  if (m.type === 'projectCreated') {
    const movedChat = !!projectDialogKey;
    if ($('project-dialog').open) $('project-dialog').close();
    projectDialogKey = '';
    if (movedChat) { render(); renderDetail(); }
    else {
      if (detailKey) closeDetail();
      chooseProject(m.key);
    }
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
  if (m.type === 'newChatShortcut' && !document.querySelector('dialog[open]')) {
    if (project) openNewChatDialog(project); else showNotice('Select a project to start a new chat.');
  }
  if (m.type === 'mcpRegistered') {
    const button = $('engineering-mcp');
    button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = 'Connect agents';
    showNotice(m.text);
  }
  if (m.type === 'projectPicked' && data.projectCatalog.some(item => item.key === m.key)) chooseProject(m.key);
});
$('search').value = query;
$('search').addEventListener('input', e => { query = e.target.value; persist(); render(); });
$('show-done').addEventListener('change', e => { showDone = e.target.checked; persist(); render(); });
$('card-sort').addEventListener('change', e => { cardSort = e.target.value === 'updated' ? 'updated' : 'created'; persist(); render(); });
$('all-projects').addEventListener('click', () => chooseProject(''));
$('refresh').addEventListener('click', () => {
  if (gitOpen && project) { requestGit(); renderGit(); }
  else if (engineeringOpen && project) requestEngineering('engineeringRefresh');
  else send({ type: 'refresh' });
});
function selectProjectView(showGit) {
  if (gitOpen === showGit && !engineeringOpen) return;
  engineeringOpen = false;
  gitOpen = showGit;
  persist();
  if (gitOpen) requestGit();
  else document.querySelectorAll('#sources, .toolbar, .filterbar, #board, main > footer').forEach(node => { node.hidden = false; });
  render();
}
$('git-switch').addEventListener('click', () => selectProjectView(true));
$('conversation-switch').addEventListener('click', () => selectProjectView(false));
$('engineering-switch').addEventListener('click', () => {
  if (engineeringOpen) { selectProjectView(false); return; }
  engineeringOpen = true;
  gitOpen = false;
  persist();
  render();
});
$('engineering-changes').addEventListener('click', () => selectProjectView(true));
for (const tab of document.querySelectorAll('[data-engineering-view]')) tab.addEventListener('click', () => switchEngineering(tab.dataset.engineeringView));
$('engineering-search').addEventListener('input', e => updateEngineering({ query: e.target.value, offset: 0 }));
$('engineering-module').addEventListener('change', e => updateEngineering({ module: e.target.value, offset: 0 }));
$('engineering-depth').addEventListener('change', e => updateEngineering({ depth: Number(e.target.value) }));
$('engineering-brief').addEventListener('click', () => requestEngineering('engineeringCopy', { brief: 'quality' }));
$('engineering-mcp').addEventListener('click', e => {
  e.currentTarget.disabled = true; e.currentTarget.setAttribute('aria-busy', 'true'); e.currentTarget.textContent = 'Connecting…';
  send({ type: 'registerMcp' });
});
for (const [action, type] of [['refresh', 'engineeringRefresh'], ['cancel', 'engineeringCancel'], ['clear', 'engineeringClear']]) {
  $('engineering-' + action).addEventListener('click', () => requestEngineering(type));
}
$('new-chat').addEventListener('click', () => openNewChatDialog(project));
$('new-chat-codex').addEventListener('click', () => startNewChat('codex'));
$('new-chat-claude').addEventListener('click', () => startNewChat('claude'));
$('close-new-chat').addEventListener('click', () => $('new-chat-dialog').close());
$('new-chat-dialog').addEventListener('close', () => { newChatTarget = null; });
$('settings').addEventListener('click', () => send({ type: 'settings' }));
$('feedback').addEventListener('click', () => send({ type: 'feedback' }));
$('sidebar-toggle').addEventListener('click', () => {
  if (narrowWorkspace.matches) drawer.showModal();
  else { sidebarHidden = !sidebarHidden; persist(); }
  syncSidebar();
});
$('close-projects').addEventListener('click', () => drawer.close());
drawer.addEventListener('close', syncSidebar);
narrowWorkspace.addEventListener('change', syncSidebar);
$('project-sort').addEventListener('change', e => { projectSort = e.target.value; persistSidebar(); render(); });
$('new-project').addEventListener('click', () => openProjectDialog());
$('open-project-folder').addEventListener('click', () => send({ type: 'openProjectFolder', projectKey: project, subfolder: subfolderFilter || '' }));
$('rename-project').addEventListener('click', () => send({ type: 'renameProject', projectKey: project }));
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
  if (document.querySelector('dialog[open]')) return;
  if ((gitOpen || engineeringOpen) && project && e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'g') {
    e.preventDefault();
    selectProjectView(false);
    $('conversation-switch').focus();
    return;
  }
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    if (engineeringOpen && project && $('engineering-filters').hidden) return;
    e.preventDefault();
    $(engineeringOpen && project ? 'engineering-search' : 'search').focus();
  }
  if (e.key === 'Escape') {
    if (!$('detail').hidden) closeDetail();
    else if (focusedGroup) focusGroup('');
  }
});
$('batch-clear').addEventListener('click', () => { batchSelection.clear(); render(); });
$('batch-apply').addEventListener('click', () => {
  const status = $('batch-status').value;
  if (!statuses.includes(status) || !batchSelection.size) return;
  send({ type: 'batchStatus', keys: [...batchSelection], status });
  batchSelection.clear(); render();
});
render(); send({ type: 'ready', legacyTheme: themeMigrated ? undefined : saved.theme });
