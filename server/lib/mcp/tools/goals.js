/**
 * MCP tool: get_goals
 *
 * Returns the user's macro / micronutrient / water goal targets. Same
 * source of truth as the Goals page (user_settings.goals key). All
 * energy values are returned in kcal (canonical storage per #146); the
 * caller can convert to kJ if it prefers.
 *
 * Filters out tombstoned user_settings rows (deleted_at IS NOT NULL)
 * so agents don't see values a user has since reset.
 */
import db from '../../../db.js';
import { safeJson, toolResult } from '../_util.js';

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
        `SELECT value FROM user_settings
          WHERE user_id = ? AND key = 'goals' AND deleted_at IS NULL`
      ).get(userId);
      const water = db.prepare(
        `SELECT value FROM user_settings
          WHERE user_id = ? AND key = 'waterGoalMl' AND deleted_at IS NULL`
      ).get(userId);
      const goals = row?.value ? safeJson(row.value, {}) : {};
      const waterGoalMl = water?.value ? Number(safeJson(water.value, 0)) || null : null;
      return toolResult({ goals, water_goal_ml: waterGoalMl });
    }
  );
}
