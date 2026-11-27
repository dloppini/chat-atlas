'use strict';
const { execFile, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const run = (cwd, args, timeout = 15000, extraEnv, signal) => new Promise((resolve, reject) => {
  execFile('git', ['--no-pager', '--no-optional-locks', ...args], { cwd, encoding: 'utf8', timeout, signal, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', ...extraEnv }, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(new Error(error.code === 'ENOENT' ? 'Git is unavailable. Install Git and restart VS Code.' : (error.killed ? 'Git timed out. Refresh repository status before retrying.' : stderr || error.message).trim()), { code: error.code }));
    else resolve(stdout);
  });
});
function readPatch(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-pager', '--no-optional-locks', ...args], {
      cwd, timeout:15000, windowsHide:true, stdio:['ignore','pipe','pipe'],
      env:{...process.env, GIT_TERMINAL_PROMPT:'0', GCM_INTERACTIVE:'Never'}
    });
    const decoder = new StringDecoder('utf8');
    let patch = '', stderr = '', remaining = 512 * 1024, truncated = false;
    // Drain the full stream so truncation never masks a later Git failure.
    child.stdout.on('data', chunk => {
      const length = Math.min(remaining, chunk.length);
      if (length) patch += decoder.write(chunk.subarray(0, length));
      remaining -= length;
      if (length < chunk.length) truncated = true;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0, 64 * 1024); });
    child.on('error', error => reject(new Error(error.code === 'ENOENT' ? 'Git is unavailable. Install Git and restart VS Code.' : error.message)));
    child.on('close', (code, signal) => {
      if (code !== 0) reject(new Error(child.killed ? 'Git timed out. Refresh repository status before retrying.' : stderr.trim() || `Git diff failed (${signal || code}).`));
      else resolve({patch:patch + (truncated ? '' : decoder.end()), truncated});
    });
  });
}
const indexVersion = async root => createHash('sha256').update(await run(root, ['ls-files', '--stage', '-z'])).digest('hex');
function azureRepositoryUrl(remote) {
  try {
    let host, parts;
    const ssh = remote.match(/^(?:[^@/]+@)?(ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com):v3\/([^\s?#]+)$/i);
    if (ssh) { host = 'dev.azure.com'; parts = ssh[2].split('/'); }
    else {
      const url = new URL(remote);
      if (url.port || url.search || url.hash) return null;
      host = url.hostname.toLowerCase(); parts = url.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
      if (url.protocol === 'ssh:' && ['ssh.dev.azure.com', 'vs-ssh.visualstudio.com'].includes(host) && parts.shift() === 'v3') host = 'dev.azure.com';
      else if (url.protocol === 'https:' && host === 'dev.azure.com' && parts.length === 4 && parts[2] === '_git') parts.splice(2, 1);
      else if (url.protocol === 'https:' && /^[a-z0-9-]+\.visualstudio\.com$/.test(host)) {
        if (parts[0] === 'DefaultCollection') parts.shift();
        if (parts.length !== 3 || parts[1] !== '_git') return null;
        parts.splice(1, 1); parts.unshift(host.split('.')[0]); host = 'dev.azure.com';
      } else return null;
    }
    if (parts.length !== 3) return null;
    parts = parts.map(part => decodeURIComponent(part));
    if (parts.some(part => !part || part === '.' || part === '..' || /[\\/\x00-\x1f]/.test(part))) return null;
    return `https://${host}/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/_git/${encodeURIComponent(parts[2])}`;
  } catch { return null; }
}
async function readGitDashboard(cwd, focusRef = '') {
  const root = (await run(cwd, ['rev-parse', '--show-toplevel'])).trim();
  // Each Git spawn costs ~100 ms on Windows, so independent reads share one parallel round.
  const [branch, branches, status, refs, head, remoteList, trackingCount, version] = await Promise.all([
    run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => 'Detached HEAD'),
    run(root, ['branch', '--all', '--no-color']),
    run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    run(root, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)', 'refs/heads', 'refs/remotes']),
    run(root, ['rev-parse', '--verify', 'HEAD']).then(s => s.trim()).catch(() => ''),
    // Same push URLs as `remote get-url --push --all` (pushInsteadOf applied), for every remote in one call.
    run(root, ['remote', '-v']),
    run(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']).then(s => s.trim().split(/\s+/).map(Number)).catch(() => null),
    indexVersion(root)
  ]);
  const branchRefs = refs.trim().split('\n').filter(Boolean).map(line => {
    const [ref, hash, upstream, remote, remoteRef] = line.split('\0');
    return { ref, hash, upstream, remote, remoteRef, name: ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, 'remotes/') };
  });
  if (typeof focusRef !== 'string' || (focusRef && !branchRefs.some(branch => branch.ref === focusRef))) throw new Error('This branch is no longer available. Show all branches or refresh.');
  const current = branchRefs.find(ref => ref.ref === 'refs/heads/' + branch.trim());
  const remoteLines = remoteList.split('\n').filter(Boolean);
  const remotes = [...new Set(remoteLines.map(line => line.split('\t')[0]))];
  const azureRemotes = remotes.map(name => {
    const urls = remoteLines.filter(line => line.startsWith(name + '\t') && line.endsWith(' (push)')).map(line => line.slice(name.length + 1, -7));
    const url = urls.length === 1 ? azureRepositoryUrl(urls[0]) : null;
    return url ? { name, url } : null;
  }).filter(Boolean);
  const upstream = current?.upstream || '';
  const tracking = head && upstream ? trackingCount : null;
  // focusRef is only passed to Git after it matched a listed ref above.
  const revisions = focusRef ? [focusRef] : ['--all', ...(branch.trim() === 'Detached HEAD' ? ['HEAD'] : [])];
  const changes = parseGitChanges(status);
  const hasHistory = refs.trim() || branch.trim() === 'Detached HEAD';
  const [comparison, graph, log] = await Promise.all([
    head && focusRef ? run(root, ['rev-list', '--left-right', '--count', `HEAD...${focusRef}`]).then(s => s.trim().split(/\s+/).map(Number)) : null,
    hasHistory ? run(root, ['log', ...revisions, '--graph', '--topo-order', '--max-count=100', '--no-color', '--decorate=short', '--format=%h %s (%an, %ar)%d']) : '',
    hasHistory ? run(root, ['log', ...revisions, '--topo-order', '-100', '--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D']) : ''
  ]);
  const commits = log.trimEnd().split('\n').filter(Boolean).map(line => {
    const [hash, parents, subject, author, date, refs] = line.split('\0');
    return { hash, parents: parents.split(' ').filter(Boolean), subject, author, date, refs };
  });
  return { head, remotes, azureRemotes, indexVersion: version, upstream, tracking, comparison, root, branch: branch.trim(), branches: branches.trimEnd(), changes, graph, commits, branchRefs, focusRef };
}
function parseGitChanges(status) {
  const changes = [], entries = status.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const code = entry.slice(0, 2), file = entry.slice(3);
    const original = /[RC]/.test(code) ? entries[++i] : '';
    changes.push({ code, file, original });
  }
  return changes;
}
// `--name-status -z` rows: a status token (R and C carry a score, then the original path), then the path.
function parseNameStatus(output) {
  const parts = output.split('\0'), changes = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i][0];
    if (!code) continue;
    const original = code === 'R' || code === 'C' ? parts[++i] : '';
    changes.push({ code, file: parts[++i], original });
  }
  return changes;
}
async function readGitDiff(cwd, selection) {
  const root = (await run(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const { mode, commit, file } = selection;
  if (!['all', 'working', 'staged', 'untracked', 'commit'].includes(mode)) throw new Error('Invalid comparison.');
  if (mode === 'commit' && !/^[a-f0-9]{40,64}$/.test(commit || '')) throw new Error('Invalid commit.');
  const options = ['--no-ext-diff', '--no-textconv', '--no-color'];
  const base = mode === 'commit' ? ['show', '--format=', '--diff-merges=first-parent', ...options, commit] : ['diff', ...options, ...(mode === 'staged' ? ['--cached'] : [])];
  const [status, headLookup] = await Promise.all([
    mode === 'all' ? run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) : null,
    mode === 'all' ? run(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(value => value.trim()).catch(error => { if (error.code === 1) return ''; throw error; }) : ''
  ]);
  const changes = status === null ? null : parseGitChanges(status);
  // Every comparison reports a status per file, so new, modified and deleted files stay distinguishable in commits too.
  const listed = changes || (mode === 'untracked'
    ? (await run(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).map(name => ({ code: '??', file: name, original: '' }))
    : parseNameStatus(await run(root, [...base, '--name-status', '-z'])));
  const files = [...new Set(listed.map(change => change.file))];
  if (file !== undefined && !files.includes(file)) throw new Error('This file is no longer in the comparison. Refresh and select it again.');
  const selected = file === undefined ? files[0] : file;
  const change = changes?.findLast(item => item.file === selected);
  const head = change && change.code !== '??' ? headLookup : '';
  const comparison = { files, file: selected || '', changes: listed };
  let patch = '';
  if (selected && (mode === 'untracked' || change?.code === '??' || (!head && change?.code[0] === 'A' && change.code[1] !== 'D'))) {
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
  } else if (selected) {
    const paths = change?.original ? [change.original, selected] : [selected];
    if (change) {
      base.push(head || '--cached');
      if (change.original) base.push('--find-renames');
    }
    return { ...comparison, ...await readPatch(root, [...base, '--patch', '--', ...paths.map(name => `:(literal)${name}`)]) };
  }
  const truncated = patch.length > 512 * 1024;
  return { ...comparison, patch: patch.slice(0, 512 * 1024), truncated };
}
const operations = new Set();
async function runGitOperation(cwd, action, expectedHead, expectedBranch, options = {}) {
  if (!['fetch', 'pull', 'push', 'stage', 'unstage', 'commit', 'createPr'].includes(action)) throw new Error('Invalid Git action.');
  const root = (await run(cwd, ['rev-parse', '--show-toplevel'])).trim();
  if (operations.has(root)) throw new Error('Another Git operation is running in this repository.');
  operations.add(root);
  try {
    const repo = await readGitDashboard(root);
    if (action === 'fetch') {
      if (!repo.remotes.length) throw new Error('No remote configured. Add a remote in Git first.');
      await run(root, ['fetch', '--all'], 120000); return 'Fetch complete. Remote references are updated.';
    }
    if (repo.head !== expectedHead || repo.branch !== expectedBranch) throw new Error('HEAD changed. Refresh and review the current branch before retrying.');
    if (['stage', 'unstage', 'commit'].includes(action)) {
      if (options.indexVersion !== repo.indexVersion) throw new Error('Staged changes changed. Refresh and review them before retrying.');
      if (action === 'commit') {
        if (repo.branch === 'Detached HEAD') throw new Error('Check out a branch before committing.');
        if (typeof options.message !== 'string' || !options.message.trim() || options.message.length > 10000 || options.message.includes('\0')) throw new Error('Enter a commit message of 1 to 10,000 characters.');
        if ((await run(root, ['diff', '--name-only', '--diff-filter=U'])).trim()) throw new Error('Resolve and stage all conflicts before committing.');
        if (!(await run(root, ['diff', '--cached', '--name-only'])).trim()) throw new Error('Stage at least one change before committing.');
        await run(root, ['commit', '-m', options.message.trim()], 120000);
        return 'Commit complete. Only staged changes were committed.';
      }
      if (!Array.isArray(options.files) || !options.files.length || options.files.length > 10000 || options.files.some(file => typeof file !== 'string')) throw new Error('Select changed files before staging or unstaging.');
      const paths = new Set();
      for (const file of options.files) {
        const change = repo.changes.find(change => change.file === file);
        const eligible = change && (action === 'stage' ? change.code[1] !== ' ' : ![' ', '?'].includes(change.code[0]));
        if (!eligible) throw new Error('Selected files changed. Refresh and select them again.');
        paths.add(file);
        if (change.original && (action === 'unstage' && change.code[0] === 'R' || action === 'stage' && change.code[1] === 'R')) paths.add(change.original);
      }
      const args = action === 'stage' ? ['add', '--all'] : repo.head ? ['reset', '-q', 'HEAD'] : ['rm', '--cached', '--force', '--quiet'];
      await run(root, [...args, '--', ...[...paths].map(file => `:(literal)${file}`)]);
      return action === 'stage' ? 'Selected changes staged.' : 'Selected changes unstaged. Working files are preserved.';
    }
    if (!repo.head || repo.branch === 'Detached HEAD') throw new Error('Check out a branch with a commit before pulling, pushing or creating a PR.');
    const branch = repo.branchRefs.find(ref => ref.ref === 'refs/heads/' + repo.branch);
    if (action === 'createPr') {
      const remote = repo.azureRemotes.find(remote => remote.name === options.remote);
      if (!remote) throw new Error('Select an Azure DevOps Services remote.');
      const source = branch?.remote === remote.name ? branch.remoteRef?.replace(/^refs\/heads\//, '') : repo.branch;
      const published = repo.branchRefs.find(ref => ref.ref === `refs/remotes/${remote.name}/${source}`);
      if (!published || (await run(root, ['rev-list', '--count', `${published.hash}..${repo.head}`])).trim() !== '0') throw new Error('Push this branch to the selected Azure remote before creating a PR.');
      return { url: `${remote.url}/pullrequestcreate?sourceRef=${encodeURIComponent(source)}` };
    }
    if (action === 'push' && !branch?.upstream) {
      if (!repo.remotes.includes(options.remote)) throw new Error('No upstream configured. Select a remote to publish this branch.');
      await run(root, ['-c', 'push.followTags=false', '-c', `remote.${options.remote}.mirror=false`, 'push', '--no-force', '--set-upstream', '--', options.remote, `${branch.ref}:${branch.ref}`], 120000);
      return `Branch published: ${repo.branch} / ${options.remote}.`;
    }
    if (!branch?.upstream || !repo.remotes.includes(branch.remote) || !branch.remoteRef?.startsWith('refs/heads/')) throw new Error('No remote upstream configured for this branch. Set its upstream in Git first.');
    if (action === 'pull') {
      if (repo.changes.length) throw new Error('Commit or stash local changes before pulling.');
      await run(root, ['pull', '--ff-only', '--no-rebase', '--no-autostash', '--', branch.remote, branch.remoteRef], 120000);
    } else {
      await run(root, ['-c', 'push.followTags=false', '-c', `remote.${branch.remote}.mirror=false`, 'push', '--no-force', '--', branch.remote, `${branch.ref}:${branch.remoteRef}`], 120000);
    }
    return `${action === 'pull' ? 'Pull' : 'Push'} complete: ${repo.branch} / ${branch.upstream}.`;
  } finally { operations.delete(root); }
}
const readOnlyGit = (cwd, args, signal) => run(cwd, ['-c', 'core.fsmonitor=false', ...args], 15000, { GIT_NO_LAZY_FETCH: '1' }, signal);
async function engineeringStatus(root, signal) {
  const keys = await readOnlyGit(root, ['config', '--null', '--name-only', '--get-regexp', '^filter[.].*[.](clean|process|required)$'], signal)
    .catch(error => { if (error.code === 1) return ''; throw error; });
  const overrides = [...new Set(keys.split('\0').filter(Boolean))].flatMap(key => ['-c', key + (key.endsWith('.required') ? '=false' : '=')]);
  return readOnlyGit(root, [...overrides, '-c', 'status.submoduleSummary=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all'], signal);
}
async function readEngineeringGit(cwd, signal) {
  let root;
  try { root = (await readOnlyGit(cwd, ['rev-parse', '--show-toplevel'], signal)).trimEnd(); }
  catch (error) {
    if (/not a git repository/i.test(error.message)) return null;
    throw error;
  }
  const [commonDir, worktree, branch, log, status] = await Promise.all([
    readOnlyGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal),
    readOnlyGit(root, ['rev-parse', '--absolute-git-dir'], signal),
    readOnlyGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal).catch(() => 'Detached HEAD'),
    readOnlyGit(root, ['log', '-1', '--no-show-signature', '--format=%H%x00%aI%x00%s'], signal).catch(() => ''),
    engineeringStatus(root, signal)
  ]);
  const [head, date, subject] = log.trimEnd().split('\0');
  const records = status.split('\0');
  const counts = { staged: 0, unstaged: 0, untracked: 0 };
  for (let i = 0; i < records.length && records[i]; i++) {
    const code = records[i].slice(0, 2);
    if (code === '??') counts.untracked++;
    else {
      if (code[0] !== ' ') counts.staged++;
      if (code[1] !== ' ') counts.unstaged++;
    }
    if (/[RC]/.test(code)) i++;
  }
  return { root, commonDir: commonDir.trimEnd(), worktree: worktree.trimEnd(), branch: branch.trim(), head, date, subject, counts,
    statusFingerprint: createHash('sha256').update(status).digest('hex') };
}
module.exports = { readGitDashboard, readGitDiff, runGitOperation, azureRepositoryUrl, readEngineeringGit, readOnlyGit };
