"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(root,"app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt"),"utf8");

function notificationScreen(){
  const start=app.indexOf("private fun NotificationsScreen(");
  const end=app.indexOf("private fun ConversationScreen(",start);
  assert.ok(start>=0&&end>start,"NotificationsScreen should exist");
  return app.slice(start,end);
}

test("Android Notifications collapses settings by default",()=>{
  const src=notificationScreen();
  assert.match(src,/remember \{ mutableStateOf\(false\) \}/);
  assert.match(src,/Text\("Notification settings"/);
  assert.match(src,/clickable \{ settingsExpanded = !settingsExpanded \}/);
  assert.match(src,/if \(settingsExpanded\) \{/);
  assert.match(src,/Followed chefs Live/);
});

test("Android Notifications removes redundant Community and Profile buttons",()=>{
  const src=notificationScreen();
  assert.doesNotMatch(src,/OutlinedButton\(onClick = onCommunity/);
  assert.doesNotMatch(src,/Button\(onClick = onProfile/);
  assert.doesNotMatch(src,/onCommunity: \(\) -> Unit/);
  assert.doesNotMatch(src,/onProfile: \(\) -> Unit/);
  assert.match(src,/Sign in from the Profile tab/);
});

test("Notifications call site no longer passes duplicate navigation callbacks",()=>{
  const start=app.indexOf("Tab.NOTIFICATIONS -> NotificationsScreen(");
  const end=app.indexOf("Tab.LIVE ->",start);
  const call=app.slice(start,end);
  assert.doesNotMatch(call,/onCommunity\s*=/);
  assert.doesNotMatch(call,/onProfile\s*=/);
  assert.match(call,/onMarkAllRead = appState::markAllNotificationsRead/);
});
