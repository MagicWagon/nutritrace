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
</script>

<!--
  Wellness page banner — footstep trail walking left → right, Zzz's
  floating up from the right, twinkling stars.
  Absolutely positioned behind page-header content.
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
    <!-- Warm glow behind footsteps (left) -->
    <radialGradient id="wbn-gl" cx="22%" cy="92%" r="55%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.22" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"    />
    </radialGradient>
    <!-- Cooler glow on the sleep / Zzz side (right) -->
    <radialGradient id="wbn-gr" cx="82%" cy="40%" r="42%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.12" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"    />
    </radialGradient>
  </defs>

  <rect width="500" height="120" fill="url(#wbn-gl)" />
  <rect width="500" height="120" fill="url(#wbn-gr)" />

  <!-- Dotted ground path that footsteps walk along -->
  <line class="wbn-trail"
        x1="20" y1="105" x2="368" y2="105"
        stroke="var(--accent)" stroke-opacity="0.15"
        stroke-width="1.2" stroke-dasharray="3 6" />

  <!--
    Footprints — 8 total, alternating right (+12°, y≈97) / left (-12°, y≈88).
    Each group: main foot ellipse + 3 toe circles, all fill="var(--accent)".
    Opacity is controlled via CSS on the group (avoids bleed between shapes).
  -->
  <g class="wbn-fp wf1" transform="translate(50,97) rotate(12)">
    <ellipse cx="0" cy="-7" rx="7" ry="11" fill="var(--accent)" />
    <circle cx="-4.5" cy="-19.5" r="2.6" fill="var(--accent)" />
    <circle cx="0"    cy="-21.5" r="2.6" fill="var(--accent)" />
    <circle cx="4.5"  cy="-19.5" r="2.6" fill="var(--accent)" />
  </g>
  <g class="wbn-fp wf2" transform="translate(93,88) rotate(-12)">
    <ellipse cx="0" cy="-7" rx="7" ry="11" fill="var(--accent)" />
    <circle cx="-4.5" cy="-19.5" r="2.6" fill="var(--accent)" />
    <circle cx="0"    cy="-21.5" r="2.6" fill="var(--accent)" />
    <circle cx="4.5"  cy="-19.5" r="2.6" fill="var(--accent)" />
  </g>
  <g class="wbn-fp wf3" transform="translate(136,97) rotate(12)">
    <ellipse cx="0" cy="-7" rx="7" ry="11" fill="var(--accent)" />
    <circle cx="-4.5" cy="-19.5" r="2.6" fill="var(--accent)" />
    <circle cx="0"    cy="-21.5" r="2.6" fill="var(--accent)" />
    <circle cx="4.5"  cy="-19.5" r="2.6" fill="var(--accent)" />
  </g>
  <g class="wbn-fp wf4" transform="translate(179,88) rotate(-12)">
    <ellipse cx="0" cy="-7" rx="7" ry="11" fill="var(--accent)" />
    <circle cx="-4.5" cy="-19.5" r="2.6" fill="var(--accent)" />
    <circle cx="0"    cy="-21.5" r="2.6" fill="var(--accent)" />
    <circle cx="4.5"  cy="-19.5" r="2.6" fill="var(--accent)" />
  </g>
  <g class="wbn-fp wf5" transform="translate(222,97) rotate(12)">
    <ellipse cx="0" cy="-7" rx="7" ry="11" fill="var(--accent)" />
    <circle cx="-4.5" cy="-19.5" r="2.6" fill="var(--accent)" />
    <circle cx="0"    cy="-21.5" r="2.6" fill="var(--accent)" />
    <circle cx="4.5"  cy="-19.5" r="2.6" fill="var(--accent)" />
  </g>
  <g class="wbn-fp wf6" transform="translate(265,88) rotate(-12)">
    <ellipse cx="0" cy="-7" rx="7" ry="11" fill="var(--accent)" />
    <circle cx="-4.5" cy="-19.5" r="2.6" fill="var(--accent)" />
    <circle cx="0"    cy="-21.5" r="2.6" fill="var(--accent)" />
    <circle cx="4.5"  cy="-19.5" r="2.6" fill="var(--accent)" />
  </g>
  <g class="wbn-fp wf7" transform="translate(308,97) rotate(12)">
    <ellipse cx="0" cy="-7" rx="7" ry="11" fill="var(--accent)" />
    <circle cx="-4.5" cy="-19.5" r="2.6" fill="var(--accent)" />
    <circle cx="0"    cy="-21.5" r="2.6" fill="var(--accent)" />
    <circle cx="4.5"  cy="-19.5" r="2.6" fill="var(--accent)" />
  </g>
  <g class="wbn-fp wf8" transform="translate(351,88) rotate(-12)">
    <ellipse cx="0" cy="-7" rx="7" ry="11" fill="var(--accent)" />
    <circle cx="-4.5" cy="-19.5" r="2.6" fill="var(--accent)" />
    <circle cx="0"    cy="-21.5" r="2.6" fill="var(--accent)" />
    <circle cx="4.5"  cy="-19.5" r="2.6" fill="var(--accent)" />
  </g>

  <!--
    Zzz's — three letters staggered in size and position,
    each rising upward and fading in a loop.
    wz1 = big/low, wz2 = medium/mid, wz3 = small/high.
  -->
  <text class="wbn-z wz1" x="398" y="95"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="22" font-weight="800"
    fill="var(--accent)" text-anchor="middle">Z</text>
  <text class="wbn-z wz2" x="420" y="74"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="16" font-weight="800"
    fill="var(--accent)" text-anchor="middle">Z</text>
  <text class="wbn-z wz3" x="438" y="57"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="12" font-weight="800"
    fill="var(--accent)" text-anchor="middle">Z</text>

  <!-- Stars — scattered above the footstep path -->
  <circle class="wbn-star ws1" cx="68"  cy="26"  r="1.6" fill="var(--accent)" />
  <circle class="wbn-star ws2" cx="158" cy="16"  r="1.3" fill="var(--accent)" />
  <circle class="wbn-star ws3" cx="250" cy="30"  r="1.8" fill="var(--accent)" />
  <circle class="wbn-star ws4" cx="345" cy="20"  r="1.4" fill="var(--accent)" />
  <circle class="wbn-star ws5" cx="468" cy="24"  r="1.7" fill="var(--accent)" />
  <circle class="wbn-star ws6" cx="488" cy="68"  r="1.2" fill="var(--accent)" />
