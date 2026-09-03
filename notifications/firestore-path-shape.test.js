/**
 * Firestore path parity gate.
 *
 * Documents need an even number of path segments and collections an odd number.
 * Two paths in this codebase had the wrong parity and threw before ever reaching
 * the network: db.doc("moderation/userRestrictions/{uid}") (3 segments) broke every
 * profile-photo and public-media upload, and db.collection("moderation/events")
 * (2 segments) broke every moderation action. Both were invisible to the other
 * gates, because a string match cannot tell you a path is malformed.
 *
 * This checks the shape of every literal Firestore path in the backend and in both
 * rules files. It is deliberately conservative: anything it cannot resolve
 * statically is skipped rather than guessed at.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const functionsSource = read("notifications/functions/index.js");
const firestoreRules = read("firestore.rules");
const storageRules = read("storage.rules");

/** Template placeholders and rules variables each stand for exactly one segment. */
function segmentCount(literal) {
  return literal
    .replace(/\$\{[^}]*\}/g, "X")
    .replace(/\$\([^)]*\)/g, "X")
    .split("/")
    .filter((segment) => segment.length > 0).length;
}

/** Resolves `function name(...) { return `a/b/${x}`; }` helpers to their literal. */
function pathHelpers(source) {
  const helpers = new Map();
  const re = /function\s+(\w*[Pp]ath)\s*\([^)]*\)\s*\{\s*return\s*`([^`]+)`/g;
  let match;
  while ((match = re.exec(source)) !== null) helpers.set(match[1], match[2]);
  return helpers;
}

/** Resolves `const NAME = "literal";` collection constants. */
function stringConstants(source) {
  const constants = new Map();
  const re = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"\s*;/g;
  let match;
  while ((match = re.exec(source)) !== null) constants.set(match[1], match[2]);
  return constants;
}

/**
 * Substitutes known string constants into a template literal. Without this a path
 * built as `${RESTRICTIONS_COLLECTION}/${uid}` counts as two segments no matter what
 * the constant holds, and a constant containing a slash slips straight through.
 */
function expandConstants(literal, constants) {
  return literal.replace(/\$\{(\w+)\}/g, (whole, name) =>
    constants.has(name) ? constants.get(name) : whole
  );
}

function resolveArgument(argument, helpers, constants) {
  const trimmed = argument.trim();
  const literal = trimmed.match(/^[`"']([^`"']*)[`"']$/);
  if (literal) return expandConstants(literal[1], constants);

  const helperCall = trimmed.match(/^(\w+)\s*\(/);
  if (helperCall && helpers.has(helperCall[1])) {
    return expandConstants(helpers.get(helperCall[1]), constants);
  }

  if (constants.has(trimmed)) return constants.get(trimmed);

  return null; // Not statically resolvable; not our business.
}

function collectCalls(source, method) {
  const helpers = pathHelpers(source);
  const constants = stringConstants(source);
  const results = [];
  const re = new RegExp(`\\bdb\\.${method}\\(([^()]*(?:\\([^()]*\\))?[^()]*)\\)`, "g");
  let match;
  while ((match = re.exec(source)) !== null) {
    const resolved = resolveArgument(match[1], helpers, constants);
    if (resolved !== null) results.push({ raw: match[1].trim(), path: resolved });
  }
  return results;
}

test("every resolvable db.doc() path names a document (even segment count)", () => {
  const calls = collectCalls(functionsSource, "doc");
  assert.ok(calls.length > 0, "no db.doc() calls were resolved; the extractor is broken");
  for (const call of calls) {
    const count = segmentCount(call.path);
    assert.equal(
      count % 2,
      0,
      `db.doc(${call.raw}) resolves to "${call.path}" with ${count} segments. ` +
        "Document paths need an even number of segments."
    );
  }
});

test("every resolvable db.collection() path names a collection (odd segment count)", () => {
  const calls = collectCalls(functionsSource, "collection");
  assert.ok(calls.length > 0, "no db.collection() calls were resolved; the extractor is broken");
  for (const call of calls) {
    const count = segmentCount(call.path);
    assert.equal(
      count % 2,
      1,
      `db.collection(${call.raw}) resolves to "${call.path}" with ${count} segments. ` +
        "Collection paths need an odd number of segments."
    );
  }
});

test("every get()/exists() path in firestore.rules names a document", () => {
  const re = /\/databases\/\$\(database\)\/documents\/([^;)\s]+)/g;
  const seen = [];
  let match;
  while ((match = re.exec(firestoreRules)) !== null) seen.push(match[1]);
  assert.ok(seen.length > 0, "no rules document paths were found; the extractor is broken");
  for (const found of seen) {
    const count = segmentCount(found);
    assert.equal(
      count % 2,
      0,
      `firestore.rules reads "${found}" (${count} segments). get()/exists() need a document path.`
    );
  }
});

test("every firestore.get()/exists() path in storage.rules names a document", () => {
  const re = /\/databases\/\(default\)\/documents\/([^;)\s]+)/g;
  const seen = [];
  let match;
  while ((match = re.exec(storageRules)) !== null) seen.push(match[1]);
  assert.ok(seen.length > 0, "no storage rules document paths were found; the extractor is broken");
  for (const found of seen) {
    const count = segmentCount(found);
    assert.equal(
      count % 2,
      0,
      `storage.rules reads "${found}" (${count} segments). firestore.get()/exists() need a document path.`
    );
  }
});

test("restriction records use one path across the backend and both rules files", () => {
  const helpers = pathHelpers(functionsSource);
  const constants = stringConstants(functionsSource);
  assert.ok(helpers.has("restrictionPath"), "restrictionPath() helper is missing from index.js");
  const collection = expandConstants(helpers.get("restrictionPath"), constants).split("/")[0];
  assert.ok(
    /^[A-Za-z][A-Za-z0-9_]*$/.test(collection),
    `restrictionPath() starts with "${collection}", which does not resolve to a literal collection name`
  );
  assert.match(
    firestoreRules,
    new RegExp(`documents/${collection}/\\$\\(uid\\)`),
    `firestore.rules does not read restrictions from "${collection}"`
  );
  assert.match(
    storageRules,
    new RegExp(`documents/${collection}/\\$\\(uid\\)`),
    `storage.rules does not read restrictions from "${collection}"`
  );
});
