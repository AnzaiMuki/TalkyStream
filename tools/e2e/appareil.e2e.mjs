// Campagne E2E sur le téléphone physique (APK debug) avec un second pair réel : Chrome sur le PC.
// Chaque étape est notée RÉUSSI / ÉCHOUÉ / BLOQUÉ avec ses mesures ; résultat dans docs/tests/appareil-resultats.json
// Lancer : cd tools && node e2e/appareil.e2e.mjs [--etapes=a,b,c]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { adb, shell, connecterWebView, lancerApp, infosAppareil, PAQUET } from '../appareil/adb.mjs';
import { serveurStatique, lancerChrome, ouvrirApp, entrerInvite, connecterCanal, ajouterContact, statsRecues, etatEmission, pause, canalTest, RACINE } from './harness.mjs';

const resultats = [];
const filtre = (process.argv.find(a => a.startsWith('--etapes=')) || '').slice(9).split(',').filter(Boolean);
async function etape(nom, fn) {
  if (filtre.length && !filtre.some(f => nom.startsWith(f))) return;
  const t0 = Date.now();
  try {
    const r = (await fn()) || {};
    resultats.push({ etape: nom, statut: r.statut || 'RÉUSSI', duree_ms: Date.now() - t0, ...r });
  } catch (e) {
    resultats.push({ etape: nom, statut: e.bloque ? 'BLOQUÉ' : 'ÉCHOUÉ', duree_ms: Date.now() - t0, erreur: String(e.message || e).split('\n')[0].slice(0, 300) });
  }
  const r = resultats.at(-1);
  console.log(`[${r.statut}] ${nom} (${r.duree_ms} ms)${r.erreur ? ' — ' + r.erreur : ''}${r.mesures ? ' ' + JSON.stringify(r.mesures) : ''}`);
}
const verifier = (cond, msg) => { if (!cond) throw new Error(msg); };
const bloque = msg => Object.assign(new Error(msg), { bloque: true });
// Pas de waitForFunction : Playwright y passe par eval, bloqué par le CSP de l'APK (pas de bypassCSP via CDP)
async function attendreQue(page, fn, arg, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await page.evaluate(fn, arg).catch(() => false)) return; await pause(150); }
  throw new Error(`condition non atteinte en ${ms} ms : ${String(fn).slice(0, 120)}`);
}
async function niveauMax(page, ms) { let m = 0; const fin = Date.now() + ms; while (Date.now() < fin) { m = Math.max(m, (await statsRecues(page)).niveau); await pause(150); } return m; }
const servicesActifs = () => shell(`dumpsys activity services ${PAQUET}`);
const fgsActif = () => /TalkieService/.test(servicesActifs()) && /isForeground=true/.test(servicesActifs());

// Coordonnées écran (px physiques) d'un élément de la WebView
async function centreEcran(page, sel) {
  return page.evaluate(async s => {
    const r = document.querySelector(s).getBoundingClientRect(), c = await natifPret;
    return { x: Math.round((r.x + r.width / 2) * devicePixelRatio), y: Math.round((r.y + r.height / 2) * devicePixelRatio + (c.encartHaut || 0)) };
  }, sel);
}

const infos = infosAppareil();
console.log('Appareil :', JSON.stringify(infos));
const serveur = await serveurStatique();
const chrome = await lancerChrome();
const canal = canalTest();
let tel, telNav, pc;

await etape('installation-et-premier-lancement', async () => {
  shell(`pm revoke ${PAQUET} android.permission.RECORD_AUDIO`);
  const sortie = shell(`am start -W -S -n ${PAQUET}/.MainActivity`);
  const total = Number((sortie.match(/TotalTime: (\d+)/) || [])[1]);
  ({ navigateur: telNav, page: tel } = await connecterWebView());
  await tel.waitForSelector('#langue-init.show, #auth.show, #main', { timeout: 10000 });
  return { mesures: { demarrage_froid_ms: total } };
});

await etape('choix-langue-et-mode-invite', async () => {
  await tel.evaluate(() => { localStorage.clear(); localStorage.setItem('tw-rnnoise', '0'); });
  await tel.reload();
  await tel.waitForSelector('#langue-init.show', { timeout: 8000 });
  await tel.click('#lg-fr');
  await entrerInvite(tel, 'tel');
  verifier(await tel.inputValue('#in-pseudo') === 'tel', 'pseudo non appliqué');
});

