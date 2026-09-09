// Pure helpers for the Inbox and for comment threading.
//
// These live outside app.js so they can be tested directly: app.js touches the DOM
// at import time, and the unread arithmetic and the reply grouping are exactly the
// parts most likely to be subtly wrong.

/** The other chef in a two-party conversation. */
export function otherParticipant(conversation, uid) {
  return (conversation?.participantIds || []).find((id) => id !== uid) || '';
}

export function otherParticipantName(conversation, uid) {
  const other = otherParticipant(conversation, uid);
  return conversation?.participantNames?.[other] || 'Chef';
}

/**
 * A conversation is unread when its last activity is newer than this account's read
 * marker AND the last message came from the other chef. Your own message bumps
 * `updatedAt` too, so without the sender check every message you sent would come
 * back as an unread badge against yourself.
 */
export function conversationUnread(conversation, uid, readMap = {}) {
  if (!conversation || !uid) return false;
  if (conversation.lastSenderId === uid) return false;
  return Number(conversation.updatedAt || 0) > Number(readMap[conversation.id] || 0);
}

export function unreadCounts(conversations = [], notifications = [], uid = '', readMap = {}) {
  return {
    messages: conversations.filter((c) => conversationUnread(c, uid, readMap)).length,
    activity: notifications.filter((n) => Number(n.readAt || 0) <= 0).length
  };
}

/**
 * Groups a flat comment list into one level of threading, matching Android.
 *
 * A reply whose parent is not in the list -- deleted, or hidden because its author
 * is blocked -- is promoted to top level rather than disappearing with the parent.
 * Dropping it would silently hide a conversation the chef is part of.
 */
export function threadComments(comments = []) {
  const present = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => !c.parentCommentId || !present.has(c.parentCommentId));
  const repliesByParent = new Map();
  for (const comment of comments) {
    if (!comment.parentCommentId || !present.has(comment.parentCommentId)) continue;
    if (!repliesByParent.has(comment.parentCommentId)) repliesByParent.set(comment.parentCommentId, []);
    repliesByParent.get(comment.parentCommentId).push(comment);
  }
  return { roots, repliesFor: (id) => repliesByParent.get(id) || [] };
}

/** Hides content authored by a chef this account has blocked. */
export function withoutBlocked(items = [], blocked = new Set(), uidKey = 'authorId') {
  return items.filter((item) => !blocked.has(item?.[uidKey]));
}
