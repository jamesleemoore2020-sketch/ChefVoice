// Optional DOM integration checks: npm install --no-save jsdom
// Uses the real Recipes-list code (recipesTemplate/bindRecipes) with simulated
// cloud/storage endpoints, mirroring cook-wizard.dom.mjs's slicing approach.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.COOK_TEST_MODULES?`${process.env.COOK_TEST_MODULES}/jsdom`:'jsdom');
const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const dom=new JSDOM('<main id="main"></main>',{url:'http://localhost',runScripts:'outside-only'});
const w=dom.window;const document=w.document;

let stored=[];let deletedAudioIds=[];let deletedMediaRecipeIds=[];let deleteCloudCalls=[];let inspectCalls=[];
let inspectResponses={};// id -> {exists,authorId} to resolve with, or an Error to throw
let confirmResult=true;let confirmCalls=0;

Object.assign(w,{
  escapeHtml:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  cloud:{user:null,api:{
    deleteChefVoiceRecipe:async id=>{deleteCloudCalls.push(id);},
    inspectRecipeForMutation:async id=>{
      inspectCalls.push(id);
      const r=inspectResponses[id];
      if(r instanceof Error)throw r;
      return r||{exists:true,authorId:''};
    }
  }},
  saveRecipes:x=>{stored=x;},
  deleteAudioBlob:async id=>{deletedAudioIds.push(id);},
  deleteRecipeMedia:async r=>{deletedMediaRecipeIds.push(r?.id);},
  confirm:()=>{confirmCalls++;return confirmResult;}
});

// recipesTemplate/publishLocalRecipe/unpublishLocalRecipe/bindRecipes is one
// contiguous block. publishLocalRecipe/unpublishLocalRecipe are pulled in too
// (unavoidable, mid-block) but never invoked here, so their own free variables
// (cloudRecipesRemaining, showPaywall, etc.) are never dereferenced.
const start=source.indexOf('function recipesTemplate(){');
const end=source.indexOf('// ---- Second Pass (ChefVoice Review)',start);
assert.ok(start>0&&end>start,'recipesTemplate..bindRecipes block found in app.js');
const recipesSection=source.slice(start,end);
vm.runInContext(`const main=document.querySelector('#main');let recipes=[];${recipesSection}
function render(){main.innerHTML=recipesTemplate();bindRecipes();}`,dom.getInternalVMContext());

const run=code=>vm.runInContext(code,dom.getInternalVMContext());
const get=s=>{const e=document.querySelector(s);assert.ok(e,`exists: ${s}`);return e;};
const click=s=>get(s).click();
let checks=0;const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// A never-published recipe that ran ChefVoice Review (post-save, or the Cook
// wizard's capture-time review) has session audio uploaded to private Cloud
// Storage under its own id. Deleting it locally while signed out must still
// delete it locally, but cannot reach the cloud to clean up that Storage prefix.
run("recipes=[{id:'r1',title:'Draft soup',isPublic:false,sessionAudio:{stored:true}}];cloud.user=null;render();");
click('[data-delete-recipe="r1"]');
await tick();
check(deleteCloudCalls.length===0,'signed out: no cloud cleanup attempted');
check(stored.every(r=>r.id!=='r1'),'signed out: recipe is still removed locally');
check(deletedAudioIds.includes('r1'),'signed out: local audio cleanup still runs');

// Signed in, unpublished, with stored session audio: the orphan case
// PWA_ORPHANED_AUDIO_CLEANUP_0.5.3 closes. The delete-cloud callable must fire
// (fire-and-forget, no preflight/confirm -- there is no Firestore doc to check
// ownership against), and the local delete must still complete as before.
run("recipes=[{id:'r2',title:'Draft soup 2',isPublic:false,sessionAudio:{stored:true}}];cloud.user={uid:'chef-1'};render();");
click('[data-delete-recipe="r2"]');
await tick();
check(deleteCloudCalls.includes('r2'),'unpublished + stored session audio + signed in triggers cloud cleanup');
check(!inspectCalls.includes('r2'),'never-published orphan cleanup skips the ownership preflight entirely');
check(stored.every(r=>r.id!=='r2'),'recipe is still removed locally');
check(deletedAudioIds.includes('r2')&&deletedMediaRecipeIds.includes('r2'),'local audio/media cleanup still runs');

// Signed in, unpublished, but no session audio was ever stored: nothing to
// clean up in Cloud Storage, so the callable must not be called.
run("recipes=[{id:'r3',title:'No audio soup',isPublic:false}];cloud.user={uid:'chef-1'};render();");
click('[data-delete-recipe="r3"]');
await tick();
check(!deleteCloudCalls.includes('r3'),'no stored session audio: no cloud cleanup attempted');

// Signed in as the owner, published: "Delete" (the button relabels away from
// "Delete local" for any cloud-backed recipe) must run the real ownership
// preflight, then permanently delete the Community/cloud recipe, then clean up
// locally -- this is the gap this fix closes.
inspectResponses.r4={exists:true,authorId:'chef-1'};
run("recipes=[{id:'r4',title:'Published soup',isPublic:true,sessionAudio:{stored:true}}];cloud.user={uid:'chef-1'};render();");
check(get('[data-delete-recipe="r4"]').textContent==='Delete','published recipe button reads "Delete", not "Delete local"');
click('[data-delete-recipe="r4"]');
await tick();
check(inspectCalls.includes('r4'),'published + owned: ownership preflight runs before deleting');
check(deleteCloudCalls.includes('r4'),'published + owned + confirmed: real cloud deletion runs');
check(stored.every(r=>r.id!=='r4'),'recipe is removed locally after cloud deletion succeeds');
check(deletedAudioIds.includes('r4')&&deletedMediaRecipeIds.includes('r4'),'local audio/media cleanup still runs');

