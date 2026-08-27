# Full recipe import from URLs and Mealie

Status: implemented (2026-08-27)  
Scope: direct recipe-webpage import, Schema.org JSON-LD extraction, Mealie import, ingredient-to-food resolution, provider fallback, recipe diary explosion, and ingredient replacement  
Primary outcome: pasting a public recipe URL or choosing a Mealie result creates a real NutriTrace recipe whose ingredients are linked to NutriTrace foods and can be reviewed, corrected, and independently adjusted after the recipe is logged.

## Product decisions

1. Import a recipe webpage or Mealie recipe into the **Recipes** catalogue (`meals.is_recipe = 1`), not into the Foods catalogue as one aggregate food.
2. Keep the saved recipe immutable when a logged serving is exploded. Quantity changes, removals, and swaps affect only that diary occurrence.
3. Never silently choose a fuzzy or provider result. Only a durable prior mapping or a unique normalized local-food match may be accepted automatically. All other candidates are shown for confirmation.
4. Do not silently omit an ingredient. Every direct or nested ingredient must end in one of these explicit states:
   - mapped to an existing NutriTrace food;
   - imported from an enabled provider such as Open Food Facts or USDA;
   - created manually as a new NutriTrace food;
   - acknowledged as an unresolved zero-nutrition placeholder.
5. Preserve the Mealie quantity, unit, preparation note, original text, and source IDs even after the ingredient is mapped. These are provenance, not nutrition data.
6. Provider nutrition remains a snapshot on the NutriTrace food/recipe item. Later upstream changes must not rewrite historical diary totals.
7. Direct URL import is server-side. The browser must not fetch arbitrary pages because CORS makes it unreliable and moving the fetch client-side would bypass centralized SSRF, redirect, size, and timeout controls.
8. Schema.org JSON-LD is the portable baseline. Site-specific DOM scrapers are not required for the first release and must be isolated adapters if added later.
9. Import is always preview-first. Fetching/parsing a URL never writes foods or recipes, and the final confirmation is one atomic bundle write.
10. Direct URL and Mealie source fetching require a NutriTrace server connection in the first release. Standalone Android must show that limitation before accepting a URL; it must not attempt a weaker WebView/Capacitor fetch. Recipes already imported on a connected installation remain fully usable offline. A future standalone fetcher requires a native transport with equivalent DNS pinning and redirect validation.

## Current state and gaps

- There is no route, service, or dependency that fetches a recipe webpage or parses JSON-LD. No code currently reads `Recipe`, `recipeIngredient`, `recipeInstructions`, or `recipeYield` Schema.org fields.
- There is no recipe URL input or meaningful loading/error state. A URL entered into an ordinary search is treated as search text and can collapse to an empty result.
- [`src/lib/mealieApi.js`](../src/lib/mealieApi.js) fetches the full recipe but `mapRecipe()` only maps aggregate per-serving nutrition.
- [`src/routes/Foods.svelte`](../src/routes/Foods.svelte) sends a selected Mealie result to `FoodEditor`, so it is saved as a single food.
- [`src/routes/MealEditor.svelte`](../src/routes/MealEditor.svelte) already saves recipes as `meals` rows containing embedded food snapshots in `items[]`.
- [`src/stores/diary.js`](../src/stores/diary.js) and [`src/routes/Diary.svelte`](../src/routes/Diary.svelte) already support “Split Recipe,” editable split children, and child removal. This should be extended, not replaced.
- Split children cannot currently be swapped through the food picker.
- Recipe weight calculation currently has unsafe generic assumptions such as `cup = 240 g`, `piece = 100 g`, and `ml = g`. Imported quantities need food-aware conversions or an explicit user decision.
- Foods and meals do not have durable external provenance. A renamed local food cannot reliably be recognized as the same Mealie ingredient on the next import.
- Native Android is local-first, so every new persisted field and bundle write must be supported in both server SQLite and [`src/lib/db-native.js`](../src/lib/db-native.js), then round-trip through sync.

