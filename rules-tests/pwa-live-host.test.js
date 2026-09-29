// Production PWA host + viewer against real Firestore rules. Camera and RTC are
// simulated; device media delivery remains a separate Android/iPhone check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const sdk = require('firebase/firestore');
const { doc, collection, setDoc, updateDoc, deleteDoc, getDoc, getDocs } = sdk;
const root = path.resolve(__dirname, '..');
const HOST = 'pwa-broadcast-host', VIEWER = 'pwa-broadcast-viewer';
const candidate = { sdpMid: '0', sdpMLineIndex: 0, candidate: 'candidate:1 1 UDP 1 192.0.2.1 5000 typ host' };
let env, hostDb, viewerDb, streams, hostPeers, viewerPeers;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(predicate) {
  const end = Date.now() + 8000;
  while (!await predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for signaling');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function mediaStream() {
  const tracks = ['video', 'audio'].map(kind => ({ kind, readyState: 'live', enabled: true, listeners: {}, stop() { this.readyState = 'ended'; }, addEventListener(name, callback) { this.listeners[name] = callback; } }));
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks.filter(t => t.kind === 'audio'), getVideoTracks: () => tracks.filter(t => t.kind === 'video') };
  streams.push(stream);
  return stream;
}
class HostRtc {
  constructor() { this.id = hostPeers.length + 1; this.candidates = []; this.tracks = []; this.connectionState = 'new'; hostPeers.push(this); }
  addTrack(track) { this.tracks.push(track); }
  async createOffer() { if (this.offerGate) await this.offerGate; return { type: 'offer', sdp: `host-offer-${this.id}` }; }
  async setLocalDescription(value) { this.localDescription = value; this.onicecandidate?.({ candidate }); }
  async setRemoteDescription(value) { this.remoteDescription = value; this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
  async addIceCandidate(value) { this.candidates.push(value); }
  close() { this.closed = true; this.connectionState = 'closed'; }
}
class ViewerRtc {
  constructor() { this.candidates = []; viewerPeers.push(this); }
  async setRemoteDescription(value) { this.remoteDescription = value; }
  async createAnswer() { return { type: 'answer', sdp: 'viewer-answer' }; }
  async setLocalDescription(value) { this.localDescription = value; this.onicecandidate?.({ candidate }); }
  async addIceCandidate(value) { this.candidates.push(value); }
  close() { this.closed = true; }
}
async function loadController(role, database, overrides = {}, globals = {}) {
  const context = vm.createContext({ console, setInterval, clearInterval, Date, RTCPeerConnection: ViewerRtc, ...globals });
  const io = { ...sdk, ...overrides };
  // The browser SDK and client normally share a realm. Copy only plain JSON
  // payloads across the VM boundary so the real SDK recognizes their prototype.
  const plain = value => JSON.parse(JSON.stringify(value));
  const exports = {
    ...io, db: database,
    setDoc: (ref, data, ...options) => io.setDoc(ref, plain(data), ...options),
    updateDoc: (ref, data, ...options) => io.updateDoc(ref, plain(data), ...options),
    runTransaction: (db, callback, ...options) => io.runTransaction(db, transaction => callback({
      get: ref => transaction.get(ref),
      update: (ref, data) => transaction.update(ref, plain(data)),
      set: (ref, data) => transaction.set(ref, plain(data))
    }), ...options)
  };
  const firebase = new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
  const helpers = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'web/js/webrtc-signaling.js'), 'utf8'), { context });
  const module = new vm.SourceTextModule(fs.readFileSync(path.join(root, `web/js/webrtc-live-${role}.js`), 'utf8'), { context });
  await module.link(specifier => {
    if (specifier === './firebase-client.js') return firebase;
    if (specifier === './webrtc-signaling.js') return helpers;
    throw new Error(`Unexpected import: ${specifier}`);
  });
  await module.evaluate();
  return module.namespace[role === 'host' ? 'LiveHostController' : 'LiveViewerController'];
}
async function host(options = {}, overrides = {}, globals = {}) {
  const Controller = await loadController('host', hostDb, overrides, globals);
  return new Controller({ hostUid: HOST, hostName: 'Host Chef', mediaDevices: { getUserMedia: async () => mediaStream() }, PeerConnection: HostRtc, ...options });
}
async function join(sessionRef, joinedAt = Date.now()) {
  const peer = doc(viewerDb, 'liveSessions', sessionRef.id, 'peers', VIEWER);
  await setDoc(peer, { viewerUid: VIEWER, state: 'JOINING', joinedAt, updatedAt: Date.now() });
  return peer;
}
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'chefvoice-pwa-host-test', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
});
test.after(async () => { await env?.cleanup(); });
test.beforeEach(async () => {
  streams = []; hostPeers = []; viewerPeers = [];
  await env.clearFirestore();
  hostDb = env.authenticatedContext(HOST).firestore();
  viewerDb = env.authenticatedContext(VIEWER).firestore();
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', HOST), { displayName: 'Host Chef' }));
});

