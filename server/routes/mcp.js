/**
 * server/routes/mcp.js — Model Context Protocol endpoint (#103).
 *
 * Mounted at /api/mcp when MCP_ENABLED=1 in the server env. Off by
 * default, so no existing user sees any change. Write tools (Phase 2:
 * log_food, log_water, log_meal, log_body_stat) additionally require
 * MCP_WRITE_ENABLED=1 on the server AND the calling token holding the
 * `mcp:write` scope; either missing and the write tools don't appear
 * in tools/list.
 *
 * Wire protocol: MCP Streamable HTTP, stateless mode. Single POST
 * endpoint. GET / DELETE explicitly return 405 (we don't run stateful
 * sessions, so the legacy standalone SSE stream + session-cleanup
 * verbs don't apply). Auth is bearer-token via the existing api_tokens
 * table with scope 'mcp:read'. Origin is validated as a DNS-rebinding
 * defense per the MCP spec.
 *
 * Middleware order: the ENABLED flag check runs BEFORE bearer auth so
 * probes against a disabled endpoint can't consume the token's rate-
 * limit budget.
 */
import { Router } from 'express';
import { bearerAuth, requireScope } from '../middleware/bearer-auth.js';
import { handleMcpRequest } from '../lib/mcp/server.js';
import { logger } from '../logger.js';

const router = Router();

const ENABLED       = _envFlag(process.env.MCP_ENABLED);
const WRITE_ENABLED = _envFlag(process.env.MCP_WRITE_ENABLED);

// Parse ALLOWED_ORIGINS (comma-separated, same convention as the rest
// of the server). Server-to-server MCP clients (Claude Desktop's HTTP
// bridge, stdio wrappers) send no Origin header and always pass. A
// browser-based client MUST be listed in ALLOWED_ORIGINS explicitly —
// there is no same-Host fallback, because trusting the Host header is
// exactly the pattern DNS rebinding attacks exploit (an attacker can
// point evil.example at 127.0.0.1 and the browser will send matching
// Origin + Host headers). See MCP spec on the DNS-rebinding defense.
function _normalizeOrigin(s) {
  // Lowercase scheme+host, strip trailing slash. Browsers strip the
  // path from Origin already (`https://foo.example/bar` -> `https://foo.example`)
  // but admins routinely paste a full URL from the address bar. Normalize
  // both sides of the comparison so a trailing / or SHOUTED CASE doesn't
  // 403 a legitimate allowlist entry.
  if (!s) return '';
  return String(s).trim().replace(/\/+$/, '').toLowerCase();
}

const _originAllow = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(_normalizeOrigin)
  .filter(Boolean)
  .filter(s => {
    // Refuse '*'. Accepting it would open the exact DNS-rebinding hole
    // this whole check exists to close, and admins carry-over the CORS
    // convention where '*' means "any" without realising the difference.
    // To intentionally allow any browser origin, remove the check and
    // recompile; there is no env-var opt-in on purpose.
    if (s === '*') {
      logger.warn('[mcp] Ignoring "*" entry in ALLOWED_ORIGINS: wildcard is refused by design (DNS-rebinding defense). List each allowed origin explicitly.');
      return false;
    }
    return true;
  });

function _isOriginAllowed(origin) {
  if (!origin) return true;                    // Server-to-server = ok
  return _originAllow.includes(_normalizeOrigin(origin));
}

// Router-level gates: BOTH the ENABLED flag AND the origin check run
// BEFORE bearer auth, so probes against a disabled endpoint or a
// disallowed origin can't burn a valid token's rate-limit budget.
router.use((req, res, next) => {
  if (!ENABLED) return res.status(404).json({ error: 'MCP not enabled on this server' });
  next();
});
router.use((req, res, next) => {
  const origin = req.get('origin');
  if (!_isOriginAllowed(origin)) {
    return res.status(403).json({
      error:
        'Origin not allowed. Server-to-server clients (Claude Desktop etc.) work by ' +
        'default; browser-based MCP inspectors must be listed in ALLOWED_ORIGINS.',
      code: 'origin_rejected',
    });
  }
  next();
});

router.post('/', bearerAuth, requireScope('mcp:read'), async (req, res) => {
  // Stamp write eligibility onto the request for the tool registrar
  // downstream. Both the server flag AND the token scope must be true.
  req.mcpWrites = WRITE_ENABLED && !!req.apiToken?.scopes?.includes('mcp:write');
  try {
    await handleMcpRequest(req, res);
  } catch (e) {
    logger.error('[mcp] request handler threw:', e?.message || e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: { code: -32603, message: 'Internal server error' },
      });
    }
  }
});

// Stateless transport: no standalone GET SSE stream, no DELETE for
// session termination. Return 405 with an explanatory body so clients
// that speculatively try either get a useful error instead of a hang.
router.get('/', bearerAuth, requireScope('mcp:read'), (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32000,
      message: 'GET not supported: NutriTrace runs MCP in stateless mode. Use POST.',
    },
  });
});
router.delete('/', bearerAuth, requireScope('mcp:read'), (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32000,
      message: 'DELETE not supported: stateless transport has no session to clean up.',
    },
  });
});

function _envFlag(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export default router;
