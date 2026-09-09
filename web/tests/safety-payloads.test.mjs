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

test('conversation and message payloads match their rules', () => {
  const conversationRule = ruleBlock('match /conversations/{conversationId}');
  for (const key of ['participantIds', 'participantNames', 'lastMessage', 'lastSenderId', 'createdAt', 'updatedAt']) {
    assert.ok(conversationRule.includes(`'${key}'`), `the conversations rule no longer lists ${key}`);
  }
  // lastMessage/lastSenderId must be empty on create; backend triggers fill them.
  assert.ok(conversationRule.includes("lastMessage == ''"));
  assert.ok(conversationRule.includes("lastSenderId == ''"));
  assert.ok(/lastMessage:\s*''/.test(clientSource) && /lastSenderId:\s*''/.test(clientSource),
    'startConversation must create with empty preview metadata');

  const messageRule = ruleBlock('match /messages/{messageId}');
  assert.ok(messageRule.includes("hasOnly(['senderId', 'senderName', 'text', 'createdAt'])"),
    'the messages rule key set changed');
  assert.ok(messageRule.includes('text.size() <= 2000'));
  assert.ok(/slice\(0,\s*2000\)/.test(clientSource), 'message text must be capped at the 2000 chars the rule allows');
});

test('the conversation id is the two uids sorted and joined, as the rule expects', () => {
  // conversationIdMatchesParticipants accepts either order, but sorting keeps one
  // canonical id so both chefs land in the same document.
  assert.ok(/\[uidA,uidB\]\.sort\(\)\.join\('--'\)/.test(clientSource.replace(/\s+/g, '')),
    'conversationIdFor must sort both uids');
  assert.ok(/\[user\.uid,targetUid\]\.sort\(\)/.test(clientSource.replace(/\s+/g, '')),
    'startConversation must sort participant ids');
});

test('threaded replies carry only the three extra keys the comment rule allows', () => {
  const rule = ruleBlock('function validRecipeCommentCreate');
  for (const key of ['parentCommentId', 'replyToUid', 'replyToName']) {
    assert.ok(rule.includes(`'${key}'`), `the comment rule no longer lists ${key}`);
    assert.ok(clientSource.includes(`payload.${key}`), `addComment no longer sets ${key} on a reply`);
  }
  assert.ok(rule.includes('text.size() <= 800'));
  assert.ok(/slice\(0,\s*800\)/.test(clientSource), 'comment text must be capped at 800 chars');
});

test('read markers and notification updates only ever move forward', () => {
  const readsRule = ruleBlock('match /messageReads/{conversationId}');
  assert.ok(readsRule.includes('lastReadAt >= resource.data.lastReadAt'),
    'the messageReads rule no longer enforces monotonic read markers');
  assert.ok(readsRule.includes("hasOnly(['conversationId', 'lastReadAt'])"));

  const notificationsRule = ruleBlock('match /notifications/{notificationId}');
  // Records are backend-created; the client may only advance readAt.
  assert.ok(notificationsRule.includes('allow create: if false'));
  assert.ok(notificationsRule.includes("hasOnly(['readAt'])"));
  assert.ok(/updateDoc\(doc\(db,'users',user\.uid,'notifications',notificationId\),\{readAt:/.test(clientSource.replace(/\s+/g, '')),
    'markNotificationRead must touch only readAt');
});

test('client writes never touch the backend-maintained recipe counters', () => {
  // validOwnerRecipeUpdate requires likes and commentCount to be unchanged, and
  // only lets the author update the recipe at all. Writing either from the client
  // failed the whole batch and broke liking and commenting outright.
  const compact = clientSource.replace(/\s+/g, '');
  assert.ok(!compact.includes('likes:increment') && !compact.includes('commentCount:increment'),
    'the client must not increment recipe counters');
  assert.ok(!/tx\.update\(recipeRef/.test(compact), 'toggleLike must not update the recipe document');
  assert.ok(!/batch\.update\(recipeRef/.test(compact), 'addComment must not update the recipe document');
});

test('a chef cannot block themselves, matching the rule', () => {
  assert.ok(ruleBlock('match /blocks/{blockedUid}').includes('blockedUid != uid'));
  assert.ok(/blockedUid===user\.uid|blockedUid === user\.uid/.test(clientSource),
    'setUserBlocked must reject blocking yourself before the rule does');
});
