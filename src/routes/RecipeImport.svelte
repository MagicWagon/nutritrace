<script>
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { _ } from 'svelte-i18n';
  import { NtApi, API, USDA } from '../lib/api.js';
  import { isNative, getServerUrl } from '../lib/platform.js';
  import { showSuccess, showError } from '../stores/toast.js';
  import { editorState } from '../stores/editorState.js';
  import { offEnabled, usdaEnabled, usdaApiKey } from '../stores/settings.js';
  import { unitToGrams, unitSystem } from '../lib/units.js';
  import { prepareRecipeImportDraft, persistRecipeImportDraft, RECIPE_IMPORT_DRAFT_KEY } from '../lib/recipe-import-draft.js';

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

  $: recipe = result?.recipes?.[selectedIndex] || null;
  $: unresolvedReady = resolutions.every(row => (row.foodId != null && !conversionRequired(row)) || row.acknowledged);
  $: if (result && typeof localStorage !== 'undefined') {
    persistRecipeImportDraft(localStorage, result, selectedIndex, resolutions);
  }

  function normalizeName(value) {
    return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function inferServings(text) {
    const match = /\d+(?:\.\d+)?/.exec(String(text || ''));
    return match ? Math.max(1, Math.round(Number(match[0]))) : 1;
  }

  function altGrams(food, unit) {
    const key = String(unit || '').toLowerCase();
    const match = (food?.alt_units || []).find(row => String(row?.abbr || '').toLowerCase() === key && Number(row?.grams) > 0);
    return match ? Number(match.grams) : null;
  }

  function amountFrame(food, amount, unit) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    const alt = altGrams(food, unit);
    if (alt != null) return { system: 'g', value: n * alt };
    const system = unitSystem(unit);
    const multiplier = unitToGrams(unit);
    if (system && multiplier != null) return { system, value: n * multiplier };
    return { system: 'opaque', value: n, unit: String(unit || '').toLowerCase() };
  }

  function conversionRequired(row) {
    if (row.foodId == null) return false;
    const food = foods.find(item => String(item.id) === String(row.foodId));
    if (!food) return true;
    const base = amountFrame(food, food.portion || 100, food.unit || 'g');
    const wanted = amountFrame(food, row.portion, row.unit);
    if (!base || !wanted) return true;
    if (base.system === wanted.system) return base.system !== 'opaque' || base.unit !== wanted.unit;
    if (base.system === 'opaque' || wanted.system === 'opaque') return true;
    return !(Number(food.density_g_ml) > 0);
  }

  function initializeResolutions(nextRecipe) {
    resolutions = (nextRecipe.ingredients || []).map(ingredient => {
      const target = normalizeName(ingredient.name);
      const matches = foods.filter(food => normalizeName(food.name) === target);
      const mapped = nextRecipe.source === 'mealie' && nextRecipe.source_instance && ingredient.source_food_id
        ? foods.filter(food => (food.external_refs || []).some(ref => ref.provider === 'mealie' && ref.instance === nextRecipe.source_instance && ref.kind === 'food' && String(ref.id) === String(ingredient.source_food_id)))
        : [];
      const food = mapped.length === 1 ? mapped[0] : (matches.length === 1 ? matches[0] : null);
      const sourceAmount = Number(ingredient.quantity);
      return {
        ingredient,
        foodId: food?.id ?? null,
        portion: Number.isFinite(sourceAmount) && sourceAmount > 0 ? sourceAmount : (food?.portion || 1),
        unit: ingredient.unit || food?.unit || 'serving',
        acknowledged: false,
        automatic: !!food,
        searching: false,
        candidates: [],
      };
    });
  }

  async function findProviderMatches(index) {
    const row = resolutions[index];
    const rows = [...resolutions];
    rows[index] = { ...row, searching: true, candidates: [] };
    resolutions = rows;
    try {
      const jobs = [];
      if ($offEnabled) jobs.push(API.searchByName(row.ingredient.name, 1).then(items => (items || []).slice(0, 5).map(food => ({ ...food, _candidateProvider: 'openfoodfacts' }))));
      if ($usdaEnabled && $usdaApiKey) jobs.push(USDA.searchByName(row.ingredient.name, 1, $usdaApiKey).then(items => (items || []).slice(0, 5).map(food => ({ ...food, _candidateProvider: 'usda' }))));
      const candidates = (await Promise.all(jobs)).flat().slice(0, 8);
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

  async function chooseProvider(index, candidate) {
    const providerReference = candidate._candidateProvider === 'openfoodfacts' && candidate.barcode
      ? [{ provider: 'openfoodfacts', kind: 'product', id: candidate.barcode }]
      : candidate._candidateProvider === 'usda' && (candidate.fdcId || candidate.id)
        ? [{ provider: 'usda', kind: 'food', id: String(candidate.fdcId || candidate.id) }]
        : [];
    const mealieReference = recipe?.source === 'mealie' && recipe.source_instance && row.ingredient.source_food_id
      ? [{ provider: 'mealie', instance: recipe.source_instance, kind: 'food', id: String(row.ingredient.source_food_id) }]
      : [];
    const { _candidateProvider, id: _drop, ...foodData } = candidate;
    try {
      const saved = await NtApi.createFood({ ...foodData, external_refs: [...providerReference, ...mealieReference] });
      foods = [...foods, saved].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      const next = [...resolutions];
      next[index] = {
        ...next[index], foodId: saved.id,
        portion: Number(row.ingredient.quantity) > 0 ? Number(row.ingredient.quantity) : (saved.portion || 100),
        unit: row.ingredient.unit || saved.unit || 'g',
        acknowledged: false, automatic: false, candidates: [], searching: false,
      };
      resolutions = next;
    } catch (error) {
      showError(error?.message || 'Could not save provider food');
    }
  }

  function chooseRecipe(index) {
    selectedIndex = index;
    initializeResolutions(result.recipes[index]);
  }

  function chooseFood(index, event) {
    const value = event.currentTarget.value;
    const food = foods.find(item => String(item.id) === value);
    const rows = [...resolutions];
    rows[index] = {
      ...rows[index],
      foodId: food?.id ?? null,
      portion: Number(rows[index].ingredient.quantity) > 0 ? Number(rows[index].ingredient.quantity) : (food?.portion || 1),
      unit: rows[index].ingredient.unit || food?.unit || 'serving',
      acknowledged: food ? false : rows[index].acknowledged,
      automatic: false,
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
        servings: inferServings(recipe.yield_text),
        mode,
        ingredients: resolutions.map(row => ({
          food_id: row.acknowledged && conversionRequired(row) ? null : row.foodId,
          portion: row.portion,
          unit: row.unit,
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
            group: row.ingredient.group || '',
            resolution: row.foodId && !(row.acknowledged && conversionRequired(row)) ? (row.automatic ? 'local_exact' : 'local_selected') : 'unresolved',
          },
        })),
      });
      try { localStorage.removeItem(RECIPE_IMPORT_DRAFT_KEY); } catch {}
      showSuccess(mode === 'update' ? $_('recipe_import.updated') : $_('recipe_import.success'));
      editorState.foodsActiveTab = 2;
      editorState.mealIsRecipe = true;
      editorState.mealPrefill = saved;
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
            <div class="ingredient-row" class:unresolved={row.foodId == null}>
              <div class="ingredient-source">
                <strong>{row.ingredient.original_text}</strong>
                {#if row.ingredient.parse_confidence !== 'high'}<span class="status warn">{$_('recipe_import.check_amount')}</span>{/if}
                {#if row.automatic}<span class="status">{$_('recipe_import.exact_match')}</span>{/if}
              </div>
              <select class="select" value={row.foodId ?? ''} on:change={event => chooseFood(index, event)}>
                <option value="">{$_('recipe_import.placeholder')}</option>
                {#each foods as food}<option value={food.id}>{food.name}{food.brand ? ` — ${food.brand}` : ''}</option>{/each}
              </select>
              {#if row.foodId != null}
                <div class="amount-row">
                  <input class="input" type="number" min="0" step="any" bind:value={row.portion} aria-label={$_('recipe_import.amount')} />
                  <input class="input unit-input" bind:value={row.unit} aria-label={$_('recipe_import.unit')} />
                </div>
                {#if conversionRequired(row)}
                  <p class="conversion-warning">{$_('recipe_import.conversion', { values: { unit: foods.find(item => String(item.id) === String(row.foodId))?.unit || $_('recipe_import.unit') } })}</p>
                  <label class="ack-row">
                    <input type="checkbox" bind:checked={row.acknowledged} />
                    {$_('recipe_import.use_placeholder')}
                  </label>
                {/if}
              {:else}
                {#if $offEnabled || ($usdaEnabled && $usdaApiKey)}
                  <button class="btn btn-ghost provider-search" on:click={() => findProviderMatches(index)} disabled={row.searching}>
                    {row.searching ? $_('recipe_import.searching') : $_('recipe_import.find_provider')}
                  </button>
                  {#if row.candidates?.length}
                    <div class="candidate-list">
                      {#each row.candidates as candidate}
                        <button on:click={() => chooseProvider(index, candidate)}>
                          <strong>{candidate.name}</strong>
                          <span>{candidate.brand || candidate._candidateProvider}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                {/if}
                <label class="ack-row">
                  <input type="checkbox" bind:checked={row.acknowledged} />
                  {$_('recipe_import.acknowledge')}
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
        <button class="btn btn-ghost" on:click={() => { result = null; resolutions = []; try { localStorage.removeItem(DRAFT_KEY); } catch {} }}>{$_('recipe_import.another')}</button>
        <button class="btn btn-primary" on:click={() => commit()} disabled={saving || !unresolvedReady}>
          {saving ? $_('recipe_import.importing') : $_('recipe_import.import')}
        </button>
      </div>
      {#if !unresolvedReady}<p class="blocking-note">{$_('recipe_import.blocked')}</p>{/if}
    {/if}
  </main>
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
  .ingredient-list { display: flex; flex-direction: column; gap: 10px; }
  .ingredient-row { display: grid; grid-template-columns: minmax(180px, 1.3fr) minmax(180px, 1fr) 180px; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); align-items: center; }
  .ingredient-row.unresolved { border-color: color-mix(in srgb, #f59e0b 55%, var(--border)); }
  .ingredient-source { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .status { font-size: 11px; padding: 2px 6px; color: var(--accent); border-radius: 999px; background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .status.warn { color: #b66a00; background: color-mix(in srgb, #f59e0b 15%, transparent); }
  .amount-row { display: grid; grid-template-columns: 1fr 72px; gap: 6px; }
  .ack-row { font-size: 12px; display: flex; gap: 7px; align-items: start; }
  .provider-search { justify-self: start; font-size: 12px; }
  .conversion-warning { grid-column: 2 / -1; margin: 0; color: #b66a00; font-size: 12px; }
  .candidate-list { grid-column: 1 / -1; display: grid; gap: 6px; }
  .candidate-list button { display: flex; justify-content: space-between; gap: 8px; text-align: left; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-1); cursor: pointer; }
  .candidate-list span { color: var(--text-3); font-size: 12px; }
  .instructions { margin: 0; padding-left: 24px; display: flex; flex-direction: column; gap: 10px; }
  .conflict-card { display: flex; flex-direction: column; gap: 8px; }
  .import-actions { display: flex; justify-content: flex-end; gap: 10px; position: sticky; bottom: 12px; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); padding: 12px; border-radius: var(--radius-lg); }
  .blocking-note { text-align: right; }
  @media (max-width: 700px) {
    .url-row { flex-direction: column; }
    .recipe-summary { grid-template-columns: 90px 1fr; }
    .recipe-summary img { width: 90px; height: 90px; }
    .ingredient-row { grid-template-columns: 1fr; }
  }
</style>
