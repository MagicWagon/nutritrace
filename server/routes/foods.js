import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';

const router = Router();

router.get('/', wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM foods ORDER BY name ASC').all();
  res.json(rows.map(parse));
}));

router.get('/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parse(row));
}));

router.post('/', wrap((req, res) => {
  const { name, brand, nutrition, portion, unit, img_url, notes, category, barcode } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(
    `INSERT INTO foods (name, brand, nutrition, portion, unit, img_url, notes, category, barcode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, brand || null, JSON.stringify(nutrition || {}), portion ?? 100, unit || 'g', img_url || null, notes || null, category || null, barcode || null);
  res.status(201).json(parse(db.prepare('SELECT * FROM foods WHERE id = ?').get(result.lastInsertRowid)));
}));

router.put('/:id', wrap((req, res) => {
  const { name, brand, nutrition, portion, unit, img_url, notes, category, barcode } = req.body;
  const existing = db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    `UPDATE foods SET name=?, brand=?, nutrition=?, portion=?, unit=?, img_url=?, notes=?, category=?, barcode=? WHERE id=?`
  ).run(name ?? existing.name, brand ?? existing.brand, JSON.stringify(nutrition ?? JSON.parse(existing.nutrition)),
    portion ?? existing.portion, unit ?? existing.unit, img_url ?? existing.img_url,
    notes ?? existing.notes, category ?? existing.category, barcode ?? existing.barcode, req.params.id);
  res.json(parse(db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id)));
}));

router.delete('/:id', wrap((req, res) => {
  db.prepare('DELETE FROM foods WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

function parse(row) {
  return { ...row, nutrition: JSON.parse(row.nutrition || '{}') };
}

export default router;
