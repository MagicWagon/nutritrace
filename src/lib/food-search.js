import { API, USDA } from './api.js';
import { normalizeIngredientName } from './ingredient-match.js';

/**
 * Small client-side scheduler for provider calls. The server proxy has a
 * fixed-window limit, so limiting concurrency alone is not sufficient: a
 * recipe can still start dozens of requests in a few milliseconds. Jobs are
 * paced at one per second by default (the proxy's 60/minute budget), while
 * callers can give interactive searches a higher priority than background
 * matching work.
 */
export function createProviderRequestScheduler({ maxConcurrent = 4, minIntervalMs = 1000 } = {}) {
  let active = 0;
  let sequence = 0;
  let nextStartAt = 0;
  let timer = null;
  const queue = [];

  const pump = () => {
    // Drop superseded background work before applying the pacing interval.
    // Without this pass, a newer recipe/search generation would still spend
    // one paced slot per stale job merely to discover that it is obsolete.
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (!queue[index].isCurrent()) {
        const [stale] = queue.splice(index, 1);
        stale.resolve({ cancelled: true });
      }
    }
    if (active >= maxConcurrent || queue.length === 0) return;
    const now = Date.now();
    const delay = Math.max(0, nextStartAt - now);
    if (delay > 0) {
      if (timer == null) timer = setTimeout(() => { timer = null; pump(); }, delay);
      return;
    }

    queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    const job = queue.shift();
    if (!job.isCurrent()) {
      job.resolve({ cancelled: true });
      pump();
      return;
    }

    active += 1;
    nextStartAt = Math.max(now, nextStartAt) + minIntervalMs;
    Promise.resolve()
      .then(job.task)
      // A request that was already in flight cannot be aborted portably, but
      // its value must not leak into a newer recipe/search generation.
      .then(value => job.isCurrent() ? value : { cancelled: true }, job.reject)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
    // Fill any other available concurrent slots after this job starts. The
    // interval still applies to each start, so this only matters when the
    // caller supplies a zero interval (for tests or a direct API client).
    pump();
  };

  return (task, { priority = 0, isCurrent = () => true } = {}) => new Promise((resolve, reject) => {
    queue.push({ task, priority: Number(priority) || 0, isCurrent, resolve, reject, sequence: sequence++ });
    pump();
  });
}

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
  if (!q) return { items: [], page, hasMore: false, totalHits: 0, rateLimited: false, retryAfter: null };
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
  return { items: [], page, hasMore: false, totalHits: 0, rateLimited: false, retryAfter: null };
}

/**
 * Shared Local/OFF/USDA search primitive for Add Food-compatible pickers.
 * Every provider settles independently so an outage never erases other hits.
 */
export async function searchFoodCatalogsDetailed({
  query, source = 'all', localFoods = [], offEnabled = true,
  usdaEnabled = false, usdaApiKey = '', limit = 50, schedule = task => task(),
  priority = 0, isCurrent = () => true,
} = {}) {
  const q = String(query || '').trim();
  if (!q) return { items: [], rateLimitedSources: [], retryAfter: null, unavailableSources: [], cancelled: false };
  const jobs = [];
  if (source === 'all' || source === 'local') jobs.push(Promise.resolve(searchLocalFoods(localFoods, q, limit)));
  if ((source === 'all' || source === 'openfoodfacts' || source === 'off') && offEnabled) {
    jobs.push(Promise.resolve().then(() => schedule(() => searchFoodProviderPage({ query: q, source: 'off', page: 1, limit }), { priority, isCurrent }))
      .then(result => ({ source: 'openfoodfacts', result }), error => ({ source: 'openfoodfacts', error })));
  }
  if ((source === 'all' || source === 'usda') && usdaEnabled && usdaApiKey) {
    jobs.push(Promise.resolve().then(() => schedule(() => searchFoodProviderPage({ query: q, source: 'usda', page: 1, limit, usdaApiKey }), { priority, isCurrent }))
      .then(result => ({ source: 'usda', result }), error => ({ source: 'usda', error })));
  }
  const settled = await Promise.allSettled(jobs);
  const items = [];
  const rateLimitedSources = [];
  const unavailableSources = [];
  let retryAfter = null;
  let cancelled = false;
  for (const entry of settled) {
    if (entry.status === 'rejected') continue;
    // Local searches are still plain arrays for compatibility.
    if (Array.isArray(entry.value)) {
      items.push(...entry.value);
      continue;
    }
    const { source: provider, result, error } = entry.value || {};
    if (error) {
      unavailableSources.push(provider || 'provider');
      continue;
    }
    if (result?.cancelled) {
      cancelled = true;
      continue;
    }
    if (result?.rateLimited) {
      rateLimitedSources.push(provider);
      const wait = Number(result.retryAfter);
      if (Number.isFinite(wait) && wait > 0) retryAfter = retryAfter == null ? wait : Math.max(retryAfter, wait);
    } else if (result?.unavailable) {
      unavailableSources.push(provider);
    }
    const providerItems = Array.isArray(result?.items) ? result.items : [];
    items.push(...providerItems.slice(0, limit).map(food => ({ ...food, _candidateProvider: provider })));
  }
  return { items, rateLimitedSources: [...new Set(rateLimitedSources)], retryAfter, unavailableSources: [...new Set(unavailableSources)], cancelled };
}

/** Backward-compatible array-returning wrapper used by existing pickers. */
export async function searchFoodCatalogs(options = {}) {
  const result = await searchFoodCatalogsDetailed(options);
  return result.items;
}
