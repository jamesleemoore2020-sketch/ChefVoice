import test from 'node:test';
import assert from 'node:assert/strict';
import { containsMeasurementEvidence, normalizeSpeechText, parseIngredient } from '../js/ingredient-parser.js';
import { parseCookingSession } from '../js/cooking-session-parser.js';

globalThis.crypto ??= (await import('node:crypto')).webcrypto;

const ing=(text)=>{const i=parseIngredient(text);return [i.quantity,i.unit,i.name]};
const session=(...texts)=>parseCookingSession(texts.map((text,i)=>({elapsedMs:i*1000,text}))).ingredients.map(i=>[i.quantity,i.unit,i.name]);

test('normalizes ASR teaspoon spelling',()=>assert.equal(normalizeSpeechText('two tea spoons salt'),'two teaspoon salt'));
test('normalizes number homophone before unit',()=>assert.equal(normalizeSpeechText('to teaspoons salt'),'2 teaspoon salt'));
test('measurement evidence survives normalized text',()=>assert.equal(containsMeasurementEvidence('to teaspoons salt'),true));
test('parses tablespoons',()=>assert.deepEqual(ing('two tablespoons olive oil'),['2','tbsp','Olive oil']));
test('parses half cup',()=>assert.deepEqual(ing('half a cup sugar'),['1/2','cup','Sugar']));
test('parses quarter cup',()=>assert.deepEqual(ing('quarter of a cup cream'),['1/4','cup','Cream']));
test('parses three quarters',()=>assert.deepEqual(ing('three quarters cup milk'),['3/4','cup','Milk']));
test('parses mixed fraction',()=>assert.deepEqual(ing('2 and a half cups flour'),['2 1/2','cup','Flour']));
test('parses unicode half',()=>assert.deepEqual(ing('½ teaspoon salt'),['1/2','tsp','Salt']));
test('joins recognition segments around ingredient',()=>assert.deepEqual(session('add two teaspoons','of salt'),[['2','tsp','Salt']]));
test('extracts unmeasured salt and pepper',()=>assert.deepEqual(session('add salt and pepper'),[['','','Salt'],['','','Pepper']]));
test('does not turn cook time into ingredient',()=>assert.deepEqual(session('cook 20 minutes'),[]));
test('does not turn temperature into ingredient',()=>assert.deepEqual(session('heat oven to 350 degrees'),[]));
test('extracts multiple measured ingredients',()=>assert.deepEqual(session('add two cloves garlic and one onion'),[['2','clove','Garlic'],['1','','Onion']]));
test('extracts conversational measured ingredient',()=>assert.deepEqual(session("we're going to add two teaspoons of salt"),[['2','tsp','Salt']]));
test('shared measure applies to each ingredient',()=>assert.deepEqual(session('add half a teaspoon each of salt and pepper'),[['1/2','tsp','Salt'],['1/2','tsp','Pepper']]));
test('correction changes the latest matching unit',()=>assert.deepEqual(session('add two cups flour actually make that three cups'),[['3','cup','Flour']]));
test('keeps diced preparation in ingredient name',()=>assert.deepEqual(session('add one diced onion'),[['1','','Diced onion']]));
test('three ingredient sentence is separated',()=>assert.deepEqual(session('add two cloves garlic, one diced onion, and a tablespoon olive oil'),[['2','clove','Garlic'],['1','','Diced onion'],['1','tbsp','Olive oil']]));
test('captures method steps while ingredients remain separate',()=>{const d=parseCookingSession([{text:'add two tablespoons olive oil then sauté the garlic'}]);assert.equal(d.ingredients[0].name,'Olive oil');assert.ok(d.steps.some(s=>/sauté/i.test(s)));});

// ---- Recipe title -----------------------------------------------------------
test('extracts title from "today I\'m making X"',()=>assert.equal(parseCookingSession([{text:"today I'm making my famous chili"}]).title,"My famous chili"));
test('extracts title from "this is my recipe for X"',()=>assert.equal(parseCookingSession([{text:'we took one pound of beef'},{text:'this is my recipe for spicy chili'}]).title,'Spicy chili'));
test('extracts title from "this recipe is X"',()=>assert.equal(parseCookingSession([{text:"this recipe is grandma's meatloaf"}]).title,"Grandma's meatloaf"));
test('does not mistake a bare imperative "make X" for a title',()=>assert.equal(parseCookingSession([{text:'take one pound of ground beef'},{text:'make four burger patties'}]).title,''));
test('does not mistake a later "we\'re going to cook X" for a title',()=>assert.equal(parseCookingSession([
  {text:'we took one pound of ground beef'},{text:'we chopped some onions'},{text:'we mixed the onions with the beef'},
  {text:"we're going to cook the beef now"}
]).title,''));
test('no announcement leaves title empty',()=>assert.equal(parseCookingSession([{text:'add two cups flour'}]).title,''));
test('title does not swallow the next instruction in the same segment',()=>assert.equal(parseCookingSession([{text:"today I'm making chili and we're going to start with the veggies"}]).title,'Chili'));

// ---- Prep/cook time estimate -------------------------------------------------
test('estimates prep and cook minutes from chop/cook verbs with stated durations',()=>{
  const d=parseCookingSession(['we going to chop up our veggies thats going to be 5 mins','we going to cook our ground beef for 10 mins','than stir and cook for another 10 mins and serve'].map((text,i)=>({elapsedMs:i*3000,text})));
  assert.equal(d.prepMinutes,5);
  assert.equal(d.cookMinutes,20);
});
test('a step naming no duration leaves both times unknown',()=>{
  const d=parseCookingSession([{text:'chop the onions'},{text:'cook the beef'}]);
  assert.equal(d.prepMinutes,null);
  assert.equal(d.cookMinutes,null);
});
test('converts an hour duration to minutes',()=>assert.equal(parseCookingSession([{text:'simmer for one hour'}]).cookMinutes,60));
test('a spoken "prep time"/"cook time" statement is taken directly and never becomes a step',()=>{
  const d=parseCookingSession([{text:'prep time five minutes'},{text:'cook time twenty minutes'}]);
  assert.equal(d.prepMinutes,5);
  assert.equal(d.cookMinutes,20);
  assert.deepEqual(d.steps,[]);
});
test('a stated cook time overrides the inferred verb-based estimate',()=>{
  const d=parseCookingSession([{text:'cook time five minutes'},{text:'cook the beef for twenty minutes'}]);
  assert.equal(d.cookMinutes,5);
});

// ---- Real bugs from a live chili capture (see PWA_PREP_COOK_TITLE_ESTIMATE writeup) ---
test('a bare cut-state modifier split from its noun is not its own ingredient',()=>{
  const d=parseCookingSession([{text:'we need one pound of ground'},{text:'beef'}]);
  assert.deepEqual(d.ingredients.map(i=>[i.quantity,i.unit,i.name]),[['1','lb','Ground beef']]);
});
test('a bare "or" left dangling by a segment break is not its own ingredient',()=>{
  const d=parseCookingSession([{text:'we need one teaspoon of salt or'},{text:'pepper'}]);
  assert.ok(!d.ingredients.some(i=>i.name.toLowerCase()==='or'));
});
test('a run-on into the next sentence is trimmed off an ingredient name',()=>{
  const d=parseCookingSession([{text:'we need one teaspoon of salt or'},{text:"pepper and you're going to let it cook"}]);
  assert.ok(!d.ingredients.some(i=>/going to let it/i.test(i.name)),`got: ${JSON.stringify(d.ingredients)}`);
});
