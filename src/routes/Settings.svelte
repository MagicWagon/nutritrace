<script>
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import Toggle from '../components/settings/Toggle.svelte';
  import Sheet  from '../components/ui/Sheet.svelte';
  import { showSuccess, showError } from '../stores/toast.js';
  import { applyAppearance, applyAccentColor } from '../stores/settings.js';
  import { AI_PROVIDERS, AI_MODELS, AI_DEFAULT_MODELS } from '../lib/aiChat.js';
  import {
    appearance, accentColor, energyUnit, mealNames,
    diaryShowBrands, diaryShowTimestamps, diaryShowThumbnails, diaryShowAllNutrients,
    diaryShowNutritionUnits, diaryShowMacroSummary, diaryPromptQuantity, diaryShowPortionSize,
    diaryShowNutritionBar, diaryTotalsMode,
    foodsShowCategories, foodsShowNotes, foodsShowThumbnails, foodsShowYesterdayMeals, foodsSort,
    barcodeBeep, barcodeFlashlight, cropPhotos,
    foodCategories, visibleNutriments, nutrimentsOrder, customNutriments,
    bodyStatsOrder, hiddenBodyStats,
    dateFormat, timeFormat,
    sidebarPersistent, goalCelebrations,
    aiEnabled, aiProvider, aiApiKey, aiModel, aiAssistantName,
  } from '../stores/settings.js';
  import { DB } from '../lib/db.js';
  import { NUTRIMENTS, Nutrition } from '../lib/nutrition.js';

  // ── Collapsible section state ──────────────────────────────────────────────
  $: isDark = $appearance === 'dark' || ($appearance === 'system' && (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  let openSections = { appearance: true, diary: false, water: false, foods: false, nutrients: false,
                       bodyStats: false, statistics: false, goals: false, categories: false,
                       units: false, integration: false, api: false, backup: false,
                       ai: false, about: false };

  function toggleSection(key) {
    openSections = { ...openSections, [key]: !openSections[key] };
  }

  // ── Appearance ─────────────────────────────────────────────────────────────
  const ACCENT_COLORS = [
    { value: 'mint',   label: 'Mint',   dark: '#4FFFB0', light: '#00C47A' },
    { value: 'blue',   label: 'Blue',   dark: '#4FC3F7', light: '#0277BD' },
    { value: 'red',    label: 'Red',    dark: '#FF7070', light: '#D93025' },
    { value: 'purple', label: 'Purple', dark: '#CE93D8', light: '#8E24AA' },
    { value: 'orange', label: 'Orange', dark: '#FFB547', light: '#E65100' },
    { value: 'teal',   label: 'Teal',   dark: '#4DD0E1', light: '#00838F' },
    { value: 'pink',   label: 'Pink',   dark: '#F48FB1', light: '#C2185B' },
    { value: 'yellow', label: 'Yellow', dark: '#FFF176', light: '#F9A825' },
    { value: 'indigo', label: 'Indigo', dark: '#9FA8DA', light: '#3949AB' },
    { value: 'lime',   label: 'Lime',   dark: '#C5E1A5', light: '#558B2F' },
    { value: 'rose',   label: 'Rose',   dark: '#FF80AB', light: '#E91E63' },
    { value: 'cyan',   label: 'Cyan',   dark: '#80DEEA', light: '#0097A7' },
  ];
  const APPEARANCE_OPTS = [
    { value: 'system', label: 'System default' },
    { value: 'dark',   label: 'Dark'           },
    { value: 'light',  label: 'Light'          },
  ];
  const ENERGY_OPTS = [
    { value: 'kcal', label: 'Calories (kcal)' },
    { value: 'kJ',   label: 'Kilojoules (kJ)'  },
  ];
  const NAV_STYLE_OPTS = [
    { value: 'bottom',   label: 'Bottom tab bar' },
    { value: 'sidebar',  label: 'Side panel'     },
    { value: 'both',     label: 'Both'           },
  ];
  const START_PAGE_OPTS = [
    { value: '/',           label: 'Diary'      },
    { value: '/foods',      label: 'Foods'      },
    { value: '/water',      label: 'Water'      },
    { value: '/statistics', label: 'Statistics' },
    { value: '/goals',      label: 'Goals'      },
    { value: '/settings',   label: 'Settings'   },
  ];

  // ── Custom accent color ───────────────────────────────────────────────────
  let customColorHex = /^#[0-9a-fA-F]{6}$/.test($accentColor) ? $accentColor : '#4FFFB0';
  let customHexInput = customColorHex;
  let showColorSheet = false;
  let cpHue = 160, cpSat = 100, cpLgt = 50;
  let cpR = 79, cpG = 255, cpB = 176;

  function _hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }
  function _hexToHsl(hex) {
    const r = parseInt(hex.slice(1,3),16)/255;
    const g = parseInt(hex.slice(3,5),16)/255;
    const b = parseInt(hex.slice(5,7),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h = 0, s = 0, l = (max+min)/2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d/(2-max-min) : d/(max+min);
      switch(max) {
        case r: h = ((g-b)/d + (g<b?6:0))/6; break;
        case g: h = ((b-r)/d + 2)/6; break;
        case b: h = ((r-g)/d + 4)/6; break;
      }
    }
    return [Math.round(h*360), Math.round(s*100), Math.round(l*100)];
  }

  function _syncRgbFromHex(hex) {
    cpR = parseInt(hex.slice(1,3),16);
    cpG = parseInt(hex.slice(3,5),16);
    cpB = parseInt(hex.slice(5,7),16);
  }
  function openColorSheet() {
    const cur = /^#[0-9a-fA-F]{6}$/.test($accentColor) ? $accentColor : '#4FFFB0';
    customColorHex = cur;
    customHexInput = cur;
    [cpHue, cpSat, cpLgt] = _hexToHsl(cur);
    _syncRgbFromHex(cur);
    showColorSheet = true;
  }
  function cpUpdateFromSliders() {
    customColorHex = _hslToHex(cpHue, cpSat, cpLgt);
    customHexInput = customColorHex;
    _syncRgbFromHex(customColorHex);
    applyAccentColor(customColorHex);
  }
  function cpUpdateFromHex() {
    if (/^#[0-9a-fA-F]{6}$/.test(customHexInput)) {
      customColorHex = customHexInput;
      [cpHue, cpSat, cpLgt] = _hexToHsl(customHexInput);
      _syncRgbFromHex(customHexInput);
      applyAccentColor(customHexInput);
    }
  }
  function cpUpdateFromRgb() {
    const r = Math.min(255, Math.max(0, cpR || 0));
    const g = Math.min(255, Math.max(0, cpG || 0));
    const b = Math.min(255, Math.max(0, cpB || 0));
    cpR = r; cpG = g; cpB = b;
    const hex = '#' + r.toString(16).padStart(2,'0') + g.toString(16).padStart(2,'0') + b.toString(16).padStart(2,'0');
    customColorHex = hex;
    customHexInput = hex;
    [cpHue, cpSat, cpLgt] = _hexToHsl(hex);
    applyAccentColor(hex);
  }
  function applyCustomColor() {
    if (/^#[0-9a-fA-F]{6}$/.test(customHexInput)) {
      applyAccentColor(customHexInput);
    }
    showColorSheet = false;
  }

  let navStyle  = DB.getSetting('navStyle',  'both');
  let startPage = DB.getSetting('startPage', '/');
  let disableAnimations        = DB.getSetting('disableAnimations', false);
  let sidebarPersistentVal     = DB.getSetting('sidebarPersistent', false);

  // ── Water ──────────────────────────────────────────────────────────────────
  let waterGoalMl      = DB.getSetting('waterGoalMl',      2000);
  let waterUnit        = DB.getSetting('waterUnit',        'ml');
  let waterContainers  = DB.getSetting('waterContainers',  [
    { id: '1', name: 'Small Bottle',     volumeMl: 250  },
    { id: '2', name: 'Standard Bottle', volumeMl: 500  },
    { id: '3', name: 'Large Bottle',    volumeMl: 1000 },
    { id: '4', name: 'Gallon Jug',       volumeMl: 3785 },
  ]);
  let waterShowInStats = DB.getSetting('waterShowInStats', true);
  let waterShowInDiary = DB.getSetting('waterShowInDiary', true);

  function _mlToDisplay(ml, unit) {
    if (unit === 'oz') return +(ml / 29.5735).toFixed(1);
    if (unit === 'L')  return +(ml / 1000).toFixed(2);
    if (unit === 'G')  return +(ml / 3785.41).toFixed(3);
    return ml;
  }
  function _displayToMl(val, unit) {
    const n = Number(val);
    if (unit === 'oz') return Math.round(n * 29.5735);
    if (unit === 'L')  return Math.round(n * 1000);
    if (unit === 'G')  return Math.round(n * 3785.41);
    return Math.round(n);
  }
  $: _waterGoalDisplay = _mlToDisplay(waterGoalMl, waterUnit);
  function _updateWaterGoal(val) { waterGoalMl = _displayToMl(val, waterUnit); }

  let _newContName   = '';
  let _newContVolume = '';
  let _newContUnit   = 'ml';
  function addContainer() {
    const name = _newContName.trim();
    const vol  = Number(_newContVolume);
    if (!name || !vol || vol <= 0) { showError('Enter a valid name and volume'); return; }
    waterContainers = [...waterContainers, { id: Date.now().toString(), name, volumeMl: _displayToMl(vol, _newContUnit) }];
    _newContName = ''; _newContVolume = '';
  }
  function removeContainer(id) { waterContainers = waterContainers.filter(c => c.id !== id); }

  // ── Statistics ─────────────────────────────────────────────────────────────
  let statsChartType = DB.getSetting('statsChartType', 'bar');
  let statsYZero     = DB.getSetting('statsYZero',     true);
  let statsAvgLine   = DB.getSetting('statsAvgLine',   true);
  let statsGoalLine  = DB.getSetting('statsGoalLine',  true);
  let statsTrendLine = DB.getSetting('statsTrendLine', true);

  // ── Goals ──────────────────────────────────────────────────────────────────
  let goalsShowCalories = DB.getSetting('goalsShowCalories', true);
  let goalsShowWeight   = DB.getSetting('goalsShowWeight',   true);

  // ── Units ──────────────────────────────────────────────────────────────────
  let weightUnit  = DB.getSetting('weightUnit',  'lb');
  let heightUnit  = DB.getSetting('heightUnit',  'ft');
  let lengthUnit  = DB.getSetting('lengthUnit',  'in');

  // ── API keys ───────────────────────────────────────────────────────────────
  let usdaApiKey    = DB.getSetting('usdaApiKey',    '');
  let offUsername   = DB.getSetting('offUsername',   '');
  let offPassword   = DB.getSetting('offPassword',   '');
  let usdaEnabled   = DB.getSetting('usdaEnabled',   false);

  const OFF_LANGUAGE_OPTS = [
    ['en','English'],['fr','French'],['de','German'],['es','Spanish'],['it','Italian'],
    ['pt','Portuguese'],['nl','Dutch'],['pl','Polish'],['ru','Russian'],['ja','Japanese'],
    ['zh','Chinese'],['ar','Arabic'],['ko','Korean']
  ];
  const OFF_COUNTRY_OPTS = ['World','United States','United Kingdom','Australia','Canada',
    'France','Germany','Spain','Italy','Mexico','Brazil','Japan','China','India'];
  let offSearchLanguage = DB.getSetting('offSearchLanguage', 'en');
  let offSearchCountry  = DB.getSetting('offSearchCountry',  'World');
  let offUploadCountry  = DB.getSetting('offUploadCountry',  'Auto');

  // ── Mealie ─────────────────────────────────────────────────────────────────
  let mealieEnabled    = DB.getSetting('mealieEnabled',   false);
  let mealieBaseUrl    = DB.getSetting('mealieBaseUrl',   '');
  let mealieApiToken   = DB.getSetting('mealieApiToken',  '');
  let mealieShowToken  = false;
  let mealieTestStatus = ''; // '', 'testing', 'ok', 'fail'
  async function testMealieConnection() {
    if (!mealieBaseUrl || !mealieApiToken) { mealieTestStatus = 'fail'; return; }
    mealieTestStatus = 'testing';
    try {
      const base = mealieBaseUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/api/recipes?perPage=1&page=1`, {
        headers: { Authorization: `Bearer ${mealieApiToken}` }
      });
      mealieTestStatus = res.ok ? 'ok' : 'fail';
    } catch { mealieTestStatus = 'fail'; }
  }

  // ── FitBot AI ──────────────────────────────────────────────────────────────
  let aiEnabledVal       = DB.getSetting('aiEnabled',       false);
  let aiProviderVal      = DB.getSetting('aiProvider',      'claude');
  let aiApiKeyVal        = DB.getSetting('aiApiKey',        '');
  let aiModelVal         = DB.getSetting('aiModel',         '');
  let aiAssistantNameVal = DB.getSetting('aiAssistantName', 'FitBot');
  let aiShowKey          = false;
  // Reset model to provider default when provider changes
  $: if (aiModelVal && !AI_MODELS[aiProviderVal]?.find(m => m.value === aiModelVal)) {
    aiModelVal = AI_DEFAULT_MODELS[aiProviderVal] || '';
  }

  // ── Meal names ─────────────────────────────────────────────────────────────
  let meals = [...(DB.getSetting('mealNames', ['Breakfast','Lunch','Dinner','Snacks']))];

  // ── Categories ─────────────────────────────────────────────────────────────
  let newCategoryName = '';

  function addCategory() {
    if (!newCategoryName.trim()) return;
    const cats = DB.getSetting('foodCategories', []);
    if (!cats.includes(newCategoryName.trim())) {
      foodCategories.set([...cats, newCategoryName.trim()]);
    }
    newCategoryName = '';
  }
  function removeCategory(cat) {
    const cats = DB.getSetting('foodCategories', []);
    foodCategories.set(cats.filter(c => c !== cat));
  }

  // ── Custom nutrients ───────────────────────────────────────────────────────
  let showNutrientSheet = false;
  let newNutrient = { id: '', label: '', unit: 'g' };

  function addCustomNutrient() {
    if (!newNutrient.label.trim()) return;
    const id = 'custom_' + newNutrient.label.toLowerCase().replace(/\s+/g,'_');
    const existing = DB.getSetting('customNutriments', []);
    if (!existing.find(n => n.id === id)) {
      customNutriments.set([...existing, { ...newNutrient, id }]);
    }
    newNutrient = { id:'', label:'', unit:'g' };
    showNutrientSheet = false;
  }
  function removeCustomNutrient(id) {
    const existing = DB.getSetting('customNutriments', []);
    customNutriments.set(existing.filter(n => n.id !== id));
  }

  // ── Nutrient ordering ─────────────────────────────────────────────────────
  $: orderedNutriments = (() => {
    const order = $nutrimentsOrder || [];
    if (!order.length) return NUTRIMENTS;
    const map = new Map(NUTRIMENTS.map(n => [n.id, n]));
    const sorted = order.map(id => map.get(id)).filter(Boolean);
    const rest   = NUTRIMENTS.filter(n => !order.includes(n.id));
    return [...sorted, ...rest];
  })();

  function moveNutrient(id, dir) {
    const order = ($nutrimentsOrder && $nutrimentsOrder.length)
      ? [...$nutrimentsOrder]
      : NUTRIMENTS.map(n => n.id);
    const idx = order.indexOf(id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= order.length) return;
    [order[idx], order[target]] = [order[target], order[idx]];
    nutrimentsOrder.set(order);
  }

  // ── Nutrient visibility ────────────────────────────────────────────────────
  function toggleNutrientVisible(id) {
    let vis = DB.getSetting('visibleNutriments', null);
    if (!vis) vis = NUTRIMENTS.filter(n => n.default).map(n => n.id);
    if (vis.includes(id)) {
      visibleNutriments.set(vis.filter(v => v !== id));
    } else {
      visibleNutriments.set([...vis, id]);
    }
  }
  function isNutrientVisible(id) {
    const vis = $visibleNutriments;
    if (!vis) return NUTRIMENTS.find(n => n.id === id)?.default ?? false;
    return vis.includes(id);
  }

  // ── Body stats ordering ───────────────────────────────────────────────────
  $: orderedBodyStats = (() => {
    const order = $bodyStatsOrder || [];
    if (!order.length) return BODY_STATS;
    const map = new Map(BODY_STATS.map(s => [s.id, s]));
    const sorted = order.map(id => map.get(id)).filter(Boolean);
    const rest   = BODY_STATS.filter(s => !order.includes(s.id));
    return [...sorted, ...rest];
  })();

  function moveBodyStat(id, dir) {
    const order = ($bodyStatsOrder && $bodyStatsOrder.length)
      ? [...$bodyStatsOrder]
      : BODY_STATS.map(s => s.id);
    const idx = order.indexOf(id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= order.length) return;
    [order[idx], order[target]] = [order[target], order[idx]];
    bodyStatsOrder.set(order);
  }

  // ── Body stats visibility ──────────────────────────────────────────────────
  const BODY_STATS = [
    { id:'weight', label:'Weight' }, { id:'neck', label:'Neck' }, { id:'waist', label:'Waist' },
    { id:'hips', label:'Hips' }, { id:'chest', label:'Chest' }, { id:'thighs', label:'Thighs' },
    { id:'biceps', label:'Biceps' }, { id:'calves', label:'Calves' }, { id:'body_fat', label:'Body Fat %' },
  ];
  function isStatVisible(id) {
    const hidden = $hiddenBodyStats || [];
    return !hidden.includes(id);
  }
  function toggleStatVisible(id) {
    const hidden = DB.getSetting('hiddenBodyStats', []);
    if (hidden.includes(id)) {
      hiddenBodyStats.set(hidden.filter(h => h !== id));
    } else {
      hiddenBodyStats.set([...hidden, id]);
    }
  }

  // ── Save helpers ───────────────────────────────────────────────────────────
  function set(key, value) { DB.setSetting(key, value); }

  function autoSaveMeals() {
    const toSave = meals.filter(m => m.trim());
    if (toSave.length) mealNames.set(toSave);
  }

  // ── Backup ─────────────────────────────────────────────────────────────────
  async function exportBackup() {
    try {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nutritrace-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showSuccess('Backup exported');
    } catch(e) { showError('Export failed: ' + e.message); }
  }
  async function importBackup() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await DB.importAll(data);
        showSuccess('Backup restored — reloading...');
        setTimeout(() => location.reload(), 1500);
      } catch(err) { showError('Import failed: ' + err.message); }
    };
    input.click();
  }
  function _compressImage(dataUrl, maxPx = 256, quality = 0.75) {
    return new Promise(resolve => {
      if (!dataUrl || !dataUrl.startsWith('data:image')) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height, 1));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
  async function _compressWaistlineImages(data) {
    for (const food of (data.foodList || [])) {
      if (food.image_url && food.image_url.startsWith('data:image')) {
        food.image_url = await _compressImage(food.image_url);
      }
    }
    for (const item of [...(data.meals || []), ...(data.recipes || [])]) {
      if (item.image_url && item.image_url.startsWith('data:image')) {
        item.image_url = await _compressImage(item.image_url);
      }
    }
  }
  async function importWaistline() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.foodList && !data.diary) {
          showError('Not a valid Waistline export file');
          return;
        }
        await _compressWaistlineImages(data);
        await DB.importWaistline(data);
        showSuccess('Waistline data imported — reloading...');
        setTimeout(() => location.reload(), 1500);
      } catch(err) { showError('Import failed: ' + err.message); }
    };
    input.click();
  }
  async function exportCSV() {
    try {
      // Nutrition imported statically above
      const data = await DB.exportAll();
      let csv = 'Date,Meal,Food,Amount,Unit,Calories,Fat,Carbs,Protein\n';
      (data.diary || []).forEach(day => {
        (day.items || []).forEach(item => {
          const n = Nutrition.calculate(item);
          csv += `${day.date},${item.meal || 0},"${item.name || ''}",${item.portion || 100},${item.unit || 'g'},${Math.round(n.calories || 0)},${(n.fat || 0).toFixed(1)},${(n.carbohydrates || 0).toFixed(1)},${(n.proteins || 0).toFixed(1)}\n`;
        });
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `waistline-diary-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      showSuccess('CSV exported');
    } catch(e) { showError('Export failed: ' + e.message); }
  }
  async function clearAllData() {
    if (!confirm('Delete ALL data? This cannot be undone.')) return;
    await DB.clearAll();
    showSuccess('All data cleared');
    setTimeout(() => location.reload(), 1000);
  }

  // ── Reactive saves ─────────────────────────────────────────────────────────
  $: set('waterGoalMl',       waterGoalMl);
  $: set('waterUnit',         waterUnit);
  $: set('waterContainers',   waterContainers);
  $: set('waterShowInStats',  waterShowInStats);
  $: set('waterShowInDiary',  waterShowInDiary);
  $: set('navStyle',          navStyle);
  $: set('startPage',          startPage);
  $: set('disableAnimations',  disableAnimations);
  $: { sidebarPersistent.set(sidebarPersistentVal); }
  $: set('statsChartType',     statsChartType);
  $: set('statsYZero',         statsYZero);
  $: set('statsAvgLine',       statsAvgLine);
  $: set('statsGoalLine',      statsGoalLine);
  $: set('statsTrendLine',     statsTrendLine);
  $: set('weightUnit',         weightUnit);
  $: set('heightUnit',         heightUnit);
  $: set('lengthUnit',         lengthUnit);
  $: set('usdaApiKey',         usdaApiKey);
  $: set('offUsername',        offUsername);
  $: set('offPassword',        offPassword);
  $: set('usdaEnabled',        usdaEnabled);
  $: set('offSearchLanguage',  offSearchLanguage);
  $: set('offSearchCountry',   offSearchCountry);
  $: set('offUploadCountry',   offUploadCountry);
  $: set('mealieBaseUrl',      mealieBaseUrl);
  $: set('mealieApiToken',     mealieApiToken);
  $: { aiEnabled.set(aiEnabledVal); }
  $: { aiProvider.set(aiProviderVal); }
  $: set('aiApiKey',        aiApiKeyVal);
  $: set('aiModel',         aiModelVal);
  $: set('aiAssistantName', aiAssistantNameVal);
</script>

<div class="page-shell">
  <header class="page-header">
    <h1>Settings</h1>
  </header>

  <div class="page-content settings-content">

    <p class="settings-group-label">Display</p>
    <!-- ── Appearance ──────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('appearance')}>
      <span class="material-symbols-rounded si">contrast</span>
      <span>Appearance</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.appearance}>expand_more</span>
    </button>
    {#if openSections.appearance}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="setting-row">
            <span class="setting-label">Theme</span>
            <div class="select-wrap" style="width:150px">
              <select class="select sel-sm" value={$appearance} on:change={e => applyAppearance(e.target.value)}>
                {#each APPEARANCE_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row" style="align-items:flex-start;flex-direction:column;gap:10px">
            <span class="setting-label">Accent color</span>
            <div class="accent-swatches">
              {#each ACCENT_COLORS as c}
                <button
                  class="accent-swatch"
                  class:active={$accentColor === c.value}
                  style="background:{isDark ? c.dark : c.light}"
                  title={c.label}
                  on:click={() => applyAccentColor(c.value)}
                >
                  {#if $accentColor === c.value}
                    <span class="material-symbols-rounded" style="font-size:16px;color:rgba(255,255,255,0.95);text-shadow:0 1px 3px rgba(0,0,0,0.4)">check</span>
                  {/if}
                </button>
              {/each}
              <!-- Custom color swatch (color wheel) -->
              <button class="accent-swatch accent-swatch-custom" class:active={/^#[0-9a-fA-F]{6}$/.test($accentColor)}
                title="Custom color" style={/^#[0-9a-fA-F]{6}$/.test($accentColor) ? "background:"+$accentColor : ""}
                on:click={openColorSheet}>
                <span class="material-symbols-rounded" style="font-size:16px;color:rgba(255,255,255,0.9);text-shadow:0 0 3px rgba(0,0,0,0.5)">colorize</span>
              </button>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Date format</span>
            <div class="select-wrap" style="width:160px">
              <select class="select sel-sm" value={$dateFormat} on:change={e => dateFormat.set(e.target.value)}>
                <option value="ISO">YYYY-MM-DD</option>
                <option value="US">MM/DD/YYYY</option>
                <option value="EU">DD/MM/YYYY</option>
                <option value="natural">D MMM YYYY</option>
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Time format</span>
            <div class="select-wrap" style="width:160px">
              <select class="select sel-sm" value={$timeFormat} on:change={e => timeFormat.set(e.target.value)}>
                <option value="12h">12-hour (AM/PM)</option>
                <option value="24h">24-hour</option>
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Navigation style</span>
            <div class="select-wrap" style="width:150px">
              <select class="select sel-sm" bind:value={navStyle}>
                {#each NAV_STYLE_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
              </select>
            </div>
          </div>
          {#if navStyle === 'sidebar' || navStyle === 'both'}
            <div class="setting-divider"></div>
            <div class="setting-row">
              <div>
                <span class="setting-label">Persistent sidebar</span>
                <div class="setting-desc">Sidebar stays open and shifts page content instead of overlaying it</div>
              </div>
              <Toggle checked={sidebarPersistentVal} on:change={e => sidebarPersistentVal = e.detail} />
            </div>
          {/if}
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Start page</span>
            <div class="select-wrap" style="width:150px">
              <select class="select sel-sm" bind:value={startPage}>
                {#each START_PAGE_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Disable animations</span>
            <Toggle checked={disableAnimations} on:change={e => { disableAnimations = e.detail; set('disableAnimations', e.detail); }} />
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <div>
              <span class="setting-label">Goal celebrations</span>
              <span class="setting-hint">Pulse animation when hitting calorie or water goal</span>
            </div>
            <Toggle checked={$goalCelebrations} on:change={e => goalCelebrations.set(e.detail)} />
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Diary ───────────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('diary')}>
      <span class="material-symbols-rounded si">book</span>
      <span>Diary</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.diary}>expand_more</span>
    </button>
    {#if openSections.diary}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="setting-row"><span class="setting-label">Show brands</span><Toggle checked={$diaryShowBrands} on:change={e => diaryShowBrands.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show timestamps</span><Toggle checked={$diaryShowTimestamps} on:change={e => diaryShowTimestamps.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show thumbnails</span><Toggle checked={$diaryShowThumbnails} on:change={e => diaryShowThumbnails.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show all nutrients on overview</span><Toggle checked={$diaryShowAllNutrients} on:change={e => diaryShowAllNutrients.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show nutrition units</span><Toggle checked={$diaryShowNutritionUnits} on:change={e => diaryShowNutritionUnits.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show macros summary per meal</span><Toggle checked={$diaryShowMacroSummary} on:change={e => diaryShowMacroSummary.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Prompt for quantity when adding</span><Toggle checked={$diaryPromptQuantity} on:change={e => diaryPromptQuantity.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show total portion size</span><Toggle checked={$diaryShowPortionSize} on:change={e => diaryShowPortionSize.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show nutrition bar (goals progress)</span><Toggle checked={$diaryShowNutritionBar} on:change={e => diaryShowNutritionBar.set(e.detail)} /></div>
        </div>

        <p class="sub-label">Meal names</p>
        <div class="card settings-card">
          {#each meals as _, i}
            <div class="setting-row">
              <span class="setting-label text-3 text-sm" style="min-width:56px">Meal {i+1}</span>
              <input class="input" style="flex:1;height:36px;max-width:220px" placeholder="Meal {i+1}" bind:value={meals[i]} on:blur={autoSaveMeals} />
              {#if meals.length > 1}
                <button class="btn-icon" style="width:32px;height:32px;color:var(--danger);flex-shrink:0"
                  on:click={() => { meals = meals.filter((_,j) => j !== i); autoSaveMeals(); }} title="Remove meal">
                  <span class="material-symbols-rounded" style="font-size:16px">remove</span>
                </button>
              {/if}
            </div>
            <div class="setting-divider"></div>
          {/each}
          <div style="padding:8px 16px 14px">
            <button class="btn btn-secondary" style="height:36px;font-size:13px;width:100%;display:flex;align-items:center;justify-content:center;gap:4px"
              on:click={() => meals = [...meals.filter(m => m.trim()), '']}>
              <span class="material-symbols-rounded" style="font-size:16px">add</span> Add Meal
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Foods ───────────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('foods')}>
      <span class="material-symbols-rounded si">restaurant</span>
      <span>Foods</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.foods}>expand_more</span>
    </button>
    {#if openSections.foods}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="setting-row"><span class="setting-label">Show thumbnails</span><Toggle checked={$foodsShowThumbnails} on:change={e => foodsShowThumbnails.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show category labels</span><Toggle checked={$foodsShowCategories} on:change={e => foodsShowCategories.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show notes</span><Toggle checked={$foodsShowNotes} on:change={e => foodsShowNotes.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show yesterday's meals</span><Toggle checked={$foodsShowYesterdayMeals} on:change={e => foodsShowYesterdayMeals.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Sort order</span>
            <div class="select-wrap" style="width:120px">
              <select class="select sel-sm" value={$foodsSort} on:change={e => foodsSort.set(e.target.value)}>
                <option value="date">By date</option>
                <option value="alpha">Alphabetical</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Water ───────────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('water')}>
      <span class="material-symbols-rounded si">water_drop</span>
      <span>Water</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.water}>expand_more</span>
    </button>
    {#if openSections.water}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <!-- Goal + unit -->
        <div class="card settings-card">
          <div class="setting-row">
            <span class="setting-label">Display unit</span>
            <select class="select sel-sm" bind:value={waterUnit}>
              <option value="ml">Milliliters (ml)</option>
              <option value="oz">Fluid ounces (fl oz)</option>
              <option value="L">Liters (L)</option>
              <option value="G">Gallons (G)</option>
            </select>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <div>
              <span class="setting-label">Daily goal</span>
              <div class="setting-desc">Target intake per day</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <input class="input" type="number" min="0.1" step="0.1"
                value={_waterGoalDisplay}
                on:change={e => _updateWaterGoal(e.target.value)}
                style="width:120px;text-align:right" />
              <span class="text-3 text-sm">{waterUnit}</span>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Show in Diary</span>
            <Toggle checked={waterShowInDiary} on:change={e => waterShowInDiary = e.detail} />
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Show in Statistics</span>
            <Toggle checked={waterShowInStats} on:change={e => waterShowInStats = e.detail} />
          </div>
        </div>

        <!-- Containers list -->
        <p class="section-title" style="margin-top:14px">Water Containers</p>
        <p class="setting-desc" style="padding:0 var(--page-px) 10px">Define bottles, cups, or glasses for one-tap quick-add</p>
        <div class="card settings-card">
          {#each waterContainers as container, i}
            {#if i > 0}<div class="setting-divider"></div>{/if}
            <div class="setting-row">
              <div style="display:flex;align-items:center;gap:10px;min-width:0">
                <span class="material-symbols-rounded" style="color:var(--accent);font-size:20px;flex-shrink:0">water_drop</span>
                <div style="min-width:0">
                  <div class="setting-label">{container.name}</div>
                  <div class="setting-desc">{_mlToDisplay(container.volumeMl, waterUnit)} {waterUnit}</div>
                </div>
              </div>
              <button class="btn-icon" on:click={() => removeContainer(container.id)} title="Remove">
                <span class="material-symbols-rounded" style="font-size:18px;color:var(--text-3)">delete</span>
              </button>
            </div>
          {/each}
          {#if waterContainers.length === 0}
            <p class="text-3 text-sm" style="padding:16px;text-align:center">No containers yet</p>
          {/if}
        </div>

        <!-- Add container form -->
        <div class="card settings-card" style="margin-top:8px">
          <div style="padding:12px 16px 14px">
            <p class="setting-label" style="margin-bottom:10px">Add Container</p>
            <input class="input" type="text" placeholder="Name (e.g. My Water Bottle)"
              bind:value={_newContName} style="margin-bottom:8px" />
            <div style="display:flex;gap:8px;align-items:center">
              <input class="input" type="number" min="0.1" step="0.1" placeholder="Volume"
                bind:value={_newContVolume} style="flex:1" />
              <select class="select sel-sm" bind:value={_newContUnit} style="width:86px">
                <option value="ml">ml</option>
                <option value="oz">fl oz</option>
                <option value="L">L</option>
                <option value="G">G</option>
              </select>
              <button class="btn btn-primary" style="height:42px;white-space:nowrap" on:click={addContainer}>Add</button>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <p class="settings-group-label">Data &amp; Tracking</p>
    <!-- ── Categories ─────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('categories')}>
      <span class="material-symbols-rounded si">tag</span>
      <span>Categories</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.categories}>expand_more</span>
    </button>
    {#if openSections.categories}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="cat-chips-wrap">
            {#each ($foodCategories || []) as cat}
              <div class="chip">
                {cat}
                <button class="chip-x" on:click={() => removeCategory(cat)} aria-label="Remove">
                  <span class="material-symbols-rounded" style="font-size:14px">close</span>
                </button>
              </div>
            {/each}
            {#if ($foodCategories || []).length === 0}
              <span class="text-3 text-sm">No categories yet</span>
            {/if}
          </div>
          <div class="setting-divider"></div>
          <div class="cat-add-row">
            <input class="input" style="flex:1;height:40px" placeholder="New category..."
              bind:value={newCategoryName} on:keydown={e => e.key==='Enter' && addCategory()} />
            <button class="btn btn-secondary" style="height:40px;padding:0 16px" on:click={addCategory}>Add</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Nutrients ───────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('nutrients')}>
      <span class="material-symbols-rounded si">science</span>
      <span>Nutrients</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.nutrients}>expand_more</span>
    </button>
    {#if openSections.nutrients}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <p class="sub-label">Visible nutrients (shown in diary & food editor)</p>
        <div class="card settings-card">
          {#each orderedNutriments as n, i}
            {#if i > 0}<div class="setting-divider"></div>{/if}
            <div class="setting-row">
              <span class="setting-label">{n.label} <span class="text-3 text-sm">({n.unit})</span></span>
              <div style="display:flex;align-items:center;gap:4px">
                <button class="btn-icon" style="width:28px;height:28px" disabled={i===0}
                  on:click={() => moveNutrient(n.id, -1)} title="Move up">
                  <span class="material-symbols-rounded" style="font-size:16px">arrow_upward</span>
                </button>
                <button class="btn-icon" style="width:28px;height:28px" disabled={i===orderedNutriments.length-1}
                  on:click={() => moveNutrient(n.id, 1)} title="Move down">
                  <span class="material-symbols-rounded" style="font-size:16px">arrow_downward</span>
                </button>
                <Toggle checked={isNutrientVisible(n.id)} on:change={() => toggleNutrientVisible(n.id)} />
              </div>
            </div>
          {/each}
        </div>

        <p class="sub-label">Custom nutrients</p>
        <div class="card settings-card">
          {#each ($customNutriments || []) as cn, i}
            {#if i > 0}<div class="setting-divider"></div>{/if}
            <div class="setting-row">
              <span class="setting-label">{cn.label} ({cn.unit})</span>
              <button class="btn-icon" style="width:32px;height:32px;color:var(--danger)"
                on:click={() => removeCustomNutrient(cn.id)}>
                <span class="material-symbols-rounded" style="font-size:18px">delete</span>
              </button>
            </div>
          {/each}
          {#if ($customNutriments || []).length === 0}
            <div class="setting-row"><span class="text-3 text-sm">No custom nutrients</span></div>
            <div class="setting-divider"></div>
          {/if}
          <div style="padding:8px 16px 14px">
            <button class="btn btn-secondary" style="height:36px;font-size:13px"
              on:click={() => showNutrientSheet = true}>
              <span class="material-symbols-rounded" style="font-size:18px">add</span>
              Add custom nutrient
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Body Stats ──────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('bodyStats')}>
      <span class="material-symbols-rounded si">monitor_weight</span>
      <span>Body Stats</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.bodyStats}>expand_more</span>
    </button>
    {#if openSections.bodyStats}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          {#each orderedBodyStats as stat, i}
            {#if i > 0}<div class="setting-divider"></div>{/if}
            <div class="setting-row">
              <span class="setting-label">{stat.label}</span>
              <div style="display:flex;align-items:center;gap:4px">
                <button class="btn-icon" style="width:28px;height:28px" disabled={i===0}
                  on:click={() => moveBodyStat(stat.id, -1)} title="Move up">
                  <span class="material-symbols-rounded" style="font-size:16px">arrow_upward</span>
                </button>
                <button class="btn-icon" style="width:28px;height:28px" disabled={i===orderedBodyStats.length-1}
                  on:click={() => moveBodyStat(stat.id, 1)} title="Move down">
                  <span class="material-symbols-rounded" style="font-size:16px">arrow_downward</span>
                </button>
                <Toggle checked={isStatVisible(stat.id)} on:change={() => toggleStatVisible(stat.id)} />
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- ── Statistics ──────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('statistics')}>
      <span class="material-symbols-rounded si">bar_chart</span>
      <span>Statistics</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.statistics}>expand_more</span>
    </button>
    {#if openSections.statistics}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="setting-row">
            <span class="setting-label">Default chart type</span>
            <div class="select-wrap" style="width:110px">
              <select class="select sel-sm" bind:value={statsChartType}>
                <option value="bar">Bar</option>
                <option value="line">Line</option>
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Y-axis starts at zero</span><Toggle checked={statsYZero} on:change={e => { statsYZero = e.detail; set('statsYZero', e.detail); }} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show average line</span><Toggle checked={statsAvgLine} on:change={e => { statsAvgLine = e.detail; set('statsAvgLine', e.detail); }} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show goal line</span><Toggle checked={statsGoalLine} on:change={e => { statsGoalLine = e.detail; set('statsGoalLine', e.detail); }} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show trend line</span><Toggle checked={statsTrendLine} on:change={e => { statsTrendLine = e.detail; set('statsTrendLine', e.detail); }} /></div>
        </div>
      </div>
    {/if}

    <!-- ── Units ───────────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('units')}>
      <span class="material-symbols-rounded si">straighten</span>
      <span>Units</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.units}>expand_more</span>
    </button>
    {#if openSections.units}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="setting-row">
            <span class="setting-label">Energy</span>
            <div class="select-wrap" style="width:160px">
              <select class="select sel-sm" value={$energyUnit} on:change={e => energyUnit.set(e.target.value)}>
                {#each ENERGY_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Weight</span>
            <div class="select-wrap" style="width:100px">
              <select class="select sel-sm" bind:value={weightUnit}>
                <option value="kg">kg</option>
                <option value="lb">lbs</option>
                <option value="st">st</option>
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Height</span>
            <div class="select-wrap" style="width:100px">
              <select class="select sel-sm" bind:value={heightUnit}>
                <option value="cm">cm</option>
                <option value="ft">ft / in</option>
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Circumference</span>
            <div class="select-wrap" style="width:100px">
              <select class="select sel-sm" bind:value={lengthUnit}>
                <option value="in">in</option>
                <option value="cm">cm</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <p class="settings-group-label">Integrations</p>
    <!-- ── Integration ────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('integration')}>
      <span class="material-symbols-rounded si">integration_instructions</span>
      <span>Integration</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.integration}>expand_more</span>
    </button>
    {#if openSections.integration}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="setting-row"><span class="setting-label">Barcode scan beep</span><Toggle checked={$barcodeBeep} on:change={e => barcodeBeep.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Barcode scan flashlight</span><Toggle checked={$barcodeFlashlight} on:change={e => barcodeFlashlight.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Crop photos before upload</span><Toggle checked={$cropPhotos} on:change={e => cropPhotos.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Enable USDA search</span><Toggle checked={usdaEnabled} on:change={e => { usdaEnabled = e.detail; set('usdaEnabled', e.detail); }} /></div>
        </div>
        <p class="sub-label">Open Food Facts</p>
        <div class="card settings-card">
          <div class="setting-row">
            <span class="setting-label">Search language</span>
            <div class="select-wrap" style="width:120px">
              <select class="select sel-sm" bind:value={offSearchLanguage}>
                {#each OFF_LANGUAGE_OPTS as [v,l]}<option value={v}>{l}</option>{/each}
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Search country</span>
            <div class="select-wrap" style="width:150px">
              <select class="select sel-sm" bind:value={offSearchCountry}>
                {#each OFF_COUNTRY_OPTS as c}<option value={c}>{c}</option>{/each}
              </select>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Upload country</span>
            <div class="select-wrap" style="width:150px">
              <select class="select sel-sm" bind:value={offUploadCountry}>
                <option value="Auto">Auto</option>
                {#each OFF_COUNTRY_OPTS.filter(c => c !== 'World') as c}<option value={c}>{c}</option>{/each}
              </select>
            </div>
          </div>
        </div>
        <p class="sub-label">Mealie</p>
        <div class="card settings-card">
          <div class="setting-row">
            <div>
              <span class="setting-label">Enable Mealie</span>
              <div class="setting-desc">Import recipes from your self-hosted Mealie instance</div>
            </div>
            <Toggle checked={mealieEnabled} on:change={e => { mealieEnabled = e.detail; set('mealieEnabled', e.detail); }} />
          </div>
          {#if mealieEnabled}
            <div class="setting-divider"></div>
            <div class="setting-row">
              <span class="setting-label">Base URL</span>
              <input class="input" style="width:200px;text-align:right"
                placeholder="https://mealie.example.com"
                bind:value={mealieBaseUrl} />
            </div>
            <div class="setting-divider"></div>
            <div class="setting-row">
              <span class="setting-label">API Token</span>
              <div style="display:flex;align-items:center;gap:6px">
                {#if mealieShowToken}
                  <input class="input" style="width:160px;text-align:right"
                    type="text" placeholder="Bearer token"
                    bind:value={mealieApiToken} />
                {:else}
                  <input class="input" style="width:160px;text-align:right"
                    type="password" placeholder="Bearer token"
                    bind:value={mealieApiToken} />
                {/if}
                <button class="btn-icon" on:click={() => mealieShowToken = !mealieShowToken}
                  title={mealieShowToken ? 'Hide' : 'Show'}>
                  <span class="material-symbols-rounded" style="font-size:18px">{mealieShowToken ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>
            <div class="setting-divider"></div>
            <div class="setting-row">
              <span class="setting-label">Connection</span>
              <div style="display:flex;align-items:center;gap:8px">
                {#if mealieTestStatus === 'ok'}
                  <span style="color:var(--macro-carbs);font-size:13px;display:flex;align-items:center;gap:4px">
                    <span class="material-symbols-rounded" style="font-size:16px">check_circle</span>Connected
                  </span>
                {:else if mealieTestStatus === 'fail'}
                  <span style="color:#FF7070;font-size:13px;display:flex;align-items:center;gap:4px">
                    <span class="material-symbols-rounded" style="font-size:16px">error</span>Failed
                  </span>
                {:else if mealieTestStatus === 'testing'}
                  <span style="color:var(--text-2);font-size:13px">Testing…</span>
                {/if}
                <button class="btn btn-secondary" style="padding:6px 14px;font-size:13px;height:32px"
                  on:click={testMealieConnection}
                  disabled={!mealieBaseUrl || !mealieApiToken || mealieTestStatus === 'testing'}>
                  Test
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- ── FitBot AI ─────────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('ai')}>
      <span class="material-symbols-rounded si">smart_toy</span>
      <span>FitBot AI</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.ai}>expand_more</span>
    </button>
    {#if openSections.ai}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="setting-row">
            <div>
              <span class="setting-label">Enable FitBot AI</span>
              <div class="setting-desc">Adds a floating chat button to all pages</div>
            </div>
            <Toggle checked={aiEnabledVal} on:change={e => aiEnabledVal = e.detail} />
          </div>

          {#if aiEnabledVal}
            <div class="setting-divider"></div>
            <div class="setting-row">
              <span class="setting-label">Assistant name</span>
              <input class="input" style="width:130px;text-align:right"
                placeholder="FitBot"
                bind:value={aiAssistantNameVal} />
            </div>

            <div class="setting-divider"></div>
            <div class="setting-row">
              <span class="setting-label">AI Provider</span>
              <div class="select-wrap" style="width:170px">
                <select class="select sel-sm" bind:value={aiProviderVal}>
                  {#each AI_PROVIDERS as p}
                    <option value={p.value}>{p.label}</option>
                  {/each}
                </select>
              </div>
            </div>

            <div class="setting-divider"></div>
            <div class="setting-row">
              <span class="setting-label">Model</span>
              <div class="select-wrap" style="width:200px">
                <select class="select sel-sm" bind:value={aiModelVal}>
                  {#each (AI_MODELS[aiProviderVal] || []) as m}
                    <option value={m.value}>{m.label}</option>
                  {/each}
                </select>
              </div>
            </div>

            <div class="setting-divider"></div>
            <div class="form-group" style="padding:10px 16px">
              <label class="form-label" for="ai-api-key">API Key</label>
              <div style="display:flex;gap:8px;align-items:center">
                {#if aiShowKey}
                  <input id="ai-api-key" class="input" type="text"
                    placeholder="Paste your API key here"
                    bind:value={aiApiKeyVal} autocomplete="off" style="flex:1" />
                {:else}
                  <input id="ai-api-key" class="input" type="password"
                    placeholder="Paste your API key here"
                    bind:value={aiApiKeyVal} autocomplete="off" style="flex:1" />
                {/if}
                <button class="btn-icon" on:click={() => aiShowKey = !aiShowKey} title={aiShowKey ? 'Hide' : 'Show'}>
                  <span class="material-symbols-rounded">{aiShowKey ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
              <div class="setting-desc" style="margin-top:6px">
                {#if aiProviderVal === 'claude'}
                  Get your key at <a href="https://console.anthropic.com" target="_blank" rel="noopener" class="about-link">console.anthropic.com</a>
                {:else if aiProviderVal === 'openai'}
                  Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" class="about-link">platform.openai.com</a>
                {:else if aiProviderVal === 'gemini'}
                  Get your key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" class="about-link">aistudio.google.com</a>
                {/if}
                Your key is stored locally on your device only.
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- ── API Keys ─────────────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('api')}>
      <span class="material-symbols-rounded si">key</span>
      <span>API Keys</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.api}>expand_more</span>
    </button>
    {#if openSections.api}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card" style="gap:12px;padding:16px">
          <div class="form-group">
            <label class="form-label" for="usda-key">USDA FoodData Central API Key</label>
            <input id="usda-key" class="input" placeholder="Get free key at api.nal.usda.gov" bind:value={usdaApiKey} />
          </div>
          <div class="form-group">
            <label class="form-label" for="off-user">Open Food Facts Username</label>
            <input id="off-user" class="input" placeholder="OFF account username" bind:value={offUsername} />
          </div>
          <div class="form-group">
            <label class="form-label" for="off-pass">Open Food Facts Password</label>
            <input id="off-pass" class="input" type="password" placeholder="OFF account password" bind:value={offPassword} />
          </div>
        </div>
      </div>
    {/if}

    <p class="settings-group-label">App</p>
    <!-- ── Backup & Restore ────────────────────────────────────────────────── -->
    <button class="section-toggle" on:click={() => toggleSection('backup')}>
      <span class="material-symbols-rounded si">backup</span>
      <span>Backup & Restore</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.backup}>expand_more</span>
    </button>
    {#if openSections.backup}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <button class="setting-row setting-action" on:click={exportBackup}>
            <span class="material-symbols-rounded si" style="color:var(--accent)">download</span>
            <span class="setting-label">Export JSON backup</span>
            <span class="material-symbols-rounded text-3" style="font-size:18px">chevron_right</span>
          </button>
          <div class="setting-divider"></div>
          <button class="setting-row setting-action" on:click={importBackup}>
            <span class="material-symbols-rounded si" style="color:var(--accent)">upload</span>
            <span class="setting-label">Import JSON backup</span>
            <span class="material-symbols-rounded text-3" style="font-size:18px">chevron_right</span>
          </button>
          <div class="setting-divider"></div>
          <button class="setting-row setting-action" on:click={importWaistline}>
            <span class="material-symbols-rounded si" style="color:var(--accent)">swap_horiz</span>
            <div>
              <span class="setting-label">Import from Waistline</span>
              <div class="setting-desc">Import foods &amp; diary from Waistline Android app</div>
            </div>
            <span class="material-symbols-rounded text-3" style="font-size:18px">chevron_right</span>
          </button>
          <div class="setting-divider"></div>
          <button class="setting-row setting-action" on:click={exportCSV}>
            <span class="material-symbols-rounded si" style="color:var(--info)">table_chart</span>
            <span class="setting-label">Export diary as CSV</span>
            <span class="material-symbols-rounded text-3" style="font-size:18px">chevron_right</span>
          </button>
          <div class="setting-divider"></div>
          <button class="setting-row setting-action danger" on:click={clearAllData}>
            <span class="material-symbols-rounded si" style="color:var(--danger)">delete_forever</span>
            <span class="setting-label" style="color:var(--danger)">Clear all data</span>
            <span class="material-symbols-rounded" style="font-size:18px;color:var(--danger)">chevron_right</span>
          </button>
        </div>
      </div>
    {/if}

    <!-- About -->
    <button class="section-toggle" on:click={() => toggleSection('about')}>
      <span class="material-symbols-rounded si">info</span>
      <span>About</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.about}>expand_more</span>
    </button>
    {#if openSections.about}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="about-hero">
            <img src="/icons/logo.png" alt="NutriTrace" class="about-icon" />
            <div>
              <div class="about-name">NutriTrace</div>
              <div class="about-version text-3 text-sm">Version 0.8.0 Alpha</div>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="about-desc">
            A privacy-first nutrition &amp; body stats tracker that runs entirely in your browser.
            No account required — your data stays on your device.
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">storage</span>
            <span>All data stored locally (IndexedDB)</span>
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">wifi_off</span>
            <span>Works offline as a PWA</span>
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">barcode_scanner</span>
            <span>Barcode lookup via Open Food Facts</span>
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">lock</span>
            <span>No tracking, no ads, no servers</span>
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">restaurant_menu</span>
            <span>Food data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener" class="about-link">Open Food Facts</a></span>
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">fork_right</span>
            <span>Based on the original <a href="https://github.com/davidhealey/waistline" target="_blank" rel="noopener" class="about-link">Waistline Android app</a> by David Healey</span>
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">favorite</span>
            <span>With inspiration from <a href="https://github.com/CodeWithCJ/SparkyFitness" target="_blank" rel="noopener" class="about-link">SparkyFitness</a> by CodeWithCJ</span>
          </div>
        </div>
      </div>
    {/if}

    <div style="height:24px"></div>
  </div>
</div>

<!-- Custom color picker sheet -->
<Sheet bind:open={showColorSheet} title="Custom Color">
  <div class="cp-body">
    <!-- Live preview -->
    <div class="cp-preview" style="background:{customColorHex}">
      <span class="cp-preview-hex">{customHexInput}</span>
    </div>
    <!-- Hue slider -->
    <div class="cp-slider-group">
      <label class="form-label">Hue</label>
      <div class="cp-slider-wrap">
        <input type="range" class="cp-slider cp-hue" min="0" max="360"
          bind:value={cpHue} on:input={cpUpdateFromSliders} />
      </div>
    </div>
    <!-- Saturation slider -->
    <div class="cp-slider-group">
      <label class="form-label">Saturation</label>
      <div class="cp-slider-wrap">
        <input type="range" class="cp-slider cp-sat" min="0" max="100"
          bind:value={cpSat} on:input={cpUpdateFromSliders}
          style="--cp-sat-lo:hsl({cpHue},0%,{cpLgt}%);--cp-sat-hi:hsl({cpHue},100%,{cpLgt}%)" />
      </div>
    </div>
    <!-- Lightness slider -->
    <div class="cp-slider-group">
      <label class="form-label">Lightness</label>
      <div class="cp-slider-wrap">
        <input type="range" class="cp-slider cp-lgt" min="0" max="100"
          bind:value={cpLgt} on:input={cpUpdateFromSliders}
          style="--cp-lgt-lo:hsl({cpHue},{cpSat}%,0%);--cp-lgt-mid:hsl({cpHue},{cpSat}%,50%);--cp-lgt-hi:hsl({cpHue},{cpSat}%,100%)" />
      </div>
    </div>
    <!-- RGB inputs -->
    <div class="cp-slider-group">
      <label class="form-label">RGB</label>
      <div class="cp-rgb-row">
        <div class="cp-rgb-field">
          <input class="input cp-rgb-input" type="number" min="0" max="255" bind:value={cpR} on:input={cpUpdateFromRgb} />
          <span class="cp-rgb-label">R</span>
        </div>
        <div class="cp-rgb-field">
          <input class="input cp-rgb-input" type="number" min="0" max="255" bind:value={cpG} on:input={cpUpdateFromRgb} />
          <span class="cp-rgb-label">G</span>
        </div>
        <div class="cp-rgb-field">
          <input class="input cp-rgb-input" type="number" min="0" max="255" bind:value={cpB} on:input={cpUpdateFromRgb} />
          <span class="cp-rgb-label">B</span>
        </div>
      </div>
    </div>
    <!-- Hex input -->
    <div class="cp-slider-group">
      <label class="form-label">Hex code</label>
      <div class="cp-hex-row">
        <span class="cp-hex-dot" style="background:{/^#[0-9a-fA-F]{6}$/.test(customHexInput) ? customHexInput : '#ccc'}"></span>
        <input class="input" type="text" placeholder="#rrggbb" maxlength="7"
          style="font-family:monospace;letter-spacing:0.05em;flex:1"
          bind:value={customHexInput}
          on:input={cpUpdateFromHex}
          on:keydown={e => e.key === 'Enter' && applyCustomColor()} />
      </div>
    </div>
    <button class="btn btn-primary w-full" style="height:44px;margin-top:4px" on:click={applyCustomColor}>Apply Color</button>
  </div>
</Sheet>

<!-- Custom nutrient sheet -->
<Sheet bind:open={showNutrientSheet} title="Add Custom Nutrient">
  <div style="display:flex;flex-direction:column;gap:16px;padding-top:8px">
    <div class="form-group">
      <label class="form-label" for="cn-label">Nutrient name</label>
      <input id="cn-label" class="input" placeholder="e.g. Omega-3" bind:value={newNutrient.label} />
    </div>
    <div class="form-group">
      <label class="form-label" for="cn-unit">Unit</label>
      <div class="select-wrap">
        <select id="cn-unit" class="select" bind:value={newNutrient.unit}>
          <option value="g">g</option>
          <option value="mg">mg</option>
          <option value="µg">µg</option>
          <option value="IU">IU</option>
          <option value="kcal">kcal</option>
          <option value="kJ">kJ</option>
          <option value="%">%</option>
        </select>
      </div>
    </div>
    <button class="btn btn-primary w-full" on:click={addCustomNutrient}>Add Nutrient</button>
  </div>
</Sheet>

<style>
  .settings-content { display: flex; flex-direction: column; gap: 0; }

  /* Section toggle button */
  .section-toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 14px var(--page-px);
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text-1);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    transition: background var(--dur-fast);
  }
  .section-toggle:hover  { background: var(--surface-2); }
  .section-toggle:active { background: var(--surface-3); }
  .si {
    font-size: 18px;
    color: var(--accent);
    flex-shrink: 0;
    width: 30px; height: 30px;
    background: var(--accent-dim);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
  }
  .settings-group-label {
    padding: 20px var(--page-px) 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .accent-swatches { display: flex; gap: 10px; flex-wrap: wrap; }
  .accent-swatch {
    width: 38px; height: 38px; border-radius: 50%;
    border: 3px solid transparent; cursor: pointer;
    transition: transform 0.15s, border-color 0.15s;
    outline: none;
    display: flex; align-items: center; justify-content: center;
  }
  .accent-swatch.active {
    border-color: var(--text-1);
    transform: scale(1.15);
  }
  .accent-swatch:hover { transform: scale(1.08); }
  .accent-swatch-custom {
    display: flex; align-items: center; justify-content: center;
    background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
    position: relative; overflow: hidden; cursor: pointer;
  }
  /* Custom color picker sheet content */
  .cp-body { display: flex; flex-direction: column; gap: 18px; padding-top: 4px; }
  .cp-preview {
    height: 70px; border-radius: var(--radius-lg);
    display: flex; align-items: flex-end; justify-content: flex-end;
    padding: 8px 12px;
    border: 1px solid rgba(255,255,255,0.12);
  }
  .cp-preview-hex {
    font-size: 11px; font-family: monospace; letter-spacing: 0.06em;
    color: rgba(255,255,255,0.75); text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    font-weight: 600;
  }
  .cp-slider-group { display: flex; flex-direction: column; gap: 8px; }
  .cp-slider-wrap { padding: 4px 0; }
  .cp-slider {
    -webkit-appearance: none; appearance: none;
    width: 100%; height: 16px; border-radius: 8px; outline: none; cursor: pointer;
    border: 1px solid rgba(128,128,128,0.2);
  }
  .cp-hue {
    background: linear-gradient(to right,
      hsl(0,100%,50%), hsl(30,100%,50%), hsl(60,100%,50%), hsl(90,100%,50%),
      hsl(120,100%,50%), hsl(150,100%,50%), hsl(180,100%,50%), hsl(210,100%,50%),
      hsl(240,100%,50%), hsl(270,100%,50%), hsl(300,100%,50%), hsl(330,100%,50%), hsl(360,100%,50%));
  }
  .cp-sat { background: linear-gradient(to right, var(--cp-sat-lo), var(--cp-sat-hi)); }
  .cp-lgt { background: linear-gradient(to right, var(--cp-lgt-lo), var(--cp-lgt-mid), var(--cp-lgt-hi)); }
  .cp-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 24px; height: 24px; border-radius: 50%;
    background: var(--surface-1); border: 2px solid var(--text-1);
    box-shadow: 0 2px 6px rgba(0,0,0,0.35); cursor: pointer;
  }
  .cp-slider::-moz-range-thumb {
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--surface-1); border: 2px solid var(--text-1);
    box-shadow: 0 2px 6px rgba(0,0,0,0.35); cursor: pointer;
  }
  .cp-rgb-row { display: flex; gap: 10px; }
  .cp-rgb-field { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
  .cp-rgb-input { height: 42px; text-align: center; font-size: 16px; font-weight: 600; padding: 0 4px; }
  .cp-rgb-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: var(--text-3); text-transform: uppercase; }
  .cp-hex-row { display: flex; align-items: center; gap: 10px; }
  .cp-hex-dot {
    width: 28px; height: 28px; border-radius: 50%;
    border: 2px solid var(--border); flex-shrink: 0;
  }
  .chevron { font-size: 20px; color: var(--text-3); margin-left: auto; transition: transform var(--dur-base) var(--ease-out); }
  .chevron.rotated { transform: rotate(180deg); }

  .section-body { padding: 12px var(--page-px); display: flex; flex-direction: column; gap: 10px; }

  .settings-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .setting-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    min-height: 50px;
  }
  .setting-label { font-size: 14px; font-weight: 500; flex: 1; }
  .setting-desc  { font-size: 12px; color: var(--text-3); margin-top: 2px; font-weight: 400; }
  .setting-divider { height: 1px; background: var(--border); margin: 0 16px; }
  .setting-action {
    width: 100%; background: none; border: none; cursor: pointer;
    color: var(--text-1); text-align: left;
    transition: background var(--dur-fast);
  }
  .setting-action:active { background: var(--surface-2); }

  .sub-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
    padding: 4px 2px 2px;
  }
  .sel-sm { height: 36px; font-size: 13px; }

  .cat-chips-wrap {
    display: flex; flex-wrap: wrap; gap: 8px;
    padding: 14px 16px 8px;
  }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 99px; font-size: 13px; font-weight: 500; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-1); }
  .chip-x { background: none; border: none; cursor: pointer; display: flex; align-items: center; color: var(--text-3); padding: 0; }
  .chip-x:hover { color: var(--danger); }
  .cat-add-row { display: flex; gap: 8px; padding: 8px 16px 14px; }

  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }
  .about-hero {
    display: flex; align-items: center; gap: 16px; padding: 16px;
  }
  .about-icon { width: 56px; height: 56px; border-radius: 12px; }
  .about-name { font-size: 18px; font-weight: 700; color: var(--text-1); }
  .about-version { margin-top: 2px; }
  .about-desc {
    font-size: 13px; color: var(--text-2); line-height: 1.5;
    padding: 12px 16px;
  }
  .about-row {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; font-size: 14px; color: var(--text-1);
  }
  .about-feat-icon { font-size: 20px; color: var(--accent); flex-shrink: 0; }
  .about-link { color: var(--accent); text-decoration: underline; }
  .about-link:hover { opacity: 0.8; }
</style>
