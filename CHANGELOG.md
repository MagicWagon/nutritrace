# Changelog

All notable changes to NutriTrace are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
