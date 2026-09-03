const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Android model includes follower preference and follow notification routing',()=>{const m=read('app/src/main/java/com/chefvoice/app/model/Models.kt');const s=read('app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt');assert.match(m,/followers: Boolean = true/);assert.match(s,/"follow" ->/);assert.match(s,/openChefProfile\(notification.actorUid\)/);});
test('backend creates deterministic blocked-aware new follower notification',()=>{const f=read('notifications/functions/index.js');assert.match(f,/exports\.notifyNewFollower/);assert.match(f,/users\/\{targetUid\}\/followers\/\{followerUid\}/);assert.match(f,/`follow_\$\{actorUid\}`/);assert.match(f,/await isBlocked\(recipientUid, actorUid\)/);assert.match(f,/follow: "followers"/);});
test('rules keep follower preference owner-private',()=>{const r=read('firestore.rules');assert.match(r,/['"]followers['"]/);assert.match(r,/request\.resource\.data\.followers is bool/);});
