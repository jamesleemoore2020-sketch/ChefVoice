import { normalizeSpeechText, parseIngredient, containsMeasurementEvidence } from './ingredient-parser.js';

// Ported from app/src/main/java/com/chefvoice/app/voice/CookingSessionParser.kt.
// Both the PWA and the native Android parser must produce the same structured
// ingredients and required method-step fragments for every row of
// shared/golden-cooking-corpus.tsv -- see shared/README.md. Keep this file's
// regex sources textually aligned with the Kotlin source so a future fix is easy
// to port in both directions.

const quantitySource =
  '(?:(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s+and\\s+(?:a\\s+|one\\s+)?(?:half|quarter)' +
  '|\\d+\\s+\\d+/\\d+' +
  '|(?:one|two|three)\\s+(?:halves|thirds|quarters|fourths)' +
  '|(?:half|quarter)\\s+(?:of\\s+)?a' +
  '|a\\s+(?:half|quarter)' +
  '|\\d+/\\d+|\\d+(?:\\.\\d+)?' +
  '|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|half|quarter|couple|dozen|a|an)';
const unitSource =
  '(?:tablespoon(?:ful)?s?|teaspoon(?:ful)?s?|tbsp|tsp|cupfuls?|cups?|chunks?|grams?|kilograms?|milligrams?|ounces?|fluid ounces?|pounds?|lbs?|cloves?|cans?|pinches?|dashes?|handfuls?|slices?|pieces?|sticks?|sprigs?|bunches?|heads?|packages?|packets?|jars?|bottles?|boxes?|bags?)';

const quantityPattern = new RegExp(`\\b${quantitySource}\\b`, 'gi');

const actionWords = new Set([
  'add', 'adding', 'bake', 'baking', 'beat', 'blend', 'boil', 'bring', 'brown',
  'chop', 'combine', 'cook', 'cooking', 'cut', 'dice', 'divide', 'drain', 'drop', 'flip', 'fold', 'form', 'fry', 'throw',
  'heat', 'knead', 'make', 'marinate', 'melt', 'mix', 'pat', 'peel', 'place', 'pour', 'preheat', 'reduce',
  'rest', 'roast', 'saute', 'sauté', 'season', 'sear', 'serve', 'settle', 'shape', 'shaped', 'simmer', 'slice', 'split',
  'sprinkle', 'stir', 'toast', 'toss', 'transfer', 'turn', 'whisk'
]);

const ingredientLead = /^(?:ingredient|ingredients)\s*[:,-]?\s*/i;
const stepLead = /^(?:step(?:\s+\d+)?|method|instruction)\s*[:,-]?\s*/i;

const ingredientContext = /\b(?:ingredient|add|adding|use|using|pour|pouring|stir\s+in|stirring\s+in|mix\s+in|mixing\s+in|put\s+in|putting\s+in|throw\s+in|throwing\s+in|drop\s+in|dropping\s+in|fold\s+in|folding\s+in|need|take|season\s+with|seasoning\s+with|sprinkle|top\s+with|combine)\b/i;

