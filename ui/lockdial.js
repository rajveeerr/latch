// The combination lock: a brass-rimmed dial that turns a notch for every character you type, a steel shackle that
// lifts when the lock opens, and a lamp. Pure SVG and CSS, so it stays light.

const num = (n) => n.toFixed(2);

function dialSvg() {
  let ticks = '', nums = '';
  for (let i = 0; i < 100; i++) {
    const a = (i * 3.6 - 90) * Math.PI / 180, major = i % 10 === 0, mid = i % 5 === 0;
    const r1 = 93, r2 = major ? 80 : mid ? 85 : 88;
    ticks += `M${num(Math.cos(a) * r1)} ${num(Math.sin(a) * r1)}L${num(Math.cos(a) * r2)} ${num(Math.sin(a) * r2)}`;
    if (major) nums += `<text x="${num(Math.cos(a) * 68)}" y="${num(Math.sin(a) * 68)}" transform="rotate(${i * 3.6} ${num(Math.cos(a) * 68)} ${num(Math.sin(a) * 68)})">${i}</text>`;
  }
  return `<svg viewBox="-100 -100 200 200" aria-hidden="true">
  <defs><radialGradient id="face" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#4a6ef0"/><stop offset=".55" stop-color="#2442c8"/><stop offset="1" stop-color="#14247d"/></radialGradient></defs>
  <circle r="98" fill="url(#face)"/>
  <circle r="98" fill="none" stroke="#f6e3a8" stroke-opacity=".5" stroke-width="1"/>
  <path d="${ticks}" stroke="#f6ecd0" stroke-width="1.4" stroke-linecap="round" fill="none"/>
  <g fill="#f6ecd0" font-family="Geist Mono, ui-monospace, monospace" font-size="9" font-weight="500" text-anchor="middle" dominant-baseline="central">${nums}</g>
  <circle r="46" fill="none" stroke="#f6e3a8" stroke-opacity=".28" stroke-width="1"/>
</svg>`;
}

const SHACKLE = `<svg viewBox="0 -12 220 162" aria-hidden="true">
  <defs><linearGradient id="steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8c97b8"/><stop offset=".3" stop-color="#f2f5fb"/><stop offset=".55" stop-color="#b5bfd8"/><stop offset="1" stop-color="#6d7899"/></linearGradient></defs>
  <path d="M34 150V70a76 76 0 0 1 152 0v80" fill="none" stroke="url(#steel)" stroke-width="30"/>
  <path d="M34 150V70a76 76 0 0 1 152 0v80" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3" transform="translate(-6 -2)"/>
  <path d="M19 150V70a91 91 0 0 1 182 0v80M49 150V70a61 61 0 0 1 122 0v80" fill="none" stroke="#3a4670" stroke-opacity=".35" stroke-width="1.2"/>
</svg>`;

export function mountDial(box) {
  box.querySelector('#dial').innerHTML = dialSvg();
  box.querySelector('.shackle').innerHTML = SHACKLE;
  const lamp = box.querySelector('#lamp');
  let timer = 0;
  const flash = (cls, ms) => { lamp.classList.remove('hot', 'bad'); lamp.classList.add(cls); clearTimeout(timer); timer = setTimeout(() => lamp.classList.remove(cls), ms); };

  return {
    // one notch (7 of the dial's 100 marks) for every character typed
    turn(length) {
      box.style.setProperty('--turn', `${(length * 25.2).toFixed(1)}deg`);
      if (length) flash('hot', 260);
    },
    wrong() { box.classList.remove('wrong'); void box.offsetWidth; box.classList.add('wrong'); box.style.setProperty('--turn', '0deg'); flash('bad', 1400); },
    open() { box.classList.add('open'); lamp.classList.add('hot'); },
    calm() { box.classList.remove('wrong'); },
  };
}