// Published, but signed out: there is no session to run the preflight or the
// delete callable as, so the recipe must be left completely alone rather than
// silently stripping only the local copy and stranding the cloud original.
run("recipes=[{id:'r5',title:'Published, signed out',isPublic:true}];cloud.user=null;render();");
click('[data-delete-recipe="r5"]');
await tick();
check(!inspectCalls.includes('r5')&&!deleteCloudCalls.includes('r5'),'published + signed out: no cloud calls attempted');
check(run("recipes.some(r=>r.id==='r5')"),'published + signed out: local copy is kept, not deleted');
check(get('[data-recipe-status="r5"]').textContent.includes('Sign in'),'published + signed out: status asks the chef to sign in');

// Published, signed in, but the chef cancels the confirmation: nothing happens
// at all, not even local cleanup -- "This cannot be undone" has to mean it.
confirmResult=false;
run("recipes=[{id:'r6',title:'Published, cancelled',isPublic:true}];cloud.user={uid:'chef-1'};render();");
click('[data-delete-recipe="r6"]');
await tick();
check(confirmCalls>0,'published: a confirmation prompt is shown before deleting');
check(!inspectCalls.includes('r6')&&!deleteCloudCalls.includes('r6'),'cancelled confirm: no cloud calls attempted');
check(run("recipes.some(r=>r.id==='r6')"),'cancelled confirm: recipe is kept, not deleted');
check(get('[data-delete-recipe="r6"]').disabled===false,'cancelled confirm: button stays enabled');
confirmResult=true;

// Published, signed in, but the live cloud doc belongs to a different account
// (e.g. a stale local cache from a previous sign-in on this device/browser):
// must refuse to delete rather than destroying someone else's recipe.
inspectResponses.r7={exists:true,authorId:'chef-1'};
run("recipes=[{id:'r7',title:'Owned by someone else',isPublic:true}];cloud.user={uid:'chef-2'};render();");
click('[data-delete-recipe="r7"]');
await tick();
check(!deleteCloudCalls.includes('r7'),'authorId mismatch: cloud deletion is never called');
check(run("recipes.some(r=>r.id==='r7')"),'authorId mismatch: recipe is kept, not deleted');
check(get('[data-recipe-status="r7"]').textContent.includes('different ChefVoice account'),'authorId mismatch: status explains why');
check(get('[data-delete-recipe="r7"]').disabled===false,'authorId mismatch: button is re-enabled after the check');

// A recipe that was published and later unpublished keeps its authorId (only
// isPublic flips back to false), and its Firestore doc/Storage media can still
// exist -- it must go through the same cloud-aware path as a currently-public one.
inspectResponses.r8={exists:true,authorId:'chef-1'};
run("recipes=[{id:'r8',title:'Unpublished after publishing',isPublic:false,authorId:'chef-1'}];cloud.user={uid:'chef-1'};render();");
click('[data-delete-recipe="r8"]');
await tick();
check(deleteCloudCalls.includes('r8'),'previously-published (authorId set, isPublic false) still triggers real cloud deletion');
check(stored.every(r=>r.id!=='r8'),'recipe is removed locally after cloud deletion succeeds');

// Published locally, but the live cloud doc is already gone (e.g. deleted from
// another device): the callable is skipped as unnecessary, and the local copy
// is still cleaned up, exactly like Android's "already absent" branch.
inspectResponses.r9={exists:false,authorId:''};
run("recipes=[{id:'r9',title:'Already gone from cloud',isPublic:true}];cloud.user={uid:'chef-1'};render();");
click('[data-delete-recipe="r9"]');
await tick();
check(inspectCalls.includes('r9'),'already-absent: the preflight still runs');
check(!deleteCloudCalls.includes('r9'),'already-absent: the delete callable is skipped, nothing left to clean up');
check(stored.every(r=>r.id!=='r9'),'already-absent: local copy is still removed');

// The ownership preflight itself fails (e.g. a transient network/permission
// error): the local copy must be kept rather than guessing.
inspectResponses.r10=new Error('Missing or insufficient permissions.');
run("recipes=[{id:'r10',title:'Preflight failed',isPublic:true}];cloud.user={uid:'chef-1'};render();");
click('[data-delete-recipe="r10"]');
await tick();
check(!deleteCloudCalls.includes('r10'),'preflight error: delete callable is never called');
check(run("recipes.some(r=>r.id==='r10')"),'preflight error: local copy is kept, not deleted');
check(get('[data-recipe-status="r10"]').textContent.includes('insufficient permissions'),'preflight error: the underlying error message is surfaced');
check(get('[data-delete-recipe="r10"]').disabled===false,'preflight error: button is re-enabled');

console.log(`${checks} Recipes list DOM checks passed.`);
dom.window.close();
