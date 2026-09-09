import { VoiceCapture } from './voice-capture.js';
import { parseIngredient } from './ingredient-parser.js';
import { mergeDraft, parseCookingSession } from './cooking-session-parser.js';
import {
  deleteAudioBlob, deleteRecipeMedia, loadAudioBlob, loadMediaBlob, loadRecipes,
  saveAudioBlob, saveMediaBlob, saveRecipes
} from './storage.js';
import {
  cloudRecipesRemaining, daysRemaining, FoundingAccess, FreeTierLimits, FREE_ENTITLEMENT,
  isEntitlementActive, isFounding, isPromo, PaywallTrigger, remainingLabel
} from './entitlement.js';
import * as ChefAnalytics from './chef-analytics.js';

const main=document.querySelector('#main');
const tabs=[...document.querySelectorAll('[data-tab]')];
let currentTab='cook';
let recipes=loadRecipes();
let ingredients=[];let steps=[];let transcript=[];let livePartial='';
let captureStatus='Talk naturally while you cook. ChefVoice will turn the session into an editable recipe draft.';
let audioBlob=null;let audioUrl='';let capturing=false;let media=[];
const form={title:'',description:'',servings:'2'};
const cloud={
  state:'connecting',message:'Connecting to ChefVoice Community…',api:null,user:null,profile:null,recipes:[],feedError:'',
  liked:new Set(),bookmarks:new Set(),following:new Set(),entitlement:{...FREE_ENTITLEMENT},
  unsubAuth:null,unsubFeed:null,unsubProfile:null,unsubLiked:null,unsubBookmarks:null,unsubFollowing:null,unsubComments:null,unsubEntitlement:null
};

// The single value the UI gates on. Fails closed to Free: signed out, offline, or a
// failed entitlement read all read as Free rather than accidentally unlocking Pro.
const isPro=()=>isEntitlementActive(cloud.entitlement);
const cloudRecipeCount=()=>recipes.filter(r=>r.isPublic).length;
let paywallTrigger='';

function clearUserObservers(){
  for(const key of ['unsubProfile','unsubLiked','unsubBookmarks','unsubFollowing','unsubEntitlement']){try{cloud[key]?.();}catch{} cloud[key]=null;}
  cloud.profile=null;cloud.liked=new Set();cloud.bookmarks=new Set();cloud.following=new Set();
  cloud.entitlement={...FREE_ENTITLEMENT};
}
function startUserObservers(user){
  clearUserObservers();
  if(!user||!cloud.api)return;
  cloud.unsubProfile=cloud.api.observeProfile(user.uid,p=>{cloud.profile=p;if(currentTab==='profile'||currentTab==='community'||currentTab==='recipes')render();});
  cloud.unsubEntitlement=cloud.api.observeProEntitlement(user.uid,e=>{cloud.entitlement=e;if(currentTab==='profile'||currentTab==='recipes')render();});
  cloud.unsubLiked=cloud.api.observeUserRecipeIds(user.uid,'likes',s=>{cloud.liked=s;if(currentTab==='community')render();});
  cloud.unsubBookmarks=cloud.api.observeUserRecipeIds(user.uid,'bookmarks',s=>{cloud.bookmarks=s;if(currentTab==='community')render();});
  cloud.unsubFollowing=cloud.api.observeUserRecipeIds(user.uid,'following',s=>{cloud.following=s;if(currentTab==='community')render();});
}
async function initCloud(){
  try{
    const api=await import('./firebase-client.js');
    cloud.api=api;cloud.state='ready';cloud.message='Connected to ChefVoice Firebase. Community writes are enabled.';
    cloud.unsubAuth=api.observeAuth(user=>{cloud.user=user;startUserObservers(user);if(currentTab==='profile'||currentTab==='community'||currentTab==='recipes')render();});
    cloud.unsubFeed=api.observePublicRecipes(items=>{cloud.recipes=items;cloud.feedError='';if(currentTab==='community')render();},err=>{cloud.feedError=err?.message||'Community feed could not be loaded.';if(currentTab==='community')render();});
  }catch(e){
    cloud.state='offline';cloud.message='Firebase is unavailable right now. Local cooking capture still works.';cloud.feedError=e?.message||String(e);
    if(currentTab==='profile'||currentTab==='community')render();
  }
}
initCloud();

const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
let voiceEngineUsed=false;let speechNeedsReset=false;
try{const recovery=JSON.parse(sessionStorage.getItem('chefvoice.capture.recovery')||'null');if(recovery){Object.assign(form,recovery.form||{});ingredients=recovery.ingredients||[];steps=recovery.steps||[];transcript=recovery.transcript||[];sessionStorage.removeItem('chefvoice.capture.recovery');captureStatus='Draft restored after refreshing the iPhone voice engine.';}}catch{}
document.addEventListener('play',()=>{if(isIOS&&voiceEngineUsed)speechNeedsReset=true;},true);

const escapeHtml=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));

/**
 * The single way a paywall is raised. Every caller goes through here so that
 * `paywall_shown` cannot be missed by a surface that sets the trigger directly, and
 * so the trigger recorded in analytics is always the one the chef actually saw.
 */
