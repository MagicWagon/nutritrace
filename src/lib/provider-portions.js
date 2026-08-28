/** Provider household-portion normalization shared by search and recipe import. */

const UNIT_ALIASES = new Map([
  ['g', 'g'], ['gram', 'g'], ['grams', 'g'],
  ['mg', 'mg'], ['milligram', 'mg'], ['milligrams', 'mg'],
  ['kg', 'kg'], ['kilogram', 'kg'], ['kilograms', 'kg'],
  ['oz', 'oz'], ['ounce', 'oz'], ['ounces', 'oz'],
  ['lb', 'lb'], ['pound', 'lb'], ['pounds', 'lb'],
  ['ml', 'ml'], ['milliliter', 'ml'], ['milliliters', 'ml'], ['millilitre', 'ml'], ['millilitres', 'ml'],
  ['l', 'l'], ['liter', 'l'], ['liters', 'l'], ['litre', 'l'], ['litres', 'l'],
  ['tsp', 'tsp'], ['teaspoon', 'tsp'], ['teaspoons', 'tsp'],
  ['tbsp', 'tbsp'], ['tablespoon', 'tbsp'], ['tablespoons', 'tbsp'],
  ['fl oz', 'fl oz'], ['fluid ounce', 'fl oz'], ['fluid ounces', 'fl oz'],
  ['c', 'cup'], ['cup', 'cup'], ['cups', 'cup'],
  ['pc', 'piece'], ['piece', 'piece'], ['pieces', 'piece'],
  ['serving', 'serving'], ['servings', 'serving'],
]);

const MASS_UNITS = new Set(['g', 'mg', 'kg', 'oz', 'lb']);
const VOLUME_UNITS = new Set(['ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup']);
const VOLUME_TO_ML = { ml: 1, l: 1000, tsp: 4.92892159375, tbsp: 14.78676478125, 'fl oz': 29.5735295625, cup: 236.5882365 };

export function normalizePortionUnit(value) {
  const raw = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (UNIT_ALIASES.has(raw)) return UNIT_ALIASES.get(raw);
  if (raw.endsWith('ies') && raw.length > 4) return `${raw.slice(0, -3)}y`;
  if (raw.endsWith('es') && raw.length > 4) return raw.slice(0, -2);
  if (raw.endsWith('s') && raw.length > 3) return raw.slice(0, -1);
  return raw;
}

export function unitKind(unit) {
  const key = normalizePortionUnit(unit);
  if (MASS_UNITS.has(key)) return 'mass';
  if (VOLUME_UNITS.has(key)) return 'volume';
  return key ? 'portion' : null;
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, c => c.toUpperCase());
}

const FULL_NAMES = {
  g: 'Gram', mg: 'Milligram', kg: 'Kilogram', oz: 'Ounce', lb: 'Pound',
  ml: 'Milliliter', l: 'Liter', tsp: 'Teaspoon', tbsp: 'Tablespoon',
  'fl oz': 'Fluid Ounce', cup: 'Cup', piece: 'Piece', serving: 'Serving',
};

export function displayUnitName(unit, amount = 1, locale = 'en') {
  const key = normalizePortionUnit(unit);
  const intlUnit = ({ g: 'gram', mg: 'milligram', kg: 'kilogram', oz: 'ounce', lb: 'pound', ml: 'milliliter', l: 'liter',
    tsp: 'teaspoon', tbsp: 'tablespoon', 'fl oz': 'fluid-ounce', cup: 'cup' })[key];
  if (intlUnit) {
    try {
      const parts = new Intl.NumberFormat(locale || 'en', { style: 'unit', unit: intlUnit, unitDisplay: 'long' }).formatToParts(Number(amount) || 1);
      const label = parts.filter(part => part.type === 'unit').map(part => part.value).join(' ').trim();
      if (label) return label.replace(/^\w/u, letter => letter.toLocaleUpperCase(locale || 'en'));
    } catch {}
  }
  const singular = FULL_NAMES[key] || titleCase(key || 'Serving');
  return Number(amount) === 1 ? singular : `${singular}${singular.endsWith('s') ? '' : 's'}`;
}

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanAltUnit(unit, grams, metadata = {}) {
  const abbr = normalizePortionUnit(unit);
  const value = finitePositive(grams);
  if (!abbr || !value || MASS_UNITS.has(abbr) || VOLUME_UNITS.has(abbr) && !['cup', 'tsp', 'tbsp', 'fl oz'].includes(abbr)) return null;
  return {
    abbr,
    grams: Math.round(value * 1000) / 1000,
    ...(metadata.label ? { label: String(metadata.label).slice(0, 160) } : {}),
    ...(metadata.source ? { source: String(metadata.source).slice(0, 40) } : {}),
    ...(metadata.source_id ? { source_id: String(metadata.source_id).slice(0, 160) } : {}),
    ...(finitePositive(metadata.source_amount) ? { source_amount: finitePositive(metadata.source_amount) } : {}),
    ...(finitePositive(metadata.source_grams) ? { source_grams: finitePositive(metadata.source_grams) } : {}),
  };
}

