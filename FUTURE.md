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

### ~~Google Health Connect (Android)~~ *(done — v0.35, see Phase 2 entry below)*

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

### ~~Quick-log (voice / text)~~ *(done — Smart Log v3, hold Trace button; water logging added v0.38.2-beta)*

### ~~Dynamic Calorie Goal~~ *(done — v0.38.3-beta, Experimental)*
- ~~Fixed (current, default) vs Dynamic (device calories_out × factor)~~
- ~~Gate behind connected Fitbit/Garmin/Health Connect — hidden if no device~~
- ~~Factor: 0.80 (lose) / 1.00 (maintain) / 1.20 (gain)~~
- ~~Uses yesterday's final burn, falls back to fixed goal if no data~~
- ~~Touchpoints: diary bar (dynamic pill), goals page (badge + annotation)~~
- ~~Statistics goal line integration~~ *(done — v0.39.11, labeled "Base Goal" when dynamic mode is on)*

### Adaptive TDEE
- Learn actual TDEE by correlating weight trends with calorie intake over 35+ days
- Requires significant history to be accurate
- v1.0+ feature

---

## Foods / Nutrition

### ~~Fuzzy food search~~ *(done — v0.39.11, `_fuzzyMatch` + `_editDist` in Foods.svelte: exact substring → word-by-word → edit-distance ≤1 for words ≥4 chars; covers local foods, meals, recipes)*

### Nutrient calculator overlay
- Select two foods → side-by-side comparison panel

### Recipe scaling from servings count
- Input "I want 6 servings" → auto-scale all ingredient quantities

### Nutrition CSV importer (v1 SHIPPED 2026-04-30, dev)
- v1 supports MyFitnessPal, LoseIt, Cronometer, and a generic
  spreadsheet shape. Adapters in `server/lib/nutrition-import/`,
  route at `/api/nutrition-import/{preview,commit}`, UI is
  `SettingsNutritionImport.svelte` mounted under Settings → Backup
  with an EXPERIMENTAL badge. Skip / Merge / Replace per-date
  semantics. Auto-detects locale (US M/D vs EU D/M), CSV
  delimiter (comma vs semicolon), and meal-name aliases; falls
  back to the user's last meal slot for unmatched labels.
- v2 candidates: **MacroFactor** (no published schema — needs real
  user export samples to pin against; ship as "experimental — bring
  your own export" once we have 2-3 samples), **FatSecret** (no
  user-facing CSV; would need OAuth API connector, separate
  feature), **YAZIO** (unverified schema — defer until a user
  sends a sample). Waistline import was deprioritized at user
  request (not a migration audience NT shares).
- Driving issue: community thread 2026-04-29.

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

## AI Assistant (Trace)

### Food photo logging via Trace chat — auto-pipe to Smart Log
- *Image attachments to Trace chat already shipped* — users can attach a meal photo and Claude/GPT-4o vision identifies foods + estimates portions in plain text reply.
- **Still pending:** intercept a vision response that looks like a food list, pipe it into the Smart Log matcher, and open the Smart Log review modal for confirmation before adding to diary. Reuses existing Smart Log infra; no new UI needed beyond what Trace chat already supports.

### Local / self-hosted LLM support (post-1.0, high priority)
Add a generic **OpenAI-compatible** provider option in `src/lib/aiChat.js` that accepts a custom base URL + model name (no API key required). Covers Ollama, LocalAI, LM Studio, vLLM, llama.cpp's server, and anything else exposing the OpenAI `/v1/chat/completions` schema in one shot — don't hardcode "Ollama" specifically.

Why it matters: closes the privacy story. PRIVACY.md currently has to say "your conversation goes to Claude/OpenAI/Gemini." With a local LLM enabled, *nothing leaves the user's network*. The self-hosted-nutrition-tracker audience overlaps heavily with the homelab/self-hosted-LLM crowd, so this reads as a feature, not a hassle.

Implementation notes / caveats to document:
- **Tool-use reliability varies by model.** The existing AI Assistant uses tool calls heavily (`get_diary`, `get_wellness_data`, etc.). Llama 3.1+ and Mistral handle them reasonably; smaller / older models silently break tool calls.
- Either gate Goal Insights + Smart Log behind a "model supports tools?" capability detection that falls back to text-only, OR document which local models we've verified and warn in Settings.
- Vision (food-photo logging) requires a multimodal local model — even more model-dependent. Keep image attachments hidden for local provider unless model is known multimodal.
- Set expectations honestly in the Settings UI: "Local models trade convenience for privacy — quality and tool reliability vary by model."

