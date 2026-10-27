// Copies the shared design pieces (fonts, tokens, Kerby, the scene, the grain) into site/assets so the landing page
// is a plain static folder that can be served from anywhere.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'site/assets');
mkdirSync(path.join(out, 'art'), { recursive: true });
cpSync(path.join(root, 'ui/fonts'), path.join(out, 'fonts'), { recursive: true });
for (const file of ['common.css', 'kerby.css', 'kerby.js', 'scene.js']) cpSync(path.join(root, 'ui', file), path.join(out, file));
cpSync(path.join(root, 'ui/art/grain.png'), path.join(out, 'art/grain.png'));
cpSync(path.join(root, 'docs/art/bust.svg'), path.join(out, 'bust.svg'));
cpSync(path.join(root, 'docs/logo.svg'), path.join(out, 'logo.svg'));
cpSync(path.join(root, 'icons/icon-128.png'), path.join(out, 'icon.png'));
cpSync(path.join(root, 'ui/icons.svg'), path.join(out, 'icons.svg'));
console.log('site assets copied');
