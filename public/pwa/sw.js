// Decoy PWA service worker — shell cache only
const CACHE = "nss-pwa-v1";
const SHELL = ["./", "./index.html", "./app.js"];
self.addEventListener("install", (e)=>{
  e.waitUntil(caches.open(CACHE).then((c)=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", (e)=>{
  e.waitUntil(
    caches.keys().then((keys)=>Promise.all(keys.filter((k)=>k!==CACHE).map((k)=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener("fetch", (e)=>{
  const url = new URL(e.request.url);
  if(url.pathname.startsWith("/api/") || e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit)=>{
      return hit || fetch(e.request).then((res)=>{
        if(url.origin === self.location.origin && res.ok){
          const clone = res.clone();
          caches.open(CACHE).then((c)=>c.put(e.request, clone));
        }
        return res;
      }).catch(()=> hit || Response.error());
    })
  );
});
