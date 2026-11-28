const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readGitDashboard, readGitDiff } = require('../src/git');
const { runGitOperation, azureRepositoryUrl } = require('../src/git');

test('All lists local changes together and previews each file against its correct baseline', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-all-diff-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const git = (...args) => execFileSync('git', args, {cwd:root, stdio:'pipe'});
  const write = (name, text) => fs.writeFile(path.join(root, name), text + '\n');
  const all = file => readGitDiff(root, {mode:'all', file});
  git('init','-b','main');
  await write('modified.txt', 'initial');
  git('add','.');
  await write('modified.txt', 'before first commit');
  assert.match((await all('modified.txt')).patch, /\+before first commit/);
  git('add','.'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Base');
  await write('modified.txt', 'staged edit'); git('add','modified.txt');
  await write('modified.txt', 'combined edit');
  await write('staged.txt', 'staged add'); git('add','staged.txt');
  await write('new [1].txt', 'new file');
  const result = await all('modified.txt');
  assert.deepEqual(result.files, ['modified.txt','staged.txt','new [1].txt']);
  assert.deepEqual(result.changes.map(item => item.code), ['MM','A ','??']);
  assert.match(result.patch, /-before first commit[\s\S]*\+combined edit/);
  assert.match((await all('staged.txt')).patch, /\+staged add/);
  assert.match((await all('new [1].txt')).patch, /\+new file/);
  await assert.rejects(all('../outside.txt'), /no longer in the comparison/);
  assert.deepEqual((await readGitDiff(root,{mode:'working'})).files,['modified.txt']);
  assert.deepEqual((await readGitDiff(root,{mode:'staged'})).files,['modified.txt','staged.txt']);
  await write('modified.txt', 'before first commit'); git('add','modified.txt');
  git('mv','modified.txt','renamed.txt');
  const rename = await all('renamed.txt');
  assert.equal(rename.changes.find(change => change.file === 'renamed.txt').original, 'modified.txt');
  assert.match(rename.patch, /rename to renamed\.txt/);
});

test('Large working, staged and committed diffs return bounded previews instead of overflowing stdout', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-large-diff-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main'); git('config','user.name','Test'); git('config','user.email','test@example.invalid'); git('config','core.autocrlf','false');
  await fs.writeFile(path.join(root,'large.txt'),'base\n');
  await fs.writeFile(path.join(root,'small.txt'),'small\n');
  git('add','.'); git('commit','-m','Base');
  const large = 'updated \u00e8\u{1f680} '.repeat(400000) + '\n';
  assert.ok(Buffer.byteLength(large) > 4 * 1024 * 1024);
  await fs.writeFile(path.join(root,'large.txt'),large); await fs.writeFile(path.join(root,'small.txt'),'small change\n');
  for (const mode of ['working','staged','commit']) {
    if (mode === 'staged') git('add','.');
    if (mode === 'commit') git('commit','-m','Large update');
    const selection = {mode,...(mode === 'commit' ? {commit:git('rev-parse','HEAD')} : {})};
    const before = git('status','--porcelain=v1');
    const preview = await readGitDiff(root,{...selection,file:'large.txt'});
    assert.deepEqual(preview.files,['large.txt','small.txt']);
    assert.equal(preview.truncated,true); assert.ok(Buffer.byteLength(preview.patch) <= 512 * 1024);
    assert.match(preview.patch,/\+updated/); assert.ok(!preview.patch.includes('\ufffd')); assert.ok(preview.patch.isWellFormed());
    const small = await readGitDiff(root,{...selection,file:'small.txt'});
    assert.equal(small.truncated,false); assert.match(small.patch,/\+small change/);
    assert.equal(git('status','--porcelain=v1'),before);
  }
});

