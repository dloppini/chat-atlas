// Run against scripts/preview.js using playwright-cli run-code --filename.
async page => {
  await page.goto('http://127.0.0.1:4317');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.project-git-dots').length === 2);
  const checks = [];
  const assert = (pass, label) => { if (!pass) throw new Error(label); checks.push(label); };
  const race = page.locator('.project-entry[data-project="path:c:/code/race studio"]');
  const lab = page.locator('.project-entry[data-project="path:c:/code/suspension lab"]');
  const counts = row => row.locator('.git-count').evaluateAll(items => items.map(item => `${item.dataset.kind}:${item.textContent}`).join());
  assert(await counts(race) === 'new:1,modified:1,deleted:1,behind:3', 'Counts order new, modified, deleted, then behind');
  assert(await counts(lab) === 'modified:1', 'Modified-only project shows one count');
  assert(await race.locator('.project-git-dots').getAttribute('aria-label') === 'Uncommitted: 1 new, 1 modified, 1 deleted. 3 commits behind origin/main', 'Accessible git status');
  await page.evaluate(() => window.postMessage({ type: 'gitSummary', summary: { 'path:c:/code/suspension lab': ['R ', 'A ', '??', '??', ...Array(120).fill(' M')] }, behind: {} }));
  await page.waitForFunction(() => !document.querySelector('.project-entry[data-project="path:c:/code/race studio"] .project-git-dots'));
  assert(await counts(lab) === 'new:3,modified:121', 'Staged add is new, rename is modified, and counts add up');
  await page.evaluate(() => window.postMessage({ type: 'gitSummary', summary: {}, behind: { 'path:c:/code/suspension lab': { count: 1, base: 'origin/master', hash: 'b', name: 'Suspension Lab' } } }));
  await page.waitForFunction(() => document.querySelector('.project-entry[data-project="path:c:/code/suspension lab"] .project-git-dots')?.getAttribute('aria-label') === '1 commit behind origin/master');
  checks.push('Behind-only project shows the arrow with singular wording');
  for (const theme of ['dark', 'pearl']) {
    await page.evaluate(t => { document.body.dataset.theme = t; window.postMessage({ type: 'gitSummary', summary: { 'path:c:/code/race studio': ['??', ' M', ' M', ' D', ...Array(14).fill('??')] }, behind: { 'path:c:/code/race studio': { count: 12, base: 'origin/main', hash: 'a', name: 'Race Studio' } } }); }, theme);
    await page.waitForFunction(() => document.querySelectorAll('.project-entry[data-project="path:c:/code/race studio"] .git-count').length === 4);
    const colors = await race.locator('.git-count').evaluateAll(items => items.map(item => getComputedStyle(item, '::before').backgroundColor));
    assert(new Set(colors).size === 4, `${theme}: four distinct marker colors`);
    for (const width of [1440, 800, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390) { await page.locator('#sidebar-toggle').click(); await page.locator('#project-drawer').waitFor(); }
      const row = page.locator('.project-entry[data-project="path:c:/code/race studio"]:visible');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}: no page overflow`);
      const dots = await row.locator('.project-git-dots').boundingBox(), name = await row.locator('.project-name').boundingBox(), entry = await row.boundingBox();
      assert(Math.abs((dots.y + dots.height / 2) - (name.y + name.height / 2)) <= 1.5, `${theme} ${width}: counts centered on name`);
      assert(dots.x >= name.x + name.width && dots.x - (name.x + name.width) <= 8, `${theme} ${width}: counts follow the name`);
      assert(dots.x + dots.width <= entry.x + entry.width, `${theme} ${width}: counts stay inside the row`);
      await row.screenshot({ path: `output/playwright/project-git-${theme}-${width}.png` });
      if (width === 390) { await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1440, height: 900 }); }
    }
  }
  return checks;
}
