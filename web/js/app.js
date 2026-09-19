import { VoiceCapture } from './voice-capture.js';
import { parseIngredient } from './ingredient-parser.js';
import { mergeDraft, parseCookingSession } from './cooking-session-parser.js';
import {
  deleteAudioBlob, deleteRecipeMedia, loadAudioBlob, loadCollections, loadMediaBlob,
  loadRecipes, loadShoppingItems, saveAudioBlob, saveCollections, saveMediaBlob,
  saveRecipes, saveShoppingItems
} from './storage.js';
import {
  collectionsContaining, createCollection, deleteCollection, recipesInCollection,
  setRecipeInCollection
} from './collections.js';
import { convert, MeasurementSystem, scale, servingFactor } from './ingredient-scaling.js';
import { additionMessage, asShareText, displayText, itemsFor, merge as mergeShopping } from './shopping-list.js';
import { formatClock } from './step-timers.js';
import { matchCommand, safeFromPartial } from './cook-commands.js';
import {
  beginSwipe, dismissDirection, dismissOffset, isHorizontal, saveOffset, saveProgress,
  shouldSave, trackSwipe
} from './swipe-gestures.js';
import {
  applyCookCommand, clearTimer, currentStep as cookCurrentStep, initialCookState,
  nextStep as cookNextStep, previousStep as cookPreviousStep, setHandsFree, setReadAloud,
  startTimer as startCookTimer, tickTimer, timersForStep, toggleTimerPause
} from './cook-along.js';
import {
  cloudRecipesRemaining, daysRemaining, FoundingAccess, FreeTierLimits, FREE_ENTITLEMENT,
  isEntitlementActive, isFounding, isPromo, PaywallTrigger, recordSecondPassUse, remainingLabel,
  secondPassMonthlyLimit, secondPassRemaining, SecondPassLimits
} from './entitlement.js';
import {
  applyMethodSuggestion, applySuggestion, fromCloudTranscript
} from './second-pass-reviewer.js';
import * as ChefAnalytics from './chef-analytics.js';
import {
  conversationUnread as isConversationUnread, otherParticipant, otherParticipantName,
  threadComments, unreadCounts as computeUnreadCounts, withoutBlocked
} from './inbox.js';
import { parseTagsInput, tagMatchesQuery } from './tag-utils.js';
import { LiveViewerController } from './webrtc-live-viewer.js';
import { LiveHostController } from './webrtc-live-host.js';

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
const form={title:'',description:'',servings:'2',tags:'',prepTime:'',cookTime:''};
const cookStepLabels=['Capture','Recipe Details','Ingredients/Method','Media','Review'];
let cookStep=0;let captureBusy=false;let savingRecipe=false;
// A stable id for this in-progress draft's private audio, minted on first Second
// Pass use during Capture (before the recipe itself exists) and reused as the
// real recipe id on save, so the uploaded privateVoice/ object stays attached to
// the recipe it was reviewed for -- see privateRecipeOwnedBy in storage.rules.
let draftRecipeId='';
let captureSecondPass={busy:false,message:'',result:null};
const cookEditors={manualIngredient:'',manualStep:'',transcriptEditor:null};
let mediaStatus='';let recipeSaveError='';
// The chef's own filing of their own library and their own errand list. Both are local to
// this browser for the same reason they are local on Android: cloud bookmarks already cover
// saving other chefs' dishes, so neither needs a Firestore collection or a rules deploy, and
// both keep working signed out.
let collections=loadCollections();
let shoppingItems=loadShoppingItems();
let activeCollectionId='';
let shoppingMessage='';
// Screens that sit on top of a tab and own the whole <main>: the shopping list and the
// cook-along. Held as state rather than sniffed out of the DOM so a background feed or
// bookmark update cannot redraw the tab underneath and yank the chef out of them.
let overlayScreen='';
const cloud={
  state:'connecting',message:'Connecting to ChefVoice Community…',api:null,user:null,profile:null,recipes:[],feedError:'',
  liked:new Set(),bookmarks:new Set(),following:new Set(),entitlement:{...FREE_ENTITLEMENT},blocked:new Set(),
  profileLoaded:false,profileError:'',verifyEmailMessage:'',
  conversations:[],messageReads:{},notifications:[],
  unsubAuth:null,unsubFeed:null,unsubProfile:null,unsubLiked:null,unsubBookmarks:null,unsubFollowing:null,unsubComments:null,unsubEntitlement:null,unsubBlocked:null,
  unsubConversations:null,unsubMessageReads:null,unsubNotifications:null,unsubThread:null,unsubChefRecipes:null,
  unsubLiveSessions:null,unsubLiveSessionDoc:null,unsubLiveComments:null
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
  chefSearchTerm='';chefSearchResults=[];chefSearchStatus='';communitySearchOpen=false;
  closeChefProfile();
}
// See openCommunityRecipeId's declaration below for why the community tab's
// listener-driven re-renders all gate on this instead of just the tab name.
// True only while the Recipes list itself is showing, never inside an opened recipe, so a
// background refresh of saves or the feed cannot yank the chef out of what they are reading.
const onRecipesList=()=>currentTab==='recipes'&&!openCommunityRecipeId&&!overlayScreen&&!document.querySelector('#backRecipes,#backCommunity');
const shouldRenderCommunity=()=>currentTab==='community'&&!openCommunityRecipeId&&!overlayScreen;
// Same reasoning as shouldRenderCommunity: while a Live room is open, its own
// targeted listeners patch the DOM directly (see openLiveRoom) instead of going
// through render(), which would tear down and recreate the <video> element and
// its RTCPeerConnection on every unrelated discovery-list update.
const shouldRenderLiveList=()=>currentTab==='live'&&!openLiveSession&&!liveHostController;
function startUserObservers(user){
  clearUserObservers();
  if(!user||!cloud.api)return;
  // profileLoaded distinguishes "the listener has not fired yet" from "it fired
  // and this account has no profile document", which need different messages:
  // one resolves itself, the other needs the chef to save a display name.
  cloud.unsubProfile=cloud.api.observeProfile(user.uid,p=>{
    cloud.profile=p;cloud.profileLoaded=true;cloud.profileError='';
    if(currentTab==='profile'||onRecipesList()||shouldRenderCommunity())render();
  },err=>{
    cloud.profileLoaded=true;cloud.profileError=err?.message||'Your chef profile could not be loaded.';
    if(currentTab==='profile')render();
  });
  cloud.unsubEntitlement=cloud.api.observeProEntitlement(user.uid,e=>{cloud.entitlement=e;if(currentTab==='profile'||onRecipesList())render();});
  cloud.unsubBlocked=cloud.api.observeBlockedUserIds(user.uid,s=>{cloud.blocked=s;if(shouldRenderCommunity()||currentTab==='profile')render();});
  cloud.unsubConversations=cloud.api.observeConversations(user.uid,items=>{cloud.conversations=items;updateInboxBadge();if(currentTab==='inbox')render();});
  cloud.unsubMessageReads=cloud.api.observeMessageReads(user.uid,map=>{cloud.messageReads=map;updateInboxBadge();if(currentTab==='inbox')render();});
  cloud.unsubNotifications=cloud.api.observeNotifications(user.uid,items=>{cloud.notifications=items;updateInboxBadge();if(currentTab==='inbox')render();});
  cloud.unsubLiked=cloud.api.observeUserRecipeIds(user.uid,'likes',s=>{cloud.liked=s;if(shouldRenderCommunity())render();});
  cloud.unsubBookmarks=cloud.api.observeUserRecipeIds(user.uid,'bookmarks',s=>{cloud.bookmarks=s;if(shouldRenderCommunity()||onRecipesList())render();});
  cloud.unsubFollowing=cloud.api.observeUserRecipeIds(user.uid,'following',s=>{cloud.following=s;if(shouldRenderCommunity())render();});
}
async function initCloud(){
  try{
    const api=await import('./firebase-client.js');
    cloud.api=api;cloud.state='ready';cloud.message='Connected to ChefVoice Firebase. Community writes are enabled.';
    cloud.unsubAuth=api.observeAuth(user=>{
      if(liveHostController&&user?.uid!==liveHostController.hostUid)closeLiveRoom();
      cloud.user=user;startUserObservers(user);
      if(currentTab==='profile'||onRecipesList()||shouldRenderCommunity()||shouldRenderLiveList())render();
    });
    cloud.unsubFeed=api.observePublicRecipes(items=>{
      cloud.recipes=items;cloud.feedError='';if(onRecipesList())render();
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
    // Live sessions are world-readable, so this starts unconditionally like the
    // feed above rather than waiting on sign-in -- browsing Live works signed out.
    cloud.unsubLiveSessions=api.observeLiveSessions(items=>{
      liveSessions=items;liveSessionsError='';
      if(shouldRenderLiveList())render();
    },err=>{liveSessionsError=err?.message||'Live sessions could not be loaded.';if(shouldRenderLiveList())render();});
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
  onSegment:s=>{const i=transcript.findIndex(t=>t.id===s.id);if(i>=0)transcript[i]=s;else transcript.push(s);renderCaptureState();},
  onPartial:s=>{livePartial=s;renderCaptureState();},
  onStatus:s=>{captureStatus=s;renderCaptureState();}
});

function captureForm(){
  const title=document.querySelector('#title');if(title)form.title=title.value;
  const desc=document.querySelector('#description');if(desc)form.description=desc.value;
  const servings=document.querySelector('#servings');if(servings)form.servings=servings.value;
  const tags=document.querySelector('#tags');if(tags)form.tags=tags.value;
  for(const key of ['prepTime','cookTime']){const input=document.getElementById(key);if(input)form[key]=input.value;}
  for(const key of Object.keys(cookEditors)){const input=document.getElementById(key);if(input)cookEditors[key]=input.value;}
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
    chefUid:currentTab==='community'?(openChefProfile?.uid||null):null,
    liveSessionId:currentTab==='live'?(openLiveSession?.id||null):null,
    liveHostSetup:currentTab==='live'&&Boolean(liveHostController)
  };
}
function pushViewState(){
  if(restoringHistory)return;
  const state=currentViewState();
  const prev=history.state;
  if(prev&&prev.tab===state.tab&&(prev.conversationId||null)===state.conversationId&&(prev.chefUid||null)===state.chefUid&&(prev.liveSessionId||null)===state.liveSessionId&&Boolean(prev.liveHostSetup)===state.liveHostSetup)return;
  history.pushState(state,'');
}
async function restoreViewState(state){
  state=state||{tab:'cook'};
  restoringHistory=true;
  try{
    nav(state.tab||'cook');
    if(state.tab==='inbox'&&state.conversationId)openConversationView(state.conversationId);
    if(state.tab==='community'&&state.chefUid)await openChef(state.chefUid);
    // If the list has not loaded this session id yet (or it is no longer live),
    // this is a no-op and the chef just sees the discovery list -- same fallback
    // ChefVoice already uses for a shared-recipe link that no longer resolves.
    if(state.tab==='live'&&state.liveSessionId){
      const session=liveSessions.find(s=>s.id===state.liveSessionId);
      if(session)openLiveRoom(session);
    }
  }finally{
    restoringHistory=false;
  }
}
function nav(tab){
  captureForm();
  try{cloud.unsubComments?.();}catch{}
  cloud.unsubComments=null;
  openCommunityRecipeId=null;
  // Leaving for another tab ends a cook-along, which is what releases the wake lock and
  // stops the microphone; nothing about hands-free may outlive the screen that offered it.
  closeCookAlong();
  overlayScreen='';
  setReplyTarget(null);
  // Leaving the Inbox closes any open thread listener; openConversationView
  // re-establishes it when a conversation is opened again.
  if(tab!=='inbox')closeConversationView();
  if(tab!=='community')closeChefProfile();
  // Unconditional (unlike the two guards above): re-entering the Live tab should
  // always start from the discovery list, and restoreViewState() re-opens a
  // specific room afterward when history says one was open. Tearing down the
  // RTCPeerConnection here every time nav() runs, rather than only when leaving
  // the tab, is deliberate -- see closeLiveRoom().
  closeLiveRoom();
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
  <section class="cook-wizard" aria-label="Create recipe">
    <header class="cook-progress" id="cookProgress" tabindex="-1">
      <p>Step ${cookStep+1} of ${cookStepLabels.length} · ${cookStepLabels[cookStep]}</p>
      <progress value="${cookStep+1}" max="5" aria-label="Recipe creation progress">${cookStep+1} of 5</progress>
    </header>
    <div id="ongoingCapture"></div>
    <div class="cook-step">${cookStepTemplate()}</div>
    <nav class="cook-step-nav" aria-label="Recipe steps">
      ${cookStep>0?'<button id="cookBack" class="secondary">Back</button>':''}
      ${cookStep===4?`<button id="saveRecipe" class="primary" aria-describedby="recipeSaveHint" ${canSaveRecipe()?'':'disabled'}>Save recipe</button>`:'<button id="cookNext" class="primary">Next</button>'}
    </nav>
  </section>`;
}

function cookStepTemplate(){
  switch(cookStep){
    case 0:return `<h2>Create recipe</h2><p class="status">Cook, talk, and let ChefVoice build the first draft while keeping the creator’s real voice.</p><section id="captureCard"></section><section id="captureSecondPass"></section>`;
    case 1:return `<h2>Recipe Details</h2><section class="card stack">
      <div class="field"><label for="title">Recipe name</label><input id="title" value="${escapeHtml(form.title)}" placeholder="Sunday tomato pasta"></div>
      <div class="field"><label for="description">Description / chef note</label><textarea id="description" placeholder="What makes this recipe yours?">${escapeHtml(form.description)}</textarea></div>
      <div class="field"><label for="servings">Servings</label><input id="servings" inputmode="numeric" value="${escapeHtml(form.servings)}"></div>
      <div class="field"><label for="tags">Tags</label><input id="tags" value="${escapeHtml(form.tags)}" placeholder="#bbq, camping, weeknight"></div>
      <div class="row"><div class="field grow"><label for="prepTime">Prep min</label><input id="prepTime" inputmode="numeric" maxlength="4" value="${escapeHtml(form.prepTime)}" placeholder="Optional"></div><div class="field grow"><label for="cookTime">Cook min</label><input id="cookTime" inputmode="numeric" maxlength="4" value="${escapeHtml(form.cookTime)}" placeholder="Optional"></div></div>
    </section>`;
    case 2:return `<h2>Ingredients/Method</h2>
      <div class="section-title"><h3>Ingredients</h3><span class="count" id="ingredientCount"></span></div><div id="ingredientList"></div>
      <div class="card"><div class="row"><input id="manualIngredient" class="grow" aria-label="Add an ingredient" value="${escapeHtml(cookEditors.manualIngredient)}" placeholder="e.g. two tablespoons olive oil"><button id="addIngredient" class="secondary">Add</button></div></div>
      <div class="section-title"><h3>Method</h3><span class="count" id="stepCount"></span></div><div id="stepList"></div>
      <div class="card"><textarea id="manualStep" aria-label="Add a cooking step" placeholder="Add a cooking step">${escapeHtml(cookEditors.manualStep)}</textarea><button id="addStep" class="secondary wide">Add step</button></div>
      <details class="card"><summary>Transcript recovery</summary><p class="hint">If speech recognition misses something, paste or correct the words here and rebuild the draft. Your recorded audio is kept separately.</p><textarea id="transcriptEditor" aria-label="Cooking transcript" placeholder="Paste a transcript or correction here…">${escapeHtml(cookEditors.transcriptEditor??transcript.map(s=>s.text).join(' '))}</textarea><button id="reanalyze" class="secondary wide">Re-analyze transcript</button></details>`;
    case 3:return `<h2>Media</h2><section class="card"><h3>Chef voice</h3><div id="draftVoice"></div></section>
      <section class="card"><h3>Photos &amp; video</h3><div class="row"><button id="takeRecipePhoto" class="secondary grow">📷 Take photo</button><button id="recordRecipeVideo" class="secondary grow">🎬 Record video</button></div><input id="recipePhotoInput" type="file" accept="image/*" capture="environment" hidden><input id="recipeVideoInput" type="file" accept="video/*" capture="environment" hidden><label for="mediaInput" class="hint">Choose photos or cooking clips from your phone.</label><input id="mediaInput" type="file" accept="image/*,video/*" multiple><p class="hint">Up to 25 MB per image and 200 MB per video. Files stay local until you explicitly publish.</p><p id="mediaStatus" class="hint" role="status">${escapeHtml(mediaStatus)}</p><div id="mediaPreview" class="media-preview"></div></section>`;
    case 4:return `<h2>Review</h2><p class="status">Check everything before saving. Use Back to change anything.</p><div id="recipeReview"></div><p id="recipeSaveHint" class="hint" role="status"></p><p id="recipeSaveError" class="notice" role="alert" ${recipeSaveError?'':'hidden'}>${escapeHtml(recipeSaveError)}</p>`;
  }
}

function canSaveRecipe(){return !!form.title.trim()&&ingredients.some(i=>i.name.trim())&&!capturing&&!captureBusy&&!captureSecondPass.busy&&!savingRecipe;}
function renderRecipeReview(){
  const el=document.querySelector('#recipeReview');if(!el)return;
  const photos=media.filter(m=>m.type.startsWith('image/')).length;
  const videos=media.filter(m=>m.type.startsWith('video/')).length;
  el.innerHTML=`<section class="card"><h3>${escapeHtml(form.title.trim()||'Untitled recipe')}</h3>${form.description.trim()?`<p>${escapeHtml(form.description)}</p>`:''}<p>Serves ${Math.max(1,Number(form.servings)||2)}${form.prepTime?` · Prep ${Number(form.prepTime)}m`:''}${form.cookTime?` · Cook ${Number(form.cookTime)}m`:''}</p>${parseTagsInput(form.tags).map(t=>`<span class="pill">#${escapeHtml(t)}</span>`).join(' ')}</section>
    <section class="card"><h3>${ingredients.length} ingredient${ingredients.length===1?'':'s'}</h3>${ingredients.length?`<ul>${ingredients.map(i=>`<li>${escapeHtml([i.quantity,i.unit,i.name].filter(Boolean).join(' '))}</li>`).join('')}</ul>`:'<p class="hint">No ingredients yet.</p>'}</section>
    <section class="card"><h3>${steps.length} method step${steps.length===1?'':'s'}</h3>${steps.length?`<ol>${steps.map(step=>`<li>${escapeHtml(step)}</li>`).join('')}</ol>`:'<p class="hint">No method steps yet.</p>'}</section>
    <section class="card"><h3>Media</h3><p>${photos} photo${photos===1?'':'s'} · ${videos} video${videos===1?'':'s'} · ${audioBlob?.size?1:0} voice clip</p></section>`;
  renderCookSaveState();
}
function renderCookSaveState(){
  const save=document.querySelector('#saveRecipe');if(save){save.disabled=!canSaveRecipe();save.textContent=savingRecipe?'Saving…':'Save recipe';}
  const hint=document.querySelector('#recipeSaveHint');if(hint)hint.textContent=capturing||captureBusy?'Finish cooking capture before saving.':captureSecondPass.busy?'Finish ChefVoice Review before saving.':!form.title.trim()?'Add a recipe name before saving.':!ingredients.some(i=>i.name.trim())?'Add at least one ingredient before saving.':'Your recipe will be saved privately on this device.';
}
function renderDraftVoice(){
  const el=document.querySelector('#draftVoice');if(!el)return;
  el.innerHTML=audioBlob?.size&&audioUrl?`<p class="hint">Your original cooking session stays with this recipe.</p><audio class="audio-player" aria-label="Original chef voice" controls src="${escapeHtml(audioUrl)}"></audio>`:'<p class="hint">Your recorded cooking session will appear here. You can go Back to Capture to record, or continue without audio.</p>';
}
function renderCaptureState(){
  renderCapture();
  const el=document.querySelector('#ongoingCapture');
  if(el){
    el.innerHTML=cookStep!==0&&(capturing||captureBusy)?`<div class="notice"><p>${escapeHtml(captureStatus)}</p><button id="finishCookCapture" class="secondary wide" ${captureBusy?'disabled':''}>${captureBusy?'Please wait…':'Finish &amp; build recipe'}</button></div>`:'';
    document.querySelector('#finishCookCapture')?.addEventListener('click',toggleCapture);
  }
  const video=document.querySelector('#recordRecipeVideo');if(video)video.disabled=capturing||captureBusy;
  renderCookSaveState();
}
function moveCookStep(delta){
  if(savingRecipe)return;
  captureForm();cookStep=Math.max(0,Math.min(4,cookStep+delta));render();
  const heading=document.querySelector('#cookProgress');
  heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start'});
}

function renderCapture(){
  const el=document.querySelector('#captureCard');if(!el)return;
  const live=transcript.length||livePartial;
  el.innerHTML=`<div class="card capture-card"><div class="capture-head"><div class="capture-title">${capturing?'<span class="live-dot"></span>LIVE COOKING CAPTURE':'🎙 Cook & capture'}</div>${capturing?'<span class="pill">Listening</span>':''}</div><p class="status">${escapeHtml(captureStatus)}</p><p class="hint">Say things like “add two teaspoons of salt,” “half a teaspoon each of salt and pepper,” or “actually make that three cups.” ChefVoice keeps measurement evidence when recognition changes its mind.</p>${live?`<div class="transcript">${transcript.slice(-6).map(s=>`<div class="transcript-line"><time>${fmt(s.elapsedMs)}</time>${escapeHtml(s.text)}</div>`).join('')}${livePartial?`<div class="transcript-line partial">… ${escapeHtml(livePartial)}</div>`:''}</div>`:''}<div class="quality">Original microphone audio is preserved independently of the ingredient parser.</div><button id="captureBtn" class="primary wide" style="margin-top:12px" ${captureBusy?'disabled':''}>${captureBusy?'Please wait…':capturing?'⏹ Finish & build recipe':'🎙 Start cooking capture'}</button></div>`;
  document.querySelector('#captureBtn')?.addEventListener('click',toggleCapture);
}
// ---- Second Pass on the just-recorded draft (before save) -------------------
// Same explicit opt-in review as the saved-recipe "ChefVoice Review" above, run
// against the in-memory draft instead of a persisted recipe: it diffs the cloud
// re-transcription against whatever Capture already parsed and lets the chef pull
// suggestions straight into the wizard's ingredients/steps, rather than typing
// corrections by hand once they reach Ingredients/Method. Recipe Details (title,
// servings, prep/cook time, etc.) stay manual -- Second Pass only ever classifies
// ingredient and method text, never durations, so there is nothing to prefill there.
function captureSecondPassTemplate(){
  if(!audioBlob?.size||capturing||captureBusy)return '';
  const pro=isPro();
  const remaining=secondPassRemaining(pro);
  const limit=secondPassMonthlyLimit(pro);
  if(!captureSecondPass.result){
    return `<section class="card"><h2>ChefVoice Review</h2><p class="hint">Re-transcribes this cooking audio in the cloud right now, before you save, so a cleaner draft can fill in Ingredients/Method for you. Nothing changes until you accept a suggestion.</p><p class="hint">Covers recordings up to ${SecondPassLimits.MAX_REVIEW_MINUTES} minutes; longer sessions stay on this device and play back in full.</p><p class="status">${remaining} of ${limit} reviews left this month.</p><button id="runCaptureSecondPass" class="secondary wide"${captureSecondPass.busy?' disabled':''}>${captureSecondPass.busy?'Running…':'Run ChefVoice Review'}</button>${captureSecondPass.message?`<p class="hint">${escapeHtml(captureSecondPass.message)}</p>`:''}</section>`;
  }
  const result=captureSecondPass.result;
  const card=(issue,kind)=>{
    const suggestion=kind==='ingredient'
      ?(issue.suggested?[issue.suggested.quantity,issue.suggested.unit,issue.suggested.name].filter(Boolean).join(' '):'')
      :(issue.suggestedStep||'');
    const canApply=kind==='ingredient'?issue.type!=='live-only-low-confidence':issue.type!=='live-only-step';
    return `<article class="card"><div class="row between"><strong>${escapeHtml(issue.title)}</strong><span class="pill">${Math.round(issue.confidence*100)}%</span></div><p class="status">${escapeHtml(issue.detail)}</p>${canApply?`<div class="row wrap"><button class="secondary" data-accept-capture-${kind}="${escapeHtml(issue.id)}">${issue.type.startsWith('remove')?'Remove':'Use second pass'}</button><button class="ghost" data-dismiss-capture-issue="${escapeHtml(issue.id)}">Keep current</button></div>`:''}${suggestion?`<p class="hint">Suggested: ${escapeHtml(suggestion)}</p>`:''}</article>`;
  };
  const issues=[...result.issues.map(i=>card(i,'ingredient')),...result.methodIssues.map(i=>card(i,'method'))].join('');
  return `<section class="card"><h2>ChefVoice Review</h2><p class="status">${result.confirmedCount+result.methodConfirmedCount} confirmed · ${result.issues.length+result.methodIssues.length} to review.</p><p class="hint">Provider: ${escapeHtml(result.provider)} · ${escapeHtml(result.model)}. Your original audio is unchanged.</p><button id="closeCaptureSecondPass" class="ghost wide">Close review</button>${captureSecondPass.message?`<p class="hint">${escapeHtml(captureSecondPass.message)}</p>`:''}</section>${issues||'<div class="empty card">The second pass agreed with everything. Nothing to review.</div>'}<section class="card"><h3>Second pass transcript</h3><p class="hint">${escapeHtml(result.transcript||'No transcript returned.')}</p></section>`;
}
function renderCaptureSecondPass(){
  const el=document.querySelector('#captureSecondPass');if(!el)return;
  el.innerHTML=captureSecondPassTemplate();
  bindCaptureSecondPass();
}
function rebuildCaptureSecondPass(){
  captureSecondPass.result=fromCloudTranscript({
    liveIngredients:ingredients,
    liveSteps:steps,
    transcript:captureSecondPass.result.transcript,
    rawSegments:captureSecondPass.result.rawSegments||[],
    provider:captureSecondPass.result.provider,
    model:captureSecondPass.result.model
  });
  // The chef just accepted second-pass content, so that transcript is the better
  // record of what was said and Recipe Details should follow it. Capture-time
  // detection ran against the live transcript, which can have missed the spoken
  // recipe name and cook time entirely -- a review that confirms nothing is
  // exactly that case. Still only fills fields the chef has left empty.
  const metaNote=applyDetectedRecipeMeta(captureSecondPass.result);
  captureSecondPass.message='Applied. Ingredients/Method updated below.'+metaNote;
  renderCookDynamic();
}
function bindCaptureSecondPass(){
  const run=document.querySelector('#runCaptureSecondPass');
  if(run)run.onclick=runCaptureSecondPass;
  const close=document.querySelector('#closeCaptureSecondPass');
  if(close)close.onclick=()=>{captureSecondPass={busy:false,message:'',result:null};renderCookDynamic();};
  main.querySelectorAll('[data-accept-capture-ingredient]').forEach(b=>b.onclick=()=>{
    const issue=captureSecondPass.result.issues.find(i=>i.id===b.dataset.acceptCaptureIngredient);
    if(!issue)return;
    ingredients=applySuggestion(ingredients,issue);
    ChefAnalytics.secondPassAccepted(ChefAnalytics.KIND_INGREDIENT);
    rebuildCaptureSecondPass();
  });
  main.querySelectorAll('[data-accept-capture-method]').forEach(b=>b.onclick=()=>{
    const issue=captureSecondPass.result.methodIssues.find(i=>i.id===b.dataset.acceptCaptureMethod);
    if(!issue)return;
    steps=applyMethodSuggestion(steps,issue);
    ChefAnalytics.secondPassAccepted(ChefAnalytics.KIND_METHOD);
    rebuildCaptureSecondPass();
  });
  main.querySelectorAll('[data-dismiss-capture-issue]').forEach(b=>b.onclick=()=>{
    captureSecondPass.result={
      ...captureSecondPass.result,
      issues:captureSecondPass.result.issues.filter(i=>i.id!==b.dataset.dismissCaptureIssue),
      methodIssues:captureSecondPass.result.methodIssues.filter(i=>i.id!==b.dataset.dismissCaptureIssue)
    };
    renderCookDynamic();
  });
}
async function runCaptureSecondPass(){
  if(!cloud.user){safetyStatus('Sign in to run ChefVoice Review.');nav('profile');return;}
  const pro=isPro();
  if(secondPassRemaining(pro)<=0){
    captureSecondPass.message=`You have used all ${secondPassMonthlyLimit(pro)} ChefVoice Reviews this month.`;
    showPaywall(PaywallTrigger.SECOND_PASS);
    renderCookDynamic();
    return;
  }
  if(!draftRecipeId)draftRecipeId=crypto.randomUUID();
  captureSecondPass={busy:true,message:'Uploading the private original audio and running Chirp 3. This can take a few minutes.',result:null};
  renderCookDynamic();
  try{
    const cloudResult=await cloud.api.transcribePrivateChefVoice(draftRecipeId,audioBlob);
    // Counted only on success: a failed review must not burn an allowance.
    recordSecondPassUse();
    ChefAnalytics.secondPassOpened();
    const review=liveIngredients=>fromCloudTranscript({
      liveIngredients,
      liveSteps:steps,
      transcript:cloudResult.transcript,
      rawSegments:cloudResult.segments,
      provider:cloudResult.provider,
      model:cloudResult.model
    });
    let result=review(ingredients);
    // A "possible missed ingredient" is purely additive: the live transcript
    // never caught it, so applying it cannot overwrite or drop anything the
    // chef recorded. Those go straight in. Every other kind still needs an
    // explicit "Use second pass" -- a quantity change, a name cleanup, removing
    // a live artifact and any method wording all alter or discard what was
    // actually said, which is exactly what this review exists to keep opt-in.
    const missed=result.issues.filter(i=>i.type==='possible-missed-ingredient');
    if(missed.length){
      for(const issue of missed)ingredients=applySuggestion(ingredients,issue);
      result=review(ingredients);
    }
    result.rawSegments=cloudResult.segments;
    // Recipe Details fills straight from the review too. Running the review is
    // already the chef's explicit opt-in, and this only ever writes into fields
    // they left empty, so nothing they typed is touched.
    const addedNote=missed.length?`Added ${missed.length} ingredient${missed.length===1?'':'s'} ChefVoice Review heard.`:'';
    captureSecondPass={busy:false,message:`${addedNote}${applyDetectedRecipeMeta(result)}`.trim(),result};
  }catch(e){
    captureSecondPass={busy:false,message:e?.message||'ChefVoice Review could not finish. Your local recipe and audio are unchanged.',result:null};
  }
  renderCookDynamic();
}
function renderIngredients(){
  const el=document.querySelector('#ingredientList');if(!el)return;
  document.querySelector('#ingredientCount').textContent=`${ingredients.length} detected`;
  el.innerHTML=ingredients.length?ingredients.map((i,n)=>`<div class="ingredient" data-ing="${n}"><input aria-label="Quantity" value="${escapeHtml(i.quantity)}" data-k="quantity"><input aria-label="Unit" value="${escapeHtml(i.unit)}" data-k="unit"><input aria-label="Ingredient name" value="${escapeHtml(i.name)}" data-k="name"><button class="icon-btn" data-remove="${n}" aria-label="Remove ingredient">×</button></div>`).join(''):'<div class="empty card">Ingredients detected from your voice will appear here.</div>';
  el.querySelectorAll('input[data-k]').forEach(input=>input.addEventListener('input',e=>{const row=e.target.closest('[data-ing]');ingredients[Number(row.dataset.ing)][e.target.dataset.k]=e.target.value;}));
  el.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{ingredients.splice(Number(b.dataset.remove),1);renderIngredients();}));
}
function renderSteps(){
  const el=document.querySelector('#stepList');if(!el)return;document.querySelector('#stepCount').textContent=`${steps.length} steps`;
  el.innerHTML=steps.length?steps.map((s,n)=>`<div class="step card"><span class="step-num">${n+1}</span><textarea aria-label="Method step ${n+1}" data-step="${n}">${escapeHtml(s)}</textarea><button class="icon-btn" data-step-remove="${n}" aria-label="Remove method step ${n+1}">×</button></div>`).join(''):'<div class="empty card">Cooking steps from your narration will appear here.</div>';
  el.querySelectorAll('[data-step]').forEach(t=>t.addEventListener('input',e=>steps[Number(e.target.dataset.step)]=e.target.value));
  el.querySelectorAll('[data-step-remove]').forEach(b=>b.addEventListener('click',()=>{steps.splice(Number(b.dataset.stepRemove),1);renderSteps();}));
}
function renderMedia(){
  const el=document.querySelector('#mediaPreview');if(!el)return;
  el.innerHTML=media.map(m=>`<div class="thumb-wrap">${m.type.startsWith('video')?`<video src="${m.url}" controls></video>`:`<img src="${m.url}" alt="Recipe media">`}<button class="media-remove" data-media-remove="${m.id}" aria-label="Remove this photo/video">×</button></div>`).join('');
  el.querySelectorAll('[data-media-remove]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.mediaRemove;
    const item=media.find(x=>x.id===id);
    if(item)try{URL.revokeObjectURL(item.url)}catch{}
    media=media.filter(x=>x.id!==id);
    renderMedia();
  });
}
function renderCookDynamic(){renderCaptureState();renderCaptureSecondPass();renderIngredients();renderSteps();renderMedia();renderDraftVoice();renderRecipeReview();}

// Fills Recipe Details fields the chef hasn't already touched from what the
// parser detected in this capture -- never overwrites a manual edit, and a
// field the parser found no evidence for (prepMinutes/cookMinutes/title all
// stay empty/'' when unset) is simply left for the chef to type, same as always.
// The chef can finish a capture from any wizard step, so the Recipe Details
// inputs may already be mounted. captureForm() first, so anything typed into
// them during the capture counts as a manual edit; write the detected values
// back into them after, because the next navigation re-reads those inputs into
// `form` and would otherwise wipe the detection right back out.
function applyDetectedRecipeMeta(draft){
  captureForm();
  const notes=[];
  if(draft.title&&!form.title.trim()){form.title=draft.title;notes.push(`title "${draft.title}"`);}
  if(draft.prepMinutes!=null&&!form.prepTime){form.prepTime=String(draft.prepMinutes);notes.push(`${draft.prepMinutes}m prep`);}
  if(draft.cookMinutes!=null&&!form.cookTime){form.cookTime=String(draft.cookMinutes);notes.push(`${draft.cookMinutes}m cook`);}
  for(const key of ['title','prepTime','cookTime']){const input=document.getElementById(key);if(input)input.value=form[key];}
  return notes.length?` Detected ${notes.join(', ')} -- review in Recipe Details.`:'';
}

async function toggleCapture(){
  if(captureBusy||savingRecipe)return;
  captureBusy=true;renderCaptureState();
  try{
  if(capturing){
    captureStatus='Finishing capture and waiting for the last words…';renderCapture();
    const result=await capture.stop();capturing=false;audioBlob=result.audioBlob;
    if(audioUrl)URL.revokeObjectURL(audioUrl);if(audioBlob?.size)audioUrl=URL.createObjectURL(audioBlob);
    const draft=parseCookingSession(transcript);const merged=mergeDraft(ingredients,steps,draft);ingredients=merged.ingredients;steps=merged.steps;
    const metaNote=applyDetectedRecipeMeta(draft);
    captureStatus=(draft.ingredients.length||draft.steps.length?`Draft ready: ${draft.ingredients.length} ingredient${draft.ingredients.length===1?'':'s'} and ${draft.steps.length} step${draft.steps.length===1?'':'s'} detected. Continue to Ingredients/Method to review the draft.`:'Audio saved. Use Transcript recovery in Ingredients/Method if live recognition missed the cooking words.')+metaNote;
    cookEditors.transcriptEditor=null;
    const editor=document.querySelector('#transcriptEditor');if(editor)editor.value=transcript.map(s=>s.text).join(' ');
    renderCookDynamic();
  }else{
    if(isIOS&&speechNeedsReset){captureForm();sessionStorage.setItem('chefvoice.capture.recovery',JSON.stringify({form,ingredients,steps,transcript}));location.reload();return;}
    try{
      transcript=[];livePartial='';audioBlob=null;if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl='';voiceEngineUsed=true;captureSecondPass={busy:false,message:'',result:null};
      await capture.start();
      capturing=true;
      // Only once capture is actually running: a denied microphone permission or a
      // failed start is not a chef who began narrating.
      ChefAnalytics.recipeCaptureStarted();
      renderCookDynamic();
    }
    catch(e){captureStatus=`Microphone could not start: ${e.message}`;renderCapture();}
  }
  }catch(e){captureStatus=`Capture could not finish: ${e.message||'Please try again.'}`;}
  // captureBusy flipping false right here is what unhides the ChefVoice Review
  // card (captureSecondPassTemplate gates on it) -- renderCaptureState() alone
  // never touches #captureSecondPass, only renderCookDynamic() does, so without
  // this the card stayed invisible until something else forced a full re-render
  // (e.g. Next then Back).
  finally{captureBusy=false;renderCookDynamic();}
}

function bindCook(){
  renderCookDynamic();
  document.querySelector('#cookBack')?.addEventListener('click',()=>moveCookStep(-1));
  document.querySelector('#cookNext')?.addEventListener('click',()=>moveCookStep(1));
  for(const [id,key] of [['title','title'],['description','description'],['servings','servings'],['tags','tags'],['prepTime','prepTime'],['cookTime','cookTime']]){
    document.getElementById(id)?.addEventListener('input',e=>{
      if(['servings','prepTime','cookTime'].includes(key))e.target.value=e.target.value.replace(/\D/g,'').slice(0,key==='servings'?3:4);
      form[key]=e.target.value;
    });
  }
  for(const key of Object.keys(cookEditors))document.getElementById(key)?.addEventListener('input',e=>cookEditors[key]=e.target.value);
  document.querySelector('#addIngredient')?.addEventListener('click',()=>{const x=document.querySelector('#manualIngredient');if(x.value.trim()){ingredients.push({...parseIngredient(x.value),confidence:'manual'});x.value='';cookEditors.manualIngredient='';renderIngredients();}});
  document.querySelector('#addStep')?.addEventListener('click',()=>{const x=document.querySelector('#manualStep');if(x.value.trim()){steps.push(x.value.trim());x.value='';cookEditors.manualStep='';renderSteps();}});
  document.querySelector('#reanalyze')?.addEventListener('click',()=>{const text=document.querySelector('#transcriptEditor').value.trim();if(!text)return;transcript=[{id:crypto.randomUUID(),elapsedMs:0,text}];const d=parseCookingSession(transcript);ingredients=d.ingredients;steps=d.steps;const metaNote=applyDetectedRecipeMeta(d);captureStatus=`Transcript rebuilt: ${ingredients.length} ingredients and ${steps.length} steps.`+metaNote;renderCookDynamic();});
  // Video and per-recipe photo caps are deliberately NOT enforced here. Both limits
  // exist in the tier model on both platforms, but Android raises a paywall only for
  // the Second Pass quota, the cloud-recipe cap and the profile "See Pro" button --
  // `videoAllowed` and `PHOTOS_PER_RECIPE` have no call site there. Enforcing them
  // on the web alone would give a Free chef a worse deal in Safari than on their
  // phone for the same account. If these should bite, they need to land on both
  // platforms in the same change.
  document.querySelector('#takeRecipePhoto')?.addEventListener('click',()=>document.querySelector('#recipePhotoInput').click());
  document.querySelector('#recordRecipeVideo')?.addEventListener('click',()=>document.querySelector('#recipeVideoInput').click());
  for(const inputId of ['mediaInput','recipePhotoInput','recipeVideoInput'])document.getElementById(inputId)?.addEventListener('change',e=>{
    mediaStatus='';
    for(const f of e.target.files){
      if(!/^(image|video)\//.test(f.type)){mediaStatus+=`${f.name} was not added: choose an image or video. `;continue;}
      const max=f.type.startsWith('video/')?200*1024*1024:25*1024*1024;
      if(f.size>max){mediaStatus+=`${f.name} was not added because it exceeds the ${f.type.startsWith('video/')?'200 MB video':'25 MB image'} alpha limit.`;continue;}
      media.push({id:crypto.randomUUID(),name:f.name,type:f.type,url:URL.createObjectURL(f),file:f});
    }
    e.target.value='';
    document.querySelector('#mediaStatus').textContent=mediaStatus;renderMedia();
  });
  document.querySelector('#saveRecipe')?.addEventListener('click',async()=>{
    captureForm();if(!canSaveRecipe())return;
    savingRecipe=true;recipeSaveError='';renderCookSaveState();
    try{
    const recipeId=draftRecipeId||crypto.randomUUID();
    const recipe={id:recipeId,title:form.title.trim()||'Untitled recipe',description:form.description.trim(),servings:Math.max(1,Number(form.servings)||2),prepTimeMinutes:Number(form.prepTime)||0,cookTimeMinutes:Number(form.cookTime)||0,ingredients:structuredClone(ingredients),steps:[...steps],transcript:structuredClone(transcript),createdAt:Date.now(),updatedAt:Date.now(),isPublic:false,media:[],tags:parseTagsInput(form.tags)};
    if(audioBlob?.size){try{recipe.sessionAudio=await saveAudioBlob(recipe.id,audioBlob);}catch(e){recipe.audioWarning=e.message;}}
    for(const item of media){try{await saveMediaBlob(recipe.id,item.id,item.file);recipe.media.push({id:item.id,name:item.name,type:item.type,size:item.file.size,stored:true});}catch(e){recipe.mediaWarning=e.message;}}
    const updatedRecipes=[recipe,...recipes];saveRecipes(updatedRecipes);recipes=updatedRecipes;
    for(const item of media)try{URL.revokeObjectURL(item.url)}catch{}
    if(audioUrl)URL.revokeObjectURL(audioUrl);
    // Only a brand-new recipe is a completion. Edits and publishes are not.
    ChefAnalytics.recipeCompleted();
    captureStatus='Recipe saved on this device.';form.title='';form.description='';form.servings='2';form.tags='';ingredients=[];steps=[];transcript=[];audioBlob=null;audioUrl='';media=[];livePartial='';cookStep=0;form.prepTime='';form.cookTime='';cookEditors.manualIngredient='';cookEditors.manualStep='';cookEditors.transcriptEditor=null;mediaStatus='';draftRecipeId='';captureSecondPass={busy:false,message:'',result:null};nav('recipes');
    }catch(e){recipeSaveError=`Could not save this recipe: ${e.message||'device storage is unavailable'}. Your draft is still here.`;const error=document.querySelector('#recipeSaveError');if(error){error.hidden=false;error.textContent=recipeSaveError;}}
    finally{savingRecipe=false;renderCookSaveState();}
  });
}

function savedCookbookTemplate(){
  if(!cloud.user)return '<div class="section-title"><h2>Saved cookbook</h2></div><div class="empty card">Sign in, then tap ☆ on any Community recipe to keep it here.</div>';
  const saved=cloud.recipes.filter(r=>cloud.bookmarks.has(r.id));
  const body=saved.length?saved.map(r=>`<article class="card recipe-card"><div><div class="row between"><h3>${escapeHtml(r.title)}</h3><span class="pill">★ Saved</span></div><p>by ${escapeHtml(r.authorName)} · ${r.ingredients?.length||0} ingredients · ${r.steps?.length||0} steps</p><div class="row wrap" style="margin-top:9px"><button class="secondary" data-open-community-recipe="${escapeHtml(r.id)}">Open</button></div></div></article>`).join(''):`<div class="empty card"><strong>No saved Community recipes yet.</strong><br>Tap ☆ on recipes you want to cook again.${cloud.bookmarks.size?' Your saved recipes are still loading from the Community feed.':''}</div>`;
  return `<div class="section-title"><h2>Saved cookbook</h2></div>${body}`;
}

/** The shopping-list shortcut, carrying how much is still to buy so the chef can see it from here. */
function shoppingButtonTemplate(){
  const remaining=shoppingItems.filter(i=>!i.checked).length;
  return `<div class="row wrap"><button class="secondary grow" id="openShopping">🛒 Shopping list${remaining?` · ${remaining} to buy`:''}</button><button class="secondary grow" id="openImport">🔗 Import from a web address</button></div>`;
}

/**
 * Collection chips. "All recipes" is always first and always reachable, so a chef can never
 * end up filtered into a collection with no way back to their whole library.
 */
function collectionsTemplate(){
  const chip=(id,label,count)=>`<button class="chip${activeCollectionId===id?' active':''}" data-collection="${escapeHtml(id)}">${escapeHtml(label)} <span class="chip-count">${count}</span></button>`;
  const chips=[chip('','All recipes',recipes.length)]
    .concat(collections.map(c=>chip(c.id,c.name,recipesInCollection(recipes,collections,c.id).length)))
    .join('');
  const active=collections.find(c=>c.id===activeCollectionId);
  return `<section class="card">
    <div class="row between"><strong>Collections</strong><button class="ghost" id="newCollection">+ New</button></div>
    <p class="hint">Your own filing of your own recipes, kept in this browser. Open a recipe to file it.</p>
    <div class="chip-row">${chips}</div>
    ${active?`<button class="ghost wide" id="deleteCollection" style="margin-top:10px">Delete “${escapeHtml(active.name)}” · the recipes stay</button>`:''}
  </section>`;
}

function recipesTemplate(){
  const cloudNote=cloud.user?`<div class="quality">Signed in as ${escapeHtml(cloud.user.email||'ChefVoice member')}. Publishing now uses the verified ChefVoice Firebase project.</div>`:`<div class="notice">Local recipes stay private on this device. Sign in from Profile to publish to Community.</div>`;
  const shown=recipesInCollection(recipes,collections,activeCollectionId);
  const emptyNote=recipes.length
    ?'<div class="empty card"><strong>Nothing in this collection yet.</strong><br>Open a recipe and tap 🗂 to file it here.</div>'
    :'<div class="empty card"><strong>No saved recipes yet.</strong><br>Start a cooking capture and ChefVoice will build your first one.</div>';
  return `<section class="hero" style="--hero:url('../assets/chefvoice-cover.webp')"><div class="eyebrow">Your kitchen archive</div><h1>Recipes with a voice.</h1><p>Your local recipe library stays available even if Firebase is offline.</p></section><div id="paywall"></div>${cloudNote}${shoppingButtonTemplate()}${collectionsTemplate()}${shown.length?shown.map(r=>`<article class="card recipe-card"><img src="assets/chefvoice-cover.webp" alt=""><div><div class="row between"><h3>${escapeHtml(r.title)}</h3>${r.isPublic?'<span class="pill">Public</span>':'<span class="pill">Private</span>'}</div><p>${r.ingredients?.length||0} ingredients · ${r.steps?.length||0} steps · serves ${r.servings||2}</p>${r.tags?.length?`<p class="hint">${r.tags.map(t=>`#${escapeHtml(t)}`).join(' ')}</p>`:''}<div class="row wrap" style="margin-top:9px"><button class="secondary" data-open-recipe="${r.id}">Open</button>${(r.steps||[]).length?`<button class="ghost" data-cook-recipe="${r.id}">🍳 Cook</button>`:''}${cloud.user?(r.isPublic?`<button class="ghost" data-unpublish="${r.id}">Unpublish</button>`:`<button class="primary" data-publish="${r.id}">Publish</button>`):''}<button class="danger" data-delete-recipe="${r.id}">${r.isPublic||r.authorId?'Delete':'Delete local'}</button></div><div class="hint" data-recipe-status="${r.id}"></div></div></article>`).join(''):emptyNote}${savedCookbookTemplate()}`;
}
/** The site name to show a chef: the host without a leading "www.". */
function importedHost(url){
  try{return new URL(url).hostname.replace(/^www\./,'')||url;}catch{return url||'another site';}
}

async function publishLocalRecipe(id,button){
  const r=recipes.find(x=>x.id===id);if(!r||!cloud.api||!cloud.user)return;
  const status=document.querySelector(`[data-recipe-status="${id}"]`);
  // Publishing an imported recipe is allowed, but never by accident. The method came from
  // someone else's page, and the credit that says so lives in the description -- which the
  // chef may have edited away. They are told both things and decide.
  if(!r.isPublic&&r.importedFrom&&!confirm(
    `This recipe was imported from ${importedHost(r.importedFrom)}.\n\n` +
    'Publishing it puts another site\'s method on your Community profile under your name. ' +
    'Keep the "Source:" credit in the description, and only publish it if you are happy to ' +
    'share it.\n\nPublish anyway?'
  ))return;
  // Free accounts sync a limited number of recipes. The recipe is never lost -- it stays
  // saved in this browser, which is what the copy has to say.
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
  const shopping=main.querySelector('#openShopping');
  if(shopping)shopping.onclick=()=>openShoppingList(()=>{overlayScreen='';render();});
  const importButton=main.querySelector('#openImport');
  if(importButton)importButton.onclick=()=>{
    closeCookAlong();
    overlayScreen='import';
    recipeImport={busy:false,message:'',notes:[],host:'',url:''};
    renderImport();
    window.scrollTo({top:0,behavior:'smooth'});
  };
  main.querySelectorAll('[data-collection]').forEach(b=>b.onclick=()=>{activeCollectionId=b.dataset.collection;render();});
  const newCollection=main.querySelector('#newCollection');
  if(newCollection)newCollection.onclick=()=>{
    const name=prompt('Name this collection — "Weeknight", "Thanksgiving":','');
    if(name===null)return;
    const result=createCollection(collections,name);
    collections=result.collections;saveCollections(collections);
    if(result.id)activeCollectionId=result.id;
    render();
  };
  const removeCollection=main.querySelector('#deleteCollection');
  if(removeCollection)removeCollection.onclick=()=>{
    const active=collections.find(c=>c.id===activeCollectionId);
    if(!active)return;
    // Worth confirming even though nothing is lost but the grouping: a chef reading fast
    // could easily take this for "delete these recipes".
    if(!confirm(`Delete the collection “${active.name}”? The recipes in it are kept.`))return;
    collections=deleteCollection(collections,active.id);saveCollections(collections);
    activeCollectionId='';render();
  };
  main.querySelectorAll('[data-cook-recipe]').forEach(b=>b.onclick=()=>{
    const r=recipes.find(x=>x.id===b.dataset.cookRecipe);
    if(r)openCookAlong(r,()=>{overlayScreen='';render();});
  });
  main.querySelectorAll('[data-open-recipe]').forEach(b=>b.onclick=()=>openRecipe(b.dataset.openRecipe));
  main.querySelectorAll('[data-open-community-recipe]').forEach(b=>b.onclick=()=>openCommunityRecipe(b.dataset.openCommunityRecipe));
  main.querySelectorAll('[data-publish]').forEach(b=>b.onclick=()=>publishLocalRecipe(b.dataset.publish,b));
  main.querySelectorAll('[data-unpublish]').forEach(b=>b.onclick=()=>unpublishLocalRecipe(b.dataset.unpublish,b));
  main.querySelectorAll('[data-delete-recipe]').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.deleteRecipe;const r=recipes.find(x=>x.id===id);
    const status=document.querySelector(`[data-recipe-status="${id}"]`);
    // A recipe that is public now, or was ever published (Unpublish clears isPublic
    // but never authorId), has a Firestore doc and possibly Storage media under this
    // id -- mirrors Android's ChefAppState.deleteRecipe hasCloudCopy check. Deleting
    // it for real requires the ownership-preflight-then-delete flow below; a plain
    // local recipe was never in the cloud, so local cleanup alone is still correct.
    if(r&&(r.isPublic||r.authorId)){
      if(!cloud.api||!cloud.user){if(status)status.textContent='Sign in with the ChefVoice account that owns this recipe before deleting it.';return;}
      if(!confirm('Delete this recipe from ChefVoice Community and this device? This cannot be undone.'))return;
      b.disabled=true;if(status)status.textContent='Checking Community/cloud recipe…';
      try{
        const check=await cloud.api.inspectRecipeForMutation(id);
        if(check.exists&&check.authorId&&check.authorId!==cloud.user.uid){
          b.disabled=false;if(status)status.textContent='This recipe belongs to a different ChefVoice account, so it was not deleted.';
          return;
        }
        if(check.exists){if(status)status.textContent='Deleting recipe from Community/cloud…';await cloud.api.deleteChefVoiceRecipe(id);}
      }catch(e){
        b.disabled=false;if(status)status.textContent=e?.message||'Could not verify or delete the cloud recipe. The copy on this device was kept.';
        return;
      }
    }else if(r&&r.sessionAudio?.stored&&cloud.api&&cloud.user){
      // ChefVoice Review can upload the original cooking audio to private Cloud
      // Storage before this recipe is ever published (post-save Review, or the Cook
      // wizard's capture-time Review, which reuses draftRecipeId as the saved recipe
      // id) -- so a never-cloud-backed recipe that was reviewed can leave audio
      // orphaned under this id. Best-effort only: must never block the local delete.
      cloud.api.deleteChefVoiceRecipe(id).catch(()=>{});
    }
    recipes=recipes.filter(x=>x.id!==id);saveRecipes(recipes);await deleteAudioBlob(id);await deleteRecipeMedia(r);render();
  });
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
    return `<section class="card"><h2>ChefVoice Review</h2><p class="hint">Re-transcribes your original cooking audio in the cloud and shows what a cleaner transcript heard. Nothing changes until you accept a suggestion.</p><p class="hint">Covers recordings up to ${SecondPassLimits.MAX_REVIEW_MINUTES} minutes; longer sessions stay on this device and play back in full.</p><p class="status">${remaining} of ${limit} reviews left this month.</p><button id="runSecondPass" class="secondary wide"${secondPass.busy?' disabled':''}>${secondPass.busy?'Running…':'Run ChefVoice Review'}</button>${secondPass.message?`<p class="hint">${escapeHtml(secondPass.message)}</p>`:''}</section>`;
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

// ---- Recipe detail: how the chef is *viewing* a recipe, never how it is stored ---------
// Scaling and unit conversion are display only. A chef who narrated "two cups of flour" said
// two cups; a stepper on a screen must not quietly become the record, so nothing here is
// written back to the recipe -- exactly as on Android.
let recipeView={recipeId:'',servings:2,system:MeasurementSystem.AS_WRITTEN};
let collectionPickerOpen=false;

function recipeViewFor(recipe){
  if(recipeView.recipeId!==recipe.id){
    recipeView={recipeId:recipe.id,servings:Math.max(1,Number(recipe.servings)||2),system:MeasurementSystem.AS_WRITTEN};
  }
  return recipeView;
}

const baseServingsOf=recipe=>Math.max(1,Number(recipe.servings)||2);

/** The servings stepper, the unit switch, and the way onto the shopping list. */
function scalingTemplate(recipe){
  const view=recipeViewFor(recipe);
  const base=baseServingsOf(recipe);
  const systems=[[MeasurementSystem.AS_WRITTEN,'As written'],[MeasurementSystem.METRIC,'Metric'],[MeasurementSystem.IMPERIAL,'Imperial']];
  return `<section class="card stack">
    <div class="row between">
      <div><strong>Serves ${view.servings}</strong><br><span class="hint">${view.servings===base?'As the chef cooked it':`Scaled from ${base} · the saved recipe is unchanged`}</span></div>
      <div class="row"><button class="ghost" id="servingsDown" ${view.servings>1?'':'disabled'} aria-label="Fewer servings">−</button><button class="ghost" id="servingsUp" ${view.servings<99?'':'disabled'} aria-label="More servings">+</button></div>
    </div>
    <div class="row">${systems.map(([value,label])=>`<button class="${view.system===value?'primary':'ghost'} grow" data-system="${value}">${label}</button>`).join('')}</div>
    ${view.system!==MeasurementSystem.AS_WRITTEN?'<p class="hint">Units ChefVoice cannot convert without guessing — a cup of flour is not a cup of honey — stay exactly as the chef said them.</p>':''}
    <button class="secondary wide" id="addToShopping">🛒 Add to shopping list</button>
    ${shoppingMessage?`<div class="row between"><span class="hint">${escapeHtml(shoppingMessage)}</span><span class="row"><button class="ghost" id="viewShoppingList">View list</button><button class="ghost" id="dismissShoppingMessage">OK</button></span></div>`:''}
  </section>`;
}

function collectionPickerTemplate(recipeId){
  const filed=collectionsContaining(collections,recipeId);
  const summary=filed.length?`🗂 ${filed.map(c=>c.name).join(', ')}`:'🗂 Add to a collection';
  const rows=collections.length
    ?collections.map(c=>`<div class="row" style="gap:9px;margin:7px 0"><input type="checkbox" id="file-${escapeHtml(c.id)}" data-file-collection="${escapeHtml(c.id)}" style="width:auto" ${(c.recipeIds||[]).includes(recipeId)?'checked':''}><label for="file-${escapeHtml(c.id)}">${escapeHtml(c.name)}</label></div>`).join('')
    :'<p class="hint">No collections yet. Name your first one below.</p>';
  return `<details class="card" id="collectionPicker" ${collectionPickerOpen?'open':''}><summary>${escapeHtml(summary)}</summary><p class="hint">Collections are your own filing of your own recipes, kept in this browser.</p>${rows}<div class="row" style="margin-top:10px"><input id="newCollectionName" class="grow" maxlength="60" placeholder="New collection"><button class="secondary" id="addCollectionHere">Add</button></div></details>`;
}

function openRecipe(id){
  const r=recipes.find(x=>x.id===id);if(!r)return;
  const view=recipeViewFor(r);
  const factor=servingFactor(baseServingsOf(r),view.servings);
  const shownIngredients=convert(scale(r.ingredients||[],factor),view.system);
  const remoteMedia=(r.remoteMedia||[]).map(m=>m.type==='VIDEO'?`<video class="detail-media" controls src="${escapeHtml(m.url)}"></video>`:`<img class="detail-media" src="${escapeHtml(m.url)}" alt="Recipe media">`).join('');
  // Shown once, on the recipe the import just produced: what the page left out, against the
  // recipe itself rather than on a screen the chef has already left.
  const notice=importedNotice?.recipeId===r.id
    ?`<div class="notice" role="status"><p><strong>Imported from ${escapeHtml(importedNotice.host||'the web')}.</strong> Check it against the original page before you cook.</p>${importedNotice.notes.length?`<ul class="install-list">${importedNotice.notes.map(n=>`<li>${escapeHtml(n)}</li>`).join('')}</ul>`:''}<button class="ghost" id="dismissImportNotice">OK</button></div>`
    :'';
  main.innerHTML=`<button id="backRecipes" class="ghost">← Recipes</button>${notice}<section class="card"><div class="row between"><h1>${escapeHtml(r.title)}</h1>${r.isPublic?'<span class="pill">Community</span>':'<span class="pill">Private</span>'}</div><p class="status">${escapeHtml(r.description||'')}</p><span class="pill">Serves ${r.servings||2}</span>${(r.tags||[]).map(t=>`<span class="pill">#${escapeHtml(t)}</span>`).join('')}</section>${(r.steps||[]).length?'<button id="cookThisRecipe" class="primary wide">🍳 Cook this recipe</button>':''}${collectionPickerTemplate(r.id)}${remoteMedia?`<section class="card"><h2>Recipe media</h2><div class="detail-media-grid">${remoteMedia}</div></section>`:''}${r.sessionAudio?.stored?'<section class="card"><h2>Original chef voice</h2><p class="hint">The full microphone recording is stored separately from the transcript.</p><button id="loadChefVoice" class="secondary wide">▶ Load chef voice</button><div id="chefVoicePlayer"></div></section>':''}<div id="paywall"></div>${secondPassTemplate(r)}<div class="section-title"><h2>Ingredients</h2></div>${scalingTemplate(r)}${shownIngredients.map(i=>`<div class="card">${escapeHtml([i.quantity,i.unit,i.name].filter(Boolean).join(' '))}</div>`).join('')}<div class="section-title"><h2>Method</h2></div>${(r.steps||[]).length?'<button id="readAloudBtn" class="secondary wide">🔊 Read steps aloud</button>':''}${(r.steps||[]).map((s,i)=>`<div class="step card"><span class="step-num">${i+1}</span><div>${escapeHtml(s)}</div></div>`).join('')}<div class="section-title"><h2>Cooking transcript</h2></div><div class="card transcript">${(r.transcript||[]).map(s=>`<div class="transcript-line">${escapeHtml(s.text)}</div>`).join('')||'No transcript saved.'}</div>`;
  document.querySelector('#backRecipes').onclick=()=>{secondPass={recipeId:'',busy:false,message:'',result:null};shoppingMessage='';importedNotice=null;render();};
  const dismissNotice=document.querySelector('#dismissImportNotice');
  if(dismissNotice)dismissNotice.onclick=()=>{importedNotice=null;openRecipe(r.id);};
  bindRecipeScaling(r,factor);
  bindCollectionPicker(r);
  const cookBtn=document.querySelector('#cookThisRecipe');
  if(cookBtn)cookBtn.onclick=()=>openCookAlong(r,()=>{overlayScreen='';openRecipe(r.id);});
  bindSecondPass(r);
  renderPaywall();
  const load=document.querySelector('#loadChefVoice');if(load)load.onclick=async()=>{load.disabled=true;load.textContent='Loading…';const blob=await loadAudioBlob(r.id);const target=document.querySelector('#chefVoicePlayer');if(blob){const url=URL.createObjectURL(blob);target.innerHTML=`<audio class="audio-player" controls src="${url}"></audio>${isIOS?'<p class="hint">ChefVoice will refresh the voice engine before your next capture after audio playback if iOS requires it.</p>':''}`;}else target.innerHTML='<p class="status">The stored recording could not be found.</p>';load.remove();};
  const readBtn=document.querySelector('#readAloudBtn');
  if(readBtn)readBtn.onclick=()=>{
    if(!('speechSynthesis' in window)){readBtn.textContent='Speech is not supported on this device.';return;}
    if(speechSynthesis.speaking){speechSynthesis.cancel();readBtn.textContent='🔊 Read steps aloud';return;}
    const utterance=new SpeechSynthesisUtterance([r.title,...(r.steps||[])].join('. '));
    utterance.onend=()=>{readBtn.textContent='🔊 Read steps aloud';};
    utterance.onerror=()=>{readBtn.textContent='🔊 Read steps aloud';};
    readBtn.textContent='⏸ Stop reading';
    speechSynthesis.speak(utterance);
  };
}

function bindRecipeScaling(recipe,factor){
  const redraw=()=>openRecipe(recipe.id);
  const down=document.querySelector('#servingsDown');
  if(down)down.onclick=()=>{recipeView.servings=Math.max(1,recipeView.servings-1);redraw();};
  const up=document.querySelector('#servingsUp');
  if(up)up.onclick=()=>{recipeView.servings=Math.min(99,recipeView.servings+1);redraw();};
  main.querySelectorAll('[data-system]').forEach(b=>b.onclick=()=>{recipeView.system=b.dataset.system;redraw();});
  const add=document.querySelector('#addToShopping');
  if(add)add.onclick=()=>{addRecipeToShoppingList(recipe,factor);redraw();};
  const view=document.querySelector('#viewShoppingList');
  if(view)view.onclick=()=>openShoppingList(()=>{overlayScreen='';openRecipe(recipe.id);});
  const dismiss=document.querySelector('#dismissShoppingMessage');
  if(dismiss)dismiss.onclick=()=>{shoppingMessage='';redraw();};
}

function bindCollectionPicker(recipe){
  const picker=document.querySelector('#collectionPicker');
  // The picker reopens itself across the redraw that follows creating a collection, so
  // filing a recipe into a brand-new collection stays one continuous action.
  if(picker)picker.ontoggle=()=>{collectionPickerOpen=picker.open;};
  main.querySelectorAll('[data-file-collection]').forEach(box=>box.onchange=()=>{
    collections=setRecipeInCollection(collections,box.dataset.fileCollection,recipe.id,box.checked);
    saveCollections(collections);
    const summary=picker?.querySelector('summary');
    const filed=collectionsContaining(collections,recipe.id);
    if(summary)summary.textContent=filed.length?`🗂 ${filed.map(c=>c.name).join(', ')}`:'🗂 Add to a collection';
  });
  const add=document.querySelector('#addCollectionHere');
  if(add)add.onclick=()=>{
    const input=document.querySelector('#newCollectionName');
    const result=createCollection(collections,input?.value||'');
    if(!result.id)return;
    // Creating one from here means the chef wants this recipe in it; making them then tick
    // it on would be a second step for something they have already asked for.
    collections=setRecipeInCollection(result.collections,result.id,recipe.id,true);
    saveCollections(collections);
    collectionPickerOpen=true;
    openRecipe(recipe.id);
  };
}

// ---- Shopping list ----------------------------------------------------------
// Built from the structured ingredients the parser already produced, so a chef never retypes
// what they narrated. Local to this browser for the same reasons collections are.

function persistShoppingItems(){saveShoppingItems(shoppingItems);}

function addRecipeToShoppingList(recipe,factor=1){
  const incoming=itemsFor(recipe.id,String(recipe.title||'').trim()||'Untitled recipe',recipe.ingredients||[],factor);
  if(!incoming.length){shoppingMessage='That recipe has no ingredients to add yet.';return;}
  const before=shoppingItems.length;
  shoppingItems=mergeShopping(shoppingItems,incoming);
  persistShoppingItems();
  shoppingMessage=additionMessage(before,incoming.length,shoppingItems.length);
}

let shoppingBack=null;

function shoppingListTemplate(){
  const remaining=shoppingItems.filter(i=>!i.checked).length;
  // Ticked lines stay on the list rather than disappearing, because a chef in a shop wants to
  // see what they have already put in the basket. They are cleared explicitly, in one go.
  const sorted=[...shoppingItems].sort((a,b)=>Number(a.checked)-Number(b.checked));
  // The tick box is a sibling of its label rather than inside one: a checkbox wrapped in a
  // <label> receives the click twice -- once itself, once forwarded by the label -- and lands
  // back where it started.
  const rows=sorted.map(i=>`<div class="card row" style="gap:10px;align-items:flex-start"><input type="checkbox" id="shop-${escapeHtml(i.id)}" data-shopping-check="${escapeHtml(i.id)}" style="width:auto;margin-top:3px" ${i.checked?'checked':''}><label class="grow" for="shop-${escapeHtml(i.id)}"${i.checked?' style="opacity:.55;text-decoration:line-through"':''}>${escapeHtml(displayText(i))}${i.recipeTitle?`<br><span class="hint">${escapeHtml(i.recipeTitle)}</span>`:''}</label><button class="ghost" data-shopping-remove="${escapeHtml(i.id)}" aria-label="Remove ${escapeHtml(i.name)}">✕</button></div>`).join('');
  return `<button id="backShopping" class="ghost">← Back</button>
  <div class="section-title"><h1>Shopping list</h1></div>
  <p class="status">${shoppingItems.length?`${remaining} to buy · ${shoppingItems.length-remaining} in the basket`:'Nothing on the list yet'}</p>
  ${shoppingMessage?`<div class="row between"><span class="hint">${escapeHtml(shoppingMessage)}</span><button class="ghost" id="dismissShoppingMessage">OK</button></div>`:''}
  ${shoppingItems.length?rows:'<div class="empty card"><strong>Nothing on the list yet.</strong><br>Open any recipe and tap “Add to shopping list”. Ingredients arrive already measured, and matching lines are added together for you.</div>'}
  ${shoppingItems.length?`<div class="row wrap" style="margin-top:12px"><button class="secondary grow" id="shareShopping">📤 Share list</button><button class="ghost grow" id="clearChecked">Clear the basket</button><button class="danger grow" id="clearShopping">Empty list</button></div>`:''}`;
}

function renderShoppingList(){
  main.innerHTML=shoppingListTemplate();
  document.querySelector('#backShopping').onclick=()=>{const back=shoppingBack;shoppingBack=null;shoppingMessage='';(back||(()=>{overlayScreen='';render();}))();};
  const dismiss=document.querySelector('#dismissShoppingMessage');
  if(dismiss)dismiss.onclick=()=>{shoppingMessage='';renderShoppingList();};
  main.querySelectorAll('[data-shopping-check]').forEach(box=>box.onchange=()=>{
    const id=box.dataset.shoppingCheck;
    shoppingItems=shoppingItems.map(i=>i.id===id?{...i,checked:box.checked}:i);
    persistShoppingItems();renderShoppingList();
  });
  main.querySelectorAll('[data-shopping-remove]').forEach(b=>b.onclick=()=>{
    shoppingItems=shoppingItems.filter(i=>i.id!==b.dataset.shoppingRemove);
    persistShoppingItems();renderShoppingList();
  });
  const share=document.querySelector('#shareShopping');
  if(share)share.onclick=async()=>{
    const text=asShareText(shoppingItems);
    try{
      if(navigator.share)await navigator.share({title:'ChefVoice shopping list',text});
      else{await navigator.clipboard.writeText(text);share.textContent='📋 Copied to the clipboard';}
    }catch{/* A cancelled share sheet is not an error. */}
  };
  const clearChecked=document.querySelector('#clearChecked');
  if(clearChecked)clearChecked.onclick=()=>{
    if(!shoppingItems.some(i=>i.checked))return;
    shoppingItems=shoppingItems.filter(i=>!i.checked);
    persistShoppingItems();shoppingMessage='Cleared everything already in the basket.';renderShoppingList();
  };
  const clearAll=document.querySelector('#clearShopping');
  if(clearAll)clearAll.onclick=()=>{
    if(!confirm('Empty the whole shopping list? This cannot be undone.'))return;
    shoppingItems=[];persistShoppingItems();shoppingMessage='Shopping list emptied.';renderShoppingList();
  };
}

function openShoppingList(back){
  closeCookAlong();
  overlayScreen='shopping';
  shoppingBack=back||null;
  renderShoppingList();
  window.scrollTo({top:0,behavior:'smooth'});
}

// ---- Recipe import from a web address ---------------------------------------
// The page is read by the `chefvoice-import` Cloud Function, not here: a browser refuses to
// fetch another site's page from a script, which is the only reason a function is involved at
// all (on Android the phone reads the page itself). The function returns a recipe draft or the
// reason there wasn't one; the words it returns are written for the chef and are shown as they
// stand. Nothing about the result is special-cased afterwards -- it is saved as an ordinary
// private recipe, editable, scalable, cookable and shoppable like any other.

let recipeImport={busy:false,message:'',notes:[],host:'',url:''};

function importTemplate(){
  return `<button id="backImport" class="ghost">← Recipes</button>
  <div class="section-title"><h1>Import from a web address</h1></div>
  <section class="card stack">
    <div class="field"><label for="importUrl">Recipe page</label><input id="importUrl" type="url" inputmode="url" placeholder="https://example.com/best-chili" value="${escapeHtml(recipeImport.url)}"></div>
    <button class="primary wide" id="runImport" ${recipeImport.busy?'disabled':''}>${recipeImport.busy?'Reading the page…':'Read the recipe'}</button>
    <p class="hint">ChefVoice reads the recipe the page itself publishes for search engines. It never guesses: anything the page leaves out is left out here too, and named below so you can check it.</p>
  </section>
  ${recipeImport.message?`<div class="notice" role="status">${escapeHtml(recipeImport.message)}</div>`:''}
  ${recipeImport.notes.length?`<section class="card"><strong>Check these before you cook</strong><ul class="install-list">${recipeImport.notes.map(n=>`<li>${escapeHtml(n)}</li>`).join('')}</ul></section>`:''}
  ${cloud.user?'':'<div class="notice">Sign in from Profile to import a recipe.</div>'}`;
}

function renderImport(){
  main.innerHTML=importTemplate();
  document.querySelector('#backImport').onclick=()=>{overlayScreen='';recipeImport={busy:false,message:'',notes:[],host:'',url:''};render();};
  const run=document.querySelector('#runImport');
  if(run)run.onclick=async()=>{
    const input=document.querySelector('#importUrl');
    recipeImport.url=input?.value||'';
    if(!recipeImport.url.trim()){recipeImport.message='Paste the web address of a recipe page first.';renderImport();return;}
    if(!cloud.user){nav('profile');return;}
    recipeImport={...recipeImport,busy:true,message:'Reading that page…',notes:[]};
    renderImport();
    try{
      const result=await cloud.api.importRecipeFromUrl(recipeImport.url);
      if(!result?.ok){
        recipeImport={...recipeImport,busy:false,message:result?.message||'That page could not be read, so nothing was saved.',notes:[]};
        renderImport();
        return;
      }
      const saved=await saveImportedRecipe(result);
      recipeImport={busy:false,message:'',notes:[],host:'',url:''};
      overlayScreen='';
      // Straight into the recipe, with the gaps the page left carried along so the chef sees
      // them against the recipe rather than on a screen they have already left.
      importedNotice={recipeId:saved.id,host:result.host,notes:result.notes||[]};
      currentTab='recipes';
      tabs.forEach(b=>b.classList.toggle('active',b.dataset.tab==='recipes'));
      openRecipe(saved.id);
    }catch(e){
      recipeImport={...recipeImport,busy:false,message:e?.message||'ChefVoice could not reach the import service. Try again in a moment.',notes:[]};
      renderImport();
    }
  };
}

/** Saves an imported draft as an ordinary private recipe on this device. */
async function saveImportedRecipe(result){
  const draft=result.recipe||{};
  const recipe={
    id:(globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(16).slice(2)}`),
    title:String(draft.title||'Imported recipe'),
    description:String(draft.description||''),
    servings:Math.max(1,Number(draft.servings)||2),
    prepTimeMinutes:Number(draft.prepTimeMinutes)||0,
    cookTimeMinutes:Number(draft.cookTimeMinutes)||0,
    ingredients:(draft.ingredients||[]).map(i=>({quantity:String(i.quantity||''),unit:String(i.unit||''),name:String(i.name||'')})),
    steps:(draft.steps||[]).map(s=>String(s||'')),
    transcript:[],
    createdAt:Date.now(),updatedAt:Date.now(),
    // Private, and owned by no cloud account until the chef chooses to publish.
    isPublic:false,media:[],tags:draft.tags||[],
    // What the chef is told before publishing, and the one field that marks an import.
    importedFrom:String(result.sourceUrl||'')
  };
  const updated=[recipe,...recipes];
  saveRecipes(updated);
  recipes=updated;
  return recipe;
}