test('Streamed previews still report late Git failures, timeouts and missing executables', async () => {
  const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
  const source = await fs.readFile(path.join(__dirname,'../src/git.js'),'utf8');
  for (const failure of ['late','timeout','missing']) {
    const module = {exports:{}};
    require('node:vm').runInNewContext(source, {module,process,setTimeout,clearTimeout,require:name => name === 'node:child_process' ? {
      execFile: (command,args,options,callback) => callback(null,args.includes('--show-toplevel') ? '/fixture' : 'M\0file.txt\0',''),
      spawn: () => {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        process.nextTick(() => {
          if (failure === 'missing') { child.emit('error',Object.assign(new Error('missing'),{code:'ENOENT'})); child.emit('close',-2,null); return; }
          child.stdout.end(Buffer.alloc(600000,97)); child.stderr.end('fatal: late read failure');
          child.killed = failure === 'timeout'; child.emit('close',child.killed ? null : 1,child.killed ? 'SIGTERM' : null);
        });
        return child;
      }
    } : require(name)});
    await assert.rejects(module.exports.readGitDiff('/fixture',{mode:'working'}),failure === 'missing' ? /Git is unavailable/ : failure === 'timeout' ? /Git timed out/ : /late read failure/);
  }
});

test('Stage, unstage and commit preserve working files, exact paths, index review and hooks', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-commit-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main'); git('config','user.name','Test'); git('config','user.email','test@example.invalid');
  const act = async (action, options = {}) => { const repo = await readGitDashboard(root); return runGitOperation(root, action, repo.head, repo.branch, {indexVersion:repo.indexVersion,...options}); };
  await fs.writeFile(path.join(root,'file [1].txt'),'initial');
  await fs.writeFile(path.join(root,'keep.txt'),'unstaged');
  await assert.rejects(act('stage',{files:['../outside']}),/Selected files changed/);
  await act('stage',{files:['file [1].txt']});
  await act('unstage',{files:['file [1].txt']});
  assert.equal(await fs.readFile(path.join(root,'file [1].txt'),'utf8'),'initial');
  assert.equal(git('ls-files'),'');
  await assert.rejects(act('commit',{message:'Nothing'}),/Stage at least/);
  await act('stage',{files:['file [1].txt']});
  await assert.rejects(act('commit',{message:'   '}),/commit message/);
  await assert.rejects(act('commit',{message:'bad\0message'}),/commit message/);
  const stale = await readGitDashboard(root);
  git('add','keep.txt');
  await assert.rejects(runGitOperation(root,'commit',stale.head,stale.branch,{message:'Stale',indexVersion:stale.indexVersion}),/Staged changes changed/);
  await act('unstage',{files:['keep.txt']});
  await fs.writeFile(path.join(root,'file [1].txt'),'working edit');
  await act('commit',{message:'First commit\n\nDetailed explanation'});
  assert.equal(git('show','HEAD:file [1].txt'),'initial');
  assert.equal(await fs.readFile(path.join(root,'file [1].txt'),'utf8'),'working edit');
  assert.match(git('log','-1','--format=%B'),/Detailed explanation/);
  assert.equal(git('ls-files'),'file [1].txt');
  await act('stage',{files:['file [1].txt']});
  await act('unstage',{files:['file [1].txt']});
  assert.equal(git('diff','--cached','--name-only'),'');
  await act('stage',{files:['file [1].txt']});
  const hook = path.join(root,'.git','hooks','pre-commit');
  await fs.writeFile(hook,'#!/bin/sh\necho "Hook stopped commit" >&2\nexit 1\n',{mode:0o755});
  await assert.rejects(act('commit',{message:'Hook failure'}),/Hook stopped commit/);
  assert.equal(git('diff','--cached','--name-only'),'file [1].txt');
  await fs.unlink(hook); await act('commit',{message:'Update'});
  git('mv','file [1].txt','renamed.txt');
  await act('unstage',{files:['renamed.txt']});
  assert.equal(git('diff','--cached','--name-only'),'');
  assert.equal(await fs.readFile(path.join(root,'renamed.txt'),'utf8'),'working edit');
  await act('stage',{files:['file [1].txt','renamed.txt']}); await act('commit',{message:'Rename'});
  await fs.unlink(path.join(root,'renamed.txt')); await act('stage',{files:['renamed.txt']});
  await act('unstage',{files:['renamed.txt']}); assert.equal(git('diff','--cached','--name-only'),'');
  assert.match(git('status','--porcelain'),/D renamed.txt/);
});

