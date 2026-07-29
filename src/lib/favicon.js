/**
 * Dynamic favicon that reflects the user's accent color.
 *
 * Why: a self-hoster running two or three TraceApps instances side by
 * side (NT / CT / LT — or two NT installs for different family members)
 * can't tell the browser tabs apart when the favicon is always the
 * same green mark. Rendering the favicon per-accent means each install
 * that picks a distinct accent gets a visually distinct tab, no admin
 * customization or icon uploads required (see issue #108).
 *
 * Design: keep the NutriTrace fork silhouette from the full logo (so
 * the mark stays recognizable at a glance), tint it with the accent
 * hex, drop the background gradient. A plain letterform ("N") reads
 * fine at 16px but loses all brand identity across the family; the
 * fork glyph is the identifiable NT mark.
 *
 * The full logo also includes a "trace line" chart element — omitted
 * here because at favicon sizes both shapes fighting for pixels turns
 * into noise. The fork alone reads instantly.
 *
 * Implementation: build a tiny 512×512 SVG at runtime, encode as a
 * data URL, and hot-swap every <link rel="icon"> in the head.
 * The PNG icons in public/icons/ stay untouched — they're still the
 * install/PWA icons and remain the "green NT" mark.
 */
import { ACCENT_HEX } from './accent-hex.js';

// Named accents → the "dark-theme" hex (matches the picker in Settings).
// Custom hex accents pass through unchanged. Fallback: mint dark.
function _resolveHex(accentValue) {
  if (typeof accentValue !== 'string') return '#4FFFB0';
  if (/^#[0-9a-fA-F]{6}$/.test(accentValue)) return accentValue;
  return ACCENT_HEX[accentValue] || '#4FFFB0';
}

/** Build the SVG source for a given accent hex. Fork-shape lifted from
 *  public/icons/logo.svg (three tines + neck + handle), flattened to
 *  solid strokes/fills in the accent color, on a dark rounded-square
 *  background so the mark reads on any browser chrome color. */
function _svgFor(accentHex) {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>
<rect width='512' height='512' rx='96' fill='#0A0B0F'/>
<rect x='118' y='92' width='22' height='118' rx='11' fill='${accentHex}'/>
<rect x='161' y='92' width='22' height='118' rx='11' fill='${accentHex}'/>
<rect x='204' y='92' width='22' height='118' rx='11' fill='${accentHex}'/>
<path d='M 129 208 C 129 248 172 260 172 260 C 172 260 215 248 215 208' fill='none' stroke='${accentHex}' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/>
<rect x='161' y='257' width='22' height='166' rx='11' fill='${accentHex}'/>
<path d='M 172 423 C 224 402 302 318 422 148' fill='none' stroke='${accentHex}' stroke-width='20' stroke-linecap='round'/>
<circle cx='422' cy='148' r='18' fill='${accentHex}'/>
</svg>`.replace(/\n\s*/g, '');
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
