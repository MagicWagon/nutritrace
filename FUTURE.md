# NutriTrace — Future Implementations

Ideas and planned enhancements. Grouped by area. No commitment to order or timeline.
Items marked ~~strikethrough~~ have been implemented.

---

## Wellness — Reporting & Insights

### ~~Phase 1 — Trends tab~~ *(done — sparklines on each metric card)*

### ~~Phase 2 — Derived insights~~ *(done)*
- ~~Sleep debt — rolling 7/14/30-day deficit~~
- ~~Chronotype — early bird / night owl from average sleep midpoint~~
- ~~Daily Readiness score — HRV + RHR + sleep + activity penalty~~
- ~~Stress Management score — smoothed HRV + RHR + sleep~~
- ~~Sleep start/end stored as `sleep_start_min` / `sleep_end_min`~~

### Phase 3 — Dashboard / cross-domain correlation
A dedicated **Dashboard** page that correlates data across all domains (nutrition + activity + sleep + body stats).

- Widget grid — user-configurable
- Example widgets:
  - Sleep duration vs weight trend overlay
  - Steps vs net calories (burned – eaten)
  - "Best week" pattern summary
  - Today at a glance (streak tracker)

---

## Wellness — Additional Integrations

### ~~Garmin Connect~~ *(done — experimental, OAuth 1.0a)*
### ~~Withings~~ *(done — body comp, ECG, vascular age, metabolic age, EDA, segmental)*

### ~~Fitbit GPS / Activity Routes~~ *(done — TCX parsed via location OAuth scope, route map on workout detail)*

### Google Health Connect (Android)
- Android Health Connect API (REST or local SDK bridge via PWA)
- Steps, sleep, HR from any Android wearable

### Apple Health (iOS)
- Requires a native iOS wrapper (WebKit `WKWebView` + Swift bridge)
- Or: export-based import (Apple Health XML export → parse + ingest)

---

## Android App (Capacitor)

### ~~Phase 1 — Native shell + offline mode~~ *(done)*
- ~~Capacitor 8 wrapping Svelte PWA~~
- ~~Local SQLite via @capacitor-community/sqlite~~
- ~~NativeSetup wizard (Use Locally / Connect to Server)~~
- ~~Native barcode scanner (@capacitor-mlkit/barcode-scanning)~~
- ~~Native camera for food/meal/avatar photos~~
- ~~CapacitorHttp for OFF/USDA search (CORS bypass)~~
- ~~Platform detection (isNative, apiUrl, getServerUrl, getNativeMode)~~
- ~~Server connection with merge dialog~~
- ~~Service worker disabled in Capacitor~~
- ~~App icon at all mipmap densities~~

### Phase 2 — Sync & platform integrations
- ~~**Differential sync** — only push/pull changed records since last sync (timestamp-based), instead of full merge on every connect~~
- ~~**Offline cache in server mode** — mirror server data in local SQLite so the app works when server is down; sync diff when back online~~
- ~~**Health Connect integration**~~ *(done — shipped in v0.35; in production)*
- **Background sync** — periodic background task (via @capacitor/background-runner or WorkManager bridge) to sync diary/foods/wellness with server when connected
- ~~**Local full backup (ZIP)** — create full backup on device (JSZip) including images, for phone-to-phone transfer without a server~~ *(done — v0.35.2-beta)*
- **iOS app** — Capacitor already supports iOS; need HealthKit integration + App Store setup

---

## ~~Shared Food Database~~ *(done — Food Sharing, experimental)*
- ~~Visibility: private / group / specific users~~
- ~~Copy-on-use model for shared items~~
- ~~Bulk share from Settings~~
- ~~"From Others" source filter in Foods~~

---

## Diary Enhancements

### ~~Calorie budget bar in diary header~~ *(done — bottom bar with progress strip)*

### ~~Meal-level macro summary~~ *(done — per-meal P/C/F bar + text)*

### ~~Quick-log (voice / text)~~ *(done — Smart Log v3, hold FitBot button; water logging added v0.38.2-beta)*

### ~~Dynamic Calorie Goal~~ *(done — v0.38.3-beta, Experimental)*
- ~~Fixed (current, default) vs Dynamic (device calories_out × factor)~~
- ~~Gate behind connected Fitbit/Garmin/Health Connect — hidden if no device~~
- ~~Factor: 0.80 (lose) / 1.00 (maintain) / 1.20 (gain)~~
- ~~Uses yesterday's final burn, falls back to fixed goal if no data~~
- ~~Touchpoints: diary bar (dynamic pill), goals page (badge + annotation)~~
- Statistics goal line integration (uses fixed goal for now — future enhancement)

### Adaptive TDEE
- Learn actual TDEE by correlating weight trends with calorie intake over 35+ days
- Requires significant history to be accurate
- v1.0+ feature

---

## Foods / Nutrition

### Fuzzy food search
- Current search requires exact substring match; typos and partial words miss results
- Replace with fuzzy matching (e.g. Fuse.js or server-side trigram search) so "chiken" finds "Chicken Breast"
- Apply across local foods, meals, and recipes; no toggle needed — degrades silently to current behavior

### Nutrient calculator overlay
- Select two foods → side-by-side comparison panel

### Recipe scaling from servings count
- Input "I want 6 servings" → auto-scale all ingredient quantities

---

## Goals

### Rolling weekly / monthly goals
- Option to track goals over a week or month period, not just daily
- Useful for intermittent fasting or flexible dieting approaches

### ~~AI-suggested goal adjustment~~ *(done — v0.38.4-beta, Goal Insights toggle in Settings → AI Assistant)*

