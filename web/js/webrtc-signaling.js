// Pure helpers for the ChefVoice Live signaling contract. No Firebase or WebRTC
// globals here on purpose -- this is the part of the viewer that can be unit
// tested with plain node --test, mirroring the constants and logic in the
// Android host's WebRtcLiveTransport.kt and FirebaseSocialRepository.kt exactly
// so the two platforms never drift onto different freshness windows or ICE
// candidate limits. firestore.rules is the actual enforcement point; this file
// only has to agree with it, never redefine it.

export const MAX_ICE_CANDIDATES_PER_SIDE = 64;
// Matches FirebaseSocialRepository's client-side "is this still worth showing"
// freshness gate, distinct from firestore.rules' own 60s-back/30s-forward
// activeLiveSession() write-time window -- the two serve different purposes and
// are not meant to be the same number.
export const LIVE_LEASE_TIMEOUT_MS = 35000;
export const LIVE_LEGACY_GRACE_MS = 90000;
export const LIVE_LEASE_REFRESH_MS = 5000;

export const LIVE_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

/** Mirrors iceCandidateDocumentId(): "c000".."c063", or null once a side's 64-candidate budget is spent. */
export function iceCandidateDocumentId(sequence) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence >= MAX_ICE_CANDIDATES_PER_SIDE) return null;
  return 'c' + String(sequence).padStart(3, '0');
}

/**
 * Shapes a browser RTCIceCandidate for Firestore. Field names and the
 * always-a-string sdpMid match validIceCandidate() in firestore.rules and
 * Android's candidateMap() -- an RTCIceCandidate's own "candidate" property
 * (the SDP a-line) is what Android calls "sdp".
 */
export function candidateToDoc(candidate) {
  return {
    sdpMid: candidate?.sdpMid || '',
    sdpMLineIndex: Number.isInteger(candidate?.sdpMLineIndex) ? candidate.sdpMLineIndex : 0,
    candidate: candidate?.candidate || '',
    createdAt: Date.now()
  };
}

/** Inverse of candidateToDoc(): a plain RTCIceCandidateInit, or null if the stored doc is unusable. */
export function candidateFromDoc(data) {
  const candidate = data?.candidate;
  const sdpMLineIndex = data?.sdpMLineIndex;
  if (typeof candidate !== 'string' || !candidate) return null;
  if (!Number.isInteger(sdpMLineIndex)) return null;
  const sdpMid = typeof data?.sdpMid === 'string' && data.sdpMid ? data.sdpMid : null;
  return { sdpMid, sdpMLineIndex, candidate };
}

/** Mirrors LiveSession.isFreshLive(): still worth listing/watching right now? */
export function isFreshLiveSession(session, now = Date.now()) {
  if (!session || session.status !== 'LIVE') return false;
  if (session.heartbeatAt > 0) return Math.max(0, now - session.heartbeatAt) <= LIVE_LEASE_TIMEOUT_MS;
  return session.startedAt > 0 && Math.max(0, now - session.startedAt) <= LIVE_LEGACY_GRACE_MS;
}
