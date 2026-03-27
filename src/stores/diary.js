import { writable, derived } from 'svelte/store';
import { NtApi } from '../lib/api.js';
import { Nutrition } from '../lib/nutrition.js';
import { localDateStr } from '../lib/db.js';

function todayStr() {
  return localDateStr();
}

export const currentDate  = writable(todayStr());
export const currentEntry = writable(null);
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

// Map API snake_case → app camelCase
function _fromApi(entry) {
  if (!entry) return null;
  return { ...entry, bodyStats: entry.body_stats || {}, body_stats: undefined };
}

// Map app camelCase → API snake_case
function _toApi(entry) {
  return {
    items:      entry.items      || [],
    body_stats: entry.bodyStats  || entry.body_stats || {},
    water:      entry.water      || [],
  };
}

export async function loadEntry(dateStr) {
  currentDate.set(dateStr);
  let entry = null;
  try {
    const raw = await NtApi.getDiaryDate(dateStr);
    entry = _fromApi(raw);
  } catch(e) {
    console.error('[diary] loadEntry error:', e);
  }
  let curDate = null;
  currentDate.subscribe(v => curDate = v)();
  if (curDate === dateStr) {
    currentEntry.set(entry || { date: dateStr, items: [], bodyStats: {}, water: [] });
  }
  return entry || null;
}

async function _save(entry) {
  const saved = await NtApi.saveDiaryDate(entry.date, _toApi(entry));
  return _fromApi(saved);
}

export async function addDiaryItem(foodItem, meal, date) {
  let viewDate = null;
  currentDate.subscribe(v => viewDate = v)();
  const targetDate = date || viewDate || todayStr();

  let entry = null;
  if (targetDate === viewDate) {
    currentEntry.subscribe(v => entry = v)();
  }
  if (!entry || entry.date !== targetDate) {
    entry = _fromApi(await NtApi.getDiaryDate(targetDate));
  }
  if (!entry) entry = { date: targetDate, items: [], bodyStats: {}, water: [] };

  const item = { ...foodItem, meal: meal != null ? Number(meal) : 0, addedAt: new Date().toISOString() };
  const updated = { ...entry, items: [...(entry.items || []), item] };
  const saved = await _save(updated);

  currentDate.subscribe(v => viewDate = v)();
  if (targetDate === viewDate) currentEntry.set(saved);
}

export async function removeDiaryItem(index) {
  let entry = null;
  currentEntry.subscribe(v => entry = v)();
  if (!entry) return;
  const updated = { ...entry, items: entry.items.filter((_, i) => i !== index) };
  currentEntry.set(await _save(updated));
}

export async function updateDiaryItem(index, changes) {
  let entry = null;
  currentEntry.subscribe(v => entry = v)();
  if (!entry) return;
  const updated = { ...entry, items: entry.items.map((item, i) => i === index ? { ...item, ...changes } : item) };
  currentEntry.set(await _save(updated));
}

export async function saveBodyStats(stats) {
  let entry = null;
  currentEntry.subscribe(v => entry = v)();
  if (!entry) return;
  const updated = { ...entry, bodyStats: { ...entry.bodyStats, ...stats } };
  currentEntry.set(await _save(updated));
}

export function prevDay() {
  let d = null;
  currentDate.subscribe(v => d = v)();
  const dt = new Date(d + 'T12:00:00');
  dt.setDate(dt.getDate() - 1);
  loadEntry(localDateStr(dt));
}

export function nextDay() {
  let d = null;
  currentDate.subscribe(v => d = v)();
  const dt = new Date(d + 'T12:00:00');
  dt.setDate(dt.getDate() + 1);
  loadEntry(localDateStr(dt));
}