function showPaywall(trigger){
  if(paywallTrigger===trigger)return;
  paywallTrigger=trigger;
  ChefAnalytics.paywallShown(trigger);
  renderPaywall();
}
function dismissPaywall(){
  const trigger=paywallTrigger;
  if(!trigger)return;
  paywallTrigger='';
  ChefAnalytics.paywallDismissed(trigger);
  renderPaywall();
}
const PAYWALL_COPY={
  [PaywallTrigger.CLOUD_LIMIT]:`Free accounts sync ${FreeTierLimits.CLOUD_RECIPES} recipes to the Community. This recipe stays saved in this browser.`,
  [PaywallTrigger.VIDEO]:'Video is a Pro feature. Photos and your full cooking audio are always included on Free.',
  [PaywallTrigger.SECOND_PASS]:'Second Pass re-transcription is a Pro feature.',
  [PaywallTrigger.PROFILE]:'ChefVoice Pro removes the Free limits on Community syncing and video.'
};
function renderPaywall(){
  const host=document.querySelector('#paywall');
  if(!host)return;
  if(!paywallTrigger){host.innerHTML='';return;}
  host.innerHTML=`<div class="notice paywall"><strong>ChefVoice Pro</strong><p class="status">${escapeHtml(PAYWALL_COPY[paywallTrigger]||PAYWALL_COPY[PaywallTrigger.PROFILE])}</p><p class="hint">Purchasing is not available in the web app yet — Pro is granted through your ChefVoice account. Everything you have already cooked stays yours either way.</p><button id="dismissPaywall" class="secondary wide">Got it</button></div>`;
  document.querySelector('#dismissPaywall')?.addEventListener('click',dismissPaywall);
}
const fmt=ms=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
const chefName=()=>cloud.profile?.displayName||cloud.user?.email?.split('@')[0]||'Chef';
const cloudReady=()=>cloud.state==='ready'&&cloud.api;

const capture=new VoiceCapture({
  onSegment:s=>{transcript.push(s);renderCookDynamic();},
  onPartial:s=>{livePartial=s;renderCookDynamic();},
  onStatus:s=>{captureStatus=s;renderCookDynamic();}
});

function captureForm(){
  const title=document.querySelector('#title');if(title)form.title=title.value;
  const desc=document.querySelector('#description');if(desc)form.description=desc.value;
  const servings=document.querySelector('#servings');if(servings)form.servings=servings.value;
}
function nav(tab){captureForm();try{cloud.unsubComments?.();}catch{}cloud.unsubComments=null;currentTab=tab;tabs.forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));render();window.scrollTo({top:0,behavior:'smooth'});}
tabs.forEach(b=>b.addEventListener('click',()=>nav(b.dataset.tab)));

function cookTemplate(){
  return `
  <section class="hero" style="--hero:url('../assets/chefvoice-cover.webp')"><div class="eyebrow">Voice-first recipe capture</div><h1>Cook naturally.<br>ChefVoice listens.</h1><p>Your original chef voice is recorded while the transcript is structured into editable ingredients and method steps.</p></section>
  <div id="paywall"></div>
  <section id="captureCard"></section>
  <section class="card stack">
    <div class="field"><label for="title">Recipe name</label><input id="title" value="${escapeHtml(form.title)}" placeholder="Sunday tomato pasta"></div>
    <div class="field"><label for="description">Description / chef note</label><textarea id="description" placeholder="What makes this recipe yours?">${escapeHtml(form.description)}</textarea></div>
    <div class="field"><label for="servings">Servings</label><input id="servings" inputmode="numeric" value="${escapeHtml(form.servings)}"></div>
  </section>
  <div class="section-title"><h2>Ingredients</h2><span class="count" id="ingredientCount"></span></div><div id="ingredientList"></div>
  <div class="card"><div class="row"><input id="manualIngredient" class="grow" placeholder="e.g. two tablespoons olive oil"><button id="addIngredient" class="secondary">Add</button></div></div>
  <div class="section-title"><h2>Method</h2><span class="count" id="stepCount"></span></div><div id="stepList"></div>
  <div class="card"><textarea id="manualStep" placeholder="Add a cooking step"></textarea><button id="addStep" class="secondary wide">Add step</button></div>
  <div class="section-title"><h2>Transcript recovery</h2><span class="pill">editable safety net</span></div>
  <section class="card"><p class="hint">If iPhone speech recognition misses something, paste or correct the words here and rebuild the draft. Your recorded audio is kept separately.</p><textarea id="transcriptEditor" placeholder="Paste a transcript or correction here…">${escapeHtml(transcript.map(s=>s.text).join(' '))}</textarea><button id="reanalyze" class="secondary wide">Re-analyze transcript</button></section>
  <div class="section-title"><h2>Photos & video</h2></div>
  <section class="card"><input id="mediaInput" type="file" accept="image/*,video/*" capture="environment" multiple><p class="hint">Alpha safety caps: 25 MB per image, 200 MB per video. Files stay local until you explicitly publish.</p><div id="mediaPreview" class="media-preview"></div></section>
  <button id="saveRecipe" class="primary wide">Save recipe</button>`;
}

