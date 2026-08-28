import { Router } from 'express';
import crypto from 'node:crypto';
import { logger, wrap } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { makeRateLimiter } from '../middleware/rate-limit.js';
import db from '../db.js';
import { fetchRecipePage, resolvePublicAddress, validateRecipeUrl } from '../lib/recipe-import/fetch-page.js';
import { parseRecipeJsonLd } from '../lib/recipe-import/jsonld.js';
import { RecipeImportError, recipeImportErrorBody } from '../lib/recipe-import/errors.js';
import { resolveAmountFactor, resolveAmountGrams } from '../lib/recipe-import/amount.js';
import { importMealieRecipeImage } from '../lib/mealie-image.js';

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

function commitFailure(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function cleanAltUnits(value) {
  const unique = new Map();
  for (const row of Array.isArray(value) ? value : []) {
    const abbr = String(row?.abbr || '').trim().toLowerCase().slice(0, 60);
    const grams = Number(row?.grams);
    if (!abbr || !Number.isFinite(grams) || grams <= 0 || grams > 1_000_000) continue;
    unique.set(abbr, {
      abbr, grams,
      ...(row.label ? { label: String(row.label).slice(0, 160) } : {}),
      ...(row.source ? { source: String(row.source).slice(0, 40) } : {}),
      ...(row.source_id ? { source_id: String(row.source_id).slice(0, 160) } : {}),
      ...(Number(row.source_amount) > 0 ? { source_amount: Number(row.source_amount) } : {}),
      ...(Number(row.source_grams) > 0 ? { source_grams: Number(row.source_grams) } : {}),
    });
  }
  return [...unique.values()].slice(0, 50);
}

function cleanProviderFood(value) {
  if (!value || typeof value !== 'object') return null;
  const name = String(value.name || '').trim().slice(0, 500);
  const provider = String(value._candidateProvider || '').toLowerCase();
  if (!name || !['openfoodfacts', 'usda'].includes(provider)) return null;
  const nutrition = {};
  for (const [key, raw] of Object.entries(value.nutrition || {}).slice(0, 100)) {
    const number = Number(raw);
    if (Number.isFinite(number) && Math.abs(number) <= 10_000_000) nutrition[String(key).slice(0, 80)] = number;
  }
  const portion = Number(value.portion);
  const density = Number(value.density_g_ml);
  return {
    name,
    brand: String(value.brand || '').trim().slice(0, 300),
    nutrition,
    portion: Number.isFinite(portion) && portion > 0 ? portion : 100,
    unit: String(value.unit || 'g').trim().toLowerCase().slice(0, 40) || 'g',
    barcode: String(value.barcode || '').trim().slice(0, 160),
    nutrition_basis: ['g', 'ml'].includes(value.nutrition_basis) ? value.nutrition_basis : null,
    alt_units: cleanAltUnits(value.alt_units),
    density_g_ml: Number.isFinite(density) && density > 0 ? density : null,
    external_refs: normalizeRefs(value.external_refs),
  };
}

function parsedFood(row) {
  return { ...row, nutrition: parseJson(row.nutrition, {}), alt_units: parseJson(row.alt_units, []), external_refs: parseJson(row.external_refs, []) };
}

/** Commit a reviewed draft and any staged provider foods atomically. */
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

  const servings = Math.max(1, Math.min(10_000, Number.parseInt(req.body?.servings) || 1));
  const mealieImage = draft.source === 'mealie'
    ? await importMealieRecipeImage(req.body?.mealie_image, userId)
    : '';
  const safeImage = draft.images?.[0] ? await publicUrl(draft.images[0], safeSource.startsWith('http') ? safeSource : undefined) : '';
  // Keep the already-validated public URL. The generic image localizer does
  // not pin DNS for the download, so invoking it here would weaken the
  // importer's DNS-rebinding boundary.
  const image = mealieImage || safeImage || null;
  const details = {
    description: draft.description || '', instructions: draft.instructions || [], source_url: safeSource,
    prep_time: draft.prep_time || '', cook_time: draft.cook_time || '', total_time: draft.total_time || '',
    categories: draft.categories || [], cuisines: draft.cuisines || [], keywords: draft.keywords || [], author: draft.author || '',
  };
  const refs = normalizeRefs([{ provider: draft.source || 'schemaorg', instance: draft.source_instance || undefined, kind: 'recipe', id: hash }]);

  let affectedFoodIds = [];
  let savedItems = [];
  const save = db.transaction(() => {
    const items = [];
    const providerFoodIds = [];
    for (const resolution of resolutions) {
      const sourceIngredient = resolution?.source_ingredient || {};
      let food = null;
      if (resolution.food_id != null) {
        food = db.prepare(`SELECT * FROM foods WHERE id = ? AND ${ownerClause(userId)} AND deleted_at IS NULL`)
          .get(resolution.food_id, ...ownerArgs(userId));
        if (!food) throw commitFailure(400, 'invalid_food_reference', 'A selected food is unavailable.');
      } else if (resolution.provider_food) {
        const staged = cleanProviderFood(resolution.provider_food);
        if (!staged) throw commitFailure(400, 'invalid_provider_food', 'A selected provider food is invalid.');
        if (staged.barcode) {
          food = db.prepare(`SELECT * FROM foods WHERE barcode = ? AND ${ownerClause(userId)} AND deleted_at IS NULL LIMIT 1`)
            .get(staged.barcode, ...ownerArgs(userId));
        }
        if (!food) {
          const result = db.prepare(
            `INSERT INTO foods (user_id, name, brand, nutrition, portion, unit, img_url, visibility, barcode, nutrition_basis, alt_units, density_g_ml, external_refs, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, 'private', ?, ?, ?, ?, ?, datetime('now'))`
          ).run(userId, staged.name, staged.brand || null, JSON.stringify(staged.nutrition), staged.portion, staged.unit,
            staged.barcode || null, staged.nutrition_basis, staged.alt_units.length ? JSON.stringify(staged.alt_units) : null,
            staged.density_g_ml, staged.external_refs.length ? JSON.stringify(staged.external_refs) : null);
          food = db.prepare('SELECT * FROM foods WHERE id = ?').get(result.lastInsertRowid);
        }
        providerFoodIds.push(food.id);
      }

      if (food) {
        const basePortion = Number(food.portion) || 100;
        const sourcePrimary = Array.isArray(sourceIngredient.amounts)
          ? sourceIngredient.amounts.find(amount => amount?.role === 'primary' && Number(amount?.quantity) > 0 && amount?.unit)
          : null;
        const requestedPortion = Number(resolution.portion);
        const portion = Number.isFinite(requestedPortion) && requestedPortion > 0
          ? requestedPortion
          : (Number(sourcePrimary?.quantity) || Number(sourceIngredient.original_quantity) || basePortion);
        const unit = String(resolution.unit || sourcePrimary?.unit || sourceIngredient.original_unit || food.unit || 'g').slice(0, 40);
        const foodForConversion = { ...food, alt_units: parseJson(food.alt_units, []) };
        const explicitEquivalentGrams = Number(resolution.equivalent_grams);
        const derivedEquivalentGrams = resolveAmountGrams(foodForConversion, portion, unit);
        const equivalentGrams = Number.isFinite(explicitEquivalentGrams) && explicitEquivalentGrams > 0
          ? explicitEquivalentGrams
          : derivedEquivalentGrams;
        const factor = Number.isFinite(explicitEquivalentGrams) && explicitEquivalentGrams > 0
          ? resolveAmountFactor(foodForConversion, explicitEquivalentGrams, 'g')
          : resolveAmountFactor(foodForConversion, portion, unit);
        if (factor == null) throw commitFailure(422, 'conversion_required', `No reliable unit conversion is available for ${food.name}.`);
        const foodNutrition = parseJson(food.nutrition, {});
        items.push({
          id: food.id, name: food.name, brand: food.brand || '', portion, unit, recipe_portion: portion, recipe_unit: unit, quantity: 1,
          nutrition: Object.fromEntries(Object.entries(foodNutrition).map(([key, value]) => [key, (Number(value) || 0) * factor])),
          imgUrl: food.img_url || '', nutrition_basis: food.nutrition_basis || null,
          alt_units: foodForConversion.alt_units, density_g_ml: food.density_g_ml ?? null,
          equivalent_grams: Number.isFinite(equivalentGrams) && equivalentGrams > 0 ? equivalentGrams : undefined,
          source_ingredient: sourceIngredient,
        });
      } else {
        if (!resolution.unresolved_acknowledged) throw commitFailure(422, 'unresolved_ingredients', 'Every unresolved ingredient must be acknowledged.');
        const sourcePrimary = Array.isArray(sourceIngredient.amounts)
          ? sourceIngredient.amounts.find(amount => amount?.role === 'primary' && Number(amount?.quantity) > 0 && amount?.unit)
          : null;
        const unresolvedPortion = Number(resolution.portion) || Number(sourcePrimary?.quantity) || Number(sourceIngredient.original_quantity) || 1;
        const unresolvedUnit = resolution.unit || sourcePrimary?.unit || sourceIngredient.original_unit || 'serving';
        items.push({
          type: 'unresolved_ingredient', name: String(resolution.name || sourceIngredient.original_text || 'Unresolved ingredient').slice(0, 500),
          portion: unresolvedPortion,
          unit: unresolvedUnit,
          recipe_portion: unresolvedPortion,
          recipe_unit: unresolvedUnit,
          quantity: 1, nutrition: {},
          source_ingredient: { ...sourceIngredient, resolution: 'unresolved' },
        });
      }
    }

    const totalNutrition = sumNutrition(items);
    const perServing = Object.fromEntries(Object.entries(totalNutrition).map(([key, value]) => [key, value / servings]));
    const knownGrams = items.reduce((sum, item) => sum + (Number(item.equivalent_grams) || (item.unit === 'g' ? Number(item.portion) || 0 : item.unit === 'kg' ? (Number(item.portion) || 0) * 1000 : 0)), 0);
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
      affectedFoodIds = providerFoodIds; savedItems = items; return existing.id;
    }
    const result = db.prepare(
      `INSERT INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, servings, visibility, recipe_details, external_refs, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'g', ?, 'private', ?, ?, datetime('now'))`
    ).run(userId, draft.name.trim(), JSON.stringify(perServing), JSON.stringify(items), image, draft.description || null,
      knownGrams ? knownGrams / servings : 100, servings, JSON.stringify(details), JSON.stringify(refs));
    affectedFoodIds = providerFoodIds; savedItems = items; return result.lastInsertRowid;
  });
  let id;
  try { id = save(); }
  catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message, code: error.code });
    throw error;
  }
  const row = db.prepare('SELECT * FROM meals WHERE id = ?').get(id);
  const returnedFoods = [...new Set(affectedFoodIds)].map(foodId => parsedFood(db.prepare('SELECT * FROM foods WHERE id = ?').get(foodId))).filter(Boolean);
  res.status(existing && mode === 'update' ? 200 : 201).json({
    recipe: {
      ...row, nutrition: parseJson(row.nutrition, {}), items: savedItems, is_recipe: true,
      recipe_details: parseJson(row.recipe_details, {}), external_refs: parseJson(row.external_refs, []),
    },
    foods: returnedFoods,
  });
}));

export default router;
