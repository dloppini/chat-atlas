async page => {
  await page.reload();
  await page.getByRole('button', {name:'Git',exact:true}).click();
  await page.waitForSelector('.git-patch');
  if(await page.locator('#git-switch svg').count()!==1)throw Error('Missing Git icon');
  const results = [];
  for (const [width, theme] of [[1440,'dark'],[390,'dark'],[800,'dark'],[1440,'light'],[390,'light']]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(theme => {
      const root=document.documentElement;
      const colors=theme==='light'?{'--bg':'#ffffff','--panel':'#f3f4f6','--card':'#ffffff','--text':'#24292f','--muted':'#57606a','--line':'#d0d7de','--hover':'#e7ebf0','--accent':'#6551a6','--vscode-charts-purple':'#7652b6','--vscode-charts-blue':'#0969b0','--vscode-charts-orange':'#9a6700','--vscode-charts-green':'#18754b','--vscode-gitDecoration-addedResourceForeground':'#18754b','--vscode-gitDecoration-deletedResourceForeground':'#b42335'}:{};
      root.style.cssText='';root.style.colorScheme=theme;for(const [key,value] of Object.entries(colors)) root.style.setProperty(key,value);
    },theme);
    await page.screenshot({path:`output/playwright/git-${width}-${theme}.png`,fullPage:true});
    const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,headerHeight:document.querySelector('header').getBoundingClientRect().height,treeHeight:document.querySelector('.git-history-scroll').getBoundingClientRect().height,diffHeight:document.querySelector('.git-diff-layout').getBoundingClientRect().height,rowHeight:document.querySelector('.git-commit').getBoundingClientRect().height}));
    if(metrics.overflow)throw Error('Page overflow: '+width+' '+theme);
    results.push({width,theme,...metrics});
  }
  await page.getByRole('spinbutton',{name:'Tree height in pixels'}).fill('220');
  await page.getByRole('spinbutton',{name:'Tree height in pixels'}).press('Tab');
  await page.getByRole('spinbutton',{name:'Diff height in pixels'}).fill('420');
  await page.getByRole('spinbutton',{name:'Diff height in pixels'}).press('Tab');
  await page.getByRole('button',{name:'Add Git diff inspector',exact:false}).click();
  await page.waitForSelector('.git-patch');
  await page.getByRole('button',{name:'src/git.js',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.git-file-heading h4')?.textContent==='src/git.js');
  await page.evaluate(()=>{
    const request=window.atlasMessages.filter(m=>m.type==='gitDiff').at(-1);
    window.postMessage({type:'gitDiff',projectKey:request.projectKey,requestId:request.requestId,diff:{files:['src/git.js'],file:'src/git.js',patch:'diff --git a/src/git.js b/src/git.js\nindex 123..456 100644\n--- a/src/git.js\n+++ b/src/git.js\n@@ -1,2 +1,2 @@\n---old content\n+++new content\n context',truncated:false}});
  });
  await page.waitForFunction(()=>document.querySelector('.git-diff-stats')?.textContent==='+1-1');
  if(await page.locator('.git-patch').textContent().then(text=>text.includes('diff --git')||text.includes('--- a/')))throw Error('Patch metadata wastes rows');
  const numbered=await page.locator('.git-diff-line.added .git-line-number').allTextContents();
  if(numbered[1]!=='1')throw Error('Added content line numbering failed');
  await page.evaluate(()=>{const request=window.atlasMessages.filter(m=>m.type==='gitDiff').at(-1);window.postMessage({type:'gitDiff',projectKey:request.projectKey,requestId:request.requestId,diff:{files:['src/git.js'],file:'src/git.js',patch:'diff --git a/src/git.js b/src/git.js\nBinary files differ',truncated:false}});});
  await page.waitForFunction(()=>document.querySelector('.git-patch')?.textContent.includes('Binary files differ'));
  await page.getByRole('button',{name:'Chats',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Git',exact:true}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'Git',exact:true}).click();
  await page.waitForSelector('.git-patch');
  if(await page.getByRole('spinbutton',{name:'Tree height in pixels'}).inputValue()!=='220')throw Error('Tree height not restored');
  if(await page.getByRole('spinbutton',{name:'Diff height in pixels'}).inputValue()!=='420')throw Error('Diff height not restored');
  return {matrix:results,checks:['commit selection','file selection','patch prefix regression','line numbers','independent height edits','height persistence']};
}
