// Optional DOM integration checks: npm install --no-save jsdom
// Uses the real Cook code and parser with simulated audio/storage endpoints.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {parseIngredient} from '../js/ingredient-parser.js';
import {parseCookingSession,mergeDraft} from '../js/cooking-session-parser.js';
import {parseTagsInput} from '../js/tag-utils.js';
import {applySuggestion,applyMethodSuggestion,fromCloudTranscript} from '../js/second-pass-reviewer.js';
import {secondPassRemaining,secondPassMonthlyLimit,recordSecondPassUse,PaywallTrigger} from '../js/entitlement.js';
// entitlement.js's monthly quota bookkeeping reads/writes the browser localStorage
// global, which plain Node does not provide; a tiny in-memory stand-in lets that
// real code run as written instead of being re-mocked here.
if(typeof globalThis.localStorage==='undefined'){
  const store=new Map();
  globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
}
const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.COOK_TEST_MODULES?`${process.env.COOK_TEST_MODULES}/jsdom`:'jsdom');
const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const dom=new JSDOM('<main id="main"></main>',{url:'http://localhost',runScripts:'outside-only'});
const w=dom.window;const document=w.document;w.HTMLElement.prototype.scrollIntoView=()=>{};
let stored=[];let mediaWrites=0;let voiceWrites=0;let saveFails=false;let starts=0;let stops=0;let permissionResolve;
let transcribeCalls=[];let transcribeResult=null;let paywallCalls=[];let secondPassAcceptedCalls=[];
Object.assign(w,{parseIngredient,parseCookingSession,mergeDraft,parseTagsInput,structuredClone,
  applySuggestion,applyMethodSuggestion,fromCloudTranscript,secondPassRemaining,secondPassMonthlyLimit,recordSecondPassUse,PaywallTrigger,
  isPro:()=>false,safetyStatus:()=>{},showPaywall:t=>{paywallCalls.push(t)},
  cloud:{user:null,entitlement:null,api:{transcribePrivateChefVoice:async(id,blob)=>{transcribeCalls.push({id,blob});return transcribeResult;}}},
  capture:{start:async()=>{starts++;await new Promise(resolve=>permissionResolve=resolve)},stop:async()=>{stops++;return {audioBlob:new Blob(['voice'])}}},
  saveAudioBlob:async()=>{voiceWrites++;return {stored:true}},saveMediaBlob:async()=>{mediaWrites++;return {stored:true}},saveRecipes:x=>{if(saveFails)throw Error('Storage full');stored=x;},
  ChefAnalytics:{recipeCaptureStarted(){},recipeCompleted(){},secondPassOpened(){},secondPassAccepted(k){secondPassAcceptedCalls.push(k)},KIND_INGREDIENT:'ingredient',KIND_METHOD:'method'}
});
w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
const initial=source.slice(source.indexOf('let ingredients=[];'),source.indexOf('const cloud={'));
const functions=source.slice(source.indexOf('function cookTemplate(){'),source.indexOf('\nfunction recipesTemplate(){'));
const captureForm=source.slice(source.indexOf('function captureForm(){'),source.indexOf('// Browser/PWA back-button'));
vm.runInContext(`const main=document.querySelector('#main');let recipes=[];let currentTab='cook';const isIOS=false;let speechNeedsReset=false;let voiceEngineUsed=false;const fmt=ms=>String(ms);const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));${initial}${captureForm}${functions}
function render(){captureForm();main.innerHTML=cookTemplate();bindCook();}function nav(tab){captureForm();currentTab=tab;if(tab==='cook')render();else main.innerHTML='Recipes';}render();`,dom.getInternalVMContext());
const run=code=>vm.runInContext(code,dom.getInternalVMContext());
const get=s=>{const e=document.querySelector(s);assert.ok(e,`exists: ${s}`);return e;};
const click=s=>get(s).click();
const fill=(s,value)=>{const e=get(s);e.value=value;e.dispatchEvent(new w.Event('input',{bubbles:true}));};
let checks=0;const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const next=()=>click('#cookNext');const back=()=>click('#cookBack');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
check(get('#cookProgress').textContent.includes('Step 1 of 5 · Capture'),'starts at Capture');check(!document.querySelector('#title,#ingredientList,#mediaInput,#saveRecipe'),'only current section mounted');check(document.querySelectorAll('.hero').length===1,'banner retained');
next();fill('#title','Sunday <tomato> pasta');fill('#description','Family dinner');fill('#servings','4');fill('#tags','#camping, weeknight');fill('#prepTime','15');fill('#cookTime','25');
next();fill('#manualIngredient','two tablespoons olive oil');click('#addIngredient');fill('[data-k=name]','extra virgin olive oil');fill('#manualStep','Warm the oil.');click('#addStep');fill('[data-step="0"]','Warm the oil gently.');fill('#manualIngredient','unfinished entry');
next();const input=get('#mediaInput');Object.defineProperty(input,'files',{value:[new w.File(['photo'],'photo.png',{type:'image/png'})]});input.dispatchEvent(new w.Event('change'));
check(document.querySelectorAll('.thumb-wrap').length===1,'photo preview mounted');
next();const review=get('#recipeReview').textContent;for(const value of ['Sunday <tomato> pasta','Family dinner','Serves 4','Prep 15m','Cook 25m','#camping','extra virgin olive oil','Warm the oil gently.','1 photo'])check(review.includes(value),`review includes ${value}`);
check(!get('#saveRecipe').disabled,'valid recipe can save');check(!get('#recipeReview').querySelector('tomato'),'review escapes markup');
back();back();check(get('[data-k=name]').value==='extra virgin olive oil','ingredient persists');check(get('#manualIngredient').value==='unfinished entry','unfinished input persists');run("nav('recipes');nav('cook')");check(get('[data-step="0"]').value==='Warm the oil gently.','method survives tab switch');back();check(get('#title').value==='Sunday <tomato> pasta','details survive Back');next();next();next();
// A failed save leaves a retryable draft, and does not insert duplicate recipes.
saveFails=true;click('#saveRecipe');await tick();check(!get('#recipeSaveError').hidden,'save error shown');check(!get('#saveRecipe').disabled,'save can retry');check(get('#recipeReview').textContent.includes('Sunday <tomato> pasta'),'failed save keeps draft');
saveFails=false;click('#saveRecipe');await tick();check(stored.length===1&&stored[0].isPublic===false,'saved privately once');check(stored[0].prepTimeMinutes===15&&stored[0].cookTimeMinutes===25,'times persisted');check(stored[0].media[0].stored&&mediaWrites>0,'media persisted');run("nav('cook')");check(get('#cookProgress').textContent.includes('Step 1 of 5'),'reset to Capture');next();check(get('#title').value==='','fields reset');next();next();next();check(get('#saveRecipe').disabled,'empty recipe cannot save');
// Permission is pending while Next is used; stream and editor state must survive.
back();back();back();back();click('#captureBtn');check(get('#captureBtn').disabled,'permission pending blocks duplicate start');next();fill('#title','Captured soup');permissionResolve();await tick();check(!!get('#finishCookCapture'),'finish control available beyond Capture');next();fill('#manualIngredient','one teaspoon salt');click('#addIngredient');fill('[data-k=name]','sea salt');run("captureStatus='Still listening';livePartial='Add two cups water';renderCaptureState()");check(get('[data-k=name]').value==='sea salt','live speech does not overwrite input');next();check(get('#recordRecipeVideo').disabled,'video recording disabled during voice capture');next();check(get('#saveRecipe').disabled,'cannot save while recording');run("transcript.push({text:'Add two cups of water.',elapsedMs:0})");click('#finishCookCapture');await tick();check(starts===1&&stops===1,'single capture start and finish');check(!get('#saveRecipe').disabled,'finish enables save');check(get('#recipeReview').textContent.includes('1 voice clip'),'review includes voice');back();check(!!document.querySelector('#draftVoice audio'),'voice player in Media');next();click('#saveRecipe');await tick();check(voiceWrites===1&&stored[0].sessionAudio.stored,'original audio saved');
// Blank ingredient names cannot bypass validation; recovery rebuilds a usable draft.
run("nav('cook')");next();fill('#title','Recovered soup');next();fill('#manualIngredient','one teaspoon salt');click('#addIngredient');fill('[data-k=name]',' ');next();next();check(get('#saveRecipe').disabled,'blank ingredient cannot save');back();back();fill('#transcriptEditor','Add two teaspoons salt. Stir gently.');click('#reanalyze');check(document.querySelectorAll('[data-ing]').length>0,'transcript recovery builds ingredients');next();next();check(!get('#saveRecipe').disabled,'recovered draft can save');
// Exercise the actual cloud conversion functions without loading Firebase.
const firebase=readFileSync(new URL('../js/firebase-client.js',import.meta.url),'utf8');
const converters=firebase.slice(firebase.indexOf('function toCloudMap('),firebase.indexOf('function normalizeProfile('));
const cloudContext=vm.createContext({crypto:{randomUUID:()=> 'test-id'}});vm.runInContext(converters,cloudContext);cloudContext.recipe=stored[0];
check(vm.runInContext('normalizeCloudRecipe(recipe.id,toCloudMap({...recipe,prepTimeMinutes:15,cookTimeMinutes:25})).cookTimeMinutes',cloudContext)===25,'cloud conversion retains time metadata');
check(vm.runInContext('toCloudMap({...recipe,prepTimeMinutes:-5,cookTimeMinutes:2.7}).prepTimeMinutes===0 && toCloudMap({...recipe,cookTimeMinutes:2.7}).cookTimeMinutes===2',cloudContext),'cloud times meet integer/non-negative rules');
// Second Pass can now run against the just-recorded draft before the recipe is
// ever saved, prefilling Ingredients/Method instead of the chef re-typing them.
back();back();back();back();
run("ingredients=[];steps=[];audioBlob=new Blob(['voice']);draftRecipeId='';captureSecondPass={busy:false,message:'',result:null};cloud.user=null;renderCookDynamic();");
check(get('#cookProgress').textContent.includes('Step 1 of 5'),'back at Capture for the pre-save review scenario');
check(get('#captureSecondPass').textContent.includes(`${secondPassRemaining(false)} of ${secondPassMonthlyLimit(false)} reviews left`),'capture review shows the free quota');
click('#runCaptureSecondPass');
check(run("currentTab")==='profile','signed-out capture review redirects to sign in');
check(transcribeCalls.length===0,'no upload attempted while signed out');
run("nav('cook')");run("cloud.user={uid:'chef-1'}");
transcribeResult={transcript:'Add two cups of flour. Stir the batter well.',segments:['Add two cups of flour.','Stir the batter well.'],provider:'google-cloud-speech-v2',model:'chirp_3'};
click('#runCaptureSecondPass');await tick();
const mintedDraftId=run("draftRecipeId");
check(!!mintedDraftId,'a draft id is minted for the private upload');
check(transcribeCalls.length===1&&transcribeCalls[0].id===mintedDraftId,'audio uploaded under the minted draft id');
check(!!get('#closeCaptureSecondPass'),'review result replaces the run button');
check(!get('#captureSecondPass').textContent.includes('reviews left'),'quota card is replaced by results');
check(run("ingredients.some(i=>i.name.toLowerCase().includes('flour'))"),'an ingredient the live pass missed fills the draft on its own');
check(!document.querySelector('[data-accept-capture-ingredient]'),'a purely additive miss needs no accept click');
// "Add two cups of flour" is itself a valid method step as well as an ingredient
// declaration, so more than one card can offer a method suggestion here -- find
// the one that actually adds the missing "stir" step rather than assuming order.
const batterButton=[...document.querySelectorAll('[data-accept-capture-method]')].find(b=>b.closest('article').textContent.toLowerCase().includes('batter'));
assert.ok(batterButton,'a method suggestion for the batter step exists');
batterButton.click();
check(run("steps.some(s=>s.toLowerCase().includes('batter'))"),'accepted method suggestion fills the draft');
check(secondPassAcceptedCalls.includes('method'),'method acceptance is tracked');
click('#closeCaptureSecondPass');
check(secondPassRemaining(false)===secondPassMonthlyLimit(false)-1,'a successful capture-time review counts against the monthly quota');
// Exhausting the quota blocks another run and raises the same paywall as the
// saved-recipe review, without spending another upload.
run("recordSecondPassUse();captureSecondPass={busy:false,message:'',result:null};renderCookDynamic();");
click('#runCaptureSecondPass');
check(transcribeCalls.length===1,'no upload attempted once the monthly quota is used up');
check(paywallCalls.includes(PaywallTrigger.SECOND_PASS),'quota exhaustion raises the Second Pass paywall');
check(get('#captureSecondPass').textContent.includes('used all'),'quota-exhausted message is shown inline');
// Saving reuses the same draft id, so the already-uploaded private audio stays
// attached to the saved recipe instead of being orphaned under a new id.
next();fill('#title','Second pass draft');next();next();next();
click('#saveRecipe');await tick();
check(stored.some(r=>r.id===mintedDraftId&&r.title==='Second pass draft'),'save reuses the pre-save draft id');
// A capture can be finished from any wizard step, so the Recipe Details inputs
// may already be mounted when detection runs. Navigation re-reads those inputs
// into `form`, so a detected value written only to state was wiped right back
// out -- the chef saw an empty Cook min despite saying "cook for 2 minutes".
const resetCook=()=>run("main.innerHTML='';form.title='';form.prepTime='';form.cookTime='';ingredients=[];steps=[];transcript=[];cookStep=0;capturing=false;captureBusy=false;audioBlob=null;render();");
const spoken="Add one top ramen and one teaspoon of salt, then let it cook for 2 minutes.";
resetCook();
click('#captureBtn');permissionResolve();await tick();
next();check(get('#cookTime').value==='','cook time starts empty on Recipe Details');
run(`transcript.push({id:'d1',elapsedMs:0,text:${JSON.stringify(spoken)}})`);
click('#finishCookCapture');await tick();
check(get('#cookTime').value==='2','detected cook time reaches the mounted Recipe Details input');
next();back();
check(get('#cookTime').value==='2'&&run('form.cookTime')==='2','detected cook time survives navigation');
// ...and a time the chef typed during that same capture is a manual edit that
// detection must not overwrite.
resetCook();
click('#captureBtn');permissionResolve();await tick();
next();fill('#cookTime','30');
run(`transcript.push({id:'d2',elapsedMs:0,text:${JSON.stringify(spoken)}})`);
click('#finishCookCapture');await tick();
next();back();
check(get('#cookTime').value==='30'&&run('form.cookTime')==='30','a manually typed cook time still wins over detection');
// Real 2026-09-16 report: live recognition caught almost nothing ("0 confirmed ·
// 5 to review"), so capture-time detection found no recipe name or cook time.
// ChefVoice Review then returned the real transcript, but accepting its
// suggestions only ever filled Ingredients/Method -- Recipe Details stayed blank.
resetCook();
// The quota was deliberately exhausted above; this scenario needs a run left.
globalThis.localStorage.removeItem('chefvoice.secondPass.usage');
run("audioBlob=new Blob(['v']);transcript=[{id:'x',elapsedMs:0,text:'uh'}];captureSecondPass={busy:false,message:'',result:null};cloud.user={uid:'chef-1'};renderCookDynamic();");
transcribeResult={transcript:"Okay, so today we're going to cook my famous top ramen meal. We start with one pack of top ramen, 1 tbsp of salt, 1 tbsp of pepper, and then you're going to let it cook for 2 minutes and you serve it up.",segments:[],provider:'google-cloud-speech-v2',model:'chirp_3'};
click('#runCaptureSecondPass');await tick();
check(run("form.title")==='Famous top ramen meal','the review fills the spoken recipe name with no accept click');
check(run("form.cookTime")==='2','the review fills the spoken cook time with no accept click');
check(run("ingredients.map(i=>i.name).join(',')")==='Pack of top ramen,Salt,Pepper','ingredients the live pass missed are added without an accept click');
check(document.querySelectorAll('[data-accept-capture-ingredient]').length===0,'auto-applied ingredient cards resolve instead of lingering');
check(run("steps.length")===0&&document.querySelectorAll('[data-accept-capture-method]').length>0,'method wording is never auto-applied and still offers an accept');
next();
check(get('#title').value==='Famous top ramen meal'&&get('#cookTime').value==='2','review-detected details reach the mounted Recipe Details inputs');
// A name the chef already typed is theirs; the review must not overwrite it.
resetCook();
globalThis.localStorage.removeItem('chefvoice.secondPass.usage');
run("audioBlob=new Blob(['v']);transcript=[{id:'y',elapsedMs:0,text:'uh'}];captureSecondPass={busy:false,message:'',result:null};renderCookDynamic();");
next();fill('#title','My own name');back();
click('#runCaptureSecondPass');await tick();
check(run("form.title")==='My own name','a manually typed recipe name survives the review autofill');
check(run("form.cookTime")==='2','an empty cook time is still filled alongside the name the chef kept');
// Only a purely additive miss is automatic. A quantity the chef already has
// recorded disagreeing with the review changes what was said, so it stays behind
// an explicit "Use second pass".
resetCook();
globalThis.localStorage.removeItem('chefvoice.secondPass.usage');
run("ingredients=[{id:'ing-1',quantity:'3',unit:'tbsp',name:'Salt'}];audioBlob=new Blob(['v']);transcript=[{id:'z',elapsedMs:0,text:'uh'}];captureSecondPass={busy:false,message:'',result:null};renderCookDynamic();");
transcribeResult={transcript:'Add 1 tbsp of salt.',segments:[],provider:'google-cloud-speech-v2',model:'chirp_3'};
click('#runCaptureSecondPass');await tick();
check(run("ingredients.find(i=>i.name==='Salt').quantity")==='3','a disagreeing quantity is not overwritten automatically');
check(document.querySelectorAll('[data-accept-capture-ingredient]').length>0,'the disagreement is still offered for review');
console.log(`${checks} Cook wizard DOM checks passed.`);
dom.window.close();
