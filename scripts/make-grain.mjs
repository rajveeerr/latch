// Builds ui/art/grain.png: a small neutral paper-grain tile, baked once so the browser never has to compute noise.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const dataUrl = await page.evaluate(() => {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  // small seeded generator so the tile is the same every build
  let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < size * size; i++) {
    const v = rand();
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 128;
    image.data[i * 4 + 3] = v > 0.86 ? 56 : v > 0.6 ? 22 : 0;     // sparse flecks in two strengths, so the PNG compresses well
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
});
writeFileSync(path.join(root, 'ui/art/grain.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
await browser.close();
