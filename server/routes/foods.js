import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/** Current user's id, or null in single-user mode */
const uid = req => userMgmtActive() ? req.user.id : null;

router.get('/', wrap((req, res) => {
  const u = uid(req);
  const rows = u == null
    ? db.prepare('SELECT * FROM foods ORDER BY name ASC').all()
    : db.prepare('SELECT * FROM foods WHERE user_id = ? ORDER BY name ASC').all(u);
  res.json(rows.map(parse));
}));

router.get('/:id', wrap((req, res) => {
  const u = uid(req);
  const row = u == null
    ? db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT * FROM foods WHERE id = ? AND user_id = ?').get(req.params.id, u);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parse(row));
}));

router.post('/', wrap((req, res) => {
  const { name, brand, nutrition, portion, unit, img_url, notes, category, barcode } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(
    `INSERT INTO foods (user_id, name, brand, nutrition, portion, unit, img_url, notes, category, barcode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid(req), name, brand || null, JSON.stringify(nutrition || {}), portion ?? 100, unit || 'g', img_url || null, notes || null, category || null, barcode || null);
  res.status(201).json(parse(db.prepare('SELECT * FROM foods WHERE id = ?').get(result.lastInsertRowid)));
}));

router.put('/:id', wrap((req, res) => {
  const u = uid(req);
  const existing = u == null
    ? db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT * FROM foods WHERE id = ? AND user_id = ?').get(req.params.id, u);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, brand, nutrition, portion, unit, img_url, notes, category, barcode } = req.body;
  db.prepare(
    `UPDATE foods SET name=?, brand=?, nutrition=?, portion=?, unit=?, img_url=?, notes=?, category=?, barcode=? WHERE id=?`
  ).run(name ?? existing.name, brand ?? existing.brand, JSON.stringify(nutrition ?? JSON.parse(existing.nutrition)),
    portion ?? existing.portion, unit ?? existing.unit, img_url ?? existing.img_url,
    notes ?? existing.notes, category ?? existing.category, barcode ?? existing.barcode, req.params.id);
  res.json(parse(db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id)));
}));

router.delete('/:id', wrap((req, res) => {
  const u = uid(req);
  if (u == null) db.prepare('DELETE FROM foods WHERE id = ?').run(req.params.id);
  else db.prepare('DELETE FROM foods WHERE id = ? AND user_id = ?').run(req.params.id, u);
  res.json({ ok: true });
}));

function parse(row) {
  return { ...row, nutrition: JSON.parse(row.nutrition || '{}') };
}

export default router;
