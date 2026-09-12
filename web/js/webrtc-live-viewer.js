import { collection, db, deleteDoc, doc, getDocs, onSnapshot, setDoc, updateDoc, writeBatch } from './firebase-client.js';
import { LIVE_ICE_SERVERS, candidateFromDoc, candidateToDoc, iceCandidateDocumentId } from './webrtc-signaling.js';

/**
 * Browser-side viewer for ChefVoice Live. Implements the *existing* viewer role
 * of the signaling contract the Android host already speaks (WebRtcLiveTransport.kt
 * + the liveSessions/{id}/peers/{peerId} rules in firestore.rules) -- nothing
 * about that contract changes here, only who is allowed to be the "peerId" browser
 * tab. The peer document id is always the viewer's own Firebase Auth uid; the
 * rules require that (peerId == request.auth.uid), the same way Android's
 * WebRtcViewerController hard-codes `peerId = viewerUid`.
 *
 * There is no native library involved on this side: RTCPeerConnection and
 * getUserMedia are built into the browser engine. That matters because Android's
 * Live has had two native-library crashes this cycle (SIGTRAP/SIGABRT inside
 * libjingle_peerconnection_so.so's JNI_OnLoad, from the io.github.webrtc-sdk:android
 * AAR -- see LIVE_WEBRTC_CRASH_FIXED_0.11.3.md). That crash class cannot occur
 * here: there is no JNI, no bundled .so, and no org.webrtc.* code path in a browser
 * client, so it has no bearing on this file.
 */
export class LiveViewerController {
  constructor({ sessionId, viewerUid, onStatus = () => {}, onTrack = () => {} } = {}) {
    this.sessionId = sessionId;
    this.viewerUid = viewerUid;
    this.onStatus = onStatus;
    this.onTrack = onTrack;

    this.peerRef = doc(db, 'liveSessions', sessionId, 'peers', viewerUid);
    this.pc = null;
    this.started = false;
    this.unsubPeerDoc = null;
    this.unsubHostCandidates = null;
    this.pendingCandidates = [];
    this.seenCandidateDocs = new Set();
    this.remoteDescriptionSet = false;
    this.offerApplied = false;
    this.candidateSequence = 0;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.status('Joining live video…');

    // Best-effort: clear a peer doc left over from an earlier watch of this same
    // Live that did not end cleanly (closed tab, backgrounded Safari evicted the
    // page). Without this, rejoining would ask Firestore to "create" a document
    // that already exists -- rules see that as an update, and the update rules
    // only allow OFFERED -> ANSWERED, never a reset back to JOINING. A missing
    // doc makes this delete fail permission-denied, which is expected and ignored.
    try { await deleteDoc(this.peerRef); } catch {}

    this.pc = new RTCPeerConnection({ iceServers: LIVE_ICE_SERVERS });
    this.pc.onicecandidate = (event) => {
      if (event.candidate) this.#sendViewerCandidate(event.candidate);
    };
    this.pc.ontrack = (event) => {
      this.onTrack(event.streams[0] || new MediaStream([event.track]));
    };
    this.pc.onconnectionstatechange = () => {
      switch (this.pc?.connectionState) {
        case 'connecting': this.status('Connecting live video…'); break;
        case 'connected': this.status('Watching LIVE video'); break;
        case 'disconnected': this.status('Live video connection interrupted…'); break;
        case 'failed': this.status('Live video failed to connect. This network may require a TURN relay.'); break;
        case 'closed': this.status('Live video closed'); break;
      }
    };

    this.unsubPeerDoc = onSnapshot(this.peerRef,
      (snapshot) => this.#onPeerDocChange(snapshot),
      (error) => this.status(`Live signaling error: ${error?.message || 'unknown error'}`));

    this.unsubHostCandidates = onSnapshot(collection(this.peerRef, 'hostCandidates'),
      (snapshot) => this.#onHostCandidates(snapshot));

    try {
      await setDoc(this.peerRef, {
        viewerUid: this.viewerUid, state: 'JOINING', joinedAt: Date.now(), updatedAt: Date.now()
      });
    } catch (e) {
      this.status(`Could not join live signaling: ${e?.message || 'Firestore write failed'}`);
    }
  }

  async #onPeerDocChange(snapshot) {
    const offer = snapshot.data()?.offerSdp;
    if (!offer || this.offerApplied || !this.pc) return;
    this.offerApplied = true;
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: offer });
      this.remoteDescriptionSet = true;
      this.#flushCandidates();
      await this.#createAnswer();
    } catch (e) {
      this.status(`Could not accept host stream: ${e?.message || e}`);
    }
  }

  async #createAnswer() {
    try {
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      // A partial update, not a full set(): the rule requires viewerUid, hostUid,
      // offerSdp and joinedAt to come out unchanged, and only these three keys are
      // allowed to actually change (validLivePeerViewerUpdate's diff().affectedKeys()).
      await updateDoc(this.peerRef, { answerSdp: answer.sdp, state: 'ANSWERED', updatedAt: Date.now() });
    } catch (e) {
      this.status(`Could not answer live stream: ${e?.message || e}`);
    }
  }

  #onHostCandidates(snapshot) {
    for (const change of snapshot.docChanges()) {
      if (change.type === 'removed' || this.seenCandidateDocs.has(change.doc.id)) continue;
      this.seenCandidateDocs.add(change.doc.id);
      const candidate = candidateFromDoc(change.doc.data());
      if (!candidate) continue;
      if (this.remoteDescriptionSet) this.pc.addIceCandidate(candidate).catch(() => {});
      else this.pendingCandidates.push(candidate);
    }
  }

  #flushCandidates() {
    for (const candidate of this.pendingCandidates) this.pc.addIceCandidate(candidate).catch(() => {});
    this.pendingCandidates = [];
  }

  #sendViewerCandidate(candidate) {
    const candidateId = iceCandidateDocumentId(this.candidateSequence++);
    if (!candidateId) { this.status('Live ICE candidate limit reached for this connection.'); return; }
    setDoc(doc(this.peerRef, 'viewerCandidates', candidateId), candidateToDoc(candidate)).catch(() => {});
  }

  status(message) {
    this.onStatus(message);
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    try { this.unsubPeerDoc?.(); } catch {}
    try { this.unsubHostCandidates?.(); } catch {}
    this.unsubPeerDoc = null;
    this.unsubHostCandidates = null;
    try { this.pc?.close(); } catch {}
    this.pc = null;
    await this.#cleanupSignaling();
  }

  async #cleanupSignaling() {
    try {
      const [hostCandidates, viewerCandidates] = await Promise.all([
        getDocs(collection(this.peerRef, 'hostCandidates')),
        getDocs(collection(this.peerRef, 'viewerCandidates'))
      ]);
      const batch = writeBatch(db);
      hostCandidates.docs.forEach((d) => batch.delete(d.ref));
      viewerCandidates.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(this.peerRef);
      await batch.commit();
    } catch {
      try { await deleteDoc(this.peerRef); } catch {}
    }
  }
}
