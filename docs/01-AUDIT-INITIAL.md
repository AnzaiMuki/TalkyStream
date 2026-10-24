# Audit initial — `talkie-walkie-final3.html` (v16)

Date : 2026-10-24 · Fichier lu intégralement (3 131 lignes, 160 576 octets) · Aucune modification avant cet audit.

## 1. Environnement

| Élément | Constat |
|---|---|
| Projet | Dépôt git `AnzaiMuki/TalkyStream`, un seul fichier HTML (index.html supprimé du working tree, final3 non suivi). Publié sur `https://anzaimuki.github.io/TalkyStream/` (HTTP 200). |
| JDK | Pas de `java` dans le PATH ; JBR 21.0.10 d'Android Studio disponible. |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk` : platforms 30→37, build-tools 34→37, Gradle 8.11.1 en cache. |
| ADB | Infinix X680 (`0555711047011843`), Android 10 / API 29, 720×1640, densité 320 (2.0), WebView 155.0.8059.43. Un émulateur `emulator-5562` hors ligne est aussi listé → toutes les commandes ciblent le numéro de série du téléphone. |
| Réseau | Téléphone en 4G LTE (CGNAT 10.215.x) + partage USB vers le PC (PC 192.168.42.222, tél. 192.168.42.129). |
| Outils PC | Node 24, Chrome stable, navigateurs Playwright installés, Python 3.14. |

## 2. Fonctionnalités détectées (état réel dans le code)

