/**
 * MCP tool: log_food (Phase 2, write)
 *
 * Append a food from the user's local catalog to a diary day. Same
 * output shape as if the user had tapped the food in the Foods picker
 * and confirmed the portion prompt.
 *
 * The food must exist in the user's foods table (search_foods returns
 * ids that are valid inputs here). External-source foods (OFF/USDA)
 * must be saved to the catalog by the user first — this tool won't
 * silently pull from OFF and create a food row, because that would let
 * an agent bloat the catalog without any UI feedback.
 */
import { z } from 'zod';
import db from '../../../db.js';
import { DATE_RE, safeJson, todayLocal, toolResult, toolError } from '../_util.js';
import { mutateDiaryDay, DiaryTombstonedError } from '../_diary-write.js';

export function registerLogFood(server, { userId }) {
  server.registerTool(
    'log_food',
    {
      title: 'Log Food',
      description:
        "Add a food from the user's catalog to a diary day. Requires food_id from " +
        'the user\'s local catalog (search with search_foods first). Portion + unit ' +
        "default to the food's stored serving; override to log a different amount. " +
        'Date defaults to today in the server timezone. Meal slot is 0-indexed ' +
        '(0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks by default; user may have ' +
        'custom labels but the index still matters).',
      inputSchema: {
        food_id:  z.number().int().positive(),
        date:     z.string().regex(DATE_RE, 'YYYY-MM-DD').optional(),
        meal:     z.number().int().min(0).max(9).optional(),
        quantity: z.number().positive().optional(),
        portion:  z.number().positive().optional(),
        unit:     z.string().max(20).optional(),
        notes:    z.string().max(500).optional(),
      },
    },
    async ({ food_id, date, meal, quantity, portion, unit, notes }) => {
      const day = date || todayLocal();
      if (!DATE_RE.test(day)) return toolError(`Invalid date '${day}'; expected YYYY-MM-DD.`);

      const food = db.prepare(
        `SELECT id, name, brand, portion, unit, nutrition, category
           FROM foods
          WHERE user_id = ? AND id = ? AND deleted_at IS NULL`
      ).get(userId, food_id);
      if (!food) return toolError(`food_id ${food_id} not found in your catalog.`);

      // Unit-conversion is intentionally not attempted server-side.
      // Callers know their own inputs; OFF/USDA style unit conversions
      // are lossy without density data. Reject cross-unit requests so
      // the agent knows to convert first. Comparison is case-insensitive
      // ('G' vs 'g' should match) but otherwise strict.
      const foodPortion = Number.isFinite(Number(food.portion)) ? Number(food.portion) : null;
      const foodUnit    = food.unit || null;
      const unitMatches = !unit
        || !foodUnit
        || String(unit).trim().toLowerCase() === String(foodUnit).trim().toLowerCase();
      if (!unitMatches) {
        return toolError(
          `Cross-unit portions are not supported: food '${food.name}' is measured in '${foodUnit}', ` +
          `caller supplied '${unit}'. Convert to '${foodUnit}' first or omit the unit override.`
        );
      }

      // Scale nutrition proportionally when the caller overrides portion.
      // Nutrition.calculate() multiplies by quantity only (portion + unit
      // are display-only on the diary item) so any portion delta must be
      // baked into the stored `nutrition` object before write.
      //
      // If the caller supplied a portion but the food row has no baseline
      // portion, we cannot compute a scale factor — refuse rather than
      // silently record the base nutrition against the caller's number.
      const rawNutrition   = safeJson(food.nutrition, {});
      const effectivePortion = Number.isFinite(portion) ? portion : foodPortion;
      if (Number.isFinite(portion) && !foodPortion) {
        return toolError(
          `Food '${food.name}' has no baseline portion stored, so a portion override ` +
          "can't be scaled correctly. Log without the portion argument (uses 1× the food's " +
          "nutrition per quantity) or edit the food in the app to add a base portion first."
        );
      }
      const factor = (foodPortion && effectivePortion) ? (effectivePortion / foodPortion) : 1;
      const scaledNutrition = (factor === 1)
        ? rawNutrition
        : Object.fromEntries(
            Object.entries(rawNutrition).map(([k, v]) =>
              [k, typeof v === 'number' ? Math.round(v * factor * 100) / 100 : v]
            )
          );

      const item = {
        name:      food.name,
        brand:     food.brand || undefined,
        meal:      meal ?? 0,
        quantity:  quantity ?? 1,
        portion:   effectivePortion ?? undefined,
        unit:      unit || foodUnit || undefined,
        nutrition: scaledNutrition,
        notes:     notes || undefined,
        food_server_id: food.id,
        addedAt:   new Date().toISOString(),
        source:    'mcp',
      };

      let next;
      try {
        next = mutateDiaryDay(userId, day, cur => ({
          ...cur,
          items: [...cur.items, item],
        }));
      } catch (e) {
        if (e instanceof DiaryTombstonedError) return toolError(e.message);
        throw e;
      }

      return toolResult({
        ok: true,
        date: day,
        logged: {
          food_id: food.id,
          name: food.name,
          meal: item.meal,
          portion: item.portion,
          unit: item.unit,
          quantity: item.quantity,
          scaled_by: factor === 1 ? undefined : factor,
        },
        total_items_on_day: next.items.length,
      });
    }
  );
}