test('Azure remotes map to credential-free, encoded PR URLs and require a published branch', async t => {
  const expected='https://dev.azure.com/acme/My%20Project/_git/repo';
  for (const remote of ['https://user:secret@dev.azure.com/acme/My%20Project/_git/repo','git@ssh.dev.azure.com:v3/acme/My%20Project/repo','ssh://git@ssh.dev.azure.com/v3/acme/My%20Project/repo','https://acme.visualstudio.com/My%20Project/_git/repo','https://acme.visualstudio.com/DefaultCollection/My%20Project/_git/repo','acme@vs-ssh.visualstudio.com:v3/acme/My%20Project/repo']) assert.equal(azureRepositoryUrl(remote),expected);
  for(const remote of ['https://github.com/acme/repo','https://dev.azure.com.evil.test/acme/project/_git/repo','file:///tmp/repo','https://dev.azure.com/acme/project/_git/%2Fbad','https://dev.azure.com/acme/project/_git/repo?token=secret','https://dev.azure.com/acme/project/_git/repo#bad','ssh://evil.test/v3/acme/project/repo']) assert.equal(azureRepositoryUrl(remote),null);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-pr-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','feature/test');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('commit','--allow-empty','-m','Base');
  git('remote','add','azure','git@ssh.dev.azure.com:v3/acme/My%20Project/repo');
  // A remote pushing to several URLs is ambiguous, and a URL-less remote is still listed.
  git('remote','add','mirror','git@ssh.dev.azure.com:v3/acme/My%20Project/repo');git('config','--add','remote.mirror.pushurl','https://github.com/acme/repo');git('config','--add','remote.mirror.pushurl','git@ssh.dev.azure.com:v3/acme/My%20Project/repo');
  git('config','remote.bare.fetch','+refs/heads/*:refs/remotes/bare/*');
  let repo=await readGitDashboard(root);
  assert.deepEqual(repo.azureRemotes,[{name:'azure',url:expected}]);
  assert.deepEqual(repo.remotes,['azure','bare','mirror']);
  await assert.rejects(runGitOperation(root,'createPr',repo.head,repo.branch,{remote:'unknown'}),/Select an Azure/);
  await assert.rejects(runGitOperation(root,'createPr',repo.head,repo.branch,{remote:'azure'}),/Push this branch/);
  git('update-ref','refs/remotes/azure/feature/test',repo.head);
  assert.deepEqual(await runGitOperation(root,'createPr',repo.head,repo.branch,{remote:'azure'}),{url:expected+'/pullrequestcreate?sourceRef=feature%2Ftest'});
  git('commit','--allow-empty','-m','Unpublished'); repo=await readGitDashboard(root);
  await assert.rejects(runGitOperation(root,'createPr',repo.head,repo.branch,{remote:'azure'}),/Push this branch/);
});
test('Git dashboard reads unborn repositories, topology, renames and working changes without mutation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-git-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  git('init', '-b', 'main'); git('config', 'user.name', 'Atlas Test'); git('config', 'user.email', 'atlas@example.invalid');
  assert.equal((await readGitDashboard(root)).graph, '');
  await fs.writeFile(path.join(root, 'old.txt'), 'first\n'); git('add', '.'); git('commit', '-m', 'Initial commit');
  git('checkout', '-b', 'feature'); await fs.writeFile(path.join(root, 'feature.txt'), 'feature'); git('add', '.'); git('commit', '-m', 'Feature');
  git('checkout', 'main'); git('merge', '--no-ff', 'feature', '-m', 'Merge feature');
  git('mv', 'old.txt', 'new name.txt'); await fs.writeFile(path.join(root, 'feature.txt'), 'changed'); await fs.writeFile(path.join(root, 'untracked.txt'), 'new');
  const before = git('status', '--porcelain=v1', '-z');
  const result = await readGitDashboard(root);
  assert.equal(result.branch, 'main'); assert.match(result.branches, /feature/); assert.match(result.graph, /Merge feature/); assert.match(result.graph, /\|/);
  assert.deepEqual(result.changes.find(c => c.code === 'R '), { code: 'R ', file: 'new name.txt', original: 'old.txt' });
  assert.ok(result.changes.some(c => c.code === ' M')); assert.ok(result.changes.some(c => c.code === '??'));
  assert.equal(result.commits[0].parents.length, 2);
  const working = await readGitDiff(root, { mode: 'working' });
  assert.deepEqual(working.files, ['feature.txt']); assert.match(working.patch, /\+changed/);
  const staged = await readGitDiff(root, { mode: 'staged' });
  assert.ok(staged.files.includes('new name.txt'));
  const untracked = await readGitDiff(root, { mode: 'untracked' });
  assert.match(untracked.patch, /\+new/);
  const committed = await readGitDiff(root, { mode: 'commit', commit: result.commits[0].hash });
  assert.ok(committed.files.includes('feature.txt')); assert.match(committed.patch, /\+feature/);
  assert.deepEqual(staged.changes.find(change => change.file === 'new name.txt'), { code: 'R', file: 'new name.txt', original: 'old.txt' });
  assert.deepEqual(working.changes, [{ code: 'M', file: 'feature.txt', original: '' }]);
  assert.ok(untracked.changes.length && untracked.changes.every(change => change.code === '??'));
  assert.deepEqual(committed.changes.map(change => change.code), committed.files.map(() => 'A'));
  const first = await readGitDiff(root, { mode: 'commit', commit: result.commits.at(-1).hash });
  assert.ok(first.files.includes('old.txt'));
  await assert.rejects(readGitDiff(root, { mode: 'working', file: '../outside.txt' }), /no longer/);
  await assert.rejects(readGitDiff(root, { mode: 'commit', commit: '--all' }), /Invalid commit/);
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0,1,2]));
  assert.match((await readGitDiff(root, { mode: 'untracked', file: 'binary.bin' })).patch, /Binary/);
  await fs.unlink(path.join(root, 'binary.bin'));
  assert.equal(git('status', '--porcelain=v1', '-z'), before);
  git('checkout', '--detach'); assert.equal((await readGitDashboard(root)).branch, 'Detached HEAD');
});
test('Git dashboard rejects non-repositories', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-no-git-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, '.git'), 'gitdir: missing-repository');
  // Git versions word this differently: older ones say "not a git repository", newer ones name the broken gitfile.
  await assert.rejects(readGitDashboard(root), /not a git repository|does not point to a valid repository/);
});

