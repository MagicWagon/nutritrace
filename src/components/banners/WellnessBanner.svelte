<script>
  import { DB } from '../../lib/db.js';

  let noAnim = DB.getSetting('disableAnimations', false);
  let noLoop = !DB.getSetting('loopBannerAnimations', true);
  if (typeof window !== 'undefined') {
    window.addEventListener('wl:setting', () => {
      noAnim = DB.getSetting('disableAnimations', false);
      noLoop = !DB.getSetting('loopBannerAnimations', true);
    });
  }

  /*
    Shoe sole paths — drawn at origin (0,0), facing upward.
    Right foot: natural outward curve on the right side, arch indent on left.
    Left foot:  mirrored (scaleX -1 via transform).

    Path anatomy (height ~22px, width ~10px):
      - Start at heel (bottom centre)
      - Right outer edge: curves gently outward toward ball of foot
      - Toe box: wider, rounded across top
      - Left inner edge (arch): curves inward noticeably
      - Back to heel
  */
  const RIGHT_SOLE = `
    M 0,0
    C  2,-3   6,-8   5,-13
    C  5,-17  4,-20  2,-22
    C -1,-23 -5,-22 -6,-20
    C -8,-18 -7,-15 -6,-13
    C -5,-9  -4,-4   0,0
    Z
  `;
  // Left foot = right foot mirrored on X (scaleX(-1) applied in transform)
  const LEFT_SOLE = RIGHT_SOLE;
</script>

<!--
  Wellness page banner — shoe-print trail walking left→right,
  Zzz's rising beside a crescent moon, twinkling stars.
-->
<svg
  class="wbn-svg"
  class:no-anim={noAnim}
  class:no-loop={noLoop}
  viewBox="0 0 500 120"
  preserveAspectRatio="xMidYMid slice"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <defs>
    <radialGradient id="wbn-gl" cx="22%" cy="92%" r="55%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.22" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"    />
    </radialGradient>
    <radialGradient id="wbn-gr" cx="82%" cy="40%" r="42%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.14" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"    />
    </radialGradient>
    <mask id="wbn-moon-mask">
      <rect width="500" height="120" fill="white"/>
      <circle cx="392" cy="52" r="11" fill="black"/>
    </mask>
  </defs>

  <rect width="500" height="120" fill="url(#wbn-gl)" />
  <rect width="500" height="120" fill="url(#wbn-gr)" />

  <!-- Dotted ground path -->
  <line class="wbn-trail"
        x1="20" y1="108" x2="360" y2="108"
        stroke="var(--accent)" stroke-opacity="0.15"
        stroke-width="1.2" stroke-dasharray="3 6" />

  <!--
    8 shoe prints alternating right / left foot, walking left → right.
    Right foot: translate to position + rotate slightly outward (+12°), natural orientation.
    Left  foot: translate + rotate (-12°) + scaleX(-1) to mirror the sole.

    Positions: x steps 46 apart, y alternates 107 (right, on ground) / 96 (left, stride).
  -->

  <!-- fp1: right foot -->
  <g class="wbn-fp wf1" transform="translate(44,107) rotate(12)">
    <path d={RIGHT_SOLE} fill="var(--accent)" />
  </g>
  <!-- fp2: left foot -->
  <g class="wbn-fp wf2" transform="translate(88,96) rotate(-12) scale(-1,1)">
    <path d={LEFT_SOLE} fill="var(--accent)" />
  </g>
  <!-- fp3: right foot -->
  <g class="wbn-fp wf3" transform="translate(132,107) rotate(12)">
    <path d={RIGHT_SOLE} fill="var(--accent)" />
  </g>
  <!-- fp4: left foot -->
  <g class="wbn-fp wf4" transform="translate(176,96) rotate(-12) scale(-1,1)">
    <path d={LEFT_SOLE} fill="var(--accent)" />
  </g>
  <!-- fp5: right foot -->
  <g class="wbn-fp wf5" transform="translate(220,107) rotate(12)">
    <path d={RIGHT_SOLE} fill="var(--accent)" />
  </g>
  <!-- fp6: left foot -->
  <g class="wbn-fp wf6" transform="translate(264,96) rotate(-12) scale(-1,1)">
    <path d={LEFT_SOLE} fill="var(--accent)" />
  </g>
  <!-- fp7: right foot -->
  <g class="wbn-fp wf7" transform="translate(308,107) rotate(12)">
    <path d={RIGHT_SOLE} fill="var(--accent)" />
  </g>
  <!-- fp8: left foot -->
  <g class="wbn-fp wf8" transform="translate(352,96) rotate(-12) scale(-1,1)">
    <path d={LEFT_SOLE} fill="var(--accent)" />
  </g>

  <!-- Crescent moon -->
  <g class="wbn-moon">
    <circle cx="386" cy="56" r="13" fill="var(--accent)" mask="url(#wbn-moon-mask)" />
  </g>

  <!-- Zzz's -->
  <text class="wbn-z wz1" x="418" y="92"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="22" font-weight="800"
    fill="var(--accent)" text-anchor="middle">Z</text>
  <text class="wbn-z wz2" x="437" y="72"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="16" font-weight="800"
    fill="var(--accent)" text-anchor="middle">Z</text>
  <text class="wbn-z wz3" x="452" y="56"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="12" font-weight="800"
    fill="var(--accent)" text-anchor="middle">Z</text>

  <!-- Stars -->
  <circle class="wbn-star ws1" cx="68"  cy="26" r="1.6" fill="var(--accent)" />
  <circle class="wbn-star ws2" cx="158" cy="16" r="1.3" fill="var(--accent)" />
  <circle class="wbn-star ws3" cx="250" cy="30" r="1.8" fill="var(--accent)" />
  <circle class="wbn-star ws4" cx="345" cy="20" r="1.4" fill="var(--accent)" />
  <circle class="wbn-star ws5" cx="468" cy="24" r="1.7" fill="var(--accent)" />
  <circle class="wbn-star ws6" cx="488" cy="68" r="1.2" fill="var(--accent)" />
