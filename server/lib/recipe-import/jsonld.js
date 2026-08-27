import { Parser, DomUtils, parseDocument } from 'htmlparser2';
import { parseIngredientLine } from './ingredient-line.js';
import { RecipeImportError } from './errors.js';

const LIMITS = Object.freeze({ blocks: 32, blockChars: 512_000, depth: 24, nodes: 10_000, ingredients: 500, instructions: 500, text: 20_000, images: 12 });

function plainText(value, max = LIMITS.text) {
  if (value == null) return '';
  const input = String(value).slice(0, max * 2);
  return DomUtils.textContent(parseDocument(input)).replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeJsonParse(source) {
  return JSON.parse(source, (key, value) => (
    key === '__proto__' || key === 'prototype' || key === 'constructor' ? undefined : value
  ));
}

export function extractJsonLdBlocks(html) {
  const blocks = [];
  const canonicalCandidates = [];
  let active = null;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'script' && /^application\/ld\+json(?:\s*;|$)/i.test(attrs.type || '') && blocks.length < LIMITS.blocks) {
        active = '';
      }
      if (name === 'link' && /(?:^|\s)canonical(?:\s|$)/i.test(attrs.rel || '') && attrs.href) canonicalCandidates.push(attrs.href);
    },
    ontext(text) {
      if (active != null && active.length <= LIMITS.blockChars) active += text;
    },
    onclosetag(name) {
      if (name === 'script' && active != null) {
        if (active.trim() && active.length <= LIMITS.blockChars) blocks.push(active.trim());
        active = null;
      }
    },
  }, { decodeEntities: true });
  parser.write(String(html || ''));
  parser.end();
  return { blocks, canonicalCandidates };
}

