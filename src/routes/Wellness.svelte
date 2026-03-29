<script>
  import { onMount, onDestroy } from 'svelte';
  import { wellnessMetrics, wellnessSyncMode, wellnessSyncRange, distUnit, pageBanners, dateFormat, withingsSyncRange as withingsSyncRangeSetting, fitbitEnabled, withingsEnabled, garminEnabled, garminSyncRange as garminSyncRangeSetting, weightUnit, goals, goalCelebrations, disableAnimations } from '../stores/settings.js';
  import Chart from 'chart.js/auto';
  import WellnessBanner from '../components/banners/WellnessBanner.svelte';
  import { showSuccess, showError } from '../stores/toast.js';
  import { localDateStr } from '../lib/db.js';
  import { NtApi } from '../lib/api.js';
  import { portal } from '../lib/portal.js';
  import FitbitIcon from '../components/icons/FitbitIcon.svelte';
  import WithingsIcon from '../components/icons/WithingsIcon.svelte';
  import GarminIcon from '../components/icons/GarminIcon.svelte';

  // ── Metric definitions ─────────────────────────────────────────────────────
  const ALL_METRICS = [
    // Movement
    { id: 'steps',            label: 'Steps',             unit: 'steps', group: 'movement', icon: 'directions_walk',    fmt: v => Math.round(v).toLocaleString() },
    { id: 'distance_km',      label: 'Distance',          unit: '',      group: 'movement', icon: 'straighten',         fmt: null },
    { id: 'floors',           label: 'Floors Climbed',    unit: 'floors',group: 'movement', icon: 'stairs',             fmt: v => Math.round(v) },
    { id: 'active_minutes',   label: 'Active Minutes',    unit: 'min',   group: 'movement', icon: 'timer',              fmt: v => Math.round(v) },
    { id: 'calories_out',     label: 'Calories Burned',   unit: 'kcal',  group: 'movement', icon: 'local_fire_department', fmt: v => Math.round(v).toLocaleString() },
    { id: 'active_zone_minutes',    label: 'Active Zone Min',   unit: 'min',  group: 'movement', icon: 'local_fire_department', fmt: v => Math.round(v) },
    { id: 'moderate_intensity_min', label: 'Moderate Intensity',unit: 'min',  group: 'movement', icon: 'directions_run',        fmt: v => Math.round(v) },
    { id: 'vigorous_intensity_min', label: 'Vigorous Intensity',unit: 'min',  group: 'movement', icon: 'sprint',                fmt: v => Math.round(v) },
    // Sleep
    { id: 'sleep_duration_min', label: 'Sleep Duration',  unit: '',      group: 'sleep',    icon: 'bedtime',            fmt: null },
    { id: 'sleep_efficiency',   label: 'Sleep Efficiency',unit: '%',     group: 'sleep',    icon: 'battery_charging_full', fmt: v => v.toFixed(0) },
    { id: 'sleep_deep_min',     label: 'Deep Sleep',      unit: 'min',   group: 'sleep',    icon: 'nights_stay',        fmt: v => Math.round(v) },
    { id: 'sleep_light_min',    label: 'Light Sleep',     unit: 'min',   group: 'sleep',    icon: 'cloud',              fmt: v => Math.round(v) },
    { id: 'sleep_rem_min',      label: 'REM Sleep',       unit: 'min',   group: 'sleep',    icon: 'psychology',         fmt: v => Math.round(v) },
    { id: 'sleep_wake_min',     label: 'Awake',           unit: 'min',   group: 'sleep',    icon: 'wb_twilight',        fmt: v => Math.round(v) },
    { id: 'sleep_score',     label: 'Sleep Score',     unit: '/100', group: 'sleep',    icon: 'star',               fmt: v => Math.round(v) },
    // Heart
    { id: 'resting_hr',         label: 'Resting Heart Rate', unit: 'bpm', group: 'heart', icon: 'favorite',           fmt: v => Math.round(v) },
    { id: 'hrv_daily_rmssd',    label: 'HRV (RMSSD)',        unit: 'ms',  group: 'heart', icon: 'monitor_heart',      fmt: v => v.toFixed(1) },
    { id: 'spo2_avg',           label: 'SpO2',               unit: '%',   group: 'heart', icon: 'water_drop',         fmt: v => v.toFixed(1) },
    { id: 'respiratory_rate',   label: 'Respiratory Rate',   unit: 'brpm',group: 'heart', icon: 'air',                fmt: v => v.toFixed(1) },
    { id: 'vo2_max',            label: 'VO2 Max',            unit: 'mL/kg/min', group: 'heart', icon: 'lungs',          fmt: v => v.toFixed(1) },
  ];

  function isVisible(metricId) {
    const vis = $wellnessMetrics;
    return vis == null || vis.includes(metricId);
  }

  function toggleMetric(id) {
    const all = [
      ...ALL_METRICS.map(m => m.id),
      'weight_kg','body_fat_pct','muscle_mass_kg','bone_mass_kg','body_water_pct','lean_mass_kg','fat_mass_kg','visceral_fat',
      'vascular_age','heart_pulse_bpm','nerve_health_score','pulse_wave_velocity','ecg_heart_rate','ecg_afib',
      'body_battery_high','body_battery_low','stress_avg',
      'segmental_analysis',
    ];
    const cur = $wellnessMetrics ?? all;
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

  // Withings state
  let withingsStatus     = null;
  let withingsData       = {};
  let withingsSyncing    = false;
  let withingsLastSync   = null;
  let withingsConnecting = false;

  // Garmin state
  let garminStatus     = null;
  let garminData       = {};
  let garminSyncing    = false;
  let garminConnecting = false;

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

  // ── Withings metric definitions ───────────────────────────────────────────
  const BODY_METRICS = [
    { id: 'weight_kg',     label: 'Weight',       unit: '', icon: 'monitor_weight',   fmt: null },
    { id: 'body_fat_pct',  label: 'Body Fat',     unit: '%', icon: 'percent',          fmt: v => v.toFixed(1) },
    { id: 'muscle_mass_kg',label: 'Muscle Mass',  unit: '', icon: 'fitness_center',   fmt: null },
    { id: 'bone_mass_kg',  label: 'Bone Mass',    unit: '', icon: 'emergency',         fmt: v => v.toFixed(2) },
    { id: 'body_water_pct',label: 'Body Water',   unit: '', icon: 'water_drop',       fmt: null },
    { id: 'lean_mass_kg',  label: 'Lean Mass',    unit: '', icon: 'person',            fmt: null },
    { id: 'fat_mass_kg',   label: 'Fat Mass',     unit: '', icon: 'scale',             fmt: null },
    { id: 'visceral_fat',  label: 'Visceral Fat', unit: '', icon: 'favorite_border',  fmt: v => v.toFixed(1) },
  ];

  const BODY_SCORE_METRICS = [
    { id: 'vascular_age',       label: 'Vascular Age',     unit: 'yrs',  icon: 'cardiology',   fmt: v => Math.round(v) },
    { id: 'heart_pulse_bpm',    label: 'Heart Pulse',      unit: 'bpm',  icon: 'favorite',     fmt: v => Math.round(v) },
    { id: 'nerve_health_score', label: 'Nerve Activity',   unit: ' µS',  icon: 'neurology',     fmt: v => Math.round(v) },
    { id: 'pulse_wave_velocity',label: 'Pulse Wave Vel.',  unit: 'm/s',  icon: 'show_chart',    fmt: v => v.toFixed(1) },
    { id: 'ecg_heart_rate',     label: 'ECG Heart Rate',   unit: 'bpm',  icon: 'ecg_heart',     fmt: v => Math.round(v) },
    { id: 'ecg_afib',           label: 'AFib Detection',   unit: '',     icon: 'ecg',           fmt: v => v === 1 ? 'Detected' : 'Normal' },
  ];

  function fmtWeight(kg) {
    if (kg == null) return null;
    if ($weightUnit === 'lb') return { value: (kg * 2.20462).toFixed(1), unit: 'lbs' };
    return { value: kg.toFixed(1), unit: 'kg' };
  }

  function fmtBodyMetric(m, raw) {
    if (raw == null) return null;
    if (m.id === 'weight_kg' || m.id === 'muscle_mass_kg' || m.id === 'lean_mass_kg' || m.id === 'fat_mass_kg' || m.id === 'bone_mass_kg') {
      return fmtWeight(raw);
    }
    if (m.id === 'body_water_pct') return { value: raw.toFixed(1), unit: '%' };
    if (m.fmt) return { value: m.fmt(raw), unit: m.unit };
    return { value: String(raw), unit: m.unit };
  }

  // ── Withings init / sync / connect / disconnect ────────────────────────────
  async function initWithings() {
    try {
      withingsStatus = await NtApi.get('/api/wellness/withings/status');
    } catch { withingsStatus = { connected: false, configured: false }; }

    if (withingsStatus.connected) {
      await loadWithingsData();
    }
  }

  async function loadWithingsData() {
    try {
      const result = await NtApi.get(`/api/wellness/withings/data?date=${dateStr}`);
      withingsData = {};
      for (const [, metrics] of Object.entries(result)) {
        for (const [key, { value }] of Object.entries(metrics)) {
          withingsData[key] = value;
        }
      }
    } catch { withingsData = {}; }
  }

  async function syncWithings(silent = false) {
    if (withingsSyncing) return;
    withingsSyncing = true;
    try {
      const range = $withingsSyncRangeSetting || 1;
      let from = dateStr, to = dateStr;
      if (!silent && range > 1) {
        const end = new Date(dateStr + 'T12:00:00');
        const start = new Date(end);
        start.setDate(start.getDate() - (range - 1));
        from = start.toISOString().slice(0, 10);
      }
      const result = await NtApi.post('/api/wellness/withings/sync', { from, to });
      await loadWithingsData();
      _checkWellnessGoals(data, withingsData);
      withingsLastSync = new Date();
      if (!silent) showSuccess(`Synced ${result.dates} day${result.dates === 1 ? '' : 's'} from Withings`);
    } catch(e) {
      if (!silent) showError('Withings sync failed: ' + e.message);
    }
    withingsSyncing = false;
  }

  async function connectWithings() {
    withingsConnecting = true;
    try {
      const { url } = await NtApi.get('/api/wellness/withings/authorize');
      window.location.href = url;
    } catch(e) {
      showError(e.message || 'Could not start Withings authorization');
      withingsConnecting = false;
    }
  }

  async function disconnectWithings() {
    try {
      await NtApi.del('/api/wellness/withings/disconnect');
      withingsStatus = { ...withingsStatus, connected: false };
      withingsData = {};
      showSuccess('Disconnected from Withings');
    } catch(e) { showError(e.message); }
  }

  // ── Garmin ─────────────────────────────────────────────────────────────────
  // Garmin-specific metrics (supplements the shared ALL_METRICS)
  const GARMIN_METRICS = [
    { id: 'body_battery_high', label: 'Body Battery (Peak)', unit: '',    icon: 'battery_full',    fmt: v => Math.round(v) },
    { id: 'body_battery_low',  label: 'Body Battery (Low)',  unit: '',    icon: 'battery_alert',   fmt: v => Math.round(v) },
    { id: 'stress_avg',        label: 'Avg Stress',          unit: '/100',icon: 'sentiment_stressed', fmt: v => Math.round(v) },
  ];

  async function initGarmin() {
    try {
      garminStatus = await NtApi.get('/api/wellness/garmin/status');
    } catch { garminStatus = { connected: false, configured: false }; }
    if (garminStatus.connected) await loadGarminData();
  }

  async function loadGarminData() {
    try {
      const result = await NtApi.get(`/api/wellness/garmin/data?date=${dateStr}`);
      garminData = result[dateStr] || {};
    } catch { garminData = {}; }
  }

  async function syncGarmin(silent = false) {
    if (garminSyncing) return;
    garminSyncing = true;
    try {
      const range = $garminSyncRangeSetting || 1;
      let from = dateStr, to = dateStr;
      if (!silent && range > 1) {
        const end = new Date(dateStr + 'T12:00:00');
        const start = new Date(end);
        start.setDate(start.getDate() - (range - 1));
        from = start.toISOString().slice(0, 10);
      }
      const result = await NtApi.post('/api/wellness/garmin/sync', { from, to });
      await loadGarminData();
      if (!silent) showSuccess(`Synced ${result.synced ?? 0} day${result.synced === 1 ? '' : 's'} from Garmin`);
    } catch(e) {
      if (!silent) showError('Garmin sync failed: ' + e.message);
    }
    garminSyncing = false;
  }

  async function connectGarmin() {
    garminConnecting = true;
    try {
      const { url } = await NtApi.get('/api/wellness/garmin/authorize');
      window.location.href = url;
    } catch(e) {
      showError(e.message || 'Could not start Garmin authorization');
      garminConnecting = false;
    }
  }

  async function disconnectGarmin() {
    try {
      await NtApi.del('/api/wellness/garmin/disconnect');
      garminStatus = { ...garminStatus, connected: false };
      garminData = {};
      showSuccess('Disconnected from Garmin');
    } catch(e) { showError(e.message); }
  }

  // ── Trends ─────────────────────────────────────────────────────────────────
  let trendsRange    = 7;
  let trendsLoading  = false;
  let trendsData     = [];
  let _trendCharts   = [];
  let _trendsVersion = 0; // incremented on each loadTrends call; stale calls abort before creating charts

  let TREND_CHARTS = [
    { id: 'steps',              label: 'Steps',       icon: 'directions_walk', source: 'fitbit',   fmtLatest: v => Math.round(v).toLocaleString() + ' steps', canvasEl: null, hasData: false, latest: null },
    { id: 'sleep_duration_min', label: 'Sleep',       icon: 'bedtime',         source: 'fitbit',   fmtLatest: v => { const h=Math.floor(v/60); return `${h}h ${Math.round(v%60)}m`; }, canvasEl: null, hasData: false, latest: null },
    { id: 'resting_hr',         label: 'Resting HR',  icon: 'favorite',        source: 'fitbit',   fmtLatest: v => Math.round(v) + ' bpm', canvasEl: null, hasData: false, latest: null },
    { id: 'hrv_daily_rmssd',    label: 'HRV',         icon: 'monitor_heart',   source: 'fitbit',   fmtLatest: v => v.toFixed(1) + ' ms', canvasEl: null, hasData: false, latest: null },
    { id: 'weight_kg',          label: 'Weight',      icon: 'monitor_weight',  source: 'withings', fmtLatest: v => $weightUnit === 'lb' ? (v * 2.20462).toFixed(1) + ' lbs' : v.toFixed(1) + ' kg', canvasEl: null, hasData: false, latest: null },
    { id: 'body_fat_pct',       label: 'Body Fat',    icon: 'percent',         source: 'withings', fmtLatest: v => v.toFixed(1) + '%', canvasEl: null, hasData: false, latest: null },
    { id: 'muscle_mass_kg',     label: 'Muscle Mass', icon: 'fitness_center',  source: 'withings', fmtLatest: v => v.toFixed(1) + ' kg', canvasEl: null, hasData: false, latest: null },
  ];

  async function loadTrends() {
    const myVersion = ++_trendsVersion;
    trendsLoading = true;
    _trendCharts.forEach(c => c.destroy?.());
    _trendCharts = [];

    // Reset chart state
    TREND_CHARTS = TREND_CHARTS.map(c => ({ ...c, hasData: false, latest: null, canvasEl: null }));

    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - (trendsRange - 1));
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = today.toISOString().slice(0, 10);

    let fitbitRows = {};
    try {
      fitbitRows = await NtApi.get(`/api/wellness/fitbit/data?from=${fromStr}&to=${toStr}`);
    } catch { /* no fitbit */ }

    let withingsRows = {};
    try {
      withingsRows = await NtApi.get(`/api/wellness/withings/data?from=${fromStr}&to=${toStr}`);
    } catch { /* no withings */ }

    // Build date axis
    const dates = [];
    const cursor = new Date(fromStr + 'T12:00:00');
    while (cursor <= today) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }

    // Pre-compute which dates have any data
    const datesWithData = dates.filter(d =>
      TREND_CHARTS.some(chart => {
        if (chart.source === 'fitbit') return fitbitRows[d]?.[chart.id] != null;
        if (chart.source === 'withings') return withingsRows[d]?.[chart.id]?.value != null;
        return false;
      })
    );
    trendsData = datesWithData;
    trendsLoading = false;

    // Wait for DOM to render canvases
    await new Promise(r => setTimeout(r, 50));

    for (const chart of TREND_CHARTS) {
      const points = dates.map(d => {
        if (chart.source === 'fitbit') return fitbitRows[d]?.[chart.id] ?? null;
        if (chart.source === 'withings') return withingsRows[d]?.[chart.id]?.value ?? null;
        return null;
      });

      chart.hasData = points.some(v => v != null);
      chart.latest  = points.filter(v => v != null).at(-1) ?? null;
    }

    // Trigger reactivity
    TREND_CHARTS = TREND_CHARTS;

    // Another tick for canvases to render
    await new Promise(r => setTimeout(r, 50));

    // Abort if a newer loadTrends call has started
    if (myVersion !== _trendsVersion) return;

    for (const chart of TREND_CHARTS) {
      if (!chart.hasData || !chart.canvasEl) continue;

      const points = dates.map(d => {
        if (chart.source === 'fitbit') return fitbitRows[d]?.[chart.id] ?? null;
        if (chart.source === 'withings') return withingsRows[d]?.[chart.id]?.value ?? null;
        return null;
      });

      const labels = dates.map(d => {
        const dt = new Date(d + 'T12:00:00');
        return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      });

      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4fffb0';

      const c = new Chart(chart.canvasEl, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data: points,
            borderColor: accent,
            backgroundColor: accent + '18',
            fill: true,
            tension: 0.35,
            pointRadius: points.map(v => v != null ? 3 : 0),
            pointBackgroundColor: accent,
            spanGaps: true,
          }],
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: {
            callbacks: { label: ctx => chart.fmtLatest(ctx.raw) }
          }},
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', maxTicksLimit: 7, maxRotation: 0 } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' }, beginAtZero: false },
          },
        },
      });
      _trendCharts.push(c);
    }
  }

  // Reload trends when tab becomes active or range changes
  $: if (activeTab === 'trends') { trendsRange; loadTrends(); }

  // ── Integration availability ───────────────────────────────────────────────
  $: fitbitAvailable   = $fitbitEnabled;
  $: withingsAvailable = $withingsEnabled;
  $: garminAvailable   = $garminEnabled;
  $: anyAvailable      = fitbitAvailable || withingsAvailable || garminAvailable;

  // Sliding pill: ordered list of visible tabs + active index
  // Garmin contributes to movement/sleep/heart tabs alongside Fitbit
  $: _wlTabList = [
    ...(fitbitAvailable || garminAvailable ? ['movement', 'sleep', 'heart'] : []),
    ...(withingsAvailable ? ['body'] : []),
    'trends',
  ];
  $: _wlActiveIdx  = Math.max(0, _wlTabList.indexOf(activeTab));
  $: _wlPillWidth  = `calc((100% - 8px) / ${_wlTabList.length})`;
  $: _wlPillLeft   = `calc(4px + ${_wlActiveIdx} * (100% - 8px) / ${_wlTabList.length})`;

  // Auto-correct activeTab when an integration's availability changes
  $: if (status !== null && withingsStatus !== null && garminStatus !== null) {
    const isActivityTab = activeTab === 'movement' || activeTab === 'sleep' || activeTab === 'heart';
    if (isActivityTab && !fitbitAvailable && !garminAvailable) activeTab = withingsAvailable ? 'body' : 'trends';
    if (activeTab === 'body' && !withingsAvailable) activeTab = (fitbitAvailable || garminAvailable) ? 'movement' : 'trends';
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
    if (!ds) return '';
    const dt   = new Date(ds + 'T12:00:00');
    const today = localDateStr();
    const yest  = (() => { const d = new Date(Date.now() - 86400000); return localDateStr(d); })();
    if (ds === today) return 'Today';
    if (ds === yest)  return 'Yesterday';
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function fmtDateSub(ds) {
    if (!ds) return '';
    const dt  = new Date(ds + 'T12:00:00');
    const fmt = $dateFormat || 'ISO';
    if (fmt === 'US') {
      const m  = String(dt.getMonth()+1).padStart(2,'0');
      const dy = String(dt.getDate()).padStart(2,'0');
      return m + '/' + dy + '/' + dt.getFullYear();
    } else if (fmt === 'EU') {
      const m  = String(dt.getMonth()+1).padStart(2,'0');
      const dy = String(dt.getDate()).padStart(2,'0');
      return dy + '/' + m + '/' + dt.getFullYear();
    }
    return ds;
  }

  // ── Calendar / date picker ─────────────────────────────────────────────────
  let showDatePicker  = false;
  let pickerDate      = '';
  let calYear         = new Date().getFullYear();
  let calMonth        = new Date().getMonth();
  let showYearPicker  = false;
  let showMonthPicker = false;
  let _sheetLock = false;
  let _sheetLockTimer;

  $: calFirstDay    = new Date(calYear, calMonth, 1).getDay();
  $: calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  $: calAtMax = (() => { const n = new Date(); return calYear > n.getFullYear() + 1 || (calYear === n.getFullYear() + 1 && calMonth > n.getMonth()); })();
  $: calMonthName   = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, { month: 'long' });
  $: yearRange      = Array.from({length: 22}, (_, i) => (new Date().getFullYear() - 10) + i);
  const monthNames  = [
    {idx:0,short:'Jan'},{idx:1,short:'Feb'},{idx:2,short:'Mar'},
    {idx:3,short:'Apr'},{idx:4,short:'May'},{idx:5,short:'Jun'},
    {idx:6,short:'Jul'},{idx:7,short:'Aug'},{idx:8,short:'Sep'},
    {idx:9,short:'Oct'},{idx:10,short:'Nov'},{idx:11,short:'Dec'},
  ];

  function _lockAndOpen(setter) {
    clearTimeout(_sheetLockTimer);
    _sheetLock = true;
    setter();
    _sheetLockTimer = setTimeout(() => _sheetLock = false, 400);
  }

  function calPrevMonth() {
    showYearPicker = false; showMonthPicker = false;
    if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--;
  }
  function calNextMonth() {
    showYearPicker = false; showMonthPicker = false;
    if (calAtMax) return;
    if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++;
  }

  function openDatePicker() {
    const dt = new Date(dateStr + 'T12:00:00');
    calYear  = dt.getFullYear();
    calMonth = dt.getMonth();
    pickerDate = dateStr;
    _lockAndOpen(() => showDatePicker = true);
  }

  function goToDate() {
    let iso = null;
    if (pickerDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(pickerDate)) {
        iso = pickerDate;
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(pickerDate)) {
        const [m,d,y] = pickerDate.split('/');
        iso = y + '-' + m.padStart(2,'0') + '-' + d.padStart(2,'0');
      }
    }
    if (iso) {
      dateStr = iso;
      loadData();
      showDatePicker = false;
    } else if (!pickerDate) {
      showDatePicker = false;
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    try {
      status = await NtApi.get('/api/wellness/fitbit/status');
    } catch { status = { connected: false, configured: false }; }

    await initWithings();
    await initGarmin();

    if (status.connected || garminStatus?.connected) {
      await loadData();
      // Auto-sync on open if sync mode = auto and it's today
      if ($wellnessSyncMode === 'auto' && isToday) {
        const key = `wl_wellness_lastSync_${dateStr}`;
        const last = localStorage.getItem(key);
        const cooldownMs = 15 * 60 * 1000; // 15 minutes
        if (!last || Date.now() - Number(last) > cooldownMs) {
          if (status.connected)       await sync(true);
          if (garminStatus?.connected) await syncGarmin(true);
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
    await loadWithingsData();
    await loadGarminData();
    _checkWellnessGoals({ ...garminData, ...data }, withingsData);
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
        const newData = result.metrics || {};
        _checkWellnessGoals(newData, withingsData);
        data = newData;
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
    } else if (params.get('withings') === 'connected') {
      history.replaceState({}, '', '/#/wellness');
      showSuccess('Withings connected!');
    } else if (params.get('withings') === 'error') {
      showError('Withings: ' + (params.get('msg') || 'Authorization failed'));
      history.replaceState({}, '', '/#/wellness');
    } else if (params.get('garmin') === 'connected') {
      history.replaceState({}, '', '/#/wellness');
      showSuccess('Garmin connected!');
    } else if (params.get('garmin') === 'error') {
      showError('Garmin: ' + (params.get('msg') || 'Authorization failed'));
      history.replaceState({}, '', '/#/wellness');
    }
    init();
  });

  onDestroy(() => { _trendCharts.forEach(c => c.destroy?.()); });

  // ── Goal celebrations ─────────────────────────────────────────────────────
  let _celebratingMetrics = new Set();
  let _prevCombinedData = null;

  // Check all wellness metrics (fitbit + withings merged) against goals
  function _checkWellnessGoals(fitbitData, withingsData_) {
    if (!$goalCelebrations || $disableAnimations) return;
    // Merge sources into one flat map of id → value
    const combined = { ...fitbitData };
    for (const [key, val] of Object.entries(withingsData_)) {
      combined[key] = val; // withingsData values are already raw numbers
    }
    const g = goals.get();
    for (const id of Object.keys(g)) {
      const goal = g[id]?.min;
      if (!goal) continue;
      const prev = _prevCombinedData?.[id];
      const curr = combined[id];
      if (curr != null && curr >= goal && (prev == null || prev < goal)) {
        _celebratingMetrics = new Set([..._celebratingMetrics, id]);
        setTimeout(() => {
          _celebratingMetrics = new Set([..._celebratingMetrics].filter(x => x !== id));
        }, 1200);
      }
    }
    _prevCombinedData = { ...combined };
  }

  // ── Merged display data: Fitbit first, Garmin as fallback ────────────────────
  $: displayData = (() => {
    const merged = { ...garminData };
    for (const [k, v] of Object.entries(data)) {
      if (v != null) merged[k] = v; // Fitbit wins when it has a value
    }
    return merged;
  })();

  // ── Sleep stage breakdown ──────────────────────────────────────────────────
  $: sleepTotal = (displayData.sleep_deep_min || 0) + (displayData.sleep_light_min || 0) + (displayData.sleep_rem_min || 0) + (displayData.sleep_wake_min || 0);
  $: sleepStages = [
    { label: 'Deep',  key: 'sleep_deep_min',  color: '#6366f1' },
    { label: 'REM',   key: 'sleep_rem_min',   color: '#8b5cf6' },
    { label: 'Light', key: 'sleep_light_min', color: '#06b6d4' },
    { label: 'Awake', key: 'sleep_wake_min',  color: '#f59e0b' },
  ];
</script>

<div class="page-shell wl-shell">
  <!-- Header -->
  <header class="page-header" class:has-banner={$pageBanners}>
    {#if $pageBanners}<WellnessBanner />{/if}
    <h1>Wellness</h1>
  </header>

  <!-- Fixed sync buttons — portalled to body so position:fixed is viewport-relative -->
  <div class="wl-topbar-actions" use:portal>
    {#if status?.connected}
      <button class="wl-sync-icon-btn" class:wl-syncing={syncing}
        on:click={() => sync()} disabled={syncing}
        title="Sync Fitbit{status.fitbitUserId ? ' · ' + status.fitbitUserId : ''}">
        {#if syncing}
          <span class="material-symbols-rounded wl-spin-icon">sync</span>
        {:else}
          <span class="wl-brand-icon"><FitbitIcon /></span>
        {/if}
      </button>
    {/if}
    {#if withingsStatus?.connected}
      <button class="wl-sync-icon-btn" class:wl-syncing={withingsSyncing}
        on:click={() => syncWithings()} disabled={withingsSyncing}
        title="Sync Withings{withingsStatus.withingsUserId ? ' · User ' + withingsStatus.withingsUserId : ''}">
        {#if withingsSyncing}
          <span class="material-symbols-rounded wl-spin-icon">sync</span>
        {:else}
          <span class="wl-brand-icon"><WithingsIcon /></span>
        {/if}
      </button>
    {/if}
    {#if garminStatus?.connected}
      <button class="wl-sync-icon-btn" class:wl-syncing={garminSyncing}
        on:click={() => syncGarmin()} disabled={garminSyncing}
        title="Sync Garmin{garminStatus.garminUserId ? ' · ' + garminStatus.garminUserId : ''}">
        {#if garminSyncing}
          <span class="material-symbols-rounded wl-spin-icon">sync</span>
        {:else}
          <span class="wl-brand-icon"><GarminIcon /></span>
        {/if}
      </button>
    {/if}
  </div>

  <!-- Date navigation sub-bar — sticky below header, same pattern as Diary -->
  <div class="wl-date-bar" class:has-banner={$pageBanners}>
    <button class="btn-icon accent" on:click={prevDay} aria-label="Previous day" title="Previous day">
      <span class="material-symbols-rounded">chevron_left</span>
    </button>
    <button class="date-btn" on:click={openDatePicker} title="Jump to date">
      <span class="date-label">{fmtDate(dateStr)}</span>
      <span class="date-sub">{fmtDateSub(dateStr)}</span>
    </button>
    <button class="btn-icon accent" on:click={nextDay} disabled={isToday} aria-label="Next day" title="Next day">
      <span class="material-symbols-rounded">chevron_right</span>
    </button>
  </div>

  <div class="page-content wl-content">

    <!-- ── Loading ── -->
    {#if !status || !withingsStatus}
      <div class="wellness-loading">
        <span class="material-symbols-rounded spin">sync</span>
      </div>

    <!-- ── Nothing configured ── -->
    {:else if !anyAvailable}
      <div class="connect-card">
        <div class="connect-icon-wrap">
          <span class="material-symbols-rounded connect-icon">monitor_heart</span>
        </div>
        <h2 class="connect-title">No integrations enabled</h2>
        <p class="connect-desc">
          Enable Fitbit or Withings in <strong>Settings → Labs</strong> to start syncing health data.
        </p>
        <div class="connect-chips">
          <span class="connect-chip"><span class="material-symbols-rounded">directions_walk</span> Activity</span>
          <span class="connect-chip"><span class="material-symbols-rounded">bedtime</span> Sleep</span>
          <span class="connect-chip"><span class="material-symbols-rounded">favorite</span> Heart</span>
          <span class="connect-chip"><span class="material-symbols-rounded">scale</span> Body</span>
        </div>
      </div>

    {:else}
      <!-- ── At least one integration configured — main UI ── -->

      <!-- Tab bar — only tabs for configured integrations -->
      <div class="tab-bar">
        <div class="tab-pill" style="left:{_wlPillLeft};width:{_wlPillWidth}"></div>
        {#if fitbitAvailable}
          <button class="tab-btn" class:active={activeTab === 'movement'} on:click={() => activeTab = 'movement'}>
            <span class="material-symbols-rounded tab-icon">directions_walk</span> Movement
          </button>
          <button class="tab-btn" class:active={activeTab === 'sleep'} on:click={() => activeTab = 'sleep'}>
            <span class="material-symbols-rounded tab-icon">bedtime</span> Sleep
          </button>
          <button class="tab-btn" class:active={activeTab === 'heart'} on:click={() => activeTab = 'heart'}>
            <span class="material-symbols-rounded tab-icon">favorite</span> Heart
          </button>
        {/if}
        {#if withingsAvailable}
          <button class="tab-btn" class:active={activeTab === 'body'} on:click={() => activeTab = 'body'}>
            <span class="material-symbols-rounded tab-icon">monitor_weight</span> Body
          </button>
        {/if}
        <button class="tab-btn" class:active={activeTab === 'trends'} on:click={() => activeTab = 'trends'}>
          <span class="material-symbols-rounded tab-icon">show_chart</span> Trends
        </button>
      </div>

      <!-- ── Fitbit tabs (Movement / Sleep / Heart) ── -->
      {#if activeTab === 'movement' || activeTab === 'sleep' || activeTab === 'heart'}

        {#if !status.connected}
          <!-- Fitbit configured but not yet connected -->
          {#if !status.configured}
            <div class="connect-card">
              <div class="connect-icon-wrap">
                <span class="material-symbols-rounded connect-icon">monitor_heart</span>
              </div>
              <h2 class="connect-title">Fitbit Setup Required</h2>
              <p class="connect-desc">
                An administrator needs to configure Fitbit API credentials in
                <strong>Settings → Labs</strong> before you can connect.
              </p>
            </div>
          {:else}
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
          {/if}

        {:else}
          <!-- Fitbit connected — metric content -->

          <!-- ── Movement tab ── -->
          {#if activeTab === 'movement'}
            <div class="metric-grid">
              {#each ALL_METRICS.filter(m => m.group === 'movement' && isVisible(m.id)) as m}
                {@const fmt = fmtMetric(m, displayData[m.id])}
                <div class="metric-card" class:no-data={fmt == null && !loadingData} class:celebrating={_celebratingMetrics.has(m.id)}>
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
              <div class="card sleep-stages-card">
                <div class="sleep-stages-header">
                  <span class="material-symbols-rounded" style="color:var(--accent)">bar_chart</span>
                  <span class="sleep-stages-title">Sleep Stages</span>
                  {#if displayData.sleep_duration_min != null}
                    {@const s = fmtSleep(displayData.sleep_duration_min)}
                    <span class="sleep-total">{s.value}</span>
                  {/if}
                </div>
                {#if sleepTotal > 0}
                  <div class="stage-bar">
                    {#each sleepStages as stage}
                      {@const pct = sleepTotal > 0 ? ((displayData[stage.key] || 0) / sleepTotal * 100) : 0}
                      {#if pct > 0}
                        <div class="stage-seg" style="width:{pct.toFixed(1)}%;background:{stage.color}" title="{stage.label}: {Math.round(displayData[stage.key] || 0)} min"></div>
                      {/if}
                    {/each}
                  </div>
                  <div class="stage-legend">
                    {#each sleepStages as stage}
                      <div class="stage-legend-item">
                        <span class="stage-dot" style="background:{stage.color}"></span>
                        <span class="stage-leg-label">{stage.label}</span>
                        <span class="stage-leg-val">{displayData[stage.key] != null ? Math.round(displayData[stage.key]) + ' min' : '—'}</span>
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
                {@const fmt = fmtMetric(m, displayData[m.id])}
                <div class="metric-card" class:no-data={fmt == null && !loadingData} class:celebrating={_celebratingMetrics.has(m.id)}>
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
                {@const fmt = fmtMetric(m, displayData[m.id])}
                <div class="metric-card" class:no-data={fmt == null && !loadingData} class:celebrating={_celebratingMetrics.has(m.id)}>
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
            <!-- Garmin-specific: Body Battery + Stress -->
            {#if garminStatus?.connected && GARMIN_METRICS.filter(m => isVisible(m.id)).some(m => garminData[m.id] != null)}
              <div class="card" style="margin-top:12px;padding:16px">
                <div class="sleep-stages-header" style="margin-bottom:12px">
                  <span class="wl-brand-icon" style="font-size:16px;color:var(--accent)"><GarminIcon /></span>
                  <span class="sleep-stages-title">Garmin</span>
                </div>
                <div class="metric-grid">
                  {#each GARMIN_METRICS.filter(m => isVisible(m.id)) as m}
                    {@const raw = garminData[m.id]}
                    {#if raw != null}
                      <div class="metric-card">
                        <div class="metric-icon-wrap">
                          <span class="material-symbols-rounded metric-icon">{m.icon}</span>
                        </div>
                        <div class="metric-body">
                          <span class="metric-label">{m.label}</span>
                          <span class="metric-value">{m.fmt(raw)}<span class="metric-unit">{m.unit}</span></span>
                        </div>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          {/if}

          <!-- Empty state for activity tabs -->
          {#if !loadingData && Object.keys(displayData).length === 0}
            <div class="empty-state">
              <span class="material-symbols-rounded" style="font-size:48px;opacity:0.18">monitor_heart</span>
              <p>No data for {isToday ? 'today' : fmtDate(dateStr)}.</p>
              <p class="text-3 text-sm">Tap <strong>Sync</strong> to pull the latest from your device.</p>
            </div>
          {/if}
        {/if}

      <!-- ── Body tab (Withings) ── -->
      {:else if activeTab === 'body'}
        {#if withingsStatus.connected}
          <div class="metric-grid">
            {#each BODY_METRICS.filter(m => isVisible(m.id)) as m}
              {@const raw = withingsData[m.id]}
              {@const formatted = fmtBodyMetric(m, raw)}
              <div class="metric-card" class:no-data={formatted == null && !loadingData} class:celebrating={_celebratingMetrics.has(m.id)}>
                <div class="metric-icon-wrap">
                  <span class="material-symbols-rounded metric-icon">{m.icon}</span>
                </div>
                <div class="metric-body">
                  <span class="metric-label">{m.label}</span>
                  {#if loadingData}
                    <span class="metric-value skeleton">—</span>
                  {:else if formatted}
                    <span class="metric-value">{formatted.value}<span class="metric-unit">{formatted.unit}</span></span>
                  {:else}
                    <span class="metric-value no-val">—</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>

          {#if BODY_SCORE_METRICS.filter(m => isVisible(m.id)).some(m => withingsData[m.id] != null)}
            <div class="card" style="margin-top:12px;padding:16px">
              <div class="sleep-stages-header" style="margin-bottom:12px">
                <span class="material-symbols-rounded" style="color:var(--accent)">biotech</span>
                <span class="sleep-stages-title">Body Scan Scores</span>
              </div>
              <div class="metric-grid">
                {#each BODY_SCORE_METRICS.filter(m => isVisible(m.id)) as m}
                  {@const raw = withingsData[m.id]}
                  {#if raw != null}
                    <div class="metric-card">
                      <div class="metric-icon-wrap">
                        <span class="material-symbols-rounded metric-icon">{m.icon}</span>
                      </div>
                      <div class="metric-body">
                        <span class="metric-label">{m.label}</span>
                        <span class="metric-value">{m.fmt(raw)}<span class="metric-unit">{m.unit}</span></span>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}

          <!-- Segmental analysis (Body Scan) -->
          {#if isVisible('segmental_analysis') && ['muscle_mass_left_arm_kg','muscle_mass_right_arm_kg','muscle_mass_torso_kg','muscle_mass_left_leg_kg','muscle_mass_right_leg_kg','fat_mass_left_arm_kg','fat_mass_right_arm_kg','fat_mass_torso_kg','fat_mass_left_leg_kg','fat_mass_right_leg_kg'].some(k => withingsData[k] != null)}
            <div class="card" style="margin-top:12px;padding:16px">
              <div class="sleep-stages-header" style="margin-bottom:12px">
                <span class="material-symbols-rounded" style="color:var(--accent)">accessibility_new</span>
                <span class="sleep-stages-title">Segmental Analysis</span>
              </div>
              <div class="segmental-table">
                <div class="seg-header">
                  <span></span>
                  <span>Muscle</span>
                  <span>Fat</span>
                </div>
                {#each [
                  { label: 'Left Arm',  muscle: 'muscle_mass_left_arm_kg',  fat: 'fat_mass_left_arm_kg'  },
                  { label: 'Right Arm', muscle: 'muscle_mass_right_arm_kg', fat: 'fat_mass_right_arm_kg' },
                  { label: 'Torso',     muscle: 'muscle_mass_torso_kg',     fat: 'fat_mass_torso_kg'     },
                  { label: 'Left Leg',  muscle: 'muscle_mass_left_leg_kg',  fat: 'fat_mass_left_leg_kg'  },
                  { label: 'Right Leg', muscle: 'muscle_mass_right_leg_kg', fat: 'fat_mass_right_leg_kg' },
                ] as seg}
                  {#if withingsData[seg.muscle] != null || withingsData[seg.fat] != null}
                    <div class="seg-row">
                      <span class="seg-label">{seg.label}</span>
                      <span class="seg-val">{withingsData[seg.muscle] != null ? fmtWeight(withingsData[seg.muscle]).value + ' ' + fmtWeight(withingsData[seg.muscle]).unit : '—'}</span>
                      <span class="seg-val">{withingsData[seg.fat] != null ? fmtWeight(withingsData[seg.fat]).value + ' ' + fmtWeight(withingsData[seg.fat]).unit : '—'}</span>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}

          {#if !loadingData && Object.keys(withingsData).length === 0}
            <div class="empty-state">
              <span class="material-symbols-rounded" style="font-size:48px;opacity:0.18">scale</span>
              <p>No Withings data for {isToday ? 'today' : fmtDate(dateStr)}.</p>
              <p class="text-3 text-sm">Tap <strong>Sync</strong> to pull from Withings.</p>
            </div>
          {/if}

        {:else if withingsStatus.configured}
          <div class="connect-card">
            <div class="connect-icon-wrap">
              <span class="material-symbols-rounded connect-icon">scale</span>
            </div>
            <h2 class="connect-title">Connect Withings</h2>
            <p class="connect-desc">
              Sync body composition from your Withings scale. Weight, body fat %, muscle mass, bone mass, and more — automatically filled into your diary.
            </p>
            <div class="connect-chips">
              <span class="connect-chip"><span class="material-symbols-rounded">monitor_weight</span> Weight</span>
              <span class="connect-chip"><span class="material-symbols-rounded">percent</span> Body Fat %</span>
              <span class="connect-chip"><span class="material-symbols-rounded">fitness_center</span> Muscle Mass</span>
              <span class="connect-chip"><span class="material-symbols-rounded">water_drop</span> Body Water</span>
              <span class="connect-chip"><span class="material-symbols-rounded">emergency</span> Bone Mass</span>
              <span class="connect-chip"><span class="material-symbols-rounded">ecg_heart</span> ECG &amp; AFib</span>
            </div>
            <button class="btn btn-primary connect-btn" on:click={connectWithings} disabled={withingsConnecting}>
              {#if withingsConnecting}
                <span class="material-symbols-rounded spin">sync</span> Connecting…
              {:else}
                <span class="material-symbols-rounded">link</span> Connect Withings
              {/if}
            </button>
          </div>
        {/if}

      <!-- ── Trends tab ── -->
      {:else if activeTab === 'trends'}
        <div class="trends-range-bar">
          {#each [{v:7,l:'7d'},{v:30,l:'30d'},{v:90,l:'90d'}] as r}
            <button class="chip" class:chip-active={trendsRange === r.v} on:click={() => trendsRange = r.v}>{r.l}</button>
          {/each}
        </div>

        {#if trendsLoading}
          <div class="wellness-loading"><span class="material-symbols-rounded spin">sync</span></div>
        {:else if trendsData.length === 0}
          <div class="empty-state">
            <span class="material-symbols-rounded" style="font-size:48px;opacity:0.18">show_chart</span>
            <p>No trend data yet.</p>
            <p class="text-3 text-sm">Sync Fitbit or Withings data to see trends.</p>
          </div>
        {:else}
          <div class="trends-charts">
            {#each TREND_CHARTS as chart}
              {#if chart.hasData}
                <div class="card trends-card">
                  <div class="trends-card-header">
                    <span class="material-symbols-rounded" style="color:var(--accent)">{chart.icon}</span>
                    <span class="trends-card-title">{chart.label}</span>
                    {#if chart.latest != null}
                      <span class="trends-latest">{chart.fmtLatest(chart.latest)}</span>
                    {/if}
                  </div>
                  <div class="trends-canvas-wrap">
                    <canvas bind:this={chart.canvasEl}></canvas>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      {/if}

    {/if}

  </div>
</div>

<!-- Date picker calendar sheet -->
{#if showDatePicker}
  <div use:portal class="sheet-backdrop" role="dialog" aria-modal="true"
    on:click={() => { if (!_sheetLock) showDatePicker = false; }} on:keydown={() => {}}>
    <div class="bs-sheet dp-sheet" on:click|stopPropagation on:keydown={() => {}}>
      <div class="sheet-handle"></div>
      <div class="dp-nav">
        <button class="btn-icon dp-nav-btn" on:click={calPrevMonth} aria-label="Previous month">
          <span class="material-symbols-rounded">chevron_left</span>
        </button>
        <div class="dp-month-year">
          <button class="dp-month-btn" on:click={() => { showMonthPicker = !showMonthPicker; showYearPicker = false; }}>
            {calMonthName}<span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle;margin-left:2px">{showMonthPicker ? 'expand_less' : 'expand_more'}</span>
          </button>
          <button class="dp-year-btn" on:click={() => { showYearPicker = !showYearPicker; showMonthPicker = false; }}>
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
          {#each {length: calFirstDay} as _}<div></div>{/each}
          {#each {length: calDaysInMonth} as _, di}
            {@const day = di + 1}
            {@const ds = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(day).padStart(2,'0')}
            <button class="dp-day"
              class:dp-today={ds === localDateStr()}
              class:dp-sel={ds === dateStr}
              class:dp-future={ds > localDateStr()}
              on:click={() => { pickerDate = ds; goToDate(); }}>
              {day}
            </button>
          {/each}
        </div>
        <div class="dp-manual">
          <input class="input" type="text" bind:value={pickerDate}
            placeholder="YYYY-MM-DD" style="flex:1;font-size:14px;height:40px" />
          <button class="btn btn-primary" style="height:40px;padding:0 18px" on:click={goToDate}>Go</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /*
    Override the global page-shell min-height: 100dvh.
    Wellness puts only the <header> inside page-shell (date bar + content are
    outside siblings), so the global min-height would balloon the shell to full
    viewport height and shove the date bar way off screen.
  */
  /* Shell: no forced min-height — avoids pushing fixed bottom nav off-screen on mobile.
     Sticky still works because header + date bar + content share the same scroll container. */
  .wl-shell {
    min-height: unset;
  }
  /* Force h1 to same height as Diary so the sticky date-bar top offset (62px) is accurate. */
  .wl-shell .page-header h1 {
    height: 40px;
    display: flex;
    align-items: center;
  }
  /* Content area: explicit bottom padding since shell no longer provides it. */
  .wl-content {
    padding-bottom: calc(var(--nav-h) + var(--safe-bottom) + 16px);
  }

  /* Date sub-bar — same pattern as Diary */
  .wl-date-bar {
    position: sticky;
    top: calc(var(--page-top, var(--safe-top)) + 62px);
    z-index: 9;
    background: var(--glass-surface);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px var(--page-px);
  }
  .wl-date-bar.has-banner {
    top: calc(var(--page-top, var(--safe-top)) + 102px);
  }
  .date-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    background: none;
    border: none;
    cursor: pointer;
  }
  .date-label { font-size: 17px; font-weight: 700; color: var(--accent); }
  .date-sub   { font-size: 12px; color: var(--text-3); }

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
  }
  .sync-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .sync-source-icon { font-size: 22px; color: var(--accent); }
  .sync-source-text { display: flex; flex-direction: column; gap: 1px; }
  .sync-source-label { font-size: 14px; font-weight: 600; color: var(--text-1); }
  .sync-time { font-size: 11px; color: var(--text-3); }
  .sync-actions { display: flex; align-items: center; gap: 8px; }

  /* Prominent sync button */
  .sync-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    background: var(--accent);
    color: var(--accent-text, #fff);
    border: none;
    border-radius: var(--radius-md);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--dur-fast), transform var(--dur-fast);
    -webkit-tap-highlight-color: transparent;
  }
  .sync-btn:hover:not(:disabled) { opacity: 0.88; }
  .sync-btn:active:not(:disabled) { transform: scale(0.96); }
  .sync-btn:disabled { opacity: 0.6; cursor: default; }
  .sync-btn-icon { font-size: 18px; }
  .sync-btn.syncing .sync-btn-icon {
    animation: wl-spin 0.8s linear infinite;
  }
  @keyframes wl-spin { to { transform: rotate(360deg); } }

  .text-danger { color: var(--text-3); }
  .text-danger:hover { color: var(--error, #f87171); }

  /* Fixed sync buttons — top-right, same row as hamburger */
  .wl-topbar-actions {
    position: fixed;
    top: calc(var(--safe-top) + 10px);
    right: 12px;
    z-index: 41;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .wl-sync-icon-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    border: none;
    background: var(--accent-dim);
    color: var(--accent);
    cursor: pointer;
    font-size: 20px;
    transition: opacity var(--dur-fast), transform var(--dur-fast);
    -webkit-tap-highlight-color: transparent;
  }
  .wl-sync-icon-btn:hover:not(:disabled) { opacity: 0.8; }
  .wl-sync-icon-btn:active:not(:disabled) { transform: scale(0.9); }
  .wl-sync-icon-btn:disabled { opacity: 0.5; cursor: default; }
  .wl-brand-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
  }
  .wl-brand-icon :global(svg) {
    width: 100%;
    height: 100%;
  }
  .wl-spin-icon {
    font-size: 20px;
    animation: wl-spin 0.8s linear infinite;
  }
  /* Tabs */
  .tab-bar {
    display: flex;
    padding: 4px;
    background: var(--surface-2);
    border-radius: var(--radius-md);
    margin-bottom: 12px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    position: relative;
  }
  .tab-bar::-webkit-scrollbar { display: none; }
  .tab-pill {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: calc(var(--radius-md) - 2px);
    background: var(--surface-1);
    box-shadow: var(--shadow-sm);
    transition: left var(--dur-base, 220ms) var(--ease-inout, cubic-bezier(.4,0,.2,1));
    pointer-events: none;
    z-index: 0;
  }
  .tab-btn {
    flex: 1 0 auto;
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
    transition: color var(--dur-fast);
    white-space: nowrap;
    position: relative;
    z-index: 1;
  }
  .tab-btn.active {
    color: var(--accent);
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
  .metric-card.celebrating { animation: goal-pulse 1.2s ease-out; }
  @keyframes goal-pulse {
    0%   { filter: brightness(1); }
    30%  { filter: brightness(1.6) saturate(1.4); box-shadow: 0 0 12px var(--accent); }
    70%  { filter: brightness(1.3); }
    100% { filter: brightness(1); }
  }
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

  /* Chip styles (used in Trends range bar) */
  .chip {
    padding: 6px 14px;
    border-radius: 99px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
    cursor: pointer;
    transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
  }
  .chip:hover { background: var(--surface-3); color: var(--text-1); }
  .chip-active {
    background: var(--accent-dim) !important;
    border-color: var(--accent) !important;
    color: var(--accent) !important;
    font-weight: 600;
  }

  /* Trends */
  .trends-range-bar {
    display: flex;
    gap: 8px;
    padding: 4px 0 12px;
  }
  .trends-charts {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .trends-card {
    padding: 14px 16px;
  }
  .trends-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .trends-card-title {
    font-size: 14px;
    font-weight: 600;
    flex: 1;
  }
  .trends-latest {
    font-size: 13px;
    color: var(--accent);
    font-weight: 600;
  }
  .trends-canvas-wrap {
    height: 160px;
    position: relative;
    overflow: hidden;
  }

  @media (max-width: 400px) {
    .metric-grid { grid-template-columns: 1fr 1fr; }
  }

  /* ── Sheet backdrop + bottom sheet (must be defined here; Diary's are scoped there) ── */
  .sheet-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: flex-end;
  }
  .sheet-handle { width: 36px; height: 4px; background: var(--border); border-radius: 2px; margin: 10px auto 0; }
  .bs-sheet {
    background: var(--surface-1);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    width: 100%; max-width: 600px; margin: 0 auto;
    padding-bottom: var(--safe-bottom);
  }

  /* ── Date picker calendar (mirrors Diary) ────────────────────────────────── */
  .dp-sheet { padding-bottom: 4px; }
  .dp-nav { display: flex; align-items: center; justify-content: space-between; padding: 12px 8px 8px; }
  .dp-nav-btn { color: var(--text-2); }
  .dp-nav-btn:disabled { opacity: 0.3; cursor: default; }
  .dp-month-year { display: flex; align-items: center; gap: 6px; }
  .dp-month-btn {
    font-size: 16px; font-weight: 700; color: var(--text-1);
    background: var(--surface-2); border: none; cursor: pointer;
    border-radius: var(--radius-sm); padding: 2px 8px;
    display: flex; align-items: center; transition: background var(--dur-fast);
  }
  .dp-month-btn:hover { background: var(--surface-3); }
  .dp-year-btn {
    font-size: 16px; font-weight: 700; color: var(--accent);
    background: var(--accent-dim); border: none; cursor: pointer;
    border-radius: var(--radius-sm); padding: 2px 8px;
    display: flex; align-items: center; transition: background var(--dur-fast);
  }
  .dp-year-btn:hover { background: color-mix(in srgb, var(--accent) 20%, transparent); }
  .dp-year-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 4px; padding: 4px 8px 8px; max-height: 220px; overflow-y: auto;
  }
  .dp-yr-btn {
    padding: 8px 4px; font-size: 14px; font-weight: 500;
    border-radius: var(--radius-sm); background: none; border: none;
    cursor: pointer; color: var(--text-1); transition: background var(--dur-fast); text-align: center;
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
    cursor: pointer; color: var(--text-1); transition: background var(--dur-fast); text-align: center;
  }
  .dp-mo-btn:hover { background: var(--surface-2); }
  .dp-mo-btn.dp-mo-sel { background: var(--accent); color: #fff; font-weight: 700; }
  .dp-grid {
    display: grid; grid-template-columns: repeat(7, 1fr);
    gap: 2px; padding: 0 8px 4px;
  }
  .dp-dh { text-align: center; font-size: 11px; font-weight: 600; color: var(--text-3); padding: 4px 0; }
  .dp-day {
    aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    font-size: 14px; border-radius: var(--radius-full);
    background: none; border: none; cursor: pointer;
    color: var(--text-1); transition: background var(--dur-fast);
    -webkit-tap-highlight-color: transparent;
  }
  .dp-day:hover:not(:disabled) { background: var(--surface-2); }
  .dp-day.dp-future { color: var(--text-3); }
  .dp-day.dp-future:hover { background: var(--surface-2); color: var(--text-2); }
  .dp-day.dp-today { color: var(--accent); font-weight: 700; }
  .dp-day.dp-sel { background: var(--accent) !important; color: #fff; font-weight: 600; }
  .dp-manual {
    display: flex; gap: 8px; padding: 8px 16px 16px; align-items: center;
    border-top: 1px solid var(--border); margin-top: 4px;
  }
  .segmental-table {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .seg-header {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
  }
  .seg-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    padding: 8px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: 13px;
  }
  .seg-label {
    font-weight: 600;
    color: var(--text-2);
  }
  .seg-val {
    color: var(--text-1);
  }
</style>