/** Shown once on the recipe an import just produced. */
let importedNotice=null;

// ---- Cook-along -------------------------------------------------------------
// One method step at a time, for a chef whose hands are in a bowl: the screen is held awake,
// steps can be read out loud, timers are offered only for durations the chef actually stated,
// and the whole screen can be driven by voice. Every decision lives in cook-along.js; this is
// the drawing of that state plus the browser APIs it needs. Nothing here edits the recipe.

let cookAlong=null;

function speakCookText(text){
  if(!('speechSynthesis' in window))return false;
  const clean=String(text||'').trim();
  if(!clean)return true;
  try{speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(clean));return true;}
  catch{return false;}
}

/** Says the current step whenever cook-along.js has asked for it to be said. */
function syncCookSpeech(){
  if(!cookAlong)return;
  if(!cookAlong.state.readAloud){
    cookAlong.lastSpokenToken=cookAlong.state.speakToken;
    try{window.speechSynthesis?.cancel();}catch{}
    return;
  }
  if(cookAlong.state.speakToken===cookAlong.lastSpokenToken)return;
  cookAlong.lastSpokenToken=cookAlong.state.speakToken;
  speakCookText(cookCurrentStep(cookAlong.state));
}

function cookTimerTick(){
  if(!cookAlong)return;
  const running=cookAlong.state.timer;
  if(!running||running.paused||running.finished)return;
  cookAlong.state=tickTimer(cookAlong.state);
  const timer=cookAlong.state.timer;
  if(timer.finished){
    // The chef's hands are busy and they may not be looking at the screen, so a finished
    // timer says so out loud as well as showing it.
    speakCookText(`Timer finished. ${timer.label} is up.`);
    renderCookAlong();
    return;
  }
  // Only the clock changes each second; redrawing the screen would throw away the chef's
  // scroll position sixty times a minute.
  const clock=document.querySelector('#cookClock');
  if(clock)clock.textContent=formatClock(timer.remainingSeconds);
}

