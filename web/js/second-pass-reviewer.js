import { canonicalizeIngredients, parseCookingSession } from './cooking-session-parser.js';
import { containsMeasurementEvidence, parseIngredient } from './ingredient-parser.js';

// Ported from app/src/main/java/com/chefvoice/app/voice/SecondPassReviewer.kt and
// IngredientReviewClassifier.kt, verified against the same fixtures as
// SecondPassReviewerTest.kt (see tests/second-pass-reviewer.test.mjs).
//
// Second Pass is explicit, opt-in review -- never automatic correction. Nothing
// here rewrites a saved recipe: buildReview/buildMethodReview only describe
// differences, and applySuggestion/applyMethodSuggestion run solely when the chef
// accepts a specific card. Every normalization below is comparison-only.

const prepWords = new Set([
  'diced', 'chopped', 'minced', 'sliced', 'crushed', 'fresh',
  'large', 'small', 'medium', 'finely', 'roughly', 'peeled', 'grated',
  'ground', 'freshly', 'whole', 'cracked', 'rough', 'thin', 'thick'
]);

// Safe comparison-only aliases. These never modify saved recipe text.
const ingredientAliases = new Map([
  ['scallions', 'green onions'], ['scallion', 'green onion'],
  ['cilantro', 'coriander'], ['garbanzo', 'chickpea'], ['garbanzos', 'chickpeas'],
  ['aubergine', 'eggplant'], ['courgette', 'zucchini']
]);

const actionOnlyWords = new Set([
  'add', 'adding', 'use', 'using', 'pour', 'pouring', 'stir', 'stirring',
  'mix', 'mixing', 'put', 'putting', 'throw', 'throwing', 'drop', 'dropping',
  'fold', 'folding', 'season', 'seasoning', 'sprinkle', 'combine'
]);

const methodTokenAliases = new Map([
  ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'], ['five', '5'],
  ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'], ['ten', '10'],
  ['tablespoon', 'tbsp'], ['tablespoons', 'tbsp'], ['tbsps', 'tbsp'],
  ['teaspoon', 'tsp'], ['teaspoons', 'tsp'], ['tsps', 'tsp'],
  ['pound', 'lb'], ['pounds', 'lb'], ['lbs', 'lb'],
  ['ounce', 'oz'], ['ounces', 'oz'], ['ozs', 'oz'],
  ['minute', 'min'], ['minutes', 'min'], ['mins', 'min'],
  ['second', 'sec'], ['seconds', 'sec'], ['secs', 'sec'],
  ['hour', 'hr'], ['hours', 'hr'], ['hrs', 'hr'],
  ['degree', 'degree'], ['degrees', 'degree']
]);

const methodStopWords = new Set(['the', 'a', 'an', 'of', 'and']);

const methodActionWords = new Set([
  'add', 'bake', 'blend', 'boil', 'brown', 'chop', 'combine', 'cook', 'cut', 'divide', 'drain',
  'flip', 'fold', 'fry', 'grill', 'knead', 'make', 'marinate', 'mix', 'pack', 'pat', 'pour',
  'preheat', 'reduce', 'rest', 'roast', 'saute', 'season', 'sear', 'serve', 'shake', 'shape',
  'simmer', 'slice', 'split', 'sprinkle', 'stir', 'toss', 'whisk'
]);

// Comparison-only cooking action groups. These prevent false review warnings when
// chefs use natural variations of the same action.
const methodActionAliases = new Map([
  ['put', 'transfer'], ['place', 'transfer'], ['move', 'transfer'],
  ['transfer', 'transfer'], ['insert', 'transfer'],
  ['bake', 'heat'], ['roast', 'heat'], ['cook', 'heat'], ['grill', 'heat'],
  ['broil', 'heat'], ['fry', 'heat'],
  ['combine', 'mix'], ['blend', 'mix'], ['whisk', 'mix']
]);

const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// ---- IngredientReviewClassifier --------------------------------------------
// Conservative ingredient pairing. Identity is resolved before measurement
// comparison, and both sides are canonicalized here so review generation never
// depends on whether an earlier parser stage cleaned an ingredient correctly.

