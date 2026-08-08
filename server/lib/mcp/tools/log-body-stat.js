/**
 * MCP tool: log_body_stat (Phase 2, write)
 *
 * Set one or more body-stat values on a diary day. Storage is the
 * diary row's `body_stats` JSON object; the shape merges with any
 * existing values (setting `weight` doesn't clear `body_fat`).
 *
 * Units are canonical (kg for mass, cm for lengths, percent as 0-100).
 * Agents that receive user input in lb/inches must convert first;
 * mirrors the client-side saveBodyStats() contract.
 */
import { z } from 'zod';
import { DATE_RE, todayLocal, toolResult, toolError } from '../_util.js';
import { mutateDiaryDay } from '../_diary-write.js';

// Allowed body-stat keys. Anything outside this list is rejected so a
// typo doesn't quietly land as a new column-in-a-JSON. Extending is a
// deliberate act — add the key here + document in Units below.
const ALLOWED_STATS = new Set([
  'weight',           // kg
  'body_fat',         // %
  'muscle_mass',      // kg
  'water_pct',        // %
  'bone_mass',        // kg
  'visceral_fat',     // AU (1-59, Withings scale)
  'waist',            // cm
  'hip',              // cm
  'neck',             // cm
  'chest',            // cm
  'arm',              // cm
  'thigh',            // cm
  'calf',             // cm
]);

export function registerLogBodyStat(server, { userId }) {
  server.registerTool(
    'log_body_stat',
    {
      title: 'Log Body Stat',
      description:
        "Set one or more body-stat values on a diary day. Units are canonical: " +
        'weight/muscle_mass/bone_mass in kg, waist/hip/neck/chest/arm/thigh/calf ' +
        'in cm, body_fat/water_pct as percent (0-100). Merges into existing ' +
        'stats (setting weight does not clear body_fat). Date defaults to today.',
      inputSchema: {
        stats: z.record(z.string(), z.number()).refine(
          o => Object.keys(o || {}).length > 0,
          'stats must be a non-empty object'
        ),
        date:  z.string().regex(DATE_RE, 'YYYY-MM-DD').optional(),
      },
    },
    async ({ stats, date }) => {
      const day = date || todayLocal();
      if (!DATE_RE.test(day)) return toolError(`Invalid date '${day}'; expected YYYY-MM-DD.`);

      const clean = {};
      const rejected = [];
      for (const [k, v] of Object.entries(stats || {})) {
        if (!ALLOWED_STATS.has(k)) { rejected.push(k); continue; }
        if (!Number.isFinite(v))   { rejected.push(k); continue; }
        clean[k] = Math.round(v * 100) / 100;   // 2-decimal cap
      }
      if (Object.keys(clean).length === 0) {
        return toolError(
          `No valid stats. Allowed keys: ${[...ALLOWED_STATS].join(', ')}. ` +
          `Rejected: ${rejected.join(', ') || '(none)'}`
        );
      }

      const next = mutateDiaryDay(userId, day, cur => ({
        ...cur,
        bodyStats: { ...cur.bodyStats, ...clean },
      }));

      return toolResult({
        ok: true,
        date: day,
        set: clean,
        rejected: rejected.length ? rejected : undefined,
        current_stats: next.bodyStats,
      });
    }
  );
}
