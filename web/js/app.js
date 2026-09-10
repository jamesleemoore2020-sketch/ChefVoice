import { VoiceCapture } from './voice-capture.js';
import { parseIngredient } from './ingredient-parser.js';
import { mergeDraft, parseCookingSession } from './cooking-session-parser.js';
import {
  deleteAudioBlob, deleteRecipeMedia, loadAudioBlob, loadMediaBlob, loadRecipes,
  saveAudioBlob, saveMediaBlob, saveRecipes
} from './storage.js';
import {
  cloudRecipesRemaining, daysRemaining, FoundingAccess, FreeTierLimits, FREE_ENTITLEMENT,
  isEntitlementActive, isFounding, isPromo, PaywallTrigger, recordSecondPassUse, remainingLabel,
  secondPassMonthlyLimit, secondPassRemaining
} from './entitlement.js';
import {
  applyMethodSuggestion, applySuggestion, fromCloudTranscript
} from './second-pass-reviewer.js';
import * as ChefAnalytics from './chef-analytics.js';
import {
  conversationUnread as isConversationUnread, otherParticipant, otherParticipantName,
  threadComments, unreadCounts as computeUnreadCounts, withoutBlocked
} from './inbox.js';

const main=document.querySelector('#main');
const tabs=[...document.querySelectorAll('[data-tab]')];
// A clicked push notification opens '/?tab=inbox' or '/?tab=community' (see
// firebase-messaging-sw.js) since a brand-new window has no in-app state to
// resume into. Anything other than one of the app's own tab names is ignored.
const requestedTab=new URLSearchParams(location.search).get('tab');
// A shared recipe link (see shareRecipe()) always opens on Community regardless
// of its own ?tab=, since that's the only tab that can show a community recipe.
let pendingSharedRecipeId=new URLSearchParams(location.search).get('recipe')||null;
let currentTab=pendingSharedRecipeId?'community':(tabs.some(b=>b.dataset.tab===requestedTab)?requestedTab:'cook');
let recipes=loadRecipes();
let ingredients=[];let steps=[];let transcript=[];let livePartial='';
let captureStatus='Talk naturally while you cook. ChefVoice will turn the session into an editable recipe draft.';
let audioBlob=null;let audioUrl='';let capturing=false;let media=[];
const form={title:'',description:'',servings:'2'};
const cloud={
  state:'connecting',message:'Connecting to ChefVoice Community…',api:null,user:null,profile:null,recipes:[],feedError:'',
  liked:new Set(),bookmarks:new Set(),following:new Set(),entitlement:{...FREE_ENTITLEMENT},blocked:new Set(),
  profileLoaded:false,profileError:'',
  conversations:[],messageReads:{},notifications:[],
  unsubAuth:null,unsubFeed:null,unsubProfile:null,unsubLiked:null,unsubBookmarks:null,unsubFollowing:null,unsubComments:null,unsubEntitlement:null,unsubBlocked:null,
  unsubConversations:null,unsubMessageReads:null,unsubNotifications:null,unsubThread:null,unsubChefRecipes:null
};

// Inbox view state: which conversation is open, if any.
let openConversation=null;
let threadMessages=[];
let inboxSection='messages';
let pushMessage='';

// The single value the UI gates on. Fails closed to Free: signed out, offline, or a
// failed entitlement read all read as Free rather than accidentally unlocking Pro.
const isPro=()=>isEntitlementActive(cloud.entitlement);
const cloudRecipeCount=()=>recipes.filter(r=>r.isPublic).length;
let paywallTrigger='';