test('Branch focus loads exact local and remote refs beyond the all-branch history limit', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-focus-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const git = (...args) => execFileSync('git', args, {cwd:root,encoding:'utf8',windowsHide:true});
  git('init','-b','main'); git('config','user.name','Atlas Test'); git('config','user.email','atlas@example.invalid');
  git('commit','--allow-empty','-m','Base');
  const base = git('rev-parse','HEAD').trim();
  git('branch','old-focus'); git('update-ref','refs/remotes/origin/old-focus',base);
  for(let i=0;i<101;i++) git('commit','--allow-empty','-m','Main '+i);
  const before=git('rev-parse','HEAD');
  const all=await readGitDashboard(root);
  assert.equal(all.commits.length,100);
  assert.ok(!all.commits.some(commit=>commit.hash===base));
  for(const ref of ['refs/heads/old-focus','refs/remotes/origin/old-focus']) {
    const focused=await readGitDashboard(root,ref);
    assert.equal(focused.focusRef,ref);
    assert.equal(focused.commits.length,1);
    assert.equal(focused.commits[0].hash,base);
    assert.ok(focused.branchRefs.some(branch=>branch.ref===ref));
  }
  for(const ref of ['--all','main~1','refs/heads/missing',{},42]) await assert.rejects(readGitDashboard(root,ref),/branch is no longer/);
  assert.equal(git('rev-parse','HEAD'),before);
});

