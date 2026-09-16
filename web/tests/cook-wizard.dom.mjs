// Optional DOM integration checks: npm install --no-save jsdom
// Uses the real Cook code and parser with simulated audio/storage endpoints.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {parseIngredient} from '../js/ingredient-parser.js';
import {parseCookingSession,mergeDraft} from '../js/cooking-session-parser.js';
import {parseTagsInput} from '../js/tag-utils.js';
const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.COOK_TEST_MODULES?`${process.env.COOK_TEST_MODULES}/jsdom`:'jsdom');
const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const dom=new JSDOM('<main id="main"></main>',{url:'http://localhost',runScripts:'outside-only'});
const w=dom.window;const document=w.document;w.HTMLElement.prototype.scrollIntoView=()=>{};
let stored=[];let mediaWrites=0;let voiceWrites=0;let saveFails=false;let starts=0;let stops=0;let permissionResolve;
Object.assign(w,{parseIngredient,parseCookingSession,mergeDraft,parseTagsInput,structuredClone,
  capture:{start:async()=>{starts++;await new Promise(resolve=>permissionResolve=resolve)},stop:async()=>{stops++;return {audioBlob:new Blob(['voice'])}}},
  saveAudioBlob:async()=>{voiceWrites++;return {stored:true}},saveMediaBlob:async()=>{mediaWrites++;return {stored:true}},saveRecipes:x=>{if(saveFails)throw Error('Storage full');stored=x;},ChefAnalytics:{recipeCaptureStarted(){},recipeCompleted(){}}
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
console.log(`${checks} Cook wizard DOM checks passed.`);
dom.window.close();
