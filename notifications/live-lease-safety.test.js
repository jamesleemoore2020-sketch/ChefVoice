const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const gradle=fs.readFileSync(path.join(root,'app/build.gradle.kts'),'utf8');
const models=fs.readFileSync(path.join(root,'app/src/main/java/com/chefvoice/app/model/Models.kt'),'utf8');
const repo=fs.readFileSync(path.join(root,'app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt'),'utf8');
const state=fs.readFileSync(path.join(root,'app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt'),'utf8');

test('Android v0.10.7 carries a heartbeat field and lease constants',()=>{
  assert.match(gradle,/versionCode = 60/);assert.match(gradle,/versionName = "0\.10\.8"/);
  assert.match(models,/val heartbeatAt: Long/);
  assert.match(repo,/LIVE_HEARTBEAT_INTERVAL_MS = 10_000L/);
  assert.match(repo,/LIVE_LEASE_TIMEOUT_MS = 35_000L/);
  assert.match(repo,/LIVE_LEGACY_GRACE_MS = 90_000L/);
});

test('Android live list periodically removes stale LIVE rooms without needing a new snapshot',()=>{
  assert.match(repo,/filter \{ it\.isFreshLive\(now\) \}/);
  assert.match(repo,/handler\.postDelayed\(refresh, LIVE_LEASE_REFRESH_MS\)/);
  assert.match(repo,/heartbeatAt > 0L/);
});

test('Android host renews heartbeat only while its selected room remains active',()=>{
  assert.match(state,/startLiveHeartbeat\(sessionId\)/);
  assert.match(state,/cloud\.updateLiveHeartbeat\(sessionId\)/);
  assert.match(state,/stopLiveHeartbeat\(\)/);
  assert.match(state,/FirebaseSocialRepository\.LIVE_HEARTBEAT_INTERVAL_MS/);
});
