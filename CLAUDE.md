# NutriTrace — Project Reference

**App name**: NutriTrace
**Version**: See `src/lib/version.js` (centralized)
**Location**: `/home/papa/Documents/claude_code/nutritrace/`
**GitHub**: `git@github.com:thebigjoe1/nutritrace.git`
**Stack**: Svelte 4, svelte-spa-router v4 (hash routing), Vite, SQLite (server), PWA
**Docker**: `docker compose up -d` → serves on port 3000

## Architecture

- **`src/main.js`** — Entry point. Calls `DB.init()` BEFORE mounting App.
- **`src/App.svelte`** — Root. `{#key $location}` destroys/recreates routes on nav. Checks `setupComplete` → wizard redirect.
- **`src/routes/Diary.svelte`** — Main diary. onMount calls `loadEntry(today)`.
- **`src/routes/Foods.svelte`** — Food picker with source filters (Local/OFF/USDA/Mealie/From Others).
- **`src/routes/Statistics.svelte`** — Charts page. `_loadVer` guard prevents stale loads.
- **`src/routes/Wellness.svelte`** — All wellness UI: metrics, sparklines, insights (readiness, stress, sleep debt, chronotype).
- **`src/routes/Settings.svelte`** (~3000 lines) — All settings. Wellness section extracted to sub-component.
- **`src/components/settings/SettingsWellness.svelte`** — Fitbit/Withings/Garmin config, metric visibility.
- **`src/stores/diary.js`** — `currentDate`, `currentEntry`, `diaryTotals`. `loadEntry`, `addDiaryItem`, etc.
- **`src/stores/settings.js`** — All settings as `createSettingStore` instances backed by localStorage + server sync.
- **`src/lib/db.js`** — IndexedDB abstraction.
- **`src/lib/version.js`** — Centralized `APP_VERSION` constant.
- **`server/lib/sharing.js`** — Shared `sharingEnabled()` and `canRead()` for foods/meals.

## Key Design Decisions

- **`{#key $location}`** in App.svelte: destroys/recreates route on every nav. `onMount` fires fresh.
- **`addDiaryItem` reads from DB**: never relies on `currentEntry` being current.
- **Settings auto-save**: most save reactively via `$: set(key, value)`. Meal names save on blur.
- **Wellness scores**: sleep score estimated server-side (Fitbit API doesn't expose it). Readiness and stress calculated client-side from 30-day HRV/RHR baselines.

## Svelte Reactivity Rules

- **Functions in templates**: Svelte only tracks dependencies that appear DIRECTLY in template expressions. Pass reactive values as explicit function parameters — don't close over them.
- **`$:` reactive statements**: fire on mount AND on change. Don't add redundant `onMount` calls.
- **Async race guards**: capture the key before await, check it still matches after.

## Environment Variables

See `.env.example` for full list. Key ones:
- `JWT_SECRET` — required for production (warns at startup if not set)
- `RECOVERY_TOKEN` — required for lockout recovery
- `LOG_LEVEL` — error | warn | info (default) | debug
- `SMTP_*` — optional, locks Settings UI fields when set
- `AI_*` — optional, locks FitBot settings when set

## Password Requirements

8+ characters with uppercase, lowercase, number, and special character. Validated server-side in `server/routes/auth.js` and client-side in Wizard + Profile.

## Android App (Capacitor 8)

### Architecture
The Android app is a Capacitor 8 shell wrapping the same Svelte PWA. It runs offline-first with a local SQLite database, and can optionally connect to a NutriTrace server for sync.

- **Platform layer** (`src/lib/platform.js`): `isNative` detects Capacitor environment; `apiUrl()` returns empty string (local mode) or server URL (connected mode); `getServerUrl()` and `getNativeMode()` read from Capacitor Preferences.
- **Native API** (`src/lib/api-native.js`): `NtApiNative` class provides the same CRUD interface as the server API but backed by local SQLite. Used when `isNative && mode === 'local'`.
- **Native DB** (`src/lib/db-native.js`): SQLite schema and queries via `@capacitor-community/sqlite`. Mirrors server tables (foods, meals, diary, user_settings).
- **NativeSetup wizard**: shown on first launch. Offers "Use Locally" (pure offline) or "Connect to Server" (enter URL, authenticate, merge dialog for existing local data).
- **Merge on connect**: when connecting to a server with existing local data, a dialog lets the user push local foods/meals/diary to the server and choose which settings win (local or server).
- **Barcode scanning**: `@capacitor-mlkit/barcode-scanning` with Google Code Scanner fallback. Replaces the web QuaggaJS scanner on native.
- **Camera**: `@capacitor/camera` for food photos, meal photos, and avatar. Falls back to file input on web.
- **HTTP**: `CapacitorHttp.get()` for OFF/USDA API calls — bypasses CORS restrictions that block `fetch()` inside the WebView.
- **API routing**: every `fetch('/api/...')` call in the codebase uses `apiUrl()` to prefix the server URL when in connected mode. In local mode, these calls go to `NtApiNative` instead.
- **Service worker**: disabled when running inside Capacitor (`src/registerSW.js` checks `isNative`) to prevent the offline.html redirect from intercepting WebView navigation.
- **Hidden settings**: features that require a server (User Management, Email/SMTP, Food Sharing, persistent sidebar, flashlight toggle, Full Backup) are hidden when running in native local mode.

### Build & Run
```bash
# Prerequisites (env vars in ~/.bashrc):
#   JAVA_HOME, ANDROID_HOME, CAPACITOR_ANDROID_STUDIO_PATH

# Build the Svelte app for production
npm run android          # or: npm run build

# Sync web assets + plugins to the Android project
npx cap sync android

# Run on a connected device or emulator
npx cap run android --target <device-id>

# Open in Android Studio (for signing, debugging, etc.)
npx cap open android
```
