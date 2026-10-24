# Tests sur appareil physique (ADB)

Date : 2026-10-24 · Appareil : Infinix X680 (série `0555711047011843`), Android 10 / API 29, 720×1640, densité 320, WebView 155.0.8059.43
APK testé : `app-debug.apk` (4 208 932 octets, SHA-256 `a06fb391…f385153`)
Réseau pendant les tests : téléphone en 4G (CGNAT, `ccmni1` 10.215.64.104) + partage USB vers le PC (`rndis0` 192.168.42.129 ↔ PC 192.168.42.62).

Statuts : RÉUSSI / ÉCHOUÉ / BLOQUÉ / NON TESTÉ / NON APPLICABLE.

## 1. Installation

| Contrôle | Résultat | Statut |
|---|---|---|
| `adb install -r app-debug.apk` | `Success` | RÉUSSI |
| Paquet présent (`pm list packages`) | `com.anzaimuki.talkiewalkie` | RÉUSSI |
| Démarrage à froid (`am start -W`, TotalTime) | 2 164 ms et 2 195 ms (deux exécutions) | RÉUSSI |

> Note : `connectedDebugAndroidTest` désinstalle l'application à la fin. Il faut la réinstaller avant les campagnes suivantes.

## 2. Tests instrumentés — `./gradlew connectedDebugAndroidTest`

**11/11 RÉUSSI**, en 1 min 18 s.

