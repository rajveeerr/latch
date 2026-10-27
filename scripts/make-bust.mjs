// Builds ui/art/bust.svg: a modern marble bust in profile. Hand-built vector shapes, no raster, no filters
// beyond soft blur for shading. The hair is carved snail-shell curls (a spiral inside each), as on classical statues.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const f = (n) => n.toFixed(1);

// a spiral inside a circle, as a polyline path
function spiral(cx, cy, r, turns = 1.75, start = 0.4) {
  const pts = [];
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + t * turns * Math.PI * 2;
    const rad = r * 0.82 * (1 - t * 0.92);
    pts.push(`${f(cx + Math.cos(a) * rad)},${f(cy + Math.sin(a) * rad)}`);
  }
  return `M${pts.join(' L')}`;
}

const curls = [];
function curl(cx, cy, r, tone = 'a', turns, start) {
  curls.push({ cx, cy, r, tone, turns, start });
}

// back and crown: two rings of curls around the skull
const CX = 238, CY = 204;
for (let i = 0; i <= 11; i++) {                         // outer ring, from the nape up over the crown to the front
  const a = (Math.PI * (178 - i * 14.2)) / 180;
  curl(CX + Math.cos(a) * 98, CY - Math.sin(a) * 96, 29, i % 3 === 0 ? 'c' : 'a', 1.6 + (i % 3) * 0.15, i * 0.9);
}
for (let i = 0; i <= 8; i++) {                          // inner ring
  const a = (Math.PI * (170 - i * 17)) / 180;
  curl(CX + Math.cos(a) * 62, CY - Math.sin(a) * 62 - 6, 25, 'b', 1.7, i * 1.3);
}
// nape
curl(168, 318, 22, 'c', 1.6, 0.2);
curl(196, 338, 19, 'c', 1.5, 1.0);
curl(150, 288, 24, 'c', 1.6, 2.1);

// fringe along the hairline, small and tight
const fringe = [[318, 168, 13], [312, 150, 15], [298, 134, 16], [278, 124, 17], [256, 120, 17], [234, 124, 17], [214, 138, 16], [201, 158, 15], [196, 182, 14]];
const fringeCurls = fringe.map(([cx, cy, r], i) => ({ cx, cy, r, tone: 'a', turns: 1.5, start: i * 0.8 }));

const curlSvg = (c) => `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(c.r)}" fill="url(#curl${c.tone})"/>` +
  `<path d="${spiral(c.cx, c.cy, c.r, c.turns, c.start)}" fill="none" stroke="#8D8573" stroke-width="2" stroke-linecap="round" opacity=".6"/>`;

