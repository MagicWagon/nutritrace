<script>
  /**
   * Diary → right column → Day Summary widget.
   *
   * The hero of the desktop-diary redesign's right rail. Consolidates
   * what today's bottom-bar (collapsed + expanded) shows in a single
   * always-visible card:
   *   - Ring visualization of calorie progress + macro breakdown (via
   *     existing MacroRing component, reused as-is)
   *   - Remaining / eaten toggle (matches bottom-bar `_totalsMode`)
   *   - Per-macro remaining/eaten grams with goal-aware coloring
   *   - Activity adjustment line when a wearable + Dynamic/Adaptive
   *     goal mode is bumping the day's target
   *
   * Widget takes tweened values as props so the parent's animation
   * pipeline drives both the bottom bar and this widget from the same
   * source (no double-tween).
   */
  import { _ } from 'svelte-i18n';
  import MacroRing from './MacroRing.svelte';
  import { Nutrition } from '../../lib/nutrition.js';
  import { macroLegendMode } from '../../stores/settings.js';

  // Tweened animated totals from Diary.svelte
  export let eatenKcal    = 0;
  export let protein      = 0;
  export let carbs        = 0;
  export let fat          = 0;

  // Goals + adjustments
  export let goalKcal         = 2000;      // caloriesGoalAdjusted (activity-shifted)
  export let baseGoalKcal     = 2000;      // caloriesGoal (fixed base)
  export let activeKcal       = 0;         // _effectiveActive
  export let proteinGoal      = null;
  export let carbGoal         = null;
  export let fatGoal          = null;

  // Display prefs
  export let energyUnit       = 'kcal';
  export let calorieGoalMode  = 'fixed';   // 'fixed' | 'dynamic' | 'adaptive'

  // Interactive
  export let mode             = 'remaining';   // 'remaining' | 'eaten'  (drives hero kcal only)
  export let onToggleMode     = () => {};
  export let onOpenSummary    = () => {};      // opens the full Nutrition Summary sheet

  $: remainingKcal = Math.max(0, goalKcal - eatenKcal);
  $: overGoal      = eatenKcal > goalKcal;
  $: overBy        = Math.max(0, eatenKcal - goalKcal);

  $: kcalHero = mode === 'remaining'
    ? Nutrition.displayEnergy(overGoal ? overBy : remainingKcal, energyUnit)
    : Nutrition.displayEnergy(eatenKcal, energyUnit);
  $: kcalGoal = Nutrition.displayEnergy(goalKcal, energyUnit);

  // Per-macro display value follows $macroLegendMode (matches the full
  // Nutrition Summary sheet's macro pills exactly):
  //   'percent' → "82 g Protein"       (raw current, no goal)
  //   'grams'   → "82/150 g Protein"   (current/goal when goal exists)
  // The Remaining/Eaten toggle at the widget header only affects the
  // hero kcal number; macro rows always show what was actually eaten
  // so the % / g toggle is the sole knob that shapes them.
  function macroDisplay(actual, goal) {
    const cur = Math.round(actual);
    if ($macroLegendMode === 'grams' && goal != null) {
      return { current: cur, goal: Math.round(goal), withGoal: true };
    }
    return { current: cur, goal: null, withGoal: false };
  }
  $: pDisp = macroDisplay(protein, proteinGoal);
  $: cDisp = macroDisplay(carbs,   carbGoal);
  $: fDisp = macroDisplay(fat,     fatGoal);

  $: showActivity = activeKcal > 0 && mode === 'remaining';
  $: activeE      = Nutrition.displayEnergy(activeKcal, energyUnit);
  $: baseE        = Nutrition.displayEnergy(baseGoalKcal, energyUnit);
  $: adjE         = Nutrition.displayEnergy(goalKcal, energyUnit);
</script>