async function requestCookWakeLock(){
  if(!navigator.wakeLock||!cookAlong||cookAlong.wakeLock)return;
  try{
    const sentinel=await navigator.wakeLock.request('screen');
    // The browser drops the lock whenever the tab is hidden; forgetting it here is what lets
    // the visibilitychange handler below take a fresh one when the chef comes back.
    sentinel.addEventListener('release',()=>{if(cookAlong?.wakeLock===sentinel)cookAlong.wakeLock=null;});
    if(cookAlong)cookAlong.wakeLock=sentinel;else await sentinel.release();
  }catch{/* Not every browser allows one, and a cook-along works without it. */}
}

function startCookListening(){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){
    cookAlong.state=setHandsFree(cookAlong.state,false);
    cookAlong.handsFreeStatus='Hands-free needs a browser with speech recognition — Chrome on Android, or Safari on iOS.';
    return;
  }
  const recognition=new Recognition();
  recognition.continuous=true;recognition.interimResults=true;recognition.lang='en-US';
  recognition.onresult=event=>{
    for(let i=event.resultIndex;i<event.results.length;i++){
      const result=event.results[i];
      const command=matchCommand(result[0]?.transcript);
      // Only reversible commands may fire on a partial result: a half-heard "stop" is the one
      // mistake a chef cannot undo by simply saying the word again.
      if(!command||(!result.isFinal&&!safeFromPartial[command]))continue;
      handleCookCommand(command);
    }
  };
  recognition.onerror=event=>{
    if(event.error==='no-speech')return;// Ordinary silence in a kitchen.
    if(event.error==='not-allowed'||event.error==='service-not-allowed'){
      cookAlong.state=setHandsFree(cookAlong.state,false);
      cookAlong.handsFreeStatus='Hands-free needs microphone permission.';
      stopCookListening();
      renderCookAlong();
      return;
    }
    cookAlong.handsFreeStatus=`Hands-free stopped: ${event.error}.`;
  };
  // Browsers end continuous recognition on their own after a pause. Restarting is gated on
  // hands-free still being on, so a refused microphone cannot spin here forever.
  recognition.onend=()=>{
    if(cookAlong?.recognition===recognition&&cookAlong.state.handsFree){try{recognition.start();}catch{}}
  };
  cookAlong.recognition=recognition;
  try{recognition.start();}
  catch{
    cookAlong.recognition=null;
    cookAlong.state=setHandsFree(cookAlong.state,false);
    cookAlong.handsFreeStatus='Hands-free could not start listening.';
  }
}

