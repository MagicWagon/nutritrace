/** Deterministic ingredient-name normalization and provider candidate scoring. */

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
    reasons: [
      best.exact ? 'exact name' : best.phrase ? 'phrase match' : `${Math.round(best.coverage * 100)}% ingredient-token coverage`,
      quality ? 'complete nutrition record' : '',
      provider ? `curated USDA ${candidate.dataType}` : '',
    ].filter(Boolean),
    matchedSearchName: best.query,
  };
}

export function rankIngredientCandidates(searchNames, candidates, limit = 8) {
  const unique = new Map();
  for (const candidate of candidates || []) {
    const scored = scoreIngredientCandidate(searchNames, candidate);
    if (!scored) continue;
    const key = `${candidate?._candidateProvider || ''}:${candidate?.barcode || candidate?.fdcId || candidate?.id || normalizeIngredientName(`${candidate?.name} ${candidate?.brand}`)}`;
    const next = { ...candidate, _matchScore: scored.score, _matchReasons: scored.reasons };
    const previous = unique.get(key);
    if (!previous || next._matchScore > previous._matchScore) unique.set(key, next);
  }
  return [...unique.values()]
    .sort((a, b) => b._matchScore - a._matchScore || String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, limit);
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
