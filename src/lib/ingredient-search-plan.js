import { normalizeIngredientName, normalizeIngredientSearchText } from './ingredient-match.js';

function unique(values) {
  const result = [];
  for (const value of values || []) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (clean && !result.some(item => normalizeIngredientName(item) === normalizeIngredientName(clean))) result.push(clean);
  }
  return result;
}

/**
 * Build bounded, ordered automatic-search stages for one ingredient.
 *
 * Stage one contains the primary parsed phrase and the small set of verified
 * preferred-brand phrases. Alternatives and token/noun fallbacks are kept in
 * later stages so common exact ingredients do not fan out into a dozen
 * provider requests before they can be selected.
 */
export function buildIngredientSearchStages(names, preferredBrands = []) {
  const normalizedNames = unique(names).slice(0, 3);
  if (!normalizedNames.length) return [];

  const primary = normalizedNames[0];
  const cleanedPrimary = normalizeIngredientSearchText(primary);
  const preferredQueries = (preferredBrands || [])
    .filter(item => item && typeof item === 'object' && item.offTag)
    .slice(0, 2)
    .map(item => `${cleanedPrimary} ${String(item.name || '').trim()}`)
    .filter(query => normalizeIngredientName(query) !== normalizeIngredientName(cleanedPrimary));

  const exact = unique([primary, cleanedPrimary, ...preferredQueries]);
  const alternatives = unique(normalizedNames.slice(1));
  const fallback = [];
  for (const name of normalizedNames) {
    const cleaned = normalizeIngredientSearchText(name);
    const tokens = cleaned.split(' ').filter(Boolean);
    if (tokens.length > 1) unique([tokens.slice(-2).join(' '), tokens.slice(0, 2).join(' ')])
      .forEach(value => fallback.push(value));
    for (const token of tokens) if (token.length > 2) fallback.push(token);
  }

  const fallbackStage = unique(fallback).filter(value =>
    !exact.some(item => normalizeIngredientName(item) === normalizeIngredientName(value))
    && !alternatives.some(item => normalizeIngredientName(item) === normalizeIngredientName(value))
  );
  return [exact, alternatives, fallbackStage].filter(stage => stage.length);
}