---

## Statistics

### Body composition chart
- Weight / body fat % / muscle mass plotted together (Withings data available)

### ~~Weekly summary email~~ *(done — v0.38.5-beta, configurable day/time, push + email)*

---

## AI Assistant (FitBot)

### Food photo logging via FitBot chat
- User attaches a photo of a meal in the FitBot chat; Claude/GPT-4o vision identifies foods and estimates portions
- Gap: AI currently responds in plain text — intercept a vision response that looks like a food list, pipe it into the Smart Log matcher, and open the Smart Log review modal for confirmation before adding to diary
- Reuses existing Smart Log infra; no new UI needed beyond what FitBot chat already supports

---

## UI / UX Polish

### Empty-state polish
- Diary, Foods, Statistics, and Wellness pages show a generic empty list when there's no data
- Add contextual empty states with a short message and a relevant action (e.g. "No foods yet — tap + to add your first" on Foods; "No data for this date" on Diary)
- No toggle needed — better UX unconditionally when empty

### Error visibility / sync status
- Sync errors (failed server push, offline, conflict) are silent — no user-visible feedback
- Add a subtle status indicator (pill or icon near the top) that shows last sync time and surfaces errors with a tap-to-retry action
- Especially useful on Android where background sync can fail quietly

### Accessibility
- ActionSheet: add `role="dialog"` and focus trap
- Form inputs: explicit `<label>` associations throughout
- MealEditor name field: `<div>` → `<label>` element

### Diary loading indicator
- Subtle spinner or opacity change on date navigation when network is slow

### ~~Water log editing~~ *(done — v0.38.1-beta)*

---

## Code / Performance

### Settings.svelte split
- Settings.svelte is ~3,000 lines; split remaining sections into sub-components (pattern already established with SettingsWellness.svelte)
- Pure maintenance — no UX change, just makes the file faster to work in

### Statistics dynamic goal line
- Statistics charts show a fixed calorie goal line even when Dynamic Calorie Goal is enabled
- Fix: pull the per-day dynamic value when drawing the goal overlay so the line reflects actual adaptive targets

### Bundle code splitting
- Main JS bundle is large; initial load on slow connections is noticeable
- Dynamic imports for heavy rarely-used sections (Statistics charts, full Settings) would cut initial parse time

---

## Infrastructure

### Multi-instance sync (optional cloud relay)
- For users running NutriTrace on multiple devices without a central server
- Lightweight CouchDB-style sync (or manual export/import trigger)

### API key scoping
- Per-integration API key management (read-only, write, admin)
- Useful for third-party dashboards or Home Assistant integrations

### Metrics / observability
- Optional Prometheus endpoint (`/api/metrics`): request count, DB query times, sync success/fail
- Admin-only; opt-in via env var

### ~~Security hardening~~ *(done)*
- ~~Rate limiting on auth endpoints (10/15min)~~
- ~~CORS middleware with allowed origins + Authorization header~~
- ~~Password complexity (8+ chars, uppercase/lowercase/number/special)~~
- ~~JWT_SECRET startup warning~~
- ~~CSRF protection — synchronizer token in JWT; enforced on cookie-based sessions; Bearer token requests exempt~~

---

## Pre-1.0 Public Release — TODO

Items to land before flipping `traceapps/nutritrace` public and submitting to Play Store:

- **Android network security lockdown** — `android/app/src/main/res/xml/network_security_config.xml` currently allows cleartext + user-installed CAs in production. Restructure to `<base-config cleartextTrafficPermitted="false">` (locked down for Play Store release builds) + `<debug-overrides>` keeping cleartext + user CAs (for sideloaded debug APKs). Document the HTTPS expectation for Play Store users in 3 places: README Android section, DEPLOY.md "Connecting from Android" subsection, and in-app error message when Play Store build hits an HTTP server.
- **Local-only encryption upgrade UI** — when a local-only install starts after the encryption update (v0.39.20+), `db-native.js` defers the migration and sets `nt:db_encryption_pending=1` in localStorage. Need a banner in Settings → Backup that surfaces this state and provides an "Upgrade Now" button gated on a fresh Local Full Backup export. Wires up to the already-exported `runLocalEncryptionUpgrade()` and `isEncryptionPending()` helpers in `db-native.js`.
- **Sync to public repo** — run `nutritrace-dev-sync.sh` to land latest beta in `traceapps/nutritrace`.
- **Pre-flight scrub** — re-check for personal URLs, secrets, `.env` artifacts, personal references in comments before flipping public.

---

## Repo Split — Public Server / Private Android

Current structure:
- `traceapps/nutritrace-dev` (private) — full monorepo with `android/`, used for development.
- `traceapps/nutritrace` (private, will go public at v1.0) — synced from `nutritrace-dev` minus `android/` via `nutritrace-dev-sync.sh`.
- `traceapps/nutritrace-android` (private) — standalone mirror of the Android shell.

Pre-flight before flipping `traceapps/nutritrace` public:
- Scrub for personal URLs, secrets, `.env` artifacts
- Scrub for personal references in comments
- Confirm AGPL-3.0 license file is present
- Run `nutritrace-dev-sync.sh` once more to land latest beta in the public repo

Sync model going forward: develop in `nutritrace-dev` as today, then ship release snapshots to `traceapps/nutritrace`. Each public release is a clean snapshot, not a daily commit log — CHANGELOG carries the version history.

---

*Last updated: 2026-04-19 (added: FitBot food photo logging, fuzzy search, empty-state polish, sync error visibility, Settings split, Statistics dynamic goal line, bundle splitting)*
