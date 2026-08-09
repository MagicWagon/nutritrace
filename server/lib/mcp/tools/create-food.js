/**
 * MCP tool: create_food (Phase 3, destructive)
 *
 * Insert a new row into the user's foods catalog. Semi-destructive
 * because the row persists across sessions and shows up in every
 * search / picker; agents that fabricate foods can pollute the
 * catalog in a way a user has to hand-clean.
 *
 * Nutrition values are per the food's portion (not per 100g). The
 * server does no unit normalization — the caller's numbers are stored
 * literally, matching how the food-editor UI writes them.
 *
 * Refuses to insert a duplicate name+brand pair; call search_foods
 * first to see if a match already exists.
 */
import { z } from 'zod';
import db from '../../../db.js';
import { toolResult, toolError } from '../_util.js';

const NUTRIMENT_KEYS = new Set([
  'calories', 'kilojoules',
  'fat', 'saturated-fat', 'trans-fat', 'polyunsaturated-fat', 'monounsaturated-fat',
  'cholesterol', 'sodium', 'salt',
  'carbohydrates', 'fiber', 'sugars', 'added-sugars',
  'protein',
  'vitamin-a', 'vitamin-c', 'vitamin-d', 'vitamin-e', 'vitamin-k',
  'vitamin-b1', 'vitamin-b2', 'vitamin-b3', 'vitamin-b5', 'vitamin-b6',
  'vitamin-b7', 'vitamin-b9', 'vitamin-b12',
  'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'zinc',
  'copper', 'manganese', 'selenium', 'chromium', 'molybdenum', 'iodine',
  'caffeine', 'alcohol',
]);

export function registerCreateFood(server, { userId }) {
  server.registerTool(
    'create_food',
    {
      title: 'Create Food',
      description:
        "Add a new food to the user's catalog. Nutrition values are per the " +
        "food's stated portion (not per 100 g by convention). Requires confirm=true. " +
        'Refuses to insert if a food with the same name + brand already exists — ' +
        "call search_foods first if you're not sure. Rejects unknown nutriment keys " +
        'to keep the catalog clean; use canonical ids like "calories", "protein", ' +
        '"carbohydrates", "vitamin-d", "vitamin-b12" (see Nutrition Facts label ids).',
      inputSchema: {
        confirm:   z.boolean(),
        name:      z.string().min(1).max(200),
        brand:     z.string().max(100).optional(),
        portion:   z.number().positive().max(10000),
        unit:      z.string().min(1).max(20),
        nutrition: z.record(z.string(), z.number()),
        category:  z.string().max(50).optional(),
        barcode:   z.string().max(30).optional(),
        notes:     z.string().max(1000).optional(),
      },
    },
    async ({ confirm, name, brand, portion, unit, nutrition, category, barcode, notes }) => {
      if (confirm !== true) {
        return toolError(
          'create_food requires confirm=true. This safeguards against accidental ' +
          "catalog pollution. Set the confirm argument to true and re-invoke if you're sure."
        );
      }

      const cleanName = name.trim();
      const cleanBrand = brand?.trim() || null;
      if (!cleanName) return toolError('name is required and cannot be blank.');

      // Filter nutrition to known keys with finite values. Silent drop
      // rather than reject-the-whole-call so partial data still lands,
      // but report what was dropped so the agent can retry. Per-value
      // sanity cap catches hallucinated 1e12 values before they poison
      // the catalog (real per-portion nutriments are all under 10000).
      const MAX_NUT_VALUE = 100000;
      const clean = {};
      const rejected = [];
      for (const [k, v] of Object.entries(nutrition || {})) {
        if (!NUTRIMENT_KEYS.has(k))  { rejected.push(`${k} (unknown key)`); continue; }
        if (!Number.isFinite(v))     { rejected.push(`${k} (not a number)`); continue; }
        if (v < 0)                   { rejected.push(`${k} (negative)`); continue; }
        if (v > MAX_NUT_VALUE)       { rejected.push(`${k} (${v} exceeds ${MAX_NUT_VALUE} cap)`); continue; }
        clean[k] = Math.round(v * 100) / 100;
      }
      if (Object.keys(clean).length === 0) {
        return toolError(
          `nutrition must include at least one valid nutriment. Rejected: ${rejected.join('; ') || '(none)'}. ` +
          `Canonical keys: calories, protein, carbohydrates, fat, ...`
        );
      }

      // Dedup on (user_id, name, brand). Case-insensitive comparison
      // matches how the client-side Foods picker groups results.
      const existing = db.prepare(
        `SELECT id FROM foods
          WHERE user_id = ?
            AND deleted_at IS NULL
            AND LOWER(name) = LOWER(?)
            AND ( (brand IS NULL AND ? IS NULL) OR LOWER(brand) = LOWER(?) )
          LIMIT 1`
      ).get(userId, cleanName, cleanBrand, cleanBrand);
      if (existing) {
        return toolError(
          `A food with this name${cleanBrand ? ` and brand '${cleanBrand}'` : ''} ` +
          `already exists (id=${existing.id}). Use that id with log_food, or edit ` +
          'the existing food in the app if the nutrition needs updating.'
        );
      }

      const result = db.prepare(
        `INSERT INTO foods (user_id, name, brand, portion, unit, nutrition, category, barcode, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        userId,
        cleanName,
        cleanBrand,
        portion,
        unit,
        JSON.stringify(clean),
        category || null,
        barcode || null,
        notes || null,
      );

      return toolResult({
        ok: true,
        created: {
          id: result.lastInsertRowid,
          name: cleanName,
          brand: cleanBrand,
          portion,
          unit,
          nutrition: clean,
          category: category || null,
          barcode: barcode || null,
        },
        rejected_nutriments: rejected.length ? rejected : undefined,
      });
    }
  );
}
