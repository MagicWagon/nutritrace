<script>
  import { onMount } from 'svelte';
  import { slide, fade } from 'svelte/transition';
  import { DB, localDateStr } from '../lib/db.js';
  import { NtApi } from '../lib/api.js';
  import { showSuccess, showError } from '../stores/toast.js';
  import { pageBanners } from '../stores/settings.js';
  import WaterBanner from '../components/banners/WaterBanner.svelte';

  const today = localDateStr();

  // ── Settings ───────────────────────────────────────────────────────────────
  let goalMl     = DB.getSetting('waterGoalMl',     2000);
  let unit       = DB.getSetting('waterUnit',       'ml');
  let containers = DB.getSetting('waterContainers', [
    { id: '1', name: 'Small Bottle',     volumeMl: 250  },
    { id: '2', name: 'Standard Bottle', volumeMl: 500  },
    { id: '3', name: 'Large Bottle',    volumeMl: 1000 },
    { id: '4', name: 'Gallon Jug',       volumeMl: 3785 },
  ]);

  // ── State ──────────────────────────────────────────────────────────────────
  let logs     = [];   // [{ amount: number, time: string }]
  let customAmt = '';
  let showCustom = false;

  $: total      = logs.reduce((s, l) => s + l.amount, 0);
  $: rawPct     = goalMl > 0 ? Math.round(total / goalMl * 100) : 0;
  $: pct        = Math.min(100, rawPct);
  $: overflowing = rawPct >= 100;

  // SVG bottle fill geometry
  // Fillable interior: y=50 (just below neck) to y=182 (bottle bottom) = 132 units
  const FILL_TOP    = 50;
  const FILL_BOTTOM = 182;
  const FILL_H      = FILL_BOTTOM - FILL_TOP;   // 132
  $: fillY = FILL_BOTTOM - (pct / 100) * FILL_H;  // y where water surface sits

  function display(ml) {
    if (unit === 'oz') return (ml / 29.5735).toFixed(0)  + ' fl oz';
    if (unit === 'L')  return (ml / 1000).toFixed(2)     + ' L';
    if (unit === 'G')  return (ml / 3785.41).toFixed(3)  + ' G';
    return ml + ' ml';
  }
  function displayGoal() {
    if (unit === 'oz') return Math.round(goalMl / 29.5735)    + ' fl oz';
    if (unit === 'L')  return (goalMl / 1000).toFixed(1)      + ' L';
    if (unit === 'G')  return (goalMl / 3785.41).toFixed(2)   + ' G';
    return goalMl + ' ml';
  }
  function contDisplay(cont) { return display(cont.volumeMl); }

  onMount(loadWater);

  async function loadWater() {
    const entry = await NtApi.getDiaryDate(today).catch(() => null);
    logs = entry?.water || [];
    goalMl     = DB.getSetting('waterGoalMl',     2000);
    unit       = DB.getSetting('waterUnit',       'ml');
    containers = DB.getSetting('waterContainers', containers);
  }

  async function addWater(amount) {
    const ml = Number(amount);
    if (!ml || ml <= 0) { showError('Invalid amount'); return; }

    const entry = await NtApi.getDiaryDate(today).catch(() => null) || { items: [], body_stats: {}, water: [] };
    const log   = {
      amount: ml,
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    };
    const water = [...(entry.water || []), log];
    await NtApi.saveDiaryDate(today, { items: entry.items || [], body_stats: entry.body_stats || entry.bodyStats || {}, water });
    logs = water;
    showCustom = false;
    customAmt  = '';
  }

  async function removeLog(index) {
    const entry = await NtApi.getDiaryDate(today).catch(() => null);
    if (!entry) return;
    const water = (entry.water || []).filter((_, i) => i !== index);
    await NtApi.saveDiaryDate(today, { items: entry.items || [], body_stats: entry.body_stats || entry.bodyStats || {}, water });
    logs = water;
  }

  function onCustomKey(e) {
    if (e.key === 'Enter') addWater(customAmt);
  }
