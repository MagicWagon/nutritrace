# Changelog

All notable changes to NutriTrace are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.22.0-beta] — 2026-03-29

### Added
- **Sleep Debt card** — Sleep tab now shows cumulative sleep debt over last 7 or 14 nights (configurable with range chips); calculated as sum of `max(0, goal − actual)` per night
- **Chronotype card** — classifies sleep type (Early Bird / Morning Type / Intermediate / Evening Type / Night Owl) from average sleep midpoint across the selected range; requires ≥5 nights of timing data; shows "Building profile…" with count when insufficient data; includes emoji + plain-language description matching Fitbit's style
- **Sleep start/end extraction (Fitbit)** — `sleep_start_min` and `sleep_end_min` now parsed from Fitbit `startTime`/`endTime` fields and stored in wellness_data (minutes past midnight)
- **Sleep start/end extraction (Garmin)** — `sleep_start_min` and `sleep_end_min` derived from `startTimeInSeconds + startTimeOffsetInSeconds` (local epoch → UTC hours/minutes); `sleep_end_min` computed from start + `durationInSeconds`
- **7-day sparklines on metric cards** — each Movement / Sleep / Heart metric card now displays a small inline SVG sparkline showing the last 7 days of that metric; loaded in background, does not block current-day display
- **Statistics — wellness metrics** — Statistics page now includes a Wellness section (when Fitbit/Garmin/Withings are enabled) with Steps, Active Minutes, Sleep, Resting HR, HRV, SpO2, and Muscle Mass; supports all date ranges including a 365-day window for the 'all' range
- **Statistics — device-first body composition** — when Withings is connected, weight and body fat pull from Withings device data first and fall back to diary manual entries; no source toggle needed; applied automatically
- **Hover tooltips on wellness metric cards** — each metric card has a `title` attribute with a plain-language explanation of what the metric measures and why it matters

### Changed
- **Trends tab removed** — the Wellness Trends tab has been replaced by inline sparklines on each metric card; reduces duplication with Statistics and keeps the view focused
- **Sleep stage legend redesigned** — proportional flex row below the bar; each segment's label and value are centered under its corresponding bar segment; segments narrower than 3% are hidden to avoid overflow
- **Wellness goals — today's progress** — Wellness goals now show the actual today total and a progress bar (same as nutrient/body stat goals); fetches today's Fitbit + Garmin data on Goals load
- **Statistics body composition** — device-first merge replaces the manual Diary/Device source toggle; cleaner UX, no extra UI state

### Fixed
- **Reactive double-load for sleep insights** — split the reactive block into two: one marks `_insightsLoaded = false` when deps change, the other calls `loadSleepInsights()` only when stale; eliminates the race condition that caused duplicate fetches

---

## [0.21.0-beta] — 2026-03-29

### Added
- **Withings segmental lean + muscle mass** — correct positional type mapping for types 173 (lean mass) and 175 (muscle mass); five readings per measurement group are assigned to torso, left leg, left arm, right leg, right arm in order; removed incorrect prior type mappings
- **Withings additional body metrics** — extracellular water (type 168), intracellular water (type 169), visceral fat index (type 170), metabolic age (type 227); displayed on Body tab and togglable in Settings
- **Fitbit Cardio Fitness (VO2 Max)** — fixed endpoint (removed erroneous `/1d` suffix); range response (e.g. "39-43") stored as midpoint; label renamed to "Cardio Fitness" throughout to match Fitbit's own terminology
- **Fitbit skin temperature variation** — synced from `/temp/skin` endpoint (Pixel Watch 4 and compatible devices); shown on Sleep tab
- **Garmin max heart rate** — extracted from dailies `maxHeartRate` field; shown on Heart tab
- **Sleep score estimation (Fitbit)** — sleep score endpoint not available in public API; estimated from duration, deep+REM%, SpO2, and HRV; calibrated to within ±1 pt on 3 actual days; Garmin device score takes priority when both sources are present
- **Settings toggles** — added for all new metrics: skin temp variation (Fitbit), max HR (Garmin), extracellular water, intracellular water, visceral fat index, metabolic age (Withings)

