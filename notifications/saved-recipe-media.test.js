const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const models=fs.readFileSync('app/src/main/java/com/chefvoice/app/model/Models.kt','utf8');
const repo=fs.readFileSync('app/src/main/java/com/chefvoice/app/data/RecipeRepository.kt','utf8');
const ui=fs.readFileSync('app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt','utf8');
const state=fs.readFileSync('app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt','utf8');
const cloud=fs.readFileSync('app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt','utf8');

test('Android saved recipe media uses stable step ids and supports photo/video edit controls',()=>{
  assert.match(models,/val stepIds: List<String>/);assert.match(models,/val stepId: String = ""/);
  assert.match(ui,/Text\(if \(mediaEditMode\) "Done" else "Edit recipe"\)/);
  assert.match(ui,/PickVisualMedia\.ImageOnly/);assert.match(ui,/PickVisualMedia\.VideoOnly/);
  assert.match(ui,/pickPhoto\(stepId\)/);assert.match(ui,/pickVideo\(stepId\)/);
});

test('Android step media metadata persists locally and in published recipe documents',()=>{
  assert.match(repo,/put\("stepIds"/);assert.match(repo,/put\("stepId", attachment\.stepId\)/);
  assert.match(cloud,/"stepIds" to stableStepIds\(\)/);assert.match(cloud,/"stepId" to it\.stepId/);
  assert.match(cloud,/caption/);
});

test('public media edits stay local until explicit Update Community',()=>{
  assert.match(models,/communityUpdatePending/);
  assert.match(state,/Tap Update Community/);assert.match(ui,/Text\("🌎 Update Community"\)/);
  assert.match(cloud,/communityUpdatePending = pending/);
  assert.match(cloud,/remoteUrl\.isBlank\(\) && it\.path\.isNotBlank\(\)/);
});
