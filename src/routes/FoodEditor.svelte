<script>
  import { onMount } from 'svelte';
  import { pop, push } from 'svelte-spa-router';
  import { NtApi } from '../lib/api.js';
  import { NUTRIMENTS } from '../lib/nutrition.js';
  import { showSuccess, showError } from '../stores/toast.js';
  import { editorState, clearFoodEditorState } from '../stores/editorState.js';
  import Toggle from '../components/settings/Toggle.svelte';
  import { foodsShowCategories, foodsShowNotes, foodCategories, visibleNutriments, nutrimentsOrder, customNutriments, cropPhotos, offUsername, offPassword, offUploadCountry } from '../stores/settings.js';

  // ── Photo capture / upload ─────────────────────────────────
  let fileInput;
  let showCamera  = false;
  let showUrlInput = false;
  let photoUrl = '';
  function applyPhotoUrl() {
    const url = photoUrl.trim();
    if (url) { food.imgUrl = url; }
    showUrlInput = false;
    photoUrl = '';
  }
  let cameraVideo = null;
  let cameraStream = null;
  let showCrop    = false;
  let cropSrc     = '';
  let cropImg     = null;
  let cropBox     = null;
  let cropDragging = false, cropStartX, cropStartY, cropOrigL, cropOrigT;

  function openGallery() { fileInput && fileInput.click(); }

  function onFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if ($cropPhotos) {
        cropSrc = ev.target.result;
        showCrop = true;
      } else {
        food.imgUrl = ev.target.result;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function openCamera() {
    showCamera = true;
    await new Promise(r => setTimeout(r, 80));
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 2160 } }
      });
      if (cameraVideo) { cameraVideo.srcObject = cameraStream; cameraVideo.play(); }
    } catch(err) {
      showCamera = false;
      alert('Camera access denied or unavailable.');
    }
  }

  function stopCamera() {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    showCamera = false;
  }

  function capturePhoto() {
    if (!cameraVideo) return;
    const canvas = document.createElement('canvas');
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    canvas.getContext('2d').drawImage(cameraVideo, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopCamera();
    if ($cropPhotos) {
      cropSrc = dataUrl;
      showCrop = true;
    } else {
      food.imgUrl = dataUrl;
    }
  }

  function removePhoto() { food.imgUrl = ''; }

  // Crop UI helpers
  function onCropImgLoad() {
    if (!cropImg || !cropBox) return;
    const w = cropImg.offsetWidth, h = cropImg.offsetHeight;
    cropBox.style.left   = Math.round(w * 0.1) + 'px';
    cropBox.style.top    = Math.round(h * 0.1) + 'px';
    cropBox.style.width  = Math.round(w * 0.8) + 'px';
    cropBox.style.height = Math.round(h * 0.8) + 'px';
  }

  function cropStartDrag(e) {
    cropDragging = true;
    const pt = e.touches ? e.touches[0] : e;
    cropStartX = pt.clientX; cropStartY = pt.clientY;
    cropOrigL = parseInt(cropBox.style.left); cropOrigT = parseInt(cropBox.style.top);
    e.preventDefault();
  }

  function cropMoveDrag(e) {
    if (!cropDragging || !cropImg || !cropBox) return;
    const pt = e.touches ? e.touches[0] : e;
    const w = cropImg.offsetWidth, h = cropImg.offsetHeight;
    cropBox.style.left = Math.max(0, Math.min(w - parseInt(cropBox.style.width),  cropOrigL + pt.clientX - cropStartX)) + 'px';
    cropBox.style.top  = Math.max(0, Math.min(h - parseInt(cropBox.style.height), cropOrigT + pt.clientY - cropStartY)) + 'px';
  }

  function cropEndDrag() { cropDragging = false; }

  function confirmCrop() {
    if (!cropImg || !cropBox) return;
    const scaleX = cropImg.naturalWidth  / cropImg.offsetWidth;
    const scaleY = cropImg.naturalHeight / cropImg.offsetHeight;
    const cx = parseInt(cropBox.style.left) * scaleX;
    const cy = parseInt(cropBox.style.top)  * scaleY;
    const cw = parseInt(cropBox.style.width)  * scaleX;
    const ch = parseInt(cropBox.style.height) * scaleY;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d').drawImage(cropImg, cx, cy, cw, ch, 0, 0, cw, ch);
    food.imgUrl = canvas.toDataURL('image/jpeg', 0.9);
    showCrop = false; cropSrc = '';
  }

  export let params = {};

  let food = {
    name:'', brand:'', barcode:'', imgUrl:'',
    portion: 100, unit: 'g', categories: [], notes: '',
    calories: '', kilojoules: '', fat: '', 'saturated-fat': '', carbohydrates: '',
    sugars: '', 'added-sugars': '', proteins: '', salt: '', fiber: '',
    sodium: '', cholesterol: '', potassium: '', caffeine: '', alcohol: '',
    calcium: '', iron: '', magnesium: '', zinc: '', phosphorus: '',
    'vitamin-c': '', 'vitamin-a': '', 'vitamin-d': '', 'vitamin-e': '', 'vitamin-k': '',
    b1: '', b2: '', b3: '', b6: '', b9: '', b12: ''
  };
  let store = 'foodList';
  let saving = false;
  let showAllNutrients = false;
  let contributing = false;
  let offSuccess = false;
  let linked = true;          // scale nutrients when portion changes
  let _portionRef = 100;      // last committed portion (for ratio calc)
  let downloading = false;
  let downloadSuccess = false;
  $: isNewFood = !(params && params.id);
  $: hasBarcode = !!(food.barcode && food.barcode.trim());

  async function contributeToOFF() {
    contributing = true; offSuccess = false;
    try {
      const { API } = await import('../lib/api.js');
      const { NUTRIMENTS: NUT } = await import('../lib/nutrition.js');
      const nutrition = {};
      for (const n of NUT) {
        const v = food[n.id];
        if (v !== undefined && v !== '' && v !== null && !isNaN(parseFloat(v)))
          nutrition[n.id] = parseFloat(v);
      }
      await API.contributeToOFF(
        { name: food.name, barcode: food.barcode, brand: food.brand,
          portion: food.portion, unit: food.unit, nutrition },
        { offUsername: $offUsername, offPassword: $offPassword,
          offUploadCountry: $offUploadCountry }
      );
      offSuccess = true;
      setTimeout(() => offSuccess = false, 3000);
    } catch(e) {
      alert('Could not upload to Open Food Facts: ' + e.message);
    } finally { contributing = false; }
  }

  function onPortionChange() {
    const newP = parseFloat(food.portion);
    if (linked && _portionRef > 0 && newP > 0 && newP !== _portionRef) {
      const ratio = newP / _portionRef;
      for (const n of NUTRIMENTS) {
        const v = parseFloat(food[n.id]);
        if (!isNaN(v) && v > 0) food[n.id] = Math.round(v * ratio * 10000) / 10000;
      }
      food = { ...food }; // trigger reactivity
    }
    _portionRef = newP > 0 ? newP : _portionRef;
  }

  async function downloadFromOFF() {
    if (!food.barcode) return;
    downloading = true; downloadSuccess = false;
    try {
      const { API } = await import('../lib/api.js');
      const result = await API.lookupBarcode(food.barcode);
      if (!result) { showError('Not found in Open Food Facts'); return; }
      // Only fill empty fields (smart mode)
      if (!food.name && result.name)   food.name  = result.name;
      if (!food.brand && result.brand) food.brand = result.brand;
      if (result.nutrition) {
        for (const n of NUTRIMENTS) {
          const v = result.nutrition[n.id];
          if ((food[n.id] === '' || food[n.id] == null) && v != null) food[n.id] = v;
        }
      }
      if (!food.imgUrl && result.imgUrl) food.imgUrl = result.imgUrl;
      food = { ...food };
      _portionRef = parseFloat(food.portion) || 100;
      downloadSuccess = true;
      setTimeout(() => downloadSuccess = false, 2500);
      showSuccess('Data refreshed from Open Food Facts');
    } catch(e) {
      showError('Refresh failed: ' + e.message);
    } finally { downloading = false; }
  }

  const UNITS = ['g','ml','oz','lb','cup','tbsp','tsp','piece','slice'];

  onMount(async () => {
    store = editorState.foodStore || 'foodList';
    if (editorState.foodPrefill) {
      const prefill = editorState.foodPrefill;
      // Flatten nested nutrition into top-level fields for editing
      const flatNutrition = (prefill.nutrition && typeof prefill.nutrition === 'object') ? { ...prefill.nutrition } : {};
      food = { ...food, ...prefill, ...flatNutrition };
    } else if (params && params.id) {
      const existing = await NtApi.getFood(params.id).catch(() => null);
      if (existing) {
        const flatNutrition = (existing.nutrition && typeof existing.nutrition === 'object') ? { ...existing.nutrition } : {};
        food = { ...food, ...existing, ...flatNutrition };
      }
    }
    _portionRef = parseFloat(food.portion) || 100;
  });

  async function save() {
    if (!food.name.trim()) {
      showError('Please enter a name');
      return;
    }
    saving = true;
    try {
      // Build nested nutrition object from flat fields for Nutrition.calculate() compatibility
      const _nutrition = {};
      for (const _n of NUTRIMENTS) {
        const _v = food[_n.id];
        if (_v !== undefined && _v !== '' && _v !== null && !isNaN(parseFloat(_v))) {
          _nutrition[_n.id] = parseFloat(_v) || 0;
        }
      }
      const item = { ...food, nutrition: _nutrition };
      const saved = food.id
        ? await NtApi.updateFood(food.id, item)
        : await NtApi.createFood(item);
      item.id = saved.id;
      // If called from diary pick mode, also add to diary
      const ctx = editorState.foodDiaryCtx;
      if (ctx) {
        const { addDiaryItem } = await import('../stores/diary.js');
        await addDiaryItem(
          { ...item, portion: item.portion || 100, unit: item.unit || 'g' },
          Number(ctx.meal) || 0,
          ctx.date
        );
      }
      clearFoodEditorState();
      showSuccess(ctx ? 'Added to diary' : 'Saved');
      if (ctx) {
        // Go back twice to return to diary
        history.go(-2);
      } else {
        pop();
      }
    } catch(e) {
      showError('Save failed: ' + (e.message || e));
    } finally {
      saving = false;
    }
  }

  function toggleCategory(cat) {
    food.categories = food.categories || [];
    if (food.categories.includes(cat)) {
      food.categories = food.categories.filter(c => c !== cat);
    } else {
      food.categories = [...food.categories, cat];
    }
  }

  $: visibleFields = (() => {
    const vis = $visibleNutriments;
    if (!vis) return NUTRIMENTS.filter(n => n.default);
    return NUTRIMENTS.filter(n => vis.includes(n.id));
  })();

  $: allFields = NUTRIMENTS;
  $: displayFields = showAllNutrients ? allFields : visibleFields;
</script>

<div class="page-shell editor-page">
  <!-- Header -->
  <header class="editor-header">
    <button class="btn-icon" on:click={pop} aria-label="Back">
      <span class="material-symbols-rounded">arrow_back</span>
    </button>
    <h2 class="editor-title">{params && params.id ? 'Edit Food' : 'Add Food'}</h2>
    <button class="btn btn-primary" style="height:36px;padding:0 16px;font-size:13px"
      on:click={save} disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </header>

  <div class="page-content editor-content">
    <!-- Photo -->
    <div class="card editor-card photo-card">
      <div class="editor-card-title">Photo</div>
      <div class="photo-preview-wrap">
        {#if food.imgUrl}
          <img class="photo-preview-img" src={food.imgUrl} alt="Food" />
          <button class="photo-remove-btn btn-icon" on:click={removePhoto} aria-label="Remove photo">
            <span class="material-symbols-rounded" style="font-size:18px">close</span>
          </button>
        {:else}
          <div class="photo-placeholder">
            <span class="material-symbols-rounded" style="font-size:48px;opacity:0.25">photo_camera</span>
          </div>
        {/if}
      </div>
      <div class="photo-btn-row">
        <button class="btn btn-ghost photo-action-btn" on:click={openCamera}>
          <span class="material-symbols-rounded">camera_alt</span>
          Camera
        </button>
        <button class="btn btn-ghost photo-action-btn" on:click={openGallery}>
          <span class="material-symbols-rounded">photo_library</span>
          Upload
        </button>
        <button class="btn btn-ghost photo-action-btn" on:click={() => { showUrlInput = !showUrlInput; photoUrl = ''; }}>
          <span class="material-symbols-rounded">link</span>
          URL
        </button>
      </div>
      {#if showUrlInput}
        <div class="photo-url-row">
          <input class="input photo-url-input" placeholder="https://..." bind:value={photoUrl}
            on:keydown={e => e.key === 'Enter' && applyPhotoUrl()} />
          <button class="btn btn-primary" on:click={applyPhotoUrl}>Get</button>
        </div>
      {/if}
      <input bind:this={fileInput} type="file" accept="image/*" style="display:none" on:change={onFileChange} />
    </div>

    <!-- Camera popup -->
    {#if showCamera}
      <div class="cam-overlay" role="dialog" aria-modal="true">
        <div class="cam-popup">
          <div class="cam-header">
            <span class="cam-title">Take Photo</span>
            <button class="btn-icon" on:click={stopCamera} aria-label="Cancel">
              <span class="material-symbols-rounded">close</span>
            </button>
          </div>
          <!-- svelte-ignore a11y-media-has-caption -->
          <video bind:this={cameraVideo} autoplay playsinline muted class="cam-video"></video>
          <div class="cam-footer">
            <button class="btn btn-primary cam-capture-btn" on:click={capturePhoto}>
              <span class="material-symbols-rounded">camera_alt</span>
              Capture
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Crop popup -->
    {#if showCrop}
      <div class="cam-overlay" role="dialog" aria-modal="true">
        <div class="cam-popup">
          <div class="cam-header">
            <span class="cam-title">Crop Photo</span>
            <button class="btn-icon" on:click={() => { showCrop = false; cropSrc = ''; }} aria-label="Cancel">
              <span class="material-symbols-rounded">close</span>
            </button>
          </div>
          <p class="crop-hint">Drag the box to reposition</p>
          <div class="crop-container"
            on:mousemove={cropMoveDrag}
            on:touchmove={cropMoveDrag}
            on:mouseup={cropEndDrag}
            on:touchend={cropEndDrag}
          >
            <img bind:this={cropImg} src={cropSrc} class="crop-img" alt="Crop" on:load={onCropImgLoad} />
            <div bind:this={cropBox} class="crop-box"
              on:mousedown={cropStartDrag}
              on:touchstart={cropStartDrag}
            ></div>
          </div>
          <div class="cam-footer">
            <button class="btn btn-primary" on:click={confirmCrop}>Crop &amp; Use</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Basic info -->
    <div class="card editor-card">
      <div class="editor-card-title">Basic Info</div>
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input class="input" placeholder="Food name" bind:value={food.name} />
      </div>
      <div class="form-group">
        <label class="form-label">Brand</label>
        <input class="input" placeholder="Brand (optional)" bind:value={food.brand} />
      </div>
      <div class="form-row" style="align-items:flex-end">
        <div class="form-group" style="flex:1">
          <label class="form-label">Default portion</label>
          <input class="input" type="number" min="0" bind:value={food.portion} on:change={onPortionChange} />
        </div>
        <div class="form-group" style="width:100px">
          <label class="form-label">Unit</label>
          <div class="select-wrap">
            <select class="select" bind:value={food.unit}>
              {#each UNITS as u}<option value={u}>{u}</option>{/each}
            </select>
          </div>
        </div>
        <button class="btn-icon link-btn" class:linked title={linked ? 'Nutrients scale with portion' : 'Nutrients fixed'}
          on:click={() => linked = !linked}>
          <span class="material-symbols-rounded" style="font-size:20px">{linked ? 'link' : 'link_off'}</span>
        </button>
      </div>
      <div class="form-group">
        <label class="form-label">Barcode</label>
        <input class="input" type="text" inputmode="numeric" placeholder="Optional" bind:value={food.barcode} />
        {#if hasBarcode}
          <div class="form-row" style="gap:8px;margin-top:8px">
            {#if isNewFood}
              <button class="btn btn-secondary" style="flex:1"
                on:click={contributeToOFF} disabled={contributing}>
                <span class="material-symbols-rounded" style="font-size:15px;vertical-align:middle;margin-right:4px">upload</span>
                {contributing ? 'Uploading…' : offSuccess ? 'Contributed!' : 'Share to OFF'}
              </button>
            {/if}
            <button class="btn btn-secondary" style="flex:1"
              on:click={downloadFromOFF} disabled={downloading}>
              <span class="material-symbols-rounded" style="font-size:15px;vertical-align:middle;margin-right:4px">download</span>
              {downloading ? 'Loading…' : downloadSuccess ? 'Updated!' : 'Refresh from OFF'}
            </button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Notes -->
    {#if $foodsShowNotes}
      <div class="card editor-card">
        <div class="editor-card-title">Notes</div>
        <textarea class="input textarea" placeholder="Optional notes" bind:value={food.notes}></textarea>
      </div>
    {/if}

    <!-- Nutrition per 100g -->
    <div class="card editor-card">
      <div class="editor-card-title">Nutrition per 100{food.unit || 'g'}</div>
      {#each displayFields as n}
        <div class="form-group">
          <label class="form-label">{n.label} ({n.unit})</label>
          <input class="input" type="number" min="0" step="0.1" placeholder="0"
            bind:value={food[n.id]} />
        </div>
      {/each}
      <button class="btn btn-ghost w-full" style="margin-top:8px"
        on:click={() => showAllNutrients = !showAllNutrients}>
        {showAllNutrients ? 'Show less' : 'Show all nutrients'}
      </button>
    </div>

    <!-- Categories -->
    {#if $foodsShowCategories && ($foodCategories || []).length > 0}
      <div class="card editor-card">
        <div class="editor-card-title">Categories</div>
        <div class="cat-chips">
          {#each $foodCategories as cat}
            <button class="chip" class:accent={(food.categories||[]).includes(cat)}
              on:click={() => toggleCategory(cat)}>
              {#if (food.categories||[]).includes(cat)}
                <span class="material-symbols-rounded" style="font-size:14px">check</span>
              {/if}
              {cat}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div style="height:16px"></div>
  </div>
</div>

<style>
  .link-btn { color: var(--text-3); margin-bottom: 2px; }
  .link-btn.linked { color: var(--accent); }
  .editor-page { padding-top: 0; }
  .editor-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: calc(var(--safe-top) + 12px) 16px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-1);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .editor-title { font-size: 17px; font-weight: 600; flex: 1; }
  .editor-content { display: flex; flex-direction: column; gap: 12px; padding-top: 16px; padding-bottom: 32px; }
  .editor-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .editor-card-title { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); margin-bottom: 4px; }
  .form-row { display: flex; gap: 12px; align-items: flex-end; }
  .cat-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  /* Photo section */
  .photo-card { gap: 10px; }
  .photo-preview-wrap {
    position: relative;
    width: min(360px, 100%);
    aspect-ratio: 1 / 1;
    margin: 0 auto;
    background: var(--surface-2);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px dashed var(--border-strong);
  }
  .photo-preview-wrap:has(.photo-preview-img) {
    border-style: solid;
    border-color: transparent;
  }
  .photo-preview-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: var(--surface-2);
  }
  .photo-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
  .photo-remove-btn {
    position: absolute;
    top: 8px; right: 8px;
    background: rgba(0,0,0,0.55);
    color: #fff;
    border-radius: 50%;
    width: 32px; height: 32px;
  }
  .photo-btn-row { display: flex; gap: 8px; }
  .photo-action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 13px;
  }
  .photo-action-btn .material-symbols-rounded { font-size: 18px; }
  .photo-url-row { display: flex; gap: 8px; margin-top: 8px; }
  .photo-url-input { flex: 1; }

  /* Camera / crop overlay */
  :global(.cam-overlay) {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0,0,0,0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: env(safe-area-inset-top, 16px) 16px 16px;
  }
  :global(.cam-popup) {
    width: 100%;
    max-width: 480px;
    background: var(--surface-1);
    border-radius: var(--radius-xl);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: min(600px, calc(100dvh - 32px));
  }
  :global(.cam-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  :global(.cam-title) { font-size: 17px; font-weight: 600; }
  :global(.cam-video) {
    width: 100%;
    max-height: 55vh;
    object-fit: contain;
    background: #000;
    display: block;
  }
  :global(.cam-footer) {
    padding: 14px 16px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }
  :global(.cam-capture-btn) { gap: 6px; min-width: 140px; }
  :global(.crop-hint) { padding: 8px 16px 0; font-size: 12px; color: var(--text-3); }
  :global(.crop-container) { position: relative; overflow: hidden; user-select: none; touch-action: none; }
  :global(.crop-img) { display: block; max-width: 100%; max-height: 55vh; }
  :global(.crop-box) {
    position: absolute;
    border: 2px solid #fff;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);
    cursor: move;
    box-sizing: border-box;
    touch-action: none;
  }


</style>