function typeIncludesRecipe(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.some(type => String(type || '').split(/[\/#:]/).pop().toLowerCase() === 'recipe');
}

function walk(value, visit, depth = 0, seen = new Set(), counter = { n: 0 }) {
  if (depth > LIMITS.depth || counter.n++ > LIMITS.nodes || value == null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visit(value);
  if (Array.isArray(value)) value.forEach(item => walk(item, visit, depth + 1, seen, counter));
  else Object.values(value).forEach(item => walk(item, visit, depth + 1, seen, counter));
}

function resolveReference(value, idMap) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value['@id'] && Object.keys(value).length === 1) return idMap.get(value['@id']) || value;
  return value;
}

function imageUrls(value, idMap, out = [], depth = 0) {
  if (out.length >= LIMITS.images || depth > 5 || value == null) return out;
  const resolved = resolveReference(value, idMap);
  if (typeof resolved === 'string') out.push(resolved);
  else if (Array.isArray(resolved)) resolved.forEach(item => imageUrls(item, idMap, out, depth + 1));
  else if (typeof resolved === 'object') imageUrls(resolved.url || resolved.contentUrl || resolved['@id'], idMap, out, depth + 1);
  return [...new Set(out.map(v => String(v).trim()).filter(Boolean))].slice(0, LIMITS.images);
}

function normalizeInstructions(value, idMap, section = '', out = [], depth = 0) {
  if (out.length >= LIMITS.instructions || depth > 12 || value == null) return out;
  const resolved = resolveReference(value, idMap);
  if (typeof resolved === 'string') {
    const text = plainText(resolved);
    if (text) out.push({ section, text });
    return out;
  }
  if (Array.isArray(resolved)) {
    resolved.forEach(item => normalizeInstructions(item, idMap, section, out, depth + 1));
    return out;
  }
  if (typeof resolved !== 'object') return out;
  const type = Array.isArray(resolved['@type']) ? resolved['@type'].join(' ') : String(resolved['@type'] || '');
  const nextSection = /HowToSection/i.test(type) ? plainText(resolved.name) || section : section;
  if (resolved.itemListElement) normalizeInstructions(resolved.itemListElement, idMap, nextSection, out, depth + 1);
  else {
    const text = plainText(resolved.text || resolved.description || resolved.name);
    if (text) out.push({ section: nextSection, text, url: typeof resolved.url === 'string' ? resolved.url : '' });
  }
  return out;
}

function stringList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return list.map(v => plainText(typeof v === 'object' ? (v.name || v.text) : v, 500)).filter(Boolean);
}

function nutrition(value) {
  if (!value || typeof value !== 'object') return {};
  const fields = ['calories', 'carbohydrateContent', 'cholesterolContent', 'fatContent', 'fiberContent', 'proteinContent', 'saturatedFatContent', 'sodiumContent', 'sugarContent', 'transFatContent', 'unsaturatedFatContent', 'servingSize'];
  return Object.fromEntries(fields.filter(key => value[key] != null).map(key => [key, plainText(value[key], 200)]));
}

function authorName(value) {
  const first = Array.isArray(value) ? value[0] : value;
  return plainText(typeof first === 'object' ? first?.name : first, 500);
}

function normalizeRecipe(node, idMap, sourceUrl) {
  const ingredientsRaw = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : (node.recipeIngredient ? [node.recipeIngredient] : []);
  const ingredients = ingredientsRaw.slice(0, LIMITS.ingredients).map(value => parseIngredientLine(plainText(value, 2_000))).filter(item => item.original_text);
  const images = imageUrls(node.image, idMap);
  return {
    source: 'jsonld',
    source_url: sourceUrl,
    source_id: plainText(node['@id'] || node.url || sourceUrl, 2_000),
    name: plainText(node.name, 1_000) || 'Unnamed Recipe',
    description: plainText(node.description),
    author: authorName(node.author),
    date_published: plainText(node.datePublished, 100),
    yield_text: plainText(node.recipeYield, 500),
    categories: stringList(node.recipeCategory),
    cuisines: stringList(node.recipeCuisine),
    keywords: stringList(node.keywords),
    prep_time: plainText(node.prepTime, 100),
    cook_time: plainText(node.cookTime, 100),
    total_time: plainText(node.totalTime, 100),
    images,
    ingredients,
    instructions: normalizeInstructions(node.recipeInstructions, idMap),
    nutrition: nutrition(resolveReference(node.nutrition, idMap)),
  };
}

export function parseRecipeJsonLd(html, finalUrl) {
  const { blocks, canonicalCandidates } = extractJsonLdBlocks(html);
  const roots = [];
  const warnings = [];
  for (const block of blocks) {
    try { roots.push(safeJsonParse(block)); }
    catch { warnings.push('Ignored one malformed JSON-LD block.'); }
  }
  const idMap = new Map();
  roots.forEach(root => walk(root, node => {
    if (!Array.isArray(node) && typeof node['@id'] === 'string') {
      const existing = idMap.get(node['@id']);
      if (!existing || Object.keys(node).length > Object.keys(existing).length) idMap.set(node['@id'], node);
    }
  }));
  const recipes = [];
  const recipeNodes = new Set();
  roots.forEach(root => walk(root, node => {
    if (!Array.isArray(node) && typeIncludesRecipe(node['@type'])) recipeNodes.add(node);
  }));
  let canonicalUrl = finalUrl;
  for (const candidate of canonicalCandidates) {
    try { canonicalUrl = new URL(candidate, finalUrl).href; break; } catch {}
  }
  for (const node of recipeNodes) recipes.push(normalizeRecipe(node, idMap, canonicalUrl));
  if (!recipes.length) {
    throw new RecipeImportError(
      blocks.length ? 'invalid_recipe_jsonld' : 'no_recipe_jsonld',
      blocks.length ? 'The page contains JSON-LD, but no usable Recipe was found.' : 'The page does not expose a recipe in static JSON-LD.',
    );
  }
  return { recipes, warnings, canonical_url: canonicalUrl };
}

export { LIMITS as JSONLD_LIMITS };
