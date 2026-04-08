/**
 * quick-log.js — natural language food logging.
 *
 * Pipeline:
 *   1. parseInput(text)         → AI parses input into [{name, quantity, unit}, ...]
 *   2. matchItems(parsedItems)  → for each item, search local DB → OFF → AI estimate
 *   3. (user reviews + edits in confirmation modal)
 *   4. saveItems(matchedItems, mealSlot) → writes to diary
 *
 * Uses the same AI provider configured for FitBot. Setting `quickLogEnabled`
 * gates the feature; `aiEnabled` + a valid `aiApiKey` are required.
 */

import { DB } from './db.js';
import { API, NtApi } from './api.js';
import { callAI } from './aiChat.js';

// ── Step 1: AI parses the input string into structured items ──────────────

/**
 * Build the parser prompt dynamically with the user's actual meal names so
 * the AI can target custom slots like "Pre-workout", "Snack 1", "Late Snack",
 * not just the default Breakfast/Lunch/Dinner/Snacks.
 */
function _buildParsePrompt(userMealNames) {
  const names = Array.isArray(userMealNames) && userMealNames.length > 0
    ? userMealNames
    : ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  const namesQuoted = names.map(n => '"' + n + '"').join(', ');
  return `You are a food parser for a nutrition tracking app. Extract food items AND the target meal from the user's input and return them as JSON.

The user's configured meal slots are: [${namesQuoted}]

Rules:
- Return ONLY valid JSON, no commentary, no markdown fences.
- Top-level shape: { "meal": <one of the meal slot names exactly as listed above, or null>, "items": [ ... ] }
- Each item has: name (string), quantity (number, default 1), unit (string or null).
- Use common units: "slice", "cup", "tbsp", "tsp", "oz", "g", "ml", "piece", "bowl", "can", "bottle".
- If no unit is specified for a countable item (eggs, bananas, apples), set unit to null.
- Words like "a", "an", "one" mean quantity 1. "couple" or "few" means 2. "some" means 1.
- Split compound items: "eggs and toast" → two items.
- For the meal field:
  * Match the user's input to one of their configured meal slots EXACTLY as written above (preserve case).
  * Use common sense: "this morning" / "for breakfast" → the breakfast-like slot. "tonight" / "for dinner" → the dinner-like slot. "as a snack" → the closest snack slot.
  * If the user says a slot name directly ("for my pre-workout meal"), match it exactly.
  * If the user has multiple numbered slots (e.g. Snack 1, Snack 2, Snack 3) and the input doesn't say which number, pick the FIRST one in the list. The user can change it later.
  * The user may have renamed defaults (e.g. no "Breakfast", but a "Morning Bowl" slot) — pick whichever slot best fits the time-of-day cue.
  * If no meal is mentioned or you can't tell, set meal to null.
- Ignore filler words: "ate", "had", "I just had".

Example output (for default meals): {"meal":"Breakfast","items":[{"name":"eggs","quantity":2,"unit":null},{"name":"toast","quantity":1,"unit":"slice"}]}`;
}

/**
 * Parse a free-form input string into structured food items + a target meal name.
 * The meal returned is one of the user's configured meal slot names (case-preserved),
 * not a generic canonical name — so custom meal slots like "Pre-workout" work.
 *
 * @param {string} text — user input
 * @param {string[]} userMealNames — current user's mealNames array
 * @returns {{ meal: string|null, items: [{name, quantity, unit}, ...] }}
 */
export async function parseInput(text, userMealNames) {
  if (!text || !text.trim()) return { meal: null, items: [] };
  const provider = DB.getSetting('aiProvider', 'claude');
  const apiKey   = DB.getSetting('aiApiKey', '');
  const model    = DB.getSetting('aiModel', '');
  if (!apiKey) throw new Error('AI provider not configured. Set up FitBot in Settings → AI first.');

  const reply = await callAI({
    provider,
    apiKey,
    model,
    messages: [{ role: 'user', content: text.trim() }],
    systemPrompt: _buildParsePrompt(userMealNames),
    tools: [],
  });

  // Defensive JSON parse — strip markdown fences if the model added them
  let jsonText = String(reply || '').trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonText);
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items = rawItems
      .filter(it => it && typeof it === 'object' && it.name)
      .map(it => ({
        name: String(it.name).trim(),
        quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
        unit: it.unit ? String(it.unit).trim() : null,
      }));
    // Meal can be any of the user's slot names (free string, validated downstream)
    const meal = parsed.meal && typeof parsed.meal === 'string' ? parsed.meal.trim() : null;
    return { meal, items };
  } catch (e) {
    console.warn('[quick-log] AI returned non-JSON:', jsonText.slice(0, 200));
    throw new Error('AI parser returned invalid JSON. Try rephrasing your input.');
  }
}

