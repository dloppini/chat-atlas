'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { demo } = require('./demo');
const bridge = `const initial=${JSON.stringify(demo()).replaceAll('<', '\\u003c')};
let board=JSON.parse(localStorage.getItem('atlasDemoData')||'null')||initial;
let sidebarPreferences=JSON.parse(localStorage.getItem('atlasDemoSidebar')||'null')||{projectSort:'alphabetical',projectOrder:[],hiddenProjects:[]};
window.atlasMessages=[];
window.atlasPreview={getState:()=>JSON.parse(localStorage.getItem('atlasDemoUi')||'null'),setState:s=>localStorage.setItem('atlasDemoUi',JSON.stringify(s)),postMessage:m=>{window.atlasMessages.push(m);if(m.type==='sidebarPreferences'){sidebarPreferences=m.preferences;localStorage.setItem('atlasDemoSidebar',JSON.stringify(sidebarPreferences));return;}if(m.type==='update'){const s=board.sessions.find(s=>s.key===m.key);Object.assign(s,m.patch);if(typeof m.patch.done==='boolean')s.status=m.patch.done?'Done':'Inbox';}if(m.type==='select')setTimeout(()=>window.postMessage({type:'detail',key:m.key,messages:[{role:'user',text:board.sessions.find(s=>s.key===m.key).preview},{role:'assistant',text:'The changes are ready for review. This is a demonstration conversation.'}]}),5);if(m.type==='open')window.postMessage({type:'notice',text:'Demo preview: the installed extension resumes this conversation in its provider.'});if(m.type==='addTopic')board.topics.push({id:'custom-'+Date.now(),name:m.name,keywords:m.keywords});if(['ready','refresh','update','addTopic'].includes(m.type)){localStorage.setItem('atlasDemoData',JSON.stringify(board));setTimeout(()=>window.postMessage({...board,sidebarPreferences}),10)}}};`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '/index.html') {
      let html = await fs.readFile(path.join(__dirname, '../media/board.html'), 'utf8');
      html = html.replaceAll('{{cspSource}}', "'self'").replaceAll('{{nonce}}', 'preview').replace('{{styleUri}}', '/board.css').replaceAll('{{iconUri}}', '/icon.png').replace('{{projectsUri}}', '/projects.js').replace('{{scriptUri}}', '/board.js').replace('<script nonce="preview" src=', '<script nonce="preview" src="/bridge.js"></script><script nonce="preview" src=');
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    } else if (req.url === '/favicon.ico') { res.statusCode = 204; res.end(); }
    else if (req.url === '/bridge.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bridge); }
    else if (['/board.js', '/projects.js', '/board.css', '/icon.png'].includes(req.url)) { res.setHeader('Content-Type', req.url.endsWith('png') ? 'image/png' : req.url.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(__dirname, '../media', req.url.slice(1)))); }
    else { res.statusCode = 404; res.end('Not found'); }
  } catch { res.statusCode = 500; res.end('Preview error'); }
});
server.listen(4317, '127.0.0.1', () => console.log('Chat Atlas demo: http://127.0.0.1:4317 (fictional conversations only)'));
