const MASS_TO_G = Object.freeze({ g: 1, mg: 0.001, kg: 1000, oz: 28.349523125, lb: 453.59237 });
const VOLUME_TO_ML = Object.freeze({ ml: 1, l: 1000, tsp: 4.92892159375, tbsp: 14.78676478125, 'fl oz': 29.5735295625, cup: 236.5882365 });

function unitKey(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ({ c: 'cup', cups: 'cup', teaspoons: 'tsp', teaspoon: 'tsp', tablespoons: 'tbsp', tablespoon: 'tbsp',
    grams: 'g', gram: 'g', kilograms: 'kg', kilogram: 'kg', milliliters: 'ml', milliliter: 'ml',
    litres: 'l', litre: 'l', liters: 'l', liter: 'l', ounces: 'oz', ounce: 'oz', pounds: 'lb', pound: 'lb' })[raw] || raw;
}

function altUnitGrams(food, unit) {
  const target = unitKey(unit);
  const rows = Array.isArray(food?.alt_units) ? food.alt_units : [];
  const match = rows.find(row => unitKey(row?.abbr) === target && Number(row?.grams) > 0);
  return match ? Number(match.grams) : null;
}

function measure(amount, unit, food) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  const key = unitKey(unit);
  const alt = altUnitGrams(food, key);
  if (alt != null) return { system: 'mass', value: value * alt };
  if (MASS_TO_G[key]) return { system: 'mass', value: value * MASS_TO_G[key] };
  if (VOLUME_TO_ML[key]) return { system: 'volume', value: value * VOLUME_TO_ML[key] };
  return { system: 'opaque', value, unit: key };
}

function inSameFrame(value, targetSystem, food) {
  if (!value) return null;
  if (value.system === targetSystem) return value.value;
  const density = Number(food?.density_g_ml);
  if (!Number.isFinite(density) || density <= 0) return null;
  if (value.system === 'volume' && targetSystem === 'mass') return value.value * density;
  if (value.system === 'mass' && targetSystem === 'volume') return value.value / density;
  return null;
}

/** Return an exact food-aware nutrition scale, or null when user input is required. */
export function resolveAmountFactor(food, amount, unit) {
  const original = measure(food?.portion, food?.unit, food);
  const requested = measure(amount, unit, food);
  if (!original || !requested) return null;
  if (original.system === 'opaque' || requested.system === 'opaque') {
    return original.system === 'opaque' && requested.system === 'opaque' && original.unit === requested.unit
      ? requested.value / original.value
      : null;
  }
  const requestedValue = inSameFrame(requested, original.system, food);
  return requestedValue != null && original.value > 0 ? requestedValue / original.value : null;
}
