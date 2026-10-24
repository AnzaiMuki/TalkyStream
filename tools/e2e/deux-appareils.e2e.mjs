// Appel réel entre deux téléphones (APK debug sur chacun) : présence, audio dans les deux sens par appui réel
// sur l'écran, sortie audio utilisée, route ICE. Un bip émis par le PC pendant le PTT sert de source sonore.
// Lancer : cd tools && node e2e/deux-appareils.e2e.mjs [--a=<série>] [--b=<série>]
// Résultat : docs/tests/deux-appareils-resultats.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { entrerInvite, statsRecues, etatEmission, pause, canalTest, RACINE } from './harness.mjs';

const PAQUET = 'com.anzaimuki.talkiewalkie';
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const A = { serie: arg('a', '0555711047011843'), pseudo: 'tela', port: 9341 };
const B = { serie: arg('b', '988829464147424556'), pseudo: 'telb', port: 9342 };

const adb = (t, args) => execFileSync('adb', ['-s', t.serie, ...args], { maxBuffer: 64 << 20, timeout: 30000 });
const shell = (t, cmd) => adb(t, ['shell', cmd]).toString();

const resultats = [];
async function etape(nom, fn) {
  const t0 = Date.now();
  try {
    const r = (await fn()) || {};
    resultats.push({ etape: nom, statut: r.statut || 'RÉUSSI', duree_ms: Date.now() - t0, ...r });
  } catch (e) {
    resultats.push({ etape: nom, statut: e.bloque ? 'BLOQUÉ' : 'ÉCHOUÉ', duree_ms: Date.now() - t0, erreur: String(e.message || e).split('\n')[0].slice(0, 300) });
  }
  const r = resultats.at(-1);
  console.log(`[${r.statut}] ${nom} (${r.duree_ms} ms)${r.erreur ? ' — ' + r.erreur : ''}${r.mesures ? ' ' + JSON.stringify(r.mesures) : ''}`);
  return r.statut === 'RÉUSSI';
}
const verifier = (cond, msg) => { if (!cond) throw new Error(msg); };
const bloque = msg => Object.assign(new Error(msg), { bloque: true });
async function attendreQue(page, fn, a, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await page.evaluate(fn, a).catch(() => false)) return; await pause(150); }
  throw new Error(`condition non atteinte en ${ms} ms : ${String(fn).slice(0, 100)}`);
}
async function niveauMax(page, ms) { let m = 0; const fin = Date.now() + ms; while (Date.now() < fin) { m = Math.max(m, (await statsRecues(page)).niveau); await pause(150); } return m; }

async function demarrer(t) {
  shell(t, `am start -W -S -n ${PAQUET}/.MainActivity`);
  let pid = '';
  for (let i = 0; i < 40 && !pid; i++) { pid = shell(t, `pidof ${PAQUET}`).trim().split(/\s+/)[0] || ''; if (!pid) await pause(250); }
  if (!pid) throw new Error('application non démarrée');
  const nom = `webview_devtools_remote_${pid}`;
  for (let i = 0; i < 40 && !shell(t, 'cat /proc/net/unix').includes('@' + nom); i++) await pause(250);
  try { adb(t, ['forward', '--remove', `tcp:${t.port}`]); } catch { }
  adb(t, ['forward', `tcp:${t.port}`, `localabstract:${nom}`]);
  t.nav = await chromium.connectOverCDP(`http://127.0.0.1:${t.port}`);
  for (let i = 0; i < 40 && !t.page; i++) {
    t.page = t.nav.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://appassets.androidplatform.net/assets/index'));
    if (!t.page) await pause(250);
  }
  if (!t.page) throw new Error('page introuvable via DevTools');
  t.page.erreurs = [];
  t.page.on('pageerror', e => t.page.erreurs.push(e.message));
  t.modele = shell(t, 'getprop ro.product.model').trim();
}

async function preparer(t, canal) {
  shell(t, `pm grant ${PAQUET} android.permission.RECORD_AUDIO`);
  await t.page.evaluate(() => { localStorage.clear(); localStorage.setItem('tw-rnnoise', '0'); });
  await t.page.reload();
  await t.page.waitForSelector('#langue-init.show', { timeout: 10000 });
  await t.page.click('#lg-fr');
  await entrerInvite(t.page, t.pseudo);
  await t.page.fill('#in-canal', canal);
  await t.page.evaluate(() => document.querySelector('button[onclick="connecter()"]').click());
  await attendreQue(t.page, () => document.getElementById('ptt-zone').style.display === 'flex', null, 30000);
}

