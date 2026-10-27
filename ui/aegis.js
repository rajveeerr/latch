// Aegis, the little hoplite: a marble guard in an engraver's style (cobalt line, hatching, a golden crest).
// "Aegis" is the Greek word for a shield's protection, and that is what he does: his shield comes up to cover his
// eyes while you type, he glowers at a wrong guess, and he raises his spear when you are let in.
//
//   const aegis = mountAegis(element, { state: 'guard', track: true });
//   aegis.set('typing');   // guard | typing | peek | growl | happy | sleep
//
// Everything is drawn from a handful of shapes and every pose is plain CSS (aegis.css), so he is tiny, crisp at any
// size, and simply holds each pose still for anyone who prefers reduced motion.

const HATCH = (id, angle, gap = 4.5, width = 1, opacity = 0.8) =>
  `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><path d="M0 0V${gap}" stroke="#1d3ac0" stroke-width="${width}" opacity="${opacity}"/></pattern>`;

const MARKUP = `
<svg class="aegis-svg" viewBox="0 0 400 470" role="img" aria-label="Aegis, a little marble hoplite guard">
  <defs>
    ${HATCH('hatchA', 35)}${HATCH('hatchB', -40, 4)}${HATCH('hatchGold', 35, 3.4, 1, 0.7)}
    <linearGradient id="marble" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbf8f1"/><stop offset="1" stop-color="#e4ddcd"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4cf7a"/><stop offset="1" stop-color="#c98f2a"/></linearGradient>
    <linearGradient id="cape" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a6ef0"/><stop offset="1" stop-color="#2442c8"/></linearGradient>
    <clipPath id="clipHead"><circle cx="200" cy="168" r="80"/></clipPath>
    <clipPath id="clipShield"><circle cx="0" cy="0" r="62"/></clipPath>
  </defs>

  <ellipse class="ground" cx="200" cy="452" rx="128" ry="9"/>

  <!-- plinth with a Greek key band -->
  <g class="plinth">
    <rect class="marble line" x="92" y="418" width="216" height="30" rx="4"/>
    <path class="line thin" d="M104 433h8v-6h8v12h8v-12h8v12h8v-12h8v12h8v-12h8v12h8v-12h8v12h8v-12h8v12h8v-12h8v12h8v-12h8v12h8v-12h8v12h8v-12h8v12h8v-12"/>
  </g>

  <!-- cloak behind him -->
  <g class="cloak">
    <path class="cape line" d="M146 246C118 292 108 356 116 420h168C292 356 282 292 254 246z"/>
    <path fill="url(#hatchB)" d="M146 246C118 292 108 356 116 420h40C146 352 148 296 168 252z"/>
    <path class="line thin soft" d="M178 270C174 320 176 370 180 418M222 270C226 320 224 370 220 418"/>
  </g>

  <!-- spear, planted at his right -->
  <g class="spear">
    <path class="line shaft" d="M330 112V420"/>
    <path class="gold line" d="M330 52c-11 18-13 40-8 62h16c5-22 3-44-8-62z"/>
    <path fill="url(#hatchGold)" d="M330 52c-11 18-13 40-8 62h8z"/>
    <rect class="gold line" x="324" y="112" width="12" height="9" rx="2"/>
    <rect class="gold line" x="325" y="414" width="10" height="9" rx="2"/>
  </g>

  <!-- legs, greaves, sandals -->
  <g class="legs">
    <rect class="marble line" x="164" y="368" width="30" height="46" rx="12"/><rect class="marble line" x="206" y="368" width="30" height="46" rx="12"/>
    <path class="line thin" d="M169 386c6-6 14-6 20 0M211 386c6-6 14-6 20 0"/>
    <path fill="url(#hatchA)" d="M184 372h10v38h-10zM226 372h10v38h-10z" opacity=".55"/>
    <ellipse class="marble line" cx="178" cy="415" rx="23" ry="9"/><ellipse class="marble line" cx="222" cy="415" rx="23" ry="9"/>
  </g>

  <!-- skirt of leather strips -->
  <g class="skirt">${[...Array(7)].map((_, i) => `<rect class="marble line" x="${139 + i * 20.5}" y="326" width="22" height="48" rx="8"/>`).join('')}
    <path fill="url(#hatchA)" opacity=".5" d="M139 340h124v14H139z"/>
    <rect class="gold line" x="136" y="318" width="128" height="12" rx="5"/>
  </g>

  <!-- torso, cuirass engraved with muscle -->
  <g class="torso">
    <path class="marble line" d="M150 258c-14 18-14 54-4 70h108c10-16 10-52-4-70z"/>
    <path class="line thin" d="M200 264v54M164 282c12 12 26 12 36 0M236 282c-12 12-26 12-36 0M176 304h48M180 318h40"/>
    <path fill="url(#hatchA)" d="M226 262c10 16 10 46 4 62h20c10-16 10-46-4-62z" opacity=".7"/>
    <path class="gold line" d="M156 262c8-8 22-12 44-12s36 4 44 12c-14 8-30 12-44 12s-30-4-44-12z"/>
  </g>

  <!-- his right arm, hand on the spear -->
  <g class="arm-r"><path class="marble line" d="M248 262c24 6 40 28 82 40v26c-48-2-74-26-86-44z"/><circle class="marble line" cx="330" cy="316" r="11"/></g>



  <!-- the head -->
  <g class="head">
    <g class="crest"><path class="plume" d="M0 0c-9-14-10-34-2-54c3-3 7-3 10 0c8 20 7 40-2 54z" transform="translate(200 72) rotate(-58) "/><path class="plume" d="M0 0c-9-14-10-34-2-54c3-3 7-3 10 0c8 20 7 40-2 54z" transform="translate(200 72) rotate(-30) "/><path class="plume" d="M0 0c-9-14-10-34-2-54c3-3 7-3 10 0c8 20 7 40-2 54z" transform="translate(200 72) rotate(0) "/><path class="plume" d="M0 0c-9-14-10-34-2-54c3-3 7-3 10 0c8 20 7 40-2 54z" transform="translate(200 72) rotate(30) "/><path class="plume" d="M0 0c-9-14-10-34-2-54c3-3 7-3 10 0c8 20 7 40-2 54z" transform="translate(200 72) rotate(58) "/><path class="crest-base" d="M178 76q22-14 44 0v8q-22-8-44 0z"/></g>
    <circle class="marble line" cx="200" cy="168" r="80"/>
    <circle fill="url(#hatchA)" cx="200" cy="168" r="80" clip-path="url(#clipHead)" opacity=".5" transform="translate(30 30)"/>
    <!-- Corinthian helmet pushed back: dome, brow, cheek plates, nasal guard -->
    <path class="helmet line" d="M118 168C114 100 152 66 200 66s86 34 82 102h-18c2-40-20-60-64-60s-66 20-64 60z"/>
    <path fill="url(#hatchGold)" d="M118 168C114 100 152 66 200 66c-30 6-60 34-64 102z" opacity=".9"/>
    <path class="gold line" d="M124 124c22-18 50-26 76-26s54 8 76 26c-24-8-50-12-76-12s-52 4-76 12z"/>
    <path class="helmet line" d="M122 176l16 44 22 8v-52zM278 176l-16 44-22 8v-52z"/>
    <path class="marble line" d="M193 110h14l-2 58h-10z"/>
    <path class="line thin" d="M200 114v50"/>
    <!-- face -->
    <g class="face">
      <ellipse class="blush" cx="150" cy="198" rx="14" ry="8"/><ellipse class="blush" cx="250" cy="198" rx="14" ry="8"/>
      ${[-1, 1].map((side) => `
      <g class="eye ${side < 0 ? 'eye-a' : 'eye-b'}" transform="translate(${200 + side * 36} 168)">
        <ellipse class="eye-white" rx="19" ry="21"/>
        <g class="pupil"><ellipse class="ink" rx="10.5" ry="13"/><circle class="glint" cx="3.5" cy="-4.5" r="4"/></g>
        <ellipse class="lid" rx="20" ry="22" cy="-1"/>
        <path class="happy-eye" d="M-15 6q15-22 30 0"/>
        <path class="sleep-eye" d="M-15-2q15 14 30 0"/>
      </g>
      <g transform="translate(${200 + side * 36} 168)"><path class="brow ${side < 0 ? 'brow-a' : 'brow-b'}" d="M${side < 0 ? '-24-30l40 9' : '24-30l-40 9'}"/></g>`).join('')}
      <path class="nose" d="M193 190q7-5 14 0q-1 8-7 10q-6-2-7-10z"/>
      <path class="mouth mouth-guard" d="M182 214q18-9 36 0"/>
      <path class="mouth mouth-growl" d="M180 216q20-16 40 0q-20-7-40 0zM188 214v5M200 211v6M212 214v5"/>
      <path class="mouth mouth-happy" d="M180 208q20 24 40 0z"/>
    </g>
  </g>

  <!-- his shield: this is what comes up to protect his eyes -->
  <g class="shield-wrap" transform="translate(94 318)"><g class="shield">
    <circle class="marble line" r="64"/>
    <circle class="ring line" r="54"/>
    <circle fill="url(#hatchA)" r="64" clip-path="url(#clipShield)" opacity=".45" transform="translate(16 18)"/>
    <circle class="line thin" r="42"/>
    <!-- the Latch mark: a bolt sliding into a bracket -->
    <path class="emblem" d="M14-14h10a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H14"/><rect class="emblem-fill" x="-28" y="-5" width="48" height="10" rx="5"/>
    <g class="studs">${[...Array(12)].map((_, i) => { const a = i * 30 * Math.PI / 180; return `<circle cx="${(Math.cos(a) * 58).toFixed(1)}" cy="${(Math.sin(a) * 58).toFixed(1)}" r="1.8"/>`; }).join('')}</g>
  </g></g>
  <!-- his left arm holds the shield -->
  <g class="arm-l"><path class="marble line" d="M152 262c-26 4-48 24-56 52l28 6c6-20 20-34 40-40z"/></g>

  <g class="zzz"><path d="M300 70h18l-18 20h18"/><path d="M328 44h13l-13 15h13"/><path d="M350 24h9l-9 10h9"/></g>
</svg>`;

