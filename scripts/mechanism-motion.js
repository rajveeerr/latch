// How the latch mechanism moves between unlocked (0) and locked (1).
// Shared by the page animation and by the script that renders the static art.

export const TRAVEL = 5;                 // how far the bolt slides, in world units
export const COS = Math.cos(Math.PI / 6);
export const SIN = 0.5;
export const SCALE = 22;                 // pixels per world unit

const along = (units) => `translate(${(units * COS * SCALE).toFixed(2)} ${(units * SIN * SCALE).toFixed(2)})`;

// Spring coils spread out behind the bolt as it extends and bunch up as it retracts.
export function transformFor(part, fraction, t) {
  if (part === 'bolt') return along(TRAVEL * t);
  if (part === 'coil') return along(TRAVEL * t * fraction);
  return '';
}

export const easeOut = (x) => 1 - Math.pow(1 - x, 4);