await etape('permission-micro-dialogue-systeme', async () => {
  await tel.fill('#in-canal', canal);
  const t0 = Date.now();
  await tel.evaluate(() => { document.querySelector('button[onclick="connecter()"]').click(); });
  // Le dialogue système Android doit apparaître : on appuie sur « Autoriser » via uiautomator
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) {
    await pause(500);
    shell('uiautomator dump /sdcard/tw.xml >/dev/null 2>&1');
    const xml = shell('cat /sdcard/tw.xml');
    const m = xml.match(/text="(Autoriser|Allow|While using the app|Lors de l'utilisation[^"]*|Uniquement[^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i)
      || xml.match(/resource-id="com.android.permissioncontroller:id\/permission_allow(_foreground_only)?_button"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (m) {
      const [x1, y1, x2, y2] = m.slice(-4).map(Number);
      shell(`input tap ${(x1 + x2) >> 1} ${(y1 + y2) >> 1}`);
      ok = true;
    }
  }
  verifier(ok, 'dialogue de permission micro non trouvé');
  await attendreQue(tel, () => document.getElementById('ptt-zone').style.display === 'flex', null, 30000);
  return { mesures: { connexion_canal_ms: Date.now() - t0 } };
});

await etape('micro-muet-apres-connexion-et-service-premier-plan', async () => {
  verifier(JSON.stringify((await etatEmission(tel)).pistes) === '[false]', 'pistes micro actives sans PTT');
  await pause(1000);
  verifier(fgsActif(), 'service de premier plan absent');
  const notif = shell('dumpsys notification --noredact').includes(PAQUET);
  verifier(notif, 'notification de session absente');
});

await etape('pc-rejoint-le-canal-presence', async () => {
  pc = await ouvrirApp(chrome, serveur.url, { stockage: { 'tw-rnnoise': '0' } });
  await entrerInvite(pc, 'ordi');
  await connecterCanal(pc, canal);
  await ajouterContact(pc, 'tel');
  await tel.evaluate(() => { document.getElementById('in-contact').value = 'ordi'; ajouterContact(); });
  const t0 = Date.now();
  await attendreQue(tel, () => enLigne.has('ordi'), null, 30000);
  await attendreQue(pc, () => enLigne.has('tel'), null, 30000);
  await pause(3000);
  return { mesures: { presence_ms: Date.now() - t0, ping_ms: await tel.evaluate(() => pingMs.ordi) } };
});

await etape('audio-pc-vers-telephone-ptt', async () => {
  await pc.click('#bcast-btn');
  await attendreQue(tel, () => Object.keys(mediaConn).length > 0, null, 20000);
  await pause(4000);
  const avant = await niveauMax(tel, 1500);
  verifier(avant < 0.01, 'son reçu avant PTT : ' + avant);
  const t0 = Date.now();
  await pc.dispatchEvent('#ptt-btn', 'mousedown');
  let n = 0; while (Date.now() - t0 < 5000 && n <= 0.01) { n = (await statsRecues(tel)).niveau; await pause(50); }
  const premierSon = Date.now() - t0;
  verifier(n > 0.01, 'aucun son reçu sur le téléphone : ' + n);
  await pause(1500);
  await pc.dispatchEvent('#ptt-btn', 'mouseup');
  const t1 = Date.now();
  let m = 1; while (Date.now() - t1 < 4000 && m >= 0.005) { m = (await statsRecues(tel)).niveau; await pause(50); }
  verifier(m < 0.005, 'son persistant après relâchement : ' + m);
  const route = await tel.evaluate(async () => {
    const pc = Object.values(mediaConn)[0].peerConnection, s = await pc.getStats(); let paire, rtt, perte, gigue;
    s.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) paire = s.get(r.selectedCandidatePairId); });
    s.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') { perte = r.packetsLost; gigue = r.jitter; } });
    if (paire) rtt = paire.currentRoundTripTime;
    const l = paire && s.get(paire.localCandidateId), d = paire && s.get(paire.remoteCandidateId);
    let dtls = {}; s.forEach(r => { if (r.type === 'transport') dtls = { dtls: r.dtlsCipher, srtp: r.srtpCipher, tls: r.tlsVersion, etat: r.dtlsState }; });
    return { local: l && l.candidateType, distant: d && d.candidateType, protocole: l && l.protocol, rtt_s: rtt, paquets_perdus: perte, gigue_s: gigue, ...dtls };
  });
  return { mesures: { premier_son_ms: premierSon, arret_son_ms: Date.now() - t1, ...route } };
});

