/**
 * Small, browser-safe recipe ingredient parser used by integrations which
 * already have a structured ingredient object (for example Mealie), but
 * still need to recover the amount and searchable food name from the
 * original display string.  The server JSON-LD importer has a more complete
 * parser; keeping this fallback here means a Mealie handoff does not silently
 * turn every ingredient into the food's default 100 g serving.
 */

const FRACTIONS = Object.freeze({
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4,
  '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
});

const NUMBER_WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 });

const UNITS = new Map(Object.entries({
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  c: 'cup', cup: 'cup', cups: 'cup',
  'fl oz': 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
  pinch: 'pinch', pinches: 'pinch', dash: 'dash', dashes: 'dash',
  clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece', each: 'piece',
  can: 'can', cans: 'can', package: 'package', packages: 'package', pkg: 'package',
  sprig: 'sprig', sprigs: 'sprig', stalk: 'stalk', stalks: 'stalk',
  bunch: 'bunch', bunches: 'bunch',
  scoop: 'scoop', scoops: 'scoop', stick: 'stick', sticks: 'stick',
  biscuit: 'biscuit', biscuits: 'biscuit', cookie: 'cookie', cookies: 'cookie',
  bar: 'bar', bars: 'bar', packet: 'packet', packets: 'packet',
  jar: 'jar', jars: 'jar', bag: 'bag', bags: 'bag', box: 'box', boxes: 'box',
}));

const SIZE_QUALIFIERS = /^(?:(?:extra|very)\s+)?(?:small|medium|large|jumbo|mini|baby)(?:\s+large|\s+small)?\s+/i;

function numberToken(value) {
  const token = String(value || '').replace(/,/g, '.').trim().toLowerCase();
  if (NUMBER_WORDS[token] != null) return NUMBER_WORDS[token];
  if (FRACTIONS[token] != null) return FRACTIONS[token];
  if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
  const fraction = /^(\d+)\/(\d+)$/.exec(token);
  if (fraction && Number(fraction[2])) return Number(fraction[1]) / Number(fraction[2]);
  const mixed = /^(\d+)[ -](\d+)\/(\d+)$/.exec(token);
  if (mixed && Number(mixed[3])) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const vulgarMixed = /^(\d+)([¼½¾⅓⅔⅛⅜⅝⅞])$/.exec(token);
  if (vulgarMixed) return Number(vulgarMixed[1]) + FRACTIONS[vulgarMixed[2]];
  return null;
}

function cleanName(value) {
  return String(value || '').replace(/^of\s+/i, '').replace(/^[,;:\-–—]\s*/, '').replace(/\s+/g, ' ').trim();
}

function appendNote(existing, value) {
  const note = String(value || '').trim();
  return note ? (existing ? `${existing}; ${note}` : note) : (existing || '');
}

function readAmount(value) {
  const match = /^(\d+\s+\d+\/\d+|\d+-\d+\/\d+|\d+[¼½¾⅓⅔⅛⅜⅝⅞]|\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|one|two|three|four|five|six)(?=\s|$)\s*/i.exec(String(value || ''));
  if (!match) return null;
  const rest = String(value).slice(match[0].length);
  // Longest aliases first so "fluid ounce" is not read as "fluid".
  const unitMatch = /^(fluid\s+ounces?|tablespoons?|teaspoons?|millilit(?:er|re)s?|kilograms?|ounces?|pounds?|grams?|cups?|tbsp|tsp|kg|mg|ml|oz|lb|g|l|c|pinch(?:es)?|dash(?:es)?|cloves?|slices?|pieces?|each|cans?|packages?|pkg|sprigs?|stalks?|bunches?|scoops?|sticks?|biscuits?|cookies?|bars?|packets?|jars?|bags?|boxes?)(?:\.|\b)\s*/i.exec(rest);
  if (!unitMatch) return null;
  const unit = UNITS.get(unitMatch[1].toLowerCase());
  const quantity = numberToken(match[1]);
  return unit && Number.isFinite(quantity)
    ? { quantity, unit, length: match[0].length + unitMatch[0].length }
    : null;
}

function readBareQuantity(value) {
  const match = /^(\d+\s+\d+\/\d+|\d+-\d+\/\d+|\d+[¼½¾⅓⅔⅛⅜⅝⅞]|\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|one|two|three|four|five|six)(?=\s|$)\s*/i.exec(String(value || ''));
  if (!match) return null;
  const quantity = numberToken(match[1]);
  return Number.isFinite(quantity) ? { quantity, length: match[0].length } : null;
}

