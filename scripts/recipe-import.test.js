import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

import { parseIngredientLine } from '../server/lib/recipe-import/ingredient-line.js';
import { extractJsonLdBlocks, parseRecipeJsonLd } from '../server/lib/recipe-import/jsonld.js';
import { createPinnedLookup, fetchRecipePage, isBlockedAddress, requestPinned, validateRecipeUrl } from '../server/lib/recipe-import/fetch-page.js';
import { resolveAmountFactor } from '../server/lib/recipe-import/amount.js';
import { persistRecipeImportDraft, prepareRecipeImportDraft, RECIPE_IMPORT_DRAFT_KEY } from '../src/lib/recipe-import-draft.js';
import { normalizeIngredientName, normalizeIngredientSearchText, rankIngredientCandidates, validateIngredientRefinement } from '../src/lib/ingredient-match.js';
import { densityFromAltUnits, displayUnitName, normalizePortionUnit, parseOffAltUnits, parseUsdaAltUnits } from '../src/lib/provider-portions.js';

test('ingredient parser handles mixed fractions, ranges, packages, units, and notes', () => {
  assert.deepEqual(parseIngredientLine('1 1/2 cups all-purpose flour, sifted'), {
    original_text: '1 1/2 cups all-purpose flour, sifted',
    quantity: 1.5,
    quantity_max: null,
    unit: 'cup',
    name: 'all-purpose flour',
    note: 'sifted',
    package_size: null,
    search_names: ['all-purpose flour'],
    amounts: [{ quantity: 1.5, unit: 'cup', role: 'primary' }],
    parse_confidence: 'high',
  });
  assert.equal(parseIngredientLine('2–3 cloves garlic').quantity_max, 3);
  assert.equal(parseIngredientLine('½ tsp salt').quantity, 0.5);
  assert.deepEqual(parseIngredientLine('one 14-ounce can tomatoes').package_size, { amount: 14, unit: 'oz' });
  assert.equal(parseIngredientLine('salt to taste').parse_confidence, 'low');
});

test('ingredient parser removes equivalent measures and separates explicit alternatives', () => {
  const sugar = parseIngredientLine('1/2 cup plus 2 tablespoons (133g) light brown sugar, packed');
  assert.equal(sugar.name, 'light brown sugar');
  assert.deepEqual(sugar.search_names, ['light brown sugar']);
  assert.deepEqual(sugar.amounts, [
    { quantity: 0.5, unit: 'cup', role: 'primary' },
    { quantity: 2, unit: 'tbsp', role: 'additional' },
    { quantity: 133, unit: 'g', role: 'equivalent' },
  ]);
  assert.equal(sugar.note, 'packed');

  const butter = parseIngredientLine('8 tablespoons (113g) unsalted butter, at room temperature');
  assert.equal(butter.name, 'unsalted butter');
  assert.deepEqual(butter.amounts.at(-1), { quantity: 113, unit: 'g', role: 'equivalent' });

  const flour = parseIngredientLine('1 cup (120g) King Arthur Unbleached All-Purpose Flour or King Arthur Gluten-Free Measure for Measure Flour');
  assert.deepEqual(flour.search_names, [
    'King Arthur Unbleached All-Purpose Flour',
    'King Arthur Gluten-Free Measure for Measure Flour',
  ]);

  const oats = parseIngredientLine('1/2 cup (57g) King Arthur Rolled Oats or 1/2 cup (45g) old-fashioned rolled oats');
  assert.deepEqual(oats.search_names, ['King Arthur Rolled Oats', 'old-fashioned rolled oats']);
});

test('ingredient candidate scoring excludes irrelevant products and ranks relevant names', () => {
  assert.equal(normalizeIngredientName("Confectioners' Sugars"), 'confectioner sugar');
  const ranked = rankIngredientCandidates(['light brown sugar'], [
    { name: 'Delikatess Geräucherter Schinkenspeck', brand: 'Dulano', barcode: '1', _candidateProvider: 'openfoodfacts' },
    { name: 'Organic Light Brown Sugar', brand: 'Store', barcode: '2', completeness: 0.8, nutrition: { calories: 380 }, _candidateProvider: 'openfoodfacts' },
    { name: 'Brown Sugar', brand: '', fdcId: '3', dataType: 'Foundation', nutrition: { calories: 380 }, _candidateProvider: 'usda' },
  ]);
  assert.deepEqual(ranked.map(item => item.barcode || item.fdcId), ['2', '3']);
  assert.ok(ranked.every(item => item._matchReasons.length));
});

