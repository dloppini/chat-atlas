'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { demo } = require('./demo');
const bridge = `const initial=${JSON.stringify(demo()).replaceAll('<', '\\u003c')};
let board=JSON.parse(localStorage.getItem('atlasDemoData')||'null')||initial;
let sidebarPreferences=JSON.parse(localStorage.getItem('atlasDemoSidebar')||'null')||{projectSort:'alphabetical',projectOrder:[],hiddenProjects:[]};
if(new URLSearchParams(location.search).has('subfolders')) sidebarPreferences.showSubfolders=true;
let demoChanges=[{code:' M',file:'media/board.js'},{code:' M',file:'src/git.js'},{code:'??',file:'notes.txt'}];
function demoGitDashboard(dashboard, focusRef) {
  dashboard.changes=demoChanges;dashboard.indexVersion='demo-index';dashboard.azureRemotes=[{name:'origin',url:'https://dev.azure.com/example/project/_git/repo'}];
  dashboard.branchRefs=[{ref:'refs/heads/main',name:'main'},{ref:'refs/heads/feature/git-dashboard',name:'feature/git-dashboard'},{ref:'refs/remotes/origin/main',name:'remotes/origin/main'}];
  dashboard.head=dashboard.commits[0].hash;dashboard.remotes=['origin'];dashboard.upstream='origin/main';dashboard.tracking=[2,1];dashboard.comparison=focusRef?[2,1]:null;
  dashboard.focusRef=focusRef||'';
  if(focusRef==='refs/heads/feature/git-dashboard')dashboard.commits=dashboard.commits.slice(2);
  return dashboard;
}
window.atlasMessages=[];
window.atlasPreview={getState:()=>JSON.parse(localStorage.getItem('atlasDemoUi')||'null'),setState:s=>localStorage.setItem('atlasDemoUi',JSON.stringify(s)),postMessage:m=>{
  window.atlasMessages.push(m);
  if(m.type==='handoffFiles')window.postMessage({type:m.type,key:m.key,requestId:m.requestId,files:['media/board.js']});
  if(m.type==='handoff')window.postMessage({type:'handoffStarted',key:m.key,requestId:m.requestId});
  if(m.type==='passages')window.postMessage({type:'notice',text:'In VS Code, choose a matching passage to open the surrounding exchange.'});
  if(m.type==='batchStatus')for(const s of board.sessions)if(m.keys.includes(s.key)){s.status=m.status;s.completedAt=m.status==='Done'?Date.now():null;}
  if(m.type==='sidebarPreferences'){sidebarPreferences=m.preferences;localStorage.setItem('atlasDemoSidebar',JSON.stringify(sidebarPreferences));return;}
  if(m.type==='update'){
    const s=board.sessions.find(s=>s.key===m.key);Object.assign(s,m.patch);
    if(typeof m.patch.done==='boolean')s.status=m.patch.done?'Done':'Inbox';
    if(Object.hasOwn(m.patch,'projectOverride'))s.project=board.projectCatalog.find(p=>p.key===(m.patch.projectOverride||originalProjectKey(s)))?.name||s.project;
  }
  if(m.type==='select')setTimeout(()=>window.postMessage({type:'detail',key:m.key,messages:[{role:'user',text:board.sessions.find(s=>s.key===m.key).preview},{role:'assistant',text:'The changes are ready for review. This is a demonstration conversation.'}]}),5);
  if(m.type==='open')window.postMessage({type:'notice',text:'Demo preview: the installed extension resumes this conversation in its provider.'});
  if(m.type==='feedback')window.postMessage({type:'notice',text:'Demo preview: VS Code offers Report a bug, Request a feature, and View existing reports. Reports open as public GitHub drafts; nothing is submitted automatically.'});
  if(m.type==='gitOperation'){setTimeout(()=>{
    if(m.action==='stage')demoChanges=demoChanges.map(c=>m.files.includes(c.file)?{...c,code:c.code==='??'?'A ':'M '}:c);
    if(m.action==='unstage')demoChanges=demoChanges.map(c=>m.files.includes(c.file)?{...c,code:c.code==='A '?'??':' M'}:c);
    if(m.action==='commit')demoChanges=demoChanges.filter(c=>c.code[0]===' '||c.code[0]==='?');
    window.postMessage({type:'gitOperation',projectKey:m.projectKey,requestId:m.requestId,message:m.action==='createPr'?'Demo: Azure PR form would open in your browser.':'Demo: '+m.action+' completed; no real repository was changed.'});
  },200);return;}
  if(m.type==='gitDashboard')setTimeout(()=>window.postMessage({type:'gitDashboard',projectKey:m.projectKey,requestId:m.requestId,dashboard:demoGitDashboard({"root": "Demo repository (fictional)", "branch": "main", "branches": "* main\\n  feature/git-dashboard\\n  remotes/origin/main", "changes": [{"code": " M", "file": "media/board.js"}], "commits": [{"hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "parents": ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccccccccccc"], "subject": "Merge repository browser", "author": "Demo author", "date": "2026-11-14T10:00:00Z", "refs": "HEAD -> main"}, {"hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "parents": ["dddddddddddddddddddddddddddddddddddddddd"], "subject": "Improve conversation navigation", "author": "Demo author", "date": "2026-11-14T10:00:00Z", "refs": ""}, {"hash": "cccccccccccccccccccccccccccccccccccccccc", "parents": ["dddddddddddddddddddddddddddddddddddddddd"], "subject": "Add Git diff inspector", "author": "Demo author", "date": "2026-11-14T10:00:00Z", "refs": "feature/git-dashboard"}, {"hash": "dddddddddddddddddddddddddddddddddddddddd", "parents": [], "subject": "Initial project", "author": "Demo author", "date": "2026-11-14T10:00:00Z", "refs": ""}]},m.focusRef)}),80);
  if(m.type==='gitDiff'){
    const changes=demoChanges.filter(c=>m.mode==='all'||(m.mode==='staged'?c.code[0]!==' '&&c.code[0]!=='?':m.mode==='untracked'?c.code==='??':c.code[1]!==' '&&c.code!=='??'));
    const listed=m.mode==='commit'?[{code:'M',file:'media/board.js'},{code:'A',file:'src/git.js'},{code:'D',file:'media/old-panel.css'},{code:'M',file:'src/engineering/graph/layout.js'},{code:'R',file:'src/engineering/graph/edges.js',original:'src/engineering/edges.js'}]:changes;
    const files=listed.map(c=>c.file);
    const file=m.file||files[0]||'';
    const patch=changes.find(c=>c.file===file)?.code==='??'?'@@ New untracked file @@\\n+New notes':'@@ -1,3 +1,4 @@\\n const view = true;\\n-old line\\n+new line\\n+one more line\\n context';
    setTimeout(()=>window.postMessage({type:'gitDiff',projectKey:m.projectKey,requestId:m.requestId,diff:{files,file,changes:listed,patch,truncated:false}}),80);
  }
  if(m.type==='newChat')window.postMessage({type:'notice',text:'Demo preview: a new '+m.provider+' chat would open in the selected project folder.'});
  if(m.type==='renameProject'){
    const target=board.projectCatalog.find(p=>p.key===m.projectKey);
    if(!target)return;
    const name=window.prompt('Rename project (1 to 80 characters)',target.name);
    if(name===null)return;
    if(!name.trim()||name.trim().length>80){window.postMessage({type:'notice',text:'Choose a project name of 1 to 80 characters.'});return;}
    target.name=name.trim();
    for(const s of board.sessions)if(projectGroupKey(s)===target.key)s.project=target.name;
  }
  if(m.type==='pickProjectFolder')window.postMessage({type:'projectError',text:'Demo preview: Browse opens the native folder picker in VS Code. Enter a fictional absolute path here.'});
  if(m.type==='addTopic')board.topics.push({id:'custom-'+Date.now(),name:m.name,keywords:m.keywords});
  let createdKey='';
  let linkedKey='';
  if(m.type==='linkProjectFolder'){
    const state={customProjects:board.projectCatalog.filter(p=>p.created).map(p=>({id:p.key.slice(7),name:p.name,cwd:p.cwd})),cards:Object.fromEntries(board.sessions.map(s=>[s.key,s]))};
    const target=board.projectCatalog.find(p=>p.key===m.projectKey);
    try{linkedKey=target?.cwd?reconnectProjectFolder(state,target,m.folder.trim()):linkProjectFolder(state,m.projectKey,m.folder.trim());}
    catch(e){window.postMessage({type:'projectError',text:e.message});return;}
    for(const s of board.sessions)if(originalProjectKey(s)===m.projectKey)s.cwd=m.folder.trim();
    if(linkedKey===m.projectKey){window.postMessage({type:'projectFolderLinked',previousKey:m.projectKey,key:linkedKey});return;}
    board.projectCatalog=board.projectCatalog.filter(p=>p.key!==linkedKey);
    target.key=linkedKey;target.cwd=m.folder.trim();
    for(const s of board.sessions)if(projectGroupKey(s)===linkedKey)s.project=target.name;
    sidebarPreferences.projectOrder=remapProjectKeys(sidebarPreferences.projectOrder,m.projectKey,linkedKey);
    sidebarPreferences.hiddenProjects=remapProjectKeys(sidebarPreferences.hiddenProjects,m.projectKey,linkedKey);
    localStorage.setItem('atlasDemoSidebar',JSON.stringify(sidebarPreferences));
  }
  if(m.type==='createProject'){
    createdKey=m.folder?originalProjectKey({cwd:m.folder}):'custom:demo-'+Date.now();
    if(!board.projectCatalog.some(p=>p.key===createdKey))board.projectCatalog.push({key:createdKey,name:m.name,cwd:m.folder||'',created:true});
    const s=board.sessions.find(s=>s.key===m.key);if(s){s.projectOverride=createdKey;s.project=m.name;delete s.subfolder;}
  }
  if(['ready','refresh','update','batchStatus','addTopic','createProject','linkProjectFolder','renameProject'].includes(m.type)){
    localStorage.setItem('atlasDemoData',JSON.stringify(board));
    setTimeout(()=>{window.postMessage({...board,sidebarPreferences});if(createdKey)window.postMessage({type:'projectCreated',key:createdKey});if(linkedKey)window.postMessage({type:'projectFolderLinked',previousKey:m.projectKey,key:linkedKey});},10);
  }
}};`;
const server = http.createServer(async (req, res) => {
  try {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/' || route === '/index.html') {
      let html = await fs.readFile(path.join(__dirname, '../media/board.html'), 'utf8');
      html = html.replaceAll('{{cspSource}}', "'self'").replaceAll('{{nonce}}', 'preview').replace('{{version}}', require('../package.json').version).replace('{{styleUri}}', '/board.css').replaceAll('{{iconUri}}', '/icon.png').replace('{{projectsUri}}', '/projects.js').replace('{{scriptUri}}', '/board.js').replace('<script nonce="preview" src=', '<script nonce="preview" src="/bridge.js"></script><script nonce="preview" src=');
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    } else if (route === '/favicon.ico') { res.statusCode = 204; res.end(); }
    else if (route === '/bridge.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bridge); }
    else if (['/board.js', '/projects.js', '/board.css', '/icon.png'].includes(route)) { res.setHeader('Content-Type', route.endsWith('png') ? 'image/png' : route.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(__dirname, '../media', route.slice(1)))); }
    else { res.statusCode = 404; res.end('Not found'); }
  } catch { res.statusCode = 500; res.end('Preview error'); }
});
server.listen(4317, '127.0.0.1', () => console.log('Chat Atlas demo: http://127.0.0.1:4317 (fictional conversations only)'));