await etape('audio-telephone-vers-pc-appui-reel-ecran', async () => {
  await tel.click('#bcast-btn');
  await attendreQue(pc, () => Object.keys(mediaConn).length > 0, null, 20000);
  await pause(3000);
  const avant = await niveauMax(pc, 1500);
  const { x, y } = await centreEcran(tel, '#ptt-btn');
  const appui = spawn('adb', ['-s', process.env.ANDROID_SERIAL || '0555711047011843', 'shell', `input swipe ${x} ${y} ${x} ${y} 4000`]);
  await pause(1200);
  const actif = await tel.evaluate(() => micActif);
  const pendant = await niveauMax(pc, 2000);
  await new Promise(r => appui.on('exit', r));
  await pause(1200);
  const apres = await niveauMax(pc, 1200);
  verifier(actif, 'le toucher réel n\'a pas ouvert le micro');
  verifier(await tel.evaluate(() => !micActif), 'micro resté ouvert après relâchement du doigt');
  verifier(pendant > avant && pendant > 0.0005, `son du téléphone non reçu (avant ${avant}, pendant ${pendant})`);
  return { mesures: { niveau_avant: avant, niveau_pendant: pendant, niveau_apres: apres, note: 'son ambiant capté par le micro du téléphone' } };
});

await etape('bouton-casque-media-session', async () => {
  shell('input keyevent KEYCODE_MEDIA_PLAY_PAUSE');
  await pause(800);
  const ouvert = await tel.evaluate(() => micActif);
  shell('input keyevent KEYCODE_MEDIA_PLAY_PAUSE');
  await pause(800);
  const ferme = await tel.evaluate(() => !micActif);
  verifier(ouvert && ferme, `bouton média : ouvert=${ouvert} fermé=${ferme}`);
});

await etape('appel-inconnu-refuse-sur-telephone', async () => {
  const intrus = await ouvrirApp(chrome, serveur.url, { stockage: { 'tw-rnnoise': '0' } });
  await entrerInvite(intrus, 'intrus');
  await connecterCanal(intrus, canal);
  await intrus.evaluate(c => { window.__a = peer.call(c + '-tel', localStream); }, canal.toLowerCase());
  await attendreQue(tel, () => /refusé/.test(document.getElementById('status').textContent), null, 20000);
  verifier(!(await tel.evaluate(() => 'intrus' in mediaConn)), 'appel d\'un inconnu décroché');
  await intrus.context().close();
});

await etape('arriere-plan-30s-reception', async () => {
  shell('input keyevent KEYCODE_HOME');
  await pause(30000);
  verifier(fgsActif(), 'service arrêté en arrière-plan');
  verifier(await tel.evaluate(() => peer && peer.open), 'signalisation perdue en arrière-plan');
  await pc.dispatchEvent('#ptt-btn', 'mousedown');
  const n = await niveauMax(tel, 3000);
  await pc.dispatchEvent('#ptt-btn', 'mouseup');
  verifier(n > 0.01, 'pas de son reçu en arrière-plan : ' + n);
  return { mesures: { niveau_recu: n } };
});

await etape('ecran-eteint-90s-reception', async () => {
  shell('input keyevent KEYCODE_SLEEP');
  await pause(90000);
  const ouvert = await tel.evaluate(() => peer && peer.open && enLigne.has('ordi'));
  await pc.dispatchEvent('#ptt-btn', 'mousedown');
  const n = await niveauMax(tel, 4000);
  await pc.dispatchEvent('#ptt-btn', 'mouseup');
  shell('input keyevent KEYCODE_WAKEUP');
  verifier(ouvert, 'liaison perdue écran éteint');
  verifier(n > 0.01, 'pas de son reçu écran éteint : ' + n);
  return { mesures: { niveau_recu: n } };
});

await etape('retour-premier-plan', async () => {
  shell('input keyevent KEYCODE_WAKEUP');
  shell(`am start -n ${PAQUET}/.MainActivity`);
  await pause(1500);
  verifier(await tel.evaluate(() => document.getElementById('ptt-zone').style.display === 'flex'), 'état perdu au retour');
});

