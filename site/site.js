import { mountKerby } from './assets/kerby.js';
import { mountScene } from './assets/scene.js';
import { mountMechanism } from './mechanism.js';

const $ = (id) => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// the hero card: Kerby on his painted scene, tilting toward the pointer
mountScene($('sceneSlot'));
mountKerby($('kerbySlot'), { state: 'guard' });
if (!reduce) {
  const tilt = $('tilt');
  let raf = 0;
  addEventListener('pointermove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      tilt.style.setProperty('--mx', (e.clientX / innerWidth * 2 - 1).toFixed(3));
      tilt.style.setProperty('--my', (e.clientY / innerHeight * 2 - 1).toFixed(3));
    });
  }, { passive: true });
}

// the latch mechanism, locked and unlocked
const mechanism = mountMechanism($('mech'), false);
for (const [id, locked] of [['mUnlock', false], ['mLock', true]]) {
  $(id).addEventListener('click', () => {
    mechanism.set(locked);
    $('mUnlock').setAttribute('aria-pressed', String(!locked));
    $('mLock').setAttribute('aria-pressed', String(locked));
  });
}

// try Kerby
const kerby = mountKerby($('demoK'), { state: 'guard' });
const note = $('demoNote');
let calm;
const settle = (text, after = 1600) => { clearTimeout(calm); calm = setTimeout(() => { kerby.set($('demoPass').value ? 'typing' : 'guard'); note.textContent = $('demoPass').value ? 'Kerby has his eyes shut.' : 'Kerby is on guard.'; }, after); note.textContent = text; };
$('demoPass').addEventListener('input', () => { kerby.set($('demoPass').value ? 'typing' : 'guard'); note.textContent = $('demoPass').value ? 'Kerby has his eyes shut.' : 'Kerby is on guard.'; });
$('demoPass').addEventListener('blur', () => kerby.set('guard'));
$('demoWrong').addEventListener('click', () => { kerby.set('growl'); settle('Grr. Wrong guess.'); });
$('demoForm').addEventListener('submit', (e) => { e.preventDefault(); $('demoPass').value = ''; kerby.set('happy'); settle('Welcome back. Tails are wagging.', 2200); });

// copy the extensions address
$('copyExt').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('brave://extensions'); $('copyExt').textContent = 'Copied. Paste it in a new tab'; }
  catch { $('copyExt').textContent = 'Type brave://extensions in a new tab'; }
});

// the engraved arcade in the footer
const arches = $('arches');
let d = '';
for (let x = 0; x < 1200; x += 100) d += `M${x + 6} 120V74a44 44 0 0 1 88 0V120M${x + 14} 120V76a36 36 0 0 1 72 0V120`;
for (let x = 0; x < 1200; x += 100) d += `M${x} 26V120`;
const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
path.setAttribute('d', d);
arches.append(path);
