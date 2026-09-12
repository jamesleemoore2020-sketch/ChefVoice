const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const gradle=read('app/build.gradle.kts'),manifest=read('app/src/main/AndroidManifest.xml'),paths=read('app/src/main/res/xml/file_paths.xml');
const repo=read('app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt'),state=read('app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt'),ui=read('app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt');
const rules=read('firestore.rules'),storageRules=read('storage.rules'),functions=read('notifications/functions/index.js'),bootstrap=read('tools/gradle-bootstrap.ps1'),unix=read('gradlew');
test('Production Trust candidate is Android v0.11.3 code 63',()=>{assert.match(gradle,/versionCode = 63/);assert.match(gradle,/versionName = "0.11.3"/);});
test('Android backup cleartext and FileProvider scope are hardened',()=>{assert.match(manifest,/android:allowBackup="false"/);assert.match(manifest,/android:fullBackupContent="false"/);assert.match(manifest,/android:usesCleartextTraffic="false"/);assert.doesNotMatch(paths,/path="\."/);assert.match(paths,/path="media\/"/);assert.match(paths,/path="voice\/"/);});
test('Android exposes reset verification deletion and moderator report lifecycle',()=>{for(const x of [/sendPasswordReset/,/sendVerificationEmail/,/checkModeratorAccess/,/listenModerationReports/,/moderateReport/,/deleteChefVoiceAccount/])assert.match(repo,x);assert.match(state,/moderatorAccess/);assert.match(ui,/Safety moderation/);assert.match(ui,/Confirm permanent cloud deletion/);});
test('account deletion has an in-app re-authentication path for the stale-auth_time gate',()=>{assert.match(repo,/reauthenticateAndDeleteChefVoiceAccount/);assert.match(repo,/getIdToken\(true\)/);assert.match(state,/needsReauthForDelete/);assert.match(state,/confirmAccountDeletionWithPassword/);assert.match(ui,/enter your password to confirm this is you/);});
test('moderation is callable/custom-claim owned and report direct update remains denied',()=>{assert.match(functions,/moderateChefVoiceReport/);assert.match(functions,/request\.auth\?\.token\?\.admin/);assert.match(rules,/allow update, delete: if false;/);});
test('account deletion requires recent auth and preserves only local cooking data',()=>{assert.match(functions,/auth_time/);assert.match(functions,/deleteIncomingBlockReferences/);assert.match(functions,/collectionGroup\("notifications"\).*actorUid/s);assert.match(functions,/getAuth\(\)\.deleteUser\(uid\)/);assert.match(functions,/localCookingDataPreserved: true/);});
test('Gradle bootstrap is version-pinned and SHA-256 verified on Windows and Unix',()=>{const sha='553c78f50dafcd54d65b9a444649057857469edf836431389695608536d6b746';assert.match(bootstrap,new RegExp(sha));assert.match(bootstrap,/Get-FileHash/);assert.match(unix,new RegExp(sha));assert.match(unix,/sha256sum/);});
test('bookmark records include recipeId for lifecycle cleanup',()=>{assert.match(repo,/"recipeId" to recipeId, "createdAt"/);assert.match(rules,/match \/bookmarks\/\{recipeId\}[\s\S]*request\.resource\.data\.recipeId == recipeId/);});

test('direct root-profile deletion is disabled so cloud account cleanup is authoritative',()=>{assert.match(rules,/match \/users\/\{uid\}[\s\S]*allow delete: if false;/);assert.match(functions,/deleteChefVoiceAccount/);});
test('public recipe media requires an existing recipe owned by the signer',()=>{assert.match(storageRules,/function recipeOwnedBy\(uid, recipeId\)/);assert.match(storageRules,/match \/recipes\/\{uid\}\/\{recipeId\}\/publicMedia\/\{fileName\}[\s\S]*recipeOwnedBy\(uid, recipeId\)/);});
test('private Cook & Capture audio is owned-by-signer but does not require a published recipe doc',()=>{assert.match(storageRules,/function privateRecipeOwnedBy\(uid, recipeId\)/);assert.match(storageRules,/!firestore\.exists\(\/databases\/\(default\)\/documents\/recipes\/\$\(recipeId\)\)/);assert.match(storageRules,/match \/privateVoice\/\{uid\}\/\{recipeId\}\/\{fileName\}[\s\S]*privateRecipeOwnedBy\(uid, recipeId\)/);assert.match(storageRules,/match \/recipes\/\{uid\}\/\{recipeId\}\/voice\/\{fileName\}[\s\S]*privateRecipeOwnedBy\(uid, recipeId\)/);});

test('signed release pipeline rejects debug certificates and has no source-controlled signing fallback',()=>{
  const prod=read('tools/BuildProductionTrust.ps1');
  assert.match(prod,/assembleRelease/);assert.match(prod,/apksigner.*verify/s);assert.match(prod,/Android Debug/);
  assert.match(gradle,/CHEFVOICE_RELEASE_STORE_FILE/);assert.match(gradle,/getByName\("release"\)[\s\S]*isDebuggable = false/);
  assert.doesNotMatch(gradle,/storePassword\s*=\s*["'][^"']+["']/);
  // Unset CHEFVOICE_RELEASE_* used to leave Gradle reporting BUILD SUCCESSFUL with an
  // unsigned artifact; the release packaging tasks must refuse to run instead.
  assert.match(gradle,/releaseArtifactTasks[\s\S]*doFirst[\s\S]*UNSIGNED/);
});
test('Android uses backend storage permits for fixed upload slots',()=>{
  assert.match(repo,/authorizeStorageUpload\("public_media"/);assert.match(repo,/authorizeStorageUpload\(permitKind/);
  assert.match(repo,/metadataWithPermit/);assert.match(storageRules,/function uploadPermit\(/);
  assert.match(storageRules,/function validPublicMedia\(\)/);assert.match(storageRules,/validVoiceSlot\(fileName\)/);
});
test('follower cleanup is deletion-safe and account deletion sweeps recipe-side likes',()=>{
  assert.match(functions,/async function syncFollowerCount\(uid\)[\s\S]*if \(\!user\.exists\) return 0;[\s\S]*userRef\.update\(\{ followerCount: count \}\)/);
  assert.match(functions,/async function deleteUserLikes\(uid\)[\s\S]*collection\("recipes"\)[\s\S]*collection\("likes"\)\.doc\(uid\)/);
});
