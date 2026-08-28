/** Deterministic ingredient-name normalization and provider candidate scoring. */

import { altUnitGrams, normalizePortionUnit, unitKind } from './provider-portions.js';

const SHORT_PLURALS = new Set(['gas', 'glass', 'molasses']);
const REFINEMENT_UNITS = new Set(['g','kg','mg','oz','lb','ml','l','tsp','tbsp','cup','pinch','dash','clove','slice','can','package','piece','sprig','stalk','bunch']);
const AMOUNT_ROLES = new Set(['primary', 'additional', 'equivalent']);

export function normalizeIngredientName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\b([a-z]{4,})s\b/g, (word, stem) => (
      word.endsWith('ss') || SHORT_PLURALS.has(word) ? word : stem
    ))
    .replace(/\s+/g, ' ');
}

export function normalizeBrandName(value) {
  return normalizeIngredientName(value)
    .replace(/\b(?:inc|incorporated|llc|ltd|limited|company|co|corp|corporation|brand|brands)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function candidateSupportsUnit(candidate, unit) {
  const wanted = normalizePortionUnit(unit);
  if (!wanted) return false;
  if (altUnitGrams(candidate, wanted)) return true;
  const requestedKind = unitKind(wanted);
  const baseKind = unitKind(candidate?.unit || candidate?.nutrition_basis);
  if (requestedKind === baseKind && requestedKind !== 'portion') return true;
  if (requestedKind === 'portion') return normalizePortionUnit(candidate?.unit) === wanted;
  return Number(candidate?.density_g_ml) > 0;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, row[j - 1], old);
      prev = old;
    }
  }
  return row[b.length];
}

function tokenMatches(queryToken, candidateToken) {
  return queryToken === candidateToken
    || (queryToken.length >= 4 && candidateToken.length >= 4 && editDistance(queryToken, candidateToken) <= 1);
}

function scoreOne(query, candidate) {
  const q = normalizeIngredientName(query);
  const c = normalizeIngredientName(`${candidate?.name || ''} ${candidate?.brand || ''}`);
  if (!q || !c) return null;
  const qTokens = q.split(' ');
  const cTokens = c.split(' ');
  const matchedQuery = qTokens.filter(qt => cTokens.some(ct => tokenMatches(qt, ct))).length;
  const matchedCandidate = cTokens.filter(ct => qTokens.some(qt => tokenMatches(qt, ct))).length;
  const coverage = matchedQuery / qTokens.length;
  const precision = matchedCandidate / cTokens.length;
  const phrase = c.includes(q) || q.includes(normalizeIngredientName(candidate?.name || ''));
  const exact = q === normalizeIngredientName(candidate?.name || '') || q === c;
  const meaningful = qTokens.some(qt => qt.length >= 4 && cTokens.some(ct => tokenMatches(qt, ct)));
  const eligible = exact || phrase || (coverage >= 2 / 3 && meaningful);
  if (!eligible) return null;
  const relevance = coverage * 65 + precision * 20 + (exact ? 15 : phrase ? 10 : 0);
  return { relevance, coverage, precision, exact, phrase, query: q };
}

export function scoreIngredientCandidate(searchNames, candidate) {
  const names = Array.isArray(searchNames) ? searchNames : [searchNames];
  const matches = names.map(name => scoreOne(name, candidate)).filter(Boolean);
  if (!matches.length) return null;
  const best = matches.sort((a, b) => b.relevance - a.relevance)[0];
  const quality = Math.min(5, Math.max(0, Number(candidate?.completeness || 0) * 5));
  const nutrition = candidate?.nutrition && Object.values(candidate.nutrition).some(value => Number(value) !== 0) ? 2 : 0;
  const provider = candidate?._candidateProvider === 'usda'
    && ['Foundation', 'SR Legacy', 'Survey (FNDDS)'].includes(candidate?.dataType) ? 2 : 0;
  return {
    score: Math.round((best.relevance + quality + nutrition + provider) * 10) / 10,
    relevance: Math.round(best.relevance * 10) / 10,
    reasons: [
      best.exact ? 'exact name' : best.phrase ? 'phrase match' : `${Math.round(best.coverage * 100)}% ingredient-token coverage`,
      quality ? 'complete nutrition record' : '',
      provider ? `curated USDA ${candidate.dataType}` : '',
    ].filter(Boolean),
    matchedSearchName: best.query,
  };
}

