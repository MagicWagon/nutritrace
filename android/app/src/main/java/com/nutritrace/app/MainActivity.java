package com.nutritrace.app;

import android.os.Bundle;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.BridgeActivity;

import java.util.concurrent.TimeUnit;

public class MainActivity extends BridgeActivity {
    private static final String WORK_NAME = "nutritrace_reminders";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        scheduleReminderWorker();
    }

    /**
     * Enqueues a battery-friendly periodic worker that runs every 15 minutes
     * (Android's hard floor) to check meal/water/weigh-in reminders against
     * the local SQLite DB. KEEP policy ensures we don't reschedule on every
     * launch — the existing worker keeps running across app restarts.
     */
    private void scheduleReminderWorker() {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
            .setRequiresBatteryNotLow(true)
            .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                ReminderWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build();

        WorkManager.getInstance(getApplicationContext())
            .enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request);
    }
}
