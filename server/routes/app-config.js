import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { testSmtp, isSmtpEnvLocked } from '../email.js';
import { isAiEnvLocked } from '../ai.js';

const router = Router();

const ALLOWED_KEYS = new Set([
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
  'ai_enabled', 'ai_provider', 'ai_api_key', 'ai_model',
  'session_hours',
  'fitbit_client_id', 'fitbit_client_secret', 'fitbit_redirect_uri',
  'withings_client_id', 'withings_client_secret', 'withings_redirect_uri',
]);

// ── GET /api/app-config/env-locks — which sections are locked by env vars ──
// Any authenticated user can read this (needed to disable UI fields)
router.get('/env-locks', requireAuth, wrap((req, res) => {
  res.json({ smtp: isSmtpEnvLocked(), ai: isAiEnvLocked() });
}));

// ── GET /api/app-config — return all config (passwords redacted) ───────────
router.get('/', requireAuth, requireAdmin, wrap((req, res) => {
  const rows = db.prepare('SELECT key, value FROM app_config').all();
  const out = {};
  for (const { key, value } of rows) {
    const redacted = key === 'smtp_pass' || key === 'ai_api_key' || key === 'fitbit_client_secret' || key === 'withings_client_secret';
    out[key] = redacted ? (value ? '••••••••' : '') : (value || '');
  }
  res.json(out);
}));

// ── PUT /api/app-config — upsert one key ──────────────────────────────────
router.put('/', requireAuth, requireAdmin, wrap((req, res) => {
  const { key, value } = req.body;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'Unknown config key' });
  // Block writes to env-locked sections
  if (key.startsWith('smtp_') && isSmtpEnvLocked()) return res.status(403).json({ error: 'SMTP is configured via environment variables and cannot be changed here.' });
  if (key.startsWith('ai_')   && isAiEnvLocked())   return res.status(403).json({ error: 'AI is configured via environment variables and cannot be changed here.' });
  // Don't overwrite secrets with the redaction placeholder
  if ((key === 'smtp_pass' || key === 'ai_api_key' || key === 'fitbit_client_secret' || key === 'withings_client_secret') && value === '••••••••') return res.json({ ok: true });
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
