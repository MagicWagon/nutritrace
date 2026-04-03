/**
 * notifications.js — Local notification scheduling for NutriTrace
 *
 * Handles water reminders, meal reminders, and goal celebrations.
 * Uses @capacitor/local-notifications on native, Notification API on PWA.
 */

import { isNative } from './platform.js';

let _LocalNotifications = null;

async function _getLN() {
  if (_LocalNotifications) return _LocalNotifications;
  if (isNative) {
    const mod = await import('@capacitor/local-notifications');
    _LocalNotifications = mod.LocalNotifications;
    return _LocalNotifications;
  }
  return null;
}

/** Request notification permission */
export async function requestPermission() {
  if (isNative) {
    const LN = await _getLN();
    if (!LN) return false;
    const result = await LN.requestPermissions();
    return result.display === 'granted';
  }
  // PWA: use Notification API
  if ('Notification' in window) {
    const result = await Notification.requestPermission();
    return result === 'granted';
  }
  return false;
}

/** Check if notifications are permitted */
export async function checkPermission() {
  if (isNative) {
    const LN = await _getLN();
    if (!LN) return false;
    const result = await LN.checkPermissions();
    return result.display === 'granted';
  }
  if ('Notification' in window) return Notification.permission === 'granted';
  return false;
}

/** Show an immediate notification */
export async function showNotification(title, body, id = Date.now()) {
  if (isNative) {
    const LN = await _getLN();
    if (!LN) return;
    await LN.schedule({ notifications: [{ id, title, body, channelId: 'nutritrace' }] });
  } else if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/icons/icon-192.png' });
  }
}

// ── Water reminders ─────────────────────────────────────────────────────────

/** Schedule recurring water reminders every `intervalMin` minutes, from 8am to 10pm */
export async function scheduleWaterReminders(intervalMin = 120) {
  if (!isNative) return; // PWA can't schedule future notifications reliably
  const LN = await _getLN();
  if (!LN) return;

  // Cancel existing water reminders first
  await cancelWaterReminders();

  const notifications = [];
  const now = new Date();
  const startHour = 8, endHour = 22;

  // Schedule for today and tomorrow
  for (let day = 0; day < 2; day++) {
    const base = new Date(now);
    base.setDate(base.getDate() + day);
    base.setHours(startHour, 0, 0, 0);

    while (base.getHours() < endHour) {
      if (base > now) {
        notifications.push({
          id: 1000 + notifications.length,
          title: 'Hydration Reminder',
          body: 'Time to drink some water! Stay hydrated.',
          schedule: { at: new Date(base) },
          channelId: 'nutritrace',
        });
      }
      base.setMinutes(base.getMinutes() + intervalMin);
    }
  }

  if (notifications.length) {
    await LN.schedule({ notifications });
    console.log(`[notifications] scheduled ${notifications.length} water reminders (every ${intervalMin} min)`);
  }
}

export async function cancelWaterReminders() {
  if (!isNative) return;
  const LN = await _getLN();
  if (!LN) return;
  const pending = await LN.getPending();
  const waterIds = pending.notifications.filter(n => n.id >= 1000 && n.id < 2000).map(n => ({ id: n.id }));
  if (waterIds.length) await LN.cancel({ notifications: waterIds });
}

// ── Meal reminders ──────────────────────────────────────────────────────────

/** Schedule daily meal reminders at specified times (e.g. ['08:00', '12:00', '18:00']) */
export async function scheduleMealReminders(times = ['08:00', '12:00', '18:00'], mealNames = ['Breakfast', 'Lunch', 'Dinner']) {
  if (!isNative) return;
  const LN = await _getLN();
  if (!LN) return;

  await cancelMealReminders();

  const notifications = [];
  const now = new Date();

  for (let day = 0; day < 2; day++) {
    times.forEach((time, i) => {
      const [h, m] = time.split(':').map(Number);
      const at = new Date(now);
      at.setDate(at.getDate() + day);
      at.setHours(h, m, 0, 0);
      if (at > now) {
        notifications.push({
          id: 2000 + day * 10 + i,
          title: 'Meal Reminder',
          body: `Time to log your ${mealNames[i] || 'meal'}!`,
          schedule: { at },
          channelId: 'nutritrace',
        });
      }
    });
  }

  if (notifications.length) {
    await LN.schedule({ notifications });
    console.log(`[notifications] scheduled ${notifications.length} meal reminders`);
  }
}

