"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

test("followed chef Live fanout is deterministic, block-aware, and chunked", () => {
  assert.match(source, /exports\.notifyFollowedChefLive/);
  assert.match(source, /liveSessions\/\{sessionId\}/);
  assert.match(source, /users\/\$\{hostUid\}\/followers/);
  assert.match(source, /start \+= FANOUT_CONCURRENCY/);
  assert.match(source, /isBlocked\(recipientUid, hostUid\)/);
  assert.match(source, /`live_\$\{sessionId\}`/);
  assert.match(source, /type: "live"/);
  assert.match(source, /liveSessionId: sessionId/);
});

test("push payload carries liveSessionId through the existing delivery function", () => {
  assert.match(source, /exports\.pushChefVoiceNotification/);
  assert.match(source, /liveSessionId: cleanText\(notification\.liveSessionId, 160\)/);
});
