import test from 'node:test';
import assert from 'node:assert/strict';

import { parseIngredientLine } from '../server/lib/recipe-import/ingredient-line.js';
import { extractJsonLdBlocks, parseRecipeJsonLd } from '../server/lib/recipe-import/jsonld.js';
import { fetchRecipePage, isBlockedAddress, validateRecipeUrl } from '../server/lib/recipe-import/fetch-page.js';
import { resolveAmountFactor } from '../server/lib/recipe-import/amount.js';

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

test('amount resolution converts mass and food-aware volume/count without guessing', () => {
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g' }, 1, 'kg'), 10);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g', density_g_ml: 0.8 }, 1, 'cup'), 236.5882365 * 0.8 / 100);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g' }, 1, 'cup'), null);
  assert.equal(resolveAmountFactor({ portion: 100, unit: 'g', alt_units: [{ abbr: 'slice', grams: 35 }] }, 2, 'slice'), 0.7);
  assert.equal(resolveAmountFactor({ portion: 1, unit: 'serving' }, 3, 'serving'), 3);
  assert.equal(resolveAmountFactor({ portion: 1, unit: 'serving' }, 1, 'piece'), null);
});