function renderCapture(){
  const el=document.querySelector('#captureCard');if(!el)return;
  const live=transcript.length||livePartial;
  el.innerHTML=`<div class="card capture-card"><div class="capture-head"><div class="capture-title">${capturing?'<span class="live-dot"></span>LIVE COOKING CAPTURE':'🎙 Cook & capture'}</div>${capturing?'<span class="pill">Listening</span>':''}</div><p class="status">${escapeHtml(captureStatus)}</p><p class="hint">Say things like “add two teaspoons of salt,” “half a teaspoon each of salt and pepper,” or “actually make that three cups.” ChefVoice keeps measurement evidence when recognition changes its mind.</p>${live?`<div class="transcript">${transcript.slice(-6).map(s=>`<div class="transcript-line"><time>${fmt(s.elapsedMs)}</time>${escapeHtml(s.text)}</div>`).join('')}${livePartial?`<div class="transcript-line partial">… ${escapeHtml(livePartial)}</div>`:''}</div>`:''}<div class="quality">Original microphone audio is preserved independently of the ingredient parser.</div><button id="captureBtn" class="primary wide" style="margin-top:12px">${capturing?'⏹ Finish & build recipe':'🎙 Start cooking capture'}</button></div>`;
  document.querySelector('#captureBtn')?.addEventListener('click',toggleCapture);
}
function renderIngredients(){
  const el=document.querySelector('#ingredientList');if(!el)return;
  document.querySelector('#ingredientCount').textContent=`${ingredients.length} detected`;
  el.innerHTML=ingredients.length?ingredients.map((i,n)=>`<div class="ingredient" data-ing="${n}"><input aria-label="Quantity" value="${escapeHtml(i.quantity)}" data-k="quantity"><input aria-label="Unit" value="${escapeHtml(i.unit)}" data-k="unit"><input aria-label="Ingredient name" value="${escapeHtml(i.name)}" data-k="name"><button class="icon-btn" data-remove="${n}" aria-label="Remove ingredient">×</button></div>`).join(''):'<div class="empty card">Ingredients detected from your voice will appear here.</div>';
  el.querySelectorAll('input[data-k]').forEach(input=>input.addEventListener('change',e=>{const row=e.target.closest('[data-ing]');ingredients[Number(row.dataset.ing)][e.target.dataset.k]=e.target.value;}));
  el.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{ingredients.splice(Number(b.dataset.remove),1);renderIngredients();}));
}
function renderSteps(){
  const el=document.querySelector('#stepList');if(!el)return;document.querySelector('#stepCount').textContent=`${steps.length} steps`;
  el.innerHTML=steps.length?steps.map((s,n)=>`<div class="step card"><span class="step-num">${n+1}</span><textarea data-step="${n}">${escapeHtml(s)}</textarea><button class="icon-btn" data-step-remove="${n}">×</button></div>`).join(''):'<div class="empty card">Cooking steps from your narration will appear here.</div>';
  el.querySelectorAll('[data-step]').forEach(t=>t.addEventListener('change',e=>steps[Number(e.target.dataset.step)]=e.target.value));
  el.querySelectorAll('[data-step-remove]').forEach(b=>b.addEventListener('click',()=>{steps.splice(Number(b.dataset.stepRemove),1);renderSteps();}));
}
function renderMedia(){const el=document.querySelector('#mediaPreview');if(el)el.innerHTML=media.map(m=>m.type.startsWith('video')?`<video src="${m.url}" controls></video>`:`<img src="${m.url}" alt="Recipe media">`).join('');}
function renderCookDynamic(){renderCapture();renderIngredients();renderSteps();renderMedia();}

async function toggleCapture(){
  if(capturing){
    captureStatus='Finishing capture and waiting for the last words…';renderCapture();
    const result=await capture.stop();capturing=false;audioBlob=result.audioBlob;
    if(audioUrl)URL.revokeObjectURL(audioUrl);if(audioBlob?.size)audioUrl=URL.createObjectURL(audioBlob);
    const draft=parseCookingSession(transcript);const merged=mergeDraft(ingredients,steps,draft);ingredients=merged.ingredients;steps=merged.steps;
    captureStatus=draft.ingredients.length||draft.steps.length?`Draft ready: ${draft.ingredients.length} ingredient${draft.ingredients.length===1?'':'s'} and ${draft.steps.length} step${draft.steps.length===1?'':'s'} detected. Review them below.`:'Audio saved. Review or correct the transcript below if live recognition missed the cooking words.';
    renderCookDynamic();
  }else{
    if(isIOS&&speechNeedsReset){captureForm();sessionStorage.setItem('chefvoice.capture.recovery',JSON.stringify({form,ingredients,steps,transcript}));location.reload();return;}
    try{
      transcript=[];livePartial='';audioBlob=null;if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl='';voiceEngineUsed=true;
      await capture.start();
      capturing=true;
      // Only once capture is actually running: a denied microphone permission or a
      // failed start is not a chef who began narrating.
      ChefAnalytics.recipeCaptureStarted();
      renderCookDynamic();
    }
    catch(e){captureStatus=`Microphone could not start: ${e.message}`;renderCapture();}
  }
}

