<script>
  import { onMount } from 'svelte';
  import { wellnessMetrics, wellnessSyncMode, wellnessSyncRange, distUnit, pageBanners } from '../stores/settings.js';
  import WellnessBanner from '../components/banners/WellnessBanner.svelte';
  import { showSuccess, showError } from '../stores/toast.js';
  import { localDateStr } from '../lib/db.js';
  import { NtApi } from '../lib/api.js';

  // ── Metric definitions ─────────────────────────────────────────────────────
  const ALL_METRICS = [
    // Movement
    { id: 'steps',            label: 'Steps',             unit: 'steps', group: 'movement', icon: 'directions_walk',    fmt: v => Math.round(v).toLocaleString() },
    { id: 'distance_km',      label: 'Distance',          unit: '',      group: 'movement', icon: 'straighten',         fmt: null },
    { id: 'floors',           label: 'Floors Climbed',    unit: 'floors',group: 'movement', icon: 'stairs',             fmt: v => Math.round(v) },
    { id: 'active_minutes',   label: 'Active Minutes',    unit: 'min',   group: 'movement', icon: 'timer',              fmt: v => Math.round(v) },
    { id: 'calories_out',     label: 'Calories Burned',   unit: 'kcal',  group: 'movement', icon: 'local_fire_department', fmt: v => Math.round(v).toLocaleString() },
    // Sleep
    { id: 'sleep_duration_min', label: 'Sleep Duration',  unit: '',      group: 'sleep',    icon: 'bedtime',            fmt: null },
    { id: 'sleep_efficiency',   label: 'Sleep Efficiency',unit: '%',     group: 'sleep',    icon: 'battery_charging_full', fmt: v => v.toFixed(0) },
    { id: 'sleep_deep_min',     label: 'Deep Sleep',      unit: 'min',   group: 'sleep',    icon: 'nights_stay',        fmt: v => Math.round(v) },
    { id: 'sleep_light_min',    label: 'Light Sleep',     unit: 'min',   group: 'sleep',    icon: 'cloud',              fmt: v => Math.round(v) },
    { id: 'sleep_rem_min',      label: 'REM Sleep',       unit: 'min',   group: 'sleep',    icon: 'psychology',         fmt: v => Math.round(v) },
    { id: 'sleep_wake_min',     label: 'Awake',           unit: 'min',   group: 'sleep',    icon: 'wb_twilight',        fmt: v => Math.round(v) },
    // Heart
    { id: 'resting_hr',         label: 'Resting Heart Rate', unit: 'bpm', group: 'heart', icon: 'favorite',           fmt: v => Math.round(v) },
    { id: 'hrv_daily_rmssd',    label: 'HRV (RMSSD)',        unit: 'ms',  group: 'heart', icon: 'monitor_heart',      fmt: v => v.toFixed(1) },
    { id: 'spo2_avg',           label: 'SpO2',               unit: '%',   group: 'heart', icon: 'water_drop',         fmt: v => v.toFixed(1) },
    { id: 'respiratory_rate',   label: 'Respiratory Rate',   unit: 'brpm',group: 'heart', icon: 'air',                fmt: v => v.toFixed(1) },
  ];

  function isVisible(metricId) {
    const vis = $wellnessMetrics;
    return vis == null || vis.includes(metricId);
  }

  function toggleMetric(id) {
    const all   = ALL_METRICS.map(m => m.id);
    const cur   = $wellnessMetrics ?? all;
    if (cur.includes(id)) {
      wellnessMetrics.set(cur.filter(x => x !== id));
    } else {
      wellnessMetrics.set([...cur, id]);
    }
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let activeTab   = 'movement';
  let dateStr     = localDateStr();
  let status      = null; // { connected, configured, fitbitUserId, expiresAt }
  let data        = {}; // { [metricId]: value }
  let syncing     = false;
  let lastSync    = null;
  let connecting  = false;
  let loadingData = true;

  // ── Unit helpers ───────────────────────────────────────────────────────────
  $: du = $distUnit || 'km';

  function fmtDistance(km) {
    if (km == null) return null;
    if (du === 'mi') return { value: (km * 0.621371).toFixed(2), unit: 'mi' };
    return { value: km.toFixed(2), unit: 'km' };
  }

  function fmtSleep(min) {
    if (min == null) return null;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return { value: `${h}h ${m}m`, unit: '' };
  }

  function fmtMetric(m, rawValue) {
    if (rawValue == null) return null;
    if (m.id === 'distance_km') {
      const d = fmtDistance(rawValue);
      return d ? { value: d.value, unit: d.unit } : null;
    }
    if (m.id === 'sleep_duration_min') {
      return fmtSleep(rawValue);
    }
    const val = m.fmt ? m.fmt(rawValue) : rawValue;
    return { value: String(val), unit: m.unit };
  }

  // ── Date navigation ────────────────────────────────────────────────────────
  function prevDay() {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    dateStr = d.toISOString().slice(0, 10);
    loadData();
  }
  function nextDay() {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    dateStr = d.toISOString().slice(0, 10);
    loadData();
  }
  $: isToday = dateStr === localDateStr();

  function fmtDate(ds) {
    const d = new Date(ds + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    try {
      status = await NtApi.get('/api/wellness/fitbit/status');
    } catch { status = { connected: false, configured: false }; }

    if (status.connected) {
      await loadData();
      // Auto-sync on open if sync mode = auto and it's today
      if ($wellnessSyncMode === 'auto' && isToday) {
        const key = `wl_wellness_lastSync_${dateStr}`;
        const last = localStorage.getItem(key);
        const cooldownMs = 15 * 60 * 1000; // 15 minutes
        if (!last || Date.now() - Number(last) > cooldownMs) {
          await sync(true);
        }
      }
    } else {
      loadingData = false;
    }
  }

  async function loadData() {
    loadingData = true;
    try {
      const byDate = await NtApi.get(`/api/wellness/fitbit/data?date=${dateStr}`);
      data = byDate[dateStr] || {};
    } catch { data = {}; }
    loadingData = false;
  }

  async function sync(silent = false) {
    if (syncing) return;
    syncing = true;
    try {
      const range = $wellnessSyncRange || 1;
      let result;
      if (!silent && range > 1) {
        // Manual sync with range: fetch from (dateStr - range + 1) to dateStr
        const end   = new Date(dateStr + 'T12:00:00');
        const start = new Date(end);
        start.setDate(start.getDate() - (range - 1));
        const from = start.toISOString().slice(0, 10);
        result = await NtApi.post('/api/wellness/fitbit/sync', { from, to: dateStr });
        await loadData(); // reload displayed date from DB after range sync
        lastSync = new Date();
        localStorage.setItem(`wl_wellness_lastSync_${dateStr}`, String(Date.now()));
        const msg = result.rateLimited
          ? `Synced ${result.synced} days (rate limited — try again later for the rest)`
          : `Synced ${result.synced} day${result.synced === 1 ? '' : 's'}`;
        showSuccess(msg);
      } else {
        // Auto-sync or 1-day range: single day
        result = await NtApi.post('/api/wellness/fitbit/sync', { date: dateStr });
        data = result.metrics || {};
        lastSync = new Date();
        localStorage.setItem(`wl_wellness_lastSync_${dateStr}`, String(Date.now()));
        if (!silent) showSuccess('Synced');
      }
    } catch (e) {
      if (!silent) showError('Sync failed: ' + e.message);
    }
    syncing = false;
  }

  async function connect() {
    connecting = true;
    try {
      const { url } = await NtApi.get('/api/wellness/fitbit/authorize');
      window.location.href = url;
    } catch (e) {
      showError(e.message || 'Could not start Fitbit authorization');
      connecting = false;
    }
  }

  async function disconnect() {
    try {
      await NtApi.del('/api/wellness/fitbit/disconnect');
      status = { ...status, connected: false };
      data = {};
      showSuccess('Disconnected from Fitbit');
    } catch (e) { showError(e.message); }
  }

  onMount(() => {
    // Post-OAuth redirect: signal is in window.location.search (before the #)
    // so the router always lands on /wellness correctly regardless of query params
    const params = new URLSearchParams(window.location.search);
    if (params.get('fitbit') === 'connected') {
      history.replaceState({}, '', '/#/wellness');
      showSuccess('Fitbit connected!');
    } else if (params.get('fitbit') === 'error') {
      showError('Fitbit: ' + (params.get('msg') || 'Authorization failed'));
      history.replaceState({}, '', '/#/wellness');
    }
    init();
  });

  // ── Sleep stage breakdown ──────────────────────────────────────────────────
  $: sleepTotal = (data.sleep_deep_min || 0) + (data.sleep_light_min || 0) + (data.sleep_rem_min || 0) + (data.sleep_wake_min || 0);
  $: sleepStages = [
    { label: 'Deep',  key: 'sleep_deep_min',  color: '#6366f1' },
    { label: 'REM',   key: 'sleep_rem_min',   color: '#8b5cf6' },
    { label: 'Light', key: 'sleep_light_min', color: '#06b6d4' },
    { label: 'Awake', key: 'sleep_wake_min',  color: '#f59e0b' },
  ];
</script>

<div class="page-shell">
  <!-- Header -->
  <header class="page-header" class:has-banner={$pageBanners}>
    {#if $pageBanners}<WellnessBanner />{/if}
    <div class="wellness-header-row">
      <div class="wellness-title-block">
        <h1>Wellness</h1>
      </div>

      <!-- Date nav -->
      <div class="date-nav">
        <button class="btn-icon" on:click={prevDay} title="Previous day" aria-label="Previous day">
          <span class="material-symbols-rounded">chevron_left</span>
        </button>
        <span class="date-label">{isToday ? 'Today' : fmtDate(dateStr)}</span>
        <button class="btn-icon" on:click={nextDay} disabled={isToday} title="Next day" aria-label="Next day">
          <span class="material-symbols-rounded">chevron_right</span>
        </button>
      </div>
    </div>
  </header>

  <div class="page-content">

    <!-- ── Not configured ── -->
    {#if !status}
      <div class="wellness-loading">
        <span class="material-symbols-rounded spin">sync</span>
      </div>

    {:else if !status.configured && !status.connected}
      <!-- Fitbit not set up by admin -->
      <div class="connect-card">
        <div class="connect-icon-wrap">
          <span class="material-symbols-rounded connect-icon">monitor_heart</span>
        </div>
        <h2 class="connect-title">Connect a Fitness Tracker</h2>
        <p class="connect-desc">
          Sync steps, sleep, heart rate, and more from your Fitbit.
          An administrator needs to configure Fitbit API credentials in
          <strong>Settings → Labs</strong> before you can connect.
        </p>
        <div class="connect-chips">
          <span class="connect-chip"><span class="material-symbols-rounded">directions_walk</span> Steps</span>
          <span class="connect-chip"><span class="material-symbols-rounded">bedtime</span> Sleep</span>
          <span class="connect-chip"><span class="material-symbols-rounded">favorite</span> Heart</span>
          <span class="connect-chip"><span class="material-symbols-rounded">water_drop</span> SpO2</span>
        </div>
      </div>

    {:else if status.configured && !status.connected}
      <!-- Configured but not connected — show Connect button -->
      <div class="connect-card">
        <div class="connect-icon-wrap">
          <span class="material-symbols-rounded connect-icon">monitor_heart</span>
        </div>
        <h2 class="connect-title">Connect Fitbit</h2>
        <p class="connect-desc">
          Authorize NutriTrace to read your Fitbit data. You'll be redirected to
          Fitbit to approve access, then brought back here.
        </p>
        <div class="connect-chips">
          <span class="connect-chip"><span class="material-symbols-rounded">directions_walk</span> Steps &amp; Activity</span>
          <span class="connect-chip"><span class="material-symbols-rounded">bedtime</span> Sleep</span>
          <span class="connect-chip"><span class="material-symbols-rounded">favorite</span> Heart Rate &amp; HRV</span>
          <span class="connect-chip"><span class="material-symbols-rounded">water_drop</span> SpO2</span>
          <span class="connect-chip"><span class="material-symbols-rounded">air</span> Breathing Rate</span>
        </div>
        <button class="btn btn-primary connect-btn" on:click={connect} disabled={connecting}>
          {#if connecting}
            <span class="material-symbols-rounded spin">sync</span> Connecting…
          {:else}
            <span class="material-symbols-rounded">link</span> Connect Fitbit
          {/if}
        </button>
      </div>

    {:else}
      <!-- Connected — main wellness UI -->

      <!-- Sync status bar -->
      <div class="sync-bar">
        <div class="sync-info">
          <span class="material-symbols-rounded sync-source-icon">fitbit</span>
          <span class="sync-source-label">Fitbit</span>
          {#if status.fitbitUserId}
            <span class="sync-user">· {status.fitbitUserId}</span>
          {/if}
        </div>
        <div class="sync-actions">
          {#if lastSync}
            <span class="sync-time">Synced {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {/if}
          <button class="btn btn-sm" on:click={() => sync()} disabled={syncing} title="Sync now" aria-label="Sync now">
            <span class="material-symbols-rounded" class:spin={syncing}>sync</span>
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
          <button class="btn btn-sm btn-danger-ghost" on:click={disconnect} title="Disconnect Fitbit" aria-label="Disconnect">
            <span class="material-symbols-rounded">link_off</span>
          </button>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tab-bar">
        <button class="tab-btn" class:active={activeTab === 'movement'} on:click={() => activeTab = 'movement'}>
          <span class="material-symbols-rounded tab-icon">directions_walk</span> Movement
        </button>
        <button class="tab-btn" class:active={activeTab === 'sleep'} on:click={() => activeTab = 'sleep'}>
          <span class="material-symbols-rounded tab-icon">bedtime</span> Sleep
        </button>
        <button class="tab-btn" class:active={activeTab === 'heart'} on:click={() => activeTab = 'heart'}>
          <span class="material-symbols-rounded tab-icon">favorite</span> Heart
        </button>
      </div>

      <!-- ── Movement tab ── -->
      {#if activeTab === 'movement'}
        <div class="metric-grid">
          {#each ALL_METRICS.filter(m => m.group === 'movement' && isVisible(m.id)) as m}
            {@const fmt = fmtMetric(m, data[m.id])}
            <div class="metric-card" class:no-data={fmt == null && !loadingData}>
              <div class="metric-icon-wrap">
                <span class="material-symbols-rounded metric-icon">{m.icon}</span>
              </div>
              <div class="metric-body">
                <span class="metric-label">{m.label}</span>
                {#if loadingData}
                  <span class="metric-value skeleton">—</span>
                {:else if fmt}
                  <span class="metric-value">{fmt.value}<span class="metric-unit">{fmt.unit}</span></span>
                {:else}
                  <span class="metric-value no-val">—</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>

      <!-- ── Sleep tab ── -->
      {:else if activeTab === 'sleep'}
        {#if !loadingData && data.sleep_duration_min != null}
          <!-- Sleep stage breakdown bar -->
          <div class="card sleep-stages-card">
            <div class="sleep-stages-header">
              <span class="material-symbols-rounded" style="color:var(--accent)">bar_chart</span>
              <span class="sleep-stages-title">Sleep Stages</span>
              {#if data.sleep_duration_min != null}
                {@const s = fmtSleep(data.sleep_duration_min)}
                <span class="sleep-total">{s.value}</span>
              {/if}
            </div>
            {#if sleepTotal > 0}
              <div class="stage-bar">
                {#each sleepStages as stage}
                  {@const pct = sleepTotal > 0 ? ((data[stage.key] || 0) / sleepTotal * 100) : 0}
                  {#if pct > 0}
                    <div class="stage-seg" style="width:{pct.toFixed(1)}%;background:{stage.color}" title="{stage.label}: {Math.round(data[stage.key] || 0)} min"></div>
                  {/if}
                {/each}
              </div>
              <div class="stage-legend">
                {#each sleepStages as stage}
                  <div class="stage-legend-item">
                    <span class="stage-dot" style="background:{stage.color}"></span>
                    <span class="stage-leg-label">{stage.label}</span>
                    <span class="stage-leg-val">{data[stage.key] != null ? Math.round(data[stage.key]) + ' min' : '—'}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-3 text-sm" style="padding:0 0 8px">No stage data available</p>
            {/if}
          </div>
        {/if}

        <div class="metric-grid">
          {#each ALL_METRICS.filter(m => m.group === 'sleep' && isVisible(m.id)) as m}
            {@const fmt = fmtMetric(m, data[m.id])}
            <div class="metric-card" class:no-data={fmt == null && !loadingData}>
              <div class="metric-icon-wrap">
                <span class="material-symbols-rounded metric-icon">{m.icon}</span>
              </div>
              <div class="metric-body">
                <span class="metric-label">{m.label}</span>
                {#if loadingData}
                  <span class="metric-value skeleton">—</span>
                {:else if fmt}
                  <span class="metric-value">{fmt.value}<span class="metric-unit">{fmt.unit}</span></span>
                {:else}
                  <span class="metric-value no-val">—</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>

      <!-- ── Heart tab ── -->
      {:else if activeTab === 'heart'}
        <div class="metric-grid">
          {#each ALL_METRICS.filter(m => m.group === 'heart' && isVisible(m.id)) as m}
            {@const fmt = fmtMetric(m, data[m.id])}
            <div class="metric-card" class:no-data={fmt == null && !loadingData}>
              <div class="metric-icon-wrap">
                <span class="material-symbols-rounded metric-icon" style="color:#ef4444">{m.icon}</span>
              </div>
              <div class="metric-body">
                <span class="metric-label">{m.label}</span>
                {#if loadingData}
                  <span class="metric-value skeleton">—</span>
                {:else if fmt}
                  <span class="metric-value">{fmt.value}<span class="metric-unit">{fmt.unit}</span></span>
                {:else}
                  <span class="metric-value no-val">—</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Empty state when no data at all -->
      {#if !loadingData && Object.keys(data).length === 0}
        <div class="empty-state">
          <span class="material-symbols-rounded" style="font-size:48px;opacity:0.18">monitor_heart</span>
          <p>No data for {isToday ? 'today' : fmtDate(dateStr)}.</p>
          <p class="text-3 text-sm">Tap <strong>Sync</strong> to pull the latest from Fitbit.</p>
        </div>
      {/if}

    {/if}

  </div>
</div>

<style>
  .wellness-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .wellness-title-block {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .wellness-title-icon {
    font-size: 28px;
    color: var(--accent);
  }
  .wellness-header-row h1 { margin: 0; }

  /* Date nav */
  .date-nav {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .date-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
    min-width: 120px;
    text-align: center;
  }

  /* Loading spinner */
  .wellness-loading {
    display: flex;
    justify-content: center;
    padding: 64px;
    color: var(--text-3);
    font-size: 36px;
  }

  /* Connect card */
  .connect-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 32px 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    margin-top: 16px;
  }
  .connect-icon-wrap {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: var(--accent-dim);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .connect-icon {
    font-size: 36px;
    color: var(--accent);
  }
  .connect-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-1);
    margin: 0;
  }
  .connect-desc {
    font-size: 14px;
    color: var(--text-2);
    max-width: 400px;
    line-height: 1.55;
    margin: 0;
  }
  .connect-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .connect-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    border-radius: 99px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: 13px;
    color: var(--text-2);
  }
  .connect-chip .material-symbols-rounded { font-size: 16px; }
  .connect-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    min-width: 180px;
    justify-content: center;
  }

  /* Sync bar */
  .sync-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    margin-bottom: 4px;
    flex-wrap: wrap;
  }
  .sync-info {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sync-source-icon { font-size: 18px; color: var(--accent); }
  .sync-source-label { font-size: 13px; font-weight: 600; color: var(--text-1); }
  .sync-user { font-size: 12px; color: var(--text-3); }
  .sync-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sync-time { font-size: 12px; color: var(--text-3); }
  .btn-danger-ghost {
    color: var(--text-3);
    background: none;
  }
  .btn-danger-ghost:hover { color: var(--error, #f87171); }

  /* Tabs */
  .tab-bar {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--surface-2);
    border-radius: var(--radius-md);
    margin-bottom: 12px;
  }
  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 8px 10px;
    border-radius: calc(var(--radius-md) - 2px);
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-3);
    transition: background var(--dur-fast), color var(--dur-fast);
    white-space: nowrap;
  }
  .tab-btn.active {
    background: var(--surface-1);
    color: var(--accent);
    box-shadow: var(--shadow-sm);
  }
  .tab-icon { font-size: 16px; }

  /* Metric grid */
  .metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }
  .metric-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: opacity var(--dur-fast);
  }
  .metric-card.no-data { opacity: 0.5; }
  .metric-icon-wrap {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    background: var(--accent-dim);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .metric-icon { font-size: 20px; color: var(--accent); }
  .metric-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .metric-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .metric-value {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-1);
    line-height: 1.1;
  }
  .metric-unit {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-3);
    margin-left: 3px;
  }
  .metric-value.no-val { color: var(--text-3); font-size: 18px; }
  .metric-value.skeleton { color: var(--surface-3); }

  /* Sleep stages card */
  .sleep-stages-card {
    padding: 16px;
    margin-bottom: 12px;
  }
  .sleep-stages-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .sleep-stages-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
    flex: 1;
  }
  .sleep-total {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-1);
  }
  .stage-bar {
    display: flex;
    height: 16px;
    border-radius: 8px;
    overflow: hidden;
    gap: 2px;
    margin-bottom: 10px;
    background: var(--surface-2);
  }
  .stage-seg {
    height: 100%;
    border-radius: 4px;
    min-width: 4px;
    transition: width var(--dur-base);
  }
  .stage-legend {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .stage-legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .stage-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .stage-leg-label {
    font-size: 12px;
    color: var(--text-2);
    flex: 1;
  }
  .stage-leg-val {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-1);
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 48px 24px;
    text-align: center;
    color: var(--text-2);
  }

  /* Spin animation */
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 1s linear infinite; }

  @media (max-width: 400px) {
    .metric-grid { grid-template-columns: 1fr 1fr; }
    .tab-btn { font-size: 12px; padding: 7px 6px; }
    .tab-icon { display: none; }
  }
</style>
