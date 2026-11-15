async page => {
  await page.reload();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Chat Atlas, 1 conversations',exact:true}).click();
  await page.getByRole('button',{name:'Git',exact:true}).click();
  await page.waitForSelector('.git-patch');
  const select = () => page.getByRole('combobox',{name:'Branch',exact:true});
  await page.getByRole('button',{name:'src/git.js',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.git-file-heading h4')?.textContent==='src/git.js');
  await select().selectOption('refs/heads/feature/git-dashboard');
  await page.waitForFunction(()=>document.querySelectorAll('.git-commit').length===2);
  if(await page.locator('.git-file-heading h4').textContent()!=='src/git.js')throw Error('Focus changed diff selection');
  if(!await select().evaluate(node=>node===document.activeElement))throw Error('Focus was lost');
  const results = [];
  for (const [width, theme] of [[1440,'dark'],[390,'dark'],[800,'dark'],[1440,'light'],[390,'light']]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(theme => {
      const root=document.documentElement;
      const colors=theme==='light'?{'--bg':'#ffffff','--panel':'#f3f4f6','--card':'#ffffff','--text':'#24292f','--muted':'#57606a','--line':'#d0d7de','--hover':'#e7ebf0','--accent':'#6551a6','--vscode-charts-purple':'#7652b6','--vscode-charts-blue':'#0969b0','--vscode-charts-orange':'#9a6700','--vscode-charts-green':'#18754b','--vscode-gitDecoration-addedResourceForeground':'#18754b','--vscode-gitDecoration-deletedResourceForeground':'#b42335'}:{};
      root.style.cssText='';root.style.colorScheme=theme;for(const [key,value] of Object.entries(colors)) root.style.setProperty(key,value);
    },theme);
    await page.screenshot({path:`output/playwright/git-branch-${width}-${theme}.png`,fullPage:true});
    const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,headerHeight:document.querySelector('header').getBoundingClientRect().height,treeHeight:document.querySelector('.git-history-scroll').getBoundingClientRect().height,diffHeight:document.querySelector('.git-diff-layout').getBoundingClientRect().height,rowHeight:document.querySelector('.git-commit').getBoundingClientRect().height}));
    const selectorWidth=await select().evaluate(node=>node.getBoundingClientRect().width);
    if(selectorWidth<120)throw Error('Branch selector collapsed');
    if(metrics.overflow)throw Error('Page overflow: '+width+' '+theme);
    results.push({width,theme,...metrics});
  }

  await select().selectOption('');
  await page.waitForFunction(()=>document.querySelectorAll('.git-commit').length===4);
  if(!await select().evaluate(node=>node===document.activeElement))throw Error('Reset lost keyboard focus');
  await page.locator('.git-branch-list summary').click();
  await page.getByRole('button',{name:'Focus branch feature/git-dashboard',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.git-commit').length===2);
  await page.reload();
  await page.getByRole('button',{name:'Git',exact:true}).click();
  await page.waitForSelector('.git-patch');
  if(await select().inputValue()!=='refs/heads/feature/git-dashboard')throw Error('Branch focus was not restored');
  await select().selectOption('refs/remotes/origin/main');
  await page.waitForFunction(()=>document.querySelectorAll('.git-commit').length===4);
  await page.evaluate(()=>{
    const request=window.atlasMessages.filter(m=>m.type==='gitDashboard').at(-1);
    window.postMessage({type:'gitDashboard',projectKey:request.projectKey,requestId:request.requestId,error:'This branch is no longer available. Show all branches or refresh.'});
  });
  await page.getByRole('button',{name:'Show all branches',exact:true}).click();
  await page.waitForSelector('.git-patch');
  if(await select().inputValue()!=='')throw Error('Missing branch recovery failed');
  return {matrix:results,checks:['branch selector','branch buttons','diff preserved','keyboard focus preserved','focus survives reload','remote refs','missing branch recovery']};
}