## Direct URL input and fetch contract

Add an `Import from URL` action to the Recipes tab and recipe editor. It opens a focused sheet with a URL input, example text, and explicit states for fetching, parsing, selecting a recipe, reviewing, and failure. The action calls a new authenticated endpoint such as:

```http
POST /api/recipes/import/preview
Content-Type: application/json

{ "url": "https://example.com/recipe" }
```

The endpoint returns a normalized import draft and diagnostics, but performs no database writes. Keep remote HTML out of logs and never return it to the browser.

On standalone Android, disable the network-backed action with a concise `Connect to a NutriTrace server to import recipe webpages` explanation. Do not display a working-looking control that can fail silently.

### URL validation and SSRF controls

Implement the fetcher in a new server module such as `server/lib/recipe-import/fetch-page.js`. Treat it as a security boundary:

- accept only absolute `http:` and `https:` URLs; prefer HTTPS and show a warning for HTTP;
- reject embedded credentials, non-standard URL ambiguity, and hostnames/IPs resolving to loopback, private, link-local, multicast, reserved, or cloud-metadata ranges for both IPv4 and IPv6;
- resolve and pin the approved IP for the actual socket connection so validation is not vulnerable to DNS rebinding;
- disable automatic redirects and validate every redirect target with the same policy; cap redirects at five;
- set connection and total timeouts, a compressed and decompressed response limit (recommended 2 MB), and a maximum JSON-LD block size/count;
- accept HTML/XHTML content types only, with conservative sniffing for common misconfigured sites;
- use a clear NutriTrace user agent and normal HTML accept headers; do not forward user cookies, auth headers, referrers, or Mealie credentials;
- rate-limit previews per user/IP and bound concurrent outbound fetches;
- do not execute JavaScript or use a headless browser in the baseline implementation;
- redact query strings and recipe content from logs. Log a request correlation ID, hostname, timings, byte count, redirect count, parser result code, and recipe count only.

Return stable user-facing error codes such as `invalid_url`, `blocked_host`, `fetch_timeout`, `too_many_redirects`, `response_too_large`, `not_html`, `no_recipe_jsonld`, `invalid_recipe_jsonld`, and `multiple_recipes`. The UI maps each code to a useful message and preserves the URL for correction/retry.

### HTML and JSON-LD extraction

Use a maintained HTML parser rather than regex to find `<script type="application/ld+json">` elements. Parse blocks defensively; one malformed block must not discard other valid blocks. The extractor must:

- accept a top-level object, array, nested arrays, and `@graph`;
- identify `@type: "Recipe"` and arrays containing `Recipe`, case-insensitively for practical compatibility;
- follow in-document `@id` references when the referenced node exists in the same JSON-LD graph, with cycle and depth guards;
- support pages containing breadcrumbs, organizations, videos, and multiple recipes without confusing them for the recipe;
- when multiple recipes exist, return summaries so the user can choose instead of silently selecting the first;
- normalize HTML entities and plain-text fields without rendering or preserving executable markup;
- use the final response URL plus `mainEntityOfPage`, `url`, and canonical-link metadata to retain a canonical source URL, subject to the same URL policy;
- ignore prototype-pollution keys and cap nesting, string lengths, instruction count, ingredient count, and image candidates.

Normalize these Schema.org fields where present: `name`, `description`, `image` (string, array, `ImageObject`), `author`, `datePublished`, `recipeYield`, `recipeCategory`, `recipeCuisine`, `keywords`, `prepTime`, `cookTime`, `totalTime`, `recipeIngredient`, `recipeInstructions`, `nutrition`, and `aggregateRating`. Durations use strict ISO 8601 parsing; invalid values remain source text rather than becoming invented numbers.

`recipeInstructions` must support strings, `HowToStep`, `HowToSection`, arrays, and nested `itemListElement`, preserving section titles and order. Sanitize text and URLs before returning the draft.

### Ingredient-line parsing

