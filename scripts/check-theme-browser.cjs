async page => {
  await page.setViewportSize({width:1440,height:1000});
  await page.reload();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'Chat Atlas, 1 conversations',exact:true}).click();
  const results=[];
  for(const theme of ['pearl','dark']) {
    await page.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), theme);
    for(const width of [1440,800,390]) {
      await page.setViewportSize({width,height:1000});
      for(const view of ['chats','git']) {
        if(view==='git') { await page.getByRole('button',{name:'Git',exact:true}).click();await page.waitForSelector('.git-patch'); }
        await page.screenshot({path:`output/playwright/theme-${theme}-${width}-${view}.png`,fullPage:true});
        const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,bg:getComputedStyle(document.body).getPropertyValue('--bg').trim(),theme:document.body.dataset.theme}));
        if(metrics.overflow)throw Error(`Overflow ${theme} ${width} ${view}`);
        results.push({theme,width,view,...metrics});
        if(view==='git') {
          await page.keyboard.press('Control+g');
          if (await page.locator('#conversation-switch:focus').getAttribute('aria-pressed') !== 'true') throw Error('Ctrl+G did not return to Conversations');
        }
      }
    }
    await page.getByRole('button',{name:'New chat',exact:true}).click();
    await page.screenshot({path:`output/playwright/theme-${theme}-dialog.png`});
    await page.keyboard.press('Escape');
  }
  await page.reload();
  if(await page.locator('body').getAttribute('data-theme')!=='dark')throw Error('Theme not restored');
  await page.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), 'system');
  await page.evaluate(()=>document.body.classList.add('vscode-light'));
  if(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--bg').trim())!=='#eae7e1')throw Error('Host light theme not followed');
  await page.evaluate(()=>{document.body.classList.remove('vscode-light');document.body.classList.add('vscode-high-contrast');});
  if(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--raised').trim())!=='none')throw Error('High contrast shadows retained');
  await page.evaluate(()=>document.body.classList.remove('vscode-high-contrast'));
  await page.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), 'pearl');
  await page.locator('#conversation-switch').focus();
  for (const id of ['git-switch', 'engineering-switch', 'new-chat', 'settings', 'feedback', 'refresh']) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement.id) !== id) throw Error('Header focus order: ' + id);
  }
  await page.getByRole('button',{name:'Workflow',exact:true}).click();
  await page.getByRole('button',{name:'Topics',exact:true}).click();
  await page.getByRole('button',{name:'Timeline',exact:true}).click();
  const contrast=[];
  for(const theme of ['pearl','dark']) {
    await page.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), theme);
    const ratios=await page.evaluate(()=>{
      const ctx=document.createElement('canvas').getContext('2d');
      function lum(color){ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const a=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
      const root=getComputedStyle(document.body);const v=k=>root.getPropertyValue(k).trim();
      return [['body',v('--text'),v('--bg')],['secondary',v('--muted'),v('--panel')],['accent',getComputedStyle(document.querySelector('#new-chat')).color,getComputedStyle(document.querySelector('#new-chat')).backgroundColor]].map(([name,fg,bg])=>{const a=lum(fg),b=lum(bg);return {name,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
    });
    if(ratios.some(r=>r.ratio<4.5))throw Error('Low contrast '+JSON.stringify(ratios));contrast.push({theme,ratios});
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'All projects 11',exact:true}).click();
    await page.screenshot({path:`output/playwright/theme-${theme}-all.png`,fullPage:true});
    await page.getByRole('button',{name:'Details for New conversation overview',exact:true}).click();
    await page.screenshot({path:`output/playwright/theme-${theme}-detail.png`,fullPage:true});
    await page.keyboard.press('Escape');
  }
  if(errors.length)throw Error(errors.join('\n'));
  return {results,contrast,checks:['persistence','host theme change','high contrast','keyboard order','dialogs','view switches'],errors};
}