async function centreEcran(page, sel) {
  return page.evaluate(async s => {
    const r = document.querySelector(s).getBoundingClientRect(), c = await natifPret;
    return { x: Math.round((r.x + r.width / 2) * devicePixelRatio), y: Math.round((r.y + r.height / 2) * devicePixelRatio + (c.encartHaut || 0)) };
  }, sel);
}

// Sortie audio des pistes de lecture de l'application pendant la réception
function sortieAudio(t) {
  const d = shell(t, 'dumpsys audio');
  const uid = (shell(t, `dumpsys package ${PAQUET}`).match(/userId=(\d+)/) || [])[1];
  const lecteurs = d.split('\n').filter(l => /AudioPlaybackConfiguration/.test(l) && (!uid || l.includes(`u/pid:${uid}`)) && /state:started/.test(l));
  const usage = [...new Set(lecteurs.map(l => (l.match(/usage=(\w+)/) || [])[1]).filter(Boolean))];
  const mode = (d.match(/mMode\s*=\s*(\w+)|Audio mode:\s*\n?\s*-?\s*(\w+)/) || []).slice(1).find(Boolean);
  const appareils = [...new Set(lecteurs.map(l => (l.match(/deviceIds?:\s*\[?([\w, ]+)/) || [])[1]).filter(Boolean))];
  const media = shell(t, 'dumpsys media.audio_policy').match(/Output devices? for strategy media[^\n]*\n?[^\n]*/i);
  return { lecteurs_actifs: lecteurs.length, usage, mode, appareils, strategie_media: media && media[0].replace(/\s+/g, ' ').slice(0, 160) };
}

// Route ICE et qualité côté récepteur
function route(page) {
  return page.evaluate(async () => {
    const c = Object.values(mediaConn).find(x => x.peerConnection); if (!c) return {};
    const s = await c.peerConnection.getStats(); let paire, perte, gigue, recus;
    s.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) paire = s.get(r.selectedCandidatePairId); });
    s.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') { perte = r.packetsLost; gigue = r.jitter; recus = r.packetsReceived; } });
    const l = paire && s.get(paire.localCandidateId), d = paire && s.get(paire.remoteCandidateId);
    return { local: l && l.candidateType, distant: d && d.candidateType, protocole: l && l.protocol, rtt_s: paire && paire.currentRoundTripTime, paquets_recus: recus, paquets_perdus: perte, gigue_s: gigue };
  });
}

// Appui réel de 4 s sur le PTT de l'émetteur, bip du PC pendant l'appui, mesure côté récepteur
async function pttReel(em, rec) {
  await em.page.click('#bcast-btn');
  await attendreQue(rec.page, () => Object.keys(mediaConn).length > 0, null, 30000)
    .catch(() => { throw bloque('aucune liaison média établie : ICE probablement impossible entre les deux réseaux'); });
  await attendreQue(rec.page, () => Object.values(mediaConn).some(c => c.peerConnection && ['connected', 'completed'].includes(c.peerConnection.iceConnectionState)), null, 30000)
    .catch(() => { throw bloque('ICE non connecté entre les deux téléphones (CGNAT des deux côtés, pas de relais TURN configuré)'); });
  await pause(2500);
  const avant = await niveauMax(rec.page, 1500);
  const { x, y } = await centreEcran(em.page, '#ptt-btn');
  const appui = spawn('adb', ['-s', em.serie, 'shell', `input swipe ${x} ${y} ${x} ${y} 4000`]);
  await pause(700);
  const bip = spawn('powershell', ['-NoProfile', '-Command', '[console]::Beep(880,2500)']);
  await pause(500);
  const actif = await em.page.evaluate(() => micActif);
  const source = (await etatEmission(em.page)).niveauSource;
  const pendant = await niveauMax(rec.page, 2000);
  const sortie = sortieAudio(rec);
  await new Promise(r => appui.on('exit', r));
  await new Promise(r => bip.exitCode !== null ? r() : bip.on('exit', r));
  await pause(1500);
  const apres = await niveauMax(rec.page, 1200);
  verifier(actif, 'le toucher réel n\'a pas ouvert le micro de l\'émetteur');
  verifier(await em.page.evaluate(() => !micActif), 'micro resté ouvert après relâchement');
  verifier(pendant > avant && pendant > 0.001, `son non reçu (avant ${avant}, pendant ${pendant})`);
  verifier(apres < pendant, `son persistant après relâchement (${apres})`);
  return { mesures: { emetteur: em.modele, recepteur: rec.modele, niveau_source_emetteur: source, niveau_avant: avant, niveau_pendant: pendant, niveau_apres: apres, ...(await route(rec.page)), sortie_recepteur: sortie } };
}