let instances = 0;

export function mountAegis(container, { state = 'guard', track = true } = {}) {
  // Every copy needs its own gradient ids: gradients inside a hidden SVG (display: none) do not resolve for other SVGs.
  const uid = `-${++instances}`;
  container.innerHTML = MARKUP.replace(/(id="|url\(#)(hatchA|hatchB|hatchGold|marble|gold|cape|clipHead|clipShield)/g, (_, lead, name) => lead + name + uid);
  const paint = (selector, gradient) => container.querySelectorAll(selector).forEach((el) => el.setAttribute('fill', `url(#${gradient}${uid})`));
  paint('.marble, .lid', 'marble'); paint('.gold, .helmet, .plume, .crest-base', 'gold'); paint('.cape, .ring', 'cape');
  const root = container.querySelector('svg');
  root.classList.add('aegis');
  root.dataset.state = state;
  const eyes = [...root.querySelectorAll('.eye')].map((eye) => ({ eye, pupil: eye.querySelector('.pupil') }));
  let frame = 0, blinkTimer = 0, blinkOff = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // The eyes look toward the pointer. The offset is measured from the fixed eye and converted into its own local space.
  function look(clientX, clientY) {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const { eye, pupil } of eyes) {
        const box = eye.getBoundingClientRect();
        if (!box.width) continue;
        const dx = clientX - (box.left + box.width / 2), dy = clientY - (box.top + box.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, dist / 160);
        const m = eye.getScreenCTM();
        if (!m) continue;
        const inv = m.inverse();
        const ux = dx / dist * reach, uy = dy / dist * reach;
        const lx = inv.a * ux + inv.c * uy, ly = inv.b * ux + inv.d * uy;
        const len = Math.hypot(lx, ly) || 1;
        const r = 6 * reach;
        pupil.style.transform = `translate(${(lx / len * r).toFixed(2)}px, ${(ly / len * r).toFixed(2)}px)`;
      }
    });
  }
  const onMove = (event) => look(event.clientX, event.clientY);
  if (track && !reduce.matches) window.addEventListener('pointermove', onMove, { passive: true });

  function blink() {
    if (root.dataset.state === 'guard' && !reduce.matches) {
      root.classList.add('blink');
      blinkOff = setTimeout(() => root.classList.remove('blink'), 140);
    }
    blinkTimer = setTimeout(blink, 2600 + Math.random() * 3200);
  }
  blinkTimer = setTimeout(blink, 1800);

  return {
    set(next) {
      if (root.dataset.state === next) return;
      root.dataset.state = next;
      if (next === 'growl') { root.classList.remove('shake'); void root.getBoundingClientRect(); root.classList.add('shake'); }
    },
    lookAt: look,
    destroy() {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
      clearTimeout(blinkTimer);
      clearTimeout(blinkOff);
    },
  };
}
