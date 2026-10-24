// Tests ECC (ECDSA P-256 / SHA-256) de la vérification des codes Pro.
// Le code testé est extrait tel quel de web/index.html (section « MODE PRO v2 ») et exécuté
// avec WebCrypto de Node, qui implémente la même API que Chrome/WebView.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;
const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
const debut = html.indexOf('const PRO_ACTIF'), fin = html.indexOf('const relaisAutorise');
assert.ok(debut > 0 && fin > debut, 'section Pro introuvable');
const sectionPro = html.slice(debut, fin);

const b64u = u => Buffer.from(u).toString('base64url');
const EPOCH_PRO = Date.UTC(2026, 0, 1);

// Charge la section Pro avec une clé publique donnée, dans un contexte isolé
function chargerPro(pubRawB64u, { appareil = 'APPAREIL1', email = '' } = {}) {
  const store = new Map([['tw-device', appareil]]);
  const ctx = {
    crypto: webcrypto, atob, TextEncoder, Uint8Array, DataView, Date,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    modeGoogle: !!email, emailGoogle: email,
  };
  vm.createContext(ctx);
  vm.runInContext(sectionPro.replace("const PRO_PUBKEY = '';", `const PRO_PUBKEY = '${pubRawB64u}';`) + '\n;globalThis.proVerifier = proVerifier; globalThis.idPro = idPro;', ctx);
  // résultats recopiés dans le contexte du test (objets d'un autre « realm » sinon)
  return { proVerifier: async c => JSON.parse(JSON.stringify(await ctx.proVerifier(c))) };
}

async function nouvellesCles() {
  const k = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await subtle.exportKey('raw', k.publicKey));
  return { ...k, raw, rawB64u: b64u(raw) };
}

// Format du code : 34 octets de charge utile + 64 octets de signature (r||s, IEEE P1363)
async function fabriquerCode(privateKey, { version = 1, type = 0, expDans = 30 * 864e5, id = 'APPAREIL1' } = {}) {
  const p = new Uint8Array(34);
  p[0] = version; p[1] = type;
  new DataView(p.buffer).setUint32(14, Math.floor((Date.now() + expDans - EPOCH_PRO) / 1000));
  const h = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(id)));
  p.set(h.slice(0, 16), 18);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, p));
  return { payload: p, sig, code: b64u(Buffer.concat([p, sig])) };
}

test('ECC : la clé publique attendue est un point P-256 non compressé de 65 octets', async () => {
  const { raw } = await nouvellesCles();
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 0x04);
});

test('ECC : un code valide signé par la bonne clé est accepté', async () => {
  const k = await nouvellesCles();
  const { code } = await fabriquerCode(k.privateKey);
  const r = await chargerPro(k.rawB64u).proVerifier(code);
  assert.equal(r.ok, true); assert.equal(r.admin, false);
});

test('ECC : toute modification de la charge utile invalide la signature', async () => {
  const k = await nouvellesCles();
  const { payload, sig } = await fabriquerCode(k.privateKey, { expDans: 864e5 });
  const pro = chargerPro(k.rawB64u);
  for (const i of [2, 14, 17, 20, 33]) {
    const p2 = payload.slice(); p2[i] ^= 0x01;
    const r = await pro.proVerifier(b64u(Buffer.concat([p2, sig])));
    assert.equal(r.ok, false, 'octet ' + i);
  }
});

test('ECC : signature altérée, tronquée ou nulle rejetée', async () => {
  const k = await nouvellesCles();
  const { payload, sig } = await fabriquerCode(k.privateKey);
  const pro = chargerPro(k.rawB64u);
  const s2 = sig.slice(); s2[10] ^= 0x80;
  assert.deepEqual(await pro.proVerifier(b64u(Buffer.concat([payload, s2]))), { ok: false, raison: 'Signature invalide' });
  assert.deepEqual(await pro.proVerifier(b64u(Buffer.concat([payload, new Uint8Array(64)]))), { ok: false, raison: 'Signature invalide' });
  assert.deepEqual(await pro.proVerifier(b64u(Buffer.concat([payload, sig.slice(0, 63)]))), { ok: false, raison: 'Code invalide' });
});

