"use strict";

const { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("node:crypto");
const { getFirestore, FieldPath } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();
const REGION = "us-central1";
const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const NOTIFICATION_PRUNE_BATCH = 50;
const STORAGE_BUCKET = "chefvoice-d7fec.firebasestorage.app";
const FANOUT_PAGE_SIZE = 200;
const FANOUT_CONCURRENCY = 40;
const DELETE_BATCH_SIZE = 200;
const STORAGE_PERMIT_TTL_MS = 90 * 1000;
const STORAGE_DAILY_BYTES = 2 * 1024 * 1024 * 1024;
const STORAGE_MONTHLY_BYTES = 20 * 1024 * 1024 * 1024;
const STORAGE_DAILY_OPERATIONS = 120;
const STORAGE_MONTHLY_OPERATIONS = 1200;

// Moderation state lives in top-level collections. The previous layout used
// "moderation/userRestrictions/{uid}" (three segments) and "moderation/events"
// (two segments); neither is a legal Firestore reference, so every call that
// touched them threw before reaching the network. Document paths need an even
// number of segments and collection paths an odd number.
const RESTRICTIONS_COLLECTION = "userRestrictions";
const MODERATION_EVENTS_COLLECTION = "moderationEvents";

function restrictionPath(uid) {
  return `${RESTRICTIONS_COLLECTION}/${uid}`;
}

function cleanText(value, max = 160) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

async function trustedActorName(uid) {
  if (!uid) return "Chef";
  const snap = await db.doc(`users/${uid}`).get();
  return cleanText(snap.exists ? snap.data()?.displayName : "", 120) || "Chef";
}

async function syncFollowerCount(uid) {
  if (!uid) return 0;
  const userRef = db.doc(`users/${uid}`);
  const user = await userRef.get();
  // Never recreate a root user document from a delayed follower trigger after
  // account deletion. Root profile creation belongs to the authenticated client.
  if (!user.exists) return 0;
  const aggregate = await userRef.collection("followers").count().get();
  const count = Math.max(0, Number(aggregate.data().count || 0));
  try { await userRef.update({ followerCount: count }); }
  catch (error) {
    if (String(error?.code || "") !== "5" && !/not[- ]found/i.test(String(error?.message || ""))) throw error;
  }
  return count;
}

async function syncRecipeCounter(recipeId, childCollection, field) {
  if (!recipeId) return 0;
  const recipeRef = db.doc(`recipes/${recipeId}`);
  const recipe = await recipeRef.get();
  if (!recipe.exists) return 0;
  const aggregate = await recipeRef.collection(childCollection).count().get();
  const count = Number(aggregate.data().count || 0);
  await recipeRef.update({ [field]: Math.max(0, count) });
  return count;
}

async function isBlocked(recipientUid, actorUid) {
  if (!recipientUid || !actorUid || recipientUid === actorUid) return false;
  const [recipientBlock, actorBlock] = await Promise.all([
    db.doc(`users/${recipientUid}/blocks/${actorUid}`).get(),
    db.doc(`users/${actorUid}/blocks/${recipientUid}`).get(),
  ]);
  return recipientBlock.exists || actorBlock.exists;
}

function preferenceFieldForType(type) {
  return ({ message: "messages", comment: "comments", like: "likes", live: "live", follow: "followers", reply: "replies" })[cleanText(type, 24)] || "";
}

async function notificationTypeEnabled(uid, type) {
  const field = preferenceFieldForType(type);
  if (!uid || !field) return true;
  const snap = await db.doc(`users/${uid}/settings/notifications`).get();
  if (!snap.exists) return true;
  return snap.data()?.[field] !== false;
}

async function pruneOldNotifications(uid) {
  if (!uid) return 0;
  const cutoff = Date.now() - NOTIFICATION_RETENTION_MS;
  const snap = await db.collection(`users/${uid}/notifications`)
    .where("createdAt", "<", cutoff)
    .limit(NOTIFICATION_PRUNE_BATCH)
    .get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
}

async function createNotification(recipientUid, eventId, payload) {
  if (!recipientUid || !eventId) return false;
  const ref = db.doc(`users/${recipientUid}/notifications/${eventId}`);
  const preferenceField = preferenceFieldForType(payload.type);
  const preferenceRef = db.doc(`users/${recipientUid}/settings/notifications`);
  return db.runTransaction(async (tx) => {
    if (preferenceField) {
      const preference = await tx.get(preferenceRef);
      if (preference.exists && preference.data()?.[preferenceField] === false) return false;
    }
    const existing = await tx.get(ref);
    if (existing.exists) return false;
    tx.create(ref, {
      type: cleanText(payload.type, 24),
      actorUid: cleanText(payload.actorUid, 160),
      actorName: cleanText(payload.actorName, 120) || "Chef",
      title: cleanText(payload.title, 160) || "ChefVoice",
      body: cleanText(payload.body, 240),
      recipeId: cleanText(payload.recipeId, 160),
      conversationId: cleanText(payload.conversationId, 260),
      liveSessionId: cleanText(payload.liveSessionId, 160),
      commentId: cleanText(payload.commentId, 160),
      createdAt: Date.now(),
      readAt: 0,
    });
    return true;
  });
}

exports.notifyDirectMessage = onDocumentCreated(
  { document: "conversations/{conversationId}/messages/{messageId}", region: REGION },
  async (event) => {
    const message = event.data?.data();
    if (!message) return;
    const senderUid = cleanText(message.senderId, 160);
    if (!senderUid) return;

    const conversation = await db.doc(`conversations/${event.params.conversationId}`).get();
    if (!conversation.exists) return;
    const participantIds = Array.isArray(conversation.data().participantIds)
      ? conversation.data().participantIds.filter((id) => typeof id === "string")
      : [];
    const recipientUid = participantIds.find((id) => id !== senderUid);
    if (!recipientUid || await isBlocked(recipientUid, senderUid)) return;

    const actorName = await trustedActorName(senderUid);
    await conversation.ref.update({
      lastMessage: cleanText(message.text, 240),
      lastSenderId: senderUid,
      updatedAt: Number(message.createdAt || Date.now()),
    });
    await createNotification(
      recipientUid,
      `message_${event.params.conversationId}_${event.params.messageId}`,
      {
        type: "message",
        actorUid: senderUid,
        actorName,
        title: `New message from ${actorName}`,
        body: "Open ChefVoice to read it.",
        conversationId: event.params.conversationId,
        recipeId: "",
        liveSessionId: "",
      }
    );
  }
);

exports.notifyRecipeComment = onDocumentCreated(
  { document: "recipes/{recipeId}/comments/{commentId}", region: REGION },
  async (event) => {
    const comment = event.data?.data();
    if (!comment) return;
    const actorUid = cleanText(comment.authorId, 160);
    await syncRecipeCounter(event.params.recipeId, "comments", "commentCount");
    if (!actorUid || cleanText(comment.parentCommentId, 160)) return;

    const recipe = await db.doc(`recipes/${event.params.recipeId}`).get();
    if (!recipe.exists) return;
    const recipeData = recipe.data();
    const recipientUid = cleanText(recipeData.authorId, 160);
    if (!recipientUid || recipientUid === actorUid || await isBlocked(recipientUid, actorUid)) return;

    const actorName = await trustedActorName(actorUid);
    const recipeTitle = cleanText(recipeData.title, 120) || "your recipe";
    await createNotification(
      recipientUid,
      `comment_${event.params.recipeId}_${event.params.commentId}`,
      {
        type: "comment",
        actorUid,
        actorName,
        title: `${actorName} commented on your recipe`,
        body: recipeTitle,
        recipeId: event.params.recipeId,
        conversationId: "",
        liveSessionId: "",
      }
    );
  }
);

exports.notifyCommentReply = onDocumentCreated(
  { document: "recipes/{recipeId}/comments/{commentId}", region: REGION },
  async (event) => {
    const reply = event.data?.data();
    const parentCommentId = cleanText(reply?.parentCommentId, 160);
    const actorUid = cleanText(reply?.authorId, 160);
    if (!reply || !parentCommentId || !actorUid) return;

    const [parent, recipe] = await Promise.all([
      db.doc(`recipes/${event.params.recipeId}/comments/${parentCommentId}`).get(),
      db.doc(`recipes/${event.params.recipeId}`).get(),
    ]);
    if (!parent.exists || !recipe.exists) return;
    const recipientUid = cleanText(parent.data().authorId, 160);
    if (!recipientUid || recipientUid === actorUid || await isBlocked(recipientUid, actorUid)) return;

    const actorName = await trustedActorName(actorUid);
    const recipeTitle = cleanText(recipe.data().title, 120) || "a recipe";
    await createNotification(
      recipientUid,
      `reply_${event.params.recipeId}_${event.params.commentId}`,
      {
        type: "reply", actorUid, actorName,
        title: `${actorName} replied to your comment`,
        body: recipeTitle,
        recipeId: event.params.recipeId, conversationId: "", liveSessionId: "", commentId: event.params.commentId,
      }
    );
  }
);

exports.notifyRecipeLike = onDocumentCreated(
  { document: "recipes/{recipeId}/likes/{likerUid}", region: REGION },
  async (event) => {
    const actorUid = cleanText(event.params.likerUid, 160);
    if (!actorUid) return;
    await syncRecipeCounter(event.params.recipeId, "likes", "likes");

    const [recipe, actor] = await Promise.all([
      db.doc(`recipes/${event.params.recipeId}`).get(),
      db.doc(`users/${actorUid}`).get(),
    ]);
    if (!recipe.exists) return;
    const recipeData = recipe.data();
    const recipientUid = cleanText(recipeData.authorId, 160);
    if (!recipientUid || recipientUid === actorUid || await isBlocked(recipientUid, actorUid)) return;

    const actorName = cleanText(actor.exists ? actor.data().displayName : "", 120) || "Chef";
    const recipeTitle = cleanText(recipeData.title, 120) || "your recipe";
    // Deterministic per liker+recipe ID means unlike/re-like loops do not spam alerts.
    await createNotification(
      recipientUid,
      `like_${event.params.recipeId}_${actorUid}`,
      {
        type: "like",
        actorUid,
        actorName,
        title: `${actorName} liked your recipe`,
        body: recipeTitle,
        recipeId: event.params.recipeId,
        conversationId: "",
        liveSessionId: "",
      }
    );
  }
);


exports.notifyNewFollower = onDocumentCreated(
  { document: "users/{targetUid}/followers/{followerUid}", region: REGION },
  async (event) => {
    const recipientUid = cleanText(event.params.targetUid, 160);
    const actorUid = cleanText(event.params.followerUid, 160);
    if (!recipientUid || !actorUid || recipientUid === actorUid) return;
    await syncFollowerCount(recipientUid);
    if (await isBlocked(recipientUid, actorUid)) return;

    const actorName = await trustedActorName(actorUid);
    await createNotification(
      recipientUid,
      `follow_${actorUid}`,
      {
        type: "follow",
        actorUid,
        actorName,
        title: `${actorName} followed you`,
        body: "Open their Chef Profile.",
        recipeId: "",
        conversationId: "",
        liveSessionId: "",
      }
    );
  }
);

async function fanoutFollowedChefLive(sessionId, session) {
  if (!session || cleanText(session.status, 24) !== "LIVE") return 0;
  const hostUid = cleanText(session.hostId, 160);
  if (!hostUid) return 0;
  const hostName = await trustedActorName(hostUid);
  const liveTitle = cleanText(session.title, 160) || `${hostName}'s live kitchen`;
  let cursor = null;
  let considered = 0;
  while (true) {
    let query = db.collection(`users/${hostUid}/followers`)
      .orderBy(FieldPath.documentId())
      .limit(FANOUT_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    const followerUids = page.docs
      .map((doc) => cleanText(doc.id, 160))
      .filter((uid) => uid && uid !== hostUid);
    considered += followerUids.length;
    for (let start = 0; start < followerUids.length; start += FANOUT_CONCURRENCY) {
      const group = followerUids.slice(start, start + FANOUT_CONCURRENCY);
      await Promise.all(group.map(async (recipientUid) => {
        if (await isBlocked(recipientUid, hostUid)) return false;
        return createNotification(recipientUid, `live_${sessionId}`, {
          type: "live", actorUid: hostUid, actorName: hostName,
          title: `${hostName} is Live`, body: liveTitle, recipeId: "",
          conversationId: "", liveSessionId: sessionId,
        });
      }));
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < FANOUT_PAGE_SIZE) break;
  }
  logger.info("ChefVoice followed-chef Live notifications created", { hostUid, sessionId, followerCount: considered });
  return considered;
}

// New clients create STARTING first and transition to LIVE only after local
// camera/microphone setup succeeds. This avoids alerting followers to rooms that
// never became watchable. Deterministic IDs make update retries safe.
exports.notifyFollowedChefLive = onDocumentUpdated(
  { document: "liveSessions/{sessionId}", region: REGION },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after || cleanText(after.status, 24) !== "LIVE" || cleanText(before?.status, 24) === "LIVE") return;
    await fanoutFollowedChefLive(event.params.sessionId, after);
  }
);