// Unmeasured ingredients need stronger evidence than conversational words like
// "need" or "take"; otherwise narration such as "what you need to do" becomes a
// fake ingredient row. "need" is admitted only when a determiner follows it
// (some|a|an|your), matching CookingSessionParser.kt.
const unmeasuredIngredientContext = /^\s*(?:(?:then|next|and|now|so|okay|ok|alright|all\s+right)[, ]+)*(?:(?:i|you|we)(?:'m|'re|'ll| am| are| will)?\s+)?(?:(?:am|are)\s+)?(?:going\s+to\s+|gonna\s+|want\s+to\s+|will\s+)?(?:add|adding|use|using|pour(?:ing)?(?:\s+in)?|stir(?:ring)?\s+in|mix(?:ing)?\s+in|put(?:ting)?\s+in|throw(?:ing)?\s+in|drop(?:ping)?\s+in|fold(?:ing)?\s+in|need(?=\s+(?:some|an?|your)\b)|season(?:ing)?\s+with|sprinkle|top(?:ping)?\s+with|combine)\b/i;

// A yield sentence describes how many people the dish feeds, not what goes into
// it. Bare "serve" is deliberately absent -- it is a method verb.
const servingYieldContext = /\b(?:feed|feeds|serves|serving|servings)\b/i;

// An unmeasured name that opens with a back-reference points at something
// already introduced, not a new ingredient.
const backReferenceName = /^(?:it|its|them|they|this|that|those|these)\b/i;

// A segment that opens a fresh "need some/your X" declaration is a standalone
// ingredient line, never the tail of the previous method step.
const ingredientDeclarationSegment = /^\s*(?:(?:then|next|and|now|so|okay|ok|alright|all\s+right)[, ]+)*(?:(?:i|you|we)(?:'m|'re|'ll| am| are| will)?\s+)?(?:(?:am|are)\s+)?(?:going\s+to\s+|gonna\s+|want\s+to\s+|will\s+)?need\s+(?:some|an?|your)\b/i;

const ingredientNoiseName = /^(?:to|of|the|it|this|that|some|what|today|tomorrow|we|you|i|and|then|so|um|uh)$/i;
const ingredientArtifactName = /^(?:grab|stuff|tasteful)$/i;
const narrationNoiseName = /^(?:today|so|what|you|we|i)\b.*\b(?:gonna|going|need|make|do)\b/i;
const cookingOnlyNames = /^(?:(?:minute|minutes|second|seconds|hour|hours|degree|degrees)\b.*|fahrenheit|celsius|pan|pot|bowl|skillet|oven|tray|dish|mixture|heat|medium heat|high heat|low heat)$/i;
const temperatureOnlyName = /^\d+(?:\.\d+)?\s*(?:°(?:\s*[fc])?|degrees?(?:\s+(?:fahrenheit|celsius))?)$/i;
const preparationOutputName = /^(?:\d+\s+)?(?:patties?|portions?|servings?)$/i;

const methodOutputCountContext = /^\s*(?:and\s+)?(?:(?:i|you|we)(?:'m|'re| am| are)?\s+)?(?:going\s+to\s+|gonna\s+)?(?:make|form|shape|split|divide|pat)\b/i;

// "need" joins this list because a window parse concatenates adjacent segments
// without punctuation, and "...some sour cream you're going to need some hot
// sauce" was becoming one ingredient name. Splitting before the verb keeps each
// declaration separate without guessing at any word.
const narratedActionBoundary = /\s+(?=(?:and\s+)?(?:(?:i|you|we)(?:'m|'re| am| are)?\s+)?(?:going\s+to\s+|gonna\s+)?(?:add|adding|use|using|take|taking|get|getting|need|needing|pour|pouring|stir|stirring|mix|mixing|put|putting|throw|throwing|drop|dropping|fold|folding|season|seasoning|sprinkle|combine|bake|cook|simmer|roast|sear|whisk|chop|make|split|divide|shape|form|pat|preheat|serve)\b)/gi;

const methodContinuationCue = /\b(?:in\s+between|halfway|on\s+both\s+sides|each\s+side|during\s+(?:cooking|baking|roasting)|before\s+serving)\b/i;
const durationOnlyMethodContinuation = /^(?:for\s+)?(?:about\s+|approximately\s+)?(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:seconds?|minutes?|hours?)$/i;
const durationAttachableMethod = /\b(?:cook|bake|roast|simmer|boil|fry|sear|broil|rest|settle|marinate|heat)\b/i;

// When one timestamp contains several ASR predicates without punctuation, split
// repeated direct-object clauses without guessing the recognized verb.
const repeatedThemBoundary = /(\bthem(?:\s+(?:down|up|over|through|well|evenly|out|off|aside|together|apart|back|around|both|again)){0,2})\s+(?:and\s+)?(?=[a-z][a-z'-]*\s+them\b)/gi;
const uncertainThemClause = /^[a-z][a-z'-]*\s+them\b/i;
const ingredientMethodContinuationAction = /\b(?:season|seasoning|sprinkle|top|add|adding|mix|mixing|combine|combining)\b/i;

const methodTemperatureAfterFor = /\b(cook|bake|roast|heat|preheat|sear|fry|broil)\b([^.!?]{0,80}?)\bfor\s+(\d+(?:\.\d+)?\s*(?:°(?:\s*[fc])?|degrees?(?:\s+(?:fahrenheit|celsius))?))(?=\s|$|[,.!?])/gi;

function uuid() {
  return crypto.randomUUID();
}

function capitalize(value) {
  const trimmed = value.trim().replace(/[.,;]+$/, '');
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : '';
}

function sentenceCase(value) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const capped = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

function lowerFirst(value) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function cleanIngredientName(value) {
  let cleaned = value
    .replace(/^(?:of\s+)+(?:the\s+)?/i, '')
    .replace(/^(?:and|then|also)\s+/i, '')
    // "need some sour cream" leaves "some sour cream" once the verb is
    // stripped. Only the bare determiner goes; the ingredient text is never
    // rewritten. Same treatment for "your" ("need your favorite Dorito chips").
    .replace(/^some\s+(?=\S)/i, '')
    .replace(/^your\s+(?=\S)/i, '')
    .replace(/\s+(?:and|then|also)$/i, '');

  // ASR sometimes joins the next measured ingredient onto the previous one:
  // "2 lb ground beef tablespoon of salt". Keep the first ingredient as the
  // parser boundary and allow the next quantity pass to capture salt.
  cleaned = cleaned.replace(/\s+(?:tablespoons?|tbsp|teaspoons?|tsp|cups?)\s+(?:of\s+)?[a-z].*$/i, '');

  // Bare prep nouns are method outputs, not ingredients.
  cleaned = cleaned.replace(/^\d+\s+(?:patties?|pieces?|portions?|servings?)$/i, '');

  return cleaned.replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '');
}

function trimIngredientTail(value) {
  return value
    .replace(/\s+(?:and\s+)?(?:cook|stir|whisk|mix|saute|sauté|bake|simmer|roast|fry|heat|boil|sear|reduce|rest)\b.*$/i, '')
    .replace(/\s+(?:to|into)\s+(?:the\s+|a\s+|an\s+)?(?:pan|pot|bowl|skillet|tray|dish|mixture|oven)\b.*$/i, '')
    .replace(/\s+until\b.*$/i, '')
    .replace(/\s+for\s+(?:about\s+)?\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?)?\b.*$/i, '')
    .replace(/[,;]\s*(?:oh|oops|uh|um|actually|sorry)\b.*$/i, '')
    .replace(/\s+(?:oh\s+(?:shit|s\*+)|oops|uh|um|sorry)\b.*$/i, '')
    .replace(/\s+(?:actually\s+(?:make\s+that|use)|make\s+that|change\s+that\s+to|correction)\b.*$/i, '')
    .replace(/\s+(?:actually\s+)?scratch\s+that\s*$/i, '')
    .replace(/\s+(?:i|you|we)\s+(?:could|would|should|might|may|can)\s*$/i, '')
    .replace(/\s+(?:i|you|we)\s+(?:want|need|like|mean|think)\s*$/i, '')
    .replace(/\s+(?:it|that|this)\s+(?:took|takes)\s*$/i, '')
    .replace(/\s+(?:like|wait|actually|sorry|no)\s*$/i, '')
    .replace(/\s+(?:(?:i|you|we)(?:'m|'re| am| are)?\s+)?(?:gonna|going\s+to)\s*$/i, '')
    .replace(/\s+(?:on|in|at|to|into|with|for)\s*$/i, '')
    .replace(/^[\s,.;]+|[\s,.;]+$/g, '');
}

function looksLikeOnlyCookingInstruction(name) {
  const words = name.toLowerCase().split(/[^a-zA-ZÀ-ÿ]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => actionWords.has(w));
}

function isValidIngredientName(name, maxLength = 80) {
  const clean = name.trim();
  if (!clean || clean.length > maxLength) return false;
  if (cookingOnlyNames.test(clean)) return false;
  if (temperatureOnlyName.test(clean)) return false;
  if (ingredientNoiseName.test(clean)) return false;
  if (ingredientArtifactName.test(clean)) return false;
  if (backReferenceName.test(clean)) return false;
  if (narrationNoiseName.test(clean)) return false;
  if (looksLikeOnlyCookingInstruction(clean)) return false;
  if (preparationOutputName.test(clean)) return false;
  return true;
}

function normalizeMethodTemperaturePreposition(value) {
  return value.replace(methodTemperatureAfterFor, (match, verb, middle, temperature) => {
    return `${verb}${middle.replace(/\s+$/, '')} at ${temperature}`;
  });
}

function cleanStep(raw) {
  const cleaned = raw
    .trim()
    .replace(/^(?:(?:okay|ok|so|now|alright|all\s+right)[, ]+)+/i, '')
    .replace(/^(?:and\s+)?when\s+(?:it(?:'s| is)|they(?:'re| are))\s+done,\s*/i, '')
    .replace(/^(?:and\s+)?(?:(?:i|you|we)(?:'m|'re| am| are)?\s+)?(?:going\s+to|gonna)\s+/i, '')
    .replace(/\s+(?:(?:i|you|we)(?:'m|'re| am| are)?\s+)?(?:gonna|going\s+to)\s*$/i, '')
    .replace(/\b(\d+)\s+(minutes?|seconds?|hours?)\s+\1\s*$/i, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, '');
  return normalizeMethodTemperaturePreposition(cleaned);
}

function splitNarration(text) {
  return text
    .replace(/\s+(?:and\s+then|but\s+then|then|next|after\s+that)\s+/gi, '. ')
    // ASR often omits punctuation. A second cooking verb is a useful soft
    // sentence boundary: "add salt add pepper" becomes two clauses.
    .replace(narratedActionBoundary, '. ')
    .replace(repeatedThemBoundary, '$1. ')
    .split(/[.!?;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractSharedMeasureIngredients(value) {
  const results = [];
  const ranges = [];
  const re = new RegExp(`\\b(${quantitySource})\\s+(${unitSource})\\s+(?:each\\s+)?of\\s+([^.;]+?)(?=(?:\\s+(?:then|and then|next|after that)\\s+)|$)`, 'gi');

  for (const match of value.matchAll(re)) {
    const rawNames = match[3];
    // "2 tbsp of paprika, 3 tbsp of garlic" is two measured ingredients, not a
    // shared 2-tbsp measure. Let the normal quantity parser handle it.
    if (containsMeasurementEvidence(rawNames)) continue;

    const names = rawNames
      .replace(/\s+(?:and\s+)?(?:cook|stir|mix|bake|simmer|roast|fry|heat|boil|sear)\b.*$/i, '')
      .split(/\s*(?:,|\band\b)\s*/i)
      .map(cleanIngredientName)
      .filter((n) => isValidIngredientName(n));

    if (names.length >= 2) {
      const seed = parseIngredient(`${match[1]} ${match[2]} placeholder`);
      for (const name of names) results.push({ ...seed, id: uuid(), name: capitalize(name) });
      ranges.push([match.index, match.index + match[0].length]);
    }
  }

  if (!ranges.length) return [results, value];

  let remainder = value;
  for (const [start, end] of [...ranges].reverse()) {
    remainder = remainder.slice(0, start) + ' ' + remainder.slice(end);
  }
  return [results, remainder.replace(/\s+/g, ' ').trim()];
}

// ASR sometimes narrates the quantity after the ingredient name instead of
// before it -- "you're going to need your favorite Dorito chips, one bag"
// trails the measure behind a comma. The general quantity scan below starts
// each ingredient chunk at its first quantity match, so without this narrow
// pass the name text ahead of a trailing quantity would be silently discarded.
// It only fires with real ingredient/action evidence already found in the
// sentence, and only for the single "name, quantity unit" shape anchored to
// the end of the source.
function extractTrailingQuantityIngredient(value, hasIngredientContext) {
  if (!hasIngredientContext) return [null, value];
  const regex = new RegExp(`^(.+?),\\s*(${quantitySource})\\s+(${unitSource})\\s*$`, 'i');
  const match = regex.exec(value);
  if (!match) return [null, value];

  const name = cleanIngredientName(match[1]);
  if (!isValidIngredientName(name)) return [null, value];

  const seed = parseIngredient(`${match[2]} ${match[3]} placeholder`);
  const remainder = (value.slice(0, match.index) + value.slice(match.index + match[0].length))
    .replace(/\s+/g, ' ')
    .trim();
  return [{ ...seed, id: uuid(), name: capitalize(name) }, remainder];
}

function extractUnmeasuredIngredients(value) {
  const cleaned = trimIngredientTail(value).replace(/^(?:of\s+)+(?:the\s+)?/i, '').trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s*(?:,|\band\b)\s*/i)
    .map(cleanIngredientName)
    .filter((n) => isValidIngredientName(n, 60))
    .map((name) => ({ id: uuid(), quantity: '', unit: '', name: capitalize(name) }));
}

function extractIngredients(raw, allowUnmeasured) {
  const normalizedRaw = normalizeSpeechText(raw);
  // A yield sentence carries quantities that look exactly like ingredient
  // quantities ("feed at least two people"), so it has to be rejected before
  // any extraction runs rather than filtered out of the results afterwards.
  if (servingYieldContext.test(normalizedRaw)) return [];
  const hasIngredientContext = ingredientContext.test(normalizedRaw);
  const hasStrongUnmeasuredContext = unmeasuredIngredientContext.test(normalizedRaw);

  let source = normalizedRaw
    .replace(/^(?:(?:okay|ok|so|now|alright|all right|then|next|and)[, ]+)+/i, '')
    .replace(/^(?:(?:i|you|we)(?:'m|'re|'ll| am| are| will)?\s+)?(?:(?:am|are)\s+)?(?:going\s+to\s+|gonna\s+|want\s+to\s+|will\s+)?(?:add|adding|use|using|pour(?:ing)?(?:\s+in)?|stir(?:ring)?\s+in|mix(?:ing)?\s+in|put(?:ting)?\s+in|throw(?:ing)?\s+in|drop(?:ping)?\s+in|fold(?:ing)?\s+in|need|take|season(?:ing)?\s+with|sprinkle|top(?:ping)?\s+with|combine)\s+/i, '')
    .trim();

  source = trimIngredientTail(source);

  const [sharedResults, sharedRemainder] = extractSharedMeasureIngredients(source);
  const result = [...sharedResults];
  source = sharedRemainder;

  const [trailingIngredient, sourceAfterTrailing] = extractTrailingQuantityIngredient(source, hasIngredientContext);
  if (trailingIngredient) {
    result.push(trailingIngredient);
    source = sourceAfterTrailing;
  }

  const matches = [...source.matchAll(new RegExp(quantityPattern.source, 'gi'))];
  if (!matches.length) {
    // Unmeasured ingredients are useful too: "add salt and pepper". We only
    // attempt them when the chef used ingredient/action language so ordinary
    // method sentences don't become ingredient rows.
    if (!allowUnmeasured && !hasStrongUnmeasuredContext) return result;
    return result.concat(extractUnmeasuredIngredients(source));
  }

  matches.forEach((match, index) => {
    const end = matches[index + 1]?.index ?? source.length;
    let chunk = source.slice(match.index, end).trim().replace(/\s+and\s*$/i, '').replace(/^[, -]+|[, -]+$/g, '');
    chunk = trimIngredientTail(chunk);
    if (!chunk) return;

    const parsed = parseIngredient(chunk);
    const name = cleanIngredientName(parsed.name);
    const quantityToken = match[0].trim().toLowerCase();
    const unsafeBareArticle = (quantityToken === 'a' || quantityToken === 'an') && !parsed.unit && !hasIngredientContext;
    const outputCount = !parsed.unit && methodOutputCountContext.test(normalizedRaw);

    // Measured/count ingredients are allowed even if recognition lost the
    // preceding word "add", but a bare article inside a method sentence ("as
    // if it was a burger patty") is not ingredient evidence.
    if (!unsafeBareArticle && !outputCount && isValidIngredientName(name)) {
      result.push({ ...parsed, id: uuid(), name: capitalize(name) });
    }
  });
  return result;
}

function buildStructuredIngredientActionStep(raw, localIngredients) {
  const actionMatch = /^\s*(?:(?:uh|um)\s+)?(?:add|adding|use|using|season(?:ing)?\s+with|sprinkle)\b/i.exec(raw);
  if (!actionMatch) return null;

  const shouldStructure = /\b(?:actually\s+)?scratch\s+that\b/i.test(raw);
  if (!shouldStructure || !localIngredients.length) return null;

  const corrected = dedupeIngredients(applyCorrections(raw, dedupeIngredients(localIngredients)));
  if (!corrected.length) return null;

  let verb = 'Add';
  if (/season/i.test(actionMatch[0])) verb = 'Season with';
  else if (/sprinkle/i.test(actionMatch[0])) verb = 'Sprinkle';
  else if (/use/i.test(actionMatch[0])) verb = 'Use';

  const rendered = corrected.map(ingredientForStep);
  let listText;
  if (rendered.length === 1) listText = rendered[0];
  else if (rendered.length === 2) listText = `${rendered[0]} and ${rendered[1]}`;
  else listText = rendered.slice(0, -1).join(', ') + ', and ' + rendered[rendered.length - 1];

  return `${verb} ${listText}`;
}

function ingredientForStep(item) {
  const parts = [];
  if (item.quantity) parts.push(item.quantity);
  if (item.unit) parts.push(item.unit);
  if (item.name) parts.push(lowerFirst(item.name.trim()));
  return parts.join(' ').trim();
}

function parseNarration(narration, ingredients, steps, collectSteps) {
  for (const clause of splitNarration(narration)) {
    const trimmed = clause.replace(/^[\s,.;:]+|[\s,.;:]+$/g, '').trim();
    if (!trimmed) continue;

    const explicitIngredient = ingredientLead.test(trimmed);
    const explicitStep = stepLead.test(trimmed);
    const ingredientSource = trimmed.replace(ingredientLead, '').trim();

    const localIngredients = explicitIngredient
      ? extractIngredients(ingredientSource, true)
      : extractIngredients(trimmed, false);
    ingredients.push(...localIngredients);

    const cleanedStep = cleanStep(trimmed.replace(stepLead, ''));
    const words = cleanedStep.toLowerCase().split(/[^a-zA-ZÀ-ÿ]+/);
    const hasAction = words.some((w) => actionWords.has(w)) ||
      (methodOutputCountContext.test(trimmed) && quantityPattern.test(trimmed));
    const ingredientOnly = explicitIngredient && !hasAction && !explicitStep;

    if (collectSteps && !ingredientOnly && (explicitStep || hasAction)) {
      const structured = buildStructuredIngredientActionStep(trimmed, localIngredients);
      const stepValue = structured ?? cleanedStep;
      if (stepValue.length >= 4) steps.push(sentenceCase(stepValue));
    }
  }
}

function collectSegmentAwareSteps(normalizedSegments) {
  const result = [];
  let acceptsIngredientContinuation = false;

  segmentLoop:
  for (const segment of normalizedSegments) {
    const segmentIngredients = [];
    const orderedCandidates = [];
    let hasRecognizedMethod = false;

    for (const clause of splitNarration(segment)) {
      const clauseIngredients = [];
      const clauseSteps = [];
      parseNarration(clause, clauseIngredients, clauseSteps, true);
      segmentIngredients.push(...clauseIngredients);

      if (clauseSteps.length) {
        hasRecognizedMethod = true;
        clauseSteps.forEach((s) => orderedCandidates.push([s, true]));
      } else {
        const cleanedClause = cleanStep(clause);
        if (cleanedClause.length >= 4 && uncertainThemClause.test(cleanedClause)) {
          orderedCandidates.push([sentenceCase(cleanedClause), false]);
        }
      }
    }

    if (hasRecognizedMethod) {
      for (const [candidate, recognized] of orderedCandidates) {
        if (recognized || uncertainThemClause.test(candidate)) result.push(candidate);
      }
      acceptsIngredientContinuation = ingredientMethodContinuationAction.test(cleanStep(segment));
      continue segmentLoop;
    }

    const cleaned = cleanStep(segment);
    if (
      acceptsIngredientContinuation &&
      segmentIngredients.length &&
      !ingredientDeclarationSegment.test(segment) &&
      cleaned.length >= 2 &&
      result.length
    ) {
      const continuation = lowerFirst(cleaned);
      const previous = result.pop().replace(/[.!?]+$/, '');
      result.push(sentenceCase(`${previous} ${continuation}`));
      continue segmentLoop;
    }
    if (segmentIngredients.length) continue segmentLoop;

    if (cleaned.length >= 4 && durationOnlyMethodContinuation.test(cleaned) && result.length) {
      const previous = result[result.length - 1].replace(/[.!?]+$/, '');
      const alreadyHasDuration = /\b(?:seconds?|minutes?|hours?)\b/i.test(previous);
      if (durationAttachableMethod.test(previous) && !alreadyHasDuration) {
        const continuation = /^for\s/i.test(cleaned) ? lowerFirst(cleaned) : `for ${lowerFirst(cleaned)}`;
        result[result.length - 1] = sentenceCase(`${previous} ${continuation}`);
        acceptsIngredientContinuation = false;
        continue segmentLoop;
      }
    }

    if (cleaned.length >= 4 && methodContinuationCue.test(cleaned)) {
      result.push(sentenceCase(cleaned));
      acceptsIngredientContinuation = false;
      continue segmentLoop;
    }

    if (cleaned.trim()) acceptsIngredientContinuation = false;
  }

  return result;
}

function dedupeIngredients(values) {
  const out = [];
  const seen = new Set();
  for (const ingredient of values) {
    const cleanName = cleanIngredientName(ingredient.name || '');
    if (!cleanName) continue;
    const normalized = { ...ingredient, name: capitalize(cleanName) };
    const key = [normalized.quantity, normalized.unit, normalized.name].join('|').toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
  }
  return out;
}

function dedupeSteps(values) {
  const seen = new Set();
  const out = [];
  const keyOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  for (const step of values) {
    const key = keyOf(step);
    if (!key || seen.has(key)) continue;

    const lastKey = out.length ? keyOf(out[out.length - 1]) : '';
    if (lastKey && lastKey.split(' ').length >= 3 && key.startsWith(`${lastKey} `)) {
      seen.delete(lastKey);
      out[out.length - 1] = step;
      seen.add(key);
      continue;
    }
    if (lastKey && key.split(' ').length >= 3 && lastKey.startsWith(`${key} `)) {
      continue;
    }

    seen.add(key);
    out.push(step);
  }
  return out;
}

function normalizedIngredientName(value) {
  return cleanIngredientName(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalUnit(raw) {
  if (!raw) return '';
  const unit = parseIngredient(`1 ${raw} placeholder`).unit;
  return unit || raw.toLowerCase();
}

function applyNamedIngredientCorrection(corrected, quantity, unit, rawName) {
  const parsed = parseIngredient(`${quantity} ${unit} ${trimIngredientTail(rawName)}`);
  const correctedName = cleanIngredientName(parsed.name);
  const targetKey = normalizedIngredientName(correctedName);
  if (!targetKey) return;

  const matching = [];
  corrected.forEach((item, index) => {
    if (normalizedIngredientName(item.name) === targetKey) matching.push(index);
  });

  if (matching.length) {
    const keep = matching[matching.length - 1];
    corrected[keep] = { ...corrected[keep], quantity: parsed.quantity, unit: parsed.unit, name: capitalize(correctedName) };
    matching
      .filter((i) => i !== keep)
      .sort((a, b) => b - a)
      .forEach((i) => corrected.splice(i, 1));
  } else if (isValidIngredientName(correctedName)) {
    corrected.push({ ...parsed, id: uuid(), name: capitalize(correctedName) });
  }
}

function applyCorrections(fullTranscript, values) {
  if (!values.length) return values;
  const corrected = [...values];

  // Named correction: "one chunk chicken breast, actually scratch that, half a
  // chunk chicken breast". Every parser/window duplicate for that same
  // ingredient collapses into one final corrected row.
  const scratchRegex = new RegExp(
    `\\b(?:actually\\s+)?scratch\\s+that\\s+(${quantitySource})\\s+(${unitSource})\\s+(?:of\\s+)?(.+?)(?=(?:\\s+${quantitySource}\\s+${unitSource}\\b)|(?:\\s+(?:and\\s+then|but\\s+then|then|next|after\\s+that)\\b)|[.;]|$)`,
    'gi'
  );
  for (const match of fullTranscript.matchAll(scratchRegex)) {
    applyNamedIngredientCorrection(corrected, match[1], match[2], match[3]);
  }

  // Natural correction cue: "1 lb ground beef, wait, 2 lb ground beef". The cue
  // only acts as a correction when immediately followed by another measured item.
  const correctionFiller =
    "(?:(?:(?:we|you)(?:'re| are)|i(?:'m| am))\\s+(?:going\\s+to|gonna)\\s+(?:do|add|use|put|get)\\s+|(?:then\\s+)?(?:do|add|use|put|get)\\s+)?";
  const waitCorrectionRegex = new RegExp(
    `\\b(?:oh\\s+)?(?:wait(?:[, ]+no)?|no|sorry|actually\\s+no|oops)[,.; ]+${correctionFiller}(${quantitySource})\\s+(${unitSource})\\s+(?:of\\s+)?(.+?)(?=(?:\\s+${quantitySource}\\s+${unitSource}\\b)|(?:\\s+(?:and\\s+then|but\\s+then|then|next|after\\s+that)\\b)|[.;]|$)`,
    'gi'
  );
  for (const match of fullTranscript.matchAll(waitCorrectionRegex)) {
    applyNamedIngredientCorrection(corrected, match[1], match[2], match[3]);
  }

  // Existing quantity/unit-only correction language.
  const correctionRegex = new RegExp(
    `\\b(?:actually\\s+(?:make\\s+that|use)|make\\s+that|change\\s+that\\s+to|correction[, ]*)\\s*(${quantitySource})\\s+(${unitSource})\\b`,
    'gi'
  );
  for (const match of fullTranscript.matchAll(correctionRegex)) {
    const parsed = parseIngredient(`${match[1]} ${match[2]} placeholder`);
    for (let index = corrected.length - 1; index >= 0; index--) {
      if (canonicalUnit(corrected[index].unit) === canonicalUnit(parsed.unit)) {
        corrected[index] = { ...corrected[index], quantity: parsed.quantity, unit: parsed.unit };
        break;
      }
    }
  }

  return corrected;
}

// Ported from RecipeCanonicalizer.kt. Canonical recipe cleanup before
// UI/review comparison -- never rewrites the user's saved recipe text.
const speechTails = /\s+(?:you(?:'re| are)?\s+gonna\s+need|you(?:'ll| will)?\s+need|we(?:'re| are)?\s+gonna\s+use|let'?s\s+add|we'?re\s+gonna\s+use|in\s+there|right\s+there|just|hey|okay|ok|there)\s*$/i;
const invalidStandalone = new Set(['the', 'a', 'an', 'there', 'hey', 'just', 'okay', 'ok', 'lets', "let's", 'um', 'uh']);
const measurementNoise = /^\s*(?:\d+(?:\.\d+)?\s*)?(?:degrees?|minutes?|mins?|seconds?|secs?)\s*$/i;

function canonicalizeIngredients(items) {
  const cleaned = items
    .map((item) => ({
      ...item,
      name: item.name.trim().replace(speechTails, '').replace(/\b(?:oh|uh|hey|just|the|and)$/i, '').replace(/^a\s+pinch\s+of\s+/i, '').trim()
    }))
    .filter((item) => {
      const name = item.name.toLowerCase().trim();
      if (!name) return false;
      if (invalidStandalone.has(name)) return false;
      if (measurementNoise.test(name)) return false;
      return true;
    });

  const groups = new Map();
  const order = [];
  for (const item of cleaned) {
    const canonicalName = item.name.toLowerCase().replace(/\ba\s+pinch\s+of\s+/i, '').replace(/\bjust\s+/i, '').trim();
    if (!groups.has(canonicalName)) {
      groups.set(canonicalName, []);
      order.push(canonicalName);
    }
    groups.get(canonicalName).push(item);
  }

  // Keep the latest parsed quantity while preserving the canonical identity.
  const merged = order.map((name) => {
    const group = groups.get(name);
    return group[group.length - 1];
  });

  const seenKeys = new Set();
  const result = [];
  for (const item of merged) {
    const key = [item.quantity.trim(), item.unit.trim().toLowerCase(), item.name.toLowerCase().trim()].join('|');
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(item);
    }
  }
  return result;
}

export function parseCookingSession(segments = []) {
  if (!segments.length) return { ingredients: [], steps: [] };

  const normalized = segments
    .map((s) => normalizeSpeechText(typeof s === 'string' ? s : s.text).trim())
    .filter(Boolean);

  const ingredients = [];
  const steps = [];

  // 1) Parse the whole transcript so ingredient phrases survive arbitrary ASR
  //    segment breaks such as "two teaspoons" | "of salt". For a multi-segment
  //    capture, timestamp boundaries are method evidence, so the whole pass
  //    does not create Method steps; those are collected below in original order.
  parseNarration(normalized.join(' '), ingredients, steps, normalized.length === 1);

  // 2) Parse two/three-segment windows. This recovers local context without
  //    letting a very long transcript swallow later action phrases.
  for (let windowSize = 2; windowSize <= 3; windowSize++) {
    if (normalized.length >= windowSize) {
      for (let i = 0; i <= normalized.length - windowSize; i++) {
        parseNarration(normalized.slice(i, i + windowSize).join(' '), ingredients, steps, false);
      }
    }
  }

  // 3) Keep the old per-segment pass too because recognizers sometimes return
  //    useful punctuation only in their final individual segments.
  normalized.forEach((s) => parseNarration(s, ingredients, steps, false));

  if (normalized.length > 1) {
    steps.push(...collectSegmentAwareSteps(normalized));
  }

  const fullTranscript = normalized.join(' ');
  const correctedIngredients = dedupeIngredients(applyCorrections(fullTranscript, dedupeIngredients(ingredients)));

  return {
    ingredients: canonicalizeIngredients(correctedIngredients),
    steps: dedupeSteps(steps)
  };
}

export function mergeDraft(existingIngredients = [], existingSteps = [], draft = { ingredients: [], steps: [] }) {
  const ingredients = [...existingIngredients];
  const keys = new Set(ingredients.map((i) => `${i.quantity}|${i.unit}|${i.name}`.toLowerCase().replace(/\s+/g, ' ')));
  for (const i of draft.ingredients || []) {
    const k = `${i.quantity}|${i.unit}|${i.name}`.toLowerCase().replace(/\s+/g, ' ');
    if (!keys.has(k)) {
      keys.add(k);
      ingredients.push(i);
    }
  }
  const steps = [...existingSteps];
  const skeys = new Set(steps.map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  for (const s of draft.steps || []) {
    const k = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (k && !skeys.has(k)) {
      skeys.add(k);
      steps.push(s);
    }
  }
  return { ingredients, steps };
}
