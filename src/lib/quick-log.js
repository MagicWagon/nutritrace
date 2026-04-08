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

const PARSE_SYSTEM_PROMPT = `You are a food parser for a nutrition tracking app. Extract food items from the user's input and return them as JSON.

Rules:
- Return ONLY valid JSON, no commentary, no markdown fences.
- Each item has: name (string), quantity (number, default 1), unit (string or null).
- Use common units: "slice", "cup", "tbsp", "tsp", "oz", "g", "ml", "piece", "bowl", "can", "bottle".
- If no unit is specified for a countable item (eggs, bananas, apples), set unit to null.
- Words like "a", "an", "one" mean quantity 1. "couple" or "few" means 2. "some" means 1.
- Split compound items: "eggs and toast" → two items.
- Ignore filler words: "ate", "had", "for breakfast", "this morning".

Examples:
Input: "2 eggs and toast"
Output: {"items":[{"name":"eggs","quantity":2,"unit":null},{"name":"toast","quantity":1,"unit":"slice"}]}

Input: "a cup of coffee and a banana"
Output: {"items":[{"name":"coffee","quantity":1,"unit":"cup"},{"name":"banana","quantity":1,"unit":null}]}

Input: "had a bowl of oatmeal with blueberries and a glass of milk"
Output: {"items":[{"name":"oatmeal","quantity":1,"unit":"bowl"},{"name":"blueberries","quantity":1,"unit":null},{"name":"milk","quantity":1,"unit":"cup"}]}`;

/**
 * Parse a free-form input string into structured food items via AI.
 * Returns an array of { name, quantity, unit }.
 */
export async function parseInput(text) {
  if (!text || !text.trim()) return [];
  const provider = DB.getSetting('aiProvider', 'claude');
  const apiKey   = DB.getSetting('aiApiKey', '');
  const model    = DB.getSetting('aiModel', '');
  if (!apiKey) throw new Error('AI provider not configured. Set up FitBot in Settings → AI first.');

  const reply = await callAI({
    provider,
    apiKey,
    model,
    messages: [{ role: 'user', content: text.trim() }],
    systemPrompt: PARSE_SYSTEM_PROMPT,
    tools: [], // no tools — just want a structured text response
  });

  // The AI should return JSON. Be defensive about markdown fences.
  let jsonText = String(reply || '').trim();
  // Strip ```json ... ``` fences if present
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonText);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    // Normalize and validate
    return items
      .filter(it => it && typeof it === 'object' && it.name)
      .map(it => ({
        name: String(it.name).trim(),
        quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
        unit: it.unit ? String(it.unit).trim() : null,
      }));
  } catch (e) {
    console.warn('[quick-log] AI returned non-JSON:', jsonText.slice(0, 200));
    throw new Error('AI parser returned invalid JSON. Try rephrasing your input.');
  }
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
