<script>
  import { createEventDispatcher } from 'svelte';
  export let tabs   = [];   // [{ label, value }]
  export let active = 0;

  const dispatch = createEventDispatcher();
  function select(i) { active = i; dispatch('change', tabs[i]); }
</script>

<div class="tabs-bar" role="tablist">
  {#each tabs as tab, i}
    <button
      class="tab-btn"
      class:active={i === active}
      role="tab"
      aria-selected={i === active}
      on:click={() => select(i)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .tabs-bar {
    display: flex;
    background: var(--surface-2);
    border-radius: var(--radius-md);
    padding: 3px;
    gap: 2px;
  }
  .tab-btn {
    flex: 1;
    padding: 8px 12px;
    border-radius: calc(var(--radius-md) - 3px);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
    transition: background var(--dur-fast), color var(--dur-fast);
    cursor: pointer;
    white-space: nowrap;
  }
  .tab-btn.active {
    background: var(--surface-1);
    color: var(--accent);
    box-shadow: var(--shadow-sm);
  }
</style>
