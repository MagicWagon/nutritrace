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
