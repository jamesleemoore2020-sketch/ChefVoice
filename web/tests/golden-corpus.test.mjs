import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCookingSession } from '../js/cooking-session-parser.js';

globalThis.crypto ??= (await import('node:crypto')).webcrypto;

// Ported from GoldenCookingCorpusTest.kt. shared/golden-cooking-corpus.tsv is
// the cross-platform regression contract (see shared/README.md): both the PWA
// and the native Android parser must produce the same structured ingredients
// and required method-step fragments for every row.

function corpusPath() {
  return new URL('../../shared/golden-cooking-corpus.tsv', import.meta.url);
}

function expectedIngredients(column) {
  if (column === '-') return [];
  return column.split(' ;; ').map((row) => row.split('^'));
}

test('shared golden cooking corpus passes on the PWA parser', () => {
  const rows = readFileSync(corpusPath(), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'));

  const failures = [];

  for (const line of rows) {
    const columns = line.split('\t');
    assert.ok(columns.length >= 5, `Malformed golden corpus row: ${line}`);
    const [id, , segmentsColumn, ingredientsColumn, stepsColumn] = columns;

    const segments = segmentsColumn.split(' || ').map((text, index) => ({ elapsedMs: index * 1000, text }));
    const expected = expectedIngredients(ingredientsColumn);
    const expectedStepFragments = stepsColumn === '-' ? [] : stepsColumn.split(' ;; ');

    const draft = parseCookingSession(segments);
    const actual = draft.ingredients.map((i) => [i.quantity, i.unit, i.name]);
    const missingSteps = expectedStepFragments.filter(
      (fragment) => !draft.steps.some((step) => step.toLowerCase().includes(fragment.toLowerCase()))
    );

    const ingredientsMatch = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ingredientsMatch || missingSteps.length) {
      let message = `[${id}] expected ingredients=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`;
      if (missingSteps.length) message += ` missing step fragments=${JSON.stringify(missingSteps)} actual steps=${JSON.stringify(draft.steps)}`;
      failures.push(message);
    }
  }

  // Golden corpus row count changed unexpectedly -- keep in sync with
  // GoldenCookingCorpusTest.kt's row-count guard on the Android side.
  assert.equal(rows.length, 59, 'Golden corpus row count changed unexpectedly');
  assert.equal(failures.length, 0, `PWA golden corpus failures:\n${failures.join('\n')}`);
});
