// DOM integration checks for servings and units on a Community recipe (audit F21):
//   npm install --no-save jsdom
// Uses the real recipe-view block of app.js (recipeViewFor .. bindCollectionPicker), sliced out
// the way cook-wizard.dom.mjs and recipes-list.dom.mjs slice theirs. The browser specs in e2e/
// cannot reach this screen: they keep Firebase unreachable, so Community has no recipes there.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.COOK_TEST_MODULES?`${process.env.COOK_TEST_MODULES}/jsdom`:'jsdom');
const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
// An open Community recipe: its ingredients, and the comment thread and composer below them.
const dom=new JSDOM('<main id="main"><div id="communityIngredients"></div><div id="comments"><div class="card">A comment</div></div><textarea id="commentText"></textarea></main>',{url:'http://localhost',runScripts:'outside-only'});
const w=dom.window;const document=w.document;

const scaling=await import('../js/ingredient-scaling.js');
let shoppingAdds=[];let shoppingBacks=[];let reopened=[];

Object.assign(w,{
  ...scaling,
  escapeHtml:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  openShoppingList:back=>{shoppingBacks.push(back);},
  openCommunityRecipe:id=>{reopened.push(id);}
});

const start=source.indexOf('// ---- Recipe detail: how the chef is *viewing* a recipe');
const end=source.indexOf('// ---- Shopping list',start);
assert.ok(start>0&&end>start,'recipe view block found in app.js');
vm.runInContext(`const main=document.querySelector('#main');let shoppingMessage='';let overlayScreen='cook';
function addRecipeToShoppingList(recipe,factor){shoppingAdds.push({id:recipe.id,factor});shoppingMessage='Added 2 items to the shopping list.';}
${source.slice(start,end)}
// The chef's own recipe screen redraws all of <main>; a Community recipe must never go through it.
var openRecipeCalls=0;openRecipe=function(){openRecipeCalls++;};`,Object.assign(dom.getInternalVMContext(),{shoppingAdds}));

const run=code=>vm.runInContext(code,dom.getInternalVMContext());
const get=s=>{const e=document.querySelector(s);assert.ok(e,`exists: ${s}`);return e;};
let checks=0;const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const ingredients=()=>get('#communityIngredients').textContent;

run(`var communityRecipe={id:'c1',title:'Other chef soup',servings:2,ingredients:[
  {quantity:'2',unit:'cups',name:'flour'},{quantity:'1',unit:'tbsp',name:'olive oil'},{quantity:'',unit:'',name:'salt'}]};
renderCommunityIngredients(communityRecipe);`);
check(ingredients().includes('Serves 2'),'a Community recipe offers the servings stepper');
check(ingredients().includes('As the chef cooked it'),'it starts at the chef\'s own servings');
check(ingredients().includes('2 cups flour')&&ingredients().includes('salt'),'every ingredient is listed as written');
check(document.querySelectorAll('[data-system]').length===3,'and the As written / Metric / Imperial switch');

// The stepper redraws the ingredients and nothing else: the comments stay drawn, and a
// half-written comment survives it.
const comments=get('#comments');
get('#commentText').value='half-written';
get('#servingsUp').click();get('#servingsUp').click();
check(ingredients().includes('Serves 4'),'the stepper moves');
check(ingredients().includes('4 cups flour')&&ingredients().includes('2 tbsp olive oil'),'amounts scale with it');
check(ingredients().includes('salt')&&!/\d\s*salt/.test(ingredients()),'an amount it cannot read passes through untouched');
check(ingredients().includes('Scaled from 2 · the saved recipe is unchanged'),'it says the recipe itself is unchanged');
check(document.querySelector('#comments')===comments&&comments.textContent==='A comment','the comment thread is not redrawn');
check(get('#commentText').value==='half-written','a half-written comment survives the stepper');
check(run('openRecipeCalls')===0,'the chef\'s own recipe screen is never drawn in its place');

get('[data-system="METRIC"]').click();
check(/\d+\s*ml flour/.test(ingredients()),'Metric converts the cups');
get('#servingsDown').click();
check(ingredients().includes('Serves 3'),'and the stepper still works after a unit switch');

// The shopping list gets the scaled amounts, and its Back returns to this recipe.
get('#addToShopping').click();
check(shoppingAdds.length===1&&shoppingAdds[0].id==='c1'&&Math.abs(shoppingAdds[0].factor-1.5)<1e-9,'Add to shopping list uses the servings on screen');
check(ingredients().includes('Added 2 items'),'the confirmation shows in place');
get('#viewShoppingList').click();
check(shoppingBacks.length===1,'View list opens the shopping list');
shoppingBacks[0]();
check(reopened.join()==='c1'&&run('overlayScreen')==='','Back from the list reopens the Community recipe');

// Opening another recipe starts it from its own servings, as written.
run(`renderCommunityIngredients({id:'c2',servings:6,ingredients:[{quantity:'1',unit:'cup',name:'rice'}]});`);
check(ingredients().includes('Serves 6')&&ingredients().includes('As the chef cooked it')&&ingredients().includes('1 cup rice'),'a different recipe starts as written');

console.log(`${checks} Recipe scaling DOM checks passed.`);
dom.window.close();
