// Screenshots the landing page: node scripts/shoot-site.mjs <out-dir> [url]
import { chromium } from 'playwright';
import path from 'node:path';

const out = process.argv[2] || '/tmp';
const url = process.argv[3] || 'http://localhost:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [scheme, width] of [['light', 1280], ['dark', 1280], ['light', 390]]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto(url);
  await page.waitForTimeout(700);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `site-${scheme}-${width}.png`) });
  await page.close();
}
await browser.close();
