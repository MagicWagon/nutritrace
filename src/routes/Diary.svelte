<script>
  import { onMount, onDestroy } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { fade, slide, fly } from 'svelte/transition';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';

  import MacroRing    from '../components/diary/MacroRing.svelte';
  import Sheet        from '../components/ui/Sheet.svelte';
  import Dialog       from '../components/ui/Dialog.svelte';
  import ActionSheet  from '../components/ui/ActionSheet.svelte';
  import { showSuccess, showError } from '../stores/toast.js';
  import {
    currentDate, currentEntry, diaryTotals, macroPercents,
    prevDay, nextDay, loadEntry, removeDiaryItem, updateDiaryItem, saveBodyStats,
    diaryShowNutritionSummary, diaryShowBodyStats
  } from '../stores/diary.js';
  import { mealNames, goals, energyUnit, weightUnit, lengthUnit, navStyle,
           diaryShowBrands, diaryShowThumbnails,
           diaryShowTimestamps, diaryShowMacroSummary, diaryPromptQuantity,
           diaryShowPortionSize, diaryShowNutritionBar, diaryTotalsMode,
           diaryShowAllNutrients, diaryShowNutritionUnits, visibleNutriments, hiddenBodyStats,
           dateFormat, timeFormat, disableAnimations, goalCelebrations } from '../stores/settings.js';
  import { NtApi } from '../lib/api.js';
  import { DB } from '../lib/db.js';
  import { portal } from '../lib/portal.js';
  import { Nutrition, NUTRIMENTS } from '../lib/nutrition.js';

  let addMealIdx = 0;
  let showAddAction = false;
  let showDeleteDialog = false;
  let pendingDeleteIdx = null;
  // showBodyStats and showNutritionSummary now live in diary.js stores (controlled from topbar)
  let editItem         = null;   // { item, idx }
  let editPortion      = 100;
  let editUnit         = 'g';
  let editQuantity     = 1;
  let showEditSheet    = false;

  // Sheet lock helper - prevents backdrop click-through on mobile
  let _sheetLock = false;
  let _sheetLockTimer;
  function _lockAndOpen(setter) {
    clearTimeout(_sheetLockTimer);
    _sheetLock = true;
    setter();
    _sheetLockTimer = setTimeout(() => _sheetLock = false, 400);
  }

  // Body stats
  let bodyStatsData = {};
  function openBodyStats() {
    bodyStatsData = { ...(entry.bodyStats || {}) };
    _lockAndOpen(() => diaryShowBodyStats.set(true));
  }
  async function saveBodyStatsLocal() {
    await saveBodyStats(bodyStatsData);
    diaryShowBodyStats.set(false);
    showSuccess('Body stats saved');
  }

  function openEditItem(item) {
    editItem     = item;
    editPortion  = item.portion || item.amount || 100;
    editUnit     = item.unit || 'g';
    editQuantity = item.quantity || 1;
    _lockAndOpen(() => showEditSheet = true);
  }

  async function saveEditItem() {
    if (!editItem) return;
    await updateDiaryItem(editItem._i, { portion: editPortion, unit: editUnit, quantity: editQuantity });
    showEditSheet = false;
    editItem = null;
    showSuccess('Updated');
  }

  $: meals = $mealNames || ['Breakfast','Lunch','Dinner','Snacks'];
  $: editCalc = editItem ? Nutrition.calculate({ ...editItem, portion: editPortion || 100, quantity: editQuantity || 1 }) : {};
  // Only use currentEntry if it belongs to the currently-displayed date;
  // this prevents stale data from a previous date from showing when navigating
  $: entry = ($currentEntry && $currentEntry.date === $currentDate)
    ? $currentEntry
    : { items: [], bodyStats: {} };
  $: totals = $diaryTotals || {};

  $: caloriesGoal = ($goals && $goals.calories) ? ($goals.calories.max || $goals.calories.min || 2000) : 2000;
  $: _hasBottomNav = $navStyle === 'bottom' || $navStyle === 'both';
  $: barBottom     = _hasBottomNav ? 'calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))' : 'env(safe-area-inset-bottom, 0px)';

  let barExpanded = false;
  let showWaterQuickAdd = false;
  $: _mp = Nutrition.macroPercents(totals);

  // Meal visual identity (icon + accent color per meal slot)
  const MEAL_ICONS  = ['coffee', 'lunch_dining', 'dinner_dining', 'nutrition'];
  const MEAL_COLORS = ['#FFB347', '#4FFFB0', '#4FC3F7', '#CE93D8'];

  // Tweened counters — animate numbers when food is added/removed
  // Pass duration dynamically so they respect "Disable animations"
  const _calTween  = tweened(0, { duration: 500, easing: cubicOut });
  const _protTween = tweened(0, { duration: 400, easing: cubicOut });
  const _carbTween = tweened(0, { duration: 400, easing: cubicOut });
  const _fatTween  = tweened(0, { duration: 400, easing: cubicOut });
  $: _calTween.set(Math.round(totals.calories || 0),       { duration: $disableAnimations ? 0 : 500 });
  $: _protTween.set(Math.round((totals.proteins||0)*10)/10,       { duration: $disableAnimations ? 0 : 400 });
  $: _carbTween.set(Math.round((totals.carbohydrates||0)*10)/10,  { duration: $disableAnimations ? 0 : 400 });
  $: _fatTween.set(Math.round((totals.fat||0)*10)/10,             { duration: $disableAnimations ? 0 : 400 });

  // Bar fill-in on mount — bars start at 0 and animate to actual value
  let _barsMounted = false;

  // Goal celebration
  let _calGoalCelebrating   = false;
  let _waterGoalCelebrating = false;
  let _prevCalPct   = null;
  let _prevWaterPct = null;
  $: if (_prevCalPct !== null && $goalCelebrations && !$disableAnimations && calPct >= 100 && _prevCalPct < 100) {
    _calGoalCelebrating = true;
    setTimeout(() => { _calGoalCelebrating = false; }, 1200);
  }
  $: _prevCalPct = calPct;
  $: if (_prevWaterPct !== null && $goalCelebrations && !$disableAnimations && _waterPct >= 100 && _prevWaterPct < 100) {
    _waterGoalCelebrating = true;
    setTimeout(() => { _waterGoalCelebrating = false; }, 1200);
  }
  $: _prevWaterPct = _waterPct;
  $: _barExpandedExtra = barExpanded
    ? (52 + 48 + ($diaryShowNutritionBar && nutritionBarItems.length > 0 ? 8 + nutritionBarItems.length * 28 : 0) + 8 + (_waterShowInDiary ? 40 : 0))
    : 0;
  $: _barBaseH = 46 + (_waterShowInDiary ? 8 : 0);
  $: contentPad = _hasBottomNav
    ? `calc(var(--nav-h) + ${_barBaseH + _barExpandedExtra + 12}px)`
    : `${_barBaseH + _barExpandedExtra + 12}px`;

  // Per-macro goals (absolute) for bottom bar remaining display
  function _macroGoal(id) {
    const g = $goals?.[id]; if (!g) return null;
    const raw = g.max ?? g.min ?? null; if (raw == null) return null;
    if (g.isPercent) {
      const density = {fat:9,'saturated-fat':9,carbohydrates:4,sugars:4,proteins:4}[id];
      return density ? Math.round(caloriesGoal * raw / 100 / density) : raw;
    }
    return raw;
  }
  $: fatGoal   = _macroGoal('fat');
  $: carbGoal  = _macroGoal('carbohydrates');
  $: protGoal  = _macroGoal('proteins');
  $: calPct    = Math.min(100, ((totals.calories||0) / caloriesGoal) * 100);

  function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d + 'T12:00:00');
    const today = new Date().toISOString().slice(0,10);
    const yest  = new Date(Date.now() - 86400000).toISOString().slice(0,10);
    if (d === today) return 'Today';
    if (d === yest)  return 'Yesterday';
    return dt.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  }

  function formatDateSub(d, fmt) {
    if (!d) return '';
    const dt = new Date(d + 'T12:00:00');
    fmt = fmt || 'ISO';
    if (fmt === 'US') {
      const m = String(dt.getMonth()+1).padStart(2,'0');
      const dy = String(dt.getDate()).padStart(2,'0');
      return m + '/' + dy + '/' + dt.getFullYear();
    } else if (fmt === 'EU') {
      const m = String(dt.getMonth()+1).padStart(2,'0');
      const dy = String(dt.getDate()).padStart(2,'0');
      return dy + '/' + m + '/' + dt.getFullYear();
    } else if (fmt === 'natural') {
      return dt.toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' });
    }
    return d; // ISO default
  }

  function openAddFood(mealIdx) {
    addMealIdx = mealIdx;
    push('/foods?pick=1&meal=' + mealIdx + '&date=' + $currentDate);
  }

  function confirmDelete(idx) {
    pendingDeleteIdx = idx;
    _lockAndOpen(() => showDeleteDialog = true);
  }

  async function doDelete() {
    if (pendingDeleteIdx !== null) {
      await removeDiaryItem(pendingDeleteIdx);
      showSuccess('Item removed');
    }
    pendingDeleteIdx = null;
  }

  function getMealTotals(items) {
    if (!items || !items.length) return null;
    const t = Nutrition.sum(items.map(i => Nutrition.calculate(i)));
    const cal = t.calories || 0;
    if (!cal) return null;
    const p = Math.round((t.proteins || 0) * 4 / cal * 100);
    const c = Math.round((t.carbohydrates || 0) * 4 / cal * 100);
    const f = Math.round((t.fat || 0) * 9 / cal * 100);
    return { cal: Math.round(cal), p, c, f };
  }

  function getMealItems(entryItems, mealIdx) {
    return (entryItems || []).map((it, i) => ({...it, _i: i}))
      .filter(it => {
        const m = (it.meal != null) ? it.meal : 0;
        return m === mealIdx || String(m) === String(mealIdx);
      });
  }

  function formatKcal(item) {
    const calc = Nutrition.calculate(item);
    return Math.round(calc.calories || 0);
  }

  // Date picker
  let showDatePicker = false;
  let pickerDate = '';
  // Calendar state for date picker
  let calYear  = new Date().getFullYear();
  let calMonth = new Date().getMonth();
  $: calFirstDay    = new Date(calYear, calMonth, 1).getDay();
  $: calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  let calAtMax = false;
  $: { const _n = new Date(); calAtMax = calYear > _n.getFullYear() + 1 || (calYear === _n.getFullYear() + 1 && calMonth > _n.getMonth()); }
  let showYearPicker  = false;
  let showMonthPicker = false;
  $: calMonthName = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, { month: 'long' });
  $: yearRange = Array.from({length: 22}, (_, i) => (new Date().getFullYear() - 10) + i);
  const monthNames = [
    {idx:0,short:'Jan'},{idx:1,short:'Feb'},{idx:2,short:'Mar'},
    {idx:3,short:'Apr'},{idx:4,short:'May'},{idx:5,short:'Jun'},
    {idx:6,short:'Jul'},{idx:7,short:'Aug'},{idx:8,short:'Sep'},
    {idx:9,short:'Oct'},{idx:10,short:'Nov'},{idx:11,short:'Dec'},
  ];
  function _todayStr() { return new Date().toISOString().slice(0, 10); }
  function calPrevMonth() {
    showYearPicker = false; showMonthPicker = false;
    if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--;
  }
  function calNextMonth() {
    showYearPicker = false; showMonthPicker = false;
    if (calAtMax) return;
    if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++;
  }
  function openDatePicker() {
    const d = $currentDate;
    const dt = new Date(d + 'T12:00:00');
    calYear  = dt.getFullYear();
    calMonth = dt.getMonth();
    // Show date in user's chosen format in the text input
    const fmt = $dateFormat || 'ISO';
    if (fmt === 'US') {
      const m = String(dt.getMonth()+1).padStart(2,'0');
      const dy = String(dt.getDate()).padStart(2,'0');
      pickerDate = m + '/' + dy + '/' + dt.getFullYear();
    } else if (fmt === 'EU') {
      const m = String(dt.getMonth()+1).padStart(2,'0');
      const dy = String(dt.getDate()).padStart(2,'0');
      pickerDate = dy + '/' + m + '/' + dt.getFullYear();
    } else {
      pickerDate = d; // ISO (YYYY-MM-DD)
    }
    _lockAndOpen(() => showDatePicker = true);
  }
  function goToDate() {
    let iso = null;
    if (pickerDate) {
      // Accept ISO: YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(pickerDate)) {
        iso = pickerDate;
      // Accept US: MM/DD/YYYY
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(pickerDate)) {
        const [m,d,y] = pickerDate.split('/');
        iso = y + '-' + m.padStart(2,'0') + '-' + d.padStart(2,'0');
      // Accept EU: DD/MM/YYYY
      } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(pickerDate)) {
        const [d,m,y] = pickerDate.split('-');
        iso = y + '-' + m.padStart(2,'0') + '-' + d.padStart(2,'0');
      }
    }
    if (iso) {
      loadEntry(iso);
      showDatePicker = false;
    } else if (!pickerDate) {
      showDatePicker = false;
    }
  }

  function nutrientBarColor(id) {
    if (id === 'fat' || id === 'saturated-fat') return 'var(--macro-fat)';
    if (id === 'carbohydrates' || id === 'sugars' || id === 'added-sugars' || id === 'fiber') return 'var(--macro-carbs)';
    if (id === 'proteins') return 'var(--macro-protein)';
    return 'var(--accent)';
  }

  // Totals toggle — use a local variable so Svelte reactivity is guaranteed
  // even inside the portalled bottom bar element
  let _totalsMode = $diaryTotalsMode || 'consumed';
  $: _totalsMode = $diaryTotalsMode || 'consumed';

  function toggleTotalsMode() {
    const next = _totalsMode === 'consumed' ? 'remaining' : 'consumed';
    _totalsMode = next;
    diaryTotalsMode.set(next);
  }

  // Nutrition bar: visible NUTRIMENTS that have goals set
  $: nutritionBarItems = (() => {
    if (!$diaryShowNutritionBar) return [];
    return NUTRIMENTS
      .filter(n => n.default && $goals[n.id] && $goals[n.id].showInDiary !== false)
      .slice(0, 8) // cap to prevent overflow
      .map(n => {
        const g = $goals[n.id];
        let tgt = null;
        if (g) {
          const raw = g.max ?? g.min ?? null;
          if (raw != null && g.isPercent) {
            const density = {fat:9,'saturated-fat':9,carbohydrates:4,sugars:4,proteins:4}[n.id];
            const calGoal = $goals.calories?.max ?? $goals.calories?.min ?? 2000;
            tgt = density ? Math.round(calGoal * raw / 100 / density) : raw;
          } else {
            tgt = raw;
          }
        }
        const cur = totals[n.id] || 0;
        const rem = tgt ? Math.max(0, tgt - cur) : null;
        const pct = tgt ? Math.min(100, cur / tgt * 100) : 0;
        const over = tgt && cur > tgt && !g?.isMin;
        return { ...n, cur, rem, tgt, pct, over };
      });
  })();

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const use24 = $timeFormat === '24h';
      return new Date(isoStr).toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit', hour12: !use24
      });
    } catch { return ''; }
  }

  // Long-press action sheet
  let showItemAction = false;
  let actionItem     = null;
  let _lpTimer       = null;
  let showMoveToMeal = false;

  function onItemTouchStart(e, item) {
    _lpTimer = setTimeout(() => {
      _lpTimer = null;
      actionItem = item;
      _lockAndOpen(() => showItemAction = true);
    }, 500);
  }
  function onItemTouchMove() {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
  }
  function onItemTouchEnd() {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
  }
  function onItemAction(e) {
    const val = e.detail?.value;
    if (!actionItem) return;
    if (val === 'edit')   { openEditItem(actionItem); }
    if (val === 'delete') { confirmDelete(actionItem._i); }
    if (val === 'move')   { _lockAndOpen(() => showMoveToMeal = true); }
  }
  async function moveItemToMeal(e) {
    const mealIdx = e.detail?.value;
    if (!actionItem || mealIdx == null) return;
    await updateDiaryItem(actionItem._i, { meal: mealIdx });
    showMoveToMeal = false;
    showSuccess('Moved to ' + (meals[mealIdx] || 'meal'));
  }

  // ── Water ──────────────────────────────────────────────────────────────────
  let _waterGoalMl      = DB.getSetting('waterGoalMl',      2000);
  let _waterUnit        = DB.getSetting('waterUnit',        'ml');
  let _waterContainers  = DB.getSetting('waterContainers',  [
    { id: '1', name: 'Small Bottle',     volumeMl: 250  },
    { id: '2', name: 'Standard Bottle', volumeMl: 500  },
    { id: '3', name: 'Large Bottle',    volumeMl: 1000 },
    { id: '4', name: 'Gallon Jug',       volumeMl: 3785 },
  ]);
  let _waterShowInDiary = DB.getSetting('waterShowInDiary', true);

  function _reloadWaterSettings() {
    _waterGoalMl      = DB.getSetting('waterGoalMl',      2000);
    _waterUnit        = DB.getSetting('waterUnit',        'ml');
    _waterContainers  = DB.getSetting('waterContainers',  []);
    _waterShowInDiary = DB.getSetting('waterShowInDiary', true);
  }

  $: _waterLogs  = entry?.water || [];
  $: _waterTotal = _waterLogs.reduce((s, l) => s + (l.amount || 0), 0);
  $: _waterPct   = _waterGoalMl > 0 ? Math.min(100, Math.round(_waterTotal / _waterGoalMl * 100)) : 0;

  function _waterDisplay(ml) {
    if (_waterUnit === 'oz') return (ml / 29.5735).toFixed(0)  + ' fl oz';
    if (_waterUnit === 'L')  return (ml / 1000).toFixed(2)     + ' L';
    if (_waterUnit === 'G')  return (ml / 3785.41).toFixed(3)  + ' G';
    return ml + ' ml';
  }
  function _contDisplay(cont) {
    if (_waterUnit === 'oz') return (cont.volumeMl / 29.5735).toFixed(0) + ' fl oz';
    if (_waterUnit === 'L')  return (cont.volumeMl / 1000).toFixed(2)    + ' L';
    if (_waterUnit === 'G')  return (cont.volumeMl / 3785.41).toFixed(3) + ' G';
    return cont.volumeMl + ' ml';
  }

  async function _addWaterFromDiary(volumeMl) {
    let entry = null;
    currentEntry.subscribe(v => entry = v)();
    const log = { amount: volumeMl, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) };
    const updated = { ...entry, water: [...(entry?.water || []), log] };
    await NtApi.saveDiaryDate($currentDate, {
      items: updated.items || [],
      body_stats: updated.bodyStats || {},
      water: updated.water,
    });
    await loadEntry($currentDate);
  }

  onMount(async () => {
    const today = new Date().toISOString().slice(0, 10);
    let storedDate;
    currentDate.subscribe(v => storedDate = v)();
    await loadEntry(storedDate || today);
    window.addEventListener('wl:setting', _reloadWaterSettings);
    // Trigger bar fill-in animation after first paint
    requestAnimationFrame(() => requestAnimationFrame(() => { _barsMounted = true; }));

    // Detect when user returns to the app on a new day (tab left open overnight)
    function _onVisibility() {
      if (document.visibilityState !== 'visible') return;
      const newToday = new Date().toISOString().slice(0, 10);
      let stored = null;
      currentDate.subscribe(v => stored = v)();
      if (newToday !== stored) loadEntry(newToday);
    }
    document.addEventListener('visibilitychange', _onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', _onVisibility);
      window.removeEventListener('wl:setting', _reloadWaterSettings);
    };
  });
