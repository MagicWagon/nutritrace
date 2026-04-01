import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';
import db from '../db.js';
import { wrap, logger } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// In single-user mode, use user_id = 0 (auto-increment users start at 1, so no collision)
const uid = req => userMgmtActive() ? req.user.id : 0;

// DB-backed PKCE helpers — survive server restarts during the OAuth redirect dance
function _pkceSet(state, userId, codeVerifier) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(`INSERT OR REPLACE INTO oauth_state (state, user_id, provider, data, expires_at)
              VALUES (?, ?, 'fitbit', ?, ?)`).run(state, userId, JSON.stringify({ codeVerifier }), expiresAt);
  // Clean up any expired states
  db.prepare(`DELETE FROM oauth_state WHERE expires_at < datetime('now')`).run();
}
function _pkceGet(state) {
  const row = db.prepare(`SELECT * FROM oauth_state WHERE state = ? AND provider = 'fitbit'`).get(state);
  if (!row) return null;
  db.prepare(`DELETE FROM oauth_state WHERE state = ?`).run(state);
  if (row.expires_at < new Date().toISOString()) return null;
  const data = JSON.parse(row.data);
  return { codeVerifier: data.codeVerifier, userId: row.user_id };
}

// Read credential: user_settings first (multi-user), app_config fallback (single-user / migration)
function _userCfg(key, userId) {
  if (userMgmtActive() && userId != null && userId !== 0) {
    const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key);
    if (row?.value != null && row.value !== '' && row.value !== '""') {
      try { return JSON.parse(row.value) || ''; } catch { return row.value; }
    }
  }
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return row?.value || '';
}

function _getTokens(userId) {
  return db.prepare('SELECT * FROM fitbit_tokens WHERE user_id = ?').get(userId);
}

