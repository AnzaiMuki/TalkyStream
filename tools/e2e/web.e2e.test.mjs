// Tests E2E de l'application web corrigée (web/index.html) dans Chrome, via le vrai serveur PeerJS Cloud.
// Lancer : cd tools && node --test --test-concurrency=1 e2e/web.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveurStatique, lancerChrome, ouvrirApp, entrerInvite, connecterCanal, ajouterContact, statsRecues, etatEmission, pause, canalTest } from './harness.mjs';

let serveur, chrome;
before(async () => { serveur = await serveurStatique(); chrome = await lancerChrome(); });
after(async () => { await chrome?.close(); serveur?.srv.close(); });

const sansRnnoise = { 'tw-rnnoise': '0' };   // RNNoise supprime le bip de test (c'est son rôle) : coupé pour mesurer
const ignorables = e => /favicon|ERR_INTERNET_DISCONNECTED|Peer error|net::ERR/.test(e);

test('démarrage : splash, écran de connexion, aucune erreur JavaScript', async () => {
  const p = await ouvrirApp(chrome, serveur.url);
  assert.equal(await p.isVisible('#splash'), true);
  await entrerInvite(p, 'Testeur');
  assert.equal(await p.inputValue('#in-pseudo'), 'Testeur');
  assert.match(await p.textContent('#status'), /Invité : Testeur/);
  assert.deepEqual(p.erreurs.filter(e => !ignorables(e)), []);
  await p.context().close();
});

test('code canal : 6 caractères aléatoires sans ambiguïté', async () => {
  const p = await ouvrirApp(chrome, serveur.url);
  await entrerInvite(p, 'Testeur');
  const codes = new Set();
  for (let i = 0; i < 30; i++) { await p.click('button[onclick="genCode()"]'); codes.add(await p.inputValue('#in-canal')); }
  for (const c of codes) assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  assert.ok(codes.size >= 29, 'codes répétés : ' + codes.size);
  await p.context().close();
});

test('injection HTML : un nom de contact malveillant est affiché comme du texte', async () => {
  const piege = '<img src=x onerror="window.__xss=1">';
  const p = await ouvrirApp(chrome, serveur.url, { stockage: { 'tw-session-guest': 'Victime', 'tw-contacts-victime': JSON.stringify([piege, "o'brien"]) } });
  await p.waitForSelector('#main', { state: 'visible' });
  await p.evaluate(() => { peer = { disconnected: false }; afficherContacts(); afficherModalAppel(); majDiagnostic(); peer = null; });
  await pause(300);
  assert.equal(await p.evaluate(() => window.__xss), undefined);
  assert.equal(await p.locator('#chips img').count(), 0);
  assert.ok((await p.textContent('#chips')).includes(piege));
  // L'ajout passe par le nettoyage du pseudo
  await p.evaluate(() => { document.getElementById('in-contact').value = 'Bob <script>'; ajouterContact(); });
  assert.ok(await p.evaluate(() => contacts.includes('Bob_script')));
  await p.context().close();
});

