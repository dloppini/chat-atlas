async page => {
  const results=[];
  const phoneContext=await page.context().browser().newContext({viewport:{width:1440,height:1000},hasTouch:true,isMobile:true});
  try {
    const phone=await phoneContext.newPage();
    for (const [surface,width] of [[page,1440],[phone,390]]) {
      await surface.setViewportSize({width:1440,height:1000});await surface.goto('http://127.0.0.1:4317');
      await surface.getByRole('button',{name:'Chat Atlas, 1 conversations',exact:true}).click();
      await surface.setViewportSize({width,height:1000});
      for (const theme of ['dark','pearl']) {
        await surface.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), theme);
        for (const mode of ['chats','git']) {
          const toggle=surface.getByRole('button',{name:mode==='git'?'Git':'Conversations',exact:true});
          if(await toggle.count())await toggle.click();
          if(mode==='git')await surface.waitForSelector('.git-patch');
          await surface.evaluate(()=>window.scrollTo(0,0));
          const geometry=await surface.evaluate(()=>{
            const nodes=[...document.querySelectorAll('.header-actions button,.header-actions select')].filter(n=>n.getClientRects().length);
            return {overflow:document.documentElement.scrollWidth>innerWidth,controls:nodes.map(n=>{const r=n.getBoundingClientRect();return {id:n.id,x:r.x,y:r.y,width:r.width,height:r.height};})};
          });
          if(geometry.overflow)throw Error('Header overflow');
          if(geometry.controls.find(n=>n.id==='feedback').y!==geometry.controls.find(n=>n.id==='refresh').y)throw Error('Utility group split across rows');
          const bug=geometry.controls.find(n=>n.id==='feedback');
          if(width===390&&(bug.width<44||bug.height<44))throw Error('Small touch target');
          for(const a of geometry.controls)for(const b of geometry.controls)if(a!==b&&a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)throw Error('Overlapping header controls');
          await surface.screenshot({path:`output/playwright/feedback-${mode}-${theme}-${width}.png`});
          const feedback=surface.getByRole('button',{name:'Report a bug or request a feature',exact:true});await feedback.focus();await surface.keyboard.press('Tab');await surface.keyboard.press('Shift+Tab');
          if(await feedback.evaluate(n=>getComputedStyle(n).outlineStyle)==='none')throw Error('Missing keyboard focus');
          await surface.keyboard.press('Enter');
          await surface.waitForFunction(()=>window.atlasMessages.some(m=>m.type==='feedback'));
          await surface.evaluate(()=>{document.getElementById('notice').hidden=true;});
          results.push({width,theme,mode,...geometry});
        }
      }
    }
  } finally {await phoneContext.close();}
  return results;
}