// Backward compatibility for already-installed clients that still create LIVE
// directly. The same deterministic notification ID prevents duplicate alerts.
exports.notifyFollowedChefLiveLegacyCreate = onDocumentCreated(
  { document: "liveSessions/{sessionId}", region: REGION },
  async (event) => {
    const session = event.data?.data();
    if (cleanText(session?.status, 24) !== "LIVE") return;
    await fanoutFollowedChefLive(event.params.sessionId, session);
  }
);

exports.cleanupBlockedSocialRelationship = onDocumentCreated(
  { document: "users/{blockerUid}/blocks/{blockedUid}", region: REGION },
  async (event) => {
    const blockerUid = cleanText(event.params.blockerUid, 160);
    const blockedUid = cleanText(event.params.blockedUid, 160);
    if (!blockerUid || !blockedUid || blockerUid === blockedUid) return;
    const batch = db.batch();
    batch.delete(db.doc(`users/${blockerUid}/following/${blockedUid}`));
    batch.delete(db.doc(`users/${blockedUid}/followers/${blockerUid}`));
    batch.delete(db.doc(`users/${blockedUid}/following/${blockerUid}`));
    batch.delete(db.doc(`users/${blockerUid}/followers/${blockedUid}`));
    await batch.commit();
    await Promise.all([syncFollowerCount(blockerUid), syncFollowerCount(blockedUid)]);
  }
);