function stopCookListening(){
  const recognition=cookAlong?.recognition;
  if(!recognition)return;
  cookAlong.recognition=null;
  try{recognition.onend=null;recognition.stop();}catch{}
}

function handleCookCommand(command){
  if(!cookAlong)return;
  const before=cookAlong.state;
  cookAlong.state=applyCookCommand(before,command);
  if(cookAlong.state===before){syncCookSpeech();return;}
  if(!cookAlong.state.handsFree)stopCookListening();
  renderCookAlong();
}

function cookAlongTemplate(){
  const {recipe,state,handsFreeStatus}=cookAlong;
  const total=state.steps.length;
  const head=`<button id="backCook" class="ghost">← ${escapeHtml(recipe.title||'Recipe')}</button>`;
  if(!total)return `${head}<div class="empty card"><strong>No cooking steps were added to this recipe.</strong></div>`;
  const timer=state.timer;
  const stepTimers=timersForStep(state);
  const timerCard=timer
    ?`<section class="card cook-timer${timer.finished?' finished':''}"><strong>${timer.finished?'⏰':'⏱'} ${escapeHtml(timer.label)}${timer.finished?' is up':''}</strong><div class="cook-clock" id="cookClock">${formatClock(timer.remainingSeconds)}</div><div class="row">${timer.finished?'':`<button class="ghost grow" id="pauseTimer">${timer.paused?'Resume':'Pause'}</button>`}<button class="ghost grow" id="cancelTimer">${timer.finished?'Clear':'Cancel'}</button></div></section>`
    :(stepTimers.length?`<section class="card"><p class="hint">Timers from this step</p><div class="row wrap">${stepTimers.slice(0,3).map((t,i)=>`<button class="ghost" data-start-timer="${i}">⏱ ${escapeHtml(t.label)}</button>`).join('')}</div></section>`:'');
  const handsFreeHelp=handsFreeStatus
    ?`<p class="hint">${escapeHtml(handsFreeStatus)}</p>`
    :(state.handsFree?'<p class="hint">Say “next”, “back”, “read out loud”, “repeat”, “start timer” or “stop listening”. Nothing you say here is recorded or saved.</p>':'');
  return `${head}
  <p class="hint" style="margin-top:12px">STEP ${state.stepIndex+1} OF ${total} · ${escapeHtml(recipe.title||'')}</p>
  <section class="card cook-step-card">${escapeHtml(cookCurrentStep(state))}</section>
  ${timerCard}
  <div class="row"><button class="ghost grow" id="cookPrevious" ${state.stepIndex>0?'':'disabled'}>Previous</button><button class="primary grow" id="cookNextStep" ${state.stepIndex<total-1?'':'disabled'}>Next</button></div>
  <button class="ghost wide" id="cookRepeat" style="margin-top:10px">🔁 Say this step again</button>
  <button class="ghost wide" id="cookReadAloud" style="margin-top:10px">${state.readAloud?'🔊 Reading aloud — tap to stop':'🔊 Read steps aloud'}</button>
  <button class="ghost wide" id="cookHandsFree" style="margin-top:10px">${state.handsFree?'🎙 Hands-free on — tap to stop':'🎙 Hands-free'}</button>
  ${handsFreeHelp}`;
}

