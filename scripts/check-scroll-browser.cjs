// Run against scripts/preview.js with playwright-cli run-code --filename.
async page => {
  const results = [];
  const position = () => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const steady = async (label, before) => {
    await page.waitForTimeout(100); // Include the host's asynchronous data/detail reply.
    const after = await position();
    if (Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1) throw new Error(`${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    results.push(label);
  };
  const clickVisible = async action => {
    const target = await page.locator(`.card [data-action="${action}"]`).evaluateAll(nodes => {
      const node = nodes.find(n => { const r = n.getBoundingClientRect(); return r.top > 150 && r.bottom < innerHeight - 80 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === n; });
      if (!node) throw new Error('No visible action');
      const r = node.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, key: node.closest('.card').dataset.key };
    });
    await page.mouse.click(target.x, target.y);
    if (action === 'detail') await page.waitForFunction(() => !document.getElementById('detail').hidden, { timeout: 1000 });
    if (action === 'detail' || action === 'open') {
      const selected = await page.evaluate(() => JSON.parse(localStorage.getItem('atlasDemoUi')).selected);
      if (selected !== target.key) throw new Error(`${action}: chat was not selected`);
    }
    return target.key;
  };
  await page.goto('http://127.0.0.1:4317');
  await page.waitForFunction(() => document.querySelectorAll('.card').length > 0);
  await page.evaluate(() => {
    const fixture = JSON.parse(localStorage.getItem('atlasDemoData'));
    const original = fixture.sessions[0];
    fixture.sessions = Array.from({ length: 180 }, (_, i) => ({ ...original, key: 'codex:scroll-' + i, id: 'scroll-' + i, provider: 'codex', createdAt: Date.now() - Math.floor(i / 18) * 86400000, title: 'Scroll fixture ' + i, topic: fixture.topics[0].id, status: 'Inbox', pinned: false }));
    localStorage.setItem('atlasDemoData', JSON.stringify(fixture));
    localStorage.removeItem('atlasDemoUi');
  });
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.card').length > 170);
    await page.evaluate(() => window.scrollTo(0, 4500));
    let before = await position();
    await clickVisible('detail');
    await steady(`${width}: select details`, before);
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await steady(`${width}: close details`, before);
    await page.evaluate(() => {
      // Resume is a host message; no provider is opened by this preview check.
      document.getElementById('notice').hidden = false;
      document.getElementById('notice').textContent = 'Demo preview';
    });
    before = await position();
    await clickVisible('open');
    await steady(`${width}: resume selection`, before);
    before = await position();
    await clickVisible('done');
    await steady(`${width}: mark done and host reply`, before);
    await page.evaluate(() => {
      document.getElementById('show-done').checked = true;
      document.getElementById('show-done').dispatchEvent(new Event('change'));
    });
    await steady(`${width}: show done`, before);
    await page.evaluate(() => {
      const checkbox = document.querySelector('.card.done .done-checkbox');
      checkbox.checked = false; checkbox.dispatchEvent(new Event('change'));
    });
    await steady(`${width}: reopen done chat`, before);
    await page.evaluate(() => document.getElementById('refresh').click());
    await steady(`${width}: refresh`, before);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error(`${width}: horizontal overflow`);
    if (width !== 800) await page.screenshot({ path: `output/playwright/scroll-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const view of ['topics', 'workflow', 'timeline']) {
    await page.evaluate(view => document.querySelector(`[data-view="${view}"]`).click(), view);
    if (view === 'timeline') await page.locator('.column-focus').first().click();
    await page.evaluate(() => { window.scrollTo(0, 200); document.querySelector('.column-cards').scrollTop = 600; });
    const before = await position();
    const listBefore = await page.locator('.column-cards').first().evaluate(n => n.scrollTop);
    await clickVisible('detail');
    await steady(`${view}: scrolled column selection`, before);
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await clickVisible('done');
    await steady(`${view}: scrolled column done`, before);
    const listAfter = await page.locator('.column-cards').first().evaluate(n => n.scrollTop);
    if (Math.abs(listBefore - listAfter) > 1) throw new Error(`${view}: column ${listBefore} -> ${listAfter}`);
    results.push(`${view}: column position retained`);
  }
  return { passed: results.length, checks: results };
}