function bindCook(){
  renderCookDynamic();
  document.querySelector('#addIngredient').addEventListener('click',()=>{const x=document.querySelector('#manualIngredient');if(x.value.trim()){ingredients.push({...parseIngredient(x.value),confidence:'manual'});x.value='';renderIngredients();}});
  document.querySelector('#addStep').addEventListener('click',()=>{const x=document.querySelector('#manualStep');if(x.value.trim()){steps.push(x.value.trim());x.value='';renderSteps();}});
  document.querySelector('#reanalyze').addEventListener('click',()=>{const text=document.querySelector('#transcriptEditor').value.trim();if(!text)return;transcript=[{id:crypto.randomUUID(),elapsedMs:0,text}];const d=parseCookingSession(transcript);ingredients=d.ingredients;steps=d.steps;captureStatus=`Transcript rebuilt: ${ingredients.length} ingredients and ${steps.length} steps.`;renderCookDynamic();});
  // Video and per-recipe photo caps are deliberately NOT enforced here. Both limits
  // exist in the tier model on both platforms, but Android raises a paywall only for
  // the Second Pass quota, the cloud-recipe cap and the profile "See Pro" button --
  // `videoAllowed` and `PHOTOS_PER_RECIPE` have no call site there. Enforcing them
  // on the web alone would give a Free chef a worse deal in Safari than on their
  // phone for the same account. If these should bite, they need to land on both
  // platforms in the same change.
  document.querySelector('#mediaInput').addEventListener('change',e=>{
    for(const f of e.target.files){
      const max=f.type.startsWith('video/')?200*1024*1024:25*1024*1024;
      if(f.size>max){captureStatus=`${f.name} was not added because it exceeds the ${f.type.startsWith('video/')?'200 MB video':'25 MB image'} alpha limit.`;continue;}
      media.push({id:crypto.randomUUID(),name:f.name,type:f.type,url:URL.createObjectURL(f),file:f});
    }
    renderCookDynamic();
  });
  document.querySelector('#saveRecipe').addEventListener('click',async()=>{
    captureForm();const recipeId=crypto.randomUUID();
    const recipe={id:recipeId,title:form.title.trim()||'Untitled recipe',description:form.description.trim(),servings:Number(form.servings)||2,ingredients:structuredClone(ingredients),steps:[...steps],transcript:structuredClone(transcript),createdAt:Date.now(),updatedAt:Date.now(),isPublic:false,media:[]};
    if(audioBlob?.size){try{recipe.sessionAudio=await saveAudioBlob(recipe.id,audioBlob);}catch(e){recipe.audioWarning=e.message;}}
    for(const item of media){try{await saveMediaBlob(recipe.id,item.id,item.file);recipe.media.push({id:item.id,name:item.name,type:item.type,size:item.file.size,stored:true});}catch(e){recipe.mediaWarning=e.message;}}
    for(const item of media)try{URL.revokeObjectURL(item.url)}catch{}
    recipes.unshift(recipe);saveRecipes(recipes);
    // Only a brand-new recipe is a completion. Edits and publishes are not.
    ChefAnalytics.recipeCompleted();
    captureStatus='Recipe saved on this device.';form.title='';form.description='';form.servings='2';ingredients=[];steps=[];transcript=[];audioBlob=null;audioUrl='';media=[];nav('recipes');
  });
}