test('ECC : un code signé par une autre clé est rejeté', async () => {
  const bonne = await nouvellesCles(), pirate = await nouvellesCles();
  const { code } = await fabriquerCode(pirate.privateKey);
  assert.deepEqual(await chargerPro(bonne.rawB64u).proVerifier(code), { ok: false, raison: 'Signature invalide' });
});

test('ECC : clé publique invalide (point hors courbe, longueur fausse) refusée', async () => {
  const k = await nouvellesCles();
  const { code } = await fabriquerCode(k.privateKey);
  const horsCourbe = k.raw.slice(); horsCourbe[64] ^= 0x01;   // y modifié : le point n'est plus sur P-256
  assert.deepEqual(await chargerPro(b64u(horsCourbe)).proVerifier(code), { ok: false, raison: 'Clé publique invalide' });
  assert.deepEqual(await chargerPro(b64u(k.raw.slice(0, 33))).proVerifier(code), { ok: false, raison: 'Clé publique invalide' });
});

test('Pro : expiration, version, type et liaison à l\'appareil vérifiés', async () => {
  const k = await nouvellesCles();
  const pro = chargerPro(k.rawB64u, { appareil: 'APPAREIL1' });
  assert.equal((await pro.proVerifier((await fabriquerCode(k.privateKey, { expDans: -1000 })).code)).raison, 'Code expiré');
  assert.equal((await pro.proVerifier((await fabriquerCode(k.privateKey, { version: 2 })).code)).raison, 'Version de code non supportée');
  assert.equal((await pro.proVerifier((await fabriquerCode(k.privateKey, { type: 2 })).code)).raison, 'Code invalide');
  assert.equal((await pro.proVerifier((await fabriquerCode(k.privateKey, { id: 'AUTRE' })).code)).raison, 'Code lié à un autre compte / appareil');
  const admin = await pro.proVerifier((await fabriquerCode(k.privateKey, { type: 1, id: 'AUTRE' })).code);
  assert.equal(admin.ok, true); assert.equal(admin.admin, true);   // les codes admin ne sont pas liés à un appareil (choix de conception)
});

test('Pro : code lié à l\'adresse Gmail normalisée', async () => {
  const k = await nouvellesCles();
  const { code } = await fabriquerCode(k.privateKey, { id: 'alice@gmail.com' });
  assert.equal((await chargerPro(k.rawB64u, { email: 'Alice@Gmail.com' }).proVerifier(code)).ok, true);
});

test('Pro : données malformées rejetées sans exception', async () => {
  const k = await nouvellesCles();
  const pro = chargerPro(k.rawB64u);
  for (const x of ['', '%%%', 'a'.repeat(5000), '\u0000', 'AAAA']) {
    const r = await pro.proVerifier(x);
    assert.equal(r.ok, false);
  }
});

test('ECC (constat) : malléabilité ECDSA — la signature (r, n−s) est aussi acceptée', async () => {
  const k = await nouvellesCles();
  const { payload, sig } = await fabriquerCode(k.privateKey);
  const n = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
  const s = BigInt('0x' + Buffer.from(sig.slice(32)).toString('hex'));
  const s2 = Buffer.from((n - s).toString(16).padStart(64, '0'), 'hex');
  const r = await chargerPro(k.rawB64u).proVerifier(b64u(Buffer.concat([payload, sig.slice(0, 32), s2])));
  // Sans impact ici : la charge utile (droits, appareil, expiration) reste identique et signée.
  assert.equal(r.ok, true);
});

test('Pro : sans clé publique configurée, le verrou Pro ne bloque plus le relais', () => {
  assert.match(html, /const PRO_EXIGE = PRO_ACTIF && !!PRO_PUBKEY;/);
  assert.match(html, /const relaisAutorise = \(\) => !PRO_EXIGE \|\|/);
});
