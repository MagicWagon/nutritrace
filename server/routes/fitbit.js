import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// In single-user mode, use user_id = 0 (auto-increment users start at 1, so no collision)
const uid = req => userMgmtActive() ? req.user.id : 0;

// In-memory PKCE store: state → { codeVerifier, userId, expiresAt }
// Only used during the brief OAuth redirect dance (~10 min window)
const _pkce = new Map();

function _cfg(key) {
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
      'Authorization': 'Basic ' + Buffer.from(`${_cfg('fitbit_client_id')}:${_cfg('fitbit_client_secret')}`).toString('base64'),
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

// ── GET /status ──────────────────────────────────────────────────────────────
router.get('/status', wrap((req, res) => {
  const u = uid(req);
  const tokens = _getTokens(u);
  const clientId = _cfg('fitbit_client_id');
  res.json({
    connected:     !!tokens,
    configured:    !!clientId,
    fitbitUserId:  tokens?.fitbit_user_id || null,
    expiresAt:     tokens?.expires_at     || null,
  });
}));

// ── GET /authorize — returns Fitbit OAuth URL using PKCE ─────────────────────
router.get('/authorize', wrap((req, res) => {
  const clientId   = _cfg('fitbit_client_id');
  const redirectUri = _cfg('fitbit_redirect_uri');
  if (!clientId || !redirectUri) {
    return res.status(400).json({ error: 'Fitbit client_id and redirect_uri must be configured in Settings → Labs.' });
  }

  const u = uid(req);
  const codeVerifier  = randomBytes(64).toString('base64url').slice(0, 128);
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state         = randomBytes(16).toString('hex');

  // Store for 10 minutes then auto-expire
  _pkce.set(state, { codeVerifier, userId: u, expiresAt: Date.now() + 10 * 60 * 1000 });
  for (const [k, v] of _pkce) { if (v.expiresAt < Date.now()) _pkce.delete(k); }

  const url = new URL('https://www.fitbit.com/oauth2/authorize');
  url.searchParams.set('response_type',          'code');
  url.searchParams.set('client_id',              clientId);
  url.searchParams.set('redirect_uri',           redirectUri);
  url.searchParams.set('scope',                  'activity heartrate sleep oxygen_saturation respiratory_rate profile');
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
    return res.redirect(`/#/wellness?error=${encodeURIComponent(error)}`);
  }

  const pkce = _pkce.get(state);
  if (!pkce || pkce.expiresAt < Date.now()) {
    _pkce.delete(state);
    return res.redirect('/#/wellness?error=invalid_state');
  }
  _pkce.delete(state);

  const clientId    = _cfg('fitbit_client_id');
  const clientSecret = _cfg('fitbit_client_secret');
  const redirectUri  = _cfg('fitbit_redirect_uri');

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
    return res.redirect(`/#/wellness?error=${encodeURIComponent('Token exchange failed: ' + body.slice(0, 80))}`);
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

  res.redirect('/#/wellness?connected=1');
}));

// ── POST /sync — fetch all Fitbit metrics for a date ─────────────────────────
router.post('/sync', wrap(async (req, res) => {
  const u = uid(req);
  const dateStr = (req.body.date || new Date().toISOString().slice(0, 10));

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

  // Breathing rate
  try {
    const d = await _get(u, `/1/user/-/br/date/${dateStr}.json`);
    metrics.respiratory_rate = d.br?.[0]?.value?.breathingRate ?? null;
  } catch (e) { errors.push('breathing: ' + e.message); }

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

  res.json({ ok: true, date: dateStr, metrics, errors });
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
