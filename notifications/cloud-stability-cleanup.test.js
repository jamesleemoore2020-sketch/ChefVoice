"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt');
const state=read('app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt');
const repo=read('app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt');
const rules=read('firestore.rules');
const functions=read('notifications/functions/index.js');

test('notification history can be cleared by its owner and is bounded server-side',()=>{
  assert.match(app,/Clear read notifications/);
  assert.match(state,/fun clearReadNotifications\(\)/);
  assert.match(repo,/fun deleteNotifications\(notificationIds: Collection<String>/);
  assert.match(rules,/allow create: if false/);
  assert.match(rules,/allow delete: if signedIn\(\) && request\.auth\.uid == uid/);
  assert.match(functions,/NOTIFICATION_RETENTION_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(functions,/NOTIFICATION_PRUNE_BATCH = 50/);
  assert.match(functions,/pruneOldNotifications/);
});

test('current rules/functions include all cumulative social-foundation permissions and triggers',()=>{
  assert.match(rules,/followers', 'replies'/);
  assert.match(rules,/match \/reports\/\{reportId\}/);
  assert.match(rules,/parentCommentId/);
  assert.match(functions,/exports\.notifyNewFollower/);
  assert.match(functions,/exports\.notifyCommentReply/);
});

test('Android public legacy recipe deletion attempts cloud first and keeps local copy on failure',()=>{
  assert.match(state,/val hasCloudCopy = recipe\.isPublic \|\| recipe\.authorId\.isNotBlank\(\)/);
  const deleteIndex=state.indexOf('cloud.deleteCloudRecipe(recipe.id)');
  const removeIndex=state.indexOf('recipes.removeAll { it.id == recipe.id }');
  assert.notEqual(deleteIndex,-1);
  assert.notEqual(removeIndex,-1);
  assert.ok(deleteIndex<removeIndex || state.indexOf('fun removeLocalAfterCloudSuccess()', state.indexOf('fun deleteRecipe')) < deleteIndex);
  assert.match(state,/The copy on this phone was kept/);
});


test('legacy orphan recipe recovery uses a read-only cloud preflight without widening list access',()=>{
  assert.match(rules,/allow get: if \(signedIn\(\) && !exists\(\/databases\/\$\(database\)\/documents\/recipes\/\$\(recipeId\)\)\)/);
  assert.match(rules,/allow list: if resource\.data\.isPublic == true \|\| ownsExistingRecipe\(\)/);
  assert.match(repo,/data class CloudRecipeMutationCheck/);
  assert.match(repo,/fun inspectRecipeForMutation\(recipeId: String/);
  assert.match(repo,/if \(!snapshot\.exists\(\)\)/);
  assert.match(state,/cloud\.inspectRecipeForMutation\(recipe\.id\)/);
  assert.match(state,/!check\.exists -> removeLocalAfterCloudSuccess/);
  assert.match(state,/!check\.exists -> keepPrivate/);
  assert.match(state,/check\.authorId != signedInUserId/);
});
