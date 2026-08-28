/**
 * mealieApi.js — Mealie self-hosted recipe manager integration
 * Docs: https://docs.mealie.io/documentation/getting-started/api-usage/
 * Auth: Bearer token created at /user/profile/api-tokens in Mealie UI
 *
 * All requests are proxied through /api/mealie/proxy to avoid CORS.
 */
import { DB } from './db.js';
import { apiUrl, isNative, getServerUrl, getAuthToken } from './platform.js';
import { Nutrition } from './nutrition.js';
import { normalizePortionUnit } from './provider-portions.js';
import { parseRecipeIngredientText } from './recipe-ingredient.js';

const KNOWN_RECIPE_UNITS = new Set([
  'g', 'mg', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup',
  'pinch', 'dash', 'clove', 'slice', 'piece', 'can', 'package', 'sprig',
  'stalk', 'bunch', 'serving', 'scoop', 'stick', 'biscuit', 'cookie', 'bar',
  'packet', 'jar', 'bag', 'box',
]);

function _cfg() {
  const baseUrl = (DB.getSetting('mealieBaseUrl', '') || '').replace(/\/$/, '');
  const token   = DB.getSetting('mealieApiToken', '') || '';
  return { baseUrl, token };
}

async function _sha256Text(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function _proxy(path) {
  const { baseUrl, token } = _cfg();
  if (!baseUrl || !token) return null;
  const csrf = !isNative ? localStorage.getItem('nt:csrf') : null;
  const res = await fetch(apiUrl('/api/mealie/proxy'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(isNative && getServerUrl() && getAuthToken() ? { 'Authorization': `Bearer ${getAuthToken()}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ baseUrl, token, path }),
  });
  if (!res.ok) return null;
  return res.json();
}

const Mealie = {
  isConfigured() {
    const { baseUrl, token } = _cfg();
    return !!(baseUrl && token);
  },

  /** Search recipes by name. Returns list of recipe summaries. */
  async search(query, page = 1) {
    if (!query) return [];
    try {
      const filter = `name LIKE "%${query}%"`;
      const data = await _proxy(`/api/recipes?queryFilter=${encodeURIComponent(filter)}&perPage=10&page=${page}`);
      return data?.items || [];
    } catch(e) {
      console.error('[Mealie] search failed:', e);
      return [];
    }
  },

  /** Paginated search returning items + pagination metadata for
      infinite-scroll callers. Same shape as API.searchByNameWithMeta and
      USDA.searchByNameWithMeta so Foods.svelte can treat all three
      external sources uniformly. Mealie returns `total` + `total_pages`
      on the response envelope, so hasMore is exact. #96. */
  async searchWithMeta(query, page = 1, perPage = 10) {
    if (!query) return { items: [], totalHits: 0, page, hasMore: false };
    try {
      const filter = `name LIKE "%${query}%"`;
      const data = await _proxy(`/api/recipes?queryFilter=${encodeURIComponent(filter)}&perPage=${perPage}&page=${page}`);
      const items = data?.items || [];
      const totalHits = typeof data?.total === 'number' ? data.total : items.length;
      const totalPages = typeof data?.total_pages === 'number' ? data.total_pages : Math.ceil(totalHits / perPage);
      const hasMore = page < totalPages;
      return { items, totalHits, page, hasMore };
    } catch(e) {
      console.error('[Mealie] search failed:', e);
      return { items: [], totalHits: 0, page, hasMore: false };
    }
  },

  /** Get full recipe details by slug, including nutrition. */
  async getRecipe(slug) {
    if (!slug) return null;
    try {
      return await _proxy(`/api/recipes/${slug}`);
    } catch(e) {
      console.error('[Mealie] getRecipe failed:', e);
      return null;
    }
  },

  /** Test the connection — returns true if the server can reach Mealie. */
  async testConnection() {
    try {
      const data = await _proxy('/api/recipes?perPage=1&page=1');
      return data != null;
    } catch {
      return false;
    }
  },

  /** Build the full image URL for a recipe (loaded directly by the browser — no CORS issue for <img>). */
  imageUrl(recipeId) {
    const { baseUrl } = _cfg();
    if (!baseUrl || !recipeId) return '';
    return `${baseUrl}/api/media/recipes/${recipeId}/images/original.webp`;
  },

  /** Commit-only credentials used by the server to copy private recipe media. */
  imageImport(recipeId) {
    const { baseUrl, token } = _cfg();
    if (!baseUrl || !token || !recipeId) return null;
    return { base_url: baseUrl, token, recipe_id: String(recipeId) };
  },

  async instanceKey() {
    const { baseUrl } = _cfg();
    if (!baseUrl) return '';
    let normalized = baseUrl;
    try {
      const parsed = new URL(baseUrl);
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      normalized = parsed.href.replace(/\/$/, '').toLowerCase();
    } catch {}
    return _sha256Text(normalized);
  },

  /**
   * Map a full Mealie recipe object to the app's food structure.
   * Nutrition is per-serving; portion=100, unit='serving' so diary qty = servings.
   */
  mapRecipe(recipe) {
    const { baseUrl } = _cfg();
    const n = recipe.nutrition || {};
    const pf = v => parseFloat(v) || 0;

    let brand = '';
    if (recipe.orgURL) {
      try { brand = new URL(recipe.orgURL).hostname.replace(/^www\./, ''); } catch {}
    }

    return {
      name:      recipe.name || 'Unnamed Recipe',
      brand,
      portion:   100,
      unit:      'serving',
      quantity:  1,
      imgUrl:    recipe.id ? `${baseUrl}/api/media/recipes/${recipe.id}/images/original.webp` : '',
      dateTime:  new Date().toISOString(),
      categories: [],
      _source:   'mealie',
      _mealieSlug: recipe.slug,
      nutrition: Nutrition.deriveSodiumSalt({
        calories:        pf(n.calories),
        proteins:        pf(n.proteinContent),
        carbohydrates:   pf(n.carbohydrateContent),
        fat:             pf(n.fatContent),
        'saturated-fat': pf(n.saturatedFatContent),
        fiber:           pf(n.fiberContent),
        sugars:          pf(n.sugarContent),
        sodium:          pf(n.sodiumContent),
        cholesterol:     pf(n.cholesterolContent),
        'trans-fat':     pf(n.transFatContent),
      }),
    };
  },

  /** Normalize a Mealie recipe into the same review draft used by URL imports. */
  normalizeRecipe(recipe) {
    const { baseUrl } = _cfg();
    const ingredientRows = recipe.recipeIngredient || recipe.recipeIngredients || [];
    const ingredients = ingredientRows.map(row => {
      const structuredQuantity = Number(row.quantity);
      const structuredUnit = typeof row.unit === 'string' ? row.unit : (row.unit?.abbreviation || row.unit?.name || '');
      const structuredFood = typeof row.food === 'string' ? row.food : (row.food?.name || '');
      const original = row.display || row.originalText || row.original_text || [row.quantity, structuredUnit, structuredFood, row.note].filter(Boolean).join(' ');
      const parsed = parseRecipeIngredientText(original);
      // Mealie versions differ: some expose quantity/unit/food fields, while
      // others only expose `display`/`originalText`. Prefer the structured
      // value when it is useful, then fall back to the display parser so a
      // line such as "1 medium apple (chopped)" stays 1 Piece instead of
      // silently inheriting the selected food's default 100 Grams.
      const quantity = Number.isFinite(structuredQuantity) && structuredQuantity > 0
        ? structuredQuantity
        : parsed.quantity;
      const parsedUnit = normalizePortionUnit(parsed.unit);
      const structuredCanonicalUnit = normalizePortionUnit(structuredUnit);
      const unit = (KNOWN_RECIPE_UNITS.has(structuredCanonicalUnit) ? structuredCanonicalUnit : parsedUnit) || '';
      const sizeOnlyFood = /^(?:(?:extra|very)\s+)?(?:small|medium|large|jumbo|mini|baby)\b/i.test(structuredFood.trim());
      const food = (!sizeOnlyFood && structuredFood.trim()) ? structuredFood.trim() : '';
      const normalizedName = food || parsed.name || row.title || original || 'Unresolved ingredient';
      const searchNames = [...new Set([
        ...(parsed.search_names || []),
        normalizedName,
      ].map(value => String(value || '').trim()).filter(Boolean))].slice(0, 3);
      const amounts = parsed.amounts?.length
        ? parsed.amounts
        : (Number.isFinite(quantity) && quantity > 0 && unit
          ? [{ quantity, unit, role: 'primary' }]
          : []);
      return {
        original_text: original || food || 'Unresolved ingredient',
        quantity: Number.isFinite(quantity) ? quantity : null,
        quantity_max: null,
        unit: unit || null,
        name: normalizedName,
        search_names: searchNames.length ? searchNames : [normalizedName],
        amounts,
        note: [parsed.note, row.note].filter(Boolean).join('; '),
        package_size: null,
        parse_confidence: parsed.parse_confidence === 'high' || food ? 'high' : parsed.parse_confidence,
        source_food_id: row.food?.id || null,
        reference_id: row.referenceId || row.reference_id || null,
      };
    });
    const instructionRows = recipe.recipeInstructions || recipe.instructions || [];
    const instructions = instructionRows.flatMap(section => {
      if (typeof section === 'string') return [{ section: '', text: section }];
      const title = section.title || section.name || '';
      const steps = section.text || section.note ? [section] : (section.steps || section.itemListElement || []);
      return steps.map(step => ({ section: title, text: typeof step === 'string' ? step : (step.text || step.note || step.title || '') })).filter(step => step.text);
    });
    const yieldValue = recipe.recipeYield || recipe.settings?.recipeYield || recipe.settings?.servings || recipe.servings;
    return {
      source: 'mealie',
      // Keep the private Mealie origin out of persisted recipe provenance.
      // The instance is represented separately by a SHA-256 key.
      source_url: `mealie:recipe:${recipe.id || recipe.slug || ''}`,
      source_id: recipe.id || recipe.slug || '',
      name: recipe.name || 'Unnamed Recipe',
      description: recipe.description || '',
      author: recipe.user?.fullName || recipe.user?.username || '',
      date_published: recipe.dateAdded || '',
      yield_text: yieldValue ? String(yieldValue) : '',
      categories: (recipe.recipeCategory || []).map(item => item.name || item).filter(Boolean),
      cuisines: (recipe.recipeCuisine || []).map(item => item.name || item).filter(Boolean),
      keywords: (recipe.tags || []).map(item => item.name || item).filter(Boolean),
      prep_time: recipe.prepTime || '', cook_time: recipe.performTime || recipe.cookTime || '', total_time: recipe.totalTime || '',
      // Private Mealie media requires the configured proxy/token and must
      // not be copied into an import draft or persisted as a raw origin URL.
      images: [],
      ingredients,
      instructions,
      nutrition: recipe.nutrition || {},
    };
  },

  async normalizeRecipeTree(recipe, seen = new Set(), depth = 0) {
    const normalized = { ...this.normalizeRecipe(recipe), source_instance: await this.instanceKey() };
    const identity = recipe.id || recipe.slug || normalized.name;
    if (seen.has(identity) || depth > 5) return normalized;
    const nextSeen = new Set(seen);
    nextSeen.add(identity);
    const rawRows = recipe.recipeIngredient || recipe.recipeIngredients || [];
    const flattened = [];
    for (let index = 0; index < rawRows.length; index++) {
      const row = rawRows[index];
      const reference = row?.referencedRecipe || row?.referenced_recipe;
      if (!reference) {
        flattened.push(normalized.ingredients[index]);
        continue;
      }
      const referenceIdentity = typeof reference === 'string' ? reference : (reference.slug || reference.id);
      if (!referenceIdentity || nextSeen.has(referenceIdentity)) {
        flattened.push({ ...normalized.ingredients[index], parse_confidence: 'low', note: `${normalized.ingredients[index]?.note || ''} Nested recipe could not be expanded.`.trim() });
        continue;
      }
      const full = Array.isArray(reference.recipeIngredient) ? reference : await this.getRecipe(reference.slug || reference.id || referenceIdentity);
      if (!full) {
        flattened.push(normalized.ingredients[index]);
        continue;
      }
      const child = await this.normalizeRecipeTree(full, nextSeen, depth + 1);
      const scale = Number(row.quantity) || 1;
      for (const ingredient of child.ingredients) {
        flattened.push({
          ...ingredient,
          quantity: ingredient.quantity != null ? ingredient.quantity * scale : ingredient.quantity,
          quantity_max: ingredient.quantity_max != null ? ingredient.quantity_max * scale : ingredient.quantity_max,
          group: [normalized.ingredients[index]?.name || full.name, ingredient.group].filter(Boolean).join(' > '),
        });
      }
    }
    return { ...normalized, ingredients: flattened.filter(Boolean) };
  },
};

export { Mealie };
