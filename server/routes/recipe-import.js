import { Router } from 'express';
import crypto from 'node:crypto';
import { logger, wrap } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { makeRateLimiter } from '../middleware/rate-limit.js';
import db from '../db.js';
import { fetchRecipePage, resolvePublicAddress, validateRecipeUrl } from '../lib/recipe-import/fetch-page.js';
import { parseRecipeJsonLd } from '../lib/recipe-import/jsonld.js';
import { RecipeImportError, recipeImportErrorBody } from '../lib/recipe-import/errors.js';
import { resolveAmountFactor } from '../lib/recipe-import/amount.js';

const router = Router();
router.use(requireAuth);

const previewLimit = makeRateLimiter({ max: 12, windowMs: 60_000, label: 'recipe-import-preview' });
let activeFetches = 0;
const MAX_ACTIVE_FETCHES = 6;

async function publicUrl(value, base) {
  try {
    const url = validateRecipeUrl(value, base);
    await resolvePublicAddress(url.hostname);
    return url.href;
  } catch { return ''; }
}

async function sanitizeDraftUrls(parsed, finalUrl) {
  parsed.canonical_url = await publicUrl(parsed.canonical_url, finalUrl) || finalUrl;
  for (const recipe of parsed.recipes) {
    recipe.source_url = parsed.canonical_url;
    const safeImages = [];
    for (const candidate of recipe.images || []) {
      const safe = await publicUrl(candidate, finalUrl);
      if (safe && !safeImages.includes(safe)) safeImages.push(safe);
    }
    recipe.images = safeImages;
  }
  return parsed;
}

router.post('/preview', previewLimit, wrap(async (req, res) => {
  if (activeFetches >= MAX_ACTIVE_FETCHES) {
    return res.status(503).json({ error: 'Recipe importing is busy. Try again shortly.', code: 'import_busy' });
  }
  const input = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!input) return res.status(400).json({ error: 'Recipe URL required', code: 'invalid_url' });

  activeFetches++;
  const started = Date.now();
  try {
    const page = await fetchRecipePage(input);
    const parsed = await sanitizeDraftUrls(parseRecipeJsonLd(page.html, page.finalUrl), page.finalUrl);
    logger.info(`[recipe-import] preview ok host=${new URL(page.finalUrl).hostname} recipes=${parsed.recipes.length} bytes=${page.bytes} redirects=${page.redirects} ms=${Date.now() - started}`);
    res.json({
      source: 'jsonld',
      source_url: parsed.canonical_url,
      recipes: parsed.recipes,
      warnings: parsed.warnings,
      diagnostics: { recipe_count: parsed.recipes.length, redirects: page.redirects },
    });
  } catch (error) {
    if (error instanceof RecipeImportError) {
      logger.info(`[recipe-import] preview rejected code=${error.code} ms=${Date.now() - started}`);
      return res.status(error.status).json(recipeImportErrorBody(error));
    }
    throw error;
  } finally {
    activeFetches--;
  }
}));

function uid(req) { return req.user?.id ?? null; }
function ownerClause(userId) { return userId == null ? 'user_id IS NULL' : 'user_id = ?'; }
function ownerArgs(userId) { return userId == null ? [] : [userId]; }
function parseJson(value, fallback) { try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } }
function sourceHash(url) {
  let normalized;
  try { normalized = new URL(url); }
  catch { return crypto.createHash('sha256').update(String(url)).digest('hex'); }
  normalized.hash = '';
  for (const key of [...normalized.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|mc_[ce]id)$/i.test(key)) normalized.searchParams.delete(key);
  }
  return crypto.createHash('sha256').update(normalized.href).digest('hex');
}
function sumNutrition(items) {
  const total = {};
  for (const item of items) {
    for (const [key, value] of Object.entries(item.nutrition || {})) {
      const n = Number(value);
      if (Number.isFinite(n)) total[key] = (total[key] || 0) + n;
    }
  }
  return total;
}

