/**
 * updates.js — server-side update-status endpoint.
 *
 * Admin-only. Reports the running server's APP_VERSION and the latest
 * release tagged on GitHub, so the PWA Settings page can show admins a
 * "your server is behind" banner with a copy-paste `docker-compose pull`
 * command. Result is cached in app_config for 24h to stay under the
 * unauthenticated GitHub API rate limit (60/hr per IP).
 *
 * Docker `:latest` deployments already auto-track new releases; this
 * banner tells the admin WHEN a `docker-compose pull` would actually
 * pick something up. Admins on pinned tags (`:1.0` / `:1`) can see when
 * a new patch is available too.
 */
import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { APP_VERSION } from './version-source.js';

const router = Router();

// Cache buckets keyed per channel so switching Stable ↔ Beta doesn't
// return stale data from the other channel. Both TTLs are 24h.
const CACHE_KEYS = {
  stable: {
    latest:    'updates_server_latest',
    checkedAt: 'updates_server_checked_at',
    notesUrl:  'updates_server_notes_url',
  },
  beta: {
    latest:    'updates_server_latest_beta',
    checkedAt: 'updates_server_checked_at_beta',
    notesUrl:  'updates_server_notes_url_beta',
  },
};
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const GH_URLS = {
  stable: 'https://api.github.com/repos/TraceApps/nutritrace/releases/latest',
  beta:   'https://api.github.com/repos/TraceApps/nutritrace/releases/tags/dev-latest',
};
const UA = `TraceApps-NutriTrace-Server/${APP_VERSION}`;

function _getCfg(key) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return row?.value || null;
}
function _setCfg(key, value) {
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

async function _fetchLatest(channel) {
  const url = GH_URLS[channel] || GH_URLS.stable;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  return {
    tag: data.tag_name || '',
    notesUrl: data.html_url || '',
  };
}

/**
 * GET /api/updates/server-status?channel=stable|beta
 * Admin-only. Returns:
 *   { current, latest, channel, available, notes_url, checked_at }
 * Cached 24h per channel; falls back to cached value if GH is unreachable.
 * Channel maps to a GH release: stable → /releases/latest,
 * beta → /releases/tags/dev-latest.
 */
router.get('/server-status', requireAuth, requireAdmin, wrap(async (req, res) => {
  const channel = (req.query.channel === 'beta') ? 'beta' : 'stable';
  const keys = CACHE_KEYS[channel];

  const now          = Date.now();
  const checkedAtRaw = _getCfg(keys.checkedAt);
  const checkedAtMs  = checkedAtRaw ? Date.parse(checkedAtRaw) : 0;
  const cached       = _getCfg(keys.latest);
  const cachedUrl    = _getCfg(keys.notesUrl);

  let latest    = cached;
  let notesUrl  = cachedUrl || '';
  let checkedAt = checkedAtRaw;

  if (!cached || now - checkedAtMs > CACHE_TTL_MS) {
    try {
      const fresh = await _fetchLatest(channel);
      latest    = fresh.tag;
      notesUrl  = fresh.notesUrl;
      checkedAt = new Date().toISOString();
      _setCfg(keys.latest, latest);
      _setCfg(keys.notesUrl, notesUrl);
      _setCfg(keys.checkedAt, checkedAt);
    } catch (e) {
      // Serve stale cache on failure.
      if (!cached) return res.status(503).json({ error: 'GitHub API unreachable and no cached version.' });
    }
  }

  const available = !!(latest && APP_VERSION && APP_VERSION !== 'unknown' && _semverGt(latest, APP_VERSION));
  res.json({
    current:    APP_VERSION,
    latest,
    channel,
    available,
    notes_url:  notesUrl,
    checked_at: checkedAt,
  });
}));

// Semver §11 precedence with pre-release identifier support so a
// Beta channel user on `v1.1.0-dev.5` doesn't get pinged that
// `v1.1.0-dev.1` is newer. Mirrors the client-side compareSemver in
// src/lib/updates.js — keep in sync if you change one, change both.
function _parseSemver(tag) {
  if (!tag) return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(tag);
  if (!m) return null;
  const base = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  const pre  = m[4]
    ? m[4].split('.').map(s => /^\d+$/.test(s) ? parseInt(s, 10) : s)
    : [];
  return { base, pre };
}

function _semverGt(a, b) {
  const pa = _parseSemver(a);
  const pb = _parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa.base[i] > pb.base[i]) return true;
    if (pa.base[i] < pb.base[i]) return false;
  }
  // Base equal → empty pre-release (final release) beats any pre-release.
  if (pa.pre.length === 0 && pb.pre.length === 0) return false;
  if (pa.pre.length === 0) return true;
  if (pb.pre.length === 0) return false;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const ai = pa.pre[i], bi = pb.pre[i];
    if (ai === undefined) return false;
    if (bi === undefined) return true;
    if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai > bi) return true;
      if (ai < bi) return false;
      continue;
    }
    if (typeof ai === 'number') return false;
    if (typeof bi === 'number') return true;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

export default router;
