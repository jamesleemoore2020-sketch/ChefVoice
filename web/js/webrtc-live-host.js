import { collection, db, doc, getDocs, onSnapshot, runTransaction, setDoc, updateDoc, writeBatch } from './firebase-client.js';
import { LIVE_ICE_SERVERS, candidateFromDoc, candidateToDoc, iceCandidateDocumentId } from './webrtc-signaling.js';

export function cameraErrorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Allow camera and microphone access for ChefVoice, then try again.';
  if (error?.name === 'NotFoundError') return 'No camera and microphone were found. Connect them or try another device.';
  if (error?.name === 'NotReadableError') return 'The camera or microphone is busy. Close other apps using it, then try again.';
  return error?.message || 'Could not open the camera and microphone.';
}

/** Browser host for the same session/peer/ICE protocol as Android. The local
 * preview never creates a public session. Publishing starts only on Go Live;
 * stopping cuts media immediately, even while a Firestore write is pending. */
export class LiveHostController {
  constructor({ hostUid, hostName, onStatus = () => {}, onStream = () => {}, onSession = () => {}, onViewerCount = () => {}, onStopped = () => {}, onEndError = () => {}, mediaDevices = globalThis.navigator?.mediaDevices, PeerConnection = globalThis.RTCPeerConnection } = {}) {
    this.hostUid = hostUid;
    this.hostName = String(hostName || '').trim();
    this.onStatus = onStatus;
    this.onStream = onStream;
    this.onSession = onSession;
    this.onViewerCount = onViewerCount;
    this.onStopped = onStopped;
    this.onEndError = onEndError;
    this.mediaDevices = mediaDevices;
    this.PeerConnection = PeerConnection;
    this.sessionRef = doc(collection(db, 'liveSessions'));
    this.phase = 'idle';
    this.stream = null;
    this.mediaGeneration = 0;
    this.muted = false;
    this.peers = new Map();
    this.sessionCreated = false;
    this.publishPromise = null;
    this.stopPromise = null;
  }

