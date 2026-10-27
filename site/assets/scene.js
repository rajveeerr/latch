// The painted scene behind Kerby: a dusk coast, an engraved sun, a far temple and a marble gate.
// Three layers (back, mid, front) so the trading card can shift them at different depths.

const COLS = (x0, y0, n, gap, h, w = 5) => [...Array(n)].map((_, i) => `<rect x="${x0 + i * gap}" y="${y0}" width="${w}" height="${h}" rx="1"/>`).join('');

export function mountScene(container) {
  const rays = [...Array(28)].map((_, i) => {
    const a = (i / 28) * Math.PI * 2, r1 = 40, r2 = 88 + (i % 2) * 22;
    return `M${(214 + Math.cos(a) * r1).toFixed(1)} ${(128 + Math.sin(a) * r1).toFixed(1)}L${(214 + Math.cos(a) * r2).toFixed(1)} ${(128 + Math.sin(a) * r2).toFixed(1)}`;
  }).join('');
  const sea = [...Array(9)].map((_, i) => `M${20 + (i % 3) * 30} ${150 + i * 4.2}h${110 - (i % 4) * 14}`).join('');
  const flutes = (x) => `M${x + 8} 40v186M${x + 16} 40v186M${x + 24} 40v186`;

  container.innerHTML = `
<svg class="scene" viewBox="0 0 306 270" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101c55"/><stop offset=".42" stop-color="#2c4fc4"/><stop offset=".74" stop-color="#8aa4f0"/><stop offset="1" stop-color="#f5c7a9"/></linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f90ee"/><stop offset="1" stop-color="#3556c9"/></linearGradient>
    <linearGradient id="marble" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f7f3ea"/><stop offset=".6" stop-color="#e9e2d3"/><stop offset="1" stop-color="#cfc6b3"/></linearGradient>
  </defs>
  <g class="layer-back">
    <rect width="306" height="270" fill="url(#sky)"/>
    <g fill="#fff" opacity=".6"><circle cx="40" cy="30" r="1.1"/><circle cx="96" cy="18" r="1.4"/><circle cx="150" cy="40" r="1"/><circle cx="268" cy="26" r="1.2"/><circle cx="238" cy="52" r="1"/><circle cx="20" cy="70" r="1"/></g>
    <path d="${rays}" stroke="#fff3da" stroke-opacity=".22" stroke-width=".8" fill="none"/>
    <circle cx="214" cy="128" r="34" fill="#fff1d6"/>
    <circle cx="214" cy="128" r="34" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>
    <g fill="#fff" opacity=".14"><ellipse cx="70" cy="96" rx="44" ry="7"/><ellipse cx="108" cy="110" rx="32" ry="5"/><ellipse cx="250" cy="78" rx="30" ry="5"/></g>
  </g>
  <g class="layer-mid">
    <rect y="146" width="306" height="40" fill="url(#sea)"/>
    <path d="${sea}" stroke="#fff" stroke-opacity=".18" stroke-width=".8" fill="none"/>
    <path d="M0 150c30-12 70-16 110-8 40 8 78 6 120-6 28-8 56-6 76 0v50H0z" fill="#33479b"/>
    <g transform="translate(40 108)"><rect x="0" y="34" width="86" height="4" fill="#e9e2d3"/><g fill="#f3eee3">${COLS(6, 10, 6, 14, 24)}</g><path d="M2 10l41-14 41 14z" fill="#e9e2d3"/><rect x="2" y="9" width="82" height="3" fill="#cfc6b3"/></g>
    <path d="M0 176c40-14 80-16 120-6 52 12 108 6 186-14v114H0z" fill="#26397f"/>
  </g>
  <g class="layer-front">
    <path d="M0 214c46-12 84-8 128 2 56 12 118 4 178-16v70H0z" fill="#1c2c66"/>
    <path d="M0 236c62-10 104-4 150 6 54 10 110 4 156-8v36H0z" fill="#efe9dd"/>
    <path d="M0 252c70-6 120 0 160 8 50 8 96 4 146-4v14H0z" fill="#dcd4c3"/>
    <g fill="url(#marble)"><rect x="30" y="34" width="32" height="196" rx="3"/><rect x="244" y="34" width="32" height="196" rx="3"/><rect x="22" y="24" width="262" height="18" rx="3"/><rect x="26" y="226" width="40" height="8" rx="2"/><rect x="240" y="226" width="40" height="8" rx="2"/></g>
    <path d="${flutes(30)}${flutes(244)}" stroke="#bdb4a0" stroke-opacity=".7" stroke-width=".9" fill="none"/>
    <rect x="22" y="24" width="262" height="3" rx="1.5" fill="#fff" opacity=".7"/>
    <path d="M120 24h66l-6 18h-54z" fill="#d6cdb9"/><path d="M153 30v6" stroke="#2b4fdb" stroke-width="3" stroke-linecap="round"/>
    <path d="M276 128c8 6 12 24 10 60l-10 4c-4-30-6-52 0-64z" fill="#14204f" opacity=".85"/>
  </g>
</svg>`;
}

