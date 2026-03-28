<script>
  import { onMount, tick } from 'svelte';
  import { push, location } from 'svelte-spa-router';
  import { fade, fly } from 'svelte/transition';

  import Tabs        from '../components/ui/Tabs.svelte';
  import ActionSheet     from '../components/ui/ActionSheet.svelte';
  import BarcodeScanner from '../components/foods/BarcodeScanner.svelte';
  import Dialog      from '../components/ui/Dialog.svelte';
  import Sheet       from '../components/ui/Sheet.svelte';
  import { diaryPromptQuantity } from '../stores/settings.js';
  import { showSuccess, showError } from '../stores/toast.js';
  import { editorState, clearFoodEditorState } from '../stores/editorState.js';
  import { DB, localDateStr } from '../lib/db.js';
  import { loadEntry } from '../stores/diary.js';
  import { API, USDA, NtApi } from '../lib/api.js';
  import { Nutrition } from '../lib/nutrition.js';
  import { Mealie } from '../lib/mealieApi.js';
  import { foodsShowThumbnails, foodsShowCategories, foodsShowLabels, foodsShowNotes, foodsSort, foodCategories, foodsShowYesterdayMeals, mealNames, usdaEnabled, usdaApiKey, catName as _catName, catDisplay as _catDisplay, pageBanners } from '../stores/settings.js';
  import FoodsBanner from '../components/banners/FoodsBanner.svelte';

  // Query string params
  function qs() {
    const hash = window.location.hash;
    const qIdx = hash.indexOf('?');
    if (qIdx < 0) return {};
    return Object.fromEntries(new URLSearchParams(hash.slice(qIdx + 1)));
  }

  $: params = qs();
  $: pickMode  = params.pick === '1';
  $: pickMeal  = params.meal;
  $: pickDate  = params.date;

  const TABS = [
    { label: 'Foods',   value: 'foodList' },
    { label: 'Meals',   value: 'meals' },
    { label: 'Recipes', value: 'recipes' },
  ];
  let activeTab = 0;
  $: { activeTab; activeCategoryFilter = ''; if (activeTab !== 0) searchSource = 'local'; }
  $: _tabIcon = activeTab === 0 ? 'restaurant' : activeTab === 1 ? 'dinner_dining' : 'menu_book';
  $: { if (pickMode) loadYesterdayMeals(); }

  let search = '';
  let searchSource = 'local';
  const _mealieEnabled = DB.getSetting('mealieEnabled',  false);
  $: availableSources = [
    { value: 'local',  label: 'Local'  },
    { value: 'off',    label: 'OFF'    },
    ...($usdaEnabled   ? [{ value: 'usda',   label: 'USDA'   }] : []),
    ...(_mealieEnabled ? [{ value: 'mealie', label: 'Mealie' }] : []),
  ];
  $: _sourceLabel = availableSources.find(s => s.value === searchSource)?.label || '';

  let localFoods = [];
  let localMeals = [];
  let localRecipes = [];
  let apiResults = [];
  let mealieResults = [];
  let loading = false;
  let loadError = false;
  let mealieLoading = false;
  let searchTimeout = null;

  let showItemActions = false;
  let selectedItem = null;
  let showDeleteDialog = false;
  let scannerOpen = false;
  let showQtyPrompt = false;
  let promptFood = null;
  let promptServings = 1;
  let promptPortion = 100;
  let promptUnit = 'g';
  let activeCategoryFilter = ''; // '' = all
  let yesterdayMeals = []; // { mealIdx, mealName, items, totalKcal } — only in pick mode

  // Multi-select (pick mode only)
  let selectedFoods = new Set();      // Set<food object reference>
  let showMultiPortionSheet = false;
  let multiPortionItems = [];         // [{ food, portion, unit, servings }]
  let multiAdding = false;

  // Clear selection when tab or search changes
  $: { activeTab; search; selectedFoods = new Set(); }

  // Convert item portions to grams for total serving display
  const _toG = { g:1, ml:1, oz:28.35, lb:453.59, cup:240, tbsp:15, tsp:5 };
  function mealServing(items) {
    if (!items?.length) return '0g';
    const total = items.reduce((s, i) => s + (parseFloat(i.portion)||0) * (_toG[i.unit] ?? 1), 0);
    return `${Math.round(total)}g`;
  }

  $: currentStore = TABS[activeTab].value;
  $: displayList = activeTab === 0 ? localFoods : activeTab === 1 ? localMeals : localRecipes;
  $: filteredBySearch = search
    ? displayList.filter(f =>
        (f.name||'').toLowerCase().includes(search.toLowerCase()) ||
        (f.brand||'').toLowerCase().includes(search.toLowerCase()))
    : displayList;
  $: filteredList = activeCategoryFilter
    ? filteredBySearch.filter(f => (f.categories||[]).includes(activeCategoryFilter))
    : filteredBySearch;

  async function load() {
    loadError = false;
    try {
      [localFoods, localMeals, localRecipes] = await Promise.all([
        NtApi.getFoods(),
        NtApi.getMeals(),
        NtApi.getRecipes(),
      ]);
      const sort = foodsSort.get();
      if (sort === 'alpha') {
        [localFoods, localMeals, localRecipes].forEach(arr =>
          arr.sort((a,b) => (a.name||'').localeCompare(b.name||'')));
      }
    } catch(e) {
      console.error('[foods] load error:', e);
      loadError = true;
    }
  }

  async function onSearch() {
    clearTimeout(searchTimeout);
    apiResults = [];
    mealieResults = [];
    if (!search.trim() || searchSource === 'local') return;
    const src = searchSource;
    searchTimeout = setTimeout(async () => {
      if (activeTab !== 0) return;
      if (src === 'off') {
        try {
          loading = true;
          apiResults = await API.searchByName(search) || [];
        } catch { apiResults = []; }
        finally { loading = false; }
      } else if (src === 'usda') {
        try {
          loading = true;
          const key = usdaApiKey.get();
          apiResults = await USDA.searchByName(search, 1, key) || [];
        } catch { apiResults = []; }
        finally { loading = false; }
      } else if (src === 'mealie') {
        try {
          mealieLoading = true;
          mealieResults = await Mealie.search(search) || [];
        } catch { mealieResults = []; }
        finally { mealieLoading = false; }
      }
    }, 400);
  }

  async function pickMealieRecipe(summary) {
    try {
      const full = await Mealie.getRecipe(summary.slug);
      if (!full) { showError('Could not load recipe from Mealie'); return; }
      const mapped = Mealie.mapRecipe(full);
      openEditor(mapped, 'foodList');
    } catch(e) {
      showError('Failed to import from Mealie');
    }
  }

  $: { search; searchSource; onSearch(); }

  function _saveScrollState() {
    editorState.foodsScrollY   = window.scrollY;
    editorState.foodsActiveTab = activeTab;
  }

  function openEditor(item, store) {
    _saveScrollState();
    editorState.foodPrefill = item ? { ...item } : null;
    editorState.foodStore   = store || currentStore;
    if (pickMode) editorState.foodDiaryCtx = { date: pickDate, meal: pickMeal };
    push('/foods/edit');
  }

  function openMealEditor(item, isRecipe) {
    _saveScrollState();
    editorState.mealPrefill  = item ? { ...item } : null;
    editorState.mealIsRecipe = isRecipe;
    push(item ? '/meal-editor/' + item.id : '/meal-editor');
  }

  async function pickFood(food) {
    if (!pickMode) {
      // Meals/Recipes open the meal editor; Foods open the food editor
      if (activeTab === 1) { openMealEditor(food, false); return; }
      if (activeTab === 2) { openMealEditor(food, true);  return; }
      openEditor(food, 'foodList');
      return;
    }
    // Meals: always expand ingredients at saved portions — no quantity prompt
    if (activeTab === 1 && food.items && food.items.length > 0) {
      await _expandMealToDiary(food);
      return;
    }
    // Foods & Recipes: prompt for quantity if setting enabled
    if ($diaryPromptQuantity) {
      promptFood = food;
      promptServings = 1;
      promptPortion = food.portion || 100;
      promptUnit = food.unit || 'g';
      showQtyPrompt = true;
      return;
    }
    await _addFoodToDiary(food, 1);
  }

  async function _expandMealToDiary(meal) {
    const { addDiaryItem } = await import('../stores/diary.js');
    for (const item of meal.items) {
      await addDiaryItem(
        { ...item, quantity: item.quantity || 1 },
        Number(pickMeal) || 0,
        pickDate || undefined
      );
    }
    import('../stores/toast.js').then(m => m.showSuccess('Added to diary'));
    editorState.lastMealAdded = Number(pickMeal) || 0;
    history.back();
  }

  async function _addFoodToDiaryNoNav(food, qty) {
    const { addDiaryItem } = await import('../stores/diary.js');
    let savedFood = food;
    if (!food.id || typeof food.id !== 'number') {
      const { id: _drop, ...rest } = food;
      savedFood = await NtApi.createFood({ ...rest, created_at: food.dateTime || new Date().toISOString() });
    }
    const item = {
      ...savedFood,
      portion: savedFood.portion || 100,
      unit: savedFood.unit || 'g',
      quantity: qty,
      nutrition: savedFood.nutrition
    };
    await addDiaryItem(item, Number(pickMeal) || 0, pickDate || undefined);
  }

  async function _addFoodToDiary(food, qty) {
    await _addFoodToDiaryNoNav(food, qty);
    import('../stores/toast.js').then(m => m.showSuccess('Added to diary'));
    editorState.lastMealAdded = Number(pickMeal) || 0;
    history.back();
  }

  function toggleSelect(food) {
    if (selectedFoods.has(food)) selectedFoods.delete(food);
    else selectedFoods.add(food);
    selectedFoods = selectedFoods;
  }

  async function confirmMultiAdd() {
    if (selectedFoods.size === 0 || multiAdding) return;
    const foods = [...selectedFoods];

    // Meals always expand ingredients — no portion prompt even if setting is on
    if (activeTab === 1) {
      multiAdding = true;
      const { addDiaryItem } = await import('../stores/diary.js');
      for (const meal of foods) {
        for (const item of (meal.items || [])) {
          await addDiaryItem({ ...item, quantity: item.quantity || 1 }, Number(pickMeal) || 0, pickDate || undefined);
        }
      }
      showSuccess(`Added ${foods.length} meal${foods.length > 1 ? 's' : ''} to diary`);
      editorState.lastMealAdded = Number(pickMeal) || 0;
      multiAdding = false;
      history.back();
      return;
    }

    // Foods & Recipes: if prompt setting on, show single stacked portion sheet
    if ($diaryPromptQuantity) {
      multiPortionItems = foods.map(food => ({
        food,
        portion: food.portion || 100,
        unit: food.unit || 'g',
        servings: 1,
      }));
      showMultiPortionSheet = true;
      return;
    }

    // No prompt — add all with defaults
    multiAdding = true;
    for (const food of foods) await _addFoodToDiaryNoNav(food, 1);
    showSuccess(`Added ${foods.length} item${foods.length > 1 ? 's' : ''} to diary`);
    editorState.lastMealAdded = Number(pickMeal) || 0;
    multiAdding = false;
    history.back();
  }

  async function confirmMultiPortionSheet() {
    if (multiAdding) return;
    multiAdding = true;
    for (const item of multiPortionItems) {
      const origPortion = parseFloat(item.food.portion) || 100;
      const newPortion  = parseFloat(item.portion) || origPortion;
      const portionFactor = newPortion / origPortion;
      const scaledNutrition = item.food.nutrition
        ? Object.fromEntries(Object.entries(item.food.nutrition).map(([k,v]) => [k, (parseFloat(v)||0) * portionFactor]))
        : item.food.nutrition;
      const food = { ...item.food, portion: newPortion, unit: item.unit, nutrition: scaledNutrition };
      await _addFoodToDiaryNoNav(food, parseFloat(item.servings) || 1);
    }
    showSuccess(`Added ${multiPortionItems.length} item${multiPortionItems.length > 1 ? 's' : ''} to diary`);
    editorState.lastMealAdded = Number(pickMeal) || 0;
    multiAdding = false;
    history.back();
  }

  async function confirmQtyPrompt() {
    if (!promptFood) return;
    const newPortion = parseFloat(promptPortion) || promptFood.portion || 100;
    const origPortion = parseFloat(promptFood.portion) || 100;

    // If portion changed (e.g. user is adding half the recipe), scale nutrition proportionally
    const portionFactor = newPortion / origPortion;
    const scaledNutrition = promptFood.nutrition ?
      Object.fromEntries(Object.entries(promptFood.nutrition).map(([k,v]) => [k, (parseFloat(v)||0) * portionFactor])) :
      promptFood.nutrition;

    const food = {
      ...promptFood,
      portion: newPortion,
      unit: promptUnit || promptFood.unit || 'g',
      nutrition: scaledNutrition
    };
    await _addFoodToDiary(food, parseFloat(promptServings) || 1);
  }

  async function deleteItem(item) {
    if (currentStore === 'foodList') await NtApi.deleteFood(item.id);
    else await NtApi.deleteMeal(item.id);
    await load();
    showSuccess('Deleted');
  }

  async function cloneItem(item) {
    const { id: _drop, ...rest } = item;
    const clone = { ...rest, name: 'Copy of ' + (item.name || ''), created_at: new Date().toISOString() };
    if (currentStore === 'foodList') await NtApi.createFood(clone);
    else await NtApi.createMeal(clone);
    await load();
    showSuccess('Cloned');
  }

  function longPress(item) {
    selectedItem = item;
    showItemActions = true;
  }

  function handleItemAction({ detail }) {
    if (!selectedItem) return;
    if (detail.value === 'edit') {
      if (activeTab === 1) openMealEditor(selectedItem, false);
      else if (activeTab === 2) openMealEditor(selectedItem, true);
      else openEditor(selectedItem, 'foodList');
    } else if (detail.value === 'clone') {
      cloneItem(selectedItem);
    } else if (detail.value === 'delete') {
      showDeleteDialog = true;
    }
  }

  async function handleScan({ detail }) {
    const code = detail.code;
    if (!code) return;
    try {
      const { API } = await import('../lib/api.js');
      const result = await API.lookupBarcode(code);
      if (result) {
        if (pickMode) {
          await pickFood(result);
        } else {
          openEditor(result, 'foodList');
        }
      } else {
        const { showError: se } = await import('../stores/toast.js');
        se('Barcode not found: ' + code);
      }
    } catch(e) {
      const { showError: se } = await import('../stores/toast.js');
      se('Lookup failed');
    }
  }

  async function loadYesterdayMeals() {
    if (!pickMode || !$foodsShowYesterdayMeals) { yesterdayMeals = []; return; }
    const yDate = new Date();
    yDate.setDate(yDate.getDate() - 1);
    const yStr = localDateStr(yDate);
    const entry = await NtApi.getDiaryDate(yStr);
    if (!entry || !entry.items || !entry.items.length) { yesterdayMeals = []; return; }
    const names = $mealNames || ['Breakfast','Lunch','Dinner','Snacks'];
    const groups = {};
    for (const item of entry.items) {
      const m = item.meal != null ? Number(item.meal) : 0;
      if (!groups[m]) groups[m] = [];
      groups[m].push(item);
    }
    yesterdayMeals = Object.entries(groups).map(([mIdx, items]) => ({
      mealIdx: Number(mIdx),
      mealName: names[Number(mIdx)] || ('Meal ' + (Number(mIdx)+1)),
      items,
      totalKcal: Math.round(items.reduce((s,i) => {
        const factor = (i.quantity || 1);
        return s + (i.nutrition?.calories || i.calories || 0) * factor;
      }, 0))
    }));
  }

  async function addYesterdayMeal(group) {
    const { addDiaryItem } = await import('../stores/diary.js');
    for (const item of group.items) {
      await addDiaryItem({ ...item }, group.mealIdx, pickDate);
    }
    import('../stores/toast.js').then(m => m.showSuccess('Added ' + group.mealName));
    editorState.lastMealAdded = group.mealIdx;
    history.back();
  }

  onMount(async () => {
    // Restore tab before load so the right list is fetched
    if (editorState.foodsActiveTab != null) {
      activeTab = editorState.foodsActiveTab;
      editorState.foodsActiveTab = null;
    }
    await load();
    await loadYesterdayMeals();
    // Restore scroll position after Svelte has flushed the list to the DOM
    if (editorState.foodsScrollY != null) {
      const sy = editorState.foodsScrollY;
      editorState.foodsScrollY = null;
      await tick();
      window.scrollTo(0, sy);
    }
  });
