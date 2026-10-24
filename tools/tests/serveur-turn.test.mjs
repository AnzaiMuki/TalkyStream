// Tests du service d'identifiants TURN temporaires (serveur-turn/api/turn.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import handler, { identifiantsCoturn } from '../../serveur-turn/api/turn.js';
import { charger } from './extraire.mjs';

const { iceValides } = charger(['f:iceValides']);

function appeler({ origin, method = 'GET', env = {} }) {
  const avant = { ...process.env };
  Object.assign(process.env, env);
  const res = { statut: 0, entetes: {}, corps: null,
    status(s) { this.statut = s; return this; }, json(c) { this.corps = c; return this; }, end() { return this; }, setHeader(k, v) { this.entetes[k] = v; } };
  return handler({ method, headers: origin ? { origin } : {} }, res).then(() => { process.env = avant; return res; });
}

test('coturn : identifiant HMAC-SHA1 expirant, vérifiable par le serveur TURN', () => {
  const [s] = identifiantsCoturn('secret', ['turn:turn.example.org:3478'], 3600, 1_000_000_000_000);
  const [exp] = s.username.split(':');
  assert.equal(Number(exp), 1_000_000_000 + 3600);
  assert.equal(s.credential, createHmac('sha1', 'secret').update(s.username).digest('base64'));
});

test('réponse valide pour l\'application et sans secret', async () => {
  const r = await appeler({ origin: 'https://appassets.androidplatform.net', env: { TURN_SECRET: 'S3CRET-ne-pas-fuir', TURN_URLS: 'turn:t.example.org:3478,turns:t.example.org:5349' } });
  assert.equal(r.statut, 200);
  assert.equal(iceValides(r.corps), true);
  assert.doesNotMatch(JSON.stringify(r.corps), /S3CRET/);
  assert.equal(r.entetes['access-control-allow-origin'], 'https://appassets.androidplatform.net');
  assert.equal(r.entetes['cache-control'], 'no-store');
});

test('origine étrangère refusée, méthode autre que GET refusée, non configuré = 503', async () => {
  assert.equal((await appeler({ origin: 'https://evil.example', env: { TURN_SECRET: 'x', TURN_URLS: 'turn:a.b:3478' } })).statut, 403);
  assert.equal((await appeler({ origin: 'https://anzaimuki.github.io', method: 'POST', env: { TURN_SECRET: 'x', TURN_URLS: 'turn:a.b:3478' } })).statut, 405);
  assert.equal((await appeler({ origin: 'https://anzaimuki.github.io', env: { TURN_SECRET: '', TURN_URLS: '', CF_TURN_KEY_ID: '', CF_TURN_API_TOKEN: '', METERED_APP: '', METERED_SECRET_KEY: '' } })).statut, 503);
});

test('Cloudflare : jeton envoyé au seul fournisseur, port 53 retiré, réponse valide et sans secret', async t => {
  const appels = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    appels.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u-temp', credential: 'c-temp' },
    ] }) };
  });
  const r = await appeler({ origin: 'https://appassets.androidplatform.net', env: { TURN_SECRET: '', TURN_URLS: '', CF_TURN_KEY_ID: 'cle-id', CF_TURN_API_TOKEN: 'JETON-ne-pas-fuir', TURN_TTL: '7200' } });
  assert.equal(r.statut, 200);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/cle-id/credentials/generate-ice-servers');
  assert.equal(appels[0].init.headers.authorization, 'Bearer JETON-ne-pas-fuir');
  assert.deepEqual(JSON.parse(appels[0].init.body), { ttl: 7200 });
  assert.equal(iceValides(r.corps), true);
  assert.doesNotMatch(JSON.stringify(r.corps), /JETON|:53/);
  assert.equal(r.corps[1].username, 'u-temp');
});

test('Cloudflare en erreur : 502 sans détail', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const r = await appeler({ origin: 'https://appassets.androidplatform.net', env: { TURN_SECRET: '', TURN_URLS: '', CF_TURN_KEY_ID: 'k', CF_TURN_API_TOKEN: 'JETON' } });
  assert.equal(r.statut, 502);
  assert.doesNotMatch(JSON.stringify(r.corps), /JETON|401/);
});
