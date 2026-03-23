import { writable, derived } from 'svelte/store';
import { DB } from '../lib/db.js';
import { Nutrition } from '../lib/nutrition.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export const currentDate  = writable(todayStr());
export const currentEntry = writable(null);  // { id, date, items[], bodyStats{} }
// UI state — controlled from App.svelte topbar buttons, consumed in Diary.svelte
export const diaryShowNutritionSummary = writable(false);
export const diaryShowBodyStats        = writable(false);

export const diaryTotals = derived(currentEntry, $entry => {
  if (!$entry || !$entry.items) return {};
  return Nutrition.sum($entry.items.map(i => Nutrition.calculate(i)));
});

export const macroPercents = derived(diaryTotals, $t => {
  return Nutrition.macroPercents($t);
});

/**
 * Ensure a diary entry exists for dateStr. Creates one in DB if missing.
 * Always returns an entry object with a valid numeric id (V1-style stable ID approach).
 */
async function _ensureEntry(dateStr) {
  let entry = await DB.getDate(dateStr);
  if (!entry) {
    const newEntry = { date: dateStr, items: [], bodyStats: {} };
    const id = await DB.add('diary', newEntry);
    // DB.add mutates newEntry.dateTime in place and returns the auto-assigned key
    entry = { ...newEntry, id };
  }
  return entry;
}

export async function loadEntry(dateStr) {
  // Set the date FIRST (before any async work) so UI header updates immediately
  // and rapid navigation reads always see the latest intended date
  currentDate.set(dateStr);
  await DB.init();
  let entry = null;
  try {
    entry = await DB.getDate(dateStr);
    console.log('[diary] loadEntry', dateStr, '->', entry ? 'found id=' + entry.id + ' items=' + entry.items?.length : 'null');
  } catch(e) {
    console.error('[diary] loadEntry DB error:', e);
  }
  // Only commit if currentDate still matches — if user navigated away during
  // the DB read, another loadEntry will have set currentDate to the new date
  let curDate = null;
  currentDate.subscribe(v => curDate = v)();
  if (curDate === dateStr) {
    console.log('[diary] committing currentEntry for', dateStr, entry ? entry.id : '(empty)');
    currentEntry.set(entry || { date: dateStr, items: [], bodyStats: {} });
    _cleanupSpuriousEntries(dateStr);
  } else {
    console.log('[diary] loadEntry', dateStr, 'stale - current date is now', curDate, '- skipping');
  }
  return entry || null;
}

async function _cleanupSpuriousEntries(keepDate) {
  try {
    const all = await DB.getAll('diary');
    for (const e of all) {
      if (e.date !== keepDate && e.items && e.items.length === 0 &&
          (!e.bodyStats || Object.keys(e.bodyStats).length === 0)) {
        console.log('[diary] removing spurious empty entry id=' + e.id + ' date=' + e.date);
        await DB.delete('diary', e.id);
      }
    }
  } catch(e) { /* silent — cleanup is best-effort */ }
}

export async function addDiaryItem(foodItem, meal, date) {
  await DB.init();
  let viewDate = null;
  currentDate.subscribe(v => viewDate = v)();
  const targetDate = date || viewDate || todayStr();
  // Ensure the entry exists in DB (creates if needed) — gives us a stable id
  const existing = await _ensureEntry(targetDate);
  const now = new Date().toISOString();
  const item = { ...foodItem, meal: meal != null ? Number(meal) : 0, addedAt: now };
  const updated = { ...existing, items: [...existing.items, item] };
  await DB.put('diary', updated);
  // Refresh store only if the user is still viewing this date
  currentDate.subscribe(v => viewDate = v)();
  if (targetDate === viewDate) {
    const saved = await DB.get('diary', updated.id);
    currentEntry.set(saved || updated);
  }
}

export async function removeDiaryItem(index) {
  await DB.init();
  let entry = null;
  currentEntry.subscribe(v => entry = v)();
  if (!entry || !entry.id) return;
  // Read fresh from DB by id to avoid any stale in-memory state
  const fresh = await DB.get('diary', entry.id);
  if (!fresh) return;
  const items = fresh.items.filter((_, i) => i !== index);
  const updated = { ...fresh, items };
  await DB.put('diary', updated);
  currentEntry.set(updated);
}

export async function updateDiaryItem(index, changes) {
  await DB.init();
  let entry = null;
  currentEntry.subscribe(v => entry = v)();
  if (!entry || !entry.id) return;
  // Read fresh from DB by id
  const fresh = await DB.get('diary', entry.id);
  if (!fresh) return;
  const items = fresh.items.map((item, i) => i === index ? { ...item, ...changes } : item);
  const updated = { ...fresh, items };
  await DB.put('diary', updated);
  currentEntry.set(updated);
}

export async function saveBodyStats(stats) {
  await DB.init();
  let entry = null;
  currentEntry.subscribe(v => entry = v)();
  if (!entry || !entry.id) return;
  const updated = { ...entry, bodyStats: { ...entry.bodyStats, ...stats } };
  await DB.put('diary', updated);
  currentEntry.set(updated);
}

export function prevDay() {
  let d = null;
  currentDate.subscribe(v => d = v)();
  const dt = new Date(d + 'T12:00:00');
  dt.setDate(dt.getDate() - 1);
  loadEntry(dt.toISOString().slice(0, 10));
}

export function nextDay() {
  let d = null;
  currentDate.subscribe(v => d = v)();
  const dt = new Date(d + 'T12:00:00');
  dt.setDate(dt.getDate() + 1);
  loadEntry(dt.toISOString().slice(0, 10));
}
