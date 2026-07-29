/**
 * Dynamic favicon that reflects the user's accent color.
 *
 * Why: a self-hoster running two or three TraceApps instances side by
 * side (NT / CT / LT — or two NT installs for different family members)
 * can't tell the browser tabs apart when the favicon is always the
 * same green mark. Rendering the favicon per-accent means each install
 * that picks a distinct accent gets a visually distinct tab, no admin
 * customization or icon uploads required (see issue #108 discussion).
 *
 * Implementation: build a tiny 64×64 SVG at runtime, encode as a data
 * URL, and hot-swap every <link rel="icon"> in the head. Browsers
 * honour the change immediately for the tab icon (and the address-bar
 * icon in Firefox). The PNG icons in public/icons/ stay untouched —
 * they're still the install/PWA icons and remain the "green NT" mark
 * so nothing about the app's identity changes.
 *
 * The SVG is intentionally simple (a rounded-square badge with the "N"
 * glyph, tinted in the accent) instead of a scaled-down version of the
 * full logo. Full-logo detail is illegible at 16×16 anyway, and a
 * bold letterform reads instantly at every zoom level a browser might
 * render the favicon at.
 */
import { ACCENT_HEX } from './accent-hex.js';

// Named accents → the "dark-theme" hex (matches the picker in Settings).
// Custom hex accents pass through unchanged. Fallback for anything we
// don't recognise: mint dark, so behaviour matches today's default.
function _resolveHex(accentValue) {
  if (typeof accentValue !== 'string') return '#4FFFB0';
  if (/^#[0-9a-fA-F]{6}$/.test(accentValue)) return accentValue;
  return ACCENT_HEX[accentValue] || '#4FFFB0';
}

/** True when the given hex reads as "light" — used to flip the glyph
 *  colour to dark on pale accents (yellow/lime/cyan) so the "N" stays
 *  legible against its own background. */
function _isLight(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62;
}

/** Build the SVG source for a given accent hex. */
function _svgFor(accentHex) {
  const glyphFill = _isLight(accentHex) ? '#0A0B0F' : '#FFFFFF';
  // Kept as a single line so the URL-encoded data URI stays compact.
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='${accentHex}'/><text x='32' y='46' text-anchor='middle' font-family='-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif' font-size='42' font-weight='800' fill='${glyphFill}'>N</text></svg>`;
}

/**
 * Update every favicon link in the document head to reflect the given
 * accent value. Safe to call on every accent change; browsers replace
 * the tab icon in place without a flicker.
 *
 * No-ops server-side (SSR / build) since there's no document there.
 */
export function updateFavicon(accentValue) {
  if (typeof document === 'undefined') return;
  const hex = _resolveHex(accentValue);
  const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(_svgFor(hex));
  // Replace ALL rel="icon" links (index.html declares two sizes) plus
  // apple-touch-icon so iOS Safari tabs match too. The 512×512 PWA
  // icon used at install time is deliberately NOT touched — it stays
  // the branded PNG so home-screen icons remain recognisable.
  const links = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
  links.forEach(link => link.setAttribute('href', dataUrl));
}