When this ships, update PRIVACY.md "Third-Party Services" entry for AI Providers to note the local-LLM option ("if configured, your conversation never leaves your network").

---

## UI / UX Polish

### ~~Empty-state polish~~ *(done — contextual empty states across Diary, Foods, Goals, Wellness, MealEditor, Settings; Foods + Statistics empty-state messages added v0.39.11)*

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

## Internationalization (i18n)

Currently English-only. UI strings are hardcoded throughout the Svelte components, so translation contributions are not yet possible. Asked about by Lemmy users early in the launch window, so worth landing reasonably soon.

Implementation sketch:
- Add `svelte-i18n` (de-facto choice for Svelte 4) and a `src/i18n/` directory with one JSON file per locale (`en.json`, `fr.json`, etc.).
- Extract all hardcoded strings to keys. Largest surface areas: `Diary.svelte`, `Foods.svelte`, `Wellness.svelte`, `Settings.svelte` (+ split sub-components), `MealEditor.svelte`, `FoodEditor.svelte`, ActionSheets, error toasts.
- Locale picker in Settings → Appearance, persisted via `createSettingStore` like theme. Default to browser locale on first load with English fallback.
- Date / number formatting via `Intl.DateTimeFormat` and `Intl.NumberFormat` (already platform-native, no extra deps). Audit existing date strings for hardcoded `en-US` style.
- Pluralization via svelte-i18n message format (ICU-style).
- Server-side strings (email subjects, push notification bodies, AI system prompts) stay English for now, or take a separate pass once the client side is stable.

Translation contribution path:
- Self-host **Weblate** alongside the demo instance, or use the free tier on `hosted.weblate.org` for libre projects. Weblate is the standard in the self-hosted scene (Mealie, Immich, Paperless-ngx all use it) and lowers the bar for non-developer translators.
- PR-based fallback: contributors copy `en.json` to `<lang>.json` and submit a PR. Document the workflow in `CONTRIBUTING.md`.
- Seed initial languages from community requests on Lemmy / GitHub issues. Don't pre-translate machine-only — wait for actual native speakers per language to avoid uncanny-valley UX.

Scope explicitly out:
- User-entered data (food names, notes, meal names) stays as-is. NutriTrace doesn't translate user content.
- OFF/USDA food names come from those upstreams in their own languages already.

Likely v1.1 or v1.2 feature. Doing this *before* v1.0 risks delaying launch and locking the string set before the surface settles.

---

## Code / Performance

### ~~Settings.svelte split~~ *(done — v0.39.11, 5 sub-components: SettingsWellness, SettingsTrace, SettingsNotifications, SettingsUserManagement, SettingsBackup. Settings.svelte dropped to ~1700 lines as a thin orchestrator)*

### ~~Statistics dynamic goal line~~ *(done — v0.39.11, see Diary Enhancements → Dynamic Calorie Goal entry above)*

### ~~Bundle code splitting~~ *(done — v0.39.11, `manualChunks` in vite.config.js splits chart.js, jszip, emoji-picker-element into separate async chunks loaded on demand)*

---

## Infrastructure

### ~~Reverse proxy / subpath support~~ *(done — `BASE_URL` env var, see DEPLOY.md → Reverse Proxy with Subpath)*
- Native subpath support via `BASE_URL=/your-prefix`. Server mounts everything under the prefix, client reads it from `__NT_CONFIG__` injected at HTML serve time, all asset/API URLs prefix at runtime.
- Requested in #3 (tellis82). Verified locally end-to-end in both root and subpath modes (image upload, settings persistence, OAuth flow ready, service worker scope, PWA install).
- Default `BASE_URL=''` keeps existing root-mounted deployments unchanged — no migration for current users.
- Caveat: changing `BASE_URL` after data exists leaves stale image URLs in old diary item snapshots (the snapshotted `imgUrl` carries the prefix from when it was logged). Documentation in DEPLOY.md notes this as "pick at install time and don't change."

### Multi-instance sync (optional cloud relay)
- For users running NutriTrace on multiple devices without a central server
- Lightweight CouchDB-style sync (or manual export/import trigger)

