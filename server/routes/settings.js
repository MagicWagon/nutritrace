import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/settings — return all user settings (empty object in single-user mode)
router.get('/', wrap((req, res) => {
  if (!userMgmtActive() || !req.user) return res.json({});
  const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ? AND deleted_at IS NULL').all(req.user.id);
  const out = {};
  for (const { key, value } of rows) {
    try { out[key] = JSON.parse(value); } catch { out[key] = value; }
  }
  res.json(out);
}));

// PUT /api/settings — upsert one setting
router.put('/', wrap((req, res) => {
  if (!userMgmtActive() || !req.user) return res.json({ ok: true });
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  db.prepare(`INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), deleted_at = NULL`)
    .run(req.user.id, key, JSON.stringify(value));
  res.json({ ok: true });
}));

// DELETE /api/settings — clear all settings for the current user
router.delete('/', wrap((req, res) => {
  if (userMgmtActive() && req.user) {
    db.prepare(`UPDATE user_settings SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?`).run(req.user.id);
  }
  res.json({ ok: true });
}));

// POST /api/settings/gotify-test — proxy a test notification to the user's Gotify server
router.post('/gotify-test', wrap(async (req, res) => {
  if (!userMgmtActive() || !req.user) return res.status(401).json({ error: 'Not logged in' });
  const { url, token } = req.body;
  if (!url || !token) return res.status(400).json({ error: 'URL and token required' });

  const endpoint = `${url.replace(/\/+$/, '')}/message?token=${encodeURIComponent(token)}`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'NutriTrace', message: 'Test notification — Gotify is connected!', priority: 5 }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return res.status(resp.status).json({ error: `Gotify ${resp.status}: ${body.slice(0, 100)}` });
  }
  res.json({ ok: true });
}));

// POST /api/settings/gotify-push — proxy a notification to the user's Gotify server
router.post('/gotify-push', wrap(async (req, res) => {
  if (!userMgmtActive() || !req.user) return res.status(401).json({ error: 'Not logged in' });
  const u = req.user.id;
  const gotifyUrl = (() => { const r = db.prepare('SELECT value FROM user_settings WHERE user_id=? AND key=?').get(u, 'gotifyUrl'); return r?.value ? JSON.parse(r.value) : ''; })();
  const gotifyToken = (() => { const r = db.prepare('SELECT value FROM user_settings WHERE user_id=? AND key=?').get(u, 'gotifyToken'); return r?.value ? JSON.parse(r.value) : ''; })();
  if (!gotifyUrl || !gotifyToken) return res.status(400).json({ error: 'Gotify not configured' });

  const { title, message, priority } = req.body;
  const endpoint = `${gotifyUrl.replace(/\/+$/, '')}/message?token=${encodeURIComponent(gotifyToken)}`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || 'NutriTrace', message: message || '', priority: priority || 5 }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return res.status(resp.status).json({ error: `Gotify ${resp.status}: ${body.slice(0, 100)}` });
  }
  res.json({ ok: true });
}));

export default router;
