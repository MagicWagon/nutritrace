# NutriTrace — Future Implementations

Ideas and planned enhancements. Grouped by area. No commitment to order or timeline.

---

## Wellness — Reporting Phases

### Phase 1 — Trends tab *(next)*
Add a **Trends** tab to the Wellness page alongside Movement / Sleep / Heart.

- **Range selector**: 7 / 30 / 90 day chip group
- **Charts**: line charts using Chart.js (same setup as Statistics)
  - Steps (Movement)
  - Sleep duration (Sleep)
  - Resting heart rate (Heart)
  - HRV / RMSSD (Heart)
- Data read from `wellness_data` table, grouped by `metric_type`, sorted by date
- Reuse Statistics' accent color, grid lines, and tooltip config

### Phase 2 — Derived insights
Richer analysis derived from raw Fitbit data. Some metrics require storing additional fields.

**Sleep quality:**
- Sleep debt — actual vs goal, rolling 7-day deficit
- Chronotype — early bird / night owl / intermediate from average `sleep_start` time
- Sleep consistency score — % of last 30 days meeting sleep goal

**Activity:**
- Step consistency score — % of last 30 days meeting steps goal
- Estimated HR zone from resting HR baseline

**Infrastructure needed:**
- Store `sleep_start` and `sleep_end` timestamps in `wellness_data`
  - Fitbit `GET /1/user/-/sleep/date/{date}.json` already returns `mainSleep.startTime` / `mainSleep.endTime`
  - Add `metric_type = 'sleep_start'` and `'sleep_end'` (ISO string values stored as text)

### Phase 3 — Dashboard / cross-domain correlation
A dedicated **Dashboard** page that correlates data across all domains (nutrition + activity + sleep + body stats).

- Widget grid — user-configurable
- Example widgets:
  - Sleep duration vs weight trend overlay
  - Steps vs net calories (burned – eaten)
  - "Best week" pattern summary
  - Today at a glance (streak tracker)
- May warrant a broader rebrand (e.g. "VitaTrace") since the app scope exceeds nutrition tracking

---

## Wellness — Additional Integrations

### Garmin Connect
- `wellness_data` schema already has `source` column (`'fitbit'` | `'garmin'` | ...)
- Garmin OAuth 2.0 (similar PKCE flow)
- Metrics overlap: steps, sleep, HR, HRV, SpO₂

### Google Health Connect (Android)
- Android Health Connect API (REST or local SDK bridge via PWA)
- Steps, sleep, HR from any Android wearable

### Apple Health (iOS)
- Requires a native iOS wrapper (WebKit `WKWebView` + Swift bridge)
- Or: export-based import (Apple Health XML export → parse + ingest)

### Withings
- Body composition scale data: weight, body fat %, muscle mass, bone mass, water %
- Would make Goals body stats richer with auto-populated values

---

## Shared Food Database

- `is_shared` flag (or `user_id = NULL`) on foods visible to all users in multi-user mode
- Admin can promote/demote shared foods
- Users can "copy to my library" a shared food for local editing
- Avoids duplication of common packaged foods across accounts on the same instance

---

## Diary Enhancements

### Calorie budget bar in diary header
- Visual remaining/over budget strip below the macro summary — color shifts red when over goal

### Meal-level macro summary
- Expandable per-meal macro breakdown (tap meal header to expand)

### Quick-log (voice / text)
- Natural language food entry: "2 eggs and a slice of toast"
- Uses AI Buddy backend (already multi-provider); returns structured nutrition data
- Confirmation sheet before adding

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
- Based on X weeks of actual diary data, AI Buddy suggests goal refinements
- "You've averaged 1,850 kcal for 4 weeks — your current goal of 2,100 may be too high"

---

## Statistics

### Body composition chart
- Weight / body fat % / muscle mass plotted together (requires Withings or manual entry)

### Weekly summary email
- Optional digest: calories in/out, steps, sleep averages, goal hit rate
- Uses existing SMTP / email template infrastructure

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

---

*Last updated: 2026-03-28*