exports.syncRecipeLikeCountOnDelete = onDocumentDeleted(
  { document: "recipes/{recipeId}/likes/{likerUid}", region: REGION },
  async (event) => { await syncRecipeCounter(event.params.recipeId, "likes", "likes"); }
);

exports.syncRecipeCommentCountOnDelete = onDocumentDeleted(
  { document: "recipes/{recipeId}/comments/{commentId}", region: REGION },
  async (event) => { await syncRecipeCounter(event.params.recipeId, "comments", "commentCount"); }
);

exports.syncFollowerCountOnDelete = onDocumentDeleted(
  { document: "users/{targetUid}/followers/{followerUid}", region: REGION },
  async (event) => { await syncFollowerCount(cleanText(event.params.targetUid, 160)); }
);

async function deleteCollectionFully(collectionRef) {
  let deleted = 0;
  while (true) {
    const snap = await collectionRef.limit(DELETE_BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < DELETE_BATCH_SIZE) break;
  }
  return deleted;
}

async function deleteStoragePrefix(prefix) {
  const bucket = getStorage().bucket(STORAGE_BUCKET);
  let deleted = 0;
  while (true) {
    const [files] = await bucket.getFiles({ prefix, maxResults: DELETE_BATCH_SIZE });
    if (!files.length) break;
    for (let start = 0; start < files.length; start += FANOUT_CONCURRENCY) {
      const group = files.slice(start, start + FANOUT_CONCURRENCY);
      await Promise.all(group.map((file) => file.delete({ ignoreNotFound: true })));
    }
    deleted += files.length;
    if (files.length < DELETE_BATCH_SIZE) break;
  }
  return deleted;
}

async function deleteRecipeUserMirrors(recipeId, likerUids = []) {
  for (let start = 0; start < likerUids.length; start += DELETE_BATCH_SIZE) {
    const batch = db.batch();
    likerUids.slice(start, start + DELETE_BATCH_SIZE).forEach((likerUid) => {
      if (likerUid) batch.delete(db.doc(`users/${likerUid}/likes/${recipeId}`));
    });
    await batch.commit();
  }
  // New bookmark mirrors carry recipeId for an indexed cleanup query.
  await deleteQueryInBatches(db.collectionGroup("bookmarks").where("recipeId", "==", recipeId));
  // v0.16.0-and-earlier bookmarks did not carry recipeId. Delete their known
  // deterministic document path while paging users so legacy references do not linger.
  let cursor = null;
  while (true) {
    let query = db.collection("users").orderBy(FieldPath.documentId()).limit(150);
    if (cursor) query = query.startAfter(cursor);
    const users = await query.get();
    if (users.empty) break;
    const batch = db.batch();
    users.docs.forEach((user) => batch.delete(user.ref.collection("bookmarks").doc(recipeId)));
    await batch.commit();
    cursor = users.docs[users.docs.length - 1].id;
    if (users.size < 150) break;
  }
}

