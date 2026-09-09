import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMethodSuggestion, applySuggestion, buildMethodReview, buildReview, fromCloudTranscript
} from '../js/second-pass-reviewer.js';

globalThis.crypto ??= (await import('node:crypto')).webcrypto;

// Ported one-for-one from SecondPassReviewerTest.kt. This is the cross-platform
// contract for Second Pass, the same role shared/golden-cooking-corpus.tsv plays
// for the parser: both clients must review a transcript identically.

const ing = (quantity = '', unit = '', name = '') => ({ id: '', quantity, unit, name });
const triples = (items) => items.map((i) => [i.quantity, i.unit, i.name]);

test('real device second pass cleans legacy live artifacts without silent rewrite', () => {
  const live = [
    ing('1', 'cup', 'Chicken broth gonna'),
    ing('2', 'tbsp', 'Salt'),
    ing('2', 'tbsp', 'Pepper You gonna'),
    ing('1', 'cup', 'Full of chicken stock'),
    ing('', '', 'Add')
  ];
  const transcript = "All right, so you're going to add 1 cup of chicken broth. " +
    "You're going to add 2 tbsp of salt and pepper. " +
    "You're going to add 1 cupful of chicken stock.";

  const result = fromCloudTranscript({ liveIngredients: live, transcript, rawSegments: [transcript] });

  assert.deepEqual(triples(result.ingredients), [
    ['1', 'cup', 'Chicken broth'],
    ['2', 'tbsp', 'Salt'],
    ['2', 'tbsp', 'Pepper'],
    ['1', 'cup', 'Chicken stock']
  ]);
  assert.equal(result.issues.filter((i) => i.type === 'ingredient-name-cleanup').length, 3);
  assert.ok(!result.issues.some((i) => i.type === 'possible-missed-ingredient'));
  assert.ok(!result.issues.some((i) => i.detail.toLowerCase().includes('heard add')));

  // Review remains explicit. Nothing changes until "Use second pass" is chosen.
  assert.equal(live[0].name, 'Chicken broth gonna');
  const firstCleanup = result.issues.find((i) => i.type === 'ingredient-name-cleanup');
  const accepted = applySuggestion(live, firstCleanup);
  assert.equal(accepted[firstCleanup.liveIndex].name, 'Chicken broth');
});

test('quantity disagreement is review-only until accepted', () => {
  const live = [ing('1', 'cup', 'Chicken stock')];
  const second = [ing('2', 'cup', 'Chicken stock')];

  const review = buildReview(live, second);
  assert.equal(review.issues.length, 1);
  const issue = review.issues[0];

  assert.equal(issue.type, 'quantity-change');
  assert.equal(live[0].quantity, '1');
  assert.equal(applySuggestion(live, issue)[0].quantity, '2');
});

test('strong second-pass-only ingredient is offered as possible miss', () => {
  const review = buildReview(
    [ing('1', 'cup', 'Chicken broth')],
    [ing('1', 'cup', 'Chicken broth'), ing('1', 'tsp', 'Cumin')]
  );
  assert.ok(review.issues.some((i) => i.type === 'possible-missed-ingredient' && i.suggested?.name === 'Cumin'));
});

test('screenshot narration produces five clean second pass ingredients', () => {
  const transcript = 'So today we going to make some Chef Boyardee. ' +
    'So what you need to do is take 2 tbsp of paprika, 3 tbsp of wood fired garlic, oh shit we did have garlic. ' +
    'Um, 2 tbsp of pepper and 1 tbsp spoon of salt. ' +
    'And then you need to mix this with 1 lb of ground beef. ' +
    'Mix it thoroughly, frying the ground beef out. ' +
    'And then you cook the ground beef as if it was a burger patty. ' +
    'You cook the ground beef for about 20 minutes making sure you flip it about 10 minutes in. ' +
    "After that you let it rest for about 5 minutes and it's ready to go.";

  const result = fromCloudTranscript({ liveIngredients: [], transcript, rawSegments: [transcript] });

  assert.deepEqual(triples(result.ingredients), [
    ['2', 'tbsp', 'Paprika'],
    ['3', 'tbsp', 'Wood fired garlic'],
    ['2', 'tbsp', 'Pepper'],
    ['1', 'tbsp', 'Salt'],
    ['1', 'lb', 'Ground beef']
  ]);
});

test('obvious old live parser garbage gets explicit remove-artifact action', () => {
  const live = [
    ing('2', 'tbsp', 'Paprika'),
    ing('3', 'tbsp', 'Wood fired garlic'),
    ing('3', 'tbsp', 'Wood fired garlic oh shit we did have fun um'),
    ing('1', 'tbsp', 'Of'),
    ing('', '', "Today we're gonna make some So what you need to do"),
    ing('5', '', "Minutes and it's ready to go")
  ];
  const second = [ing('2', 'tbsp', 'Paprika'), ing('3', 'tbsp', 'Wood fired garlic')];

  const review = buildReview(live, second);
  const artifacts = review.issues.filter((i) => i.type === 'remove-live-artifact');
  assert.ok(artifacts.length >= 4, `expected >= 4 artifacts, got ${artifacts.length}`);

  const cleaned = applySuggestion(live, artifacts[0]);
  assert.equal(cleaned.length, live.length - 1);
});

