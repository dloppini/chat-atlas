// Run against scripts/preview.js using playwright-cli run-code --filename.
async page => {
  await page.goto('http://127.0.0.1:4317');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.card').length > 0);
  const checks = [];
  const assert = (pass, label) => { if (!pass) throw new Error(label); checks.push(label); };
  const project = key => page.locator(`.project-entry[data-project="${key}"]`);
  const race = project('path:c:/code/race studio');
  const lab = project('path:c:/code/suspension lab');
  assert(await race.locator('.project-run-indicator').count() === 1, 'Initial Codex project spinner');
  assert(await lab.locator('.project-run-indicator').count() === 1, 'Initial Claude project spinner');
  assert(await page.locator('.project-run-indicator').count() === 2, 'Idle projects have no spinner');
  await page.evaluate(() => {
    window.runningProjectRow = document.querySelector('.project-entry[data-project="path:c:/code/race studio"]');
    window.runningProjectSpinner = window.runningProjectRow.querySelector('.project-run-indicator');
    window.postMessage({ type: 'activity', sessions: [{ key: 'claude:demo-1', running: true }] });
  });
  await page.waitForFunction(() => window.runningProjectSpinner.title === '2 running tasks');
  assert((await race.locator('.nav').getAttribute('aria-label')).includes('2 running tasks'), 'Accessible running count');
  await page.evaluate(() => {
    window.scrollTo(0, 200);
    window.runningPageY = scrollY;
    window.postMessage({ type: 'activity', sessions: [{ key: 'codex:demo-0', running: false }] });
  });
  await page.waitForFunction(() => window.runningProjectSpinner.title === '1 running task');
  assert(await page.evaluate(() => window.runningProjectRow === document.querySelector('.project-entry[data-project="path:c:/code/race studio"]') && window.runningProjectSpinner === window.runningProjectRow.querySelector('.project-run-indicator') && scrollY === window.runningPageY), 'Activity retains row, spinner and viewport');
  await page.evaluate(() => window.postMessage({ type: 'activity', sessions: [{ key: 'claude:demo-1', running: false }] }));
  await page.waitForFunction(() => !window.runningProjectRow.querySelector('.project-run-indicator'));
  assert(!(await race.locator('.nav').getAttribute('aria-label')).includes('running'), 'Last completed task clears accessible status');
  await page.evaluate(() => {
    const fixture = JSON.parse(localStorage.getItem('atlasDemoData'));
    fixture.sessions.find(s => s.key === 'codex:demo-0').projectOverride = 'path:c:/code/suspension lab';
    fixture.sessions.find(s => s.key === 'claude:demo-4').running = false;
    fixture.sessions.find(s => s.key === 'codex:demo-0').status = 'Done';
    window.postMessage(fixture);
  });
  await page.waitForFunction(() => document.querySelector('.project-entry[data-project="path:c:/code/suspension lab"] .project-run-indicator'));
  assert(await race.locator('.project-run-indicator').count() === 0, 'Manual placement removes original project activity');
  assert(await lab.locator('.project-run-indicator').count() === 1, 'Done and filtered running chat still marks its assigned project');
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('No matches');
  assert(await lab.locator('.project-run-indicator').count() === 1, 'Search does not hide project activity');
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('');
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`);
    if (width > 680) {
      const spinner = await lab.locator('.project-run-indicator').boundingBox();
      const name = await lab.locator('.project-name').boundingBox();
      assert(spinner.x >= name.x + name.width && spinner.y < name.y + name.height, `${width}: spinner beside project name`);
    }
    await page.screenshot({ path: `output/playwright/project-running-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(await lab.locator('.project-run-indicator').evaluate(n => getComputedStyle(n, '::before').animationName === 'none'), 'Reduced motion keeps a static running marker');
  return { passed: checks.length, checks };
}
