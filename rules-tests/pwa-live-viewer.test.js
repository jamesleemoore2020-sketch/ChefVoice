// Runs the actual browser controller against the Firestore emulator. Only the
// WebRTC media engine is fake; authorization and all signaling I/O are real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const firestore = require('firebase/firestore');
const { doc, collection, setDoc, updateDoc, getDoc, getDocs, onSnapshot } = firestore;

const HOST = 'host-live-test';
const VIEWER = 'viewer-live-test';
const SESSION = 'pwa-join-test';
const peerPath = ['liveSessions', SESSION, 'peers', VIEWER];
const root = path.resolve(__dirname, '..');
const candidate = { sdpMid: '0', sdpMLineIndex: 0, candidate: 'candidate:1 1 UDP 1 192.0.2.1 5000 typ host' };
let env;
let hostDb;
let viewerDb;
let media;
let receivedHostCandidate;
let originalRtc;

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function nextSnapshot(ref, predicate) {
  let unsub;
  let timer;
  const promise = new Promise((resolve, reject) => {
    timer = setTimeout(() => { unsub?.(); reject(new Error(`Timed out: ${ref.path}`)); }, 8000);
    unsub = onSnapshot(ref, snapshot => {
      if (predicate(snapshot)) { clearTimeout(timer); unsub(); resolve(snapshot); }
    }, error => { clearTimeout(timer); reject(error); });
  });
  return { promise, cancel() { clearTimeout(timer); unsub?.(); } };
}

async function controllerClass(overrides = {}) {
  // Link the production ESM without fetching the browser Firebase SDK from a
  // CDN. SyntheticModule supplies the real authenticated emulator SDK instead.
  const exports = { ...firestore, db: viewerDb, ...overrides };
  const sdk = new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  });
  const helpers = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'web/js/webrtc-signaling.js'), 'utf8'));
  const viewer = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'web/js/webrtc-live-viewer.js'), 'utf8'));
  await viewer.link(specifier => {
    if (specifier === './firebase-client.js') return sdk;
    if (specifier === './webrtc-signaling.js') return helpers;
    throw new Error(`Unexpected import: ${specifier}`);
  });
  await viewer.evaluate();
  return viewer.namespace.LiveViewerController;
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'chefvoice-pwa-live-test',
    firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') }
  });
  originalRtc = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = class {
    constructor() { this.candidates = []; this.closed = false; media.push(this); }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async createAnswer() { return { type: 'answer', sdp: 'test-viewer-answer' }; }
    async setLocalDescription(description) {
      this.localDescription = description;
      this.onicecandidate?.({ candidate });
    }
    async addIceCandidate(value) { this.candidates.push(value); receivedHostCandidate.resolve(); }
    close() { this.closed = true; }
  };
});

test.after(async () => {
  if (originalRtc === undefined) delete globalThis.RTCPeerConnection;
  else globalThis.RTCPeerConnection = originalRtc;
  await env?.cleanup();
});

test.beforeEach(async () => {
  media = [];
  receivedHostCandidate = deferred();
  await env.clearFirestore();
  hostDb = env.authenticatedContext(HOST).firestore();
  viewerDb = env.authenticatedContext(VIEWER).firestore();
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'liveSessions', SESSION), {
      hostId: HOST, hostName: 'Host', title: 'Test Live', status: 'LIVE',
      startedAt: Date.now(), heartbeatAt: Date.now(), endedAt: 0,
      heartCount: 0, fireCount: 0, clapCount: 0
    });
  });
});

test('a viewer listener on a missing join document is denied by the real rules', async () => {
  const listener = nextSnapshot(doc(viewerDb, ...peerPath), snapshot => !snapshot.metadata.fromCache);
  try { await assert.rejects(listener.promise, { code: 'permission-denied' }); }
  finally { listener.cancel(); }
});

