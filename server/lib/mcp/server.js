/**
 * server/lib/mcp/server.js
 *
 * Handle a single MCP request over the Streamable HTTP transport.
 *
 * Uses stateless mode: a fresh McpServer + StreamableHTTPServerTransport
 * pair per HTTP request. All Phase 1 tools are read-only + stateless
 * (no per-session state to persist), so session management would just
 * be maintenance burden. If a future tool needs a session (long-lived
 * subscriptions, resumable streams), revisit and switch to stateful.
 *
 * Auth + rate limit + origin check happen upstream in the Express
 * router — by the time this function runs, req.apiUser is trusted
 * and identifies the caller.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { APP_VERSION } from '../../routes/version-source.js';
import { registerReadTools } from './tools/index.js';

export async function handleMcpRequest(req, res) {
  const transport = new StreamableHTTPServerTransport({
    // Stateless — no session id, every request self-contained.
    sessionIdGenerator: undefined,
  });
  const server = new McpServer(
    {
      name: 'nutritrace',
      version: String(APP_VERSION || '0.0.0').replace(/^v/, ''),
    },
    {
      // Advertise only tools capability; Phase 1 has no resources/prompts.
      capabilities: { tools: {} },
    }
  );
  registerReadTools(server, { userId: req.apiUser.id });

  // If the client hangs up mid-response, tear down transport cleanly
  // so we don't leak the underlying reader/writer.
  res.on('close', () => {
    try { transport.close?.(); } catch { /* ignore */ }
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