test('audio de bout en bout : micro muet avant PTT, son reçu pendant PTT, coupé au relâchement', async () => {
  const canal = canalTest();
  const a = await ouvrirApp(chrome, serveur.url, { stockage: sansRnnoise });
  const b = await ouvrirApp(chrome, serveur.url, { stockage: sansRnnoise });
  await entrerInvite(a, 'alice'); await entrerInvite(b, 'bob');
  await connecterCanal(a, canal); await connecterCanal(b, canal);
  await ajouterContact(a, 'bob'); await ajouterContact(b, 'alice');

  // P0 : après connexion, les pistes micro sont capturées mais désactivées
  assert.deepEqual((await etatEmission(a)).pistes, [false]);

  await a.waitForFunction(() => enLigne.has('bob'), null, { timeout: 30000 });
  await a.click('#bcast-btn');
  await b.waitForFunction(() => Object.keys(mediaConn).length > 0, null, { timeout: 20000 });
  await pause(3000);
  const avant = await statsRecues(b);
  assert.ok(avant.niveau < 0.01, 'son reçu avant PTT : ' + avant.niveau);

  const t0 = Date.now();
  await a.dispatchEvent('#ptt-btn', 'mousedown');
  let pendant;
  for (let i = 0; i < 40; i++) { await pause(100); pendant = await statsRecues(b); if (pendant.niveau > 0.01) break; }
  const delaiPremierSon = Date.now() - t0;
  assert.ok(pendant.niveau > 0.01, 'aucun son reçu pendant PTT : ' + pendant.niveau);
  assert.deepEqual((await etatEmission(a)).pistes, [true]);

  await a.dispatchEvent('#ptt-btn', 'mouseup');
  let apres;
  for (let i = 0; i < 30; i++) { await pause(100); apres = await statsRecues(b); if (apres.niveau < 0.005) break; }
  assert.ok(apres.niveau < 0.005, 'son toujours reçu après relâchement : ' + apres.niveau);
  assert.ok(apres.octets > avant.octets);
  console.log(`  mesure : premier son reçu ${delaiPremierSon} ms après l'appui (Chrome↔Chrome, même machine, PeerJS Cloud)`);

  // Déconnexion : le micro est réellement libéré
  const pistes = await a.evaluate(() => { window.__pistes = rawStream.getTracks(); deconnecter(); return window.__pistes.map(t => t.readyState); });
  assert.deepEqual(pistes, ['ended']);
  assert.equal(await a.evaluate(() => localStream), null);
  for (const p of [a, b]) { assert.deepEqual(p.erreurs.filter(e => !ignorables(e)), []); await p.context().close(); }
});

test('sécurité : un pair inconnu ne peut ni écouter ni usurper un nom', async () => {
  const canal = canalTest();
  const b = await ouvrirApp(chrome, serveur.url, { stockage: sansRnnoise });
  const m = await ouvrirApp(chrome, serveur.url, { stockage: sansRnnoise });
  await entrerInvite(b, 'bob'); await entrerInvite(m, 'mallory');
  await connecterCanal(b, canal); await connecterCanal(m, canal);
  // mallory n'est pas un contact de bob : son appel audio direct doit être refusé
  await m.evaluate(c => { window.__appel = peer.call(c + '-bob', localStream); }, canal.toLowerCase());
  await b.waitForFunction(() => /refusé/.test(document.getElementById('status').textContent), null, { timeout: 20000 });
  assert.equal(await b.evaluate(() => Object.keys(mediaConn).length), 0);
  // Message de chat avec un faux expéditeur : le nom réel du pair est affiché
  await m.evaluate(c => new Promise(ok => { const d = peer.connect(c + '-bob'); d.on('open', () => { d.send({ type: 'chat', de: 'admin', txt: 'salut' }); ok(); }); }), canal.toLowerCase());
  await b.waitForFunction(() => document.querySelectorAll('#chat-liste .msg').length > 0, null, { timeout: 15000 });
  assert.equal(await b.textContent('#chat-liste .msg small'), 'mallory');
  // « appel-accepte » non sollicité : aucun appel audio n'est lancé
  await m.evaluate(c => new Promise(ok => { const d = peer.connect(c + '-bob'); d.on('open', () => { d.send({ type: 'appel-accepte', de: 'mallory' }); ok(); }); }), canal.toLowerCase());
  await pause(2000);
  assert.equal(await b.evaluate(() => Object.keys(mediaConn).length), 0);
  for (const p of [b, m]) await p.context().close();
});

test('robustesse : double appui sur OK ne crée qu\'une seule connexion', async () => {
  const p = await ouvrirApp(chrome, serveur.url, { stockage: sansRnnoise });
  await entrerInvite(p, 'solo');
  await p.fill('#in-canal', canalTest());
  await p.evaluate(() => { window.__nb = 0; const P = window.Peer; window.Peer = function (...a) { window.__nb++; return new P(...a); }; });
  await p.evaluate(() => { connecter(); connecter(); });
  await p.waitForFunction(() => document.getElementById('ptt-zone').style.display === 'flex', null, { timeout: 25000 });
  assert.equal(await p.evaluate(() => window.__nb), 1);
  await p.context().close();
});

test('RNNoise embarqué : le module WASM local se charge', async () => {
  const p = await ouvrirApp(chrome, serveur.url);
  await entrerInvite(p, 'bruit');
  const ok = await p.evaluate(async () => { const r = await getMic(); return { r, bruitEtat }; });
  assert.deepEqual(ok, { r: true, bruitEtat: 'on' });
  await p.context().close();
});
