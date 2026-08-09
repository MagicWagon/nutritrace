<script>
  /**
   * Diary → right column → Weight widget.
   *
   * Compact inline weight logger. Shows the current day's weight if
   * logged; if not, offers a one-tap inline input to log today's
   * weight without opening the full Body Stats sheet. Uses the
   * existing saveBodyStats plumbing via the parent's callback — same
   * write path the Body Stats sheet uses, so tags (weight_unit) and
   * sync behavior are identical.
   *
   * Future phases (or a Phase 3.1 follow-up) can add a 7-day sparkline
   * once weight-history fetching is centralised (Goals.svelte pulls all
   * diary and filters; would want a lighter endpoint to reuse here).
   */
  import { slide } from 'svelte/transition';

  export let currentWeight = null;    // display-unit value or null
  export let unit          = 'kg';    // 'kg' | 'lb'
  export let onSave        = async (_val) => {};

  let editing = false;
  let inputVal = '';
  let inputEl;
  let saving = false;

  async function startEdit() {
    editing = true;
    inputVal = currentWeight != null ? String(currentWeight) : '';
    await Promise.resolve();
    inputEl?.focus();
    inputEl?.select();
  }

  async function commit() {
    const val = parseFloat(inputVal);
    if (!Number.isFinite(val) || val <= 0) { cancel(); return; }
    saving = true;
    try {
      await onSave(val);
      editing = false;
    } finally {
      saving = false;
    }
  }

  function cancel() {
    editing = false;
    inputVal = '';
  }

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { cancel(); }
  }
</script>

<section class="weight-widget card">
  <header class="ww2-header">
    <span class="material-symbols-rounded ww2-icon">scale</span>
    <span class="ww2-title">Weight</span>
    {#if currentWeight != null && !editing}
      <button class="ww2-edit" on:click={startEdit} title="Edit today's weight">
        <span class="material-symbols-rounded">edit</span>
      </button>
    {/if}
  </header>

  {#if !editing}
    <div class="ww2-body">
      {#if currentWeight != null}
        <div class="ww2-value">
          {currentWeight}
          <span class="ww2-unit">{unit}</span>
        </div>
        <div class="ww2-caption">logged today</div>
      {:else}
        <div class="ww2-empty">Not logged today</div>
        <button class="ww2-log-btn btn btn-primary" on:click={startEdit}>
          Log today's weight
        </button>
      {/if}
    </div>
  {:else}
    <div class="ww2-edit-row" transition:slide={{ duration: 160 }}>
      <input
        bind:this={inputEl}
        bind:value={inputVal}
        on:keydown={onKey}
        type="number"
        step="0.1"
        inputmode="decimal"
        placeholder={unit}
        class="input ww2-edit-input"
        disabled={saving}
      />
      <span class="ww2-edit-unit">{unit}</span>
      <button class="btn btn-primary ww2-edit-save" on:click={commit} disabled={saving}>
        {saving ? '…' : 'Save'}
      </button>
      <button class="btn btn-ghost ww2-edit-cancel" on:click={cancel} disabled={saving}>
        Cancel
      </button>
    </div>
  {/if}
</section>

<style>
  .weight-widget {
    padding: 16px 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ww2-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ww2-icon {
    color: var(--accent);
    font-size: 20px;
  }
  .ww2-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-1);
    letter-spacing: -0.01em;
    flex: 1;
  }
  .ww2-edit {
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
  .ww2-edit:hover { color: var(--text-1); background: var(--surface-2); }
  .ww2-edit .material-symbols-rounded { font-size: 16px; }

  .ww2-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .ww2-value {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
    color: var(--text-1);
  }
  .ww2-unit {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-3);
    margin-left: 4px;
  }
  .ww2-caption {
    font-size: 12px;
    color: var(--text-3);
  }
  .ww2-empty {
    font-size: 13px;
    color: var(--text-3);
    font-style: italic;
  }
  .ww2-log-btn {
    width: 100%;
    padding: 10px 12px;
    font-size: 13px;
    font-weight: 600;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .ww2-edit-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: 6px;
  }
  .ww2-edit-input {
    padding: 8px 10px;
    font-size: 15px;
    font-weight: 600;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-1);
    width: 100%;
  }
  .ww2-edit-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .ww2-edit-unit {
    font-size: 13px;
    color: var(--text-3);
    font-weight: 500;
  }
  .ww2-edit-save, .ww2-edit-cancel {
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
  }
</style>
