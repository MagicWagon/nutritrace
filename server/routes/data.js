import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const uid = req => userMgmtActive() ? req.user.id : null;

// Clear all app data (scoped to current user)
router.delete('/', wrap((req, res) => {
  const u = uid(req);
  if (u == null) {
    db.prepare('DELETE FROM foods').run();
    db.prepare('DELETE FROM meals').run();
    db.prepare('DELETE FROM diary').run();
  } else {
    db.prepare('DELETE FROM foods WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM meals WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM diary WHERE user_id = ?').run(u);
  }
  res.json({ ok: true });
}));

// Bulk import — accepts NutriTrace backup format (foodList/meals/recipes/diary)
router.post('/import', wrap((req, res) => {
  const { foodList = [], meals = [], recipes = [], diary = [] } = req.body;
  const u = uid(req);

  const insFood = db.prepare(
    `INSERT OR IGNORE INTO foods (user_id, name, brand, nutrition, portion, unit, img_url, notes, category, barcode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insMeal = db.prepare(
    `INSERT OR IGNORE INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insDiary = db.prepare(
    `INSERT OR REPLACE INTO diary (user_id, date, items, body_stats, water)
     VALUES (?, ?, ?, ?, ?)`
  );

  const run = db.transaction(() => {
    for (const f of foodList) {
      insFood.run(
        u, f.name || '', f.brand || null,
        JSON.stringify(f.nutrition || {}),
        f.portion ?? 100, f.unit || 'g',
        f.imgUrl || f.img_url || null,
        f.notes || null,
        (f.categories && f.categories[0]) || f.category || null,
        f.barcode || null
      );
    }
    for (const m of [...meals, ...recipes]) {
      insMeal.run(
        u, m.name || '', JSON.stringify(m.nutrition || {}),
        JSON.stringify(m.items || []),
        m.imgUrl || m.img_url || null,
        m.notes || null,
        recipes.includes(m) ? 1 : 0,
        m.portion ?? 100, m.unit || 'g'
      );
    }
    for (const e of diary) {
      if (!e.date) continue;
      insDiary.run(
        u, e.date,
        JSON.stringify(e.items || []),
        JSON.stringify(e.bodyStats || e.body_stats || {}),
        JSON.stringify(e.water || [])
      );
    }
  });

  run();
  res.json({ ok: true });
}));

export default router;
