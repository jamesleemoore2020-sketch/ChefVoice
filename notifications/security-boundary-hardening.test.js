const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const rules=fs.readFileSync('firestore.rules','utf8');const fn=fs.readFileSync('notifications/functions/index.js','utf8');
test('Live signaling is host or bound-viewer only',()=>{
  assert.match(rules,/function livePeerViewer\(sessionId, peerId\)[\s\S]*peerId == request\.auth\.uid[\s\S]*viewerUid == request\.auth\.uid/);
  assert.match(rules,/match \/peers\/\{peerId\}[\s\S]*allow read: if liveHost\(sessionId\) \|\| livePeerViewer\(sessionId, peerId\)/);
  assert.match(rules,/match \/hostCandidates\/\{candidateId\}[\s\S]*allow delete: if liveHost\(sessionId\) \|\| livePeerViewer\(sessionId, peerId\)/);
});
test('notification actor names are server profile-derived',()=>{
  assert.match(fn,/async function trustedActorName\(uid\)/);
  assert.match(fn,/const actorName = await trustedActorName\(senderUid\)/);
  assert.match(fn,/const hostName = await trustedActorName\(hostUid\)/);
});
