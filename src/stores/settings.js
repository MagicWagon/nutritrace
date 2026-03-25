import { writable, get } from 'svelte/store';
import { DB } from '../lib/db.js';

// ── Server-side settings sync ──────────────────────────────────────────────
// Keys in this set are synced to the server when user management is active.
// Browser-only keys (appearance, nav style, etc.) are NOT in this set.
const SERVER_SETTINGS = new Set([
  'energyUnit','mealNames','goals','goalTemplates',
  'visibleNutriments','nutrimentsOrder','customNutriments',
  'bodyStatsOrder','hiddenBodyStats','foodCategories',
  'diaryShowNutritionBar','diaryTotalsMode',
  'diaryShowBrands','diaryShowTimestamps','diaryShowThumbnails',
  'diaryShowAllNutrients','diaryShowNutritionUnits','diaryShowMacroSummary',
  'diaryPromptQuantity','diaryShowPortionSize',
  'foodsShowCategories','foodsShowLabels','foodsShowNotes','foodsShowThumbnails',
  'foodsShowYesterdayMeals','foodsSort',
  'barcodeBeep','barcodeFlashlight','cropPhotos',
  'offSearchLanguage','offSearchCountry','offUploadCountry',
  'weightUnit','heightUnit','lengthUnit','distUnit',
  'waterGoalMl','waterUnit','waterContainers','waterShowInStats','waterShowInDiary',
  'dateFormat','timeFormat',
  'statsChartType','statsYZero','statsAvgLine','statsGoalLine','statsTrendLine',
  'aiEnabled','aiProvider','aiApiKey','aiModel','aiAssistantName',
  'usdaEnabled','usdaApiKey','offUsername','offPassword',
  'mealieEnabled','mealieBaseUrl','mealieApiToken',
]);

