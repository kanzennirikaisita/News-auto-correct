/* Bump VERSION whenever the application shell changes. All URLs are scope-relative. */
const VERSION='radar-v1';
const BASE=new URL('./',self.location.href);
const SHELL=`${VERSION}:shell:${BASE.pathname}`;
const DATA=`radar-data:${BASE.pathname}`;
const paths=['./','./index.html','./styles.css','./app.js','./domain.mjs','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png'];
const shellURLs=new Set(paths.map(p=>new URL(p,BASE).href));
const dataURL=new URL('./data/latest.json',BASE).href;
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll([...shellURLs])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('radar-v')&&k.endsWith(`:shell:${BASE.pathname}`)&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
async function latest(request){
  const cache=await caches.open(DATA);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(request,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('Fetch failed');
    const value=await response.clone().json();
    if(value.schemaVersion!==1||!Array.isArray(value.items)||!Array.isArray(value.sources))throw new Error('Invalid feed');
    await cache.put(dataURL,response.clone());return response;
  }catch(error){
    const cached=await cache.match(dataURL);if(!cached)throw error;
    const headers=new Headers(cached.headers);headers.set('X-Radar-Cache','offline');
    return new Response(await cached.arrayBuffer(),{status:200,headers});
  }finally{clearTimeout(timer);}
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==BASE.origin)return;
  if(url.href===dataURL){event.respondWith(latest(event.request));return;}
  if(!shellURLs.has(url.href))return;
  event.respondWith(caches.open(SHELL).then(async cache=>(await cache.match(event.request))||fetch(event.request)));
});
// Prime the feed after first installation; the initial page may have loaded before control.
self.addEventListener('message',event=>{
  if(event.data==='CACHE_FEED')event.waitUntil(latest(new Request(dataURL)).catch(()=>{}));
});
