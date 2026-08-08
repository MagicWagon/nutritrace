/**
 * Shared diary-day mutation helper for MCP write tools.
 *
 * Every write tool eventually appends/merges into a diary row's items,
 * water, or body_stats JSON columns. Centralising the load/mutate/save
 * loop here keeps the tools tight and ensures every write:
 *  - runs inside a single transaction (safe against concurrent writes),
 *  - respects the (user_id, date) unique-key upsert pattern the rest of
 *    the server uses (nutrition-import, data.js, full-backup),
 *  - clears the `deleted_at` tombstone if the row was soft-deleted,
 *  - stamps `updated_at` so differential sync picks up the change.
 *
 * The mutator callback receives the parsed { items, water, bodyStats,
 * notes } shape and returns the same (mutated in-place or replaced).
 * Return `null` from the mutator to bail without writing.
 */
import db from '../../db.js';
import { safeJson } from './_util.js';

/**
 * Load a diary day, hand its parsed contents to `mutator`, and save
 * the result back. Runs inside a transaction so concurrent MCP write
 * calls on the same day serialise cleanly.
 *
 * @param {number}   userId
 * @param {string}   date       YYYY-MM-DD (server-local)
 * @param {function} mutator    ({items, water, bodyStats, notes}) => same shape | null
 * @returns {object|null} the final shape actually written, or null if mutator bailed
 */
export function mutateDiaryDay(userId, date, mutator) {
  const tx = db.transaction(() => {
    const row = db.prepare(
      `SELECT items, water, body_stats, notes
         FROM diary
        WHERE user_id = ? AND date = ? AND deleted_at IS NULL`
    ).get(userId, date);

    const current = {
      items:     row?.items     ? safeJson(row.items,      []) : [],
      water:     row?.water     ? safeJson(row.water,      []) : [],
      bodyStats: row?.body_stats ? safeJson(row.body_stats, {}) : {},
      notes:     row?.notes ?? null,
    };
    const next = mutator(current);
    if (next == null) return null;

    const itemsJson     = JSON.stringify(next.items ?? []);
    const waterJson     = JSON.stringify(next.water ?? []);
    const bodyStatsJson = JSON.stringify(next.bodyStats ?? {});
    const notes         = next.notes ?? null;

    db.prepare(
      `INSERT INTO diary (user_id, date, items, body_stats, water, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(date, user_id) DO UPDATE SET
         items=excluded.items,
         body_stats=excluded.body_stats,
         water=excluded.water,
         notes=excluded.notes,
         updated_at=excluded.updated_at,
         deleted_at=NULL`
    ).run(userId, date, itemsJson, bodyStatsJson, waterJson, notes);

    return next;
  });
  return tx();
}
