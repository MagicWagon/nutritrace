<script>
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { _, locale } from 'svelte-i18n';
  import { NtApi, API, USDA } from '../lib/api.js';
  import { isNative, getServerUrl } from '../lib/platform.js';
  import { showSuccess, showError } from '../stores/toast.js';
  import { editorState } from '../stores/editorState.js';
  import { offEnabled, offSearchLanguage, usdaEnabled, usdaApiKey, aiEffectivelyEnabled, preferredFoodBrands, preferredBrandPriority } from '../stores/settings.js';
  import { unitToGrams, unitSystem } from '../lib/units.js';
  import { prepareRecipeImportDraft, persistRecipeImportDraft, RECIPE_IMPORT_DRAFT_KEY } from '../lib/recipe-import-draft.js';
  import { isStrongIngredientCandidate, normalizeIngredientName, normalizeIngredientSearchText, rankIngredientCandidates } from '../lib/ingredient-match.js';
  import { estimateIngredientGramsWithAI, refineIngredientWithAI } from '../lib/ingredient-ai.js';
  import { altUnitGrams, conversionProvenance, displayUnitName, normalizePortionUnit } from '../lib/provider-portions.js';
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
  let searchTimer;
  let searchSequence = 0;
  let conversionEstimateQueue = Promise.resolve();

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
    // Re-run automatic matching for restored drafts as well. Provider data,
    // settings, or an earlier partial outage may have changed since save.
    autoMatchAll();
  });

  $: recipe = result?.recipes?.[selectedIndex] || null;
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

  function providerSearchQueries(names) {
    const queries = [];
    const add = value => {
      const clean = String(value || '').replace(/\s+/g, ' ').trim();
      if (clean && !queries.some(item => normalizeName(item) === normalizeName(clean))) queries.push(clean);
    };
    for (const name of names) {
      add(name);
      const cleaned = normalizeIngredientSearchText(name);
      add(cleaned);
      for (const brand of $preferredFoodBrands.slice(0, 2)) {
        if (!normalizeName(cleaned).includes(normalizeName(brand))) add(`${cleaned} ${brand}`);
      }
      const tokens = cleaned.split(' ').filter(Boolean);
      // Provider indexes vary between phrase, food-name, and brand matching.
      // Shorter fallbacks are ranked against the full query after retrieval.
      if (tokens.length > 2) add(tokens.slice(0, -1).join(' '));
      if (tokens.length > 1) add(tokens.slice(0, 2).join(' '));
      if (tokens.length > 1) add(tokens.at(-1));
      if (tokens.length === 2) add(tokens[0]);
    }
    return queries.slice(0, 4);
  }

  function preferredIngredientAmount(ingredient, fallbackFood = null) {
    const equivalent = (ingredient?.amounts || []).find(amount =>
      amount?.role === 'equivalent' && ['g', 'kg'].includes(String(amount?.unit || '').toLowerCase())
      && Number(amount?.quantity) > 0
    );
    if (equivalent) return { portion: Number(equivalent.quantity), unit: equivalent.unit };
    const sourceAmount = Number(ingredient?.quantity);
    return {
      portion: Number.isFinite(sourceAmount) && sourceAmount > 0 ? sourceAmount : (fallbackFood?.portion || 1),
      unit: ingredient?.unit || fallbackFood?.unit || 'serving',
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

  const CORE_UNITS = ['g', 'mg', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup', 'piece', 'serving'];

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
    resolutions = (nextRecipe.ingredients || []).map(ingredient => {
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
        aiRefining: false,
        aiProposal: null,
        equivalentGrams: null,
        conversionSource: null,
        conversionEstimateFailed: false,
        manuallySelected: false,
        selectionVersion: 0,
      };
    });
  }

  function cachedProviderSearch(provider, name) {
    const key = `${provider}:${normalizeName(name)}`;
    if (providerSearchCache.has(key)) return providerSearchCache.get(key);
    const promise = provider === 'openfoodfacts'
      ? API.searchByName(name, 1, { countryFilter: false }).then(items => (items || []).slice(0, 20).map(food => ({ ...food, _candidateProvider: provider })))
      : USDA.searchByName(name, 1, $usdaApiKey).then(items => (items || []).slice(0, 20).map(food => ({ ...food, _candidateProvider: provider })));
    providerSearchCache.set(key, promise);
    promise.catch(() => providerSearchCache.delete(key));
    return promise;
  }

  function localCandidates(query) {
    return foods.map(food => ({ ...food, _candidateProvider: 'local', _localFoodId: food.id }))
      .filter(food => normalizeName(`${food.name} ${food.brand || ''}`).includes(normalizeName(query)) || normalizeName(query).split(' ').some(token => token.length > 2 && normalizeName(`${food.name} ${food.brand || ''}`).includes(token)));
  }

  async function hydrateCandidate(candidate) {
    if (!candidate || candidate._candidateProvider === 'local') return candidate;
    let hydrated = null;
    if (candidate._candidateProvider === 'openfoodfacts' && candidate.barcode) {
      hydrated = await API.fetchProductByCode(candidate.barcode).catch(() => null);
    } else if (candidate._candidateProvider === 'usda' && (candidate.fdcId || String(candidate.barcode || '').startsWith('fdcId_'))) {
      const fdcId = candidate.fdcId || String(candidate.barcode).slice(6);
      hydrated = await USDA.fetchFoodById(fdcId, $usdaApiKey).catch(() => null);
    }
    return hydrated ? { ...candidate, ...hydrated, _candidateProvider: candidate._candidateProvider } : candidate;
  }

  function rankingOptions(row) {
    return {
      requiredUnit: row?.unit || row?.ingredient?.unit,
      preferredBrands: $preferredFoodBrands,
      brandPriority: $preferredBrandPriority,
    };
  }

  async function collectMatches(row, query, source = 'all', limit = 30) {
    const names = query ? [query] : ingredientSearchNames(row.ingredient);
    const queries = providerSearchQueries(names);
    const jobs = [];
    if (source === 'all' || source === 'local') jobs.push(Promise.resolve(queries.flatMap(localCandidates)));
    if ((source === 'all' || source === 'openfoodfacts') && $offEnabled) {
      for (const name of queries) jobs.push(cachedProviderSearch('openfoodfacts', name));
    }
    if ((source === 'all' || source === 'usda') && $usdaEnabled && $usdaApiKey) {
      for (const name of queries) jobs.push(cachedProviderSearch('usda', name));
    }
    const raw = (await Promise.allSettled(jobs)).flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const provisional = rankIngredientCandidates(names, raw, Math.max(limit, 8), rankingOptions(row));
    const hydrated = await Promise.all(provisional.slice(0, 8).map(hydrateCandidate));
    return rankIngredientCandidates(names, [...hydrated, ...provisional.slice(8)], limit, rankingOptions(row));
  }

  async function findProviderMatches(index) {
    const row = resolutions[index];
    const rows = [...resolutions];
    rows[index] = { ...row, searching: true, candidates: [], searchAttempted: true };
    resolutions = rows;
    try {
      const candidates = await collectMatches(row, '', 'all', 30);
      const next = [...resolutions];
      next[index] = { ...next[index], searching: false, candidates };
      resolutions = next;
    } catch (error) {
      const next = [...resolutions];
      next[index] = { ...next[index], searching: false, candidates: [] };
      resolutions = next;
      showError(error?.message || 'Provider search failed');
    }
  }

  async function autoMatchAll() {
    const snapshot = resolutions;
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < snapshot.length) {
        const index = nextIndex++;
        const row = snapshot[index];
        if (row.manuallySelected) continue;
      try {
        const candidates = await collectMatches(row, '', 'all', 30);
        const current = resolutions[index];
        if (!current || current.ingredient.original_text !== row.ingredient.original_text) continue;
        const best = candidates[0];
        const next = [...resolutions];
        next[index] = { ...current, candidates, searchAttempted: true, searching: false };
        if (best && isStrongIngredientCandidate(best) && !current.manuallySelected) {
          applyCandidateToRow(next[index], best, true);
        }
        resolutions = next;
        if (best && isStrongIngredientCandidate(best) && !current.manuallySelected) maybeEstimateConversion(index);
      } catch {
        const next = [...resolutions];
        if (next[index]) next[index] = { ...next[index], searching: false, searchAttempted: true };
        resolutions = next;
      }
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
    const { _candidateProvider, _matchScore, _relevanceScore, _matchReasons, _convertible, _brandRank, _sourceRank, _localFoodId, nameLanguage, id: _drop, ...foodData } = candidate;
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
    row.conversionSource = null;
    row.estimatingConversion = false;
    row.conversionEstimateFailed = false;
  }

  async function chooseProvider(index, candidate) {
    const row = resolutions[index];
    try {
      const hydrated = await hydrateCandidate(candidate);
      const next = [...resolutions];
      next[index] = { ...next[index] };
      applyCandidateToRow(next[index], hydrated, false);
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
    if (searchRowIndex < 0 || !searchQuery.trim()) { sheetResults = []; return; }
    const sequence = ++searchSequence;
    sheetSearching = true;
    try {
      const results = await collectMatches(resolutions[searchRowIndex], searchQuery.trim(), searchSource, 50);
      if (sequence === searchSequence) sheetResults = results;
    }
    catch (error) { if (sequence === searchSequence) { sheetResults = []; showError(error?.message || 'Food search failed'); } }
    finally { if (sequence === searchSequence) sheetSearching = false; }
  }

  function scheduleSheetSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSheetSearch, 250);
  }

  async function requestAiRefinement(index) {
    const row = resolutions[index];
    if (!row || row.aiRefining) return;
    const next = [...resolutions];
    next[index] = { ...row, aiRefining: true, aiProposal: null };
    resolutions = next;
    try {
      const proposal = await refineIngredientWithAI(row.ingredient.original_text, $offSearchLanguage);
      const done = [...resolutions];
      done[index] = { ...done[index], aiRefining: false, aiProposal: proposal };
      resolutions = done;
    } catch (error) {
      const done = [...resolutions];
      done[index] = { ...done[index], aiRefining: false, aiProposal: null };
      resolutions = done;
      showError(error?.message || 'Could not refine this ingredient');
    }
  }

  async function applyAiRefinement(index) {
    const row = resolutions[index];
    const proposal = row?.aiProposal;
    if (!proposal) return;
    const ingredient = {
      ...row.ingredient,
      name: proposal.name,
      brand: proposal.brand,
      search_names: proposal.search_names,
      note: proposal.note || row.ingredient.note,
      amounts: proposal.amounts.length ? proposal.amounts : (row.ingredient.amounts || []),
      normalization_source: 'ai',
    };
    const next = [...resolutions];
    next[index] = { ...row, ingredient, aiProposal: null, candidates: [], searchAttempted: false };
    resolutions = next;
    await findProviderMatches(index);
  }

  function dismissAiRefinement(index) {
    const next = [...resolutions];
    next[index] = { ...next[index], aiProposal: null };
    resolutions = next;
  }

  function chooseRecipe(index) {
    selectedIndex = index;
    initializeResolutions(result.recipes[index]);
    autoMatchAll();
  }

  function chooseFood(index, event) {
    const value = event.currentTarget.value;
    const food = foods.find(item => String(item.id) === value);
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
      equivalentGrams: null,
      conversionSource: null,
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
      autoMatchAll();
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
        servings: inferServings(recipe.yield_text),
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
      push('/meal-editor');
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
                {#if $aiEffectivelyEnabled && (row.ingredient.parse_confidence !== 'high' || (row.searchAttempted && !row.candidates?.length))}
                  <button class="btn btn-ghost ai-refine" on:click={() => requestAiRefinement(index)} disabled={row.aiRefining}>
                    {row.aiRefining ? $_('recipe_import.ai_refining') : $_('recipe_import.ai_refine')}
                  </button>
                {/if}
                {#if row.aiProposal}
                  <div class="ai-proposal">
                    <strong>{$_('recipe_import.ai_proposal')}</strong>
                    <span>{$_('recipe_import.ai_original', { values: { value: row.ingredient.name } })}</span>
                    <span>{$_('recipe_import.ai_proposed', { values: { value: row.aiProposal.search_names.join(' · ') } })}</span>
                    {#if row.aiProposal.amounts?.length}<span>{$_('recipe_import.ai_amounts', { values: { value: row.aiProposal.amounts.map(a => `${a.quantity} ${displayUnitName(a.unit, a.quantity, $locale)} (${a.role})`).join(' · ') } })}</span>{/if}
                    <div>
                      <button class="btn btn-primary" on:click={() => applyAiRefinement(index)}>{$_('recipe_import.ai_apply')}</button>
                      <button class="btn btn-ghost" on:click={() => dismissAiRefinement(index)}>{$_('recipe_import.dismiss')}</button>
                    </div>
                  </div>
                {/if}
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
          ...($offEnabled ? [{ value: 'openfoodfacts', label: 'Open Food Facts' }] : []),
          ...($usdaEnabled && $usdaApiKey ? [{ value: 'usda', label: 'USDA' }] : []),
        ] as sourceOption}
          <button class:active={searchSource === sourceOption.value} on:click={() => { searchSource = sourceOption.value; runSheetSearch(); }}>{sourceOption.label}</button>
        {/each}
      </div>
      {#if sheetSearching}
        <div class="sheet-state"><span class="material-symbols-rounded spin">refresh</span> Searching…</div>
      {:else if sheetResults.length}
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
  .amount-row { grid-column: 3; min-width: 0; display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 6px; }
  .amount-row > *, .unit-select { width: 100%; min-width: 0; }
  .ack-row { grid-column: 2 / -1; font-size: 12px; display: flex; gap: 7px; align-items: start; }
  .ack-row span { display: flex; flex-direction: column; gap: 2px; }
  .ack-row small { color: var(--text-3); font-weight: 400; }
  .conversion-warning { grid-column: 2 / -1; margin: 0; color: #b66a00; font-size: 12px; }
  .conversion-detail { grid-column: 2 / -1; margin: 0; color: var(--text-3); font-size: 12px; }
  .conversion-detail.estimated { color: #b66a00; }
  .retry-estimate { margin-left: 6px; border: 0; padding: 0; background: none; color: var(--accent); cursor: pointer; text-decoration: underline; }
  .ai-refine { justify-self: start; font-size: 12px; }
  .ai-proposal { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 8%, var(--surface-2)); font-size: 12px; }
  .ai-proposal > div { display: flex; gap: 8px; }
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
  .sheet-result { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); color: var(--text-1); text-align: left; cursor: pointer; }
  .result-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .result-main strong, .result-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result-main small, .result-source { color: var(--text-3); font-size: 11px; }
  .result-source { flex: 0 0 auto; }
  .sheet-state { min-height: 160px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-3); text-align: center; }
  @media (max-width: 700px) {
    .url-row { flex-direction: column; }
    .recipe-summary { grid-template-columns: 90px 1fr; }
    .recipe-summary img { width: 90px; height: 90px; }
    .ingredient-row { grid-template-columns: 1fr; }
    .ack-row, .conversion-warning, .conversion-detail { grid-column: 1; }
  }
  @container (max-width: 760px) {
    .ingredient-row { grid-template-columns: minmax(180px, 1fr) minmax(280px, 1.25fr); }
    .ingredient-source { grid-column: 1; grid-row: 1 / span 2; }
    .match-picker { grid-column: 2; }
    .amount-row { grid-column: 2; }
    .ack-row, .conversion-warning, .conversion-detail { grid-column: 2; }
  }
  @container (max-width: 540px) {
    .ingredient-row { grid-template-columns: minmax(0, 1fr); }
    .ingredient-source, .match-picker, .amount-row, .ack-row, .conversion-warning, .conversion-detail { grid-column: 1; grid-row: auto; }
  }
</style>