### Changed
- **Segmental Analysis** — removed the % toggle (values were misleading); replaced with an explanatory note; "Fat" column renamed to "Lean" to correctly reflect what the data represents (lean mass, not fat mass)
- **Sleep stage legend** — values now display in h/m format (e.g. "1h 13m") instead of raw minutes; applied to both the legend and bar tooltips
- **displayData merge** — Garmin sleep score takes priority over Fitbit estimated score; all other metrics still prefer Fitbit when both are present

### Fixed
- **Withings OAuth scope** — removed `user.cardiovascular` from default scope (caused re-auth failures); ECG requires re-auth only when explicitly needed
- **Wellness Trends unit conversion** — muscle mass and weight charts now correctly convert to lbs on the y-axis and in tooltips when the app unit is set to lb

---

## [0.20.0-beta] — 2026-03-29

### Added
- **Metric visibility toggles** — Settings → Wellness now includes a "Visible Metrics" card with chip toggles for every wellness metric, grouped by section (Movement, Sleep, Heart, Garmin, Body, Body Scan, Segmental); hidden metrics are excluded from Wellness display and future reports; data is always synced regardless of visibility; defaults to all visible with a "Reset to defaults" button
- **Expanded Withings metrics** — now captures heart pulse during weigh-in (meastype 11), segmental fat mass per limb (right arm, left arm, torso, right leg, left leg); displays in a new Segmental Analysis table (muscle + fat per limb) on the Body tab
- **Withings ECG** — syncs ECG recordings from `/v2/heart` endpoint after each measurement sync; stores `ecg_heart_rate` (latest reading) and `ecg_afib` (Normal / Detected per day); requires re-authorization to grant `user.cardiovascular` scope
- **Fixed Withings type-174 duplicate bug** — `visceral_fat` was being silently overwritten by a second `174` mapping; corrected to a single `visceral_fat` entry
- **Expanded Garmin metrics** — now extracts moderate/vigorous intensity minutes from dailies; respiration rate and sleep score from sleep response (already fetched)
- **Fitbit Active Zone Minutes** — synced from `/activities/active-zone-minutes` endpoint using the existing `activity` scope
- **Fitbit VO2 Max** — synced from `/cardioscore` endpoint; requires re-authorization to grant `cardio_fitness` scope
- **New metric cards** in Wellness — Active Zone Min, Moderate Intensity, Vigorous Intensity (Movement tab); Sleep Score (Sleep tab); VO2 Max (Heart tab); Heart Pulse, ECG Heart Rate, AFib Detection (Body Scan Scores); ECG & AFib chip on Withings connect screen

### Changed
- Visibility filtering extended to Body, Body Scan Scores, Garmin-specific, and Segmental sections (previously only applied to Movement/Sleep/Heart)
- **Labs section removed** from Settings — it had been reduced to a redirect note; credentials are fully managed per-integration in Settings → Wellness

---

## [0.19.0-beta] — 2026-03-29

### Added
- **Garmin integration (Experimental)** — OAuth 1.0a flow via Garmin Health API; syncs steps, distance, active minutes, calories, floors, sleep stages, resting HR, HRV, SpO2, Body Battery, and Stress score; requires a Garmin Health API partnership (not a free developer program)
- **GarminIcon** — triangle brand mark SVG component (`currentColor`) matching the Garmin logo
- **Garmin sync button** — appears in the fixed topbar alongside Fitbit/Withings when connected; shows GarminIcon at rest, spinning sync icon while active
- **Garmin card in Settings → Wellness** — with purple "Experimental" badge, enable toggle, sync range chips + custom input, and inline credential setup form (Consumer Key/Secret/Redirect URI)
- **Garmin-specific metrics in Heart tab** — Body Battery (peak/low) and Avg Stress shown in a dedicated Garmin card
- **Merged activity display** — Fitbit data takes priority; Garmin fills in when Fitbit has no value for a metric (movement, sleep, heart tabs)

### Fixed
- **Nerve Activity (EDA) display** — Withings Body Scan nerve measurement (meastype 226) is raw electrodermal activity in µS, not a 0–100 score; unit corrected from `/100` → `µS` and label updated to "Nerve Activity" to accurately reflect what the API returns

---

## [0.18.0-beta] — 2026-03-29