function clearUserObservers(){
  for(const key of ['unsubProfile','unsubLiked','unsubBookmarks','unsubFollowing','unsubEntitlement','unsubBlocked','unsubConversations','unsubMessageReads','unsubNotifications','unsubThread']){try{cloud[key]?.();}catch{} cloud[key]=null;}
  cloud.profile=null;cloud.liked=new Set();cloud.bookmarks=new Set();cloud.following=new Set();
  cloud.entitlement={...FREE_ENTITLEMENT};cloud.blocked=new Set();
  cloud.profileLoaded=false;cloud.profileError='';
  cloud.conversations=[];cloud.messageReads={};cloud.notifications=[];
  openConversation=null;threadMessages=[];
  // Chef search is sign-in gated, so signing out has to clear its results too.
  chefSearchTerm='';chefSearchResults=[];chefSearchStatus='';
  closeChefProfile();
}
// See openCommunityRecipeId's declaration below for why the community tab's
// listener-driven re-renders all gate on this instead of just the tab name.
const shouldRenderCommunity=()=>currentTab==='community'&&!openCommunityRecipeId;
function startUserObservers(user){
  clearUserObservers();
  if(!user||!cloud.api)return;
  // profileLoaded distinguishes "the listener has not fired yet" from "it fired
  // and this account has no profile document", which need different messages:
  // one resolves itself, the other needs the chef to save a display name.
  cloud.unsubProfile=cloud.api.observeProfile(user.uid,p=>{
    cloud.profile=p;cloud.profileLoaded=true;cloud.profileError='';
    if(currentTab==='profile'||currentTab==='recipes'||shouldRenderCommunity())render();
  },err=>{
    cloud.profileLoaded=true;cloud.profileError=err?.message||'Your chef profile could not be loaded.';
    if(currentTab==='profile')render();
  });
  cloud.unsubEntitlement=cloud.api.observeProEntitlement(user.uid,e=>{cloud.entitlement=e;if(currentTab==='profile'||currentTab==='recipes')render();});
  cloud.unsubBlocked=cloud.api.observeBlockedUserIds(user.uid,s=>{cloud.blocked=s;if(shouldRenderCommunity()||currentTab==='profile')render();});
  cloud.unsubConversations=cloud.api.observeConversations(user.uid,items=>{cloud.conversations=items;updateInboxBadge();if(currentTab==='inbox')render();});
  cloud.unsubMessageReads=cloud.api.observeMessageReads(user.uid,map=>{cloud.messageReads=map;updateInboxBadge();if(currentTab==='inbox')render();});
  cloud.unsubNotifications=cloud.api.observeNotifications(user.uid,items=>{cloud.notifications=items;updateInboxBadge();if(currentTab==='inbox')render();});
  cloud.unsubLiked=cloud.api.observeUserRecipeIds(user.uid,'likes',s=>{cloud.liked=s;if(shouldRenderCommunity())render();});
  cloud.unsubBookmarks=cloud.api.observeUserRecipeIds(user.uid,'bookmarks',s=>{cloud.bookmarks=s;if(shouldRenderCommunity())render();});
  cloud.unsubFollowing=cloud.api.observeUserRecipeIds(user.uid,'following',s=>{cloud.following=s;if(shouldRenderCommunity())render();});
}
async function initCloud(){
  try{
    const api=await import('./firebase-client.js');
    cloud.api=api;cloud.state='ready';cloud.message='Connected to ChefVoice Firebase. Community writes are enabled.';
    cloud.unsubAuth=api.observeAuth(user=>{cloud.user=user;startUserObservers(user);if(currentTab==='profile'||currentTab==='recipes'||shouldRenderCommunity())render();});
    cloud.unsubFeed=api.observePublicRecipes(items=>{
      cloud.recipes=items;cloud.feedError='';
      // A shared link is only actionable once the feed it points into has
      // loaded; only tried once; if the recipe is gone or unlisted, this just
      // falls through to the ordinary feed rather than looping forever.
      if(pendingSharedRecipeId){
        const shared=items.find(x=>x.id===pendingSharedRecipeId);
        pendingSharedRecipeId=null;
        if(shared){openCommunityRecipe(shared.id);return;}
      }
      if(shouldRenderCommunity())render();
    },err=>{cloud.feedError=err?.message||'Community feed could not be loaded.';if(shouldRenderCommunity())render();});
  }catch(e){
    cloud.state='offline';cloud.message='Firebase is unavailable right now. Local cooking capture still works.';cloud.feedError=e?.message||String(e);
    if(currentTab==='profile'||shouldRenderCommunity())render();
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
function relativeTime(ms){
  if(!ms)return '';
  const diff=Date.now()-ms;
  if(diff<60000)return 'Just now';
  if(diff<3600000)return `${Math.floor(diff/60000)}m`;
  if(diff<86400000)return `${Math.floor(diff/3600000)}h`;
  if(diff<604800000)return `${Math.floor(diff/86400000)}d`;
  return new Date(ms).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}
function formatCount(n){
  n=Number(n)||0;
  if(n<1000)return String(n);
  if(n<1000000)return `${(n/1000).toFixed(n%1000>=100?1:0)}K`;
  return `${(n/1000000).toFixed(1)}M`;
}
/** The IG-style double-tap: always likes, never removes a like, and always
 * shows the heart even when already liked -- a delight gesture, not a toggle. */
function burstHeart(container){
  if(!container)return;
  const heart=document.createElement('div');
  heart.className='heart-burst';
  heart.textContent='❤';
  heart.addEventListener('animationend',()=>heart.remove());
  container.appendChild(heart);
}
function likeFromPhoto(recipeId,container){
  if(!requireCommunitySignIn())return;
  burstHeart(container);
  if(!cloud.liked.has(recipeId))cloud.api.toggleLike(recipeId).catch(()=>{});
}

/**
 * The name to send on any write the rules check with `profileNameMatches` --
 * publishing, comments, replies, conversations and messages all compare the name in
 * the payload against `users/{uid}.displayName` and reject a mismatch. `chefName()`
 * falls back to an email prefix or "Chef" for display, and sending that fallback is
 * a permission-denied, so rule-bound writes use this instead and fail with
 * something a chef can act on.
 */
function requireProfileName(){
  const name=String(cloud.profile?.displayName||'').trim();
  if(name)return name;
  if(cloud.profileError)throw new Error(cloud.profileError);
  // Once the listener has reported, a missing name means there is no profile
  // document — the chef has to save one before any name-checked write can pass.
  if(cloud.profileLoaded)throw new Error('Set your chef display name in Profile before posting.');
  throw new Error('Your chef profile is still loading. Try again in a moment.');
}
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

// Browser/PWA back-button support. Every tab switch and the two multi-screen
// drill-ins (an open chef profile, an open conversation) push a history entry so
// the hardware/gesture back button navigates within the app instead of closing
// it; only popping past the first entry leaves. `restoringHistory` stops the
// popstate handler's own nav()/openChef()/openConversationView() calls from
// pushing a second, redundant entry for the state history just handed back.
let restoringHistory=false;
function currentViewState(){
  return {
    tab:currentTab,
    conversationId:currentTab==='inbox'?(openConversation?.id||null):null,
    chefUid:currentTab==='community'?(openChefProfile?.uid||null):null
  };
}
function pushViewState(){
  if(restoringHistory)return;
  const state=currentViewState();
  const prev=history.state;
  if(prev&&prev.tab===state.tab&&(prev.conversationId||null)===state.conversationId&&(prev.chefUid||null)===state.chefUid)return;
  history.pushState(state,'');
}
async function restoreViewState(state){
  state=state||{tab:'cook'};
  restoringHistory=true;
  try{
    nav(state.tab||'cook');
    if(state.tab==='inbox'&&state.conversationId)openConversationView(state.conversationId);
    if(state.tab==='community'&&state.chefUid)await openChef(state.chefUid);
  }finally{
    restoringHistory=false;
  }
}
function nav(tab){
  captureForm();
  try{cloud.unsubComments?.();}catch{}
  cloud.unsubComments=null;
  openCommunityRecipeId=null;
  setReplyTarget(null);
  // Leaving the Inbox closes any open thread listener; openConversationView
  // re-establishes it when a conversation is opened again.
  if(tab!=='inbox')closeConversationView();
  if(tab!=='community')closeChefProfile();
  currentTab=tab;
  tabs.forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  render();
  window.scrollTo({top:0,behavior:'smooth'});
  pushViewState();
}
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
    const authorName=requireProfileName();
    const result=await cloud.api.publishRecipe(r,authorName,{mediaAssets:assets,voiceBlob});
    Object.assign(r,{isPublic:true,authorId:cloud.user.uid,authorName,updatedAt:result.recipe.updatedAt,remoteMedia:result.recipe.media,voiceClips:result.recipe.voiceClips,likes:result.recipe.likes,commentCount:result.recipe.commentCount});
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
// ---- Second Pass (ChefVoice Review) ----------------------------------------
// Explicit, opt-in review. The result is held here until the chef accepts a
// specific card; the saved recipe is never rewritten automatically.
let secondPass={recipeId:'',busy:false,message:'',result:null};

function secondPassTemplate(recipe){
  if(!recipe.sessionAudio?.stored)return '';
  const pro=isPro();
  const remaining=secondPassRemaining(pro);
  const limit=secondPassMonthlyLimit(pro);
  if(secondPass.recipeId!==recipe.id||!secondPass.result){
    return `<section class="card"><h2>ChefVoice Review</h2><p class="hint">Re-transcribes your original cooking audio in the cloud and shows what a cleaner transcript heard. Nothing changes until you accept a suggestion.</p><p class="status">${remaining} of ${limit} reviews left this month.</p><button id="runSecondPass" class="secondary wide"${secondPass.busy?' disabled':''}>${secondPass.busy?'Running…':'Run ChefVoice Review'}</button>${secondPass.message?`<p class="hint">${escapeHtml(secondPass.message)}</p>`:''}</section>`;
  }

  const result=secondPass.result;
  const card=(issue,kind)=>{
    const suggestion=kind==='ingredient'
      ?(issue.suggested?[issue.suggested.quantity,issue.suggested.unit,issue.suggested.name].filter(Boolean).join(' '):'')
      :(issue.suggestedStep||'');
    // A live-only card has nothing to apply -- it is a heads-up, not an action.
    const canApply=kind==='ingredient'?issue.type!=='live-only-low-confidence':issue.type!=='live-only-step';
    return `<article class="card"><div class="row between"><strong>${escapeHtml(issue.title)}</strong><span class="pill">${Math.round(issue.confidence*100)}%</span></div><p class="status">${escapeHtml(issue.detail)}</p>${canApply?`<div class="row wrap"><button class="secondary" data-accept-${kind}="${escapeHtml(issue.id)}">${issue.type.startsWith('remove')?'Remove':'Use second pass'}</button><button class="ghost" data-dismiss-issue="${escapeHtml(issue.id)}">Keep current</button></div>`:''}${suggestion?`<p class="hint">Suggested: ${escapeHtml(suggestion)}</p>`:''}</article>`;
  };
  const issues=[...result.issues.map(i=>card(i,'ingredient')),...result.methodIssues.map(i=>card(i,'method'))].join('');
  return `<section class="card"><h2>ChefVoice Review</h2><p class="status">${result.confirmedCount+result.methodConfirmedCount} confirmed · ${result.issues.length+result.methodIssues.length} to review.</p><p class="hint">Provider: ${escapeHtml(result.provider)} · ${escapeHtml(result.model)}. Your original audio is unchanged.</p><button id="closeSecondPass" class="ghost wide">Close review</button>${secondPass.message?`<p class="hint">${escapeHtml(secondPass.message)}</p>`:''}</section>${issues||'<div class="empty card">The second pass agreed with everything. Nothing to review.</div>'}<section class="card"><h3>Second pass transcript</h3><p class="hint">${escapeHtml(result.transcript||'No transcript returned.')}</p></section>`;
}

function bindSecondPass(recipe){
  const run=document.querySelector('#runSecondPass');
  if(run)run.onclick=()=>runSecondPass(recipe);
  const close=document.querySelector('#closeSecondPass');
  if(close)close.onclick=()=>{secondPass={recipeId:'',busy:false,message:'',result:null};openRecipe(recipe.id);};

  main.querySelectorAll('[data-accept-ingredient]').forEach(b=>b.onclick=()=>{
    const issue=secondPass.result.issues.find(i=>i.id===b.dataset.acceptIngredient);
    if(!issue)return;
    const updated={...recipe,ingredients:applySuggestion(recipe.ingredients||[],issue),updatedAt:Date.now()};
    persistReviewed(updated,issue.id,'ingredient');
  });
  main.querySelectorAll('[data-accept-method]').forEach(b=>b.onclick=()=>{
    const issue=secondPass.result.methodIssues.find(i=>i.id===b.dataset.acceptMethod);
    if(!issue)return;
    const updated={...recipe,steps:applyMethodSuggestion(recipe.steps||[],issue),updatedAt:Date.now()};
    persistReviewed(updated,issue.id,'method');
  });
  main.querySelectorAll('[data-dismiss-issue]').forEach(b=>b.onclick=()=>{
    // "Keep current" simply drops the card. The chef's text already stands.
    secondPass.result={
      ...secondPass.result,
      issues:secondPass.result.issues.filter(i=>i.id!==b.dataset.dismissIssue),
      methodIssues:secondPass.result.methodIssues.filter(i=>i.id!==b.dataset.dismissIssue)
    };
    openRecipe(recipe.id);
  });
}

function persistReviewed(updated,issueId,kind){
  const index=recipes.findIndex(x=>x.id===updated.id);
  if(index<0)return;
  recipes[index]=updated;
  saveRecipes(recipes);
  ChefAnalytics.secondPassAccepted(kind==='ingredient'?ChefAnalytics.KIND_INGREDIENT:ChefAnalytics.KIND_METHOD);
  // Indices in the remaining cards refer to the list that just changed, so the
  // review is rebuilt against the updated recipe rather than left stale.
  secondPass.result=fromCloudTranscript({
    liveIngredients:updated.ingredients||[],
    liveSteps:updated.steps||[],
    transcript:secondPass.result.transcript,
    rawSegments:secondPass.result.rawSegments||[],
    provider:secondPass.result.provider,
    model:secondPass.result.model
  });
  secondPass.result.rawSegments=secondPass.rawSegments||[];
  secondPass.message='Applied. Your recipe was updated on this device.';
  openRecipe(updated.id);
}

async function runSecondPass(recipe){
  if(!cloud.user){safetyStatus('Sign in to run ChefVoice Review.');nav('profile');return;}
  const pro=isPro();
  if(secondPassRemaining(pro)<=0){
    secondPass.message=`You have used all ${secondPassMonthlyLimit(pro)} ChefVoice Reviews this month.`;
    showPaywall(PaywallTrigger.SECOND_PASS);
    openRecipe(recipe.id);
    return;
  }
  secondPass={recipeId:recipe.id,busy:true,message:'Uploading the private original audio and running Chirp 3. This can take a few minutes.',result:null};
  openRecipe(recipe.id);
  try{
    const blob=await loadAudioBlob(recipe.id);
    if(!blob)throw new Error('The original local cooking audio could not be found.');
    const cloudResult=await cloud.api.transcribePrivateChefVoice(recipe.id,blob);
    // Counted only on success: a failed review must not burn an allowance.
    recordSecondPassUse();
    ChefAnalytics.secondPassOpened();
    const result=fromCloudTranscript({
      liveIngredients:recipe.ingredients||[],
      liveSteps:recipe.steps||[],
      transcript:cloudResult.transcript,
      rawSegments:cloudResult.segments,
      provider:cloudResult.provider,
      model:cloudResult.model
    });
    result.rawSegments=cloudResult.segments;
    secondPass={recipeId:recipe.id,busy:false,message:'',result};
  }catch(e){
    secondPass={recipeId:recipe.id,busy:false,message:e?.message||'ChefVoice Review could not finish. Your local recipe and audio are unchanged.',result:null};
  }
  openRecipe(recipe.id);
}

function openRecipe(id){
  const r=recipes.find(x=>x.id===id);if(!r)return;
  const remoteMedia=(r.remoteMedia||[]).map(m=>m.type==='VIDEO'?`<video class="detail-media" controls src="${escapeHtml(m.url)}"></video>`:`<img class="detail-media" src="${escapeHtml(m.url)}" alt="Recipe media">`).join('');
  main.innerHTML=`<button id="backRecipes" class="ghost">← Recipes</button><section class="card"><div class="row between"><h1>${escapeHtml(r.title)}</h1>${r.isPublic?'<span class="pill">Community</span>':'<span class="pill">Private</span>'}</div><p class="status">${escapeHtml(r.description||'')}</p><span class="pill">Serves ${r.servings||2}</span></section>${remoteMedia?`<section class="card"><h2>Recipe media</h2><div class="detail-media-grid">${remoteMedia}</div></section>`:''}${r.sessionAudio?.stored?'<section class="card"><h2>Original chef voice</h2><p class="hint">The full microphone recording is stored separately from the transcript.</p><button id="loadChefVoice" class="secondary wide">▶ Load chef voice</button><div id="chefVoicePlayer"></div></section>':''}<div id="paywall"></div>${secondPassTemplate(r)}<div class="section-title"><h2>Ingredients</h2></div>${(r.ingredients||[]).map(i=>`<div class="card">${escapeHtml([i.quantity,i.unit,i.name].filter(Boolean).join(' '))}</div>`).join('')}<div class="section-title"><h2>Method</h2></div>${(r.steps||[]).map((s,i)=>`<div class="step card"><span class="step-num">${i+1}</span><div>${escapeHtml(s)}</div></div>`).join('')}<div class="section-title"><h2>Cooking transcript</h2></div><div class="card transcript">${(r.transcript||[]).map(s=>`<div class="transcript-line">${escapeHtml(s.text)}</div>`).join('')||'No transcript saved.'}</div>`;
  document.querySelector('#backRecipes').onclick=()=>{secondPass={recipeId:'',busy:false,message:'',result:null};render();};
  bindSecondPass(r);
  renderPaywall();
  const load=document.querySelector('#loadChefVoice');if(load)load.onclick=async()=>{load.disabled=true;load.textContent='Loading…';const blob=await loadAudioBlob(r.id);const target=document.querySelector('#chefVoicePlayer');if(blob){const url=URL.createObjectURL(blob);target.innerHTML=`<audio class="audio-player" controls src="${url}"></audio>${isIOS?'<p class="hint">ChefVoice will refresh the voice engine before your next capture after audio playback if iOS requires it.</p>':''}`;}else target.innerHTML='<p class="status">The stored recording could not be found.</p>';load.remove();};
}

// Chef discovery state. Search needs sign-in because listing the users collection
// does; a signed-out chef still gets the public feed.
let chefSearchTerm='';
let chefSearchResults=[];
let chefSearchStatus='';
let openChefProfile=null;
let openChefRecipes=[];
// Set while a single community recipe's detail/comments are open. The feed and
// social-state listeners below skip their blunt re-render while this is set --
// without that guard, anyone else liking any post in the whole public feed
// query would silently kick a chef out of the comments they were reading (or
// typing) back to the feed list, since observePublicRecipes redelivers the
// full result set (and re-renders) on any change to any recipe in it.
let openCommunityRecipeId=null;

function chefProfileTemplate(){
  const p=openChefProfile;
  const self=cloud.user?.uid===p.uid;
  const following=cloud.following.has(p.uid);
  const blocked=cloud.blocked.has(p.uid);
  const initial=(p.displayName||'C').trim().charAt(0).toUpperCase();
  const canModerate=cloud.user&&!self;
  const recipes=openChefRecipes.length
    ?openChefRecipes.map(r=>`<article class="card"><div class="row between"><strong>${escapeHtml(r.title)}</strong><span class="pill">♥ ${r.likes||0}</span></div><p class="status">${r.ingredients.length} ingredients · ${r.steps.length} steps</p><button class="secondary" data-open-community-recipe="${escapeHtml(r.id)}">Open</button></article>`).join('')
    :'<div class="empty card">No public recipes from this chef yet.</div>';
  const menuId=`profile-${p.uid}`;
  const menu=canModerate?`<button class="kebab" data-menu-toggle="${escapeHtml(menuId)}" aria-label="More options">⋯</button><div class="card-menu" id="menu-${escapeHtml(menuId)}" hidden><button class="menu-item" data-message="${escapeHtml(p.uid)}">✉ Message chef</button><button class="menu-item danger" data-report-user="${escapeHtml(p.uid)}">⚑ Report</button><button class="menu-item danger" data-toggle-block="${escapeHtml(p.uid)}">${blocked?'Unblock chef':'🚫 Block chef'}</button></div>`:'';
  return `<button id="backCommunity" class="ghost">← Community</button><section class="card"><div class="social-head"><span class="avatar-circle large">${escapeHtml(initial)}</span><div class="chef-id"><strong style="font-size:1.15rem">${escapeHtml(p.displayName)}</strong><span class="meta">${p.followerCount} follower${p.followerCount===1?'':'s'}</span></div>${canModerate?`<button class="follow-btn${following?' following':''}" data-follow="${escapeHtml(p.uid)}">${following?'Following':'Follow'}</button>`:''}${menu}</div>${p.bio?`<p class="status">${escapeHtml(p.bio)}</p>`:''}${p.favoriteThings?.length?`<div class="row wrap" style="margin-top:8px">${p.favoriteThings.map(t=>`<span class="pill">${escapeHtml(t)}</span>`).join('')}</div>`:''}</section><div id="safetyStatus" class="hint"></div>${blocked?'<div class="notice">You blocked this chef. Their recipes stay hidden in your Community feed.</div>':''}<div class="section-title"><h2>Public recipes</h2></div>${recipes}`;
}

function communityTemplate(){
  if(openChefProfile)return chefProfileTemplate();
  const cloudStatus=cloud.state==='ready'?'<span class="pill">Firebase connected</span>':cloud.state==='connecting'?'<span class="pill">Connecting…</span>':'<span class="pill">Local mode</span>';
  // Blocking has to actually hide the blocked chef's cooking, or the button is a
  // broken promise. Firestore rules already stop writes in both directions between
  // a blocked pair; this is the read half.
  const visible=withoutBlocked(cloud.recipes,cloud.blocked);
  const hiddenCount=cloud.recipes.length-visible.length;
  const feed=visible.length?visible.map(r=>{
    const liked=cloud.liked.has(r.id),bookmarked=cloud.bookmarks.has(r.id),following=cloud.following.has(r.authorId),self=cloud.user?.uid===r.authorId;
    const hero=r.media?.find(m=>m.type!=='VIDEO')?.url;
    const initial=(r.authorName||'C').trim().charAt(0).toUpperCase();
    const canModerate=cloud.user&&!self;
    const menu=canModerate?`<button class="kebab" data-menu-toggle="${escapeHtml(r.id)}" aria-label="More options">⋯</button><div class="card-menu" id="menu-${escapeHtml(r.id)}" hidden><button class="menu-item" data-message="${escapeHtml(r.authorId)}" data-message-name="${escapeHtml(r.authorName||'')}">✉ Message chef</button><button class="menu-item danger" data-report="${escapeHtml(r.id)}" data-report-uid="${escapeHtml(r.authorId)}">⚑ Report</button><button class="menu-item danger" data-block="${escapeHtml(r.authorId)}">🚫 Block chef</button></div>`:'';
    return `<article class="card community-card"><div class="social-head"><span class="avatar-circle">${escapeHtml(initial)}</span><div class="chef-id"><strong>${escapeHtml(r.authorName||'Chef')}</strong><span class="meta">${r.ingredients.length} ingredients · ${r.steps.length} steps · ${relativeTime(r.createdAt)}</span></div>${canModerate?`<button class="follow-btn${following?' following':''}" data-follow="${escapeHtml(r.authorId)}">${following?'Following':'Follow'}</button>`:''}${menu}</div>${hero?`<div class="thumb-wrap"><img class="community-thumb" data-dbl-like="${r.id}" src="${escapeHtml(hero)}" alt="${escapeHtml(r.title)}"></div>`:''}<h3>${escapeHtml(r.title)}</h3>${r.description?`<p class="status">${escapeHtml(r.description)}</p>`:''}<div class="action-row"><button class="action-btn${liked?' active':''}" data-like="${r.id}">${liked?'♥':'♡'} ${formatCount(r.likes||0)}</button><button class="action-btn" data-comments="${r.id}">💬 ${formatCount(r.commentCount||0)}</button><button class="action-btn" data-share="${r.id}" aria-label="Share">📤</button><button class="action-btn action-spacer${bookmarked?' saved':''}" data-bookmark="${r.id}" aria-label="${bookmarked?'Saved':'Save'}">${bookmarked?'★':'☆'}</button></div></article>`;
  }).join(''):`<div class="empty card">${cloud.feedError?`Community could not load: ${escapeHtml(cloud.feedError)}`:cloud.state==='connecting'?'Connecting to the real ChefVoice Community…':'No public Community recipes were returned.'}</div>`;
  const blockedNote=hiddenCount?`<div class="notice">${hiddenCount} recipe${hiddenCount===1?'':'s'} from chefs you blocked ${hiddenCount===1?'is':'are'} hidden. Manage blocked chefs from your Profile.</div>`:'';
  const searchResults=chefSearchResults.length
    ?`<div class="section-title"><h2>Chefs</h2><span class="count">${chefSearchResults.length} found</span></div>${chefSearchResults.map(p=>`<article class="card"><div class="row between"><div><strong>${escapeHtml(p.displayName)}</strong><p class="status">${escapeHtml(p.bio||'ChefVoice member')}</p></div><span class="pill">${p.followerCount} follower${p.followerCount===1?'':'s'}</span></div><button class="secondary" data-open-chef="${escapeHtml(p.uid)}">View chef</button></article>`).join('')}`
    :'';
  const search=cloud.user
    ?`<section class="card"><div class="row"><input id="chefSearch" class="grow" placeholder="Search chefs by name, bio or favourites" value="${escapeHtml(chefSearchTerm)}"><button id="chefSearchBtn" class="secondary">Search</button></div>${chefSearchStatus?`<p class="hint">${escapeHtml(chefSearchStatus)}</p>`:''}</section>${searchResults}`
    :'';
  return `<section class="hero" style="--hero:url('../assets/community-hero.webp')"><div class="eyebrow">ChefVoice Community</div><h1>Android and iPhone, one kitchen.</h1><p>Both clients now use the same Firebase Authentication, Firestore and Storage project.</p></section><div class="row between" style="margin:10px 2px"><strong>Community feed</strong>${cloudStatus}</div><div id="safetyStatus" class="hint"></div>${!cloud.user?'<div class="notice">You can browse public recipes now. Sign in from Profile to like, save, follow, comment and search for chefs.</div>':''}${cloud.feedError?`<div class="notice">${escapeHtml(cloud.feedError)}</div>`:''}${search}${blockedNote}${feed}`;
}
function requireCommunitySignIn(){if(cloud.user)return true;nav('profile');return false;}
function bindCommunity(){
  main.querySelectorAll('[data-like]').forEach(b=>b.onclick=async()=>{if(!requireCommunitySignIn())return;b.disabled=true;try{await cloud.api.toggleLike(b.dataset.like);}catch(e){alert(e?.message||'Could not update like.');b.disabled=false;}});
  main.querySelectorAll('[data-bookmark]').forEach(b=>b.onclick=async()=>{if(!requireCommunitySignIn())return;b.disabled=true;try{await cloud.api.toggleBookmark(b.dataset.bookmark);}catch(e){alert(e?.message||'Could not update bookmark.');b.disabled=false;}});
  main.querySelectorAll('[data-follow]').forEach(b=>b.onclick=async()=>{if(!requireCommunitySignIn())return;b.disabled=true;try{await cloud.api.toggleFollow(b.dataset.follow);}catch(e){alert(e?.message||'Could not update follow.');b.disabled=false;}});
  main.querySelectorAll('[data-comments]').forEach(b=>b.onclick=()=>openCommunityRecipe(b.dataset.comments));
  main.querySelectorAll('[data-share]').forEach(b=>b.onclick=()=>{
    const r=cloud.recipes.find(x=>x.id===b.dataset.share);
    if(r)shareRecipe(r);
  });
  main.querySelectorAll('[data-dbl-like]').forEach(img=>img.ondblclick=()=>likeFromPhoto(img.dataset.dblLike,img.closest('.thumb-wrap')));
  main.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>reportTarget({targetType:'recipe',targetId:b.dataset.report,targetUid:b.dataset.reportUid,contextId:b.dataset.report}));
  main.querySelectorAll('[data-block]').forEach(b=>b.onclick=()=>blockChef(b.dataset.block));
  main.querySelectorAll('[data-message]').forEach(b=>b.onclick=()=>messageChef(b.dataset.message));
  main.querySelectorAll('[data-open-chef]').forEach(b=>b.onclick=()=>openChef(b.dataset.openChef));
  main.querySelectorAll('[data-open-community-recipe]').forEach(b=>b.onclick=()=>openCommunityRecipe(b.dataset.openCommunityRecipe));
  main.querySelectorAll('[data-report-user]').forEach(b=>b.onclick=()=>reportTarget({targetType:'user',targetId:b.dataset.reportUser,targetUid:b.dataset.reportUser,contextId:''}));
  main.querySelectorAll('[data-toggle-block]').forEach(b=>b.onclick=async()=>{
    const uid=b.dataset.toggleBlock;
    if(cloud.blocked.has(uid))await unblockChef(uid);else await blockChef(uid);
  });
  // Only one "more options" menu is ever open at a time; stopPropagation keeps
  // this same click from immediately re-triggering the document-level closer.
  main.querySelectorAll('[data-menu-toggle]').forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();
    const menu=document.getElementById('menu-'+b.dataset.menuToggle);
    if(!menu)return;
    const wasHidden=menu.hidden;
    main.querySelectorAll('.card-menu').forEach(m=>m.hidden=true);
    menu.hidden=!wasHidden;
  });

  const back=document.querySelector('#backCommunity');
  if(back&&openChefProfile)back.onclick=()=>{history.back();};

  const searchBtn=document.querySelector('#chefSearchBtn');
  const searchBox=document.querySelector('#chefSearch');
  const runSearch=async()=>{
    chefSearchTerm=searchBox.value;
    if(chefSearchTerm.trim().length<2){chefSearchStatus='Type at least two characters to search.';chefSearchResults=[];render();return;}
    chefSearchStatus='Searching…';
    render();
    try{
      chefSearchResults=await cloud.api.searchChefProfiles(chefSearchTerm);
      chefSearchStatus=chefSearchResults.length?'':'No chefs matched that search.';
    }catch(e){chefSearchResults=[];chefSearchStatus=e?.message||'Chef search could not be loaded.';}
    render();
  };
  if(searchBtn)searchBtn.onclick=runSearch;
  if(searchBox)searchBox.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();runSearch();}};
}

