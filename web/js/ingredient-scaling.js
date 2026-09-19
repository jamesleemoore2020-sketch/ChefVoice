// Port of app/.../util/IngredientScaling.kt. Keep the two in step.
//
// Serving scaling and unit conversion for DISPLAY ONLY. Nothing here is written back into a
// recipe: a chef who narrated "two cups of flour" said two cups, and a stepper on a screen must
// not quietly become the record. Both operations fail soft -- a quantity that cannot be read
// ("a pinch", "to taste", blank) passes through untouched, so scaling can never lose an
// ingredient or invent a number for one. Volume is never converted to weight.

export const MeasurementSystem = Object.freeze({ AS_WRITTEN: 'AS_WRITTEN', METRIC: 'METRIC', IMPERIAL: 'IMPERIAL' });

const vulgarFractions = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875
};

const numberWords = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, a: 1, an: 1, half: 0.5
};

/** Reads "2", "1.5", "1/2", "1 1/2", "1½", "½", "two". Null for anything else. */
export function parseQuantity(raw) {
  const clean = String(raw ?? '').trim().toLowerCase();
  if (!clean) return null;
  let expanded = '';
  for (const ch of clean) expanded += ch in vulgarFractions ? ` ${ch} ` : ch;
  let total = 0;
  let sawNumber = false;
  for (const token of expanded.split(/\s+/).filter(Boolean)) {
    let value;
    if (token.length === 1 && token in vulgarFractions) value = vulgarFractions[token];
    else if (Object.prototype.hasOwnProperty.call(numberWords, token)) value = numberWords[token];
    else if (token.includes('/')) {
      const parts = token.split('/');
      const n = Number(parts[0].trim());
      const d = Number(parts[1]?.trim());
      value = parts.length === 2 && parts[0].trim() && parts[1].trim() && Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? n / d : null;
    } else value = token !== '' && Number.isFinite(Number(token)) ? Number(token) : null;
    // A token this cannot read makes the whole quantity unsafe.
    if (value === null || value === undefined) return null;
    total += value;
    sawNumber = true;
  }
  return sawNumber && total > 0 ? total : null;
}

const kitchenFractions = [
  [0.125, '1/8'], [0.25, '1/4'], [1 / 3, '1/3'], [0.375, '3/8'], [0.5, '1/2'],
  [0.625, '5/8'], [2 / 3, '2/3'], [0.75, '3/4'], [0.875, '7/8']
];

function nearestKitchenFraction(remainder) {
  if (remainder < 0.005) return null;
  let best = null;
  for (const c of kitchenFractions) if (!best || Math.abs(c[0] - remainder) < Math.abs(best[0] - remainder)) best = c;
  // Only snap when the value genuinely is one of these, never to force one.
  return best && Math.abs(best[0] - remainder) <= 0.02 ? best[1] : null;
}

/** Writes a number back the way a cook would: "1 1/2", not "1.5". */
export function formatQuantity(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const whole = Math.floor(value);
  const remainder = value - whole;
  const fraction = nearestKitchenFraction(remainder);
  if (fraction) return whole === 0 ? fraction : `${whole} ${fraction}`;
  if (remainder < 0.005) return String(whole);
  if (value >= 100) return String(Math.round(value));
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function servingFactor(baseServings, targetServings) {
  if (baseServings <= 0 || targetServings <= 0) return 1;
  return targetServings / baseServings;
}

/** Scales every quantity by `factor`; a factor of 1 returns the very same list. */
export function scale(ingredients, factor) {
  if (factor === 1 || factor <= 0 || Number.isNaN(factor)) return ingredients;
  return ingredients.map(item => {
    const amount = parseQuantity(item.quantity);
    return amount === null ? item : { ...item, quantity: formatQuantity(amount * factor) };
  });
}

function stepUp(m) {
  if (m.unit === 'ml' && m.amount >= 1000) return { amount: m.amount / 1000, unit: 'l' };
  if (m.unit === 'g' && m.amount >= 1000) return { amount: m.amount / 1000, unit: 'kg' };
  if (m.unit === 'oz' && m.amount >= 16) return { amount: m.amount / 16, unit: 'lb' };
  if (m.unit === 'fl oz' && m.amount >= 8) return { amount: m.amount / 8, unit: 'cups' };
  return m;
}

function convertMeasure(amount, unit, system) {
  const key = String(unit ?? '').trim().toLowerCase().replace(/\.+$/, '').replace(/s$/, '');
  let base = null;
  if (system === MeasurementSystem.METRIC) {
    switch (key) {
      case 'cup': base = { amount: amount * 236.588, unit: 'ml' }; break;
      case 'tablespoon': case 'tbsp': base = { amount: amount * 14.787, unit: 'ml' }; break;
      case 'teaspoon': case 'tsp': base = { amount: amount * 4.929, unit: 'ml' }; break;
      case 'fluid ounce': case 'fl oz': base = { amount: amount * 29.574, unit: 'ml' }; break;
      case 'pint': base = { amount: amount * 473.176, unit: 'ml' }; break;
      case 'quart': base = { amount: amount * 946.353, unit: 'ml' }; break;
      case 'ounce': case 'oz': base = { amount: amount * 28.35, unit: 'g' }; break;
      case 'pound': case 'lb': base = { amount: amount * 453.592, unit: 'g' }; break;
    }
  } else if (system === MeasurementSystem.IMPERIAL) {
    switch (key) {
      case 'milliliter': case 'millilitre': case 'ml': base = { amount: amount / 29.574, unit: 'fl oz' }; break;
      case 'liter': case 'litre': case 'l': base = { amount: amount * 1000 / 29.574, unit: 'fl oz' }; break;
      case 'gram': case 'g': base = { amount: amount / 28.35, unit: 'oz' }; break;
      case 'kilogram': case 'kg': base = { amount: amount * 1000 / 28.35, unit: 'oz' }; break;
    }
  }
  return base ? stepUp(base) : null;
}

/** Rewrites quantity and unit into `system`, leaving anything it does not recognise alone. */
export function convert(ingredients, system) {
  if (system === MeasurementSystem.AS_WRITTEN) return ingredients;
  return ingredients.map(item => {
    const amount = parseQuantity(item.quantity);
    if (amount === null) return item;
    const converted = convertMeasure(amount, item.unit, system);
    return converted ? { ...item, quantity: formatQuantity(converted.amount), unit: converted.unit } : item;
  });
}
