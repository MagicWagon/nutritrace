/** Display helpers for recipe ingredient rows.
 *
 * Recipe items keep their entered amount/unit for editing and provenance.
 * Gram weight is a separate derived value, backed by provider portions when
 * available. These helpers are shared by the editor and the saved-recipe
 * detail sheet so the two views never disagree about what was imported.
 */

import { altUnitGrams, displayUnitName, normalizePortionUnit } from './provider-portions.js';
import { unitToGrams } from './units.js';
import { parseRecipeIngredientText } from './recipe-ingredient.js';

const VOLUME_UNITS = new Set(['ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup']);
const RECIPE_UNITS = new Set([
  'g', 'mg', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup',
  'pinch', 'dash', 'clove', 'slice', 'piece', 'can', 'package', 'sprig',
  'stalk', 'bunch', 'serving', 'scoop', 'stick', 'biscuit', 'cookie', 'bar',
  'packet', 'jar', 'bag', 'box',
]);

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function sourceAmount(item) {
  const source = item?.source_ingredient;
  if (!source || typeof source !== 'object') return null;
  let amount = positive(source.original_quantity);
  let unit = normalizePortionUnit(source.original_unit);
  // Older Mealie payloads put a size adjective (for example `medium`) in
  // the structured unit field. It is not a measurable unit; prefer the
  // original display text in that case so it can become `1 Piece` and use a
  // provider portion when one is available.
  const unitLooksUsable = unit && RECIPE_UNITS.has(unit);
  if (!(amount && unitLooksUsable) && source.original_text) {
    const parsed = parseRecipeIngredientText(source.original_text);
    amount = amount || positive(parsed.quantity);
    unit = (unitLooksUsable ? unit : normalizePortionUnit(parsed.unit)) || unit;
  }
  if (!(amount && unit)) {
    const primary = Array.isArray(source.amounts)
      ? source.amounts.find(row => row?.role === 'primary' && positive(row?.quantity) && row?.unit)
      : null;
    amount = amount || positive(primary?.quantity);
    unit = unit || normalizePortionUnit(primary?.unit);
  }
  return amount && unit ? { amount, unit } : null;
}

/** Return the recipe amount/unit, retaining the source amount for legacy rows. */
export function recipeItemAmount(item) {
  const explicitAmount = positive(item?.recipe_portion);
  const explicitUnit = normalizePortionUnit(item?.recipe_unit);
  if (explicitAmount && explicitUnit) return { amount: explicitAmount, unit: explicitUnit };

  // Older imports did not stamp recipe_portion/recipe_unit and some were
  // persisted as the selected food's default 100 g serving. Their
  // source_ingredient still contains the original line, so recover it here.
  const source = sourceAmount(item);
  if (source) {
    const currentAmount = positive(item?.portion);
    const currentUnit = normalizePortionUnit(item?.unit);
    if (!currentAmount || !currentUnit || (currentAmount === 100 && currentUnit === 'g')) return source;
  }

  return {
    amount: positive(item?.portion ?? item?.amount) || 100,
    unit: normalizePortionUnit(item?.unit) || normalizePortionUnit(item?.unit_name) || 'g',
  };
}

function sourceEquivalentGrams(item) {
  const amounts = item?.source_ingredient?.amounts;
  if (!Array.isArray(amounts)) return null;
  const equivalent = amounts.find(row => row?.role === 'equivalent');
  if (!equivalent) return null;
  const amount = positive(equivalent.quantity);
  const unit = normalizePortionUnit(equivalent.unit);
  if (!amount || !unit) return null;
  if (unit === 'g') return amount;
  if (unit === 'kg') return amount * 1000;
  return null;
}

function sameMeasurement(a, b) {
  if (!a || !b) return false;
  return Math.abs(Number(a.amount) - Number(b.amount)) < 0.000001
    && normalizePortionUnit(a.unit) === normalizePortionUnit(b.unit);
}

