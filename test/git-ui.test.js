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
