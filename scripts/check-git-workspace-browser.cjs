async page => {
  await page.setViewportSize({width:1440,height:1200});
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('atlasDemoUi')||'{}');s.gitHeights={tree:300,diff:360};delete s.gitAutoFit;s.gitHideHistory=false;s.gitWrap=false;localStorage.setItem('atlasDemoUi',JSON.stringify(s));});
  await page.reload();
  await page.getByRole('button',{name:'Chat Atlas, 1 conversations',exact:true}).click();
  await page.getByRole('button',{name:'Git',exact:true}).click();
  await page.waitForSelector('.git-patch');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=async()=>page.evaluate(()=>{
    const request=window.atlasMessages.filter(m=>m.type==='gitDiff').at(-1);
    const lines=['@@ -1,60 +1,60 @@'];
    for(let i=0;i<60;i++)lines.push((i%7===0?'+':i%11===0?'-':' ')+['function renderRepository(project) {','  const selection = project.files.filter(file => file.changed);','  return selection.map(file => ({ path: file.path, status: file.status, preview: file.preview, staged: file.staged, repository: project.root }));','}'][i%4]);
    window.postMessage({type:'gitDiff',projectKey:request.projectKey,requestId:request.requestId,diff:{files:['media/board.js','media/board.css','src/git.js','src/extension.js','test/git.test.js','README.md','CHANGELOG.md'],file:'media/board.js',patch:lines.join('\n'),truncated:false}});
  });
  await fixture();await page.waitForFunction(()=>document.querySelectorAll('.git-diff-line').length>50);
  const matrix=[];
  await page.locator('.git-branch-list summary').click();
  await page.getByRole('button',{name:'Focus branch main',exact:true}).waitFor();
  await page.locator('.git-branch-list summary').click();
  for(const theme of ['dark','pearl']) {
    await page.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), theme);
    for(const [width,height] of [[1440,1200],[1440,900],[800,1000],[390,900]]) {
      await page.setViewportSize({width,height});
      const m=await page.evaluate(()=>{const r=document.querySelector('.git-diff-layout').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,diffHeight:r.height,bottom:r.bottom,tree:document.querySelector('.git-history-scroll').getBoundingClientRect().height,rows:Math.floor((r.height-38)/21)};});
      if(m.overflow)throw Error('Horizontal overflow');
      if(width===1440&&(m.bottom>height||m.diffHeight<height*.5))throw Error('Diff does not use viewport '+JSON.stringify(m));
      await page.screenshot({path:`output/playwright/workspace-${theme}-${width}-${height}.png`,fullPage:true});matrix.push({theme,width,height,...m});
    }
  }
  await page.locator('.git-branch-list summary').click();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile branches overflow');
  await page.locator('.git-branch-list summary').click();
  await page.setViewportSize({width:1440,height:1200});
  const before=await page.locator('.git-diff-layout').evaluate(n=>n.clientHeight);
  await page.getByRole('button',{name:'Hide history',exact:true}).click();
  if(await page.locator('.git-history').isVisible())throw Error('History still visible');
  if(await page.locator('.git-diff-layout').evaluate(n=>n.clientHeight)<=before)throw Error('Focus did not grow');
  await page.getByRole('button',{name:'Wrap lines',exact:true}).click();
  if(await page.locator('.git-patch').evaluate(n=>n.scrollWidth>n.clientWidth))throw Error('Wrapped diff overflows');
  await page.screenshot({path:'output/playwright/workspace-focused.png',fullPage:true});
  await page.reload();await page.getByRole('button',{name:'Git',exact:true}).click();await page.waitForSelector('.git-patch');
  if(await page.getByRole('button',{name:'Hide history',exact:true}).getAttribute('aria-pressed')!=='true')throw Error('Focus not persisted');
  if(await page.getByRole('button',{name:'Wrap lines',exact:true}).getAttribute('aria-pressed')!=='true')throw Error('Wrap not persisted');
  await page.getByRole('button',{name:'Hide history',exact:true}).click();
  await page.getByRole('button',{name:'Fit window',exact:true}).click();
  if(await page.getByRole('spinbutton',{name:'Diff height in pixels'}).inputValue()!=='360')throw Error('Legacy custom height lost');
  await page.getByRole('spinbutton',{name:'Diff height in pixels'}).fill('720');await page.keyboard.press('Tab');
  if(await page.locator('.git-diff-layout').evaluate(n=>n.getBoundingClientRect().height)!==720)throw Error('Manual sizing failed');
  await page.getByRole('button',{name:'Fit window',exact:true}).click();
  await page.getByRole('button',{name:'src/git.js, Modified',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.git-file-heading h4')?.textContent==='src/git.js');
  await page.getByRole('combobox',{name:'Branch',exact:true}).selectOption('refs/heads/feature/git-dashboard');
  await page.waitForFunction(()=>document.querySelectorAll('.git-commit').length===2);
  if(await page.locator('.git-file-heading h4').textContent()!=='src/git.js')throw Error('Branch lost diff');
  await page.getByRole('button',{name:'Add Git diff inspector',exact:false}).click();await page.waitForSelector('.git-patch');
  await page.getByRole('button',{name:'Fit window',exact:true}).focus();await page.keyboard.press('Enter');
  if(await page.getByRole('button',{name:'Fit window',exact:true}).getAttribute('aria-pressed')!=='false')throw Error('Keyboard toggle failed');
  if(errors.length)throw Error(errors.join('\n'));
  return {matrix,checks:['legacy sizing migration','viewport fit','focus mode','wrap','persisted layout','custom sizing','branch/file/commit selection','keyboard'],errors};
}