function renderCookAlong(){
  if(!cookAlong)return;
  main.innerHTML=cookAlongTemplate();
  const state=()=>cookAlong.state;
  document.querySelector('#backCook').onclick=()=>{const back=cookAlong.back;closeCookAlong();(back||(()=>{overlayScreen='';render();}))();};
  const previous=document.querySelector('#cookPrevious');
  if(previous)previous.onclick=()=>{cookAlong.state=cookPreviousStep(state());renderCookAlong();};
  const next=document.querySelector('#cookNextStep');
  if(next)next.onclick=()=>{cookAlong.state=cookNextStep(state());renderCookAlong();};
  const repeat=document.querySelector('#cookRepeat');
  if(repeat)repeat.onclick=()=>{speakCookText(cookCurrentStep(state()));};
  const read=document.querySelector('#cookReadAloud');
  if(read)read.onclick=()=>{cookAlong.state=setReadAloud(state(),!state().readAloud);renderCookAlong();};
  const handsFree=document.querySelector('#cookHandsFree');
  if(handsFree)handsFree.onclick=()=>{
    const wanted=!state().handsFree;
    cookAlong.handsFreeStatus='';
    cookAlong.state=setHandsFree(state(),wanted);
    if(wanted)startCookListening();else stopCookListening();
    renderCookAlong();
  };
  main.querySelectorAll('[data-start-timer]').forEach(b=>b.onclick=()=>{
    const timer=timersForStep(state())[Number(b.dataset.startTimer)];
    if(timer){cookAlong.state=startCookTimer(state(),timer);renderCookAlong();}
  });
  const pause=document.querySelector('#pauseTimer');
  if(pause)pause.onclick=()=>{cookAlong.state=toggleTimerPause(state());renderCookAlong();};
  const cancel=document.querySelector('#cancelTimer');
  if(cancel)cancel.onclick=()=>{cookAlong.state=clearTimer(state());renderCookAlong();};
  syncCookSpeech();
}

