# NutriTrace — Project Reference

**App name**: NutriTrace
**Version**: 0.8.0-alpha
**Location**: `/home/papa/Documents/claude_code/nutritrace/`
**GitHub**: `git@github.com:thebigjoe1/nutritrace.git`
**Stack**: Svelte 4, svelte-spa-router v4 (hash routing), Vite, IndexedDB, PWA (service worker)
**Docker**: `docker compose up -d` → serves on port 3000

## Architecture

- **`src/main.js`** — Entry point. Calls `DB.init()` BEFORE mounting App. App never mounts if DB fails.
- **`src/App.svelte`** — Root component. Contains `{#key $location}` router wrapper (destroys/recreates route on nav), hamburger button, diary icon buttons, BottomNav. `onMount` checks `setupComplete` and redirects to wizard if needed. Does NOT call `loadEntry` — Diary handles its own loading.
- **`src/routes/Diary.svelte`** — Main diary page. onMount calls `loadEntry(today)` + attaches visibilitychange listener for next-day detection.
- **`src/routes/Foods.svelte`** — Food picker. `_addFoodToDiary` awaits `addDiaryItem` then calls `history.back()`.
- **`src/routes/Statistics.svelte`** — Statistics/charts page. `_loadVer` version guard prevents concurrent `loadData` calls; `$:` reactive block handles initial load (no redundant `onMount(loadData)`).
- **`src/stores/diary.js`** — `currentDate`, `currentEntry`, `diaryTotals` stores. `loadEntry`, `addDiaryItem`, `removeDiaryItem`, `updateDiaryItem`, `saveBodyStats` functions.
- **`src/stores/settings.js`** — All settings as `createSettingStore` instances backed by localStorage.
- **`src/lib/db.js`** — IndexedDB abstraction. `DB.init()` must be called before any DB operation. Uses `_initPromise` singleton to prevent double-open. `getDate(dateStr)` uses `getByIndex('diary', 'date', dateStr)` with fallback full scan. `saveDate` upserts by date.

## Key Design Decisions

- **`{#key $location}`** in App.svelte: destroys and recreates the entire route component on every navigation. `onMount` fires fresh on every visit, but component state is lost.
- **`addDiaryItem` always reads from DB**: never relies on `currentEntry` being current. Avoids the bug where stale/null `currentEntry` causes all old food to appear when adding.
- **Settings auto-save**: most settings save reactively via `$: set(key, value)`. Meal names auto-save on input blur, no Save button.

## Fixes Applied (as of 2026-03-22)

### Settings lockup — double dispatch from createSettingStore.set()
- **Root cause**: `createSettingStore.set()` dispatched `wl:setting` TWICE. Caused 50+ synchronous listener callbacks per click, losing iOS touch events.
- **Fix**: Removed redundant explicit dispatch; `DB.setSetting` already fires it.

### Diary loading bug — overlapping Diary.svelte instances during page transitions
- **Root cause**: `{#key $location}` creates overlapping instances during transitions; shared `_loadSeq` counter was unreliable.
- **Fix**: Removed `out:fade` from App.svelte (old instance destroyed immediately). Replaced `_loadSeq` with `currentDate`-check guard in `loadEntry`.

### Diary loading bug #2 — async race: currentDate set too late
- **Root cause**: `currentDate.set(dateStr)` was called AFTER `await DB.init()`. Concurrent `loadEntry` could fire between them.
- **Fix**: `currentDate.set(dateStr)` moved BEFORE `await DB.init()` — date set synchronously before any async work.

### Diary display bug — Svelte not tracking getMealItems reactivity
- **Root cause**: `getMealItems(mealIdx)` closed over `entry` via closure; Svelte didn't re-run when `entry.items` changed.
- **Fix**: Changed to `getMealItems(entryItems, mealIdx)` — pass `entry.items` as explicit parameter. Template: `{@const items = getMealItems(entry.items, mealIdx)}`.

### Diary date guard on entry reactive statement
- **Fix**: `$: entry = ($currentEntry && $currentEntry.date === $currentDate) ? $currentEntry : { items: [], bodyStats: {} };`

### Diary item with null meal not showing
- **Fix**: `const m = (it.meal != null) ? it.meal : 0` — treats missing meal as Breakfast (0).

### Settings.svelte — autoSaveMeals DOM mutation during blur
- **Fix**: Removed `meals = filtered` DOM mutation from blur handler; only calls `mealNames.set(toSave)`.

### Diary item deletion — action sheet instead of trash icon
- Long-press (mobile) and right-click / contextmenu (desktop) open action sheet: **Edit / Move to meal / Delete**.

### Statistics — empty/hollow bars in bar mode
- **Root cause**: Average/Trend/Goal overlay datasets were Chart.js bar type; rendered as hollow bars on every date in bar mode.
- **Fix**: Overlay datasets explicitly set `type: 'line'`. Bar main dataset only shows dates with actual data (`data.filter(d => d.val !== null && d.val > 0)`).

### Statistics — duplicate loadData calls
- **Root cause**: Both `onMount(loadData)` and `$:` reactive block fired on mount.
- **Fix**: Removed `onMount(loadData)`; `$:` block handles initial load. Added `_loadVer` version guard to abort stale async calls.

### Statistics — duplicate current day entry in 'all' mode
- **Fix**: Deduplicated dates with `dates = [...new Set(all)].sort()`.

## Svelte Reactivity Lessons

- **Function calls in templates**: Svelte only tracks reactive dependencies that appear DIRECTLY in template expressions. Functions that close over reactive variables are NOT tracked. Always pass reactive values as explicit function parameters.
- **`$:` reactive statements**: fire on mount AND on dependency change. Don't add redundant `onMount` calls for the same function.
- **Async race guards**: for async loads keyed to a value (e.g. date), capture the key before the await and check it still matches after. Use the store value itself as the guard, not a separate counter.
