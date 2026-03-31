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
