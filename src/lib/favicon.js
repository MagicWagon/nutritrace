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
 * Implementation: embed the actual public/icons/logo.svg source below
 * with the two mint hex values (`#4FFFB0` and `#00C87A`) marked as
 * substitution points. At runtime, swap those for the current accent
 * hex, encode as a data URL, and hot-swap every <link rel="icon">.
 * This keeps the mark visually IDENTICAL to the shipped brand logo
 * (fork silhouette + trace line + end dot on the dark rounded-square
 * background), just recoloured. When the logo changes, this source
 * needs to be re-synced from public/icons/logo.svg.
 *
 * The 192/512 PNG install icons in public/icons/ stay untouched —
 * they're still used at PWA install / home-screen shortcut time and
 * remain the branded green mark. Only the tab favicon tints.
 */
import { ACCENT_HEX } from './accent-hex.js';

// Named accents → the "dark-theme" hex (matches the picker in Settings).
// Custom hex accents pass through unchanged. Fallback: mint dark.
function _resolveHex(accentValue) {
  if (typeof accentValue !== 'string') return '#4FFFB0';
  if (/^#[0-9a-fA-F]{6}$/.test(accentValue)) return accentValue;
  return ACCENT_HEX[accentValue] || '#4FFFB0';
}

// Full logo.svg source, verbatim, with the two mint hex values kept as
// literal strings so we can regex-substitute them for the accent hex
// at runtime. Whitespace collapsed to keep the encoded data URL under
// the ~10KB browser favicon limit comfortably.
const LOGO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' width='512' height='512'><defs><linearGradient id='bgGrad' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#141720'/><stop offset='100%' stop-color='#0A0B0F'/></linearGradient><linearGradient id='forkGrad' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#4FFFB0'/><stop offset='100%' stop-color='#00C87A'/></linearGradient><linearGradient id='lineGrad' x1='0' y1='1' x2='1' y2='0'><stop offset='0%' stop-color='#00C87A'/><stop offset='100%' stop-color='#4FFFB0'/></linearGradient><linearGradient id='areaGrad' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#4FFFB0' stop-opacity='0.10'/><stop offset='100%' stop-color='#4FFFB0' stop-opacity='0'/></linearGradient></defs><rect width='512' height='512' rx='96' fill='url(#bgGrad)'/><ellipse cx='300' cy='250' rx='210' ry='170' fill='#4FFFB0' opacity='0.025'/><rect x='118' y='92' width='22' height='118' rx='11' fill='url(#forkGrad)'/><rect x='161' y='92' width='22' height='118' rx='11' fill='url(#forkGrad)'/><rect x='204' y='92' width='22' height='118' rx='11' fill='url(#forkGrad)'/><path d='M 129 208 C 129 248 172 260 172 260 C 172 260 215 248 215 208' fill='none' stroke='url(#forkGrad)' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/><rect x='161' y='257' width='22' height='166' rx='11' fill='url(#forkGrad)'/><path d='M 172 423 C 224 402 302 318 422 148 L 422 423 Z' fill='url(#areaGrad)'/><path d='M 172 423 C 224 402 302 318 422 148' fill='none' stroke='#4FFFB0' stroke-width='32' stroke-linecap='round' opacity='0.15'/><path d='M 172 423 C 224 402 302 318 422 148' fill='none' stroke='url(#lineGrad)' stroke-width='20' stroke-linecap='round'/><circle cx='422' cy='148' r='32' fill='#4FFFB0' opacity='0.20'/><circle cx='422' cy='148' r='18' fill='url(#lineGrad)'/></svg>`;

/** Derive a slightly darker companion to the accent, used for the
 *  gradient's bottom stop so the fork keeps its top-to-bottom depth
 *  instead of flattening to a solid colour. Simple 20% blackness. */
function _darker(hex) {
  const r = Math.max(0, Math.floor(parseInt(hex.slice(1, 3), 16) * 0.7));
  const g = Math.max(0, Math.floor(parseInt(hex.slice(3, 5), 16) * 0.7));
  const b = Math.max(0, Math.floor(parseInt(hex.slice(5, 7), 16) * 0.7));
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** Build the recoloured SVG source for a given accent hex. */
function _svgFor(accentHex) {
  const deep = _darker(accentHex);
  // Substitute BOTH mint values wherever they appear (gradient stops,
  // solid fills, glow strokes, ambient ellipse) with the accent pair.
  return LOGO_SVG
    .replaceAll('#4FFFB0', accentHex)
    .replaceAll('#00C87A', deep);
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
  const links = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
  links.forEach(link => link.setAttribute('href', dataUrl));
}