async function _refresh(userId) {
  const tokens = _getTokens(userId);
  if (!tokens) throw Object.assign(new Error('Not connected to Fitbit'), { status: 401 });

  const res = await fetch('https://api.fitbit.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${_userCfg('fitbit_client_id', userId)}:${_userCfg('fitbit_client_secret', userId)}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });

  if (!res.ok) {
    db.prepare('DELETE FROM fitbit_tokens WHERE user_id = ?').run(userId);
    throw Object.assign(new Error('Fitbit token revoked — please reconnect.'), { status: 401 });
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  db.prepare(`
    UPDATE fitbit_tokens SET access_token=?, refresh_token=?, expires_at=? WHERE user_id=?
  `).run(data.access_token, data.refresh_token, expiresAt, userId);
  return data.access_token;
}

async function _token(userId) {
  const tokens = _getTokens(userId);
  if (!tokens) throw Object.assign(new Error('Not connected to Fitbit'), { status: 401 });
  // Refresh if expiring within 5 minutes
  if (new Date(tokens.expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
    return _refresh(userId);
  }
  return tokens.access_token;
}

async function _get(userId, path) {
  let tok = await _token(userId);
  let res = await fetch(`https://api.fitbit.com${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (res.status === 401) {
    tok = await _refresh(userId);
    res = await fetch(`https://api.fitbit.com${path}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Fitbit API ${res.status}: ${body.slice(0, 120)}`);
  }
  return res.json();
}

// ── GET /config — read user's own credentials (client_id + redirect_uri only, no secret) ──
router.get('/config', wrap((req, res) => {
  const u = uid(req);
  res.json({
    client_id:    _userCfg('fitbit_client_id',    u),
    redirect_uri: _userCfg('fitbit_redirect_uri', u),
  });
}));

// ── PUT /config — save user's own credentials ─────────────────────────────────
router.put('/config', wrap((req, res) => {
  const { client_id, client_secret, redirect_uri } = req.body;
  if (userMgmtActive() && req.user) {
    const save = db.prepare('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)');
    db.transaction(() => {
      if (client_id     !== undefined) save.run(req.user.id, 'fitbit_client_id',     JSON.stringify(client_id));
      if (client_secret !== undefined) save.run(req.user.id, 'fitbit_client_secret', JSON.stringify(client_secret));
      if (redirect_uri  !== undefined) save.run(req.user.id, 'fitbit_redirect_uri',  JSON.stringify(redirect_uri));
    })();
  } else {
    const save = db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)');
    db.transaction(() => {
      if (client_id     !== undefined) save.run('fitbit_client_id',     client_id);
      if (client_secret !== undefined) save.run('fitbit_client_secret', client_secret);
      if (redirect_uri  !== undefined) save.run('fitbit_redirect_uri',  redirect_uri);
    })();
  }
  res.json({ ok: true });
}));

// ── GET /status ──────────────────────────────────────────────────────────────
router.get('/status', wrap((req, res) => {
  const u = uid(req);
  const tokens = _getTokens(u);
  const clientId = _userCfg('fitbit_client_id', u);
  const lastSync = db.prepare('SELECT MAX(synced_at) as ts FROM wellness_data WHERE user_id=? AND source=?').get(u, 'fitbit');
  res.json({
    connected:     !!tokens,
    configured:    !!clientId,
    fitbitUserId:  tokens?.fitbit_user_id || null,
    expiresAt:     tokens?.expires_at     || null,
    lastSyncedAt:  lastSync?.ts           || null,
  });
}));

// ── GET /authorize — returns Fitbit OAuth URL using PKCE ─────────────────────
router.get('/authorize', wrap((req, res) => {
  const u = uid(req);
  const clientId   = _userCfg('fitbit_client_id',    u);
  const redirectUri = _userCfg('fitbit_redirect_uri', u);
  if (!clientId || !redirectUri) {
    return res.status(400).json({ error: 'Fitbit client_id and redirect_uri must be configured in Settings → Wellness.' });
  }

  const codeVerifier  = randomBytes(64).toString('base64url').slice(0, 128);
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state         = randomBytes(16).toString('hex');

  _pkceSet(state, u, codeVerifier);

  const url = new URL('https://www.fitbit.com/oauth2/authorize');
  url.searchParams.set('response_type',          'code');
  url.searchParams.set('client_id',              clientId);
  url.searchParams.set('redirect_uri',           redirectUri);
  url.searchParams.set('scope',                  'activity heartrate sleep oxygen_saturation respiratory_rate cardio_fitness temperature profile');
  url.searchParams.set('code_challenge',         codeChallenge);
  url.searchParams.set('code_challenge_method',  'S256');
  url.searchParams.set('state',                  state);
  url.searchParams.set('expires_in',             '604800'); // 7-day token

  res.json({ url: url.toString() });
}));

// ── GET /callback — Fitbit redirects here after authorization ────────────────
router.get('/callback', wrap(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?fitbit=error&msg=${encodeURIComponent(error)}#/wellness`);
  }

  const pkce = _pkceGet(state);
  if (!pkce) {
    return res.redirect('/?fitbit=error&msg=invalid_state#/wellness');
  }

  const clientId    = _userCfg('fitbit_client_id',     pkce.userId);
  const clientSecret = _userCfg('fitbit_client_secret', pkce.userId);
  const redirectUri  = _userCfg('fitbit_redirect_uri',  pkce.userId);

  const tokenRes = await fetch('https://api.fitbit.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      code_verifier: pkce.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    return res.redirect(`/?fitbit=error&msg=${encodeURIComponent('Token exchange failed: ' + body.slice(0, 80))}#/wellness`);
  }

  const td = await tokenRes.json();
  const expiresAt = new Date(Date.now() + td.expires_in * 1000).toISOString();

  db.prepare(`
    INSERT INTO fitbit_tokens (user_id, access_token, refresh_token, expires_at, fitbit_user_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      access_token   = excluded.access_token,
      refresh_token  = excluded.refresh_token,
      expires_at     = excluded.expires_at,
      fitbit_user_id = excluded.fitbit_user_id
  `).run(pkce.userId, td.access_token, td.refresh_token, expiresAt, td.user_id || null);

  res.redirect('/?fitbit=connected#/wellness');
}));