/**
 * Resolve a meal name string from the AI to an index in the user's configured
 * mealNames array.
 *
 * The user may have:
 *   - Custom slot names ("Pre-workout", "Late Snack", "Brunch")
 *   - Numbered duplicates ("Snack 1", "Snack 2", "Snack 3")
 *   - Renamed defaults ("Morning Bowl" instead of "Breakfast")
 *   - Removed defaults entirely (no "Snacks" slot at all)
 *
 * Strategy (in priority order):
 *   1. EXACT case-insensitive match against the user's configured names.
 *      The AI is told to use the user's exact slot names, so this is the
 *      common case.
 *   2. Substring match where one fully contains the other. Prefers shorter
 *      user slot names so "Pre-workout meal" → "Pre-workout".
 *   3. Canonical-word alias: if the AI returned a generic word like
 *      "breakfast" / "snack", find the FIRST user slot whose name contains
 *      one of the canonical aliases. Numbered duplicates like "Snack 1, 2, 3"
 *      will pick "Snack 1" — the user can change it in the review modal.
 *   4. If nothing matches, return null and the caller falls back to its
 *      default meal slot.
 */
export function resolveMealSlot(mealName, mealNames) {
  if (!mealName || !Array.isArray(mealNames) || mealNames.length === 0) return null;
  const target = String(mealName).toLowerCase().trim();
  if (!target) return null;

  // 1. Exact case-insensitive match
  const direct = mealNames.findIndex(n => String(n).toLowerCase() === target);
  if (direct >= 0) return direct;

  // 2. Substring match — prefer the SHORTEST matching slot name to avoid
  //    "Pre-workout snack" matching "Snack 1" when "Pre-workout" exists.
  let bestSubstr = -1;
  let bestSubstrLen = Infinity;
  for (let i = 0; i < mealNames.length; i++) {
    const ln = String(mealNames[i]).toLowerCase();
    if (ln === target) return i; // double-check exact (shouldn't reach here but safe)
    if (ln.includes(target) || target.includes(ln)) {
      if (ln.length < bestSubstrLen) {
        bestSubstr = i;
        bestSubstrLen = ln.length;
      }
    }
  }
  if (bestSubstr >= 0) return bestSubstr;

  // 3. Canonical-word fuzzy fallback
  const aliases = {
    breakfast: ['breakfast', 'morning', 'am', 'wake', 'first'],
    lunch:     ['lunch', 'noon', 'midday'],
    dinner:    ['dinner', 'supper', 'evening', 'night'],
    snack:     ['snack', 'snacks'],
  };
  const aliasList = aliases[target] || [];
  if (aliasList.length > 0) {
    // First pass: find a slot whose lowercase name STARTS WITH any alias
    // (handles "Snack 1" picking up "snack" as a prefix). Returns the first
    // such slot which is typically the user's "first" snack.
    for (let i = 0; i < mealNames.length; i++) {
      const ln = String(mealNames[i]).toLowerCase();
      if (aliasList.some(a => ln.startsWith(a))) return i;
    }
    // Second pass: any substring match (e.g. "Mid-afternoon Snack")
    for (let i = 0; i < mealNames.length; i++) {
      const ln = String(mealNames[i]).toLowerCase();
      if (aliasList.some(a => ln.includes(a))) return i;
    }
  }

  return null;
}

// ── Step 2: Match parsed items to real food records ──────────────────────

/**
 * Search local foods + OFF for a single parsed item.
 * Returns { item, candidates: [...], best: <foodRecord|null>, source: 'local'|'off'|'unknown' }.
 *
 * Match strategy:
 *   1. Search local foods by name. If matches: rank by usage frequency in diary, pick most-used.
 *   2. If no local matches: search OFF (handles native via existing CapacitorHttp pipeline).
 *   3. If still nothing: return null + 'unknown' so the modal can show an "Estimate" badge.
 */