export async function cancelMealReminders() {
  if (!isNative) return;
  const LN = await _getLN();
  if (!LN) return;
  const pending = await LN.getPending();
  const mealIds = pending.notifications.filter(n => n.id >= 2000 && n.id < 3000).map(n => ({ id: n.id }));
  if (mealIds.length) await LN.cancel({ notifications: mealIds });
}

// ── Unified notify — sends to all enabled delivery methods ──────────────────

function _getSetting(key, def) {
  // Read from localStorage directly (same as DB.getSetting but without circular import)
  const userId = localStorage.getItem('wl:userId');
  const storageKey = userId ? `wl_u${userId}_${key}` : `wl_${key}`;
  const raw = localStorage.getItem(storageKey);
  if (raw === null) return def;
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Send a notification through all enabled delivery methods.
 * @param {string} settingKey — which notification type to check (e.g. 'notifWellnessAlerts')
 * @param {string} title
 * @param {string} body
 * @param {number} priority — 1-10 for Gotify (5 = default)
 */
export async function notify(settingKey, title, body, priority = 5) {
  // Check if this notification type is enabled
  if (!_getSetting(settingKey, false)) return;

  // Local device notification
  if (_getSetting('notifLocalEnabled', true)) {
    await showNotification(title, body);
  }

  // Gotify
  if (_getSetting('notifGotifyEnabled', false)) {
    const url = _getSetting('gotifyUrl', '');
    const token = _getSetting('gotifyToken', '');
    if (url && token) {
      await sendGotify(url, token, title, body, priority);
    }
  }
}

// ── Goal checking ───────────────────────────────────────────────────────────

// Track which goals we've already celebrated today to avoid repeats
const _celebratedToday = new Set();

/** Reset celebrations at midnight */
function _resetCelebrations() {
  const key = new Date().toLocaleDateString('sv-SE');
  if (_celebratedToday._date !== key) {
    _celebratedToday.clear();
    _celebratedToday._date = key;
  }
}

const GOAL_LABELS = {
  calories: 'Calorie', proteins: 'Protein', carbohydrates: 'Carbs', fat: 'Fat',
  fiber: 'Fiber', sodium: 'Sodium', sugars: 'Sugar', 'saturated-fat': 'Saturated Fat',
  cholesterol: 'Cholesterol', potassium: 'Potassium', calcium: 'Calcium',
  iron: 'Iron', 'vitamin-c': 'Vitamin C', 'vitamin-a': 'Vitamin A',
  'vitamin-d': 'Vitamin D', water_ml: 'Water',
  sleep_duration_min: 'Sleep', steps: 'Steps', active_minutes: 'Active Minutes',
  distance_km: 'Distance', calories_out: 'Calories Burned',
};

const GOAL_UNITS = {
  calories: 'kcal', proteins: 'g', carbohydrates: 'g', fat: 'g',
  fiber: 'g', sodium: 'mg', sugars: 'g', 'saturated-fat': 'g',
  cholesterol: 'mg', potassium: 'mg', calcium: 'mg', iron: 'mg',
  'vitamin-c': 'mg', 'vitamin-a': 'mcg', 'vitamin-d': 'mcg',
  water_ml: 'ml', sleep_duration_min: 'min', steps: 'steps',
  active_minutes: 'min', distance_km: 'km', calories_out: 'kcal',
};

/**
 * Check all goals against current values and fire notifications for any that are met.
 * @param {Object} goals — the user's goals object { calories: { min, max }, proteins: { min }, ... }
 * @param {Object} values — current totals { calories: 1850, proteins: 120, ... }
 */
export async function checkGoals(goals, values) {
  if (!goals || !values) return;
  _resetCelebrations();

  for (const [key, goal] of Object.entries(goals)) {
    if (!goal) continue;
    const val = values[key];
    if (val == null) continue;

    const target = goal.min ?? goal.max;
    if (target == null) continue;

    const celebKey = `${key}_${new Date().toLocaleDateString('sv-SE')}`;
    if (_celebratedToday.has(celebKey)) continue;

    // Goal celebration: hit the target (min) or reached limit (max)
    if (goal.min != null && val >= goal.min) {
      _celebratedToday.add(celebKey);
      const label = GOAL_LABELS[key] || key;
      const unit = GOAL_UNITS[key] || '';
      await notify('notifGoalCelebrations', 'Goal Reached!',
        `You hit your ${label} goal: ${Math.round(val).toLocaleString()} ${unit} (target: ${Math.round(goal.min).toLocaleString()})`, 5);
    }

    // Calorie goal specific
    if (key === 'calories' && goal.max != null && val >= goal.max) {
      if (!_celebratedToday.has('cal_max')) {
        _celebratedToday.add('cal_max');
        await notify('notifCalorieGoal', 'Calorie Target Reached',
          `You've hit ${Math.round(val).toLocaleString()} kcal — your daily target is ${Math.round(goal.max).toLocaleString()} kcal`, 6);
      }
    }
  }
}

/**
 * Check step goal after Fitbit/Garmin sync
 * @param {number} steps — today's step count
 * @param {number} goal — step goal
 */
export async function checkStepGoal(steps, goal) {
  if (!steps || !goal) return;
  _resetCelebrations();

  if (steps >= goal && !_celebratedToday.has('steps_hit')) {
    _celebratedToday.add('steps_hit');
    await notify('notifStepGoal', 'Step Goal Reached!',
      `You've walked ${steps.toLocaleString()} steps — goal was ${goal.toLocaleString()}!`, 5);
  } else if (!_celebratedToday.has('steps_midday')) {
    // Midday nudge: if it's between 12pm-2pm and under 50% of goal
    const hour = new Date().getHours();
    if (hour >= 12 && hour <= 14 && steps < goal * 0.5) {
      _celebratedToday.add('steps_midday');
      const remaining = goal - steps;
      await notify('notifStepGoal', 'Step Goal Progress',
        `You're at ${steps.toLocaleString()} steps — ${remaining.toLocaleString()} to go!`, 4);
    }
  }
}

// ── Gotify push ─────────────────────────────────────────────────────────────

/** Send a notification via Gotify server */
export async function sendGotify(url, token, title, message, priority = 5) {
  if (!url || !token) return;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/message?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `NutriTrace — ${title}`, message, priority }),
    });
    if (!res.ok) console.warn(`[gotify] push failed: ${res.status}`);
  } catch (e) {
    console.warn('[gotify] push failed:', e.message);
  }
}

