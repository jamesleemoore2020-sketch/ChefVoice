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

let stored=[];let deletedAudioIds=[];let deletedMediaRecipeIds=[];let deleteCloudCalls=[];

Object.assign(w,{
  escapeHtml:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  cloud:{user:null,api:{deleteChefVoiceRecipe:async id=>{deleteCloudCalls.push(id);}}},
  saveRecipes:x=>{stored=x;},
  deleteAudioBlob:async id=>{deletedAudioIds.push(id);},
  deleteRecipeMedia:async r=>{deletedMediaRecipeIds.push(r?.id);}
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

// Signed in, unpublished, with stored session audio: the orphan case this
// fix closes. The delete-cloud callable must fire, and the local delete must
// still complete exactly as before.
run("recipes=[{id:'r2',title:'Draft soup 2',isPublic:false,sessionAudio:{stored:true}}];cloud.user={uid:'chef-1'};render();");
click('[data-delete-recipe="r2"]');
await tick();
check(deleteCloudCalls.includes('r2'),'unpublished + stored session audio + signed in triggers cloud cleanup');
check(stored.every(r=>r.id!=='r2'),'recipe is still removed locally');
check(deletedAudioIds.includes('r2')&&deletedMediaRecipeIds.includes('r2'),'local audio/media cleanup still runs');

// Signed in, unpublished, but no session audio was ever stored: nothing to
// clean up in Cloud Storage, so the callable must not be called.
run("recipes=[{id:'r3',title:'No audio soup',isPublic:false}];render();");
click('[data-delete-recipe="r3"]');
await tick();
check(!deleteCloudCalls.includes('r3'),'no stored session audio: no cloud cleanup attempted');

// Signed in, published, with stored session audio: this is not the orphan
// case (a published recipe is not what this fix targets), so "Delete local"
// must not call the private-audio cleanup callable for it either.
run("recipes=[{id:'r4',title:'Published soup',isPublic:true,sessionAudio:{stored:true}}];render();");
click('[data-delete-recipe="r4"]');
await tick();
check(!deleteCloudCalls.includes('r4'),'published recipe: delete-local never calls the private-audio cleanup callable');

console.log(`${checks} Recipes list DOM checks passed.`);
dom.window.close();
