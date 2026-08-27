export const RECIPE_IMPORT_DRAFT_KEY = 'nt:recipe-import-draft:v1';

export function prepareRecipeImportDraft(draft, savedIndex = 0) {
  if (!draft || !Array.isArray(draft.recipes)) return null;

  const recipes = draft.recipes.filter(recipe => recipe && typeof recipe === 'object');
  if (!recipes.length) return null;

  const numericIndex = Number(savedIndex);
  const requestedIndex = Number.isFinite(numericIndex) ? Math.trunc(numericIndex) : 0;
  const selectedIndex = Math.min(Math.max(requestedIndex, 0), recipes.length - 1);
  const result = recipes.length === draft.recipes.length ? draft : { ...draft, recipes };

  return { result, selectedIndex, recipe: recipes[selectedIndex] };
}

export function persistRecipeImportDraft(storage, draft, selectedIndex = 0, resolutions = []) {
  const prepared = prepareRecipeImportDraft(draft, selectedIndex);
  if (!storage || !prepared) return false;

  try {
    storage.setItem(RECIPE_IMPORT_DRAFT_KEY, JSON.stringify({
      result: prepared.result,
      selectedIndex: prepared.selectedIndex,
      resolutions: Array.isArray(resolutions) ? resolutions : [],
    }));
    return true;
  } catch {
    return false;
  }
}
