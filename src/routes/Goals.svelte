<script>
  import { onMount } from 'svelte';
  import { DB } from '../lib/db.js';
  import { portal } from '../lib/portal.js';
  import { goals, energyUnit, weightUnit, heightUnit, lengthUnit, visibleNutriments, hiddenBodyStats } from '../stores/settings.js';
  import { NUTRIMENTS, Nutrition } from '../lib/nutrition.js';
  import { loadEntry } from '../stores/diary.js';
  import { showSuccess } from '../stores/toast.js';

  const BODY_STATS = [
    { id: 'weight',   label: 'Weight',   isBody: true },
    { id: 'neck',     label: 'Neck',     isBody: true },
    { id: 'waist',    label: 'Waist',    isBody: true },
    { id: 'hips',     label: 'Hips',     isBody: true },
    { id: 'chest',    label: 'Chest',    isBody: true },
    { id: 'thighs',   label: 'Thighs',   isBody: true },
    { id: 'biceps',   label: 'Biceps',   isBody: true },
    { id: 'calves',   label: 'Calves',   isBody: true },
    { id: 'body_fat', label: 'Body Fat', isBody: true, unit: '%' },
  ];

  $: wUnit = $weightUnit || 'kg';
  $: hUnit = $heightUnit || 'cm';
  $: lUnit = $lengthUnit || 'in';
  $: bodyStatsWithUnit = BODY_STATS.map(s => ({
    ...s,
    unit: s.unit || (s.id === 'weight' ? wUnit : lUnit)
  }));

  // All nutrients filtered only by energy unit — used in Goals so you can set
  // goals for any nutrient regardless of diary visibility settings
  $: allNutrients = NUTRIMENTS.filter(n => {
    if (n.id === 'kilojoules' && ($energyUnit||'kcal') === 'kcal') return false;
    if (n.id === 'calories'   && ($energyUnit||'kcal') === 'kJ') return false;
    return true;
  });

  // All fields for goal-setting: all body stats + all nutrients
  $: allFields = [...bodyStatsWithUnit, ...allNutrients];
  // Your Goals: every stat that has a goal configured (regardless of visibility)
  $: configuredStats = allFields.filter(s => $goals[s.id]);

  let activeTab = 'yours'; // 'yours' | 'all'
  let today = new Date().toISOString().slice(0,10);
  let todayTotals = {};
  let todayBodyStats = {};

  onMount(async () => {
    const entry = await DB.getDiaryForDate(today);
    if (entry) {
      todayBodyStats = entry.bodyStats || {};
      todayTotals = Nutrition.sum((entry.items || []).map(i => Nutrition.calculate(i)));
    }
  });

  // ── Edit state ────────────────────────────────────────────────────────────
  let editOpen = false;
  let editStat = null;
  let editShared = true;
  let editIsMin = false;
  let editVal0 = '';
  let editDayVals = ['','','','','','',''];
  let editShowDiary  = true;
  let editShowStats  = true;
  let editIsPercent  = false;
  let editAutoAdjust = false;

  let _gLock = false;
  let _gLockTimer;
  function openEdit(stat) {
    editStat = stat;
    const g = $goals[stat.id];
    if (g) {
      editShared  = g.sharedGoal !== false;
      editIsMin   = g.isMin || false;
      editShowDiary  = g.showInDiary  !== false;
      editShowStats  = g.showInStats  !== false;
      editIsPercent  = g.isPercent    || false;
      editAutoAdjust = g.autoAdjust   || false;
      if (editShared) {
        editVal0 = String(g.max ?? g.min ?? '');
      } else {
        editDayVals = g.days ? [...g.days] : ['','','','','','',''];
        editVal0 = String(editDayVals[0]);
      }
    } else {
      editShared  = true; editIsMin = false;
      editVal0 = ''; editDayVals = ['','','','','','',''];
      editShowDiary = true; editShowStats = true;
      editIsPercent = false; editAutoAdjust = false;
    }
    clearTimeout(_gLockTimer);
    _gLock = true;
    editOpen = true;
    _gLockTimer = setTimeout(() => _gLock = false, 400);
  }

  function saveGoal() {
    if (!editStat) return;
    const val = parseFloat(editVal0) || null;
    const dayArr = editShared
      ? Array(7).fill(val)
      : editDayVals.map(v => parseFloat(v) || null);

    const validDays = dayArr.filter(v => v != null && v > 0);
    const peakVal = validDays.length ? Math.max(...validDays) : null;

    const entry = {
      sharedGoal:  editShared,
      isMin:       editIsMin,
      isPercent:   editIsPercent,
      autoAdjust:  editAutoAdjust,
      showInDiary: editShowDiary,
      showInStats: editShowStats,
      days: dayArr
    };
    if (editIsMin) entry.min = editShared ? val : peakVal;
    else           entry.max = editShared ? val : peakVal;

    goals.update(g => ({ ...g, [editStat.id]: entry }));
    editOpen = false;
    showSuccess('Goal saved');
  }

  function deleteGoal() {
    if (!editStat) return;
    goals.update(g => { const n = {...g}; delete n[editStat.id]; return n; });
    editOpen = false;
  }

  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const MACRO_DENSITY = { fat: 9, 'saturated-fat': 9, carbohydrates: 4, sugars: 4, proteins: 4 };
  function isPercentEligible(stat) {
    return stat && (stat.id in MACRO_DENSITY);
  }

  function getTodayValue(stat) {
    if (stat.isBody) return todayBodyStats[stat.id] ?? null;
    return todayTotals[stat.id] ?? null;
  }

  function getTarget(stat) {
    const g = $goals[stat.id];
    if (!g) return null;
    let raw;
    if (g.sharedGoal !== false) {
      raw = g.max ?? g.min ?? null;
    } else {
      const d = new Date().getDay();
      raw = (g.days && g.days[d] != null) ? g.days[d] : (g.max ?? g.min ?? null);
    }
    if (raw == null || !g.isPercent) return raw;
    const density = MACRO_DENSITY[stat.id];
    if (!density) return raw;
    const calGoal = $goals.calories?.max ?? $goals.calories?.min ?? 2000;
    return Math.round(calGoal * raw / 100 / density);
  }

  function getPct(stat) {
    const cur = getTodayValue(stat);
    const tgt = getTarget(stat);
    if (cur == null || tgt == null || tgt === 0) return 0;
    return Math.min(100, Math.round(cur / tgt * 100));
  }
