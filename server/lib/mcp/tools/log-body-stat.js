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
import { mutateDiaryDay, DiaryTombstonedError } from '../_diary-write.js';

// Allowed body-stat keys with { min, max } sanity ranges. Values
// outside the range are rejected so a wrong-sign or typo (e.g. -70,
// or 700 kg) doesn't land in the diary and skew charts. Ranges are
// generous — clinically implausible but physically plausible — because
// the MCP tool is a data pipe, not a validator; the app UI catches
// finer input mistakes.
const STAT_RANGES = {
  weight:       { min: 0.5,  max: 500,  unit: 'kg' },
  body_fat:     { min: 0,    max: 80,   unit: '%'  },
  muscle_mass:  { min: 1,    max: 200,  unit: 'kg' },
  water_pct:    { min: 0,    max: 100,  unit: '%'  },
  bone_mass:    { min: 0.5,  max: 20,   unit: 'kg' },
  visceral_fat: { min: 1,    max: 59,   unit: 'AU' },
  waist:        { min: 30,   max: 250,  unit: 'cm' },
  hip:          { min: 30,   max: 250,  unit: 'cm' },
  neck:         { min: 15,   max: 100,  unit: 'cm' },
  chest:        { min: 40,   max: 250,  unit: 'cm' },
  arm:          { min: 10,   max: 100,  unit: 'cm' },
  thigh:        { min: 20,   max: 150,  unit: 'cm' },
  calf:         { min: 15,   max: 100,  unit: 'cm' },
};
const ALLOWED_STATS = new Set(Object.keys(STAT_RANGES));

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
        if (!ALLOWED_STATS.has(k)) { rejected.push(`${k} (unknown key)`); continue; }
        if (!Number.isFinite(v))   { rejected.push(`${k} (not a number)`); continue; }
        const { min, max, unit } = STAT_RANGES[k];
        if (v < min || v > max)    { rejected.push(`${k} (${v} outside ${min}-${max} ${unit})`); continue; }
        clean[k] = Math.round(v * 100) / 100;   // 2-decimal cap
      }
      if (Object.keys(clean).length === 0) {
        return toolError(
          `No valid stats. Allowed keys: ${[...ALLOWED_STATS].join(', ')}. ` +
          `Rejected: ${rejected.join(', ') || '(none)'}`
        );
      }

      let next;
      try {
        next = mutateDiaryDay(userId, day, cur => ({
          ...cur,
          bodyStats: { ...cur.bodyStats, ...clean },
        }));
      } catch (e) {
        if (e instanceof DiaryTombstonedError) return toolError(e.message);
        throw e;
      }

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
