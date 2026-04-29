<!--
  DatePicker — calendar-based date selector matching the diary date-bar
  aesthetic. Caller decides whether to wrap in a Sheet/modal or render inline.

  Props:
    value         (bindable) — selected date as 'YYYY-MM-DD'
    min           — earliest selectable date as 'YYYY-MM-DD' (optional)
    max           — latest selectable date as 'YYYY-MM-DD' (optional, e.g.
                    pass `localDateStr()` to forbid future dates)
    showManualInput — render the text-entry row at the bottom (default true)

  Events:
    select { detail: 'YYYY-MM-DD' } — fires when the user taps a day or
                                      submits a valid manual entry.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { dateFormat } from '../../stores/settings.js';
  import { localDateStr } from '../../lib/db.js';

  export let value = '';
  export let min = '';
  export let max = '';
  export let showManualInput = true;

  const dispatch = createEventDispatcher();

  // Initialise calendar view from value (or today if empty)
  function _seedDate(v) {
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return new Date(v + 'T12:00:00');
    }
    return new Date();
  }
  let _seed = _seedDate(value);
  let calYear  = _seed.getFullYear();
  let calMonth = _seed.getMonth();

  $: calFirstDay    = new Date(calYear, calMonth, 1).getDay();
  $: calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  // Nav-bound caps
  $: calAtMax = (() => {
    if (!max) return false;
    const [my, mm] = max.split('-').map(Number);
    return calYear > my || (calYear === my && calMonth + 1 > mm);
  })();
  $: calAtMin = (() => {
    if (!min) return false;
    const [my, mm] = min.split('-').map(Number);
    return calYear < my || (calYear === my && calMonth + 1 < mm);
  })();

  let showYearPicker  = false;
  let showMonthPicker = false;
  $: calMonthName = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, { month: 'long' });
  $: yearRange = (() => {
    const center = max
      ? Number(max.slice(0, 4))
      : new Date().getFullYear();
    return Array.from({ length: 22 }, (_, i) => (center - 10) + i);
  })();
  const monthNames = [
    {idx:0,short:'Jan'},{idx:1,short:'Feb'},{idx:2,short:'Mar'},
    {idx:3,short:'Apr'},{idx:4,short:'May'},{idx:5,short:'Jun'},
    {idx:6,short:'Jul'},{idx:7,short:'Aug'},{idx:8,short:'Sep'},
    {idx:9,short:'Oct'},{idx:10,short:'Nov'},{idx:11,short:'Dec'},
  ];

  function _todayStr() { return localDateStr(); }

  // Manual-entry state — initial value reflects current `value` in user's
  // chosen format. Updated when value changes externally.
  let pickerDate = '';
  $: pickerDate = _formatForDisplay(value);

  function _formatForDisplay(v) {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
    const fmt = $dateFormat || 'ISO';
    const [y, m, d] = v.split('-');
    if (fmt === 'US') return `${m}/${d}/${y}`;
    if (fmt === 'EU') return `${d}/${m}/${y}`;
    return v;
  }

  function _parseManual(s) {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
      const fmt = $dateFormat || 'ISO';
      const parts = s.split('/');
      const y = parts[2];
      // US is M/D/Y, EU is D/M/Y
      const [m, d] = fmt === 'EU' ? [parts[1], parts[0]] : [parts[0], parts[1]];
      return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    return null;
  }

  function calPrevMonth() {
    showYearPicker = false; showMonthPicker = false;
    if (calAtMin) return;
    if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--;
  }
  function calNextMonth() {
    showYearPicker = false; showMonthPicker = false;
    if (calAtMax) return;
    if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++;
  }

  function _selectDay(ds) {
    if (max && ds > max) return;
    if (min && ds < min) return;
    value = ds;
    dispatch('select', ds);
  }

  function applyManual() {
    const iso = _parseManual(pickerDate);
    if (!iso) return;
    if (max && iso > max) return;
    if (min && iso < min) return;
    value = iso;
    // Update calendar view to land on the picked month
    const dt = new Date(iso + 'T12:00:00');
    calYear  = dt.getFullYear();
    calMonth = dt.getMonth();
    dispatch('select', iso);
  }
</script>

<div class="date-picker">
  <!-- Month / year navigation -->
  <div class="dp-nav">
    <button class="btn-icon dp-nav-btn" on:click={calPrevMonth} disabled={calAtMin} aria-label="Previous month">
      <span class="material-symbols-rounded">chevron_left</span>
    </button>
    <div class="dp-month-year">
      <button class="dp-month-btn" on:click={() => { showMonthPicker = !showMonthPicker; showYearPicker = false; }} title="Pick month">
        {calMonthName}<span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle;margin-left:2px">{showMonthPicker ? 'expand_less' : 'expand_more'}</span>
      </button>
      <button class="dp-year-btn" on:click={() => { showYearPicker = !showYearPicker; showMonthPicker = false; }} title="Pick year">
        {calYear}<span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle;margin-left:2px">{showYearPicker ? 'expand_less' : 'expand_more'}</span>
      </button>
    </div>
    <button class="btn-icon dp-nav-btn" on:click={calNextMonth} disabled={calAtMax} aria-label="Next month">
      <span class="material-symbols-rounded">chevron_right</span>
    </button>
  </div>

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
    <div class="dp-grid">
      {#each ['Su','Mo','Tu','We','Th','Fr','Sa'] as dh}
        <div class="dp-dh">{dh}</div>
      {/each}
      {#each {length: calFirstDay} as _}
        <div></div>
      {/each}
      {#each {length: calDaysInMonth} as _, di}
        {@const day = di + 1}
        {@const ds = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(day).padStart(2,'0')}
        {@const blocked = (max && ds > max) || (min && ds < min)}
        <button class="dp-day"
          class:dp-today={ds === _todayStr()}
          class:dp-sel={ds === value}
          class:dp-future={ds > _todayStr() && !blocked}
          disabled={blocked}
          on:click={() => _selectDay(ds)}>
          {day}
        </button>
      {/each}
    </div>
    {#if showManualInput}
      <div class="dp-manual">
        <input class="input" type="text" bind:value={pickerDate}
          placeholder={$dateFormat === 'US' ? 'MM/DD/YYYY' : $dateFormat === 'EU' ? 'DD/MM/YYYY' : 'YYYY-MM-DD'}
          style="flex:1;font-size:14px;height:40px" />
        <button class="btn btn-primary" style="height:40px;padding:0 18px" on:click={applyManual}>Go</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .date-picker { padding-bottom: 4px; }
  .dp-nav {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 8px 8px;
  }
  .dp-nav-btn { color: var(--text-2); }
  .dp-nav-btn:disabled { opacity: 0.3; cursor: default; }
  .dp-month-year { display: flex; align-items: center; gap: 6px; }
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
</style>
