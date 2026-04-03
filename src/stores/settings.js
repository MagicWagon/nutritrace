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
  'weightUnit','heightUnit','lengthUnit','distUnit','tempUnit',
  'waterGoalMl','waterUnit','waterContainers','waterShowInStats','waterShowInDiary',
  'dateFormat','timeFormat',
  'statsChartType','statsYZero','statsAvgLine','statsGoalLine','statsTrendLine',
  'aiEnabled','aiProvider','aiApiKey','aiModel','aiAssistantName',
  'usdaEnabled','usdaApiKey','offUsername','offPassword',
  'mealieEnabled','mealieBaseUrl','mealieApiToken',
  'wellnessEnabled','fitbitEnabled','healthConnectEnabled','wellnessMetrics','workoutsEnabled','wellnessSyncMode','wellnessSyncRange',
  'withingsEnabled','withingsSyncRange','withingsDataPriority',
  'garminEnabled','garminSyncRange',
  'defaultFoodVisibility',
  // Appearance / UI prefs — included so full backups restore the full look-and-feel
  'appearance','accentColor',
  'navStyle','sidebarPersistent','startPage','disableAnimations','goalCelebrations','pageBanners','loopBannerAnimations',
]);

import { isNative, getServerUrl, getAuthToken } from '../lib/platform.js';

function _settingsUrl() {
  if (isNative) { const url = getServerUrl(); if (url) return url + '/api/settings'; }
  return '/api/settings';
}

function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (isNative && getServerUrl()) {
    const token = getAuthToken();
    if (token) h['Authorization'] = `Bearer ${token}`;
  }
  return h;
}

const _saveQueue = {};
function _isLoggedIn() { return !!localStorage.getItem('wl:userId'); }
function _shouldSyncToServer() { return _isLoggedIn() && !(isNative && !getServerUrl()); }
export function scheduleSave(key, value) {
  if (!SERVER_SETTINGS.has(key)) return;
  clearTimeout(_saveQueue[key]);
  _saveQueue[key] = setTimeout(async () => {
    // On native: always write to local SQLite (queues for differential sync)
    if (isNative) {
      try {
        const { dbUpsertSetting } = await import('../lib/db-native.js');
        await dbUpsertSetting(key, value);
      } catch (e) {
        console.warn('[settings] failed to save to local db:', e.message);
      }
    }
    // Try direct push to server (fast path when online)
    if (!_shouldSyncToServer()) return;
    try {
      await fetch(_settingsUrl(), {
        method: 'PUT',
        credentials: 'include',
        headers: _authHeaders(),
        body: JSON.stringify({ key, value }),
      });
      // If direct push succeeded on native, mark as synced so differential sync skips it
      if (isNative) {
        try {
          const { dbMarkSettingsSynced } = await import('../lib/db-native.js');
          await dbMarkSettingsSynced([key]);
        } catch {}
      }
    } catch (e) {
      console.warn(`[settings] direct push failed for ${key}:`, e.message);
    }
  }, 600);
}

/**
 * Called after login/auth-check. Fetches all server settings and populates
 * localStorage + notifies all stores via wl:setting events.
 */
export async function loadServerSettings() {
  if (!_shouldSyncToServer()) return;
  try {
    const res = await fetch(_settingsUrl(), { credentials: 'include', headers: _authHeaders() });
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
export const tempUnit   = createSettingStore('tempUnit',   'F');  // 'F' | 'C'

// Water
export const waterGoalMl      = createSettingStore('waterGoalMl',      2000);
export const waterUnit         = createSettingStore('waterUnit',         'ml');
export const waterContainers   = createSettingStore('waterContainers',   [
  { id: '1', name: 'Small Bottle',    volumeMl: 250 },
  { id: '2', name: 'Standard Bottle', volumeMl: 500 },
]);
export const waterShowInStats  = createSettingStore('waterShowInStats',  true);
export const waterShowInDiary  = createSettingStore('waterShowInDiary',  true);

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

// Page banners
export const pageBanners          = createSettingStore('pageBanners',          true);
export const loopBannerAnimations = createSettingStore('loopBannerAnimations', true);

// Wellness (Activity Tracking)
export const wellnessEnabled    = createSettingStore('wellnessEnabled',    false);
export const fitbitEnabled      = createSettingStore('fitbitEnabled',      false);
export const healthConnectEnabled = createSettingStore('healthConnectEnabled', false);
export const wellnessMetrics    = createSettingStore('wellnessMetrics',    null); // null = all visible
export const workoutsEnabled   = createSettingStore('workoutsEnabled',   false); // show workout history + GPS maps in Movement tab
export const wellnessSyncMode   = createSettingStore('wellnessSyncMode',   'auto'); // 'auto' | 'manual'
export const wellnessSyncRange  = createSettingStore('wellnessSyncRange',  7);    // days: 1|7|30|90|365

export const withingsEnabled      = createSettingStore('withingsEnabled',      false);
export const withingsSyncRange    = createSettingStore('withingsSyncRange',    7);
export const withingsDataPriority = createSettingStore('withingsDataPriority', {
  activity: 'fitbit',  // 'fitbit' | 'withings'
  sleep:    'fitbit',
  heart:    'fitbit',
});

export const garminEnabled   = createSettingStore('garminEnabled',   false);
export const garminSyncRange = createSettingStore('garminSyncRange', 7);

// Sharing
export const defaultFoodVisibility = createSettingStore('defaultFoodVisibility', 'private'); // 'private' | 'group' | 'specific'

// FitBot AI
export const aiEnabled       = createSettingStore('aiEnabled',       false);
export const aiProvider      = createSettingStore('aiProvider',      'claude');
export const aiApiKey        = createSettingStore('aiApiKey',        '');
export const aiModel         = createSettingStore('aiModel',         '');
export const aiAssistantName = createSettingStore('aiAssistantName', 'FitBot');