/** Test Gotify connection */
export async function testGotify(url, token) {
  try {
    await sendGotify(url, token, 'NutriTrace', 'Test notification — Gotify is connected!', 5);
    return true;
  } catch {
    return false;
  }
}

// ── Weigh-in reminder scheduling ────────────────────────────────────────────

export async function scheduleWeighInReminder(timeStr = '07:00') {
  if (!isNative) return;
  const LN = await _getLN();
  if (!LN) return;
  await cancelWeighInReminder();

  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const notifications = [];

  for (let day = 0; day < 2; day++) {
    const at = new Date(now);
    at.setDate(at.getDate() + day);
    at.setHours(h, m, 0, 0);
    if (at > now) {
      notifications.push({
        id: 4000 + day,
        title: 'Weigh-in Reminder',
        body: 'Time to step on the scale!',
        schedule: { at },
        channelId: 'nutritrace',
      });
    }
  }

  if (notifications.length) await LN.schedule({ notifications });
}

export async function cancelWeighInReminder() {
  if (!isNative) return;
  const LN = await _getLN();
  if (!LN) return;
  const pending = await LN.getPending();
  const ids = pending.notifications.filter(n => n.id >= 4000 && n.id < 5000).map(n => ({ id: n.id }));
  if (ids.length) await LN.cancel({ notifications: ids });
}
