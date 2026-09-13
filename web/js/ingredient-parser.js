const unitAliases = new Map([
  ['tablespoonfuls','tbsp'], ['tablespoonful','tbsp'], ['tablespoons','tbsp'], ['tablespoon','tbsp'], ['tbsp','tbsp'], ['tbs','tbsp'],
  ['teaspoonfuls','tsp'], ['teaspoonful','tsp'], ['teaspoons','tsp'], ['teaspoon','tsp'], ['tsp','tsp'],
  ['kilograms','kg'], ['kilogram','kg'], ['kg','kg'], ['milligrams','mg'], ['milligram','mg'], ['mg','mg'],
  ['grams','g'], ['gram','g'], ['g','g'], ['liters','L'], ['liter','L'], ['litres','L'], ['litre','L'], ['l','L'],
  ['milliliters','ml'], ['milliliter','ml'], ['millilitres','ml'], ['millilitre','ml'], ['ml','ml'],
  ['fluid ounces','fl oz'], ['fluid ounce','fl oz'], ['fl oz','fl oz'], ['ounces','oz'], ['ounce','oz'], ['oz','oz'],
  ['pounds','lb'], ['pound','lb'], ['lbs','lb'], ['lb','lb'],
  ['cupfuls','cup'], ['cupful','cup'], ['cups','cup'], ['cup','cup'],
  ['chunks','chunk'], ['chunk','chunk'],
  ['cloves','clove'], ['clove','clove'], ['cans','can'], ['can','can'], ['pinches','pinch'], ['pinch','pinch'],
  ['dashes','dash'], ['dash','dash'], ['handfuls','handful'], ['handful','handful'], ['slices','slice'], ['slice','slice'],
  ['pieces','piece'], ['piece','piece'], ['sticks','stick'], ['stick','stick'], ['sprigs','sprig'], ['sprig','sprig'],
  ['bunches','bunch'], ['bunch','bunch'], ['heads','head'], ['head','head'], ['packages','package'], ['package','package'],
  ['packets','packet'], ['packet','packet'], ['jars','jar'], ['jar','jar'], ['bottles','bottle'], ['bottle','bottle'],
  ['boxes','box'], ['box','box'], ['bags','bag'], ['bag','bag']
]);

const numberWords = new Map([
  ['zero','0'], ['one','1'], ['two','2'], ['three','3'], ['four','4'], ['five','5'], ['six','6'], ['seven','7'],
  ['eight','8'], ['nine','9'], ['ten','10'], ['eleven','11'], ['twelve','12'], ['thirteen','13'], ['fourteen','14'],
  ['fifteen','15'], ['sixteen','16'], ['seventeen','17'], ['eighteen','18'], ['nineteen','19'], ['twenty','20'],
  ['couple','2'], ['dozen','12'], ['half','1/2'], ['quarter','1/4'], ['a','1'], ['an','1']
]);

const measurementEvidence = /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|a|an)\s+(?:tablespoon(?:ful)?s?|teaspoon(?:ful)?s?|tbsp|tsp|cups?|chunks?|grams?|kilograms?|milligrams?|ounces?|pounds?|lbs?|cloves?|cans?|pinches?|dashes?|handfuls?|slices?|pieces?|sticks?|sprigs?|bunches?|heads?|packages?|packets?|jars?|bottles?|boxes?|bags?)\b/gi;