function recipesTemplate(){
  const cloudNote=cloud.user?`<div class="quality">Signed in as ${escapeHtml(cloud.user.email||'ChefVoice member')}. Publishing now uses the verified ChefVoice Firebase project.</div>`:`<div class="notice">Local recipes stay private on this device. Sign in from Profile to publish to Community.</div>`;
  return `<section class="hero" style="--hero:url('../assets/chefvoice-cover.webp')"><div class="eyebrow">Your kitchen archive</div><h1>Recipes with a voice.</h1><p>Your local recipe library stays available even if Firebase is offline.</p></section><div id="paywall"></div>${cloudNote}${recipes.length?recipes.map(r=>`<article class="card recipe-card"><img src="assets/chefvoice-cover.webp" alt=""><div><div class="row between"><h3>${escapeHtml(r.title)}</h3>${r.isPublic?'<span class="pill">Public</span>':'<span class="pill">Private</span>'}</div><p>${r.ingredients?.length||0} ingredients · ${r.steps?.length||0} steps · serves ${r.servings||2}</p><div class="row wrap" style="margin-top:9px"><button class="secondary" data-open-recipe="${r.id}">Open</button>${cloud.user?(r.isPublic?`<button class="ghost" data-unpublish="${r.id}">Unpublish</button>`:`<button class="primary" data-publish="${r.id}">Publish</button>`):''}<button class="danger" data-delete-recipe="${r.id}">Delete local</button></div><div class="hint" data-recipe-status="${r.id}"></div></div></article>`).join(''):'<div class="empty card"><strong>No saved recipes yet.</strong><br>Start a cooking capture and ChefVoice will build your first one.</div>'}`;
}
async function publishLocalRecipe(id,button){
  const r=recipes.find(x=>x.id===id);if(!r||!cloud.api||!cloud.user)return;
  const status=document.querySelector(`[data-recipe-status="${id}"]`);
  // Free accounts sync a limited number of recipes. The recipe is never lost --
  // it stays saved in this browser, which is what the copy has to say.
  if(!r.isPublic&&cloudRecipesRemaining(isPro(),cloudRecipeCount())<=0){
    if(status)status.textContent=`Free accounts sync ${FreeTierLimits.CLOUD_RECIPES} recipes to the Community. This recipe stays saved in this browser.`;
    showPaywall(PaywallTrigger.CLOUD_LIMIT);
    return;
  }
  button.disabled=true;if(status)status.textContent='Uploading recipe media and chef voice…';
  try{
    const assets=[];
    for(const item of r.media||[]){const remote=(r.remoteMedia||[]).find(x=>x.id===item.id);assets.push({...item,blob:await loadMediaBlob(r.id,item.id),remoteUrl:remote?.url||'',cloudType:item.type?.startsWith('video/')?'VIDEO':'IMAGE'});}
    const voiceBlob=await loadAudioBlob(r.id);
    const result=await cloud.api.publishRecipe(r,chefName(),{mediaAssets:assets,voiceBlob});
    Object.assign(r,{isPublic:true,authorId:cloud.user.uid,authorName:chefName(),updatedAt:result.recipe.updatedAt,remoteMedia:result.recipe.media,voiceClips:result.recipe.voiceClips,likes:result.recipe.likes,commentCount:result.recipe.commentCount});
    saveRecipes(recipes);if(status)status.textContent=result.warnings.length?`Published. ${result.warnings.join(' ')}`:'Published to ChefVoice Community.';render();
  }catch(e){if(status)status.textContent=e?.message||'Could not publish recipe.';button.disabled=false;}
}
async function unpublishLocalRecipe(id,button){
  const r=recipes.find(x=>x.id===id);if(!r||!cloud.api)return;button.disabled=true;
  try{await cloud.api.unpublishRecipe(id);r.isPublic=false;r.updatedAt=Date.now();saveRecipes(recipes);render();}catch(e){button.disabled=false;const status=document.querySelector(`[data-recipe-status="${id}"]`);if(status)status.textContent=e?.message||'Could not unpublish.';}
}
function bindRecipes(){
  main.querySelectorAll('[data-open-recipe]').forEach(b=>b.onclick=()=>openRecipe(b.dataset.openRecipe));
  main.querySelectorAll('[data-publish]').forEach(b=>b.onclick=()=>publishLocalRecipe(b.dataset.publish,b));
  main.querySelectorAll('[data-unpublish]').forEach(b=>b.onclick=()=>unpublishLocalRecipe(b.dataset.unpublish,b));
  main.querySelectorAll('[data-delete-recipe]').forEach(b=>b.onclick=async()=>{const id=b.dataset.deleteRecipe;const r=recipes.find(x=>x.id===id);recipes=recipes.filter(x=>x.id!==id);saveRecipes(recipes);await deleteAudioBlob(id);await deleteRecipeMedia(r);render();});
}
function openRecipe(id){
  const r=recipes.find(x=>x.id===id);if(!r)return;
  const remoteMedia=(r.remoteMedia||[]).map(m=>m.type==='VIDEO'?`<video class="detail-media" controls src="${escapeHtml(m.url)}"></video>`:`<img class="detail-media" src="${escapeHtml(m.url)}" alt="Recipe media">`).join('');
  main.innerHTML=`<button id="backRecipes" class="ghost">← Recipes</button><section class="card"><div class="row between"><h1>${escapeHtml(r.title)}</h1>${r.isPublic?'<span class="pill">Community</span>':'<span class="pill">Private</span>'}</div><p class="status">${escapeHtml(r.description||'')}</p><span class="pill">Serves ${r.servings||2}</span></section>${remoteMedia?`<section class="card"><h2>Recipe media</h2><div class="detail-media-grid">${remoteMedia}</div></section>`:''}${r.sessionAudio?.stored?'<section class="card"><h2>Original chef voice</h2><p class="hint">The full microphone recording is stored separately from the transcript.</p><button id="loadChefVoice" class="secondary wide">▶ Load chef voice</button><div id="chefVoicePlayer"></div></section>':''}<div class="section-title"><h2>Ingredients</h2></div>${(r.ingredients||[]).map(i=>`<div class="card">${escapeHtml([i.quantity,i.unit,i.name].filter(Boolean).join(' '))}</div>`).join('')}<div class="section-title"><h2>Method</h2></div>${(r.steps||[]).map((s,i)=>`<div class="step card"><span class="step-num">${i+1}</span><div>${escapeHtml(s)}</div></div>`).join('')}<div class="section-title"><h2>Cooking transcript</h2></div><div class="card transcript">${(r.transcript||[]).map(s=>`<div class="transcript-line">${escapeHtml(s.text)}</div>`).join('')||'No transcript saved.'}</div>`;
  document.querySelector('#backRecipes').onclick=()=>render();
  const load=document.querySelector('#loadChefVoice');if(load)load.onclick=async()=>{load.disabled=true;load.textContent='Loading…';const blob=await loadAudioBlob(r.id);const target=document.querySelector('#chefVoicePlayer');if(blob){const url=URL.createObjectURL(blob);target.innerHTML=`<audio class="audio-player" controls src="${url}"></audio>${isIOS?'<p class="hint">ChefVoice will refresh the voice engine before your next capture after audio playback if iOS requires it.</p>':''}`;}else target.innerHTML='<p class="status">The stored recording could not be found.</p>';load.remove();};
}

