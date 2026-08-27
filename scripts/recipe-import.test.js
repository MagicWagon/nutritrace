import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

import { parseIngredientLine } from '../server/lib/recipe-import/ingredient-line.js';
import { extractJsonLdBlocks, parseRecipeJsonLd } from '../server/lib/recipe-import/jsonld.js';
import { createPinnedLookup, fetchRecipePage, isBlockedAddress, requestPinned, validateRecipeUrl } from '../server/lib/recipe-import/fetch-page.js';
import { resolveAmountFactor } from '../server/lib/recipe-import/amount.js';
import { persistRecipeImportDraft, prepareRecipeImportDraft, RECIPE_IMPORT_DRAFT_KEY } from '../src/lib/recipe-import-draft.js';

test('ingredient parser handles mixed fractions, ranges, packages, units, and notes', () => {
  assert.deepEqual(parseIngredientLine('1 1/2 cups all-purpose flour, sifted'), {
    original_text: '1 1/2 cups all-purpose flour, sifted',
    quantity: 1.5,
    quantity_max: null,
    unit: 'cup',
    name: 'all-purpose flour',
    note: 'sifted',
    package_size: null,
    parse_confidence: 'high',
  });
  assert.equal(parseIngredientLine('2–3 cloves garlic').quantity_max, 3);
  assert.equal(parseIngredientLine('½ tsp salt').quantity, 0.5);
  assert.deepEqual(parseIngredientLine('one 14-ounce can tomatoes').package_size, { amount: 14, unit: 'oz' });
  assert.equal(parseIngredientLine('salt to taste').parse_confidence, 'low');
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
  assert.doesNotMatch(source, /\bpop\(\)/);
});

test('amount resolution converts mass and food-aware volume/count without guessing', () => {
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g' }, 1, 'kg'), 10);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g', density_g_ml: 0.8 }, 1, 'cup'), 236.5882365 * 0.8 / 100);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g' }, 1, 'cup'), null);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g', alt_units: [{ abbr: 'slice', grams: 35 }] }, 2, 'slice'), 0.7);
  assert.equal(resolveAmountFactor({ portion: 1, unit: 'serving' }, 3, 'serving'), 3);
  assert.equal(resolveAmountFactor({ portion: 1, unit: 'serving' }, 1, 'piece'), null);
});