### API key scoping
- Per-integration API key management (read-only, write, admin)
- Useful for third-party dashboards or Home Assistant integrations

### Metrics / observability
- Optional Prometheus endpoint (`/api/metrics`): request count, DB query times, sync success/fail
- Admin-only; opt-in via env var

### ~~OIDC / SSO support (Authentik, Keycloak, Authelia, etc.)~~ *(SHIPPED in v1.0.0-rc.9)*
Settings → User Management → OIDC providers. Multi-provider, admin-managed (not env-only), client secrets encrypted at rest, auto-link verified-email + auto-register-new-users split toggles, admin role mapping via group claims, runtime password-login disable for OIDC-only instances. Provider preset picker covers Authentik / Keycloak / Pocket ID / Authelia / Auth0 / Google / Custom. Profile → Linked accounts to attach SSO to an existing password account.

### ~~Security hardening~~ *(done)*
- ~~Rate limiting on auth endpoints (10/15min)~~
- ~~CORS middleware with allowed origins + Authorization header~~
- ~~Password complexity (8+ chars, uppercase/lowercase/number/special)~~
- ~~JWT_SECRET startup warning~~
- ~~CSRF protection — synchronizer token in JWT; enforced on cookie-based sessions; Bearer token requests exempt~~

---

## Authentication — Biometric re-auth

Add biometric (fingerprint / face) unlock for re-authentication flows
in server mode. Pure UX improvement: the user logs in once with
username + password, and on subsequent JWT expiries (or app reopens
after a session timeout) the app prompts a biometric instead of
making them retype the password.

Implementation sketch:
- **Android**: AndroidX Biometric library (`androidx.biometric:biometric`)
  + Android Keystore. On successful password login, save the JWT (or
  a refresh token) encrypted with a Keystore key whose access requires
  biometric authentication. On re-auth, `BiometricPrompt.authenticate()`
  → `Cipher` → decrypt the saved token → silent re-auth against server.
  Wrap in a Capacitor plugin or use `@capacitor-community/biometric-auth`.
- **PWA**: WebAuthn / Passkeys via the Credential Management API. More
  involved — requires server-side passkey registration / authentication
  endpoints (RP ID, challenge, attestation verification). Higher value
  long-term since it's phishing-resistant and survives password
  rotation, but more work than the Android-side plugin path.

Scope:
- Server mode only. Local-only mode has no auth flow to gate.
- Opt-in via Settings → Account → "Use biometric for sign-in".
- Fallback to password always available — biometric never replaces the
  password, only saves the user from typing it on re-auth.

Threat model: this is a UX / convenience layer, not an added security
boundary. The server still authenticates by password / JWT; biometric
just unlocks the locally-saved credential. Doesn't change anything
about Android FBE protecting data at rest.

Likely v1.1 — Android-side first (smaller surface, immediate UX win),
PWA WebAuthn as a follow-up once we want to invest in passkey infra
on the server side.

---

## Engagement / Achievements (maybe-never)

A small, restrained set of cross-domain badges (Diary + Wellness) that
reinforce real behavior milestones, not trivia. Idea-stage only — may
not ever ship if it ends up feeling gamified or out of character for
the self-hosted/serious audience.

If we did ship it:
- 8–12 badges total, not 50. Resist the urge to add "logged your first
  food!" trivial ones.
- Opt-in via Settings toggle (likely default off). The app should feel
  adult/clean for users who don't want gamification.
- Surface in Profile as a "Trophies" panel — slow-burn record, not
  another in-the-moment popup. Goal Celebrations already cover the
  dopamine-hit moment; achievements would be the cumulative log.
- Candidate milestones (cross-domain, real-behavior):
  - Diary: 7/30/90/365-day logging streak, first 1000 unique foods
    logged, 30 days hitting protein goal, 30 days under TDEE
  - Wellness: 7 consecutive nights ≥80 sleep score, 30 days with HRV
    data, 7-day readiness ≥80 streak, first month with body stats
- Data model: single `achievements_unlocked` table with
  `(user_id, badge_id, unlocked_at)`. Server computes on goal-tick or
  daily wellness sync; cheap to evaluate and persist.

Tradeoff: gamification creep is the real risk. Too many badges or
too-easy unlocks turn the app into a kids' game. Self-hosted nutrition
trackers tend toward austere — most users would rather see a sparkline
than a trophy. Defer until after the v1.0 surface settles and we have
real user feedback on what (if anything) they ask for here.