// A laurel branch that crosses the edge of the card: the one thing that breaks the frame.
export const BRANCH = '<svg class="branch" viewBox="0 0 120 150" aria-hidden="true"><path d="M20 140C34 100 64 60 104 16" fill="none" stroke="#6f8e5c" stroke-width="3" stroke-linecap="round"/><g fill="#86a273" stroke="#6f8e5c" stroke-width="1"><ellipse cx="30.3" cy="127.6" rx="10" ry="4.2" transform="rotate(-104 25.7 125.6)"/><ellipse cx="21.1" cy="123.6" rx="10" ry="4.2" transform="rotate(-28 25.7 125.6)"/><ellipse cx="35.9" cy="115.9" rx="10" ry="4.2" transform="rotate(-101 31.5 113.6)"/><ellipse cx="27.1" cy="111.3" rx="10" ry="4.2" transform="rotate(-25 31.5 113.6)"/><ellipse cx="42.5" cy="104.0" rx="10" ry="4.2" transform="rotate(-98 38.2 101.5)"/><ellipse cx="33.8" cy="98.9" rx="10" ry="4.2" transform="rotate(-22 38.2 101.5)"/><ellipse cx="49.9" cy="92.0" rx="10" ry="4.2" transform="rotate(-95 45.7 89.3)"/><ellipse cx="41.5" cy="86.6" rx="10" ry="4.2" transform="rotate(-19 45.7 89.3)"/><ellipse cx="58.1" cy="79.9" rx="10" ry="4.2" transform="rotate(-93 54.0 77.0)"/><ellipse cx="49.9" cy="74.2" rx="10" ry="4.2" transform="rotate(-17 54.0 77.0)"/><ellipse cx="67.0" cy="67.7" rx="10" ry="4.2" transform="rotate(-91 63.1 64.6)"/><ellipse cx="59.1" cy="61.6" rx="10" ry="4.2" transform="rotate(-15 63.1 64.6)"/><ellipse cx="76.8" cy="55.2" rx="10" ry="4.2" transform="rotate(-89 72.9 52.1)"/><ellipse cx="69.0" cy="49.0" rx="10" ry="4.2" transform="rotate(-13 72.9 52.1)"/><ellipse cx="87.2" cy="42.6" rx="10" ry="4.2" transform="rotate(-88 83.4 39.4)"/><ellipse cx="79.6" cy="36.2" rx="10" ry="4.2" transform="rotate(-12 83.4 39.4)"/><ellipse cx="98.3" cy="29.8" rx="10" ry="4.2" transform="rotate(-87 94.6 26.5)"/><ellipse cx="90.8" cy="23.2" rx="10" ry="4.2" transform="rotate(-11 94.6 26.5)"/><ellipse cx="104.0" cy="16.0" rx="10" ry="4.2" transform="rotate(-48 104.0 16.0)"/></g></svg>';
