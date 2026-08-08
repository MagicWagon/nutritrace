/**
 * MCP tool: get_recent_foods
 *
 * Return the user's most-recently-used foods from their local catalog,
 * ordered by last diary appearance. Useful for agents that want to
 * surface "log the same thing again" suggestions without re-searching.
 *
 * Cheap implementation: walks the last 14 days of diary rows and
 * counts distinct food ids. Not indexed on the server; if that becomes
 * a hot path we can materialize a `foods.last_used_at` column.
 *
 * Filters out tombstoned diary rows so agents don't get "recent" foods
 * seeded from days the user has erased.
 */
import { z } from 'zod';
import db from '../../../db.js';
import { safeJson, toolResult } from '../_util.js';

const MAX_LIMIT = 30;
const DEFAULT_LIMIT = 10;
const LOOKBACK_DAYS = 14;

export function registerRecentFoods(server, { userId }) {
  server.registerTool(
    'get_recent_foods',
    {
      title: 'Get Recent Foods',
      description:
        "Return the user's most-recently-used foods from their local catalog, ordered " +
        `by last diary appearance in the past ${LOOKBACK_DAYS} days. Default limit 10, max ${MAX_LIMIT}.`,
      inputSchema: {
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      },
    },
    async ({ limit }) => {
      const cap = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
      const since = _daysAgoLocal(LOOKBACK_DAYS);
      const rows = db.prepare(
        `SELECT items, date FROM diary
          WHERE user_id = ? AND date >= ? AND deleted_at IS NULL
          ORDER BY date DESC`
      ).all(userId, since);
      const lastSeen = new Map();
      for (const r of rows) {
        const items = safeJson(r.items, []);
        for (const it of items) {
          const id = it?.id ?? it?.food_id ?? it?.foodId;
          if (id == null) continue;
          if (!lastSeen.has(id)) lastSeen.set(id, r.date);
        }
        if (lastSeen.size >= cap * 3) break;
      }
      const ids = Array.from(lastSeen.keys()).slice(0, cap);
      if (!ids.length) return toolResult({ count: 0, items: [] });
      const placeholders = ids.map(() => '?').join(',');
      const foods = db.prepare(
        `SELECT id, name, brand, barcode, portion, unit, nutrition, category
           FROM foods
          WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`
      ).all(userId, ...ids);
      const byId = new Map(foods.map(f => [f.id, f]));
      const items = ids
        .map(id => byId.get(id))
        .filter(Boolean)
        .map(f => ({
          id: f.id,
          name: f.name,
          brand: f.brand || null,
          barcode: f.barcode || null,
          portion: Number(f.portion) || null,
          unit: f.unit || null,
          category: f.category || null,
          nutrition: safeJson(f.nutrition, {}),
          last_logged_on: lastSeen.get(f.id),
        }));
      return toolResult({ count: items.length, items });
    }
  );
}

function _daysAgoLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('sv-SE');
}