const canal = canalTest();
console.log('Canal :', canal);
let pret = await etape('demarrage-deux-telephones', async () => {
  await Promise.all([demarrer(A), demarrer(B)]);
  return { mesures: { a: A.modele, b: B.modele } };
});
if (pret) pret = await etape('connexion-canal-deux-telephones', async () => {
  await Promise.all([preparer(A, canal), preparer(B, canal)]);
});
if (pret) pret = await etape('presence-mutuelle', async () => {
  await A.page.evaluate(n => { document.getElementById('in-contact').value = n; ajouterContact(); }, B.pseudo);
  await B.page.evaluate(n => { document.getElementById('in-contact').value = n; ajouterContact(); }, A.pseudo);
  const t0 = Date.now();
  try {
    await attendreQue(A.page, n => enLigne.has(n), B.pseudo, 40000);
    await attendreQue(B.page, n => enLigne.has(n), A.pseudo, 40000);
  } catch (e) {
    // La présence passe par une connexion de données PeerJS : sans paire ICE, elle ne s'établit pas
    const ice = await Promise.all([A, B].map(t => t.page.evaluate(async () => {
      const etats = [], types = new Set();
      for (const c of Object.values(peer.connections || {}).flat()) {
        const pc = c.peerConnection; if (!pc) continue;
        etats.push(pc.iceConnectionState);
        (await pc.getStats()).forEach(r => { if (r.type === 'local-candidate') types.add(r.candidateType); });
      }
      return { peer_ouvert: peer.open, etats_ice: etats, candidats_locaux: [...types], source_turn: typeof sourceTurn !== 'undefined' ? sourceTurn : null };
    })));
    if (ice.every(d => d.peer_ouvert) && ice.some(d => d.etats_ice.includes('failed') || d.etats_ice.includes('checking'))) {
      throw bloque(`ICE impossible entre les deux téléphones (CGNAT des deux côtés, pas de relais TURN) : ${JSON.stringify(ice)}`);
    }
    throw new Error(e.message + ' ' + JSON.stringify(ice));
  }
  await pause(3000);
  return { mesures: { presence_ms: Date.now() - t0, ping_a_vers_b_ms: await A.page.evaluate(n => pingMs[n], B.pseudo), ping_b_vers_a_ms: await B.page.evaluate(n => pingMs[n], A.pseudo) } };
});
if (pret) {
  await etape('audio-a-vers-b-appui-reel', () => pttReel(A, B));
  await etape('audio-b-vers-a-appui-reel', () => pttReel(B, A));
}
await etape('erreurs-js-et-plantages', async () => {
  const js = { a: A.page ? A.page.erreurs : null, b: B.page ? B.page.erreurs : null };
  const plantages = [A, B].map(t => shell(t, 'logcat -d -b crash').split('\n').filter(l => l.includes(PAQUET)).length);
  verifier(!(js.a || []).length && !(js.b || []).length, 'erreurs JS : ' + JSON.stringify(js).slice(0, 200));
  verifier(plantages.every(n => n === 0), 'plantages : ' + plantages);
  return { mesures: { erreurs_js: js, plantages } };
});

for (const t of [A, B]) {
  try { await t.page?.evaluate(() => typeof deconnecter === 'function' && deconnecter()); } catch { }
  try { await t.nav?.close(); } catch { }
  try { adb(t, ['forward', '--remove', `tcp:${t.port}`]); } catch { }
}
const dossier = join(RACINE, 'docs', 'tests');
mkdirSync(dossier, { recursive: true });
writeFileSync(join(dossier, 'deux-appareils-resultats.json'), JSON.stringify({ date: new Date().toISOString(), canal, resultats }, null, 2));
console.log('Résultats écrits dans docs/tests/deux-appareils-resultats.json');
