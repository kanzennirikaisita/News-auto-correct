import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function harness(){
  const events={}, stores=new Map();let online=true;
  const caches={open:async name=>{if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {addAll:async urls=>{for(const u of urls)store.set(u,new Response('shell'));},put:async(key,value)=>store.set(typeof key==='string'?key:key.url,value),match:async key=>store.get(typeof key==='string'?key:key.url)?.clone()};},keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key)};
  const feed={schemaVersion:1,items:[],sources:[]};
  const context=vm.createContext({URL,Request,Response,Headers,AbortController,setTimeout,clearTimeout,caches,
    fetch:async()=>{if(!online)throw Error('offline');return new Response(JSON.stringify(feed),{headers:{'Content-Type':'application/json'}});},
    self:{location:{href:'https://example.org/News-auto-correct/sw.js'},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
  vm.runInContext(source,context);
  return {events,stores,setOffline:()=>online=false,async fire(name,extra={}){let promise;events[name]({...extra,waitUntil:p=>promise=p,respondWith:p=>promise=p});return promise?await promise:undefined;}};
}
test('subpath shell and first-install feed survive offline reload',async()=>{const h=harness();await h.fire('install');await h.fire('activate');await h.fire('message',{data:'CACHE_FEED'});h.setOffline();const response=await h.fire('fetch',{request:new Request('https://example.org/News-auto-correct/data/latest.json')});assert.equal(response.headers.get('X-Radar-Cache'),'offline');assert.equal((await response.json()).schemaVersion,1);const page=await h.fire('fetch',{request:new Request('https://example.org/News-auto-correct/')});assert.equal(await page.text(),'shell');assert.equal(await h.fire('fetch',{request:new Request('https://external.org/article')}),undefined);});
test('activation does not delete other applications caches',async()=>{const h=harness();h.stores.set('another-app',new Map());h.stores.set('radar-v0:shell:/News-auto-correct/',new Map());await h.fire('install');await h.fire('activate');assert(h.stores.has('another-app'));assert(!h.stores.has('radar-v0:shell:/News-auto-correct/'));});
