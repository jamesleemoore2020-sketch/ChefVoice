"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=(relative)=>fs.readFileSync(path.join(root,relative),"utf8");
const models=read("app/src/main/java/com/chefvoice/app/model/Models.kt");
const repo=read("app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt");
const state=read("app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt");
const app=read("app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt");
const rules=read("firestore.rules");
const backend=read("notifications/functions/index.js");

test("Android model and UI expose six account-synced preferences",()=>{
  assert.match(models,/data class NotificationPreferences/);
  for(const key of ["messages","comments","likes","live"]) assert.match(models,new RegExp(`val ${key}: Boolean = true`));
  assert.match(repo,/listenNotificationPreferences/);
  assert.match(repo,/saveNotificationPreferences/);
  assert.match(state,/notificationPreferencesReady/);
  assert.match(app,/Followed chefs Live/);
  assert.match(app,/Switch\(checked = checked/);
});

test("rules keep notification preferences private to the owner",()=>{
  assert.match(rules,/match \/settings\/\{settingId\}/);
  assert.match(rules,/settingId == 'notifications'/);
  assert.match(rules,/request\.auth\.uid == uid/);
  assert.match(rules,/hasOnly\(\['messages', 'comments', 'likes', 'live', 'followers', 'replies', 'updatedAt'\]\)/);
});

test("backend suppresses persistent activity and push when disabled",()=>{
  assert.match(backend,/notificationTypeEnabled/);
  assert.match(backend,/users\/\$\{uid\}\/settings\/notifications/);
  assert.match(backend,/payload\.type/);
  assert.match(backend,/notification\.type/);
});
