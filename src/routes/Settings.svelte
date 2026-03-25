<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { slide } from 'svelte/transition';
  import Toggle from '../components/settings/Toggle.svelte';
  import Sheet  from '../components/ui/Sheet.svelte';
  import Dialog from '../components/ui/Dialog.svelte';
  import { showSuccess, showError } from '../stores/toast.js';
  import { applyAppearance, applyAccentColor } from '../stores/settings.js';
  import { AI_PROVIDERS, AI_MODELS, AI_DEFAULT_MODELS } from '../lib/aiChat.js';
  import { catName as _catName, catDisplay as _catDisplay } from '../stores/settings.js';
  import 'emoji-picker-element';
  import {
    appearance, accentColor, energyUnit, mealNames,
    diaryShowBrands, diaryShowTimestamps, diaryShowThumbnails, diaryShowAllNutrients,
    diaryShowNutritionUnits, diaryShowMacroSummary, diaryPromptQuantity, diaryShowPortionSize,
    diaryShowNutritionBar, diaryTotalsMode,
    foodsShowCategories, foodsShowLabels, foodsShowNotes, foodsShowThumbnails, foodsShowYesterdayMeals, foodsSort,
    barcodeBeep, barcodeFlashlight, cropPhotos,
    foodCategories, visibleNutriments, nutrimentsOrder, customNutriments,
    bodyStatsOrder, hiddenBodyStats,
    dateFormat, timeFormat,
    sidebarPersistent, goalCelebrations,
    aiEnabled, aiProvider, aiApiKey, aiModel, aiAssistantName,
  } from '../stores/settings.js';
  import { DB } from '../lib/db.js';
  import { NtApi } from '../lib/api.js';
  import { NUTRIMENTS, Nutrition } from '../lib/nutrition.js';
  import { currentUser, userMgmtActive, loadAuthState, logout } from '../stores/auth.js';
  import { push } from 'svelte-spa-router';
  // ── Collapsible section state ──────────────────────────────────────────────
  $: isDark = $appearance === 'dark' || ($appearance === 'system' && (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  let openSections = { appearance: true, regional: false, diary: false, foods: false, water: false,
                       categories: false, nutrients: false, bodyStats: false, statistics: false,
                       units: false, connectedServices: false, ai: false,
                       backup: false, email: false, users: false, about: false };

  function toggleSection(key) {
    openSections = { ...openSections, [key]: !openSections[key] };
  }

  // ── Settings search ────────────────────────────────────────────────────────
  let settingsSearch = '';
  $: settingsQuery = settingsSearch.toLowerCase().trim();

  const SECTION_KEYWORDS = {
    appearance:        ['appearance','theme','dark','light','accent','color','navigation','sidebar','persistent','start page','animations','celebrations','reduce motion'],
    regional:          ['regional','date format','time format','locale','date','time','12h','24h'],
    diary:             ['diary','brands','timestamps','thumbnails','nutrients','nutrition units','macros','macro summary','prompt quantity','portion size','nutrition bar','goals progress','meal names','meals'],
    foods:             ['foods','thumbnails','category','notes','yesterday meals','sort order','sort','barcode','scan','beep','flashlight','crop photos'],
    water:             ['water','display unit','daily goal','containers','bottle','cup','glass'],
    categories:        ['categories','food categories','tags','labels'],
    nutrients:         ['nutrients','nutriments','custom nutrients','vitamins','minerals'],
    bodyStats:         ['body stats','body','weight','measurements','stats'],
    statistics:        ['statistics','chart','y-axis','average','goal line','trend','stats'],
    goals:             ['goals','target','calorie goal'],
    units:             ['units','energy unit','weight unit','height','circumference','imperial','metric'],
    connectedServices: ['connected services','usda','open food facts','mealie','recipe','search language','country','api key','credentials','username','password'],
    ai:                ['ai','fitbot','assistant','provider','model','api key','artificial intelligence','chat'],
    backup:            ['backup','export','import','restore','waistline','csv','clear data','json','full backup','images','zip'],
    email:             ['email','smtp','mail','password reset','invites','notifications'],
    users:             ['users','user management','accounts','login','password','admin','register','profile'],
    about:             ['about','version','nutritrace'],
  };

  function sectionVisible(query, key) {
    if (!query) return true;
    return (SECTION_KEYWORDS[key] || []).some(kw => kw.includes(query));
  }

  function sectionOpen(sections, query, key) {
    return sections[key] || (!!query && sectionVisible(query, key));
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
      const res = await fetch('/api/mealie/proxy', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: mealieBaseUrl,
          token:   mealieApiToken,
          path:    '/api/recipes?perPage=1&page=1',
        }),
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
  let newCategoryName  = '';
  let newCategoryLabel = '';
  let showEmojiPicker  = false;
  let emojiPickerX     = 0;
  let emojiPickerY     = 0;

  function openEmojiPicker(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    // Position below the button; flip up if it would overflow viewport bottom
    const pickerH = 400; // approximate picker height
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < pickerH) {
      emojiPickerY = rect.top - pickerH - 6;
    } else {
      emojiPickerY = rect.bottom + 6;
    }
    emojiPickerX = rect.left;
    showEmojiPicker = !showEmojiPicker;
  }

  function onEmojiPick(e) {
    newCategoryLabel = e.detail.unicode;
    showEmojiPicker  = false;
  }

  function clickOutside(node, fn) {
    function handle(e) { if (!node.contains(e.target)) fn(); }
    document.addEventListener('pointerdown', handle, true);
    return { destroy() { document.removeEventListener('pointerdown', handle, true); } };
  }

  function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const cats = get(foodCategories) || [];
    if (cats.some(c => _catName(c) === name)) return;
    const label = newCategoryLabel.trim();
    foodCategories.set([...cats, label ? { name, label } : name]);
    newCategoryName = '';
    newCategoryLabel = '';
  }
  function removeCategory(cat) {
    const n = _catName(cat);
    foodCategories.set((get(foodCategories) || []).filter(c => _catName(c) !== n));
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

  // Drag-to-reorder for nutrients
  let nutDragFrom = null, nutDragOver = null, nutDragDelta = 0, nutRowHeights = [];
  function onNutDragDown(e, i) {
    const list = e.currentTarget.closest('.drag-list');
    const rows = [...list.querySelectorAll('.drag-row')];
    nutRowHeights = rows.map(r => r.getBoundingClientRect().height);
    nutDragFrom = i; nutDragOver = i; nutDragDelta = 0;
    list.setPointerCapture(e.pointerId);
    list._dragStartY = e.clientY;
  }
  function onNutDragMove(e) {
    if (nutDragFrom === null) return;
    nutDragDelta = e.clientY - e.currentTarget._dragStartY;
    const rows = [...e.currentTarget.querySelectorAll('.drag-row')];
    const y = e.clientY;
    let best = nutDragOver;
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx].getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) { best = idx; break; }
    }
    nutDragOver = best;
  }
  function onNutDragUp() {
    if (nutDragFrom !== null && nutDragOver !== null && nutDragFrom !== nutDragOver) {
      const order = ($nutrimentsOrder && $nutrimentsOrder.length)
        ? [...$nutrimentsOrder] : orderedNutriments.map(n => n.id);
      const [removed] = order.splice(nutDragFrom, 1);
      order.splice(nutDragOver, 0, removed);
      nutrimentsOrder.set(order);
    }
    nutDragFrom = null; nutDragOver = null; nutDragDelta = 0; nutRowHeights = [];
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

  // Drag-to-reorder for body stats
  let statDragFrom = null, statDragOver = null, statDragDelta = 0, statRowHeights = [];
  function onStatDragDown(e, i) {
    const list = e.currentTarget.closest('.drag-list');
    const rows = [...list.querySelectorAll('.drag-row')];
    statRowHeights = rows.map(r => r.getBoundingClientRect().height);
    statDragFrom = i; statDragOver = i; statDragDelta = 0;
    list.setPointerCapture(e.pointerId);
    list._dragStartY = e.clientY;
  }
  function onStatDragMove(e) {
    if (statDragFrom === null) return;
    statDragDelta = e.clientY - e.currentTarget._dragStartY;
    const rows = [...e.currentTarget.querySelectorAll('.drag-row')];
    const y = e.clientY;
    let best = statDragOver;
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx].getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) { best = idx; break; }
    }
    statDragOver = best;
  }
  function onStatDragUp() {
    if (statDragFrom !== null && statDragOver !== null && statDragFrom !== statDragOver) {
      const order = ($bodyStatsOrder && $bodyStatsOrder.length)
        ? [...$bodyStatsOrder] : orderedBodyStats.map(s => s.id);
      const [removed] = order.splice(statDragFrom, 1);
      order.splice(statDragOver, 0, removed);
      bodyStatsOrder.set(order);
    }
    statDragFrom = null; statDragOver = null; statDragDelta = 0; statRowHeights = [];
  }

  // Compute translateY for a non-dragging row given current drag state
  function dragShift(i, from, over, heights) {
    if (from === null || over === null || i === from || from === over) return 0;
    const h = heights[from] || 52;
    if (from < over && i > from && i <= over) return -h;  // dragging down: items above shift up
    if (from > over && i >= over && i < from) return h;   // dragging up: items below shift down
    return 0;
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
      const [foodList, meals, recipes, diary] = await Promise.all([
        NtApi.getFoods(),
        NtApi.getMeals(),
        NtApi.getRecipes(),
        NtApi.getAllDiary(),
      ]);
      const data = { foodList, meals, recipes, diary, settings: DB.getAllSettings(), exportedAt: new Date().toISOString() };
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
        // Upload any base64 images to the server and replace with server URLs
        async function migrateImg(item) {
          if (!item.imgUrl || !item.imgUrl.startsWith('data:')) return item;
          try {
            const blob = await fetch(item.imgUrl).then(r => r.blob());
            const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
            const url = await NtApi.uploadImage(file);
            return { ...item, imgUrl: url };
          } catch { return { ...item, imgUrl: '' }; }
        }
        const migrateAll = arr => Promise.all((arr || []).map(migrateImg));
        const [foodList, meals, recipes] = await Promise.all([
          migrateAll(data.foodList),
          migrateAll(data.meals),
          migrateAll(data.recipes),
        ]);
        await NtApi.post('/api/data/import', { ...data, foodList, meals, recipes });
        if (data.settings && typeof data.settings === 'object') {
          for (const [key, value] of Object.entries(data.settings)) DB.setSetting(key, value);
        }

        // Merge imported categories into the category list
        const importedCats = [...new Set((foodList || []).map(f => (f.categories && f.categories[0]) || f.category).filter(Boolean))];
        if (importedCats.length) {
          const existing = get(foodCategories) || [];
          const existingNames = new Set(existing.map(c => _catName(c)));
          const toAdd = importedCats.filter(n => !existingNames.has(n));
          if (toAdd.length) foodCategories.set([...existing, ...toAdd]);
        }

        showSuccess('Backup restored — reloading...');
        setTimeout(() => location.reload(), 1500);
      } catch(err) { showError('Import failed: ' + err.message); }
    };
    input.click();
  }

  async function importWaistline() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        if (!raw.foodList && !raw.diary) { showError('Not a valid Waistline export file'); return; }

        const NUTR_MAP = { 'Added Sugars':'added-sugars','vitamin-b1':'b1','vitamin-b2':'b2','vitamin-b6':'b6','vitamin-b9':'b9','vitamin-b12':'b12','vitamin-pp':'b3' };
        const mapNutrition = n => { const o={}; for(const[k,v] of Object.entries(n||{})) o[NUTR_MAP[k]||k]=parseFloat(v)||0; return o; };
        const cleanImg = u => (u && u !== 'undefined') ? u : null;

        // Upload base64 images first so diary items (which embed full food objects) are small
        async function migrateImg(imgUrl) {
          if (!imgUrl || !imgUrl.startsWith('data:')) return imgUrl;
          try {
            const blob = await fetch(imgUrl).then(r => r.blob());
            const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
            return await NtApi.uploadImage(file);
          } catch { return ''; }
        }

        // Map foods — drop original image_url (base64) after migrating to server URL
        const foods = await Promise.all((raw.foodList||[]).map(async f => {
          const { image_url, ...rest } = f;
          return { ...rest, imgUrl: await migrateImg(cleanImg(image_url)), nutrition: mapNutrition(f.nutrition) };
        }));
        const foodMap = Object.fromEntries((raw.foodList||[]).map((f,i) => [f.id, foods[i]]));

        const resolveItems = items => (items||[]).map(item => {
          const food = foodMap[item.id]; if(!food) return null;
          return { ...food, portion: parseFloat(item.portion)||food.portion||100, quantity: parseFloat(item.quantity)||1 };
        }).filter(Boolean);

        const meals = await Promise.all((raw.meals||[]).map(async m => {
          const { image_url, ...rest } = m;
          return { ...rest, imgUrl: await migrateImg(cleanImg(image_url)), items: resolveItems(m.items), nutrition: {} };
        }));
        const recipes = await Promise.all((raw.recipes||[]).map(async r => {
          const { image_url, ...rest } = r;
          return { ...rest, imgUrl: await migrateImg(cleanImg(image_url)), items: resolveItems(r.items), nutrition: mapNutrition(r.nutrition) };
        }));

        await NtApi.post('/api/data/import', { foodList: foods, meals, recipes });

        // Merge imported categories into the category list
        const importedCats = [...new Set(foods.map(f => (f.categories && f.categories[0]) || f.category).filter(Boolean))];
        if (importedCats.length) {
          const existing = get(foodCategories) || [];
          const existingNames = new Set(existing.map(c => _catName(c)));
          const toAdd = importedCats.filter(n => !existingNames.has(n));
          if (toAdd.length) foodCategories.set([...existing, ...toAdd]);
        }

        showSuccess('Waistline data imported — reloading...');
        setTimeout(() => location.reload(), 1500);
      } catch(err) { showError('Import failed: ' + err.message); }
    };
    input.click();
  }

  async function exportCSV() {
    try {
      const diary = await NtApi.getAllDiary();
      let csv = 'Date,Meal,Food,Amount,Unit,Calories,Fat,Carbs,Protein\n';
      diary.forEach(day => {
        (day.items || []).forEach(item => {
          const n = Nutrition.calculate(item);
          csv += `${day.date},${item.meal||0},"${item.name||''}",${item.portion||100},${item.unit||'g'},${Math.round(n.calories||0)},${(n.fat||0).toFixed(1)},${(n.carbohydrates||0).toFixed(1)},${(n.proteins||0).toFixed(1)}\n`;
        });
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nutritrace-diary-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      showSuccess('CSV exported');
    } catch(e) { showError('Export failed: ' + e.message); }
  }

  // ── Full Backup ────────────────────────────────────────────────────────────
  let fullBackups        = [];
  let fullBackupBusy     = false;
  let restoreTarget      = null;  // filename pending restore confirm
  let deleteTarget       = null;  // filename pending delete confirm
  let showRestoreDialog  = false;
  let showDeleteBkDialog = false;

  async function loadFullBackups() {
    try {
      const res = await fetch('/api/full-backup', { credentials: 'include' });
      if (res.ok) fullBackups = await res.json();
    } catch {}
  }

  async function createFullBackup() {
    fullBackupBusy = true;
    try {
      const res  = await fetch('/api/full-backup', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) { showError(data.error || 'Backup failed'); return; }
      showSuccess('Full backup created');
      await loadFullBackups();
    } catch { showError('Backup failed'); }
    finally   { fullBackupBusy = false; }
  }

  function downloadFullBackup(filename) {
    const a = document.createElement('a');
    a.href = `/api/full-backup/${encodeURIComponent(filename)}/download`;
    a.download = filename;
    a.click();
  }

  async function confirmRestoreFullBackup() {
    if (!restoreTarget) return;
    showRestoreDialog = false;
    const filename = restoreTarget;
    restoreTarget = null;
    fullBackupBusy = true;
    try {
      const res  = await fetch(`/api/full-backup/${encodeURIComponent(filename)}/restore`, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) { showError(data.error || 'Restore failed'); return; }
      showSuccess('Restore complete — reloading…');
      setTimeout(() => location.reload(), 1500);
    } catch { showError('Restore failed'); }
    finally   { fullBackupBusy = false; }
  }

  async function confirmDeleteFullBackup() {
    if (!deleteTarget) return;
    showDeleteBkDialog = false;
    const filename = deleteTarget;
    deleteTarget = null;
    try {
      const res = await fetch(`/api/full-backup/${encodeURIComponent(filename)}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { showSuccess('Backup deleted'); await loadFullBackups(); }
      else showError('Delete failed');
    } catch { showError('Delete failed'); }
  }

  function fmtBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Load backup list when section opens (admin only)
  $: if (openSections.backup && $currentUser?.role === 'admin') loadFullBackups();

  // ── Email / SMTP ───────────────────────────────────────────────────────────
  let smtpHost   = '';
  let smtpPort   = '587';
  let smtpSecure = false;
  let smtpUser   = '';
  let smtpPass   = '';
  let smtpFrom   = '';
  let smtpTestStatus = ''; // '', 'testing', 'ok', 'fail'

  async function loadSmtpConfig() {
    try {
      const res  = await fetch('/api/app-config', { credentials: 'include' });
      if (!res.ok) return;
      const cfg  = await res.json();
      smtpHost   = cfg.smtp_host   || '';
      smtpPort   = cfg.smtp_port   || '587';
      smtpSecure = cfg.smtp_secure === 'true';
      smtpUser   = cfg.smtp_user   || '';
      smtpPass   = cfg.smtp_pass   || '';
      smtpFrom   = cfg.smtp_from   || '';
    } catch {}
  }

  async function saveSmtpField(key, value) {
    await fetch('/api/app-config', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: String(value) }),
    }).catch(() => {});
  }

  let smtpSaving = false;
  let smtpSaved  = false;
  async function saveSmtp() {
    smtpSaving = true;
    try {
      await saveSmtpField('smtp_host',   smtpHost);
      await saveSmtpField('smtp_port',   smtpPort);
      await saveSmtpField('smtp_secure', String(smtpSecure));
      await saveSmtpField('smtp_user',   smtpUser);
      await saveSmtpField('smtp_pass',   smtpPass);
      await saveSmtpField('smtp_from',   smtpFrom);
      smtpSaved = true;
      setTimeout(() => smtpSaved = false, 2000);
    } finally {
      smtpSaving = false;
    }
  }

  async function testSmtp() {
    smtpTestStatus = 'testing';
    try {
      const res = await fetch('/api/app-config/test-email', { method: 'POST', credentials: 'include' });
      smtpTestStatus = res.ok ? 'ok' : 'fail';
    } catch { smtpTestStatus = 'fail'; }
  }

  $: if (openSections.email && $currentUser?.role === 'admin') loadSmtpConfig();

  // ── Invite ─────────────────────────────────────────────────────────────────
  let inviteEmail  = '';
  let inviteRole   = 'user';
  let inviteLoading = false;
  let inviteResult = null; // { inviteUrl, sent }

  async function createInvite() {
    inviteLoading = true;
    inviteResult  = null;
    try {
      const res  = await fetch('/api/auth/invite', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() || undefined, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) { showError(data.error || 'Failed to create invite'); return; }
      inviteResult = data;
      inviteEmail  = '';
    } catch { showError('Could not create invite'); }
    inviteLoading = false;
  }

  // ── User Management ────────────────────────────────────────────────────────
  let umUsers        = [];
  let umLoading      = false;
  let showAddUser    = false;
  let newUsername    = '';
  let newPassword    = '';
  let newFullName    = '';
  let newRole        = 'user';
  let umError        = '';
  let showDisableUmDialog = false;

  // Enable user management from Settings
  let showEnableUm    = false;
  let enableAdminUser = '';
  let enableAdminPass = '';
  let enableAdminConf = '';
  let enableAdminName = '';
  let enableUmError   = '';
  let enableUmLoading = false;

  async function enableUserManagement() {
    enableUmError = '';
    if (!enableAdminUser.trim()) { enableUmError = 'Username is required'; return; }
    if (enableAdminPass.length < 6) { enableUmError = 'Password must be at least 6 characters'; return; }
    if (enableAdminPass !== enableAdminConf) { enableUmError = 'Passwords do not match'; return; }
    enableUmLoading = true;
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username:  enableAdminUser.trim(),
          password:  enableAdminPass,
          full_name: enableAdminName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { enableUmError = data.error || 'Registration failed'; enableUmLoading = false; return; }
      localStorage.setItem('wl:userId', data.user.id);
      await loadAuthState();
      showEnableUm = false;
      enableAdminUser = ''; enableAdminPass = ''; enableAdminConf = ''; enableAdminName = '';
      await loadUsers();
      showSuccess('User management enabled');
    } catch(e) { enableUmError = 'Could not connect to server'; }
    enableUmLoading = false;
  }

  async function loadUsers() {
    try {
      umUsers = await NtApi.get('/api/auth/users');
    } catch(e) { umError = e.message; }
  }

  async function addUser() {
    umError = '';
    if (!newUsername.trim() || !newPassword.trim()) { umError = 'Username and password required'; return; }
    umLoading = true;
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, full_name: newFullName.trim() || undefined, role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { umError = data.error || 'Failed to add user'; } else {
        newUsername = ''; newPassword = ''; newFullName = ''; newRole = 'user';
        showAddUser = false;
        await loadUsers();
        showSuccess('User added');
      }
    } catch(e) { umError = e.message; }
    umLoading = false;
  }

  async function deleteUser(id) {
    try {
      await NtApi.del(`/api/auth/users/${id}`);
      await loadUsers();
      showSuccess('User deleted');
    } catch(e) { showError(e.message); }
  }

  async function disableUserManagement() {
    try {
      await NtApi.del('/api/auth/management');
      localStorage.removeItem('wl:userId');
      await loadAuthState();
      showDisableUmDialog = false;
      showSuccess('User management disabled');
      await loadUsers();
    } catch(e) { showError(e.message); }
  }

  // Load users when section opens
  $: if (openSections.users && $userMgmtActive) loadUsers();

  let showClearDialog = false;
  async function clearAllData() {
    try {
      await NtApi.del('/api/data');
      // Clear all settings except app-level flags that survive a data wipe
      const preserve = new Set(['wl_setupComplete', 'wl:userId']);
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('wl_') && !preserve.has(k)) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
      showSuccess('All data cleared');
      setTimeout(() => location.reload(), 1000);
    } catch(e) { showError('Clear failed: ' + e.message); }
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
  $: set('usdaEnabled',        usdaEnabled);
  $: set('offSearchLanguage',  offSearchLanguage);
  $: set('offSearchCountry',   offSearchCountry);
  $: set('offUploadCountry',   offUploadCountry);
  $: { aiEnabled.set(aiEnabledVal); }
  $: { aiProvider.set(aiProviderVal); }
  $: set('aiModel',         aiModelVal);
  $: set('aiAssistantName', aiAssistantNameVal);

  // ── Explicit credential saves ──────────────────────────────────────────────
  let usdaSaved   = false;
  let offSaved    = false;
  let mealieSaved = false;
  let aiKeySaved  = false;

  function saveUsda()   { set('usdaApiKey', usdaApiKey);   usdaSaved = true;   setTimeout(() => usdaSaved   = false, 2000); }
  function saveOff()    { set('offUsername', offUsername); set('offPassword', offPassword); offSaved = true; setTimeout(() => offSaved = false, 2000); }
  function saveMealie() { set('mealieBaseUrl', mealieBaseUrl); set('mealieApiToken', mealieApiToken); mealieSaved = true; setTimeout(() => mealieSaved = false, 2000); }
  function saveAiKey()  { set('aiApiKey', aiApiKeyVal);    aiKeySaved = true;  setTimeout(() => aiKeySaved  = false, 2000); }
</script>

<div class="page-shell">
  <header class="page-header">
    <h1>Settings</h1>
  </header>

  <div class="settings-search-bar">
    <span class="material-symbols-rounded settings-search-icon">search</span>
    <input class="settings-search-input" type="search" placeholder="Search settings…"
      bind:value={settingsSearch} />
    {#if settingsSearch}
      <button class="settings-search-clear btn-icon" on:click={() => settingsSearch = ''}>
        <span class="material-symbols-rounded" style="font-size:18px">close</span>
      </button>
    {/if}
  </div>

  <div class="page-content settings-content">

    <p class="settings-group-label">Display</p>
    <!-- ── Appearance ──────────────────────────────────────────────────────── -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'appearance')} on:click={() => toggleSection('appearance')}>
      <span class="material-symbols-rounded si">contrast</span>
      <span>Appearance</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.appearance}>expand_more</span>
    </button>

    {#if sectionOpen(openSections, settingsQuery, 'appearance') && sectionVisible(settingsQuery, 'appearance')}
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
            <span class="setting-label">Reduce motion</span>
            <Toggle checked={disableAnimations} on:change={e => { disableAnimations = e.detail; set('disableAnimations', e.detail); }} />
          </div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <div>
              <span class="setting-label">Celebrate goals</span>
              <span class="setting-hint">Pulse animation when hitting your calorie or water goal</span>
            </div>
            <Toggle checked={$goalCelebrations} on:change={e => goalCelebrations.set(e.detail)} />
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Regional ────────────────────────────────────────────────────────── -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'regional')} on:click={() => toggleSection('regional')}>
      <span class="material-symbols-rounded si">language</span>
      <span>Regional</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.regional}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'regional') && sectionVisible(settingsQuery, 'regional')}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
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
        </div>
      </div>
    {/if}

    <!-- ── Diary ───────────────────────────────────────────────────────────── -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'diary')} on:click={() => toggleSection('diary')}>
      <span class="material-symbols-rounded si">book</span>
      <span>Diary</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.diary}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'diary') && sectionVisible(settingsQuery, 'diary')}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="setting-row"><span class="setting-label">Show brand names</span><Toggle checked={$diaryShowBrands} on:change={e => diaryShowBrands.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show timestamps</span><Toggle checked={$diaryShowTimestamps} on:change={e => diaryShowTimestamps.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show thumbnails</span><Toggle checked={$diaryShowThumbnails} on:change={e => diaryShowThumbnails.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show all nutrients</span><Toggle checked={$diaryShowAllNutrients} on:change={e => diaryShowAllNutrients.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show nutrition units</span><Toggle checked={$diaryShowNutritionUnits} on:change={e => diaryShowNutritionUnits.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show macro summary per meal</span><Toggle checked={$diaryShowMacroSummary} on:change={e => diaryShowMacroSummary.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Ask for quantity when adding</span><Toggle checked={$diaryPromptQuantity} on:change={e => diaryPromptQuantity.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show portion size</span><Toggle checked={$diaryShowPortionSize} on:change={e => diaryShowPortionSize.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show daily goals progress bar</span><Toggle checked={$diaryShowNutritionBar} on:change={e => diaryShowNutritionBar.set(e.detail)} /></div>
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
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'foods')} on:click={() => toggleSection('foods')}>
      <span class="material-symbols-rounded si">restaurant</span>
      <span>Foods</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.foods}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'foods') && sectionVisible(settingsQuery, 'foods')}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="setting-row"><span class="setting-label">Show thumbnails</span><Toggle checked={$foodsShowThumbnails} on:change={e => foodsShowThumbnails.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show categories</span><Toggle checked={$foodsShowCategories} on:change={e => foodsShowCategories.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show category labels</span><Toggle checked={$foodsShowLabels} on:change={e => foodsShowLabels.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show notes</span><Toggle checked={$foodsShowNotes} on:change={e => foodsShowNotes.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Show yesterday's meals</span><Toggle checked={$foodsShowYesterdayMeals} on:change={e => foodsShowYesterdayMeals.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row">
            <span class="setting-label">Sort order</span>
            <div class="select-wrap" style="width:140px">
              <select class="select sel-sm" value={$foodsSort} on:change={e => foodsSort.set(e.target.value)}>
                <option value="date">Recently added</option>
                <option value="alpha">Alphabetical</option>
              </select>
            </div>
          </div>
        </div>
        <p class="sub-label">Camera &amp; Scanning</p>
        <div class="card settings-card">
          <div class="setting-row"><span class="setting-label">Beep on successful scan</span><Toggle checked={$barcodeBeep} on:change={e => barcodeBeep.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Use flashlight while scanning</span><Toggle checked={$barcodeFlashlight} on:change={e => barcodeFlashlight.set(e.detail)} /></div>
          <div class="setting-divider"></div>
          <div class="setting-row"><span class="setting-label">Crop photos on upload</span><Toggle checked={$cropPhotos} on:change={e => cropPhotos.set(e.detail)} /></div>
        </div>
      </div>
    {/if}

    <!-- ── Water ───────────────────────────────────────────────────────────── -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'water')} on:click={() => toggleSection('water')}>
      <span class="material-symbols-rounded si">water_drop</span>
      <span>Water</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.water}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'water') && sectionVisible(settingsQuery, 'water')}
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
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'categories')} on:click={() => toggleSection('categories')}>
      <span class="material-symbols-rounded si">tag</span>
      <span>Categories</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.categories}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'categories') && sectionVisible(settingsQuery, 'categories')}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="cat-chips-wrap">
            {#each ($foodCategories || []) as cat}
              <div class="chip">
                {_catDisplay(cat)}
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
            <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;position:relative">
              <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);text-align:center">Label</span>
              <button class="input emoji-btn" title="Pick an emoji label"
                on:click={openEmojiPicker}>
                {newCategoryLabel || '🏷️'}
              </button>
              {#if showEmojiPicker}
                <div class="emoji-picker-wrap"
                  style="left:{emojiPickerX}px;top:{emojiPickerY}px"
                  use:clickOutside={() => showEmojiPicker = false}>
                  <emoji-picker on:emoji-click={onEmojiPick}></emoji-picker>
                </div>
              {/if}
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;flex:1">
              <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)">Category name *</span>
              <input class="input" style="height:40px" placeholder="e.g. Dairy, Proteins…"
                bind:value={newCategoryName} on:keydown={e => e.key==='Enter' && addCategory()} />
            </div>
            <button class="btn btn-secondary" style="height:40px;padding:0 16px;align-self:flex-end" on:click={addCategory}>Add</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Nutrients ───────────────────────────────────────────────────────── -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'nutrients')} on:click={() => toggleSection('nutrients')}>
      <span class="material-symbols-rounded si">science</span>
      <span>Nutrients</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.nutrients}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'nutrients') && sectionVisible(settingsQuery, 'nutrients')}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <p class="sub-label">Visible nutrients (shown in diary & food editor)</p>
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="card settings-card drag-list"
          on:pointermove={onNutDragMove}
          on:pointerup={onNutDragUp}
          on:pointercancel={onNutDragUp}>
          {#each orderedNutriments as n, i}
            {#if i > 0}<div class="setting-divider"></div>{/if}
            <div class="setting-row drag-row"
              class:dragging={nutDragFrom === i}
              style={nutDragFrom !== null
                ? nutDragFrom === i
                  ? `transform:scale(1.04) translateY(${nutDragDelta}px);transition:box-shadow 200ms ease,opacity 200ms ease`
                  : `transform:translateY(${dragShift(i,nutDragFrom,nutDragOver,nutRowHeights)}px)`
                : ''}>
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <span class="drag-handle material-symbols-rounded" on:pointerdown={e => onNutDragDown(e, i)}>drag_indicator</span>
              <span class="setting-label">{n.label} <span class="text-3 text-sm">({n.unit})</span></span>
              <Toggle checked={isNutrientVisible(n.id)} on:change={() => toggleNutrientVisible(n.id)} />
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
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'bodyStats')} on:click={() => toggleSection('bodyStats')}>
      <span class="material-symbols-rounded si">monitor_weight</span>
      <span>Body Stats</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.bodyStats}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'bodyStats') && sectionVisible(settingsQuery, 'bodyStats')}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="card settings-card drag-list"
          on:pointermove={onStatDragMove}
          on:pointerup={onStatDragUp}
          on:pointercancel={onStatDragUp}>
          {#each orderedBodyStats as stat, i}
            {#if i > 0}<div class="setting-divider"></div>{/if}
            <div class="setting-row drag-row"
              class:dragging={statDragFrom === i}
              style={statDragFrom !== null
                ? statDragFrom === i
                  ? `transform:scale(1.04) translateY(${statDragDelta}px);transition:box-shadow 200ms ease,opacity 200ms ease`
                  : `transform:translateY(${dragShift(i,statDragFrom,statDragOver,statRowHeights)}px)`
                : ''}>
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <span class="drag-handle material-symbols-rounded" on:pointerdown={e => onStatDragDown(e, i)}>drag_indicator</span>
              <span class="setting-label">{stat.label}</span>
              <Toggle checked={isStatVisible(stat.id)} on:change={() => toggleStatVisible(stat.id)} />
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- ── Statistics ──────────────────────────────────────────────────────── -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'statistics')} on:click={() => toggleSection('statistics')}>
      <span class="material-symbols-rounded si">bar_chart</span>
      <span>Statistics</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.statistics}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'statistics') && sectionVisible(settingsQuery, 'statistics')}
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
          <div class="setting-row"><span class="setting-label">Lock Y-axis to zero</span><Toggle checked={statsYZero} on:change={e => { statsYZero = e.detail; set('statsYZero', e.detail); }} /></div>
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
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'units')} on:click={() => toggleSection('units')}>
      <span class="material-symbols-rounded si">straighten</span>
      <span>Units</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.units}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'units') && sectionVisible(settingsQuery, 'units')}
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

    <p class="settings-group-label">Connected Services</p>
    <!-- ── Connected Services ─────────────────────────────────────────────── -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'connectedServices')} on:click={() => toggleSection('connectedServices')}>
      <span class="material-symbols-rounded si">hub</span>
      <span>Connected Services</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.connectedServices}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'connectedServices') && sectionVisible(settingsQuery, 'connectedServices')}
      <div class="section-body" transition:slide={{ duration: 180 }}>

        <p class="sub-label">USDA FoodData Central</p>
        <div class="card settings-card">
          <div class="setting-row">
            <div>
              <span class="setting-label">Enable USDA FoodData</span>
              <div class="setting-desc">Search the USDA nutrition database when adding foods</div>
            </div>
            <Toggle checked={usdaEnabled} on:change={e => { usdaEnabled = e.detail; set('usdaEnabled', e.detail); }} />
          </div>
          {#if usdaEnabled}
            <div class="setting-divider"></div>
            <div class="form-group" style="padding:10px 16px 14px">
              <label class="form-label" for="usda-key">API Key</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input id="usda-key" class="input" style="flex:1" placeholder="Get a free key at api.nal.usda.gov" bind:value={usdaApiKey} />
                <button class="btn btn-primary" style="height:40px;font-size:13px;white-space:nowrap" on:click={saveUsda}>
                  {#if usdaSaved}<span class="material-symbols-rounded" style="font-size:16px">check</span>{:else}Save{/if}
                </button>
              </div>
            </div>
          {/if}
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
          <div class="setting-divider"></div>
          <div class="form-group" style="padding:10px 16px 14px">
            <label class="form-label" for="off-user">Account username</label>
            <input id="off-user" class="input" style="margin-bottom:8px" placeholder="Optional — required to contribute edits" bind:value={offUsername} />
            <label class="form-label" for="off-pass">Account password</label>
            <input id="off-pass" class="input" type="password" style="margin-bottom:10px" placeholder="OFF account password" bind:value={offPassword} />
            <button class="btn btn-primary" style="height:36px;font-size:13px;align-self:flex-start" on:click={saveOff}>
              {#if offSaved}<span class="material-symbols-rounded" style="font-size:16px">check</span> Saved{:else}Save{/if}
            </button>
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
                <button class="btn btn-primary" style="padding:6px 14px;font-size:13px;height:32px"
                  on:click={saveMealie}>
                  {#if mealieSaved}<span class="material-symbols-rounded" style="font-size:16px">check</span>{:else}Save{/if}
                </button>
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
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'ai')} on:click={() => toggleSection('ai')}>
      <span class="material-symbols-rounded si">smart_toy</span>
      <span>FitBot AI</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.ai}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'ai') && sectionVisible(settingsQuery, 'ai')}
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
              <span class="setting-label">Provider</span>
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
                <button class="btn btn-primary" style="height:40px;font-size:13px;white-space:nowrap" on:click={saveAiKey}>
                  {#if aiKeySaved}<span class="material-symbols-rounded" style="font-size:16px">check</span>{:else}Save{/if}
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
                Your key is stored securely on the server.
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <p class="settings-group-label">App</p>
    <!-- ── Backup & Restore ────────────────────────────────────────────────── -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'backup')} on:click={() => toggleSection('backup')}>
      <span class="material-symbols-rounded si">backup</span>
      <span>Backup & Restore</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.backup}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'backup') && sectionVisible(settingsQuery, 'backup')}
      <div class="section-body" transition:slide={{ duration: 180 }}>

        <!-- Full backup (admin only) -->
        {#if $currentUser?.role === 'admin'}
        <p class="sub-label">Full Backup</p>
        <div class="card settings-card">
          <div style="padding:12px 16px 4px">
            <p class="setting-desc" style="margin:0 0 12px">A complete snapshot of everything — all user data, diary, foods, meals, recipes, settings, and uploaded images. Saved on the server and available to download or restore at any time.</p>
            <button class="btn btn-primary" style="height:36px;font-size:13px;margin-bottom:14px"
              on:click={createFullBackup} disabled={fullBackupBusy}>
              {#if fullBackupBusy}
                <span class="material-symbols-rounded spin" style="font-size:16px">autorenew</span> Working…
              {:else}
                <span class="material-symbols-rounded" style="font-size:16px">add_circle</span> Create Backup
              {/if}
            </button>
          </div>

          {#if fullBackups.length > 0}
            <div class="setting-divider"></div>
            {#each fullBackups as bk, i}
              {#if i > 0}<div class="setting-divider"></div>{/if}
              <div class="backup-row">
                <div class="backup-meta">
                  <span class="backup-name">{bk.filename.replace('nutritrace-backup-','').replace('.zip','').replace(/T|-/g, s => s === 'T' ? ' ' : ':').slice(0,16)}</span>
                  <span class="backup-size">{fmtBytes(bk.size)}</span>
                </div>
                <div class="backup-actions">
                  <button class="btn btn-secondary" style="height:30px;font-size:12px;padding:0 10px"
                    on:click={() => downloadFullBackup(bk.filename)} title="Download">
                    <span class="material-symbols-rounded" style="font-size:15px">download</span>
                  </button>
                  <button class="btn btn-secondary" style="height:30px;font-size:12px;padding:0 10px"
                    on:click={() => { restoreTarget = bk.filename; showRestoreDialog = true; }} title="Restore" disabled={fullBackupBusy}>
                    <span class="material-symbols-rounded" style="font-size:15px">restore</span>
                  </button>
                  <button class="btn-icon" style="color:var(--danger)"
                    on:click={() => { deleteTarget = bk.filename; showDeleteBkDialog = true; }} title="Delete">
                    <span class="material-symbols-rounded" style="font-size:18px">delete</span>
                  </button>
                </div>
              </div>
            {/each}
          {:else}
            <div class="setting-divider"></div>
            <p style="padding:12px 16px;font-size:13px;color:var(--text-3);margin:0">No backups yet</p>
          {/if}
        </div>
        {/if}

        <!-- Portable JSON export/import -->
        <p class="sub-label">Portable Export</p>
        <div class="card settings-card">
          <button class="setting-row setting-action" on:click={exportBackup}>
            <span class="material-symbols-rounded si" style="color:var(--accent)">download</span>
            <div>
              <span class="setting-label">Export JSON</span>
              <div class="setting-desc">Downloads your foods, meals, recipes, diary, and settings as a JSON file. Good for moving data to another device or app.</div>
            </div>
            <span class="material-symbols-rounded text-3" style="font-size:18px;flex-shrink:0">chevron_right</span>
          </button>
          <div class="setting-divider"></div>
          <button class="setting-row setting-action" on:click={importBackup}>
            <span class="material-symbols-rounded si" style="color:var(--accent)">upload</span>
            <div>
              <span class="setting-label">Import JSON</span>
              <div class="setting-desc">Restores from a previously exported JSON file. Merges with existing data — does not erase what's already here. Note: server-hosted images will need to be re-uploaded separately.</div>
            </div>
            <span class="material-symbols-rounded text-3" style="font-size:18px;flex-shrink:0">chevron_right</span>
          </button>
        </div>

        <!-- Other tools -->
        <p class="sub-label">Other</p>
        <div class="card settings-card">
          <button class="setting-row setting-action" on:click={importWaistline}>
            <span class="material-symbols-rounded si" style="color:var(--accent)">swap_horiz</span>
            <div>
              <span class="setting-label">Import from Waistline</span>
              <div class="setting-desc">Import foods, meals &amp; recipes from the Waistline Android app</div>
            </div>
            <span class="material-symbols-rounded text-3" style="font-size:18px;flex-shrink:0">chevron_right</span>
          </button>
          <div class="setting-divider"></div>
          <button class="setting-row setting-action" on:click={exportCSV}>
            <span class="material-symbols-rounded si" style="color:var(--info)">table_chart</span>
            <div>
              <span class="setting-label">Export diary as CSV</span>
              <div class="setting-desc">Downloads your full diary history as a spreadsheet. Useful for analysis in Excel or Google Sheets.</div>
            </div>
            <span class="material-symbols-rounded text-3" style="font-size:18px;flex-shrink:0">chevron_right</span>
          </button>
          <div class="setting-divider"></div>
          <button class="setting-row setting-action danger" on:click={() => showClearDialog = true}>
            <span class="material-symbols-rounded si" style="color:var(--danger)">delete_forever</span>
            <div>
              <span class="setting-label" style="color:var(--danger)">Clear all data</span>
              <div class="setting-desc">Permanently deletes all diary entries, foods, meals, and recipes. This cannot be undone.</div>
            </div>
            <span class="material-symbols-rounded" style="font-size:18px;color:var(--danger);flex-shrink:0">chevron_right</span>
          </button>
        </div>

      </div>
    {/if}


    <!-- ── Email ────────────────────────────────────────────────────────────── -->
    {#if $currentUser?.role === 'admin'}
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'email')} on:click={() => toggleSection('email')}>
      <span class="material-symbols-rounded si">mail</span>
      <span>Email</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.email}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'email') && sectionVisible(settingsQuery, 'email')}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <p class="sub-label" style="padding-bottom:4px">Used for password resets and user invites</p>
        <div class="card settings-card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
          <div class="form-group">
            <label class="form-label">SMTP Host</label>
            <input class="input" type="text" placeholder="smtp.gmail.com"
              bind:value={smtpHost} />
          </div>
          <div style="display:flex;gap:10px">
            <div class="form-group" style="flex:1">
              <label class="form-label">Port</label>
              <input class="input" type="number" placeholder="587"
                bind:value={smtpPort} />
            </div>
            <div class="form-group" style="display:flex;flex-direction:column;gap:6px;justify-content:flex-end;padding-bottom:2px">
              <label class="form-label">TLS</label>
              <Toggle checked={smtpSecure} on:change={e => smtpSecure = e.detail} />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Username</label>
            <input class="input" type="text" autocomplete="off" placeholder="SMTP username or email"
              bind:value={smtpUser} />
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input class="input" type="password" autocomplete="new-password" placeholder="SMTP password or app password"
              bind:value={smtpPass} />
          </div>
          <div class="form-group">
            <label class="form-label">From address</label>
            <input class="input" type="email" placeholder='NutriTrace <noreply@example.com>'
              bind:value={smtpFrom} />
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn btn-primary" style="height:36px;font-size:13px"
              on:click={saveSmtp} disabled={smtpSaving}>
              {#if smtpSaved}
                <span class="material-symbols-rounded" style="font-size:16px">check</span> Saved
              {:else}
                {smtpSaving ? 'Saving…' : 'Save'}
              {/if}
            </button>
            <button class="btn btn-secondary" style="height:36px;font-size:13px"
              on:click={testSmtp} disabled={!smtpHost || smtpTestStatus === 'testing'}>
              {smtpTestStatus === 'testing' ? 'Testing…' : 'Test'}
            </button>
            {#if smtpTestStatus === 'ok'}
              <span style="color:var(--macro-carbs);font-size:13px;display:flex;align-items:center;gap:4px">
                <span class="material-symbols-rounded" style="font-size:16px">check_circle</span>Connected
              </span>
            {:else if smtpTestStatus === 'fail'}
              <span style="color:var(--danger);font-size:13px;display:flex;align-items:center;gap:4px">
                <span class="material-symbols-rounded" style="font-size:16px">error</span>Failed
              </span>
            {/if}
          </div>
        </div>
      </div>
    {/if}
    {/if}

    <!-- ── User Management ──────────────────────────────────────────────────── -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'users')} on:click={() => toggleSection('users')}>
      <span class="material-symbols-rounded si">group</span>
      <span>User Management</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.users}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'users') && sectionVisible(settingsQuery, 'users')}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          {#if $userMgmtActive}
            <!-- Current user row -->
            <button class="setting-row setting-action" on:click={() => push('/profile')}>
              <span class="material-symbols-rounded si" style="color:var(--accent)">manage_accounts</span>
              <div>
                <span class="setting-label">My Profile</span>
                <div class="setting-desc">{$currentUser?.nickname || $currentUser?.full_name || $currentUser?.username || ''}</div>
              </div>
              <span class="material-symbols-rounded text-3" style="font-size:18px">chevron_right</span>
            </button>
            <div class="setting-divider"></div>

            <!-- User list (admin only) -->
            {#if $currentUser?.role === 'admin'}
              <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;padding:12px 16px">
                <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
                  <span class="setting-label">Users</span>
                  <button class="btn btn-secondary" style="height:30px;font-size:12px;padding:0 10px"
                    on:click={() => { showAddUser = !showAddUser; umError = ''; }}>
                    {showAddUser ? 'Cancel' : '+ Add User'}
                  </button>
                </div>

                {#if showAddUser}
                  <div class="um-add-form" transition:slide={{ duration: 160 }}>
                    <div class="um-form-row">
                      <input class="input" type="text" bind:value={newUsername} placeholder="Username *" autocomplete="off" />
                      <input class="input" type="password" bind:value={newPassword} placeholder="Password *" autocomplete="new-password" />
                    </div>
                    <div class="um-form-row">
                      <input class="input" type="text" bind:value={newFullName} placeholder="Full name (optional)" />
                      <select class="input" bind:value={newRole}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    {#if umError}<p class="um-error">{umError}</p>{/if}
                    <button class="btn btn-primary" style="width:100%" on:click={addUser} disabled={umLoading}>
                      {umLoading ? 'Adding...' : 'Create User'}
                    </button>
                  </div>
                {/if}

                <div class="um-user-list">
                  {#each umUsers as u}
                    <div class="um-user-row">
                      <div class="um-user-avatar">
                        {#if u.avatar_url}
                          <img src={u.avatar_url} alt={u.username} />
                        {:else}
                          <span class="material-symbols-rounded">person</span>
                        {/if}
                      </div>
                      <div class="um-user-info">
                        <div class="um-user-name">{u.nickname || u.full_name || u.username}</div>
                        <div class="um-user-sub">@{u.username}{u.role === 'admin' ? ' · admin' : ''}</div>
                      </div>
                      {#if u.id !== $currentUser?.id}
                        <button class="btn btn-ghost um-del-btn" title="Delete user"
                          on:click={() => deleteUser(u.id)}>
                          <span class="material-symbols-rounded" style="font-size:18px;color:var(--danger)">person_remove</span>
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
              <div class="setting-divider"></div>

              <!-- Invite user -->
              <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;padding:12px 16px">
                <span class="setting-label">Invite user</span>
                <div class="um-form-row">
                  <input class="input" type="email" bind:value={inviteEmail} placeholder="Email (optional)" />
                  <select class="input" bind:value={inviteRole}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button class="btn btn-secondary" style="width:100%" on:click={createInvite} disabled={inviteLoading}>
                  {inviteLoading ? 'Creating…' : 'Generate invite link'}
                </button>
                {#if inviteResult}
                  <div class="invite-result" transition:slide={{ duration: 160 }}>
                    {#if inviteResult.sent}
                      <span class="material-symbols-rounded" style="color:var(--accent);font-size:18px">mark_email_read</span>
                      <span style="font-size:13px">Invite sent to <strong>{inviteEmail || 'user'}</strong></span>
                    {:else}
                      <span style="font-size:13px;color:var(--text-2)">Share this link:</span>
                      <div class="invite-link-row">
                        <input class="input" style="flex:1;font-size:12px" readonly value={inviteResult.inviteUrl} />
                        <button class="btn btn-secondary" style="height:36px;padding:0 12px;font-size:12px"
                          on:click={() => { navigator.clipboard?.writeText(inviteResult.inviteUrl); showSuccess('Copied!'); }}>
                          Copy
                        </button>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>

              <div class="setting-divider"></div>
              <button class="setting-row setting-action danger" on:click={() => showDisableUmDialog = true}>
                <span class="material-symbols-rounded si" style="color:var(--danger)">no_accounts</span>
                <div>
                  <span class="setting-label" style="color:var(--danger)">Disable user management</span>
                  <div class="setting-desc">Removes all user accounts and returns to single-user mode</div>
                </div>
              </button>
            {/if}

            <div class="setting-divider"></div>
            <button class="setting-row setting-action" on:click={logout}>
              <span class="material-symbols-rounded si" style="color:var(--text-3)">logout</span>
              <span class="setting-label">Sign out</span>
            </button>
          {:else}
            <button class="setting-row setting-action" on:click={() => { showEnableUm = !showEnableUm; enableUmError = ''; }}>
              <span class="material-symbols-rounded si" style="color:var(--accent)">group_add</span>
              <div>
                <span class="setting-label">Enable user management</span>
                <div class="setting-desc">Add multiple user accounts with separate data &amp; settings</div>
              </div>
              <span class="material-symbols-rounded text-3" style="font-size:18px">{showEnableUm ? 'expand_less' : 'expand_more'}</span>
            </button>

            {#if showEnableUm}
              <div class="section-body" style="padding:0 16px 16px" transition:slide={{ duration: 160 }}>
                <p class="um-section-label" style="margin-bottom:8px">Create admin account</p>
                <div class="um-add-form">
                  <div class="um-form-row">
                    <input class="input" type="text" bind:value={enableAdminUser} placeholder="Username *" autocomplete="username" />
                    <input class="input" type="text" bind:value={enableAdminName} placeholder="Full name (optional)" />
                  </div>
                  <div class="um-form-row">
                    <input class="input" type="password" bind:value={enableAdminPass} placeholder="Password *" autocomplete="new-password" />
                    <input class="input" type="password" bind:value={enableAdminConf} placeholder="Confirm *" autocomplete="new-password" />
                  </div>
                  {#if enableUmError}<p class="um-error">{enableUmError}</p>{/if}
                  <button class="btn btn-primary" style="width:100%" on:click={enableUserManagement} disabled={enableUmLoading}>
                    {enableUmLoading ? 'Enabling...' : 'Enable & Create Admin'}
                  </button>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/if}

    <!-- About -->
    <button class="section-toggle" class:hidden={!sectionVisible(settingsQuery, 'about')} on:click={() => toggleSection('about')}>
      <span class="material-symbols-rounded si">info</span>
      <span>About</span>
      <span class="material-symbols-rounded chevron" class:rotated={openSections.about}>expand_more</span>
    </button>
    {#if sectionOpen(openSections, settingsQuery, 'about') && sectionVisible(settingsQuery, 'about')}
      <div class="section-body" transition:slide={{ duration: 180 }}>
        <div class="card settings-card">
          <div class="about-hero">
            <img src="/icons/logo.png" alt="NutriTrace" class="about-icon" />
            <div>
              <div class="about-name">NutriTrace</div>
              <div class="about-version text-3 text-sm">v0.10.0-alpha</div>
            </div>
          </div>
          <div class="setting-divider"></div>
          <div class="about-desc">
            Track every bite, every stat — on your own terms. NutriTrace is a self-hosted nutrition
            and body stats tracker built for privacy. Your data lives on your server, not in the cloud.
            Run it solo with no login required, or enable user accounts to support multiple profiles
            on a shared instance.
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">database</span>
            <span>Data stored on your own server (SQLite)</span>
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
            <span>No tracking, no ads, no third parties</span>
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">restaurant_menu</span>
            <span>Food data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener" class="about-link">Open Food Facts</a></span>
          </div>
          <div class="setting-divider"></div>
          <div class="about-row">
            <span class="material-symbols-rounded about-feat-icon">favorite</span>
            <span>Inspired by <a href="https://github.com/davidhealey/waistline" target="_blank" rel="noopener" class="about-link">Waistline</a> by David Healey and <a href="https://github.com/CodeWithCJ/SparkyFitness" target="_blank" rel="noopener" class="about-link">SparkyFitness</a> by CodeWithCJ</span>
          </div>
        </div>
      </div>
    {/if}

    <div style="height:24px"></div>
  </div>
</div>

<Dialog bind:open={showClearDialog}
  title="Clear all data"
  message="This will permanently delete all foods, meals, diary entries, and settings. This cannot be undone."
  confirmText="Delete everything"
  cancelText="Cancel"
  dangerous
  on:confirm={clearAllData}
/>

<Dialog bind:open={showRestoreDialog}
  title="Restore backup?"
  message="This will replace all current data with the contents of this backup. This cannot be undone."
  confirmText="Restore"
  cancelText="Cancel"
  dangerous
  on:confirm={confirmRestoreFullBackup}
/>

<Dialog bind:open={showDeleteBkDialog}
  title="Delete backup?"
  message="This backup file will be permanently removed from the server."
  confirmText="Delete"
  cancelText="Cancel"
  dangerous
  on:confirm={confirmDeleteFullBackup}
/>

<Dialog bind:open={showDisableUmDialog}
  title="Disable user management"
  message="This will remove all user accounts and their data cannot be recovered. The app will return to single-user mode."
  confirmText="Disable & delete all users"
  cancelText="Cancel"
  dangerous
  on:confirm={disableUserManagement}
/>

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
  .hidden { display: none !important; }

  /* Settings search bar */
  .settings-search-bar {
    position: sticky;
    top: var(--header-h, 56px);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
  }
  .settings-search-icon { font-size: 20px; color: var(--text-3); flex-shrink: 0; }
  .settings-search-input {
    flex: 1;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    padding: 7px 14px;
    font-size: 15px;
    color: var(--text-1);
    outline: none;
  }
  .settings-search-input:focus { border-color: var(--accent); }
  .settings-search-clear { color: var(--text-3); }

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
  /* Allow dragged items to visually escape the card boundary */
  .drag-list { overflow: visible; }

  .drag-row {
    position: relative;
    will-change: transform;
    transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 220ms ease, opacity 220ms ease;
  }
  .drag-row.dragging {
    opacity: 0.90;
    z-index: 20;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    box-shadow:
      0 28px 72px rgba(0,0,0,0.50),
      0 8px 24px rgba(0,0,0,0.30),
      0 0 0 1px rgba(255,255,255,0.08);
    backdrop-filter: blur(4px);
  }
  .drag-handle {
    font-size: 20px;
    color: var(--text-3);
    cursor: grab;
    flex-shrink: 0;
    user-select: none;
    touch-action: none;
    transition: color var(--dur-fast);
  }
  .drag-handle:hover  { color: var(--accent); }
  .drag-handle:active { cursor: grabbing; color: var(--accent); }
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

  .backup-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 10px 16px;
  }
  .backup-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .backup-name { font-size: 13px; font-weight: 500; color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .backup-size { font-size: 11px; color: var(--text-3); }
  .backup-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

  .cat-chips-wrap {
    display: flex; flex-wrap: wrap; gap: 8px;
    padding: 14px 16px 8px;
  }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 99px; font-size: 13px; font-weight: 500; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-1); }
  .chip-x { background: none; border: none; cursor: pointer; display: flex; align-items: center; color: var(--text-3); padding: 0; }
  .chip-x:hover { color: var(--danger); }
  .cat-add-row { display: flex; gap: 8px; padding: 8px 16px 14px; }
  .emoji-btn {
    width: 54px; height: 40px; font-size: 20px; padding: 0;
    text-align: center; cursor: pointer; line-height: 1;
  }
  .emoji-picker-wrap {
    position: fixed;
    z-index: 9999; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
  }
  .emoji-picker-wrap emoji-picker {
    --border-radius: 12px;
    --background: var(--surface-1);
    --border-color: var(--border);
    --input-border-color: var(--border);
    --input-font-color: var(--text-1);
    --input-placeholder-color: var(--text-3);
    --category-emoji-size: 1.1rem;
    --emoji-size: 1.4rem;
  }

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

  /* ── User Management ── */
  .um-section-label {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--text-3);
  }
  .um-add-form { display: flex; flex-direction: column; gap: 8px; width: 100%; padding-top: 4px; }
  .um-form-row { display: flex; gap: 8px; }
  .um-form-row > .input { flex: 1; min-width: 0; }
  .um-error { font-size: 12px; color: var(--danger, #ff6b6b); background: rgba(255,107,107,0.1); border-radius: var(--radius-sm); padding: 6px 10px; }
  .um-user-list { display: flex; flex-direction: column; gap: 4px; width: 100%; }
  .invite-result { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 10px 12px; background: var(--surface-2); border-radius: var(--radius-md); border: 1px solid var(--border); }
  .invite-link-row { display: flex; gap: 6px; align-items: center; }
  .um-user-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px; border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .um-user-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--surface-3); display: flex; align-items: center; justify-content: center;
    overflow: hidden; flex-shrink: 0;
  }
  .um-user-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .um-user-avatar .material-symbols-rounded { font-size: 20px; color: var(--text-3); }
  .um-user-info { flex: 1; min-width: 0; }
  .um-user-name { font-size: 14px; font-weight: 600; }
  .um-user-sub  { font-size: 12px; color: var(--text-3); }
  .um-del-btn { padding: 4px; min-width: 0; }
</style>