async function openChef(uid){
  try{
    const profile=await cloud.api.getProfile(uid);
    if(!profile){safetyStatus('That chef profile could not be loaded.');return;}
    closeChefProfile();
    openChefProfile=profile;
    openChefRecipes=[];
    cloud.unsubChefRecipes=cloud.api.observeChefRecipes(uid,items=>{
      openChefRecipes=items;
      if(shouldRenderCommunity())render();
    },err=>safetyStatus(err?.message||'That chef\'s recipes could not be loaded.'));
    render();
    pushViewState();
  }catch(e){safetyStatus(e?.message||'That chef profile could not be loaded.');}
}
function closeChefProfile(){
  try{cloud.unsubChefRecipes?.();}catch{}
  cloud.unsubChefRecipes=null;
  openChefProfile=null;
  openChefRecipes=[];
}

// Which comment a reply is aimed at, if any. Cleared after posting so the next
// comment does not silently become a reply to something the chef forgot about.
let replyTarget=null;
function setReplyTarget(target){
  replyTarget=target;
  const banner=document.querySelector('#replyBanner');
  if(banner){
    banner.innerHTML=target
      ?`Replying to <strong>${escapeHtml(target.authorName)}</strong> · <button class="ghost" id="cancelReply">Cancel</button>`
      :'';
    document.querySelector('#cancelReply')?.addEventListener('click',()=>setReplyTarget(null));
  }
  const box=document.querySelector('#commentText');
  if(box&&target)box.focus();
}

