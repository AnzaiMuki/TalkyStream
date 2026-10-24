// Pilotage du téléphone : ADB + protocole DevTools de la WebView (build debug uniquement).
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

export const SERIE = process.env.ANDROID_SERIAL || '0555711047011843';
export const PAQUET = 'com.anzaimuki.talkiewalkie';
export const URL_APP = 'https://appassets.androidplatform.net/assets/index.html';
export const URL_REF = 'https://appassets.androidplatform.net/assets/reference/index.html';

export function adb(args, opts = {}) {
  return execFileSync('adb', ['-s', SERIE, ...args], { maxBuffer: 64 << 20, ...opts });
}
export const shell = cmd => adb(['shell', cmd]).toString();
export const capture = () => adb(['exec-out', 'screencap', '-p']);

export function lancerApp({ effacer = false } = {}) {
  if (effacer) shell(`pm clear ${PAQUET}`);
  shell(`am force-stop ${PAQUET}`);
  shell(`am start -W -n ${PAQUET}/.MainActivity`);
}

export async function connecterWebView(port = 9333) {
  let pid = '';
  for (let i = 0; i < 40 && !pid; i++) {
    pid = shell(`pidof ${PAQUET}`).trim().split(/\s+/)[0] || '';
    if (!pid) await new Promise(r => setTimeout(r, 250));
  }
  if (!pid) throw new Error('application non démarrée');
  const nom = `webview_devtools_remote_${pid}`;
  for (let i = 0; i < 40; i++) {
    if (shell('cat /proc/net/unix').includes('@' + nom)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  try { adb(['forward', '--remove', `tcp:${port}`], { stdio: 'ignore' }); } catch { }
  adb(['forward', `tcp:${port}`, `localabstract:${nom}`]);
  const navigateur = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = navigateur.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://appassets.androidplatform.net/'));
    if (!page) await new Promise(r => setTimeout(r, 250));
  }
  if (!page) throw new Error('page de l\'application introuvable via DevTools');
  page.erreurs = [];
  page.on('pageerror', e => page.erreurs.push(e.message));
  return { navigateur, page };
}

export function infosAppareil() {
  const p = k => shell(`getprop ${k}`).trim();
  return {
    modele: p('ro.product.model'), android: p('ro.build.version.release'), sdk: p('ro.build.version.sdk'),
    taille: shell('wm size').trim(), densite: shell('wm density').trim(),
    webview: (shell('dumpsys webviewupdate').match(/Current WebView package \(name, version\): \(([^)]+)\)/) || [])[1],
  };
}