</svg>

<style>
  .wbn-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* ── Trail fade-in ────────────────────────────────────────────────────────── */
  .wbn-trail {
    opacity: 0;
    animation: wbn-trail-in 0.6s ease 0.05s forwards;
  }
  @keyframes wbn-trail-in {
    to { opacity: 1; }
  }

  /* ── Footprints ───────────────────────────────────────────────────────────── */
  /* Group opacity drives visibility — no bleed between overlapping shapes */
  .wbn-fp {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: wbn-fp-stamp 0.30s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
  .wf1 { animation-delay: 0.08s; }
  .wf2 { animation-delay: 0.22s; }
  .wf3 { animation-delay: 0.36s; }
  .wf4 { animation-delay: 0.50s; }
  .wf5 { animation-delay: 0.64s; }
  .wf6 { animation-delay: 0.78s; }
  .wf7 { animation-delay: 0.92s; }
  .wf8 { animation-delay: 1.06s; }

  @keyframes wbn-fp-stamp {
    from { opacity: 0;    transform: scale(0.45) translateY(4px); }
    to   { opacity: 0.28; transform: scale(1)    translateY(0); }
  }

  /* ── Zzz's ───────────────────────────────────────────────────────────────── */
  .wbn-z {
    opacity: 0;
    animation: wbn-z-rise 2.4s ease-in-out infinite;
  }
  /* Each Z is staggered so they sequence nicely: big → medium → small */
  .wz1 { animation-delay: 0.30s; animation-duration: 2.5s; }
  .wz2 { animation-delay: 0.95s; animation-duration: 2.2s; }
  .wz3 { animation-delay: 1.55s; animation-duration: 1.9s; }

  @keyframes wbn-z-rise {
    0%   { opacity: 0;    transform: translateY(0);     }
    18%  { opacity: 0.72;                               }
    75%  { opacity: 0.42;                               }
    100% { opacity: 0;    transform: translateY(-30px); }
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
    50%       { opacity: 0.30; transform: scale(1.4); }
  }

  /* ── No-loop: looping animations play once then freeze ───────────────────── */
  .wbn-svg.no-loop .wbn-z {
    animation-iteration-count: 1;
    animation-fill-mode: forwards;
  }
  .wbn-svg.no-loop .wbn-star {
    animation-iteration-count: 1;
    animation-fill-mode: forwards;
  }

  /* ── No-anim: everything static at their final resting state ─────────────── */
  .wbn-svg.no-anim .wbn-trail { animation: none; opacity: 1; }
  .wbn-svg.no-anim .wbn-fp    { animation: none; opacity: 0.28; transform: scale(1); }
  .wbn-svg.no-anim .wbn-z     { animation: none; opacity: 0.55; transform: translateY(-14px); }
  .wbn-svg.no-anim .wbn-star  { animation: none; opacity: 0.20; }

  @media (prefers-reduced-motion: reduce) {
    .wbn-trail { animation: none !important; opacity: 1 !important; }
    .wbn-fp    { animation: none !important; opacity: 0.28 !important; transform: scale(1) !important; }
    .wbn-z     { animation: none !important; opacity: 0.55 !important; transform: translateY(-14px) !important; }
    .wbn-star  { animation: none !important; opacity: 0.20 !important; }
  }
</style>