export function rankIngredientCandidates(searchNames, candidates, limit = 8, options = {}) {
  const preferredBrands = (Array.isArray(options.preferredBrands) ? options.preferredBrands : [])
    .map(normalizeBrandName).filter(Boolean);
  const preferredBrandRank = brand => {
    const normalized = normalizeBrandName(brand);
    const index = preferredBrands.findIndex(item => normalized === item || normalized.includes(item) || item.includes(normalized));
    return index < 0 ? 0 : preferredBrands.length - index;
  };
  const sourceRank = candidate => ({ local: 3, openfoodfacts: 2, usda: 1 }[candidate?._candidateProvider] || 0);
  const unique = new Map();
  for (const candidate of candidates || []) {
    const scored = scoreIngredientCandidate(searchNames, candidate);
    if (!scored) continue;
    const provider = candidate?._candidateProvider || '';
    const external = provider === 'openfoodfacts' || provider === 'usda';
    const semanticKey = `${normalizeIngredientName(candidate?.name)}\0${normalizeBrandName(candidate?.brand)}`;
    const key = external ? `external:${semanticKey}` : `${provider}:${candidate?.id || semanticKey}`;
    const convertible = options.requiredUnit ? candidateSupportsUnit(candidate, options.requiredUnit) : false;
    const brandRank = preferredBrandRank(candidate?.brand);
    const next = {
      ...candidate,
      _matchScore: scored.score,
      _relevanceScore: scored.relevance,
      _matchReasons: [...scored.reasons, convertible ? 'unit conversion available' : '', brandRank ? 'preferred brand' : ''].filter(Boolean),
      _convertible: convertible,
      _brandRank: brandRank,
      _sourceRank: sourceRank(candidate),
    };
    const previous = unique.get(key);
    if (!previous || compareCandidates(next, previous, options.brandPriority) < 0) unique.set(key, next);
  }
  return [...unique.values()]
    .sort((a, b) => compareCandidates(a, b, options.brandPriority))
    .slice(0, limit);
}

function compareCandidates(a, b, brandPriority = 'standard') {
  const relevanceDifference = Number(b._relevanceScore || 0) - Number(a._relevanceScore || 0);
  if (Math.abs(relevanceDifference) > 8) return relevanceDifference;
  if (!!a._convertible !== !!b._convertible) return a._convertible ? -1 : 1;
  if (brandPriority === 'strong' && a._brandRank !== b._brandRank) return b._brandRank - a._brandRank;
  if (a._sourceRank !== b._sourceRank) return b._sourceRank - a._sourceRank;
  if (brandPriority !== 'strong' && a._brandRank !== b._brandRank) return b._brandRank - a._brandRank;
  return relevanceDifference
    || Number(b.completeness || 0) - Number(a.completeness || 0)
    || String(a.name || '').localeCompare(String(b.name || ''))
    || String(a.brand || '').localeCompare(String(b.brand || ''));
}

export function isStrongIngredientCandidate(candidate) {
  if (!candidate) return false;
  return Number(candidate._relevanceScore || candidate._matchScore || 0) >= 65;
}

export function validateIngredientRefinement(value) {
  if (!value || typeof value !== 'object') return null;
  const search_names = [...new Set((Array.isArray(value.search_names) ? value.search_names : [])
    .map(name => String(name || '').trim().slice(0, 160))
    .filter(Boolean))].slice(0, 3);
  if (!search_names.length) return null;
  const amounts = (Array.isArray(value.amounts) ? value.amounts : []).flatMap(amount => {
    const quantity = Number(amount?.quantity);
    const unit = String(amount?.unit || '').toLowerCase();
    const role = String(amount?.role || 'primary').toLowerCase();
    return Number.isFinite(quantity) && quantity > 0 && REFINEMENT_UNITS.has(unit) && AMOUNT_ROLES.has(role)
      ? [{ quantity, unit, role }]
      : [];
  }).slice(0, 6);
  return {
    search_names,
    name: search_names[0],
    brand: typeof value.brand === 'string' ? value.brand.trim().slice(0, 120) : '',
    note: typeof value.note === 'string' ? value.note.trim().slice(0, 500) : '',
    amounts,
    normalization_source: 'ai',
  };
}
