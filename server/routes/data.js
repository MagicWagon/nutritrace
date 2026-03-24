import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Clear all app data from SQLite
router.delete('/', (req, res) => {
  db.prepare('DELETE FROM foods').run();
  db.prepare('DELETE FROM meals').run();
  db.prepare('DELETE FROM diary').run();
  res.json({ ok: true });
});

// Bulk import — accepts NutriTrace backup format (foodList/meals/recipes/diary)
// Also handles camelCase fields (imgUrl, categories) from frontend objects
router.post('/import', (req, res) => {
  const { foodList = [], meals = [], recipes = [], diary = [] } = req.body;

  const insFood = db.prepare(
    `INSERT OR IGNORE INTO foods (name, brand, nutrition, portion, unit, img_url, notes, category, barcode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insMeal = db.prepare(
    `INSERT OR IGNORE INTO meals (name, nutrition, items, img_url, notes, is_recipe, portion, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insDiary = db.prepare(
    `INSERT OR REPLACE INTO diary (date, items, body_stats, water)
     VALUES (?, ?, ?, ?)`
  );

  const run = db.transaction(() => {
    for (const f of foodList) {
      insFood.run(
        f.name || '', f.brand || null,
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
        m.name || '', JSON.stringify(m.nutrition || {}),
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
        e.date,
        JSON.stringify(e.items || []),
        JSON.stringify(e.bodyStats || e.body_stats || {}),
        JSON.stringify(e.water || [])
      );
    }
  });

  try {
    run();
    res.json({ ok: true });
  } catch(e) {
    console.error('[data/import]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
