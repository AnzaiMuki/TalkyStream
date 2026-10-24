// Service d'identifiants TURN TEMPORAIRES pour Talkie-walkie (fonction serverless Vercel, Node 18+).
// Le secret ne quitte jamais le serveur ; l'application reçoit des identifiants valables TURN_TTL secondes.
//
// Deux modes (variables d'environnement) :
//  - coturn « TURN REST API » (RFC draft-uberti-behave-turn-rest) : TURN_SECRET, TURN_URLS (séparées par des virgules)
//  - Cloudflare Realtime TURN : CF_TURN_KEY_ID, CF_TURN_API_TOKEN (jeton de la clé TURN, 1 000 Go/mois offerts)
//  - Metered : METERED_APP, METERED_SECRET_KEY (clé SECRÈTE du tableau de bord, jamais la mettre dans l'app)
// Optionnel : TURN_TTL (défaut 3600), ORIGINES (défaut : origines de l'app).
import { createHmac, randomBytes } from 'node:crypto';

const ORIGINES = (process.env.ORIGINES || 'https://appassets.androidplatform.net,https://anzaimuki.github.io').split(',');

export function identifiantsCoturn(secret, urls, ttl, maintenant = Date.now()) {
  const username = `${Math.floor(maintenant / 1000) + ttl}:${randomBytes(6).toString('hex')}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return [{ urls, username, credential }];
}

// Cloudflare renvoie { iceServers: [...] } ; le port 53 est bloqué par les navigateurs (attente inutile) : retiré
export async function identifiantsCloudflare(cle, jeton, ttl) {
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cle)}/credentials/generate-ice-servers`, {
    method: 'POST', headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl }),
  });
  if (!r.ok) throw new Error('Cloudflare ' + r.status);
  const { iceServers } = await r.json();
  return [].concat(iceServers).map(s => ({ ...s, urls: [].concat(s.urls).filter(u => !/:53(\?|$)/.test(u)) })).filter(s => s.urls.length);
}

async function identifiantsMetered(app, cle, ttl) {
  const r = await fetch(`https://${app}.metered.live/api/v1/turn/credential?secretKey=${encodeURIComponent(cle)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expiryInSeconds: ttl, label: 'talkie-walkie' }),
  });
  if (!r.ok) throw new Error('Metered ' + r.status);
  const { username, password } = await r.json();
  const h = 'global.relay.metered.ca';
  return [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: [`turn:${h}:80`, `turn:${h}:80?transport=tcp`, `turn:${h}:443`, `turns:${h}:443?transport=tcp`], username, credential: password },
  ];
}

export default async function handler(req, res) {
  const origine = req.headers.origin || '';
  if (origine && !ORIGINES.includes(origine)) { res.status(403).json({ erreur: 'origine refusée' }); return; }
  if (origine) res.setHeader('access-control-allow-origin', origine);
  res.setHeader('vary', 'origin');
  res.setHeader('cache-control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).end(); return; }
  const ttl = Math.min(Math.max(Number(process.env.TURN_TTL) || 3600, 300), 86400);
  try {
    if (process.env.TURN_SECRET && process.env.TURN_URLS) {
      res.status(200).json(identifiantsCoturn(process.env.TURN_SECRET, process.env.TURN_URLS.split(','), ttl));
    } else if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) {
      res.status(200).json(await identifiantsCloudflare(process.env.CF_TURN_KEY_ID, process.env.CF_TURN_API_TOKEN, ttl));
    } else if (process.env.METERED_APP && process.env.METERED_SECRET_KEY) {
      res.status(200).json(await identifiantsMetered(process.env.METERED_APP, process.env.METERED_SECRET_KEY, ttl));
    } else {
      res.status(503).json({ erreur: 'relais non configuré' });
    }
  } catch {
    res.status(502).json({ erreur: 'fournisseur TURN indisponible' });   // pas de détail : ne révèle rien du secret
  }
}
