// Builds ui/icons.svg from the Lucide icon set (ISC license, https://lucide.dev).
// Only the icons Latch uses are included, so the sprite stays tiny.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lucide = (name) => readFileSync(path.join(root, 'node_modules/lucide-static/icons', `${name}.svg`), 'utf8');

// Latch's icon name -> Lucide file
const ICONS = {
  lock: 'lock', unlock: 'lock-open', 'arrow-right': 'arrow-right', eye: 'eye', 'eye-off': 'eye-off', clock: 'clock',
  window: 'app-window', display: 'monitor', power: 'power', layers: 'layers', 'speaker-off': 'volume-x', pause: 'pause',
  'shield-check': 'shield-check', sliders: 'sliders-horizontal', check: 'check', keyboard: 'keyboard', copy: 'copy',
  fingerprint: 'fingerprint', key: 'key-round', activity: 'activity', download: 'download', 'chevron-down': 'chevron-down',
  mask: 'venetian-mask', info: 'info', grid: 'layout-grid', x: 'x', globe: 'globe', moon: 'moon', laptop: 'laptop',
  paw: 'paw-print', sparkles: 'sparkles', 'arrow-up-right': 'arrow-up-right',
};

const symbols = Object.entries(ICONS).map(([id, file]) => {
  const inner = lucide(file).replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  return `  <symbol id="${id}" viewBox="0 0 24 24">${inner.replace(/\s*\n\s*/g, '')}</symbol>`;
});

writeFileSync(path.join(root, 'ui/icons.svg'), `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <!-- Icons from Lucide (ISC license, https://lucide.dev), 24px grid. Use: svg.i > use href="icons.svg#name" -->
${symbols.join('\n')}
</svg>
`);
console.log(symbols.length, 'icons');