await etape('coupure-donnees-mobiles-et-reconnexion', async () => {
  const wifi = /Wi-Fi is enabled|enabled/.test(shell('dumpsys wifi | head -1'));
  shell('svc data disable');
  if (wifi) shell('svc wifi disable');
  const t0 = Date.now();
  try { await attendreQue(tel, () => etatServeur === 'reco' || !navigator.onLine, null, 40000); } catch { }
  const detecte = Date.now() - t0;
  const etatPendant = await tel.evaluate(() => ({ serveur: etatServeur, enLigne: navigator.onLine, net: document.getElementById('net-txt').textContent }));
  await pause(5000);
  shell('svc data enable');
  if (wifi) shell('svc wifi enable');
  const t1 = Date.now();
  await attendreQue(tel, () => etatServeur === 'ok' && peer && peer.open, null, 90000);
  const reco = Date.now() - t1;
  await attendreQue(tel, () => enLigne.has('ordi'), null, 60000);
  const presence = Date.now() - t1;
  await attendreQue(pc, () => 'tel' in mediaConn, null, 40000).catch(() => {});
  await pc.dispatchEvent('#ptt-btn', 'mousedown');
  const n = await niveauMax(tel, 6000);
  await pc.dispatchEvent('#ptt-btn', 'mouseup');
  verifier(n > 0.01, 'audio non rétabli après coupure : ' + n);
  return { mesures: { detection_ms: detecte, etat_pendant: etatPendant, reconnexion_serveur_ms: reco, presence_retablie_ms: presence, niveau_apres: n } };
});

await etape('relais-turn-force', async () => {
  // Le PC n'accepte que des candidats « relay » : simule deux réseaux sans chemin direct (NAT symétrique, CGNAT)
  const etatTurnTel = await tel.evaluate(() => etatTurn);
  const pcr = await ouvrirApp(chrome, serveur.url, { stockage: { 'tw-rnnoise': '0' } });
  try {
    await entrerInvite(pcr, 'pcrelais');
    await pcr.evaluate(() => { const o = construireIce; construireIce = async () => ({ ...(await o()), iceTransportPolicy: 'relay' }); });
    await connecterCanal(pcr, canal);
    const ok = await pcr.evaluate(() => testerTurn(ICE_CONFIG));
    if (!ok) throw bloque(`aucun relais TURN fonctionnel (source : ${await pcr.evaluate(() => sourceTurn)}) — configurer un TURN (docs/RESEAU.md)`);
    await ajouterContact(pcr, 'tel');
    await tel.evaluate(() => { document.getElementById('in-contact').value = 'pcrelais'; ajouterContact(); });
    await attendreQue(pcr, () => enLigne.has('tel'), null, 40000);
    await pcr.click('#bcast-btn');
    await attendreQue(tel, () => 'pcrelais' in mediaConn, null, 30000);
    await pause(5000);
    await pcr.dispatchEvent('#ptt-btn', 'mousedown');
    const n = await niveauMax(tel, 5000);
    await pcr.dispatchEvent('#ptt-btn', 'mouseup');
    const type = await tel.evaluate(async () => { const s = await mediaConn.pcrelais.peerConnection.getStats(); let t; s.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) { const p = s.get(r.selectedCandidatePairId); t = s.get(p.remoteCandidateId).candidateType; } }); return t; });
    verifier(type === 'relay', 'paire sélectionnée non relayée : ' + type);
    verifier(n > 0.01, 'audio non reçu via relais : ' + n);
    return { mesures: { etat_turn_telephone: etatTurnTel, candidat_distant: type, niveau_recu: n } };
  } finally {
    await tel.evaluate(() => { const i = contacts.indexOf('pcrelais'); if (i >= 0) supprimerContact('pcrelais'); }).catch(() => {});
    await pcr.context().close();
  }
});

await etape('mesures-ressources', async () => {
  const mem = shell(`dumpsys meminfo ${PAQUET}`);
  const pss = Number((mem.match(/TOTAL(?: PSS)?:?\s+(\d+)/) || [])[1]);
  const top = shell('top -b -n 1 -o PID,%CPU,RES,NAME').split('\n').filter(l => /talkiewalkie|sandboxed_process/.test(l)).map(l => l.trim());
  return { mesures: { pss_total_ko: pss, top } };
});

await etape('deconnexion-libere-micro-et-service', async () => {
  await tel.evaluate(() => { window.__p = rawStream && rawStream.getTracks(); deconnecter(); });
  await pause(1500);
  const pistes = await tel.evaluate(() => (window.__p || []).map(t => t.readyState));
  verifier(pistes.every(s => s === 'ended'), 'pistes micro non arrêtées : ' + pistes);
  verifier(!fgsActif(), 'service de premier plan toujours actif');
  const enregistrement = shell('dumpsys audio').split('\n').filter(l => /rec|record/i.test(l) && l.includes(PAQUET));
  return { mesures: { pistes, enregistrements_actifs: enregistrement.length } };
});

