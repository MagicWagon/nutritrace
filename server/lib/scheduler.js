/**
 * scheduler.js — Server-side scheduled tasks
 *
 * Runs periodic checks for:
 * 1. Scheduled wellness sync (Fitbit/Garmin/Withings) per user settings
 * 2. Push notifications for time-based reminders (water, meal, weigh-in)
 * 3. Weekly summary on Sundays
 *
 * Checks every 15 minutes. Each user's schedule is read from user_settings.
 */

import db from '../db.js';
import { logger } from '../logger.js';

const _lastRun = {}; // userId_task → timestamp (dedup within window)

function _getUserSetting(userId, key) {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key);
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function _isEnabled(userId, key) {
  const val = _getUserSetting(userId, key);
  return val === true || val === 'true';
}

function _dedupKey(userId, task) { return `${userId}_${task}`; }

function _ranRecently(userId, task, windowMs = 14 * 60 * 1000) {
  const key = _dedupKey(userId, task);
  const last = _lastRun[key];
  if (last && Date.now() - last < windowMs) return true;
  _lastRun[key] = Date.now();
  return false;
}

// ── Scheduled wellness sync ─────────────────────────────────────────────────

async function _syncWellness(userId) {
  const syncMode = _getUserSetting(userId, 'wellnessSyncMode');
  if (syncMode !== 'scheduled') return;

  const schedule = _getUserSetting(userId, 'wellnessSyncSchedule') || 'daily';
  const syncTime = _getUserSetting(userId, 'wellnessSyncTime') || '14:00';
  const now = new Date();
  const [h, m] = syncTime.split(':').map(Number);
  const hour = now.getHours(), minute = now.getMinutes();

  // Check if we're within the 15-minute window of the scheduled time
  const scheduledMin = h * 60 + m;
  const currentMin = hour * 60 + minute;
  const diff = currentMin - scheduledMin;

  let shouldSync = false;
  if (schedule === 'daily' && diff >= 0 && diff < 15) shouldSync = true;
  if (schedule === 'every6h' && hour % 6 === h % 6 && minute < 15) shouldSync = true;
  if (schedule === 'every12h' && hour % 12 === h % 12 && minute < 15) shouldSync = true;
  if (schedule === 'weekly' && now.getDay() === 0 && diff >= 0 && diff < 15) shouldSync = true;

  if (!shouldSync) return;
  if (_ranRecently(userId, 'wellness_sync', 5 * 60 * 60 * 1000)) return; // 5h dedup for daily

  logger.info(`[scheduler] running scheduled wellness sync for user ${userId}`);

  // Import and run Fitbit sync
  try {
    const today = now.toISOString().slice(0, 10);

    // Fitbit sync — call internal sync function directly (no HTTP/auth needed)
    const hasFitbit = db.prepare('SELECT 1 FROM fitbit_tokens WHERE user_id=?').get(userId);
    if (hasFitbit) {
      try {
        const { syncDate } = await import('../routes/fitbit.js');
        logger.info(`[scheduler] Fitbit sync for user ${userId} date ${today}`);
        const { metrics, errors } = await syncDate(userId, today);
        logger.info(`[scheduler] Fitbit sync done: ${Object.keys(metrics || {}).length} metrics, ${errors?.length || 0} errors`);
      } catch (e) {
        logger.warn(`[scheduler] Fitbit sync error for user ${userId}: ${e.message}`);
        try { const { alertSyncFailure } = await import('./push-notify.js'); alertSyncFailure(userId, `Scheduled Fitbit sync failed: ${e.message}`); } catch {}
      }
    }
  } catch (e) {
    logger.warn(`[scheduler] wellness sync failed for user ${userId}: ${e.message}`);
  }
}

// ── Push reminders (water, meal, weigh-in) ──────────────────────────────────

async function _pushReminders(userId) {
  const pushService = _getUserSetting(userId, 'notifPushService');
  if (!pushService || pushService === 'none') return;

  const { pushNotify } = await import('./push-notify.js');
  const now = new Date();
  const hour = now.getHours(), minute = now.getMinutes();
  const currentMin = hour * 60 + minute;

  // Water reminders
  if (_isEnabled(userId, 'notifWaterReminders')) {
    const interval = _getUserSetting(userId, 'notifWaterInterval') || 120;
    const startMin = 8 * 60, endMin = 22 * 60;
    if (currentMin >= startMin && currentMin < endMin) {
      // Check if current time falls on an interval boundary (within 15 min window)
      const minSinceStart = currentMin - startMin;
      if (minSinceStart % interval < 15 && !_ranRecently(userId, `water_${Math.floor(minSinceStart / interval)}`, interval * 60 * 1000)) {
        await pushNotify(userId, 'notifWaterReminders', '💧 Hydration Reminder', 'Time to drink some water! Stay hydrated.', 4);
      }
    }
  }

  // Meal reminders
  if (_isEnabled(userId, 'notifMealReminders')) {
    const times = _getUserSetting(userId, 'notifMealTimes') || ['08:00', '12:00', '18:00'];
    const mealNames = _getUserSetting(userId, 'mealNames') || ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
    times.forEach((time, i) => {
      const [th, tm] = time.split(':').map(Number);
      const targetMin = th * 60 + tm;
      if (currentMin >= targetMin && currentMin < targetMin + 15 && !_ranRecently(userId, `meal_${i}`)) {
        pushNotify(userId, 'notifMealReminders', '🍽️ Meal Reminder', `Time to log your ${mealNames[i] || 'meal'}!`, 4);
      }
    });
  }

  // Weigh-in reminder
  if (_isEnabled(userId, 'notifWeighIn')) {
    const time = _getUserSetting(userId, 'notifWeighInTime') || '07:00';
    const [th, tm] = time.split(':').map(Number);
    const targetMin = th * 60 + tm;
    if (currentMin >= targetMin && currentMin < targetMin + 15 && !_ranRecently(userId, 'weighin')) {
      await pushNotify(userId, 'notifWeighIn', '⚖️ Weigh-in Reminder', 'Time to step on the scale!', 4);
    }
  }

  // Weekly summary (Sunday)
  if (_isEnabled(userId, 'notifWeeklySummary') && now.getDay() === 0 && hour >= 9 && hour < 10 && !_ranRecently(userId, 'weekly', 6 * 24 * 60 * 60 * 1000)) {
    const { sendWeeklySummary } = await import('./push-notify.js');
    await sendWeeklySummary(userId);
  }
}

// ── Main tick — called every 15 minutes ─────────────────────────────────────

async function _tick() {
  try {
    // Get all users (or single user if no user management)
    const users = db.prepare('SELECT id FROM users').all();
    const userIds = users.length ? users.map(u => u.id) : [0];

    for (const userId of userIds) {
      try {
        await _pushReminders(userId);
        await _syncWellness(userId);
      } catch (e) {
        logger.debug(`[scheduler] error for user ${userId}: ${e.message}`);
      }
    }
  } catch (e) {
    logger.debug(`[scheduler] tick error: ${e.message}`);
  }
}

/** Start the scheduler — call once at server startup */
export function startScheduler() {
  logger.info('[scheduler] started (15-minute interval)');
  // Run first tick after 30 seconds (let server fully boot)
  setTimeout(_tick, 30000);
  // Then every 15 minutes
  setInterval(_tick, 15 * 60 * 1000);
}
