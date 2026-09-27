import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Everything app.js imports statically must load before the app draws anything, and must
// load with no network. firebase-client.js fetches the Firebase SDK from gstatic with a
// top-level await; while the Live controllers imported it statically, a phone with no
// signal or a blocked CDN got a blank app -- local cooking capture included.

const read = (file) => readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');

// `import x from './y.js'`, `import {a,\n b} from './y.js'`, `import './y.js'` and
// `export {a} from './y.js'`. A dynamic import('./y.js') is deliberately not matched.
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?['"](\.\/[^'"]+)['"]/g;

function staticGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of read(file).matchAll(STATIC_IMPORT)) queue.push(match[1].slice(2));
  }
  return seen;
}

test('app.js reaches none of the Firebase SDK through its static imports', () => {
  const graph = staticGraph('app.js');
  // Sanity: the walk really follows imports.
  assert.ok(graph.has('cooking-session-parser.js'));
  assert.ok(graph.has('ingredient-parser.js'));
  assert.ok(!graph.has('firebase-client.js'),
    'a static import from app.js reaches firebase-client.js, so the app cannot start without the Firebase CDN');
  for (const file of graph) {
    assert.doesNotMatch(read(file), /^(?:const|let|var)\s[^\n]*=\s*await\b/m,
      `${file} has a top-level await, which would hold app.js's start-up on it`);
  }
});

test('the Live controllers are loaded when a Live opens, not at start-up', () => {
  const app = read('app.js');
  assert.match(app, /import\('\.\/webrtc-live-viewer\.js'\)/);
  assert.match(app, /import\('\.\/webrtc-live-host\.js'\)/);
  assert.doesNotMatch(app, /from '\.\/webrtc-live-(viewer|host)\.js'/);
});