### Added
- **Per-user Fitbit & Withings credentials** — each user registers their own developer OAuth app; credentials stored in user_settings (multi-user) or app_config (single-user), no admin required
- **Inline credential setup in Settings → Wellness** — when a tracker is enabled but not yet configured, the credential form appears inline with step-by-step instructions; no separate Labs section needed
- **Last synced timestamp** — `/status` routes now return `lastSyncedAt`; Settings → Wellness shows "Last synced X minutes ago" next to each connected device
- **DEPLOY.md** — full self-hosting guide: Docker Compose setup, all env vars, first-run walkthrough, Fitbit & Withings OAuth app registration steps with required scopes and redirect URI format

### Changed
- Settings → Labs now shows a brief note directing users to Settings → Wellness for credential setup
- Redirect URI suggestion auto-filled from `window.location.origin` (matches actual deployment URL instead of placeholder)

---

## [0.17.0-alpha] — 2026-03-29

### Added
- **Wellness settings section** — dedicated "Wellness" section in Settings (between AI Assistant and Labs) for all user-facing wellness controls: Activity Tracking toggle, Sync Mode selector, and per-integration cards (Fitbit + Withings) each with an enable toggle, sync range (chips + custom input), and a 4-state connection UI (loading / connected+disconnect / configured+connect / admin-required)

### Changed
- Settings → Labs now contains only admin API credentials (Fitbit Client ID/Secret, Withings Client ID/Secret); all operational controls moved to the new Wellness section
- Non-admin users see an info card in Labs noting that credentials are managed by an admin

---

## [0.16.0-alpha] — 2026-03-29

### Added
- **Sliding pill tabs** — `Tabs.svelte` now uses an animated sliding pill indicator (same transition as BottomNav) on Foods (Foods/Meals/Recipes), MealEditor picker, and anywhere else the `<Tabs>` component is used
- **Wellness tab bar pill** — Wellness Movement/Sleep/Heart/Body/Trends tab bar gets the same sliding pill treatment
- **Wellness sync buttons in topbar** — Fitbit and Withings sync buttons are now fixed to the top-right corner (same row and height as the hamburger menu), portalled to `document.body` so they stay on screen while scrolling; each shows its brand logo at rest and a spinning sync icon while active
- **FitbitIcon + WithingsIcon** — monochrome SVG brand mark components (`currentColor`) for use anywhere in the app
- **Disconnect in Settings** — Fitbit and Withings each show a "Connected device" row (with account ID) and a Disconnect button inside Settings → Labs; connection status fetched when Labs section opens
- **Custom sync range** — Fitbit and Withings sync range now support any number of days via an inline number input alongside the preset chips; input highlights accent when a custom value is active
- **Multi-select in MealEditor ingredient picker** — checkbox-based multi-select across all three tabs (Foods, Meals, Recipes); selecting multiple items opens a stacked per-item portion sheet before batch-adding; single tap still opens the single-item flow

### Changed
- Wellness sync bars removed from content area — sync is now always accessible from the fixed topbar buttons regardless of active tab
- Wellness disconnect moved from topbar to Settings → Labs (more appropriate home for device management)
- Settings Appearance: Celebrate goals, Page banners, Loop banner animations descriptions now render below the label (block `<div>`) instead of inline (`<span>`), consistent with Persistent sidebar

### Fixed
- Wellness sync buttons now stay visible while scrolling (portal + position:fixed, unaffected by Svelte fade transition stacking context)

---

## [0.15.0-alpha] — 2026-03-28

### Added
- **AI wellness context** — AI Buddy now includes today's Fitbit and Withings data (steps, active minutes, sleep, HR, HRV, weight, body fat, etc.) in its system prompt so it can speak to your full health picture
- **Wellness goal celebrations** — metric cards pulse with the same `goal-pulse` animation as Diary when a tracked metric (steps, active minutes, sleep duration) crosses its goal for the day; respects the "Celebrate goals" and "Disable animations" settings

### Changed
- Wellness tab bar now uses `flex: 1 0 auto` so tabs are equally spaced on wide screens and horizontally scrollable on mobile without shrinking

### Fixed
- Wellness tab bar buttons were all left-aligned on desktop after the scroll fix; restored equal distribution while preserving scrollability on small screens

---

## [0.14.0-alpha] — 2026-03-28

