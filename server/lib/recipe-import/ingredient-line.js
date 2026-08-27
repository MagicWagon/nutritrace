const FRACTIONS = Object.freeze({
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4,
  '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 1 / 10,
  '⅓': 1 / 3, '⅔': 2 / 3, '⅕': 1 / 5, '⅖': 2 / 5,
  '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
});

const NUMBER_WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 });

const UNIT_ALIASES = new Map(Object.entries({
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
  pinch: 'pinch', pinches: 'pinch', dash: 'dash', dashes: 'dash',
  clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice',
  can: 'can', cans: 'can', package: 'package', packages: 'package', pkg: 'package',
  piece: 'piece', pieces: 'piece', sprig: 'sprig', sprigs: 'sprig',
  stalk: 'stalk', stalks: 'stalk', bunch: 'bunch', bunches: 'bunch',
}));

function parseNumericToken(token) {
  if (!token) return null;
  const normalized = token.replace(/,/g, '.').trim().toLowerCase();
  if (NUMBER_WORDS[normalized] != null) return NUMBER_WORDS[normalized];
  if (FRACTIONS[normalized] != null) return FRACTIONS[normalized];
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  const frac = /^(\d+)\/(\d+)$/.exec(normalized);
  if (frac && Number(frac[2])) return Number(frac[1]) / Number(frac[2]);
  const mixed = /^(\d+)[ -](\d+)\/(\d+)$/.exec(normalized);
  if (mixed && Number(mixed[3])) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const vulgarMixed = /^(\d+)([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/.exec(normalized);
  if (vulgarMixed) return Number(vulgarMixed[1]) + FRACTIONS[vulgarMixed[2]];
  return null;
}

function cleanName(value) {
  return value.replace(/^of\s+/i, '').replace(/^[,;:\-–—]\s*/, '').replace(/\s+/g, ' ').trim();
}

/** Best-effort parser. The original line is always authoritative. */
export function parseIngredientLine(input) {
  const original = String(input ?? '').replace(/\s+/g, ' ').trim();
  const out = {
    original_text: original,
    quantity: null,
    quantity_max: null,
    unit: null,
    name: original,
    note: '',
    package_size: null,
    parse_confidence: original ? 'low' : 'none',
  };
  if (!original) return out;

  let rest = original;
  const compactRange = /^(\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s*[-–—]\s*(\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])(?=\s)\s*/.exec(rest);
  if (compactRange && !/^\d+-\d+\/\d+/.test(rest)) {
    out.quantity = parseNumericToken(compactRange[1]);
    out.quantity_max = parseNumericToken(compactRange[2]);
    rest = rest.slice(compactRange[0].length);
  }
  // "1 1/2", "1-1/2", "1½", vulgar fractions, decimals, and small number words.
  const quantityMatch = out.quantity == null
    ? /^(\d+\s+\d+\/\d+|\d+-\d+\/\d+|\d+[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|one|two|three|four|five|six)(?=\s|$)\s*/i.exec(rest)
    : null;
  if (quantityMatch) {
    out.quantity = parseNumericToken(quantityMatch[1]);
    rest = rest.slice(quantityMatch[0].length);

    // A spaced range such as "1 - 2 cups" or compact "1–2 cups".
    const range = /^(?:-|–|—|to)\s*(\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s*/i.exec(rest);
    if (range) {
      out.quantity_max = parseNumericToken(range[1]);
      rest = rest.slice(range[0].length);
    }
  }

  // Parenthetical or hyphenated package size: "one (14 ounce) can" / "1 14-ounce can".
  const packageMatch = /^\(?\s*(\d+(?:[.,]\d+)?)\s*[- ]\s*(ounces?|oz|grams?|g|kilograms?|kg|millilit(?:er|re)s?|ml)\s*\)?\s*/i.exec(rest);
  if (packageMatch) {
    out.package_size = { amount: Number(packageMatch[1].replace(',', '.')), unit: UNIT_ALIASES.get(packageMatch[2].toLowerCase()) || packageMatch[2].toLowerCase() };
    rest = rest.slice(packageMatch[0].length);
  }

  const unitMatch = /^([A-Za-z]+)\.?\b\s*/.exec(rest);
  if (unitMatch) {
    const canonical = UNIT_ALIASES.get(unitMatch[1].toLowerCase());
    if (canonical) {
      out.unit = canonical;
      rest = rest.slice(unitMatch[0].length);
    }
  }

  // Preserve preparation text separately where the conventional comma form is clear.
  const comma = rest.indexOf(',');
  if (comma >= 0) {
    out.name = cleanName(rest.slice(0, comma));
    out.note = rest.slice(comma + 1).trim();
  } else {
    out.name = cleanName(rest);
  }

  const hasUsefulName = out.name.length > 0;
  if (out.quantity != null && out.unit && hasUsefulName) out.parse_confidence = 'high';
  else if ((out.quantity != null || out.unit) && hasUsefulName) out.parse_confidence = 'medium';
  return out;
}

export { UNIT_ALIASES };
