/**
 * MCP tool registrar. Called once per request when the McpServer is
 * built. Each tool is registered against the user identified by
 * ctx.userId — the token that hit the MCP endpoint owns the scope
 * of every query. No cross-user access is possible from an MCP
 * handler; every DB query in each tool prepends `WHERE user_id = ?`.
 */
import { registerGetGoals } from './goals.js';
import { registerListDiary } from './list-diary.js';
import { registerDailyTotals } from './daily-totals.js';
import { registerSearchFoods } from './search-foods.js';
import { registerRecentFoods } from './recent-foods.js';

export function registerReadTools(server, ctx) {
  registerGetGoals(server, ctx);
  registerListDiary(server, ctx);
  registerDailyTotals(server, ctx);
  registerSearchFoods(server, ctx);
  registerRecentFoods(server, ctx);
}
