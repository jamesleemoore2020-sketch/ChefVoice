const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt'),'utf8');
const state=fs.readFileSync(path.join(root,'app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt'),'utf8');
const repo=fs.readFileSync(path.join(root,'app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt'),'utf8');
const gradle=fs.readFileSync(path.join(root,'app/build.gradle.kts'),'utf8');
function ok(name,condition){if(!condition){console.error('FAIL:',name);process.exitCode=1;}else console.log('PASS:',name)}
ok('Android v0.10.1 version',/versionCode = 52/.test(gradle)&&/versionName = "0\.10\.1"/.test(gradle));
ok('Community is photo-first',/height\(360\.dp\)/.test(app)&&/Alignment\.TopStart/.test(app)&&/onChefProfile\(recipe\.authorId\)/.test(app));
ok('Public Chef Profile exists',/private fun PublicChefProfileScreen\(/.test(app)&&/Finished dishes/.test(app)&&/Watch Live/.test(app));
ok('Follower identities remain private',/Follower identities are not exposed here/.test(app)&&!/FollowerListScreen|FollowingListScreen/.test(app));
ok('Follower count is backend-maintained and identity-private',/getLong\("followerCount"\)/.test(repo)&&!/AggregateSource\.SERVER/.test(repo));
ok('Live follow/reactions are overlayed',/Alignment\.TopEnd/.test(app)&&/Alignment\.CenterEnd/.test(app)&&/toggleFollowUid\(appState\.selectedLiveSession!!\.hostId\)/.test(app)&&/onReact/.test(app));
ok('Live hub favors followed hosts',/sortedWith\(compareByDescending<LiveSession> \{ isFollowing\(it\.hostId\) \}/.test(app));
ok('Public profile routes recipes and live',/openRecipeFromChefProfile/.test(state)&&/activeLiveFor/.test(state));
if(process.exitCode) process.exit(process.exitCode); else console.log('All social layout gates passed.');