function safetyStatus(message){
  const el=document.querySelector('#safetyStatus');
  if(el)el.textContent=message;
}

/**
 * Opens a moderation report. The status is fixed at 'open' by rule -- a client can
 * raise a report and nothing else; advancing it is the moderator-only callable.
 */
async function reportTarget({targetType,targetId,targetUid,contextId}){
  if(!requireCommunitySignIn())return;
  const reason=prompt('What is wrong with this content? A moderator will review it.','');
  if(reason===null)return;
  const clean=String(reason).trim();
  if(!clean){safetyStatus('A report needs a short reason so a moderator can act on it.');return;}
  try{
    await cloud.api.reportContent({targetType,targetId,targetUid,contextId,reason:clean});
    safetyStatus('Report submitted. A moderator will review it. Thank you.');
  }catch(e){safetyStatus(e?.message||'Could not submit the report.');}
}

async function blockChef(targetUid){
  if(!requireCommunitySignIn())return;
  if(!targetUid||targetUid===cloud.user.uid)return;
  if(!confirm('Block this chef? Their recipes and comments will be hidden from you, and neither of you can message or interact with the other.'))return;
  try{
    await cloud.api.setUserBlocked(targetUid,true);
    safetyStatus('Chef blocked. You can unblock them from your Profile.');
    render();
  }catch(e){safetyStatus(e?.message||'Could not block this chef.');}
}