test('exact duplicate live artifact below confidence gate is still offered for removal', () => {
  const live = [ing('2', '', 'So'), ing('2', '', 'So')];
  const second = [ing('2', '', 'So')];

  const review = buildReview(live, second);
  assert.equal(review.issues.length, 1);
  const artifact = review.issues[0];
  assert.equal(artifact.type, 'remove-live-artifact');
  assert.equal(artifact.liveIndex, 1);
  assert.equal(applySuggestion(live, artifact).length, live.length - 1);
});

test('accepting possible missed ingredient twice does not duplicate', () => {
  const live = [ing('1', 'cup', 'Chicken broth')];
  const second = [ing('1', 'cup', 'Chicken broth'), ing('1', 'tsp', 'Cumin')];
  const issue = buildReview(live, second).issues.find((i) => i.type === 'possible-missed-ingredient');

  const onceAccepted = applySuggestion(live, issue);
  assert.equal(onceAccepted.length, 2);
  const acceptedAgain = applySuggestion(onceAccepted, issue);
  assert.equal(acceptedAgain.length, 2);
});

test('accepting possible missed step twice does not duplicate', () => {
  const live = ['Brown the ground beef.'];
  const second = ['Brown the ground beef.', 'Let it rest for 5 minutes.'];
  const issue = buildMethodReview(live, second).issues.find((i) => i.type === 'possible-missed-step');

  const onceAccepted = applyMethodSuggestion(live, issue);
  assert.equal(onceAccepted.length, 2);
  const acceptedAgain = applyMethodSuggestion(onceAccepted, issue);
  assert.equal(acceptedAgain.length, 2);
});

test('matching method step is confirmed without rewrite', () => {
  const live = ['Mix the ground beef thoroughly.'];
  const second = ['Mix ground beef thoroughly.'];

  const review = buildMethodReview(live, second);
  assert.equal(review.confirmedCount, 1);
  assert.equal(review.issues.length, 0);
  assert.equal(live[0], 'Mix the ground beef thoroughly.');
});

test('second-pass-only method step is an explicit possible miss', () => {
  const live = ['Brown the ground beef.'];
  const second = ['Brown the ground beef.', 'Let it rest for 5 minutes.'];

  const issue = buildMethodReview(live, second).issues.find((i) => i.type === 'possible-missed-step');
  assert.equal(issue.suggestedStep, 'Let it rest for 5 minutes.');
  assert.equal(live.length, 1);
  assert.deepEqual(applyMethodSuggestion(live, issue), ['Brown the ground beef.', 'Let it rest for 5 minutes.']);
});

test('materially different method wording requires review before replacement', () => {
  const live = ['Cook ground beef for 20 minutes.'];
  const second = ['Cook ground beef for 20 minutes, flipping halfway.'];

  const review = buildMethodReview(live, second);
  assert.equal(review.issues.length, 1);
  const issue = review.issues[0];
  assert.equal(issue.type, 'method-wording-disagreement');
  assert.equal(live[0], 'Cook ground beef for 20 minutes.');
  assert.equal(applyMethodSuggestion(live, issue)[0], 'Cook ground beef for 20 minutes, flipping halfway.');
});

test('live-only method step is surfaced without a delete action', () => {
  const review = buildMethodReview(['Season with salt.'], []);
  assert.equal(review.issues.length, 1);
  const issue = review.issues[0];
  assert.equal(issue.type, 'live-only-step');
  assert.equal(issue.suggestedStep, null);
  assert.deepEqual(applyMethodSuggestion(['Season with salt.'], issue), ['Season with salt.']);
});

test('expanded second pass method detail pairs as a wording review', () => {
  const review = buildMethodReview(
    ['Cook the ground beef for 20 minutes.'],
    ['Cook the ground beef for 20 minutes making sure you flip it about 10 minutes in.']
  );
  assert.equal(review.issues.length, 1);
  assert.equal(review.issues[0].type, 'method-wording-disagreement');
});

test('real device "actually" method correction offers only the corrected step', () => {
  const live = ['Add chicken to the pan.', 'Cook for 10 minutes Actually Cooked for 20 minutes the flip halfway.'];
  const second = ['Add chicken to the pan.', 'Cook for 10 minutes.', 'Cook for 20 minutes and flip halfway.'];

  const review = buildMethodReview(live, second);

  assert.equal(review.confirmedCount, 1);
  assert.equal(review.issues.length, 1);
  const issue = review.issues[0];
  assert.equal(issue.type, 'method-wording-disagreement');
  assert.equal(issue.title, 'Check corrected method');
  assert.equal(issue.liveIndex, 1);
  assert.equal(issue.secondIndex, 2);
  assert.equal(issue.suggestedStep, 'Cook for 20 minutes and flip halfway.');
  assert.ok(!review.issues.some((i) => i.type === 'possible-missed-step'));
  assert.deepEqual(applyMethodSuggestion(live, issue), ['Add chicken to the pan.', 'Cook for 20 minutes and flip halfway.']);
});