export function normalizeAltUnits(rows) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const clean = cleanAltUnit(row?.abbr || row?.unit, row?.grams, row || {});
    if (!clean) continue;
    const previous = unique.get(clean.abbr);
    if (!previous || (!previous.source && clean.source)) unique.set(clean.abbr, clean);
  }
  return [...unique.values()];
}

function parseHouseholdMeasure(text) {
  const cleaned = String(text || '').replace(/\([^)]*(?:g|gram|grams)\b[^)]*\)/ig, ' ').trim();
  const match = cleaned.match(/(?:^|\s)(\d+(?:\.\d+)?|\d+\/\d+)\s*([a-zA-Z][a-zA-Z ._-]*)/);
  if (!match) return null;
  let amount;
  if (match[1].includes('/')) {
    const [a, b] = match[1].split('/').map(Number);
    amount = b ? a / b : null;
  } else amount = Number(match[1]);
  const unit = normalizePortionUnit(match[2].trim().split(/\s+(?:of|\(|-|,)/)[0]);
  return finitePositive(amount) && unit ? { amount, unit } : null;
}

export function parseOffAltUnits(product) {
  const text = String(product?.serving_size || '').trim();
  if (!text) return [];
  const gramMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:g|gram|grams)\b/i);
  let grams = finitePositive(gramMatch?.[1]);
  const servingQuantity = finitePositive(product?.serving_quantity);
  const servingUnit = normalizePortionUnit(product?.serving_quantity_unit);
  if (!grams && servingQuantity && (!servingUnit || servingUnit === 'g')) grams = servingQuantity;
  const household = parseHouseholdMeasure(text.replace(gramMatch?.[0] || '', ' '));
  if (!grams || !household || MASS_UNITS.has(household.unit)) return [];
  const row = cleanAltUnit(household.unit, grams / household.amount, {
    label: text, source: 'openfoodfacts', source_id: product?.code || product?._id || product?.id,
    source_amount: household.amount, source_grams: grams,
  });
  return row ? [row] : [];
}

export function parseUsdaAltUnits(item) {
  const rows = [];
  const sourceId = item?.fdcId;
  for (const portion of Array.isArray(item?.foodPortions) ? item.foodPortions : []) {
    const described = parseHouseholdMeasure(portion?.portionDescription || portion?.modifier);
    const amount = finitePositive(portion?.amount) || described?.amount || 1;
    const grams = finitePositive(portion?.gramWeight);
    const measure = portion?.measureUnit?.abbreviation || portion?.measureUnit?.name || '';
    const normalizedMeasure = normalizePortionUnit(measure);
    const unit = (!normalizedMeasure || ['undetermined', 'quantity not specified'].includes(normalizedMeasure))
      ? (described?.unit || normalizePortionUnit(portion?.modifier))
      : normalizedMeasure;
    if (!grams || !unit || MASS_UNITS.has(unit)) continue;
    const row = cleanAltUnit(unit, grams / amount, {
      label: portion?.portionDescription || `${amount} ${measure}`,
      source: 'usda', source_id: sourceId, source_amount: amount, source_grams: grams,
    });
    if (row) rows.push(row);
  }
  const household = parseHouseholdMeasure(item?.householdServingFullText);
  const servingGrams = finitePositive(item?.servingSize);
  const servingUnit = normalizePortionUnit(item?.servingSizeUnit || 'g');
  if (household && servingGrams && servingUnit === 'g') {
    const row = cleanAltUnit(household.unit, servingGrams / household.amount, {
      label: item.householdServingFullText, source: 'usda', source_id: sourceId,
      source_amount: household.amount, source_grams: servingGrams,
    });
    if (row) rows.push(row);
  }
  return normalizeAltUnits(rows);
}

export function altUnitGrams(food, unit) {
  const key = normalizePortionUnit(unit);
  const match = normalizeAltUnits(food?.alt_units).find(row => row.abbr === key);
  return match?.grams || null;
}

export function conversionProvenance(food, unit) {
  const key = normalizePortionUnit(unit);
  return normalizeAltUnits(food?.alt_units).find(row => row.abbr === key)?.source || null;
}

export function densityFromAltUnits(rows) {
  for (const row of normalizeAltUnits(rows)) {
    const ml = VOLUME_TO_ML[row.abbr];
    if (ml && Number(row.grams) > 0) return Math.round((Number(row.grams) / ml) * 1_000_000) / 1_000_000;
  }
  return null;
}