function openCookAlong(recipe,back){
  closeCookAlong();
  overlayScreen='cook';
  cookAlong={
    recipe,back:back||null,state:initialCookState(recipe.steps||[]),
    lastSpokenToken:0,handsFreeStatus:'',recognition:null,wakeLock:null,timerHandle:null
  };
  cookAlong.lastSpokenToken=cookAlong.state.speakToken;
  cookAlong.timerHandle=setInterval(cookTimerTick,1000);
  requestCookWakeLock();
  renderCookAlong();
  window.scrollTo({top:0,behavior:'smooth'});
}

/** Ends a cook-along: the microphone, the wake lock and any speech all stop with the screen. */
function closeCookAlong(){
  if(!cookAlong)return;
  const session=cookAlong;
  stopCookListening();
  cookAlong=null;
  clearInterval(session.timerHandle);
  try{window.speechSynthesis?.cancel();}catch{}
  try{session.wakeLock?.release();}catch{}
}

// A screen wake lock is dropped whenever the tab is hidden, so it has to be taken again when
// the chef comes back to a cook-along that is still open.
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&cookAlong&&!cookAlong.wakeLock)requestCookWakeLock();});

// Chef discovery state. Search needs sign-in because listing the users collection
// does; a signed-out chef still gets the public feed.
let communitySearchOpen=false;
let chefSearchTerm='';
// Mirrors Android's Following/Discover split (CommunityScreen in ChefVoiceApp.kt).
let communityMode='discover';
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

// The feed uses the same full-photo card and over-photo controls as Android.
function communityPostTemplate(r){
  const id=escapeHtml(r.id),authorId=escapeHtml(r.authorId||'');
  const authorName=r.authorName?.trim()||'Chef';
  const liked=cloud.liked.has(r.id),bookmarked=cloud.bookmarks.has(r.id),following=cloud.following.has(r.authorId);
  const hero=r.media?.find(m=>m.type!=='VIDEO')?.url;
  const canModerate=cloud.user&&r.authorId&&cloud.user.uid!==r.authorId;
  const menu=canModerate?`<div class="community-post-controls">
    <button class="follow-btn${following?' following':''}" data-follow="${authorId}" aria-pressed="${following}">${following?'Following':'Follow'}</button>
    <button class="kebab" data-menu-toggle="${id}" aria-label="More options">⋯</button>
    <div class="card-menu" id="menu-${id}" hidden>
      <button class="menu-item" data-message="${authorId}" data-message-name="${escapeHtml(authorName)}">✉ Message chef</button>
      <button class="menu-item danger" data-report="${id}" data-report-uid="${authorId}">⚑ Report</button>
      <button class="menu-item danger" data-block="${authorId}">🚫 Block chef</button>
    </div>
  </div>`:'';
  // The card rides on top of a fixed backdrop that only shows while it is being dragged --
  // the web equivalent of Android's Box with the label behind the Card.
  return `<div class="swipe-row" data-swipe-save="${id}"><div class="swipe-backdrop" aria-hidden="true">${bookmarked?'★ Already saved':'★ Save to cookbook'}</div><article class="community-card swipe-card">
    <div class="community-photo thumb-wrap" data-dbl-like="${id}">
      ${hero?`<img class="community-thumb" src="${escapeHtml(hero)}" alt="${escapeHtml(r.title)}" loading="lazy">`:'<div class="community-photo-placeholder" role="img" aria-label="Recipe without a photo">🍽️</div>'}
    </div>
    <div class="community-post-top">
      <button class="community-chef" ${authorId?`data-open-chef="${authorId}"`: 'disabled'} aria-label="View ${escapeHtml(authorName)} profile">
        <span class="avatar-circle" aria-hidden="true">${escapeHtml(authorName.charAt(0).toUpperCase())}</span>
        <strong>${escapeHtml(authorName)}</strong>
      </button>
      ${menu}
    </div>
    <button class="community-caption" data-open-community-recipe="${id}" aria-label="Open ${escapeHtml(r.title)}">
      <strong class="community-post-title">${escapeHtml(r.title)}</strong>
      <span class="community-post-meta">${r.ingredients.length} ingredients · 💬 ${formatCount(r.commentCount||0)} · ${relativeTime(r.createdAt)}</span>
      ${r.tags?.length?`<span class="community-post-tags">${r.tags.slice(0,3).map(t=>`#${escapeHtml(t)}`).join(' ')}</span>`:''}
    </button>
    <div class="community-actions" aria-label="Post actions">
      <button class="action-btn${liked?' active':''}" data-like="${id}" aria-label="${liked?'Unlike':'Like'} · ${formatCount(r.likes||0)} likes" aria-pressed="${liked}"><span aria-hidden="true">${liked?'♥':'♡'} ${formatCount(r.likes||0)}</span></button>
      <button class="action-btn" data-comments="${id}" aria-label="Comments · ${formatCount(r.commentCount||0)} comments">💬</button>
      <button class="action-btn" data-share="${id}" aria-label="Share">📤</button>
      <button class="action-btn${bookmarked?' saved':''}" data-bookmark="${id}" aria-label="${bookmarked?'Unsave':'Save'}" aria-pressed="${bookmarked}">${bookmarked?'★':'☆'}</button>
    </div>
  </article></div>`;
}

function communityTemplate(){
  if(openChefProfile)return chefProfileTemplate();
  // Blocking has to actually hide the blocked chef's cooking, or the button is a
  // broken promise. Firestore rules already stop writes in both directions between
  // a blocked pair; this is the read half.
  const unblocked=withoutBlocked(cloud.recipes,cloud.blocked);
  const visible=communityMode==='following'?(cloud.user?unblocked.filter(r=>cloud.following.has(r.authorId)):[]):unblocked;
  const hiddenCount=cloud.recipes.length-unblocked.length;
  const dishTerm=chefSearchTerm.trim().toLowerCase();
  const searched=dishTerm?visible.filter(r=>{
    if((r.tags||[]).some(t=>tagMatchesQuery(t,dishTerm)))return true;
    const haystack=[r.title,r.description,r.authorName,...(r.ingredients||[]).map(i=>i.name)].join(' ').toLowerCase();
    return haystack.includes(dishTerm);
  }):visible;
  const emptyMessage=communityMode==='following'
    ?(!cloud.user?'Sign in to see finished dishes from chefs you follow.':'Follow chefs from Discover to build your Following feed.')
    :cloud.feedError?`Community could not load: ${escapeHtml(cloud.feedError)}`
    :cloud.state==='connecting'?'Connecting to the real ChefVoice Community…'
    :dishTerm?'No dishes matched that search.'
    :'No public Community recipes were returned.';
  const feed=searched.length?searched.map(communityPostTemplate).join(''):`<div class="empty card">${emptyMessage}</div>`;
  const blockedNote=hiddenCount?`<div class="notice">${hiddenCount} recipe${hiddenCount===1?'':'s'} from chefs you blocked ${hiddenCount===1?'is':'are'} hidden. Manage blocked chefs from your Profile.</div>`:'';
  const searchResults=chefSearchResults.length
    ?`<div class="section-title"><h2>Chefs</h2><span class="count">${chefSearchResults.length} found</span></div>${chefSearchResults.map(p=>`<article class="card"><div class="row between"><div><strong>${escapeHtml(p.displayName)}</strong><p class="status">${escapeHtml(p.bio||'ChefVoice member')}</p></div><span class="pill">${p.followerCount} follower${p.followerCount===1?'':'s'}</span></div><button class="secondary" data-open-chef="${escapeHtml(p.uid)}">View chef</button></article>`).join('')}`
    :'';
  const search=cloud.user&&communitySearchOpen
    ?`<section id="communitySearchPanel" class="card"><div class="row"><input id="chefSearch" class="grow" aria-label="Search chefs, dishes or tags" placeholder="Search chefs, dishes or #tags" value="${escapeHtml(chefSearchTerm)}"><button id="chefSearchBtn" class="secondary">Search</button></div>${chefSearchStatus?`<p class="hint">${escapeHtml(chefSearchStatus)}</p>`:''}</section>${searchResults}`
    :'';
  const modeToggle=`<div class="community-modes" aria-label="Community feed">
    <button class="${communityMode==='following'?'primary':'secondary'}" data-community-mode="following" aria-pressed="${communityMode==='following'}">Following</button>
    <button class="${communityMode==='discover'?'primary':'secondary'}" data-community-mode="discover" aria-pressed="${communityMode==='discover'}">Discover</button>
  </div>`;
  return `<section class="hero community-hero" style="--hero:url('../assets/community-hero.webp')">
    <div class="community-banner-title"><div class="eyebrow">ChefVoice Community</div><h1>Community</h1></div>
    <div class="community-banner-actions">
      <button id="communitySearchToggle" class="community-banner-action" aria-label="${communitySearchOpen?'Close search':'Search'}" aria-expanded="${communitySearchOpen}">${communitySearchOpen?'✕':'🔍'}</button>
      <button id="communityMessages" class="community-banner-action" aria-label="Messages"><span aria-hidden="true">✉</span><small id="communityMessagesBadge" class="community-badge" hidden aria-hidden="true"></small></button>
      <button id="communityNotifications" class="community-banner-action" aria-label="Notifications"><span aria-hidden="true">🔔</span><small id="communityNotificationsBadge" class="community-badge" hidden aria-hidden="true"></small></button>
    </div>
  </section><div id="safetyStatus" class="hint" role="status"></div>${cloud.feedError?`<div class="notice">${escapeHtml(cloud.feedError)}</div>`:''}${modeToggle}${search}${blockedNote}<div class="community-feed">${feed}</div>`;
}
function requireCommunitySignIn(){if(cloud.user)return true;nav('profile');return false;}

/**
 * Pointer-driven horizontal swipe on one row. `onMove` draws the travel and `onEnd` decides
 * what it meant; both are handed the gesture state from swipe-gestures.js, which is where
 * every decision about direction, distance and the axis lock lives.
 *
 * The row keeps `touch-action: pan-y` in CSS, so a finger moving down the feed still scrolls
 * it and only a sideways one reaches this code at all.
 */
function bindSwipe(row,{onMove,onEnd}){
  let gesture=null,pointerId=null;
  row.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    pointerId=e.pointerId;gesture=beginSwipe(e.clientX,e.clientY);
  });
  row.addEventListener('pointermove',e=>{
    if(!gesture||e.pointerId!==pointerId)return;
    gesture=trackSwipe(gesture,e.clientX,e.clientY);
    if(!isHorizontal(gesture))return;
    // Once the gesture is ours, stop the browser making it a text selection or a back swipe.
    e.preventDefault();
    onMove(gesture);
  });
  const finish=e=>{
    if(!gesture||e.pointerId!==pointerId)return;
    const settled=gesture;gesture=null;pointerId=null;
    // A sideways drag that ends over a button would otherwise also fire that button's click
    // and, say, open the recipe the chef was only trying to save.
    if(isHorizontal(settled)&&Math.abs(settled.dx)>4){
      const swallow=ev=>{ev.stopPropagation();ev.preventDefault();};
      row.addEventListener('click',swallow,{capture:true,once:true});
      // A swipe on a touchscreen usually produces no click at all; drop the guard shortly
      // after so it can never eat the chef's next real tap.
      setTimeout(()=>row.removeEventListener('click',swallow,{capture:true}),350);
    }
    onEnd(settled);
  };
  row.addEventListener('pointerup',finish);
  row.addEventListener('pointercancel',finish);
  row.addEventListener('pointerleave',finish);
}

/** Swipe a Community card to the right to keep the dish. It only ever adds -- see shouldSave. */
function bindSaveSwipes(){
  main.querySelectorAll('[data-swipe-save]').forEach(row=>{
    const id=row.dataset.swipeSave;
    const card=row.querySelector('.swipe-card');
    if(!card)return;
    const settle=()=>{card.style.transition='';card.style.transform='';row.style.setProperty('--swipe-progress','0');};
    bindSwipe(row,{
      onMove:state=>{
        card.style.transition='none';
        card.style.transform=`translateX(${saveOffset(state)}px)`;
        row.style.setProperty('--swipe-progress',String(saveProgress(state)));
      },
      onEnd:async state=>{
        const save=shouldSave(state,cloud.bookmarks.has(id));
        settle();
        if(!save||!requireCommunitySignIn())return;
        // toggleBookmark is a toggle, but shouldSave has already refused the gesture for a
        // recipe that is saved, so this can only add -- the same guard Android applies.
        try{await cloud.api.toggleBookmark(id);}
        catch(e){safetyStatus(e?.message||'Could not save that recipe.');}
      }
    });
  });
}

