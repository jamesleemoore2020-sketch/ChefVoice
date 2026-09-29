import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterBackup, complete, MEDIA_SLOTS, needsBackup, restorable, restored } from '../js/backup.js';

// Private backup (audit F11). The decisions run against the real module; the rest are source
// gates, since these tests cannot reach Firestore or Storage: they check both clients still hold
// the shapes that keep a backup private and never write over a published recipe.

const uid = 'chef-1';

test('only the private recipes of the signed-in chef that changed need a backup', () => {
  const fresh = { id: 'r1', title: 'Soup', updatedAt: 10 };
  assert.equal(needsBackup(fresh, uid), true);
  assert.equal(needsBackup({ ...fresh, authorId: uid }, uid), true);
  assert.equal(needsBackup(fresh, ''), false, 'nobody signed in');
  assert.equal(needsBackup({ ...fresh, isPublic: true }, uid), false, 'published: Community holds it');
  assert.equal(needsBackup({ ...fresh, authorId: 'chef-2' }, uid), false, "another chef's");
  assert.equal(needsBackup({ ...fresh, backedUpAt: 10 }, uid), false, 'already backed up as it stands');
  assert.equal(needsBackup({ ...fresh, backedUpAt: 9 }, uid), true, 'changed since');
});

test('the account offers what this browser does not have, newest first', () => {
  const local = [{ id: 'here', updatedAt: 50 }];
  const cloud = [{ id: 'old', updatedAt: 1 }, { id: 'here', updatedAt: 99 }, { id: 'new', updatedAt: 30, isPublic: true }];
  assert.deepEqual(restorable(cloud, local).map((r) => r.id), ['new', 'old']);
});

test('a backup is complete when every photo and the recording are in the account', () => {
  const snapshot = { media: [{ id: 'a', stored: true }, { id: 'b', stored: true }], sessionAudio: { stored: true } };
  const everything = { remoteMedia: [{ id: 'a', url: 'https://storage/a' }, { id: 'b', url: 'https://storage/b' }], audioUploaded: true };
  assert.equal(complete(snapshot, everything), true);
  assert.equal(complete(snapshot, { ...everything, remoteMedia: everything.remoteMedia.slice(0, 1) }), false, 'a photo stayed behind');
  assert.equal(complete(snapshot, { ...everything, audioUploaded: false }), false, 'the recording stayed behind');
  assert.equal(complete({ ...snapshot, audioBackedUp: true }, { ...everything, audioUploaded: false }), true, 'the account already held it');
});

test('what cannot be sent does not hold a backup open', () => {
  const slots = Array.from({ length: MEDIA_SLOTS }, (_, i) => ({ id: `p${i}`, stored: true }));
  const held = { remoteMedia: slots.map((m) => ({ id: m.id, url: `https://storage/${m.id}` })) };
  // Past the account's 24 slots.
  assert.equal(complete({ media: [...slots, { id: 'extra', stored: true }] }, held), true);
  // A restored photo lives in the account, not here.
  assert.equal(complete({ media: [{ id: 'r', stored: false }] }, { remoteMedia: [] }), true);
  // Files this browser has lost: storage evicted, or cleared.
  assert.equal(complete({ media: [{ id: 'gone', stored: true }] }, { remoteMedia: [] }, { missingMedia: new Set(['gone']) }), true);
  assert.equal(complete({ sessionAudio: { stored: true } }, {}, { audioMissing: true }), true);
  assert.equal(complete({}, {}), true, 'no recording in this browser');
});

test('changes made while the upload ran are kept and still wait for the next backup', () => {
  const snapshot = { id: 'r1', title: 'Soup', updatedAt: 10, media: [{ id: 'a', stored: true }], sessionAudio: { stored: true } };
  const result = { authorId: uid, authorName: 'Chef One', remoteMedia: [{ id: 'a', type: 'IMAGE', url: 'https://storage/a' }], audioUploaded: true };
  const changed = { ...snapshot, title: 'Better soup', updatedAt: 11 };
  const merged = { ...changed, ...afterBackup(changed, snapshot, result, true) };
  assert.equal(merged.title, 'Better soup');
  assert.equal(merged.authorId, uid);
  assert.equal(merged.authorName, 'Chef One');
  assert.deepEqual(merged.remoteMedia.map((m) => m.url), ['https://storage/a']);
  assert.equal(merged.audioBackedUp, true);
  assert.equal(merged.backedUpAt, 10, 'the version that went up, not the upload time');
  assert.equal(needsBackup(merged, uid), true, 'the change is not in the account yet');
  assert.equal(needsBackup({ ...snapshot, ...afterBackup(snapshot, snapshot, result, true) }, uid), false);
});

test('a backup done in part keeps what went up and still waits', () => {
  const snapshot = { id: 'r1', updatedAt: 10, backedUpAt: 4, remoteMedia: [{ id: 'old', url: 'https://storage/old' }] };
  const merged = { ...snapshot, ...afterBackup(snapshot, snapshot, { authorId: uid, authorName: 'Chef', remoteMedia: [{ id: 'a', url: 'https://storage/a' }] }, false) };
  assert.equal(merged.backedUpAt, 4);
  assert.deepEqual(merged.remoteMedia.map((m) => m.id), ['old', 'a']);
  assert.equal(needsBackup(merged, uid), true);
});