test('ingredient matching ignores preparation directions but preserves meaningful food terms', () => {
  assert.equal(normalizeIngredientSearchText('walnuts, finely chopped'), 'walnut');
  assert.equal(normalizeIngredientSearchText('peanut butter optional'), 'peanut butter');
  const walnut = rankIngredientCandidates(['walnut chopped'], [
    { name: 'Walnuts', unit: 'g', _candidateProvider: 'local' },
  ]);
  const peanut = rankIngredientCandidates(['peanut butter optional'], [
    { name: 'Peanut Butter', brand: 'Kirkland Signature', unit: 'g', _candidateProvider: 'openfoodfacts' },
  ]);
  assert.equal(walnut.length, 1);
  assert.equal(peanut.length, 1);
});

test('provider portions normalize household measures into grams per unit', () => {
  assert.deepEqual(parseOffAltUnits({ code: '1', serving_size: '2 tablespoons (30 g)', serving_quantity: 30, serving_quantity_unit: 'g' }), [{
    abbr: 'tbsp', grams: 15, label: '2 tablespoons (30 g)', source: 'openfoodfacts', source_id: '1', source_amount: 2, source_grams: 30,
  }]);
  assert.deepEqual(parseOffAltUnits({ serving_size: '30 g' }), []);
  assert.deepEqual(parseUsdaAltUnits({ fdcId: 2, foodPortions: [{ amount: 0.5, gramWeight: 40, measureUnit: { name: 'cup' }, portionDescription: '1/2 cup' }] }), [{
    abbr: 'cup', grams: 80, label: '1/2 cup', source: 'usda', source_id: '2', source_amount: 0.5, source_grams: 40,
  }]);
  assert.ok(Math.abs(densityFromAltUnits([{ abbr: 'cup', grams: 80 }]) - 0.33814) < 0.000001);
});

test('recipe units normalize aliases and display full names', () => {
  assert.equal(normalizePortionUnit('c'), 'cup');
  assert.equal(normalizePortionUnit('Tablespoons'), 'tbsp');
  assert.equal(displayUnitName('cup', 1, 'en'), 'Cup');
  assert.equal(displayUnitName('cup', 2, 'en'), 'Cups');
  assert.equal(displayUnitName('g', 2, 'en'), 'Grams');
});

test('candidate ranking prefers conversion and source order while supporting strong brands', () => {
  const candidates = [
    { id: 1, name: 'Almond milk', brand: '', unit: 'g', _candidateProvider: 'local' },
    { barcode: '2', name: 'Almond milk', brand: 'Random', unit: 'g', alt_units: [{ abbr: 'cup', grams: 240 }], _candidateProvider: 'openfoodfacts' },
    { fdcId: 3, name: 'Almond milk', brand: 'Kirkland Signature', unit: 'g', alt_units: [{ abbr: 'cup', grams: 240 }], _candidateProvider: 'usda' },
  ];
  const standard = rankIngredientCandidates(['almond milk'], candidates, 10, { requiredUnit: 'cup', preferredBrands: ['Kirkland Signature'], brandPriority: 'standard' });
  assert.equal(standard[0].barcode, '2');
  const strong = rankIngredientCandidates(['almond milk'], candidates, 10, { requiredUnit: 'cup', preferredBrands: ['Kirkland Signature'], brandPriority: 'strong' });
  assert.equal(strong[0].fdcId, 3);
});

test('external semantic duplicates collapse silently to the stronger record', () => {
  const ranked = rankIngredientCandidates(['dark chocolate chips'], [
    { barcode: '1', name: 'Dark Chocolate Chips', brand: '', completeness: 0.4, _candidateProvider: 'openfoodfacts' },
    { barcode: '2', name: 'dark chocolate chips', brand: '', completeness: 0.9, nutrition: { calories: 500 }, _candidateProvider: 'openfoodfacts' },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].barcode, '2');
});

test('AI ingredient refinements are bounded and reject unsafe shapes', () => {
  assert.equal(validateIngredientRefinement({ amounts: [] }), null);
  const refined = validateIngredientRefinement({
    search_names: [' unsalted butter ', 'unsalted butter', 'butter', 'ignored fourth'],
    brand: 'x'.repeat(200),
    note: 'room temperature',
    amounts: [
      { quantity: 113, unit: 'G', role: 'equivalent' },
      { quantity: -1, unit: 'g', role: 'primary' },
      { quantity: 1, unit: 'bucket', role: 'primary' },
    ],
  });
  assert.deepEqual(refined.search_names, ['unsalted butter', 'butter', 'ignored fourth']);
  assert.equal(refined.brand.length, 120);
  assert.deepEqual(refined.amounts, [{ quantity: 113, unit: 'g', role: 'equivalent' }]);
  assert.equal(refined.normalization_source, 'ai');
});