export function normalizeSpeechText(raw = '') {
  return String(raw)
    .replaceAll('’', "'")
    .replaceAll('½', ' 1/2 ')
    .replaceAll('¼', ' 1/4 ')
    .replaceAll('¾', ' 3/4 ')
    .replaceAll('⅓', ' 1/3 ')
    .replaceAll('⅔', ' 2/3 ')
    .replace(/\b1?\s*⁄\s*2\b/gi, ' 1/2 ')
    .replace(/\btea[ -]?spoon(?:ful)?s?\b/gi, 'teaspoon')
    .replace(/\btable[ -]?spoon(?:ful)?s?\b/gi, 'tablespoon')
    .replace(/\bt[ .-]?spoons?\b/gi, 'teaspoon')
    .replace(/\btb[ .-]?spoons?\b/gi, 'tablespoon')
    .replace(/\bfl[ .-]?ounces?\b/gi, 'fluid ounce')
    .replace(/\bcup\s*ful(?:l)?s?\b/gi, 'cup')
    .replace(/\bcup\s+fulls?\b/gi, 'cup')
    .replace(/\ba\s+(half|quarter)\s+a\b/gi, (_, word) => `${word} a`)
    .replace(/\b(tbsp|tsp|tablespoons?|teaspoons?)\s+spoons?\b/gi, '$1')
    .replace(/\b(?:to|too)\s+(?=(?:tablespoons?|teaspoons?|tbsp|tsp|cups?|chunks?|grams?|kilograms?|ounces?|pounds?|lbs?|cloves?|cans?|pinches?|slices?|pieces?)\b)/gi, '2 ')
    .replace(/\bwon\s+(?=(?:tablespoons?|teaspoons?|cups?|chunks?|grams?|ounces?|pounds?|cloves?|cans?|pinches?)\b)/gi, '1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsMeasurementEvidence(raw = '') {
  measurementEvidence.lastIndex = 0;
  return measurementEvidence.test(normalizeSpeechText(raw));
}

export function measurementEvidenceCount(raw = '') {
  const text = normalizeSpeechText(raw);
  return [...text.matchAll(new RegExp(measurementEvidence.source, 'gi'))].length;
}

function parseQuantity(tokens) {
  if (!tokens.length) return ['', 0];
  const first = tokens[0].replace(/[,.]+$/g, '');

  if (['half','quarter'].includes(first) && tokens.length >= 2) {
    if (tokens[1] === 'a') return [first === 'half' ? '1/2' : '1/4', 2];
    if (tokens.length >= 3 && tokens[1] === 'of' && tokens[2] === 'a') return [first === 'half' ? '1/2' : '1/4', 3];
  }
  if (first === 'a' && tokens.length >= 2 && ['half','quarter'].includes(tokens[1])) {
    return [tokens[1] === 'half' ? '1/2' : '1/4', 2];
  }

  if (/^(?:\d+(?:\.\d+)?|\d+\/\d+)$/.test(first)) {
    if (tokens.length >= 2 && /^\d+\/\d+$/.test(tokens[1])) return [`${first} ${tokens[1]}`, 2];
    if (tokens.length >= 4 && tokens[1] === 'and' && ['a','one'].includes(tokens[2]) && ['half','quarter'].includes(tokens[3])) {
      return [`${first} ${tokens[3] === 'half' ? '1/2' : '1/4'}`, 4];
    }
    if (tokens.length >= 3 && tokens[1] === 'and' && ['half','quarter'].includes(tokens[2])) {
      return [`${first} ${tokens[2] === 'half' ? '1/2' : '1/4'}`, 3];
    }
    return [first, 1];
  }

  if (tokens.length >= 2) {
    const numerator = Number.parseInt(numberWords.get(first), 10);
    const fractionWord = tokens[1].replace(/[,.]+$/g, '');
    const denominator = ({half:2, halves:2, third:3, thirds:3, quarter:4, quarters:4, fourth:4, fourths:4})[fractionWord];
    if (Number.isFinite(numerator) && denominator && numerator >= 1 && numerator < denominator) return [`${numerator}/${denominator}`, 2];
  }

  const base = numberWords.get(first);
  if (!base) return ['', 0];
  if (tokens.length >= 4 && tokens[1] === 'and' && ['a','one'].includes(tokens[2]) && ['half','quarter'].includes(tokens[3])) {
    return [`${base} ${tokens[3] === 'half' ? '1/2' : '1/4'}`, 4];
  }
  if (tokens.length >= 3 && tokens[1] === 'and' && ['half','quarter'].includes(tokens[2])) {
    return [`${base} ${tokens[2] === 'half' ? '1/2' : '1/4'}`, 3];
  }
  return [base, 1];
}

export function parseIngredient(raw = '') {
  const cleaned = normalizeSpeechText(raw).toLowerCase().trim().replace(/^[\s,.;:]+|[\s,.;:]+$/g, '').replace(/\s+/g, ' ');
  if (!cleaned) return { id: crypto.randomUUID(), quantity:'', unit:'', name:'' };

  const tokens = cleaned.split(' ');
  const [quantity, consumed] = parseQuantity(tokens);
  tokens.splice(0, consumed);

  let unit = '';
  if (tokens.length) {
    const twoWord = tokens.slice(0, 2).join(' ').replace(/[,.]+$/g, '');
    const oneWord = tokens[0].replace(/[,.]+$/g, '');
    if (tokens.length >= 2 && unitAliases.has(twoWord)) {
      unit = unitAliases.get(twoWord);
      tokens.splice(0, 2);
    } else if (unitAliases.has(oneWord)) {
      unit = unitAliases.get(oneWord);
      tokens.splice(0, 1);
    }
  }

  let nameRaw = tokens.join(' ').replace(/^(?:of\s+)+(?:the\s+)?/i, '').replace(/^[\s,.;:]+|[\s,.;:]+$/g, '');

  // Remove standalone preparation items that are not ingredients.
  if (/^\d+\s+patties?$/i.test(nameRaw) || /^patties?$/i.test(nameRaw)) nameRaw = '';

  // Remove stray measurement words accidentally captured in the name.
  nameRaw = nameRaw
    .replace(/\b(?:teaspoons?|tsp|tablespoons?|tbsp)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const name = nameRaw ? nameRaw[0].toUpperCase() + nameRaw.slice(1) : '';
  return { id: crypto.randomUUID(), quantity, unit, name };
}

export function displayIngredient(i) {
  return [i.quantity, i.unit, i.name].filter(Boolean).join(' ');
}

export const ingredientParserInternals = { unitAliases, numberWords };
