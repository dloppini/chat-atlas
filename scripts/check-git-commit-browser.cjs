async page => {
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(() => localStorage.removeItem('atlasDemoUi'));
  await page.reload();
  await page.getByRole('button',{name:'Chat Atlas, 1 conversations',exact:true}).click();
  await page.getByRole('button',{name:'Git',exact:true}).click();
  await page.waitForSelector('.git-patch');
  const local = page.getByRole('group',{name:'Local change comparison'});
  const modified = page.getByRole('button',{name:'media/board.js, Modified',exact:true});
  const added = page.getByRole('button',{name:'notes.txt, New',exact:true});
  if (await local.getByRole('button',{name:'All',exact:true}).getAttribute('aria-pressed') !== 'true') throw Error('All is not selected');
  for (const theme of ['dark','pearl']) {
    await page.evaluate(theme => window.postMessage({type:'theme',theme}),theme);
    for (const width of [1440,800,390]) {
      await page.setViewportSize({width,height:900});
      const bounds = await local.evaluate(n => {
        const tabs = [...n.querySelectorAll('button')].map(tab => tab.getBoundingClientRect());
        return { overflowing: document.documentElement.scrollWidth > innerWidth || tabs.some(tab => tab.right > innerWidth),
          heightMismatch: tabs.some(tab => tab.height !== tabs[0].height) };
      });
      if (bounds.overflowing || bounds.heightMismatch) throw Error('Local change controls misaligned at ' + width);
      if (width === 390 && !await added.evaluate(row => row.getBoundingClientRect().bottom <= row.closest('nav').getBoundingClientRect().bottom)) throw Error('New badge is clipped on the phone');
      for (const [row,letter,color] of [[modified,'M','rgb(245, 214, 107)'],[added,'N','rgb(145, 214, 162)']]) {
        const badge = row.locator('.git-file-status');
        if (await badge.textContent() !== letter || await badge.evaluate(n => getComputedStyle(n).backgroundColor) !== color)
          throw Error('Incorrect local change badge');
      }
      if (width !== 800) {
        await local.evaluate(n => n.scrollIntoView({block:'center'}));
        await page.screenshot({path:`output/playwright/git-all-${theme}-${width}.png`});
      }
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await added.press('Enter');
  await page.waitForFunction(() => document.activeElement.dataset.diffFile === 'notes.txt' && document.querySelector('.git-patch')?.textContent.includes('New notes'));
  await modified.click();
  await page.waitForFunction(() => document.querySelector('.git-file-heading h4')?.textContent === 'media/board.js');
  const message = () => page.getByRole('textbox',{name:'Commit message',exact:true});
  const done = action => page.waitForFunction(action => document.querySelector('.git-operation-status')?.textContent.includes(action), action);
  await message().fill('Refine local changes\n\nKeep the full diff readable.');
  await page.getByRole('button',{name:'Stage file',exact:true}).click();
  await page.getByRole('button',{name:'Commit staged (1)',exact:true}).waitFor();
  if (!await message().inputValue().then(s=>s.includes('Refine'))) throw Error('Stage lost draft');
  await page.getByRole('button',{name:'Unstage file',exact:true}).click();
  await page.getByRole('button',{name:'Commit staged (0)',exact:true}).waitFor();
  await page.getByRole('button',{name:'Unstaged',exact:true}).click();
  await page.getByRole('button',{name:'Stage all',exact:true}).click();
  await page.getByRole('button',{name:'Commit staged (2)',exact:true}).waitFor();
  await page.waitForSelector('.git-patch');
  const matrix=[];
  for (const theme of ['dark','pearl']) {
    await page.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), theme);
    for (const width of [1440,800,390]) {
      await page.setViewportSize({width,height:1000}); await page.evaluate(()=>window.scrollTo(0,0));
      const layout=await page.evaluate(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom};};
        return {overflow:document.documentElement.scrollWidth>innerWidth,field:rect('#git-commit-message'),submit:rect('.git-commit-form button'),diff:rect('.git-diff-layout'),controls:[...document.querySelectorAll('.git-sync-actions button')].map(n=>({name:n.textContent,y:n.getBoundingClientRect().y,h:n.getBoundingClientRect().height}))};
      });
      if(layout.overflow || Math.abs(layout.field.bottom-layout.submit.bottom)>1 || layout.field.x+layout.field.w>layout.submit.x)throw Error('Commit form layout: '+JSON.stringify(layout));
      await page.screenshot({path:`output/playwright/commit-${theme}-${width}.png`,fullPage:true}); matrix.push({theme,width,...layout});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{
    window.normalAtlasPost=window.atlasPreview.postMessage;
    window.atlasPreview.postMessage=m=>m.type==='gitOperation'&&m.action==='commit'?setTimeout(()=>window.postMessage({type:m.type,projectKey:m.projectKey,requestId:m.requestId,error:'Fixture: hook rejected commit. Fix the hook and retry.'}),50):window.normalAtlasPost(m);
  });
  await page.getByRole('button',{name:'Commit staged (2)',exact:true}).click();await done('hook rejected');
  await page.getByRole('button',{name:'Commit staged (2)',exact:true}).waitFor();
  if(!await message().inputValue().then(s=>s.includes('Refine')))throw Error('Error lost draft');
  await page.evaluate(()=>{window.atlasPreview.postMessage=window.normalAtlasPost;});
  await page.getByRole('button',{name:'Commit staged (2)',exact:true}).click();await done('commit completed');
  await page.getByRole('button',{name:'Commit staged (0)',exact:true}).waitFor();
  if(await message().inputValue()!=='')throw Error('Successful commit retained submitted draft');
  await message().fill('Draft for Atlas');
  await page.getByRole('button',{name:'Race Studio, 5 conversations, 1 running task',exact:true}).click();await message().waitFor();
  if(await message().inputValue()!=='')throw Error('Draft leaked between projects');
  await message().fill('Draft for Race Studio');
  await page.getByRole('button',{name:'Chat Atlas, 1 conversations',exact:true}).click();await message().waitFor();
  if(await message().inputValue()!=='Draft for Atlas')throw Error('Project switch lost draft');
  await page.getByRole('button',{name:'Untracked',exact:true}).click();await page.waitForSelector('.git-patch');
  await page.getByRole('button',{name:'Stage all',exact:true}).click();await page.getByRole('button',{name:'Commit staged (1)',exact:true}).waitFor();
  await message().focus();await page.keyboard.press('Tab');
  if(!await page.getByRole('button',{name:'Commit staged (1)',exact:true}).evaluate(n=>n===document.activeElement))throw Error('Commit not keyboard reachable');
  await page.keyboard.press('Enter');await done('commit completed');await page.getByRole('button',{name:'Commit staged (0)',exact:true}).waitFor();
  await page.getByRole('button',{name:'Create PR',exact:true}).click();await done('Azure PR form');
  await message().fill('Draft survives reload');await page.reload();
  await page.getByRole('button',{name:'Git',exact:true}).click();await message().waitFor();
  if(await message().inputValue()!=='Draft survives reload')throw Error('Reload lost draft');
  const touch=[];
  for (const theme of ['dark','pearl']) {
    const context=await page.context().browser().newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    try {
      const phone=await context.newPage();await phone.goto('http://127.0.0.1:4317');
      // Select the fixture project before switching to the phone layout with its hidden sidebar.
      await phone.setViewportSize({width:1440,height:1000});
      await phone.getByRole('button',{name:'Chat Atlas, 1 conversations',exact:true}).click();
      await phone.getByRole('button',{name:'Git',exact:true}).click();await phone.waitForSelector('.git-patch');
      await phone.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), theme);
      await phone.evaluate(()=>{const m=window.atlasMessages.filter(m=>m.type==='gitDashboard').at(-1);window.postMessage({type:m.type,projectKey:m.projectKey,requestId:m.requestId,dashboard:{root:'Azure fixture',branch:'feature/review',head:'a'.repeat(40),commits:[],changes:[{file:'media/board.js',code:' M'}],branchRefs:[],remotes:['github','azure'],azureRemotes:[{name:'azure',url:'https://dev.azure.com/example/project/_git/repo'}],upstream:'',indexVersion:'demo'}});});
      await phone.getByRole('combobox',{name:'Remote',exact:true}).selectOption('azure');
      if(await phone.getByRole('button',{name:'Push',exact:true}).isDisabled())throw Error('Publish branch disabled');
      if(!await phone.getByRole('button',{name:'Push',exact:true}).getAttribute('title').then(s=>s.includes('azure')))throw Error('Publish target unclear');
      await phone.setViewportSize({width:390,height:844});
      const sizes=await phone.locator('.git-sync-actions button,.git-heading>button,.git-stage-file,.git-commit-form button,.git-remote select').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({text:n.textContent,height:n.getBoundingClientRect().height})));
      if(sizes.some(n=>n.height<44))throw Error('Small touch control: '+JSON.stringify(sizes));
      if(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Phone overflow');
      await phone.screenshot({path:`output/playwright/commit-touch-${theme}.png`,fullPage:true});touch.push({theme,sizes});
    } finally {await context.close();}
  }
  return {matrix,touch,checks:['stage file','unstage file','stage all','untracked files','commit failure retains draft','commit success clears draft','project draft isolation','keyboard commit','Azure PR handoff','persistent draft','publish remote selection','touch targets']};
}