const FACE = 'M158 262 C152 180 196 116 262 116 C300 116 322 142 324 178 L326 212 C338 238 348 262 356 282 C350 288 346 290 340 292 C338 298 338 302 338 304 C345 306 348 311 345 316 C342 318 340 319 338 319 C345 322 347 328 343 334 C340 339 339 344 341 350 C344 362 338 376 322 386 C312 392 296 396 280 396 L262 396 C236 386 216 366 202 340 C176 330 160 300 158 262 Z';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 600" width="480" height="600" role="img" aria-label="A marble bust in profile">
  <defs>
    <linearGradient id="skin" x1="1" y1="0" x2="0" y2="0.3">
      <stop offset="0" stop-color="#FCFBF7"/><stop offset=".42" stop-color="#F0ECE3"/><stop offset="1" stop-color="#D5CEBF"/>
    </linearGradient>
    <linearGradient id="chest" x1="0.2" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#F5F2EA"/><stop offset="1" stop-color="#CDC6B6"/>
    </linearGradient>
    <linearGradient id="curla" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#F6F3EC"/><stop offset=".55" stop-color="#E2DCCF"/><stop offset="1" stop-color="#BFB7A5"/>
    </linearGradient>
    <linearGradient id="curlb" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#EFEBE1"/><stop offset=".55" stop-color="#D8D1C2"/><stop offset="1" stop-color="#B3AB98"/>
    </linearGradient>
    <linearGradient id="curlc" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#DDD7CA"/><stop offset=".55" stop-color="#C8C0AE"/><stop offset="1" stop-color="#9F9784"/>
    </linearGradient>
    <linearGradient id="plinth" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#E4DFD3"/><stop offset=".6" stop-color="#F4F1EA"/><stop offset="1" stop-color="#CEC7B8"/>
    </linearGradient>
    <linearGradient id="cool" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6F7886" stop-opacity=".16"/><stop offset=".6" stop-color="#6F7886" stop-opacity=".04"/><stop offset="1" stop-color="#6F7886" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="faceClip"><path d="${FACE}"/></clipPath>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="softer" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="hair-shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5"/></filter>
  </defs>

  <ellipse cx="240" cy="566" rx="168" ry="12" fill="#1A1917" opacity=".10"/>

  <!-- plinth -->
  <rect x="104" y="524" width="272" height="38" rx="3" fill="url(#plinth)"/>
  <rect x="104" y="524" width="272" height="5" rx="2" fill="#fff" opacity=".6"/>
  <rect x="128" y="494" width="224" height="34" rx="3" fill="url(#plinth)"/>
  <rect x="128" y="494" width="224" height="4" rx="2" fill="#fff" opacity=".6"/>

  <!-- chest and drapery -->
  <path d="M88 500 C96 458 146 438 186 430 L296 428 C346 438 380 464 388 500 Z" fill="url(#chest)"/>
  <path d="M186 430 C206 454 238 472 270 482 C322 496 368 498 388 500 L350 500 C300 494 236 472 196 442 Z" fill="#C4BCAA" opacity=".55"/>
  <path d="M120 472 C150 454 180 448 206 454 C186 472 160 488 132 500 L96 500 C100 490 108 480 120 472 Z" fill="#fff" opacity=".38"/>
  <path d="M236 438 C264 458 302 472 346 480" fill="none" stroke="#A9A18E" stroke-width="2" opacity=".55" stroke-linecap="round"/>
  <path d="M232 436 C214 448 204 462 202 480" fill="none" stroke="#A9A18E" stroke-width="1.6" opacity=".4" stroke-linecap="round"/>

  <g transform="translate(0 10)">
    <!-- neck -->
    <path d="M196 330 C194 372 190 404 188 428 L296 426 C292 406 290 386 288 364 L284 338 Z" fill="url(#skin)"/>
    <path d="M196 330 C194 372 190 404 188 428 L214 430 C216 396 218 364 224 338 Z" fill="#B6AE9C" opacity=".34"/>
    <path d="M250 372 C262 392 270 410 272 426" fill="none" stroke="#B5AD9B" stroke-width="2" opacity=".5" stroke-linecap="round"/>
    <ellipse cx="262" cy="384" rx="44" ry="20" fill="#8F8672" opacity=".32" filter="url(#soft)"/>

    <!-- curls behind the face -->
    ${curls.map(curlSvg).join('\n    ')}

    <!-- face -->
    <path id="face" d="${FACE}" fill="url(#skin)"/>
    <path d="${FACE}" fill="url(#cool)"/>

    <!-- planes: three tonal steps from light to shadow, kept inside the silhouette -->
    <g clip-path="url(#faceClip)">
    <path d="M292 214 L326 212 C332 224 338 236 342 246 L312 244 C304 236 296 226 292 214 Z" fill="#fff" opacity=".42" filter="url(#softer)"/>      <!-- brow and nose bridge, lit -->
    <path d="M326 214 C338 240 348 264 356 282 L342 290 C338 270 332 240 322 224 Z" fill="#8F8672" opacity=".12" filter="url(#softer)"/>                                      <!-- far side of the nose -->
    <path d="M298 252 C282 258 270 276 264 306 C260 336 252 358 238 374 C256 384 276 388 300 384 C312 366 322 344 322 320 C316 296 308 270 298 252 Z" fill="#8F8672" opacity=".09" filter="url(#soft)"/>   <!-- cheek into jaw, mid tone -->
    <path d="M262 148 L322 176 L326 212 L296 208 L268 190 Z" fill="#fff" opacity=".34" filter="url(#softer)"/>                                           <!-- brow and temple plane, lit -->
    <ellipse cx="296" cy="250" rx="11" ry="15" fill="#8F8672" opacity=".16" filter="url(#softer)"/>                                                    <!-- hollow under the eye -->
    <path d="M298 258 C312 253 326 259 331 272 C317 270 306 268 298 258 Z" fill="#fff" opacity=".42" filter="url(#softer)"/>                           <!-- cheekbone catching the light -->
    <path d="M238 336 L304 340 L324 388 L262 394 L228 362 Z" fill="#6F6A60" opacity=".16" filter="url(#soft)"/>                                        <!-- jaw plane turning away -->
    <path d="M326 214 C338 240 348 264 356 282" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.4" stroke-linecap="round" filter="url(#softer)"/>   <!-- nose bridge light -->
    <path d="M228 232 C250 262 262 300 284 332" fill="none" stroke="#8E8674" stroke-width="1.2" opacity=".26" stroke-linecap="round"/>                  <!-- marble veins across the face -->
    <path d="M208 300 C230 322 250 342 272 374" fill="none" stroke="#8E8674" stroke-width="1.1" opacity=".22" stroke-linecap="round"/>
    <path d="M214 232 C206 270 214 320 236 372 C250 380 262 384 272 384 C246 350 232 300 238 238 Z" fill="#7F7A70" opacity=".20" filter="url(#soft)"/>   <!-- shadow plane toward the ear -->
    <ellipse cx="304" cy="231" rx="14" ry="9" fill="#8F8672" opacity=".24" filter="url(#softer)"/>                                                       <!-- eye socket -->
    <ellipse cx="337" cy="298" rx="9" ry="5" fill="#8F8672" opacity=".26" filter="url(#softer)"/>                                                         <!-- under the nose -->
    <path d="M336 352 C334 362 326 372 312 378" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round" filter="url(#softer)"/>   <!-- chin light -->

    </g>
    <!-- a faint contour keeps the lit edge readable on any ground, and the jaw is defined -->
    <path d="${FACE}" fill="none" stroke="#B9B1A0" stroke-width="1.4" opacity=".75" stroke-linejoin="round"/>
    <path d="M322 386 C296 394 262 392 238 374 C226 362 218 348 214 332" fill="none" stroke="#9C9482" stroke-width="2" opacity=".35" stroke-linecap="round"/>

    <!-- features -->
    <path d="M288 215 C300 207 313 207 326 213" fill="none" stroke="#8F8674" stroke-width="3" stroke-linecap="round" opacity=".5"/>
    <path d="M293 230 C301 225 311 225 320 231" fill="none" stroke="#857D6B" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M296 236 C304 239 312 238 318 235" fill="none" stroke="#9C9482" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
    <path d="M340 293 C336 297 331 297 327 294" fill="none" stroke="#857D6B" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M338 319 C335 322 330 322 326 321" fill="none" stroke="#857D6B" stroke-width="2.4" stroke-linecap="round"/>

    <!-- ear -->
    <path d="M222 250 C200 242 192 276 212 300 C220 290 226 270 222 250 Z" fill="#E6E0D3"/>
    <path d="M216 256 C207 262 207 276 213 288" fill="none" stroke="#A39A87" stroke-width="2" stroke-linecap="round"/>
    <path d="M221 262 C217 268 217 276 219 283" fill="none" stroke="#B5AD9B" stroke-width="1.6" stroke-linecap="round"/>

    <!-- shadow the hairline casts, then the fringe curls -->
    <path d="M200 190 C196 160 214 136 240 128 C268 120 296 128 312 148 C320 160 322 172 322 182" fill="none" stroke="#7F7A70" stroke-width="12" opacity=".30" filter="url(#hair-shadow)"/>
    ${fringeCurls.map(curlSvg).join('\n    ')}
  </g>

  <!-- marble veins -->
  <g fill="none" stroke="#8E8674" stroke-width="1.2" opacity=".3" stroke-linecap="round">
    <path d="M250 440 C270 452 290 456 330 474 C352 484 366 488 380 496"/>
    <path d="M130 488 C150 470 176 458 200 456"/>
    <path d="M118 520 C160 514 220 516 262 526"/>
    <path d="M300 506 C320 512 340 514 366 512"/>
    <path d="M262 362 C274 370 286 374 298 376"/>
  </g>
</svg>
`;
writeFileSync(path.join(root, 'ui/art/bust.svg'), svg);
console.log('bust written,', curls.length + fringeCurls.length, 'curls');
