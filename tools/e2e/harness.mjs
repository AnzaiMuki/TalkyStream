// Outils communs des tests E2E : serveur statique de web/ et pilotage de Chrome (Playwright).
// Chrome reçoit un micro simulé (bip 440 Hz) pour mesurer réellement le son transmis.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = join(RACINE, 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };

export function serveurStatique(racine = WEB, port = 0) {
  const srv = http.createServer(async (req, res) => {
    const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/])+/, '');
    const fichier = join(racine, chemin || 'index.html');
    if (!fichier.startsWith(racine)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(fichier);
      res.writeHead(200, { 'content-type': TYPES[extname(fichier)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise(ok => srv.listen(port, '0.0.0.0', () => ok({ srv, url: `http://localhost:${srv.address().port}/`, port: srv.address().port })));
}

export async function lancerChrome({ headless = true, args = [] } = {}) {
  return chromium.launch({
    channel: 'chrome', headless,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...args],
  });
}

// Ouvre l'app comme un téléphone de 360×820 px CSS (720×1640 physiques, densité 2 = Infinix X680)
export async function ouvrirApp(navigateur, url, { langue = 'fr', theme, stockage = {} } = {}) {
  const ctx = await navigateur.newContext({ bypassCSP: true, viewport: { width: 360, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', permissions: ['microphone', 'camera'] });
  await ctx.addInitScript(([l, t, s]) => {
    if (l) localStorage.setItem('tw-langue', l);
    if (t) localStorage.setItem('tw-theme', t);
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, [langue, theme, stockage]);
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on('pageerror', e => page.erreurs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.erreurs.push('console: ' + m.text()); });
  await page.goto(url);
  return page;
}

export async function entrerInvite(page, pseudo) {
  await page.waitForSelector('#auth.show', { timeout: 8000 });
  await page.fill('#au-pseudo-guest', pseudo);
  await page.click('#auth .auth-guest-input .btn');
  await page.waitForSelector('#auth', { state: 'hidden' });
}

export async function connecterCanal(page, canal) {
  await page.fill('#in-canal', canal);
  await page.click('button[onclick="connecter()"]');
  await page.waitForFunction(() => document.getElementById('ptt-zone').style.display === 'flex', null, { timeout: 25000 });
}

export async function ajouterContact(page, nom) {
  await page.fill('#in-contact', nom);
  await page.click('button[onclick="ajouterContact()"]');
}

// Niveau audio reçu (0..1) et octets reçus sur toutes les liaisons audio de la page
export function statsRecues(page) {
  return page.evaluate(async () => {
    let octets = 0, niveau = 0;
    for (const c of Object.values(mediaConn)) {
      const pc = c.peerConnection; if (!pc) continue;
      (await pc.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') { octets += r.bytesReceived || 0; niveau = Math.max(niveau, r.audioLevel || 0); } });
    }
    return { octets, niveau };
  });
}

// Énergie audio réellement émise : piste locale active et niveau de la source
export function etatEmission(page) {
  return page.evaluate(async () => {
    const pistes = localStream ? localStream.getAudioTracks().map(t => t.enabled) : [];
    let envoyes = 0;
    for (const c of Object.values(mediaConn)) {
      const pc = c.peerConnection; if (!pc) continue;
      (await pc.getStats()).forEach(r => { if (r.type === 'media-source' && r.kind === 'audio') envoyes = Math.max(envoyes, r.audioLevel || 0); });
    }
    return { pistes, micActif, niveauSource: envoyes };
  });
}

export const pause = ms => new Promise(r => setTimeout(r, ms));
export const canalTest = () => 'E2E' + Math.random().toString(36).slice(2, 8).toUpperCase();
