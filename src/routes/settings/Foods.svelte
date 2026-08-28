<script>
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Toggle from '../../components/settings/Toggle.svelte';
  import { isNative } from '../../lib/platform.js';
  import {
    foodsShowCategories, foodsShowLabels, foodsShowNotes, foodsShowThumbnails,
    foodsShowYesterdayMeals, foodsSort, mealsSort, recipesSort,
    foodsDefaultSource, preferredFoodBrands, offEnabled, offSearchLanguage, offSearchCountry, usdaEnabled,
    recipeImportUsePreferredBrands, recipeImportPreferredBrandsFirst,
    barcodeBeep, barcodeFlashlight, cropPhotos,
  } from '../../stores/settings.js';
  import { DB } from '../../lib/db.js';
  import { API } from '../../lib/api.js';
  import { offCountryTagToIso } from '../../lib/off-country-flag.js';
  import { normalizeBrandName } from '../../lib/ingredient-match.js';
  // Mealie is a plain localStorage flag (not a store), unlike OFF/USDA.
  const _mealieEnabled = DB.getSetting('mealieEnabled', false);
  let preferredBrandInput = '';
  let brandSuggestions = [];
  let brandSearching = false;
  let brandSearchError = '';
  let highlightedBrand = -1;
  let brandSearchTimer;

  const brandName = brand => typeof brand === 'string' ? brand : brand?.name || '';
  const verifiedBrand = brand => !!(brand && typeof brand === 'object' && brand.offTag);

  async function searchPreferredBrands() {
    const query = preferredBrandInput.trim();
    brandSuggestions = [];
    highlightedBrand = -1;
    brandSearchError = '';
    if (!$offEnabled || query.length < 2) return;
    brandSearching = true;
    try {
      brandSuggestions = await API.suggestBrands(query, {
        language: $offSearchLanguage,
        country: offCountryTagToIso($offSearchCountry),
        limit: 10,
      });
      if (brandSuggestions.length) highlightedBrand = 0;
    } catch {
      brandSearchError = 'Open Food Facts brand lookup is unavailable. Try again shortly.';
    } finally { brandSearching = false; }
  }

  function scheduleBrandSearch() {
    clearTimeout(brandSearchTimer);
    brandSearchTimer = setTimeout(searchPreferredBrands, 275);
  }

  async function addPreferredBrand(suggestion) {
    if (!suggestion?.offTag) return;
    brandSearching = true;
    try {
      const canonical = await API.canonicalizeBrand(suggestion, { language: $offSearchLanguage });
      if (!canonical) throw new Error('Brand could not be verified');
      const exists = $preferredFoodBrands.some(item => verifiedBrand(item) && item.offTag.toLowerCase() === canonical.offTag.toLowerCase());
      if (!exists) preferredFoodBrands.set([...$preferredFoodBrands, canonical]);
      preferredBrandInput = '';
      brandSuggestions = [];
      highlightedBrand = -1;
    } catch {
      brandSearchError = 'That brand could not be verified with Open Food Facts.';
    } finally { brandSearching = false; }
  }

  function onBrandKeydown(event) {
    if (event.key === 'ArrowDown' && brandSuggestions.length) {
      event.preventDefault(); highlightedBrand = (highlightedBrand + 1) % brandSuggestions.length;
    } else if (event.key === 'ArrowUp' && brandSuggestions.length) {
      event.preventDefault(); highlightedBrand = (highlightedBrand - 1 + brandSuggestions.length) % brandSuggestions.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (highlightedBrand >= 0) addPreferredBrand(brandSuggestions[highlightedBrand]);
    } else if (event.key === 'Escape') {
      brandSuggestions = []; highlightedBrand = -1;
    }
  }

  function removePreferredBrand(index) {
    preferredFoodBrands.set($preferredFoodBrands.filter((_, i) => i !== index));
  }

  function movePreferredBrand(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= $preferredFoodBrands.length) return;
    const next = [...$preferredFoodBrands];
    [next[index], next[target]] = [next[target], next[index]];
    preferredFoodBrands.set(next);
  }

  onMount(async () => {
    if (!$offEnabled) return;
    const next = [...$preferredFoodBrands];
    let changed = false;
    for (let index = 0; index < next.length; index++) {
      const legacy = next[index];
      if (verifiedBrand(legacy) || typeof legacy !== 'string' || !legacy.trim()) continue;
      try {
        const suggestions = await API.suggestBrands(legacy, {
          language: $offSearchLanguage, country: offCountryTagToIso($offSearchCountry), limit: 10,
        });
        const exact = suggestions.find(item => normalizeBrandName(item.name) === normalizeBrandName(legacy));
        if (exact) {
          const canonical = await API.canonicalizeBrand(exact, { language: $offSearchLanguage });
          if (canonical) { next[index] = canonical; changed = true; }
        }
      } catch { /* legacy values remain visible and inert */ }
    }
    if (changed) preferredFoodBrands.set(next);
  });
</script>