</script>

<div class="page-shell diary-page">
  <header class="page-header diary-header">
    <div class="diary-title-row">
      <h1>Diary</h1>
      <div class="diary-title-actions">
        {#if _waterShowInDiary}
          <button class="btn-icon accent" on:click={() => showWaterQuickAdd = true} aria-label="Log water" title="Water — log your water intake">
            <span class="material-symbols-rounded">water_drop</span>
          </button>
        {/if}
        <button class="btn-icon accent" on:click={() => diaryShowNutritionSummary.set(true)} aria-label="Nutrition summary" title="Nutrition Summary — full breakdown of today's nutrients">
          <span class="material-symbols-rounded">monitoring</span>
        </button>
        <button class="btn-icon accent" on:click={() => diaryShowBodyStats.set(true)} aria-label="Body stats" title="Body Stats — log weight, body fat, and measurements">
          <span class="material-symbols-rounded">scale</span>
        </button>
      </div>
    </div>
    <div class="diary-date-row">
      <button class="btn-icon accent" on:click={prevDay} aria-label="Previous day">
        <span class="material-symbols-rounded">chevron_left</span>
      </button>
      <button class="date-btn" on:click={openDatePicker} title="Jump to date">
        <span class="date-label">{formatDate($currentDate)}</span>
        <span class="date-sub">{formatDateSub($currentDate, $dateFormat)}</span>
      </button>
      <button class="btn-icon accent" on:click={nextDay} aria-label="Next day">
        <span class="material-symbols-rounded">chevron_right</span>
      </button>
    </div>
  </header>

  <div class="page-content diary-content" style="padding-bottom:{contentPad}">
    <!-- Meal groups -->
    {#each meals as meal, mealIdx}
      {@const items = getMealItems(entry.items, mealIdx)}
      <section class="meal-group card" in:fly={{ y: 18, duration: 280, delay: 60 + mealIdx * 55 }}>
        <div class="meal-header" style="--meal-color:{MEAL_COLORS[mealIdx] || MEAL_COLORS[3]}">
          <span class="meal-type-icon material-symbols-rounded">{MEAL_ICONS[mealIdx] || MEAL_ICONS[3]}</span>
          <span class="meal-name">{meal}</span>
          {#if items.length > 0}
            <span class="meal-kcal text-3 text-sm">
              {items.reduce((s,it) => s + formatKcal(it), 0)} kcal
            </span>
          {/if}
          <button class="btn-icon accent ml-auto" on:click={() => openAddFood(mealIdx)} aria-label="Add food to {meal}">
            <span class="material-symbols-rounded">add</span>
          </button>
        </div>

        {#if items.length === 0}
          <div class="meal-empty">
            <span class="material-symbols-rounded meal-empty-icon" style="color:{MEAL_COLORS[mealIdx] || MEAL_COLORS[3]}">add_circle</span>
            <span class="meal-empty-text">Tap + to add food</span>
          </div>
        {:else}
          <div class="meal-items">
            {#each items as item (item._i)}
              <div class="diary-item" in:fly={{ y: 6, duration: 180 }}
                on:touchstart|passive={e => onItemTouchStart(e, item)}
                on:touchmove|passive={onItemTouchMove}
                on:touchend={onItemTouchEnd}
                on:contextmenu|preventDefault={() => { actionItem = item; _lockAndOpen(() => showItemAction = true); }}>
                <button class="diary-item-btn" on:click={() => openEditItem(item)}>
                  {#if $diaryShowThumbnails && item.imgUrl}
                    <img class="item-thumb" src={item.imgUrl} alt="" loading="lazy" />
                  {:else if $diaryShowThumbnails}
                    <div class="item-thumb-placeholder">
                      <span class="material-symbols-rounded" style="font-size:18px;color:var(--accent)">restaurant</span>
                    </div>
                  {/if}
                  <div class="item-info">
                    <span class="item-name truncate">{item.name}</span>
                    <span class="item-meta text-3 text-sm">
                      {item.portion || item.amount || 100}{item.unit || 'g'}{#if (item.quantity || 1) > 1} × {item.quantity || 1}{#if $diaryShowPortionSize} (= {Math.round((item.portion || item.amount || 100) * (item.quantity || 1))}{item.unit || 'g'}){/if}{/if}
                      {#if $diaryShowBrands && item.brand} · {item.brand}{/if}
                      · {formatKcal(item)} kcal
                      {#if $diaryShowTimestamps && item.addedAt}
                        · {formatTime(item.addedAt)}
                      {/if}
                    </span>
                  </div>
                </button>

              </div>
            {/each}
          </div>
        {/if}
        {#if items.length > 0}
          <button class="meal-add-row" on:click={() => openAddFood(mealIdx)}>
            <span class="material-symbols-rounded">add</span>
            <span>Add food</span>
          </button>
        {/if}
        {#if $diaryShowMacroSummary && items.length > 0}
          {@const mt = getMealTotals(items)}
          {#if mt}
            <div class="meal-macro-footer">
              <div class="meal-macro-bar">
                <div class="mmb-p" style="width:{mt.p}%" title="Protein {mt.p}%"></div>
                <div class="mmb-c" style="width:{mt.c}%" title="Carbs {mt.c}%"></div>
                <div class="mmb-f" style="width:{mt.f}%" title="Fat {mt.f}%"></div>
              </div>
              <span class="meal-macro-text text-3 text-sm"><span style="color:var(--macro-protein)">{mt.p}% P</span> · <span style="color:var(--macro-carbs)">{mt.c}% C</span> · <span style="color:var(--macro-fat)">{mt.f}% F</span> · <span style="color:var(--macro-calories)">{mt.cal} kcal</span></span>
            </div>
          {/if}
        {/if}
      </section>
    {/each}


  </div>
</div>

<!-- Persistent bottom nutrition bar -->
<div use:portal class="diary-bottom-bar" style="bottom:{barBottom}">
  <!-- Calorie progress strip -->
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="dbb-progress" on:click={() => barExpanded = !barExpanded}
    title="Calories: {Math.round(calPct)}%">
    <div class="dbb-progress-fill"
      class:celebrating={_calGoalCelebrating}
      style="width:{_barsMounted ? calPct : 0}%;{calPct >= 100 ? 'background:var(--danger)' : ''}"></div>
  </div>
  <!-- Macro proportion bar — outside button so title tooltips work on hover -->
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="dbb-macro-bar" on:click={() => barExpanded = !barExpanded}>
    <div class="dbb-mb-p" style="width:{_barsMounted ? _mp.protein : 0}%" title="Protein {_mp.protein}%"></div>
    <div class="dbb-mb-c" style="width:{_barsMounted ? _mp.carbs : 0}%"   title="Carbs {_mp.carbs}%"></div>
    <div class="dbb-mb-f" style="width:{_barsMounted ? _mp.fat : 0}%"     title="Fat {_mp.fat}%"></div>
  </div>
  <!-- Water progress strip (collapsed, always visible) -->
  {#if _waterShowInDiary}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="dbb-water-strip" on:click={() => barExpanded = !barExpanded}
      title="Water: {_waterPct}%">
      <div class="dbb-water-strip-fill"
        class:celebrating={_waterGoalCelebrating}
        style="width:{_barsMounted ? _waterPct : 0}%"></div>
    </div>
  {/if}

  <!-- Text summary row — taps to expand/collapse -->
  <button class="dbb-summary-row" on:click={() => barExpanded = !barExpanded}
    aria-label="{barExpanded ? 'Collapse' : 'Expand'} nutrition panel">
    <span class="dbb-summary-text"><span style="color:var(--macro-protein)">{_mp.protein}% P</span> · <span style="color:var(--macro-carbs)">{_mp.carbs}% C</span> · <span style="color:var(--macro-fat)">{_mp.fat}% F</span> · <span style="color:var(--macro-calories)">{Math.round($_calTween)} kcal</span>{#if _waterShowInDiary} · <span style="color:var(--water-blue)">💧 {_waterDisplay(_waterTotal)}</span>{/if}</span>
    <span class="dbb-chevron material-symbols-rounded">{barExpanded ? 'expand_more' : 'expand_less'}</span>
  </button>

  <!-- Expanded detail panel -->
  {#if barExpanded}
    <div class="dbb-panel" transition:slide={{ duration: 220 }}>
      <!-- Consumed / Remaining toggle -->
      <div class="dbb-toggle-row">
        <button class="dbb-toggle-pill" on:click|stopPropagation={toggleTotalsMode}
          aria-label="Toggle consumed/remaining">
          <span class="dbb-tp-opt" class:dbb-tp-active={_totalsMode === 'consumed'}>Consumed</span>
          <span class="dbb-tp-opt" class:dbb-tp-active={_totalsMode === 'remaining'}>Remaining</span>
        </button>
      </div>
      <!-- Mode-aware calorie + macro row -->
      <div class="dbb-detail-row">
        <div class="dbb-kcal">
          {#if _totalsMode === 'remaining'}
            <span class="dbb-num">{Math.max(0, caloriesGoal - Math.round($_calTween))}</span>
            <span class="dbb-unit">kcal left</span>
          {:else}
            <span class="dbb-num">{Math.round($_calTween)}</span>
            <span class="dbb-unit">kcal eaten</span>
          {/if}
        </div>
        <div class="dbb-macros">
          <span class="dbb-macro" style="color:var(--macro-protein)">
            {#if _totalsMode === 'remaining' && protGoal != null}{Math.max(0, Math.round((protGoal - $_protTween)*10)/10)}{:else}{Math.round($_protTween*10)/10}{/if}
            <span class="dbb-mlabel">g Protein</span>
          </span>
          <span class="dbb-macro" style="color:var(--macro-carbs)">
            {#if _totalsMode === 'remaining' && carbGoal != null}{Math.max(0, Math.round((carbGoal - $_carbTween)*10)/10)}{:else}{Math.round($_carbTween*10)/10}{/if}
            <span class="dbb-mlabel">g Carbs</span>
          </span>
          <span class="dbb-macro" style="color:var(--macro-fat)">
            {#if _totalsMode === 'remaining' && fatGoal != null}{Math.max(0, Math.round((fatGoal - $_fatTween)*10)/10)}{:else}{Math.round($_fatTween*10)/10}{/if}
            <span class="dbb-mlabel">g Fat</span>
          </span>
        </div>
      </div>
      <!-- Water row -->
      {#if _waterShowInDiary}
        <div class="dbb-water-row">
          <span class="material-symbols-rounded dbb-water-icon">water_drop</span>
          <div class="dbb-water-track">
            <div class="dbb-water-bar">
              <div class="dbb-water-fill" style="width:{_waterPct}%"></div>
            </div>
            <span class="dbb-water-text">
              {#if _totalsMode === 'remaining'}
                {_waterDisplay(Math.max(0, _waterGoalMl - _waterTotal))} left
              {:else}
                {_waterDisplay(_waterTotal)}
              {/if}
              / {_waterDisplay(_waterGoalMl)}
            </span>
          </div>
          <span class="dbb-water-pct">{_totalsMode === 'remaining' ? Math.max(0, 100 - _waterPct) + '%' : _waterPct + '%'}</span>
        </div>
      {/if}

      <!-- Nutrient bars -->
      {#if $diaryShowNutritionBar && nutritionBarItems.length > 0}
        <div class="dbb-nutrient-bars">
          {#each nutritionBarItems as nb}
            <div class="nb-row">
              <span class="nb-label">{nb.label}</span>
              <div class="nb-bar"><div class="nb-fill" class:over={nb.over} style="width:{nb.pct}%;{nb.over ? '' : 'background:' + nutrientBarColor(nb.id)}"></div></div>
              <span class="nb-val" class:over={nb.over}>
                {#if _totalsMode === 'remaining' && nb.tgt}
                  {Math.max(0, Math.round((nb.tgt - nb.cur)*10)/10)}{#if $diaryShowNutritionUnits} {nb.unit}{/if}
                {:else}
                  {Math.round(nb.cur*10)/10}{#if $diaryShowNutritionUnits} {nb.unit}{/if}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Water quick-add sheet -->
<Sheet bind:open={showWaterQuickAdd} title="Log Water" on:close={() => showWaterQuickAdd = false}>
  <div class="wqa-body">
    <div class="wqa-progress">
      <div class="wqa-progress-bar">
        <div class="wqa-progress-fill" style="width:{_waterPct}%"></div>
      </div>
      <span class="wqa-stats text-3 text-sm">{_waterDisplay(_waterTotal)} / {_waterDisplay(_waterGoalMl)} · {_waterPct}%</span>
    </div>
    <div class="wqa-grid">
      {#each _waterContainers as cont (cont.id)}
        <button class="wqa-btn" on:click={() => { _addWaterFromDiary(cont.volumeMl); showWaterQuickAdd = false; }}>
          <span class="material-symbols-rounded" style="color:var(--accent);font-size:22px">water_drop</span>
          <span class="wqa-name">{cont.name}</span>
          <span class="wqa-vol text-3">{_contDisplay(cont)}</span>
        </button>
      {/each}
      {#if _waterContainers.length === 0}
        {#each [250, 500, 1000] as ml}
          <button class="wqa-btn" on:click={() => { _addWaterFromDiary(ml); showWaterQuickAdd = false; }}>
            <span class="material-symbols-rounded" style="color:var(--accent);font-size:22px">water_drop</span>
            <span class="wqa-vol text-3">{_waterDisplay(ml)}</span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
</Sheet>

<!-- Edit item sheet -->
<Sheet bind:open={showEditSheet} title={editItem ? editItem.name : ''} on:close={() => showEditSheet = false}>
  {#if editItem}
    <div class="edit-sheet-body">
      <div class="form-row" style="gap:12px;margin-bottom:16px">
        <div style="flex:1">
          <label class="form-label" style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">Amount</label>
          <input class="input" type="number" min="0.1" step="0.1" bind:value={editPortion} style="width:100%" />
        </div>
        <div style="width:90px">
          <label class="form-label" style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">Unit</label>
          <select class="select" bind:value={editUnit} style="width:100%">
            {#each ['g','ml','oz','lb','cup','tbsp','tsp','piece','slice','serving'] as u}
              <option value={u}>{u}</option>
            {/each}
          </select>
        </div>
      </div>
      <div style="margin-bottom:8px">
          <label class="form-label" style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">Quantity (servings)</label>
          <input class="input" type="number" min="0.1" step="0.1" bind:value={editQuantity} style="width:100%" />
        </div>
      <div class="edit-macros">
        <div class="edit-macro-pill">
          <span class="edit-macro-val">{Math.round(editCalc.calories || 0)}</span>
          <span class="edit-macro-label">kcal</span>
        </div>
        <div class="edit-macro-pill">
          <span class="edit-macro-val">{Math.round((editCalc.proteins || 0) * 10)/10}g</span>
          <span class="edit-macro-label">protein</span>
        </div>
        <div class="edit-macro-pill">
          <span class="edit-macro-val">{Math.round((editCalc.carbohydrates || 0) * 10)/10}g</span>
          <span class="edit-macro-label">carbs</span>
        </div>
        <div class="edit-macro-pill">
          <span class="edit-macro-val">{Math.round((editCalc.fat || 0) * 10)/10}g</span>
          <span class="edit-macro-label">fat</span>
        </div>
      </div>
      <button class="btn btn-primary w-full" style="margin-top:16px" on:click={saveEditItem}>Save</button>
    </div>
  {/if}
</Sheet>

<!-- Delete confirm dialog -->
<Dialog
  bind:open={showDeleteDialog}
  title="Remove item?"
  message="This will remove the item from today's diary."
  confirmText="Remove"
  dangerous
  on:confirm={doDelete}
/>

<!-- Item long-press action sheet -->
<ActionSheet
  bind:open={showItemAction}
  title={actionItem?.name || ''}
  actions={[
    { label: 'Edit',         icon: 'edit',       value: 'edit'   },
    { label: 'Move to meal', icon: 'swap_horiz', value: 'move'   },
    { label: 'Delete',       icon: 'delete',     value: 'delete', danger: true },
  ]}
  on:select={onItemAction}
/>

<!-- Move to meal action sheet -->
<ActionSheet
  bind:open={showMoveToMeal}
  title="Move to meal"
  actions={meals.map((m, i) => ({ label: m, icon: 'restaurant', value: i }))}
  on:select={moveItemToMeal}
/>

<!-- Date Picker Calendar Sheet -->
{#if showDatePicker}
  <div use:portal class="sheet-backdrop" role="dialog" aria-modal="true"
    on:click={() => { if (!_sheetLock) showDatePicker = false; }} on:keydown={() => {}}>
    <div class="bs-sheet dp-sheet" on:click|stopPropagation on:keydown={() => {}}>
      <div class="sheet-handle"></div>
      <!-- Month / year navigation -->
      <div class="dp-nav">
        <button class="btn-icon dp-nav-btn" on:click={calPrevMonth} aria-label="Previous month">
          <span class="material-symbols-rounded">chevron_left</span>
        </button>
        <div class="dp-month-year">
          <button class="dp-month-btn" on:click={() => { showMonthPicker = !showMonthPicker; showYearPicker = false; }}
            title="Pick month">{calMonthName}<span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle;margin-left:2px">{showMonthPicker ? 'expand_less' : 'expand_more'}</span></button>
          <button class="dp-year-btn" on:click={() => { showYearPicker = !showYearPicker; showMonthPicker = false; }}
            title="Pick year">{calYear}<span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle;margin-left:2px">{showYearPicker ? 'expand_less' : 'expand_more'}</span></button>
        </div>
        <button class="btn-icon dp-nav-btn" on:click={calNextMonth} disabled={calAtMax} aria-label="Next month">
          <span class="material-symbols-rounded">chevron_right</span>
        </button>
      </div>
      <!-- Year picker grid (shown when year is tapped) -->
      {#if showYearPicker}
        <div class="dp-year-grid">
          {#each yearRange as yr}
            <button class="dp-yr-btn" class:dp-yr-sel={yr === calYear}
              on:click={() => { calYear = yr; showYearPicker = false; }}>{yr}</button>
          {/each}
        </div>
      {:else if showMonthPicker}
        <div class="dp-month-grid">
          {#each monthNames as m}
            <button class="dp-mo-btn" class:dp-mo-sel={m.idx === calMonth}
              on:click={() => { calMonth = m.idx; showMonthPicker = false; }}>{m.short}</button>
          {/each}
        </div>
      {:else}
        <!-- Day-of-week headers -->
        <div class="dp-grid">
          {#each ['Su','Mo','Tu','We','Th','Fr','Sa'] as dh}
            <div class="dp-dh">{dh}</div>
          {/each}
          <!-- Blank offset for first day of month -->
          {#each {length: calFirstDay} as _}
            <div></div>
          {/each}
          <!-- Day buttons — future dates allowed for meal planning -->
          {#each {length: calDaysInMonth} as _, di}
            {@const day = di + 1}
            {@const ds = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(day).padStart(2,'0')}
            <button class="dp-day"
              class:dp-today={ds === _todayStr()}
              class:dp-sel={ds === pickerDate}
              class:dp-future={ds > _todayStr()}
              on:click={() => { pickerDate = ds; goToDate(); }}>
              {day}
            </button>
          {/each}
        </div>
        <!-- Manual date entry -->
        <div class="dp-manual">
          <input class="input" type="text" bind:value={pickerDate}
            placeholder={$dateFormat === 'US' ? 'MM/DD/YYYY' : $dateFormat === 'EU' ? 'DD/MM/YYYY' : 'YYYY-MM-DD'}
            style="flex:1;font-size:14px;height:40px" />
          <button class="btn btn-primary" style="height:40px;padding:0 18px" on:click={goToDate}>Go</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Body Stats Sheet -->
{#if $diaryShowBodyStats}
  <div use:portal class="sheet-backdrop" role="dialog" aria-modal="true"
    on:click={() => { if (!_sheetLock) diaryShowBodyStats.set(false); }} on:keydown={() => {}}>
    <div class="bs-sheet" on:click|stopPropagation on:keydown={() => {}}>
      <div class="sheet-handle"></div>
      <div class="sheet-header-row">
        <h3 class="sheet-title">Body Stats</h3>
      </div>
      <div class="bs-sheet-body">
        <div class="bs-grid">
          {#if !($hiddenBodyStats||[]).includes('weight')}
          <div><label class="form-label">Weight ({$weightUnit||'kg'})</label>
            <input class="input" type="number" step="0.1" min="0" bind:value={bodyStatsData.weight} /></div>
          {/if}
          {#if !($hiddenBodyStats||[]).includes('body_fat')}
          <div><label class="form-label">Body Fat %</label>
            <input class="input" type="number" step="0.1" min="0" max="100" bind:value={bodyStatsData.body_fat} /></div>
          {/if}
          {#if !($hiddenBodyStats||[]).includes('neck')}
          <div><label class="form-label">Neck ({$lengthUnit||'in'})</label>
            <input class="input" type="number" step="0.1" min="0" bind:value={bodyStatsData.neck} /></div>
          {/if}
          {#if !($hiddenBodyStats||[]).includes('waist')}
          <div><label class="form-label">Waist ({$lengthUnit||'in'})</label>
            <input class="input" type="number" step="0.1" min="0" bind:value={bodyStatsData.waist} /></div>
          {/if}
          {#if !($hiddenBodyStats||[]).includes('hips')}
          <div><label class="form-label">Hips ({$lengthUnit||'in'})</label>
            <input class="input" type="number" step="0.1" min="0" bind:value={bodyStatsData.hips} /></div>
          {/if}
          {#if !($hiddenBodyStats||[]).includes('chest')}
          <div><label class="form-label">Chest ({$lengthUnit||'in'})</label>
            <input class="input" type="number" step="0.1" min="0" bind:value={bodyStatsData.chest} /></div>
          {/if}
          {#if !($hiddenBodyStats||[]).includes('thighs')}
          <div><label class="form-label">Thighs ({$lengthUnit||'in'})</label>
            <input class="input" type="number" step="0.1" min="0" bind:value={bodyStatsData.thighs} /></div>
          {/if}
          {#if !($hiddenBodyStats||[]).includes('biceps')}
          <div><label class="form-label">Biceps ({$lengthUnit||'in'})</label>
            <input class="input" type="number" step="0.1" min="0" bind:value={bodyStatsData.biceps} /></div>
          {/if}
          {#if !($hiddenBodyStats||[]).includes('calves')}
          <div><label class="form-label">Calves</label>
            <input class="input" type="number" step="0.1" min="0" placeholder="cm / in" bind:value={bodyStatsData.calves} /></div>
          {/if}
        </div>
      </div>
      <div class="bs-sheet-footer">
        <button class="btn btn-primary w-full" on:click={saveBodyStatsLocal}>Save</button>
      </div>
    </div>
  </div>
{/if}

<!-- Nutrition Summary Modal -->
{#if $diaryShowNutritionSummary}
  <div use:portal class="sheet-backdrop" role="dialog" aria-modal="true"
    on:click={() => { if (!_sheetLock) diaryShowNutritionSummary.set(false); }} on:keydown={() => {}}>
    <div class="ns-sheet" on:click|stopPropagation on:keydown={() => {}}>
      <div class="sheet-handle"></div>
      <div class="sheet-header-row">
        <h3 class="sheet-title">Nutrition Summary</h3>
        <span class="text-3 text-sm">{formatDateSub($currentDate, $dateFormat)}</span>
      </div>
      <div class="ns-body">
        <!-- Macro ring -->
        <div class="ns-ring-wrap">
          <MacroRing
            calories={totals.calories || 0}
            caloriesGoal={caloriesGoal}
            fat={totals.fat || 0}
            carbs={totals.carbohydrates || 0}
            protein={totals.proteins || 0}
          />
        </div>
        <!-- Macros highlight -->
        <div class="ns-macros">
          <div class="ns-macro-pill" style="background:var(--macro-protein-dim)">
            <span class="ns-macro-val" style="color:var(--macro-protein)">{Math.round(totals.proteins || 0)}g</span>
            <span class="ns-macro-lbl">Protein</span>
          </div>
          <div class="ns-macro-pill" style="background:var(--macro-carbs-dim)">
            <span class="ns-macro-val" style="color:var(--macro-carbs)">{Math.round(totals.carbohydrates || 0)}g</span>
            <span class="ns-macro-lbl">Carbs</span>
          </div>
          <div class="ns-macro-pill" style="background:var(--macro-fat-dim)">
            <span class="ns-macro-val" style="color:var(--macro-fat)">{Math.round(totals.fat || 0)}g</span>
            <span class="ns-macro-lbl">Fat</span>
          </div>
          <div class="ns-macro-pill" style="background:var(--macro-calories-dim)">
            <span class="ns-macro-val" style="color:var(--macro-calories)">{Math.round(totals.calories || 0)}</span>
            <span class="ns-macro-lbl">kcal</span>
          </div>
        </div>
        <!-- All nutrients -->
        <div class="ns-rows">
          {#each NUTRIMENTS.filter(n => ($diaryShowAllNutrients ? true : n.default) && (totals[n.id] || 0) > 0) as n}
            <div class="ns-row">
              <span>{n.label}</span>
              <span class="font-medium">{Math.round((totals[n.id]||0)*10)/10} {n.unit}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}


<style>
  /* Date picker calendar */
  .dp-sheet { padding-bottom: 4px; }
  .dp-nav {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 8px 8px;
  }
  .dp-nav-btn { color: var(--text-2); }
  .dp-nav-btn:disabled { opacity: 0.3; cursor: default; }
  .dp-month-year { display: flex; align-items: center; gap: 6px; }
  .dp-month-name { font-size: 16px; font-weight: 700; color: var(--text-1); }
  .dp-month-btn {
    font-size: 16px; font-weight: 700; color: var(--text-1);
    background: var(--surface-2); border: none; cursor: pointer;
    border-radius: var(--radius-sm); padding: 2px 8px;
    display: flex; align-items: center;
    transition: background var(--dur-fast);
  }
  .dp-month-btn:hover { background: var(--surface-3); }
  .dp-year-btn {
    font-size: 16px; font-weight: 700; color: var(--accent);
    background: var(--accent-dim); border: none; cursor: pointer;
    border-radius: var(--radius-sm); padding: 2px 8px;
    display: flex; align-items: center;
    transition: background var(--dur-fast);
  }
  .dp-year-btn:hover { background: color-mix(in srgb, var(--accent) 20%, transparent); }
  .dp-year-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 4px; padding: 4px 8px 8px; max-height: 220px; overflow-y: auto;
  }
  .dp-yr-btn {
    padding: 8px 4px; font-size: 14px; font-weight: 500;
    border-radius: var(--radius-sm); background: none; border: none;
    cursor: pointer; color: var(--text-1); transition: background var(--dur-fast);
    text-align: center;
  }
  .dp-yr-btn:hover { background: var(--surface-2); }
  .dp-yr-btn.dp-yr-sel { background: var(--accent); color: #fff; font-weight: 700; }
  .dp-month-grid {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 4px; padding: 4px 8px 8px;
  }
  .dp-mo-btn {
    padding: 10px 4px; font-size: 14px; font-weight: 500;
    border-radius: var(--radius-sm); background: none; border: none;
    cursor: pointer; color: var(--text-1); transition: background var(--dur-fast);
    text-align: center;
  }
  .dp-mo-btn:hover { background: var(--surface-2); }
  .dp-mo-btn.dp-mo-sel { background: var(--accent); color: #fff; font-weight: 700; }
  .dp-grid {
    display: grid; grid-template-columns: repeat(7, 1fr);
    gap: 2px; padding: 0 8px 4px;
  }
  .dp-dh {
    text-align: center; font-size: 11px; font-weight: 600;
    color: var(--text-3); padding: 4px 0;
  }
  .dp-day {
    aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    font-size: 14px; border-radius: var(--radius-full);
    background: none; border: none; cursor: pointer;
    color: var(--text-1); transition: background var(--dur-fast);
    -webkit-tap-highlight-color: transparent;
  }
  .dp-day:hover:not(:disabled) { background: var(--surface-2); }
  .dp-day:disabled { color: var(--text-3); opacity: 0.35; cursor: default; }
  .dp-day.dp-future { color: var(--text-3); }
  .dp-day.dp-future:hover { background: var(--surface-2); color: var(--text-2); }
  .dp-day.dp-today { color: var(--accent); font-weight: 700; }
  .dp-day.dp-sel { background: var(--accent) !important; color: #fff; font-weight: 600; }
  .dp-manual {
    display: flex; gap: 8px; padding: 8px 16px 16px; align-items: center;
    border-top: 1px solid var(--border); margin-top: 4px;
  }

  .diary-page { padding-top: 0; }

  /* Diary header extends .page-header with its unique column / date-row layout */
  .diary-header {
    flex-direction: column;
    align-items: stretch;
    padding-bottom: 0;
  }
  .diary-title-row { display: flex; align-items: center; padding-bottom: 6px; }
  .diary-title-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
  .diary-date-row { display: flex; align-items: center; gap: 4px; padding-bottom: 8px; }

  .date-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: none;
    border: none;
    cursor: pointer;
    gap: 1px;
  }
  .date-label { font-size: 17px; font-weight: 700; color: var(--accent); }
  .date-sub   { font-size: 12px; color: var(--text-3); }

  .diary-content { padding-top: 12px; padding-bottom: 16px; gap: 12px; display: flex; flex-direction: column; }

  /* Water blue — dedicated color, always blue regardless of theme accent */
  :global(:root) { --water-blue: #2196F3; --water-blue-dim: rgba(33,150,243,0.15); }

  /* Water strip in collapsed bar */
  .dbb-water-strip { height: 8px; background: var(--surface-3); overflow: hidden; cursor: pointer; }
  .dbb-water-strip-fill { height: 100%; background: linear-gradient(90deg, #42A5F5, var(--water-blue)); transition: width 0.7s cubic-bezier(0.34, 1.2, 0.64, 1); }
  .dbb-water-strip-fill.celebrating { animation: goal-pulse 1.2s ease-out; }

  /* Water row in expanded panel */
  .dbb-water-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 16px 2px;
  }
  .dbb-water-icon { color: var(--water-blue); font-size: 16px; flex-shrink: 0; }
  .dbb-water-track { flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .dbb-water-bar { height: 4px; background: var(--surface-3); border-radius: var(--radius-full); overflow: hidden; }
  .dbb-water-fill { height: 100%; background: var(--water-blue); border-radius: var(--radius-full); transition: width 0.4s ease; }
  .dbb-water-text { font-size: 11px; color: var(--text-3); }
  .dbb-water-pct  { font-size: 11px; font-weight: 600; color: var(--water-blue); flex-shrink: 0; min-width: 36px; text-align: right; }

  /* Water quick-add sheet */
  .wqa-body     { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .wqa-progress { display: flex; flex-direction: column; gap: 6px; }
  .wqa-progress-bar  { height: 6px; background: var(--surface-3); border-radius: var(--radius-full); overflow: hidden; }
  .wqa-progress-fill { height: 100%; background: var(--water-blue); border-radius: var(--radius-full); transition: width 0.4s ease; }
  .wqa-stats    { text-align: center; }
  .wqa-grid     { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .wqa-btn      {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 14px 10px; border-radius: var(--radius-md);
    background: var(--surface-2); border: 1px solid var(--border);
    cursor: pointer; transition: background var(--dur-fast), border-color var(--dur-fast);
  }
  .wqa-btn:hover  { background: var(--accent-dim); border-color: var(--accent); }
  .wqa-btn:active { transform: scale(0.95); }
  .wqa-name { font-size: 13px; font-weight: 600; color: var(--text-1); text-align: center; }
  .wqa-vol  { font-size: 12px; text-align: center; }


  .meal-group { overflow: visible; border-left: 3px solid var(--meal-color, var(--accent)); }
  .meal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border);
  }
  .meal-type-icon {
    font-size: 18px;
    color: var(--meal-color, var(--accent));
    flex-shrink: 0;
    opacity: 0.9;
  }
  .meal-name   { font-size: 15px; font-weight: 600; color: var(--text-1); }
  .meal-kcal   { margin-left: 4px; }
  .ml-auto     { margin-left: auto; }
  .meal-empty  {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 16px;
  }
  .meal-empty-icon { font-size: 20px; opacity: 0.5; flex-shrink: 0; }
  .meal-empty-text { font-size: 13px; color: var(--text-3); }

  .meal-add-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 9px 14px;
    border-top: 1.5px dashed var(--border);
    color: var(--text-3);
    font-size: 13px;
    font-weight: 500;
    background: none;
    cursor: pointer;
    transition: color var(--dur-fast), background var(--dur-fast);
  }
  .meal-add-row .material-symbols-rounded { font-size: 17px; }
  .meal-add-row:hover { color: var(--meal-color, var(--accent)); background: var(--accent-dim); }

  .meal-items { display: flex; flex-direction: column; }
  .diary-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    transition: background var(--dur-fast);
  }
  .diary-item:last-child { border-bottom: none; }
  .diary-item:active { background: var(--surface-2); }
  .item-thumb {
    width: 40px; height: 40px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--surface-2);
  }
  .item-info  { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .item-name  { font-size: 14px; font-weight: 500; }
  .item-meta  { }
  .btn-sm     { width: 32px; height: 32px; }


  .diary-item-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    padding: 0;
    color: var(--text-1);
  }
  .item-thumb-placeholder {
    width: 40px; height: 40px;
    border-radius: var(--radius-sm);
    background: var(--accent-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .edit-sheet-body { padding: 16px; }
  .edit-macros { display: flex; gap: 8px; flex-wrap: wrap; }
  .edit-macro-pill {
    flex: 1;
    min-width: 60px;
    background: var(--surface-2);
    border-radius: var(--radius-md);
    padding: 8px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .edit-macro-val   { font-size: 15px; font-weight: 700; color: var(--text-1); }
  .edit-macro-label { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: .4px; }

  /* Sheet backdrop */
  .sheet-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: flex-end;
  }
  .sheet-handle { width: 36px; height: 4px; background: var(--border); border-radius: 2px; margin: 10px auto 0; }
  .sheet-header-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px 4px; }
  .sheet-title { font-size: 17px; font-weight: 700; }

  /* Body stats sheet */
  .bs-sheet {
    background: var(--surface-1);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    width: 100%; max-width: 600px; margin: 0 auto;
    padding-bottom: var(--safe-bottom);
  }
  .bs-sheet-body  { padding: 8px 20px 0; display: flex; flex-direction: column; gap: 12px; }
  .bs-sheet-footer { padding: 16px 20px; }
  .bs-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 4px 0;
  }
  .form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  /* Nutrition summary sheet */
  .ns-sheet {
    background: var(--surface-1);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    width: 100%; max-width: 600px; margin: 0 auto;
    max-height: 85dvh; display: flex; flex-direction: column;
    padding-bottom: var(--safe-bottom);
  }
  .ns-body { flex: 1; overflow-y: auto; padding: 0 16px 16px; }
  .ns-ring-wrap { padding: 8px 0 4px; }
  .ns-macros { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
  .ns-macro-pill {
    border-radius: var(--radius-md); padding: 10px 4px;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
  }
  .ns-macro-val { font-size: 18px; font-weight: 700; }
  .ns-macro-lbl { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
  .ns-rows { display: flex; flex-direction: column; gap: 6px; }
  .ns-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
  .ns-row:last-child { border-bottom: none; }

  /* Meal macro footer */
  .meal-macro-footer { padding: 8px 16px 10px; border-top: 1px solid var(--border); }
  .meal-macro-bar {
    height: 8px; border-radius: 4px;
    background: var(--surface-3); overflow: hidden;
    display: flex; margin-bottom: 6px;
  }
  .mmb-p { background: linear-gradient(90deg, #BA68C8, var(--macro-protein)); }
  .mmb-c { background: linear-gradient(90deg, #00E676, var(--macro-carbs)); }
  .mmb-f { background: linear-gradient(90deg, var(--macro-fat), #E65100); }
  .meal-macro-text { display: block; }

  /* Nutrition bar (inside bottom bar) */
  .dbb-nutrient-bars { padding: 0 12px 4px; display: flex; flex-direction: column; gap: 6px; }
  .nb-row { display: flex; align-items: center; gap: 8px; }
  .nb-label { font-size: 12px; color: var(--text-3); width: 60px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nb-bar { flex: 1; height: 6px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
  .nb-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width var(--dur-base); }
  .nb-fill.over { background: var(--red, #f44336); }
  .nb-val { font-size: 12px; font-weight: 600; color: var(--text-2); width: 60px; text-align: right; flex-shrink: 0; }
  .nb-val.over { color: var(--red, #f44336); }

  /* ── Persistent bottom nutrition bar ─────────────────────────── */
  .diary-bottom-bar {
    position: fixed;
    left: 0; right: 0;
    z-index: 90;
    background: var(--glass-surface);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border-top: 1px solid var(--border);
    box-shadow: 0 -4px 16px rgba(0,0,0,0.12);
  }
  .dbb-progress {
    height: 8px;
    background: var(--surface-3);
    overflow: hidden;
    cursor: pointer;
  }
  @keyframes goal-pulse {
    0%   { filter: brightness(1); }
    30%  { filter: brightness(1.6) saturate(1.4); box-shadow: 0 0 12px currentColor; }
    70%  { filter: brightness(1.3); }
    100% { filter: brightness(1); }
  }
  .dbb-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--macro-calories), #FF8F00);
    transition: width 0.7s cubic-bezier(0.34, 1.2, 0.64, 1);
  }
  .dbb-progress-fill.celebrating {
    animation: goal-pulse 1.2s ease-out;
  }
  /* Colored macro proportion bar (standalone — not inside button so title tooltips work) */
  .dbb-macro-bar {
    height: 8px;
    background: var(--surface-3);
    display: flex;
    overflow: hidden;
    cursor: pointer;
  }
  .dbb-mb-p { background: linear-gradient(90deg, #BA68C8, var(--macro-protein)); transition: width 0.7s cubic-bezier(0.34, 1.2, 0.64, 1); }
  .dbb-mb-c { background: linear-gradient(90deg, #00E676, var(--macro-carbs)); transition: width 0.7s cubic-bezier(0.34, 1.2, 0.64, 1); }
  .dbb-mb-f { background: linear-gradient(90deg, var(--macro-fat), #E65100); transition: width 0.7s cubic-bezier(0.34, 1.2, 0.64, 1); }
  /* Text summary row button */
  .dbb-summary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 14px 7px;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-1);
    text-align: left;
    -webkit-tap-highlight-color: transparent;
  }
  .dbb-summary-row:active { background: var(--surface-2); }
  .dbb-summary-text {
    font-size: 13px;
    color: var(--text-2);
    font-weight: 500;
  }
  .dbb-chevron {
    font-size: 18px;
    color: var(--text-3);
    flex-shrink: 0;
  }
  .dbb-kcal {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 80px;
    flex-shrink: 0;
  }
  .dbb-num  { font-size: 20px; font-weight: 800; line-height: 1.1; color: var(--macro-calories); }
  .dbb-unit { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
  .dbb-macros {
    display: flex;
    flex: 1;
    gap: 12px;
    justify-content: flex-end;
  }
  .dbb-macro {
    display: flex;
    align-items: baseline;
    gap: 2px;
    font-size: 15px;
    font-weight: 700;
  }
  .dbb-mlabel { font-size: 10px; font-weight: 400; color: var(--text-3); margin-left: 1px; }

  /* Expanded panel */
  .dbb-panel {
    border-top: 1px solid var(--border);
    overflow: hidden;
  }
  .dbb-toggle-row {
    display: flex;
    justify-content: center;
    padding: 10px 14px 6px;
  }
  .dbb-toggle-pill {
    display: flex;
    background: var(--surface-2);
    border: none;
    border-radius: var(--radius-full);
    padding: 3px;
    cursor: pointer;
    gap: 2px;
    -webkit-tap-highlight-color: transparent;
  }
  .dbb-tp-opt {
    padding: 6px 18px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-3);
    border-radius: var(--radius-full);
    transition: background var(--dur-fast), color var(--dur-fast);
    user-select: none;
  }
  .dbb-tp-active {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .dbb-detail-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 14px 10px;
  }

</style>
