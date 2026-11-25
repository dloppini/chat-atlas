// Run against scripts/preview.js with playwright-cli run-code --filename.
async page => {
  await page.goto('http://127.0.0.1:4317');
  await page.locator('.card').first().waitFor();
  const drawer = page.locator('#project-drawer');
  const toggle = page.locator('#sidebar-toggle');
  const rail = page.locator('#project-sidebar');
  for (const hideDesktop of [false, true]) {
    await page.setViewportSize({width: 1440, height: 900});
    if (await rail.isVisible() === hideDesktop) await toggle.click();
    await page.setViewportSize({width: 390, height: 844});
    await toggle.focus();
    await page.keyboard.press('Enter');
    await drawer.waitFor();
    if (!await drawer.locator('#close-projects').evaluate(n => n === document.activeElement)) throw Error('Drawer did not receive focus');
    await page.keyboard.press('Escape');
    await drawer.waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement.id === 'sidebar-toggle' && document.activeElement.getAttribute('aria-expanded') === 'false');
    await toggle.click();
    await drawer.locator('.project-entry').filter({hasText: 'Race Studio'}).locator('.nav').click();
    await drawer.waitFor({state: 'hidden'});
    if (await page.locator('#heading').textContent() !== 'Race Studio') throw Error('Project was not selected');
    await toggle.click();
    await drawer.locator('#new-project').click();
    await page.locator('#project-dialog[open]').waitFor();
    await page.keyboard.press('Escape');
    if (!await drawer.isVisible()) throw Error('Cancelling a project form dismissed the navigator');
    await page.setViewportSize({width: 1440, height: 900});
    await drawer.waitFor({state: 'hidden'});
    if (await rail.isVisible() === hideDesktop) throw Error('Drawer changed the desktop sidebar preference');
    if (await page.locator('#main').evaluate(n => n.inert || !!document.querySelector(':modal'))) throw Error('Workspace remained modal');
  }
  return 'Project selection, nested dialog, Escape, focus return and desktop preference passed';
}
