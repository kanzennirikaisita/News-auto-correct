// Dependency-free local server; also accepts supervised-preview host/port flags.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const host=option('--host','127.0.0.1');const port=Number(option('--port','8000'));
const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const top=new Set(['index.html','app.js','domain.mjs','styles.css','sw.js','manifest.webmanifest']);
createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const requested=new URL(req.url,'http://localhost');
    if(requested.pathname==='/' && requested.searchParams.get('preview')==='mobile'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end('<!doctype html><html lang="ja"><title>My Radar mobile preview</title><body style="margin:0;background:#dce2ea;display:grid;place-items:center;min-height:100vh"><iframe title="390px mobile preview" src="/News-auto-correct/" style="width:390px;height:844px;border:0;background:white"></iframe></body></html>');return;
    }
    let path=decodeURIComponent(requested.pathname);
    if(path.startsWith('/News-auto-correct/'))path=path.slice('/News-auto-correct'.length);
    if(path==='/')path='/index.html';
    path=path.slice(1);
    if(path.includes('..')||path.includes('\\')||!(top.has(path)||/^icons\/[\w.-]+$/.test(path)||path==='data/latest.json')){res.writeHead(404);res.end();return;}
    const body=await readFile(resolve(root,path));
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end();}
}).listen(port,host,()=>console.log(`Local radar server listening on ${host}:${port}`));