const _saveQueue = {};
function _isLoggedIn() { return !!localStorage.getItem('wl:userId'); }
export function scheduleSave(key, value) {
  if (!SERVER_SETTINGS.has(key)) return;
  clearTimeout(_saveQueue[key]);
  _saveQueue[key] = setTimeout(() => {
    if (!_isLoggedIn()) return;
    fetch('/api/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }).catch(() => {});
  }, 600);
}

/**
 * Called after login/auth-check. Fetches all server settings and populates
 * localStorage + notifies all stores via wl:setting events.
 */
export async function loadServerSettings() {
  if (!_isLoggedIn()) return;
  try {
    const res = await fetch('/api/settings', { credentials: 'include' });
    if (!res.ok) return;
    const serverSettings = await res.json();
    for (const [key, value] of Object.entries(serverSettings)) {
      // Use raw key for localStorage (DB.setSetting prefixes with wl_)
      DB.setSetting(key, value);
      window.dispatchEvent(new CustomEvent('wl:setting', { detail: { key: `wl_${key}` } }));
    }
  } catch {}
}

/**
 * Creates a Svelte store backed by a DB setting.
 * Syncs with the 'wl:setting' window event so changes in one
 * component are immediately reflected everywhere.
 */
function createSettingStore(key, defaultValue) {
  const store = writable(DB.getSetting(key, defaultValue));

  window.addEventListener('wl:setting', (e) => {
    if (e.detail && e.detail.key === key) {
      store.set(DB.getSetting(key, defaultValue));
    }
  });

  return {
    subscribe: store.subscribe,
    set(value) {
      DB.setSetting(key, value);
      store.set(value);
      scheduleSave(key, value);
    },
    update(fn) {
      const current = DB.getSetting(key, defaultValue);
      this.set(fn(current));
    },
    get() {
      return get(store);
    }
  };
}

export const appearance       = createSettingStore('appearance',       'system');
export const energyUnit        = createSettingStore('energyUnit',       'kcal');
export const mealNames         = createSettingStore('mealNames',        ['Breakfast','Lunch','Dinner','Snacks']);
export const goals             = createSettingStore('goals',            {});
export const goalTemplates     = createSettingStore('goalTemplates',    []);
export const visibleNutriments = createSettingStore('visibleNutriments', null);
export const nutrimentsOrder   = createSettingStore('nutrimentsOrder',  []);
export const customNutriments  = createSettingStore('customNutriments', []);
export const bodyStatsOrder    = createSettingStore('bodyStatsOrder',   []);
export const hiddenBodyStats   = createSettingStore('hiddenBodyStats',  []);
export const foodCategories    = createSettingStore('foodCategories',   []);

// Display prefs used in multiple pages
export const diaryShowNutritionBar = createSettingStore('diaryShowNutritionBar', true);
export const diaryTotalsMode      = createSettingStore('diaryTotalsMode', 'consumed'); // 'consumed' | 'remaining'
export const diaryShowBrands        = createSettingStore('diaryShowBrands',        true);
export const diaryShowTimestamps    = createSettingStore('diaryShowTimestamps',     false);
export const diaryShowThumbnails    = createSettingStore('diaryShowThumbnails',     true);
export const diaryShowAllNutrients  = createSettingStore('diaryShowAllNutrients',   false);
export const diaryShowNutritionUnits= createSettingStore('diaryShowNutritionUnits', true);
export const diaryShowMacroSummary  = createSettingStore('diaryShowMacroSummary',   true);
export const diaryPromptQuantity    = createSettingStore('diaryPromptQuantity',     true);
export const diaryShowPortionSize   = createSettingStore('diaryShowPortionSize',    false);

export const foodsShowCategories    = createSettingStore('foodsShowCategories',    true);
export const foodsShowLabels        = createSettingStore('foodsShowLabels',        true);
export const foodsShowNotes         = createSettingStore('foodsShowNotes',         true);
export const foodsShowThumbnails    = createSettingStore('foodsShowThumbnails',    true);
export const foodsShowYesterdayMeals= createSettingStore('foodsShowYesterdayMeals',true);
export const foodsSort              = createSettingStore('foodsSort',              'alpha');

export const barcodeBeep            = createSettingStore('barcodeBeep',            false);
export const barcodeFlashlight      = createSettingStore('barcodeFlashlight',      false);
export const cropPhotos             = createSettingStore('cropPhotos',             false);
export const offSearchLanguage      = createSettingStore('offSearchLanguage',      'en');
export const offSearchCountry       = createSettingStore('offSearchCountry',       'World');
export const offUploadCountry       = createSettingStore('offUploadCountry',       'Auto');

export const accentColor = createSettingStore('accentColor', 'mint');

/** Apply accent color — supports named presets and custom hex (#rrggbb) */
export function applyAccentColor(value) {
  const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
  // Clear any previously injected custom vars
  ['--accent','--accent-2','--accent-dim','--accent-text'].forEach(v =>
    document.documentElement.style.removeProperty(v));
  if (value === 'mint') {
    document.documentElement.removeAttribute('data-accent');
  } else if (isHex) {
    // Custom hex: remove data-accent and inject CSS vars directly
    document.documentElement.removeAttribute('data-accent');
    const r = parseInt(value.slice(1,3), 16);
    const g = parseInt(value.slice(3,5), 16);
    const b = parseInt(value.slice(5,7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    document.documentElement.style.setProperty('--accent',      value);
    document.documentElement.style.setProperty('--accent-2',    value);
    document.documentElement.style.setProperty('--accent-dim',  `rgba(${r},${g},${b},0.15)`);
    document.documentElement.style.setProperty('--accent-text', lum > 0.55 ? '#0A0B0F' : '#FFFFFF');
  } else {
    document.documentElement.setAttribute('data-accent', value);
  }
  accentColor.set(value);
}

/** Apply an appearance change and update the DOM + theme-color meta */
export function applyAppearance(value) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = value === 'dark' || (value === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.content = dark ? '#0A0B0F' : '#F5F7FA';
  appearance.set(value);
}

// Navigation & app settings (not already declared above)
export const navStyle          = createSettingStore('navStyle',          'both');
export const sidebarPersistent = createSettingStore('sidebarPersistent', false);
export const startPage         = createSettingStore('startPage',         '/');
export const disableAnimations  = createSettingStore('disableAnimations',  false);
export const goalCelebrations   = createSettingStore('goalCelebrations',   true);

// Date / time display format
export const dateFormat = createSettingStore('dateFormat', 'US');   // 'ISO' | 'US' | 'EU' | 'natural'
export const timeFormat = createSettingStore('timeFormat', '12h');  // '12h' | '24h'

// Statistics chart settings
export const statsChartType = createSettingStore('statsChartType', 'bar');
export const statsYZero     = createSettingStore('statsYZero',     true);
export const statsAvgLine   = createSettingStore('statsAvgLine',   true);
export const statsGoalLine  = createSettingStore('statsGoalLine',  true);
export const statsTrendLine = createSettingStore('statsTrendLine', true);

// Units
export const weightUnit = createSettingStore('weightUnit', 'lb');
export const heightUnit = createSettingStore('heightUnit', 'ft');
export const lengthUnit = createSettingStore('lengthUnit', 'in');
export const distUnit   = createSettingStore('distUnit',   'km');

// USDA / OFF API keys
export const usdaApiKey  = createSettingStore('usdaApiKey',  '');
export const usdaEnabled = createSettingStore('usdaEnabled', false);
export const offUsername = createSettingStore('offUsername', '');
export const offPassword = createSettingStore('offPassword', '');

// ── Category label helpers ─────────────────────────────────────────────────
// foodCategories items can be a plain string (legacy) or { name, label? }
export const catName    = c => typeof c === 'string' ? c : (c?.name    || '');
export const catLabel   = c => typeof c === 'string' ? '' : (c?.label  || '');
export const catDisplay = c => { const l = catLabel(c); return l ? `${l} ${catName(c)}` : catName(c); };

// FitBot AI
export const aiEnabled       = createSettingStore('aiEnabled',       false);
export const aiProvider      = createSettingStore('aiProvider',      'claude');
export const aiApiKey        = createSettingStore('aiApiKey',        '');
export const aiModel         = createSettingStore('aiModel',         '');
export const aiAssistantName = createSettingStore('aiAssistantName', 'FitBot');
