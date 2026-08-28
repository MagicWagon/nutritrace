import { API, USDA } from './api.js';
import { normalizeIngredientName } from './ingredient-match.js';

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = a[i - 1] === b[j - 1] ? previous : 1 + Math.min(previous, row[j - 1], old);
      previous = old;
    }
  }
  return row[b.length];
}

/** Same local name/brand matching policy used by the Add Food catalogue. */
export function foodSearchMatches(food, query) {
  const combined = normalizeIngredientName(`${food?.name || ''} ${food?.brand || ''}`);
  const wanted = normalizeIngredientName(query);
  if (!wanted) return true;
  if (combined.includes(wanted)) return true;
  const queryWords = wanted.split(' ');
  if (queryWords.every(word => combined.includes(word))) return true;
  const targetWords = combined.split(' ');
  return queryWords.every(word => word.length >= 4 && targetWords.some(target => target.length >= 3 && editDistance(word, target) <= 1));
}

export function searchLocalFoods(foods, query, limit = 50) {
  return (foods || []).filter(food => foodSearchMatches(food, query)).slice(0, limit)
    .map(food => ({ ...food, _candidateProvider: 'local', _localFoodId: food.id }));
}

/**
 * The provider-page call shared by Add Food and every ingredient picker.
 * Keeping pagination here ensures each surface gets the same OFF country /
 * language behavior and the same USDA mapping.
 */
export async function searchFoodProviderPage({
  query, source, page = 1, limit, usdaApiKey = '',
} = {}) {
  const q = String(query || '').trim();
  if (!q) return { items: [], page, hasMore: false, totalHits: 0 };
  if (source === 'openfoodfacts' || source === 'off') {
    return limit == null
      ? API.searchByNameWithMeta(q, page)
      : API.searchByNameWithMeta(q, page, limit);
  }
  if (source === 'usda') {
    return limit == null
      ? USDA.searchByNameWithMeta(q, page, usdaApiKey)
      : USDA.searchByNameWithMeta(q, page, usdaApiKey, limit);
  }
  return { items: [], page, hasMore: false, totalHits: 0 };
}

/**
 * Shared Local/OFF/USDA search primitive for Add Food-compatible pickers.
 * Every provider settles independently so an outage never erases other hits.
 */
export async function searchFoodCatalogs({
  query, source = 'all', localFoods = [], offEnabled = true,
  usdaEnabled = false, usdaApiKey = '', limit = 50, schedule = task => task(),
} = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const jobs = [];
  if (source === 'all' || source === 'local') jobs.push(Promise.resolve(searchLocalFoods(localFoods, q, limit)));
  if ((source === 'all' || source === 'openfoodfacts' || source === 'off') && offEnabled) {
    jobs.push(schedule(() => searchFoodProviderPage({ query: q, source: 'off', page: 1, limit })).then(result => (result.items || []).slice(0, limit)
      .map(food => ({ ...food, _candidateProvider: 'openfoodfacts' }))));
  }
  if ((source === 'all' || source === 'usda') && usdaEnabled && usdaApiKey) {
    jobs.push(schedule(() => searchFoodProviderPage({ query: q, source: 'usda', page: 1, limit, usdaApiKey })).then(result => (result.items || []).slice(0, limit)
      .map(food => ({ ...food, _candidateProvider: 'usda' }))));
  }
  return (await Promise.allSettled(jobs)).flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
