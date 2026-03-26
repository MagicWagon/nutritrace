import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../logger.js';
import { getAiConfig } from '../ai.js';

const router = Router();

const AI_DEFAULT_MODELS = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
};

/**
 * POST /api/ai/chat
 * Server-side proxy for AI calls — used when AI config is env-locked.
 * The API key never leaves the server; clients send only messages + systemPrompt.
 */
router.post('/chat', requireAuth, wrap(async (req, res) => {
  const { messages, systemPrompt } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  const cfg = getAiConfig();
  if (!cfg.ai_api_key) return res.status(503).json({ error: 'AI not configured on server. Set AI_API_KEY in environment.' });

  const provider = cfg.ai_provider || 'claude';
  const model    = cfg.ai_model    || AI_DEFAULT_MODELS[provider] || '';
  const apiKey   = cfg.ai_api_key;

  let text;
  switch (provider) {
    case 'claude':  text = await _callClaude(apiKey, model, messages, systemPrompt); break;
    case 'openai':  text = await _callOpenAI(apiKey, model, messages, systemPrompt); break;
    case 'gemini':  text = await _callGemini(apiKey, model, messages, systemPrompt); break;
    default: return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }
  res.json({ text });
}));

export default router;

// ── Provider implementations (server-side) ────────────────────────────────────

async function _callClaude(apiKey, model, messages, systemPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Claude API error ${res.status}`);
  return data.content[0].text;
}

async function _callOpenAI(apiKey, model, messages, systemPrompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `OpenAI API error ${res.status}`);
  return data.choices[0].message.content;
}

async function _callGemini(apiKey, model, messages, systemPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini API error ${res.status}`);
  return data.candidates[0].content.parts[0].text;
}
