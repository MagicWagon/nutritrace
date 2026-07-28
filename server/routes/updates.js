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

const CACHE_KEY_LATEST  = 'updates_server_latest';
const CACHE_KEY_CHECKED = 'updates_server_checked_at';
const CACHE_KEY_URL     = 'updates_server_notes_url';
const CACHE_TTL_MS      = 24 * 60 * 60 * 1000;

const GH_URL = 'https://api.github.com/repos/TraceApps/nutritrace/releases/latest';
const UA     = `TraceApps-NutriTrace-Server/${APP_VERSION}`;

function _getCfg(key) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return row?.value || null;
}
function _setCfg(key, value) {
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

async function _fetchLatest() {
  const res = await fetch(GH_URL, {
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
 * GET /api/updates/server-status
 * Admin-only. Returns:
 *   { current, latest, available, notes_url, checked_at }
 * Cached 24h; falls back to cached value if GH is unreachable.
 */
router.get('/server-status', requireAuth, requireAdmin, wrap(async (req, res) => {
  const now = Date.now();
  const checkedAtRaw = _getCfg(CACHE_KEY_CHECKED);
  const checkedAtMs  = checkedAtRaw ? Date.parse(checkedAtRaw) : 0;
  const cached       = _getCfg(CACHE_KEY_LATEST);
  const cachedUrl    = _getCfg(CACHE_KEY_URL);

  let latest    = cached;
  let notesUrl  = cachedUrl || '';
  let checkedAt = checkedAtRaw;

  if (!cached || now - checkedAtMs > CACHE_TTL_MS) {
    try {
      const fresh = await _fetchLatest();
      latest    = fresh.tag;
      notesUrl  = fresh.notesUrl;
      checkedAt = new Date().toISOString();
      _setCfg(CACHE_KEY_LATEST, latest);
      _setCfg(CACHE_KEY_URL, notesUrl);
      _setCfg(CACHE_KEY_CHECKED, checkedAt);
    } catch (e) {
      // Serve stale cache on failure.
      if (!cached) return res.status(503).json({ error: 'GitHub API unreachable and no cached version.' });
    }
  }

  const available = !!(latest && APP_VERSION && _semverGt(latest, APP_VERSION));
  res.json({
    current:    APP_VERSION,
    latest,
    available,
    notes_url:  notesUrl,
    checked_at: checkedAt,
  });
}));

function _semverGt(a, b) {
  const pa = /^v?(\d+)\.(\d+)\.(\d+)/.exec(a || '');
  const pb = /^v?(\d+)\.(\d+)\.(\d+)/.exec(b || '');
  if (!pa || !pb) return false;
  for (let i = 1; i <= 3; i++) {
    const na = parseInt(pa[i], 10);
    const nb = parseInt(pb[i], 10);
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

export default router;
