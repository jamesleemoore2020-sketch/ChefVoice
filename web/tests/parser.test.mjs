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
