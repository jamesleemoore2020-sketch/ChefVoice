"use strict";

// The decisions behind deletion without full scans (audit F17), run for real on
// document-shaped objects. rules-tests/deletion-backfill.test.js runs the callable itself
// against the Firestore emulator.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BACKFILL_PHASES, legacyScansRetired, blockFixes, bookmarkFixes, likeMirror, likeMirrorFixes, advance,
  backfillDone
} = require("./deletion-indexes");

/** A stand-in for a Firestore document snapshot. */
const snap = (path, data = {}) => ({ id: path.split("/").pop(), ref: { path }, get: (field) => data[field] });

test("the walks retire only once the backfill has recorded that it finished", () => {
  assert.equal(legacyScansRetired(null), false);
  assert.equal(legacyScansRetired({}), false);
  assert.equal(legacyScansRetired({ cursors: { blocks: "done" } }), false);
  assert.equal(legacyScansRetired({ backfilledAt: 0 }), false);
  assert.equal(legacyScansRetired({ backfilledAt: 1790000000000 }), true);
});

test("a block missing the field deletion finds it by gets it, and only that", () => {
  const docs = [
    snap("users/alice/blocks/bob"),
    snap("users/alice/blocks/carol", { blockedUid: "carol", createdAt: 1 }),
    snap("users/dave/blocks/erin", { blockedUid: "someone-else" }),
    snap("elsewhere/x/blocks/y")
  ];
  assert.deepEqual(blockFixes(docs), [
    { path: "users/alice/blocks/bob", data: { blockedUid: "bob" } },
    { path: "users/dave/blocks/erin", data: { blockedUid: "erin" } }
  ]);
});

test("a bookmark missing the field recipe deletion finds it by gets it, and only that", () => {
  const docs = [
    snap("users/alice/bookmarks/r1", { createdAt: 5 }),
    snap("users/alice/bookmarks/r2", { recipeId: "r2", createdAt: 5 }),
    snap("recipes/r3/bookmarks/x")
  ];
  assert.deepEqual(bookmarkFixes(docs), [{ path: "users/alice/bookmarks/r1", data: { recipeId: "r1" } }]);
});

test("only a recipe's own like has a mirror to make; the mirrors themselves are skipped", () => {
  assert.deepEqual(likeMirror("recipes/r1/likes/alice"), { recipeId: "r1", uid: "alice", mirrorPath: "users/alice/likes/r1" });
  assert.equal(likeMirror("users/alice/likes/r1"), null);
  assert.equal(likeMirror("recipes/r1/comments/c1"), null);
  assert.equal(likeMirror(""), null);
});

test("a missing mirror is made with the like's own time; an existing one is left alone", () => {
  const docs = [
    snap("recipes/r1/likes/alice", { createdAt: 111 }),
    snap("recipes/r2/likes/alice", { createdAt: 222 }),
    snap("recipes/r3/likes/bob", {}),
    snap("users/alice/likes/r1", { createdAt: 111 })
  ];
  const existing = new Set(["users/alice/likes/r2"]);
  assert.deepEqual(likeMirrorFixes(docs, existing), [
    { path: "users/alice/likes/r1", data: { createdAt: 111 } },
    { path: "users/bob/likes/r3", data: { createdAt: 0 } }
  ]);
});

test("the backfill resumes from the last document it read, and a short page ends a phase", () => {
  const page = Array.from({ length: 3 }, (_, i) => snap(`users/u${i}/blocks/x`));
  let cursors = advance({}, "blocks", page, 3);
  assert.equal(cursors.blocks, "users/u2/blocks/x");
  cursors = advance(cursors, "blocks", page.slice(0, 1), 3);
  assert.equal(cursors.blocks, "done");
  assert.equal(advance({}, "likes", [], 3).likes, "done");
  // The input is not changed in place, so a failed page leaves the saved cursor where it was.
  const before = { blocks: "users/u0/blocks/x" };
  advance(before, "blocks", page, 3);
  assert.deepEqual(before, { blocks: "users/u0/blocks/x" });
});

test("the backfill is done only when every phase is", () => {
  assert.deepEqual([...BACKFILL_PHASES], ["blocks", "bookmarks", "likes"]);
  assert.equal(backfillDone({ blocks: "done", bookmarks: "done" }), false);
  assert.equal(backfillDone({ blocks: "done", bookmarks: "done", likes: "users/a/likes/b" }), false);
  assert.equal(backfillDone({ blocks: "done", bookmarks: "done", likes: "done" }), true);
  assert.equal(backfillDone(undefined), false);
});