export async function matchItem(parsedItem) {
  const out = { item: parsedItem, candidates: [], best: null, source: 'unknown' };
  const query = parsedItem.name;

  // ── 1. Local foods ──────────────────────────────────────────────────────
  // NtApi has no server-side text search; we fetch all and filter client-side
  // (matches the pattern used in Foods.svelte). For typical libraries (<2k items)
  // this is fine. For huge libraries we could move filtering to a worker.
  try {
    const allFoods = await NtApi.getFoods();
    const ql = query.toLowerCase();
    const matches = (allFoods || []).filter(f => {
      const n = (f.name || '').toLowerCase();
      const b = (f.brand || '').toLowerCase();
      // Match if any token of the query appears in the name or brand
      return ql.split(/\s+/).every(tok => n.includes(tok) || b.includes(tok));
    });

    if (matches.length > 0) {
      // Frequency-rank: count how many times each food appears in diary entries
      let freqMap = {};
      try {
        const allDiary = await NtApi.getAllDiary();
        for (const day of allDiary) {
          for (const it of (day.items || [])) {
            const key = it.id || it.foodId || it.name;
            if (key) freqMap[key] = (freqMap[key] || 0) + 1;
          }
        }
      } catch {}
      // Sort: by frequency desc, then exact-name match boost, then name length asc
      const ranked = [...matches].sort((a, b) => {
        const fa = freqMap[a.id || a.name] || 0;
        const fb = freqMap[b.id || b.name] || 0;
        if (fb !== fa) return fb - fa;
        const ea = (a.name || '').toLowerCase() === ql ? 1 : 0;
        const eb = (b.name || '').toLowerCase() === ql ? 1 : 0;
        if (eb !== ea) return eb - ea;
        return (a.name || '').length - (b.name || '').length;
      });
      out.candidates = ranked.slice(0, 8);
      out.best = ranked[0];
      out.source = 'local';
      return out;
    }
  } catch (e) {
    console.warn('[quick-log] local search failed:', e.message);
  }

  // ── 2. OFF fallback ─────────────────────────────────────────────────────
  try {
    const offResults = await API.searchByName(query, 1);
    if (Array.isArray(offResults) && offResults.length > 0) {
      out.candidates = offResults.slice(0, 5);
      out.best = offResults[0];
      out.source = 'off';
      return out;
    }
  } catch (e) {
    console.warn('[quick-log] OFF search failed:', e.message);
  }

  // ── 3. Nothing matched ──────────────────────────────────────────────────
  return out;
}

/** Match all parsed items in parallel. */
export async function matchItems(parsedItems) {
  return Promise.all(parsedItems.map(matchItem));
}

// ── Step 3: Save matched items to diary ──────────────────────────────────

/**
 * Save the user's confirmed items to the diary for the given date + meal slot.
 *
 * Each "matched item" should have:
 *   - food: the food record (local or OFF) — added to local Foods if from OFF
 *   - quantity: portion size in the food's base unit (typically grams)
 *   - mealSlot: 0..n meal index
 *   - date: 'YYYY-MM-DD'
 */
export async function saveItems(matchedList, { date, defaultMealSlot = 0 }) {
  if (!Array.isArray(matchedList) || matchedList.length === 0) return { saved: 0 };
  const { addDiaryItem } = await import('../stores/diary.js');

  let saved = 0;
  for (const m of matchedList) {
    if (!m || !m.food) continue;
    let food = m.food;

    // If the food came from OFF, persist it to the local foods table first so
    // future quick-log calls find it via the local-search fast path.
    if (m.source === 'off' && !food.id) {
      try {
        const created = await NtApi.createFood(food);
        if (created && created.id) food = created;
      } catch (e) {
        console.warn('[quick-log] failed to save OFF food locally:', e.message);
      }
    }

    const item = {
      ...food,
      portion: m.quantity || food.portion || 100,
      unit: food.unit || 'g',
      meal: m.mealSlot != null ? Number(m.mealSlot) : defaultMealSlot,
    };
    try {
      await addDiaryItem(item, item.meal, date);
      saved++;
    } catch (e) {
      console.warn('[quick-log] add to diary failed:', e.message);
    }
  }
  return { saved };
}
