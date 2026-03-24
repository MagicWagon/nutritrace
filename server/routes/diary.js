import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';

const router = Router();

// Get all diary dates (for statistics)
router.get('/', wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM diary ORDER BY date ASC').all();
  res.json(rows.map(parse));
}));

// Get single date
router.get('/:date', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM diary WHERE date = ?').get(req.params.date);
  if (!row) return res.json({ date: req.params.date, items: [], body_stats: {}, water: [] });
  res.json(parse(row));
}));

// Save/replace entire diary entry for a date
router.put('/:date', wrap((req, res) => {
  const { items, body_stats, water } = req.body;
  db.prepare(
    `INSERT INTO diary (date, items, body_stats, water, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(date) DO UPDATE SET
       items      = excluded.items,
       body_stats = excluded.body_stats,
       water      = excluded.water,
       updated_at = excluded.updated_at`
  ).run(req.params.date, JSON.stringify(items || []), JSON.stringify(body_stats || {}), JSON.stringify(water || []));
  res.json(parse(db.prepare('SELECT * FROM diary WHERE date = ?').get(req.params.date)));
}));

router.delete('/:date', wrap((req, res) => {
  db.prepare('DELETE FROM diary WHERE date = ?').run(req.params.date);
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