test('Git synchronization reports HEAD and divergence and uses explicit upstream safely', async t => {
  const {runGitOperation}=require('../src/git');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-sync-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const remote=path.join(root,'remote.git'), a=path.join(root,'a'), b=path.join(root,'b');
  const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git(root,'init','--bare',remote);git(root,'clone',remote,a);
  for(const cwd of [a]){git(cwd,'config','user.name','Test');git(cwd,'config','user.email','test@example.invalid');}
  git(a,'checkout','-b','main');git(a,'commit','--allow-empty','-m','Base');git(a,'push','-u','origin','main');
  git(root,'clone','-b','main',remote,b);git(b,'config','user.name','Test');git(b,'config','user.email','test@example.invalid');
  let repo=await readGitDashboard(a);assert.equal(repo.head,git(a,'rev-parse','HEAD'));assert.deepEqual(repo.tracking,[0,0]);
  git(b,'commit','--allow-empty','-m','Remote work');git(b,'push');
  await runGitOperation(a,'fetch');repo=await readGitDashboard(a);assert.deepEqual(repo.tracking,[0,1]);
  await fs.writeFile(path.join(a,'dirty.txt'),'keep me');
  await assert.rejects(runGitOperation(a,'pull',repo.head,repo.branch),/Commit or stash/);assert.equal(await fs.readFile(path.join(a,'dirty.txt'),'utf8'),'keep me');await fs.unlink(path.join(a,'dirty.txt'));
  await runGitOperation(a,'pull',repo.head,repo.branch);assert.equal(git(a,'rev-parse','HEAD'),git(b,'rev-parse','HEAD'));
  git(a,'commit','--allow-empty','-m','Local work');repo=await readGitDashboard(a);assert.deepEqual(repo.tracking,[1,0]);
  await assert.rejects(runGitOperation(a,'push','0'.repeat(40),'main'),/HEAD changed/);
  await assert.rejects(runGitOperation(a,'push',repo.head,'other'),/HEAD changed/);
  await runGitOperation(a,'push',repo.head,repo.branch);assert.equal(git(root,'--git-dir',remote,'rev-parse','main'),repo.head);
  git(b,'pull','--ff-only');git(b,'commit','--allow-empty','-m','Other work');git(b,'push');git(a,'commit','--allow-empty','-m','Diverged');
  await runGitOperation(a,'fetch');repo=await readGitDashboard(a);assert.deepEqual(repo.tracking,[1,1]);
  await assert.rejects(runGitOperation(a,'pull',repo.head,repo.branch));assert.equal(git(a,'rev-parse','HEAD'),repo.head);
  await assert.rejects(runGitOperation(a,'push',repo.head,repo.branch));
  const focus=await readGitDashboard(a,'refs/remotes/origin/main');assert.deepEqual(focus.comparison,[1,1]);
  git(a,'checkout','--detach');await assert.rejects(runGitOperation(a,'push',repo.head,'Detached HEAD'),/Check out/);
  git(a,'checkout','-b','no-upstream');repo=await readGitDashboard(a);await assert.rejects(runGitOperation(a,'push',repo.head,repo.branch),/upstream/);
  await runGitOperation(a,'push',repo.head,repo.branch,{remote:'origin'});
  assert.equal((await readGitDashboard(a)).upstream,'origin/no-upstream');
  assert.equal(git(root,'--git-dir',remote,'rev-parse','no-upstream'),repo.head);
  await assert.rejects(runGitOperation(a,'reset'),/Invalid/);
  git(a,'remote','remove','origin');await assert.rejects(runGitOperation(a,'fetch'),/No remote/);
});

test('Commit refuses unresolved conflicts without changing the branch', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-conflict-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  await fs.writeFile(path.join(root,'shared.txt'),'base\n');git('add','.');git('commit','-m','Base');git('checkout','-b','other');
  await fs.writeFile(path.join(root,'shared.txt'),'other\n');git('commit','-am','Other');git('checkout','main');
  await fs.writeFile(path.join(root,'shared.txt'),'main\n');git('commit','-am','Main');assert.throws(()=>git('merge','other'));
  const repo=await readGitDashboard(root);
  await assert.rejects(runGitOperation(root,'commit',repo.head,repo.branch,{indexVersion:repo.indexVersion,message:'Unresolved'}),/Resolve and stage/);
  assert.equal(git('rev-parse','HEAD'),repo.head);assert.match(git('status','--porcelain'),/UU shared.txt/);
});