</svg>

<style>
  .wbn-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* ── Trail ───────────────────────────────────────────────────────────────── */
  .wbn-trail {
    opacity: 0;
    animation: wbn-trail-in 0.6s ease 0.05s forwards;
  }
  @keyframes wbn-trail-in { to { opacity: 1; } }

  /* ── Shoe prints ─────────────────────────────────────────────────────────── */
  .wbn-fp {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: wbn-fp-stamp 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
  .wf1 { animation-delay: 0.08s; }
  .wf2 { animation-delay: 0.24s; }
  .wf3 { animation-delay: 0.40s; }
  .wf4 { animation-delay: 0.56s; }
  .wf5 { animation-delay: 0.72s; }
  .wf6 { animation-delay: 0.88s; }
  .wf7 { animation-delay: 1.04s; }
  .wf8 { animation-delay: 1.20s; }

  @keyframes wbn-fp-stamp {
    from { opacity: 0;    transform: scale(0.5) translateY(4px); }
    to   { opacity: 0.35; transform: scale(1)   translateY(0); }
  }

  /* ── Moon ────────────────────────────────────────────────────────────────── */
  .wbn-moon {
    opacity: 0;
    animation: wbn-moon-in 0.8s ease 1.4s forwards;
  }
  @keyframes wbn-moon-in { to { opacity: 0.55; } }

  /* ── Zzz's ───────────────────────────────────────────────────────────────── */
  .wbn-z {
    opacity: 0;
    animation: wbn-z-rise 2.4s ease-in-out infinite;
  }
  .wz1 { animation-delay: 0.30s; animation-duration: 2.5s; }
  .wz2 { animation-delay: 0.95s; animation-duration: 2.2s; }
  .wz3 { animation-delay: 1.55s; animation-duration: 1.9s; }

  @keyframes wbn-z-rise {
    0%   { opacity: 0;    transform: translateY(0);     }
    18%  { opacity: 0.72;                               }
    75%  { opacity: 0.42;                               }
    100% { opacity: 0;    transform: translateY(-28px); }
  }

  /* ── Stars ───────────────────────────────────────────────────────────────── */
  .wbn-star {
    opacity: 0.10;
    animation: wbn-star-twinkle 3s ease-in-out infinite;
  }
  .ws1 { animation-delay: 0.0s;  animation-duration: 2.8s; }
  .ws2 { animation-delay: 0.7s;  animation-duration: 3.3s; }
  .ws3 { animation-delay: 1.4s;  animation-duration: 2.6s; }
  .ws4 { animation-delay: 0.4s;  animation-duration: 3.1s; }
  .ws5 { animation-delay: 1.8s;  animation-duration: 2.9s; }
  .ws6 { animation-delay: 2.4s;  animation-duration: 3.5s; }

  @keyframes wbn-star-twinkle {
    0%, 100% { opacity: 0.10; transform: scale(1);   }
    50%       { opacity: 0.35; transform: scale(1.4); }
  }

  /* ── No-loop ─────────────────────────────────────────────────────────────── */
  .wbn-svg.no-loop .wbn-z    { animation-iteration-count: 1; animation-fill-mode: forwards; }
  .wbn-svg.no-loop .wbn-star { animation-iteration-count: 1; animation-fill-mode: forwards; }

  /* ── No-anim ─────────────────────────────────────────────────────────────── */
  .wbn-svg.no-anim .wbn-trail { animation: none; opacity: 1; }
  .wbn-svg.no-anim .wbn-fp    { animation: none; opacity: 0.35; transform: scale(1); }
  .wbn-svg.no-anim .wbn-moon  { animation: none; opacity: 0.55; }
  .wbn-svg.no-anim .wbn-z     { animation: none; opacity: 0.55; transform: translateY(-14px); }
  .wbn-svg.no-anim .wbn-star  { animation: none; opacity: 0.22; }

  @media (prefers-reduced-motion: reduce) {
    .wbn-trail { animation: none !important; opacity: 1 !important; }
    .wbn-fp    { animation: none !important; opacity: 0.35 !important; transform: scale(1) !important; }
    .wbn-moon  { animation: none !important; opacity: 0.55 !important; }
    .wbn-z     { animation: none !important; opacity: 0.55 !important; transform: translateY(-14px) !important; }
    .wbn-star  { animation: none !important; opacity: 0.22 !important; }
  }
</style>