async function deleteRecipeArtifacts(uid, recipeRef) {
  const recipeId = recipeRef.id;
  const likesSnapshot = await recipeRef.collection("likes").get();
  const likerUids = likesSnapshot.docs.map((item) => item.id);
  const [mediaDeleted, privateDeleted] = await Promise.all([
    deleteStoragePrefix(`recipes/${uid}/${recipeId}/`),
    deleteStoragePrefix(`privateVoice/${uid}/${recipeId}/`),
  ]);
  const [likesDeleted, commentsDeleted] = await Promise.all([
    deleteCollectionFully(recipeRef.collection("likes")),
    deleteCollectionFully(recipeRef.collection("comments")),
  ]);
  await deleteRecipeUserMirrors(recipeId, likerUids);
  const snap = await recipeRef.get();
  if (snap.exists) await recipeRef.delete();
  return { mediaDeleted: mediaDeleted + privateDeleted, likesDeleted, commentsDeleted };
}

function moderatorAuthorized(request) {
  return request.auth?.token?.admin === true || request.auth?.token?.moderator === true;
}

function deletedIdentity(uid) {
  return `deleted:${crypto.createHash("sha256").update(`chefvoice:${uid}`).digest("hex").slice(0,24)}`;
}

const MODERATION_ACTIONS = new Set([
  "restrict_24h", "restrict_7d", "restrict_permanent", "lift_restriction",
  "unpublish_recipe", "remove_content"
]);

async function applyModerationAction(reportId, report, action, moderatorUid) {
  const now = Date.now();
  const targetType = cleanText(report.targetType, 32).toLowerCase();
  const targetId = cleanText(report.targetId, 180);
  const targetUid = cleanText(report.targetUid, 180);
  const contextId = cleanText(report.contextId, 180);
  const result = { action, targetType, targetId, targetUid, contextId };

  if (["restrict_24h", "restrict_7d", "restrict_permanent", "lift_restriction"].includes(action)) {
    if (!targetUid || targetUid.startsWith("deleted:")) throw new HttpsError("failed-precondition", "This report no longer has an active target account.");
    const restrictionRef = db.doc(restrictionPath(targetUid));
    if (action === "lift_restriction") {
      await restrictionRef.set({ active: false, action, updatedAt: now, liftedAt: now, reportId, moderatorUid }, { merge: true });
      result.restrictionActive = false;
      return result;
    }
    const durationMs = action === "restrict_24h" ? 24 * 60 * 60 * 1000 : action === "restrict_7d" ? 7 * 24 * 60 * 60 * 1000 : 0;
    await restrictionRef.set({
      active: true, action, createdAt: now, updatedAt: now, expiresAt: durationMs ? now + durationMs : 0, reportId, moderatorUid
    }, { merge: true });
    result.restrictionActive = true;
    result.expiresAt = durationMs ? now + durationMs : 0;
    return result;
  }

  if (action === "unpublish_recipe") {
    if (targetType !== "recipe" || !/^[A-Za-z0-9_-]{1,128}$/.test(targetId)) throw new HttpsError("failed-precondition", "Unpublish requires a recipe report with a valid recipe ID.");
    const recipeRef = db.doc(`recipes/${targetId}`);
    const recipe = await recipeRef.get();
    if (!recipe.exists) { result.alreadyMissing = true; return result; }
    await recipeRef.update({ isPublic: false, updatedAt: now });
    result.unpublished = true;
    return result;
  }

  if (action === "remove_content") {
    if ((targetType === "comment" || targetType === "reply") && /^[A-Za-z0-9_-]{1,128}$/.test(contextId) && targetId) {
      await db.doc(`recipes/${contextId}/comments/${targetId}`).delete();
      await syncRecipeCounter(contextId, "comments", "commentCount");
      result.removed = true;
      return result;
    }
    if (targetType === "message" && contextId && targetId) {
      const messageRef = db.doc(`conversations/${contextId}/messages/${targetId}`);
      const message = await messageRef.get();
      if (message.exists) await messageRef.delete();
      const conversationRef = db.doc(`conversations/${contextId}`);
      const latest = await conversationRef.collection("messages").orderBy("createdAt", "desc").limit(1).get();
      if (latest.empty) { const conversation = await conversationRef.get(); if (conversation.exists) await conversationRef.delete(); }
      else {
        const data = latest.docs[0].data() || {};
        const conversation = await conversationRef.get();
        if (conversation.exists) await conversationRef.update({ lastMessage: cleanText(data.text, 240), lastSenderId: cleanText(data.senderId, 160), updatedAt: Number(data.createdAt || now) });
      }
      result.removed = message.exists;
      return result;
    }
    if (targetType === "recipe" && /^[A-Za-z0-9_-]{1,128}$/.test(targetId)) {
      const recipeRef = db.doc(`recipes/${targetId}`);
      const recipe = await recipeRef.get();
      if (recipe.exists) await recipeRef.update({ isPublic: false, updatedAt: now });
      result.unpublished = recipe.exists;
      return result;
    }
    throw new HttpsError("failed-precondition", "This report type does not support content removal. Restrict the account instead.");
  }

  throw new HttpsError("invalid-argument", "Unsupported moderation action.");
}

