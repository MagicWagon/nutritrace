/**
 * MCP tool: log_water (Phase 2, write)
 *
 * Append a water log entry to a diary day. Amount is in millilitres
 * to match the storage canonical unit; agents can convert oz on their
 * side (1 fl oz = 29.5735 ml) before calling.
 */
import { z } from 'zod';
import { DATE_RE, todayLocal, toolResult, toolError } from '../_util.js';
import { mutateDiaryDay, DiaryTombstonedError } from '../_diary-write.js';

const MAX_ML_PER_ENTRY = 5000;   // 5 L in one log = obvious agent bug or typo

export function registerLogWater(server, { userId }) {
  server.registerTool(
    'log_water',
    {
      title: 'Log Water',
      description:
        'Append a water log entry to a diary day. Amount is in millilitres ' +
        '(convert oz: 1 fl oz = 29.5735 ml). Date defaults to today in the ' +
        'server timezone. Time is a human string like "2:15 PM" and defaults ' +
        'to now if omitted.',
      inputSchema: {
        amount_ml: z.number().positive().max(MAX_ML_PER_ENTRY),
        date:      z.string().regex(DATE_RE, 'YYYY-MM-DD').optional(),
        time:      z.string().max(20).optional(),
      },
    },
    async ({ amount_ml, date, time }) => {
      const day = date || todayLocal();
      if (!DATE_RE.test(day)) return toolError(`Invalid date '${day}'; expected YYYY-MM-DD.`);

      // Default time to now ONLY when the log is for today; backdated
      // entries default to noon to avoid a stamp that reads as "logged
      // 9 AM on that day" when it was actually filed later.
      const isToday = day === todayLocal();
      const log = {
        amount: Math.round(amount_ml),
        time: time || (isToday
          ? new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          : '12:00 PM'),
      };

      let next;
      try {
        next = mutateDiaryDay(userId, day, cur => ({
          ...cur,
          water: [...cur.water, log],
        }));
      } catch (e) {
        if (e instanceof DiaryTombstonedError) return toolError(e.message);
        throw e;
      }

      const total_ml = next.water.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      return toolResult({
        ok: true,
        date: day,
        logged: log,
        total_ml_on_day: total_ml,
        entry_count_on_day: next.water.length,
      });
    }
  );
}
