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
if (typeof module !== 'undefined') module.exports = { canonicalProjectPath, projectGroupKey, groupProjects, resolveProjectSelection };