</script>

<div class="page-shell">
  <header class="page-header">
    <h1>Goals</h1>
  </header>

  <!-- Tabs -->
  <div class="tab-bar">
    <button class="tab-btn" class:active={activeTab==='yours'} on:click={() => activeTab='yours'}>
      Your Goals
    </button>
    <button class="tab-btn" class:active={activeTab==='all'} on:click={() => activeTab='all'}>
      All Fields
    </button>
  </div>

  <div class="page-content">

    <!-- ── Your Goals tab ── -->
    {#if activeTab === 'yours'}
      {#if configuredStats.length === 0}
        <div class="empty-state">
          <span class="material-symbols-rounded" style="font-size:48px;opacity:0.2">flag</span>
          <p>No goals set yet.</p>
          <p class="text-3 text-sm">Go to <strong>All Fields</strong> tab to add goals.</p>
        </div>
      {:else}
        <div class="card">
          {#each configuredStats as stat, i}
            {#if i > 0}<div class="divider"></div>{/if}
            <button class="goal-row" on:click={() => openEdit(stat)}>
              <div class="goal-info">
                <span class="font-medium">{stat.label}</span>
                {#if getTarget(stat) != null}
                  {@const pct = getPct(stat)}
                  {@const tgt = getTarget(stat)}
                  {@const cur = getTodayValue(stat)}
                  {@const isMin = $goals[stat.id]?.isMin}
                  {@const bad = cur != null && tgt != null && (isMin ? cur < tgt : cur > tgt)}
                  <div class="goal-progress-bar">
                    <div class="goal-progress-fill"
                      class:over={bad}
                      style="width:{pct}%"></div>
                  </div>
                  <span class="text-3 text-sm">
                    {cur != null ? Math.round(cur*10)/10 : '—'} / {tgt} {stat.unit || ''}
                    {#if isMin}<span style="opacity:0.6">(min)</span>{/if}
                  </span>
                {:else}
                  <span class="text-3 text-sm">Not set</span>
                {/if}
              </div>
              <span class="material-symbols-rounded text-3" style="font-size:18px">chevron_right</span>
            </button>
          {/each}
        </div>
      {/if}

    <!-- ── All Fields tab ── -->
    {:else}
      <p class="text-3 text-sm" style="padding:0 var(--page-px) 8px">Tap any field to set or edit its goal.</p>

      <!-- Body Stats -->
      <p class="section-title">Body Stats</p>
      <div class="card">
        {#each bodyStatsWithUnit as stat, i}
          {#if i > 0}<div class="divider"></div>{/if}
          <button class="goal-row" on:click={() => openEdit(stat)}>
            <div class="goal-info">
              <span class="font-medium">{stat.label}</span>
              {#if $goals[stat.id]}
                {@const pct = getPct(stat)}
                {@const tgt = getTarget(stat)}
                {@const cur = getTodayValue(stat)}
                <div class="goal-progress-bar">
                  <div class="goal-progress-fill" style="width:{pct}%"></div>
                </div>
                <span class="text-3 text-sm">{cur != null ? Math.round(cur*10)/10 : '—'} / {tgt} {stat.unit}</span>
              {:else}
                <span class="text-3 text-sm" style="opacity:0.4">No goal</span>
              {/if}
            </div>
            <span class="material-symbols-rounded text-3" style="font-size:18px">chevron_right</span>
          </button>
        {/each}
      </div>

      <!-- Nutrients -->
      <p class="section-title">Nutrients</p>
      <div class="card">
        {#each allNutrients as stat, i}
          {#if i > 0}<div class="divider"></div>{/if}
          <button class="goal-row" on:click={() => openEdit(stat)}>
            <div class="goal-info">
              <span class="font-medium">{stat.label}</span>
              {#if $goals[stat.id]}
                {@const pct = getPct(stat)}
                {@const tgt = getTarget(stat)}
                {@const cur = getTodayValue(stat)}
                <div class="goal-progress-bar">
                  <div class="goal-progress-fill" style="width:{pct}%"></div>
                </div>
                <span class="text-3 text-sm">{cur != null ? Math.round(cur*10)/10 : '—'} / {tgt} {stat.unit}</span>
              {:else}
                <span class="text-3 text-sm" style="opacity:0.4">No goal</span>
              {/if}
            </div>
            <span class="material-symbols-rounded text-3" style="font-size:18px">chevron_right</span>
          </button>
        {/each}
      </div>
    {/if}

    <div style="height:24px"></div>
  </div>
</div>

<!-- ── Goal editor sheet ── -->
{#if editOpen && editStat}
  <div use:portal class="sheet-backdrop" role="dialog" aria-modal="true"
    on:click={() => { if (!_gLock) editOpen = false; }} on:keydown={() => {}}>
    <div class="sheet-panel" on:click|stopPropagation on:keydown={() => {}}>
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <h3 class="sheet-title">{editStat.label} {editStat.unit ? '('+editStat.unit+')' : ''}</h3>
      </div>
      <div class="sheet-body">

        <!-- Options -->
        <div class="toggle-row">
          <label class="toggle-label">Show in Diary</label>
          <label class="toggle-switch">
            <input type="checkbox" bind:checked={editShowDiary} />
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="toggle-row">
          <label class="toggle-label">Show in Statistics</label>
          <label class="toggle-switch">
            <input type="checkbox" bind:checked={editShowStats} />
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="toggle-row">
          <label class="toggle-label">Same goal every day</label>
          <label class="toggle-switch">
            <input type="checkbox" bind:checked={editShared} />
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="toggle-row">
          <label class="toggle-label">Minimum goal (must reach target)</label>
          <label class="toggle-switch">
            <input type="checkbox" bind:checked={editIsMin} />
            <span class="toggle-track"></span>
          </label>
        </div>
        {#if isPercentEligible(editStat)}
        <div class="toggle-row">
          <label class="toggle-label">Goal as % of calories</label>
          <label class="toggle-switch">
            <input type="checkbox" bind:checked={editIsPercent} />
            <span class="toggle-track"></span>
          </label>
        </div>
        {/if}
        <div class="toggle-row">
          <label class="toggle-label">Auto-adjust to activity</label>
          <label class="toggle-switch">
            <input type="checkbox" bind:checked={editAutoAdjust} />
            <span class="toggle-track"></span>
          </label>
        </div>

        <div class="divider" style="margin:8px 0"></div>

        <!-- Goal value(s) -->
        {#if editShared}
          <label class="form-label">Target ({editIsPercent ? '% of calories' : (editStat.unit || '')})</label>
          <input class="input" type="number" min="0" step="any"
            placeholder="0" bind:value={editVal0} />
        {:else}
          {#each DAYS as day, i}
            <label class="form-label">{day} ({editIsPercent ? '% of calories' : (editStat.unit || '')})</label>
            <input class="input" type="number" min="0" step="any"
              placeholder="0" bind:value={editDayVals[i]} style="margin-bottom:8px" />
          {/each}
        {/if}
      </div>
      <div class="sheet-footer">
        {#if $goals[editStat?.id]}
          <button class="btn btn-danger w-full" style="margin-bottom:8px" on:click={deleteGoal}>
            Remove Goal
          </button>
        {/if}
        <button class="btn btn-primary w-full" on:click={saveGoal}>Save Goal</button>
      </div>
    </div>
  </div>
{/if}

<style>

  .tab-bar {
    display: flex; border-bottom: 1px solid var(--border);
    margin-top: 12px;
  }
  .tab-btn {
    flex: 1; padding: 10px 0; font-size: 14px; font-weight: 600;
    background: none; border: none; cursor: pointer;
    color: var(--text-3); border-bottom: 2px solid transparent;
    transition: color var(--dur-fast), border-color var(--dur-fast);
  }
  .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }

  .card { border-left: 3px solid var(--accent); }

  .goal-row {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; width: 100%;
    background: none; border: none; cursor: pointer;
    text-align: left; color: var(--text-1);
    transition: background var(--dur-fast);
  }
  .goal-row:active { background: var(--surface-2); }
  .goal-row .material-symbols-rounded { color: var(--accent); }
  .goal-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .divider { height: 1px; background: var(--border); margin: 0 16px; }

  .empty-state .material-symbols-rounded { color: var(--accent); opacity: 0.5; }

  .goal-progress-bar {
    height: 4px; background: var(--surface-3); border-radius: 2px;
    overflow: hidden; max-width: 200px;
  }
  .goal-progress-fill {
    height: 100%; background: var(--accent);
    border-radius: 2px;
    transition: width var(--dur-base) var(--ease-inout);
  }
  .goal-progress-fill.over { background: var(--red, #f44336); }

  .empty-state {
    display: flex; flex-direction: column; align-items: center;
    gap: 8px; padding: 48px 16px; text-align: center;
  }

  /* Sheet */
  .sheet-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: flex-end;
  }
  .sheet-panel {
    background: var(--surface-1);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    width: 100%; max-width: 600px; margin: 0 auto;
    max-height: 90dvh; display: flex; flex-direction: column;
    padding-bottom: var(--safe-bottom);
  }
  .sheet-handle {
    width: 36px; height: 4px; background: var(--border);
    border-radius: 2px; margin: 10px auto 0;
  }
  .sheet-header { padding: 12px 20px 4px; }
  .sheet-title  { font-size: 16px; font-weight: 700; }
  .sheet-body   { flex: 1; overflow-y: auto; padding: 8px 20px 0; display: flex; flex-direction: column; gap: 8px; }
  .sheet-footer { padding: 16px 20px; }

  /* Toggle rows */
  .toggle-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 0;
  }
  .toggle-label { font-size: 14px; }
  .toggle-switch { position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer; }
  .toggle-switch input { opacity: 0; width: 0; height: 0; }
  .toggle-track {
    position: absolute; inset: 0;
    background: var(--surface-3); border-radius: 12px;
    transition: background var(--dur-fast);
  }
  .toggle-track::after {
    content: ''; position: absolute;
    top: 3px; left: 3px;
    width: 18px; height: 18px;
    border-radius: 50%; background: white;
    transition: transform var(--dur-fast);
  }
  .toggle-switch input:checked ~ .toggle-track { background: var(--accent); }
  .toggle-switch input:checked ~ .toggle-track::after { transform: translateX(20px); }
</style>
