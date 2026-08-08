#!/usr/bin/env node
/**
 * scripts/mcp-smoke.mjs — end-to-end MCP smoke test.
 *
 * Usage:
 *   node scripts/mcp-smoke.mjs <BASE_URL> <MCP_TOKEN>
 *
 * Example:
 *   node scripts/mcp-smoke.mjs https://nt-dev.example nt_abc123...
 *
 * The token must hold the `mcp:read` scope. Mint one via
 * POST /api/admin/api-tokens (or the Settings UI once wired).
 *
 * Prints one line per check with PASS / FAIL / SKIP. Exits non-zero
 * if any REQUIRED check failed. Negative-path checks (401 / 403) are
 * required — if they pass, auth or origin gating is broken.
 */

const [, , BASE, TOKEN] = process.argv;
if (!BASE || !TOKEN) {
  console.error('usage: node scripts/mcp-smoke.mjs <BASE_URL> <MCP_TOKEN>');
  process.exit(2);
}

const URL_ = BASE.replace(/\/+$/, '') + '/api/mcp';
const HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

let pass = 0;
let fail = 0;
let id = 0;

function line(status, label, detail = '') {
  const tag = status === 'PASS' ? '\x1b[32mPASS\x1b[0m'
            : status === 'FAIL' ? '\x1b[31mFAIL\x1b[0m'
            : '\x1b[33mSKIP\x1b[0m';
  console.log(`  ${tag}  ${label}${detail ? '  ' + detail : ''}`);
  if (status === 'PASS') pass++;
  else if (status === 'FAIL') fail++;
}

async function mcp(method, params) {
  const body = { jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) };
  const r = await fetch(URL_, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  // Streamable HTTP replies can be application/json OR text/event-stream.
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    // Take the last `data:` frame; SDK typically emits one for stateless.
    const lines = text.split('\n').filter(l => l.startsWith('data:'));
    const last = lines[lines.length - 1] || '';
    try { json = JSON.parse(last.slice(5).trim()); } catch { /* keep null */ }
  } else {
    try { json = JSON.parse(text); } catch { /* keep null */ }
  }
  return { status: r.status, json, raw: text };
}

async function callTool(name, args = {}) {
  return mcp('tools/call', { name, arguments: args });
}

console.log(`\n\x1b[1mMCP smoke test\x1b[0m  ${URL_}\n`);

// --- Handshake ---
{
  const r = await mcp('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'nt-smoke', version: '1' },
  });
  const info = r.json?.result?.serverInfo;
  if (r.status === 200 && info?.name === 'nutritrace') {
    line('PASS', `initialize`, `serverInfo=${info.name}@${info.version}`);
  } else {
    line('FAIL', `initialize`, `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

// --- tools/list ---
const EXPECTED_TOOLS = new Set([
  'get_goals',
  'list_diary_entries',
  'get_daily_totals',
  'search_foods',
  'get_recent_foods',
]);
{
  const r = await mcp('tools/list');
  const tools = r.json?.result?.tools || [];
  const names = new Set(tools.map(t => t.name));
  const missing = [...EXPECTED_TOOLS].filter(n => !names.has(n));
  if (r.status === 200 && missing.length === 0) {
    line('PASS', `tools/list`, `${tools.length} tools`);
  } else {
    line('FAIL', `tools/list`, `status=${r.status} missing=[${missing.join(',')}]`);
  }
}

// --- Each tool ---
async function checkTool(name, args, resultKey, note) {
  const r = await callTool(name, args);
  const sc = r.json?.result?.structuredContent;
  if (r.status === 200 && sc && (resultKey ? resultKey in sc : true)) {
    const preview = resultKey ? JSON.stringify(sc[resultKey]).slice(0, 80) : '';
    line('PASS', name, note ? `${note} ${preview}` : preview);
  } else if (r.status === 200 && r.json?.result?.isError) {
    line('FAIL', name, `tool returned isError: ${r.json.result.content?.[0]?.text}`);
  } else {
    line('FAIL', name, `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

await checkTool('get_goals',           {},                       'goals');
await checkTool('get_daily_totals',    {},                       'totals',    '(today)');
await checkTool('list_diary_entries',  {},                       'entries',   '(today)');
await checkTool('search_foods',        { query: 'a', limit: 3 }, 'items',     '(q=a)');
await checkTool('get_recent_foods',    { limit: 3 },             'items');

// --- Negative: no bearer → 401 ---
{
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/list' }),
  });
  if (r.status === 401) line('PASS', 'no-bearer → 401');
  else                  line('FAIL', 'no-bearer → 401', `got ${r.status}`);
}

// --- Negative: disallowed origin → 403 ---
{
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { ...HEADERS, origin: 'https://evil.example' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 998, method: 'tools/list' }),
  });
  if (r.status === 403) line('PASS', 'bad-origin → 403');
  else                  line('FAIL', 'bad-origin → 403', `got ${r.status}`);
}

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