test('JSON-LD extractor finds scripts and canonical links without treating other scripts as data', () => {
  const html = `<!doctype html><html><head>
    <link rel="canonical" href="/canonical-recipe">
    <script>window.nope = true</script>
    <script type="application/ld+json">{"@type":"Recipe","name":"Soup"}</script>
  </head></html>`;
  const found = extractJsonLdBlocks(html);
  assert.equal(found.blocks.length, 1);
  assert.equal(found.canonicalCandidates[0], '/canonical-recipe');
});

test('recipe JSON-LD supports @graph, @type arrays, image objects, sections, and malformed siblings', () => {
  const html = `<!doctype html><html><head>
    <script type="application/ld+json">{bad json</script>
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@id': '#photo', '@type': 'ImageObject', contentUrl: '/photo.webp' },
        {
          '@id': '#recipe', '@type': ['Thing', 'Recipe'], name: '<b>Tomato Soup</b>',
          image: { '@id': '#photo' }, recipeYield: '4 servings',
          recipeIngredient: ['2–3 cloves garlic', 'one 14-ounce can tomatoes'],
          recipeInstructions: [{ '@type': 'HowToSection', name: 'Soup', itemListElement: [
            { '@type': 'HowToStep', text: 'Cook &amp; stir.' },
          ] }],
          nutrition: { calories: '120 calories', proteinContent: '4 g' },
        },
      ],
    })}</script>
  </head></html>`;
  const result = parseRecipeJsonLd(html, 'https://recipes.example/soup');
  assert.equal(result.recipes.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.recipes[0].name, 'Tomato Soup');
  assert.deepEqual(result.recipes[0].images, ['/photo.webp']);
  assert.equal(result.recipes[0].ingredients[0].quantity_max, 3);
  assert.deepEqual(result.recipes[0].instructions[0], { section: 'Soup', text: 'Cook & stir.', url: '' });
});

test('recipe JSON-LD returns every recipe for explicit user selection', () => {
  const html = `<script type="application/ld+json">${JSON.stringify([
    { '@type': 'Recipe', name: 'A', recipeIngredient: ['1 cup rice'] },
    { '@type': 'Recipe', name: 'B', recipeIngredient: ['1 cup beans'] },
  ])}</script>`;
  assert.deepEqual(parseRecipeJsonLd(html, 'https://example.test').recipes.map(r => r.name), ['A', 'B']);
});

test('URL security blocks credentials and non-public address ranges', () => {
  assert.throws(() => validateRecipeUrl('file:///etc/passwd'), error => error.code === 'invalid_url');
  assert.throws(() => validateRecipeUrl('https://user:pass@example.com'), error => error.code === 'invalid_url');
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '::1', 'fd00::1', '2001:db8::1']) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  assert.equal(isBlockedAddress('93.184.216.34'), false);
  assert.equal(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
});

test('fetcher pins validated DNS, validates redirects, and returns bounded HTML', async () => {
  const calls = [];
  const resolver = async hostname => [{ address: hostname === 'one.example' ? '93.184.216.34' : '93.184.216.35', family: 4 }];
  const requester = async (url, pinned) => {
    calls.push({ url: url.href, pinned });
    if (url.hostname === 'one.example') return { status: 302, headers: { location: 'https://two.example/recipe' }, body: Buffer.alloc(0), bytes: 0 };
    return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<!doctype html><html></html>'), bytes: 28 };
  };
  const result = await fetchRecipePage('https://one.example/start', { resolver, requester });
  assert.equal(result.finalUrl, 'https://two.example/recipe');
  assert.equal(result.redirects, 1);
  assert.deepEqual(calls.map(c => c.pinned.address), ['93.184.216.34', '93.184.216.35']);
});

test('fetcher refuses a hostname when any DNS answer is private', async () => {
  const resolver = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];
  await assert.rejects(fetchRecipePage('https://example.test', { resolver, requester: async () => assert.fail('request must not run') }), error => error.code === 'blocked_host');
});

