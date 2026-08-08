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
 * table with scope 'mcp:read'. Origin is validated against the same
 * ALLOWED_ORIGINS list the rest of the server honors, as a DNS-
 * rebinding defense per the MCP spec.
 */
import { Router } from 'express';
import { bearerAuth, requireScope } from '../middleware/bearer-auth.js';
import { handleMcpRequest } from '../lib/mcp/server.js';
import { logger } from '../logger.js';

const router = Router();

const ENABLED = _envFlag(process.env.MCP_ENABLED);

// Parse ALLOWED_ORIGINS (comma-separated, same convention as CORS
// config in server/index.js). Absent = allow same-origin only, which
// for MCP over Streamable HTTP means no Origin header at all (typical
// for server-to-server clients like Claude Desktop).
const _originAllow = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function _isOriginAllowed(origin) {
  if (!origin) return true;                    // No origin = server-to-server = ok
  if (_originAllow.length === 0) return false; // Origin set + no allowlist = reject
  return _originAllow.some(o => o === origin || o === '*');
}

router.post('/', bearerAuth, requireScope('mcp:read'), async (req, res) => {
  if (!ENABLED) return res.status(404).json({ error: 'MCP not enabled on this server' });
  const origin = req.get('origin');
  if (!_isOriginAllowed(origin)) {
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
  if (!ENABLED) return res.status(404).json({ error: 'MCP not enabled on this server' });
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
  if (!ENABLED) return res.status(404).json({ error: 'MCP not enabled on this server' });
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