function bindCommunity(){
  bindSaveSwipes();
  main.querySelectorAll('[data-community-mode]').forEach(b=>b.onclick=()=>{
    if(communityMode===b.dataset.communityMode)return;
    communityMode=b.dataset.communityMode;render();
  });
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

  const searchToggleBtn=document.querySelector('#communitySearchToggle');
  if(searchToggleBtn)searchToggleBtn.onclick=()=>{
    if(!requireCommunitySignIn())return;
    if(communitySearchOpen){chefSearchTerm='';chefSearchResults=[];chefSearchStatus='';}
    communitySearchOpen=!communitySearchOpen;
    render();
    if(communitySearchOpen)document.querySelector('#chefSearch')?.focus();
  };
  for(const [id,section] of [['communityMessages','messages'],['communityNotifications','activity']]){
    const button=document.getElementById(id);
    if(button)button.onclick=()=>{
      if(!requireCommunitySignIn())return;
      inboxSection=section;
      nav('inbox');
    };
  }
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
  main.innerHTML=`<button id="backCommunity" class="ghost">← Community</button><section class="card"><h1>${escapeHtml(r.title)}</h1><p class="status">by ${escapeHtml(r.authorName)} · serves ${r.servings} · ${relativeTime(r.createdAt)}</p><p>${escapeHtml(r.description||'')}</p><div class="action-row"><button class="action-btn${liked?' active':''}" id="detailLike" aria-label="Like">${liked?'♥':'♡'} ${formatCount(r.likes||0)}</button><button class="action-btn" id="detailShare" aria-label="Share">📤</button><button class="action-btn action-spacer${bookmarked?' saved':''}" id="detailSave" aria-label="${bookmarked?'Saved':'Save'}">${bookmarked?'★':'☆'}</button></div></section>${(r.steps||[]).length?'<button id="cookCommunityRecipe" class="primary wide">🍳 Cook this recipe</button>':''}${mediaHtml?`<section class="card"><div class="detail-media-grid">${mediaHtml}</div></section>`:''}<div class="section-title"><h2>Ingredients</h2></div>${r.ingredients.map(i=>`<div class="card">${escapeHtml([i.quantity,i.unit,i.name].filter(Boolean).join(' '))}</div>`).join('')}<div class="section-title"><h2>Method</h2></div>${r.steps.map((s,i)=>`<div class="step card"><span class="step-num">${i+1}</span><div>${escapeHtml(s)}</div></div>`).join('')}${voiceHtml?`<section class="card"><h2>Chef voice</h2><p class="hint">Original cooking-session audio published by the chef.</p>${voiceHtml}</section>`:''}<div class="section-title"><h2>Comments</h2></div><div id="safetyStatus" class="hint"></div><div id="comments"><div class="empty card">Loading comments…</div></div>${cloud.user?`<section class="card"><div id="replyBanner" class="hint"></div><textarea id="commentText" maxlength="800" placeholder="Add a comment"></textarea><button id="postComment" class="primary wide">Post comment</button><div id="commentStatus" class="hint"></div></section>`:'<div class="notice">Sign in to comment.</div>'}`;
  document.querySelector('#backCommunity').onclick=()=>{try{cloud.unsubComments?.();}catch{}cloud.unsubComments=null;openCommunityRecipeId=null;render();};
  // Cooking from a Community recipe reads it; it never copies it into the chef's own library,
  // which is still the publish/save decision it always was.
  const cookCommunity=document.querySelector('#cookCommunityRecipe');
  if(cookCommunity)cookCommunity.onclick=()=>openCookAlong(r,()=>{overlayScreen='';openCommunityRecipe(r.id);});

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
  const firebaseCard=cloud.user?`<section class="card"><div class="quality">Connected to ChefVoice Firebase</div><h2>${escapeHtml(cloud.user.email||'ChefVoice member')}</h2>${profileNotice}${cloud.user.emailVerified?'':'<div class="notice">Email not verified — required for ChefVoice Review and posting media to Community. Local Cook &amp; Capture works either way.</div>'}<button id="verifyEmail" class="secondary wide" ${cloud.user.emailVerified?'disabled':''}>${cloud.user.emailVerified?'✓ Email verified':'Verify email'}</button><div id="verifyEmailStatus" class="hint">${escapeHtml(cloud.verifyEmailMessage||'')}</div><div class="field" style="margin-top:12px"><label>Chef display name</label><input id="profileName" value="${escapeHtml(cloud.profile?.displayName||chefName())}"></div><div class="field"><label>Bio</label><textarea id="profileBio" placeholder="Tell the Community about your cooking">${escapeHtml(cloud.profile?.bio||'')}</textarea></div><button id="saveProfile" class="primary wide">Save profile</button><div id="profileStatus" class="hint"></div><button id="cloudSignOut" class="secondary wide" style="margin-top:10px">Sign out</button></section>`:`<section class="card"><h2>Sign in</h2><p class="status">Use the same Email/Password ChefVoice account you use on Android.</p><div class="stack"><div class="field"><label>Email</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="chef@example.com"></div><div class="field"><label>Password</label><input id="cloudPassword" type="password" autocomplete="current-password" placeholder="Password"></div><button id="cloudSignIn" class="primary wide">Sign in</button><div id="cloudAuthStatus" class="hint">${escapeHtml(cloud.message)}</div></div></section><section class="card"><h2>Create account</h2><div class="stack"><div class="field"><label>Chef name</label><input id="newChefName" placeholder="Chef Jamie"></div><div class="field"><label>Email</label><input id="newEmail" type="email" autocomplete="email"></div><div class="field"><label>Password</label><input id="newPassword" type="password" autocomplete="new-password" minlength="6"></div><button id="cloudSignUp" class="secondary wide">Create ChefVoice account</button><div id="cloudSignUpStatus" class="hint"></div></div></section>`;
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
  const verifyEmail=document.querySelector('#verifyEmail');
  if(verifyEmail)verifyEmail.onclick=async()=>{
    verifyEmail.disabled=true;
    cloud.verifyEmailMessage='Sending verification email…';
    const status=document.querySelector('#verifyEmailStatus');if(status)status.textContent=cloud.verifyEmailMessage;
    try{
      await cloud.api.sendVerificationEmail();
      cloud.verifyEmailMessage='Verification email sent — check your inbox (and spam folder), then reopen Profile to refresh.';
    }catch(e){
      cloud.verifyEmailMessage=e?.message||'Could not send verification email.';
      verifyEmail.disabled=false;
    }
    if(status)status.textContent=cloud.verifyEmailMessage;
  };
}

// Mirrors Android's ON_RESUME refreshEmailVerification(): Auth's cached user
// only picks up a server-side verified flip via reload(), and there is no
// event that fires just because the chef clicked the emailed link in another
// tab. Re-checking whenever ChefVoice regains focus on Profile is the closest
// the PWA has to that lifecycle hook.
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden||currentTab!=='profile'||!cloud.user||cloud.user.emailVerified||!cloud.api)return;
  const verified=await cloud.api.refreshEmailVerification().catch(()=>false);
  if(verified)render();
});

// ---- Inbox: direct messages + activity notifications ------------------------

// Read markers are monotonic by rule, so a stale listener cannot walk one
// backwards and resurrect an old badge.
const conversationUnread=c=>isConversationUnread(c,cloud.user?.uid,cloud.messageReads);
const unreadCounts=()=>computeUnreadCounts(cloud.conversations,cloud.notifications,cloud.user?.uid,cloud.messageReads);
function updateInboxBadge(){
  const {messages,activity}=unreadCounts();
  for(const [id,count,label] of [
    ['inboxBadge',messages+activity,'Inbox'],
    ['communityMessagesBadge',messages,'Messages'],
    ['communityNotificationsBadge',activity,'Notifications']
  ]){
    const badge=document.getElementById(id);
    if(!badge)continue;
    badge.hidden=count===0;
    badge.textContent=count>99?'99+':String(count);
    badge.parentElement.setAttribute('aria-label',count?`${label}, ${count} unread`:label);
  }
}

const otherUid=c=>otherParticipant(c,cloud.user?.uid);
const otherName=c=>otherParticipantName(c,cloud.user?.uid);

/** Same glyphs Android's Notifications tab uses, so one alert reads the same on both. */
const notificationGlyph=type=>({
  message:'✉',comment:'💬',like:'♥',live:'🔴',follow:'👨‍🍳',reply:'↩'
}[String(type||'')]||'🔔');

