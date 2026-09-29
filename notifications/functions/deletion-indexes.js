"use strict";

// Account and recipe deletion without walking the whole platform (audit F17).
//
// Deletion used to page through every user (to remove blocks of the deleted account, and legacy
// bookmarks of a deleted recipe) and through every recipe (to remove the deleted account's
// likes), so one deletion cost one read and one write per user or per recipe on ChefVoice, under
// a function timeout. Each walk exists only for documents older than a field or rule that now
// makes them findable directly:
//
// - a block carries `blockedUid` (firestore.rules requires it), so a collection-group query finds
//   every block of an account;
// - a bookmark carries `recipeId` (required too), so the same finds every bookmark of a recipe;
// - a like is two documents, the recipe's and the chef's own mirror, written together; the rules
//   now also keep the mirror while the recipe's half exists, so the mirrors list every like.
//
// `backfillChefVoiceDeletionIndexes` (index.js) gives the older documents those fields and
// mirrors once, and records in config/deletionIndexes when it has finished. The walks run until
// then, so a deploy that lands first loses nothing, and stop by themselves afterwards.
//
// This file holds the decisions, as pure functions over document-shaped objects
// ({id, ref: {path}, get(field)}), so they are tested for real rather than by reading source.

const DELETION_INDEX_DOC = "config/deletionIndexes";
const BACKFILL_PHASES = Object.freeze(["blocks", "bookmarks", "likes"]);
const RECIPE_LIKE = /^recipes\/([^/]+)\/likes\/([^/]+)$/;
const OWN_BLOCK = /^users\/([^/]+)\/blocks\/([^/]+)$/;
const OWN_BOOKMARK = /^users\/([^/]+)\/bookmarks\/([^/]+)$/;

/** True once the backfill has finished, from the config/deletionIndexes document's data. */
function legacyScansRetired(state) {
  return Number(state?.backfilledAt || 0) > 0;
}

/** Older block documents that lack the field account deletion now finds them by. */
function blockFixes(docs) {
  return docs
    .filter((doc) => OWN_BLOCK.test(doc.ref.path) && doc.get("blockedUid") !== doc.id)
    .map((doc) => ({ path: doc.ref.path, data: { blockedUid: doc.id } }));
}

/** Older bookmark documents that lack the field recipe deletion now finds them by. */
function bookmarkFixes(docs) {
  return docs
    .filter((doc) => OWN_BOOKMARK.test(doc.ref.path) && doc.get("recipeId") !== doc.id)
    .map((doc) => ({ path: doc.ref.path, data: { recipeId: doc.id } }));
}

/**
 * The chef's own mirror of a recipe's like, or null for anything else in the "likes" collection
 * group, which also holds the mirrors themselves.
 */
function likeMirror(path) {
  const match = RECIPE_LIKE.exec(String(path || ""));
  return match ? { recipeId: match[1], uid: match[2], mirrorPath: `users/${match[2]}/likes/${match[1]}` } : null;
}

/** The mirrors missing for a page of the "likes" collection group, given which ones exist. */
function likeMirrorFixes(docs, existingMirrorPaths) {
  const fixes = [];
  for (const doc of docs) {
    const like = likeMirror(doc.ref.path);
    if (!like || existingMirrorPaths.has(like.mirrorPath)) continue;
    // The rules pin both halves of a like to one createdAt; the mirror takes the recipe's.
    const createdAt = Number(doc.get("createdAt"));
    fixes.push({ path: like.mirrorPath, data: { createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0 } });
  }
  return fixes;
}

/**
 * Where the backfill stands after a page: the cursor it resumes from, or "done" once a phase has
 * read a short page. The whole backfill is done when every phase is.
 */
function advance(cursors, phase, pageDocs, pageSize) {
  const next = { ...cursors };
  if (!pageDocs.length || pageDocs.length < pageSize) next[phase] = "done";
  else next[phase] = pageDocs[pageDocs.length - 1].ref.path;
  return next;
}

const backfillDone = (cursors) => BACKFILL_PHASES.every((phase) => cursors?.[phase] === "done");

module.exports = {
  DELETION_INDEX_DOC, BACKFILL_PHASES, legacyScansRetired, blockFixes, bookmarkFixes, likeMirror,
  likeMirrorFixes, advance, backfillDone
};
