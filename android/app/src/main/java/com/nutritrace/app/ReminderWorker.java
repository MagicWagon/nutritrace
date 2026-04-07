package com.nutritrace.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

/**
 * ReminderWorker — periodic background worker that checks the local SQLite
 * database and posts smart notifications without requiring the app to be open.
 *
 * Battery-conscious design:
 *  - Network constraint NONE (local DB only)
 *  - Read-only DB access
 *  - Returns immediately if no relevant time window or already-logged
 *  - Single worker handles water + meal + weigh-in
 *
 * Reads from the same SQLite database the JS app uses
 * (capacitor-community/sqlite stores it as <name>SQLite.db in databases dir).
 */
public class ReminderWorker extends Worker {
    private static final String TAG = "ReminderWorker";
    private static final String DB_FILENAME = "nutritrace_localSQLite.db";
    private static final String CHANNEL_ID = "nutritrace_reminders";

    public ReminderWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            File dbFile = getApplicationContext().getDatabasePath(DB_FILENAME);
            if (!dbFile.exists()) {
                Log.d(TAG, "DB not found at " + dbFile.getAbsolutePath() + " — skipping");
                return Result.success();
            }

            SQLiteDatabase db = SQLiteDatabase.openDatabase(
                dbFile.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            try {
                runChecks(db);
            } finally {
                db.close();
            }
            // Re-evaluate which workers should be enqueued/cancelled so Settings
            // toggles (e.g. enabling Health Connect) take effect within 15 min.
            WorkerScheduler.reschedule(getApplicationContext());
            return Result.success();
        } catch (Exception e) {
            Log.w(TAG, "worker failed: " + e.getMessage());
            return Result.success(); // never retry-spam
        }
    }

    private void runChecks(SQLiteDatabase db) {
        Calendar now = Calendar.getInstance();
        int currentMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        String today = String.format(java.util.Locale.US, "%04d-%02d-%02d",
            now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH));

        // Check meal reminders
        if (getBoolSetting(db, "notifMealReminders")) {
            checkMealReminders(db, currentMin, today);
        }

        // Check water reminders
        if (getBoolSetting(db, "notifWaterReminders")) {
            checkWaterReminders(db, currentMin, today);
        }

        // Check weigh-in reminder
        if (getBoolSetting(db, "notifWeighIn")) {
            checkWeighInReminder(db, currentMin, today);
        }
    }

    // ── Meal reminders ─────────────────────────────────────────────────────
    private void checkMealReminders(SQLiteDatabase db, int currentMin, String today) {
        JSONArray times = getArraySetting(db, "notifMealTimes");
        if (times == null || times.length() == 0) return; // no times configured → nothing to do
        // mealNames is OPTIONAL — if missing or shorter than times, fall back to a
        // generic "meal" label rather than lying with stale defaults like "Dinner"
        // when the user has restructured their meal slots.
        JSONArray names = getArraySetting(db, "mealNames");

        Set<Integer> loggedSlots = getLoggedMealSlots(db, today);

        for (int i = 0; i < times.length(); i++) {
            try {
                String time = times.getString(i);
                String[] hm = time.split(":");
                int targetMin = Integer.parseInt(hm[0]) * 60 + Integer.parseInt(hm[1]);
                // Within 15-min window of target time?
                if (currentMin < targetMin || currentMin >= targetMin + 15) continue;
                // Already logged?
                if (loggedSlots.contains(i)) {
                    Log.d(TAG, "skipping meal " + i + " — already logged");
                    continue;
                }
                // Use the user's meal name if available at this index, else generic
                String mealName = (names != null && i < names.length()) ? names.getString(i) : "meal";
                postNotification(2000 + i, "🍽️ Meal Reminder",
                    "Time to log your " + mealName + "!");
            } catch (Exception e) {
                Log.w(TAG, "meal " + i + " check failed: " + e.getMessage());
            }
        }
    }

    private Set<Integer> getLoggedMealSlots(SQLiteDatabase db, String today) {
        Set<Integer> slots = new HashSet<>();
        Cursor c = null;
        try {
            c = db.rawQuery(
                "SELECT items FROM diary WHERE date = ? AND deleted_at IS NULL",
                new String[]{today});
            if (c.moveToFirst()) {
                String itemsJson = c.getString(0);
                if (itemsJson != null && !itemsJson.isEmpty()) {
                    JSONArray items = new JSONArray(itemsJson);
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.getJSONObject(i);
                        slots.add(item.optInt("meal", 0));
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "diary read failed: " + e.getMessage());
        } finally {
            if (c != null) c.close();
        }
        return slots;
    }

    // ── Water reminders ────────────────────────────────────────────────────
    private void checkWaterReminders(SQLiteDatabase db, int currentMin, String today) {
        int interval = (int) getIntSetting(db, "notifWaterInterval", 120);
        int startMin = 8 * 60;  // 08:00
        int endMin = 22 * 60;   // 22:00
        if (currentMin < startMin || currentMin >= endMin) return;

        int minSinceStart = currentMin - startMin;
        // Only fire near interval boundaries (within 15 min window)
        if (minSinceStart % interval >= 15) return;

        // Skip if water goal already met
        long waterGoal = getIntSetting(db, "waterGoalMl", 0);
        if (waterGoal > 0) {
            long waterTotal = getWaterTotal(db, today);
            if (waterTotal >= waterGoal) {
                Log.d(TAG, "skipping water reminder — goal met (" + waterTotal + "/" + waterGoal + ")");
                return;
            }
        }

        // Use intervalIdx as the notification ID so each interval slot fires only once
        int intervalIdx = minSinceStart / interval;
        postNotification(3000 + intervalIdx, "💧 Hydration Reminder",
            "Time to drink some water! Stay hydrated.");
    }

    private long getWaterTotal(SQLiteDatabase db, String today) {
        Cursor c = null;
        long total = 0;
        try {
            c = db.rawQuery(
                "SELECT water FROM diary WHERE date = ? AND deleted_at IS NULL",
                new String[]{today});
            if (c.moveToFirst()) {
                String waterJson = c.getString(0);
                if (waterJson != null && !waterJson.isEmpty()) {
                    JSONArray logs = new JSONArray(waterJson);
                    for (int i = 0; i < logs.length(); i++) {
                        total += logs.getJSONObject(i).optLong("amount", 0);
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "water read failed: " + e.getMessage());
        } finally {
            if (c != null) c.close();
        }
        return total;
    }

    // ── Weigh-in reminder ──────────────────────────────────────────────────
    private void checkWeighInReminder(SQLiteDatabase db, int currentMin, String today) {
        String time = getStringSetting(db, "notifWeighInTime", "07:00");
        try {
            String[] hm = time.split(":");
            int targetMin = Integer.parseInt(hm[0]) * 60 + Integer.parseInt(hm[1]);
            if (currentMin < targetMin || currentMin >= targetMin + 15) return;
            postNotification(4000, "⚖️ Weigh-in Reminder", "Time to step on the scale!");
        } catch (Exception e) {
            Log.w(TAG, "weigh-in check failed: " + e.getMessage());
        }
    }

    // ── Settings helpers ───────────────────────────────────────────────────
    private String getRawSetting(SQLiteDatabase db, String key) {
        Cursor c = null;
        try {
            c = db.rawQuery("SELECT value FROM user_settings WHERE key = ? LIMIT 1",
                new String[]{key});
            if (c.moveToFirst()) return c.getString(0);
        } catch (Exception e) {
            // table may not exist yet on first launch
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    private boolean getBoolSetting(SQLiteDatabase db, String key) {
        String v = getRawSetting(db, key);
        if (v == null) return false;
        v = v.replace("\"", "").trim();
        return "true".equalsIgnoreCase(v) || "1".equals(v);
    }

    private long getIntSetting(SQLiteDatabase db, String key, long def) {
        String v = getRawSetting(db, key);
        if (v == null) return def;
        try { return Long.parseLong(v.replace("\"", "").trim()); }
        catch (Exception e) { return def; }
    }

    private String getStringSetting(SQLiteDatabase db, String key, String def) {
        String v = getRawSetting(db, key);
        if (v == null) return def;
        return v.replace("\"", "").trim();
    }

    private JSONArray getArraySetting(SQLiteDatabase db, String key) {
        String v = getRawSetting(db, key);
        if (v == null) return null;
        try { return new JSONArray(v); }
        catch (Exception e) { return null; }
    }

    // ── Notification posting ───────────────────────────────────────────────
    private void postNotification(int id, String title, String body) {
        Context ctx = getApplicationContext();
        ensureChannel(ctx);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(id, builder.build());
        } catch (SecurityException e) {
            Log.w(TAG, "notify denied: " + e.getMessage());
        }
    }

    private void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "NutriTrace Reminders",
                    NotificationManager.IMPORTANCE_DEFAULT);
                channel.setDescription("Meal, water, and weigh-in reminders");
                nm.createNotificationChannel(channel);
            }
        }
    }
}