async function unblockChef(targetUid){
  try{
    await cloud.api.setUserBlocked(targetUid,false);
    render();
  }catch(e){alert(e?.message||'Could not unblock this chef.');}
}
function openCommunityRecipe(id){
  const r=cloud.recipes.find(x=>x.id===id);if(!r)return;
  openCommunityRecipeId=id;
  try{cloud.unsubComments?.();}catch{}
  const liked=cloud.liked.has(r.id),bookmarked=cloud.bookmarks.has(r.id);
  const mediaHtml=(r.media||[]).map(m=>m.type==='VIDEO'?`<video class="detail-media" controls src="${escapeHtml(m.url)}"></video>`:`<div class="thumb-wrap"><img class="detail-media" data-dbl-like="${r.id}" src="${escapeHtml(m.url)}" alt="Recipe media"></div>`).join('');
  const voiceHtml=(r.voiceClips||[]).map(v=>`<audio class="audio-player" controls src="${escapeHtml(v.url)}"></audio>`).join('');
  main.innerHTML=`<button id="backCommunity" class="ghost">← Community</button><section class="card"><h1>${escapeHtml(r.title)}</h1><p class="status">by ${escapeHtml(r.authorName)} · serves ${r.servings} · ${relativeTime(r.createdAt)}</p><p>${escapeHtml(r.description||'')}</p><div class="action-row"><button class="action-btn${liked?' active':''}" id="detailLike" aria-label="Like">${liked?'♥':'♡'} ${formatCount(r.likes||0)}</button><button class="action-btn" id="detailShare" aria-label="Share">📤</button><button class="action-btn action-spacer${bookmarked?' saved':''}" id="detailSave" aria-label="${bookmarked?'Saved':'Save'}">${bookmarked?'★':'☆'}</button></div></section>${mediaHtml?`<section class="card"><div class="detail-media-grid">${mediaHtml}</div></section>`:''}<div class="section-title"><h2>Ingredients</h2></div>${r.ingredients.map(i=>`<div class="card">${escapeHtml([i.quantity,i.unit,i.name].filter(Boolean).join(' '))}</div>`).join('')}<div class="section-title"><h2>Method</h2></div>${r.steps.map((s,i)=>`<div class="step card"><span class="step-num">${i+1}</span><div>${escapeHtml(s)}</div></div>`).join('')}${voiceHtml?`<section class="card"><h2>Chef voice</h2><p class="hint">Original cooking-session audio published by the chef.</p>${voiceHtml}</section>`:''}<div class="section-title"><h2>Comments</h2></div><div id="safetyStatus" class="hint"></div><div id="comments"><div class="empty card">Loading comments…</div></div>${cloud.user?`<section class="card"><div id="replyBanner" class="hint"></div><textarea id="commentText" maxlength="800" placeholder="Add a comment"></textarea><button id="postComment" class="primary wide">Post comment</button><div id="commentStatus" class="hint"></div></section>`:'<div class="notice">Sign in to comment.</div>'}`;
  document.querySelector('#backCommunity').onclick=()=>{try{cloud.unsubComments?.();}catch{}cloud.unsubComments=null;openCommunityRecipeId=null;render();};

  // Like/save patch their own button in place instead of going through
  // render(): openCommunityRecipeId exists precisely to hold this view steady
  // while the comment thread below stays subscribed, so redrawing the whole
  // view here would defeat that (and blank the thread until its next change).
  const likeBtn=document.querySelector('#detailLike');
  if(likeBtn)likeBtn.onclick=async()=>{
    if(!requireCommunitySignIn())return;
    likeBtn.disabled=true;
    try{
      const nowLiked=await cloud.api.toggleLike(r.id);
      likeBtn.classList.toggle('active',nowLiked);
      likeBtn.textContent=`${nowLiked?'♥':'♡'} ${formatCount((r.likes||0)+(nowLiked?1:-1))}`;
    }catch(e){alert(e?.message||'Could not update like.');}
    finally{likeBtn.disabled=false;}
  };
  const saveBtn=document.querySelector('#detailSave');
  if(saveBtn)saveBtn.onclick=async()=>{
    if(!requireCommunitySignIn())return;
    saveBtn.disabled=true;
    try{
      const nowSaved=await cloud.api.toggleBookmark(r.id);
      saveBtn.classList.toggle('saved',nowSaved);
      saveBtn.textContent=nowSaved?'★':'☆';
      saveBtn.setAttribute('aria-label',nowSaved?'Saved':'Save');
    }catch(e){alert(e?.message||'Could not update bookmark.');}
    finally{saveBtn.disabled=false;}
  };
  document.querySelector('#detailShare')?.addEventListener('click',()=>shareRecipe(r));
  main.querySelectorAll('[data-dbl-like]').forEach(img=>img.ondblclick=()=>likeFromPhoto(r.id,img.closest('.thumb-wrap')));

  cloud.unsubComments=cloud.api.observeComments(r.id,comments=>{
    const el=document.querySelector('#comments');
    if(!el)return;
    // Same read half of blocking as the feed: a blocked chef's words are hidden too.
    const visible=withoutBlocked(comments,cloud.blocked);
    const {roots,repliesFor}=threadComments(visible);
    const actions=c=>cloud.user
      ?`<div class="row wrap" style="margin-top:6px"><button class="ghost" data-reply="${escapeHtml(c.id)}" data-reply-uid="${escapeHtml(c.authorId)}" data-reply-name="${escapeHtml(c.authorName)}">Reply</button>${c.authorId!==cloud.user.uid?`<button class="ghost" data-report-comment="${escapeHtml(c.id)}" data-comment-uid="${escapeHtml(c.authorId)}">⚑</button>`:''}</div>`
      :'';
    const card=(c,isReply)=>`<div class="card${isReply?' reply':''}"${isReply?' style="margin-left:18px"':''}><div class="row between"><strong>${escapeHtml(c.authorName)}</strong><small>${c.createdAt?new Date(c.createdAt).toLocaleDateString():''}</small></div>${isReply&&c.replyToName?`<p class="hint">to ${escapeHtml(c.replyToName)}</p>`:''}<p class="status">${escapeHtml(c.text)}</p>${actions(c)}</div>`;
    el.innerHTML=roots.length
      ?roots.map(c=>card(c,false)+repliesFor(c.id).map(x=>card(x,true)).join('')).join('')
      :'<div class="empty card">No comments yet.</div>';
    el.querySelectorAll('[data-report-comment]').forEach(b=>b.onclick=()=>reportTarget({targetType:'comment',targetId:b.dataset.reportComment,targetUid:b.dataset.commentUid,contextId:r.id}));
    el.querySelectorAll('[data-reply]').forEach(b=>b.onclick=()=>setReplyTarget({id:b.dataset.reply,authorId:b.dataset.replyUid,authorName:b.dataset.replyName}));
  },err=>{const el=document.querySelector('#comments');if(el)el.innerHTML=`<div class="notice">${escapeHtml(err?.message||'Could not load comments.')}</div>`;});
  const post=document.querySelector('#postComment');
  if(post)post.onclick=async()=>{
    const box=document.querySelector('#commentText');
    const status=document.querySelector('#commentStatus');
    post.disabled=true;status.textContent=replyTarget?'Posting reply…':'Posting…';
    try{
      await cloud.api.addComment(r.id,box.value,requireProfileName(),replyTarget);
      box.value='';
      status.textContent=replyTarget?'Reply posted.':'Posted.';
      setReplyTarget(null);
    }catch(e){status.textContent=e?.message||'Could not post comment.';}
    finally{post.disabled=false;}
  };
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
  const profileNotice=cloud.user&&cloud.profileError
    ?`<div class="notice">${escapeHtml(cloud.profileError)}</div>`
    :cloud.user&&cloud.profileLoaded&&!cloud.profile
      ?'<div class="notice">This account has no chef profile yet. Set a display name and save — Community posting, messages and publishing all need it.</div>'
      :'';
  const firebaseCard=cloud.user?`<section class="card"><div class="quality">Connected to ChefVoice Firebase</div><h2>${escapeHtml(cloud.user.email||'ChefVoice member')}</h2>${profileNotice}<div class="field"><label>Chef display name</label><input id="profileName" value="${escapeHtml(cloud.profile?.displayName||chefName())}"></div><div class="field"><label>Bio</label><textarea id="profileBio" placeholder="Tell the Community about your cooking">${escapeHtml(cloud.profile?.bio||'')}</textarea></div><button id="saveProfile" class="primary wide">Save profile</button><div id="profileStatus" class="hint"></div><button id="cloudSignOut" class="secondary wide" style="margin-top:10px">Sign out</button></section>`:`<section class="card"><h2>Sign in</h2><p class="status">Use the same Email/Password ChefVoice account you use on Android.</p><div class="stack"><div class="field"><label>Email</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="chef@example.com"></div><div class="field"><label>Password</label><input id="cloudPassword" type="password" autocomplete="current-password" placeholder="Password"></div><button id="cloudSignIn" class="primary wide">Sign in</button><div id="cloudAuthStatus" class="hint">${escapeHtml(cloud.message)}</div></div></section><section class="card"><h2>Create account</h2><div class="stack"><div class="field"><label>Chef name</label><input id="newChefName" placeholder="Chef Jamie"></div><div class="field"><label>Email</label><input id="newEmail" type="email" autocomplete="email"></div><div class="field"><label>Password</label><input id="newPassword" type="password" autocomplete="new-password" minlength="6"></div><button id="cloudSignUp" class="secondary wide">Create ChefVoice account</button><div id="cloudSignUpStatus" class="hint"></div></div></section>`;
  const pushCard=cloud.user
    ?`<section class="card"><h2>Notifications</h2><p class="status">The Activity tab in your Inbox always works. Push also alerts you when ChefVoice is closed.</p><div id="pushStatus" class="hint">${escapeHtml(pushMessage||'')}</div><div class="row wrap" style="margin-top:8px"><button class="secondary" id="enablePush">Turn on push</button><button class="ghost" id="disablePush">Turn off on this device</button></div></section>`
    :'';
  const blockedCard=cloud.user
    ?`<section class="card"><h2>Blocked chefs</h2>${cloud.blocked.size
        ?`<p class="hint">Their recipes and comments are hidden from you, and neither of you can interact with the other.</p>${[...cloud.blocked].map(uid=>`<div class="row between" style="margin-top:8px"><code>${escapeHtml(uid.slice(0,12))}…</code><button class="secondary" data-unblock="${escapeHtml(uid)}">Unblock</button></div>`).join('')}`
        :'<p class="status">You have not blocked anyone. You can block a chef from any recipe in Community.</p>'}</section>`
    :'';
  return `<div id="paywall"></div>${membershipTemplate()}${firebaseCard}${pushCard}${blockedCard}<section class="card"><h1>ChefVoice on iPhone</h1><p class="status">${standalone?'ChefVoice is running as a Home Screen web app.':'Install ChefVoice on your Home Screen without an Apple Developer subscription.'}</p>${!standalone&&ios?`<ol class="install-list"><li>Open this page in <strong>Safari</strong>.</li><li>Tap the <strong>Share</strong> button.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Turn on <strong>Open as Web App</strong> if shown, then tap Add.</li></ol>`:''}<div class="quality">Voice → ingredient parsing remains local and protected from Firebase changes.</div></section><section class="card"><h2>Protected voice behavior</h2><p class="status">Measurement-preserving recognition, spoken fractions, ASR homophone repair, cross-segment ingredient recovery, shared measurements, and spoken corrections remain unchanged by the Community integration.</p></section>`;
}
function bindProfile(){
  document.querySelector('#showPaywall')?.addEventListener('click',()=>showPaywall(PaywallTrigger.PROFILE));
  main.querySelectorAll('[data-unblock]').forEach(b=>b.onclick=()=>unblockChef(b.dataset.unblock));

  const setPushMessage=text=>{pushMessage=text;const el=document.querySelector('#pushStatus');if(el)el.textContent=text;};
  const enable=document.querySelector('#enablePush');
  if(enable)enable.onclick=async()=>{
    enable.disabled=true;
    setPushMessage('Asking your browser for permission…');
    try{
      await cloud.api.registerPushDevice();
      setPushMessage('Push is on for this browser.');
    }catch(e){setPushMessage(e?.message||'Push could not be turned on.');}
    finally{enable.disabled=false;}
  };
  const disable=document.querySelector('#disablePush');
  if(disable)disable.onclick=async()=>{
    disable.disabled=true;
    try{
      await cloud.api.unregisterPushDevice();
      setPushMessage('Push is off for this browser. The Activity tab still works.');
    }catch(e){setPushMessage(e?.message||'Push could not be turned off.');}
    finally{disable.disabled=false;}
  };
  const signIn=document.querySelector('#cloudSignIn');if(signIn)signIn.onclick=async()=>{const status=document.querySelector('#cloudAuthStatus');if(!cloud.api){status.textContent='Firebase has not finished loading.';return;}const email=document.querySelector('#cloudEmail').value.trim();const password=document.querySelector('#cloudPassword').value;if(!email||!password){status.textContent='Enter your email and password.';return;}signIn.disabled=true;status.textContent='Signing in…';try{await cloud.api.signIn(email,password);status.textContent='Signed in.';}catch(e){status.textContent=e?.message||'Could not sign in.';signIn.disabled=false;}};
  const signUp=document.querySelector('#cloudSignUp');if(signUp)signUp.onclick=async()=>{const status=document.querySelector('#cloudSignUpStatus');const name=document.querySelector('#newChefName').value.trim();const email=document.querySelector('#newEmail').value.trim();const password=document.querySelector('#newPassword').value;if(!email||password.length<6){status.textContent='Enter an email and a password of at least 6 characters.';return;}signUp.disabled=true;status.textContent='Creating account…';try{await cloud.api.signUp(email,password,name);status.textContent='Account created.';}catch(e){status.textContent=e?.message||'Could not create account.';signUp.disabled=false;}};
  const save=document.querySelector('#saveProfile');if(save)save.onclick=async()=>{const status=document.querySelector('#profileStatus');save.disabled=true;status.textContent='Saving…';try{await cloud.api.saveUserProfile(cloud.user.uid,{displayName:document.querySelector('#profileName').value,bio:document.querySelector('#profileBio').value,photoUrl:cloud.profile?.photoUrl||'',createdAt:cloud.profile?.createdAt||Date.now()});status.textContent='Profile saved.';}catch(e){status.textContent=e?.message||'Could not save profile.';}finally{save.disabled=false;}};
  const signOut=document.querySelector('#cloudSignOut');if(signOut)signOut.onclick=async()=>{signOut.disabled=true;try{await cloud.api?.signOutUser();}catch{signOut.disabled=false;}};
}