test('viewer waits for join acknowledgement, then receives an early offer and exchanges ICE', { timeout: 15000 }, async () => {
  const enteredWrite = deferred();
  const allowWrite = deferred();
  const statuses = [];
  let subscriptions = 0;
  const Controller = await controllerClass({
    async setDoc(ref, data) {
      if (ref.path === peerPath.join('/')) {
        enteredWrite.resolve();
        await allowWrite.promise;
        await setDoc(ref, data);
        // The host may reply before the viewer attaches either listener.
        await updateDoc(doc(hostDb, ...peerPath), {
          hostUid: HOST, offerSdp: 'test-host-offer', state: 'OFFERED', updatedAt: Date.now()
        });
        await setDoc(doc(hostDb, ...peerPath, 'hostCandidates', 'c000'), { ...candidate, createdAt: Date.now() });
      } else await setDoc(ref, data);
    },
    onSnapshot(...args) { subscriptions++; return onSnapshot(...args); }
  });
  const controller = new Controller({ sessionId: SESSION, viewerUid: VIEWER, onStatus: s => statuses.push(s) });
  const answer = nextSnapshot(doc(hostDb, ...peerPath), s => s.data()?.state === 'ANSWERED');
  const ice = nextSnapshot(doc(hostDb, ...peerPath, 'viewerCandidates', 'c000'), s => s.exists());
  const started = controller.start();
  try {
    await enteredWrite.promise;
    assert.equal(subscriptions, 0, 'must not subscribe while the join write is pending');
    allowWrite.resolve();
    await started;
    await Promise.all([answer.promise, ice.promise, receivedHostCandidate.promise]);
    assert.equal(subscriptions, 2);
    assert.equal(media[0].remoteDescription.sdp, 'test-host-offer');
    assert.equal(media[0].localDescription.sdp, 'test-viewer-answer');
    assert.equal(media[0].candidates[0]?.candidate, candidate.candidate);
    assert.ok(!statuses.some(s => /error|could not/i.test(s)), statuses.join('\n'));
    const outsider = env.authenticatedContext('unrelated-viewer').firestore();
    await assertFails(getDoc(doc(outsider, ...peerPath)));
    await assertFails(getDocs(collection(outsider, ...peerPath, 'hostCandidates')));
  } finally {
    allowWrite.resolve();
    answer.cancel(); ice.cancel();
    await started;
    await controller.stop();
  }
});

test('leaving while the join write is pending does not attach listeners or leave a peer behind', async () => {
  const enteredWrite = deferred();
  const allowWrite = deferred();
  let subscriptions = 0;
  const Controller = await controllerClass({
    async setDoc(ref, data) { enteredWrite.resolve(); await allowWrite.promise; await setDoc(ref, data); },
    onSnapshot(...args) { subscriptions++; return onSnapshot(...args); }
  });
  const controller = new Controller({ sessionId: SESSION, viewerUid: VIEWER });
  const started = controller.start();
  await enteredWrite.promise;
  const stopped = controller.stop();
  allowWrite.resolve();
  await Promise.all([started, stopped]);
  assert.equal(subscriptions, 0);
  assert.ok(media.every(pc => pc.closed));
  assert.equal((await getDoc(doc(hostDb, ...peerPath))).exists(), false);
});

test('rejoining clears abandoned ICE documents before reusing candidate IDs', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, ...peerPath), { viewerUid: VIEWER, state: 'JOINING', joinedAt: Date.now(), updatedAt: Date.now() });
    for (const side of ['hostCandidates', 'viewerCandidates']) {
      await setDoc(doc(db, ...peerPath, side, 'c000'), { ...candidate, candidate: 'old-candidate', createdAt: Date.now() });
    }
  });
  const Controller = await controllerClass();
  const controller = new Controller({ sessionId: SESSION, viewerUid: VIEWER });
  try {
    await controller.start();
    for (const side of ['hostCandidates', 'viewerCandidates']) {
      assert.equal((await getDocs(collection(hostDb, ...peerPath, side))).size, 0);
    }
    await setDoc(doc(viewerDb, ...peerPath, 'viewerCandidates', 'c000'), { ...candidate, createdAt: Date.now() });
  } finally { await controller.stop(); }
});

test('a denied join reports the error without starting listeners or retaining the media engine', async () => {
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'liveSessions', SESSION), { status: 'ENDED' }));
  let subscriptions = 0;
  const statuses = [];
  const Controller = await controllerClass({ onSnapshot(...args) { subscriptions++; return onSnapshot(...args); } });
  const controller = new Controller({ sessionId: SESSION, viewerUid: VIEWER, onStatus: s => statuses.push(s) });
  try {
    await controller.start();
    assert.equal(subscriptions, 0);
    assert.ok(media.every(pc => pc.closed));
    assert.ok(statuses.some(s => /Could not join live signaling/.test(s)), statuses.join('\n'));
  } finally { await controller.stop(); }
});