function communityTemplate(){
  const cloudStatus=cloud.state==='ready'?'<span class="pill">Firebase connected</span>':cloud.state==='connecting'?'<span class="pill">Connecting…</span>':'<span class="pill">Local mode</span>';
  const feed=cloud.recipes.length?cloud.recipes.map(r=>{
    const liked=cloud.liked.has(r.id),bookmarked=cloud.bookmarks.has(r.id),following=cloud.following.has(r.authorId),self=cloud.user?.uid===r.authorId;
    const hero=r.media?.find(m=>m.type!=='VIDEO')?.url;
    return `<article class="card community-card">${hero?`<img class="community-thumb" src="${escapeHtml(hero)}" alt="${escapeHtml(r.title)}">`:''}<div class="row between"><div><h3>${escapeHtml(r.title)}</h3><p class="status">by ${escapeHtml(r.authorName||'Chef')} · ${r.ingredients.length} ingredients · ${r.steps.length} steps</p></div><span class="pill">♥ ${r.likes||0}</span></div>${r.description?`<p>${escapeHtml(r.description)}</p>`:''}<div class="row wrap"><button class="${liked?'primary':'secondary'}" data-like="${r.id}">${liked?'♥ Liked':'♡ Like'}</button><button class="${bookmarked?'primary':'secondary'}" data-bookmark="${r.id}">${bookmarked?'★ Saved':'☆ Save'}</button><button class="secondary" data-comments="${r.id}">💬 ${r.commentCount||0}</button>${cloud.user&&!self?`<button class="${following?'primary':'ghost'}" data-follow="${escapeHtml(r.authorId)}">${following?'Following':'Follow chef'}</button>`:''}</div></article>`;
  }).join(''):`<div class="empty card">${cloud.feedError?`Community could not load: ${escapeHtml(cloud.feedError)}`:cloud.state==='connecting'?'Connecting to the real ChefVoice Community…':'No public Community recipes were returned.'}</div>`;
  return `<section class="hero" style="--hero:url('../assets/community-hero.webp')"><div class="eyebrow">ChefVoice Community</div><h1>Android and iPhone, one kitchen.</h1><p>Both clients now use the same Firebase Authentication, Firestore and Storage project.</p></section><div class="row between" style="margin:10px 2px"><strong>Community feed</strong>${cloudStatus}</div>${!cloud.user?'<div class="notice">You can browse public recipes now. Sign in from Profile to like, save, follow and comment.</div>':''}${cloud.feedError?`<div class="notice">${escapeHtml(cloud.feedError)}</div>`:''}${feed}`;
}
function requireCommunitySignIn(){if(cloud.user)return true;nav('profile');return false;}
function bindCommunity(){
  main.querySelectorAll('[data-like]').forEach(b=>b.onclick=async()=>{if(!requireCommunitySignIn())return;b.disabled=true;try{await cloud.api.toggleLike(b.dataset.like);}catch(e){alert(e?.message||'Could not update like.');b.disabled=false;}});
  main.querySelectorAll('[data-bookmark]').forEach(b=>b.onclick=async()=>{if(!requireCommunitySignIn())return;b.disabled=true;try{await cloud.api.toggleBookmark(b.dataset.bookmark);}catch(e){alert(e?.message||'Could not update bookmark.');b.disabled=false;}});
  main.querySelectorAll('[data-follow]').forEach(b=>b.onclick=async()=>{if(!requireCommunitySignIn())return;b.disabled=true;try{await cloud.api.toggleFollow(b.dataset.follow);}catch(e){alert(e?.message||'Could not update follow.');b.disabled=false;}});
  main.querySelectorAll('[data-comments]').forEach(b=>b.onclick=()=>openCommunityRecipe(b.dataset.comments));
}
function openCommunityRecipe(id){
  const r=cloud.recipes.find(x=>x.id===id);if(!r)return;
  try{cloud.unsubComments?.();}catch{}
  const mediaHtml=(r.media||[]).map(m=>m.type==='VIDEO'?`<video class="detail-media" controls src="${escapeHtml(m.url)}"></video>`:`<img class="detail-media" src="${escapeHtml(m.url)}" alt="Recipe media">`).join('');
  const voiceHtml=(r.voiceClips||[]).map(v=>`<audio class="audio-player" controls src="${escapeHtml(v.url)}"></audio>`).join('');
  main.innerHTML=`<button id="backCommunity" class="ghost">← Community</button><section class="card"><h1>${escapeHtml(r.title)}</h1><p class="status">by ${escapeHtml(r.authorName)} · serves ${r.servings}</p><p>${escapeHtml(r.description||'')}</p></section>${mediaHtml?`<section class="card"><div class="detail-media-grid">${mediaHtml}</div></section>`:''}<div class="section-title"><h2>Ingredients</h2></div>${r.ingredients.map(i=>`<div class="card">${escapeHtml([i.quantity,i.unit,i.name].filter(Boolean).join(' '))}</div>`).join('')}<div class="section-title"><h2>Method</h2></div>${r.steps.map((s,i)=>`<div class="step card"><span class="step-num">${i+1}</span><div>${escapeHtml(s)}</div></div>`).join('')}${voiceHtml?`<section class="card"><h2>Chef voice</h2><p class="hint">Original cooking-session audio published by the chef.</p>${voiceHtml}</section>`:''}<div class="section-title"><h2>Comments</h2></div><div id="comments"><div class="empty card">Loading comments…</div></div>${cloud.user?`<section class="card"><textarea id="commentText" maxlength="800" placeholder="Add a comment"></textarea><button id="postComment" class="primary wide">Post comment</button><div id="commentStatus" class="hint"></div></section>`:'<div class="notice">Sign in to comment.</div>'}`;
  document.querySelector('#backCommunity').onclick=()=>{try{cloud.unsubComments?.();}catch{}cloud.unsubComments=null;render();};
  cloud.unsubComments=cloud.api.observeComments(r.id,comments=>{const el=document.querySelector('#comments');if(el)el.innerHTML=comments.length?comments.map(c=>`<div class="card"><strong>${escapeHtml(c.authorName)}</strong><p class="status">${escapeHtml(c.text)}</p></div>`).join(''):'<div class="empty card">No comments yet.</div>';},err=>{const el=document.querySelector('#comments');if(el)el.innerHTML=`<div class="notice">${escapeHtml(err?.message||'Could not load comments.')}</div>`;});
  const post=document.querySelector('#postComment');if(post)post.onclick=async()=>{const text=document.querySelector('#commentText').value;const status=document.querySelector('#commentStatus');post.disabled=true;status.textContent='Posting…';try{await cloud.api.addComment(r.id,text,chefName());document.querySelector('#commentText').value='';status.textContent='Posted.';}catch(e){status.textContent=e?.message||'Could not post comment.';}finally{post.disabled=false;}};
}