| Classe | Test | Statut |
|---|---|---|
| CoffreSecretsTest | `allerRetourChiffre`, `ivAleatoire`, `donneesAltereesRejetees`, `chiffreLieASonNom` (AES-256-GCM Keystore, AAD = nom de l'entrée) | RÉUSSI (4) |
| WebViewAppTest | `webViewDebugUniquementEnDebug` | RÉUSSI |
| WebViewAppTest | `pageEmbarqueeEtPontActif` : origine `https://appassets.androidplatform.net`, contexte sécurisé, pont natif, dépendances locales | RÉUSSI |
| WebViewAppTest | `cspBloqueHttpEtScriptsDistants` : `fetch http://` et script CDN refusés | RÉUSSI |
| WebViewAppTest | `navigationExterneRefusee` | RÉUSSI |
| WebViewAppTest | `coffreViaPont` : seul l'emplacement `turn` est accessible | RÉUSSI |
| WebViewAppTest | `microAccordeEtMuetApresCapture` : piste `enabled=false` après `getMic()` (régression P0) | RÉUSSI |
| WebViewAppTest | `cryptoEcdsaP256DisponibleDansLaWebView` | RÉUSSI |

Défaut corrigé dans le test (pas dans l'application) : `evaluateJavascript` renvoie la valeur **encodée en JSON**. Les deux premiers échecs venaient de guillemets échappés. `jsAsync()` décode maintenant la chaîne.

## 3. Campagne E2E téléphone ↔ PC — `tools/e2e/appareil.e2e.mjs`

Le téléphone (APK, piloté par ADB et le protocole DevTools de la WebView) dialogue avec Chrome sur le PC, qui joue le second pair (micro simulé : bip 440 Hz). Résultats bruts : [`tests/appareil-resultats.json`](tests/appareil-resultats.json).

**Bilan : 9 RÉUSSI · 9 BLOQUÉ · 0 ÉCHOUÉ.**

| Étape | Statut | Mesures / remarque |
|---|---|---|
| Installation et premier lancement | RÉUSSI | démarrage à froid ≈ 2,2 s |
| Choix de langue et mode invité | RÉUSSI | |
| Dialogue système de permission micro (tapé via uiautomator) | RÉUSSI | connexion au canal : 5,8 s, permission comprise |
| Micro muet après connexion + service de premier plan + notification | RÉUSSI | pistes `[false]`, `TalkieService isForeground=true` |
| Le PC rejoint le canal, présence | BLOQUÉ | réseau (voir §4) |
| Audio PC → téléphone (PTT) | BLOQUÉ | réseau |
| Audio téléphone → PC (appui réel sur l'écran) | BLOQUÉ | réseau |
| Bouton casque (MediaSession, `KEYCODE_MEDIA_PLAY_PAUSE`) | RÉUSSI, **instable** | réussi 1 fois sur 3 exécutions complètes ; deux échecs « ouvert=false » |
| Appel d'un inconnu refusé sur le téléphone | RÉUSSI | aucun `mediaConn` créé, message « refusé » |
| Réception en arrière-plan (30 s) | BLOQUÉ | réseau ; le service de premier plan reste actif |
| Réception écran éteint (90 s) | BLOQUÉ | réseau |
| Retour au premier plan | RÉUSSI | |
| Coupure des données mobiles et reconnexion | BLOQUÉ | la **reconnexion au serveur de signalisation est atteinte** ; seule la présence du pair (ICE) échoue |
| Relais TURN forcé | BLOQUÉ | aucun TURN fonctionnel configuré (relais public mort) |
| Ressources | RÉUSSI | PSS ≈ 107–140 Mo ; CPU 9–15 % pendant la session |
| Déconnexion : micro et service libérés | RÉUSSI | pistes `ended`, service arrêté |
| Mode Local (serveur PeerJS sur le PC, `ws://` via `adb reverse`) | BLOQUÉ | **signalisation ouverte** (`peer.open`) après correction du NSC ; présence bloquée par le réseau |
| Mode Direct (échange SDP sans serveur) | BLOQUÉ | réseau |

Erreurs JavaScript relevées sur le téléphone : **aucune**.

## 4. Cause des blocages réseau (diagnostic)

Diagnostic par `RTCPeerConnection.getStats()` des deux côtés :

- La WebView ne publie de candidat *host* que sur l'interface 4G (`10.215.64.104`). Android n'expose pas l'interface de partage USB (`rndis0`) aux applications.
- Le PC sort sur Internet **par le partage du téléphone** : les deux pairs ont donc la même IP publique (candidats *srflx* identiques) derrière le CGNAT de l'opérateur, qui ne fait pas de « hairpin ».
- ICE reste en `checking` indéfiniment. Sans relais TURN, il n'existe aucun chemin.

C'est une limite de l'**environnement de test**, pas un défaut de l'application : l'original utilise la même pile WebRTC et serait bloqué de la même façon. Pour lever le blocage, il faut l'une de ces deux options :

1. Mettre le téléphone et le PC sur **le même Wi-Fi**, sans partage USB. Garder le câble pour ADB.
2. Configurer un **TURN** (voir [RESEAU.md](RESEAU.md)).

Puis relancer : `cd tools && node e2e/appareil.e2e.mjs`.

## 4 bis. Appel entre deux téléphones — `tools/e2e/deux-appareils.e2e.mjs`

Infinix X680 (Android, WebView Chrome) et Galaxy S8 SM-G950U1 (Android 9, WebView Chrome 138), APK debug v17 sur les deux, chacun sur les données mobiles d'un opérateur différent. Les résultats sont dans `docs/tests/deux-appareils-resultats.json`.

| Étape | Statut | Détail |
|---|---|---|
| Démarrage des deux applications, accès DevTools | RÉUSSI | |
| Connexion au canal (PeerJS Cloud) sur les deux | RÉUSSI | `peer.open` vrai des deux côtés |
| Présence mutuelle | BLOQUÉ | connexions de données en `checking`/`disconnected`, candidats *host* et *srflx* seulement, aucun *relay* (openrelay hors service) |
| Audio A → B et B → A par appui réel sur l'écran | BLOQUÉ | dépend de la présence |
| Erreurs JS, plantages | RÉUSSI | 0 et 0 |

Cause mesurée : le NAT de l'opérateur de l'Infinix est symétrique (voir [RESEAU.md](RESEAU.md) §2). Il faut un relais TURN. Le mode Cloudflare a été ajouté à `serveur-turn` (§4 bis de RESEAU.md) ; le test sera à relancer une fois le service déployé.

## 5. Défauts trouvés et corrigés pendant la campagne

| Défaut | Où | Correction |
|---|---|---|
| **Mode Local cassé dans l'APK** : `ws://` refusé par la WebView (`net::ERR_CLEARTEXT_NOT_PERMITTED`), car le NSC interdisait tout trafic en clair | `res/xml/network_security_config.xml` | `cleartextTrafficPermitted="true"`, avec les verrous CSP, filtre JS et `Politique` (voir [04-SECURITE.md](04-SECURITE.md)). Vérifié sur l'appareil : la signalisation s'ouvre. |
| `waitForFunction` de Playwright passe par `eval`, refusé par le CSP de l'APK (pas de `bypassCSP` via CDP) | outil E2E | attente par boucle de `page.evaluate` (CDP `Runtime.evaluate`) ; le CSP de l'APK n'est pas modifié |
| Pseudo de test « pc » (2 caractères) refusé par l'application (3 minimum) | outil E2E | pseudo « ordi » |
| Chemin du serveur PeerJS local erroné | outil E2E | `peer/dist/bin/peerjs.js` |
| Course de timing sur la capture du splash | outil visuel | voir [02-FIDELITE-VISUELLE.md](02-FIDELITE-VISUELLE.md) |
| Double encodage JSON dans `jsAsync` | test instrumenté | voir §2 |

## 6. Non vérifié sur appareil

| Point | Statut |
|---|---|
| Son réel entre deux pairs (tous modes) | BLOQUÉ (réseau) : téléphone ↔ PC (§4) et téléphone ↔ téléphone entre deux opérateurs (§4 bis) ; il faut un relais TURN déployé |
| Limitation des minuteurs en arrière-plan / Doze avec un pair réel | BLOQUÉ (réseau) |
| Routage audio haut-parleur / écouteur | NON TESTÉ (nécessite un son reçu) |
| Connexion Google (Credential Manager → Firebase) | BLOQUÉ : `tw.googleWebClientId` absent, empreinte SHA-1 non enregistrée dans Firebase |
| Scan de QR code avec la caméra | NON TESTÉ |
| Autres versions d'Android / de WebView | NON TESTÉ |
