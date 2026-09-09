import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// firestore.rules pins the exact write shape for blocks and reports: an exact key
// set, a bounded reason, a fixed initial status, and a client clock within five
// minutes of the server's. A drift here is a permission-denied for the chef at
// best and a moderation gap at worst, and it cannot be caught by the parser tests.
// These are source-text gates in the same spirit as billing/launch-access.test.js.

const clientSource = readFileSync(new URL('../js/firebase-client.js', import.meta.url), 'utf8');
const rulesSource = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

function ruleBlock(header) {
  const start = rulesSource.indexOf(header);
  assert.notEqual(start, -1, `${header} not found in firestore.rules`);
  return rulesSource.slice(start, start + 1200);
}

test('the report payload carries exactly the keys firestore.rules allows', () => {
  const rule = ruleBlock('match /reports/{reportId}');
  const allowed = ['reporterUid', 'targetType', 'targetId', 'targetUid', 'contextId', 'reason', 'createdAt', 'status'];
  for (const key of allowed) {
    assert.ok(rule.includes(`'${key}'`), `firestore.rules no longer lists ${key}`);
    assert.ok(new RegExp(`\\b${key}\\s*:`).test(clientSource), `reportContent no longer writes ${key}`);
  }
});

test('reports are opened with status open and a bounded reason', () => {
  // The rule requires status == 'open' on create; moderation state moves only
  // through the moderator-only callable.
  assert.ok(ruleBlock('match /reports/{reportId}').includes("status == 'open'"));
  assert.ok(/status:\s*'open'/.test(clientSource), 'reportContent must open reports with status open');
  assert.ok(/slice\(0,\s*500\)/.test(clientSource), 'the report reason must be capped at the 500 chars the rule allows');
  assert.ok(/'Safety concern'/.test(clientSource), 'an empty reason must fall back rather than fail the rule');
});

test('only the five target types the rule accepts can be reported', () => {
  const rule = ruleBlock('match /reports/{reportId}');
  for (const type of ['user', 'recipe', 'comment', 'reply', 'message']) {
    assert.ok(rule.includes(`'${type}'`), `firestore.rules no longer accepts target type ${type}`);
    assert.ok(clientSource.includes(`'${type}'`), `REPORT_TARGET_TYPES no longer offers ${type}`);
  }
});

test('the block payload carries exactly the two keys the rule allows', () => {
  const rule = ruleBlock('match /blocks/{blockedUid}');
  assert.ok(rule.includes("hasOnly(['blockedUid', 'createdAt'])"), 'the blocks rule key set changed');
  // setDoc writes {blockedUid, createdAt} and nothing else -- a third field is a
  // permission denial, not a silently ignored extra.
  const compact = clientSource.replace(/\s+/g, '');
  assert.ok(compact.includes('setDoc(target,{blockedUid,createdAt:Date.now()})'),
    'the block write shape no longer matches the rule');
});

test('a chef cannot block themselves, matching the rule', () => {
  assert.ok(ruleBlock('match /blocks/{blockedUid}').includes('blockedUid != uid'));
  assert.ok(/blockedUid===user\.uid|blockedUid === user\.uid/.test(clientSource),
    'setUserBlocked must reject blocking yourself before the rule does');
});