</script>

<div class="page-shell">
  <header class="page-header" class:has-banner={$pageBanners}>
    {#if $pageBanners}<WaterBanner />{/if}
    <h1>Water</h1>
  </header>

  <div class="water-content">

    <!-- ── Bottle + stats ─────────────────────────────────────────────────── -->
    <div class="bottle-section">

      <!-- SVG Animated Water Bottle -->
      <div class="bottle-wrap" class:overflowing>
        <svg
          class="bottle-svg"
          class:overflowing
          viewBox="0 0 120 200"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Water bottle, {rawPct}% full"
        >
          <defs>
            <!-- Bottle interior clip (excludes cap) -->
            <clipPath id="wc-clip">
              <path d="M 46 16 L 46 38 C 32 44 22 56 22 68 L 22 168 Q 22 184 37 184 L 83 184 Q 98 184 98 168 L 98 68 C 98 56 88 44 74 38 L 74 16 Z" />
            </clipPath>
          </defs>

          <!-- Bottle body — empty/background -->
          <path
            d="M 46 16 L 46 38 C 32 44 22 56 22 68 L 22 168 Q 22 184 37 184 L 83 184 Q 98 184 98 168 L 98 68 C 98 56 88 44 74 38 L 74 16 Z"
            class="bottle-bg"
          />

          <!-- Water fill (clipped) -->
          {#if pct > 0}
            <g clip-path="url(#wc-clip)">
              <!-- Solid water body below wave -->
              <rect
                x="-5" y={fillY + 10}
                width="130" height={FILL_BOTTOM - fillY + 10}
                class="water-body"
              />
              <!-- Animated wave at water surface -->
              <g transform="translate(0, {fillY})">
                <path
                  class="water-wave"
                  d="M -120,10 C -90,2 -60,18 -30,10 C 0,2 30,18 60,10 C 90,2 120,18 150,10 C 180,2 210,18 240,10 L 240,30 L -120,30 Z"
                />
              </g>
            </g>
          {/if}

          <!-- Bottle outline (rendered on top so fill stays inside) -->
          <path
            d="M 46 16 L 46 38 C 32 44 22 56 22 68 L 22 168 Q 22 184 37 184 L 83 184 Q 98 184 98 168 L 98 68 C 98 56 88 44 74 38 L 74 16 Z"
            class="bottle-outline"
            class:full={pct >= 100}
          />

          <!-- Cap -->
          <rect x="44" y="2" width="32" height="16" rx="5" class="bottle-cap" />

          <!-- Cap highlight line -->
          <line x1="44" y1="16" x2="76" y2="16" class="cap-line" />

          <!-- ── Overflow animation (goal met/exceeded) ─────────────────── -->
          {#if overflowing}
            <!-- Water pooling on top of cap -->
            <ellipse class="overflow-spill" cx="60" cy="5" rx="19" ry="4" />
            <!-- Drips escaping from left side of cap, falling outward -->
            <circle class="overflow-drip drip-1" cx="43" cy="14" r="3" />
            <circle class="overflow-drip drip-2" cx="42" cy="13" r="2.5" />
            <!-- Drips escaping from right side of cap, falling outward -->
            <circle class="overflow-drip drip-3" cx="77" cy="14" r="3" />
            <circle class="overflow-drip drip-4" cx="78" cy="13" r="2.5" />
          {/if}
        </svg>
      </div>

      <!-- Stats -->
      <div class="water-stats">
        <div class="water-amount">
          <span class="water-current">{display(total)}</span>
          <span class="water-sep">/</span>
          <span class="water-goal">{displayGoal()}</span>
        </div>
        <div class="water-pct" class:goal-met={overflowing}>
          {rawPct}%{overflowing ? ' 🎉' : ''}
        </div>

        <!-- Progress bar -->
        <div class="water-progress-bar">
          <div class="water-progress-fill" style="width: {pct}%"></div>
        </div>
      </div>
    </div>

    <!-- ── Quick-add containers ────────────────────────────────────────────── -->
    <div class="quick-add-section">
      <p class="section-title" style="padding: var(--space-4) 0 var(--space-2)">Quick Add</p>
      <div class="preset-grid">
        {#if containers.length > 0}
          {#each containers as cont (cont.id)}
            <button class="preset-btn" on:click={() => addWater(cont.volumeMl)}>
              <span class="material-symbols-rounded">water_drop</span>
              <span class="preset-name">{cont.name}</span>
              <span class="preset-vol">{contDisplay(cont)}</span>
            </button>
          {/each}
        {:else}
          {#each [250, 500, 1000] as ml}
            <button class="preset-btn" on:click={() => addWater(ml)}>
              <span class="material-symbols-rounded">add</span>
              {display(ml)}
            </button>
          {/each}
        {/if}
        <button class="preset-btn preset-custom" on:click={() => showCustom = !showCustom}>
          <span class="material-symbols-rounded">edit</span>
          Custom
        </button>
      </div>

      {#if showCustom}
        <div class="custom-row" transition:slide={{ duration: 160 }}>
          <input
            class="input custom-input"
            type="number"
            min="1"
            step="1"
            placeholder="Amount (ml)"
            bind:value={customAmt}
            on:keydown={onCustomKey}
          />
          <button class="btn btn-primary" on:click={() => addWater(customAmt)}>Add</button>
        </div>
      {/if}
    </div>

    <!-- ── Today's log ────────────────────────────────────────────────────── -->
    {#if logs.length > 0}
      <p class="section-title">Today's Log</p>
      <div class="card log-card">
        {#each logs as log, i}
          {#if i > 0}<div class="divider"></div>{/if}
          <div class="log-row">
            <span class="material-symbols-rounded log-icon">water_drop</span>
            <div class="log-info">
              <span class="font-medium">{display(log.amount)}</span>
              {#if log.time}
                <span class="text-3 text-sm">{log.time}</span>
              {/if}
            </div>
            <button class="btn-icon" on:click={() => removeLog(i)} title="Remove">
              <span class="material-symbols-rounded" style="font-size:18px;color:var(--text-3)">delete</span>
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-log">
        <span class="material-symbols-rounded" style="font-size:36px;color:var(--accent);opacity:0.4">water_drop</span>
        <p class="text-3 text-sm">No water logged yet today</p>
      </div>
    {/if}

    <div style="height: 24px"></div>
  </div>
</div>

<style>
  .water-content {
    padding: 12px var(--page-px) 0;
  }

  /* ── Bottle section ─────────────────────────────────────────────────────── */
  .bottle-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 8px 0 4px;
  }

  .bottle-wrap {
    width: 140px;
    height: auto;
    filter: drop-shadow(0 8px 24px rgba(0,0,0,0.3));
  }

  .bottle-svg {
    width: 100%;
    height: auto;
    overflow: visible;
  }

  /* SVG elements */
  .bottle-bg {
    fill: var(--surface-3);
  }
  .bottle-outline {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 2;
    transition: stroke 0.4s ease;
  }
  .bottle-outline.full {
    stroke: var(--accent);
    filter: drop-shadow(0 0 4px var(--accent));
  }
  .bottle-cap {
    fill: var(--accent);
  }
  .cap-line {
    stroke: var(--border-strong);
    stroke-width: 1;
  }
  .water-body {
    fill: var(--accent);
    opacity: 0.55;
    transition: y 0.6s ease, height 0.6s ease;
  }
  .water-wave {
    fill: var(--accent);
    opacity: 0.75;
    animation: wave-flow 1.8s linear infinite;
  }

  @keyframes wave-flow {
    from { transform: translateX(0px);    }
    to   { transform: translateX(-120px); }
  }

  /* ── Overflow state (goal met/exceeded) ──────────────────────────────────── */

  /* Pulsing glow on the bottle wrap */
  .bottle-wrap.overflowing {
    animation: overflow-glow 1.8s ease-in-out infinite;
  }
  @keyframes overflow-glow {
    0%, 100% { filter: drop-shadow(0 8px 24px rgba(0,0,0,0.3)); }
    50%       { filter: drop-shadow(0 0 22px rgba(79,255,176,0.55)) drop-shadow(0 8px 24px rgba(0,0,0,0.2)); }
  }

  /* Speed up the wave when overflowing */
  .bottle-svg.overflowing .water-wave {
    animation-duration: 0.65s;
  }

  /* Water pooling on top of cap */
  .overflow-spill {
    fill: var(--accent);
    animation: spill-pulse 1.6s ease-in-out infinite;
  }
  @keyframes spill-pulse {
    0%, 100% { opacity: 0.35; }
    50%       { opacity: 0.65; }
  }

  /* Animated drip drops from cap sides */
  .overflow-drip {
    fill: var(--accent);
  }
  /* Left drips fall left and down */
  .drip-1 { animation: drip-fall-l 1.4s ease-in 0s    infinite; }
  .drip-2 { animation: drip-fall-l 1.4s ease-in 0.7s  infinite; }
  /* Right drips fall right and down */
  .drip-3 { animation: drip-fall-r 1.4s ease-in 0.35s infinite; }
  .drip-4 { animation: drip-fall-r 1.4s ease-in 1.05s infinite; }

  @keyframes drip-fall-l {
    0%   { transform: translate(0px,   0px);   opacity: 0;    }
    8%   { opacity: 0.85; }
    100% { transform: translate(-10px, 34px);  opacity: 0;    }
  }
  @keyframes drip-fall-r {
    0%   { transform: translate(0px,  0px);    opacity: 0;    }
    8%   { opacity: 0.85; }
    100% { transform: translate(10px, 34px);   opacity: 0;    }
  }

  /* ── Stats ─────────────────────────────────────────────────────────────── */
  .water-stats {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 280px;
  }
  .water-amount {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .water-current {
    font-size: 28px;
    font-weight: 700;
    color: var(--accent);
    line-height: 1;
  }
  .water-sep {
    font-size: 20px;
    color: var(--text-3);
  }
  .water-goal {
    font-size: 18px;
    font-weight: 500;
    color: var(--text-2);
  }
  .water-pct {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-3);
  }
  .water-pct.goal-met {
    color: var(--accent);
  }
  .water-progress-bar {
    width: 100%;
    height: 8px;
    background: var(--surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  .water-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    border-radius: var(--radius-full);
    transition: width 0.5s cubic-bezier(0.34,1.56,0.64,1);
  }

  /* ── Quick add ──────────────────────────────────────────────────────────── */
  .quick-add-section {
    width: 100%;
  }
  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 8px;
  }
  .preset-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 18px 8px;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-1);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast), transform var(--dur-fast);
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .preset-btn .material-symbols-rounded {
    font-size: 26px;
    color: var(--accent);
  }
  .preset-name { font-size: 12px; font-weight: 600; }
  .preset-vol  { font-size: 12px; color: var(--text-3); font-weight: 500; }
  .preset-btn:hover {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent);
  }
  .preset-btn:active { transform: scale(0.94); }
  .preset-custom {
    background: var(--surface-2);
    border-style: dashed;
  }

  .custom-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    align-items: center;
  }
  .custom-input { flex: 1; }

  /* ── Log ────────────────────────────────────────────────────────────────── */
  .log-card {
    border-left: 3px solid var(--accent);
  }
  .log-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
  }
  .log-icon {
    color: var(--accent);
    font-size: 20px;
    flex-shrink: 0;
  }
  .log-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .divider {
    height: 1px;
    background: var(--border);
    margin: 0 16px;
  }

  .empty-log {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 0;
  }
</style>
