/**
 * server/routes/mcp.js — Model Context Protocol endpoint (#103).
 *
 * Mounted at /api/mcp when MCP_ENABLED=1 in the server env. Off by
 * default, so no existing user sees any change. A future write-scope
 * addition will require MCP_WRITE_ENABLED=1 separately (Phase 2).
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

const ENABLED = _envFlag(process.env.MCP_ENABLED);

// Parse ALLOWED_ORIGINS (comma-separated, same convention as the rest
// of the server). If absent, origin-bearing requests fall back to a
// same-Host check so a browser-based MCP inspector hitting the app's
// own URL still works out of the box. Header-less server-to-server
// clients (Claude Desktop, stdio bridges) always pass.
const _originAllow = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function _isOriginAllowed(origin, host) {
  if (!origin) return true;                    // Server-to-server = ok
  if (_originAllow.some(o => o === '*' || o === origin)) return true;
  if (host) {
    try {
      const u = new URL(origin);
      if (u.host === host) return true;         // Same-origin browser client
    } catch { /* invalid Origin header → treat as reject */ }
  }
  return false;
}

// Router-level gate: if MCP is disabled, respond 404 to every verb on
// /api/mcp BEFORE running bearer auth. Prevents an attacker (or a
// misconfigured agent) from burning a valid token's rate-limit budget
// against a feature that isn't actually turned on.
router.use((req, res, next) => {
  if (!ENABLED) return res.status(404).json({ error: 'MCP not enabled on this server' });
  next();
});

router.post('/', bearerAuth, requireScope('mcp:read'), async (req, res) => {
  const origin = req.get('origin');
  const host = req.get('host');
  if (!_isOriginAllowed(origin, host)) {
    return res.status(403).json({
      error: 'Origin not allowed',
      code: 'origin_rejected',
    });
  }
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
