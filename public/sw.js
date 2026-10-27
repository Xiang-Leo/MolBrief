const CACHE="molbrief-static-v1";
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(["/favicon.svg","/offline.html"])));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("molbrief-")&&k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch",event=>{
  if(event.request.mode==="navigate") {
    event.respondWith(fetch(event.request).catch(()=>caches.match("/offline.html")));
  }
});