  async prepare(facingMode = 'environment') {
    if (!['idle', 'preview'].includes(this.phase)) return false;
    if (!this.mediaDevices?.getUserMedia || !this.PeerConnection) throw new Error('Live needs camera and microphone support. Open ChefVoice in Safari or another supported browser over HTTPS.');
    const generation = ++this.mediaGeneration;
    this.#releaseMedia();
    this.phase = 'opening';
    this.onStatus('Opening camera and microphone…');
    try {
      const stream = await this.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      // Permission prompts can resolve after Cancel/Back or after the page hides.
      if (this.phase === 'stopped' || generation !== this.mediaGeneration) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      this.stream = stream;
      if (!stream.getVideoTracks().length || !stream.getAudioTracks().length) throw new Error('Both a camera and microphone are needed to go live.');
      for (const track of stream.getTracks()) track.addEventListener('ended', () => {
        if (this.stream === stream && this.phase !== 'stopped') void this.stop('Camera or microphone disconnected. Live ended.');
      });
      this.setMuted(this.muted);
      this.phase = 'preview';
      this.onStream(stream);
      this.onStatus('Preview only — tap Go Live when you are ready.');
      return true;
    } catch (error) {
      if (this.phase === 'stopped' || generation !== this.mediaGeneration) return false;
      this.#releaseMedia();
      this.phase = 'idle';
      throw new Error(cameraErrorMessage(error));
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !this.muted; });
  }

  async start(title, tags = []) {
    if (this.phase !== 'preview') throw new Error('Open the camera preview before going live.');
    const cleanTitle = String(title || '').trim().slice(0, 120);
    if (!cleanTitle) throw new Error('Give your Live a title.');
    if (!this.hostUid || !this.hostName) throw new Error('Sign in and save your chef name in Profile before going live.');
    if (this.stream.getTracks().some(track => track.readyState !== 'live')) throw new Error('The camera or microphone stopped. Open the preview again.');
    this.phase = 'starting';
    this.onStatus('Starting your Live…');
    const now = Date.now();
    const session = {
      hostId: this.hostUid, hostName: this.hostName, title: cleanTitle,
      status: 'STARTING', startedAt: now, heartbeatAt: now, endedAt: 0,
      heartCount: 0, fireCount: 0, clapCount: 0,
      tags: tags.map(String).slice(0, 8)
    };
    this.publishPromise = (async () => {
      await setDoc(this.sessionRef, session);
      this.sessionCreated = true;
      if (this.phase === 'stopped') return;
      // Authorize the host listener before advertising the room as LIVE.
      await this.#listenForViewers();
      if (this.phase === 'stopped') return;
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(this.sessionRef);
        if (this.phase === 'stopped') return;
        if (!snapshot.exists() || snapshot.data().status !== 'STARTING') throw new Error('This Live is no longer available. Start a new one.');
        transaction.update(this.sessionRef, { status: 'LIVE', heartbeatAt: Date.now() });
      });
      if (this.phase === 'stopped') return;
      this.phase = 'live';
      this.lastHeartbeatAck = Date.now();
      this.onSession({ ...session, id: this.sessionRef.id, status: 'LIVE' });
      this.onStatus('You are live. Waiting for viewers…');
      this.unsubSession = onSnapshot(this.sessionRef, snapshot => {
        if (this.phase !== 'live') return;
        if (!snapshot.exists() || snapshot.data().status === 'ENDED') {
          void this.stop('This Live has ended.');
        } else this.onSession({ ...snapshot.data(), id: this.sessionRef.id });
      }, error => { void this.stop(`Live connection lost: ${error?.message || 'Please try again.'}`); });
      this.heartbeatTimer = setInterval(() => this.#heartbeat(), 10000);
      this.leaseTimer = setInterval(() => {
        if (this.phase === 'live' && Date.now() - this.lastHeartbeatAck > 25000) void this.stop('Connection lost. Camera and microphone are off. Start a new Live when you reconnect.');
      }, 1000);
    })();
    try { await this.publishPromise; }
    catch (error) {
      if (this.phase !== 'stopped') await this.stop(`Could not start Live: ${error?.message || 'Please try again.'}`);
      throw error;
    }
  }

  #listenForViewers() {
    return new Promise((resolve, reject) => {
      this.cancelListenerReady = resolve;
      this.unsubPeers = onSnapshot(collection(this.sessionRef, 'peers'), { includeMetadataChanges: true }, snapshot => {
        if (this.phase === 'stopped') return;
        for (const change of snapshot.docChanges()) {
          const id = change.doc.id, data = change.doc.data();
          if (change.type === 'removed') { this.#dropPeer(id); continue; }
          if (data.viewerUid !== id) continue;
          let peer = this.peers.get(id);
          if (peer && peer.joinedAt !== data.joinedAt) { this.#dropPeer(id); peer = null; }
          if (!peer && data.state === 'JOINING') peer = this.#createPeer(id, data);
          if (peer && data.state === 'ANSWERED' && data.answerSdp && !peer.answerApplied) void this.#acceptAnswer(peer, data.answerSdp);
        }
        if (!snapshot.metadata.fromCache) { this.cancelListenerReady = null; resolve(); }
      }, error => {
        reject(error);
        if (this.phase === 'live') void this.stop(`Live signaling stopped: ${error?.message || 'Please try again.'}`);
      });
    });
  }

  #isCurrent(peer) { return this.phase !== 'stopped' && this.peers.get(peer.id) === peer; }

  #createPeer(id, data) {
    let pc;
    try { pc = new this.PeerConnection({ iceServers: LIVE_ICE_SERVERS }); }
    catch { this.onStatus('A viewer could not connect. Ask them to rejoin.'); return null; }
    const peer = { id, ref: doc(this.sessionRef, 'peers', id), joinedAt: data.joinedAt, pc, sequence: 0, pending: [], outgoing: [], seen: new Set(), writes: Promise.resolve(), offered: false, answerApplied: false, remoteReady: false };
    this.peers.set(id, peer);
    try {
      this.stream.getTracks().forEach(track => pc.addTrack(track, this.stream));
      pc.onicecandidate = event => {
        if (!event.candidate || !this.#isCurrent(peer)) return;
        if (peer.offered) this.#sendCandidate(peer, event.candidate);
        else peer.outgoing.push(event.candidate);
      };
      pc.onconnectionstatechange = () => {
        if (!this.#isCurrent(peer)) return;
        this.#viewerCount();
        if (pc.connectionState === 'failed') this.onStatus('A viewer could not connect on this network. They can try another connection and rejoin.');
      };
      peer.unsubCandidates = onSnapshot(collection(peer.ref, 'viewerCandidates'), snapshot => {
        if (!this.#isCurrent(peer)) return;
        for (const change of snapshot.docChanges()) {
          if (change.type === 'removed' || peer.seen.has(change.doc.id)) continue;
          peer.seen.add(change.doc.id);
          const candidate = candidateFromDoc(change.doc.data());
          if (!candidate) continue;
          if (peer.remoteReady) void pc.addIceCandidate(candidate).catch(() => {});
          else peer.pending.push(candidate);
        }
      }, () => { if (this.#isCurrent(peer)) this.onStatus('A viewer lost their connection. Ask them to rejoin.'); });
      void this.#offer(peer);
      return peer;
    } catch {
      this.#dropPeer(id);
      this.onStatus('A viewer could not connect. Ask them to rejoin.');
      return null;
    }
  }

  async #offer(peer) {
    try {
      const offer = await peer.pc.createOffer();
      if (!this.#isCurrent(peer)) return;
      await peer.pc.setLocalDescription(offer);
      if (!this.#isCurrent(peer)) return;
      peer.offerSdp = peer.pc.localDescription?.sdp || offer.sdp;
      // A fast leave/rejoin reuses the viewer's uid path. Never write an old
      // offer into the replacement join, even when the old request was in flight.
      const sent = await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(peer.ref);
        if (!this.#isCurrent(peer) || !snapshot.exists() || snapshot.data().joinedAt !== peer.joinedAt || snapshot.data().state !== 'JOINING') return false;
        transaction.update(peer.ref, { hostUid: this.hostUid, offerSdp: peer.offerSdp, state: 'OFFERED', updatedAt: Date.now() });
        return true;
      });
      if (!sent || !this.#isCurrent(peer)) return;
      peer.offered = true;
      for (const candidate of peer.outgoing) this.#sendCandidate(peer, candidate);
      peer.outgoing = [];
    } catch (error) {
      if (this.#isCurrent(peer)) this.onStatus(`Could not connect a viewer: ${error?.message || 'Ask them to rejoin.'}`);
    }
  }

  async #acceptAnswer(peer, sdp) {
    peer.answerApplied = true;
    try {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp });
      if (!this.#isCurrent(peer)) return;
      peer.remoteReady = true;
      for (const candidate of peer.pending) void peer.pc.addIceCandidate(candidate).catch(() => {});
      peer.pending = [];
    } catch { if (this.#isCurrent(peer)) this.onStatus('Could not accept a viewer connection. Ask them to rejoin.'); }
  }

  #sendCandidate(peer, candidate) {
    const id = iceCandidateDocumentId(peer.sequence++);
    if (!id) return;
    peer.writes = peer.writes.then(() => runTransaction(db, async transaction => {
      const snapshot = await transaction.get(peer.ref);
      if (!this.#isCurrent(peer) || !snapshot.exists() || snapshot.data().joinedAt !== peer.joinedAt || snapshot.data().offerSdp !== peer.offerSdp) return;
      transaction.set(doc(peer.ref, 'hostCandidates', id), candidateToDoc(candidate));
    })).catch(() => { if (this.#isCurrent(peer)) this.onStatus('Could not send connection details to a viewer. Ask them to rejoin.'); });
  }

  #dropPeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.unsubCandidates?.();
    peer.pc.close();
    this.#viewerCount();
  }

  #viewerCount() { this.onViewerCount([...this.peers.values()].filter(peer => peer.pc.connectionState === 'connected').length); }

  #heartbeat() {
    if (this.phase !== 'live' || this.heartbeatPending) return;
    this.heartbeatPending = true;
    updateDoc(this.sessionRef, { heartbeatAt: Date.now() }).then(() => {
      if (this.phase === 'live') this.lastHeartbeatAck = Date.now();
    }).catch(() => { if (this.phase === 'live') void this.stop('Live connection lost. Camera and microphone are off.'); })
      .finally(() => { this.heartbeatPending = false; });
  }

  #releaseMedia() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.onStream(null);
  }

  stop(message = 'Live ended. Camera and microphone are off.') {
    if (this.phase === 'stopped') return this.stopPromise || Promise.resolve();
    this.phase = 'stopped';
    ++this.mediaGeneration;
    clearInterval(this.heartbeatTimer);
    clearInterval(this.leaseTimer);
    this.cancelListenerReady?.();
    this.cancelListenerReady = null;
    this.unsubPeers?.();
    this.unsubSession?.();
    for (const id of this.peers.keys()) this.#dropPeer(id);
    this.#releaseMedia();
    this.stopPromise = (async () => {
      // An eventual STARTING/LIVE write must finish before ENDED is written.
      try { await this.publishPromise; } catch {}
      if (!this.sessionCreated) return;
      try {
        await updateDoc(this.sessionRef, { status: 'ENDED', endedAt: Date.now(), heartbeatAt: 0 });
        const peers = await getDocs(collection(this.sessionRef, 'peers'));
        for (const peer of peers.docs) {
          const sides = await Promise.all(['hostCandidates', 'viewerCandidates'].map(side => getDocs(collection(peer.ref, side))));
          const batch = writeBatch(db);
          sides.forEach(side => side.docs.forEach(candidate => batch.delete(candidate.ref)));
          batch.delete(peer.ref);
          await batch.commit();
        }
      } catch { this.onEndError('Camera and microphone are off. The room may remain listed briefly while its connection expires.'); }
    })();
    this.onStopped(message);
    return this.stopPromise;
  }
}
