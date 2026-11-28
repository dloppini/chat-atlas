const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SessionIndex, fileMatch, passages, searchPatterns, lastMatch, reconcile, publicSessions, claudeProjectPrompt } = require('../src/core');

test('Historical file evidence and matching passages include the unsampled middle of a session', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-history-'));
  t.after(() => fs.rm(root, {recursive:true,force:true}));
  const id = 'aaaaaaaa-1111-4111-8111-111111111111';
  const file = path.join(root,id + '.jsonl'), target = path.join(root,'src','board.js');
  const message = (role,text) => ({type:'response_item',payload:{type:'message',role,content:text}});
  const pad = {noise:'x'.repeat(300000)};
  const records = [
    {type:'session_meta',payload:{id,cwd:root}},message('user','Investigate the board'),pad,
    {type:'event_msg',payload:{type:'patch_apply_end',changes:{'src/board.js':{}}}},
    {type:'event_msg',payload:{type:'exec_command_end',parsed_cmd:[{type:'read',path:'docs/notes.md'}]}},
    message('assistant','Restore keyboard focus; see src/dialog.js.'), message('user','Test the result'),
    pad,message('assistant','Finished')
  ];
  await fs.writeFile(file,records.map(r=>JSON.stringify(r)).join('\n'));
  const s = await new SessionIndex().readSession('codex',file,await fs.stat(file));
  assert.equal((await fileMatch(s,target)).kind,'Edited');
  assert.equal((await fileMatch(s,path.join(root,'docs','notes.md'))).kind,'Read');
  assert.equal((await fileMatch(s,path.join(root,'src','dialog.js'))).kind,'Mentioned');
  assert.equal(await fileMatch(s,path.join(root,'other','dialog.js')),null);
  assert.equal(await fileMatch(s,path.join(root,'other-project','src','board.js')),null);
  const [hit] = await passages(s,'keyboard focus');
  const exchange = await passages(s,'keyboard focus', hit.line);
  assert.equal(exchange.before.text,'Investigate the board');
  assert.equal(exchange.after.text,'Test the result');
  assert.match(exchange.message.text,/keyboard focus/);
  assert.equal(publicSessions([s],reconcile([s],{}))[0].fileEvidence,undefined);
});

test('Search loosely matches word starts and passages point at the last occurrence', async t => {
  const [pattern] = searchPatterns('3D');
  assert.ok('render the 3D view'.search(pattern) >= 0);
  assert.ok('a 3D-model'.search(pattern) >= 0);
  for (const miss of ['commit 3dd2f01', 'color #3d3d3d', 'a13d', '3d2']) assert.equal(miss.search(pattern), -1, miss);
  const [loose] = searchPatterns('test');
  for (const hit of ['run the Tests', 'testing it']) assert.ok(hit.search(loose) >= 0, hit);
  assert.equal('a contest'.search(loose), -1);
  assert.deepEqual(lastMatch('3d first, then 3D again', pattern), { start: 15, end: 17 });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-words-'));
  t.after(() => fs.rm(root, {recursive:true,force:true}));
  const id = 'cccccccc-1111-4111-8111-111111111111', file = path.join(root, id + '.jsonl');
  const message = (role,text) => ({type:'response_item',payload:{type:'message',role,content:text}});
  await fs.writeFile(file,[{type:'session_meta',payload:{id,cwd:root}},message('user','Plan the 3D view'),message('assistant','Hash 3dd2f only'),message('user','Ship the 3D view')].map(r=>JSON.stringify(r)).join('\n'));
  const hits = await passages(await new SessionIndex().readSession('codex',file,await fs.stat(file)),'3d');
  assert.deepEqual(hits.map(hit => hit.label), ['Plan the 3D view','Ship the 3D view']);
});

test('A cross-project Claude handoff retains its source link and indexes tool paths',async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-handoff-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const id='bbbbbbbb-1111-4111-8111-111111111111', source='codex:aaaaaaaa-1111-4111-8111-111111111111';
  const file=path.join(root,id+'.jsonl');
  const records=[
    {type:'user',sessionId:id,cwd:root,message:{content:claudeProjectPrompt(root)+'Atlas handoff from '+source+'\n\nReview layout'}},
    {type:'assistant',message:{content:[{type:'tool_use',name:'Read',input:{file_path:path.join(root,'board.js')}}]}}
  ];
  await fs.writeFile(file,records.map(r=>JSON.stringify(r)).join('\n'));
  const s=await new SessionIndex().readSession('claude',file,await fs.stat(file));
  const state=reconcile([s],{});
  assert.equal(s.title,'Review layout');
  assert.equal(state.cards[s.key].handoffFrom,source);
  assert.equal((await fileMatch(s,path.join(root,'board.js'))).kind,'Read');
});