async function recordModerationEvent(payload) {
  const ref = db.collection(MODERATION_EVENTS_COLLECTION).doc();
  await ref.create({ ...payload, createdAt: Date.now() });
  return ref.id;
}

async function deleteQueryInBatches(query, beforeDelete = async () => {}) {
  let count = 0;
  while (true) {
    const snap = await query.limit(DELETE_BATCH_SIZE).get();
    if (snap.empty) break;
    await beforeDelete(snap.docs);
    for (let start = 0; start < snap.docs.length; start += DELETE_BATCH_SIZE) {
      const batch = db.batch();
      snap.docs.slice(start, start + DELETE_BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    count += snap.size;
    if (snap.size < DELETE_BATCH_SIZE) break;
  }
  return count;
}

async function deleteUserFollowEdges(uid) {
  const ownFollowing = db.collection(`users/${uid}/following`);
  while (true) {
    const snap = await ownFollowing.limit(DELETE_BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.delete(doc.ref);
      batch.delete(db.doc(`users/${doc.id}/followers/${uid}`));
    });
    await batch.commit();
  }
  const ownFollowers = db.collection(`users/${uid}/followers`);
  while (true) {
    const snap = await ownFollowers.limit(DELETE_BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.delete(doc.ref);
      batch.delete(db.doc(`users/${doc.id}/following/${uid}`));
    });
    await batch.commit();
  }
}

async function deleteIncomingBlockReferences(uid) {
  let cursor = null;
  while (true) {
    let query = db.collection("users").orderBy(FieldPath.documentId()).limit(200);
    if (cursor) query = query.startAfter(cursor);
    const users = await query.get();
    if (users.empty) break;
    const batch = db.batch();
    users.docs.forEach((user) => {
      if (user.id !== uid) batch.delete(user.ref.collection("blocks").doc(uid));
    });
    await batch.commit();
    cursor = users.docs[users.docs.length - 1].id;
    if (users.size < 200) break;
  }
}

async function deleteUserLikes(uid) {
  // Clean the normal per-user mirror first.
  const refs = db.collection(`users/${uid}/likes`);
  while (true) {
    const snap = await refs.limit(DELETE_BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.delete(doc.ref);
      batch.delete(db.doc(`recipes/${doc.id}/likes/${uid}`));
    });
    await batch.commit();
  }

  // Defense in depth for legacy/custom clients: scan recipe pages and remove the
  // deterministic recipe-side like even if its user-side mirror never existed.
  let cursor = null;
  while (true) {
    let query = db.collection("recipes").orderBy(FieldPath.documentId()).limit(DELETE_BATCH_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const recipes = await query.get();
    if (recipes.empty) break;
    const batch = db.batch();
    recipes.docs.forEach((recipe) => batch.delete(recipe.ref.collection("likes").doc(uid)));
    await batch.commit();
    cursor = recipes.docs[recipes.docs.length - 1].id;
    if (recipes.size < DELETE_BATCH_SIZE) break;
  }
}

async function deleteLiveSessionFully(sessionRef) {
  const peers = await sessionRef.collection("peers").get();
  for (const peer of peers.docs) {
    await Promise.all([
      deleteCollectionFully(peer.ref.collection("hostCandidates")),
      deleteCollectionFully(peer.ref.collection("viewerCandidates")),
    ]);
    await peer.ref.delete();
  }
  await Promise.all([
    deleteCollectionFully(sessionRef.collection("comments")),
    deleteCollectionFully(sessionRef.collection("reactionState")),
  ]);
  const snap = await sessionRef.get();
  if (snap.exists) await sessionRef.delete();
}

async function refreshConversationAfterAccountDeletion(conversationRef, uid) {
  const remaining = await conversationRef.collection("messages").orderBy("createdAt", "desc").limit(1).get();
  if (remaining.empty) {
    await conversationRef.delete();
    return;
  }
  const message = remaining.docs[0].data();
  const snap = await conversationRef.get();
  if (!snap.exists) return;
  const participantNames = { ...(snap.data()?.participantNames || {}) };
  participantNames[uid] = "Deleted Chef";
  await conversationRef.update({
    participantNames,
    lastMessage: cleanText(message.text, 240),
    lastSenderId: cleanText(message.senderId, 160),
    updatedAt: Number(message.createdAt || Date.now()),
  });
}

async function deleteConversationForAccountDeletion(conversationRef) {
  const snap = await conversationRef.get();
  const participantIds = snap.exists && Array.isArray(snap.data()?.participantIds) ? snap.data().participantIds : [];
  await deleteCollectionFully(conversationRef.collection("messages"));
  for (let start = 0; start < participantIds.length; start += DELETE_BATCH_SIZE) {
    const batch = db.batch();
    participantIds.slice(start, start + DELETE_BATCH_SIZE).forEach((participantUid) => {
      if (participantUid) batch.delete(db.doc(`users/${participantUid}/messageReads/${conversationRef.id}`));
    });
    await batch.commit();
  }
  if (snap.exists) await conversationRef.delete();
}


async function publicSocialUploadRestricted(uid) {
  if (!uid) return true;
  const snap = await db.doc(restrictionPath(uid)).get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  if (data.active !== true) return false;
  const expiresAt = Number(data.expiresAt || 0);
  return expiresAt === 0 || expiresAt > Date.now();
}

function storageQuotaKeys(now) {
  const date = new Date(now);
  return {
    dayKey: date.toISOString().slice(0, 10),
    monthKey: date.toISOString().slice(0, 7),
  };
}