const conversationalTail = /\s+(?:(?:i|you|we)(?:'m|'re| am| are)?\s+)?(?:gonna|going\s+to)\s*$/i;
const trailingFiller = /\s+(?:like|wait|actually|sorry|no|too|also|there)\s*$/i;

/** Unique words in first-seen order -- the Kotlin side uses a LinkedHashSet. */
function classifierWords(value) {
  let text = String(value || '').trim().replace(/\s+/g, ' ');
  text = text.replace(conversationalTail, '').trim();
  text = text.replace(trailingFiller, '').trim();
  const tokens = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return [...new Set(tokens)];
}

const sameWordSet = (a, b) => a.length === b.length && a.every((w) => b.includes(w));
const containsAllWords = (haystack, needles) => needles.every((w) => haystack.includes(w));

function prefixClose(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  return min >= 3 && a.slice(0, min) === b.slice(0, min);
}

function identityScore(live, second) {
  const liveWords = classifierWords(live.name);
  const secondWords = classifierWords(second.name);

  if (!liveWords.length || !secondWords.length) return 0;
  if (sameWordSet(liveWords, secondWords)) return 1;

  // Tolerate ASR truncation: ground bee -> ground beef.
  if (liveWords.length === secondWords.length && liveWords.every((w, i) => prefixClose(w, secondWords[i]))) {
    return 0.88;
  }

  const overlap = liveWords.filter((w) => secondWords.includes(w)).length;
  const union = new Set([...liveWords, ...secondWords]).size;
  const jaccardScore = overlap / Math.max(1, union);

  // Preserve distinctions such as pepper vs lemon pepper.
  if (liveWords.includes('pepper') && secondWords.includes('pepper') && !sameWordSet(liveWords, secondWords)) {
    return jaccardScore;
  }

  if (containsAllWords(liveWords, secondWords) || containsAllWords(secondWords, liveWords)) return 0.92;

  return jaccardScore;
}

export function classifyIngredients(liveIngredients, secondIngredients) {
  const secondMatches = new Map();
  const usedLive = new Set();
  const live = canonicalizeIngredients(liveIngredients);
  const second = canonicalizeIngredients(secondIngredients);

  second.forEach((candidate, secondIndex) => {
    let best = null;
    live.forEach((item, liveIndex) => {
      if (usedLive.has(liveIndex)) return;
      const score = identityScore(item, candidate);
      if (score >= 0.66 && (best === null || score > best.score)) best = { liveIndex, score };
    });
    if (best) {
      usedLive.add(best.liveIndex);
      secondMatches.set(secondIndex, best);
    }
  });

  return { secondMatches };
}

// ---- Ingredient comparison helpers -----------------------------------------

const display = (item) => [item.quantity, item.unit, item.name].filter(Boolean).join(' ').trim();

// Comparison-only quantity normalization. Never changes saved recipe quantities.
function normalizeQuantityPhrase(value) {
  let output = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  output = output
    .replaceAll('one half', '0.5')
    .replaceAll('half', '0.5')
    .replaceAll('quarter', '0.25')
    .replaceAll('a quarter', '0.25')
    .replaceAll('couple', '2')
    .replaceAll('a couple', '2');
  return output.trim();
}

const quantityKey = (value) => normalizeQuantityPhrase(value);

function canonicalUnit(raw) {
  if (!raw || !String(raw).trim()) return '';
  const unit = parseIngredient(`1 ${raw} placeholder`).unit;
  return unit || String(raw).trim().toLowerCase();
}

const sameMeasure = (a, b) =>
  quantityKey(a.quantity) === quantityKey(b.quantity) && canonicalUnit(a.unit) === canonicalUnit(b.unit);

