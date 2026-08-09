<script>
  /**
   * Diary → right column → Body Measurements widget.
   *
   * Compact summary of the current day's body-measurement stats
   * (waist / hips / neck / chest / thighs / biceps / calves — the
   * LENGTH_KEYS set from body-stats-unit.js). Weight is handled by its
   * own dedicated widget above (WeightWidget); measurements sit here
   * as a companion so all body-stat entry surfaces are on one screen.
   *
   * Empty state offers a "Log measurements" button that opens the
   * existing full Body Stats sheet (parent callback). No inline edit
   * form here — measurements are usually logged in a batch (multiple
   * fields at once) so the sheet's form is the better surface.
   */
  export let stats     = {};             // { waist: 82, hips: 95, ... } in display unit
  export let unit      = 'cm';           // 'cm' | 'in'
  export let onOpen    = () => {};

  const ROWS = [
    { key: 'waist',  label: 'Waist'  },
    { key: 'hips',   label: 'Hips'   },
    { key: 'chest',  label: 'Chest'  },
    { key: 'neck',   label: 'Neck'   },
    { key: 'thighs', label: 'Thighs' },
    { key: 'biceps', label: 'Biceps' },
    { key: 'calves', label: 'Calves' },
  ];

  $: rowsWithValues = ROWS
    .filter(r => stats[r.key] != null && stats[r.key] !== '')
    .map(r => ({ ...r, value: stats[r.key] }));
  $: hasAny = rowsWithValues.length > 0;
</script>

<section class="body-widget card">
  <header class="bw-header">
    <span class="material-symbols-rounded bw-icon">straighten</span>
    <span class="bw-title">Measurements</span>
    <button class="bw-open" on:click={onOpen} title="Open body stats sheet">
      <span class="material-symbols-rounded">open_in_full</span>
    </button>
  </header>

  {#if hasAny}
    <ul class="bw-list">
      {#each rowsWithValues as row (row.key)}
        <li class="bw-row">
          <span class="bw-label">{row.label}</span>
          <span class="bw-value">{row.value} <span class="bw-unit">{unit}</span></span>
        </li>
      {/each}
    </ul>
    {#if rowsWithValues.length < ROWS.length}
      <button class="bw-add-more" on:click={onOpen}>
        + Log more measurements
      </button>
    {/if}
  {:else}
    <div class="bw-empty">No measurements logged today</div>
    <button class="btn btn-primary bw-log-btn" on:click={onOpen}>
      Log measurements
    </button>
  {/if}
</section>

<style>
  .body-widget {
    padding: 16px 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bw-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bw-icon {
    color: var(--accent);
    font-size: 20px;
  }
  .bw-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-1);
    letter-spacing: -0.01em;
    flex: 1;
  }
  .bw-open {
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
  .bw-open:hover { color: var(--text-1); background: var(--surface-2); }
  .bw-open .material-symbols-rounded { font-size: 16px; }

  .bw-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bw-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
  .bw-label {
    color: var(--text-2);
    font-weight: 500;
  }
  .bw-value {
    color: var(--text-1);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .bw-unit {
    color: var(--text-3);
    font-weight: 500;
    font-size: 11px;
    margin-left: 2px;
  }
  .bw-add-more {
    background: transparent;
    border: 1px dashed var(--border);
    color: var(--text-3);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    text-align: center;
  }
  .bw-add-more:hover {
    background: var(--surface-2);
    color: var(--text-1);
    border-style: solid;
    border-color: var(--accent);
  }

  .bw-empty {
    font-size: 13px;
    color: var(--text-3);
    font-style: italic;
  }
  .bw-log-btn {
    width: 100%;
    padding: 10px 12px;
    font-size: 13px;
    font-weight: 600;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
</style>
