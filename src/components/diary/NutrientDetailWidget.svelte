<script>
  /**
   * Diary → right column → Nutrient Detail widget.
   *
   * Replaces the current bottom-bar-expanded nutrient list (fiber /
   * sodium / sugar / vitamins / minerals) with an inline always-visible
   * card in the right rail. Same data shape (nutritionBarItems from
   * Diary.svelte), same colors, respects the `remaining` / `eaten`
   * mode toggle.
   *
   * Hidden entirely when the user has turned off "Show Nutrient Bar"
   * in Settings → Diary (matches diaryShowNutritionBar behavior).
   */
  export let items       = [];    // [{id, label, cur, rem, tgt, pct, over, unit}]
  export let mode        = 'remaining';   // 'remaining' | 'eaten'
  export let showUnits   = true;

  function nutrientBarColor(id) {
    if (id === 'fat' || id === 'saturated-fat') return 'var(--macro-fat)';
    if (id === 'carbohydrates' || id === 'sugars' || id === 'added-sugars' || id === 'fiber') return 'var(--macro-carbs)';
    if (id === 'proteins') return 'var(--macro-protein)';
    return 'var(--accent)';
  }
</script>

{#if items.length > 0}
  <section class="nutrient-widget card">
    <header class="nw-header">
      <span class="material-symbols-rounded nw-icon">monitoring</span>
      <span class="nw-title">Nutrients</span>
    </header>

    <div class="nw-list">
      {#each items as nb (nb.id)}
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
