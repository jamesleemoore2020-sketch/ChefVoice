"use strict";
// Account deletion must not leave records keyed by the deleted account behind. Deleting
// users/{uid} does not delete its subcollections, so each one has to be named; the
// entitlement and purchase records were not, and outlived every deleted account while the
// deletion page said the account was gone. Source-text gates, like the rest of this folder:
// they cannot run the callable, but they catch the list drifting from the rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const rules = read("firestore.rules");
const functions = read("notifications/functions/index.js");

function block(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `${header} not found`);
  let index = source.indexOf("{", start + header.length - 1);
  let depth = 0;
  for (; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) break;
  }
  return source.slice(start, index + 1);
}

const declared = [...block(rules, "match /users/{uid} {").matchAll(/match \/([A-Za-z]+)\/\{/g)]
  .map((m) => m[1])
  .filter((name) => name !== "users");

const listed = (() => {
  const match = functions.match(/const ACCOUNT_SUBCOLLECTIONS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "ACCOUNT_SUBCOLLECTIONS must be declared as a frozen array literal");
  return [...match[1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
})();

const deletion = functions.slice(functions.indexOf("exports.deleteChefVoiceAccount"), functions.indexOf("exports.deleteChefVoiceRecipe"));

test("account deletion clears every users/{uid} subcollection the rules declare", () => {
  assert.ok(declared.length >= 11, `expected the rules to declare the user subcollections, found ${declared.join(", ")}`);
  for (const name of declared) assert.ok(listed.includes(name), `users/{uid}/${name} is declared in firestore.rules but never deleted with the account`);
  // The backend-only ones the storage permits use.
  for (const name of ["privateOperations", "storageUploadPermits"]) assert.ok(listed.includes(name));
  assert.match(deletion, /for \(const name of ACCOUNT_SUBCOLLECTIONS\)/);
});

test("account deletion removes the billing and usage records kept outside users/{uid}", () => {
  assert.match(deletion, /db\.doc\(`importUsage\/\$\{uid\}`\)\.delete\(\)/);
  assert.match(deletion, /deleteQueryInBatches\(db\.collection\("purchaseTokens"\)\.where\("uid", "==", uid\)\)/);
});

test("the moderation trail is pseudonymized with the same identity as reports", () => {
  assert.match(deletion, /db\.collection\(MODERATION_EVENTS_COLLECTION\)\.where\("targetUid", "==", uid\)/);
  const moderated = deletion.slice(deletion.indexOf("MODERATION_EVENTS_COLLECTION"));
  assert.match(moderated, /targetUid: pseudonym/);
  // Reports and events must share one pseudonym or the audit trail no longer lines up.
  assert.equal((deletion.match(/const pseudonym = deletedIdentity\(uid\);/g) || []).length, 1);
});
