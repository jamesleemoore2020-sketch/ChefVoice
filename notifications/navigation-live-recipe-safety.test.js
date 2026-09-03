const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Android v0.9.5 system Back unwinds ChefVoice before app exit',()=>{
  const app=read('app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt');
  assert.match(app,/BackHandler\(/);
  assert.match(app,/fun requestAppBack\(\)/);
  assert.match(app,/selectedConversation != null -> appState\.closeConversation\(\)/);
  assert.match(app,/selectedRecipe != null -> appState\.closeRecipe\(\)/);
  assert.match(app,/selectedChefUid\.isNotBlank\(\) -> appState\.closeChefProfile\(\)/);
  assert.match(app,/tabHistory\.removeAt\(tabHistory\.lastIndex\)/);
});

test('Android active host cannot silently leave Live and backgrounding ends host state',()=>{
  const app=read('app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt');
  const state=read('app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt');
  assert.match(app,/Text\("End Live & Leave"\)/);
  assert.match(app,/Text\("Stay Live"\)/);
  assert.match(app,/Lifecycle\.Event\.ON_STOP/);
  assert.match(app,/endLiveForSafety\("Live ended because ChefVoice left the foreground\. Camera and microphone are off\."\)/);
  assert.match(state,/selectedLiveSession = ended/);
  assert.ok(state.indexOf('selectedLiveSession = ended') < state.indexOf('cloud.endLiveSession(session.id)'));
});

test('Android cloud recipe delete is cloud-first and preserves local copy on failure',()=>{
  const state=read('app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt');
  const start=state.indexOf('fun deleteRecipe(recipe: Recipe)');
  const end=state.indexOf('\n    fun publish(',start);
  const block=state.slice(start,end);
  assert.match(block,/cloud\.deleteCloudRecipe\(recipe\.id\) \{ error ->[\s\S]*if \(error != null\)[\s\S]*else removeLocalAfterCloudSuccess\(\)/);
  assert.match(block,/The copy on this phone was kept/);
  assert.match(state,/Removed from Community and kept private in Recipes\./);
});