test('a restored recipe keeps its photos in the account and is already backed up', () => {
  const cloud = {
    id: 'r1', title: 'Stew', authorId: uid, isPublic: false, createdAt: 3, updatedAt: 40,
    media: [{ id: 'm1', type: 'VIDEO', url: 'https://storage/m1' }, { id: 'bad', type: 'IMAGE', url: '' }],
    voiceClips: [{ id: 'v', url: 'https://storage/v' }]
  };
  const back = restored(cloud, 'stored', { stored: true, type: 'audio/webm', size: 9 });
  assert.deepEqual(back.remoteMedia, [{ id: 'm1', type: 'VIDEO', url: 'https://storage/m1' }]);
  // An entry per photo, as a published recipe has, so publishing it later sends them again.
  assert.deepEqual(back.media, [{ id: 'm1', type: 'video/mp4', stored: false }]);
  assert.deepEqual(back.sessionAudio, { stored: true, type: 'audio/webm', size: 9 });
  assert.equal(back.audioBackedUp, true);
  assert.equal(back.backedUpAt, 40);
  assert.equal(back.audioInAccount, undefined);
  assert.equal(needsBackup(back, uid), false);
  assert.equal(complete(back, { remoteMedia: [] }), true, 'nothing of it waits');
});

test('a recording this browser could not download stays in the account, and the recipe says so', () => {
  const back = restored({ id: 'r2', updatedAt: 7, media: [] }, 'in-account');
  assert.equal(back.audioInAccount, true);
  assert.equal(back.audioBackedUp, true, 'a later backup does not try to send what is not here');
  assert.equal(back.sessionAudio, undefined);
  const none = restored({ id: 'r3', updatedAt: 7 }, 'none');
  assert.equal(none.audioBackedUp, false);
  assert.equal(none.audioInAccount, undefined);
});

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const client = read('../js/firebase-client.js');
const app = read('../js/app.js');
const androidRepo = read('../../app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt');
const androidState = read('../../app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt');
const between = (source, from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `found ${from}`);
  const end = source.indexOf(to, start + from.length);
  return source.slice(start, end < 0 ? undefined : end);
};

test('a backup writes a private copy and stops at a published one, on both platforms', () => {
  // A private copy written over a published recipe would quietly take it off Community.
  const web = between(client, 'async function writeBackupCopy(', '\n}\n');
  assert.match(web, /runTransaction\(db,/);
  assert.match(web, /if\(data\?\.isPublic===true\)return 'published';/);
  assert.match(web, /if\(mustExist&&!data\)return 'gone';/);
  assert.match(web, /isPublic:false,/);
  const kotlin = between(androidRepo, 'private fun writeBackupCopy(', '\n    }\n');
  assert.match(kotlin, /db\.runTransaction \{ transaction ->/);
  assert.match(kotlin, /current\.getBoolean\("isPublic"\) == true -> BackupWrite\.PUBLISHED/);
  assert.match(kotlin, /mustExist && !current\.exists\(\) -> BackupWrite\.GONE/);
  assert.match(kotlin, /isPublic = false,/);
  // Nothing in either backup ever asks for a public recipe.
  assert.doesNotMatch(between(client, 'export async function backupRecipe(', 'async function writeBackupCopy('), /isPublic:true/);
  assert.doesNotMatch(between(androidRepo, 'fun backupRecipe(', 'private enum class BackupWrite'), /isPublic = true/);
});

test('backup is Pro, off until turned on, and restore is for everyone', () => {
  assert.match(app, /const backupOn=\(\)=>backupChosen\(\)&&isPro\(\);/);
  assert.match(app, /if\(toggle\.checked&&!isPro\(\)\)\{toggle\.checked=false;showPaywall\(PaywallTrigger\.BACKUP\);return;\}/);
  assert.match(androidState, /backupEnabled = uid\.isNotBlank\(\) && backupPrefs\.getBoolean\("enabled_\$uid", false\)/);
  assert.match(androidState, /if \(on && !isPro\) \{\r?\n\s*showPaywall\(PaywallTrigger\.BACKUP\)/);
  // The account is asked what it holds at every sign-in, Pro or not.
  assert.match(app, /checkRestorable\(\);/);
  assert.match(androidState, /checkRestorable\(\)/);
});

test('a recording already in the account is not uploaded again', () => {
  // Up to 120 MB, and it never changes once recorded.
  assert.match(app, /voiceBlob=snapshot\.audioBackedUp\?null:await loadAudioBlob\(snapshot\.id\)/);
  assert.match(app, /const voiceBlob=r\.audioBackedUp\?null:await loadAudioBlob\(r\.id\);/);
  assert.match(androidRepo, /if \(isFullCookingSession && clip\.id == recipe\.backedUpAudioId\) \{/);
});