### Added
- **WellnessBanner** — animated SVG banner for the Wellness page header: shoe-print trail walking left→right with sequential stamp animation, floating Zzz's looping upward beside a crescent moon, and twinkling stars; dual radial glow gradients (warm left / cool right); full `no-anim` / `no-loop` class support and `prefers-reduced-motion` media query
- **Fitbit sync range** — Settings → Labs: chip selector for how far back the manual Sync button fetches (1 day / 1 week / 1 month / 3 months / 1 year); auto-sync always covers today only; server supports `{ from, to }` range with 250ms throttle and 429 rate-limit detection

### Changed
- Sidebar version string updated to v0.14.0-alpha
- Wellness tab restored to Statistics' slot in BottomNav; Statistics restored alongside it; Wellness only appears when the `wellnessEnabled` setting is on; Wellness inserts after Foods (where Water used to be)
- Foods/Meals/Recipes multi-select: searching no longer clears selection; only switching tabs resets it

### Fixed
- Water card banner title position corrected from `padding-bottom: 52px` to `16px`
- Wellness title: removed inline icon from h1 to match all other page headers
- Fitbit OAuth redirect: callback redirected to `/?fitbit=connected#/wellness` (real query string) instead of `/#/wellness?connected=1` (inside hash fragment) — the latter caused svelte-spa-router to fall through to `* → Diary`
- Fitbit OAuth callback URL: the correct redirect URI to register in the Fitbit developer portal and in Settings → Labs is `https://your-domain.com/api/wellness/fitbit/callback`

---

## [0.13.0-alpha] — 2026-03-28

### Added
- **Wellness section** — new nav entry (replaces the Stats slot in BottomNav; sits between Foods and Goals in Sidebar) with dedicated `/wellness` route; powered by Fitbit integration with full OAuth 2.0 PKCE flow
- **Fitbit integration** — connects to Fitbit API to sync: Steps, Distance, Floors Climbed, Active Minutes, Calories Burned (Movement tab); Sleep Duration, Efficiency, Deep/Light/REM/Wake stages with visual stage breakdown bar (Sleep tab); Resting Heart Rate, HRV (RMSSD), SpO2, Respiratory Rate (Heart tab)
- **Wellness DB tables** — `wellness_data` (source-keyed per-metric storage for future Garmin/Withings/Google Health support) and `fitbit_tokens` (per-user OAuth tokens) added to SQLite schema
- **Settings → Labs section** — new "Experimental" section with Activity Tracking toggle, auto/manual sync mode selector, and Fitbit API credential fields (Client ID, Client Secret, Redirect URI with auto-suggested value + copy button); credential fields shown to admins only in multi-user mode
- **Fitbit OAuth server routes** — `GET /api/wellness/fitbit/authorize` (PKCE redirect), `GET /api/wellness/fitbit/callback` (token exchange), `POST /api/wellness/fitbit/sync` (fetch all metrics), `GET /api/wellness/fitbit/data` (read stored data), `DELETE /api/wellness/fitbit/disconnect`
- **Wellness goals** — Steps, Active Minutes, and Sleep Duration goal fields in Goals page when Wellness is enabled (both "Your Goals" and "All Fields" tabs)
- **Date navigation on Wellness** — browse historical data by day (same UX as Diary); auto-sync on open with 15-minute cooldown when sync mode is set to auto

### Changed
- BottomNav: Stats tab replaced by Wellness (`monitor_heart` icon); Stats remains accessible via Sidebar and Settings start-page
- BottomNav Stats tab replaced by Wellness (`monitor_heart` icon); Stats remains accessible via Sidebar

---

## [0.12.0-alpha] — 2026-03-28

### Added
- **Water card in Diary** — the `water_drop` topbar button now opens a full-featured sheet: animated SVG bottle (fill, wave, overflow drip effects), amount/goal stats, progress bar, quick-add container grid with custom-amount input, and a deletable per-entry log; works for any diary date (not just today)
- **Water card banner** — WaterBanner (waves, drops, bubbles) rendered as a 110px strip at the top of the sheet, matching the visual style of all other page banners; "Water" title overlaid at bottom-left in gradient text, consistent with every other page header
- **Water card empty state** — faded water drop icon + "No water logged yet today" message shown when no water has been logged, matching the standalone Water page
- **First-run integrations step** — new wizard step between activity and summary; cards for Open Food Facts, USDA FoodData Central, Mealie, and AI Buddy; each individually skippable; AI card auto-hidden if configured via env vars; all saved values written to `user_settings` (included in backup)
- **PWA offline fallback** — `public/offline.html` served by the service worker when the server is unreachable during a cold open; branded "Can't reach your server / Try again" page instead of a browser error
- **Server-error banners** — Diary and Foods show a subtle inline "Could not reach server — retry" banner when the initial data load fails; Foods suppresses the "no items" empty state during an error