// ---- Inbox: direct messages + activity notifications ------------------------

// Read markers are monotonic by rule, so a stale listener cannot walk one
// backwards and resurrect an old badge.
const conversationUnread=c=>isConversationUnread(c,cloud.user?.uid,cloud.messageReads);
const unreadCounts=()=>computeUnreadCounts(cloud.conversations,cloud.notifications,cloud.user?.uid,cloud.messageReads);
function updateInboxBadge(){
  const badge=document.querySelector('#inboxBadge');
  if(!badge)return;
  const {messages,activity}=unreadCounts();
  const total=messages+activity;
  badge.hidden=total===0;
  badge.textContent=total>99?'99+':String(total);
}

const otherUid=c=>otherParticipant(c,cloud.user?.uid);
const otherName=c=>otherParticipantName(c,cloud.user?.uid);

function inboxTemplate(){
  if(!cloud.user){
    return `<section class="hero" style="--hero:url('../assets/community-hero.webp')"><div class="eyebrow">Inbox</div><h1>Messages and activity.</h1></section><div class="notice">Sign in from Profile to see your messages and activity.</div>`;
  }
  if(openConversation)return conversationTemplate();

  const {messages,activity}=unreadCounts();
  const tabs=`<div class="row" style="margin:10px 2px;gap:8px"><button class="${inboxSection==='messages'?'primary':'secondary'}" data-inbox="messages">Messages${messages?` (${messages})`:''}</button><button class="${inboxSection==='activity'?'primary':'secondary'}" data-inbox="activity">Activity${activity?` (${activity})`:''}</button></div>`;

  if(inboxSection==='activity'){
    const list=cloud.notifications.length
      ?cloud.notifications.map(n=>`<article class="card ${n.readAt<=0?'unread':''}" data-notification="${escapeHtml(n.id)}"><div class="row between"><strong>${escapeHtml(n.title)}</strong>${n.readAt<=0?'<span class="pill">New</span>':''}</div>${n.body?`<p class="status">${escapeHtml(n.body)}</p>`:''}<div class="row wrap" style="margin-top:8px">${n.readAt<=0?`<button class="secondary" data-read="${escapeHtml(n.id)}">Mark read</button>`:''}<button class="ghost" data-dismiss-notification="${escapeHtml(n.id)}">Dismiss</button></div></article>`).join('')
      :'<div class="empty card">No activity yet. Likes, comments, replies, follows and Live alerts show up here.</div>';
    return `<section class="hero" style="--hero:url('../assets/community-hero.webp')"><div class="eyebrow">Inbox</div><h1>Messages and activity.</h1></section>${tabs}<div id="safetyStatus" class="hint"></div>${list}`;
  }

  const visible=cloud.conversations.filter(c=>!cloud.blocked.has(otherUid(c)));
  const hidden=cloud.conversations.length-visible.length;
  // Conversations are hidden from the list but the thread itself stays reachable
  // and readable if already open -- blocking stops new contact, it does not erase
  // history the chef may need.
  const list=visible.length
    ?visible.map(c=>`<article class="card" data-conversation="${escapeHtml(c.id)}"><div class="row between"><strong>${escapeHtml(otherName(c))}</strong>${conversationUnread(c)?'<span class="pill">New</span>':''}</div><p class="status">${escapeHtml(c.lastMessage||'No messages yet.')}</p><button class="secondary" data-open-conversation="${escapeHtml(c.id)}">Open</button></article>`).join('')
    :'<div class="empty card">No conversations yet. Open a chef\'s recipe in Community and choose Message chef.</div>';
  const blockedNote=hidden?`<div class="notice">${hidden} conversation${hidden===1?'':'s'} with blocked chefs ${hidden===1?'is':'are'} hidden.</div>`:'';
  return `<section class="hero" style="--hero:url('../assets/community-hero.webp')"><div class="eyebrow">Inbox</div><h1>Messages and activity.</h1></section>${tabs}<div id="safetyStatus" class="hint"></div>${blockedNote}${list}`;
}

