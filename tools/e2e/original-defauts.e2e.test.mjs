// Reproduction des défauts P0 sur le fichier de référence NON modifié (talkie-walkie-final3.html).
// Ces tests passent quand le défaut EST présent : ils documentent la faille corrigée dans web/index.html.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveurStatique, lancerChrome, ouvrirApp, entrerInvite, connecterCanal, statsRecues, pause, canalTest, RACINE } from './harness.mjs';

let serveur, chrome;
before(async () => { serveur = await serveurStatique(RACINE); chrome = await lancerChrome(); });
after(async () => { await chrome?.close(); serveur?.srv.close(); });

test('ORIGINAL : un inconnu qui connaît canal + pseudo entend le micro de la victime sans PTT', async () => {
  const url = serveur.url + 'talkie-walkie-final3.html';
  const canal = canalTest();
  const victime = await ouvrirApp(chrome, url, { stockage: { 'tw-rnnoise': '0' } });
  const espion = await ouvrirApp(chrome, url, { stockage: { 'tw-rnnoise': '0' } });
  await entrerInvite(victime, 'victime'); await entrerInvite(espion, 'espion');
  await connecterCanal(victime, canal); await connecterCanal(espion, canal);

  assert.deepEqual(await victime.evaluate(() => localStream.getAudioTracks().map(t => t.enabled)), [true], 'micro actif dès la connexion');
  // L'espion appelle directement la victime : décroché automatiquement
  await espion.evaluate(c => {
    const call = peer.call(c + '-victime', localStream);
    mediaConn.victime = call;
    call.on('stream', s => jouerFlux(s, call));
  }, canal.toLowerCase());
  let s;
  for (let i = 0; i < 100; i++) { await pause(200); s = await statsRecues(espion); if (s.niveau > 0.01) break; }
  assert.ok(s.niveau > 0.01, 'son de la victime capté par l\'espion : ' + s.niveau);
  assert.equal(await victime.evaluate(() => micActif), false, 'la victime n\'a jamais appuyé sur PTT');
  for (const p of [victime, espion]) await p.context().close();
});
