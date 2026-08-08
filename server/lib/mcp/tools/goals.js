/**
 * MCP tool: get_goals
 *
 * Returns the user's macro / micronutrient / water goal targets. Same
 * source of truth as the Goals page (user_settings.goals key). All
 * energy values are returned in kcal (canonical storage per #146); the
 * caller can convert to kJ if it prefers.
 */
import { z } from 'zod';
import db from '../../../db.js';

export function registerGetGoals(server, { userId }) {
  server.registerTool(
    'get_goals',
    {
      title: 'Get Goals',
      description:
        "Return the user's current macro / micronutrient / water goal targets. " +
        "Energy is always in kcal. Includes water goal in millilitres.",
      inputSchema: {},
    },
    async () => {
      const row = db.prepare(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'goals'`
      ).get(userId);
      const water = db.prepare(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'waterGoalMl'`
      ).get(userId);
      const goals = row?.value ? _safeJson(row.value, {}) : {};
      const waterGoalMl = water?.value ? Number(_safeJson(water.value, 0)) || null : null;
      const result = { goals, water_goal_ml: waterGoalMl };
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}

function _safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
