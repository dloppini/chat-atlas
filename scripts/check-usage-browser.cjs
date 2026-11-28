async page => {
  await page.setViewportSize({width:1440,height:1000});
  await page.reload();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const usage=page.getByRole('button',{name:'Usage',exact:true});
  const results=[];
  for(const theme of ['pearl','dark']) {
    await page.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), theme);
    for(const width of [1440,800,390]) {
      await page.setViewportSize({width,height:1000});
      if(width===390) await page.getByRole('button',{name:'Close projects'}).click().catch(()=>{});
      if(await usage.getAttribute('aria-pressed')!=='true') await usage.click();
      await page.waitForSelector('#usage-content .eng-stats');
      await page.screenshot({path:`output/playwright/usage-${theme}-${width}.png`,fullPage:true});
      const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,boardHidden:document.getElementById('board').hidden,
        headings:[...document.querySelectorAll('#usage-content h2')].map(h=>h.textContent),status:document.getElementById('usage-status').textContent}));
      if(metrics.overflow)throw Error(`Overflow ${theme} ${width}`);
      if(!metrics.boardHidden)throw Error('Board still visible under Usage');
      if(JSON.stringify(metrics.headings)!==JSON.stringify(['Codex plan','By day','By model','By project','Largest conversations']))throw Error('Usage sections: '+metrics.headings.join(','));
      results.push({theme,width,...metrics});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'7 days',exact:true}).click();
  const dayRows=await page.locator('#usage-content table').nth(1).locator('tbody tr').count();
  if(dayRows<1||dayRows>7)throw Error('7-day table rows: '+dayRows);
  if(!(await page.locator('#usage-status').textContent()).includes('gpt-6.1-terra'))throw Error('Unpriced model notice missing');
  await page.getByRole('button',{name:'Show usage for Race Studio'}).click();
  await page.waitForSelector('#usage-content .eng-stats');
  if(await page.locator('#heading').textContent()!=='Race Studio')throw Error('Project row did not select the project');
  if(await page.locator('#usage-content h2',{hasText:'By project'}).count())throw Error('By project shown inside a project');
  await page.screenshot({path:'output/playwright/usage-project.png',fullPage:true});
  await page.keyboard.press('Control+g');
  if(await page.locator('#conversation-switch:focus').getAttribute('aria-pressed')!=='true')throw Error('Ctrl+G did not return to Conversations');
  if(!await page.locator('#usage-panel').isHidden())throw Error('Usage panel still open');
  await page.locator('.card .info').first().click();
  const meta=await page.locator('#detail .meta').first().textContent();
  if(!/Tokens [\d.]+[kM] \(\d+% cached\) · [\d.]+[kM] out · /.test(meta))throw Error('Details usage line: '+meta);
  await page.screenshot({path:'output/playwright/usage-detail.png'});
  await usage.click();
  await page.locator('#usage-content').getByRole('button',{name:/^Open /}).first().click();
  if(!await page.locator('#usage-panel').isHidden()||await page.locator('#detail').isHidden())throw Error('Largest conversation did not open details');
  await usage.click();
  await page.reload();
  if(await page.locator('#usage-panel').isHidden())throw Error('Usage view not restored after reload');
  if(await page.getByRole('button',{name:'7 days',exact:true}).getAttribute('aria-pressed')!=='true')throw Error('Usage range not restored');
  await page.locator('#conversation-switch').focus();
  for (const id of ['git-switch', 'engineering-switch', 'usage-switch', 'new-chat', 'settings', 'feedback', 'refresh']) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement.id) !== id) throw Error('Header focus order: ' + id);
  }
  if(errors.length)throw Error(errors.join('\n'));
  return results;
}