JSON-LD ingredients are usually strings, not structured foods. Add a pure parser such as `server/lib/recipe-import/ingredient-line.js` that preserves the original line and extracts best-effort fields:

```json
{
  "original_text": "1 1/2 cups flour, sifted",
  "quantity": 1.5,
  "quantity_max": null,
  "unit": "cup",
  "name": "flour",
  "note": "sifted",
  "parse_confidence": "high"
}
```

Support integers, decimals, Unicode and ASCII vulgar/mixed fractions, ranges, parenthetical package sizes, optional quantities, common plural/abbreviated units, and lines such as `salt to taste` or `one 14-ounce can tomatoes`. Keep ambiguous text intact and mark it for review. Never use a low-confidence parse to silently calculate nutrition. Locale-specific decimal and unit parsing should be explicit and fixture-driven rather than guessed from the server locale.

The normalized URL draft and normalized Mealie draft must converge on the same source-neutral shape before matching or UI code runs.

## Mealie input contract

Normalize Mealie responses at the integration boundary instead of letting API-version-specific shapes leak into UI code. Current Mealie recipe ingredients may contain structured `quantity`, `unit`, `food`, `note`, `display`, `originalText`, `referenceId`, and `referencedRecipe` values. `unit` and `food` can be objects or strings, and unparsed rows may contain their full text in `note`/`originalText`.

Reference the upstream schemas while implementing:

