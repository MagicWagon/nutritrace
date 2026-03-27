/**
 * Transient state passed from Foods page to Food/Meal editors.
 * Uses a mutable object so imports can be reassigned across modules.
 */
export const editorState = {
  foodPrefill:   null,
  foodStore:     'foodList',
  foodDiaryCtx:  null,
  mealPrefill:   null,
  mealIsRecipe:  false,
  lastMealAdded: null,  // meal index to scroll to after adding food
};

export function clearFoodEditorState() {
  editorState.foodPrefill   = null;
  editorState.foodStore     = 'foodList';
  editorState.foodDiaryCtx  = null;
}

export function clearMealEditorState() {
  editorState.mealPrefill  = null;
  editorState.mealIsRecipe = false;
}