// ── Helper: sync a single date, return { metrics, errors } ───────────────────
async function _syncDate(u, dateStr) {
  const metrics = {};
  const errors  = [];

  // Activities (steps, distance, floors, active minutes, calories)
  try {
    const d = await _get(u, `/1/user/-/activities/date/${dateStr}.json`);
    const s = d.summary || {};
    metrics.steps          = s.steps ?? null;
    metrics.distance_km    = s.distances?.find(x => x.activity === 'total')?.distance ?? null;
    metrics.floors         = s.floors ?? null;
    metrics.active_minutes = ((s.fairlyActiveMinutes ?? 0) + (s.veryActiveMinutes ?? 0)) || null;
    metrics.calories_out   = s.caloriesOut ?? null;
  } catch (e) { errors.push('activities: ' + e.message); }

  // Sleep
  try {
    const d = await _get(u, `/1.2/user/-/sleep/date/${dateStr}.json`);
    const main = (d.sleep || []).find(s => s.isMainSleep) || d.sleep?.[0];
    if (main) {
      metrics.sleep_duration_min = main.minutesAsleep ?? null;
      metrics.sleep_efficiency   = main.efficiency    ?? null;
      const stg = main.levels?.summary;
      metrics.sleep_deep_min  = stg?.deep?.minutes  ?? null;
      metrics.sleep_light_min = stg?.light?.minutes ?? null;
      metrics.sleep_rem_min   = stg?.rem?.minutes   ?? null;
      metrics.sleep_wake_min  = stg?.wake?.minutes  ?? null;
      // Sleep timing for chronotype — Fitbit returns local time strings e.g. "2024-01-15T22:30:00.000"
      if (main.startTime) {
        const [, hh, mm] = main.startTime.match(/T(\d{2}):(\d{2})/) || [];
        if (hh != null) metrics.sleep_start_min = parseInt(hh) * 60 + parseInt(mm);
      }
      if (main.endTime) {
        const [, hh, mm] = main.endTime.match(/T(\d{2}):(\d{2})/) || [];
        if (hh != null) metrics.sleep_end_min = parseInt(hh) * 60 + parseInt(mm);
      }
    }
  } catch (e) { errors.push('sleep: ' + e.message); }

  // Resting heart rate
  try {
    const d = await _get(u, `/1/user/-/activities/heart/date/${dateStr}/1d.json`);
    metrics.resting_hr = d['activities-heart']?.[0]?.value?.restingHeartRate ?? null;
  } catch (e) { errors.push('heart: ' + e.message); }

  // HRV
  try {
    const d = await _get(u, `/1/user/-/hrv/date/${dateStr}.json`);
    metrics.hrv_daily_rmssd = d.hrv?.[0]?.value?.dailyRmssd ?? null;
  } catch (e) { errors.push('hrv: ' + e.message); }

  // SpO2
  try {
    const d = await _get(u, `/1/user/-/spo2/date/${dateStr}.json`);
    metrics.spo2_avg = d.value?.avg ?? null;
  } catch (e) { errors.push('spo2: ' + e.message); }

  // Skin temperature variation (Pixel Watch / Fitbit Sense/Versa 3+ only)
  try {
    const d = await _get(u, `/1/user/-/temp/skin/date/${dateStr}.json`);
    metrics.skin_temp_variation = d.tempSkin?.[0]?.value?.nightlyRelative ?? null;
  } catch (e) { errors.push('skin_temp: ' + e.message); }

  // Breathing rate
  try {
    const d = await _get(u, `/1/user/-/br/date/${dateStr}.json`);
    metrics.respiratory_rate = d.br?.[0]?.value?.breathingRate ?? null;
  } catch (e) { errors.push('breathing: ' + e.message); }

  // Active Zone Minutes
  try {
    const d = await _get(u, `/1/user/-/activities/active-zone-minutes/date/${dateStr}/1d.json`);
    metrics.active_zone_minutes = d['activities-active-zone-minutes']?.[0]?.value?.activeZoneMinutes ?? null;
  } catch (e) { errors.push('azm: ' + e.message); }

  // Cardio Fitness Score (Fitbit returns a range string like "39-43")
  // Store midpoint as vo2_max (numeric, used for charting/goals) and raw
  // range string as vo2_max_range (used for display)
  try {
    const d = await _get(u, `/1/user/-/cardioscore/date/${dateStr}.json`);
    const raw = d['cardioScore']?.[0]?.value?.vo2Max ?? null;
    if (typeof raw === 'number') {
      metrics.vo2_max = raw;
    } else if (typeof raw === 'string' && raw.includes('-')) {
      const [lo, hi] = raw.split('-').map(Number);
      metrics.vo2_max       = (lo + hi) / 2;
      metrics.vo2_max_range = raw.trim(); // e.g. "39-43"
    } else {
      metrics.vo2_max = raw != null ? Number(raw) : null;
    }
  } catch (e) { errors.push('vo2max: ' + e.message); }

  // Sleep Score — not in public Fitbit API; estimated from sleep components.
  // Formula: Duration (0-30) + Quality/deep+REM% (0-40) + QualBonus for >35% (0-8)
  //        + SpO2 restoration (0-15) + HRV (0-15) + Efficiency bonus (0-3)
  // Duration target: 455min (~7.5h) — Fitbit is generous with 7+ hours.
  // SpO2 null default: 11 (Fitbit doesn't penalize missing SpO2 heavily).
  // Efficiency bonus: rewards high sleep efficiency (>85%) up to 3 pts.
  if (metrics.sleep_duration_min != null) {
    const dur  = metrics.sleep_duration_min;
    const deep = metrics.sleep_deep_min ?? 0;
    const rem  = metrics.sleep_rem_min  ?? 0;
    const spo2 = metrics.spo2_avg;
    const hrv  = metrics.hrv_daily_rmssd;
    const eff  = metrics.sleep_efficiency ?? null;
    const durPts     = Math.min(30, (dur / 470) * 30);
    const deepRemPct = dur > 0 ? (deep + rem) / dur : 0;
    const qualPts    = Math.min(40, deepRemPct / 0.25 * 40);
    const qualBonus  = Math.min(8, Math.max(0, (deepRemPct - 0.35) / 0.15 * 8));
    const spo2Pts    = spo2 != null ? Math.min(15, Math.max(0, (spo2 - 90) / 5 * 15)) : 11;
    const hrvPts     = hrv  != null ? Math.min(15, Math.max(0, (hrv  -  5) / 45 * 15)) : 10;
    const effPts     = eff  != null ? Math.min(1.5, Math.max(0, (eff - 85) * 0.15)) : 0;
    metrics.sleep_score = Math.min(100, Math.round(durPts + qualPts + qualBonus + spo2Pts + hrvPts + effPts));
    logger.debug(`[fitbit] sleep_score ${dateStr}: dur=${dur}m deep=${deep}m rem=${rem}m spo2=${spo2} hrv=${hrv} eff=${eff} → ${durPts.toFixed(1)}+${qualPts.toFixed(1)}+${qualBonus.toFixed(1)}+${spo2Pts.toFixed(1)}+${hrvPts.toFixed(1)}+${effPts.toFixed(1)}=${metrics.sleep_score}`);
  }

  // Upsert all metrics
  const upsert = db.prepare(`
    INSERT INTO wellness_data (user_id, date, source, metric_type, value, synced_at)
    VALUES (?, ?, 'fitbit', ?, ?, datetime('now'))
    ON CONFLICT(user_id, date, source, metric_type) DO UPDATE SET
      value = excluded.value, synced_at = excluded.synced_at
  `);
  db.transaction(() => {
    for (const [type, value] of Object.entries(metrics)) {
      if (value != null) upsert.run(u, dateStr, type, value);
    }
  })();

  logger.debug(`[fitbit] ${dateStr} readiness inputs: hrv=${metrics.hrv_daily_rmssd} rhr=${metrics.resting_hr} sleep=${metrics.sleep_score} cal=${metrics.calories_out} sleep_eff=${metrics.sleep_efficiency}`);

  // Snapshot readiness + stress scores at sync time so they don't drift
  _snapshotScores(u, dateStr);

  if (errors.length) logger.warn(`[fitbit] sync errors for ${dateStr}:`, errors);
  return { metrics, errors };
}

