import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';

const router = Router();

router.get('/', wrap((req, res) => {
  const isRecipe = req.query.recipes === '1' ? 1 : 0;
  const rows = db.prepare('SELECT * FROM meals WHERE is_recipe = ? ORDER BY name ASC').all(isRecipe);
  res.json(rows.map(parse));
}));

router.get('/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parse(row));
}));

router.post('/', wrap((req, res) => {
  const { name, nutrition, items, img_url, notes, is_recipe, portion, unit } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(
    `INSERT INTO meals (name, nutrition, items, img_url, notes, is_recipe, portion, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, JSON.stringify(nutrition || {}), JSON.stringify(items || []),
    img_url || null, notes || null, is_recipe ? 1 : 0, portion ?? 100, unit || 'g');
  res.status(201).json(parse(db.prepare('SELECT * FROM meals WHERE id = ?').get(result.lastInsertRowid)));
}));

router.put('/:id', wrap((req, res) => {
  const existing = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, nutrition, items, img_url, notes, is_recipe, portion, unit } = req.body;
  db.prepare(
    `UPDATE meals SET name=?, nutrition=?, items=?, img_url=?, notes=?, is_recipe=?, portion=?, unit=? WHERE id=?`
  ).run(name ?? existing.name, JSON.stringify(nutrition ?? JSON.parse(existing.nutrition)),
    JSON.stringify(items ?? JSON.parse(existing.items)), img_url ?? existing.img_url,
    notes ?? existing.notes, is_recipe != null ? (is_recipe ? 1 : 0) : existing.is_recipe,
    portion ?? existing.portion, unit ?? existing.unit, req.params.id);
  res.json(parse(db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id)));
}));

router.delete('/:id', wrap((req, res) => {
  db.prepare('DELETE FROM meals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

function parse(row) {
  return {
    ...row,
    nutrition: JSON.parse(row.nutrition || '{}'),
    items: JSON.parse(row.items || '[]'),
    is_recipe: row.is_recipe === 1,
  };
}

export default router;
