'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { demo } = require('./demo');
const bridge = `const initial=${JSON.stringify(demo()).replaceAll('<', '\\u003c')};
let board=JSON.parse(localStorage.getItem('atlasDemoData')||'null')||initial;
let sidebarPreferences=JSON.parse(localStorage.getItem('atlasDemoSidebar')||'null')||{projectSort:'alphabetical',projectOrder:[],hiddenProjects:[]};
if(new URLSearchParams(location.search).has('subfolders')) sidebarPreferences.showSubfolders=true;
window.atlasMessages=[];
window.atlasPreview={getState:()=>JSON.parse(localStorage.getItem('atlasDemoUi')||'null'),setState:s=>localStorage.setItem('atlasDemoUi',JSON.stringify(s)),postMessage:m=>{
  window.atlasMessages.push(m);
  if(m.type==='sidebarPreferences'){sidebarPreferences=m.preferences;localStorage.setItem('atlasDemoSidebar',JSON.stringify(sidebarPreferences));return;}
  if(m.type==='update'){
    const s=board.sessions.find(s=>s.key===m.key);Object.assign(s,m.patch);
    if(typeof m.patch.done==='boolean')s.status=m.patch.done?'Done':'Inbox';
    if(Object.hasOwn(m.patch,'projectOverride'))s.project=board.projectCatalog.find(p=>p.key===(m.patch.projectOverride||originalProjectKey(s)))?.name||s.project;
  }
  if(m.type==='select')setTimeout(()=>window.postMessage({type:'detail',key:m.key,messages:[{role:'user',text:board.sessions.find(s=>s.key===m.key).preview},{role:'assistant',text:'The changes are ready for review. This is a demonstration conversation.'}]}),5);
  if(m.type==='open')window.postMessage({type:'notice',text:'Demo preview: the installed extension resumes this conversation in its provider.'});
  if(m.type==='newChat')window.postMessage({type:'notice',text:'Demo preview: a new '+m.provider+' chat would open in the selected project folder.'});
  if(m.type==='pickProjectFolder')window.postMessage({type:'projectError',text:'Demo preview: Browse opens the native folder picker in VS Code. Enter a fictional absolute path here.'});
  if(m.type==='addTopic')board.topics.push({id:'custom-'+Date.now(),name:m.name,keywords:m.keywords});
  let createdKey='';
  let linkedKey='';
  if(m.type==='linkProjectFolder'){
    const state={customProjects:board.projectCatalog.filter(p=>p.created).map(p=>({id:p.key.slice(7),name:p.name,cwd:p.cwd})),cards:Object.fromEntries(board.sessions.map(s=>[s.key,s]))};
    try{linkedKey=linkProjectFolder(state,m.projectKey,m.folder.trim());}
    catch(e){window.postMessage({type:'projectError',text:e.message});return;}
    const target=board.projectCatalog.find(p=>p.key===m.projectKey);
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
  if(['ready','refresh','update','addTopic','createProject','linkProjectFolder'].includes(m.type)){
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