/**
 * Mirrors ProMembershipCard on Android. Complimentary access is stated plainly:
 * these chefs never entered a payment method, so warning them about one, or
 * offering to manage a subscription they do not have, would be nonsense.
 */
function membershipTemplate(){
  if(!cloud.user)return '';
  const e=cloud.entitlement;
  const pro=isPro();
  const days=daysRemaining(e);
  let title='ChefVoice Free';
  if(pro&&isFounding(e))title='ChefVoice Pro · Founding member';
  else if(pro&&isPromo(e))title='ChefVoice Pro · Free launch access';
  else if(pro)title='ChefVoice Pro';

  let body;
  if(pro&&isFounding(e)){
    if(days<=0)body='Your founding Pro access has ended. Everything you cooked stays yours.';
    else if(days===Number.POSITIVE_INFINITY)body=`You were one of the first ${FoundingAccess.SEATS} chefs on ChefVoice. Pro is yours — no card, no renewal, nothing to cancel.`;
    else body=`You were one of the first ${FoundingAccess.SEATS} chefs on ChefVoice. Pro is free for ${FoundingAccess.FOUNDING_YEARS} years — ${remainingLabel(days)} left. No card, no renewal, nothing to cancel.`;
  }else if(pro&&isPromo(e)){
    body=days>0
      ? `The first ${FoundingAccess.PROMO_DAYS} days of Pro are free — ${days} ${days===1?'day':'days'} left. No card, and nothing happens automatically when it ends.`
      : 'Your free Pro access has ended. Everything you cooked stays yours.';
  }else if(pro){
    body='Pro is active on this account.';
  }else{
    const remaining=cloudRecipesRemaining(false,cloudRecipeCount());
    body=`Free syncs ${FreeTierLimits.CLOUD_RECIPES} recipes to the Community (${remaining} left) and ${FreeTierLimits.PHOTOS_PER_RECIPE} photo per recipe. Cooking capture, the parser and your original audio are never limited.`;
  }
  return `<section class="card"><div class="row between"><strong>${escapeHtml(title)}</strong>${pro?'<span class="pill">Pro</span>':'<span class="pill">Free</span>'}</div><p class="status">${escapeHtml(body)}</p>${pro?'':'<button id="showPaywall" class="secondary wide">What is Pro?</button>'}</section>`;
}

