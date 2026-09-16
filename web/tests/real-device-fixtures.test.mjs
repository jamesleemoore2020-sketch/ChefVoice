import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookingSession } from '../js/cooking-session-parser.js';

globalThis.crypto ??= (await import('node:crypto')).webcrypto;

// Ported from GoldenCookingCorpusTest.kt. These assert things the golden corpus
// can't express -- exact step ordering, and that a step must NOT contain
// certain text -- so they're a stronger parity check than the corpus alone.

test('real burger fixture preserves temperature/durations and chronological method order', () => {
  const text = "Okay, so today we're making hamburgers. We're going to take a pound of ground beef and you're going to make four different burger patties. " +
    "Split them all evenly, shape them well, and pat them down. Then we're going to take 2 tsp of salt and we're going to take 1 tsp of pepper. " +
    "Then take 1 tsp of garlic and 1 tsp of lemon pepper. And you're going to season your ground beef patties. " +
    "After you season your ground beef patties on both sides, then you're going to throw them on the oven at 375°. " +
    "You let it sit and cook for 20 minutes, flipping it in between. And when it's done, you let it sit and settle for 5 minutes and it's ready to eat.";

  const draft = parseCookingSession([{ elapsedMs: 0, text }]);

  assert.deepEqual(
    draft.ingredients.map((i) => [i.quantity, i.unit, i.name]),
    [
      ['1', 'lb', 'Ground beef'],
      ['2', 'tsp', 'Salt'],
      ['1', 'tsp', 'Pepper'],
      ['1', 'tsp', 'Garlic'],
      ['1', 'tsp', 'Lemon pepper']
    ]
  );
  assert.ok(draft.ingredients.every((i) => !`${i.quantity} ${i.unit} ${i.name}`.includes('375') && !i.name.includes('°')));
  assert.equal(draft.title, 'Hamburgers');
  assert.equal(draft.cookMinutes, 20);
  assert.equal(draft.prepMinutes, null);

  const expected = [
    'make four different burger patties',
    'split them all evenly',
    'shape them well',
    'pat them down',
    'season your ground beef patties',
    'throw them on the oven at 375°',
    'cook for 20 minutes',
    'you let it sit and settle for 5 minutes'
  ];
  let cursor = -1;
  for (const fragment of expected) {
    const next = draft.steps.findIndex((step, index) => index > cursor && step.toLowerCase().includes(fragment.toLowerCase()));
    assert.ok(next > cursor, `Expected chronological step fragment '${fragment}' after index ${cursor}; got ${JSON.stringify(draft.steps)}`);
    cursor = next;
  }
});

test('real timestamped burger capture keeps method boundaries and normalizes temperature preposition', () => {
  const segments = [
    { elapsedMs: 5000, text: 'Take one pound of ground beef' },
    { elapsedMs: 8000, text: 'Make four burger patties' },
    { elapsedMs: 12000, text: 'Split them evenly shape them' },
    { elapsedMs: 14000, text: 'Pat them down' },
    { elapsedMs: 17000, text: 'Season both sides' },
    { elapsedMs: 20000, text: 'With two teaspoon of salt' },
    { elapsedMs: 23000, text: 'One teaspoon of pepper' },
    { elapsedMs: 25000, text: 'One teaspoon of garlic' },
    { elapsedMs: 28000, text: 'And one teaspoon of lemon pepper' },
    { elapsedMs: 36000, text: 'Cook them for 375 degrees for 20 minutes' },
    { elapsedMs: 39000, text: 'Foot them in between' },
    { elapsedMs: 43000, text: 'Let them rest with five we feel serving' }
  ];

  const draft = parseCookingSession(segments);

  assert.deepEqual(
    draft.ingredients.map((i) => [i.quantity, i.unit, i.name]),
    [
      ['1', 'lb', 'Ground beef'],
      ['2', 'tsp', 'Salt'],
      ['1', 'tsp', 'Pepper'],
      ['1', 'tsp', 'Garlic'],
      ['1', 'tsp', 'Lemon pepper']
    ]
  );
  assert.deepEqual(draft.steps, [
    'Make four burger patties.',
    'Split them evenly.',
    'Shape them.',
    'Pat them down.',
    'Season both sides with two teaspoon of salt one teaspoon of pepper one teaspoon of garlic and one teaspoon of lemon pepper.',
    'Cook them at 375 degrees for 20 minutes.',
    'Foot them in between.',
    'Let them rest with five we feel serving.'
  ]);
  assert.ok(!draft.steps.some((s) => /20 minutes.*(?:foot|rest)|foot.*rest/i.test(s)));
  assert.equal(draft.title, '', 'no opening announcement in this fixture -- must not invent one from "Make four burger patties"');
  assert.equal(draft.cookMinutes, 20);
});

