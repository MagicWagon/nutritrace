/**
 * AI Chat — multi-provider API layer
 * Supports: Anthropic Claude, OpenAI, Google Gemini
 * All calls made client-side using the user's own API key.
 */

export async function callAI({ provider, apiKey, model, messages, systemPrompt }) {
  if (!apiKey) throw new Error('No API key configured. Add one in Settings → FitBot AI.');
  switch (provider) {
    case 'claude':  return _callClaude(apiKey, model, messages, systemPrompt);
    case 'openai':  return _callOpenAI(apiKey, model, messages, systemPrompt);
    case 'gemini':  return _callGemini(apiKey, model, messages, systemPrompt);
    default: throw new Error(`Unknown AI provider: ${provider}`);
  }
}

/**
 * Server-side proxy call — used when AI config is env-locked.
 * The API key stays on the server; only messages + systemPrompt are sent.
 */
export async function callAIProxy({ messages, systemPrompt }) {
  const { apiUrl } = await import('./platform.js');
  const res = await fetch(apiUrl('/api/ai/chat'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, systemPrompt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `AI proxy error ${res.status}`);
  return data.text;
}

// ── Default models per provider ───────────────────────────────────────────────
export const AI_PROVIDERS = [
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'openai', label: 'OpenAI'           },
  { value: 'gemini', label: 'Google Gemini'    },
];

export const AI_MODELS = {
  claude: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku (fast, cheap)' },
    { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet (smarter)'    },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
    { value: 'gpt-4o',      label: 'GPT-4o (smarter)'          },
  ],
  gemini: [
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (fast, cheap)' },
    { value: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro (smarter)'       },
  ],
};

export const AI_DEFAULT_MODELS = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
};

// ── Anthropic Claude ──────────────────────────────────────────────────────────
async function _callClaude(apiKey, model, messages, systemPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || AI_DEFAULT_MODELS.claude,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Claude API error ${res.status}`);
  return data.content[0].text;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
async function _callOpenAI(apiKey, model, messages, systemPrompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || AI_DEFAULT_MODELS.openai,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `OpenAI API error ${res.status}`);
  return data.choices[0].message.content;
}

// ── Google Gemini ─────────────────────────────────────────────────────────────
async function _callGemini(apiKey, model, messages, systemPrompt) {
  const m = model || AI_DEFAULT_MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
  // Gemini uses "model" instead of "assistant" for AI turns
  const contents = messages.map(msg => {
    const parts = [];
    if (msg._image) {
      parts.push({ inlineData: { mimeType: msg._image.mimeType, data: msg._image.base64 } });
    }
    parts.push({ text: typeof msg.content === 'string' ? msg.content : (msg.content || '') });
    return { role: msg.role === 'assistant' ? 'model' : 'user', parts };
  });
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