test('camera preview stays private, supports mute and stops tracks on cancel', async () => {
  const controller = await host();
  try {
    await controller.prepare();
    assert.equal((await getDocs(collection(hostDb, 'liveSessions'))).size, 0);
    controller.setMuted(true);
    assert.equal(streams[0].getAudioTracks()[0].enabled, false);
    controller.setMuted(false);
    assert.equal(streams[0].getAudioTracks()[0].enabled, true);
    await controller.prepare('user');
    assert.ok(streams[0].getTracks().every(t => t.readyState === 'ended'));
    assert.ok(streams[1].getTracks().every(t => t.readyState === 'live'));
  } finally { await controller.stop(); }
  assert.ok(streams[0].getTracks().every(t => t.readyState === 'ended'));
});

test('denied camera permission creates no room and permits an explicit retry', async () => {
  let denied = true;
  const controller = await host({ mediaDevices: { getUserMedia: async () => {
    if (denied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    return mediaStream();
  } } });
  try {
    await assert.rejects(controller.prepare(), /Allow camera and microphone/);
    assert.equal(controller.phase, 'idle');
    assert.equal((await getDocs(collection(hostDb, 'liveSessions'))).size, 0);
    denied = false;
    assert.equal(await controller.prepare(), true);
  } finally { await controller.stop(); }
});

test('permission granted after cancel immediately releases the late camera stream', async () => {
  const allowed = deferred();
  const controller = await host({ mediaDevices: { getUserMedia: () => allowed.promise } });
  const prepared = controller.prepare();
  await controller.stop();
  allowed.resolve(mediaStream());
  assert.equal(await prepared, false);
  assert.ok(streams[0].getTracks().every(t => t.readyState === 'ended'));
  assert.equal((await getDocs(collection(hostDb, 'liveSessions'))).size, 0);
});

test('PWA host and existing PWA viewer exchange SDP and ICE under the unchanged rules', { timeout: 20000 }, async () => {
  const counts = [], statuses = [];
  const controller = await host({ onViewerCount: n => counts.push(n), onStatus: s => statuses.push(s) });
  const Viewer = await loadController('viewer', viewerDb);
  const viewer = new Viewer({ sessionId: controller.sessionRef.id, viewerUid: VIEWER, onStatus: s => statuses.push(s) });
  try {
    await controller.prepare();
    await controller.start('Cooking from an iPhone', ['pasta']);
    assert.equal((await getDoc(controller.sessionRef)).data().status, 'LIVE');
    await viewer.start();
    await until(() => hostPeers[0]?.candidates.length && viewerPeers[0]?.candidates.length);
    assert.equal(hostPeers[0].remoteDescription.sdp, 'viewer-answer');
    assert.equal(viewerPeers[0].remoteDescription.sdp, 'host-offer-1');
    assert.equal(hostPeers[0].tracks.length, 2);
    assert.equal(counts.at(-1), 1);
    assert.ok(!statuses.some(s => /could not|lost|error/i.test(s)), statuses.join('\n'));
    const outsider = env.authenticatedContext('outsider').firestore();
    await assertFails(getDoc(doc(outsider, 'liveSessions', controller.sessionRef.id, 'peers', VIEWER)));
    await viewer.stop();
    await until(() => controller.peers.size === 0);
  } finally { await viewer.stop(); await controller.stop(); }
  const ended = (await getDoc(controller.sessionRef)).data();
  assert.equal(ended.status, 'ENDED');
  assert.equal(ended.heartbeatAt, 0);
  assert.equal((await getDocs(collection(controller.sessionRef, 'peers'))).size, 0);
  assert.ok(streams[0].getTracks().every(t => t.readyState === 'ended'));
});

test('a room at its limit answers the next join with FULL, and serves a join once a place opens (audit F18)', { timeout: 30000 }, async () => {
  const LIMIT = Number(fs.readFileSync(path.join(root, 'web/js/webrtc-signaling.js'), 'utf8').match(/export const LIVE_MAX_VIEWERS = (\d+);/)[1]);
  const statuses = [], viewerStatuses = [];
  let turnedAway = 0, again = null;
  const controller = await host({ onStatus: s => statuses.push(s) });
  const peerDoc = (database, uid) => doc(database, 'liveSessions', controller.sessionRef.id, 'peers', uid);
  const LATE = 'pwa-late-viewer';
  const lateDb = env.authenticatedContext(LATE).firestore();
  const Viewer = await loadController('viewer', lateDb);
  const viewer = new Viewer({ sessionId: controller.sessionRef.id, viewerUid: LATE, onStatus: s => viewerStatuses.push(s), onFull: () => { turnedAway++; } });
  try {
    await controller.prepare(); await controller.start('A full kitchen');
    for (let seat = 0; seat < LIMIT; seat++) {
      const uid = `pwa-seat-${seat}`;
      await setDoc(peerDoc(env.authenticatedContext(uid).firestore(), uid), { viewerUid: uid, state: 'JOINING', joinedAt: Date.now(), updatedAt: Date.now() });
    }
    await until(() => hostPeers.length === LIMIT);
    await viewer.start();
    await until(() => turnedAway === 1);
    const turned = (await getDoc(peerDoc(hostDb, LATE))).data();
    assert.equal(turned.state, 'FULL');
    assert.equal(turned.offerSdp, undefined);
    assert.equal(hostPeers.length, LIMIT, 'no connection, and so no encoder, for a viewer the room has no place for');
    assert.ok(viewerStatuses.some(s => /full/i.test(s)), viewerStatuses.join('\n'));
    assert.ok(statuses.some(s => /full/i.test(s)), statuses.join('\n'));
    await viewer.stop();
    assert.equal((await getDoc(peerDoc(hostDb, LATE))).exists(), false, 'the viewer turned away leaves');

    // A viewer leaves, and the next join is served.
    await deleteDoc(peerDoc(env.authenticatedContext('pwa-seat-0').firestore(), 'pwa-seat-0'));
    await until(() => controller.peers.size === LIMIT - 1);
    again = new Viewer({ sessionId: controller.sessionRef.id, viewerUid: LATE, onFull: () => { turnedAway++; } });
    await again.start();
    await until(async () => (await getDoc(peerDoc(hostDb, LATE))).data()?.state === 'ANSWERED');
    assert.equal(turnedAway, 1);
    assert.equal(hostPeers.length, LIMIT + 1);
  } finally { await viewer.stop(); await again?.stop(); await controller.stop(); }
});

test('a viewer whose connection failed no longer holds a place in a full room (audit F18)', { timeout: 30000 }, async () => {
  const LIMIT = Number(fs.readFileSync(path.join(root, 'web/js/webrtc-signaling.js'), 'utf8').match(/export const LIVE_MAX_VIEWERS = (\d+);/)[1]);
  const controller = await host();
  const peerDoc = (database, uid) => doc(database, 'liveSessions', controller.sessionRef.id, 'peers', uid);
  const LATE = 'pwa-late-viewer';
  const Viewer = await loadController('viewer', env.authenticatedContext(LATE).firestore());
  const viewer = new Viewer({ sessionId: controller.sessionRef.id, viewerUid: LATE });
  try {
    await controller.prepare(); await controller.start('A kitchen with a bad connection');
    for (let seat = 0; seat < LIMIT; seat++) {
      const uid = `pwa-seat-${seat}`;
      await setDoc(peerDoc(env.authenticatedContext(uid).firestore(), uid), { viewerUid: uid, state: 'JOINING', joinedAt: Date.now(), updatedAt: Date.now() });
    }
    await until(() => hostPeers.length === LIMIT);
    hostPeers[2].connectionState = 'failed';
    hostPeers[2].onconnectionstatechange?.();
    await viewer.start();
    await until(async () => (await getDoc(peerDoc(hostDb, LATE))).data()?.state === 'ANSWERED');
    assert.equal(hostPeers.length, LIMIT + 1);
  } finally { await viewer.stop(); await controller.stop(); }
});

test('cancelling during STARTING acknowledgement never publishes LIVE', async () => {
  const written = deferred(), acknowledged = deferred();
  const controller = await host({}, { async setDoc(ref, data) {
    await setDoc(ref, data); written.resolve(); await acknowledged.promise;
  } });
  await controller.prepare();
  const started = controller.start('Cancel starting');
  await written.promise;
  const stopped = controller.stop();
  assert.ok(streams[0].getTracks().every(t => t.readyState === 'ended'));
  assert.equal((await getDoc(controller.sessionRef)).data().status, 'STARTING');
  acknowledged.resolve();
  await Promise.all([started, stopped]);
  assert.equal((await getDoc(controller.sessionRef)).data().status, 'ENDED');
});

test('cancelling while LIVE publication is acknowledged finishes with ENDED', async () => {
  const published = deferred(), acknowledged = deferred();
  const controller = await host({}, { async runTransaction(...args) {
    const result = await sdk.runTransaction(...args); published.resolve(); await acknowledged.promise; return result;
  } });
  await controller.prepare();
  const started = controller.start('Cancel publishing');
  await published.promise;
  const stopped = controller.stop();
  assert.ok(streams[0].getTracks().every(t => t.readyState === 'ended'));
  acknowledged.resolve();
  await Promise.all([started, stopped]);
  assert.equal((await getDoc(controller.sessionRef)).data().status, 'ENDED');
});

test('a renamed profile rejects stale hostName and stops capture without a public room', async () => {
  const controller = await host({ hostName: 'Old Name' });
  await controller.prepare();
  await assert.rejects(controller.start('Name mismatch'));
  assert.equal(controller.phase, 'stopped');
  assert.ok(streams[0].getTracks().every(t => t.readyState === 'ended'));
  assert.equal((await getDocs(collection(hostDb, 'liveSessions'))).size, 0);
});

test('a delayed offer cannot overwrite a viewer replacement join', async () => {
  const released = deferred();
  class DelayedRtc extends HostRtc {
    async createOffer() { if (this.id === 1) await released.promise; return super.createOffer(); }
  }
  const controller = await host({ PeerConnection: DelayedRtc });
  try {
    await controller.prepare(); await controller.start('Rejoin test');
    const firstJoined = Date.now();
    const peerRef = await join(controller.sessionRef, firstJoined);
    await until(() => hostPeers.length === 1);
    await deleteDoc(peerRef);
    await join(controller.sessionRef, firstJoined + 1);
    await until(async () => (await getDoc(doc(hostDb, 'liveSessions', controller.sessionRef.id, 'peers', VIEWER))).data()?.offerSdp === 'host-offer-2');
    released.resolve();
    await new Promise(resolve => setImmediate(resolve));
    const latest = (await getDoc(doc(hostDb, 'liveSessions', controller.sessionRef.id, 'peers', VIEWER))).data();
    assert.equal(latest.offerSdp, 'host-offer-2');
    assert.equal(latest.joinedAt, firstJoined + 1);
    assert.equal(hostPeers[0].closed, true);
  } finally { released.resolve(); await controller.stop(); }
});

test('heartbeat loss ends capture before the room lease expires', async () => {
  let now = Date.now();
  const timers = new Map();
  class Clock extends Date { static now() { return now; } }
  const controller = await host({}, {}, { Date: Clock, setInterval: (fn, ms) => { timers.set(ms, fn); return ms; }, clearInterval: id => timers.delete(id) });
  try {
    await controller.prepare(); await controller.start('Lease test');
    assert.ok(timers.has(10000));
    now += 10000;
    timers.get(10000)();
    await until(() => !controller.heartbeatPending);
    assert.equal((await getDoc(controller.sessionRef)).data().heartbeatAt, now);
    now += 26000;
    timers.get(1000)();
    assert.equal(controller.phase, 'stopped');
    assert.equal(timers.size, 0);
    assert.ok(streams[0].getTracks().every(t => t.readyState === 'ended'));
    await controller.stop();
    assert.equal((await getDoc(controller.sessionRef)).data().status, 'ENDED');
  } finally { await controller.stop(); }
});


test('the host account can watch from another device and host shutdown clears active peer data', { timeout: 20000 }, async () => {
  const controller = await host();
  const Viewer = await loadController('viewer', hostDb);
  const viewer = new Viewer({ sessionId: controller.sessionRef.id, viewerUid: HOST });
  try {
    await controller.prepare(); await controller.start('Same-account second device');
    await viewer.start();
    await until(() => hostPeers[0]?.candidates.length && viewerPeers[0]?.candidates.length);
    assert.equal(hostPeers[0].remoteDescription.sdp, 'viewer-answer');
    await controller.stop();
    assert.equal((await getDocs(collection(controller.sessionRef, 'peers'))).size, 0);
    for (const side of ['hostCandidates', 'viewerCandidates']) {
      assert.equal((await getDocs(collection(controller.sessionRef, 'peers', HOST, side))).size, 0);
    }
    assert.equal((await getDoc(controller.sessionRef)).data().status, 'ENDED');
  } finally { await viewer.stop(); await controller.stop(); }
});

test('ending the room from another host device shuts down this camera too', async () => {
  const controller = await host();
  try {
    await controller.prepare(); await controller.start('Remote end');
    await updateDoc(controller.sessionRef, { status: 'ENDED', heartbeatAt: 0, endedAt: Date.now() });
    await until(() => controller.phase === 'stopped');
    assert.ok(streams[0].getTracks().every(t => t.readyState === 'ended'));
    await controller.stop();
  } finally { await controller.stop(); }
});
