// Renders docs/logo.svg to the PNG sizes the extension needs.
// Usage: node scripts/make-icons.mjs   (needs playwright and a Chromium, see package.json)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(path.join(root, 'docs/logo.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

// A fresh page per size, so nothing is captured mid-resize.
async function render(size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return png;
}

for (const size of [16, 32, 48, 128]) writeFileSync(path.join(root, `icons/icon-${size}.png`), await render(size));
writeFileSync(path.join(root, 'docs/logo.png'), await render(512));   // larger copy for the README
await browser.close();
