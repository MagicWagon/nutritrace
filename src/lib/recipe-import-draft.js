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
