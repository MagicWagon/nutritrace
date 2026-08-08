/**
 * server/lib/mcp/_util.js
 *
 * Shared helpers for the MCP tool implementations. Extracted so any
 * hardening (JSON depth caps, TZ handling, error envelope tweaks) lives
 * in one place instead of drifting across tool files.
 */

/**
 * Safely parse a JSON string; return `fallback` on any error.
 */
export function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/**
 * YYYY-MM-DD in server-local time. Used when the caller didn't specify
 * a date. NOTE: this uses the SERVER's timezone, not the caller's —
 * agents that need calendar accuracy for a user in a different TZ
 * should pass an explicit `date` argument rather than relying on
 * "today". Each tool's inputSchema description notes this.
 */
export function todayLocal() {
  return new Date().toLocaleDateString('sv-SE');
}

/**
 * YYYY-MM-DD `days` days before today in server-local time. Same TZ
 * caveat as `todayLocal`.
 */
export function daysAgoLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('sv-SE');
}

/**
 * Standard MCP error result. `isError: true` means "the tool ran but
 * couldn't do what was asked" — protocol-level errors (unknown tool,
 * malformed JSON-RPC) are returned as JSON-RPC error objects by the
 * SDK itself and don't come through here.
 */
export function toolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Standard MCP success result carrying both a text rendering (for
 * clients that don't understand structuredContent) and the raw JSON
 * (for clients that do). Matches the pattern the MCP spec recommends
 * for backward compatibility.
 */
export function toolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a YYYY-MM-DD string; return the string when valid, or
 * `null` when invalid. Empty / undefined is a caller error and should
 * be handled upstream (each tool decides whether to default to today).
 */
export function validateDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) ? s : null;
}

export { DATE_RE };