- [Mealie recipe ingredient schema](https://github.com/mealie-recipes/mealie/blob/mealie-next/mealie/schema/recipe/recipe_ingredient.py)
- [Mealie recipe TypeScript types](https://github.com/mealie-recipes/mealie/blob/mealie-next/frontend/app/lib/api/types/recipe.ts)

Add fixtures captured from at least the oldest supported Mealie release and the current release. The normalizer, not the rest of NutriTrace, owns compatibility differences.

Both sources implement the same adapter contract:

```js
previewRecipeSource(input, context) -> {
  source,
  sourceIdentity,
  recipes: [normalizedRecipeDraft],
  warnings,
  diagnostics
}
```

The matching, unit-resolution, review, and persistence layers must not branch on JSON-LD versus Mealie except when displaying source provenance.

## Target data model

### Food and recipe provenance

Add nullable JSON text column `external_refs` to both `foods` and `meals`:

```json
[
  {
    "provider": "mealie",
    "instance": "sha256:normalized-base-url",
    "kind": "food",
    "id": "mealie-food-uuid"
  },
  {
    "provider": "openfoodfacts",
    "kind": "product",
    "id": "barcode"
  },
  {
    "provider": "schemaorg",
    "instance": "sha256:canonical-origin",
    "kind": "recipe",
    "id": "sha256:canonical-url"
  }
]
```

- Hash the normalized Mealie base URL; never store the API key.
- Store the human-usable canonical recipe URL in `recipe_details.source_url`, but use a normalized URL hash for idempotency and external-reference matching. Strip fragments and known tracking parameters before hashing; do not strip unknown parameters that may identify the recipe.
- Allow multiple references because one local food can be linked to both a Mealie ingredient and an OFF/USDA record.
- Treat the tuple `(provider, instance, kind, id)` as the logical identity.
- Normalize, deduplicate, and size-limit the array at every write boundary.
- Concurrency protection is best-effort because SQLite cannot place a simple unique index over a JSON array. The bundle-import transaction must recheck references before inserting.

Add nullable JSON text column `recipe_details` to `meals` so the import can retain relevant non-nutrition recipe data without turning the `notes` string into an undocumented format:

```json
{
  "description": "...",
  "instructions": [{ "title": "...", "text": "..." }],
  "source_url": "...",
  "prep_time": "...",
  "cook_time": "...",
  "total_time": "...",
  "categories": ["..."],
  "tags": ["..."]
}
```

Render this data in the recipe detail/editor view. Keep user-authored `notes` separate.

### Imported recipe item shape

Continue using `meals.items[]` as the canonical ingredient list. Each resolved ingredient remains a normal embedded NutriTrace food snapshot and gains a small `source_ingredient` object:

```json
{
  "id": 42,
  "food_server_id": 42,
  "name": "All-purpose flour",
  "portion": 240,
  "unit": "g",
  "quantity": 1,
  "nutrition": { "calories": 873 },
  "source_ingredient": {
    "provider": "mealie",
    "instance": "sha256:...",
    "food_id": "...",
    "reference_id": "...",
    "original_quantity": 2,
    "original_unit": "cup",
    "original_text": "2 cups all-purpose flour",
    "note": "sifted",
    "resolution": "local_exact"
  }
}
```

`portion` and `nutrition` represent the resolved total amount used in the whole saved recipe; `quantity` remains `1`, matching current `MealEditor` behavior. `source_ingredient` is retained in the recipe but may be omitted from the compact diary reference once split children have stable identities.

### Unresolved placeholders

An acknowledged placeholder is still an item so “all ingredients” is truthful:

- `type: "unresolved_ingredient"`;
- original Mealie name/text, amount, unit, and note;
- empty nutrition;
- no food ID;
- a visible warning in the recipe editor/detail view.

Placeholders must be replaceable later. They contribute zero until mapped and must never be presented as nutritionally complete.

### Migrations and sync

Update all of the following together:

- server schema/migrations in [`server/db.js`](../server/db.js);
- server food and meal parse/write routes;
- native schema and migrations in [`src/lib/db-native.js`](../src/lib/db-native.js);
- HTTP and cached mapping helpers in [`src/lib/api.js`](../src/lib/api.js) and [`src/lib/api-cached.js`](../src/lib/api-cached.js);
- native push/pull serialization in [`server/routes/sync.js`](../server/routes/sync.js) and [`src/lib/sync.js`](../src/lib/sync.js);
- backup/import/export paths so provenance and recipe details survive restore.

JSON fields must be parsed to objects/arrays at API boundaries and serialized only in database helpers.

## Import pipeline

### 1. Fetch and normalize

For direct URLs, the server preview route runs the guarded page fetcher, extracts JSON-LD recipes, parses ingredient lines, and returns source-neutral normalized drafts. If several recipes are present, the user selects one before matching begins.

For Mealie, replace `Mealie.mapRecipe()` with two explicit operations in a new module such as `src/lib/mealie-import.js`:

- `normalizeMealieRecipe(raw, instanceKey)` produces an import draft.
- `materializeRecipe(draft, resolutions)` produces the final NutriTrace bundle.

Both normalized drafts include recipe identity, metadata, yield, image candidates, direct ingredients, ingredient groups, instructions, canonical source URL, source warnings, and—when applicable—nested referenced recipes.

For nested `referencedRecipe` ingredients:

- fetch missing referenced recipe details through the existing Mealie proxy;
- recursively flatten leaf ingredients using the parent quantity as a scale;
- retain a breadcrumb/group label such as `Sauce > Garlic`;
- guard against cycles using Mealie recipe IDs/slugs;
- cap recursion depth and total ingredient count, returning a visible import error instead of truncating silently.

### 2. Resolve against local foods

Load the local food catalogue once and build normalized indexes. Matching order:

1. Exact `external_refs` match for the Mealie instance and `food.id`.
2. Exact barcode/provider reference if Mealie extras expose one.
3. Unique normalized local name plus compatible brand.
4. Unique normalized local alias/name after conservative singularization and punctuation/Unicode normalization.
5. Fuzzy local candidates for review only.

Normalization should lowercase, Unicode-normalize, collapse whitespace, strip punctuation, and keep meaningful descriptors such as “whole milk” or “low sodium.” Preparation text such as “diced” should come from Mealie’s note/original fields, not be globally stripped from food names.

Auto-resolve only steps 1–4 when there is exactly one compatible candidate. Multiple exact candidates require review.

### 3. Search enabled nutrition providers

For unresolved ingredients, query enabled providers through a small provider adapter interface:

```js
searchIngredient({ name, brand, barcode, page, signal })
  -> [{ provider, providerId, food, score, reasons }]
```

Initial adapters:

- Open Food Facts using `API.lookupBarcode`, `API.searchByName`, and product hydration where available;
- USDA using `USDA.lookupBarcode`/`USDA.searchByName` when enabled and configured.

Search providers concurrently with bounded concurrency, cancellation, a short debounce, and per-import caching so repeated “salt” ingredients do not produce repeated network calls. Honor OFF local-only/air-gap settings.

Candidate scoring may order the review list but must not silently select a provider hit. Score using:

- normalized name/token similarity;
- exact barcode/provider ID;
- brand agreement;
- food data type/quality and nutrition completeness;
- unit compatibility and usable serving metadata;
- penalties for conflicting branded/generic identity.

Prefer generic USDA/Foundation-style candidates for generic ingredients and branded OFF/USDA candidates only when the Mealie ingredient is itself branded.

### 4. Resolve quantity and unit

Use the shared unit conversion layer rather than `MealEditor.toGrams()` constants.

- Mass-to-mass conversions are automatic.
- Volume-to-mass requires a food density.
- Discrete units (`clove`, `slice`, `can`, `piece`) require a matching `alt_units` entry or user-entered gram equivalent.
- Mealie unit aliases are mapped to NutriTrace canonical units in a dedicated alias table.
- If the selected provider food supplies serving metadata, offer that as the default conversion and show it in the review row.
- Never assume all cups are 240 g, all pieces are 100 g, or all milliliters weigh one gram.
- If a nutrition-bearing amount cannot be converted, block final import for that row until the user supplies an equivalent amount or deliberately chooses a zero-nutrition placeholder.

Compute each ingredient’s nutrition from the selected food snapshot and resolved amount. Compute whole-recipe totals from ingredients, then divide by Mealie yield for the stored per-serving recipe nutrition and portion. Show a warning when Mealie’s aggregate nutrition differs materially from the ingredient-derived total, but do not double-count or overwrite resolved ingredient totals.

### 5. Review UI

Add `Import from URL` to the Recipes tab and change `pickMealieRecipe()` in `Foods.svelte` to open the same dedicated import route/sheet instead of `FoodEditor`.

Suggested UI states:

- header: image, recipe name, yield, source link, and overall resolution progress;
- source step: URL entry and fetch status, or Mealie selection; multiple JSON-LD recipes require an explicit choice;
- ingredient rows with `Mapped`, `Provider match`, `Needs review`, or `Unresolved` status;
- expandable candidate list with Local / OFF / USDA tabs;
- actions: choose candidate, search again, create food, use placeholder;
- bulk action only for exact deterministic local matches;
- final summary: new foods to create, existing foods reused, placeholders, computed per-serving nutrition;
- primary action: `Import recipe`; secondary action: cancel without writes.

The review state should live in an editor draft so an Android process death or navigation does not discard a partially resolved recipe.

The preview must distinguish source parsing from nutrition resolution. Users should still be able to import title, instructions, and ingredient text when some ingredient lines are unresolved, but only after explicitly acknowledging every zero-nutrition placeholder. Show warnings for low-confidence ingredient parses, missing/ambiguous yield, unavailable images, and a large mismatch between JSON-LD aggregate nutrition and ingredient-derived totals.

### 6. Persist as one logical bundle

Add `NtApi.importRecipeBundle(bundle)` with platform-specific implementations:

- PWA/server: `POST /api/meals/import` validates ownership of reused food IDs, rechecks external references, creates new foods, rewrites ingredient references to final IDs, and creates/updates the recipe inside one SQLite transaction.
- Native/local-first: a transaction helper in `db-native.js` creates/reuses local foods and the recipe together, marks rows pending, then schedules normal sync.

The bundle endpoint/helper must:

- validate maximum recipe/ingredient/payload sizes;
- reject duplicate ingredient keys in the submitted bundle;
- preserve input order and ingredient groups;
- localize external images on a best-effort basis without corrupting the transaction;
- derive nutrition server/local-side from the accepted item snapshots rather than trusting a client-supplied aggregate;
- return the created recipe and every created/reused food mapping;
- be idempotent for the same Mealie recipe external reference.

Native bundle/sync remapping needs an explicit contract. A newly created local food has no server ID when its recipe is first assembled, so the recipe item must temporarily carry `food_client_id` alongside its local `id`. During a connected push, process foods before meals, build `food_client_id -> server_id`, rewrite the outgoing recipe items to `food_server_id`, and then insert/update the server recipe. Apply the returned mapping to the local recipe JSON as part of sync acknowledgement. Do not send raw device-local food IDs to another device as if they were server IDs.

On reimport of an already-linked Mealie recipe, offer `Update existing recipe` or `Save as copy`. Updating replaces the saved recipe snapshot only; existing diary entries remain unchanged.

## Diary explosion and ingredient editing

Build on the existing `_splitItems` parent/child representation.

### Stable split identity

- Give every new split child its own UUID.
- Address split operations by parent UUID and child UUID rather than rendered array indexes.
- Key expansion state by parent UUID, not index.
- Keep `_splitItems` in the diary compact reference allowlist; keep source food IDs, amount/unit, nutrition, and UUID for each child.

This also reduces the existing cross-device/index-shift risk called out in `src/stores/diary.js`.

### Explosion behavior

When the user chooses `Split Recipe`:

1. Fetch the saved recipe by stable meal ID when ingredients are not already present on the diary snapshot.
2. Scale every ingredient by the logged recipe servings/portion using the recipe’s explicit yield and resolved total amount.
3. Round display amounts only; preserve an unrounded scale internally for nutrition calculations.
4. Create child UUIDs and persist `_splitItems` on that diary occurrence.
5. Expand the parent immediately.

The parent’s displayed nutrition must be the sum of current children whenever `_splitItems` exists. Removing, editing, or swapping a child therefore updates daily totals without mutating the source recipe.

### Adjust quantity

Retain the current split-child edit sheet, but route updates through UUID-based store functions. Use the child food’s `nutrition_basis`, `alt_units`, and density for conversion. If a requested unit conversion lacks data, ask for an equivalent amount rather than guessing.

### Swap ingredient

Add `Swap` to each split child’s action menu:

1. Open the existing Foods picker with a `splitChildReplacement` context containing date, parent UUID, child UUID, current amount, and unit.
2. Allow Local, OFF, USDA, scan, shared food, and manual creation through the same picker behavior already used by `MealEditor`.
3. Persist an external/provider pick to the local food catalogue first.
4. Default the replacement to the old child’s resolved mass/volume. If incompatible, show the normal portion/unit prompt.
5. Replace only the selected child snapshot, issue a new child `updatedAt`, and keep the parent recipe name/image and other children unchanged.
6. Bump usage for the replacement food; do not increment usage for the removed food.

Replace the current session-storage/index-based regular diary replacement handoff with a typed context helper shared by regular items and split children where practical.

## Implementation phases

### Phase 1 — Data contract and pure logic

- Define the source-neutral normalized recipe draft and preview error contract.
- Add representative HTML/JSON-LD fixtures for top-level objects, arrays, `@graph`, multiple recipes, malformed sibling blocks, instruction shapes, image shapes, nutrition, missing yields, and hostile/oversized inputs.
- Implement JSON-LD traversal/normalization and ingredient-line parsing as pure modules.
- Add Mealie fixtures and `normalizeMealieRecipe()`.
- Add external-ref normalization helpers.
- Add deterministic local matching and provider adapter contracts.
- Add food-aware amount resolution and unit aliases.
- Unit-test nested recipes, cycles, raw/unparsed rows, zero/missing quantities, unit objects/strings, and duplicate foods.

### Phase 2 — Secure URL preview service

- Add the authenticated `/api/recipes/import/preview` route.
- Implement IP-pinned SSRF-safe fetching, redirect revalidation, response limits, timeouts, rate/concurrency limits, content-type validation, and redacted diagnostics.
- Wire stable error codes to translated UI messages.
- Add integration tests with a controllable local HTTP fixture server and injected DNS/fetch transport; tests must not depend on public websites.

### Phase 3 — Persistence and sync

- Add `external_refs` and `recipe_details` migrations server-side and native-side.
- Thread fields through routes, cached/HTTP APIs, backup/restore, and sync.
- Add atomic server and native recipe-bundle import.
- Add idempotent update/save-copy behavior.

### Phase 4 — Import review experience

- Add the Recipes-tab URL entry and fetching/error/multiple-recipe-selection states.
- Route Mealie selections to the importer.
- Implement local auto-resolution and provider candidate searches.
- Implement mapping, conversion, placeholder, create-food, and final review states.
- Persist import drafts and add translated strings to every locale file.

### Phase 5 — Diary ingredient operations

- Move split parent/child operations to UUID identity.
- Correct split scaling to use explicit recipe yield and resolved amounts.
- Add child swap handoff and picker UI.
- Verify parent/daily nutrition recomputation after edit, removal, and swap.

### Phase 6 — Hardening and rollout

- Add payload/rate/concurrency limits and abort handling.
- Add telemetry/logging that records counts and statuses but no recipe names, ingredient names, Mealie URLs, or tokens.
- Exercise PWA, connected Android, standalone Android, OFF local mirror, OFF air-gap, and USDA-disabled configurations.
- Exercise direct URL preview against a curated compatibility corpus without making those live websites part of CI.
- Document supported Schema.org shapes, known static-HTML limitations, supported Mealie versions, and the mapping review workflow.

## Tests

### Pure/unit tests

- JSON-LD discovery in objects, arrays, nested arrays, and `@graph`.
- `@type` arrays, in-document `@id` resolution, malformed sibling blocks, cycles, depth/count limits, and multiple-recipe selection.
- Recipe normalization for images, yields, durations, nutrition, categories, keywords, canonical URLs, and every supported instruction shape.
- Ingredient parsing for decimals, mixed/Unicode fractions, ranges, package sizes, plural/unit aliases, optional amounts, preparation notes, and ambiguous lines.
- HTML/text sanitization, entity decoding, prototype-pollution keys, and string/count caps.
- Structured and unparsed Mealie ingredient normalization.
- Object/string units and foods, fractional quantities, notes, groups, and original text.
- Referenced-recipe recursion, scale propagation, depth limit, and cycle rejection.
- External-ref normalization/deduplication and instance isolation.
- Local matching: prior mapping, exact unique, ambiguous exact, fuzzy review-only.
- Provider scoring never auto-selects a non-exact external result.
- Mass, volume+density, discrete alt-unit, incompatible unit, and placeholder paths.
- Ingredient-derived whole/per-serving nutrition.

### Server integration tests

- Preview rejects invalid protocols, credentials, loopback/private/link-local/reserved IPs, DNS rebinding, unsafe redirects, excessive redirects, slow responses, decompression bombs, oversized bodies, and non-HTML content.
- Preview accepts approved public targets through an injected pinned transport, applies each redirect policy check, extracts valid JSON-LD, and makes no database writes.
- Preview returns stable errors for no recipe, malformed recipe, and multiple recipes; logs contain no path/query, recipe title, ingredients, HTML, cookies, or credentials.
- Bundle import creates all new foods and recipe atomically.
- Failure rolls back recipe and new food writes.
- Existing foods cannot be referenced across users without permission.
- Repeated import is idempotent; update and save-copy behave distinctly.
- JSON size/count limits and malformed external refs are rejected.
- Recipe image localization failure does not lose the recipe.

### Native and sync tests

- Existing databases migrate without data loss.
- Standalone bundle transaction creates locally usable foods/recipe.
- Connected native push/pull preserves `external_refs`, `recipe_details`, and item provenance.
- A same-batch native food + recipe push remaps `food_client_id` to `food_server_id`; another device can hydrate every ingredient correctly.
- Backup/restore retains imported recipe fidelity.

### Diary tests

- Splitting 0.5, 1, and multiple servings produces correct child quantities and totals.
- Editing one child changes only that diary occurrence and parent total.
- Swapping a child preserves its resolved amount and recalculates nutrition.
- Removing the final child follows an explicit product rule (recommended: remove the parent occurrence).
- Concurrent item insertion does not make a UUID-based edit hit the wrong child.
- Compact diary serialization keeps split children but does not re-inline the full saved recipe.

### UI/wiring tests

- Recipes exposes `Import from URL`; submit disables while fetching and duplicate submits are suppressed.
- Standalone Android explains the server requirement before URL entry; PWA and connected Android use the authenticated preview endpoint.
- A valid URL proceeds to recipe selection/review; every stable preview error is visible and retryable.
- Multiple recipes require a user choice, and back/cancel performs no writes.
- A Mealie result opens the recipe importer, not `FoodEditor`.
- Import is blocked on unacknowledged unresolved/conversion rows.
- Cancel performs no writes.
- Imported recipe appears under Recipes with all ingredient rows.
- Logged recipe exposes Split Recipe; split children expose Edit, Swap, and Remove.

## Acceptance criteria

- Pasting a public webpage containing valid Schema.org `Recipe` JSON-LD produces a preview with the correct name, yield, ordered ingredients, grouped/ordered instructions, image, metadata, and canonical source URL.
- Top-level, array, and `@graph` JSON-LD shapes work; malformed unrelated JSON-LD blocks do not prevent a valid recipe block from importing.
- Pages with multiple recipes prompt for selection. Pages with no usable static JSON-LD return a clear explanation instead of doing nothing.
- The server cannot be used to access localhost, private/link-local/reserved networks, cloud metadata, or an unsafe redirect target, and bounded fetches cannot consume unbounded time or memory.
- Ingredient text is preserved exactly for provenance; uncertain amount/unit parses are visible and cannot silently influence nutrition.
- Selecting a Mealie recipe imports a NutriTrace recipe with the same direct and nested leaf ingredients, source amounts/notes, yield, image, and retained recipe details.
- Every imported ingredient visibly resolves to a NutriTrace food or an explicitly acknowledged placeholder.
- Missing local foods can be found and imported from enabled OFF/USDA providers without leaving the recipe flow.
- Reimporting the same Mealie recipe/food reuses durable mappings and does not create accidental duplicates.
- Recipe nutrition is derived from resolved ingredients and stored per serving.
- Adding a recipe to a day keeps it collapsed until the user chooses Split Recipe.
- After splitting, an individual ingredient can be adjusted, removed, or swapped without modifying the saved recipe or other diary days.
- Daily and recipe-parent totals immediately reflect child edits.
- URL and Mealie import work on PWA and connected Android; completed imports remain available offline. Standalone Android clearly reports the server requirement while all local recipe editing, persistence, and diary operations continue to work.
- No Mealie token or unhashed private base URL is persisted in recipe/food provenance or logs.

## Explicit non-goals for this work

- Two-way synchronization of NutriTrace edits back into Mealie.
- Automatic upstream refresh that rewrites existing foods, recipes, or diary history.
- Fully automatic fuzzy/provider matching without user review.
- Executing page JavaScript or shipping a headless browser to recover recipes from sites that do not expose usable JSON-LD in their initial HTML.
- Maintaining per-site CSS/XPath scrapers in the baseline release. Future site adapters must feed the same normalized draft and security boundary.
- Bypassing paywalls, authentication, bot challenges, CAPTCHAs, or publisher access controls.
- Assuming nutrition for unresolved ingredients or inventing weight conversions.