<div class="section-body">

  <!-- Group: Food Row Display — what shows on each row in the Foods / Meals list -->
  <p class="settings-group-heading">Food Row Display</p>
  <p class="settings-group-sub">Fields shown on each row in the Foods, Meals, and Recipes tabs.</p>
  <div class="card settings-card">
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_foods_picker.show_thumbnails')}</span><div class="setting-desc">{$_('settings_foods_picker.show_thumbnails_desc')}</div></div>
      <Toggle checked={$foodsShowThumbnails} on:change={e => foodsShowThumbnails.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row brand-setting-row">
      <div>
        <span class="setting-label">Preferred Brands</span>
        <div class="setting-desc">Choose verified Open Food Facts brands. Earlier brands have higher priority.</div>
        <div class="brand-combobox">
          <input class="input" type="text" placeholder="Search Open Food Facts brands" bind:value={preferredBrandInput}
            disabled={!$offEnabled} role="combobox" aria-autocomplete="list" aria-expanded={brandSuggestions.length > 0}
            aria-controls="off-brand-suggestions" on:input={scheduleBrandSearch} on:keydown={onBrandKeydown} />
          {#if brandSearching}<span class="brand-spinner">Searching…</span>{/if}
          {#if brandSuggestions.length}
            <div id="off-brand-suggestions" class="brand-suggestions" role="listbox">
              {#each brandSuggestions as suggestion, suggestionIndex}
                <button class:active={highlightedBrand === suggestionIndex} role="option"
                  aria-selected={highlightedBrand === suggestionIndex}
                  on:mousedown={event => event.preventDefault()} on:click={() => addPreferredBrand(suggestion)}>
                  <span>{suggestion.name}</span><small>Open Food Facts</small>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        {#if !$offEnabled}<div class="brand-help">Enable Open Food Facts to add or verify preferred brands.</div>{/if}
        {#if brandSearchError}<div class="brand-error">{brandSearchError}</div>{/if}
        {#if $preferredFoodBrands.length}
          <div class="brand-tags">
            {#each $preferredFoodBrands as brand, index}
              <span class="brand-tag" class:unverified={!verifiedBrand(brand)}>
                <button class="brand-move" on:click={() => movePreferredBrand(index, -1)} disabled={index === 0} aria-label={`Move ${brandName(brand)} up`}>↑</button>
                <button class="brand-move" on:click={() => movePreferredBrand(index, 1)} disabled={index === $preferredFoodBrands.length - 1} aria-label={`Move ${brandName(brand)} down`}>↓</button>
                {brandName(brand)}
                <small>{verifiedBrand(brand) ? '✓ OFF' : 'Needs OFF match'}</small>
                <button class="brand-remove" on:click={() => removePreferredBrand(index)} aria-label={`Remove ${brandName(brand)}`}>×</button>
              </span>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">Use preferred brands in recipe import</span><div class="setting-desc">Promote relevant foods from your verified brand list.</div></div>
      <Toggle checked={$recipeImportUsePreferredBrands} on:change={e => recipeImportUsePreferredBrands.set(e.detail)} />
    </div>
    {#if $recipeImportUsePreferredBrands}
      <div class="setting-divider"></div>
      <div class="setting-row">
        <div><span class="setting-label">Preferred brands before Local</span><div class="setting-desc">When on, relevant preferred-brand foods are considered before your saved Local foods.</div></div>
        <Toggle checked={$recipeImportPreferredBrandsFirst} on:change={e => recipeImportPreferredBrandsFirst.set(e.detail)} />
      </div>
    {/if}
    <div class="priority-summary">
      Recipe import priority: {$recipeImportUsePreferredBrands
        ? ($recipeImportPreferredBrandsFirst ? 'Preferred brands → Local → USDA → Open Food Facts' : 'Local → Preferred brands → USDA → Open Food Facts')
        : 'Local → USDA → Open Food Facts'}
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_foods_picker.show_categories')}</span><div class="setting-desc">{$_('settings_foods_picker.show_categories_desc')}</div></div>
      <Toggle checked={$foodsShowCategories} on:change={e => foodsShowCategories.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_foods_picker.show_category_labels')}</span><div class="setting-desc">{$_('settings_foods_picker.show_category_labels_desc')}</div></div>
      <Toggle checked={$foodsShowLabels} on:change={e => foodsShowLabels.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_foods_picker.show_notes')}</span><div class="setting-desc">{$_('settings_foods_picker.show_notes_desc')}</div></div>
      <Toggle checked={$foodsShowNotes} on:change={e => foodsShowNotes.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">Show Yesterday's Meals</span><div class="setting-desc">Pin yesterday's meals as quick-add cards in the Meals tab. Tap the info icon to see what's in each one.</div></div>
      <Toggle checked={$foodsShowYesterdayMeals} on:change={e => foodsShowYesterdayMeals.set(e.detail)} />
    </div>
  </div>

  <!-- Group: Sort & Source — default search source + per-tab sort order -->
  <p class="settings-group-heading">Sort &amp; Source</p>
  <p class="settings-group-sub">Default source when searching, and ordering on each list.</p>
  <div class="card settings-card">
    <div class="setting-row">
      <div>
        <span class="setting-label">{$_('settings_foods_picker.default_source')}</span>
        <div class="setting-desc">{$_('settings_foods_picker.default_source_desc')}</div>
      </div>
      <div class="select-wrap" style="width:160px">
        <select class="select sel-sm" value={$foodsDefaultSource} on:change={e => foodsDefaultSource.set(e.target.value)}>
          <option value="all">{$_('foods.sources.all')}</option>
          <option value="local">{$_('foods.sources.local')}</option>
          {#if $offEnabled}<option value="off">OFF</option>{/if}
          {#if $usdaEnabled}<option value="usda">USDA</option>{/if}
          {#if _mealieEnabled}<option value="mealie">Mealie</option>{/if}
        </select>
      </div>
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div>
        <span class="setting-label">{$_('settings_foods_picker.foods_sort')}</span>
        <div class="setting-desc">How items are ordered in the Foods tab. Favorites are always pinned at the top regardless of sort.</div>
      </div>
      <div class="select-wrap" style="width:160px">
        <select class="select sel-sm" value={$foodsSort} on:change={e => foodsSort.set(e.target.value)}>
          <option value="recent">{$_('settings_foods_picker.opt_recent')}</option>
          <option value="most">{$_('settings_foods_picker.opt_most')}</option>
          <option value="alpha">{$_('settings_foods_picker.opt_alpha')}</option>
        </select>
      </div>
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div>
        <span class="setting-label">{$_('settings_foods_picker.meals_sort')}</span>
        <div class="setting-desc">How items are ordered in the Meals tab.</div>
      </div>
      <div class="select-wrap" style="width:160px">
        <select class="select sel-sm" value={$mealsSort} on:change={e => mealsSort.set(e.target.value)}>
          <option value="recent">{$_('settings_foods_picker.opt_recent')}</option>
          <option value="most">{$_('settings_foods_picker.opt_most')}</option>
          <option value="alpha">{$_('settings_foods_picker.opt_alpha')}</option>
        </select>
      </div>
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div>
        <span class="setting-label">{$_('settings_scanner.recipes_sort')}</span>
        <div class="setting-desc">How items are ordered in the Recipes tab.</div>
      </div>
      <div class="select-wrap" style="width:160px">
        <select class="select sel-sm" value={$recipesSort} on:change={e => recipesSort.set(e.target.value)}>
          <option value="recent">{$_('settings_foods_picker.opt_recent')}</option>
          <option value="most">{$_('settings_foods_picker.opt_most')}</option>
          <option value="alpha">{$_('settings_foods_picker.opt_alpha')}</option>
        </select>
      </div>
    </div>
  </div>

  <!-- Group: Camera & Scanning — barcode scanner UX -->
  <p class="settings-group-heading">Camera &amp; Scanning</p>
  <p class="settings-group-sub">Barcode scanner audio, flashlight, and photo crop preferences.</p>
  <div class="card settings-card">
    <div class="setting-row"><span class="setting-label">{$_('settings_scanner.beep_on_scan')}</span><Toggle checked={$barcodeBeep} on:change={e => barcodeBeep.set(e.detail)} /></div>
    {#if isNative}
      <div class="setting-divider"></div>
      <div class="setting-row"><span class="setting-label">{$_('settings_scanner.use_flashlight')}</span><Toggle checked={$barcodeFlashlight} on:change={e => barcodeFlashlight.set(e.detail)} /></div>
    {/if}
    <div class="setting-divider"></div>
    <div class="setting-row"><span class="setting-label">{$_('settings_scanner.crop_photos')}</span><Toggle checked={$cropPhotos} on:change={e => cropPhotos.set(e.detail)} /></div>
  </div>

</div>

<style>
  .brand-setting-row { align-items: flex-start; }
  .brand-setting-row > div:first-child { flex: 1; min-width: 0; }
  .brand-combobox { position: relative; margin-top: 10px; max-width: 520px; }
  .brand-combobox .input { width: 100%; }
  .brand-spinner { position: absolute; right: 12px; top: 12px; color: var(--text-3); font-size: 12px; }
  .brand-suggestions { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0; max-height: 260px; overflow: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); }
  .brand-suggestions button { width: 100%; border: 0; background: transparent; color: var(--text-1); padding: 9px 11px; display: flex; justify-content: space-between; gap: 8px; text-align: left; cursor: pointer; }
  .brand-suggestions button.active, .brand-suggestions button:hover { background: var(--surface-2); }
  .brand-suggestions small, .brand-tag small { color: var(--text-3); }
  .brand-help, .brand-error { font-size: 12px; margin-top: 6px; color: var(--text-3); }
  .brand-error { color: var(--danger, #d55); }
  .brand-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .brand-tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); font-size: 12px; }
  .brand-tag.unverified { border-color: color-mix(in srgb, #f59e0b 55%, var(--border)); }
  .priority-summary { padding: 10px 12px; color: var(--text-2); font-size: 12px; background: var(--surface-2); }
  .brand-move, .brand-remove { border: 0; background: transparent; color: var(--text-2); cursor: pointer; padding: 0 2px; }
  .brand-move:disabled { opacity: .3; cursor: default; }
  .brand-remove { font-size: 16px; }
  @media (max-width: 700px) { .brand-setting-row { align-items: stretch; } }
</style>
