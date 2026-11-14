'use strict';
const { execFile } = require('node:child_process');
const run = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', ['--no-pager', '--no-optional-locks', ...args], { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    if (error) reject(new Error(error.code === 'ENOENT' ? 'Git is unavailable. Install Git and restart VS Code.' : (stderr || error.message).trim()));
    else resolve(stdout);
  });
});
async function readGitDashboard(cwd) {
  const root = (await run(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const [branch, branches, status, refs] = await Promise.all([
    run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => 'Detached HEAD'),
    run(root, ['branch', '--all', '--no-color']),
    run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    run(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
  ]);
  const changes = [], entries = status.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const code = entry.slice(0, 2), file = entry.slice(3);
    const original = /[RC]/.test(code) ? entries[++i] : '';
    changes.push({ code, file, original });
  }
  const graph = refs.trim() || branch.trim() === 'Detached HEAD'
    ? await run(root, ['log', '--all', ...(branch.trim() === 'Detached HEAD' ? ['HEAD'] : []), '--graph', '--topo-order', '--max-count=100', '--no-color', '--decorate=short', '--format=%h %s (%an, %ar)%d'])
    : '';
  const log = graph ? await run(root, ['log', '--all', ...(branch.trim() === 'Detached HEAD' ? ['HEAD'] : []), '--topo-order', '-100', '--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D']) : '';
  const commits = log.trimEnd().split('\n').filter(Boolean).map(line => {
    const [hash, parents, subject, author, date, refs] = line.split('\0');
    return { hash, parents: parents.split(' ').filter(Boolean), subject, author, date, refs };
  });
  return { root, branch: branch.trim(), branches: branches.trimEnd(), changes, graph, commits };
}
async function readGitDiff(cwd, selection) {
  const root = (await run(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const { mode, commit, file } = selection;
  if (!['working', 'staged', 'untracked', 'commit'].includes(mode)) throw new Error('Invalid comparison.');
  if (mode === 'commit' && !/^[a-f0-9]{40,64}$/.test(commit || '')) throw new Error('Invalid commit.');
  const options = ['--no-ext-diff', '--no-textconv', '--no-color'];
  const base = mode === 'commit' ? ['show', '--format=', '--diff-merges=first-parent', ...options, commit] : ['diff', ...options, ...(mode === 'staged' ? ['--cached'] : [])];
  const names = mode === 'untracked'
    ? await run(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    : await run(root, [...base, '--name-only', '-z']);
  const files = [...new Set(names.split('\0').filter(Boolean))];
  if (file !== undefined && !files.includes(file)) throw new Error('This file is no longer in the comparison. Refresh and select it again.');
  const selected = file === undefined ? files[0] : file;
  let patch = '';
  if (selected && mode === 'untracked') {
    const fs = require('node:fs/promises'), path = require('node:path');
    const target = await fs.realpath(path.join(root, selected)), realRoot = await fs.realpath(root);
    const relative = path.relative(realRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Cannot preview a link outside this repository.');
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 512 * 1024) patch = 'Preview unavailable: not a regular file or larger than 512 KB.';
    else {
      const buffer = await fs.readFile(target);
      patch = buffer.includes(0) ? 'Binary file: text preview unavailable.' : '@@ New untracked file @@\n' + buffer.toString('utf8').split('\n').map(line => '+' + line).join('\n');
    }
  } else if (selected) patch = await run(root, [...base, '--patch', '--', `:(literal)${selected}`]);
  const truncated = patch.length > 512 * 1024;
  return { files, file: selected || '', patch: patch.slice(0, 512 * 1024), truncated };
}
module.exports = { readGitDashboard, readGitDiff };
