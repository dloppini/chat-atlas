// Run against scripts/preview.js using playwright-cli run-code --filename.
async page => {
  const checks = [];
  const assert = (pass, label) => { if (!pass) throw new Error(label); checks.push(label); };
  const race = 'path:c:/code/race studio', lab = 'path:c:/code/suspension lab';
  const row = key => page.locator(`.project-entry[data-project="${key}"]`);
  const order = () => page.locator('.project-entry').evaluateAll(rows => rows.map(row => row.dataset.project));
  const ui = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlasDemoUi')));
  const reset = async (width = 1440, saved = {}) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:4317');
    await page.waitForFunction(() => Number(document.querySelector('#total')?.textContent) > 0);
    await page.evaluate(saved => {
      localStorage.clear();
      localStorage.setItem('atlasDemoUi', JSON.stringify(saved));
    }, saved);
    await page.goto('about:blank');
    await page.goto('http://127.0.0.1:4317');
    await page.waitForFunction(() => document.querySelectorAll('.card').length > 0);
  };
  const assigned = async (key, project) => {
    await page.waitForFunction(({ key, project }) => JSON.parse(localStorage.getItem('atlasDemoData')).sessions.find(s => s.key === key).projectOverride === project, { key, project });
  };
  await reset();
  await page.getByLabel('Project sort order').selectOption('manual');
  assert(await page.getByRole('button', { name: /^Move .* (up|down)$/ }).count() === 0, 'Manual sorting has no arrow buttons');
  await row(lab).locator('.nav').focus();
  await page.keyboard.press('Alt+ArrowUp');
  let manual = await order();
  assert(manual.indexOf(lab) < manual.indexOf(race), 'Keyboard sorting works without arrow buttons');
  await page.getByLabel('Project sort order').selectOption('alphabetical');
  const alphabetical = await page.locator('.project-name').allTextContents();
  assert(JSON.stringify(alphabetical) === JSON.stringify([...alphabetical].sort((a, b) => a.localeCompare(b))), 'Alphabetical sorting remains available');
  await page.getByLabel('Project sort order').selectOption('manual');
  assert(JSON.stringify(await order()) === JSON.stringify(manual), 'Switching back to Manual retains its order');
  const source = await row(race).boundingBox(), target = await row(manual[0]).boundingBox();
  await page.mouse.move(source.x + 25, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 25, source.y + source.height / 2 + 12, { steps: 5 });
  await page.mouse.move(target.x + 25, target.y + 3, { steps: 12 });
  await page.mouse.up();
  assert((await order())[0] === race, 'Native drag reorders projects');
  manual = await order();
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.card').length > 0);
  assert(JSON.stringify(await order()) === JSON.stringify(manual), 'Manual order persists after reload');

  for (const width of [1440, 1000, 800, 681, 390]) {
    await reset(width, { project: race });
    await page.getByRole('button', { name: 'Details for Dashboard layout refinements', exact: true }).click();
    if (width > 680) {
      assert(await page.getByRole('complementary', { name: 'Projects', exact: true }).isVisible(), `${width}: opening details keeps sidebar visible`);
      assert(await page.getByRole('button', { name: 'Hide project sidebar', exact: true }).isVisible(), `${width}: sidebar toggle remains available`);
    }
    await page.locator('#detail').getByRole('combobox', { name: 'Project', exact: true }).selectOption(lab);
    await assigned('codex:demo-0', lab);
    assert((await ui()).project === race && await page.locator('#heading').textContent() === 'Race Studio', `${width}: moving a task retains selected project`);
    assert(await page.locator('#detail').isVisible(), `${width}: moved task details stay open`);
    assert((await ui()).sidebarHidden === false, `${width}: moving retains sidebar preference`);
    if (width > 680) assert(await page.locator('#project-sidebar').isVisible(), `${width}: moving keeps sidebar visible`);
    assert(await page.locator('.card[data-key="codex:demo-0"]').count() === 0 && await row(race).locator('.project-count').textContent() === '4', `${width}: task moves out of source and counts update`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow with details open`);
    if ([1440, 800, 390].includes(width)) await page.screenshot({ path: `output/playwright/project-moves-${width}.png` });
    await page.locator('#detail').getByRole('combobox', { name: 'Project', exact: true }).selectOption('__create__');
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('New destination');
    await page.locator('#project-form').getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('atlasDemoData')).sessions.find(s => s.key === 'codex:demo-0').projectOverride.startsWith('custom:'));
    await page.waitForFunction(() => !document.querySelector('#project-dialog').open);
    assert((await ui()).project === race && await page.locator('#detail').isVisible(), `${width}: moving into a new project preserves project and details`);
    if (width > 680) assert(await page.locator('#project-sidebar').isVisible(), `${width}: new-project move retains sidebar`);
  }

  await reset(1440, { project: 'path:c:/code/timing desk' });
  await page.getByRole('button', { name: 'Details for Prepare deployment checks', exact: true }).click();
  await page.locator('#detail').getByRole('combobox', { name: 'Project', exact: true }).selectOption(lab);
  await assigned('claude:demo-7', lab);
  assert((await ui()).project === 'path:c:/code/timing desk' && await row('path:c:/code/timing desk').locator('.project-count').textContent() === '0', 'Moving the last task retains the selected empty project in sidebar');

  await reset();
  await page.getByRole('button', { name: 'Details for Dashboard layout refinements', exact: true }).click();
  await page.locator('#detail').getByRole('combobox', { name: 'Project', exact: true }).selectOption(lab);
  await assigned('codex:demo-0', lab);
  assert((await ui()).project === '', 'Moving from All projects retains All projects');
  await page.locator('#detail').getByRole('combobox', { name: 'Project', exact: true }).selectOption('');
  await assigned('codex:demo-0', null);
  assert((await ui()).project === '', 'Restoring Automatic retains All projects');
  await page.getByRole('button', { name: 'Hide project sidebar', exact: true }).click();
  await page.locator('#detail').getByRole('combobox', { name: 'Project', exact: true }).selectOption(lab);
  await assigned('codex:demo-0', lab);
  assert((await ui()).sidebarHidden && !await page.locator('#project-sidebar').isVisible(), 'Moving retains an explicitly hidden sidebar');
  await page.getByRole('button', { name: 'Show project sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.locator('#new-project').click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Empty project');
  await page.locator('#project-form').getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#heading').textContent === 'Empty project');
  assert((await ui()).project.startsWith('custom:'), 'Creating an empty project still opens that project');
  return { passed: checks.length, checks };
}