<section class="day-summary-widget card">
  <header class="dsw-header">
    <span class="dsw-title">Today</span>
    <div class="dsw-toolbar">
      <button
        class="dsw-legend-toggle"
        on:click={() => macroLegendMode.set($macroLegendMode === 'grams' ? 'percent' : 'grams')}
        aria-label="Toggle macro display between percent and grams"
        title="Toggle percent / grams">
        <span class="dsw-lt-opt" class:dsw-lt-active={$macroLegendMode === 'percent'}>%</span>
        <span class="dsw-lt-opt" class:dsw-lt-active={$macroLegendMode === 'grams'}>g</span>
      </button>
      <button class="dsw-mode-toggle" on:click={onToggleMode} aria-label="Toggle remaining / eaten">
        {mode === 'remaining' ? 'Remaining' : 'Eaten'}
        <span class="material-symbols-rounded dsw-toggle-icon">swap_vert</span>
      </button>
      <button class="dsw-open" on:click={onOpenSummary} title="Open full nutrition summary">
        <span class="material-symbols-rounded">open_in_full</span>
      </button>
    </div>
  </header>

  <div class="dsw-ring">
    <MacroRing
      calories={eatenKcal}
      caloriesGoal={goalKcal}
      {protein}
      {carbs}
      {fat}
      {proteinGoal}
      {carbGoal}
      {fatGoal}
    />
  </div>

  <div class="dsw-kcal-hero">
    <div class="dsw-kcal-num">
      {kcalHero.value.toLocaleString()}
      <span class="dsw-kcal-unit">{kcalHero.unit}</span>
    </div>
    <div class="dsw-kcal-caption">
      {#if mode === 'remaining'}
        {#if overGoal}
          over your {kcalGoal.value.toLocaleString()} {kcalGoal.unit} goal
        {:else}
          left of {kcalGoal.value.toLocaleString()} {kcalGoal.unit}
        {/if}
      {:else}
        of {kcalGoal.value.toLocaleString()} {kcalGoal.unit} goal
      {/if}
      {#if calorieGoalMode === 'dynamic'}<span class="dsw-mode-badge" title="Dynamic goal — moves with your wearable activity">⚡</span>{/if}
      {#if calorieGoalMode === 'adaptive'}<span class="dsw-mode-badge" title="Adaptive goal — learned from your weight trend">📈</span>{/if}
    </div>
  </div>

  {#if showActivity}
    <div class="dsw-activity-line" title="Activity from wearable added to today's goal">
      <span class="material-symbols-rounded dsw-activity-icon">directions_run</span>
      {baseE.value.toLocaleString()} <span class="dsw-plus">+</span> {activeE.value.toLocaleString()} = {adjE.value.toLocaleString()} {adjE.unit}
    </div>
  {/if}

  <div class="dsw-macros">
    <div class="dsw-macro-row" style="--macro-color:var(--macro-protein)">
      <span class="dsw-macro-label">Protein</span>
      <span class="dsw-macro-value">
        {pDisp.current}{#if pDisp.withGoal}<span class="dsw-macro-goal">/{pDisp.goal}</span>{/if}
        <span class="dsw-macro-suffix">g</span>
      </span>
    </div>
    <div class="dsw-macro-row" style="--macro-color:var(--macro-carbs)">
      <span class="dsw-macro-label">Carbs</span>
      <span class="dsw-macro-value">
        {cDisp.current}{#if cDisp.withGoal}<span class="dsw-macro-goal">/{cDisp.goal}</span>{/if}
        <span class="dsw-macro-suffix">g</span>
      </span>
    </div>
    <div class="dsw-macro-row" style="--macro-color:var(--macro-fat)">
      <span class="dsw-macro-label">Fat</span>
      <span class="dsw-macro-value">
        {fDisp.current}{#if fDisp.withGoal}<span class="dsw-macro-goal">/{fDisp.goal}</span>{/if}
        <span class="dsw-macro-suffix">g</span>
      </span>
    </div>
  </div>
</section>

<style>
  .day-summary-widget {
    padding: 20px 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .dsw-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .dsw-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-1);
    letter-spacing: -0.01em;
  }
  .dsw-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dsw-mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  .dsw-mode-toggle:hover { background: var(--surface-3); color: var(--text-1); }
  .dsw-toggle-icon { font-size: 14px; }

  /* Percent / grams pill toggle. Two segments in one rounded container;
     active side is filled with accent tint, inactive is muted. Matches
     the ns-legend-toggle pattern used inside the nutrition sheet so
     users see the same control on both surfaces. */
  .dsw-legend-toggle {
    display: inline-flex;
    align-items: center;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    padding: 2px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    line-height: 1;
    overflow: hidden;
  }
  .dsw-legend-toggle:hover { background: var(--surface-3); }
  .dsw-lt-opt {
    padding: 3px 8px;
    border-radius: var(--radius-full);
    transition: background 120ms ease, color 120ms ease;
    min-width: 18px;
    text-align: center;
  }
  .dsw-lt-active {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--text-1);
  }

  .dsw-ring {
    /* MacroRing renders two sibling elements (SVG ring, then a percent
       legend). Block layout lets the SVG center itself (its own
       margin:0 auto handles that) and the legend flows below on its
       own line — a flex wrapper here would put them side by side. */
    margin: 2px 0 -8px;
    text-align: center;
  }

  .dsw-kcal-hero {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dsw-kcal-num {
    font-size: 34px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
    color: var(--text-1);
  }
  .dsw-kcal-unit {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-3);
    margin-left: 2px;
  }
  .dsw-kcal-caption {
    font-size: 13px;
    color: var(--text-3);
    line-height: 1.4;
  }
  .dsw-mode-badge { margin-left: 4px; }

  .dsw-activity-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-3);
    background: color-mix(in srgb, #4FFFB0 8%, transparent);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
  }
  .dsw-activity-icon { font-size: 16px; color: #4FFFB0; }
  .dsw-plus { color: #4FFFB0; margin: 0 2px; font-weight: 600; }

  .dsw-macros {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 2px;
  }
  .dsw-macro-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--macro-color);
    border-radius: var(--radius-sm);
  }
  .dsw-macro-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
  }
  .dsw-macro-value {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-1);
  }
  .dsw-macro-suffix {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-3);
    margin-left: 2px;
  }
  .dsw-macro-goal {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-3);
  }
  /* Open-full-summary icon button (matches Body Measurements widget) */
  .dsw-open {
    background: transparent;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .dsw-open:hover { color: var(--text-1); background: var(--surface-2); }
  .dsw-open .material-symbols-rounded { font-size: 16px; }
</style>
