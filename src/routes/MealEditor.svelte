<script>
  import { onMount } from 'svelte';
  import { pop } from 'svelte-spa-router';
  import { DB } from '../lib/db.js';
  import { portal } from '../lib/portal.js';
  import { showSuccess, showError } from '../stores/toast.js';
  import { editorState, clearMealEditorState } from '../stores/editorState.js';
  import { Nutrition, NUTRIMENTS } from '../lib/nutrition.js';
  import { foodsShowCategories, foodsShowNotes, foodCategories } from '../stores/settings.js';

  export let params = {};

  let meal   = { name: '', notes: '', categories: [], items: [], imgUrl: '' };
  let store  = 'meals';
  let saving = false;
  let isRecipe = false;

  // Photo state
  let photoPreviewUrl = '';
  let cameraOpen = false;
  let showUrlInput = false;
  let photoUrl = '';
  function applyPhotoUrl() {
    const url = photoUrl.trim();
    if (url) { photoPreviewUrl = url; }
    showUrlInput = false;
    photoUrl = '';
  }
  let cameraStream = null;
  let videoEl = null;
  let cropOpen = false;
  let cropSrc = '';
  let cropImgEl = null;
  let cropBoxX = 0, cropBoxY = 0, cropBoxSize = 200;
  let cropDragging = false, cropDragStartX = 0, cropDragStartY = 0, cropBoxStartX = 0, cropBoxStartY = 0;

  // Recipe fields
  let recipeAmount = '';
  let recipeUnit = 'g';
  const UNITS = ['g','ml','oz','cup','tbsp','tsp','piece','serving'];

  // Search
  let searchQuery = '';
  let searchResults = [];
  let showSearch = false;

  // Portion picker
  let portionFood = null;
  let portionAmount = '';
  let portionQty = 1;
  let portionUnit = 'g';
  let portionSheet = false;

  onMount(async () => {
    isRecipe = editorState.mealIsRecipe || false;
    store    = isRecipe ? 'recipes' : 'meals';
    if (editorState.mealPrefill) {
      meal = { ...meal, ...editorState.mealPrefill };
    } else if (params && params.id) {
      const existing = await DB.get(store, params.id);
      if (existing) meal = { ...meal, ...existing };
    }
    if (meal.imgUrl) photoPreviewUrl = meal.imgUrl;
    if (isRecipe && meal.portion) recipeAmount = meal.portion;
    if (isRecipe && meal.unit) recipeUnit = meal.unit;
  });

  // ── Photo ──────────────────────────────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { cropSrc = ev.target.result; cropOpen = true; initCropBox(); };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function openCamera() {
    cameraOpen = true;
    await new Promise(r => setTimeout(r, 100));
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      if (videoEl) { videoEl.srcObject = cameraStream; videoEl.play(); }
    } catch { cameraOpen = false; showError('Camera not available'); }
  }

  function capturePhoto() {
    if (!videoEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth; canvas.height = videoEl.videoHeight;
    canvas.getContext('2d').drawImage(videoEl, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    closeCamera();
    cropSrc = dataUrl; cropOpen = true; initCropBox();
  }

  function closeCamera() {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    cameraOpen = false;
  }

  function initCropBox() {
    cropBoxX = 20; cropBoxY = 20; cropBoxSize = 200;
  }

  function confirmCrop() {
    if (!cropImgEl) return;
    const canvas = document.createElement('canvas');
    const scaleX = cropImgEl.naturalWidth / cropImgEl.offsetWidth;
    const scaleY = cropImgEl.naturalHeight / cropImgEl.offsetHeight;
    canvas.width = 300; canvas.height = 300;
    canvas.getContext('2d').drawImage(
      cropImgEl,
      cropBoxX * scaleX, cropBoxY * scaleY,
      cropBoxSize * scaleX, cropBoxSize * scaleY,
      0, 0, 300, 300
    );
    photoPreviewUrl = canvas.toDataURL('image/jpeg', 0.85);
    cropOpen = false; cropSrc = '';
  }

  function onCropMouseDown(e) {
    cropDragging = true;
    cropDragStartX = e.clientX; cropDragStartY = e.clientY;
    cropBoxStartX = cropBoxX; cropBoxStartY = cropBoxY;
    e.preventDefault();
  }
  function onCropMouseMove(e) {
    if (!cropDragging || !cropImgEl) return;
    const maxX = cropImgEl.offsetWidth - cropBoxSize;
    const maxY = cropImgEl.offsetHeight - cropBoxSize;
    cropBoxX = Math.max(0, Math.min(maxX, cropBoxStartX + (e.clientX - cropDragStartX)));
    cropBoxY = Math.max(0, Math.min(maxY, cropBoxStartY + (e.clientY - cropDragStartY)));
  }
  function onCropMouseUp() { cropDragging = false; }

  // ── Ingredient search ──────────────────────────────────────────────────────
  async function searchFoods() {
    const foods = (await DB.getAll('foodList')) || [];
    const recipeItems = isRecipe ? [] : ((await DB.getAll('recipes')) || []);
    const combined = [
      ...foods.map(f => ({ ...f, _source: 'food' })),
      ...recipeItems.map(r => ({ ...r, _source: 'recipe' }))
    ];
    if (!searchQuery.trim()) {
      searchResults = combined.slice().reverse().slice(0, 40);
      return;
    }
    const q = searchQuery.toLowerCase();
    searchResults = combined.filter(f =>
      (f.name||'').toLowerCase().includes(q) ||
      (f.brand||'').toLowerCase().includes(q)
    ).slice(0, 40);
  }

  $: { searchQuery; if (showSearch) searchFoods(); }

  function openSearch() { showSearch = true; searchFoods(); }

  let _meLock = false;
  let _meLockTimer;
  function pickIngredient(food) {
    portionFood   = food;
    portionAmount = food.portion || 100;
    portionUnit   = food.unit || 'g';
    portionQty    = food.quantity || 1;
    clearTimeout(_meLockTimer);
    _meLock = true;
    portionSheet = true;
    _meLockTimer = setTimeout(() => _meLock = false, 400);
  }

  function confirmPortion() {
    if (!portionFood) return;
    const item = {
      ...portionFood,
      portion: parseFloat(portionAmount) || portionFood.portion || 100,
      unit: portionUnit,
      quantity: parseFloat(portionQty) || 1
    };
    meal = { ...meal, items: [...meal.items, item] };
    portionSheet = false;
    portionFood = null;
    showSearch = false;
    searchQuery = '';
    if (isRecipe) autoUpdateRecipeAmount();
  }

  function moveIngredient(i, dir) {
    const items = [...meal.items];
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    meal = { ...meal, items };
  }

  // Drag-to-reorder state
  let dragFrom = null;
  let dragOver = null;

  function onDragHandleDown(e, i) {
    dragFrom = i;
    dragOver = i;
    e.currentTarget.closest('.ingredient-row').setPointerCapture(e.pointerId);
  }

  function onDragPointerMove(e, i) {
    if (dragFrom === null) return;
    // Find which row the pointer is over by hit-testing sibling rows
    const list = e.currentTarget.closest('.ingredient-list');
    if (!list) return;
    const rows = [...list.querySelectorAll('.ingredient-row')];
    const y = e.clientY;
    let target = dragFrom;
    for (let idx = 0; idx < rows.length; idx++) {
      const rect = rows[idx].getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) { target = idx; break; }
    }
    dragOver = target;
  }

  function onDragPointerUp(e) {
    if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) {
      const items = [...meal.items];
      const [removed] = items.splice(dragFrom, 1);
      items.splice(dragOver, 0, removed);
      meal = { ...meal, items };
    }
    dragFrom = null;
    dragOver = null;
  }

  function removeIngredient(i) {
    meal = { ...meal, items: meal.items.filter((_,idx) => idx !== i) };
    if (isRecipe) autoUpdateRecipeAmount();
  }

  function autoUpdateRecipeAmount() {
    const grams = meal.items.reduce((s, it) => s + toGrams(it.portion, it.unit) * (it.quantity||1), 0);
    recipeAmount = grams > 0 ? String(Math.round(grams)) : '';
    recipeUnit = 'g';
  }

  function toGrams(amount, unit) {
    const c = { g:1, ml:1, oz:28.35, cup:240, tbsp:15, tsp:5, piece:100, serving:100 };
    return (parseFloat(amount)||0) * (c[unit]||1);
  }

  let showAllNutrients = false;
  $: totals = Nutrition.sum((meal.items||[]).map(i => Nutrition.calculate(i)));

  // ── Category chips ─────────────────────────────────────────────────────────
  function toggleCat(cat) {
    const cats = meal.categories || [];
    if (cats.includes(cat)) {
      meal = { ...meal, categories: cats.filter(c => c !== cat) };
    } else {
      meal = { ...meal, categories: [...cats, cat] };
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function save() {
    if (!meal.name.trim()) { showError('Please enter a name'); return; }
    if (!meal.items.length) { showError('Please add at least one ingredient'); return; }
    saving = true;
    try {
      const item = {
        ...meal,
        imgUrl: photoPreviewUrl || '',
        nutrition: totals,
        id: meal.id || Date.now()
      };
      if (isRecipe) {
        item.portion = parseFloat(recipeAmount) || Math.round(meal.items.reduce((s,it)=>s+toGrams(it.portion,it.unit),0)) || 100;
        item.unit = recipeUnit;
      }
      await DB.put(store, item);
      clearMealEditorState();
      showSuccess('Saved');
      pop();
    } catch(e) {
      showError('Save failed');
    } finally {
      saving = false;
    }
  }
</script>

<div class="page-shell editor-page">
  <header class="editor-header">
    <button class="btn-icon" on:click={pop} aria-label="Back">
      <span class="material-symbols-rounded">arrow_back</span>
    </button>
    <h2 class="editor-title">{params && params.id ? 'Edit' : 'New'} {isRecipe ? 'Recipe' : 'Meal'}</h2>
    <button class="btn btn-primary" style="height:36px;padding:0 16px;font-size:13px"
      on:click={save} disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </header>

  <div class="page-content editor-content">

    <!-- Photo -->
    <div class="card editor-card">
      <div class="editor-card-title">Photo</div>
      <div class="photo-preview-wrap">
        {#if photoPreviewUrl}
          <img src={photoPreviewUrl} alt="food" class="photo-preview-img" />
        {:else}
          <div class="photo-placeholder">
            <span class="material-symbols-rounded" style="font-size:40px;opacity:0.2">photo_camera</span>
          </div>
        {/if}
      </div>
      <div class="photo-actions">
        <button class="btn btn-ghost photo-btn" on:click={openCamera}>
          <span class="material-symbols-rounded" style="font-size:18px">camera_alt</span>
          Camera
        </button>
        <label class="btn btn-ghost photo-btn" style="cursor:pointer">
          <span class="material-symbols-rounded" style="font-size:18px">photo_library</span>
          Upload
          <input type="file" accept="image/*" style="display:none" on:change={handleFileChange} />
        </label>
        <button class="btn btn-ghost photo-btn" on:click={() => { showUrlInput = !showUrlInput; photoUrl = ''; }}>
          <span class="material-symbols-rounded" style="font-size:18px">link</span>
          URL
        </button>
        {#if photoPreviewUrl}
          <button class="btn btn-ghost photo-btn" style="color:var(--text-3)"
            on:click={() => photoPreviewUrl = ''}>
            <span class="material-symbols-rounded" style="font-size:18px">delete</span>
          </button>
        {/if}
      </div>
      {#if showUrlInput}
        <div class="photo-url-row">
          <input class="input photo-url-input" placeholder="https://..." bind:value={photoUrl}
            on:keydown={e => e.key === 'Enter' && applyPhotoUrl()} />
          <button class="btn btn-primary" on:click={applyPhotoUrl}>Get</button>
        </div>
      {/if}
    </div>

    <!-- Name -->
    <div class="card editor-card">
      <div class="editor-card-title">Name *</div>
      <input class="input" placeholder="{isRecipe ? 'Recipe name' : 'Meal name'}" bind:value={meal.name} />
    </div>

    <!-- Recipe amount/unit -->
    {#if isRecipe}
      <div class="card editor-card">
        <div class="editor-card-title">Recipe Serving</div>
        <div style="display:flex;gap:10px;align-items:center">
          <input class="input" type="number" min="0.1" step="any"
            placeholder="Auto from ingredients" bind:value={recipeAmount} style="flex:1" />
          <select class="input" bind:value={recipeUnit} style="width:100px">
            {#each UNITS as u}<option value={u}>{u}</option>{/each}
          </select>
        </div>
        <p class="text-3" style="font-size:12px;margin:0">Serving size used when adding to diary</p>
      </div>
    {/if}

    <!-- Categories -->
    {#if $foodsShowCategories && $foodCategories && $foodCategories.length > 0}
      <div class="card editor-card">
        <div class="editor-card-title">Categories</div>
        <div class="category-chips">
          {#each $foodCategories as cat}
            <button
              class="cat-chip"
              class:active={(meal.categories||[]).includes(cat)}
              on:click={() => toggleCat(cat)}
            >{cat}</button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Notes -->
    {#if $foodsShowNotes}
      <div class="card editor-card">
        <div class="editor-card-title">Notes</div>
        <textarea class="input" rows="2" placeholder="Optional notes…" bind:value={meal.notes}
          style="resize:vertical;min-height:60px"></textarea>
      </div>
    {/if}

    <!-- Ingredients -->
    <div class="card editor-card">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="editor-card-title">
          {isRecipe ? 'Foods' : 'Foods & Recipes'}
          {#if meal.items.length > 0}
            <span style="font-weight:400;color:var(--accent)">
              — {Math.round(totals.calories||0)} kcal total
            </span>
          {/if}
        </div>
        <button class="btn btn-ghost" style="font-size:13px;height:32px;padding:0 12px"
          on:click={openSearch}>
          + Add
        </button>
      </div>

      {#if meal.items.length === 0}
        <p class="text-3 text-sm" style="padding:4px 0">No foods or recipes yet. Tap + to add.</p>
      {:else}
        <div class="ingredient-list"
          on:pointermove={e => onDragPointerMove(e, dragOver)}
          on:pointerup={onDragPointerUp}
          on:pointercancel={onDragPointerUp}>
          {#each meal.items as item, i}
            <div class="ingredient-row"
              class:drag-over={dragOver === i && dragFrom !== null && dragFrom !== i}
              class:dragging={dragFrom === i}>
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <span class="drag-handle material-symbols-rounded"
                on:pointerdown={e => onDragHandleDown(e, i)}>
                drag_indicator
              </span>
              {#if item.imgUrl}
                <img src={item.imgUrl} alt={item.name} class="ing-thumb" />
              {:else}
                <div class="ing-thumb ing-thumb-placeholder">
                  <span class="material-symbols-rounded" style="font-size:20px;opacity:0.3">fastfood</span>
                </div>
              {/if}
              <div class="ing-info">
                <span class="ingredient-name">{item.name}</span>
                <span class="text-3" style="font-size:12px">{item.portion} {item.unit}</span>
              </div>
              <span class="text-3 text-sm">{Math.round((Nutrition.calculate(item).calories)||0)} kcal</span>
              <button class="btn-icon btn-sm" on:click={() => removeIngredient(i)}
                style="color:var(--text-3)">
                <span class="material-symbols-rounded" style="font-size:18px">remove_circle</span>
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Nutrition totals -->
    {#if meal.items.length > 0}
      <div class="card editor-card">
        <div class="editor-card-title">Nutrition Totals</div>
        {#each NUTRIMENTS.filter(n => (showAllNutrients ? true : n.default) && totals[n.id]) as n}
          <div style="display:flex;justify-content:space-between;padding:4px 0">
            <span class="text-sm">{n.label}</span>
            <span class="text-sm font-medium">{Math.round(totals[n.id]*10)/10} {n.unit}</span>
          </div>
        {/each}
        <button class="btn btn-ghost w-full" style="margin-top:8px"
          on:click={() => showAllNutrients = !showAllNutrients}>
          {showAllNutrients ? 'Show less' : 'Show all nutrients'}
        </button>
      </div>
    {/if}

    <div style="height:16px"></div>
  </div>
</div>

<!-- ── Ingredient search overlay ── -->
{#if showSearch}
  <div class="search-overlay" role="dialog" aria-modal="true">
    <div class="search-panel">
      <div class="search-header">
        <input class="input" placeholder="{isRecipe ? 'Search foods…' : 'Search foods & recipes…'}" bind:value={searchQuery} autofocus />
        <button class="btn btn-ghost" on:click={() => { showSearch = false; searchQuery = ''; }}>Cancel</button>
      </div>
      <div class="search-results">
        {#if searchResults.length === 0}
          <p class="text-3 text-sm" style="padding:16px;text-align:center">No {isRecipe ? 'foods' : 'foods or recipes'} found. Add some in the Foods tab first.</p>
        {:else}
          {#each searchResults as food}
            <button class="search-result-row" on:click={() => pickIngredient(food)}>
              {#if food.imgUrl}
                <img src={food.imgUrl} alt={food.name} class="ing-thumb" />
              {:else}
                <div class="ing-thumb ing-thumb-placeholder">
                  <span class="material-symbols-rounded" style="font-size:18px;opacity:0.3">fastfood</span>
                </div>
              {/if}
              <div class="ing-info">
                <span style="font-weight:500">{food.name}</span>
                {#if food.brand}<span class="text-3" style="font-size:12px">{food.brand}</span>{/if}
              </div>
              {#if food._source === 'recipe'}<span class="chip" style="font-size:11px;flex-shrink:0">Recipe</span>{/if}
              <span class="text-3 text-sm">{Math.round(food.nutrition?.calories || food.calories || 0)} kcal</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- ── Portion picker sheet ── -->
{#if portionSheet && portionFood}
  <div use:portal class="overlay-backdrop" role="dialog" aria-modal="true"
    on:click={() => { if (!_meLock) portionSheet = false; }} on:keydown={() => {}}>
    <div class="portion-sheet" on:click|stopPropagation on:keydown={() => {}}>
      <div class="portion-header">
        <span style="font-weight:600">{portionFood.name}</span>
        <button class="btn-icon" on:click={() => portionSheet = false}>
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
      <div class="portion-body">
        <label class="form-label">Amount</label>
        <input class="input" type="number" min="0.1" step="any" bind:value={portionAmount} />
        <label class="form-label" style="margin-top:12px">Unit</label>
        <select class="input" bind:value={portionUnit}>
          {#each UNITS as u}<option value={u}>{u}</option>{/each}
        </select>
        <label class="form-label" style="margin-top:12px">Quantity</label>
        <input class="input" type="number" min="0.01" step="any" bind:value={portionQty} />
      </div>
      <div style="padding:16px;flex-shrink:0">
        <button class="btn btn-primary w-full" on:click={confirmPortion}>Add Ingredient</button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Camera overlay ── -->
{#if cameraOpen}
  <div class="cam-overlay" role="dialog" aria-modal="true">
    <div class="cam-panel">
      <div class="cam-header">
        <span style="font-weight:600">Take Photo</span>
        <button class="btn-icon" on:click={closeCamera}>
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
      <!-- svelte-ignore a11y-media-has-caption -->
      <video bind:this={videoEl} autoplay playsinline muted class="cam-video"></video>
      <div style="padding:16px">
        <button class="btn btn-primary w-full" on:click={capturePhoto}>
          <span class="material-symbols-rounded" style="font-size:18px;vertical-align:middle;margin-right:6px">camera_alt</span>
          Capture Photo
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Crop overlay ── -->
{#if cropOpen}
  <div class="cam-overlay" role="dialog" aria-modal="true">
    <div class="cam-panel">
      <div class="cam-header">
        <span style="font-weight:600">Crop Photo</span>
        <button class="btn-icon" on:click={() => { cropOpen = false; cropSrc = ''; }}>
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
      <div class="crop-area"
        on:mousemove={onCropMouseMove}
        on:mouseup={onCropMouseUp}
        on:mouseleave={onCropMouseUp}
        role="img" aria-label="Crop area">
        <img bind:this={cropImgEl} src={cropSrc} alt="crop" class="crop-img" draggable="false" />
        <div class="crop-box"
          style="left:{cropBoxX}px;top:{cropBoxY}px;width:{cropBoxSize}px;height:{cropBoxSize}px"
          on:mousedown={onCropMouseDown}
          role="button" tabindex="0"
          aria-label="Drag to reposition crop"
          on:keydown={() => {}}></div>
      </div>
      <div style="padding:16px">
        <button class="btn btn-primary w-full" on:click={confirmCrop}>Use This Crop</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .editor-page { padding-top: 0; }
  .editor-header {
    display: flex; align-items: center; gap: 12px;
    padding: calc(var(--safe-top) + 12px) 16px 12px;
    border-bottom: 1px solid var(--border); background: var(--surface-1);
    position: sticky; top: 0; z-index: 10;
  }
  .editor-title { font-size: 17px; font-weight: 600; flex: 1; }
  .editor-content { display: flex; flex-direction: column; gap: 12px; padding-top: 16px; padding-bottom: 32px; }
  .editor-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .editor-card-title { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }

  /* Photo */
  .photo-preview-wrap {
    width: min(360px, 100%); aspect-ratio: 1 / 1; margin: 0 auto;
    border-radius: var(--radius-lg); overflow: hidden;
    border: 2px dashed var(--border);
    background: var(--surface-2);
    display: flex; align-items: center; justify-content: center;
  }
  .photo-preview-img { width: 100%; height: 100%; object-fit: cover; display: block; background: var(--surface-2); }
  .photo-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  .photo-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .photo-btn { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; font-size: 13px; }
  .photo-url-row { display: flex; gap: 8px; margin-top: 8px; }
  .photo-url-input { flex: 1; }

  /* Categories */
  .category-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .cat-chip {
    padding: 6px 12px; border-radius: var(--radius-full);
    border: 1.5px solid var(--border); background: none;
    font-size: 13px; cursor: pointer; color: var(--text-2);
    transition: all var(--dur-fast);
  }
  .cat-chip.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }

  /* Ingredient rows */
  .ingredient-list { display: flex; flex-direction: column; touch-action: none; }
  .ingredient-row {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 0; border-bottom: 1px solid var(--border);
    transition: background 120ms, opacity 120ms;
  }
  .ingredient-row:last-child { border-bottom: none; }
  .ingredient-row.dragging { opacity: 0.4; }
  .ingredient-row.drag-over { background: var(--accent-dim); border-radius: var(--radius-sm); }
  .drag-handle {
    font-size: 20px; color: var(--text-3); cursor: grab; flex-shrink: 0;
    touch-action: none; user-select: none; -webkit-user-select: none;
  }
  .drag-handle:active { cursor: grabbing; }
  .ing-thumb { width: 44px; height: 44px; border-radius: var(--radius-md); object-fit: cover; flex-shrink: 0; }
  .ing-thumb-placeholder {
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-2);
  }
  .ing-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ingredient-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .btn-sm { width: 32px; height: 32px; }

  /* Search overlay */
  :global(.search-overlay) {
    position: fixed; inset: 0; z-index: 200;
    background: var(--surface-0, var(--surface-1));
    display: flex; flex-direction: column;
  }
  .search-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .search-header {
    display: flex; gap: 8px; align-items: center;
    padding: calc(var(--safe-top) + 12px) 16px 12px;
    border-bottom: 1px solid var(--border);
  }
  .search-header .input { flex: 1; }
  .search-results { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  .search-result-row {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
    background: none; border-left: none; border-right: none; border-top: none;
    cursor: pointer; color: var(--text-1); text-align: left;
    transition: background var(--dur-fast);
  }
  .search-result-row:active { background: var(--surface-2); }

  /* Portion sheet */
  :global(.overlay-backdrop) {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: flex-end;
  }
  .portion-sheet {
    background: var(--surface-1);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    width: 100%; max-width: 600px; margin: 0 auto;
    padding-bottom: var(--safe-bottom);
    max-height: 85dvh; overflow: hidden;
    display: flex; flex-direction: column;
  }
  .portion-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 16px 8px; flex-shrink: 0;
  }
  .portion-body { padding: 0 16px; display: flex; flex-direction: column; gap: 8px; flex: 1; overflow-y: auto; }

  /* Camera / Crop overlays */
  :global(.cam-overlay) {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.9);
    display: flex; align-items: center; justify-content: center;
  }
  :global(.cam-panel) {
    background: var(--surface-1);
    border-radius: var(--radius-xl);
    width: min(480px, 96vw);
    overflow: hidden;
    display: flex; flex-direction: column;
  }
  :global(.cam-header) {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px; border-bottom: 1px solid var(--border);
  }
  :global(.cam-video) { width: 100%; max-height: 50vh; background: #000; }
  :global(.crop-area) { position: relative; overflow: hidden; max-height: 60vh; }
  :global(.crop-img) { width: 100%; display: block; user-select: none; }
  :global(.crop-box) {
    position: absolute;
    border: 2px solid var(--accent);
    cursor: grab;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.45);
  }
</style>
