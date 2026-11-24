const C='finsy-v3';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png']).catch(()=>{})));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
 e.respondWith(fetch(r,{cache:'no-store'}).then(res=>{const cp=res.clone();caches.open(C).then(c=>c.put(r,cp));return res;}).catch(()=>caches.match(r).then(m=>m||caches.match('./index.html'))));});
self.addEventListener('push',e=>{
 let data={title:'Finsy',body:''};
 try{ data=e.data.json(); }catch(err){}
 e.waitUntil(self.registration.showNotification(data.title||'Finsy',{
  body:data.body||'',icon:'./icon-192.png',badge:'./icon-192.png',data:{url:'./'}
 }));
});
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 e.waitUntil(clients.matchAll({type:'window'}).then(list=>{
  for(const c of list){ if('focus' in c) return c.focus(); }
  if(clients.openWindow) return clients.openWindow(e.notification.data&&e.notification.data.url||'./');
 }));
});
