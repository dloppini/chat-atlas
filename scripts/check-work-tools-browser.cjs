// Run against scripts/preview.js with playwright-cli run-code --filename.
async page => {
  await page.goto('http://127.0.0.1:4317');
  await page.locator('.card').first().waitFor();
  await page.evaluate(() => {
    const board = JSON.parse(localStorage.getItem('atlasDemoData'));
    board.sessions[0].note = 'Verify focus in the drawer';
    board.sessions[0].searchText = 'dashboard layout refinements';
    board.sessions[1].handoffFrom = board.sessions[0].key;
    localStorage.setItem('atlasDemoData',JSON.stringify(board));
  });
  await page.reload();
  await page.locator('.project-entry').filter({hasText:'Race Studio'}).locator('.nav').click();
  for (const width of [1440,800,390,320]) {
    await page.setViewportSize({width,height:900});
    for (const theme of ['pearl','dark']) {
      await page.evaluate(theme => dispatchEvent(new MessageEvent('message',{data:{type:'theme',theme}})),theme);
      await page.locator('#pickup').click();
      await page.locator('#pickup-list').getByText('Verify focus in the drawer').waitFor();
      if ([390,1440].includes(width)) await page.screenshot({path:'output/playwright/pickup-'+width+'-'+theme+'.png'});
      await page.locator('#pickup-list button').first().click();
      await page.locator('#detail-excerpts .excerpt').first().waitFor();
      await page.locator('.linked-chat').first().waitFor();
      await page.getByRole('button',{name:/^Hand off/}).click();
      await page.locator('#handoff-excerpt').selectOption({index:1});
      await page.locator('#handoff-files').click();
      await page.waitForFunction(() => document.querySelector('#handoff-paths').value === 'media/board.js');
      await page.locator('#handoff-form summary').click();
      if (!(await page.locator('#handoff-preview').innerText()).includes('Verify focus in the drawer')) throw Error('Missing next step');
      const layout = await page.evaluate(() => {
        const dialog = document.querySelector('#handoff-dialog'), r = dialog.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth;
      });
      if (!layout) throw Error('Handoff overflow at '+width);
      await page.screenshot({path:'output/playwright/work-tools-'+width+'-'+theme+'.png'});
      await page.locator('#handoff-provider').selectOption('claude');
      await page.locator('#handoff-submit').click();
      await page.locator('#handoff-dialog').waitFor({state:'hidden'});
      await page.getByRole('button',{name:'Close details'}).click();
      await page.locator('#search').fill('dashboard');
      await page.getByRole('button',{name:/^Find matching passages/}).first().click();
      await page.waitForFunction(() => window.atlasMessages.some(m => m.type === 'passages' && m.query === 'dashboard'));
      if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Search results overflow at '+width);
      if ([390,1440].includes(width)) await page.screenshot({path:'output/playwright/passages-'+width+'-'+theme+'.png'});
      await page.locator('#search').clear();
    }
  }
}
