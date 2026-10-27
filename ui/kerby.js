// Kerby, the guard pup: a marble Cerberus with three heads, a laurel crown and a padlock tag.
// Drawn in code from a few shapes, so he is tiny, crisp at any size and easy to restyle.
//
//   const kerby = mountKerby(element, { state: 'guard', track: true });
//   kerby.set('typing');   // guard | typing | peek | growl | happy | sleep
//
// The eyes follow the pointer, he blinks now and then, and every reaction is plain CSS
// (kerby.css), so reduced motion simply shows each pose without moving.

const HEAD = (id, x, y, scale, tilt, { crown = false } = {}) => `
  <g class="head" data-head="${id}" transform="translate(${x} ${y}) rotate(${tilt}) scale(${scale})">
    <path class="ear" d="M-50 -30C-80 -36-94 -4-80 28c10 14 26-2 34-26z"/>
    <path class="ear" d="M50 -30C80 -36 94 -4 80 28c-10 14-26-2-34-26z"/>
    <ellipse class="fur" rx="62" ry="56"/>
    <ellipse class="fur-light" cx="0" cy="24" rx="34" ry="26"/>
    <ellipse class="blush" cx="-42" cy="14" rx="10" ry="6.5"/><ellipse class="blush" cx="42" cy="14" rx="10" ry="6.5"/>
    <g class="mouth"><path class="line" d="M0 18v8M0 26q-9 9-19 2M0 26q9 9 19 2"/><ellipse class="tongue" cx="0" cy="38" rx="9" ry="11"/></g>
    <path class="nose" d="M-10 5q10-6 20 0q0 11-10 15q-10-4-10-15z"/>
    ${[-26, 26].map((ex) => `
    <g class="eye ${ex < 0 ? 'eye-a' : 'eye-b'}" transform="translate(${ex} -6)">
      <ellipse class="eye-white" rx="12.5" ry="14"/>
      <g class="pupil"><ellipse class="ink" rx="9.5" ry="11.5"/><circle class="glint" cx="3" cy="-4" r="3.4"/></g>
      <ellipse class="lid" rx="13.5" ry="15" cy="-1"/>
      <path class="happy-eye" d="M-11 5q11-16 22 0" />
    </g>
    <path class="brow ${ex < 0 ? 'brow-a' : 'brow-b'}" transform="translate(${ex} -6)" d="M-12 -26q12-7 24 0"/>`).join('')}
    ${crown ? `<g class="laurel">${[...Array(7)].map((_, i) => {
      const a = (-155 + i * 22) * Math.PI / 180;
      return `<ellipse class="leaf" cx="${(Math.cos(a) * 58).toFixed(1)}" cy="${(Math.sin(a) * 52 - 14).toFixed(1)}" rx="9" ry="4.4" transform="rotate(${(-155 + i * 22 + 90).toFixed(0)} ${(Math.cos(a) * 58).toFixed(1)} ${(Math.sin(a) * 52 - 14).toFixed(1)})"/>`;
    }).join('')}</g>` : ''}
  </g>`;

const MARKUP = `
<svg class="kerby-svg" viewBox="0 0 400 420" role="img" aria-label="Kerby, a three-headed marble guard pup">
  <ellipse class="ground" cx="200" cy="396" rx="124" ry="11"/>
  <path class="tail" d="M270 338c52-8 84-46 70-90c-4 22-24 52-62 58z"/>
  <ellipse class="fur" cx="200" cy="350" rx="82" ry="62"/>
  <g class="hind"><ellipse class="fur-shade" cx="132" cy="378" rx="34" ry="24"/><ellipse class="fur-shade" cx="268" cy="378" rx="34" ry="24"/></g>
  <ellipse class="fur-light" cx="200" cy="336" rx="48" ry="54"/>
  <rect class="fur" x="165" y="330" width="28" height="68" rx="14"/><rect class="fur" x="207" y="330" width="28" height="68" rx="14"/>
  <ellipse class="paw" cx="179" cy="398" rx="20" ry="10"/><ellipse class="paw" cx="221" cy="398" rx="20" ry="10"/>
  <path class="line soft" d="M172 392v-8M179 392v-8M186 392v-8M214 392v-8M221 392v-8M228 392v-8"/>
  <ellipse class="fur" cx="138" cy="268" rx="26" ry="36" transform="rotate(-38 138 268)"/><ellipse class="fur" cx="262" cy="268" rx="26" ry="36" transform="rotate(38 262 268)"/>
  ${HEAD('l', 104, 214, 0.72, -13)}
  ${HEAD('r', 296, 214, 0.72, 13)}
  <ellipse class="fur" cx="200" cy="262" rx="46" ry="44"/>
  <path class="collar" d="M138 280q62 24 124 0l-4 20q-58 22-116 0z"/>
  <g class="tag"><path class="line" d="M200 304v8"/><circle class="tag-disc" cx="200" cy="326" r="15"/><g class="tag-lock" transform="translate(200 327)"><rect x="-6" y="-2" width="12" height="9" rx="2.200"/><path d="M-3.500 -2v-3a3.500 3.500 0 0 1 7 0v3"/></g></g>
  ${HEAD('c', 200, 168, 1.0, 0, { crown: true })}
  <g class="zzz"><path d="M286 96h18l-18 20h18"/><path d="M314 70h13l-13 15h13"/><path d="M336 48h9l-9 10h9"/></g>
</svg>`;

export function mountKerby(container, { state = 'guard', track = true } = {}) {
  container.innerHTML = MARKUP;
  const root = container.querySelector('svg');
  root.classList.add('kerby');
  root.dataset.state = state;
  const pupils = [...root.querySelectorAll('.pupil')];
  let frame = 0;
  let blinkTimer;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // eyes: look toward the pointer, a few units at most
  function look(clientX, clientY) {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const pupil of pupils) {
        const box = pupil.getBoundingClientRect();
        const dx = clientX - (box.left + box.width / 2), dy = clientY - (box.top + box.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(5, dist / 28);
        pupil.style.transform = `translate(${(dx / dist * reach).toFixed(2)}px, ${(dy / dist * reach).toFixed(2)}px)`;
      }
    });
  }
  const onMove = (event) => look(event.clientX, event.clientY);
  if (track && !reduce.matches) window.addEventListener('pointermove', onMove, { passive: true });

  function blink() {
    if (root.dataset.state === 'guard' && !reduce.matches) {
      root.classList.add('blink');
      setTimeout(() => root.classList.remove('blink'), 140);
    }
    blinkTimer = setTimeout(blink, 2400 + Math.random() * 3200);
  }
  blinkTimer = setTimeout(blink, 1800);

  return {
    set(next) {
      if (root.dataset.state === next) return;
      root.dataset.state = next;
      if (next === 'growl') { root.classList.remove('shake'); void root.getBoundingClientRect(); root.classList.add('shake'); }
    },
    lookAt: look,
    destroy() { window.removeEventListener('pointermove', onMove); clearTimeout(blinkTimer); },
  };
}
