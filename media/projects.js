'use strict';
// Shared by the webview and Node regression tests. Original resume paths stay intact.
function canonicalProjectPath(value) {
  let folder = (value || '').replace(/\\/g, '/');
  if (/^\/\/\?\/UNC\//i.test(folder)) folder = `//${folder.slice(8)}`;
  else if (folder.startsWith('//?/')) folder = folder.slice(4);
  const windows = /^[a-z]:\//i.test(folder) || folder.startsWith('//');
  folder = folder.replace(/\/+$/, '') || (folder ? '/' : '');
  if (/^[a-z]:$/i.test(folder)) folder += '/';
  return windows ? folder.toLowerCase() : folder;
}
function originalProjectKey(session) {
  return session.cwd ? `path:${canonicalProjectPath(session.cwd)}` : 'other:';
}
function projectGroupKey(session) { return session.projectOverride || originalProjectKey(session); }
function remapProjectKeys(keys, previousKey, key) {
  return [...new Set((keys || []).map(value => value === previousKey ? key : value))];
}
function linkProjectFolder(state, previousKey, cwd) {
  const project = (state.customProjects || []).find(item => `custom:${item.id}` === previousKey && !item.cwd);
  if (!project) throw new Error('Choose a project without a linked folder.');
  if (!cwd) throw new Error('Choose an existing folder to link.');
  const key = originalProjectKey({ cwd });
  if (state.customProjects.some(item => item !== project && item.cwd && originalProjectKey(item) === key)) {
    throw new Error('That folder is already linked to another project. Select that project instead.');
  }
  project.cwd = cwd;
  // Include cards outside the current history scan so their placement survives later refreshes.
  for (const card of Object.values(state.cards || {})) {
    if (card.projectOverride === previousKey) { card.projectOverride = key; delete card.subfolder; }
  }
  return key;
}
function projectCatalog(sessions, customProjects = []) {
  const catalog = new Map();
  for (const session of sessions) {
    const key = originalProjectKey(session);
    if (!catalog.has(key)) catalog.set(key, { key, name: session.project, cwd: session.cwd || '' });
  }
  for (const item of customProjects) if (item?.id && item?.name) {
    const key = item.cwd ? originalProjectKey(item) : `custom:${item.id}`;
    catalog.set(key, { key, name: item.name, cwd: item.cwd || '', created: true });
  }
  return [...catalog.values()];
}
function effectiveSubfolder(session, available = []) {
  const value = session.subfolder == null ? session.projectOverride ? '' : session.subfolderHint : session.subfolder;
  if (typeof value !== 'string' || !value) return '';
  const windows = /^path:(?:[a-z]:\/|\/\/)/i.test(projectGroupKey(session));
  return available.find(name => windows ? name.toLowerCase() === value.toLowerCase() : name === value) || '';
}
function groupSubfolders(sessions, availableByProject = {}) {
  const groups = new Map();
  for (const session of sessions) {
    const key = projectGroupKey(session);
    const group = groups.get(key) || { folders: new Map(), unassigned: 0 };
    const folder = effectiveSubfolder(session, availableByProject[key] || []);
    if (folder) group.folders.set(folder, (group.folders.get(folder) || 0) + 1);
    else group.unassigned++;
    groups.set(key, group);
  }
  return groups;
}
function groupProjects(sessions, catalog = []) {
  const groups = new Map(catalog.map(p => [p.key, { name: p.name, count: 0, created: p.created === true, isBoardProject: p.key.startsWith('custom:'), folders: new Map(p.cwd ? [[canonicalProjectPath(p.cwd), p.cwd]] : []) }]));
  for (const session of sessions) {
    const key = projectGroupKey(session);
    const group = groups.get(key) || { name: session.project, count: 0, folders: new Map() };
    group.count++;
    if (session.cwd && key === originalProjectKey(session)) group.folders.set(canonicalProjectPath(session.cwd), session.cwd);
    groups.set(key, group);
  }
  const nameCounts = new Map();
  for (const group of groups.values()) {
    const name = group.name.toLowerCase();
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  for (const group of groups.values()) group.showPath = nameCounts.get(group.name.toLowerCase()) > 1;
  return groups;
}
function resolveProjectSelection(selection, sessions, groups) {
  if (!selection || groups.has(selection)) return selection;
  const match = sessions.find(s => s.cwd && canonicalProjectPath(s.cwd) === canonicalProjectPath(selection));
  return match ? originalProjectKey(match) : selection;
}
function orderedProjects(groups, mode, order = []) {
  const alphabetical = [...groups].sort((a, b) => a[1].name.localeCompare(b[1].name) || a[0].localeCompare(b[0]));
  if (mode !== 'manual') return alphabetical;
  const positions = new Map(order.map((key, index) => [key, index]));
  return alphabetical.sort((a, b) => (positions.get(a[0]) ?? Infinity) - (positions.get(b[0]) ?? Infinity));
}
function moveProject(order, source, target, after = false) {
  if (source === target || !order.includes(source) || !order.includes(target)) return [...order];
  const next = order.filter(key => key !== source);
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source);
  return next;
}
if (typeof module !== 'undefined') module.exports = { canonicalProjectPath, originalProjectKey, projectGroupKey, remapProjectKeys, linkProjectFolder, projectCatalog, effectiveSubfolder, groupSubfolders, groupProjects, resolveProjectSelection, orderedProjects, moveProject };