function normalizeRefs(value) {
  const refs = Array.isArray(value) ? value : parseJson(value, []);
  const unique = new Map();
  for (const ref of refs.slice(0, 50)) {
    if (!ref || typeof ref !== 'object') continue;
    const clean = {
      provider: String(ref.provider || '').slice(0, 50),
      instance: ref.instance ? String(ref.instance).slice(0, 100) : undefined,
      kind: String(ref.kind || '').slice(0, 50),
      id: String(ref.id || '').slice(0, 500),
    };
    if (!clean.provider || !clean.kind || !clean.id) continue;
    unique.set(`${clean.provider}\0${clean.instance || ''}\0${clean.kind}\0${clean.id}`, clean);
  }
  return [...unique.values()];
}

/** Commit a reviewed draft as one recipe row. Reused foods are reloaded server-side. */
router.post('/commit', wrap(async (req, res) => {
  const draft = req.body?.recipe;
  const resolutions = Array.isArray(req.body?.ingredients) ? req.body.ingredients : [];
  const mode = ['copy', 'update'].includes(req.body?.mode) ? req.body.mode : 'create';
  if (!draft || typeof draft.name !== 'string' || !draft.name.trim()) {
    return res.status(400).json({ error: 'Recipe name required', code: 'invalid_recipe' });
  }
  if (!draft.source_url || resolutions.length === 0 || resolutions.length > 500) {
    return res.status(400).json({ error: 'Recipe source and ingredients required', code: 'invalid_recipe' });
  }
  const safeSource = draft.source === 'mealie'
    ? String(draft.source_url || `mealie:recipe:${draft.source_id || draft.name}`).slice(0, 2_000)
    : await publicUrl(draft.source_url, draft.source_url);
  if (!safeSource) return res.status(400).json({ error: 'Recipe source URL is invalid', code: 'invalid_url' });

  const userId = uid(req);
  const hash = sourceHash(safeSource);
  const existing = db.prepare(
    `SELECT * FROM meals WHERE ${ownerClause(userId)} AND is_recipe = 1 AND external_refs LIKE ? AND deleted_at IS NULL LIMIT 1`
  ).get(...ownerArgs(userId), `%${hash}%`);
  if (existing && mode === 'create') {
    return res.status(409).json({ error: 'This recipe was already imported.', code: 'recipe_exists', existing_id: existing.id });
  }
  if (mode === 'update' && !existing) {
    return res.status(404).json({ error: 'Previously imported recipe not found', code: 'recipe_not_found' });
  }

  const items = [];
  for (const resolution of resolutions) {
    const sourceIngredient = resolution?.source_ingredient || {};
    if (resolution.food_id != null) {
      const food = db.prepare(`SELECT * FROM foods WHERE id = ? AND ${ownerClause(userId)} AND deleted_at IS NULL`)
        .get(resolution.food_id, ...ownerArgs(userId));
      if (!food) return res.status(400).json({ error: 'A selected food is unavailable.', code: 'invalid_food_reference' });
      const basePortion = Number(food.portion) || 100;
      const portion = Number(resolution.portion) || basePortion;
      const unit = resolution.unit || food.unit || 'g';
      const foodForConversion = { ...food, alt_units: parseJson(food.alt_units, []) };
      const factor = resolveAmountFactor(foodForConversion, portion, unit);
      if (factor == null) {
        return res.status(422).json({ error: `Choose an equivalent amount for ${food.name}.`, code: 'conversion_required' });
      }
      const foodNutrition = parseJson(food.nutrition, {});
      items.push({
        id: food.id,
        name: food.name,
        brand: food.brand || '',
        portion,
        unit,
        quantity: 1,
        nutrition: Object.fromEntries(Object.entries(foodNutrition).map(([key, value]) => [key, (Number(value) || 0) * factor])),
        imgUrl: food.img_url || '',
        nutrition_basis: food.nutrition_basis || null,
        alt_units: foodForConversion.alt_units,
        density_g_ml: food.density_g_ml ?? null,
        source_ingredient: sourceIngredient,
      });
    } else {
      if (!resolution.unresolved_acknowledged) {
        return res.status(422).json({ error: 'Every unresolved ingredient must be acknowledged.', code: 'unresolved_ingredients' });
      }
      items.push({
        type: 'unresolved_ingredient',
        name: String(resolution.name || sourceIngredient.original_text || 'Unresolved ingredient').slice(0, 500),
        portion: Number(resolution.portion) || Number(sourceIngredient.original_quantity) || 1,
        unit: resolution.unit || sourceIngredient.original_unit || 'serving',
        quantity: 1,
        nutrition: {},
        source_ingredient: { ...sourceIngredient, resolution: 'unresolved' },
      });
    }
  }

  const servings = Math.max(1, Math.min(10_000, Number.parseInt(req.body?.servings) || 1));
  const totalNutrition = sumNutrition(items);
  const perServing = Object.fromEntries(Object.entries(totalNutrition).map(([key, value]) => [key, value / servings]));
  const knownGrams = items.reduce((sum, item) => sum + (item.unit === 'g' ? Number(item.portion) || 0 : item.unit === 'kg' ? (Number(item.portion) || 0) * 1000 : 0), 0);
  const safeImage = draft.images?.[0] ? await publicUrl(draft.images[0], safeSource.startsWith('http') ? safeSource : undefined) : '';
  // Keep the already-validated public URL. The generic image localizer does
  // not pin DNS for the download, so invoking it here would weaken the
  // importer's DNS-rebinding boundary.
  const image = safeImage || null;
  const details = {
    description: draft.description || '', instructions: draft.instructions || [], source_url: safeSource,
    prep_time: draft.prep_time || '', cook_time: draft.cook_time || '', total_time: draft.total_time || '',
    categories: draft.categories || [], cuisines: draft.cuisines || [], keywords: draft.keywords || [], author: draft.author || '',
  };
  const refs = normalizeRefs([{ provider: draft.source || 'schemaorg', instance: draft.source_instance || undefined, kind: 'recipe', id: hash }]);

  const save = db.transaction(() => {
    for (const item of items) {
      const source = item.source_ingredient;
      if (!item.id || source?.provider !== 'mealie' || !source.instance || !source.food_id) continue;
      const row = db.prepare(`SELECT external_refs FROM foods WHERE id = ? AND ${ownerClause(userId)} AND deleted_at IS NULL`)
        .get(item.id, ...ownerArgs(userId));
      const next = normalizeRefs([
        ...parseJson(row?.external_refs, []),
        { provider: 'mealie', instance: source.instance, kind: 'food', id: source.food_id },
      ]);
      db.prepare(`UPDATE foods SET external_refs=?, updated_at=datetime('now') WHERE id=? AND ${ownerClause(userId)}`)
        .run(JSON.stringify(next), item.id, ...ownerArgs(userId));
    }
    if (existing && mode === 'update') {
      db.prepare(
        `UPDATE meals SET name=?, nutrition=?, items=?, img_url=?, notes=?, is_recipe=1, portion=?, unit='g', servings=?, recipe_details=?, external_refs=?, updated_at=datetime('now') WHERE id=?`
      ).run(draft.name.trim(), JSON.stringify(perServing), JSON.stringify(items), image, draft.description || null,
        knownGrams ? knownGrams / servings : 100, servings, JSON.stringify(details), JSON.stringify(refs), existing.id);
      return existing.id;
    }
    const result = db.prepare(
      `INSERT INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, servings, visibility, recipe_details, external_refs, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'g', ?, 'private', ?, ?, datetime('now'))`
    ).run(userId, draft.name.trim(), JSON.stringify(perServing), JSON.stringify(items), image, draft.description || null,
      knownGrams ? knownGrams / servings : 100, servings, JSON.stringify(details), JSON.stringify(refs));
    return result.lastInsertRowid;
  });
  const id = save();
  const row = db.prepare('SELECT * FROM meals WHERE id = ?').get(id);
  res.status(existing && mode === 'update' ? 200 : 201).json({
    ...row,
    nutrition: parseJson(row.nutrition, {}), items: parseJson(row.items, []), is_recipe: true,
    recipe_details: parseJson(row.recipe_details, {}), external_refs: parseJson(row.external_refs, []),
  });
}));

export default router;