test('pinned lookup supports scalar and all-address Node callback modes', async () => {
  const lookup = createPinnedLookup({ address: '93.184.216.34', family: 4 });
  const scalar = await new Promise((resolve, reject) => lookup('example.test', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  const all = await new Promise((resolve, reject) => lookup('example.test', { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
  assert.deepEqual(scalar, { address: '93.184.216.34', family: 4 });
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
});

test('pinned requester works with the active Node address-selection behavior', async t => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html></html>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await requestPinned(
    new URL(`http://recipe.example:${port}/`),
    { address: '127.0.0.1', family: 4 },
    { timeoutMs: 2_000, maxCompressedBytes: 1_024 }
  );
  assert.equal(response.status, 200);
  assert.match(response.body.toString('utf8'), /<!doctype html>/);
});

test('recipe import drafts validate recipes and clamp persisted selection', () => {
  const recipe = { name: 'Mealie Soup', ingredients: [], instructions: [] };
  const draft = { source: 'mealie', recipes: [recipe], warnings: [] };
  assert.deepEqual(prepareRecipeImportDraft(draft, 99), { result: draft, selectedIndex: 0, recipe });
  assert.equal(prepareRecipeImportDraft(draft, -3).selectedIndex, 0);
  assert.equal(prepareRecipeImportDraft(null), null);
  assert.equal(prepareRecipeImportDraft({ recipes: [] }), null);
  assert.equal(prepareRecipeImportDraft({ recipes: [null] }), null);
  assert.equal(prepareRecipeImportDraft({ recipes: [{ name: 'No image', ingredients: [] }] }).recipe.images, undefined);
});

test('Mealie handoff persists a review draft before route navigation', () => {
  const values = new Map();
  const storage = {
    setItem(key, value) { values.set(key, value); },
    getItem(key) { return values.get(key) ?? null; },
  };
  const recipe = { name: 'Mealie Soup', ingredients: [], instructions: [] };
  const draft = { source: 'mealie', recipes: [recipe], warnings: [] };

  assert.equal(persistRecipeImportDraft(storage, draft), true);
  assert.deepEqual(JSON.parse(storage.getItem(RECIPE_IMPORT_DRAFT_KEY)), {
    result: draft,
    selectedIndex: 0,
    resolutions: [],
  });
  assert.equal(persistRecipeImportDraft(storage, { recipes: [] }), false);

  const foodsSource = readFileSync(new URL('../src/routes/Foods.svelte', import.meta.url), 'utf8');
  const persistAt = foodsSource.indexOf('persistRecipeImportDraft(localStorage, draft)');
  const navigateAt = foodsSource.indexOf("push('/recipe-import')", persistAt);
  assert.ok(persistAt >= 0 && navigateAt > persistAt);
});

test('recipe import UI restores drafts safely and Back always returns to Foods', () => {
  const source = readFileSync(new URL('../src/routes/RecipeImport.svelte', import.meta.url), 'utf8');
  assert.match(source, /const transientDraft = editorState\.recipeImportDraft/);
  assert.match(source, /!transientDraft && Array\.isArray\(saved\?\.resolutions\)/);
  assert.match(source, /restoringDraft/);
  assert.match(source, /recipe\?\.images\?\.\[0\]/);
  assert.match(source, /on:click=\{\(\) => push\('\/foods'\)\}/);
  assert.match(source, /recipe_import\.ai_refine/);
  assert.match(source, /on:click=\{\(\) => requestAiRefinement\(index\)\}/);
  assert.match(source, /role === 'equivalent'/);
  assert.match(source, /rankIngredientCandidates/);
  assert.match(source, /<Sheet bind:open=\{searchSheetOpen\}/);
  assert.match(source, /<select class="select unit-select"/);
  assert.doesNotMatch(source, /class="input unit-input"/);
  assert.match(source, /displayUnitName\(row\.unit/);
  assert.match(source, /provider_food:/);
  assert.match(source, /Import without nutrition/);
  assert.match(source, /Promise\.allSettled\(jobs\)/);
  assert.match(source, /conversionEstimateQueue/);
  assert.match(source, /container-type: inline-size/);
  assert.match(source, /mealie_image:/);
  assert.doesNotMatch(source, /\bpop\(\)/);
});

test('recipe commit stages provider foods atomically and returns cache hydration data', () => {
  const route = readFileSync(new URL('../server/routes/recipe-import.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/lib/api-cached.js', import.meta.url), 'utf8');
  assert.match(route, /resolution\.provider_food/);
  assert.match(route, /const save = db\.transaction/);
  assert.match(route, /recipe:\s*\{/);
  assert.match(route, /foods: returnedFoods/);
  assert.match(route, /importMealieRecipeImage/);
  assert.match(api, /for \(const serverFood of response\.foods/);
  assert.match(api, /dbUpsertFromServer\('meals', response\.recipe\)/);
});

test('amount resolution converts mass and food-aware volume/count without guessing', () => {
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g' }, 1, 'kg'), 10);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g', density_g_ml: 0.8 }, 1, 'cup'), 236.5882365 * 0.8 / 100);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g', density_g_ml: 0.8 }, 1, 'c'), 236.5882365 * 0.8 / 100);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g' }, 1, 'cup'), null);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g', alt_units: [{ abbr: 'slice', grams: 35 }] }, 2, 'slice'), 0.7);
  assert.equal(resolveAmountFactor({ portion: 1, unit: 'serving' }, 3, 'serving'), 3);
  assert.equal(resolveAmountFactor({ portion: 1, unit: 'serving' }, 1, 'piece'), null);
});