function inboxTemplate(){
  if(!cloud.user){
    return `<section class="hero" style="--hero:url('../assets/community-hero.webp')"><div class="eyebrow">Inbox</div><h1>Messages and activity.</h1></section><div class="notice">Sign in from Profile to see your messages and activity.</div>`;
  }
  if(openConversation)return conversationTemplate();

  const {messages,activity}=unreadCounts();
  const tabs=`<div class="row" style="margin:10px 2px;gap:8px"><button class="${inboxSection==='messages'?'primary':'secondary'}" data-inbox="messages">Messages${messages?` (${messages})`:''}</button><button class="${inboxSection==='activity'?'primary':'secondary'}" data-inbox="activity">Activity${activity?` (${activity})`:''}</button></div>`;

  if(inboxSection==='activity'){
    const list=cloud.notifications.length
      ?cloud.notifications.map(n=>`<div class="swipe-row" data-swipe-dismiss="${escapeHtml(n.id)}"><div class="swipe-backdrop both" aria-hidden="true">Clear</div><article class="card swipe-card ${n.readAt<=0?'unread':''}" data-notification="${escapeHtml(n.id)}"><div class="row" style="align-items:flex-start;gap:10px"><span class="notification-glyph" aria-hidden="true">${notificationGlyph(n.type)}</span><div class="grow"><div class="row between"><strong>${escapeHtml(n.title)}</strong>${n.readAt<=0?'<span class="pill">New</span>':''}</div>${n.body?`<p class="status">${escapeHtml(n.body)}</p>`:''}${n.createdAt?`<p class="hint">${escapeHtml(relativeTime(n.createdAt))}</p>`:''}${n.readAt<=0?`<div class="row wrap" style="margin-top:8px"><button class="secondary" data-read="${escapeHtml(n.id)}">Mark read</button></div>`:''}</div><button class="icon-btn" data-dismiss-notification="${escapeHtml(n.id)}" aria-label="Clear this notification">✕</button></div></article></div>`).join('')
      :'<div class="empty card">No activity yet. Likes, comments, replies, follows and Live alerts show up here.</div>';
    // Clearing everything already read, in one go, without touching anything still unread.
    const clearRead=cloud.notifications.some(n=>n.readAt>0)
      ?'<button class="ghost wide" id="clearReadNotifications" style="margin-top:12px">Clear read notifications</button>'
      :'';
    const swipeHint=cloud.notifications.length?'<p class="hint">Swipe a notification either way to clear it, or use ✕.</p>':'';
    return `<section class="hero" style="--hero:url('../assets/community-hero.webp')"><div class="eyebrow">Inbox</div><h1>Messages and activity.</h1></section>${tabs}<div id="safetyStatus" class="hint"></div>${swipeHint}${list}${clearRead}`;
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

/**
 * Clears one notification, read or not. Backs both the ✕ and the swipe, so a chef can deal
 * with a single alert without clearing everything they have read.
 *
 * The row is faded and taken out of the way straight away rather than after a Firestore round
 * trip; the listener removes it for real a moment later. A failed delete brings it back,
 * because a row that vanished and did not actually clear is the worse outcome.
 */
async function dismissNotification(id,control){
  const row=main.querySelector(`[data-swipe-dismiss="${CSS.escape(id)}"]`);
  if(control)control.disabled=true;
  if(row)row.classList.add('clearing');
  try{
    await cloud.api.deleteNotification(id);
  }catch(e){
    if(row)row.classList.remove('clearing');
    if(control)control.disabled=false;
    safetyStatus(e?.message||'That notification could not be cleared.');
  }
}

/** Swipe a notification row either way to clear it -- both directions mean the same thing. */
function bindDismissSwipes(){
  main.querySelectorAll('[data-swipe-dismiss]').forEach(row=>{
    const id=row.dataset.swipeDismiss;
    const card=row.querySelector('.swipe-card');
    if(!card)return;
    bindSwipe(row,{
      onMove:state=>{
        card.style.transition='none';
        card.style.transform=`translateX(${dismissOffset(state)}px)`;
        row.style.setProperty('--swipe-progress',String(Math.min(Math.abs(dismissOffset(state))/96,1)));
      },
      onEnd:state=>{
        const direction=dismissDirection(state);
        card.style.transition='';card.style.transform='';
        row.style.setProperty('--swipe-progress','0');
        if(direction)dismissNotification(id,null);
      }
    });
  });
}

function bindInbox(){
  main.querySelectorAll('[data-inbox]').forEach(b=>b.onclick=()=>{inboxSection=b.dataset.inbox;render();});
  main.querySelectorAll('[data-open-conversation]').forEach(b=>b.onclick=()=>openConversationView(b.dataset.openConversation));
  main.querySelectorAll('[data-read]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{await cloud.api.markNotificationRead(b.dataset.read);}catch(e){safetyStatus(e?.message||'Could not mark that as read.');b.disabled=false;}
  });
  main.querySelectorAll('[data-dismiss-notification]').forEach(b=>b.onclick=()=>dismissNotification(b.dataset.dismissNotification,b));
  bindDismissSwipes();
  const clearRead=document.querySelector('#clearReadNotifications');
  if(clearRead)clearRead.onclick=async()=>{
    const ids=cloud.notifications.filter(n=>n.readAt>0).map(n=>n.id);
    if(!ids.length)return;
    clearRead.disabled=true;
    // One at a time rather than a batch: the PWA client exposes a single-document delete,
    // and a partial failure then leaves the rows it could not clear visibly still there.
    const failures=[];
    for(const id of ids){try{await cloud.api.deleteNotification(id);}catch(e){failures.push(e?.message||'unknown error');}}
    if(failures.length)safetyStatus(`Could not clear read notifications: ${failures[0]}`);
    clearRead.disabled=false;
  };

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

// ---- Live: hosting and watching --------------------------------------------
// Both roles use the existing Android-compatible session/peer/ICE contract.
let liveSessions=[];
let liveSessionsError='';
let liveSearchTerm='';
let openLiveSession=null;
let liveViewerStatus='';
let liveViewerController=null;
let liveViewerShutdown=Promise.resolve();
let liveComments=[];
let liveReactionBusy=false;
let liveHostController=null;
let liveHostSession=null;
let liveHostingNotice='';
const liveHostDraft={title:'Live cooking',tags:'',camera:'environment'};

function liveCardTemplate(session){
  const initial=(session.hostName||'C').trim().charAt(0).toUpperCase();
  const tags=session.tags.length?`<p class="hint">${session.tags.slice(0,3).map(t=>`#${escapeHtml(t)}`).join(' ')}</p>`:'';
  return `<article class="card"><div class="social-head"><span class="avatar-circle">${escapeHtml(initial)}</span><div class="chef-id"><strong>${escapeHtml(session.hostName)}</strong><span class="meta">🔴 LIVE</span></div></div><h3>${escapeHtml(session.title)}</h3>${tags}<p class="status">♥ ${formatCount(session.heartCount)} · 🔥 ${formatCount(session.fireCount)} · 👏 ${formatCount(session.clapCount)}</p><button class="primary wide" data-watch-live="${escapeHtml(session.id)}">Watch Live</button></article>`;
}

function liveTemplate(){
  const term=liveSearchTerm.trim().toLowerCase();
  const filtered=term?liveSessions.filter(s=>s.tags.some(t=>tagMatchesQuery(t,term))||`${s.title} ${s.hostName}`.toLowerCase().includes(term)):liveSessions;
  const searchBox=liveSessions.length?`<div class="card"><div class="row"><input id="liveSearch" class="grow" placeholder="Search chefs, dishes or #tags" value="${escapeHtml(liveSearchTerm)}"><button id="liveSearchBtn" class="secondary">Search</button></div></div>`:'';
  const list=filtered.length
    ?filtered.map(liveCardTemplate).join('')
    :liveSessionsError?`<div class="notice">${escapeHtml(liveSessionsError)}</div>`
    :liveSessions.length?'<div class="empty card">No matching Lives. Try a different chef name or tag.</div>'
    :'<div class="empty card">Nobody is live yet. Start a Live and invite other chefs into your kitchen.</div>';
  const signInNote=cloud.user?'':'<div class="notice">Browse active Lives now. Sign in from Profile to watch, chat and react.</div>';
  return `<section class="hero" style="--hero:url('../assets/live-hero.webp')"><div class="eyebrow">Live kitchen</div><h1>Cook together, live.</h1><p>Share your kitchen or watch another chef cook.</p></section><button id="goLive" class="primary wide">🔴 Go Live</button>${liveHostingNotice?`<p class="notice" role="status">${escapeHtml(liveHostingNotice)}</p>`:''}${signInNote}${searchBox}${list}`;
}

function bindLive(){
  document.querySelector('#goLive')?.addEventListener('click',openLiveHostSetup);
  const runSearch=()=>{liveSearchTerm=document.querySelector('#liveSearch').value;render();};
  document.querySelector('#liveSearchBtn')?.addEventListener('click',runSearch);
  document.querySelector('#liveSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runSearch();}});
  main.querySelectorAll('[data-watch-live]').forEach(b=>b.onclick=()=>{
    if(!requireCommunitySignIn())return;
    const session=liveSessions.find(s=>s.id===b.dataset.watchLive);
    if(session)openLiveRoom(session);
  });
}

function liveHostTemplate(){
  return `<button id="backLive" class="ghost">← Back to Live</button>
    <h2>Your live kitchen</h2>
    <p class="hint">Preview your camera first. Keep this page open while broadcasting; leaving or locking your phone ends the Live.</p>
    <fieldset id="liveHostSettings" class="live-host-settings stack">
      <label class="field">Live title<input id="liveHostTitle" maxlength="120" value="${escapeHtml(liveHostDraft.title)}" placeholder="What are you cooking?"></label>
      <label class="field">Tags<input id="liveHostTags" maxlength="240" value="${escapeHtml(liveHostDraft.tags)}" placeholder="#pasta #weeknight"></label>
      <label class="field">Camera<select id="liveHostCamera"><option value="environment"${liveHostDraft.camera==='environment'?' selected':''}>Back camera</option><option value="user"${liveHostDraft.camera==='user'?' selected':''}>Front camera</option></select></label>
      <button id="previewLiveHost" type="button" class="secondary">Enable camera &amp; microphone</button>
    </fieldset>
    <div class="live-video-wrap"><video id="liveHostVideo" class="live-video" playsinline autoplay muted hidden></video><div id="liveHostPlaceholder" class="live-video-placeholder">Your camera preview appears here</div></div>
    <p id="liveHostStatus" class="status" role="status">Camera and microphone are off.</p>
    <div class="row wrap live-host-controls">
      <button id="startLiveHost" class="primary" disabled>Go Live</button>
      <button id="muteLiveHost" class="secondary" aria-pressed="false" disabled>Mute mic</button>
      <button id="endLiveHost" class="danger">Cancel</button>
    </div>
    <section id="liveHostActivity" hidden>
      <h3 id="liveHostBroadcastTitle"></h3>
      <p id="liveHostViewerCount" class="status">0 viewers connected</p>
      <p>♥ <span id="liveHeartCount">0</span> · 🔥 <span id="liveFireCount">0</span> · 👏 <span id="liveClapCount">0</span></p>
      <section class="card"><textarea id="liveCommentText" maxlength="500" aria-label="Live comment" placeholder="Say something to your viewers…"></textarea><button id="postLiveComment" class="primary wide">Send</button><div id="liveCommentStatus" class="hint"></div></section>
      <div id="liveComments"></div>
    </section>`;
}

function openLiveHostSetup(){
  if(!requireCommunitySignIn())return;
  if(capturing){liveHostingNotice='Finish your cooking recording before opening the Live camera.';render();return;}
  let name;
  try{name=requireProfileName();}catch(error){liveHostingNotice=error.message;render();return;}
  closeLiveRoom();
  liveHostingNotice='';
  main.innerHTML=liveHostTemplate();
  const controller=new LiveHostController({
    hostUid:cloud.user.uid,hostName:name,
    onStatus:message=>{if(liveHostController===controller)document.querySelector('#liveHostStatus')?.replaceChildren(document.createTextNode(message));},
    onStream:stream=>{
      if(liveHostController!==controller)return;
      const video=document.querySelector('#liveHostVideo');
      if(!video)return;
      video.srcObject=stream;video.muted=true;video.hidden=!stream;
      document.querySelector('#liveHostPlaceholder').hidden=Boolean(stream);
      if(stream){
        video.classList.toggle('mirrored',stream.getVideoTracks()[0]?.getSettings?.().facingMode==='user');
        video.play().catch(()=>{if(video.isConnected)video.controls=true;});
      }
    },
    onSession:session=>{
      if(liveHostController!==controller)return;
      const first=!liveHostSession;
      liveHostSession=session;
      document.querySelector('#liveHostSettings').hidden=true;
      document.querySelector('#startLiveHost').hidden=true;
      document.querySelector('#liveHostActivity').hidden=false;
      document.querySelector('#endLiveHost').textContent='End Live';
      document.querySelector('#liveHostBroadcastTitle').textContent=session.title;
      for(const [id,key] of [['liveHeartCount','heartCount'],['liveFireCount','fireCount'],['liveClapCount','clapCount']])document.getElementById(id).textContent=formatCount(session[key]||0);
      if(first){
        bindLiveRoomChrome(session);
        cloud.unsubLiveComments=cloud.api.observeLiveComments(session.id,items=>{
          if(liveHostController===controller){liveComments=items;renderLiveComments();}
        },()=>{if(liveHostController===controller)document.querySelector('#liveCommentStatus').textContent='Live comments could not load.';});
      }
    },
    onViewerCount:count=>{if(liveHostController===controller)document.querySelector('#liveHostViewerCount').textContent=`${count} viewer${count===1?'':'s'} connected`;},
    onStopped:message=>{
      if(liveHostController!==controller)return;
      liveHostingNotice=message;
      closeLiveRoom();
      if(currentTab==='live')render();
    },
    onEndError:message=>{
      if(!liveHostController){liveHostingNotice=message;if(shouldRenderLiveList())render();}
    }
  });
  liveHostController=controller;
  const title=document.querySelector('#liveHostTitle'),tags=document.querySelector('#liveHostTags'),camera=document.querySelector('#liveHostCamera');
  title.oninput=()=>{liveHostDraft.title=title.value;};
  tags.oninput=()=>{liveHostDraft.tags=tags.value;};
  const prepare=async()=>{
    if(!['idle','preview'].includes(controller.phase))return;
    document.querySelector('#previewLiveHost').disabled=true;
    document.querySelector('#startLiveHost').disabled=true;
    camera.disabled=true;
    try{
      const ready=await controller.prepare(liveHostDraft.camera);
      if(liveHostController===controller&&ready){
        document.querySelector('#startLiveHost').disabled=false;
        document.querySelector('#muteLiveHost').disabled=false;
        document.querySelector('#previewLiveHost').textContent='Refresh camera preview';
      }
    }catch(error){if(liveHostController===controller)document.querySelector('#liveHostStatus').textContent=error.message;}
    finally{if(liveHostController===controller){document.querySelector('#previewLiveHost').disabled=false;camera.disabled=false;}}
  };
  camera.onchange=()=>{liveHostDraft.camera=camera.value;if(controller.phase==='preview')void prepare();};
  document.querySelector('#previewLiveHost').onclick=prepare;
  document.querySelector('#startLiveHost').onclick=async()=>{
    if(controller.phase!=='preview')return;
    document.querySelector('#startLiveHost').disabled=true;
    document.querySelector('#liveHostSettings').disabled=true;
    try{controller.hostName=requireProfileName();await controller.start(liveHostDraft.title,parseTagsInput(liveHostDraft.tags));}
    catch(error){
      if(liveHostController===controller){
        document.querySelector('#liveHostStatus').textContent=error.message;
        document.querySelector('#startLiveHost').disabled=false;
        document.querySelector('#liveHostSettings').disabled=false;
      }
    }
  };
  document.querySelector('#muteLiveHost').onclick=event=>{
    controller.setMuted(!controller.muted);
    event.currentTarget.textContent=controller.muted?'Unmute mic':'Mute mic';
    event.currentTarget.setAttribute('aria-pressed',String(controller.muted));
  };
  document.querySelector('#endLiveHost').onclick=()=>{
    liveHostingNotice=controller.phase==='live'||controller.phase==='starting'?'Live ended. Camera and microphone are off.':'Preview closed. Camera and microphone are off.';
    nav('live');
  };
  document.querySelector('#backLive').onclick=()=>history.back();
  pushViewState();
}

function stopLiveHosting(){
  const controller=liveHostController;
  liveHostController=null;liveHostSession=null;
  void controller?.stop();
}

function liveRoomTemplate(session){
  const ended=session.status==='ENDED';
  const initial=(session.hostName||'C').trim().charAt(0).toUpperCase();
  const video=ended
    ?'<div class="live-video-placeholder">This Live has ended</div>'
    :'<video id="liveVideo" class="live-video" playsinline autoplay muted></video>';
  const reactions=ended?'':`<div class="row wrap" style="margin-top:10px"><button class="secondary" data-live-react="heart">♥ <span id="liveHeartCount">${session.heartCount}</span></button><button class="secondary" data-live-react="fire">🔥 <span id="liveFireCount">${session.fireCount}</span></button><button class="secondary" data-live-react="clap">👏 <span id="liveClapCount">${session.clapCount}</span></button></div><div id="liveReactionStatus" class="hint"></div>`;
  const composer=cloud.user&&!ended
    ?`<section class="card"><textarea id="liveCommentText" maxlength="500" placeholder="Say something"></textarea><button id="postLiveComment" class="primary wide">Send</button><div id="liveCommentStatus" class="hint"></div></section>`
    :ended?'':'<div class="notice">Sign in to chat and react.</div>';
  return `<button id="backLive" class="ghost">← Live</button><section class="card"><div class="live-video-wrap">${video}<div class="live-host-chip"><span class="avatar-circle">${escapeHtml(initial)}</span><div><strong>${escapeHtml(session.hostName)}</strong><br><small>${ended?'ENDED':'🔴 LIVE'}</small></div></div>${ended?'':'<button id="liveAudioToggle" class="live-audio-btn">🔇 Enable audio</button>'}</div><p id="liveViewerStatus" class="status">${escapeHtml(ended?'':liveViewerStatus)}</p>${reactions}</section><div class="section-title"><h2>Live chat</h2></div><div id="liveComments"><div class="empty card">Loading…</div></div>${composer}`;
}

function renderLiveComments(){
  const el=document.querySelector('#liveComments');
  if(!el)return;
  el.innerHTML=liveComments.length
    ?liveComments.map(c=>`<div class="card"><div class="row between"><strong>${escapeHtml(c.authorName)}</strong><small>${relativeTime(c.createdAt)}</small></div><p class="status">${escapeHtml(c.text)}</p></div>`).join('')
    :'<div class="empty card">No comments yet. Say hello.</div>';
}

async function sendLiveReactionTap(sessionId,reaction,button){
  if(!requireCommunitySignIn())return;
  if(liveReactionBusy)return;
  liveReactionBusy=true;button.disabled=true;
  try{await cloud.api.sendLiveReaction(sessionId,reaction);}
  catch(e){const status=document.querySelector('#liveReactionStatus');if(status)status.textContent=e?.message||'Could not send that reaction.';}
  setTimeout(()=>{liveReactionBusy=false;button.disabled=false;},1600);
}

function bindLiveRoomChrome(session){
  document.querySelector('#backLive').onclick=()=>{history.back();};
  main.querySelectorAll('[data-live-react]').forEach(b=>b.onclick=()=>sendLiveReactionTap(session.id,b.dataset.liveReact,b));
  document.querySelector('#liveAudioToggle')?.addEventListener('click',()=>{
    const video=document.querySelector('#liveVideo');
    if(video){video.muted=false;video.play().catch(()=>{});}
  });
  const post=document.querySelector('#postLiveComment');
  if(post)post.onclick=async()=>{
    const box=document.querySelector('#liveCommentText');
    const status=document.querySelector('#liveCommentStatus');
    post.disabled=true;if(status)status.textContent='Sending…';
    try{
      await cloud.api.addLiveComment(session.id,box.value,requireProfileName());
      box.value='';if(status)status.textContent='';
    }catch(e){if(status)status.textContent=e?.message||'Could not send that.';}
    finally{post.disabled=false;}
  };
}

function startLiveViewer(session){
  if(!cloud.user){liveViewerStatus='Sign in to watch Live.';const el=document.querySelector('#liveViewerStatus');if(el)el.textContent=liveViewerStatus;return;}
  liveViewerController=new LiveViewerController({
    sessionId:session.id,
    viewerUid:cloud.user.uid,
    onStatus:message=>{liveViewerStatus=message;const el=document.querySelector('#liveViewerStatus');if(el)el.textContent=message;},
    onTrack:stream=>{const video=document.querySelector('#liveVideo');if(video){video.srcObject=stream;video.play().catch(()=>{});}}
  });
  const controller=liveViewerController;
  // A rapid leave/rejoin can reuse the same session/uid document path. Finish
  // the previous cleanup before creating the replacement peer on that path.
  liveViewerShutdown.then(()=>{
    if(liveViewerController===controller)return controller.start();
  }).catch(error=>{
    if(liveViewerController===controller)controller.status(`Could not join Live: ${error?.message||'unknown error'}`);
  });
}

function openLiveRoom(session){
  closeLiveRoom();
  openLiveSession=session;
  liveViewerStatus='Joining live video…';
  main.innerHTML=liveRoomTemplate(session);
  bindLiveRoomChrome(session);
  startLiveViewer(session);

  // Patches the room in place instead of calling render(): this is the same
  // "drill-in" treatment openCommunityRecipe() gives comments, and for the same
  // reason -- a full re-render here would tear down and recreate the <video>
  // element (and with it, its srcObject) every time the host's heartbeat ticks.
  cloud.unsubLiveSessionDoc=cloud.api.observeLiveSession(session.id,updated=>{
    if(!updated||!openLiveSession)return;
    const justEnded=openLiveSession.status!=='ENDED'&&updated.status==='ENDED';
    openLiveSession=updated;
    document.querySelector('#liveHeartCount')?.replaceChildren(document.createTextNode(String(updated.heartCount)));
    document.querySelector('#liveFireCount')?.replaceChildren(document.createTextNode(String(updated.fireCount)));
    document.querySelector('#liveClapCount')?.replaceChildren(document.createTextNode(String(updated.clapCount)));
    if(justEnded){
      stopLiveViewer();
      main.innerHTML=liveRoomTemplate(updated);
      bindLiveRoomChrome(updated);
      renderLiveComments();
    }
  },()=>{});

  cloud.unsubLiveComments=cloud.api.observeLiveComments(session.id,items=>{liveComments=items;renderLiveComments();});
  pushViewState();
}

function stopLiveViewer(){
  const controller=liveViewerController;
  liveViewerController=null;
  const stopped=controller?.stop();
  liveViewerShutdown=Promise.all([liveViewerShutdown,stopped]).then(()=>{}).catch(()=>{});
}

function closeLiveRoom(){
  stopLiveHosting();
  stopLiveViewer();
  try{cloud.unsubLiveSessionDoc?.();}catch{}
  try{cloud.unsubLiveComments?.();}catch{}
  cloud.unsubLiveSessionDoc=null;cloud.unsubLiveComments=null;
  openLiveSession=null;liveComments=[];liveViewerStatus='';
}

function render(){
  if(currentTab==='cook'){captureForm();main.innerHTML=cookTemplate();bindCook();}
  if(currentTab==='recipes'){main.innerHTML=recipesTemplate();bindRecipes();}
  if(currentTab==='community'){main.innerHTML=communityTemplate();bindCommunity();}
  if(currentTab==='inbox'){main.innerHTML=inboxTemplate();bindInbox();}
  if(shouldRenderLiveList()){main.innerHTML=liveTemplate();bindLive();}
  if(currentTab==='profile'){main.innerHTML=profileTemplate();bindProfile();}
  renderPaywall();
  updateInboxBadge();
}

// A hidden iPhone PWA can suspend media and timers. End this broadcast rather
// than leave a room advertised as live without a working camera.
function stopHiddenLiveHost(){
  if(!liveHostController)return;
  liveHostingNotice='Live closed because you left the screen. Camera and microphone are off.';
  closeLiveRoom();
  if(currentTab==='live')render();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopHiddenLiveHost();});
window.addEventListener('pagehide',stopHiddenLiveHost);

if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
window.addEventListener('beforeunload',()=>{stopLiveHosting();closeCookAlong();capture.close();try{liveViewerController?.stop();}catch{}for(const key of ['unsubAuth','unsubFeed','unsubProfile','unsubLiked','unsubBookmarks','unsubFollowing','unsubComments','unsubEntitlement','unsubBlocked','unsubConversations','unsubMessageReads','unsubNotifications','unsubThread','unsubChefRecipes','unsubLiveSessions','unsubLiveSessionDoc','unsubLiveComments'])try{cloud[key]?.();}catch{}});
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
