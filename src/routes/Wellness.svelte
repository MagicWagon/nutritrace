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
  // sources: which integrations can supply this metric. Used to hide metrics
  // when their only source integration is disabled.
  const ALL_METRICS = [
    // Movement — both Fitbit and Garmin
    { id: 'steps',            label: 'Steps',             unit: 'steps', group: 'movement', icon: 'directions_walk',       fmt: v => Math.round(v).toLocaleString(),  sources: ['fitbit','garmin'], desc: 'Total steps taken today.' },
    { id: 'distance_km',      label: 'Distance',          unit: '',      group: 'movement', icon: 'straighten',            fmt: null,                                  sources: ['fitbit','garmin'], desc: 'Total distance covered today.' },
    { id: 'floors',           label: 'Floors Climbed',    unit: 'floors',group: 'movement', icon: 'stairs',                fmt: v => Math.round(v),                   sources: ['fitbit','garmin'], desc: 'Floors climbed based on elevation gain detected by your device.' },
    { id: 'active_minutes',   label: 'Active Minutes',    unit: 'min',   group: 'movement', icon: 'timer',                 fmt: v => Math.round(v),                   sources: ['fitbit','garmin'], desc: 'Time spent at a moderate or higher activity level.' },
    { id: 'calories_out',     label: 'Calories Burned',   unit: 'kcal',  group: 'movement', icon: 'local_fire_department', fmt: v => Math.round(v).toLocaleString(),  sources: ['fitbit','garmin'], desc: 'Total calories burned including your resting metabolic rate.' },
    // Movement — Fitbit only
    { id: 'active_zone_minutes', label: 'Active Zone Min', unit: 'min',  group: 'movement', icon: 'local_fire_department', fmt: v => Math.round(v), sources: ['fitbit'], desc: 'Minutes spent in Fat Burn, Cardio, or Peak heart rate zones — counts double for Cardio and Peak.' },
    // Movement — Garmin only
    { id: 'moderate_intensity_min', label: 'Moderate Intensity', unit: 'min', group: 'movement', icon: 'directions_run', fmt: v => Math.round(v), sources: ['garmin'], desc: 'Time at moderate intensity (brisk walking, light cycling). WHO recommends 150–300 min/week.' },
    { id: 'vigorous_intensity_min', label: 'Vigorous Intensity', unit: 'min', group: 'movement', icon: 'sprint',         fmt: v => Math.round(v), sources: ['garmin'], desc: 'Time at high intensity (running, hard effort). Counts double toward weekly activity targets.' },
    // Sleep — both
    { id: 'sleep_duration_min', label: 'Sleep Duration', unit: '',     group: 'sleep', icon: 'bedtime',               fmt: null,               sources: ['fitbit','garmin'], desc: 'Total time asleep last night. Adults generally need 7–9 hours.' },
    { id: 'sleep_deep_min',     label: 'Deep Sleep',     unit: 'min',  group: 'sleep', icon: 'nights_stay',           fmt: v => Math.round(v), sources: ['fitbit','garmin'], desc: 'Deep (slow-wave) sleep — the most restorative stage. Critical for physical recovery and immune function.' },
    { id: 'sleep_light_min',    label: 'Light Sleep',    unit: 'min',  group: 'sleep', icon: 'cloud',                 fmt: v => Math.round(v), sources: ['fitbit','garmin'], desc: 'Light sleep is the transition between wakefulness and deeper stages. Makes up the majority of most sleep cycles.' },
    { id: 'sleep_rem_min',      label: 'REM Sleep',      unit: 'min',  group: 'sleep', icon: 'psychology',            fmt: v => Math.round(v), sources: ['fitbit','garmin'], desc: 'REM sleep supports memory consolidation, learning, and emotional regulation. Increases in later sleep cycles.' },
    { id: 'sleep_wake_min',     label: 'Awake',          unit: 'min',  group: 'sleep', icon: 'wb_twilight',           fmt: v => Math.round(v), sources: ['fitbit','garmin'], desc: 'Time spent awake or restless during the night. Brief awakenings are normal; frequent ones may signal poor sleep quality.' },
    // Sleep — Fitbit only
    { id: 'sleep_efficiency',   label: 'Sleep Efficiency', unit: '%',  group: 'sleep', icon: 'battery_charging_full', fmt: v => v.toFixed(0),  sources: ['fitbit'], desc: 'Percentage of time in bed actually spent asleep. Above 85% is generally considered good.' },
    // Sleep — Garmin (device-measured); Fitbit (estimated from stages + SpO2 + HRV)
    { id: 'sleep_score',        label: 'Sleep Score',    unit: '/100', group: 'sleep', icon: 'star',                  fmt: v => Math.round(v), sources: ['fitbit','garmin'], desc: 'Overall sleep quality score out of 100. Factors in duration, sleep stage balance, SpO2, and HRV.' },
    // Sleep — Fitbit only
    { id: 'skin_temp_variation', label: 'Skin Temp Var.', unit: '°C', group: 'sleep', icon: 'thermometer',           fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2), sources: ['fitbit'], desc: 'Nightly skin temperature relative to your personal baseline. Elevated readings can indicate illness or hormonal changes.' },
    // Heart — both
    { id: 'resting_hr',       label: 'Resting Heart Rate', unit: 'bpm',       group: 'heart', icon: 'favorite',       fmt: v => Math.round(v), sources: ['fitbit','garmin'], desc: 'Heart rate when fully at rest. Lower is generally better — a downward trend over time reflects improving cardiovascular fitness.' },
    { id: 'hrv_daily_rmssd',  label: 'HRV (RMSSD)',        unit: 'ms',        group: 'heart', icon: 'monitor_heart',  fmt: v => v.toFixed(1),  sources: ['fitbit','garmin'], desc: 'Heart rate variability — the variation between heartbeats. Higher values indicate better recovery and autonomic nervous system balance.' },
    { id: 'spo2_avg',         label: 'SpO2',               unit: '%',         group: 'heart', icon: 'water_drop',     fmt: v => v.toFixed(1),  sources: ['fitbit','garmin'], desc: 'Blood oxygen saturation measured overnight. Healthy range is typically 95–100%. Dips below 90% may indicate sleep apnea.' },
    { id: 'respiratory_rate', label: 'Respiratory Rate',   unit: 'brpm',      group: 'heart', icon: 'air',            fmt: v => v.toFixed(1),  sources: ['fitbit','garmin'], desc: 'Average breaths per minute during sleep. Normal adult range is 12–20 breaths/min. Elevated values may signal illness or stress.' },
    // Heart — Fitbit only
    { id: 'vo2_max',          label: 'Cardio Fitness',     unit: 'mL/kg/min', group: 'heart', icon: 'fitness_center', fmt: v => v.toFixed(1),  sources: ['fitbit'], desc: 'Estimated VO₂ Max — the maximum oxygen your body can use during exercise. A key indicator of long-term cardiovascular health.' },
    // Heart — Garmin only
    { id: 'max_hr',           label: 'Max Heart Rate',     unit: 'bpm',       group: 'heart', icon: 'favorite',       fmt: v => Math.round(v), sources: ['garmin'], desc: 'Highest heart rate recorded during the day. Useful for tracking workout intensity and your true max effort.' },
  ];

  // Returns true if at least one of this metric's source integrations is enabled
  function isSourceEnabled(m) {
    if (!m.sources) return true;
    return m.sources.some(s =>
      (s === 'fitbit'   && $fitbitEnabled)  ||
      (s === 'garmin'   && $garminEnabled)  ||
      (s === 'withings' && $withingsEnabled)
    );
  }

  function isVisible(metricId) {
    const vis = $wellnessMetrics;
    return vis == null || vis.includes(metricId);
  }

  function toggleMetric(id) {
    const all = [
      ...ALL_METRICS.map(m => m.id),
      'weight_kg','body_fat_pct','muscle_mass_kg','bone_mass_kg','body_water_pct','lean_mass_kg','fat_mass_kg','visceral_fat','visceral_fat_index','extracellular_water_kg','intracellular_water_kg',
      'vascular_age','heart_pulse_bpm','nerve_health_score','pulse_wave_velocity','ecg_heart_rate','ecg_afib','metabolic_age',
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
    if (h === 0) return { value: `${m}`, unit: 'min' };
    if (m === 0) return { value: `${h}h`, unit: '' };
    return { value: `${h}h ${m}m`, unit: '' };
  }

  function fmtSleepStr(min) {
    const s = fmtSleep(min);
    if (!s) return '—';
    return s.unit ? `${s.value} ${s.unit}` : s.value;
  }

  const SLEEP_TIME_IDS = new Set(['sleep_duration_min','sleep_deep_min','sleep_light_min','sleep_rem_min','sleep_wake_min']);

  function fmtMetric(m, rawValue) {
    if (rawValue == null) return null;
    if (m.id === 'distance_km') {
      const d = fmtDistance(rawValue);
      return d ? { value: d.value, unit: d.unit } : null;
    }
    if (SLEEP_TIME_IDS.has(m.id)) {
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
    { id: 'lean_mass_kg',            label: 'Lean Mass',            unit: '', icon: 'person',           fmt: null },
    { id: 'fat_mass_kg',             label: 'Fat Mass',             unit: '', icon: 'scale',            fmt: null },
    { id: 'visceral_fat',            label: 'Visceral Fat',         unit: '', icon: 'favorite_border',  fmt: v => v.toFixed(1) },
    { id: 'visceral_fat_index',      label: 'Visceral Fat Index',   unit: '', icon: 'favorite_border',  fmt: v => v.toFixed(1) },
    { id: 'extracellular_water_kg',  label: 'Extracellular Water',  unit: '', icon: 'water_drop',       fmt: null },
    { id: 'intracellular_water_kg',  label: 'Intracellular Water',  unit: '', icon: 'water_drop',       fmt: null },
  ];

  const BODY_SCORE_METRICS = [
    { id: 'vascular_age',       label: 'Vascular Age',     unit: 'yrs',  icon: 'cardiology',   fmt: v => Math.round(v) },
    { id: 'metabolic_age',      label: 'Metabolic Age',    unit: 'yrs',  icon: 'trending_up',  fmt: v => Math.round(v) },
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
    if (m.id === 'weight_kg' || m.id === 'muscle_mass_kg' || m.id === 'lean_mass_kg' || m.id === 'fat_mass_kg' || m.id === 'bone_mass_kg' || m.id === 'extracellular_water_kg' || m.id === 'intracellular_water_kg') {
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
    garminSyncing    = false;
    _insightsLoaded  = false;
    _readinessLoaded = false;
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

  // ── Sleep Insights: Debt + Chronotype ─────────────────────────────────────
  let sleepInsightsRange = 14; // nights to look back for debt calculation
  let sleepDebt     = null;    // { debtMin, nights, goalMin } | null
  let chronotype    = null;    // { label, emoji, desc, midpointMin, nights } | { nights, needed } | null
  let _insightsLoaded = false;

  function _sleepMidpoint(startMin, endMin) {
    if (startMin == null || endMin == null) return null;
    // endMin may be less than startMin if sleep crosses midnight (e.g. start=22:30, end=06:45)
    const effectiveEnd = endMin < startMin ? endMin + 1440 : endMin;
    const mid = (startMin + effectiveEnd) / 2;
    return mid >= 1440 ? mid - 1440 : mid;
  }

  function _classifyChronotype(avgMidMin) {
    const h = avgMidMin / 60;
    if (h < 2.0) return { label: 'Early Bird',   emoji: '🌅', desc: 'You naturally wake early and feel most energized in the morning. Your body clock runs ahead of most — mornings are your prime time.' };
    if (h < 3.5) return { label: 'Morning Type',  emoji: '☀️', desc: 'You do your best work in the first half of the day and tend to wake up feeling refreshed. Most schedules suit you well.' };
    if (h < 5.0) return { label: 'Intermediate',  emoji: '⚖️', desc: 'Your body clock is well-aligned with typical schedules — you adapt easily between early mornings and late evenings.' };
    if (h < 6.5) return { label: 'Evening Type',  emoji: '🌆', desc: 'You come alive in the afternoon and evening. Mornings can be a challenge — your peak energy arrives later in the day.' };
    return        { label: 'Night Owl',           emoji: '🦉', desc: "Your body clock runs late. You're at your sharpest in the evening and may struggle with early alarms. Late nights feel natural." };
  }

  function fmtTimeMin(min) {
    if (min == null) return '—';
    const h    = Math.floor(min / 60) % 24;
    const m    = Math.round(min % 60);
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  }

  async function loadSleepInsights() {
    const today   = new Date();
    const lookback = Math.max(sleepInsightsRange, 30); // 30d window for enough chronotype data
    const from    = new Date(today);
    from.setDate(from.getDate() - lookback + 1);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = today.toISOString().slice(0, 10);

    let fitbitRows = {}, garminRows = {};
    try { if ($fitbitEnabled)  fitbitRows  = await NtApi.get(`/api/wellness/fitbit/data?from=${fromStr}&to=${toStr}`); } catch {}
    try { if ($garminEnabled)  garminRows  = await NtApi.get(`/api/wellness/garmin/data?from=${fromStr}&to=${toStr}`); } catch {}

    // Build merged per-date sleep records, most recent last
    const dates = [];
    const cur = new Date(fromStr + 'T12:00:00');
    while (cur <= today) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    const merged = dates.map(d => {
      const g = garminRows[d] || {}, f = fitbitRows[d] || {};
      return {
        sleep_duration_min: g.sleep_duration_min ?? f.sleep_duration_min ?? null,
        sleep_start_min:    g.sleep_start_min    ?? f.sleep_start_min    ?? null,
        sleep_end_min:      g.sleep_end_min      ?? f.sleep_end_min      ?? null,
      };
    });

    // Sleep Debt — last sleepInsightsRange nights
    const goalMin     = goals.get().sleep_duration_min?.min ?? 480;
    const debtNights  = merged.slice(-sleepInsightsRange);
    let   totalDebt   = 0, counted = 0;
    for (const n of debtNights) {
      if (n.sleep_duration_min != null) {
        totalDebt += Math.max(0, goalMin - n.sleep_duration_min);
        counted++;
      }
    }
    sleepDebt = counted > 0 ? { debtMin: Math.round(totalDebt), nights: counted, goalMin } : null;

    // Chronotype — average sleep midpoint across all available nights
    const midpoints = merged
      .map(n => _sleepMidpoint(n.sleep_start_min, n.sleep_end_min))
      .filter(v => v != null);
    if (midpoints.length >= 5) {
      const avg = midpoints.reduce((a, b) => a + b, 0) / midpoints.length;
      chronotype = { ..._classifyChronotype(avg), midpointMin: Math.round(avg), nights: midpoints.length };
    } else {
      chronotype = midpoints.length > 0 ? { label: null, nights: midpoints.length, needed: 5 } : null;
    }
    _insightsLoaded = true;
  }

  // ── Daily Readiness Score ─────────────────────────────────────────────────
  let readiness        = null;  // result obj | { data_days, needed } | null
  let _readinessLoaded = false;

  function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function _calcReadiness(todayHrv, todayRhr, todaySleepScore, todayCalories, history30d) {
    const hrvVals = history30d.map(d => d.hrv_daily_rmssd).filter(v => v != null);
    if (hrvVals.length < 7) return { calibrating: true, data_days: hrvVals.length, needed: 7 };
    if (todayHrv == null)   return null;

    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

    const hrvBaseline = mean(hrvVals);
    const rhrVals     = history30d.map(d => d.resting_hr).filter(v => v != null);
    const rhrBaseline = rhrVals.length >= 5 ? mean(rhrVals) : null;

    // HRV score (60% weight) — calibrated constants from 6 ground-truth days:
    // baseline=65, below penalty=220 (steep), above boost=80 (gentle)
    // Fits observed data to ±2 pts vs Fitbit's own score.
    const hrvRatio = todayHrv / hrvBaseline;
    let hrv_score  = hrvRatio >= 1.0
      ? 65 + (hrvRatio - 1.0) * 80
      : 65 - (1.0 - hrvRatio) * 220;
    hrv_score = _clamp(hrv_score, 0, 100);

    // RHR score (20% weight) — inverse: lower today is better
    let rhr_score = 65; // neutral if no baseline
    if (rhrBaseline != null && todayRhr != null) {
      const rhrRatio = rhrBaseline / todayRhr;
      rhr_score = 65 + (rhrRatio - 1.0) * 120;
      rhr_score = _clamp(rhr_score, 0, 100);
    }

    // HRV × RHR interaction penalty — when both signals go wrong together
    // Fitbit applies a compounding penalty (proven by Fri data: HRV low + RHR elevated → -12 pts)
    let interaction_penalty = 0;
    if (hrvRatio < 1.0 && rhrBaseline != null && todayRhr != null && todayRhr > rhrBaseline) {
      interaction_penalty = (1.0 - hrvRatio) * (todayRhr - rhrBaseline) * 30;
      interaction_penalty = _clamp(interaction_penalty, 0, 10);
    }

    // Sleep score used for contribution (15% weight)
    const sleepBase = todaySleepScore != null ? todaySleepScore : 75;
    const sleep_cap = (todaySleepScore != null && todaySleepScore < 50) ? 65 : 100;

    // Activity penalty — only when today spikes above 7d rolling avg
    const calHistory7 = history30d.slice(-7).map(d => d.calories_out).filter(v => v != null);
    let activity_penalty = 0;
    if (calHistory7.length >= 3 && todayCalories != null) {
      const calMean    = mean(calHistory7);
      const spikeRatio = todayCalories / calMean;
      if (spikeRatio > 1.25) activity_penalty += (spikeRatio - 1.25) * 40;
      // Multi-day accumulation
      const daysAbove = history30d.slice(-3).filter(d => d.calories_out != null && d.calories_out > calMean * 1.1).length;
      activity_penalty += daysAbove * 3;
      activity_penalty = _clamp(activity_penalty, 0, 20);
    }

    let score = (0.60 * hrv_score) + (0.20 * rhr_score) + (0.15 * sleepBase) - activity_penalty - interaction_penalty;
    score     = Math.min(_clamp(Math.round(score), 1, 100), sleep_cap);

    const label = score >= 80 ? 'Optimal' : score >= 65 ? 'Good' : score >= 50 ? 'Fair' : score >= 35 ? 'Low' : 'Poor';
    const color = score >= 65 ? 'var(--accent)' : score >= 50 ? '#f59e0b' : '#ef4444';

    return {
      score, label, color,
      hrv_score:        Math.round(hrv_score),
      rhr_score:        Math.round(rhr_score),
      sleep_score_used: Math.round(sleepBase),
      activity_penalty:     Math.round(activity_penalty),
      interaction_penalty:  Math.round(interaction_penalty),
      hrv_baseline:         Math.round(hrvBaseline * 10) / 10,
      rhr_baseline:         rhrBaseline != null ? Math.round(rhrBaseline) : null,
      data_days:            hrvVals.length,
    };
  }

  async function loadReadiness() {
    _readinessLoaded = true;
    const today   = new Date();
    const from    = new Date(today);
    from.setDate(from.getDate() - 30);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = today.toISOString().slice(0, 10);

    const dates = [];
    const cur   = new Date(fromStr + 'T12:00:00');
    while (cur <= today) { dates.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }

    let fitbitRows = {}, garminRows = {};
    try { if ($fitbitEnabled) fitbitRows = await NtApi.get(`/api/wellness/fitbit/data?from=${fromStr}&to=${toStr}`); } catch {}
    try { if ($garminEnabled) garminRows = await NtApi.get(`/api/wellness/garmin/data?from=${fromStr}&to=${toStr}`); } catch {}

    // History = all days EXCEPT today (today's values come from displayData)
    const history = dates.slice(0, -1).map(d => {
      const g = garminRows[d] || {}, f = fitbitRows[d] || {};
      return {
        hrv_daily_rmssd: g.hrv_daily_rmssd ?? f.hrv_daily_rmssd ?? null,
        resting_hr:      g.resting_hr      ?? f.resting_hr      ?? null,
        calories_out:    g.calories_out    ?? f.calories_out    ?? null,
      };
    });

    readiness = _calcReadiness(
      displayData.hrv_daily_rmssd,
      displayData.resting_hr,
      displayData.sleep_score,
      displayData.calories_out,
      history
    );
  }

  $: { activeTab; if (activeTab === 'heart') _readinessLoaded = false; }
  $: if (activeTab === 'heart' && !_readinessLoaded) loadReadiness();

  // ── 7-day sparklines ───────────────────────────────────────────────────────
  let _sparklineData = {}; // { [metricId]: (number|null)[] } — 7 values, oldest first

  async function loadSparklines() {
    const today   = new Date();
    const from    = new Date(today);
    from.setDate(from.getDate() - 6);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = today.toISOString().slice(0, 10);
    const dates   = [];
    const cur     = new Date(fromStr + 'T12:00:00');
    while (cur <= today) { dates.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }

    let fitbitRange = {}, garminRange = {};
    try { if ($fitbitEnabled)  fitbitRange  = await NtApi.get(`/api/wellness/fitbit/data?from=${fromStr}&to=${toStr}`); } catch {}
    try { if ($garminEnabled)  garminRange  = await NtApi.get(`/api/wellness/garmin/data?from=${fromStr}&to=${toStr}`); } catch {}

    const result = {};
    for (const m of ALL_METRICS) {
      result[m.id] = dates.map(d => garminRange[d]?.[m.id] ?? fitbitRange[d]?.[m.id] ?? null);
    }
    _sparklineData = result;
  }

  // Tiny SVG sparkline path from an array of values (nulls = gaps)
  function sparklinePath(vals, w = 56, h = 24) {
    const pts = vals.map((v, i) => v != null ? [i, v] : null).filter(Boolean);
    if (pts.length < 2) return '';
    const xMax   = vals.length - 1;
    const ys     = pts.map(p => p[1]);
    const yMin   = Math.min(...ys), yMax = Math.max(...ys);
    const yRange = yMax - yMin || 1;
    const toX    = i => (i / xMax) * w;
    const toY    = v => h - ((v - yMin) / yRange) * (h - 4) - 2;
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p[0]).toFixed(1)},${toY(p[1]).toFixed(1)}`).join(' ');
  }

  // Mark insights stale when tab activates or range changes (so the next check loads them)
  $: { sleepInsightsRange; activeTab; if (activeTab === 'sleep') _insightsLoaded = false; }
  // Load whenever stale and on sleep tab (also fires after syncs set _insightsLoaded = false)
  $: if (activeTab === 'sleep' && !_insightsLoaded) loadSleepInsights();

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
  ];
  $: _wlActiveIdx  = Math.max(0, _wlTabList.indexOf(activeTab));
  $: _wlPillWidth  = `calc((100% - 8px) / ${_wlTabList.length})`;
  $: _wlPillLeft   = `calc(4px + ${_wlActiveIdx} * (100% - 8px) / ${_wlTabList.length})`;

  // Auto-correct activeTab when an integration's availability changes
  $: if (status !== null && withingsStatus !== null && garminStatus !== null) {
    const isActivityTab = activeTab === 'movement' || activeTab === 'sleep' || activeTab === 'heart';
    if (isActivityTab && !fitbitAvailable && !garminAvailable) activeTab = withingsAvailable ? 'body' : 'movement';
    if (activeTab === 'body' && !withingsAvailable) activeTab = (fitbitAvailable || garminAvailable) ? 'movement' : 'body';
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
    // Refresh readiness if on heart tab (today's values just changed)
    if (activeTab === 'heart') _readinessLoaded = false;
    // Load sparklines in background (not awaited — don't block date display)
    loadSparklines();
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
    _insightsLoaded  = false; // refresh sleep insights after sync
    _readinessLoaded = false; // refresh readiness after sync
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

  onDestroy(() => {});

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

  // ── Merged display data: only include data from enabled integrations ─────────
  $: displayData = (() => {
    const merged = {};
    if ($garminEnabled) {
      for (const [k, v] of Object.entries(garminData)) {
        if (v != null) merged[k] = v;
      }
    }
    if ($fitbitEnabled) {
      for (const [k, v] of Object.entries(data)) {
        if (v != null) {
          // Garmin sleep_score is device-measured; don't let Fitbit's estimate overwrite it
          if (k === 'sleep_score' && merged[k] != null) continue;
          merged[k] = v;
        }
      }
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
              {#each ALL_METRICS.filter(m => m.group === 'movement' && isVisible(m.id) && isSourceEnabled(m)) as m}
                {@const fmt = fmtMetric(m, displayData[m.id])}
                {@const spark = sparklinePath(_sparklineData[m.id] ?? [])}
                <div class="metric-card" class:no-data={fmt == null && !loadingData} class:celebrating={_celebratingMetrics.has(m.id)} title={m.desc}>
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
                  {#if spark}
                    <svg class="sparkline" viewBox="0 0 56 24" preserveAspectRatio="none">
                      <path d={spark} fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  {/if}
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
                        <div class="stage-seg" style="width:{pct.toFixed(1)}%;background:{stage.color}" title="{stage.label}: {fmtSleepStr(displayData[stage.key])}"></div>
                      {/if}
                    {/each}
                  </div>
                  <!-- Legend: each label floats at its segment's midpoint -->
                  <div class="stage-legend-bar">
                    {#each sleepStages as stage}
                      {@const pct = sleepTotal > 0 ? ((displayData[stage.key] || 0) / sleepTotal * 100) : 0}
                      {#if pct >= 3}
                        <div class="stage-leg-seg" style="width:{pct.toFixed(1)}%">
                          <span class="stage-leg-label" style="color:{stage.color}">{stage.label}</span>
                          <span class="stage-leg-val">{fmtSleepStr(displayData[stage.key])}</span>
                        </div>
                      {/if}
                    {/each}
                  </div>
                {:else}
                  <p class="text-3 text-sm" style="padding:0 0 8px">No stage data available</p>
                {/if}
              </div>
            {/if}
            <div class="metric-grid">
              {#each ALL_METRICS.filter(m => m.group === 'sleep' && isVisible(m.id) && isSourceEnabled(m)) as m}
                {@const fmt = fmtMetric(m, displayData[m.id])}
                {@const spark = sparklinePath(_sparklineData[m.id] ?? [])}
                <div class="metric-card" class:no-data={fmt == null && !loadingData} class:celebrating={_celebratingMetrics.has(m.id)} title={m.desc}>
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
                  {#if spark}
                    <svg class="sparkline" viewBox="0 0 56 24" preserveAspectRatio="none">
                      <path d={spark} fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  {/if}
                </div>
              {/each}
            </div>

            <!-- Sleep Debt card -->
            {#if sleepDebt != null}
              <div class="card sleep-insight-card" style="margin-bottom:10px">
                <div class="si-header">
                  <span class="material-symbols-rounded si-icon">battery_low</span>
                  <div class="si-title-wrap">
                    <span class="si-title">Sleep Debt</span>
                    <span class="si-sub">Last {sleepDebt.nights} nights</span>
                  </div>
                  <span class="si-value {sleepDebt.debtMin === 0 ? 'si-good' : sleepDebt.debtMin < 120 ? 'si-warn' : 'si-bad'}">
                    {sleepDebt.debtMin === 0 ? 'On track' : fmtSleepStr(sleepDebt.debtMin)}
                  </span>
                </div>
                {#if sleepDebt.debtMin > 0}
                  <p class="si-desc">
                    You're {fmtSleepStr(sleepDebt.debtMin)} short of your {fmtSleepStr(sleepDebt.goalMin)} sleep goal across the last {sleepDebt.nights} nights.
                    {#if sleepDebt.debtMin >= 120}Prioritize early bedtimes this week to recover.{:else}A consistent schedule should close the gap quickly.{/if}
                  </p>
                {:else}
                  <p class="si-desc">You're meeting your sleep goal. Keep it up!</p>
                {/if}
                <div class="si-range-chips">
                  {#each [7, 14] as n}
                    <button class="chip" class:chip-active={sleepInsightsRange === n} on:click={() => sleepInsightsRange = n}>{n}d</button>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Chronotype card -->
            {#if chronotype != null}
              <div class="card sleep-insight-card">
                <div class="si-header">
                  <span class="si-emoji">{chronotype.emoji ?? '⏳'}</span>
                  <div class="si-title-wrap">
                    <span class="si-title">{chronotype.label ?? 'Building Profile…'}</span>
                    <span class="si-sub">
                      {#if chronotype.label}Avg sleep midpoint: {fmtTimeMin(chronotype.midpointMin)} · {chronotype.nights} nights
                      {:else}{chronotype.nights}/{chronotype.needed} nights collected{/if}
                    </span>
                  </div>
                </div>
                {#if chronotype.label}
                  <p class="si-desc">{chronotype.desc}</p>
                {:else}
                  <p class="si-desc">Syncing more nights will unlock your chronotype. Once {chronotype.needed} nights of sleep timing are available your profile will appear here.</p>
                {/if}
              </div>
            {/if}

          <!-- ── Heart tab ── -->
          {:else if activeTab === 'heart'}
            <div class="metric-grid">
              {#each ALL_METRICS.filter(m => m.group === 'heart' && isVisible(m.id) && isSourceEnabled(m)) as m}
                {@const fmt = fmtMetric(m, displayData[m.id])}
                {@const spark = sparklinePath(_sparklineData[m.id] ?? [])}
                <div class="metric-card" class:no-data={fmt == null && !loadingData} class:celebrating={_celebratingMetrics.has(m.id)} title={m.desc}>
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
                  {#if spark}
                    <svg class="sparkline" viewBox="0 0 56 24" preserveAspectRatio="none">
                      <path d={spark} fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  {/if}
                </div>
              {/each}
            </div>
            <!-- Garmin-specific: Body Battery + Stress -->
            {#if $garminEnabled && garminStatus?.connected && GARMIN_METRICS.filter(m => isVisible(m.id)).some(m => garminData[m.id] != null)}
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

            <!-- Daily Readiness card -->
            {#if readiness != null}
              <div class="card sleep-insight-card readiness-card" style="margin-top:10px">
                {#if readiness.calibrating}
                  <div class="si-header">
                    <span class="material-symbols-rounded si-icon">battery_charging_full</span>
                    <div class="si-title-wrap">
                      <span class="si-title">Daily Readiness</span>
                      <span class="si-sub">Calibrating… {readiness.data_days}/{readiness.needed} days of HRV history</span>
                    </div>
                  </div>
                  <p class="si-desc">Keep syncing — once {readiness.needed} days of HRV data are collected, your personal baseline will unlock and your readiness score will appear here.</p>
                {:else}
                  <div class="readiness-header">
                    <div class="readiness-header-left">
                      <span class="material-symbols-rounded si-icon">battery_charging_full</span>
                      <div class="si-title-wrap">
                        <span class="si-title">Daily Readiness</span>
                        <span class="si-sub">
                          HRV baseline {readiness.hrv_baseline} ms{readiness.rhr_baseline != null ? ` · RHR baseline ${readiness.rhr_baseline} bpm` : ''} · {readiness.data_days} days
                        </span>
                      </div>
                    </div>
                    <div class="readiness-score-wrap">
                      <span class="readiness-score" style="color:{readiness.color}">{readiness.score}</span>
                      <span class="readiness-label" style="color:{readiness.color}">{readiness.label}</span>
                    </div>
                  </div>
                  <div class="readiness-drivers">
                    <div class="readiness-driver">
                      <span class="rd-label">HRV</span>
                      <span class="rd-val" style="color:{readiness.hrv_score >= 65 ? 'var(--accent)' : readiness.hrv_score >= 50 ? '#f59e0b' : '#ef4444'}">{readiness.hrv_score}</span>
                    </div>
                    <div class="readiness-driver">
                      <span class="rd-label">Resting HR</span>
                      <span class="rd-val" style="color:{readiness.rhr_score >= 65 ? 'var(--accent)' : readiness.rhr_score >= 50 ? '#f59e0b' : '#ef4444'}">{readiness.rhr_score}</span>
                    </div>
                    <div class="readiness-driver">
                      <span class="rd-label">Sleep</span>
                      <span class="rd-val" style="color:{readiness.sleep_score_used >= 65 ? 'var(--accent)' : readiness.sleep_score_used >= 50 ? '#f59e0b' : '#ef4444'}">{readiness.sleep_score_used}</span>
                    </div>
                    <div class="readiness-driver">
                      <span class="rd-label">Penalties</span>
                      {@const totalPenalty = readiness.activity_penalty + readiness.interaction_penalty}
                      <span class="rd-val" class:rd-penalty={totalPenalty > 0}>
                        {totalPenalty > 0 ? `−${totalPenalty}` : '—'}
                      </span>
                    </div>
                  </div>
                {/if}
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
          {#if isVisible('segmental_analysis') && ['muscle_mass_torso_kg','muscle_mass_left_leg_kg','muscle_mass_left_arm_kg','muscle_mass_right_leg_kg','muscle_mass_right_arm_kg','lean_mass_torso_kg','lean_mass_left_leg_kg','lean_mass_left_arm_kg','lean_mass_right_leg_kg','lean_mass_right_arm_kg'].some(k => withingsData[k] != null)}
            <div class="card" style="margin-top:12px;padding:16px">
              <div class="sleep-stages-header" style="margin-bottom:4px">
                <span class="material-symbols-rounded" style="color:var(--accent)">accessibility_new</span>
                <span class="sleep-stages-title">Segmental Analysis</span>
              </div>
              <p style="font-size:0.75rem;color:var(--text-3);margin:0 0 12px;line-height:1.4">
                <strong>Muscle</strong> = contractile muscle tissue. <strong>Lean</strong> = all non-fat tissue (muscle + bone + water). Lean is always higher than muscle. These values are absolute weights — percentages shown in the Withings app use a different calculation and will not match.
              </p>
              <div class="segmental-table">
                <div class="seg-header">
                  <span></span>
                  <span>Muscle</span>
                  <span>Lean</span>
                </div>
                {#each [
                  { label: 'Left Arm',  muscle: 'muscle_mass_left_arm_kg',  lean: 'lean_mass_left_arm_kg'  },
                  { label: 'Right Arm', muscle: 'muscle_mass_right_arm_kg', lean: 'lean_mass_right_arm_kg' },
                  { label: 'Torso',     muscle: 'muscle_mass_torso_kg',     lean: 'lean_mass_torso_kg'     },
                  { label: 'Left Leg',  muscle: 'muscle_mass_left_leg_kg',  lean: 'lean_mass_left_leg_kg'  },
                  { label: 'Right Leg', muscle: 'muscle_mass_right_leg_kg', lean: 'lean_mass_right_leg_kg' },
                ] as seg}
                  {#if withingsData[seg.muscle] != null || withingsData[seg.lean] != null}
                    {@const mKg = withingsData[seg.muscle]}
                    {@const lKg = withingsData[seg.lean]}
                    <div class="seg-row">
                      <span class="seg-label">{seg.label}</span>
                      <span class="seg-val">{mKg != null ? fmtWeight(mKg).value + ' ' + fmtWeight(mKg).unit : '—'}</span>
                      <span class="seg-val">{lKg != null ? fmtWeight(lKg).value + ' ' + fmtWeight(lKg).unit : '—'}</span>
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
  /* Sleep stage legend — proportional segments matching bar */
  .stage-legend-bar {
    display: flex;
    margin-top: 8px;
    overflow: hidden;
  }
  .stage-leg-seg {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    padding: 0 2px;
    overflow: hidden;
  }
  .stage-leg-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .stage-leg-val {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
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

  /* Chip styles */
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

  /* Sparkline */
  .sparkline {
    width: 100%;
    height: 24px;
    display: block;
    opacity: 0.6;
    margin-top: 4px;
  }

  /* Sleep Insight cards (Debt + Chronotype) */
  .sleep-insight-card {
    padding: 14px 16px;
  }
  .si-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .si-icon {
    font-size: 22px;
    color: var(--accent);
    flex-shrink: 0;
  }
  .si-emoji {
    font-size: 22px;
    line-height: 1;
    flex-shrink: 0;
  }
  .si-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
  }
  .si-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
  }
  .si-sub {
    font-size: 11px;
    color: var(--text-3);
  }
  .si-value {
    font-size: 16px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .si-good { color: var(--accent); }
  .si-warn { color: #f59e0b; }
  .si-bad  { color: #ef4444; }
  .si-desc {
    font-size: 13px;
    color: var(--text-2);
    line-height: 1.5;
    margin: 0 0 10px;
  }
  .si-range-chips {
    display: flex;
    gap: 6px;
  }

  /* Daily Readiness card */
  .readiness-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .readiness-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  .readiness-score-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
  }
  .readiness-score {
    font-size: 38px;
    font-weight: 800;
    line-height: 1;
  }
  .readiness-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 1px;
  }
  .readiness-drivers {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    background: var(--surface-2);
    border-radius: 8px;
    padding: 10px 8px;
  }
  .readiness-driver {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }
  .rd-label {
    font-size: 9px;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: center;
  }
  .rd-val {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-1);
  }
  .rd-penalty { color: #f59e0b; }

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