test('Status codes summarize a repository for the sidebar dots and skip non-repositories', async t => {
  const { readGitStatusCodes } = require('../src/git');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-status-codes-'));
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(root); // The temp folder may sit inside a home-directory repository.
  t.after(() => { if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = ceiling; return fs.rm(root, {recursive:true, force:true}); });
  assert.equal(await readGitStatusCodes(root), null);
  const git = (...args) => execFileSync('git', args, {cwd:root, stdio:'pipe'});
  git('init','-b','main');
  assert.deepEqual(await readGitStatusCodes(root), []);
  for (const name of ['a.txt','b.txt']) await fs.writeFile(path.join(root, name), 'x\n');
  git('add','.'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Base');
  await fs.writeFile(path.join(root, 'a.txt'), 'y\n');
  await fs.rm(path.join(root, 'b.txt'));
  await fs.writeFile(path.join(root, 'c.txt'), 'z\n');
  await fs.mkdir(path.join(root, 'new'));
  for (const name of ['d.txt','e.txt']) await fs.writeFile(path.join(root, 'new', name), 'w\n');
  // One code per file, untracked folders expanded, so the sidebar can count them.
  assert.deepEqual((await readGitStatusCodes(root)).sort(), [' D',' M','??','??','??']);
});

test('Current branch names the checked-out branch, a detached commit, or nothing outside a repository', async t => {
  const { readCurrentBranch } = require('../src/git');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-branch-'));
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(root);
  t.after(() => { if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = ceiling; return fs.rm(root, {recursive:true, force:true}); });
  assert.equal(await readCurrentBranch(root), '');
  const git = (...args) => execFileSync('git', args, {cwd:root, stdio:'pipe'}).toString().trim();
  git('init','-b','main');
  await fs.writeFile(path.join(root, 'a.txt'), 'x\n');
  git('add','.'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Base');
  git('checkout','-b','feature/sidebar');
  assert.equal(await readCurrentBranch(root), 'feature/sidebar');
  git('checkout','--detach');
  assert.equal(await readCurrentBranch(root), `detached ${git('rev-parse','--short','HEAD')}`);
});

test('Behind main counts remote main commits missing from HEAD on main and feature branches', async t => {
  const { readBehindMain } = require('../src/git');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-behind-'));
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(base);
  t.after(() => { if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = ceiling; return fs.rm(base, {recursive:true, force:true}); });
  const remote = path.join(base, 'remote.git'), a = path.join(base, 'a'), b = path.join(base, 'b');
  const git = (cwd, ...args) => execFileSync('git', ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid', ...args], {cwd, stdio:'pipe'}).toString().trim();
  git(base, 'init', '--bare', '-b', 'main', remote);
  git(base, 'clone', remote, a); git(a, 'checkout', '-B', 'main');
  await fs.writeFile(path.join(a, 'x.txt'), '1\n'); git(a, 'add', '.'); git(a, 'commit', '-m', 'one'); git(a, 'push', '-u', 'origin', 'main');
  git(base, 'clone', remote, b);
  assert.equal(await readBehindMain(base, false), null, 'Not a repository');
  const start = await readBehindMain(b, false);
  assert.equal(start.base, 'origin/main'); assert.equal(start.behind, 0);
  for (const n of [2, 3]) { await fs.writeFile(path.join(a, 'x.txt'), `${n}\n`); git(a, 'commit', '-am', String(n)); }
  git(a, 'push');
  assert.equal((await readBehindMain(b, false)).behind, 0, 'Without fetching, local refs are unchanged');
  const fetched = await readBehindMain(b, true);
  assert.equal(fetched.behind, 2); assert.equal(fetched.hash, git(a, 'rev-parse', 'HEAD'));
  git(b, 'checkout', '-b', 'feature');
  assert.equal((await readBehindMain(b, false)).behind, 2, 'A feature branch compares with the remote main');
  assert.equal(git(b, 'status', '--porcelain'), '', 'Fetching leaves the working tree untouched');
});

test('Canceling a Git read ends the real git.exe, not only the Windows launcher', async () => {
  const { readOnlyGit } = require('../src/git');
  const marker = `atlas-orphan-${process.pid}-${Date.now()}`;
  const controller = new AbortController();
  // hash-object --stdin waits on the open stdin pipe until it is stopped.
  const pending = readOnlyGit(os.tmpdir(), ['hash-object', '--stdin', `--path=${marker}`], controller.signal);
  setTimeout(() => controller.abort(), 500);
  await assert.rejects(pending, /canceled/);
  if (process.platform !== 'win32') return;
  await new Promise(resolve => setTimeout(resolve, 500));
  const left = execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name='git.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' }).Count`]).toString().trim();
  assert.equal(left, '0');
});
