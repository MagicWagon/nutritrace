import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const uid = req => userMgmtActive() ? req.user.id : null;

function sharingEnabled() {
  const row = db.prepare(`SELECT value FROM app_config WHERE key = 'sharing_enabled'`).get();
  return row?.value === 'true';
}

function canRead(meal, u) {
  if (meal.user_id == null || meal.user_id === u) return true;
  if (meal.visibility === 'group') return true;
  if (meal.visibility === 'specific') {
    const row = db.prepare('SELECT 1 FROM meal_shares WHERE meal_id = ? AND user_id = ?').get(meal.id, u);
    return !!row;
  }
  return false;
}

// ── GET / ─────────────────────────────────────────────────────────────────
router.get('/', wrap((req, res) => {
  const isRecipe = req.query.recipes === '1' ? 1 : 0;
  const u = uid(req);

  if (u == null) {
    return res.json(db.prepare('SELECT * FROM meals WHERE is_recipe = ? ORDER BY name ASC').all(isRecipe).map(parse));
  }

  if (req.query.group === '1' && sharingEnabled()) {
    // Group catalogue: other users' meals/recipes visible to this user
    const others = db.prepare('SELECT * FROM meals WHERE is_recipe = ? AND user_id != ? ORDER BY name ASC').all(isRecipe, u);
    const shared = others.filter(m => canRead(m, u));
    const userCache = {};
    for (const m of shared) {
      if (m.user_id && !userCache[m.user_id]) {
        const usr = db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(m.user_id);
        userCache[m.user_id] = usr?.full_name || usr?.username || 'Unknown';
      }
      m._shared_by = userCache[m.user_id] || null;
    }
    return res.json(shared.map(parse));
  }

  const rows = db.prepare('SELECT * FROM meals WHERE is_recipe = ? AND user_id = ? ORDER BY name ASC').all(isRecipe, u);
  res.json(rows.map(parse));
}));

// ── GET /:id ──────────────────────────────────────────────────────────────
router.get('/:id', wrap((req, res) => {
  const u = uid(req);
  const row = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (u != null && !canRead(row, u)) return res.status(403).json({ error: 'Forbidden' });
  if (u != null && row.user_id === u && row.visibility === 'specific') {
    row._specific_users = db.prepare('SELECT user_id FROM meal_shares WHERE meal_id = ?').all(row.id).map(r => r.user_id);
  }
  res.json(parse(row));
}));

// ── POST / ────────────────────────────────────────────────────────────────
router.post('/', wrap((req, res) => {
  const { name, nutrition, items, img_url, notes, is_recipe, portion, unit, visibility, source_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const u = uid(req);
  const defaultVis = db.prepare(`SELECT value FROM app_config WHERE key = 'default_food_visibility'`).get()?.value || 'private';
  const vis = visibility || defaultVis;
  const result = db.prepare(
    `INSERT INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, visibility, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(u, name, JSON.stringify(nutrition || {}), JSON.stringify(items || []),
    img_url || null, notes || null, is_recipe ? 1 : 0, portion ?? 100, unit || 'g', vis, source_id || null);
  res.status(201).json(parse(db.prepare('SELECT * FROM meals WHERE id = ?').get(result.lastInsertRowid)));
}));

// ── PUT /:id ──────────────────────────────────────────────────────────────
router.put('/:id', wrap((req, res) => {
  const u = uid(req);
  const existing = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (u != null && existing.user_id !== u) return res.status(403).json({ error: 'Forbidden' });
  const { name, nutrition, items, img_url, notes, is_recipe, portion, unit, visibility } = req.body;
  db.prepare(
    `UPDATE meals SET name=?, nutrition=?, items=?, img_url=?, notes=?, is_recipe=?, portion=?, unit=?, visibility=? WHERE id=?`
  ).run(name ?? existing.name, JSON.stringify(nutrition ?? JSON.parse(existing.nutrition || '{}')),
    JSON.stringify(items ?? JSON.parse(existing.items || '[]')), img_url ?? existing.img_url,
    notes ?? existing.notes, is_recipe != null ? (is_recipe ? 1 : 0) : existing.is_recipe,
    portion ?? existing.portion, unit ?? existing.unit,
    visibility ?? existing.visibility, req.params.id);
  res.json(parse(db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id)));
}));

// ── DELETE /:id ───────────────────────────────────────────────────────────
router.delete('/:id', wrap((req, res) => {
  const u = uid(req);
  const existing = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (u != null && existing.user_id !== u) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM meals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ── PATCH /:id/share ──────────────────────────────────────────────────────
router.patch('/:id/share', wrap((req, res) => {
  const u = uid(req);
  if (!sharingEnabled()) return res.status(403).json({ error: 'Sharing is not enabled on this instance.' });
  const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!meal) return res.status(404).json({ error: 'Not found' });
  if (u != null && meal.user_id !== u) return res.status(403).json({ error: 'Forbidden' });

  const { visibility, user_ids } = req.body;
  if (!['private', 'group', 'specific'].includes(visibility)) {
    return res.status(400).json({ error: 'visibility must be private, group, or specific' });
  }

  db.prepare('UPDATE meals SET visibility = ? WHERE id = ?').run(visibility, meal.id);
  db.prepare('DELETE FROM meal_shares WHERE meal_id = ?').run(meal.id);
  if (visibility === 'specific' && Array.isArray(user_ids)) {
    const ins = db.prepare('INSERT OR IGNORE INTO meal_shares (meal_id, user_id) VALUES (?, ?)');
    db.transaction(() => { for (const uid_ of user_ids) ins.run(meal.id, uid_); })();
  }

  res.json({ ok: true, visibility });
}));

// ── POST /:id/copy — clone shared meal/recipe into caller's catalogue ─────
// Food items within the meal are handled client-side (foods have their own /copy endpoint).
// We store items as embedded nutrition snapshots so the copy always works regardless of
// whether the original food items are accessible to the new owner.
router.post('/:id/copy', wrap((req, res) => {
  const u = uid(req);
  if (!sharingEnabled()) return res.status(403).json({ error: 'Sharing is not enabled on this instance.' });
  const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!meal) return res.status(404).json({ error: 'Not found' });
  if (u != null && meal.user_id === u) return res.status(400).json({ error: 'Already yours' });
  if (u != null && !canRead(meal, u)) return res.status(403).json({ error: 'Forbidden' });

  // Already copied?
  if (u != null) {
    const existing = db.prepare('SELECT id FROM meals WHERE user_id = ? AND source_id = ?').get(u, meal.id);
    if (existing) return res.json(parse(db.prepare('SELECT * FROM meals WHERE id = ?').get(existing.id)));
  }

  const result = db.prepare(
    `INSERT INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, visibility, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?)`
  ).run(u, meal.name, meal.nutrition, meal.items, meal.img_url, meal.notes,
    meal.is_recipe, meal.portion, meal.unit, meal.id);
  res.status(201).json(parse(db.prepare('SELECT * FROM meals WHERE id = ?').get(result.lastInsertRowid)));
}));

function parse(row) {
  return {
    ...row,
    nutrition: JSON.parse(row.nutrition || '{}'),
    items: JSON.parse(row.items || '[]'),
    is_recipe: row.is_recipe === 1,
    _specific_users: row._specific_users || undefined,
  };
}

export default router;