await etape('mode-local-serveur-peerjs', async () => {
  const srv = spawn(process.execPath, [join(RACINE, 'tools', 'node_modules', 'peer', 'dist', 'bin', 'peerjs.js'), '--port', '9000', '--path', '/'], { stdio: 'ignore' });
  try {
    await pause(2500);
    adb(['reverse', 'tcp:9000', 'tcp:9000']);
    const canalL = canalTest();
    for (const [p, nom, autre] of [[tel, 'tel', 'ordi'], [pc, 'ordi', 'tel']]) {
      await p.evaluate(([c, a]) => {
        document.querySelectorAll('.tgl-btn')[1].click();
        document.getElementById('in-ip').value = '127.0.0.1:9000';
        document.getElementById('in-canal').value = c;
        if (!contacts.includes(a)) contacts.push(a);
        connecter();
      }, [canalL, autre]);
    }
    await attendreQue(tel, () => peer && peer.open, null, 20000);
    await attendreQue(tel, () => enLigne.has('ordi'), null, 30000);
    await pc.click('#bcast-btn');
    await attendreQue(tel, () => Object.keys(mediaConn).length > 0, null, 20000);
    await pause(3000);
    await pc.dispatchEvent('#ptt-btn', 'mousedown');
    const n = await niveauMax(tel, 4000);
    await pc.dispatchEvent('#ptt-btn', 'mouseup');
    verifier(n > 0.01, 'audio non reçu en mode local : ' + n);
    return { mesures: { niveau_recu: n, serveur: 'peer 1.0.2 sur le PC, ws://127.0.0.1:9000 via adb reverse' } };
  } finally {
    await tel.evaluate(() => deconnecter()).catch(() => {});
    await pc.evaluate(() => deconnecter()).catch(() => {});
    srv.kill();
  }
});

await etape('mode-direct-sans-serveur', async () => {
  // Les deux appareils doivent partager un réseau IP (partage de connexion USB/Wi-Fi) : candidats « host » uniquement
  const ipTel = shell('ip -4 addr').match(/inet (\d+\.\d+\.\d+\.\d+)\/\d+ .*(wlan|rndis|ap|swlan)/g);
  if (!ipTel) throw bloque('téléphone et PC sans réseau local commun (activer le partage de connexion USB ou un Wi-Fi commun)');
  for (const p of [tel, pc]) await p.evaluate(() => { document.querySelectorAll('.tgl-btn')[2].click(); });
  await tel.evaluate(() => directCreer());
  await attendreQue(tel, () => document.getElementById('dir-out').value.length > 20, null, 15000);
  const offre = await tel.inputValue('#dir-out');
  await pc.evaluate(async o => { await directRejoindre(); document.getElementById('dir-in').value = o; await directValider(); }, offre);
  await attendreQue(pc, () => document.getElementById('dir-out').value.length > 20 && document.getElementById('dir-code-titre').textContent.startsWith('2/2'), null, 15000);
  const reponse = await pc.inputValue('#dir-out');
  await tel.evaluate(async r => { document.getElementById('dir-in').value = r; await directValider(); }, reponse);
  await attendreQue(tel, () => directActif, null, 20000);
  await pc.evaluate(() => activerMicro('toucher'));
  let n = 0; const fin = Date.now() + 4000;
  while (Date.now() < fin) { n = Math.max(n, await tel.evaluate(async () => { let v = 0; (await dPc.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') v = r.audioLevel || 0; }); return v; })); await pause(150); }
  await pc.evaluate(() => couperMicro());
  verifier(n > 0.01, 'audio non reçu en mode direct : ' + n);
  return { mesures: { taille_code_offre: offre.length, taille_code_reponse: reponse.length, niveau_recu: n } };
});

const erreursJs = tel ? tel.erreurs : [];
mkdirSync(join(RACINE, 'docs', 'tests'), { recursive: true });
writeFileSync(join(RACINE, 'docs', 'tests', 'appareil-resultats.json'), JSON.stringify({ date: new Date().toISOString(), appareil: infos, canal, erreursJs, resultats }, null, 2));
console.log('Erreurs JS sur le téléphone :', erreursJs.length ? erreursJs : 'aucune');
await chrome.close(); serveur.srv.close();
try { await telNav.close(); } catch { }
process.exit(0);
