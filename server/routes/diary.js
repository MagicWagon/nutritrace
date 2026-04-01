import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const uid = req => userMgmtActive() ? req.user.id : null;

// Get all diary dates (for statistics)
router.get('/', wrap((req, res) => {
  const u = uid(req);
  const rows = u == null
    ? db.prepare('SELECT * FROM diary WHERE deleted_at IS NULL ORDER BY date ASC').all()
    : db.prepare('SELECT * FROM diary WHERE user_id = ? AND deleted_at IS NULL ORDER BY date ASC').all(u);
  res.json(rows.map(parse));
}));

// Get single date
router.get('/:date', wrap((req, res) => {
  const u = uid(req);
  const row = u == null
    ? db.prepare('SELECT * FROM diary WHERE date = ? AND deleted_at IS NULL').get(req.params.date)
    : db.prepare('SELECT * FROM diary WHERE date = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.date, u);
  if (!row) return res.json({ date: req.params.date, items: [], body_stats: {}, water: [] });
  res.json(parse(row));
}));

// Save/replace entire diary entry for a date
router.put('/:date', wrap((req, res) => {
  const { items, body_stats, water } = req.body;
  const u = uid(req);
  if (u == null) {
    db.prepare(
      `INSERT INTO diary (date, items, body_stats, water, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(date, user_id) DO UPDATE SET
         items=excluded.items, body_stats=excluded.body_stats,
         water=excluded.water, updated_at=excluded.updated_at,
         deleted_at=NULL`
    ).run(req.params.date, JSON.stringify(items || []), JSON.stringify(body_stats || {}), JSON.stringify(water || []));
  } else {
    db.prepare(
      `INSERT INTO diary (user_id, date, items, body_stats, water, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(date, user_id) DO UPDATE SET
         items=excluded.items, body_stats=excluded.body_stats,
         water=excluded.water, updated_at=excluded.updated_at,
         deleted_at=NULL`
    ).run(u, req.params.date, JSON.stringify(items || []), JSON.stringify(body_stats || {}), JSON.stringify(water || []));
  }
  const row = u == null
    ? db.prepare('SELECT * FROM diary WHERE date = ? AND user_id IS NULL AND deleted_at IS NULL').get(req.params.date)
    : db.prepare('SELECT * FROM diary WHERE date = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.date, u);
  res.json(parse(row));
}));

router.delete('/:date', wrap((req, res) => {
  const u = uid(req);
  if (u == null) {
    db.prepare("UPDATE diary SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE date = ? AND deleted_at IS NULL").run(req.params.date);
  } else {
    db.prepare("UPDATE diary SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE date = ? AND user_id = ? AND deleted_at IS NULL").run(req.params.date, u);
  }
  res.json({ ok: true });
}));

function parse(row) {
  return {
    ...row,
    items:      JSON.parse(row.items      || '[]'),
    body_stats: JSON.parse(row.body_stats || '{}'),
    water:      JSON.parse(row.water      || '[]'),
  };
}

export default router;
