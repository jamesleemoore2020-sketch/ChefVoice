const CACHE='chefvoice-pwa-v0.5.16';
const CORE=['./','./index.html','./css/styles.css','./css/cook-wizard.css','./js/app.js','./js/ingredient-parser.js','./js/cooking-session-parser.js','./js/voice-capture.js','./js/storage.js','./js/collections.js','./js/swipe-gestures.js','./js/cook-along.js','./js/cook-commands.js','./js/step-timers.js','./js/ingredient-scaling.js','./js/shopping-list.js','./js/firebase-config.js','./js/firebase-client.js','./js/webrtc-signaling.js','./js/webrtc-live-viewer.js','./js/webrtc-live-host.js','./manifest.webmanifest','./assets/chefvoice-icon.png','./assets/chefvoice-cover.webp','./assets/community-hero.webp','./assets/live-hero.webp'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).then(r=>{const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