test('accepted real device method correction does not resurrect the superseded step', () => {
  const transcript = 'Add chicken to the pan and cook for 10 minutes. Actually, cook for 20 minutes and flip halfway.';
  const live = ['Add chicken to the pan.', 'Cook for 10 minutes Actually Cooked for 20 minutes the flip halfway.'];
  const second = ['Add chicken to the pan.', 'Cook for 10 minutes.', 'Cook for 20 minutes and flip halfway.'];

  const initial = buildMethodReview(live, second, transcript);
  assert.equal(initial.issues.length, 1);
  const accepted = applyMethodSuggestion(live, initial.issues[0]);
  assert.deepEqual(accepted, ['Add chicken to the pan.', 'Cook for 20 minutes and flip halfway.']);

  const rebuilt = buildMethodReview(accepted, second, transcript);
  assert.equal(rebuilt.confirmedCount, 2);
  assert.equal(rebuilt.issues.length, 0);
});

test('rerun after an accepted method correction stays clean', () => {
  const transcript = 'Add chicken to the pan and cook for 10 minutes. Actually, cook for 20 minutes and flip halfway.';
  const acceptedLive = ['Add chicken to the pan.', 'Cook for 20 minutes and flip halfway.'];
  const second = ['Add chicken to the pan.', 'Cook for 10 minutes.', 'Cook for 20 minutes and flip halfway.'];

  const rerun = buildMethodReview(acceptedLive, second, transcript);
  assert.equal(rerun.confirmedCount, 2);
  assert.equal(rerun.issues.length, 0);
});

test('a temperature fact is never offered as a possible ingredient', () => {
  const review = buildReview([], [ing('', '', '375°')]);
  assert.equal(review.issues.length, 0);
  assert.equal(review.confirmedCount, 0);
});

test('real device 0912 aligns composite second pass method to neighbouring live steps', () => {
  const live = [
    'Make four burger patties.',
    'Split them evenly.',
    'Shake them.',
    'Pat them down.',
    'Season both sides with two tablespoon of salt one tablespoon of pepper one tablespoon of garlic one tablespoon of lemon pepper.',
    'Cook them at 375 degrees for 20 minutes.',
    'In between.',
    'Let them rest for five minutes before serving.'
  ];
  const second = [
    'Make four burger patties.',
    'Split them evenly.',
    'Shape them, and pack them down.',
    'Season both sides with 2 tbsp of salt, 1 tbsp of pepper, 1 tbsp of garlic, and 1 tbsp of lemon pepper.',
    'Cook them at 375 degrees for 20 minutes.',
    'Flip them in between.',
    'Let them rest for 5 minutes before serving.'
  ];

  const review = buildMethodReview(live, second);

  assert.ok(!review.issues.some((i) => i.type === 'live-only-step' && i.liveIndex === 2));
  const shape = review.issues.filter((i) => i.liveIndex === 2);
  assert.equal(shape.length, 1);
  assert.equal(shape[0].type, 'method-wording-disagreement');
  assert.equal(shape[0].suggestedStep, 'Shape them.');
  const pack = review.issues.filter((i) => i.liveIndex === 3);
  assert.equal(pack.length, 1);
  assert.equal(pack[0].suggestedStep, 'Pack them down.');
  assert.ok(!review.issues.some((i) => (i.suggestedStep || '').toLowerCase().includes('let them rest')));
  assert.ok(!review.issues.some((i) => (i.suggestedStep || '').toLowerCase().includes('season both sides')));
  const flip = review.issues.filter((i) => i.liveIndex === 6);
  assert.equal(flip.length, 1);
  assert.equal(flip[0].suggestedStep, 'Flip them in between.');
});

test('accepted 0912 neighbouring method corrections rebuild cleanly', () => {
  const second = [
    'Make four burger patties.',
    'Split them evenly.',
    'Shape them, and pack them down.',
    'Season both sides with 2 tbsp of salt, 1 tbsp of pepper, 1 tbsp of garlic, and 1 tbsp of lemon pepper.',
    'Cook them at 375 degrees for 20 minutes.',
    'Flip them in between.',
    'Let them rest for 5 minutes before serving.'
  ];
  let live = [
    'Make four burger patties.',
    'Split them evenly.',
    'Shake them.',
    'Pat them down.',
    'Season both sides with two tablespoon of salt one tablespoon of pepper one tablespoon of garlic one tablespoon of lemon pepper.',
    'Cook them at 375 degrees for 20 minutes.',
    'In between.',
    'Let them rest for five minutes before serving.'
  ];
  const initial = buildMethodReview(live, second);
  for (const liveIndex of [2, 3, 6]) {
    const matching = initial.issues.filter((i) => i.liveIndex === liveIndex);
    assert.equal(matching.length, 1, `expected one issue for live index ${liveIndex}`);
    live = applyMethodSuggestion(live, matching[0]);
  }
  const rebuilt = buildMethodReview(live, second);
  assert.equal(rebuilt.confirmedCount, 8);
  assert.equal(rebuilt.issues.length, 0);
});