| # | Fonction | État |
|---|---|---|
| 1 | Splash 2 s | Implémentée |
| 2 | Pseudo + code canal | Implémentée (ID PeerJS = `canal-pseudo`) |
| 3 | Code aléatoire / favoris | Implémentée (4 chiffres via `Math.random`) |
| 4 | Modes Internet / Local / Direct | Internet : PeerJS Cloud `0.peerjs.com`. Local : serveur PeerJS en `ws://` (non chiffré). Direct : échange SDP par QR/texte, sans STUN |
| 5–7 | Audio temps réel, PTT, diffusion | Implémentés (PeerJS MediaConnection, piste activée/désactivée) |
| 8 | Contacts, présence, ping | Implémentés (DataConnection + ping/pong 8 s) |
| 9 | Appels 1-à-1 | Implémentés (demande → acceptation → `peer.call`) |
| 10 | Chat | Implémenté (DataConnection), badge in-app uniquement |
| 11 | Google / invité | Firebase Auth `signInWithPopup` ; invité local |
| 12 | Pseudos / données locales | `localStorage` |
| 13 | Partage lien + QR, scan QR | qrcode-generator, BarcodeDetector ou jsQR |
| 14–16 | Paramètres, thèmes, FR/EN | Implémentés (traduction par MutationObserver) |
| 17 | VU-mètres, réécoute | Implémentés (AnalyserNode, MediaRecorder) |
| 18 | RNNoise | Chargé dynamiquement depuis jsDelivr (WASM + AudioWorklet), repli micro brut |
| 19 | Casque / touches | MediaSession + son quasi silencieux en boucle ; touche clavier assignable |
| 20 | TURN, diagnostic, version | Implémentés ; TURN codé en dur |
| 21 | Mises à jour | Relit sa propre URL et compare `APP_VERSION` |
| 22 | Arrière-plan | « Silent audio trick » + Wake Lock écran dès le démarrage |
| — | Mode Pro | Codes signés ECDSA P-256 vérifiés via WebCrypto (non mentionné dans l'inventaire initial) |

## 3. Défauts confirmés par inspection du code

| Gravité | Défaut | Preuve |
|---|---|---|
| **P0** | Micro « chaud » dès la connexion : `getMic()` met `track.enabled = true` et rien ne coupe la piste avant le premier relâchement du PTT. | L.1678 |
| **P0** | Tout pair qui connaît `canal-pseudo` peut appeler et l'appel est **décroché automatiquement** avec le flux micro (`peer.on('call') → call.answer(localStream)`), sans vérifier qu'il s'agit d'un contact. Combiné au point précédent : écoute à distance. | L.1774-1785 |
| **P0** | Identifiants TURN permanents codés en dur (ExpressTURN + Metered) et **publiés** sur GitHub Pages. | L.1243-1246 ; `curl` de la page publiée |
| **P1** | `PRO_ACTIF = true` avec `PRO_PUBKEY = ''` : aucun code Pro ne peut être validé → le relais TURN est retiré pour **tous** → le mode Internet ne fonctionne pas entre réseaux différents. | L.1261-1262, 1312, 1373-1378 |
| **P1** | Le micro n'est jamais libéré à la déconnexion (pistes non arrêtées, RNNoise/AudioContext conservés). | `deconnecter()` L.1168 |
| **P1** | `connecter()` ne détruit pas un `peer` existant : double appui sur OK → deux pairs, connexions dupliquées. | L.1715 |
| **P1** | Reconnexion serveur : une seule tentative après 2 s, puis plus rien. Pas de relance des flux audio après coupure réseau. | L.1787-1791 |
| **P1** | Google `signInWithPopup` : bloqué par Google dans une WebView (`disallowed_useragent`). | L.969 |
| **P1** | Mode Local en `ws://` depuis une page HTTPS : contenu mixte bloqué. | L.1742 |
| **P2** | Injection HTML : noms de contacts insérés via `innerHTML` et `onclick="...('${c}')"` (un `'` casse l'UI, `<img onerror>` s'exécute). | L.1978-1984, 1991, 1842-1846 |
| **P2** | Annonce distante (`ANNONCE`) injectée via `innerHTML`. | L.3064 |
| **P2** | Lien d'invitation basé sur `location.href` (inutilisable s'il n'est pas hébergé). | L.1096 |
| **P2** | « Supprimer données locales » laisse favoris, config TURN, clé API. | L.1056-1057 |
| **P2** | Audio silencieux en boucle + Wake Lock écran **dès le démarrage**, même déconnecté (batterie). | L.3031-3033 |
| **P2** | Code canal de 4 chiffres (10⁴ combinaisons, `Math.random`). | L.1092 |
| **P3** | `changerMode()` utilise la variable globale implicite `event`. | L.821 |
| **P3** | `surveillerVoix` crée une source audio à chaque flux sans la déconnecter. | L.2593 |

## 4. Risques à vérifier

Comportement WebView : `navigator.share`, `speechSynthesis` (absent dans WebView), `navigator.onLine`, autoplay, AudioWorklet/WASM, permissions micro/caméra, dialogues `alert/confirm`, `env(safe-area-inset-*)`, mise en veille des timers en arrière-plan, mode Doze.

## 5. Dépendances externes

PeerJS 1.5.2, qrcode-generator 1.4.4, jsQR 1.4.0, Firebase compat 10.12.2, @sapphi-red/web-noise-suppressor 0.4.1, Google Fonts Barlow / Barlow Condensed — toutes chargées depuis des CDN au runtime. Services : PeerJS Cloud, STUN Google/Cloudflare, TURN openrelay / ExpressTURN / Metered, Firebase Auth (`talkie-walkie-b0f2d`).

## 6. Architecture recommandée

**Option A — WebView contrôlée**. Elle conserve à l'identique le DOM, le CSS, les animations et toute la logique WebRTC (la pile WebRTC de Chromium est celle que le HTML utilise déjà). Une réécriture native imposerait de réimplémenter PeerJS, Opus/SDP, RNNoise et les ~70 règles CSS du thème, avec un risque élevé d'écarts. L'intégration Android ajoute ce que le web ne sait pas faire : service de premier plan micro, MediaSession native, permissions, Google via Credential Manager, TTS, partage, stockage chiffré des secrets TURN.

## 7. Tests prévus

Tests unitaires Node sur le code JS réellement embarqué (extraction depuis le HTML), tests ECC (ECDSA P-256), tests Android (instrumentés + JVM), tests E2E téléphone ↔ Chrome PC via PeerJS Cloud, serveur PeerJS local et mode Direct, pilotés par ADB et le protocole DevTools de la WebView. Captures comparées par pixel (Chrome émulé 360×820 @2x vs captures ADB).
