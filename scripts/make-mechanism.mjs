// Builds the isometric latch mechanism: site/mechanism.js (the landing page animation) and static art in docs/art.
//
// The figure follows a few fixed rules so it reads as a real object: isometric camera at 30 degrees,
// solid parts painted back to front, four shading tones, one accent colour for the lit part, and no
// text. The bolt, the spring coils and the lamp move when Latch locks and unlocks.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COS, SIN, SCALE, transformFor } from './mechanism-motion.js';

const root = path.resolve(import.meta.dirname, '..');

// Tones are [top, left face, right face]. Marble neutrals, ink, and one patina accent.
const TONES = {
  stone: ['#F7F4EE', '#DDD7CA', '#C5BDAC'],
  slab: ['#E6E1D5', '#CCC5B5', '#B4AC99'],
  ink: ['#55524D', '#37352F', '#242321'],
  steel: ['#F0EEEA', '#D3D0CA', '#B8B4AC'],
  bolt: ['#77736C', '#524F49', '#3A3833'],            // dark enough that its position reads at small sizes
  lampOn: ['#7BE0C4', '#35A68C', '#25806B'],
  lampOff: ['#DAD6CE', '#C1BDB3', '#A9A59B'],
};

const parts = [];
// move: 'bolt' (slides with the bolt), 'coil' (spring coil at `fraction` along its length), undefined (fixed)
function box(x, y, z, w, d, h, tone, extra = {}) {
  parts.push({ x, y, z, w, d, h, tone, ...extra });
}

// ---- the object ----
box(0, 0, 0, 17, 11, 1.2, 'slab');                         // base plate

// channel: low housing walls so the working parts stay visible
box(1, 2, 1.2, 7, 1, 1.4, 'stone');                        // housing back wall
box(1, 8, 1.2, 7, 1, 1.4, 'stone');                        // housing front wall
box(1, 3, 1.2, 1, 5, 1.4, 'stone');                        // housing end wall
box(2, 3, 1.2, 12, 0.5, 0.3, 'steel');                     // guide rail, back
box(2, 7.5, 1.2, 12, 0.5, 0.3, 'steel');                   // guide rail, front

// strike plate: the pocket the bolt drops into
box(11, 2, 1.2, 5, 7, 0.5, 'steel');                       // plate
box(11, 2, 1.7, 5, 1, 1.4, 'stone');                       // pocket back wall
box(11, 8, 1.7, 5, 1, 1.4, 'stone');                       // pocket front wall
box(15, 3, 1.7, 1, 5, 1.4, 'stone');                       // pocket end stop
for (let i = 0; i < 4; i++) box(11.6 + i * 1.1, 8.2, 3.1, 0.5, 0.6, 0.3, 'ink');   // grip ribs on the front wall

// the bolt and everything that travels with it
box(3.4, 4, 1.5, 5.2, 3, 1.8, 'bolt', { move: 'bolt' });           // bolt body
box(8.6, 4.3, 1.6, 1.1, 2.4, 1.6, 'bolt', { move: 'bolt' });       // chamfered tip
for (let i = 0; i < 3; i++) box(4.1 + i * 1.3, 4.4, 3.3, 0.6, 2.2, 0.3, 'steel', { move: 'bolt' });   // grip ribs
box(3.4, 5.1, 3.3, 0.5, 0.8, 0.5, 'stone', { move: 'bolt' });      // pull pin

// the spring: coils between the end wall and the bolt
const COILS = 8;
for (let i = 0; i < COILS; i++) {
  const f = i / (COILS - 1);
  box(2.2 + f * 1.0, 4.2, 1.8, 0.28, 2.6, 1.3, 'ink', { move: 'coil', fraction: f });
}

