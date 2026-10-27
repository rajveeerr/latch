// Renders an SVG (or HTML) file to a PNG for a quick look: node scripts/preview.mjs <in> <out.png> [width] [height]
import { chromium } from 'playwright';
import path from 'node:path';

const [input, output, width = '600', height = '700'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 2 });
await page.goto('file://' + path.resolve(input));
await page.screenshot({ path: output });
await browser.close();
