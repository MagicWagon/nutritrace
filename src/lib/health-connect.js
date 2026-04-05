/**
 * health-connect.js — Android Health Connect integration.
 *
 * Reads health data from Health Connect and maps to our wellness_data format.
 * Uses @devmaxime/capacitor-health-connect plugin.
 *
 * Available data types:
 * - Steps, Distance, Calories (active + total)
 * - Heart rate (avg, min, max), Resting heart rate
 * - Sleep sessions
 * - Weight
 * - Activity/exercise sessions
 *
 * Data is stored locally in wellness_data with source='health_connect'.
 * When connected to a server, the sync engine pushes it up.
 *
 * EXPERIMENTAL — labeled as such in Settings.
 */

import { isNative } from './platform.js';
import { HealthConnect } from '@devmaxime/capacitor-health-connect';

function _getPlugin() {
  if (!isNative) return null;
  return HealthConnect;
}

/**
 * Check if Health Connect is available on this device.
 * Returns 'Available' | 'NotSupported' | 'NotInstalled'
 */
export async function checkAvailability() {
  const hc = _getPlugin();
  if (!hc) return 'NotSupported';
  try {
    const { availability } = await hc.checkAvailability();
    return availability;
  } catch {
    return 'NotSupported';
  }
}

/**
 * Request read/write permissions from Health Connect.
 */
export async function requestPermissions() {
  const hc = _getPlugin();
  if (!hc) return { read: [], write: [] };
  try {
    // First check if permissions are already granted (avoids triggering crash-prone dialog)
    const existing = await getGrantedPermissions();
    if (existing.read?.length > 0) return existing;

    // Request permissions via Health Connect dialog
    let result;
    try {
      result = await hc.requestPermissions({
        read: ['Steps', 'Weight', 'SleepSession', 'HeartRate', 'ExerciseSession'],
        write: [],
      });
    } catch (e) {
      console.warn('[health-connect] Permission dialog failed:', e.message);
      result = { read: [], write: [] };
    }
    // Check if permissions were actually granted (singleTask launch mode can cause
    // the permission dialog to close immediately without user interaction)
    if (result.read?.length === 0) {
      // Fallback: open Health Connect app so user can grant permissions manually
      console.warn('[health-connect] Permission dialog failed — opening Health Connect app');
      try {
        const { App: CapApp } = await import('@capacitor/app');
        // Open Health Connect's permission management for our app
        window.open('market://details?id=com.google.android.apps.healthdata', '_system');
      } catch {}
      return { read: [], write: [] };
    }
    return result;
  } catch (e) {
    console.error('[health-connect] Permission request failed:', e);
    return { read: [], write: [] };
  }
}

/**
 * Check which permissions are currently granted.
 */
export async function getGrantedPermissions() {
  const hc = _getPlugin();
  if (!hc) return { read: [], write: [] };
  try {
    return await hc.getGrantedPermissions();
  } catch {
    return { read: [], write: [] };
  }
}

/**
 * Read today's health data from Health Connect.
 * Returns an object of wellness_data-compatible metrics.
 */
