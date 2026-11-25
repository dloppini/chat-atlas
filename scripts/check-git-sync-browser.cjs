async page=>{
 await page.setViewportSize({width:1440,height:1000});await page.reload();
 await page.getByRole('button',{name:'Chat Atlas, 1 conversations',exact:true}).click();await page.getByRole('button',{name:'Git',exact:true}).click();await page.waitForSelector('.git-patch');
 if(await page.getByRole('button',{name:'Fit window',exact:true}).getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'Fit window',exact:true}).click();
 if(await page.getByRole('button',{name:'Hide history',exact:true}).getAttribute('aria-pressed')==='true')await page.getByRole('button',{name:'Hide history',exact:true}).click();
 await page.getByRole('combobox',{name:'Branch',exact:true}).selectOption('');await page.waitForSelector('.git-head-label');
 const matrix=[];
 for(const theme of ['dark','pearl']){await page.evaluate(theme => window.dispatchEvent(new MessageEvent('message', {data: {type: 'theme', theme}})), theme);for(const width of [1440,800,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`output/playwright/position-${theme}-${width}.png`,fullPage:true});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Overflow');matrix.push({theme,width,overflow});}}
 await page.getByRole('button',{name:'Fetch',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.git-operation-status')?.textContent.includes('completed'));await page.waitForSelector('.git-head-label');
 if(!await page.getByRole('button',{name:'Pull',exact:true}).isDisabled())throw Error('Dirty pull enabled');
 await page.getByRole('button',{name:'Push',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.git-operation-status')?.textContent.includes('push completed'));
 await page.getByRole('combobox',{name:'Branch',exact:true}).selectOption('refs/heads/feature/git-dashboard');await page.getByRole('button',{name:'Show current branch',exact:true}).waitFor();
 if(!await page.locator('.git-position').textContent().then(s=>s.includes('2 commits only on HEAD / 1 only on this branch')))throw Error('Missing branch relationship');
 await page.getByRole('button',{name:'Show current branch',exact:true}).click();await page.waitForSelector('.git-head-label');
 await page.getByRole('button',{name:'Improve conversation navigation',exact:false}).click();await page.waitForSelector('.git-patch');
 if(!await page.locator('#git-inspector h3').textContent().then(s=>s.startsWith('Viewing commit bbbbbbb')))throw Error('Missing inspected commit');
 if(!await page.locator('.git-checkout').textContent().then(s=>s.includes('aaaaaaa')))throw Error('Checkout moved visually');
 await page.evaluate(()=>{const request=window.atlasMessages.filter(m=>m.type==='gitDashboard').at(-1);window.postMessage({type:'gitDashboard',projectKey:request.projectKey,requestId:request.requestId,dashboard:{root:'Fixture',branch:'Detached HEAD',head:'a'.repeat(40),commits:[],changes:[],branchRefs:[],remotes:['origin'],upstream:'',tracking:null}});});
 await page.waitForFunction(()=>document.querySelector('.git-checkout')?.textContent.includes('Detached HEAD'));
 if(!await page.getByRole('button',{name:'Push',exact:true}).isDisabled())throw Error('Detached push enabled');
 return {matrix,checks:['HEAD marker','upstream counts','dirty pull disabled','demo fetch/push','focus comparison','restore current branch','inspection separate from checkout','detached state']};
}
