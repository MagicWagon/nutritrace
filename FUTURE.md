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

### Fitbit GPS / Activity Routes
- Fitbit API provides GPS route data for outdoor activities (runs, walks, bike rides)
- `GET /1/user/-/activities/{id}.json` returns TCX data with lat/lon/elevation
- Could display route maps on a per-activity detail view (Leaflet or similar map library)
- Only unused Fitbit API capability — everything else is already synced

### Google Health Connect (Android)
- Android Health Connect API (REST or local SDK bridge via PWA)
- Steps, sleep, HR from any Android wearable

### Apple Health (iOS)
- Requires a native iOS wrapper (WebKit `WKWebView` + Swift bridge)
- Or: export-based import (Apple Health XML export → parse + ingest)

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

### Quick-log (voice / text)
- Natural language food entry: "2 eggs and a slice of toast"
- Uses FitBot AI backend (already multi-provider); returns structured nutrition data
- Confirmation sheet before adding

### Dynamic Calorie Goal
- **Fixed** (current, default) vs **Dynamic** (device calories_out × factor)
- Gate behind connected Fitbit/Garmin — hidden if no device
- Factor: 0.80 (lose) / 1.00 (maintain) / 1.20 (gain)
- Uses yesterday's final burn, falls back to fixed goal if no data
- Touchpoints: diary bar, goals page (read-only override), statistics goal line, FitBot
- Experimental badge

### Adaptive TDEE
- Learn actual TDEE by correlating weight trends with calorie intake over 35+ days
- Requires significant history to be accurate
- v1.0+ feature

---

## Foods / Nutrition

### Nutrient calculator overlay
- Select two foods → side-by-side comparison panel

### Recipe scaling from servings count
- Input "I want 6 servings" → auto-scale all ingredient quantities

### Barcode history
- Recent scans list; re-add without re-scanning

---

## Goals

### Rolling weekly / monthly goals
- Option to track goals over a week or month period, not just daily
- Useful for intermittent fasting or flexible dieting approaches

### AI-suggested goal adjustment
- Based on X weeks of actual diary data, FitBot suggests goal refinements
- "You've averaged 1,850 kcal for 4 weeks — your current goal of 2,100 may be too high"

---

## Statistics

### Body composition chart
- Weight / body fat % / muscle mass plotted together (Withings data available)

### Weekly summary email
- Optional digest: calories in/out, steps, sleep averages, goal hit rate
- Uses existing SMTP / email template infrastructure

---

## UI / UX Polish

### Accessibility
- ActionSheet: add `role="dialog"` and focus trap
- Form inputs: explicit `<label>` associations throughout
- MealEditor name field: `<div>` → `<label>` element

### Diary loading indicator
- Subtle spinner or opacity change on date navigation when network is slow

### Water log editing
- Tap a water log entry to edit volume/time (currently only add/delete)

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

### Security hardening
- Rate limiting on auth endpoints
- CORS middleware with explicit allowed origins
- CSRF protection
- Increase minimum password length (4 → 8+)

---

*Last updated: 2026-03-31*