### Changed
- Water page removed — standalone `/water` route, nav entry (bottom nav, sidebar), and Settings start-page option all removed; all functionality lives in the Diary water card
- `alert()` calls replaced with `showError()` toasts in FoodEditor (camera denied, OFF upload failures)

### Fixed
- Water card banner title position matches page-header banner proportions (`padding-bottom: 52px`, title at bottom-left)
- Quick-add container buttons centered in the sheet (flex-wrap with `justify-content: center`)

---

## [0.11.0-alpha] — 2026-03-28

### Added
- **Diary multi-delete** — long-press any diary item → action sheet → "Select multiple" to enter select mode; circles appear on each item, header shows count with cancel and trash; batch removes all selected in one write
- **Multi-select when adding food** — in pick mode (Diary → Foods), circle button on each row toggles selection independently of the row tap; header confirms selection count with a check button; stacked portion sheet for multiple items when prompt-quantity is on
- **OFF upload verification** — after contributing to Open Food Facts, app waits 3 seconds then does a follow-up barcode lookup to confirm the product is live; shows "Confirmed" or "Submitted — may take a few minutes" with a direct link to the product page
- **OFF duplicate check** — before uploading to Open Food Facts, checks if the barcode already exists; warns the user that uploading will update an existing community entry, with option to cancel or continue
- **Hover tooltips** — every icon-only button across the app now shows a description on hover (native `title` attribute); covers all navigation, action, editor, and utility buttons
- **Branded email templates** — invite and password reset emails redesigned with NutriTrace logo, "Trace Every Bite" tagline, mint accent stripe, and CTA button; automatically switches between dark and light layouts based on the recipient's OS preference (`prefers-color-scheme`); copyright footer

### Changed
- Thumbnails increased from 40–44 px → 52 px across Foods, Diary, and MealEditor for improved readability
- "Share to OFF" button now shows "Submitted!" on success (previously "Contributed!")