// ── Server-side readiness & stress score snapshot ─────────────────────────────
// Mirrors the client-side formulas in Wellness.svelte so stored scores don't
// change retroactively as the 30-day baseline shifts.
function _snapshotScores(userId, dateStr) {
  const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const _mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Load 30-day history (excluding today)
  const history = db.prepare(
    `SELECT date, metric_type, value FROM wellness_data
     WHERE user_id = ? AND source = 'fitbit' AND date >= date(?, '-30 days') AND date < ?
     ORDER BY date`
  ).all(userId, dateStr, dateStr);

  // Group by date
  const byDate = {};
  for (const row of history) {
    byDate[row.date] ??= {};
    byDate[row.date][row.metric_type] = row.value;
  }
  const days = Object.values(byDate);

  // Today's values
  const todayRows = db.prepare(
    `SELECT metric_type, value FROM wellness_data WHERE user_id = ? AND source = 'fitbit' AND date = ?`
  ).all(userId, dateStr);
  const today = {};
  for (const r of todayRows) today[r.metric_type] = r.value;

  const todayHrv = today.hrv_daily_rmssd;
  const todayRhr = today.resting_hr;
  const todaySleep = today.sleep_score;
  const todayCal = today.calories_out;

  if (todayHrv == null) return; // can't calculate without HRV

  // Baselines (history only, not today)
  const histHrv = days.map(d => d.hrv_daily_rmssd).filter(v => v != null);
  if (histHrv.length < 2) return; // not enough data

  const hrvBaseline = _mean(histHrv);
  const rhrVals = [...days.map(d => d.resting_hr).filter(v => v != null), ...(todayRhr != null ? [todayRhr] : [])];
  const rhrBaseline = rhrVals.length >= 3 ? _mean(rhrVals) : null;

  // ── Readiness ─────────────────────────────────────────────────
  const hrvRatio = todayHrv / hrvBaseline;
  let hrv_score = hrvRatio >= 1.0 ? 65 + (hrvRatio - 1.0) * 80 : 65 - (1.0 - hrvRatio) * 350;
  hrv_score = _clamp(hrv_score, 0, 100);

  let rhr_score = 55;
  if (rhrBaseline != null && todayRhr != null) {
    rhr_score = 55 + (rhrBaseline / todayRhr - 1.0) * 150;
    rhr_score = _clamp(rhr_score, 0, 100);
  }

  const sleepBase = todaySleep != null ? todaySleep : 75;
  const sleep_cap = (todaySleep != null && todaySleep < 50) ? 65 : 100;

  // Activity penalty
  const calHistory7 = days.slice(-7).map(d => d.calories_out).filter(v => v != null);
  let activity_penalty = 0;
  if (calHistory7.length >= 3 && todayCal != null) {
    const calMean = _mean(calHistory7);
    const spikeRatio = todayCal / calMean;
    if (spikeRatio > 1.25) activity_penalty += (spikeRatio - 1.25) * 40;
    const daysAbove = days.slice(-3).filter(d => d.calories_out != null && d.calories_out > calMean * 1.1).length;
    activity_penalty += daysAbove * 3;
    activity_penalty = _clamp(activity_penalty, 0, 20);
  }

  // Interaction penalty
  let interaction_penalty = 0;
  if (hrvRatio < 1.0 && rhrBaseline != null && todayRhr != null && todayRhr > rhrBaseline) {
    interaction_penalty = (1.0 - hrvRatio) * (todayRhr - rhrBaseline) * 30;
    interaction_penalty = _clamp(interaction_penalty, 0, 10);
  }

  let readiness = (0.65 * hrv_score) + (0.20 * rhr_score) + (0.10 * sleepBase) - activity_penalty - interaction_penalty;
  readiness = Math.min(_clamp(Math.round(readiness), 1, 100), sleep_cap);

  // ── Stress ────────────────────────────────────────────────────
  function _rawStress(hrv, rhr, sleep) {
    const r = hrv / hrvBaseline;
    let h_s = 75 + (r - 1.0) * 120;
    h_s = _clamp(h_s, 0, 100);
    let r_s = 75;
    if (rhrBaseline != null && rhr != null) {
      r_s = 75 + (rhrBaseline / rhr - 1.0) * 80;
      r_s = _clamp(r_s, 0, 100);
    }
    const sl = sleep != null ? sleep : 75;
    return (0.40 * h_s) + (0.35 * sl) + (0.15 * r_s) + 10;
  }

  const todayRaw = _rawStress(todayHrv, todayRhr, todaySleep);
  // Smoothed from history
  const histStress = days.map(d => {
    if (d.hrv_daily_rmssd == null) return null;
    return _rawStress(d.hrv_daily_rmssd, d.resting_hr, d.sleep_score);
  }).filter(v => v != null);

  let stress;
  if (histStress.length >= 3) {
    const smoothed = _mean(histStress.slice(-7));
    stress = Math.round(0.65 * smoothed + 0.35 * todayRaw);
  } else {
    stress = Math.round(todayRaw);
  }
  stress = _clamp(stress, 1, 100);

  // Store both scores
  const upsert = db.prepare(`
    INSERT INTO wellness_data (user_id, date, source, metric_type, value, synced_at)
    VALUES (?, ?, 'fitbit', ?, ?, datetime('now'))
    ON CONFLICT(user_id, date, source, metric_type) DO UPDATE SET
      value = excluded.value, synced_at = excluded.synced_at
  `);
  upsert.run(userId, dateStr, 'readiness_score', readiness);
  upsert.run(userId, dateStr, 'stress_score', stress);
  logger.debug(`[fitbit] ${dateStr} snapshot: readiness=${readiness} stress=${stress}`);
}