---

## Post-1.0 follow-ups

- **Nutrition card filter behavior** — the per-meal totals popup and the day Nutrition Summary both respect the `diaryShowAllNutrients` toggle (default 9 nutrients vs all). Decide: should the per-meal popup ALWAYS show all available nutrients (since user opted in by tapping the macro bar) regardless of the toggle, or stay consistent with the day summary? Three options: (a) leave as-is, (b) always show all in the popup, (c) add an in-popup expand toggle. Defer the call until we have user feedback on what they reach for.

---

## Pre-1.0 Public Release — TODO

Items to land before flipping `traceapps/nutritrace` public and submitting to Play Store:

- ~~**Android network security lockdown**~~ *(done 2026-05-02)* — `android/app/src/main/res/xml/network_security_config.xml` is now strict (`cleartextTrafficPermitted="false"` + system + user CA trust). Debug-signed APKs get a permissive resource overlay at `android/app/src/debug/res/xml/` that re-enables cleartext for `http://192.168.x.x` LAN dev. `explainConnectError()` in `src/lib/platform.js` translates the cleartext-blocked failure into a friendly "this build only allows HTTPS" message pointing at DEPLOY.md. Documented in three places: README "Coming soon" Android line, new DEPLOY.md "Connecting from Android" section (covers Let's Encrypt, Cloudflare/Tailscale tunnels, self-signed CA install on device, and the build-it-yourself escape hatch), and the in-app error toast.
- ~~**Native SQLite encryption (revisit)**~~ *(decided 2026-05-02 — won't ship, position is "rely on Android FBE")* — SQLCipher integration via `@capacitor-community/sqlite` v8 was rolled back in v0.39.23 due to flaky `setEncryptionSecret` secure-store semantics that locked users out of their own data. After surveying comparable apps (Immich, Joplin, Obsidian, AnkiDroid, Mealie, Tandoor, Wger — none encrypt their local SQLite either), decided NutriTrace's threat model doesn't justify the operational risk. Android's file-based encryption (default since Android 7) already encrypts the app data directory using a key tied to the device PIN/biometric — a locked phone is encrypted at rest. PRIVACY.md "Local data at rest" section documents the position explicitly and corrects the previous misleading "encrypted SQLite database" claim.
- **Public demo instance** — host `demo.nutritrace.app` on the existing Oracle Cloud Always Free machine. Pattern (standard for self-hosted demos — Mealie, Penpot, Vikunja all do this): single shared instance, signup disabled, pre-seeded with a realistic sample week of foods/meals/diary/wellness, cron resets the DB every 6–24h. Implementation: `DEMO_MODE=1` env flag that (a) blocks signup, (b) auto-signs in as the demo user, (c) returns 503 from AI/SMTP/upload routes (don't burn API keys, don't email random addresses), (d) renders a sticky banner "DEMO — data resets daily, don't enter real info". Add `server/scripts/seed-demo.js` to wipe + reseed; cron via systemd timer on the Oracle box. Demo URL is the single biggest conversion lever for awesome-selfhosted submission and r/selfhosted launch posts — defer to just before launch so the demo shows the v1.0 surface, not a beta.
- **Sync to public repo** — run `nutritrace-dev-sync.sh` to land latest beta in `traceapps/nutritrace`.
- ~~**Pre-flight scrub**~~ *(done 2026-04-26 — full audit ran in v0.39.35-beta cycle: zero personal email/name leaks, `.env` properly gitignored, no hardcoded URLs/IPs in shipping files, all OAuth credentials user-configurable, sync script handles `thebigjoe1` → `traceapps` rewrites, Ko-fi handle migrated to `traceapps`)*
- **Discovery push** (post-flip) — submit to awesome-selfhosted, post to r/selfhosted with screenshots/demo link, submit to selfh.st newsletter, then Show HN a few weeks later once Reddit traffic stabilizes. AlternativeTo + Umbrel/CasaOS app store listings as secondary follow-ups. Prerequisites: demo instance live, 4–5 screenshots in README, v1.0.0 tag (curated lists shy away from beta).

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

*Last updated: 2026-04-28 (added: Internationalization section — svelte-i18n + Weblate path, prompted by Lemmy translation request; marked done: Reverse proxy / subpath support via BASE_URL env var, prompted by tellis82 issue #3 and verified locally end-to-end)*
