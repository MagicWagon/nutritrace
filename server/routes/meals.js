import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const uid = req => userMgmtActive() ? req.user.id : null;

router.get('/', wrap((req, res) => {
  const isRecipe = req.query.recipes === '1' ? 1 : 0;
  const u = uid(req);
  const rows = u == null
    ? db.prepare('SELECT * FROM meals WHERE is_recipe = ? ORDER BY name ASC').all(isRecipe)
    : db.prepare('SELECT * FROM meals WHERE is_recipe = ? AND user_id = ? ORDER BY name ASC').all(isRecipe, u);
  res.json(rows.map(parse));
}));

router.get('/:id', wrap((req, res) => {
  const u = uid(req);
  const row = u == null
    ? db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT * FROM meals WHERE id = ? AND user_id = ?').get(req.params.id, u);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parse(row));
}));

router.post('/', wrap((req, res) => {
  const { name, nutrition, items, img_url, notes, is_recipe, portion, unit } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(
    `INSERT INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid(req), name, JSON.stringify(nutrition || {}), JSON.stringify(items || []),
    img_url || null, notes || null, is_recipe ? 1 : 0, portion ?? 100, unit || 'g');
  res.status(201).json(parse(db.prepare('SELECT * FROM meals WHERE id = ?').get(result.lastInsertRowid)));
}));

router.put('/:id', wrap((req, res) => {
  const u = uid(req);
  const existing = u == null
    ? db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT * FROM meals WHERE id = ? AND user_id = ?').get(req.params.id, u);
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
  const u = uid(req);
  if (u == null) db.prepare('DELETE FROM meals WHERE id = ?').run(req.params.id);
  else db.prepare('DELETE FROM meals WHERE id = ? AND user_id = ?').run(req.params.id, u);
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