// key cylinder on the front of the housing, with the lit lamp on top
box(3, 9, 1.2, 4, 1.6, 3.0, 'steel');                      // cylinder body
box(3.6, 10.6, 2.0, 2.8, 0.15, 1.4, 'stone');              // face plate
box(4.6, 10.75, 2.5, 0.8, 0.12, 0.5, 'ink');               // keyway
box(3.8, 9.3, 4.2, 1.4, 1.0, 0.5, 'lampOff', { lamp: true });
box(4.0, 9.45, 4.7, 1.0, 0.7, 0.3, 'lampOff', { lamp: true });

// four screws in the base plate corners (round head approximated by a washer and a slotted block)
for (const [sx, sy] of [[0.6, 0.6], [15.4, 0.6], [0.6, 9.4], [15.4, 9.4]]) {
  box(sx - 0.45, sy - 0.45, 1.2, 0.9, 0.9, 0.25, 'steel');
  box(sx - 0.3, sy - 0.3, 1.45, 0.6, 0.6, 0.3, 'steel');
  box(sx - 0.28, sy - 0.05, 1.75, 0.56, 0.1, 0.06, 'ink');
}

// ---- projection and painter's order ----
const project = (x, y, z) => [(x - y) * COS * SCALE, ((x + y) * SIN - z) * SCALE];
const pts = (arr) => arr.map(([x, y, z]) => project(x, y, z).map((n) => n.toFixed(1)).join(',')).join(' ');

// A is behind B when it lies wholly on the far side of B along some axis.
const behind = (a, b) => a.x + a.w <= b.x + 1e-6 || a.y + a.d <= b.y + 1e-6 || a.z + a.h <= b.z + 1e-6;
function paintOrder(list) {
  const edges = list.map(() => new Set());
  const indegree = list.map(() => 0);
  list.forEach((a, i) => list.forEach((b, j) => {
    if (i === j) return;
    if (behind(a, b) && !behind(b, a)) { edges[i].add(j); }
  }));
  edges.forEach((set) => set.forEach((j) => indegree[j]++));
  const depth = (p) => p.x + p.w / 2 + p.y + p.d / 2 + p.z + p.h / 2;
  const ready = list.map((_, i) => i).filter((i) => indegree[i] === 0);
  const out = [];
  while (ready.length) {
    ready.sort((a, b) => depth(list[b]) - depth(list[a]));      // farthest first
    const i = ready.pop();
    out.push(i);
    edges[i].forEach((j) => { if (--indegree[j] === 0) ready.push(j); });
  }
  if (out.length < list.length) list.forEach((_, i) => { if (!out.includes(i)) out.push(i); });   // cycles: fall back
  return out.map((i) => list[i]);
}

const ordered = paintOrder(parts);

function drawBox(p, id) {
  const { x, y, z, w, d, h } = p;
  const [top, left, right] = TONES[p.tone];
  const faces = [
    `<polygon class="${p.lamp ? 'lamp-l' : ''}" fill="${left}" points="${pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])}"/>`,
    `<polygon class="${p.lamp ? 'lamp-r' : ''}" fill="${right}" points="${pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])}"/>`,
    `<polygon class="${p.lamp ? 'lamp-t' : ''}" fill="${top}" points="${pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])}"/>`,
  ];
  // a light edge along the front of the top face keeps the solids crisp
  const edge = `<polyline fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8" stroke-linejoin="round" points="${pts([[x, y + d, z + h], [x + w, y + d, z + h], [x + w, y, z + h]])}"/>`;
  return `${faces.join('')}${edge}`;
}

// a soft cast shadow of the base plate, offset along the light
const shadow = `<polygon fill="#1A1917" fill-opacity=".10" filter="url(#blur)" points="${pts([[1.5, 1.5, 0], [19, 1.5, 0], [19, 12.5, 0], [1.5, 12.5, 0]])}"/>`;