/** Resolve the item's total gram weight, or null when no safe conversion exists. */
export function recipeItemGrams(item) {
  const { amount, unit } = recipeItemAmount(item);
  const quantity = positive(item?.quantity) || 1;
  const explicit = positive(item?.equivalent_grams);
  if (explicit) return explicit * quantity;

  const sourceEquivalent = sourceEquivalentGrams(item);
  // A source equivalent belongs to the original recipe line. Do not keep
  // using it after a user edits the row's amount/unit; otherwise changing
  // "1 Cup" to "2 Cups" would still display the old gram weight. Imported
  // rows stamp `equivalent_grams` when they are committed, and legacy rows
  // only reach this fallback while their current measurement still matches
  // the source line.
  if (sourceEquivalent && sameMeasurement(recipeItemAmount(item), sourceAmount(item))) {
    return sourceEquivalent * quantity;
  }

  const alt = altUnitGrams(item, unit);
  if (alt) return amount * alt * quantity;

  const factor = unitToGrams(unit);
  if (factor == null) return null;
  // The generic unit table is useful for mass units, but volume units are
  // food-specific. Do not present a water-equivalent cup/tablespoon value as
  // fact for oats, oils, honey, etc.; require provider portion data or a
  // saved density (AI estimates are persisted as equivalent_grams above).
  if (VOLUME_UNITS.has(unit)) {
    const density = positive(item?.density_g_ml);
    if (!density) return null;
    return amount * factor * density * quantity;
  }
  const grams = amount * factor;
  return grams * quantity;
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function recipeItemAmountLabel(item, locale = 'en') {
  const { amount, unit } = recipeItemAmount(item);
  return `${formatNumber(amount)} ${displayUnitName(unit, amount, locale)}`;
}

export function recipeItemGramLabel(item, locale = 'en') {
  const grams = recipeItemGrams(item);
  if (!(Number.isFinite(grams) && grams > 0)) return '';
  return `${formatNumber(grams)} ${displayUnitName('g', grams, locale)}`;
}

/**
 * Restore the entered recipe measurement on rows written by older importers.
 * Those rows contain source_ingredient provenance but were persisted as the
 * selected food's default 100 g serving. New rows already carry the explicit
 * recipe_portion/recipe_unit pair and pass through unchanged.
 *
 * Nutrition was historically stored for that default 100 g row. When the
 * source measurement has a deterministic gram conversion, scale the snapshot
 * at the same time; when it does not, preserve the nutrition snapshot but do
 * not invent a gram value. This is intentionally a pure helper so callers can
 * migrate in-memory drafts without writing until the user saves.
 */
export function restoreRecipeItemMeasurement(item) {
  if (!item || typeof item !== 'object' || !item.source_ingredient) return item;
  if (positive(item.recipe_portion) && normalizePortionUnit(item.recipe_unit)) return item;
  const currentAmount = positive(item.portion);
  const currentUnit = normalizePortionUnit(item.unit);
  if (!(currentAmount === 100 && currentUnit === 'g')) return item;
  const source = sourceAmount(item);
  if (!source) return item;

  const restored = {
    ...item,
    portion: source.amount,
    unit: source.unit,
    recipe_portion: source.amount,
    recipe_unit: source.unit,
  };
  const grams = recipeItemGrams(restored);
  if (!(Number.isFinite(grams) && grams > 0)) return restored;
  restored.equivalent_grams = grams;
  if (restored.nutrition && typeof restored.nutrition === 'object') {
    const scale = grams / 100;
    restored.nutrition = Object.fromEntries(
      Object.entries(restored.nutrition).map(([key, value]) => [
        // `_derived` is metadata used by NutritionFactsBox; scaling it as a
        // number would replace the flags with 0 and make the migrated row
        // lose its provenance. Numeric nutriments are the only values that
        // represent the legacy 100 g snapshot.
        key,
        key === '_derived' ? value : (Number(value) || 0) * scale,
      ]),
    );
  }
  return restored;
}

export function restoreRecipeItemMeasurements(items) {
  return (Array.isArray(items) ? items : []).map(restoreRecipeItemMeasurement);
}
