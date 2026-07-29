/**
 * Named accent → hex mapping. Kept separate from Settings.svelte's
 * ACCENT_COLORS (which is picker metadata: label, dark/light pairs
 * for the swatches) so non-UI code can resolve an accent name to a
 * hex without pulling in the whole settings screen.
 *
 * Hex values match ACCENT_COLORS[…].dark — the tone the accent uses
 * in dark mode, which is the more saturated, visible variant and
 * gives a favicon that reads clearly at small sizes.
 *
 * When adding a new accent: mirror the ACCENT_COLORS entry here.
 * Divergence between the two lists is a bug (a valid picker choice
 * that renders wrong in the tab).
 */
export const ACCENT_HEX = Object.freeze({
  mint:   '#4FFFB0',
  blue:   '#4FC3F7',
  red:    '#FF7070',
  purple: '#CE93D8',
  orange: '#FFB547',
  teal:   '#4DD0E1',
  pink:   '#F48FB1',
  yellow: '#FFF176',
  indigo: '#9FA8DA',
  lime:   '#C5E1A5',
  rose:   '#FF80AB',
  cyan:   '#80DEEA',
});
