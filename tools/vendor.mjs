// Copie les dépendances web (versions figées dans package.json) dans web/vendor
// et écrit web/vendor/MANIFEST.json (version + SHA-256 de chaque fichier).
// L'APK n'exécute ainsi aucun code téléchargé depuis un CDN au runtime.
import { createHash } from 'node:crypto';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const nm = join(ici, 'node_modules');
const dest = resolve(ici, '..', 'web', 'vendor');
const version = p => JSON.parse(readFileSync(join(nm, p, 'package.json'), 'utf8')).version;

const fichiers = [
  ['peerjs', 'dist/peerjs.min.js', 'peerjs.min.js'],
  ['qrcode-generator', 'qrcode.js', 'qrcode.js'],
  ['jsqr', 'dist/jsQR.js', 'jsQR.js'],
  ['firebase', 'firebase-app-compat.js', 'firebase-app-compat.js'],
  ['firebase', 'firebase-auth-compat.js', 'firebase-auth-compat.js'],
  ['@sapphi-red/web-noise-suppressor', 'dist/index.js', 'noise/index.js'],
  ['@sapphi-red/web-noise-suppressor', 'dist/rnnoise/workletProcessor.js', 'noise/rnnoise/workletProcessor.js'],
  ['@sapphi-red/web-noise-suppressor', 'dist/rnnoise.wasm', 'noise/rnnoise.wasm'],
  ['@sapphi-red/web-noise-suppressor', 'dist/rnnoise_simd.wasm', 'noise/rnnoise_simd.wasm'],
  ['@fontsource/barlow', 'files/barlow-latin-400-normal.woff2', 'fonts/barlow-400.woff2'],
  ['@fontsource/barlow', 'files/barlow-latin-500-normal.woff2', 'fonts/barlow-500.woff2'],
  ['@fontsource/barlow', 'files/barlow-latin-600-normal.woff2', 'fonts/barlow-600.woff2'],
  ['@fontsource/barlow-condensed', 'files/barlow-condensed-latin-600-normal.woff2', 'fonts/barlow-condensed-600.woff2'],
  ['@fontsource/barlow-condensed', 'files/barlow-condensed-latin-700-normal.woff2', 'fonts/barlow-condensed-700.woff2'],
];

rmSync(dest, { recursive: true, force: true });
const manifeste = {};
for (const [pkg, src, cible] of fichiers) {
  const out = join(dest, cible);
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(nm, pkg, src), out);
  manifeste[cible] = { package: pkg, version: version(pkg), sha256: createHash('sha256').update(readFileSync(out)).digest('hex') };
}
writeFileSync(join(dest, 'MANIFEST.json'), JSON.stringify(manifeste, null, 2) + '\n');
console.log(`${fichiers.length} fichiers copiés dans ${dest}`);
