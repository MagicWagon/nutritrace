import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { testSmtp } from '../email.js';

const router = Router();

const ALLOWED_KEYS = new Set([
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
]);

// ── GET /api/app-config — return all config (passwords redacted) ───────────
router.get('/', requireAuth, requireAdmin, wrap((req, res) => {
  const rows = db.prepare('SELECT key, value FROM app_config').all();
  const out = {};
  for (const { key, value } of rows) {
    out[key] = key === 'smtp_pass' ? (value ? '••••••••' : '') : (value || '');
  }
  res.json(out);
}));

// ── PUT /api/app-config — upsert one key ──────────────────────────────────
router.put('/', requireAuth, requireAdmin, wrap((req, res) => {
  const { key, value } = req.body;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'Unknown config key' });
  // Don't overwrite password with the placeholder
  if (key === 'smtp_pass' && value === '••••••••') return res.json({ ok: true });
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value || null);
  res.json({ ok: true });
}));

// ── POST /api/app-config/test-email — verify SMTP connection ─────────────
router.post('/test-email', requireAuth, requireAdmin, wrap(async (req, res) => {
  await testSmtp();
  res.json({ ok: true });
}));

export default router;
