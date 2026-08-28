<script>
  import { onDestroy, onMount } from 'svelte';
  import { push, replace } from 'svelte-spa-router';
  import { _, locale } from 'svelte-i18n';
  import { NtApi, API, USDA } from '../lib/api.js';
  import { isNative, getServerUrl } from '../lib/platform.js';
  import { showSuccess, showError } from '../stores/toast.js';
  import { editorState } from '../stores/editorState.js';
  import { offEnabled, offSearchLanguage, offSearchCountry, usdaEnabled, usdaApiKey, aiEffectivelyEnabled, preferredFoodBrands, recipeImportUsePreferredBrands, recipeImportPreferredBrandsFirst } from '../stores/settings.js';
  import { unitToGrams, unitSystem } from '../lib/units.js';
  import { prepareRecipeImportDraft, persistRecipeImportDraft, RECIPE_IMPORT_DRAFT_KEY } from '../lib/recipe-import-draft.js';
  import { isStrongIngredientCandidate, normalizeIngredientName, normalizeIngredientSearchText, rankIngredientCandidates } from '../lib/ingredient-match.js';
  import { estimateIngredientGramsWithAI } from '../lib/ingredient-ai.js';
  import { altUnitGrams, conversionProvenance, displayUnitName, normalizePortionUnit } from '../lib/provider-portions.js';
  import { parseRecipeIngredientText } from '../lib/recipe-ingredient.js';
  import { createProviderRequestScheduler, searchFoodCatalogsDetailed, searchLocalFoods } from '../lib/food-search.js';
  import { buildIngredientSearchStages } from '../lib/ingredient-search-plan.js';
  import Sheet from '../components/ui/Sheet.svelte';
  import { Mealie } from '../lib/mealieApi.js';

  let url = '';
  let loading = false;
  let saving = false;
  let result = null;
  let selectedIndex = 0;
  let foods = [];
  let resolutions = [];
  let conflict = null;
  let restoringDraft = true;
  const serverRequired = isNative && !getServerUrl();
  const providerSearchCache = new Map();
  let searchSheetOpen = false;
  let searchRowIndex = -1;
  let searchQuery = '';
  let searchSource = 'all';
  let sheetSearching = false;
  let sheetResults = [];
  let sheetRateLimitedSources = [];
  let sheetUnavailableSources = [];
  let sheetRetryAfter = null;
  let searchTimer;
  let searchSequence = 0;
  let conversionEstimateQueue = Promise.resolve();
  let autoRematchTimer;
  let autoMatchGeneration = 0;
  const autoRetryTimers = new Map();
  // Leave headroom under the proxy's 60/minute API bucket for winner
  // hydration and for interactive work. The exact-first planner normally
  // uses far fewer calls; this guard covers recipes with no exact candidates
  // so token fallbacks cannot fan out past the server budget.
  const AUTO_PROVIDER_CALL_LIMIT = 50;
  let automaticProviderCalls = 0;
  let automaticProviderWindowStarted = 0;
  const providerRequestScheduler = createProviderRequestScheduler({ maxConcurrent: 4, minIntervalMs: 1000 });

  onMount(async () => {
    const transientDraft = editorState.recipeImportDraft;
    let pending = transientDraft;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(RECIPE_IMPORT_DRAFT_KEY) || 'null'); } catch {}
    if (!pending) {
      pending = saved?.result || null;
    }
    editorState.recipeImportDraft = null;
    const prepared = prepareRecipeImportDraft(pending, transientDraft ? 0 : saved?.selectedIndex);
    if (!prepared) {
      if (pending) {
        try { localStorage.removeItem(RECIPE_IMPORT_DRAFT_KEY); } catch {}
      }
      restoringDraft = false;
      return;
    }

    foods = await NtApi.getFoods().catch(() => []);
    selectedIndex = prepared.selectedIndex;
    if (!transientDraft && Array.isArray(saved?.resolutions) && saved.resolutions.length === prepared.recipe.ingredients?.length) {
      resolutions = saved.resolutions;
    } else {
      initializeResolutions(prepared.recipe);
    }
    result = prepared.result;
    restoringDraft = false;
  });

  onDestroy(() => {
    clearTimeout(autoRematchTimer);
    clearTimeout(searchTimer);
    for (const timer of autoRetryTimers.values()) clearTimeout(timer);
    autoRetryTimers.clear();
    // Active provider calls cannot be aborted by the shared scheduler, but
    // all queued work observes these generations and will be ignored.
    autoMatchGeneration += 1;
    searchSequence += 1;
  });

  $: recipe = result?.recipes?.[selectedIndex] || null;
  $: matchSettingsKey = `${$offEnabled}:${$offSearchLanguage}:${$offSearchCountry}:${$usdaEnabled}:${$usdaApiKey}:${$recipeImportUsePreferredBrands}:${$recipeImportPreferredBrandsFirst}:${JSON.stringify($preferredFoodBrands)}`;
  $: if (!restoringDraft && result && matchSettingsKey) {
    scheduleAutoMatch();
  }
  $: unresolvedReady = resolutions.every(row => (selectedFood(row) && !conversionRequired(row)) || row.acknowledged);
  $: if (result && typeof localStorage !== 'undefined') {
    persistRecipeImportDraft(localStorage, result, selectedIndex, resolutions);
  }

  function normalizeName(value) {
    return normalizeIngredientName(value);
  }

  function ingredientSearchNames(ingredient) {
    const rawNames = Array.isArray(ingredient?.search_names) ? ingredient.search_names : [ingredient?.name];
    const names = rawNames.map(name => String(name || '').trim()).filter(Boolean);
    const brand = String(ingredient?.brand || '').trim();
    if (brand && names[0] && !normalizeName(names[0]).includes(normalizeName(brand))) {
      names.unshift(`${brand} ${names[0]}`);
    }
    return [...new Set(names)].slice(0, 3);
  }


  function preferredIngredientAmount(ingredient, fallbackFood = null) {
    // Keep the recipe's primary household measurement in the editable row.
    // An explicit parenthetical metric amount ("1 cup (120 g)") is a
    // conversion hint, not a replacement for the amount the cook entered.
    const primary = (ingredient?.amounts || []).find(amount =>
      amount?.role === 'primary' && Number(amount?.quantity) > 0 && amount?.unit
    );
    if (primary) return { portion: Number(primary.quantity), unit: normalizePortionUnit(primary.unit) || primary.unit };
    const sourceAmount = Number(ingredient?.quantity);
    const hasSourceAmount = Number.isFinite(sourceAmount) && sourceAmount > 0;
    const equivalent = (ingredient?.amounts || []).find(amount =>
      amount?.role === 'equivalent' && ['g', 'kg'].includes(String(amount?.unit || '').toLowerCase())
      && Number(amount?.quantity) > 0
    );
    if (!hasSourceAmount && equivalent) {
      return { portion: Number(equivalent.quantity), unit: normalizePortionUnit(equivalent.unit) || equivalent.unit };
    }
    return {
      portion: hasSourceAmount ? sourceAmount : (fallbackFood?.portion || 1),
      unit: normalizePortionUnit(ingredient?.unit) || normalizePortionUnit(fallbackFood?.unit) || ingredient?.unit || fallbackFood?.unit || 'serving',
    };
  }

  function explicitEquivalentGrams(ingredient) {
    const equivalent = (ingredient?.amounts || []).find(amount =>
      amount?.role === 'equivalent' && Number(amount?.quantity) > 0
      && ['g', 'kg'].includes(normalizePortionUnit(amount?.unit))
    );
    if (!equivalent) return null;
    const grams = Number(equivalent.quantity) * (normalizePortionUnit(equivalent.unit) === 'kg' ? 1000 : 1);
    return Number.isFinite(grams) && grams > 0 ? grams : null;
  }

  function normalizeImportedIngredient(ingredient) {
    const original = String(ingredient?.original_text || '').trim();
    if (!original) return ingredient;
    const parsed = parseRecipeIngredientText(original);
    const currentName = String(ingredient?.name || '').trim();
    const rawName = !currentName || normalizeName(currentName) === normalizeName(original)
      || currentName.toLowerCase() === 'unresolved ingredient';
    const currentSearch = Array.isArray(ingredient?.search_names) ? ingredient.search_names : [];
    const currentUnit = normalizePortionUnit(ingredient?.unit);
    const usableCurrentUnit = currentUnit && (CORE_UNITS.includes(currentUnit) || currentUnit === 'pinch' || currentUnit === 'dash' || currentUnit === 'clove');
    const existingAmounts = Array.isArray(ingredient?.amounts) ? ingredient.amounts : [];
    const normalizedAmounts = existingAmounts.map(amount => ({
      ...amount,
      unit: normalizePortionUnit(amount?.unit) || amount?.unit,
    })).filter(amount => amount?.quantity > 0 && amount?.unit && (CORE_UNITS.includes(amount.unit) || ['pinch', 'dash', 'clove'].includes(amount.unit)));
    const searchNames = rawName
      ? (parsed.search_names?.length ? parsed.search_names : currentSearch)
      : [...new Set([...(parsed.search_names || []), ...currentSearch])].filter(Boolean).slice(0, 3);
    return {
      ...ingredient,
      quantity: Number(ingredient?.quantity) > 0 ? ingredient.quantity : parsed.quantity,
      unit: usableCurrentUnit || parsed.unit || ingredient?.unit || null,
      name: rawName ? (parsed.name || currentName || original) : currentName,
      search_names: searchNames.length ? searchNames : [currentName || parsed.name || original],
      amounts: normalizedAmounts.length ? normalizedAmounts : (parsed.amounts || []),
      note: [parsed.note, ingredient?.note].filter(Boolean).join('; '),
      parse_confidence: ingredient?.parse_confidence && ingredient.parse_confidence !== 'low'
        ? ingredient.parse_confidence
        : parsed.parse_confidence,
    };
  }

  function inferServings(text) {
    const match = /\d+(?:\.\d+)?/.exec(String(text || ''));
    return match ? Math.max(1, Math.round(Number(match[0]))) : 1;
  }

  function altGrams(food, unit) {
    return altUnitGrams(food, unit);
  }

  function selectedFood(row) {
    return row?.providerFood || foods.find(item => String(item.id) === String(row?.foodId)) || null;
  }

  function amountFrame(food, amount, unit) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    const normalizedUnit = normalizePortionUnit(unit) || unit;
    const alt = altGrams(food, normalizedUnit);
    if (alt != null) return { system: 'g', value: n * alt };
    const system = unitSystem(normalizedUnit);
    const multiplier = unitToGrams(normalizedUnit);
    if (system && multiplier != null) return { system, value: n * multiplier };
    return { system: 'opaque', value: n, unit: normalizedUnit };
  }

  const CORE_UNITS = ['g', 'mg', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup', 'piece', 'serving',
    'slice', 'pinch', 'dash', 'clove', 'can', 'package', 'sprig', 'stalk', 'bunch',
    'scoop', 'stick', 'biscuit', 'cookie', 'bar', 'packet', 'jar', 'bag', 'box'];

  function unitOptions(row) {
    const food = selectedFood(row);
    const values = [...CORE_UNITS, ...(food?.alt_units || []).map(item => item.abbr), row?.unit]
      .map(normalizePortionUnit).filter(Boolean);
    return [...new Set(values)].map(value => ({ value, label: displayUnitName(value, row?.portion, $locale) }));
  }

  function setRowUnit(index, event) {
    const next = [...resolutions];
    next[index] = { ...next[index], unit: normalizePortionUnit(event.currentTarget.value), acknowledged: false, equivalentGrams: null, conversionSource: null, estimatingConversion: false, conversionEstimateFailed: false, selectionVersion: (next[index].selectionVersion || 0) + 1 };
    resolutions = next;
    maybeEstimateConversion(index);
  }

  function prettyNumber(value) {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function conversionDetail(row) {
    const food = selectedFood(row);
    if (!food) return null;
    if (Number(row.equivalentGrams) > 0) {
      return { value: Number(row.equivalentGrams), unit: 'g', source: row.conversionSource || 'recipe' };
    }
    const wanted = amountFrame(food, row.portion, row.unit);
    if (!wanted || wanted.system === 'opaque') return null;
    if (wanted.system === 'g') return { value: wanted.value, unit: 'g', source: conversionProvenance(food, row.unit) || 'calculated' };
    const density = Number(food.density_g_ml);
    if (wanted.system === 'ml' && Number.isFinite(density) && density > 0) {
      return { value: wanted.value * density, unit: 'g', source: 'density' };
    }
    if (wanted.system === 'ml' && (food.nutrition_basis === 'ml' || normalizePortionUnit(food.unit) === 'ml')) {
      return { value: wanted.value, unit: 'ml', source: 'provider' };
    }
    return null;
  }

  function conversionSourceLabel(source) {
    return ({ openfoodfacts: 'Open Food Facts portion data', usda: 'USDA portion data', ai: 'AI estimate', recipe: 'Recipe measurement', density: 'Food density', provider: 'Provider volume data', calculated: 'Unit conversion' })[source] || 'Unit conversion';
  }

  function conversionRequired(row) {
    const food = selectedFood(row);
    if (!food) return false;
    if (Number(row?.equivalentGrams) > 0) return false;
    const base = amountFrame(food, food.portion || 100, food.unit || 'g');
    const wanted = amountFrame(food, row.portion, row.unit);
    if (!base || !wanted) return true;
    if (base.system === wanted.system) return base.system === 'opaque' ? base.unit !== wanted.unit : false;
    if (base.system === 'opaque' || wanted.system === 'opaque') return true;
    return !(Number(food.density_g_ml) > 0);
  }

  function initializeResolutions(nextRecipe) {
    resolutions = (nextRecipe.ingredients || []).map(rawIngredient => {
      const ingredient = normalizeImportedIngredient(rawIngredient);
      const targets = ingredientSearchNames(ingredient).map(normalizeName);
      const matches = foods.filter(food => targets.includes(normalizeName(food.name)));
      const mapped = nextRecipe.source === 'mealie' && nextRecipe.source_instance && ingredient.source_food_id
        ? foods.filter(food => (food.external_refs || []).some(ref => ref.provider === 'mealie' && ref.instance === nextRecipe.source_instance && ref.kind === 'food' && String(ref.id) === String(ingredient.source_food_id)))
        : [];
      const food = mapped.length === 1 ? mapped[0] : (matches.length === 1 ? matches[0] : null);
      const preferred = preferredIngredientAmount(ingredient, food);
      return {
        ingredient,
        foodId: food?.id ?? null,
        providerFood: null,
        portion: preferred.portion,
        unit: normalizePortionUnit(preferred.unit) || preferred.unit,
        acknowledged: false,
        automatic: !!food,
        searching: false,
        candidates: [],
        searchAttempted: false,
        searchStatus: null,
        searchRetryAfter: null,
        rateLimitRetries: 0,
        equivalentGrams: explicitEquivalentGrams(ingredient),
        conversionSource: explicitEquivalentGrams(ingredient) ? 'recipe' : null,
        conversionEstimateFailed: false,
        manuallySelected: false,
        selectionVersion: 0,
      };
    });
  }

  // Initial preview, draft restoration, recipe switching, and settings
  // changes can all invalidate the same recipe at nearly the same time.
  // Debouncing this entry point ensures one recipe starts one full pass while
  // still allowing a later settings change to supersede an active generation.
  function scheduleAutoMatch() {
    // Invalidate active workers immediately, before the debounce window, so a
    // recipe switch cannot let an old worker write into a new row with the
    // same ingredient text.
    autoMatchGeneration += 1;
    for (const timer of autoRetryTimers.values()) clearTimeout(timer);
    autoRetryTimers.clear();
    resolutions = resolutions.map(row => row.searching ? { ...row, searching: false } : row);
    clearTimeout(autoRematchTimer);
    autoRematchTimer = setTimeout(() => {
      autoRematchTimer = null;
      autoMatchAll();
    }, 300);
  }

  function providerCacheKey(provider, name) {
    const languageKey = provider === 'openfoodfacts' ? `:${$offSearchLanguage}:${$offSearchCountry}` : `:${$usdaApiKey}`;
    return `${provider}${languageKey}:${normalizeName(name)}`;
  }

  function reserveAutomaticProviderCall() {
    const now = Date.now();
    if (!automaticProviderWindowStarted || now - automaticProviderWindowStarted >= 60_000) {
      automaticProviderWindowStarted = now;
      automaticProviderCalls = 0;
    }
    if (automaticProviderCalls >= AUTO_PROVIDER_CALL_LIMIT) return false;
    automaticProviderCalls += 1;
    return true;
  }

  function cachedProviderSearch(provider, name, { priority = -1, isCurrent = () => true } = {}) {
    const key = providerCacheKey(provider, name);
    const existing = providerSearchCache.get(key);
    // A newer generation must not reuse a pending promise whose scheduler job
    // is about to be cancelled. Completed, successful results remain valid
    // cache entries across generations; only in-flight stale work is replaced.
    if (existing) {
      if (existing.pending && !existing.isCurrent()) providerSearchCache.delete(key);
      else return existing.promise || Promise.resolve(existing.value);
    }
    if (priority < 0 && !reserveAutomaticProviderCall()) {
      return Promise.resolve({ items: [], rateLimitedSources: [], unavailableSources: [], retryAfter: null, cancelled: false, budgetExhausted: true });
    }
    const entry = { pending: true, isCurrent, promise: null, value: null };
    const promise = searchFoodCatalogsDetailed({
      query: name, source: provider, localFoods: [], offEnabled: $offEnabled,
      usdaEnabled: $usdaEnabled, usdaApiKey: $usdaApiKey, limit: 20,
      schedule: providerRequestScheduler, priority, isCurrent,
    }).then(result => {
      // An empty rate-limited/unavailable response is not a catalogue answer.
      // Evict it so a later retry can actually contact the provider again.
      if (result.cancelled || result.rateLimitedSources.length || result.unavailableSources.length) {
        if (providerSearchCache.get(key) === entry) providerSearchCache.delete(key);
        // A cancelled queued job never consumed a provider request. Return
        // that reservation so a replacement generation still has budget.
        if (result.cancelled && priority < 0 && automaticProviderWindowStarted
          && Date.now() - automaticProviderWindowStarted < 60_000) {
          automaticProviderCalls = Math.max(0, automaticProviderCalls - 1);
        }
      } else {
        entry.pending = false;
        entry.value = result;
      }
      return result;
    }).catch(error => {
      if (providerSearchCache.get(key) === entry) providerSearchCache.delete(key);
      throw error;
    });
    entry.promise = promise;
    providerSearchCache.set(key, entry);
    return promise;
  }

  async function hydrateCandidate(candidate, { priority = 10, isCurrent = () => true } = {}) {
    if (!candidate || candidate._candidateProvider === 'local') {
      return { food: candidate, rateLimitedSources: [], unavailableSources: [], retryAfter: null, cancelled: false };
    }
    const provider = candidate._candidateProvider;
    let result = null;
    const hasHydrationRequest = (provider === 'openfoodfacts' && candidate.barcode)
      || (provider === 'usda' && (candidate.fdcId || String(candidate.barcode || '').startsWith('fdcId_')));
    if (hasHydrationRequest && priority < 0 && !reserveAutomaticProviderCall()) {
      return { food: candidate, rateLimitedSources: [], unavailableSources: [], retryAfter: null, cancelled: false, budgetExhausted: true };
    }
    try {
      if (provider === 'openfoodfacts' && candidate.barcode) {
        result = await providerRequestScheduler(() => API.fetchProductByCodeWithMeta(candidate.barcode), { priority, isCurrent });
      } else if (provider === 'usda' && (candidate.fdcId || String(candidate.barcode || '').startsWith('fdcId_'))) {
        const fdcId = candidate.fdcId || String(candidate.barcode).slice(6);
        result = await providerRequestScheduler(() => USDA.fetchFoodByIdWithMeta(fdcId, $usdaApiKey), { priority, isCurrent });
      }
    } catch {
      result = { item: null, rateLimited: false, retryAfter: null, unavailable: true };
    }
    if (result?.cancelled) return { food: candidate, rateLimitedSources: [], unavailableSources: [], retryAfter: null, cancelled: true };
    const rateLimitedSources = result?.rateLimited ? [provider] : [];
    const unavailableSources = result?.unavailable ? [provider] : [];
    return {
      food: result?.item ? { ...candidate, ...result.item, _candidateProvider: provider } : candidate,
      rateLimitedSources,
      unavailableSources,
      retryAfter: result?.retryAfter || null,
      cancelled: false,
      budgetExhausted: false,
    };
  }

  function rankingOptions(row) {
    return {
      requiredUnit: row?.unit || row?.ingredient?.unit,
      preferredBrands: $preferredFoodBrands,
      usePreferredBrands: $recipeImportUsePreferredBrands,
      preferredBrandsFirst: $recipeImportPreferredBrandsFirst,
    };
  }

  async function collectMatches(row, query, source = 'all', limit = 30, { queries: requestedQueries = null, priority = -1, isCurrent = () => true, skipSources = new Set() } = {}) {
    const names = query ? [query] : ingredientSearchNames(row.ingredient);
    // Manual searches are sent verbatim. Automatic matching passes one
    // bounded stage at a time so exact phrases can short-circuit fallbacks.
    const queries = requestedQueries || (query ? [query.trim()] : []);
    const raw = [];
    const rateLimitedSources = new Set();
    const unavailableSources = new Set();
    let retryAfter = null;
    let cancelled = false;
    let budgetExhausted = false;

    if (source === 'all' || source === 'local') {
      for (const value of queries) raw.push(...searchLocalFoods(foods, value, limit));
    }
    const providers = [];
    if ((source === 'all' || source === 'openfoodfacts') && $offEnabled && !skipSources.has('openfoodfacts')) providers.push('openfoodfacts');
    if ((source === 'all' || source === 'usda') && $usdaEnabled && $usdaApiKey && !skipSources.has('usda')) providers.push('usda');
    const jobs = [];
    // Interleave providers for each phrase so one slow/rate-limited source
    // cannot occupy the entire queue ahead of the other source.
    for (const value of queries) {
      for (const provider of providers) jobs.push({ provider, promise: cachedProviderSearch(provider, value, { priority, isCurrent }) });
    }
    const settledJobs = await Promise.allSettled(jobs.map(job => job.promise));
    for (let jobIndex = 0; jobIndex < settledJobs.length; jobIndex += 1) {
      const jobProvider = jobs[jobIndex].provider;
      const settled = settledJobs[jobIndex];
      if (settled.status === 'rejected') {
        unavailableSources.add(jobProvider);
        continue;
      }
      const detail = settled.value || { items: [], rateLimitedSources: [], unavailableSources: [] };
      if (detail.cancelled) { cancelled = true; continue; }
      if (detail.budgetExhausted) { budgetExhausted = true; continue; }
      (detail.rateLimitedSources || []).forEach(provider => rateLimitedSources.add(provider));
      (detail.unavailableSources || []).forEach(provider => unavailableSources.add(provider));
      if (Number.isFinite(Number(detail.retryAfter)) && Number(detail.retryAfter) > 0) {
        retryAfter = retryAfter == null ? Number(detail.retryAfter) : Math.max(retryAfter, Number(detail.retryAfter));
      }
      raw.push(...(Array.isArray(detail.items) ? detail.items : []));
    }
    return {
      candidates: rankIngredientCandidates(names, raw, limit, rankingOptions(row)),
      rateLimitedSources: [...rateLimitedSources],
      unavailableSources: [...unavailableSources],
      retryAfter,
      cancelled,
      budgetExhausted,
    };
  }

  function mergeSearchOutcome(base, next) {
    const rateLimitedSources = new Set([...(base.rateLimitedSources || []), ...(next.rateLimitedSources || [])]);
    const unavailableSources = new Set([...(base.unavailableSources || []), ...(next.unavailableSources || [])]);
    const retryAfter = base.retryAfter == null ? next.retryAfter : next.retryAfter == null ? base.retryAfter : Math.max(base.retryAfter, next.retryAfter);
    return {
      candidates: rankIngredientCandidates(base.names, [...(base.candidates || []), ...(next.candidates || [])], 30, base.options),
      names: base.names,
      options: base.options,
      rateLimitedSources: [...rateLimitedSources],
      unavailableSources: [...unavailableSources],
      retryAfter,
      cancelled: base.cancelled || next.cancelled,
      budgetExhausted: base.budgetExhausted || next.budgetExhausted,
    };
  }

  async function collectAutomaticMatches(row, generation) {
    const names = ingredientSearchNames(row.ingredient);
    const options = rankingOptions(row);
    const stages = buildIngredientSearchStages(names, $recipeImportUsePreferredBrands && $offEnabled ? $preferredFoodBrands : []);
    const preferredExactQueries = new Set(($recipeImportUsePreferredBrands && $offEnabled ? $preferredFoodBrands : [])
      .filter(item => item && typeof item === 'object' && item.offTag)
      .slice(0, 2)
      .map(item => normalizeName(`${normalizeIngredientSearchText(names[0])} ${String(item.name || '').trim()}`)));
    let outcome = { candidates: [], names, options, rateLimitedSources: [], unavailableSources: [], retryAfter: null, cancelled: false, budgetExhausted: false };
    const blockedSources = new Set();
    const activeProviders = [
      ...($offEnabled ? ['openfoodfacts'] : []),
      ...($usdaEnabled && $usdaApiKey ? ['usda'] : []),
    ];
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
      const stage = stages[stageIndex];
      // Verified preferred-brand phrases are OFF taxonomy queries. Keeping
      // them out of USDA/local fan-out preserves the recipe-specific brand
      // ordering while leaving the other provider available for the primary
      // ingredient phrase.
      const preferred = stageIndex === 0 ? stage.filter(query => preferredExactQueries.has(normalizeName(query))) : [];
      const general = stage.filter(query => !preferredExactQueries.has(normalizeName(query)));
      for (const [queries, source] of [[general, 'all'], [preferred, 'openfoodfacts']]) {
        if (!queries.length) continue;
        const next = await collectMatches(row, '', source, 30, {
          queries,
          priority: -1,
          isCurrent: () => generation === autoMatchGeneration,
          skipSources: blockedSources,
        });
        outcome = mergeSearchOutcome(outcome, next);
        if (outcome.cancelled) return outcome;
        if (outcome.budgetExhausted) return outcome;
        next.rateLimitedSources.forEach(provider => blockedSources.add(provider));
        next.unavailableSources.forEach(provider => blockedSources.add(provider));
      }
      const strong = outcome.candidates.some(isStrongIngredientCandidate);
      if (strong) break;
      // Do not repeat requests to a provider that has already told us it is
      // rate-limited. Continue with any provider that remains available.
      if (activeProviders.length && activeProviders.every(provider => blockedSources.has(provider))) break;
    }
    return outcome;
  }

  function scheduleRateLimitRetry(index, retryAfter) {
    if (autoRetryTimers.has(index)) return;
    const seconds = Number.isFinite(Number(retryAfter)) && Number(retryAfter) > 0 ? Number(retryAfter) : 60;
    // Respect the provider's Retry-After value (including values longer than
    // a minute); only enforce a small lower bound so malformed zero/negative
    // headers cannot create a tight retry loop.
    const delay = Math.max(1_000, Math.ceil(seconds * 1000));
    const timer = setTimeout(() => {
      autoRetryTimers.delete(index);
      const row = resolutions[index];
      if (row && Number(row.rateLimitRetries || 0) < 1) retryIngredientMatch(index, true);
    }, delay);
    autoRetryTimers.set(index, timer);
  }

  function clearRateLimitRetry(index) {
    const timer = autoRetryTimers.get(index);
    if (timer) clearTimeout(timer);
    autoRetryTimers.delete(index);
  }

  async function runAutomaticMatchAtIndex(index, row, generation) {
    const currentBefore = resolutions[index];
    if (!currentBefore || currentBefore.ingredient.original_text !== row.ingredient.original_text || generation !== autoMatchGeneration) return;
    resolutions = resolutions.map((item, itemIndex) => itemIndex === index
      ? { ...item, searching: true, searchAttempted: true, searchStatus: null, searchRetryAfter: null }
      : item);
    try {
      const outcome = await collectAutomaticMatches(row, generation);
      if (outcome.cancelled || generation !== autoMatchGeneration) return;
      const current = resolutions[index];
      if (!current || current.ingredient.original_text !== row.ingredient.original_text) return;
      let best = outcome.candidates[0];
      let hydration = { food: best, rateLimitedSources: [], unavailableSources: [], retryAfter: null, cancelled: false };
      if (best && isStrongIngredientCandidate(best) && !current.manuallySelected) {
        hydration = await hydrateCandidate(best, { priority: -1, isCurrent: () => generation === autoMatchGeneration });
        if (hydration.cancelled || generation !== autoMatchGeneration) return;
        best = hydration.food || best;
      }
      const rateLimitedSources = [...new Set([...(outcome.rateLimitedSources || []), ...(hydration.rateLimitedSources || [])])];
      const unavailableSources = [...new Set([...(outcome.unavailableSources || []), ...(hydration.unavailableSources || [])])];
      const strongBest = best && isStrongIngredientCandidate(best);
      // Keep diagnostics visible even when another provider supplied a usable
      // winner. A partial outage should never be mistaken for a clean
      // no-match, and the selected result remains usable while it is shown.
      const searchStatus = rateLimitedSources.length
        ? 'rate_limited'
        : unavailableSources.length ? 'unavailable' : null;
      const searchRetryAfter = hydration.retryAfter || outcome.retryAfter || null;
      const next = [...resolutions];
      next[index] = {
        ...current,
        candidates: outcome.candidates,
        searchAttempted: true,
        searching: false,
        searchStatus,
        searchRetryAfter,
      };
      if (strongBest && !current.manuallySelected) {
        applyCandidateToRow(next[index], best, true);
        // Applying a winner resets selection/conversion state, but a partial
        // provider outage is still useful context for the row and may need a
        // single scheduled retry.
        next[index].searchStatus = searchStatus;
        next[index].searchRetryAfter = searchRetryAfter;
      }
      resolutions = next;
      if (searchStatus === 'rate_limited' && Number(current.rateLimitRetries || 0) < 1) {
        scheduleRateLimitRetry(index, searchRetryAfter);
      } else if (searchStatus !== 'rate_limited') {
        clearRateLimitRetry(index);
      }
      if (strongBest && !current.manuallySelected) maybeEstimateConversion(index);
    } catch {
      const next = [...resolutions];
      if (next[index]) next[index] = { ...next[index], searching: false, searchAttempted: true, searchStatus: 'unavailable' };
      resolutions = next;
    }
  }

  async function retryIngredientMatch(index, automatic = false) {
    const row = resolutions[index];
    if (!row || row.manuallySelected || row.searching || Number(row.rateLimitRetries || 0) >= 1) return;
    clearRateLimitRetry(index);
    const generation = ++autoMatchGeneration;
    const next = resolutions.map((item, itemIndex) => itemIndex === index
      ? {
        ...row,
        searching: true,
        searchStatus: null,
        searchRetryAfter: null,
        rateLimitRetries: automatic ? Number(row.rateLimitRetries || 0) + 1 : Math.max(1, Number(row.rateLimitRetries || 0)),
      }
      : item.searching ? { ...item, searching: false } : item);
    resolutions = next;
    await runAutomaticMatchAtIndex(index, next[index], generation);
  }

  async function autoMatchAll() {
    const generation = ++autoMatchGeneration;
    // A newer recipe/settings generation supersedes queued work and any
    // pending retry from the previous pass. Clear stale UI state as well so a
    // cancelled worker cannot leave rows showing an endless spinner.
    for (const timer of autoRetryTimers.values()) clearTimeout(timer);
    autoRetryTimers.clear();
    resolutions = resolutions.map(row => row.manuallySelected
      ? row
      : { ...row, searching: false, searchStatus: null, searchRetryAfter: null, rateLimitRetries: 0 });
    const snapshot = resolutions;
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < snapshot.length) {
        const index = nextIndex++;
        const row = snapshot[index];
        if (row.manuallySelected || generation !== autoMatchGeneration) continue;
        await runAutomaticMatchAtIndex(index, row, generation);
      }
    };
    await Promise.all([worker(), worker()]);
  }

  function providerReferences(candidate, row) {
    const refs = [];
    if (candidate._candidateProvider === 'openfoodfacts' && candidate.barcode) refs.push({ provider: 'openfoodfacts', kind: 'product', id: candidate.barcode });
    if (candidate._candidateProvider === 'usda' && (candidate.fdcId || candidate.id)) refs.push({ provider: 'usda', kind: 'food', id: String(candidate.fdcId || candidate.id) });
    if (recipe?.source === 'mealie' && recipe.source_instance && row.ingredient.source_food_id) refs.push({ provider: 'mealie', instance: recipe.source_instance, kind: 'food', id: String(row.ingredient.source_food_id) });
    return refs;
  }

  function cleanProviderFood(candidate, row) {
    const { _candidateProvider, _matchScore, _relevanceScore, _matchReasons, _convertible, _brandRank, _unbranded, _sourceRank, _priorityRank, _localFoodId, nameLanguage, id: _drop, ...foodData } = candidate;
    return { ...foodData, external_refs: providerReferences(candidate, row), _candidateProvider };
  }

  function applyCandidateToRow(row, candidate, automatic = false) {
    const preferred = preferredIngredientAmount(row.ingredient, candidate);
    row.foodId = candidate._candidateProvider === 'local' ? (candidate._localFoodId ?? candidate.id) : null;
    row.providerFood = candidate._candidateProvider === 'local' ? null : cleanProviderFood(candidate, row);
    row.portion = preferred.portion;
    row.unit = normalizePortionUnit(preferred.unit) || preferred.unit;
    row.acknowledged = false;
    row.automatic = automatic;
    row.manuallySelected = !automatic;
    row.selectionVersion = (row.selectionVersion || 0) + 1;
    row.equivalentGrams = null;
    const explicit = explicitEquivalentGrams(row.ingredient);
    row.equivalentGrams = explicit;
    row.conversionSource = explicit ? 'recipe' : null;
    row.estimatingConversion = false;
    row.conversionEstimateFailed = false;
    row.searchStatus = null;
    row.searchRetryAfter = null;
  }

  async function chooseProvider(index, candidate) {
    const row = resolutions[index];
    clearRateLimitRetry(index);
    try {
      const hydration = await hydrateCandidate(candidate, { priority: 10, isCurrent: () => true });
      const hydrated = hydration.food || candidate;
      const next = [...resolutions];
      next[index] = { ...next[index] };
      applyCandidateToRow(next[index], hydrated, false);
      if (hydration.rateLimitedSources.length) {
        next[index].searchStatus = 'rate_limited';
        next[index].searchRetryAfter = hydration.retryAfter || null;
      } else if (hydration.unavailableSources.length) {
        next[index].searchStatus = 'unavailable';
      }
      resolutions = next;
      searchSheetOpen = false;
      await maybeEstimateConversion(index);
    } catch (error) {
      showError(error?.message || 'Could not select provider food');
    }
  }

  async function maybeEstimateConversion(index) {
    const row = resolutions[index];
    const food = selectedFood(row);
    if (!row || !food || !conversionRequired(row) || !$aiEffectivelyEnabled || row.estimatingConversion) return;
    const selectionVersion = row.selectionVersion || 0;
    const next = [...resolutions];
    next[index] = { ...row, estimatingConversion: true };
    resolutions = next;
    conversionEstimateQueue = conversionEstimateQueue.catch(() => {}).then(async () => {
      const current = resolutions[index];
      if (!current || (current.selectionVersion || 0) !== selectionVersion) return;
      if (!conversionRequired(current)) {
        const skipped = [...resolutions];
        skipped[index] = { ...current, estimatingConversion: false, conversionEstimateFailed: false };
        resolutions = skipped;
        return;
      }
      let estimate = null;
      for (let attempt = 0; attempt < 2 && !estimate; attempt++) {
        try {
          estimate = await estimateIngredientGramsWithAI({
            ingredientText: row.ingredient.original_text, foodName: food.name, brand: food.brand,
            amount: row.portion, unit: row.unit,
          });
        } catch {}
      }
      const done = [...resolutions];
      if ((done[index]?.selectionVersion || 0) !== selectionVersion) return;
      done[index] = estimate
        ? { ...done[index], estimatingConversion: false, conversionEstimateFailed: false, equivalentGrams: estimate.grams, conversionSource: 'ai' }
        : { ...done[index], estimatingConversion: false, conversionEstimateFailed: true };
      resolutions = done;
    });
    await conversionEstimateQueue;
  }

  function openMatchSearch(index) {
    searchRowIndex = index;
    searchQuery = resolutions[index]?.ingredient?.name || '';
    searchSource = 'all';
    searchSheetOpen = true;
    runSheetSearch();
  }

  async function runSheetSearch() {
    if (searchRowIndex < 0 || !searchQuery.trim()) {
      sheetResults = [];
      sheetRateLimitedSources = [];
      sheetUnavailableSources = [];
      sheetRetryAfter = null;
      return;
    }
    const sequence = ++searchSequence;
    sheetSearching = true;
    sheetRateLimitedSources = [];
    sheetUnavailableSources = [];
    sheetRetryAfter = null;
    try {
      const query = searchQuery.trim();
      // Manual lookup uses the exact same catalogue operation as the meal
      // editor. Do not put interactive searches behind the automatic-match
      // request queue: a large recipe can otherwise make a valid lookup look
      // empty or unresponsive. Recipe-only preferred-brand ordering is
      // applied after the shared retrieval step and only in the merged view.
      const detail = await searchFoodCatalogsDetailed({
        query, source: searchSource, localFoods: foods, offEnabled: $offEnabled,
        usdaEnabled: $usdaEnabled, usdaApiKey: $usdaApiKey, limit: 50,
        schedule: providerRequestScheduler, priority: 10,
        isCurrent: () => sequence === searchSequence,
      });
      if (detail.cancelled) return;
      const catalogueResults = detail.items;
      const results = searchSource === 'all'
        ? rankIngredientCandidates([query], catalogueResults, 50, rankingOptions(resolutions[searchRowIndex]))
        : catalogueResults;
      if (sequence === searchSequence) {
        sheetResults = results;
        sheetRateLimitedSources = detail.rateLimitedSources;
        sheetUnavailableSources = detail.unavailableSources;
        sheetRetryAfter = detail.retryAfter;
      }
    }
    catch (error) {
      if (sequence === searchSequence) {
        sheetResults = [];
        sheetUnavailableSources = ['provider'];
        showError(error?.message || 'Food search failed');
      }
    }
    finally { if (sequence === searchSequence) sheetSearching = false; }
  }

  function scheduleSheetSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSheetSearch, 250);
  }

  function chooseRecipe(index) {
    selectedIndex = index;
    initializeResolutions(result.recipes[index]);
    scheduleAutoMatch();
  }

  function chooseFood(index, event) {
    const value = event.currentTarget.value;
    const food = foods.find(item => String(item.id) === value);
    clearRateLimitRetry(index);
    const rows = [...resolutions];
    const preferred = preferredIngredientAmount(rows[index].ingredient, food);
    rows[index] = {
      ...rows[index],
      foodId: food?.id ?? null,
      providerFood: null,
      portion: preferred.portion,
      unit: preferred.unit,
      acknowledged: food ? false : rows[index].acknowledged,
      automatic: false,
      manuallySelected: true,
      selectionVersion: (rows[index].selectionVersion || 0) + 1,
      equivalentGrams: explicitEquivalentGrams(rows[index].ingredient),
      conversionSource: explicitEquivalentGrams(rows[index].ingredient) ? 'recipe' : null,
      searchStatus: null,
      searchRetryAfter: null,
      rateLimitRetries: 0,
    };
    resolutions = rows;
  }

  async function preview() {
    if (!url.trim() || serverRequired) return;
    loading = true;
    result = null;
    conflict = null;
    try {
      [result, foods] = await Promise.all([NtApi.previewRecipeUrl(url.trim()), NtApi.getFoods()]);
      selectedIndex = 0;
      initializeResolutions(result.recipes[0]);
    } catch (error) {
      showError(error?.message || 'Could not import that recipe URL');
    } finally {
      loading = false;
    }
  }

  async function commit(mode = 'create') {
    if (!recipe || !unresolvedReady) return;
    saving = true;
    conflict = null;
    try {
      const saved = await NtApi.commitRecipeImport({
        recipe,
        mealie_image: recipe.source === 'mealie' ? Mealie.imageImport(recipe.source_id) : null,
        servings: Number(recipe.servings) > 0 ? Math.round(Number(recipe.servings)) : inferServings(recipe.yield_text),
        mode,
        ingredients: resolutions.map(row => ({
          food_id: row.acknowledged && conversionRequired(row) ? null : row.foodId,
          provider_food: row.acknowledged && conversionRequired(row) ? null : row.providerFood,
          portion: row.portion,
          unit: row.unit,
          equivalent_grams: Number(row.equivalentGrams) > 0 ? Number(row.equivalentGrams) : undefined,
          name: row.ingredient.name,
          unresolved_acknowledged: row.acknowledged,
          source_ingredient: {
            provider: recipe.source || 'jsonld',
            instance: recipe.source_instance || undefined,
            food_id: row.ingredient.source_food_id || undefined,
            original_quantity: row.ingredient.quantity,
            original_quantity_max: row.ingredient.quantity_max,
            original_unit: row.ingredient.unit,
            original_text: row.ingredient.original_text,
            note: row.ingredient.note,
            parse_confidence: row.ingredient.parse_confidence,
            search_names: ingredientSearchNames(row.ingredient),
            amounts: row.ingredient.amounts || [],
            normalization_source: row.ingredient.normalization_source || 'deterministic',
            group: row.ingredient.group || '',
            resolution: selectedFood(row) && !(row.acknowledged && conversionRequired(row))
              ? (row.providerFood ? (row.automatic ? 'provider_automatic' : 'provider_selected') : (row.automatic ? 'local_automatic' : 'local_selected'))
              : 'unresolved',
          },
        })),
      });
      try { localStorage.removeItem(RECIPE_IMPORT_DRAFT_KEY); } catch {}
      showSuccess(mode === 'update' ? $_('recipe_import.updated') : $_('recipe_import.success'));
      editorState.foodsActiveTab = 2;
      editorState.mealIsRecipe = true;
      editorState.mealPrefill = saved.recipe;
      replace(`/meal-editor/${saved.recipe.id}`);
    } catch (error) {
      if (error?.code === 'recipe_exists') conflict = { id: error.existingId };
      else showError(error?.message || 'Recipe import failed');
    } finally {
      saving = false;
    }
  }