test('real intra-segment burger capture splits unknown predicates and trims ingredient narration tail', () => {
  const segments = [
    { elapsedMs: 14000, text: 'Say one pound of ground beef and make four burger patties split them evenly shape them and pet them down see them both sides with two tablespoon of salt' },
    { elapsedMs: 16000, text: 'One tablespoon of pepper' },
    { elapsedMs: 21000, text: 'Two tablespoon of garlic I want a tablespoon of lemon pepper' },
    { elapsedMs: 26000, text: 'Cook them at 375 degrees for 20 minutes' },
    { elapsedMs: 28000, text: 'In between' },
    { elapsedMs: 31000, text: 'Let them rest for five minutes before serving' }
  ];

  const draft = parseCookingSession(segments);

  assert.deepEqual(
    draft.ingredients.map((i) => [i.quantity, i.unit, i.name]),
    [
      ['1', 'lb', 'Ground beef'],
      ['2', 'tbsp', 'Salt'],
      ['1', 'tbsp', 'Pepper'],
      ['2', 'tbsp', 'Garlic'],
      ['1', 'tbsp', 'Lemon pepper']
    ]
  );
  assert.deepEqual(draft.steps, [
    'Make four burger patties.',
    'Split them evenly.',
    'Shape them.',
    'Pet them down.',
    'See them both sides with two tablespoon of salt.',
    'Cook them at 375 degrees for 20 minutes.',
    'In between.',
    'Let them rest for five minutes before serving.'
  ]);
  assert.ok(!draft.ingredients.some((i) => i.name.toLowerCase().includes('i want')));
  assert.ok(!draft.steps.some((s) => s.toLowerCase().includes('pat them') || s.toLowerCase().includes('season both')));
});

test('real duration continuation attaches and ingredient artifacts are rejected', () => {
  const segments = [
    { elapsedMs: 12000, text: 'It took and make four burger patties split them evenly shaped them' },
    { elapsedMs: 17000, text: 'Impact them down season both sides with two teaspoon of salt' },
    { elapsedMs: 20000, text: 'One teaspoon of pepper' },
    { elapsedMs: 22000, text: 'One teaspoon of garlic' },
    { elapsedMs: 25000, text: 'And one tablespoon of lemon pepper' },
    { elapsedMs: 31000, text: 'Cook them for 350 cook them at 375 degrees' },
    { elapsedMs: 33000, text: 'For 20 minutes' },
    { elapsedMs: 35000, text: 'Flipped in between' },
    { elapsedMs: 39000, text: 'Let them rest for five minutes before serving' }
  ];
  const draft = parseCookingSession(segments);
  assert.ok(draft.steps.includes('Cook them for 350.'));
  assert.ok(draft.steps.includes('Cook them at 375 degrees for 20 minutes.'));
  assert.ok(!draft.steps.some((s) => /^for 20 minutes/i.test(s)));

  const grab = parseCookingSession([{ elapsedMs: 4000, text: 'Take one grab' }]);
  assert.equal(grab.ingredients.length, 0);

  const beef = parseCookingSession([
    { elapsedMs: 6000, text: 'Take one pound of ground beef it took' },
    { elapsedMs: 9000, text: 'One pound of ground beef' }
  ]);
  assert.deepEqual(beef.ingredients.map((i) => [i.quantity, i.unit, i.name]), [['1', 'lb', 'Ground beef']]);
});

// Real Android capture, 0909. Three ingredients declared as "you're going to
// need some X" were being lost entirely. The second half is the regression
// guard: a declaration segment must not be swallowed into the preceding
// method step ("sprinkle" arms the ingredient-continuation branch).
test('real nachos fixture keeps ingredient declarations out of method steps', () => {
  const texts = [
    "Okay, today we're going to make some nachos",
    'One pack should feed at least two people, maybe three',
    "Then you're going to need 1 lb of ground beef",
    'Mix in 1 tsp of salt and pepper, 1 tsp of lemon pepper',
    'Then you take your ground beef and you sprinkle it on top of your nachos',
    "Then you're going to need some sour cream",
    "You're going to need some hot sauce",
    "You're going to need some jalapenos",
    "And it's ready to serve and eat"
  ];
  const segments = texts.map((text, index) => ({ elapsedMs: index * 3000, text }));
  const draft = parseCookingSession(segments);

  assert.deepEqual(
    draft.ingredients.map((i) => [i.quantity, i.unit, i.name]),
    [
      ['1', 'lb', 'Ground beef'],
      ['1', 'tsp', 'Salt and pepper'],
      ['1', 'tsp', 'Lemon pepper'],
      ['', '', 'Sour cream'],
      ['', '', 'Hot sauce'],
      ['', '', 'Jalapenos']
    ]
  );
  assert.ok(draft.steps.includes('Sprinkle it on top of your nachos.'), `sprinkle step should stand alone, got: ${JSON.stringify(draft.steps)}`);
  assert.ok(!draft.steps.some((s) => s.toLowerCase().includes('need some')), `no method step may absorb an ingredient declaration, got: ${JSON.stringify(draft.steps)}`);
  assert.equal(draft.title, 'Nachos', 'title announcement is split across segments 0 and 1 by ASR -- must not run on into "One pack should feed..."');
});
