export class RecipeImportError extends Error {
  constructor(code, message, status = 422, details = null) {
    super(message);
    this.name = 'RecipeImportError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function recipeImportErrorBody(error) {
  return {
    error: error?.message || 'Recipe import failed',
    code: error?.code || 'recipe_import_failed',
    ...(error?.details ? { details: error.details } : {}),
  };
}
