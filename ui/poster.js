// The engraved poster behind the lock screen: concentric rings, a ruler of ticks, a circle of monospace type,
// Greek-key bands and corner ornaments. Single-colour line work, like a cobalt engraving on paper (or pale ink on
// a deep blue plate in dark mode). The colour comes from CSS (--poster-ink).

const KEY = (w) => { let d = ''; for (let x = 0; x < w; x += 24) d += `M${x} 20v-12h12v8h-6v-4h-2v10h4`; return d; };

export function mountPoster(container) {
  const rings = [...Array(11)].map((_, i) => `<circle cx="800" cy="500" r="${150 + i * 66}" opacity="${(0.9 - i * 0.07).toFixed(2)}"/>`).join('');
  const rays = [...Array(36)].map((_, i) => { const a = i * 10 * Math.PI / 180; return `M${(800 + Math.cos(a) * 150).toFixed(1)} ${(500 + Math.sin(a) * 150).toFixed(1)}L${(800 + Math.cos(a) * 880).toFixed(1)} ${(500 + Math.sin(a) * 880).toFixed(1)}`; }).join('');
  const ticks = [...Array(180)].map((_, i) => { const a = i * 2 * Math.PI / 180, long = i % 5 === 0, r1 = 612, r2 = long ? 626 : 620; return `M${(800 + Math.cos(a) * r1).toFixed(1)} ${(500 + Math.sin(a) * r1).toFixed(1)}L${(800 + Math.cos(a) * r2).toFixed(1)} ${(500 + Math.sin(a) * r2).toFixed(1)}`; }).join('');
  container.innerHTML = `
<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><path id="textRing" d="M800 500m-588 0a588 588 0 1 1 1176 0a588 588 0 1 1-1176 0"/></defs>
  <g fill="none" stroke="currentColor" stroke-width="1">${rings}</g>
  <g fill="none" stroke="currentColor" stroke-width="1" opacity=".5"><path d="${rays}"/></g>
  <g fill="none" stroke="currentColor" stroke-width="1.2" opacity=".8"><path d="${ticks}"/></g>
  <text class="ring-text" fill="currentColor" font-size="15" letter-spacing="9"><textPath href="#textRing" startOffset="2%">LATCH · A QUIET LOCK FOR YOUR BROWSER · NOTHING GETS PAST THE GATE · AEGIS ON GUARD · NO TABS LOST · NO TABS LOST · AEGIS ON GUARD · NOTHING GETS PAST THE GATE ·</textPath></text>
  <g fill="none" stroke="currentColor" stroke-width="1.4"><path transform="translate(0 0)" d="${KEY(1600)}"/><path transform="translate(0 976)" d="${KEY(1600)}"/></g>
  <g fill="none" stroke="currentColor" stroke-width="1.6" opacity=".9">
    <path d="M30 80V40a10 10 0 0 1 10-10h40M1570 80V40a10 10 0 0 0-10-10h-40M30 920v40a10 10 0 0 0 10 10h40M1570 920v40a10 10 0 0 1-10 10h-40"/>
  </g>
</svg>`;
}
