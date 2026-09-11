const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const models=fs.readFileSync('app/src/main/java/com/chefvoice/app/model/Models.kt','utf8');
const repo=fs.readFileSync('app/src/main/java/com/chefvoice/app/data/RecipeRepository.kt','utf8');
const cloud=fs.readFileSync('app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt','utf8');
const ui=fs.readFileSync('app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt','utf8');
const state=fs.readFileSync('app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt','utf8');
const gradle=fs.readFileSync('app/build.gradle.kts','utf8');

test('Android v0.10.7 stores optional prep and cook time metadata without changing Method steps',()=>{
  assert.match(gradle,/versionCode = 59/);assert.match(gradle,/versionName = "0\.10\.7"/);
  assert.match(models,/val prepTimeMinutes: Int = 0/);assert.match(models,/val cookTimeMinutes: Int = 0/);
  assert.match(repo,/put\("prepTimeMinutes", prepTimeMinutes\)/);assert.match(repo,/put\("cookTimeMinutes", cookTimeMinutes\)/);
  assert.match(cloud,/"prepTimeMinutes" to prepTimeMinutes/);assert.match(cloud,/"cookTimeMinutes" to cookTimeMinutes/);
});

test('owners can edit prep and cook times after save and public edits wait for Update Community',()=>{
  assert.match(ui,/Text\("Prep min"\)/);assert.match(ui,/Text\("Cook min"\)/);assert.match(ui,/Text\(if \(mediaEditMode\) "Done" else "Edit recipe"\)/);
  assert.match(state,/fun updateRecipeTimes/);assert.match(state,/communityUpdatePending = current\.isPublic \|\| current\.communityUpdatePending/);
  assert.match(state,/Prep\/cook times saved on this phone\. Tap Update Community/);
});
