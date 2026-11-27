const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../media/board.js'), 'utf8');
const layoutSource = source.slice(source.indexOf('function gitGraphLayout('), source.indexOf('function renderGit('));
const layout = vm.runInNewContext(layoutSource + '; gitGraphLayout');
test('Git graph keeps first-parent colors and separates merged paths without lane collisions', () => {
  const commits = [
    {hash:'merge', parents:['main','feature']},
    {hash:'main', parents:['base']},
    {hash:'feature', parents:['base']},
    {hash:'base', parents:[]},
    {hash:'other', parents:[]}
  ];
  const {byHash, maxLanes} = layout(commits);
  assert.equal(byHash.get('merge').color, byHash.get('main').color);
  assert.equal(byHash.get('main').color, byHash.get('base').color);
  assert.notEqual(byHash.get('main').color, byHash.get('feature').color);
  assert.notEqual(byHash.get('main').lane, byHash.get('feature').lane);
  assert.notEqual(byHash.get('other').color, byHash.get('base').color);
  assert.equal(maxLanes, 2);
  assert.equal(layout([]).positions.length, 0);
});

test('Changed files tree lists folders first, merges single-child chains and hides collapsed folders', () => {
  const treeSource = source.slice(source.indexOf('function gitTreeRows('), source.indexOf('function gitFileStatus('));
  const rows = vm.runInNewContext(treeSource + '; gitTreeRows');
  const files = ['README.md', 'src/engineering/graph/layout.js', 'src/engineering/graph/edges.js', 'src/git.js', 'media/board.js'];
  const shape = list => [...list].map(row => `${row.depth}:${row.type === 'folder' ? row.name + '/' + row.count : row.name}`);
  assert.deepEqual(shape(rows(files, new Set())), ['0:media/1', '1:board.js', '0:src/3', '1:engineering/graph/2', '2:edges.js', '2:layout.js', '1:git.js', '0:README.md']);
  assert.deepEqual(shape(rows(files, new Set(['src/engineering/graph']))), ['0:media/1', '1:board.js', '0:src/3', '1:engineering/graph/2', '1:git.js', '0:README.md']);
  assert.equal(rows(files, new Set()).find(row => row.name === 'layout.js').file, 'src/engineering/graph/layout.js');
});