export async function readTodayData() {
  const hc = _getPlugin();
  if (!hc) return {};

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = now.toISOString();

  const metrics = {};

  // Steps (aggregate for full day)
  try {
    const { aggregates } = await hc.aggregateRecords({
      start: todayStart, end: todayEnd,
      type: 'Steps', groupBy: 'day',
    });
    if (aggregates.length > 0) metrics.steps = aggregates[0].value;
  } catch {}

  // Distance
  try {
    const { aggregates } = await hc.aggregateRecords({
      start: todayStart, end: todayEnd,
      type: 'Distance', groupBy: 'day',
    });
    if (aggregates.length > 0) metrics.distance_km = +(aggregates[0].value / 1000).toFixed(2);
  } catch {}

  // Total calories burned
  try {
    const { aggregates } = await hc.aggregateRecords({
      start: todayStart, end: todayEnd,
      type: 'TotalCaloriesBurned', groupBy: 'day',
    });
    if (aggregates.length > 0) metrics.calories_out = Math.round(aggregates[0].value);
  } catch {}

  // Active calories
  try {
    const { aggregates } = await hc.aggregateRecords({
      start: todayStart, end: todayEnd,
      type: 'ActiveCaloriesBurned', groupBy: 'day',
    });
    if (aggregates.length > 0) metrics.active_calories = Math.round(aggregates[0].value);
  } catch {}

  // Heart rate (aggregate)
  try {
    const { aggregates } = await hc.aggregateRecords({
      start: todayStart, end: todayEnd,
      type: 'HeartRate', groupBy: 'day',
    });
    if (aggregates.length > 0) metrics.avg_heart_rate = Math.round(aggregates[0].value);
  } catch {}

  // Resting heart rate
  try {
    const { records } = await hc.readRecords({
      start: todayStart, end: todayEnd,
      type: 'RestingHeartRate',
    });
    if (records.length > 0) {
      // Take the most recent reading
      const latest = records[records.length - 1];
      metrics.resting_hr = latest.beatsPerMinute || latest.value;
    }
  } catch {}

  // Weight
  try {
    const { records } = await hc.readRecords({
      start: todayStart, end: todayEnd,
      type: 'Weight',
    });
    if (records.length > 0) {
      const latest = records[records.length - 1];
      metrics.weight_kg = +(latest.weight?.inKilograms || latest.value || 0).toFixed(1);
    }
  } catch {}

  // Sleep session (look back 24h for last night's sleep)
  try {
    const sleepStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { records } = await hc.readRecords({
      start: sleepStart, end: todayEnd,
      type: 'SleepSession',
    });
    if (records.length > 0) {
      const sleep = records[records.length - 1]; // Most recent session
      if (sleep.startTime && sleep.endTime) {
        const durMs = new Date(sleep.endTime) - new Date(sleep.startTime);
        metrics.sleep_duration_min = Math.round(durMs / 60000);
      }
      // Parse stages if available
      if (sleep.stages && Array.isArray(sleep.stages)) {
        let deep = 0, rem = 0, light = 0, awake = 0;
        for (const stage of sleep.stages) {
          const durMin = stage.duration ? Math.round(stage.duration / 60000) : 0;
          switch (stage.stage) {
            case 'deep': case 'DEEP': deep += durMin; break;
            case 'rem': case 'REM': rem += durMin; break;
            case 'light': case 'LIGHT': light += durMin; break;
            case 'awake': case 'AWAKE': awake += durMin; break;
          }
        }
        if (deep) metrics.sleep_deep_min = deep;
        if (rem) metrics.sleep_rem_min = rem;
        if (light) metrics.sleep_light_min = light;
        if (awake) metrics.sleep_awake_min = awake;
      }
    }
  } catch {}

  // Activity sessions
  try {
    const { records } = await hc.readRecords({
      start: todayStart, end: todayEnd,
      type: 'ActivitySession',
    });
    if (records.length > 0) {
      let totalMin = 0;
      for (const r of records) {
        if (r.startTime && r.endTime) {
          totalMin += Math.round((new Date(r.endTime) - new Date(r.startTime)) / 60000);
        }
      }
      if (totalMin > 0) metrics.active_minutes = totalMin;
    }
  } catch {}

  return metrics;
}

/**
 * Read a date range of health data. Returns { [date]: { metrics } }.
 */
export async function readDateRange(startDate, endDate) {
  const hc = _getPlugin();
  if (!hc) return {};

  const start = new Date(startDate + 'T00:00:00').toISOString();
  const end = new Date(endDate + 'T23:59:59').toISOString();
  const result = {};

  // Steps by day
  try {
    const { aggregates } = await hc.aggregateRecords({
      start, end, type: 'Steps', groupBy: 'day',
    });
    for (const a of aggregates) {
      const date = a.startTime.slice(0, 10);
      result[date] = result[date] || {};
      result[date].steps = a.value;
    }
  } catch {}

  // Distance by day
  try {
    const { aggregates } = await hc.aggregateRecords({
      start, end, type: 'Distance', groupBy: 'day',
    });
    for (const a of aggregates) {
      const date = a.startTime.slice(0, 10);
      result[date] = result[date] || {};
      result[date].distance_km = +(a.value / 1000).toFixed(2);
    }
  } catch {}

  // Calories by day
  try {
    const { aggregates } = await hc.aggregateRecords({
      start, end, type: 'TotalCaloriesBurned', groupBy: 'day',
    });
    for (const a of aggregates) {
      const date = a.startTime.slice(0, 10);
      result[date] = result[date] || {};
      result[date].calories_out = Math.round(a.value);
    }
  } catch {}

  // Heart rate by day
  try {
    const { aggregates } = await hc.aggregateRecords({
      start, end, type: 'HeartRate', groupBy: 'day',
    });
    for (const a of aggregates) {
      const date = a.startTime.slice(0, 10);
      result[date] = result[date] || {};
      result[date].avg_heart_rate = Math.round(a.value);
    }
  } catch {}

  return result;
}

/**
 * Sync Health Connect data to local wellness_data DB.
 * Called during sync cycle when Health Connect is enabled.
 */
export async function syncHealthConnect(dateStr) {
  const metrics = await readTodayData();
  if (Object.keys(metrics).length === 0) return;

  const { dbUpsertWellness } = await import('./db-native.js');
  for (const [type, value] of Object.entries(metrics)) {
    if (value != null) {
      await dbUpsertWellness(dateStr, 'health_connect', type, value);
    }
  }

  console.log(`[health-connect] Synced ${Object.keys(metrics).length} metrics for ${dateStr}`);
  return metrics;
}