// ── POST /sync — fetch Fitbit metrics for a date or date range ────────────────
// Body: { date? } for single day  OR  { from, to } for a range
// Rate limit: Fitbit allows 150 req/hr (6 req/day → max 25 days/hr).
// For range syncs we delay 250ms between days; on 429 we stop early.
router.post('/sync', wrap(async (req, res) => {
  const u = uid(req);
  const today = new Date().toISOString().slice(0, 10);

  const { from, to } = req.body;

  // Single-day mode
  if (!from || !to) {
    const dateStr = req.body.date || today;
    const { metrics, errors } = await _syncDate(u, dateStr);
    return res.json({ ok: true, date: dateStr, metrics, errors });
  }

  // Range mode — iterate from → to inclusive
  const start = new Date(from + 'T12:00:00');
  const end   = new Date(to   + 'T12:00:00');
  if (isNaN(start) || isNaN(end) || start > end) {
    return res.status(400).json({ error: 'Invalid date range' });
  }
  // Cap at 365 days to prevent accidental multi-year syncs
  const dayDiff = Math.round((end - start) / 86400000);
  if (dayDiff > 365) return res.status(400).json({ error: 'Range cannot exceed 365 days' });

  const results = { synced: 0, errors: [], rateLimited: false };
  const cur = new Date(start);

  while (cur <= end) {
    const ds = cur.toISOString().slice(0, 10);
    try {
      const { errors } = await _syncDate(u, ds);
      results.synced++;
      if (errors.length) results.errors.push({ date: ds, errors });
    } catch (e) {
      if (e.message?.includes('429')) {
        results.rateLimited = true;
        break;
      }
      results.errors.push({ date: ds, errors: [e.message] });
    }
    cur.setDate(cur.getDate() + 1);
    if (cur <= end) await new Promise(r => setTimeout(r, 250)); // throttle
  }

  res.json({ ok: true, from, to, ...results });
}));

// ── GET /data — return stored wellness data ───────────────────────────────────
router.get('/data', wrap((req, res) => {
  const u = uid(req);
  const { date, from, to } = req.query;

  let rows;
  if (date) {
    rows = db.prepare('SELECT * FROM wellness_data WHERE user_id=? AND date=? AND source=?')
              .all(u, date, 'fitbit');
  } else {
    const start = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const end   = to   || new Date().toISOString().slice(0, 10);
    rows = db.prepare('SELECT * FROM wellness_data WHERE user_id=? AND date>=? AND date<=? AND source=? ORDER BY date')
              .all(u, start, end, 'fitbit');
  }

  // Group by date → { [date]: { [metric_type]: value } }
  const byDate = {};
  for (const row of rows) {
    byDate[row.date] ??= {};
    byDate[row.date][row.metric_type] = row.value;
  }
  res.json(byDate);
}));

// ── DELETE /disconnect ────────────────────────────────────────────────────────
router.delete('/disconnect', wrap((req, res) => {
  db.prepare('DELETE FROM fitbit_tokens WHERE user_id=?').run(uid(req));
  res.json({ ok: true });
}));

export default router;