</script>

<div class="page-shell">
  <!-- Header -->
  <header class="page-header" class:has-banner={$pageBanners}>
    {#if $pageBanners}<FoodsBanner />{/if}
    {#if pickMode && selectedFoods.size > 0}
      <h1 class="pick-count-title">{selectedFoods.size} selected</h1>
      <button class="btn-icon accent" on:click={confirmMultiAdd} disabled={multiAdding} aria-label="Add selected to diary" title="Add selected to diary">
        {#if multiAdding}
          <span class="material-symbols-rounded spin">refresh</span>
        {:else}
          <span class="material-symbols-rounded">check</span>
        {/if}
      </button>
    {:else}
      <h1>Foods</h1>
      <button class="btn-icon accent" on:click={() => {
        if (activeTab === 0) openEditor(null, 'foodList');
        else if (activeTab === 1) openMealEditor(null, false);
        else openMealEditor(null, true);
      }} aria-label="Add new" title="Add new">
        <span class="material-symbols-rounded">add</span>
      </button>
    {/if}
  </header>

  <!-- Tabs -->
  <div class="foods-tabs">
    <Tabs tabs={TABS} bind:active={activeTab} />
  </div>

  <!-- Search -->
  <div class="foods-search">
    <div class="search-input-wrap">
      <span class="material-symbols-rounded icon-search">search</span>
      <input
        class="input"
        type="search"
        placeholder="Search foods or scan barcode..."
        bind:value={search}
      />
      <button class="btn-icon scan-btn" on:click={() => scannerOpen = true} aria-label="Scan barcode" title="Scan barcode">
        <span class="material-symbols-rounded">barcode_scanner</span>
      </button>
    </div>
  </div>

  <!-- Source chips (Foods tab only) -->
  {#if activeTab === 0}
    <div class="source-chip-row">
      {#each availableSources as src}
        <button class="source-chip" class:active={searchSource === src.value}
          on:click={() => searchSource = src.value}>{src.label}</button>
      {/each}
    </div>
  {/if}

  <!-- Category filter chips (Local + Foods tab only) -->
  {#if activeTab === 0 && searchSource === 'local' && $foodsShowCategories && $foodCategories && $foodCategories.length > 0}
    <div class="cat-filter-row">
      <button class="cat-chip" class:active={!activeCategoryFilter}
        on:click={() => activeCategoryFilter = ''}>All</button>
      {#each $foodCategories as cat}
        <button class="cat-chip" class:active={activeCategoryFilter === _catName(cat)}
          on:click={() => activeCategoryFilter = activeCategoryFilter === _catName(cat) ? '' : _catName(cat)}>{$foodsShowLabels ? _catDisplay(cat) : _catName(cat)}</button>
      {/each}
    </div>
  {/if}

  <!-- Yesterday's meals (pick mode only) -->
  {#if pickMode && yesterdayMeals.length > 0 && !search && activeTab === 1}
    <p class="section-title" style="padding-bottom:4px">Yesterday's Meals</p>
    <div class="card" style="margin-bottom:12px">
      {#each yesterdayMeals as group, gi}
        {#if gi > 0}<div style="height:1px;background:var(--border);margin:0 16px"></div>{/if}
        <button class="food-item-btn" style="padding:12px 14px" on:click={() => addYesterdayMeal(group)}>
          <div class="ing-thumb-placeholder" style="width:52px;height:52px;border-radius:var(--radius-sm);background:var(--accent-dim);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span class="material-symbols-rounded" style="color:var(--accent);font-size:20px">restaurant</span>
          </div>
          <div class="food-info">
            <span class="food-name">{group.mealName}</span>
            <span class="food-kcal text-sm">{group.items.length} items · {group.totalKcal} kcal</span>
          </div>
          <span class="material-symbols-rounded" style="font-size:18px;flex-shrink:0;color:var(--accent)">add_circle</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if loadError}
    <div class="server-error-banner">
      <span class="material-symbols-rounded">cloud_off</span>
      <span>Could not reach server — <button class="server-error-retry" on:click={load}>retry</button></span>
    </div>
  {/if}

  <div class="page-content">
    {#if searchSource === 'local' || activeTab !== 0}
      <!-- ── Local list ─────────────────────────────────────────────────────── -->
      {#if filteredList.length === 0 && !search && !loadError}
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">
            {activeTab === 0 ? 'restaurant' : activeTab === 1 ? 'dinner_dining' : 'book'}
          </span>
          <p>No {TABS[activeTab].label.toLowerCase()} yet</p>
          <button class="btn btn-primary" on:click={() => {
            if (activeTab === 0) openEditor(null);
            else openMealEditor(null, activeTab === 2);
          }}>
            Add {TABS[activeTab].label.slice(0,-1)}
          </button>
        </div>
      {:else}
        <ul class="food-list">
          {#each filteredList as food (food.id)}
            {@const _sel = selectedFoods.has(food)}
            <li class="food-item card" class:food-selected={_sel} in:fade={{ duration: 160 }}>
              {#if pickMode}
                <button class="food-select-btn" on:click={() => toggleSelect(food)} aria-label="Select">
                  <span class="food-check material-symbols-rounded" class:food-check-on={_sel}>
                    {_sel ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                </button>
              {/if}
              <button class="food-item-btn"
                on:click={() => pickFood(food)}
                on:contextmenu|preventDefault={() => longPress(food)}>
                {#if $foodsShowThumbnails && food.imgUrl}
                  <img class="food-thumb" src={food.imgUrl} alt="" loading="lazy" />
                {:else}
                  <div class="food-thumb-placeholder">
                    <span class="material-symbols-rounded">{_tabIcon}</span>
                  </div>
                {/if}
                <div class="food-info">
                  <span class="food-name">{food.name}</span>
                  {#if activeTab === 0}
                    {#if food.brand}<span class="food-brand text-3 text-sm">{food.brand}</span>{/if}
                    <span class="food-kcal text-sm">{food.portion || 100}{food.unit || 'g'}</span>
                  {:else}
                    {@const _kcal = Math.round(Nutrition.sum((food.items||[]).map(i => Nutrition.calculate(i))).calories || food.nutrition?.calories || 0)}
                    <span class="food-brand text-3 text-sm">{mealServing(food.items)}</span>
                    <span class="food-kcal text-sm">{_kcal} kcal</span>
                  {/if}
                </div>
                <span class="material-symbols-rounded text-3" style="font-size:18px;flex-shrink:0">chevron_right</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

    {:else}
      <!-- ── External source results ─────────────────────────────────────────── -->
      {#if !search.trim()}
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">search</span>
          <p>Search {_sourceLabel}</p>
        </div>

      {:else if loading || mealieLoading}
        <div class="loading-row">
          <span class="material-symbols-rounded spin">refresh</span>
          <span class="text-2 text-sm">Searching {_sourceLabel}…</span>
        </div>

      {:else if apiResults.length === 0 && mealieResults.length === 0}
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">search_off</span>
          <p>No results in {_sourceLabel}</p>
        </div>

      {:else}
        <!-- OFF / USDA results -->
        {#if apiResults.length > 0}
          <ul class="food-list">
            {#each apiResults as food (food.id || food.barcode)}
              {@const _sel = selectedFoods.has(food)}
              <li class="food-item card" class:food-selected={_sel}>
                {#if pickMode}
                  <button class="food-select-btn" on:click={() => toggleSelect(food)} aria-label="Select">
                    <span class="food-check material-symbols-rounded" class:food-check-on={_sel}>
                      {_sel ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                  </button>
                {/if}
                <button class="food-item-btn"
                  on:click={() => pickFood(food)}
                  on:contextmenu|preventDefault={() => longPress(food)}>
                  {#if food.imgUrl}
                    <img class="food-thumb" src={food.imgUrl} alt="" loading="lazy" />
                  {:else}
                    <div class="food-thumb-placeholder">
                      <span class="material-symbols-rounded">{searchSource === 'usda' ? 'science' : 'public'}</span>
                    </div>
                  {/if}
                  <div class="food-info">
                    <span class="food-name">{food.name}</span>
                    {#if food.brand}<span class="food-brand text-3 text-sm">{food.brand}</span>{/if}
                    <span class="food-kcal text-sm">{Math.round(food.nutrition?.calories || food.calories || 0)} kcal</span>
                  </div>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <!-- Mealie results -->
        {#if mealieResults.length > 0}
          <ul class="food-list">
            {#each mealieResults as recipe (recipe.slug)}
              <li class="food-item card">
                <button class="food-item-btn" on:click={() => pickMealieRecipe(recipe)}>
                  {#if recipe.id}
                    <img class="food-thumb" src={Mealie.imageUrl(recipe.id)} alt=""
                      loading="lazy" on:error={e => e.target.style.display='none'} />
                  {:else}
                    <div class="food-thumb-placeholder">
                      <span class="material-symbols-rounded">menu_book</span>
                    </div>
                  {/if}
                  <div class="food-info">
                    <span class="food-name">{recipe.name}</span>
                    {#if recipe.recipeCategory?.length}
                      <span class="food-brand text-3 text-sm">{recipe.recipeCategory.map(c => c.name).join(', ')}</span>
                    {/if}
                  </div>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    {/if}
  </div>
</div>

<!-- Multi-item portion sheet -->
<Sheet bind:open={showMultiPortionSheet} title="Set Portions ({multiPortionItems.length} items)">
  <div style="display:flex;flex-direction:column;gap:0;padding-top:4px">
    {#each multiPortionItems as item, i}
      {#if i > 0}<div style="height:1px;background:var(--border);margin:12px 0"></div>{/if}
      <div style="display:flex;flex-direction:column;gap:10px">
        <span style="font-size:13px;font-weight:600;color:var(--text-1)">{item.food.name}</span>
        <div style="display:flex;gap:10px">
          <div style="flex:1">
            <label class="form-label" style="font-size:11px;color:var(--text-3);display:block;margin-bottom:5px">Serving Size</label>
            <input class="input" type="number" min="0.1" step="0.1" bind:value={item.portion} style="font-size:16px;width:100%" />
          </div>
          <div style="width:80px">
            <label class="form-label" style="font-size:11px;color:var(--text-3);display:block;margin-bottom:5px">Unit</label>
            <select class="select" bind:value={item.unit} style="width:100%">
              {#each ['g','ml','oz','lb','cup','tbsp','tsp','piece','slice','serving'] as u}
                <option value={u}>{u}</option>
              {/each}
            </select>
          </div>
          <div style="width:72px">
            <label class="form-label" style="font-size:11px;color:var(--text-3);display:block;margin-bottom:5px">Servings</label>
            <input class="input" type="number" min="0.1" step="0.1" bind:value={item.servings} style="font-size:16px;width:100%" />
          </div>
        </div>
      </div>
    {/each}
    <button class="btn btn-primary w-full" style="margin-top:16px"
      on:click={confirmMultiPortionSheet} disabled={multiAdding}>
      {#if multiAdding}
        <span class="material-symbols-rounded spin" style="font-size:18px">refresh</span>
      {:else}
        Add {multiPortionItems.length} Item{multiPortionItems.length > 1 ? 's' : ''} to Diary
      {/if}
    </button>
  </div>
</Sheet>

<!-- Quantity prompt sheet -->
<Sheet bind:open={showQtyPrompt} title={promptFood ? promptFood.name : 'Add to Diary'}>
  <div style="display:flex;flex-direction:column;gap:16px;padding-top:8px">
    <div style="display:flex;gap:12px">
      <div style="flex:1">
        <label class="form-label" style="font-size:11px;color:var(--text-3);display:block;margin-bottom:6px">Serving Size</label>
        <input class="input" type="number" min="0.1" step="0.1" bind:value={promptPortion}
          style="font-size:16px;width:100%" />
      </div>
      <div style="width:80px">
        <label class="form-label" style="font-size:11px;color:var(--text-3);display:block;margin-bottom:6px">Unit</label>
        <select class="select" bind:value={promptUnit} style="width:100%">
          {#each ['g','ml','oz','lb','cup','tbsp','tsp','piece','slice','serving'] as u}
            <option value={u}>{u}</option>
          {/each}
        </select>
      </div>
    </div>
    <div>
      <label class="form-label" style="font-size:11px;color:var(--text-3);display:block;margin-bottom:6px">Number of Servings</label>
      <input class="input" type="number" min="0.1" step="0.1" bind:value={promptServings}
        style="font-size:16px;width:100%" />
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface-2);border-radius:var(--radius-md)">
      <span style="font-size:13px;color:var(--text-3)">Total Amount</span>
      <span style="font-size:14px;font-weight:500">{Math.round((parseFloat(promptPortion) || 100) * (parseFloat(promptServings) || 1) * 10) / 10}{promptUnit || 'g'}</span>
    </div>
    <button class="btn btn-primary w-full" on:click={confirmQtyPrompt}>Add to Diary</button>
  </div>
</Sheet>

<BarcodeScanner bind:open={scannerOpen} on:scan={handleScan} on:close={() => scannerOpen = false} />

<ActionSheet
  bind:open={showItemActions}
  title={selectedItem ? selectedItem.name : ''}
  actions={[
    { label: 'Edit',   icon: 'edit',             value: 'edit' },
    ...(activeTab !== 0 ? [{ label: 'Clone', icon: 'content_copy', value: 'clone' }] : []),
    { label: 'Delete', icon: 'delete',            value: 'delete', danger: true },
  ]}
  on:select={handleItemAction}
/>

<Dialog
  bind:open={showDeleteDialog}
  title="Delete item?"
  message="This will permanently delete this item."
  confirmText="Delete"
  dangerous
  on:confirm={() => selectedItem && deleteItem(selectedItem)}
/>

<style>
  .foods-tabs { padding: 12px var(--page-px) 12px; }
  .foods-search { padding: 0 var(--page-px) 12px; }
  .foods-search .search-input-wrap { gap: 8px; }
  .scan-btn { flex-shrink: 0; }

  .food-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .food-item { overflow: hidden; }
  .food-item-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background var(--dur-fast);
    color: var(--text-1);
  }
  .food-item-btn:active { background: var(--surface-2); }
  .food-thumb {
    width: 52px; height: 52px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    background: var(--surface-2);
    flex-shrink: 0;
  }
  .food-thumb-placeholder {
    width: 52px; height: 52px;
    border-radius: var(--radius-sm);
    background: var(--accent-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--accent);
    font-size: 20px;
  }
  .food-info  { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .food-name  { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .food-brand { }
  .food-kcal  { color: var(--text-2); }

  .server-error-banner {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    margin: 0 0 8px;
    background: rgba(255, 100, 80, 0.08);
    border: 1px solid rgba(255, 100, 80, 0.2);
    border-radius: var(--radius-lg);
    font-size: 14px; color: var(--text-2);
  }
  .server-error-banner .material-symbols-rounded { font-size: 18px; color: #ff6450; flex-shrink: 0; }
  .server-error-retry {
    background: none; border: none; padding: 0;
    color: var(--accent); font-size: 14px; font-weight: 600;
    cursor: pointer; text-decoration: underline;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 48px 24px;
    text-align: center;
    color: var(--text-2);
  }
  .empty-icon { font-size: 48px; color: var(--accent); opacity: 0.6; }

  .loading-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px;
    justify-content: center;
  }

  .cat-filter-row {
    display: flex;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 6px;
    padding: 0 var(--page-px) 10px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .cat-filter-row::-webkit-scrollbar { display: none; }
  .cat-chip {
    flex-shrink: 0;
    padding: 5px 12px;
    border-radius: var(--radius-full);
    border: 1.5px solid var(--border);
    background: none;
    font-size: 13px;
    cursor: pointer;
    color: var(--text-2);
    transition: all var(--dur-fast);
    white-space: nowrap;
  }
  .cat-chip.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); font-weight: 600; }

  .source-chip-row {
    display: flex;
    gap: 6px;
    padding: 0 var(--page-px) 10px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  /* ── Multi-select ─────────────────────────────────────────────────────── */
  .food-item { display: flex; align-items: stretch; }

  .food-select-btn {
    display: flex;
    align-items: center;
    padding: 0 4px 0 14px;
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    color: var(--text-3);
  }
  .food-check {
    font-size: 22px;
    transition: color var(--dur-fast);
  }
  .food-check-on { color: var(--accent); }

  .food-item.food-selected { background: var(--accent-dim); }

  .pick-count-title { color: var(--accent); }

  .source-chip-row::-webkit-scrollbar { display: none; }
  .source-chip {
    flex-shrink: 0;
    padding: 5px 16px;
    border-radius: var(--radius-full);
    border: 1.5px solid var(--border);
    background: var(--surface-1);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-2);
    transition: all var(--dur-fast);
    white-space: nowrap;
  }
  .source-chip:hover { background: var(--surface-2); }
  .source-chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--surface-1);
    font-weight: 600;
  }
</style>