// bounds
const all = ordered.flatMap((p) => [[p.x, p.y, p.z], [p.x + p.w, p.y + p.d, p.z + p.h], [p.x + p.w, p.y, p.z + p.h], [p.x, p.y + p.d, p.z + p.h], [p.x + p.w, p.y + p.d, p.z], [p.x, p.y, p.z]].map(([a, b, c]) => project(a, b, c)));
const minX = Math.min(...all.map((q) => q[0])) - 14, maxX = Math.max(...all.map((q) => q[0])) + 30;
const minY = Math.min(...all.map((q) => q[1])) - 12, maxY = Math.max(...all.map((q) => q[1])) + 34;
const viewBox = `${minX.toFixed(0)} ${minY.toFixed(0)} ${(maxX - minX).toFixed(0)} ${(maxY - minY).toFixed(0)}`;

function svg(t, { animated }) {
  const body = ordered.map((p, i) => {
    const attrs = [];
    if (p.move) attrs.push(`data-move="${p.move}"`);
    if (p.fraction !== undefined) attrs.push(`data-f="${p.fraction.toFixed(3)}"`);
    if (!animated && p.move) attrs.push(`transform="${transformFor(p.move, p.fraction, t)}"`);
    let drawn = drawBox(p, i);
    if (!animated && p.lamp && t >= 0.5) {
      const on = TONES.lampOn;
      drawn = drawn.replace(TONES.lampOff[0], on[0]).replace(TONES.lampOff[1], on[1]).replace(TONES.lampOff[2], on[2]);
    }
    return `<g ${attrs.join(' ')}>${drawn}</g>`;
  }).join('\n');
  return `<defs><filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter></defs>\n${shadow}\n${body}`;
}

const wrap = (t, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">\n${svg(t, { animated: false })}\n</svg>\n`;
writeFileSync(path.join(root, 'docs/art/latch-unlocked.svg'), wrap(0, 'An isometric latch mechanism with its bolt retracted'));
writeFileSync(path.join(root, 'docs/art/latch-locked.svg'), wrap(1, 'An isometric latch mechanism with its bolt extended into the strike plate'));

// the module the landing page uses: markup plus a small animator, with the motion rules inlined
const motion = readFileSync(path.join(import.meta.dirname, 'mechanism-motion.js'), 'utf8').replace(/^export /gm, '');
const markup = svg(0, { animated: true });
writeFileSync(path.join(root, 'site/mechanism.js'), `// Generated by scripts/make-mechanism.mjs. Do not edit by hand.
${motion}
const LAMP_ON = ${JSON.stringify(TONES.lampOn)};
const LAMP_OFF = ${JSON.stringify(TONES.lampOff)};
const MARKUP = ${JSON.stringify(markup)};

// Draws the mechanism into the container. Returns { set(locked, animate) } to move the bolt.
export function mountMechanism(container, locked = false) {
  container.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="A latch mechanism">' + MARKUP + '</svg>';
  const root = container.querySelector('svg');
  const moving = [...root.querySelectorAll('[data-move]')];
  const lampFaces = { l: root.querySelectorAll('.lamp-l'), r: root.querySelectorAll('.lamp-r'), t: root.querySelectorAll('.lamp-t') };
  let current = locked ? 1 : 0;
  let frame = 0;

  function draw(t) {
    for (const el of moving) el.setAttribute('transform', transformFor(el.dataset.move, Number(el.dataset.f || 0), t));
    const tones = t >= 0.5 ? LAMP_ON : LAMP_OFF;
    lampFaces.t.forEach((el) => el.setAttribute('fill', tones[0]));
    lampFaces.l.forEach((el) => el.setAttribute('fill', tones[1]));
    lampFaces.r.forEach((el) => el.setAttribute('fill', tones[2]));
    current = t;
  }

  draw(current);
  return {
    set(isLocked, animate = true) {
      cancelAnimationFrame(frame);
      const to = isLocked ? 1 : 0;
      if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches || to === current) return draw(to);
      const from = current, start = performance.now(), duration = 520;
      const step = (now) => {
        const k = Math.min(1, (now - start) / duration);
        draw(from + (to - from) * easeOut(k));
        if (k < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    },
  };
}
`);
console.log('parts:', parts.length);