function normalizeStoragePermitRequest(data) {
  const kind = cleanText(data?.kind, 32);
  const recipeId = cleanText(data?.recipeId, 128);
  const fileName = cleanText(data?.fileName, 64);
  const contentType = cleanText(data?.contentType, 120).toLowerCase();
  const bytes = Number(data?.bytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) throw new HttpsError("invalid-argument", "Upload byte size is required.");
  let permitId = "";
  let maxBytes = 0;
  if (kind === "profile_avatar") {
    if (fileName !== "profile.jpg" || !contentType.startsWith("image/")) throw new HttpsError("invalid-argument", "Invalid profile image upload.");
    maxBytes = 10 * 1024 * 1024; permitId = "profile-avatar";
  } else if (kind === "profile_cover") {
    if (fileName !== "profile.jpg" || !contentType.startsWith("image/")) throw new HttpsError("invalid-argument", "Invalid cover image upload.");
    maxBytes = 20 * 1024 * 1024; permitId = "profile-cover";
  } else {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(recipeId)) throw new HttpsError("invalid-argument", "Invalid recipe ID.");
    if (kind === "public_media") {
      if (!/^slot-(0[0-9]|1[0-9]|2[0-3])$/.test(fileName) || !(contentType.startsWith("image/") || contentType.startsWith("video/"))) throw new HttpsError("invalid-argument", "Invalid public media slot.");
      maxBytes = contentType.startsWith("image/") ? 25 * 1024 * 1024 : 200 * 1024 * 1024;
      permitId = `public-${recipeId}-${fileName}`;
    } else if (kind === "voice_clip") {
      if (!/^clip-(0[0-9]|1[0-5])$/.test(fileName) || !contentType.startsWith("audio/")) throw new HttpsError("invalid-argument", "Invalid voice clip slot.");
      maxBytes = 120 * 1024 * 1024; permitId = `voice-${recipeId}-${fileName}`;
    } else if (kind === "private_session") {
      if (fileName !== "session" || !contentType.startsWith("audio/")) throw new HttpsError("invalid-argument", "Invalid private cooking-session upload.");
      maxBytes = 120 * 1024 * 1024; permitId = `session-${recipeId}`;
    } else {
      throw new HttpsError("invalid-argument", "Unknown ChefVoice upload kind.");
    }
  }
  if (bytes > maxBytes) throw new HttpsError("invalid-argument", "Upload exceeds the ChefVoice object-size limit.");
  return { kind, recipeId, fileName, contentType, bytes, maxBytes, permitId };
}

exports.authorizeChefVoiceStorageUpload = onCall(
  { region: REGION, enforceAppCheck: false },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before uploading ChefVoice cloud media.");
    const uid = cleanText(request.auth.uid, 160);
    const input = normalizeStoragePermitRequest(request.data);
    const requiresVerifiedEmail = ["public_media", "voice_clip", "private_session"].includes(input.kind);
    if (requiresVerifiedEmail && request.auth.token?.email_verified !== true) {
      throw new HttpsError("failed-precondition", "Verify your ChefVoice email before uploading recipe media or private cloud audio.");
    }
    if (["profile_avatar", "profile_cover", "public_media"].includes(input.kind) && await publicSocialUploadRestricted(uid)) {
      throw new HttpsError("permission-denied", "This ChefVoice account is temporarily restricted from changing public-facing media.");
    }
    if (input.recipeId) {
      const recipe = await db.doc(`recipes/${input.recipeId}`).get();
      if (!recipe.exists || cleanText(recipe.data()?.authorId, 160) !== uid) throw new HttpsError("permission-denied", "This recipe is not owned by the signed-in ChefVoice account.");
    }

    const now = Date.now();
    const token = crypto.randomUUID();
    const expiresAt = now + STORAGE_PERMIT_TTL_MS;
    const quotaRef = db.doc(`users/${uid}/privateOperations/storageBudget`);
    const permitRef = db.doc(`users/${uid}/storageUploadPermits/${input.permitId}`);
    const { dayKey, monthKey } = storageQuotaKeys(now);
    await db.runTransaction(async (tx) => {
      const quotaSnap = await tx.get(quotaRef);
      const q = quotaSnap.exists ? quotaSnap.data() || {} : {};
      let dailyBytes = String(q.dayKey || "") === dayKey ? Math.max(0, Number(q.dailyBytes || 0)) : 0;
      let dailyOperations = String(q.dayKey || "") === dayKey ? Math.max(0, Number(q.dailyOperations || 0)) : 0;
      let monthlyBytes = String(q.monthKey || "") === monthKey ? Math.max(0, Number(q.monthlyBytes || 0)) : 0;
      let monthlyOperations = String(q.monthKey || "") === monthKey ? Math.max(0, Number(q.monthlyOperations || 0)) : 0;
      if (dailyBytes + input.bytes > STORAGE_DAILY_BYTES || dailyOperations + 1 > STORAGE_DAILY_OPERATIONS) throw new HttpsError("resource-exhausted", "ChefVoice daily cloud-upload budget reached. Local cooking data is unchanged.");
      if (monthlyBytes + input.bytes > STORAGE_MONTHLY_BYTES || monthlyOperations + 1 > STORAGE_MONTHLY_OPERATIONS) throw new HttpsError("resource-exhausted", "ChefVoice monthly cloud-upload budget reached.");
      dailyBytes += input.bytes; dailyOperations += 1; monthlyBytes += input.bytes; monthlyOperations += 1;
      tx.set(quotaRef, { dayKey, dailyBytes, dailyOperations, monthKey, monthlyBytes, monthlyOperations, updatedAt: now }, { merge: true });
      tx.set(permitRef, {
        token, kind: input.kind, recipeId: input.recipeId, fileName: input.fileName,
        contentType: input.contentType, maxBytes: input.maxBytes, reservedBytes: input.bytes,
        issuedAt: now, expiresAt, usedAt: 0
      });
    });
    return { permitId: input.permitId, token, expiresAt, maxBytes: input.maxBytes };
  }
);

