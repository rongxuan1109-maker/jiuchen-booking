// 九辰後台 App — Service Worker（外殼快取，讓 App 秒開；有網路時背景更新）
const CACHE='jiuchen-app-v2';
const SHELL=['app.html','manifest.webmanifest'];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}));
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;                       // 只快取 GET
  const url=new URL(req.url);
  // Supabase API / 認證：一律走網路（不可快取即時資料）
  if(url.hostname.endsWith('supabase.co')) return;
  // App 外殼與 CDN：stale-while-revalidate（先給快取、背景更新）
  e.respondWith(
    caches.open(CACHE).then(async cache=>{
      const cached=await cache.match(req);
      const network=fetch(req).then(res=>{ if(res&&res.status===200) cache.put(req,res.clone()); return res; }).catch(()=>cached);
      return cached||network;
    })
  );
});
