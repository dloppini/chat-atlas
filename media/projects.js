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
function projectGroupKey(session) {
  return session.cwd ? `path:${canonicalProjectPath(session.cwd)}` : 'other:';
}
function groupProjects(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = projectGroupKey(session);
    const group = groups.get(key) || { name: session.project, count: 0, folders: new Map() };
    group.count++;
    if (session.cwd) group.folders.set(canonicalProjectPath(session.cwd), session.cwd);
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
  return match ? projectGroupKey(match) : selection;
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
if (typeof module !== 'undefined') module.exports = { canonicalProjectPath, projectGroupKey, groupProjects, resolveProjectSelection, orderedProjects, moveProject };
