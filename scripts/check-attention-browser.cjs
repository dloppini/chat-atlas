async page => {
  await page.setViewportSize({width:1440,height:1000});
  await page.reload();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('.card');
  const summary=await page.locator('#summary').textContent();
  if(!/1 asks you · 1 ready to review/.test(summary))throw Error('Summary: '+summary);
  const asks=page.locator('.card.asks');
  if(await asks.count()!==1||await asks.locator('.attention.question').textContent()!=='Asks you')throw Error('Asks you badge missing');
  if(await page.locator('.attention.finished').count()!==1)throw Error('Finished badge missing');
  const results=[];
  for(const theme of ['pearl','dark']) {
    await page.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), theme);
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      await page.screenshot({path:`output/playwright/attention-${theme}-${width}.png`,fullPage:false});
      const metrics=await page.evaluate(()=>{const b=document.querySelector('.attention.question').getBoundingClientRect();const box=document.querySelector('.card.asks .card-project').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,inside:b.left>=box.left-1&&b.right<=box.right+1&&b.top>=box.top-1&&b.bottom<=box.bottom+1,visible:b.width>0&&b.height>0};});
      if(metrics.overflow)throw Error(`Overflow ${theme} ${width}`);
      if(!metrics.inside||!metrics.visible)throw Error(`Badge outside its project label at ${width}: `+JSON.stringify(metrics));
      results.push({theme,width,...metrics});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  // Live activity messages update badges and the summary without a rebuild.
  const key=await asks.getAttribute('data-key');
  await page.evaluate(key => window.dispatchEvent(new MessageEvent('message', {data: {type:'activity', sessions:[{key, running:false, attention:''}]}})), key);
  if(await page.locator('.card.asks').count()!==0)throw Error('Badge not cleared by activity message');
  if(/asks you/.test(await page.locator('#summary').textContent()))throw Error('Summary not updated by activity message');
  await page.evaluate(key => window.dispatchEvent(new MessageEvent('message', {data: {type:'activity', sessions:[{key, running:false, attention:'question'}]}})), key);
  if(await page.locator('.card.asks').count()!==1)throw Error('Badge not restored by activity message');
  // Project pickup lists questions first.
  await page.getByRole('button',{name:/^Race Studio, 5 conversations/}).click();
  await page.getByRole('button',{name:'Project pickup',exact:true}).click();
  const groups=await page.locator('#pickup-list h3').allTextContents();
  if(JSON.stringify(groups.slice(0,2))!==JSON.stringify(['Asks you','Finished']))throw Error('Pickup groups: '+groups.join(','));
  await page.screenshot({path:'output/playwright/attention-pickup.png'});
  await page.keyboard.press('Escape');
  // Details line shows lines changed and the reported cost.
  await page.locator('.card .info').nth(3).click();
  const meta=await page.locator('#detail .meta').first().textContent();
  if(!/reported by Claude/.test(meta)||!/Lines \+120 −9/.test(meta))throw Error('Details usage line: '+meta);
  if(errors.length)throw Error(errors.join('\n'));
  return results;
}
