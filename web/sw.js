// ChefVoice PWA service worker.
//
// It does one job: keep the app's own files so ChefVoice opens in a kitchen with no
// signal. Nothing cross-origin is ever cached here. Firestore's Listen channel carries
// direct messages and notifications, and Storage serves recipe media; the worker before
// 0.5.18 cached every GET, so a shared browser kept another chef's messages in Cache
// Storage after they signed out. Firestore, Storage, the Firebase SDK on gstatic and
// Analytics now go straight to the network, untouched.
const CACHE='chefvoice-pwa-v0.5.19';

// Everything the app needs to boot offline. web/tests/hosting-config.test.mjs fails when a
// file under web/js/ or web/css/ is missing from this list: the worker does not control the
// first page load, so a module left out here was never cached anywhere, and an offline
// reopen served index.html in its place and the app did not start.
const CORE=['./','./index.html','./manifest.webmanifest',
  './css/styles.css','./css/cook-wizard.css',
  './js/app.js','./js/chef-analytics.js','./js/collections.js','./js/community-feed.js','./js/cook-along.js','./js/cook-commands.js',
  './js/cooking-session-parser.js','./js/entitlement.js','./js/firebase-client.js','./js/firebase-config.js',
  './js/inbox.js','./js/ingredient-parser.js','./js/ingredient-scaling.js','./js/second-pass-reviewer.js',
  './js/shopping-list.js','./js/step-timers.js','./js/storage.js','./js/swipe-gestures.js','./js/tag-utils.js',
  './js/theme-boot.js','./js/voice-capture.js','./js/webm-duration-fix.js','./js/webrtc-live-host.js','./js/webrtc-live-viewer.js',
  './js/webrtc-signaling.js',
  './assets/chefvoice-icon.png','./assets/chefvoice-cover.webp','./assets/community-hero.webp','./assets/live-hero.webp'];

// How long an app launch waits on the network before opening from the cache instead.
// Kitchen Wi-Fi that is connected but not passing traffic otherwise hangs the launch.
const NAVIGATION_TIMEOUT_MS=3000;

// Pages that were opened from the cache. Their scripts are served from the cache too, so
// one launch never mixes modules from two deploys: an ES module importing a name that an
// older copy of its neighbour lacks fails to link, and the app would not start at all.
// Held in memory only; if the browser stops the worker, those pages fall back to
// network-then-cache, which is slower but still correct.
const cacheBootedClients=new Set();
const MAX_TRACKED_CLIENTS=50;

self.addEventListener('install',event=>event.waitUntil(
  // 'reload' skips the HTTP cache, so the precache is one consistent deploy.
  caches.open(CACHE)
    .then(cache=>cache.addAll(CORE.map(url=>new Request(url,{cache:'reload'}))))
    .then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  // Dropping every other cache also removes what older workers stored, private
  // Firestore payloads included.
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  // Not ours to cache: Firestore, Storage, the Firebase SDK, Analytics.
  if(new URL(request.url).origin!==self.location.origin)return;
  if(request.mode==='navigate'){event.respondWith(openApp(event));return;}
  event.respondWith(appFile(event));
});

function withTimeout(promise,ms){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('network timeout')),ms);
    promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
}

// A partial (206) response, an opaque one or an error page is never stored.
function storable(request,response){
  return response&&response.status===200&&response.type==='basic'&&!request.headers.has('range');
}

function store(key,response){
  const copy=response.clone();
  caches.open(CACHE).then(cache=>cache.put(key,copy)).catch(()=>{});
}

async function openApp(event){
  // Hosting rewrites every path to index.html, so every launch -- a shared recipe link, a
  // push notification's ?tab= -- is the same page and is stored under one key, not one
  // entry per link.
  const network=fetch(event.request).then(response=>{
    if(storable(event.request,response)&&(response.headers.get('content-type')||'').includes('text/html'))store('./index.html',response);
    return response;
  });
  try{
    return await withTimeout(network,NAVIGATION_TIMEOUT_MS);
  }catch{
    const cached=await caches.match('./index.html');
    if(!cached)return network.catch(()=>Response.error());
    if(event.resultingClientId){
      cacheBootedClients.add(event.resultingClientId);
      if(cacheBootedClients.size>MAX_TRACKED_CLIENTS)cacheBootedClients.delete(cacheBootedClients.values().next().value);
    }
    return cached;
  }
}

async function appFile(event){
  const request=event.request;
  if(cacheBootedClients.has(event.clientId)){
    const cached=await caches.match(request);
    if(cached)return cached;
  }
  try{
    const response=await fetch(request);
    if(storable(request,response))store(request,response);
    return response;
  }catch{
    const cached=await caches.match(request);
    return cached||Response.error();
  }
}
