import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { RecipeImportError } from './errors.js';

const DEFAULTS = Object.freeze({
  maxRedirects: 5,
  maxCompressedBytes: 2 * 1024 * 1024,
  maxDecodedBytes: 2 * 1024 * 1024,
  timeoutMs: 12_000,
});

const blocked = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
]) blocked.addSubnet(network, prefix, 'ipv6');

export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (!family) return true;
  if (family === 4) return blocked.check(address, 'ipv4');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped ? blocked.check(mapped[1], 'ipv4') : blocked.check(address, 'ipv6');
}

export function validateRecipeUrl(input, base = null) {
  let url;
  try { url = base ? new URL(input, base) : new URL(input); }
  catch { throw new RecipeImportError('invalid_url', 'Enter a valid absolute recipe URL.', 400); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RecipeImportError('invalid_url', 'Recipe URLs must use HTTP or HTTPS.', 400);
  }
  if (url.username || url.password || !url.hostname) {
    throw new RecipeImportError('invalid_url', 'Recipe URLs cannot contain credentials.', 400);
  }
  return url;
}

export async function resolvePublicAddress(hostname, resolver = dns.lookup) {
  let results;
  try { results = await resolver(hostname, { all: true, verbatim: true }); }
  catch { throw new RecipeImportError('blocked_host', 'The recipe host could not be resolved.', 400); }
  if (!Array.isArray(results)) results = [results];
  if (!results.length || results.some(item => isBlockedAddress(item.address))) {
    throw new RecipeImportError('blocked_host', 'That recipe host is not allowed.', 403);
  }
  const selected = results.find(item => item.family === 4) || results[0];
  return { address: selected.address, family: selected.family || net.isIP(selected.address) };
}

function decodeBody(buffer, encoding, maxBytes) {
  const opts = { maxOutputLength: maxBytes };
  try {
    if (/gzip/i.test(encoding)) return zlib.gunzipSync(buffer, opts);
    if (/br/i.test(encoding)) return zlib.brotliDecompressSync(buffer, opts);
    if (/deflate/i.test(encoding)) return zlib.inflateSync(buffer, opts);
    if (buffer.length > maxBytes) throw new Error('decoded response too large');
    return buffer;
  } catch (error) {
    if (/larger|maxOutputLength|too large/i.test(error.message)) {
      throw new RecipeImportError('response_too_large', 'The recipe page is too large to import.', 413);
    }
    throw new RecipeImportError('invalid_response', 'The recipe page returned an unreadable compressed response.', 422);
  }
}

export function createPinnedLookup(pinned) {
  return function pinnedLookup(_hostname, lookupOptions, callback) {
    if (lookupOptions?.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

export function requestPinned(url, pinned, options) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'NutriTrace-Recipe-Importer/1.0 (+https://github.com/TraceApps/nutritrace)',
        Accept: 'text/html,application/xhtml+xml;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      family: pinned.family,
      autoSelectFamily: false,
      lookup: createPinnedLookup(pinned),
      servername: url.hostname,
      timeout: options.timeoutMs,
    }, response => {
      const chunks = [];
      let received = 0;
      response.on('data', chunk => {
        received += chunk.length;
        if (received > options.maxCompressedBytes) {
          request.destroy(new RecipeImportError('response_too_large', 'The recipe page is too large to import.', 413));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
        bytes: received,
      }));
    });
    request.on('timeout', () => request.destroy(new RecipeImportError('fetch_timeout', 'The recipe website took too long to respond.', 504)));
    request.on('error', error => reject(error instanceof RecipeImportError ? error : new RecipeImportError('fetch_failed', 'The recipe website could not be reached.', 502)));
    request.end();
  });
}

function isRedirect(status) { return [301, 302, 303, 307, 308].includes(status); }

/** Fetch public HTML while pinning each validated DNS result to the socket. */
export async function fetchRecipePage(input, overrides = {}) {
  const options = { ...DEFAULTS, ...overrides };
  const resolver = overrides.resolver || dns.lookup;
  const requester = overrides.requester || requestPinned;
  let current = validateRecipeUrl(input);
  const initialProtocol = current.protocol;
  let redirects = 0;
  let totalBytes = 0;

  while (true) {
    const pinned = await resolvePublicAddress(current.hostname, resolver);
    const response = await requester(current, pinned, options);
    totalBytes += response.bytes || response.body?.length || 0;

    if (isRedirect(response.status)) {
      if (++redirects > options.maxRedirects) throw new RecipeImportError('too_many_redirects', 'The recipe URL redirected too many times.', 422);
      const location = response.headers?.location;
      if (!location) throw new RecipeImportError('fetch_failed', 'The recipe website returned an invalid redirect.', 502);
      const next = validateRecipeUrl(location, current);
      if (initialProtocol === 'https:' && next.protocol === 'http:') {
        throw new RecipeImportError('unsafe_redirect', 'The recipe URL redirected from HTTPS to insecure HTTP.', 422);
      }
      current = next;
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new RecipeImportError('fetch_failed', `The recipe website returned HTTP ${response.status}.`, 502);
    }
    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    const decoded = decodeBody(response.body || Buffer.alloc(0), String(response.headers?.['content-encoding'] || ''), options.maxDecodedBytes);
    const prefix = decoded.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    const looksHtml = prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.startsWith('<head') || prefix.startsWith('<body');
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !looksHtml) {
      throw new RecipeImportError('not_html', 'The URL did not return an HTML recipe page.', 415);
    }
    return {
      html: decoded.toString('utf8'),
      finalUrl: current.href,
      redirects,
      bytes: totalBytes,
      contentType,
    };
  }
}

export { DEFAULTS as RECIPE_FETCH_DEFAULTS };
