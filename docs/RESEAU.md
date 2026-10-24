# Réseau : modes de connexion et relais TURN

## 1. Les trois modes

| Mode | Signalisation | Chemin audio | Prérequis |
|---|---|---|---|
| **Internet** | PeerJS Cloud `wss://0.peerjs.com` | direct (STUN) si les NAT le permettent, sinon **relais TURN** | Internet ; un TURN pour les réseaux incompatibles |
| **Local** | serveur PeerJS sur le réseau privé, `ws://IP:9000` | direct sur le LAN | un serveur PeerJS joignable (`npx peer --port 9000`) |
| **Direct** | aucun serveur : codes d'offre et de réponse échangés par QR code ou texte | direct, candidats *host* uniquement | les deux appareils sur le **même réseau IP** |

## 2. Quand faut-il un TURN ?

WebRTC essaie d'abord une liaison directe. Elle échoue quand :
- un des deux appareils est derrière un **CGNAT** d'opérateur mobile (cas fréquent en 4G) ou un NAT symétrique ;
- les deux appareils sont derrière **la même IP publique** sans « hairpin ». C'est le cas constaté pendant les tests : le PC sortait par le partage USB du téléphone, et la liaison est restée bloquée en `checking` (voir [03-TESTS-ADB.md](03-TESTS-ADB.md) §4).

Dans ces cas, seul un relais TURN fait passer l'audio. Il ne déchiffre rien : le flux reste en DTLS-SRTP.

**État actuel** : le relais public openrelay ne répond plus (aucun candidat *relay* obtenu en 6 s). Sans configuration, le mode Internet entre réseaux incompatibles **ne fonctionne pas**, comme dans l'original, où le verrou Pro retirait de toute façon le relais.

## 3. Ordre de priorité des sources de relais dans l'application

1. **JSON personnel** saisi dans Paramètres › Avancé (tableau `iceServers`).
2. **Metered personnel** : nom d'app + clé, saisis dans Paramètres › Avancé.
3. **Service d'identifiants temporaires** : `tw.turnServiceUrl` (APK) ou `TURN_SERVICE_URL` (web), en HTTPS uniquement.
4. STUN public seul.

Dans l'APK, les réglages personnels sont stockés **chiffrés** par le Keystore Android. Dans la version web, ils restent dans le `localStorage` de l'appareil. La source utilisée s'affiche dans le diagnostic (`sourceTurn`).

## 4. Option recommandée : déployer `serveur-turn` (identifiants temporaires)

[`serveur-turn/api/turn.js`](../serveur-turn/api/turn.js) est une fonction serverless (Vercel, Node 18+). Le secret reste sur le serveur ; l'application reçoit des identifiants valables `TURN_TTL` secondes.

Variables d'environnement à définir sur la plateforme d'hébergement, **jamais dans le dépôt** :

| Variable | Mode | Contenu |
|---|---|---|
| `TURN_SECRET`, `TURN_URLS` | coturn (« TURN REST API ») | secret partagé `static-auth-secret` de coturn ; URLs séparées par des virgules, par exemple `turn:turn.exemple.org:3478,turns:turn.exemple.org:5349` |
| `METERED_APP`, `METERED_SECRET_KEY` | Metered | nom de l'app et **clé secrète** du tableau de bord |
| `TURN_TTL` | optionnel | 300 à 86 400 s (défaut 3 600) |
| `ORIGINES` | optionnel | origines autorisées (défaut : `https://appassets.androidplatform.net,https://anzaimuki.github.io`) |

Étapes :
1. `cd serveur-turn && npx vercel deploy`, puis définir les variables dans le tableau de bord.
2. Tester : `curl -H "Origin: https://appassets.androidplatform.net" https://<projet>.vercel.app/api/turn` doit renvoyer un tableau `iceServers` avec `username` et `credential` temporaires.
3. Dans `android/local.properties` : `tw.turnServiceUrl=https://<projet>.vercel.app/api/turn`, puis recompiler.
4. Pour la version web : renseigner `TURN_SERVICE_URL` dans `web/index.html` avant publication.

Remarque : un service sans authentification de l'utilisateur distribue des identifiants à quiconque connaît l'URL depuis une origine autorisée. L'en-tête `Origin` se falsifie hors navigateur. Il faut donc surveiller la consommation et plafonner le quota chez le fournisseur.

## 5. Option simple : un TURN personnel par appareil

Paramètres › Avancé › serveur TURN personnalisé : coller un JSON du type
`[{"urls":"turn:global.relay.metered.ca:443","username":"…","credential":"…"}]`,
ou saisir le nom d'app Metered et la clé. Il faut se déconnecter puis se reconnecter. Les identifiants permanents ainsi saisis restent sur l'appareil, chiffrés, et ne sont jamais envoyés ailleurs qu'au serveur TURN.

## 6. Mode Local : serveur PeerJS sur le réseau

```bash
npx peer --port 9000 --path /
```

Dans l'application : mode **Local**, adresse `IP_DU_SERVEUR:9000`. `ws://` n'est accepté que vers une adresse privée (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8, `*.local`, IPv6 locales) ; ailleurs, il faut `wss://`. Le pare-feu du serveur doit autoriser le port 9000 en entrée.

## 7. Vérifier rapidement

- Paramètres › Diagnostic des contacts : 🟢 connecté avec latence, 🟠 recherche, 🔴 « réseaux incompatibles (TURN requis) ».
- Paramètres › Relais Internet (TURN) : « Non testé », puis le résultat du test de relais.
- Campagne automatique : `cd tools && node e2e/appareil.e2e.mjs --etapes=relais` (téléphone branché).
