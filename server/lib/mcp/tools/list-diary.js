/**
 * MCP tool: list_diary_entries
 *
 * Return the food items logged on a given date. Reads from the same
 * diary row the frontend does (JSON blob per day). Returns items in
 * the order they were added, with resolved nutrition + timestamps.
 *
 * date defaults to today (server-local time). Format: YYYY-MM-DD.
 */
import { z } from 'zod';
import db from '../../../db.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerListDiary(server, { userId }) {
  server.registerTool(
    'list_diary_entries',
    {
      title: 'List Diary Entries',
      description:
        'Return the food items logged on a given date (YYYY-MM-DD, defaults to today). ' +
        'Each item includes name, meal slot, portion, unit, quantity, nutrition, and the ' +
        'timestamp it was added.',
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
        `SELECT items, water, body_stats FROM diary WHERE user_id = ? AND date = ?`
      ).get(userId, day);
      const items = row?.items ? _safeJson(row.items, []) : [];
      const result = { date: day, items, count: items.length };
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}

function _todayLocal() {
  // sv-SE gives YYYY-MM-DD in server-local time. Same trick the client uses.
  return new Date().toLocaleDateString('sv-SE');
}
function _safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
function _err(msg) {
  return { content: [{ type: 'text', text: msg }], isError: true };
}