function conversationTemplate(){
  const c=openConversation;
  const name=otherName(c);
  const blocked=cloud.blocked.has(otherUid(c));
  const thread=threadMessages.length
    ?threadMessages.map(m=>`<div class="card ${m.senderId===cloud.user.uid?'mine':''}"><div class="row between"><strong>${escapeHtml(m.senderName)}</strong><small>${new Date(m.createdAt).toLocaleString()}</small></div><p class="status">${escapeHtml(m.text)}</p></div>`).join('')
    :'<div class="empty card">No messages yet. Say hello.</div>';
  const composer=blocked
    ?'<div class="notice">You blocked this chef. Unblock them to send messages again. Your history stays visible.</div>'
    :`<section class="card"><textarea id="messageText" maxlength="2000" placeholder="Write a message"></textarea><button id="sendMessage" class="primary wide">Send</button></section>`;
  return `<button id="backInbox" class="ghost">← Inbox</button><section class="card"><div class="row between"><h1>${escapeHtml(name)}</h1><span class="pill">${blocked?'Blocked':'Direct messages'}</span></div><div class="row wrap"><button class="ghost" data-report-user="${escapeHtml(otherUid(c))}">⚑ Report chef</button><button class="ghost" data-toggle-block="${escapeHtml(otherUid(c))}">${blocked?'Unblock chef':'Block chef'}</button></div></section><div id="safetyStatus" class="hint"></div>${thread}${composer}`;
}

