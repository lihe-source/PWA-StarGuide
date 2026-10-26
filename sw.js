'use strict';
const VERSION='1.1.0';
const PREFIX='starguide-'+new URL(self.registration.scope).pathname+'-';
const CACHE=PREFIX+VERSION;
const ASSETS=['./','./index.html','./style.css','./app.js','./core.js','./worker.js','./storage.js','./exif.js','./astronomy.browser.min.js','./stars.json','./constellations.json','./manifest.webmanifest','./version.json','./favicon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 // A deployment must contain a consistent version before it may replace the previous cache.
 const r=await fetch(new URL('./version.json',self.registration.scope),{cache:'no-store'});
 if(!r.ok||(await r.json()).version!==VERSION)throw new Error('Incomplete deployment');
 const cache=await caches.open(CACHE);
 await cache.addAll(ASSETS.map(p=>new Request(new URL(p,self.registration.scope),{cache:'reload'})));
 // Wait for the application's safe idle point; never reload while capturing or saving.
})()));
self.addEventListener('message',event=>{if(['ACTIVATE','SKIP_WAITING'].includes(event.data?.type))self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const k of await caches.keys())if(k.startsWith(PREFIX)&&k!==CACHE)await caches.delete(k);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url),scope=new URL(self.registration.scope);
 if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 if(url.pathname===new URL('./version.json',scope).pathname&&url.search)return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE),cached=await cache.match(event.request,{ignoreSearch:url.searchParams.get('v')===VERSION});if(cached)return cached;
  try{return await fetch(event.request)}catch(e){if(event.request.mode==='navigate')return (await cache.match(new URL('./index.html',scope)))||Response.error();throw e}
 })());
});
