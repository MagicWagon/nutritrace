<script>
  /**
   * Diary → right column → Nutrient Detail widget.
   *
   * Complements Day Summary rather than duplicating it. Day Summary
   * already handles calories + P/C/F (with the macro ring + hero
   * number + gram rows). This widget shows the OTHER nutrients the
   * user has enabled in Settings → Nutrients: fiber, sodium, sat fat,
   * cholesterol, sugars, and any vitamins / minerals they track.
   *
   * The primary macros are filtered out here so the widget always
   * adds information rather than repeating it. If a user only tracks
   * the basic macros, the widget hides entirely (nothing extra to show).
   * Also hidden when Settings → Diary → Show Nutrient Bar is off.
   */
  export let items       = [];    // [{id, label, cur, rem, tgt, pct, over, unit}]
  export let mode        = 'remaining';   // 'remaining' | 'eaten'
  export let showUnits   = true;

  // Nutrients already shown by Day Summary (its ring, hero kcal, and
  // colored macro rows). Filtered out here so this widget is purely
  // additive detail — saves rail space and prevents the "wait, isn't
  // that already up there?" reaction.
  const DAY_SUMMARY_KEYS = new Set([
    'calories', 'kilojoules',
    'protein', 'carbohydrates', 'fat',
  ]);
  $: extraItems = items.filter(nb => !DAY_SUMMARY_KEYS.has(nb.id));

  function nutrientBarColor(id) {
    if (id === 'fat' || id === 'saturated-fat') return 'var(--macro-fat)';
    if (id === 'carbohydrates' || id === 'sugars' || id === 'added-sugars' || id === 'fiber') return 'var(--macro-carbs)';
    if (id === 'proteins') return 'var(--macro-protein)';
    return 'var(--accent)';
  }
</script>

{#if extraItems.length > 0}
  <section class="nutrient-widget card">
    <header class="nw-header">
      <span class="material-symbols-rounded nw-icon">monitoring</span>
      <span class="nw-title">Other nutrients</span>
    </header>

    <div class="nw-list">
      {#each extraItems as nb (nb.id)}
        <div class="nw-row" class:nw-over={nb.over}>
          <span class="nw-label">{nb.label}</span>
          <div class="nw-bar-track">
            <div
              class="nw-bar-fill"
              class:over={nb.over}
              style="width:{Math.min(100, nb.pct)}%;{nb.over ? '' : 'background:' + nutrientBarColor(nb.id)}"
            ></div>
          </div>
          <span class="nw-val" class:nw-val-over={nb.over}>
            {#if mode === 'remaining' && nb.tgt}
              {Math.round((nb.tgt - nb.cur) * 10) / 10}{#if showUnits} {nb.unit}{/if}
            {:else}
              {Math.round(nb.cur * 10) / 10}{#if showUnits} {nb.unit}{/if}
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .nutrient-widget {
    padding: 16px 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .nw-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .nw-icon {
    color: var(--accent);
    font-size: 20px;
  }
  .nw-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-1);
    letter-spacing: -0.01em;
  }

  .nw-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .nw-row {
    display: grid;
    grid-template-columns: 90px 1fr 68px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .nw-label {
    color: var(--text-2);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nw-bar-track {
    height: 6px;
    background: var(--surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  .nw-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius-full);
    transition: width 0.4s cubic-bezier(0.34, 1.2, 0.64, 1);
  }
  .nw-bar-fill.over {
    background: var(--danger, #ff5252);
  }
  .nw-val {
    text-align: right;
    color: var(--text-1);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 11px;
  }
  .nw-val-over {
    color: var(--danger, #ff5252);
  }
</style>
