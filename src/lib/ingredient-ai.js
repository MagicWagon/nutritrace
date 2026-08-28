import { get } from 'svelte/store';
import { callAI, callAIProxy } from './aiChat.js';
import { aiProvider, aiApiKey, aiModel, aiBaseUrl, envLocks } from '../stores/settings.js';
import { validateIngredientRefinement } from './ingredient-match.js';

function jsonReply(text) {
  const cleaned = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

export async function refineIngredientWithAI(originalText, language = 'en') {
  const systemPrompt = `You normalize one recipe ingredient for deterministic food-database search.
Return JSON only with this shape:
{"search_names":["primary food name","optional alternative"],"brand":"optional explicit brand","note":"preparation note","amounts":[{"quantity":1,"unit":"g","role":"primary|additional|equivalent"}]}
Rules:
- Use language ${String(language || 'en').slice(0, 2).toLowerCase()} for search_names.
- Remove quantities, units, temperatures, and preparation notes from search_names.
- Preserve meaningful food descriptors such as unsalted, ground, whole, or light brown.
- Split explicit alternatives introduced by “or”; do not invent alternatives or brands.
- Record only measurements explicitly present in the source. Parenthetical metric conversions use role equivalent.
- Do not provide nutrition, database IDs, commentary, or markdown.`;
  const messages = [{ role: 'user', content: String(originalText || '').slice(0, 2_000) }];
  const reply = get(envLocks)?.ai
    ? await callAIProxy({ messages, systemPrompt, tools: [] })
    : await callAI({
        provider: get(aiProvider) || 'claude',
        apiKey: get(aiApiKey),
        model: get(aiModel),
        baseUrl: get(aiBaseUrl),
        messages,
        systemPrompt,
        tools: [],
      });
  const validated = validateIngredientRefinement(jsonReply(reply));
  if (!validated) throw new Error('AI returned an invalid ingredient refinement.');
  return validated;
}

export async function estimateIngredientGramsWithAI({ ingredientText, foodName, brand, amount, unit }) {
  const systemPrompt = `Estimate a recipe household measurement in grams only when no food database portion is available.
Return JSON only: {"grams":123,"confidence":"high|medium|low"}.
Use the named food and brand when supplied. Do not change the requested amount or unit. Return low confidence when the food is too ambiguous.`;
  const messages = [{ role: 'user', content: JSON.stringify({ ingredientText, foodName, brand, amount, unit }).slice(0, 2_000) }];
  const reply = get(envLocks)?.ai
    ? await callAIProxy({ messages, systemPrompt, tools: [] })
    : await callAI({
        provider: get(aiProvider) || 'claude', apiKey: get(aiApiKey), model: get(aiModel), baseUrl: get(aiBaseUrl),
        messages, systemPrompt, tools: [],
      });
  const parsed = jsonReply(reply);
  const grams = Number(parsed?.grams);
  if (!Number.isFinite(grams) || grams <= 0 || grams > 1_000_000 || parsed?.confidence === 'low') {
    throw new Error('AI could not provide a reliable unit conversion.');
  }
  return { grams: Math.round(grams * 10) / 10, confidence: parsed.confidence || 'medium', source: 'ai' };
}