### Fixed
- `contributeToOFF` was accidentally defined inside `_USDA_NUTRIENT_MAP` object instead of `API`, causing "is not a function" error on every OFF upload attempt
- UTC vs. local timezone mismatch in Goals page (today's totals were fetching the wrong diary date for US timezones); same fix applied to Foods yesterday's meals lookup

---

## [0.10.0-alpha] — 2026-03-22

### Added
- **Animated page banners** — optional decorative banners on all main routes (Diary, Foods, Water, Goals, Statistics, Settings); can be disabled in Appearance settings; Foods banner features a typewriter "Today's Menu" animation with floating food silhouettes (fork, apple, carrot, spoon)
- **Full-screen ingredient picker in MealEditor** — tabbed overlay (Foods / Meals / Recipes) with search; replaces the previous inline search
- **Water goal moved to Goals page** — consolidated alongside nutrition and body stat goals; removed from Settings
- **Env-var config locking** — SMTP and other server settings can be set via environment variables in `docker-compose.yml`; locked fields are disabled in the Settings UI
- **Sign-out button** — added to sidebar footer in multi-user mode
- **Per-meal icons in action sheet** — "Move to meal" sheet shows the correct meal icon for each slot
- **Scroll position preservation** — Foods page restores scroll position after adding a food to diary and navigating back
- **Backup improvements** — upload & restore from a local ZIP file; mobile-optimized backup table layout

### Changed
- Settings page restructured and reworded throughout; all sections have descriptions
- Goals page: "Your Goals" tab now categorized (Body Stats / Nutrients / Water)
- Diary header layout: date navigation above the title, action icons fixed top-right (same level as hamburger)
- Service worker no longer precaches `index.html` — eliminates stale UI after deploys
- Camera constraints simplified — no longer requests a specific resolution, fixing narrow viewfinder on portrait phones

### Fixed
- Recipe nutrition not preserved when added to diary
- Recipe nutrition not scaling correctly when portion size changes in editor
- Waistline recipe nutrition not scaled to portion size on import
- Diary edit sheet not rescaling nutrition when serving size is changed
- FoodsBanner silhouettes collapsing on desktop (percentage height had no resolved parent)
- Scroll restoration using incorrect method on some browsers
- Broken ingredient images from stale Waistline image paths
- Banner scaling distorting on wide/desktop screens
- Goals page reactive statements not updating when totals changed
- PWA manifest corrected so app installs standalone instead of as browser shortcut
- HTTP caching disabled on all API calls — prevents stale data after import or restore

---

## [0.9.0-alpha] — 2026-03-10

### Added
- **Goal templates** — save and apply named sets of nutrition/macro goals
- **Settings search** — filter all settings by keyword
- **Drag-to-reorder** — meal names, visible nutrients, and body stats order all drag-reorderable in Settings
- **Photo URL input** — add a photo to any food, meal, or recipe via a direct URL
- **Waistline Android import** — import foods, diary entries, meals, recipes, and images from a Waistline backup
- **GitHub Actions CI** — pushes to `main` automatically build and publish `ghcr.io/thebigjoe1/nutritrace:latest`
- **Proportional nutrition scaling** — lock icon in FoodEditor scales all nutrients proportionally when serving size changes; real-time preview as you type

### Changed
- Food, meal, and recipe list cards redesigned — shows calories per default portion
- Trans fat, polyunsaturated fat, and monounsaturated fat set to hidden by default
- Sodium visible by default; salt hidden by default (US Nutrition Facts convention)
- Settings: drag-to-reorder nutrients and body stats order

### Fixed
- Meal/recipe nutrition totals showing 0 kcal in list view
- Proportional scaling math and snapshot logic
- Category import and add/remove bugs in FoodEditor
- Waistline import: base64 images uploaded to server, ingredient references resolved, image URLs corrected

---

## [0.8.0-alpha] — 2026-03-01

### Added
- **SQLite backend** — all data migrated from IndexedDB to a server-side SQLite database via Express API
- **Docker support** — single multi-stage container (Svelte build + Express server); `docker compose up -d`
- **Optional user management** — JWT authentication, user profiles, admin/user roles, invite system (email or copyable link)
- **Password reset** — forgot password flow via email with time-limited token
- **Full server-side backup** — creates a ZIP of all data + uploaded images; download, restore, or delete from Settings
- **Server-side settings sync** — settings tied to account; persist across devices and survive container rebuilds
- **Mealie integration** — browse and import recipes from a self-hosted Mealie instance (proxied server-side)
- **AI Buddy** — floating chat panel with multi-provider AI support (OpenAI, Anthropic, etc.) for nutrition questions
- **Water tracking** — log water intake by container type; progress shown in diary and statistics
- **USDA FoodData Central** — search the USDA database directly from the Foods page
- **Open Food Facts contribution** — share locally-created foods back to the OFF database
- **Session timeout** — configurable (never / 8h / 1d / 7d / 30d / 90d / 1y); admin-only setting
- **Appearance settings** — theme (light/dark/system), accent color, nav style, animation toggle
- **Barcode scanner** — scan barcodes to look up foods via Open Food Facts
- **Camera photo capture** — take or crop photos for foods and meals directly in the editor
- **Statistics page** — charts for calories, macros, weight, and other tracked values over time; bar and line modes
- **README** — setup and configuration guide

### Changed
- Renamed from Waistline Web to **NutriTrace** — new logo, name, and Docker image
- Serving size editable directly in the add-to-diary prompt and diary edit sheet

### Fixed
- OFF search switched from deprecated CGI endpoint to working search API
- Proxy added for OFF and USDA requests to avoid CORS errors
- Nutrition calculation: values correctly treated as per-serving, not per-100g

---

## [0.1.0-alpha] — 2026-02-15

Initial release — Svelte 4 PWA forked from Waistline Web concept.

### Added
- Diary with meal groups, daily macro summary, and calorie progress bar
- Foods database — add, edit, and delete custom foods
- Meals and recipes — group foods into reusable meals; recipes scale by portion
- Goals — set calorie and macro targets with progress indicators
- Settings — units, date/time format, display preferences, meal name customization
- Open Food Facts integration — search and import foods by name or barcode
- IndexedDB local storage — all data stored on-device, no account required
