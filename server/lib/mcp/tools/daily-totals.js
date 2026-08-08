/**
 * MCP tool: get_daily_totals
 *
 * Sum the nutrition of the food items in a day's diary row. Returns
 * calories, protein, carbs, fat, plus any micronutrients present on
 * the items. Water is returned separately as it lives in its own
 * column on the diary row. Mirrors what the Diary top-bar displays.
 */
import { z } from 'zod';
import db from '../../../db.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerDailyTotals(server, { userId }) {
  server.registerTool(
    'get_daily_totals',
    {
      title: 'Get Daily Totals',
      description:
        "Sum the nutrition of a day's diary entries. Returns calories (kcal), " +
        'macros (protein / carbs / fat / etc. in grams), any micronutrients ' +
        'present on the logged items, and total water in millilitres. Date ' +
        'defaults to today; format YYYY-MM-DD.',
      inputSchema: {
        date: z.string().regex(DATE_RE, 'YYYY-MM-DD').optional(),
      },
    },
    async ({ date }) => {
      const day = date || _todayLocal();
      if (!DATE_RE.test(day)) {
        return _err(`Invalid date '${day}'; expected YYYY-MM-DD.`);
      }
      const row = db.prepare(
        `SELECT items, water FROM diary WHERE user_id = ? AND date = ?`
      ).get(userId, day);
      const items = row?.items ? _safeJson(row.items, []) : [];
      const waterLogs = row?.water ? _safeJson(row.water, []) : [];
      const totals = _sumNutrition(items);
      const water_ml = waterLogs.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const result = { date: day, totals, water_ml, item_count: items.length };
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}

// Item nutrition is stored as per-portion values; sum the values as-is
// since the client already scales them at write time. Mirrors what
// Nutrition.sum does client-side but stays self-contained here to avoid
// pulling frontend modules into the server bundle.
function _sumNutrition(items) {
  const acc = {};
  for (const it of items) {
    const nut = it?.nutrition || {};
    const qty = Number(it?.quantity) || 1;
    for (const [k, v] of Object.entries(nut)) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      acc[k] = (acc[k] || 0) + n * qty;
    }
  }
  // Round to 1 decimal place — matches how the diary top-bar displays.
  for (const k of Object.keys(acc)) acc[k] = Math.round(acc[k] * 10) / 10;
  return acc;
}

function _todayLocal() {
  return new Date().toLocaleDateString('sv-SE');
}
function _safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
function _err(msg) {
  return { content: [{ type: 'text', text: msg }], isError: true };
}