function readEquivalent(value) {
  const match = /^\(\s*(\d+(?:[.,]\d+)?|\d+\/\d+)\s*(g|grams?|kg|kilograms?)\s*\)\s*/i.exec(String(value || ''));
  if (!match) return null;
  const quantity = numberToken(match[1]);
  const unit = UNITS.get(match[2].toLowerCase());
  return unit && Number.isFinite(quantity) ? { quantity, unit, length: match[0].length } : null;
}

function stripAlternativeAmount(value) {
  let rest = String(value || '').trim();
  const amount = readAmount(rest);
  if (amount) rest = rest.slice(amount.length);
  const equivalent = readEquivalent(rest);
  if (equivalent) rest = rest.slice(equivalent.length);
  return cleanName(rest).replace(SIZE_QUALIFIERS, '').trim();
}

/** Parse an ingredient display string into the fields used by recipe import. */
export function parseRecipeIngredientText(input) {
  const original = String(input ?? '').replace(/\s+/g, ' ').trim();
  const result = {
    original_text: original,
    quantity: null,
    quantity_max: null,
    unit: null,
    name: original,
    note: '',
    search_names: original ? [original] : [],
    amounts: [],
    parse_confidence: original ? 'low' : 'none',
  };
  if (!original) return result;

  let rest = original;
  const amount = readAmount(rest);
  if (amount) {
    result.quantity = amount.quantity;
    result.unit = amount.unit;
    result.amounts.push({ quantity: amount.quantity, unit: amount.unit, role: 'primary' });
    rest = rest.slice(amount.length);
  } else {
    // Size-qualified count ingredients omit a household unit ("1 medium
    // apple", "2 large eggs"). Recover the number before handling the size
    // qualifier below, then represent the amount as pieces.
    const bare = readBareQuantity(rest);
    if (bare) {
      result.quantity = bare.quantity;
      rest = rest.slice(bare.length);
    }
  }

  const size = SIZE_QUALIFIERS.exec(rest);
  if (size) {
    result.note = appendNote(result.note, size[0].trim());
    rest = rest.slice(size[0].length);
    // "1 medium apple" is a count, which lets a provider's apple portion
    // metadata (or an AI estimate) supply the actual gram weight.
    if (result.quantity != null) {
      result.unit = 'piece';
      result.amounts[0] = { quantity: result.quantity, unit: 'piece', role: 'primary' };
    }
  }

  // A bare count without a size qualifier is also a piece (for example
  // "1 apple"). This is intentionally after the size block so the latter
  // can replace any parsed household unit with piece semantics.
  if (result.quantity != null && !result.unit) {
    result.unit = 'piece';
    result.amounts.push({ quantity: result.quantity, unit: 'piece', role: 'primary' });
  }

  const equivalent = readEquivalent(rest);
  if (equivalent) {
    result.amounts.push({ quantity: equivalent.quantity, unit: equivalent.unit, role: 'equivalent' });
    rest = rest.slice(equivalent.length);
  }

  // Alternatives are often wrapped in parentheses (`milk (or almond milk)`)
  // instead of written as a top-level `or` clause. Keep those alternatives
  // in the searchable names while leaving preparation parentheses as notes.
  const parentheticalAlternatives = [];
  rest = rest.replace(/\(\s*or\s+([^()]*)\)/ig, (_match, alternative) => {
    parentheticalAlternatives.push(alternative);
    return ' ';
  });
  const trailing = /\s*\(([^()]*)\)\s*$/.exec(rest);
  if (trailing && !/^or\s+/i.test(trailing[1].trim())) {
    result.note = appendNote(result.note, trailing[1]);
    rest = rest.slice(0, trailing.index).trim();
  }

  const comma = rest.indexOf(',');
  if (comma >= 0) {
    result.name = cleanName(rest.slice(0, comma));
    result.note = appendNote(result.note, rest.slice(comma + 1));
  } else {
    result.name = cleanName(rest);
  }

  const alternatives = [
    ...result.name.split(/\s+or\s+/i),
    ...parentheticalAlternatives.flatMap(value => String(value).split(/\s+or\s+/i)),
  ].map(stripAlternativeAmount).filter(Boolean);
  result.name = alternatives[0] || result.name;
  result.search_names = [...new Set(alternatives.length ? alternatives : [result.name])].slice(0, 3);
  if (result.quantity != null && result.unit && result.name) result.parse_confidence = 'high';
  else if ((result.quantity != null || result.unit) && result.name) result.parse_confidence = 'medium';
  return result;
}
