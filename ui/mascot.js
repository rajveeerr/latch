// One place that knows which mascot (if any) the person chose, so every screen agrees.
// The choice lives in localStorage (shared by all Latch pages, read synchronously, so nothing flashes).
import { mountAegis } from './aegis.js';
import { mountKerby } from './kerby.js';

export const MASCOTS = {
  aegis: { name: 'Aegis', role: 'Guardian of the gate', stats: [['1', 'Shield'], ['0', 'Tabs lost'], ['∞', 'Patience']] },
  kerby: { name: 'Kerby', role: 'Three heads, one gate', stats: [['3', 'Heads'], ['0', 'Tabs lost'], ['∞', 'Patience']] },
  none: { name: 'Latch', role: 'A quiet lock for your browser', stats: [] },
};
export const LAYOUTS = ['device', 'card'];

export const getMascot = () => { const v = localStorage.getItem('mascot'); return v in MASCOTS ? v : 'aegis'; };
export const setMascot = (id) => localStorage.setItem('mascot', id in MASCOTS ? id : 'aegis');
export const getLayout = () => { const v = localStorage.getItem('lockLayout'); return LAYOUTS.includes(v) ? v : 'device'; };
export const setLayout = (id) => localStorage.setItem('lockLayout', LAYOUTS.includes(id) ? id : 'device');

// Draws the chosen mascot into `container`. With "none" the container is emptied and hidden, and the returned
// controller does nothing, so callers never need to special-case it.
export function mountMascot(container, options = {}) {
  const id = getMascot();
  container.dataset.mascot = id;
  if (id === 'none') {
    container.textContent = '';
    container.hidden = true;
    return { id, set() {}, lookAt() {}, destroy() {} };
  }
  container.hidden = false;
  const controller = (id === 'kerby' ? mountKerby : mountAegis)(container, options);
  return { id, ...controller };
}