function profileTemplate(){
  const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
  const firebaseCard=cloud.user?`<section class="card"><div class="quality">Connected to ChefVoice Firebase</div><h2>${escapeHtml(cloud.user.email||'ChefVoice member')}</h2><div class="field"><label>Chef display name</label><input id="profileName" value="${escapeHtml(cloud.profile?.displayName||chefName())}"></div><div class="field"><label>Bio</label><textarea id="profileBio" placeholder="Tell the Community about your cooking">${escapeHtml(cloud.profile?.bio||'')}</textarea></div><button id="saveProfile" class="primary wide">Save profile</button><div id="profileStatus" class="hint"></div><button id="cloudSignOut" class="secondary wide" style="margin-top:10px">Sign out</button></section>`:`<section class="card"><h2>Sign in</h2><p class="status">Use the same Email/Password ChefVoice account you use on Android.</p><div class="stack"><div class="field"><label>Email</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="chef@example.com"></div><div class="field"><label>Password</label><input id="cloudPassword" type="password" autocomplete="current-password" placeholder="Password"></div><button id="cloudSignIn" class="primary wide">Sign in</button><div id="cloudAuthStatus" class="hint">${escapeHtml(cloud.message)}</div></div></section><section class="card"><h2>Create account</h2><div class="stack"><div class="field"><label>Chef name</label><input id="newChefName" placeholder="Chef Jamie"></div><div class="field"><label>Email</label><input id="newEmail" type="email" autocomplete="email"></div><div class="field"><label>Password</label><input id="newPassword" type="password" autocomplete="new-password" minlength="6"></div><button id="cloudSignUp" class="secondary wide">Create ChefVoice account</button><div id="cloudSignUpStatus" class="hint"></div></div></section>`;
  return `<div id="paywall"></div>${membershipTemplate()}${firebaseCard}<section class="card"><h1>ChefVoice on iPhone</h1><p class="status">${standalone?'ChefVoice is running as a Home Screen web app.':'Install ChefVoice on your Home Screen without an Apple Developer subscription.'}</p>${!standalone&&ios?`<ol class="install-list"><li>Open this page in <strong>Safari</strong>.</li><li>Tap the <strong>Share</strong> button.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Turn on <strong>Open as Web App</strong> if shown, then tap Add.</li></ol>`:''}<div class="quality">Voice → ingredient parsing remains local and protected from Firebase changes.</div></section><section class="card"><h2>Protected voice behavior</h2><p class="status">Measurement-preserving recognition, spoken fractions, ASR homophone repair, cross-segment ingredient recovery, shared measurements, and spoken corrections remain unchanged by the Community integration.</p></section>`;
}
function bindProfile(){
  document.querySelector('#showPaywall')?.addEventListener('click',()=>showPaywall(PaywallTrigger.PROFILE));
  const signIn=document.querySelector('#cloudSignIn');if(signIn)signIn.onclick=async()=>{const status=document.querySelector('#cloudAuthStatus');if(!cloud.api){status.textContent='Firebase has not finished loading.';return;}const email=document.querySelector('#cloudEmail').value.trim();const password=document.querySelector('#cloudPassword').value;if(!email||!password){status.textContent='Enter your email and password.';return;}signIn.disabled=true;status.textContent='Signing in…';try{await cloud.api.signIn(email,password);status.textContent='Signed in.';}catch(e){status.textContent=e?.message||'Could not sign in.';signIn.disabled=false;}};
  const signUp=document.querySelector('#cloudSignUp');if(signUp)signUp.onclick=async()=>{const status=document.querySelector('#cloudSignUpStatus');const name=document.querySelector('#newChefName').value.trim();const email=document.querySelector('#newEmail').value.trim();const password=document.querySelector('#newPassword').value;if(!email||password.length<6){status.textContent='Enter an email and a password of at least 6 characters.';return;}signUp.disabled=true;status.textContent='Creating account…';try{await cloud.api.signUp(email,password,name);status.textContent='Account created.';}catch(e){status.textContent=e?.message||'Could not create account.';signUp.disabled=false;}};
  const save=document.querySelector('#saveProfile');if(save)save.onclick=async()=>{const status=document.querySelector('#profileStatus');save.disabled=true;status.textContent='Saving…';try{await cloud.api.saveUserProfile(cloud.user.uid,{displayName:document.querySelector('#profileName').value,bio:document.querySelector('#profileBio').value,photoUrl:cloud.profile?.photoUrl||'',createdAt:cloud.profile?.createdAt||Date.now()});status.textContent='Profile saved.';}catch(e){status.textContent=e?.message||'Could not save profile.';}finally{save.disabled=false;}};
  const signOut=document.querySelector('#cloudSignOut');if(signOut)signOut.onclick=async()=>{signOut.disabled=true;try{await cloud.api?.signOutUser();}catch{signOut.disabled=false;}};
}

function liveTemplate(){return `<section class="hero" style="--hero:url('../assets/live-hero.webp')"><div class="eyebrow">Live kitchen</div><h1>Cook together, in real time.</h1><p>Community is now writable across Android and iPhone. WebRTC Live stays behind a separate device-test gate so it cannot interfere with the protected microphone/ingredient workflow.</p></section><div class="card"><strong>Live remains intentionally gated</strong><p class="status">The next Live milestone is Android ↔ iPhone signaling, camera, microphone and reconnection testing on real devices.</p></div>`;}

function render(){
  if(currentTab==='cook'){main.innerHTML=cookTemplate();bindCook();}
  if(currentTab==='recipes'){main.innerHTML=recipesTemplate();bindRecipes();}
  if(currentTab==='community'){main.innerHTML=communityTemplate();bindCommunity();}
  if(currentTab==='live')main.innerHTML=liveTemplate();
  if(currentTab==='profile'){main.innerHTML=profileTemplate();bindProfile();}
  renderPaywall();
}

if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
window.addEventListener('beforeunload',()=>{capture.close();for(const key of ['unsubAuth','unsubFeed','unsubProfile','unsubLiked','unsubBookmarks','unsubFollowing','unsubComments'])try{cloud[key]?.();}catch{}});
render();
