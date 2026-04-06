package com.nutritrace.app;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * HealthConnectSyncWorker — placeholder periodic worker that wakes the JS app
 * to perform a Health Connect read when the app is closed.
 *
 * Note: Reading Health Connect data requires the @devmaxime/capacitor-health-connect
 * plugin which only runs in the JS layer. A pure native implementation would
 * require duplicating the Health Connect SDK calls in Kotlin/Java, which is
 * outside scope for now.
 *
 * Current behavior: this worker is enqueued only when healthConnectEnabled=true,
 * and simply marks a "needs sync" flag in SharedPreferences that the app reads
 * on next launch. If you open the app at any point during the day, the regular
 * sync flow will pick up fresh HC data.
 *
 * Battery: same constraints as ReminderWorker — no network, batteryNotLow,
 * 1-hour interval. ~5ms cost per invocation when nothing to do.
 */
public class HealthConnectSyncWorker extends Worker {
    private static final String TAG = "HCSyncWorker";
    private static final String PREFS = "nutritrace_hc";
    private static final String KEY_NEEDS_SYNC = "needsSync";
    private static final String KEY_LAST_SYNC = "lastSyncMs";

    public HealthConnectSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_NEEDS_SYNC, true)
                .putLong(KEY_LAST_SYNC, System.currentTimeMillis())
                .apply();
            Log.d(TAG, "marked HC needs-sync flag");
            return Result.success();
        } catch (Exception e) {
            Log.w(TAG, "worker failed: " + e.getMessage());
            return Result.success();
        }
    }
}