</script>

<div class="page-shell recipe-import-page">
  <header class="page-header">
    <button class="btn-icon" on:click={() => push('/foods')} aria-label={$_('recipe_import.back')} title={$_('recipe_import.back')}>
      <span class="material-symbols-rounded">arrow_back</span>
    </button>
    <h1>{$_('recipe_import.title')}</h1>
    <span class="header-spacer"></span>
  </header>

  <main class="page-content import-content">
    {#if serverRequired}
      <section class="card state-card">
        <span class="material-symbols-rounded state-icon">dns</span>
        <h2>{$_('recipe_import.server_title')}</h2>
        <p>{$_('recipe_import.server_body')}</p>
        <button class="btn btn-primary" on:click={() => push('/settings/serverConnection')}>{$_('recipe_import.server_action')}</button>
      </section>
    {:else if restoringDraft}
      <section class="card state-card">
        <span class="material-symbols-rounded state-icon spin">refresh</span>
        <p>{$_('recipe_import.reading')}</p>
      </section>
    {:else if !result || !recipe}
      <section class="card import-card">
        <h2>{$_('recipe_import.webpage')}</h2>
        <p class="text-3">{$_('recipe_import.webpage_help')}</p>
        <label for="recipe-url">{$_('recipe_import.url')}</label>
        <div class="url-row">
          <input id="recipe-url" class="input" type="url" inputmode="url" bind:value={url}
            placeholder="https://example.com/recipe" disabled={loading}
            on:keydown={event => event.key === 'Enter' && preview()} />
          <button class="btn btn-primary" on:click={preview} disabled={loading || !url.trim()}>
            {#if loading}<span class="material-symbols-rounded spin">refresh</span>{/if}
            {loading ? $_('recipe_import.reading') : $_('recipe_import.preview')}
          </button>
        </div>
        <p class="hint">{$_('recipe_import.static_hint')}</p>
      </section>
    {:else}
      {#if result.recipes.length > 1}
        <section class="card import-card">
          <h2>{$_('recipe_import.choose_recipe')}</h2>
          <div class="recipe-choices">
            {#each result.recipes as option, index}
              <button class:active={selectedIndex === index} on:click={() => chooseRecipe(index)}>{option.name}</button>
            {/each}
          </div>
        </section>
      {/if}

      <section class="card recipe-summary">
        {#if recipe?.images?.[0]}<img src={recipe.images[0]} alt="" on:error={event => event.currentTarget.style.display = 'none'} />{/if}
        <div>
          <h2>{recipe.name}</h2>
          {#if recipe.author}<p>{$_('recipe_import.by', { values: { author: recipe.author } })}</p>{/if}
          <p class="text-3">{recipe.yield_text || $_('recipe_import.yield_missing')} · {$_('recipe_import.ingredient_count', { values: { count: recipe.ingredients.length } })}</p>
          {#if recipe.description}<p>{recipe.description}</p>{/if}
        </div>
      </section>

      {#if result.warnings?.length}
        <section class="warning-card">{result.warnings.join(' ')}</section>
      {/if}

      <section class="card import-card">
        <h2>{$_('recipe_import.match_title')}</h2>
        <p class="text-3">{$_('recipe_import.match_help')}</p>
        <div class="ingredient-list">
          {#each resolutions as row, index}
            <div class="ingredient-row" class:unresolved={!selectedFood(row)}>
              <div class="ingredient-source">
                <strong>{row.ingredient.original_text}</strong>
                {#if row.ingredient.parse_confidence !== 'high'}<span class="status warn">{$_('recipe_import.check_amount')}</span>{/if}
                {#if row.automatic}<span class="status">{$_('recipe_import.exact_match')}</span>{/if}
              </div>
              <button class="match-picker" on:click={() => openMatchSearch(index)}>
                {#if selectedFood(row)}
                  <span><strong>{selectedFood(row).name}</strong>{#if selectedFood(row).brand}<small>{selectedFood(row).brand}</small>{/if}</span>
                {:else}
                  <span><strong>{row.searching ? 'Finding a match…' : 'Find a food match'}</strong><small>Search foods or brands</small></span>
                {/if}
                <span class="material-symbols-rounded">search</span>
              </button>
              {#if row.searchStatus === 'rate_limited'}
                <p class="search-warning">Provider search was temporarily rate-limited. {#if !row.manuallySelected && (row.rateLimitRetries || 0) < 1}<button class="retry-search" on:click={() => retryIngredientMatch(index)}>Retry now</button>{:else if !row.manuallySelected}Retry scheduled or already attempted.{/if}</p>
              {:else if row.searchStatus === 'unavailable'}
                <p class="search-warning">A food provider is temporarily unavailable. {#if !row.manuallySelected && (row.rateLimitRetries || 0) < 1}<button class="retry-search" on:click={() => retryIngredientMatch(index)}>Retry</button>{:else if !row.manuallySelected}Retry already attempted.{/if}</p>
              {/if}
              {#if selectedFood(row)}
                <div class="amount-row">
                  <input class="input" type="number" min="0" step="any" bind:value={row.portion} aria-label={$_('recipe_import.amount')} />
                  <select class="select unit-select" value={normalizePortionUnit(row.unit)} on:change={event => setRowUnit(index, event)} aria-label={$_('recipe_import.unit')}>
                    {#each unitOptions(row) as option}<option value={option.value}>{option.label}</option>{/each}
                  </select>
                </div>
                {@const detail = conversionDetail(row)}
                {#if detail}
                  <p class="conversion-detail" class:estimated={detail.source === 'ai'}>
                    {prettyNumber(row.portion)} {displayUnitName(row.unit, row.portion, $locale)} → {prettyNumber(detail.value)} {displayUnitName(detail.unit, detail.value, $locale)} · {conversionSourceLabel(detail.source)}
                  </p>
                {/if}
                {#if conversionRequired(row)}
                  <p class="conversion-warning">
                    {row.estimatingConversion
                      ? 'Estimating the unit conversion with AI…'
                      : row.conversionEstimateFailed && $aiEffectivelyEnabled
                        ? 'AI could not estimate this conversion.'
                        : 'No automatic conversion is available for the selected unit.'}
                    {#if row.conversionEstimateFailed && $aiEffectivelyEnabled}<button class="retry-estimate" on:click={() => maybeEstimateConversion(index)}>Retry</button>{/if}
                  </p>
                  <label class="ack-row">
                    <input type="checkbox" bind:checked={row.acknowledged} />
                    <span><strong>Import without nutrition</strong><small>Keep this ingredient in the recipe, but do not count calories or nutrients.</small></span>
                  </label>
                {/if}
              {:else}
                <label class="ack-row">
                  <input type="checkbox" bind:checked={row.acknowledged} />
                  <span><strong>Import without nutrition</strong><small>Keep this ingredient in the recipe, but do not count calories or nutrients.</small></span>
                </label>
              {/if}
            </div>
          {/each}
        </div>
      </section>

      {#if recipe.instructions?.length}
        <section class="card import-card">
          <h2>{$_('recipe_import.instructions')}</h2>
          <ol class="instructions">
            {#each recipe.instructions as step}
              <li>{#if step.section}<strong>{step.section}: </strong>{/if}{step.text}</li>
            {/each}
          </ol>
        </section>
      {/if}

      {#if conflict}
        <section class="warning-card conflict-card">
          <strong>{$_('recipe_import.duplicate_title')}</strong>
          <span>{$_('recipe_import.duplicate_body')}</span>
          <div><button class="btn btn-primary" on:click={() => commit('update')} disabled={saving}>{$_('recipe_import.update')}</button> <button class="btn btn-ghost" on:click={() => commit('copy')} disabled={saving}>{$_('recipe_import.copy')}</button></div>
        </section>
      {/if}

      <div class="import-actions">
        <button class="btn btn-ghost" on:click={() => { result = null; resolutions = []; try { localStorage.removeItem(RECIPE_IMPORT_DRAFT_KEY); } catch {} }}>{$_('recipe_import.another')}</button>
        <button class="btn btn-primary" on:click={() => commit()} disabled={saving || !unresolvedReady}>
          {saving ? $_('recipe_import.importing') : $_('recipe_import.import')}
        </button>
      </div>
      {#if !unresolvedReady}<p class="blocking-note">{$_('recipe_import.blocked')}</p>{/if}
    {/if}
  </main>

  <Sheet bind:open={searchSheetOpen} title="Choose a food match" height="full" on:close={() => searchSheetOpen = false}>
    <div class="match-search-sheet">
      <div class="sheet-search-row">
        <span class="material-symbols-rounded">search</span>
        <input class="input" type="search" placeholder="Search food or brand" bind:value={searchQuery}
          on:input={scheduleSheetSearch} on:keydown={event => event.key === 'Enter' && runSheetSearch()} />
      </div>
      <div class="source-tabs" role="tablist" aria-label="Food source">
        {#each [
          { value: 'all', label: 'All' },
          { value: 'local', label: 'My Foods' },
          ...($usdaEnabled && $usdaApiKey ? [{ value: 'usda', label: 'USDA' }] : []),
          ...($offEnabled ? [{ value: 'openfoodfacts', label: 'Open Food Facts' }] : []),
        ] as sourceOption}
          <button class:active={searchSource === sourceOption.value} on:click={() => { searchSource = sourceOption.value; runSheetSearch(); }}>{sourceOption.label}</button>
        {/each}
      </div>
      {#if sheetSearching}
        <div class="sheet-state"><span class="material-symbols-rounded spin">refresh</span> Searching…</div>
      {:else if sheetResults.length}
        {#if sheetRateLimitedSources.length}<div class="sheet-warning">Some providers were rate-limited; showing the results that arrived. <button class="retry-search" on:click={runSheetSearch}>Retry</button></div>{/if}
        {#if !sheetRateLimitedSources.length && sheetUnavailableSources.length}<div class="sheet-warning">Some food providers were unavailable; showing the results that arrived. <button class="retry-search" on:click={runSheetSearch}>Retry</button></div>{/if}
        <div class="sheet-results">
          {#each sheetResults as candidate}
            <button class="sheet-result" on:click={() => chooseProvider(searchRowIndex, candidate)}>
              <span class="result-main">
                <strong>{candidate.name}</strong>
                {#if candidate.brand}<small>{candidate.brand}</small>{/if}
                <small>{(candidate._matchReasons || []).join(' · ')}</small>
              </span>
              <span class="result-source">{candidate._candidateProvider === 'local' ? 'My Foods' : candidate._candidateProvider === 'openfoodfacts' ? 'Open Food Facts' : 'USDA'}</span>
            </button>
          {/each}
        </div>
      {:else if sheetRateLimitedSources.length}
        <div class="sheet-state sheet-state-stack"><span>Provider search was temporarily rate-limited.</span><button class="btn btn-ghost" on:click={runSheetSearch}>Retry</button></div>
      {:else if sheetUnavailableSources.length}
        <div class="sheet-state sheet-state-stack"><span>Food provider temporarily unavailable.</span><button class="btn btn-ghost" on:click={runSheetSearch}>Retry</button></div>
      {:else}
        <div class="sheet-state">No relevant foods found. Try a food name, brand, or both.</div>
      {/if}
    </div>
  </Sheet>
</div>

<style>
  .recipe-import-page { min-height: 100%; }
  .header-spacer { width: 40px; }
  .import-content { width: min(900px, 100%); margin: 0 auto; display: flex; flex-direction: column; gap: 16px; padding-bottom: 100px; }
  .import-card, .state-card { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  h2, p { margin: 0; }
  .url-row { display: flex; gap: 10px; }
  .url-row .input { flex: 1; }
  .hint, .blocking-note { margin: 0; color: var(--text-3); font-size: 13px; }
  .state-card { align-items: center; text-align: center; padding: 36px 24px; }
  .state-icon { font-size: 48px; color: var(--accent); }
  .recipe-choices { display: flex; flex-wrap: wrap; gap: 8px; }
  .recipe-choices button { border: 1px solid var(--border); background: var(--surface-2); color: var(--text-1); border-radius: var(--radius-md); padding: 10px 14px; cursor: pointer; }
  .recipe-choices button.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, var(--surface-2)); }
  .recipe-summary { padding: 16px; display: grid; grid-template-columns: 140px 1fr; gap: 18px; align-items: start; }
  .recipe-summary img { width: 140px; height: 140px; object-fit: cover; border-radius: var(--radius-md); }
  .recipe-summary > div { display: flex; flex-direction: column; gap: 8px; }
  .warning-card { padding: 14px 16px; border-radius: var(--radius-md); background: color-mix(in srgb, #f59e0b 14%, var(--surface)); border: 1px solid color-mix(in srgb, #f59e0b 50%, var(--border)); }
  .ingredient-list { display: flex; flex-direction: column; gap: 10px; container-type: inline-size; }
  .ingredient-row { display: grid; grid-template-columns: minmax(180px, 1.3fr) minmax(180px, 1fr) minmax(210px, .9fr); gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); align-items: center; }
  .ingredient-row.unresolved { border-color: color-mix(in srgb, #f59e0b 55%, var(--border)); }
  .ingredient-source { grid-column: 1; min-width: 0; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .status { font-size: 11px; padding: 2px 6px; color: var(--accent); border-radius: 999px; background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .status.warn { color: #b66a00; background: color-mix(in srgb, #f59e0b 15%, transparent); }
  .match-picker { grid-column: 2; min-width: 0; min-height: 44px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); color: var(--text-1); cursor: pointer; }
  .match-picker > span:first-child { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .match-picker strong, .match-picker small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .match-picker small { color: var(--text-3); }
  .amount-row { grid-column: 3; min-width: 0; display: grid; grid-template-columns: minmax(72px, .55fr) minmax(120px, 1fr); gap: 6px; }
  .amount-row > *, .unit-select { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; }
  .unit-select { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ack-row { grid-column: 2 / -1; font-size: 12px; display: flex; gap: 7px; align-items: start; }
  .ack-row span { display: flex; flex-direction: column; gap: 2px; }
  .ack-row small { color: var(--text-3); font-weight: 400; }
  .conversion-warning { grid-column: 2 / -1; margin: 0; color: #b66a00; font-size: 12px; }
  .search-warning { grid-column: 2 / -1; margin: 0; color: #b66a00; font-size: 12px; }
  .retry-search { border: 0; padding: 0; background: none; color: var(--accent); cursor: pointer; text-decoration: underline; }
  .conversion-detail { grid-column: 2 / -1; margin: 0; color: var(--text-3); font-size: 12px; }
  .conversion-detail.estimated { color: #b66a00; }
  .retry-estimate { margin-left: 6px; border: 0; padding: 0; background: none; color: var(--accent); cursor: pointer; text-decoration: underline; }
  .instructions { margin: 0; padding-left: 24px; display: flex; flex-direction: column; gap: 10px; }
  .conflict-card { display: flex; flex-direction: column; gap: 8px; }
  .import-actions { display: flex; justify-content: flex-end; gap: 10px; position: sticky; bottom: 12px; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); padding: 12px; border-radius: var(--radius-lg); }
  .blocking-note { text-align: right; }
  .match-search-sheet { min-height: 100%; display: flex; flex-direction: column; gap: 12px; }
  .sheet-search-row { position: relative; }
  .sheet-search-row > span { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
  .sheet-search-row .input { width: 100%; padding-left: 40px; }
  .source-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
  .source-tabs button { flex: 0 0 auto; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); color: var(--text-2); padding: 7px 11px; cursor: pointer; }
  .source-tabs button.active { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)); }
  .sheet-results { display: flex; flex-direction: column; gap: 7px; }
  .sheet-warning { color: #b66a00; font-size: 12px; }
  .sheet-result { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); color: var(--text-1); text-align: left; cursor: pointer; }
  .result-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .result-main strong, .result-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result-main small, .result-source { color: var(--text-3); font-size: 11px; }
  .result-source { flex: 0 0 auto; }
  .sheet-state { min-height: 160px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-3); text-align: center; }
  .sheet-state-stack { flex-direction: column; }
  @media (max-width: 700px) {
    .url-row { flex-direction: column; }
    .recipe-summary { grid-template-columns: 90px 1fr; }
    .recipe-summary img { width: 90px; height: 90px; }
    .ingredient-row { grid-template-columns: 1fr; }
    .ack-row, .conversion-warning, .conversion-detail, .search-warning { grid-column: 1; }
  }
  @container (max-width: 760px) {
    .ingredient-row { grid-template-columns: minmax(180px, 1fr) minmax(280px, 1.25fr); }
    .ingredient-source { grid-column: 1; grid-row: 1 / span 2; }
    .match-picker { grid-column: 2; }
    .amount-row { grid-column: 2; }
    .ack-row, .conversion-warning, .conversion-detail, .search-warning { grid-column: 2; }
  }
  @container (max-width: 540px) {
    .ingredient-row { grid-template-columns: minmax(0, 1fr); }
    .ingredient-source, .match-picker, .amount-row, .ack-row, .conversion-warning, .conversion-detail, .search-warning { grid-column: 1; grid-row: auto; }
  }
</style>
