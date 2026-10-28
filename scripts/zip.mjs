// Builds dist/latch-<version>.zip containing only the files the extension needs (plus the helper source and its install scripts).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = path.join(root, 'dist', `latch-${version}.zip`);
mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', out, 'manifest.json', 'src', 'ui', 'icons', 'LICENSE', 'Install Latch Helper.command', 'Uninstall Latch Helper.command', 'native/build.sh', 'native/install.sh', 'native/uninstall.sh', 'native/helper', 'native/bin'], { cwd: root, stdio: 'inherit' });
console.log('wrote', path.relative(root, out));
