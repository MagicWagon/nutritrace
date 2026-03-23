/**
 * mealieApi.js — Mealie self-hosted recipe manager integration
 * Docs: https://docs.mealie.io/documentation/getting-started/api-usage/
 * Auth: Bearer token created at /user/profile/api-tokens in Mealie UI
 */
import { DB } from './db.js';

function _cfg() {
  const baseUrl = (DB.getSetting('mealieBaseUrl', '') || '').replace(/\/$/, '');
  const token   = DB.getSetting('mealieApiToken', '') || '';
  return { baseUrl, token };
}

function _headers(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const Mealie = {
  isConfigured() {
    const { baseUrl, token } = _cfg();
    return !!(baseUrl && token);
  },

  /** Search recipes by name. Returns list of recipe summaries (slug, name, image key). */
  async search(query, page = 1) {
    const { baseUrl, token } = _cfg();
    if (!baseUrl || !token || !query) return [];
    try {
      const filter = `name LIKE "%${query}%"`;
      const url = `${baseUrl}/api/recipes?queryFilter=${encodeURIComponent(filter)}&perPage=10&page=${page}`;
      const res = await fetch(url, { headers: _headers(token) });
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    } catch (e) {
      console.error('[Mealie] search failed:', e);
      return [];
    }
  },

  /** Get full recipe details by slug, including nutrition and image UUID. */
  async getRecipe(slug) {
    const { baseUrl, token } = _cfg();
    if (!baseUrl || !token || !slug) return null;
    try {
      const res = await fetch(`${baseUrl}/api/recipes/${slug}`, { headers: _headers(token) });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[Mealie] getRecipe failed:', e);
      return null;
    }
  },

  /** Test the connection — returns true if we get a valid response. */
  async testConnection() {
    const { baseUrl, token } = _cfg();
    if (!baseUrl || !token) return false;
    try {
      const res = await fetch(`${baseUrl}/api/recipes?perPage=1&page=1`, { headers: _headers(token) });
      return res.ok;
    } catch (e) {
      return false;
    }
  },

  /** Build the full image URL for a recipe using its UUID. */
  imageUrl(recipeId) {
    const { baseUrl } = _cfg();
    if (!baseUrl || !recipeId) return '';
    return `${baseUrl}/api/media/recipes/${recipeId}/images/original.webp`;
  },

  /**
   * Map a full Mealie recipe object to the app's food structure.
   * Mealie stores nutrition per serving. We store with portion=100, unit='serving'
   * so the diary factor = (100 * qty) / 100 = qty, giving correct per-serving calories.
   */
  mapRecipe(recipe) {
    const { baseUrl } = _cfg();
    const n = recipe.nutrition || {};
    const pf = v => parseFloat(v) || 0;

    // Try to extract a brand/source from the original URL
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
      nutrition: {
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
      },
    };
  },
};

export { Mealie };