function storageObjectOwnerUid(name) {
  const parts = String(name || "").split("/");
  if (parts[0] === "profiles" && parts.length >= 2) return parts[1];
  if ((parts[0] === "recipes" || parts[0] === "privateVoice") && parts.length >= 2) return parts[1];
  return "";
}

exports.consumeChefVoiceStorageUploadPermit = onObjectFinalized(
  { region: REGION, bucket: STORAGE_BUCKET },
  async (event) => {
    const object = event.data;
    const uid = cleanText(storageObjectOwnerUid(object?.name), 160);
    const permitId = cleanText(object?.metadata?.chefvoicePermitId, 220);
    const token = cleanText(object?.metadata?.chefvoiceUploadToken, 220);
    if (!uid || !permitId || !token) return;
    const ref = db.doc(`users/${uid}/storageUploadPermits/${permitId}`);
    const snap = await ref.get();
    if (!snap.exists || cleanText(snap.data()?.token, 220) !== token) return;
    await ref.delete();
  }
);

exports.moderateChefVoiceReport = onCall(
  { region: REGION, enforceAppCheck: false },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before moderating reports.");
    if (!moderatorAuthorized(request)) throw new HttpsError("permission-denied", "ChefVoice moderator access is required.");
    const reportId = cleanText(request.data?.reportId, 180);
    const status = cleanText(request.data?.status, 32).toLowerCase();
    const moderatorNote = cleanText(request.data?.moderatorNote, 1000);
    const action = cleanText(request.data?.action, 160).toLowerCase();
    if (!reportId) throw new HttpsError("invalid-argument", "Report ID is required.");
    if (!["reviewed", "actioned", "dismissed"].includes(status)) throw new HttpsError("invalid-argument", "Invalid report status.");
    if (status === "actioned" && !MODERATION_ACTIONS.has(action)) throw new HttpsError("invalid-argument", "Choose a concrete moderation action before marking a report actioned.");
    if (status !== "actioned" && action) throw new HttpsError("invalid-argument", "Moderation actions are only accepted with actioned status.");

    const ref = db.doc(`reports/${reportId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Report no longer exists.");
    const report = snap.data() || {};
    const beforeStatus = cleanText(report.status, 32) || "open";
    const actionResult = status === "actioned" ? await applyModerationAction(reportId, report, action, request.auth.uid) : { action: "" };
    const eventId = await recordModerationEvent({
      reportId, moderatorUid: request.auth.uid, beforeStatus, status, action, moderatorNote,
      targetType: cleanText(report.targetType, 32), targetId: cleanText(report.targetId, 180),
      targetUid: cleanText(report.targetUid, 180), contextId: cleanText(report.contextId, 180),
      result: actionResult
    });
    await ref.update({ status, moderatorNote, action, reviewedAt: Date.now(), reviewedBy: request.auth.uid, moderationEventId: eventId });
    logger.info("ChefVoice report moderated", { reportId, status, moderatorUid: request.auth.uid, action, eventId });
    return { ok: true, status, action, eventId, result: actionResult };
  }
);

exports.deleteChefVoiceAccount = onCall(
  { region: REGION, enforceAppCheck: false, timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before deleting your ChefVoice account.");
    const uid = cleanText(request.auth.uid, 160);
    const authTimeSeconds = Number(request.auth.token?.auth_time || 0);
    if (!authTimeSeconds || Date.now() - authTimeSeconds * 1000 > 10 * 60 * 1000) {
      throw new HttpsError("failed-precondition", "For your security, sign in again before permanently deleting your ChefVoice account.");
    }

    // Recipes and their cloud media/private audio.
    while (true) {
      const recipes = await db.collection("recipes").where("authorId", "==", uid).limit(50).get();
      if (recipes.empty) break;
      for (const recipe of recipes.docs) await deleteRecipeArtifacts(uid, recipe.ref);
    }

    // Social edges, user-owned like mirrors, and block references held by other accounts.
    await Promise.all([deleteUserFollowEdges(uid), deleteUserLikes(uid), deleteIncomingBlockReferences(uid)]);

    // Remove authored comments, replies that explicitly target this UID, and activity
    // records retained by other accounts. Flat reply documents are removed when
    // their replyToUid points at the deleted account so no orphan identity remains.
    await Promise.all([
      deleteQueryInBatches(db.collectionGroup("comments").where("authorId", "==", uid)),
      deleteQueryInBatches(db.collectionGroup("comments").where("replyToUid", "==", uid)),
      deleteQueryInBatches(db.collectionGroup("notifications").where("actorUid", "==", uid)),
    ]);

    // Private conversations are shared records. Account deletion removes the full
    // conversation and both participants' per-conversation read markers so the
    // deleted UID is not retained in participantIds or deterministic conversation IDs.
    const conversations = await db.collection("conversations").where("participantIds", "array-contains", uid).get();
    for (const conversation of conversations.docs) await deleteConversationForAccountDeletion(conversation.ref);

    // End and remove the account's Live rooms/signaling records.
    while (true) {
      const sessions = await db.collection("liveSessions").where("hostId", "==", uid).limit(50).get();
      if (sessions.empty) break;
      for (const session of sessions.docs) await deleteLiveSessionFully(session.ref);
    }

    // Known private user subcollections. Reports are retained for safety/moderation,
    // but raw account UID references are pseudonymized below.
    for (const name of ["bookmarks", "blocks", "messageReads", "notifications", "notificationDevices", "settings", "privateOperations", "storageUploadPermits", "following", "followers", "likes"]) {
      await deleteCollectionFully(db.collection(`users/${uid}/${name}`));
    }

    await Promise.all([
      deleteStoragePrefix(`profiles/${uid}/`),
      deleteStoragePrefix(`privateVoice/${uid}/`),
      deleteStoragePrefix(`recipes/${uid}/`),
    ]);

    const pseudonym = deletedIdentity(uid);
    const reportedBy = await db.collection("reports").where("reporterUid", "==", uid).get();
    for (const doc of reportedBy.docs) {
      const data = doc.data() || {};
      await doc.ref.update({
        reporterUid: pseudonym,
        contextId: cleanText(data.contextId, 180).split(uid).join(pseudonym),
        reporterAccountDeletedAt: Date.now(),
      });
    }
    const targeting = await db.collection("reports").where("targetUid", "==", uid).get();
    for (const doc of targeting.docs) {
      const data = doc.data() || {};
      await doc.ref.update({
        targetUid: pseudonym,
        targetId: cleanText(data.targetId, 180) === uid ? pseudonym : cleanText(data.targetId, 180),
        contextId: cleanText(data.contextId, 180).split(uid).join(pseudonym),
        targetAccountDeletedAt: Date.now(),
      });
    }

    // Firebase never reuses a UID, so a restriction record keyed by the deleted
    // account is dead weight and a raw UID reference we said we would not retain.
    await db.doc(restrictionPath(uid)).delete();
    await db.doc(`users/${uid}`).delete();
    await getAuth().deleteUser(uid);
    logger.info("ChefVoice account permanently deleted", { deletedIdentity: pseudonym });
    return { ok: true, localCookingDataPreserved: true, safetyReportsPseudonymized: true };
  }
);

exports.deleteChefVoiceRecipe = onCall(
  { region: REGION, enforceAppCheck: false, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before deleting a ChefVoice recipe.");
    const uid = cleanText(request.auth.uid, 160);
    const recipeId = cleanText(request.data?.recipeId, 160);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(recipeId)) throw new HttpsError("invalid-argument", "Invalid recipe ID.");
    const recipeRef = db.doc(`recipes/${recipeId}`);
    const recipe = await recipeRef.get();
    if (recipe.exists && cleanText(recipe.data()?.authorId, 160) !== uid) {
      throw new HttpsError("permission-denied", "Only the recipe owner can permanently delete this recipe.");
    }
    // Cleanup is deliberately idempotent. A retry after a partial failure sees
    // missing files/docs as already-clean and can safely continue.
    const result = await deleteRecipeArtifacts(uid, recipeRef);
    logger.info("ChefVoice recipe cloud deletion completed", { uid, recipeId, ...result });
    return { ok: true, missing: !recipe.exists, mediaDeleted: result.mediaDeleted };
  }
);

exports.pushChefVoiceNotification = onDocumentCreated(
  { document: "users/{uid}/notifications/{notificationId}", region: REGION },
  async (event) => {
    const notification = event.data?.data();
    if (!notification) return;
    const recipientUid = event.params.uid;
    if (!(await notificationTypeEnabled(recipientUid, notification.type))) return;

    // Keep notification history bounded without a separate scheduler. Every new
    // activity event opportunistically removes up to 50 records older than 30 days.
    try {
      const pruned = await pruneOldNotifications(recipientUid);
      if (pruned) logger.info("ChefVoice old notification history pruned", { recipientUid, pruned });
    } catch (error) {
      logger.warn("ChefVoice notification history prune skipped", { recipientUid, error: error?.message || String(error) });
    }

    const devicePage = await db.collection(`users/${recipientUid}/notificationDevices`).orderBy("updatedAt", "desc").limit(40).get();
    const devices = { docs: devicePage.docs.slice(0, 20) };
    const surplusDevices = devicePage.docs.slice(20);
    const fids = devices.docs
      .map((doc) => cleanText(doc.data().fid, 220))
      .filter(Boolean);
    if (surplusDevices.length) {
      const cleanup = db.batch();
      surplusDevices.forEach((doc) => cleanup.delete(doc.ref));
      await cleanup.commit();
    }
    if (fids.length === 0) return;

    const data = {
      eventId: event.params.notificationId,
      recipientUid,
      type: cleanText(notification.type, 24),
      title: cleanText(notification.title, 160) || "ChefVoice",
      body: cleanText(notification.body, 240) || "You have new ChefVoice activity.",
      recipeId: cleanText(notification.recipeId, 160),
      conversationId: cleanText(notification.conversationId, 260),
      liveSessionId: cleanText(notification.liveSessionId, 160),
      commentId: cleanText(notification.commentId, 160),
    };

    try {
      const response = await getMessaging().sendEachForMulticast({
        fids,
        data,
        android: {
          priority: "high",
          ttl: 86400000,
        },
      });
      const staleFids = response.responses
        .map((item, index) => ({ item, fid: fids[index] }))
        .filter(({ item }) => {
          const code = item.error?.code || "";
          return !item.success && (
            code.includes("installation-id-not-registered") ||
            code.includes("registration-token-not-registered")
          );
        })
        .map(({ fid }) => fid);

      if (staleFids.length > 0) {
        const batch = db.batch();
        staleFids.forEach((fid) => {
          batch.delete(db.doc(`users/${recipientUid}/notificationDevices/${fid}`));
        });
        await batch.commit();
      }

      logger.info("ChefVoice notification push result", {
        notificationId: event.params.notificationId,
        recipientUid,
        successCount: response.successCount,
        failureCount: response.failureCount,
        staleFidsRemoved: staleFids.length,
      });
    } catch (error) {
      logger.error("ChefVoice notification push failed", {
        notificationId: event.params.notificationId,
        recipientUid,
        error: error?.message || String(error),
      });
      throw error;
    }
  }
);
