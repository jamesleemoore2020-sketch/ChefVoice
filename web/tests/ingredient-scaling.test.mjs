import test from 'node:test';
import assert from 'node:assert/strict';
import { scale, convert, servingFactor, parseQuantity, formatQuantity, MeasurementSystem as S } from '../js/ingredient-scaling.js';

// Port of IngredientScalingTest.kt. Scaling is a VIEW: it may never lose an ingredient or
// invent a number for one it cannot read.

const ing = (quantity, unit = '', name = 'flour') => ({ quantity, unit, name });
const near = (actual, expected, tol) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} vs ${expected}`);

test('doubling doubles a whole number', () => assert.equal(scale([ing('2', 'cups')], 2)[0].quantity, '4'));
test('halving produces a kitchen fraction, not a decimal', () => {
  assert.equal(scale([ing('1', 'cup')], 0.5)[0].quantity, '1/2');
  assert.equal(scale([ing('3', 'cups')], 0.5)[0].quantity, '1 1/2');
});
test('scales quantities written as fractions', () => {
  assert.equal(scale([ing('1/2', 'cup')], 2)[0].quantity, '1');
  assert.equal(scale([ing('1 1/2', 'cups')], 2)[0].quantity, '3');
  assert.equal(scale([ing('½', 'cup')], 2)[0].quantity, '1');
});
test('an unreadable quantity passes through untouched', () => {
  const out = scale([ing('a pinch', '', 'salt')], 2);
  assert.equal(out[0].quantity, 'a pinch');
  assert.equal(out[0].name, 'salt');
});
test('an ingredient with no quantity survives', () => {
  const out = scale([ing('', '', 'black pepper')], 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, '');
});
test('scaling never drops a line', () => {
  const list = [ing('2', 'cups'), ing('a pinch', '', 'salt'), ing('', '', 'pepper')];
  assert.equal(scale(list, 2.5).length, list.length);
});
test('a factor of one returns the same list', () => {
  const list = [ing('1/3', 'cup')];
  assert.equal(scale(list, 1), list);
});
test('servingFactor is target over base', () => {
  assert.equal(servingFactor(2, 4), 2);
  assert.equal(servingFactor(4, 2), 0.5);
  assert.equal(servingFactor(0, 4), 1);
  assert.equal(servingFactor(2, 0), 1);
});
test('converts volume and weight within a system', () => {
  const metric = convert([ing('1', 'cup')], S.METRIC)[0];
  assert.equal(metric.unit, 'ml');
  near(parseQuantity(metric.quantity), 236.588, 1);
  const imperial = convert([ing('113', 'g')], S.IMPERIAL)[0];
  assert.equal(imperial.unit, 'oz');
  near(parseQuantity(imperial.quantity), 4, 0.05);
});
test('steps up to the larger unit once the amount deserves one', () => {
  const pound = convert([ing('454', 'g')], S.IMPERIAL)[0];
  assert.equal(pound.unit, 'lb');
  near(parseQuantity(pound.quantity), 1, 0.02);
  const litre = convert([ing('5', 'cups')], S.METRIC)[0];
  assert.equal(litre.unit, 'l');
  near(parseQuantity(litre.quantity), 1.18, 0.02);
  const kilo = convert([ing('3', 'lb')], S.METRIC)[0];
  assert.equal(kilo.unit, 'kg');
  near(parseQuantity(kilo.quantity), 1.36, 0.02);
});
test('staying below the threshold keeps the smaller unit', () => {
  const grams = convert([ing('1', 'lb')], S.METRIC)[0];
  assert.equal(grams.unit, 'g');
  near(parseQuantity(grams.quantity), 453.592, 1);
});
test('never converts volume into weight', () => assert.equal(convert([ing('1', 'cup', 'honey')], S.METRIC)[0].unit, 'ml'));
test('an unknown unit is left exactly as written', () => {
  const out = convert([ing('2', 'handfuls', 'spinach')], S.METRIC)[0];
  assert.equal(out.unit, 'handfuls');
  assert.equal(out.quantity, '2');
});
test('as-written changes nothing', () => {
  const list = [ing('1', 'cup')];
  assert.equal(convert(list, S.AS_WRITTEN), list);
});
test('parseQuantity reads what chefs write and refuses the rest', () => {
  assert.equal(parseQuantity('2'), 2);
  assert.equal(parseQuantity('1.5'), 1.5);
  assert.equal(parseQuantity('1/2'), 0.5);
  assert.equal(parseQuantity('1 1/2'), 1.5);
  assert.equal(parseQuantity('¾'), 0.75);
  assert.equal(parseQuantity('two'), 2);
  assert.equal(parseQuantity('a pinch'), null);
  assert.equal(parseQuantity('to taste'), null);
  assert.equal(parseQuantity(''), null);
  assert.equal(parseQuantity('2 or so'), null);
});
test('formatQuantity writes numbers the way a cook would read them', () => {
  assert.equal(formatQuantity(2), '2');
  assert.equal(formatQuantity(0.5), '1/2');
  assert.equal(formatQuantity(1.25), '1 1/4');
  assert.equal(formatQuantity(1 / 3), '1/3');
  assert.equal(formatQuantity(236.588), '237');
  assert.equal(formatQuantity(0), '');
});