function words(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizeIngredientComparisonText(value) {
  let output = String(value || '');
  // Comparison-only removal of conversational tails.
  output = output.replace(/\s+(?:in\s+there|right\s+there|there|too|also|as\s+well|let'?s|lets)\s*$/i, '');
  // Common speech filler between words. Only used for matching.
  output = output.replace(/\b(?:uh|um|okay|ok|you\s+know)\b/gi, ' ');
  return output.trim().replace(/\s+/g, ' ');
}

function cleanupKnownAsrTail(value, unit) {
  let output = String(value || '').trim().replace(/\s+/g, ' ');
  output = output.replace(/\s+(?:(?:i|you|we)(?:'m|'re| am| are)?\s+)?(?:gonna|going\s+to)\s*$/i, '').trim();
  output = output.replace(/\s+(?:like|wait|actually|sorry|no)\s*$/i, '').trim();
  if (canonicalUnit(unit) === 'cup') output = output.replace(/^full\s+of\s+/i, '').trim();
  return output;
}

const coreWords = (value, unit) =>
  words(normalizeIngredientComparisonText(cleanupKnownAsrTail(value, unit)))
    .map((w) => ingredientAliases.get(w) || w)
    .filter((w) => !prepWords.has(w));

const nameKey = (item) => coreWords(item.name, item.unit).join(' ');

function jaccard(a, b) {
  const left = new Set(coreWords(a.name, a.unit));
  const right = new Set(coreWords(b.name, b.unit));
  if (!left.size || !right.size) return 0;
  const same = [...left].filter((w) => right.has(w)).length;
  return same / Math.max(1, left.size + right.size - same);
}

function containsCleanName(live, second) {
  const liveWords = coreWords(live.name, live.unit);
  const secondWords = coreWords(second.name, second.unit);
  if (!secondWords.length || liveWords.length <= secondWords.length) return false;
  return secondWords.every((w) => liveWords.includes(w));
}

function isLikelyParserArtifact(live, secondIngredients) {
  const name = String(live.name || '').trim();
  const lower = name.toLowerCase();
  if (!name) return true;
  if (/^(?:to|of|the|it|this|that|some|what|today|we|you|i|and|then|so|um|uh|let'?s|lets|there|too|also|okay|ok)$/.test(lower)) return true;
  if (/^(?:minutes?|seconds?|hours?|degrees?)\b.*$/.test(lower)) return true;
  if (/^\d+(?:\.\d+)?\s+(?:minutes?|seconds?|hours?|degrees?)\b.*$/.test(lower)) return true;
  if (/^(?:today|so|what|you|we|i)\b.*\b(?:gonna|going|need|make|do)\b.*$/.test(lower)) return true;
  if (/.*\b(?:you|we|i)\s*$/.test(lower) && !String(live.unit || '').trim()) return true;
  if (containsMeasurementEvidence(name)) return true;
  if (/.*\b(?:oh\s+(?:shit|s\*+)|oops|uh|um|sorry)\b.*$/.test(lower)) return true;

  // If the second pass has the same measured clean ingredient entirely inside this
  // longer live name, this row is almost certainly a duplicate ASR artifact.
  if (secondIngredients.some((second) => sameMeasure(live, second) && containsCleanName(live, second))) return true;

  return false;
}

function ingredientReviewConfidence(live, secondIngredients) {
  const name = String(live.name || '').trim().toLowerCase();
  if (!name) return 0;

  let score = 0.5;
  const tokens = words(name);

  if (tokens.some((t) => t.length >= 3)) score += 0.15;
  if (tokens.some((t) => !actionOnlyWords.has(t))) score += 0.15;
  if (containsMeasurementEvidence(name)) score += 0.05;

  const obviousSpeech = new Set(['lets', "let's", 'there', 'too', 'also', 'okay', 'ok', 'so', 'um', 'uh']);
  if (tokens.every((t) => obviousSpeech.has(t))) score -= 0.75;

  if (secondIngredients.some((second) => sameMeasure(live, second) && containsCleanName(live, second))) score -= 0.25;

  return clamp(score, 0, 1);
}

function isActionOnly(item) {
  const itemWords = words(item.name);
  return itemWords.length > 0 && itemWords.every((w) => actionOnlyWords.has(w));
}

function isCookingFactIngredient(item) {
  const raw = [item.quantity, item.unit, item.name].filter(Boolean).join(' ').trim();
  return /^\d+(?:\.\d+)?\s*(?:°(?:\s*[fc])?|degrees?(?:\s+(?:fahrenheit|celsius))?)$/i.test(raw) ||
    /^\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?)$/i.test(raw);
}

// ---- Ingredient review ------------------------------------------------------

export function buildReview(liveIngredients = [], secondIngredients = []) {
  const issues = [];
  const usedLive = new Set();
  let confirmed = 0;

  // Pure and input-independent across the loop, so it is computed once rather
  // than per second-pass item as the Kotlin does.
  const { secondMatches } = classifyIngredients(liveIngredients, secondIngredients);

  secondIngredients.forEach((second, secondIndex) => {
    if (isCookingFactIngredient(second)) return;
    const classifiedMatch = secondMatches.get(secondIndex) || null;
    const bestIndex = classifiedMatch ? classifiedMatch.liveIndex : -1;
    const bestScore = classifiedMatch ? classifiedMatch.score : 0;

    if (bestIndex >= 0 && bestScore >= 0.66) {
      usedLive.add(bestIndex);
      const live = liveIngredients[bestIndex];
      if (sameMeasure(live, second)) {
        const cleanedLive = cleanupKnownAsrTail(live.name, live.unit);
        const hadKnownJunk = cleanedLive.toLowerCase() !== String(live.name || '').trim().toLowerCase();
        if (hadKnownJunk) {
          issues.push({
            id: `name-cleanup:${bestIndex}:${secondIndex}`,
            type: 'ingredient-name-cleanup',
            title: 'Clean up ingredient name',
            detail: `Live capture: ${display(live)} · Second pass: ${display(second)}`,
            liveIndex: bestIndex,
            secondIndex,
            suggested: second,
            confidence: 0.75
          });
        } else {
          confirmed++;
        }
      } else {
        issues.push({
          id: `measurement:${bestIndex}:${secondIndex}`,
          type: 'quantity-change',
          title: 'Quantity changed',
          detail: `Live capture: ${display(live)} · Second pass: ${display(second)}`,
          liveIndex: bestIndex,
          secondIndex,
          suggested: second,
          confidence: 0.85
        });
      }
    } else {
      issues.push({
        id: `missing:${secondIndex}`,
        type: 'possible-missed-ingredient',
        title: 'Possible missed ingredient',
        detail: `Second pass heard: ${display(second)}`,
        liveIndex: -1,
        secondIndex,
        suggested: second,
        confidence: 0.75
      });
    }
  });

  liveIngredients.forEach((live, liveIndex) => {
    if (usedLive.has(liveIndex) || isActionOnly(live)) return;
    // Identity must be resolved before the confidence gate: a superseded/artifact
    // duplicate should always surface for removal, even at low text confidence.
    const superseding = secondIngredients.find((second) => nameKey(live) === nameKey(second) && !sameMeasure(live, second)) || null;
    const likelyArtifact = superseding !== null || isLikelyParserArtifact(live, secondIngredients);
    const confidence = ingredientReviewConfidence(live, secondIngredients);
    if (!likelyArtifact && confidence < 0.45) return;

    let title = 'Live-only ingredient';
    let detail = `Live capture heard ${display(live)}, but the second pass did not confirm it.`;
    if (superseding) {
      title = 'Superseded quantity';
      detail = `Live capture kept ${display(live)}, but the second pass corrected the same ingredient to ${display(superseding)}.`;
    } else if (likelyArtifact) {
      title = 'Likely capture artifact';
      detail = `Live capture created ${display(live)}, but the cleaner second pass did not confirm it.`;
    }

    issues.push({
      id: likelyArtifact ? `artifact:${liveIndex}` : `live-only:${liveIndex}`,
      type: likelyArtifact ? 'remove-live-artifact' : 'live-only-low-confidence',
      title,
      detail,
      liveIndex,
      secondIndex: -1,
      suggested: null,
      confidence: likelyArtifact ? 0.9 : 0.72
    });
  });

  return { issues, confirmedCount: confirmed };
}

export function applySuggestion(ingredients = [], issue) {
  const next = [...ingredients];
  switch (issue.type) {
    case 'possible-missed-ingredient': {
      if (!issue.suggested) break;
      // A second "possible missed" card can describe the same real ingredient as
      // one already accepted, and accepting both must not leave two rows for one
      // ingredient.
      const alreadyPresent = next.some((item) => jaccard(item, issue.suggested) >= 0.66);
      if (!alreadyPresent) next.push({ ...issue.suggested, id: issue.suggested.id || uuid() });
      break;
    }
    // "measurement-disagreement" is the legacy name for "quantity-change". Reviews
    // persisted locally by older builds still carry it, so keep it accepted.
    case 'measurement-disagreement':
    case 'quantity-change':
    case 'ingredient-name-cleanup': {
      if (issue.liveIndex >= 0 && issue.liveIndex < next.length && issue.suggested) {
        const current = next[issue.liveIndex];
        next[issue.liveIndex] = {
          ...current,
          quantity: issue.suggested.quantity || current.quantity,
          unit: issue.suggested.unit || current.unit,
          name: issue.suggested.name || current.name
        };
      }
      break;
    }
    case 'remove-live-artifact': {
      if (issue.liveIndex >= 0 && issue.liveIndex < next.length) next.splice(issue.liveIndex, 1);
      break;
    }
    default:
      break;
  }
  return next;
}

// ---- Method comparison helpers ---------------------------------------------

function methodWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(?:okay|ok|so|now|alright|all right|then|next|after that)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => methodTokenAliases.get(w) || w)
    .map((w) => methodActionAliases.get(w) || w)
    .filter((w) => !methodStopWords.has(w));
}

const methodDurationCue = /\b\d+\s*(?:second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs)\b/g;
const methodTemperatureCue = /\b\d+\s*(?:degree|degrees|deg|f|c|fahrenheit|celsius)\b/g;

const cueCount = (cue, value) => (String(value || '').toLowerCase().match(new RegExp(cue.source, 'g')) || []).length;

/** Matches a cooking action in its bare, -s, -ed or -ing form ("flip", "flipping"). */
function isMethodActionToken(word) {
  if (methodActionWords.has(word)) return true;
  let base;
  if (word.endsWith('ing') && word.length > 5) base = word.slice(0, -3);
  else if (word.endsWith('ed') && word.length > 4) base = word.slice(0, -2);
  else if (word.endsWith('s') && word.length > 3) base = word.slice(0, -1);
  else return false;
  const undoubled = base.length > 2 && base[base.length - 1] === base[base.length - 2] ? base.slice(0, -1) : base;
  return methodActionWords.has(base) || methodActionWords.has(undoubled) ||
    methodActionWords.has(`${base}e`) || methodActionWords.has(`${undoubled}e`);
}

/**
 * Second Pass routinely expands a terse live note into a chef-readable sentence.
 * That extra wording is confirmation, not a disagreement -- unless the added words
 * introduce something the chef has to actually do: another cooking action, another
 * duration, or another temperature.
 */
function methodMeaningIsContained(live, second) {
  const liveWords = new Set(methodWords(live));
  const secondWords = new Set(methodWords(second));
  if (liveWords.size < 2 || secondWords.size <= liveWords.size) return false;
  if (![...liveWords].every((w) => secondWords.has(w))) return false;

  const addedWords = [...secondWords].filter((w) => !liveWords.has(w));
  if (addedWords.some(isMethodActionToken)) return false;
  if (cueCount(methodDurationCue, second) > cueCount(methodDurationCue, live)) return false;
  if (cueCount(methodTemperatureCue, second) > cueCount(methodTemperatureCue, live)) return false;
  return true;
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  if (i < a.length || j < b.length) edits++;
  return edits <= 1;
}

function methodSimilarity(a, b) {
  const leftWords = methodWords(a);
  const rightWords = methodWords(b);
  const leftSet = new Set(leftWords);
  const rightSet = new Set(rightWords);
  if (!leftSet.size || !rightSet.size) return 0;
  if (leftWords.join(' ') === rightWords.join(' ')) return 1;

  const intersection = [...leftSet].filter((w) => rightSet.has(w)).length;
  const union = leftSet.size + rightSet.size - intersection;
  const jaccardScore = intersection / Math.max(1, union);
  const coverage = Math.max(intersection / Math.max(1, leftSet.size), intersection / Math.max(1, rightSet.size));
  let score = Math.max(jaccardScore, coverage * 0.9);

  const leftAction = leftWords[0];
  const rightAction = rightWords[0];
  if (
    leftAction && rightAction &&
    leftAction.length >= 4 && rightAction.length >= 4 &&
    methodActionWords.has(leftAction) && methodActionWords.has(rightAction) &&
    editDistanceAtMostOne(leftAction, rightAction)
  ) {
    const leftTail = new Set(leftWords.slice(1));
    const rightTail = new Set(rightWords.slice(1));
    const tailIntersection = [...leftTail].filter((w) => rightTail.has(w)).length;
    const tailCoverage = (!leftTail.size && !rightTail.size)
      ? 1
      : Math.max(tailIntersection / Math.max(1, leftTail.size), tailIntersection / Math.max(1, rightTail.size));
    if (tailCoverage >= 0.5) score = Math.max(score, 0.84);
  }
  return score;
}

function methodJaccard(a, b) {
  const leftSet = new Set(methodWords(a));
  const rightSet = new Set(methodWords(b));
  if (!leftSet.size || !rightSet.size) return 0;
  const intersection = [...leftSet].filter((w) => rightSet.has(w)).length;
  const union = leftSet.size + rightSet.size - intersection;
  return intersection / Math.max(1, union);
}

const normalizeMethodStep = (value) => methodWords(value).join(' ');

// The bar for "this is the same instruction, not a disagreement" -- used both to
// confirm a matched pair without a review card, and to stop a duplicate step being
// inserted.
const isSameMethodStep = (a, b) =>
  methodJaccard(a, b) >= 0.86 ||
  normalizeMethodStep(a) === normalizeMethodStep(b) ||
  methodMeaningIsContained(a, b);

const methodCorrectionCue = /\b(?:actually(?:\s+scratch\s+that)?|scratch\s+that|oh\s+wait(?:\s+no)?|wait|sorry|oops|no)\b[,:;\s-]*/gi;

const trimEdges = (value) => value.replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '');

function splitMethodCorrection(value) {
  const matches = [...String(value || '').matchAll(methodCorrectionCue)];
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  const before = trimEdges(value.slice(0, match.index));
  const after = trimEdges(value.slice(match.index + match[0].length));
  if (!before || !after) return null;
  return [before, after];
}

function ensureMethodSentence(value) {
  let text = String(value || '').trim().replace(/^[,;:\s-]+|[,;:\s-]+$/g, '').replace(/[.?!]+$/, '').trim();
  if (!text) return '';
  text = text[0].toUpperCase() + text.slice(1);
  return `${text}.`;
}

function splitCompositeMethodStep(value) {
  const match = /^(.+?)[,;]?\s+and\s+(.+)$/i.exec(String(value || '').trim());
  if (!match) return null;
  const first = ensureMethodSentence(match[1]);
  const second = ensureMethodSentence(match[2]);
  if (!first || !second) return null;
  const firstAction = methodWords(first)[0];
  const secondAction = methodWords(second)[0];
  if (!methodActionWords.has(firstAction) || !methodActionWords.has(secondAction)) return null;
  return [first, second];
}

function compositeNeighborMatch(liveSteps, parts, usedLive) {
  if (!parts) return null;
  let bestFirst = -1;
  let bestSecond = -1;
  let bestAverage = 0;
  for (let liveIndex = 0; liveIndex < liveSteps.length - 1; liveIndex++) {
    if (usedLive.has(liveIndex) || usedLive.has(liveIndex + 1)) continue;
    const firstScore = methodSimilarity(liveSteps[liveIndex], parts[0]);
    const secondScore = methodSimilarity(liveSteps[liveIndex + 1], parts[1]);
    const average = (firstScore + secondScore) / 2;
    if (firstScore >= 0.56 && secondScore >= 0.56 && average >= 0.68 && average > bestAverage) {
      bestFirst = liveIndex;
      bestSecond = liveIndex + 1;
      bestAverage = average;
    }
  }
  return bestFirst >= 0 ? [bestFirst, bestSecond] : null;
}

function methodCandidates(liveSteps, secondSteps, handledSecond, usedLive) {
  const candidates = [];
  secondSteps.forEach((secondRaw, secondIndex) => {
    if (handledSecond.has(secondIndex)) return;
    const second = String(secondRaw || '').trim();
    if (!second) return;
    const parts = splitCompositeMethodStep(second);
    const neighbor = compositeNeighborMatch(liveSteps, parts, usedLive);
    if (parts && neighbor) {
      candidates.push({ secondIndex, key: `${secondIndex}:0`, text: parts[0], preferredLiveIndex: neighbor[0] });
      candidates.push({ secondIndex, key: `${secondIndex}:1`, text: parts[1], preferredLiveIndex: neighbor[1] });
    } else {
      candidates.push({ secondIndex, key: `${secondIndex}:0`, text: second, preferredLiveIndex: -1 });
    }
  });
  return candidates;
}

function supersededSecondMethodIndices(secondSteps, sourceTranscript) {
  if (secondSteps.length < 2 || !String(sourceTranscript || '').trim()) return new Set();
  const parts = splitMethodCorrection(sourceTranscript);
  if (!parts) return new Set();
  const [before, after] = parts;

  let correctedIndex = -1;
  let correctedScore = 0;
  secondSteps.forEach((step, index) => {
    const score = methodSimilarity(after, step);
    if (score > correctedScore) { correctedScore = score; correctedIndex = index; }
  });
  if (correctedIndex <= 0 || correctedScore < 0.72) return new Set();

  const corrected = secondSteps[correctedIndex];
  for (let index = correctedIndex - 1; index >= 0; index--) {
    const beforeScore = methodSimilarity(before, secondSteps[index]);
    const relatedScore = methodSimilarity(secondSteps[index], corrected);
    if (beforeScore >= 0.56 && relatedScore >= 0.56) return new Set([index]);
  }
  return new Set();
}

// ---- Method review ----------------------------------------------------------

export function buildMethodReview(liveSteps = [], secondSteps = [], sourceTranscript = '') {
  const issues = [];
  const usedLive = new Set();
  const handledSecond = supersededSecondMethodIndices(secondSteps, sourceTranscript);
  let confirmed = 0;

  // Real-device correction closure: live recognition can collapse an old method and
  // its spoken correction into one row, while the cleaner second pass splits them
  // into two. Pair the live row with the corrected (later) second-pass step and
  // suppress the stale pre-correction step so it is never offered as a replacement.
  liveSteps.forEach((liveRaw, liveIndex) => {
    const parts = splitMethodCorrection(liveRaw);
    if (!parts) return;
    const [before, after] = parts;

    let supersededIndex = -1;
    let supersededScore = 0;
    secondSteps.forEach((secondRaw, secondIndex) => {
      const score = methodSimilarity(before, secondRaw);
      if (score > supersededScore) { supersededScore = score; supersededIndex = secondIndex; }
    });
    if (supersededIndex < 0 || supersededScore < 0.72) return;

    let correctedIndex = -1;
    let correctedScore = 0;
    secondSteps.forEach((secondRaw, secondIndex) => {
      if (secondIndex <= supersededIndex) return;
      const score = methodSimilarity(after, secondRaw);
      if (score > correctedScore) { correctedScore = score; correctedIndex = secondIndex; }
    });
    if (correctedIndex < 0 || correctedScore < 0.56) return;

    const live = String(liveRaw).trim();
    const corrected = String(secondSteps[correctedIndex]).trim();
    usedLive.add(liveIndex);
    handledSecond.add(supersededIndex);
    handledSecond.add(correctedIndex);
    issues.push({
      id: `method-correction:${liveIndex}:${correctedIndex}`,
      type: 'method-wording-disagreement',
      title: 'Check corrected method',
      detail: `Live method contains a correction: ${live} · Second pass corrected method: ${corrected}`,
      liveIndex,
      secondIndex: correctedIndex,
      suggestedStep: corrected,
      confidence: clamp(correctedScore, 0.65, 0.92)
    });
  });

  methodCandidates(liveSteps, secondSteps, handledSecond, usedLive).forEach((candidate) => {
    const { secondIndex } = candidate;
    const second = candidate.text;
    let bestIndex = -1;
    let bestScore = 0;

    if (candidate.preferredLiveIndex >= 0 && !usedLive.has(candidate.preferredLiveIndex)) {
      const score = methodSimilarity(liveSteps[candidate.preferredLiveIndex], second);
      if (score >= 0.56) { bestIndex = candidate.preferredLiveIndex; bestScore = score; }
    }

    if (bestIndex < 0) {
      liveSteps.forEach((liveRaw, liveIndex) => {
        if (usedLive.has(liveIndex)) return;
        const score = methodSimilarity(liveRaw, second);
        if (score > bestScore) { bestScore = score; bestIndex = liveIndex; }
      });
    }

    if (bestIndex >= 0 && bestScore >= 0.56) {
      usedLive.add(bestIndex);
      const live = String(liveSteps[bestIndex]).trim();
      if (isSameMethodStep(live, second)) {
        // Second Pass often expands terse live notes into a chef-readable
        // instruction. Extra detail is confirmation, not a disagreement.
        confirmed++;
      } else {
        issues.push({
          id: `method-wording:${bestIndex}:${candidate.key}`,
          type: 'method-wording-disagreement',
          title: 'Check method wording',
          detail: `Live method: ${live} · Second pass: ${second}`,
          liveIndex: bestIndex,
          secondIndex,
          suggestedStep: second,
          confidence: clamp(bestScore, 0.6, 0.9)
        });
      }
    } else {
      issues.push({
        id: `method-missing:${candidate.key}`,
        type: 'possible-missed-step',
        title: 'Possible missed step',
        detail: `Second pass heard: ${second}`,
        liveIndex: -1,
        secondIndex,
        suggestedStep: second,
        confidence: 0.78
      });
    }
  });

  liveSteps.forEach((liveRaw, liveIndex) => {
    if (usedLive.has(liveIndex)) return;
    const live = String(liveRaw || '').trim();
    if (!live) return;
    issues.push({
      id: `method-live-only:${liveIndex}`,
      type: 'live-only-step',
      title: 'Live-only step',
      detail: `Live method: ${live} · Second pass did not confirm this step.`,
      liveIndex,
      secondIndex: -1,
      suggestedStep: null,
      confidence: 0.68
    });
  });

  return { issues, confirmedCount: confirmed };
}

export function applyMethodSuggestion(steps = [], issue) {
  const next = [...steps];
  if (issue.type === 'possible-missed-step') {
    const suggested = String(issue.suggestedStep || '').trim();
    if (!suggested) return next;
    // Same duplicate guard as ingredients: don't insert a step that already reads
    // as the same instruction as one already in the list.
    if (next.some((step) => isSameMethodStep(step, suggested))) return next;
    const insertAt = clamp(issue.secondIndex, 0, next.length);
    next.splice(insertAt, 0, suggested);
  } else if (issue.type === 'method-wording-disagreement') {
    if (issue.liveIndex >= 0 && issue.liveIndex < next.length && String(issue.suggestedStep || '').trim()) {
      next[issue.liveIndex] = String(issue.suggestedStep).trim();
    }
  }
  return next;
}

// ---- Entry point ------------------------------------------------------------

/**
 * Re-runs a returned cloud transcript through the same deterministic parser the
 * live capture used, then diffs it against what the chef already has. Nothing is
 * applied here -- the result describes differences for the chef to accept or
 * reject.
 */
export function fromCloudTranscript({
  liveIngredients = [],
  liveSteps = [],
  transcript = '',
  rawSegments = [],
  provider = 'google-cloud-speech-v2',
  model = 'chirp_3',
  ranAt = Date.now()
} = {}) {
  let segmentTexts = rawSegments.map((s) => String(s || '').trim()).filter(Boolean);
  if (!segmentTexts.length) segmentTexts = [String(transcript || '').trim()].filter(Boolean);
  const parserSegments = segmentTexts.map((text, index) => ({ elapsedMs: index * 1000, text }));

  const parsed = parseCookingSession(parserSegments);
  const canonicalSecondIngredients = canonicalizeIngredients(parsed.ingredients);
  const ingredientReview = buildReview(canonicalizeIngredients(liveIngredients), canonicalSecondIngredients);
  const methodReview = buildMethodReview(liveSteps, parsed.steps, transcript);

  return {
    provider,
    model,
    transcript: String(transcript || '').trim(),
    ingredients: canonicalSecondIngredients,
    issues: ingredientReview.issues,
    confirmedCount: ingredientReview.confirmedCount,
    steps: parsed.steps,
    methodIssues: methodReview.issues,
    methodConfirmedCount: methodReview.confirmedCount,
    ranAt
  };
}
