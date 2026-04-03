/**
 * gotify.js — Send push notifications via Gotify server
 *
 * Reads the user's gotifyUrl and gotifyToken from user_settings.
 * Called from Fitbit/Garmin/Withings sync routes when events occur.
 */

import db from '../db.js';
import { logger } from '../logger.js';

function _getUserSetting(userId, key) {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key);
  if (!row?.value) return '';
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function _isEnabled(userId, key) {
  const val = _getUserSetting(userId, key);
  return val === true || val === 'true';
}

/**
 * Send a Gotify notification for a user (if configured)
 * @param {number} userId
 * @param {string} settingKey — which notification type to check (e.g. 'notifWellnessAlerts')
 * @param {string} title
 * @param {string} message
 * @param {number} priority — 1-10 (5 = default)
 */
export async function pushGotify(userId, settingKey, title, message, priority = 5) {
  if (!_isEnabled(userId, settingKey)) return;

  const url = _getUserSetting(userId, 'gotifyUrl');
  const token = _getUserSetting(userId, 'gotifyToken');
  if (!url || !token) return;

  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/message?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `NutriTrace — ${title}`, message, priority }),
    });
    if (!res.ok) {
      logger.warn(`[gotify] push failed for user ${userId}: ${res.status}`);
    } else {
      logger.debug(`[gotify] pushed "${title}" to user ${userId}`);
    }
  } catch (e) {
    logger.warn(`[gotify] push failed for user ${userId}: ${e.message}`);
  }
}

/** Convenience: send wellness alert */
export function alertWellness(userId, message) {
  return pushGotify(userId, 'notifWellnessAlerts', 'Wellness Alert', message, 7);
}

/** Convenience: send workout summary */
export function notifyWorkout(userId, message) {
  return pushGotify(userId, 'notifWorkoutSummary', 'Workout Complete', message, 5);
}

/** Convenience: send sync failure */
export function alertSyncFailure(userId, message) {
  return pushGotify(userId, 'notifSyncFailures', 'Sync Issue', message, 8);
}

/** Convenience: step goal notification */
export function notifyStepGoal(userId, steps, goal) {
  if (steps >= goal) {
    return pushGotify(userId, 'notifStepGoal', 'Step Goal Reached!',
      `${steps.toLocaleString()} steps — goal was ${goal.toLocaleString()}!`, 5);
  }
  // Midday nudge
  const hour = new Date().getHours();
  if (hour >= 12 && hour <= 14 && steps < goal * 0.5) {
    return pushGotify(userId, 'notifStepGoal', 'Step Goal Progress',
      `${steps.toLocaleString()} steps so far — ${(goal - steps).toLocaleString()} to go!`, 4);
  }
}

/** Convenience: calorie goal alert */
export function notifyCalorieGoal(userId, calories, goal) {
  return pushGotify(userId, 'notifCalorieGoal', 'Calorie Target Reached',
    `${Math.round(calories).toLocaleString()} kcal — daily target is ${Math.round(goal).toLocaleString()} kcal`, 5);
}

/** Generate and send weekly summary */
export async function sendWeeklySummary(userId) {
  const rows = db.prepare(
    `SELECT metric_type, AVG(value) as avg FROM wellness_data
     WHERE user_id=? AND source='fitbit' AND date >= date('now','-7 days')
     AND metric_type IN ('steps','calories_out','sleep_duration_min')
     GROUP BY metric_type`
  ).all(userId);

  const m = {};
  for (const r of rows) m[r.metric_type] = r.avg;

  const parts = [];
  if (m.steps) parts.push(`Avg steps: ${Math.round(m.steps).toLocaleString()}`);
  if (m.calories_out) parts.push(`Avg cal burned: ${Math.round(m.calories_out).toLocaleString()}`);
  if (m.sleep_duration_min) {
    const h = Math.floor(m.sleep_duration_min / 60);
    const min = Math.round(m.sleep_duration_min % 60);
    parts.push(`Avg sleep: ${h}h ${min}m`);
  }

  if (parts.length) {
    return pushGotify(userId, 'notifWeeklySummary', 'Weekly Summary', parts.join('\n'), 4);
  }
}
