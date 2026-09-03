"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const models = read("app/src/main/java/com/chefvoice/app/model/Models.kt");
const repo = read("app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt");
const state = read("app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt");
const app = read("app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt");
const helper = read("app/src/main/java/com/chefvoice/app/notifications/NotificationHelper.kt");
const service = read("app/src/main/java/com/chefvoice/app/notifications/ChefVoiceMessagingService.kt");
const activity = read("app/src/main/java/com/chefvoice/app/MainActivity.kt");

test("Android notification model has a dedicated liveSessionId", () => {
  assert.match(models, /val liveSessionId: String = ""/);
  assert.match(repo, /liveSessionId = data\["liveSessionId"\]\.asString\(\)/);
});

test("in-app Live notification opens the matching current session", () => {
  assert.match(state, /"live" ->/);
  assert.match(state, /liveSessions\.firstOrNull \{ it\.id == notification\.liveSessionId \}/);
  assert.match(state, /openLiveSession\(session\)/);
});

test("Android system Live alert carries and consumes session-aware routing metadata", () => {
  assert.match(helper, /EXTRA_LIVE_SESSION_ID/);
  assert.match(service, /liveSessionId = data\["liveSessionId"\]\.orEmpty\(\)/);
  assert.match(activity, /captureNotificationIntent/);
  assert.match(app, /LaunchedEffect\(pendingLiveSessionId, appState\.liveSessionsReady\)/);
  assert.match(app, /navigateTab\(Tab\.LIVE, rememberCurrent = false\)/);
  assert.match(app, /openLiveSession/);
});