function bindInbox(){
  main.querySelectorAll('[data-inbox]').forEach(b=>b.onclick=()=>{inboxSection=b.dataset.inbox;render();});
  main.querySelectorAll('[data-open-conversation]').forEach(b=>b.onclick=()=>openConversationView(b.dataset.openConversation));
  main.querySelectorAll('[data-read]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{await cloud.api.markNotificationRead(b.dataset.read);}catch(e){safetyStatus(e?.message||'Could not mark that as read.');b.disabled=false;}
  });
  main.querySelectorAll('[data-dismiss-notification]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{await cloud.api.deleteNotification(b.dataset.dismissNotification);}catch(e){safetyStatus(e?.message||'Could not dismiss that.');b.disabled=false;}
  });

  const back=document.querySelector('#backInbox');
  if(back)back.onclick=()=>{history.back();};
  main.querySelectorAll('[data-report-user]').forEach(b=>b.onclick=()=>reportTarget({targetType:'user',targetId:b.dataset.reportUser,targetUid:b.dataset.reportUser,contextId:openConversation?.id||''}));
  main.querySelectorAll('[data-toggle-block]').forEach(b=>b.onclick=async()=>{
    const uid=b.dataset.toggleBlock;
    if(cloud.blocked.has(uid))await unblockChef(uid);
    else await blockChef(uid);
  });
  const send=document.querySelector('#sendMessage');
  if(send)send.onclick=async()=>{
    const box=document.querySelector('#messageText');
    const text=box.value;
    if(!text.trim())return;
    send.disabled=true;
    try{
      await cloud.api.sendDirectMessage(openConversation,text,requireProfileName());
      box.value='';
    }catch(e){safetyStatus(e?.message||'Could not send the message.');}
    finally{send.disabled=false;}
  };
}

function openConversationView(conversationId){
  const c=cloud.conversations.find(x=>x.id===conversationId);
  if(!c)return;
  closeConversationView();
  openConversation=c;
  threadMessages=[];
  cloud.unsubThread=cloud.api.observeDirectMessages(c.id,items=>{
    threadMessages=items;
    // Mark read against the newest message actually seen, not "now" -- the rule
    // keeps the marker monotonic and this keeps it honest.
    const newest=items.reduce((max,m)=>Math.max(max,m.createdAt),0);
    if(newest>(cloud.messageReads[c.id]||0))cloud.api.markConversationRead(c.id,newest).catch(()=>{});
    if(currentTab==='inbox')render();
  },err=>safetyStatus(err?.message||'Conversation could not be loaded.'));
  render();
  pushViewState();
}
function closeConversationView(){
  try{cloud.unsubThread?.();}catch{}
  cloud.unsubThread=null;
  openConversation=null;
  threadMessages=[];
}

async function messageChef(targetUid){
  if(!requireCommunitySignIn())return;
  if(!targetUid||targetUid===cloud.user.uid)return;
  try{
    // The rule checks both names against the *live* profiles, so a recipe card's
    // cached authorName is not good enough -- it goes stale when a chef renames.
    const profile=await cloud.api.getProfile(targetUid);
    const targetName=String(profile?.displayName||'').trim();
    if(!targetName)throw new Error('That chef profile could not be loaded.');
    const conversation=await cloud.api.startConversation(targetUid,targetName,requireProfileName());
    if(!cloud.conversations.some(c=>c.id===conversation.id))cloud.conversations=[conversation,...cloud.conversations];
    inboxSection='messages';
    nav('inbox');
    openConversationView(conversation.id);
  }catch(e){safetyStatus(e?.message||'Could not open messages with this chef.');}
}

/**
 * Unlike like/save/follow, sharing changes nothing server-side, so it is never
 * sign-in gated -- anyone who can already see a public recipe can pass its link
 * on. The link opens straight into that recipe (see pendingSharedRecipeId
 * above) rather than dropping a chef on the bare feed.
 */
async function shareRecipe(recipe){
  const url=`${location.origin}/?tab=community&recipe=${encodeURIComponent(recipe.id)}`;
  const shareData={title:recipe.title||'A ChefVoice recipe',text:`${recipe.title||'A recipe'} on ChefVoice, by ${recipe.authorName||'a ChefVoice chef'}`,url};
  if(navigator.share){
    try{await navigator.share(shareData);}
    catch(e){if(e?.name!=='AbortError')safetyStatus('Could not open the share sheet.');}
    return;
  }
  try{await navigator.clipboard.writeText(url);safetyStatus('Recipe link copied to clipboard.');}
  catch{safetyStatus(url);}
}

function liveTemplate(){return `<section class="hero" style="--hero:url('../assets/live-hero.webp')"><div class="eyebrow">Live kitchen</div><h1>Cook together, in real time.</h1><p>Community is now writable across Android and iPhone. WebRTC Live stays behind a separate device-test gate so it cannot interfere with the protected microphone/ingredient workflow.</p></section><div class="card"><strong>Live remains intentionally gated</strong><p class="status">The next Live milestone is Android ↔ iPhone signaling, camera, microphone and reconnection testing on real devices.</p></div>`;}

function render(){
  if(currentTab==='cook'){main.innerHTML=cookTemplate();bindCook();}
  if(currentTab==='recipes'){main.innerHTML=recipesTemplate();bindRecipes();}
  if(currentTab==='community'){main.innerHTML=communityTemplate();bindCommunity();}
  if(currentTab==='inbox'){main.innerHTML=inboxTemplate();bindInbox();}
  if(currentTab==='live')main.innerHTML=liveTemplate();
  if(currentTab==='profile'){main.innerHTML=profileTemplate();bindProfile();}
  renderPaywall();
  updateInboxBadge();
}

if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
window.addEventListener('beforeunload',()=>{capture.close();for(const key of ['unsubAuth','unsubFeed','unsubProfile','unsubLiked','unsubBookmarks','unsubFollowing','unsubComments','unsubEntitlement','unsubBlocked','unsubConversations','unsubMessageReads','unsubNotifications','unsubThread','unsubChefRecipes'])try{cloud[key]?.();}catch{}});
window.addEventListener('popstate',e=>{restoreViewState(e.state);});
// Closes any open chef "more options" menu on an outside click. A single
// document-level listener, rather than one per card, since render() throws the
// whole card list away and rebuilds it on every like/follow/etc.
document.addEventListener('click',()=>{document.querySelectorAll('.card-menu').forEach(m=>m.hidden=true);});
// The very first paint bypasses nav(), so the tab bar's active class (otherwise
// only kept in sync by nav()) is set here to match a tab requested via ?tab=.
tabs.forEach(b=>b.classList.toggle('active',b.dataset.tab===currentTab));
render();
history.replaceState(currentViewState(),'',location.pathname);
