// Tests unitaires des fonctions de validation et de sécurité de web/index.html
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { charger, html } from './extraire.mjs';

const f = charger(['c:esc', 'c:nettoyerPseudo', 'c:pseudoValide', 'c:sanitize', 'f:iceValides', 'f:analyserServeurLocal', 'f:sdpOpus'], { opts: { debit: 24000 } });
const vrai = x => JSON.parse(JSON.stringify(x));

test('esc : neutralise les caractères HTML', () => {
  assert.equal(f.esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
});

test('pseudos : nettoyage et validation', () => {
  assert.equal(f.nettoyerPseudo('Élodie Martin'), 'Elodie_Martin');
  assert.equal(f.nettoyerPseudo('<script>'), 'script');
  assert.equal(f.pseudoValide('ab'), false);
  assert.equal(f.pseudoValide('abc'), true);
  assert.equal(f.pseudoValide('a'.repeat(21)), false);
  assert.equal(f.sanitize('Canal Été-1'), 'canalete-1');
});

test('iceValides : accepte une configuration Metered réelle', () => {
  assert.equal(f.iceValides([
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'u', credential: 'p' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'u', credential: 'p' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'u', credential: 'p' },
  ]), true);
  assert.equal(f.iceValides([{ urls: ['turn:a.b:3478?transport=udp', 'turn:a.b:3478?transport=tcp'], username: 'u', credential: 'p' }]), true);
});

test('iceValides : refuse les configurations malformées ou dangereuses', () => {
  for (const x of [
    null, {}, [], 'x', [null], [{}],
    [{ urls: 'http://evil.example/' }],
    [{ urls: 'javascript:alert(1)' }],
    [{ urls: 'turn:a.b:3478' }],                                  // relais sans identifiants
    [{ urls: 'turn:a.b:3478', username: 1, credential: 'p' }],
    [{ urls: 'turn:a.b:3478?transport=sctp', username: 'u', credential: 'p' }],
    [{ urls: 'stun:a b' }],
    Array(21).fill({ urls: 'stun:a.b:3478' }),
  ]) assert.equal(f.iceValides(x), false, JSON.stringify(x)?.slice(0, 60));
});

test('serveur local : adresses privées en ws://, wss:// pour le reste', () => {
  assert.deepEqual(vrai(f.analyserServeurLocal('192.168.1.20:9000')), { host: '192.168.1.20', port: 9000, secure: false });
  assert.deepEqual(vrai(f.analyserServeurLocal('10.0.0.5')), { host: '10.0.0.5', port: 9000, secure: false });
  assert.deepEqual(vrai(f.analyserServeurLocal('172.16.4.1:80')), { host: '172.16.4.1', port: 80, secure: false });
  assert.deepEqual(vrai(f.analyserServeurLocal('wss://peer.example.org')), { host: 'peer.example.org', port: 443, secure: true });
  assert.deepEqual(vrai(f.analyserServeurLocal('wss://peer.example.org:8443/')), { host: 'peer.example.org', port: 8443, secure: true });
  for (const x of ['8.8.8.8:9000', 'example.com:9000', 'ws://example.com', '192.168.1.2:99999', '192.168.1.2:0', '', 'a b', '192.168.1.2:90/../x', '172.32.0.1'])
    assert.equal(f.analyserServeurLocal(x), null, x);
});

test('Opus : paramètres voix injectés dans le SDP', () => {
  const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n';
  const out = f.sdpOpus(sdp);
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;stereo=0;sprop-stereo=0;cbr=0;maxplaybackrate=48000;maxaveragebitrate=24000/);
  assert.match(out, /a=ptime:20/);
});

// Les valeurs à rechercher sont lues dans l'original au moment du test : elles ne doivent jamais être recopiées dans le dépôt
const ORIGINAL = new URL('../../talkie-walkie-final3.html', import.meta.url);

test('aucun identifiant TURN permanent dans le code livré', () => {
  assert.doesNotMatch(html, /EXPRESS_PASS|METERED_PASS/);
});

test('aucune valeur TURN de l’original dans le code livré', { skip: !existsSync(ORIGINAL) && 'original absent' }, () => {
  const valeurs = [...readFileSync(ORIGINAL, 'utf8').matchAll(/^const (?:EXPRESS|METERED)_(?:USER|PASS) = '([^']+)';/gm)].map(m => m[1]);
  assert.ok(valeurs.length > 0, 'aucune valeur TURN trouvée dans l’original');
  for (const v of valeurs) assert.ok(!html.includes(v), 'une valeur TURN de l’original est présente');
});

test('aucune ressource exécutable chargée depuis un CDN', () => {
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\.jsdelivr|gstatic\.com\/firebasejs/);
  assert.match(html, /Content-Security-Policy/);
});

test('micro muet après capture (régression P0)', () => {
  assert.match(html, /audioTracks\.forEach\(track => track\.enabled = false\);/);
  assert.doesNotMatch(html, /audioTracks\.forEach\(track => track\.enabled = true\);/);
});
