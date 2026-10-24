# Dépendances

Date : 2026-10-24

## 1. Bibliothèques web embarquées dans l'APK

L'original chargeait tout depuis des CDN au moment de l'exécution. Désormais, tout est copié dans `web/vendor/` par [`tools/vendor.mjs`](../tools/vendor.mjs) depuis des paquets npm **à version figée**, avec leur SHA-256 dans [`web/vendor/MANIFEST.json`](../web/vendor/MANIFEST.json). Aucune ressource exécutable ne vient d'un CDN : c'est vérifié par un test Node et, sur le téléphone, par `cspBloqueHttpEtScriptsDistants`.

| Paquet | Original | Embarqué | Fichiers | Rôle |
|---|---|---|---|---|
| peerjs | 1.5.2 (CDN) | **1.5.5** | `peerjs.min.js` | signalisation et WebRTC |
| qrcode-generator | 1.4.4 (CDN) | 1.4.4 | `qrcode.js` | génération de QR code |
| jsqr | 1.4.0 (CDN) | 1.4.0 | `jsQR.js` | lecture de QR code |
| firebase (compat) | 10.12.2 (CDN) | 10.12.2 | `firebase-app-compat.js`, `firebase-auth-compat.js` | connexion Google |
| @sapphi-red/web-noise-suppressor | 0.4.1 (jsDelivr, dynamique) | 0.4.1 | `noise/index.js`, `workletProcessor.js`, `rnnoise.wasm`, `rnnoise_simd.wasm` | réduction de bruit RNNoise |
| @fontsource/barlow, barlow-condensed | Google Fonts | 5.1.0 | 5 fichiers `woff2` | polices (même rendu, voir fidélité visuelle) |

**Vulnérabilités** : `npm audit` signale des alertes `undici` et `grpc` dans l'arbre de dépendances **Node** de `firebase`. Ces modules ne sont **pas** présents dans les bundles navigateur `*-compat.js` embarqués, et ne s'exécutent donc jamais dans l'APK.

Installation des outils : `cd tools && npm install --ignore-scripts`. Sans `--ignore-scripts`, un script post-installation échoue sous Windows (« spawn cmd ENOENT »).

## 2. Android

| Élément | Version |
|---|---|
| Gradle (wrapper) | 9.1.0 |
| Android Gradle Plugin | 8.13.1 |
| Java | 17 (JBR d'Android Studio) |
| compileSdk / targetSdk / minSdk | 36 / 36 / 26 |

| Dépendance | Version utilisée | Plus récente signalée par lint | Rôle |
|---|---|---|---|
| androidx.core:core | 1.15.0 | 1.19.1 | compatibilité |
| androidx.activity:activity | 1.9.3 | 1.13.0 | bord à bord, retour |
| androidx.webkit:webkit | 1.12.1 | 1.18.0 | `WebViewAssetLoader`, `addWebMessageListener` |
| androidx.credentials:credentials (+ play-services-auth) | 1.3.0 | 1.6.0 | connexion Google |
| com.google.android.libraries.identity.googleid:googleid | 1.1.1 | 1.2.1 | jeton Google |
| junit:junit (tests JVM) | 4.13.2 | — | tests |
| androidx.test.ext:junit / runner / rules | 1.2.1 / 1.6.2 / 1.6.1 | 1.3.0 / 1.7.0 / 1.7.0 | tests instrumentés |

Aucune dépendance native (`.so`) n'est ajoutée par le projet : WebRTC, Opus et le moteur de rendu sont ceux de la WebView système, mise à jour par le Play Store.

Les mises à jour proposées par lint n'ont pas été appliquées pendant la campagne de tests : toute montée de version devra être suivie d'un nouveau passage des tests instrumentés sur l'appareil. Statut : NON TESTÉ.

## 3. Outils de test (PC uniquement, jamais dans l'APK)

| Paquet | Version | Usage |
|---|---|---|
| peer | 1.0.2 | serveur PeerJS local (mode Local) |
| playwright-core | 1.49.1 | pilotage de Chrome et de la WebView (CDP) |
| pngjs / pixelmatch | 7.0.0 / 6.0.0 | comparaison visuelle |

## 4. Services externes

| Service | Usage | Remarque |
|---|---|---|
| PeerJS Cloud `0.peerjs.com` | signalisation du mode Internet | sans authentification des identifiants (voir sécurité) |
| STUN Google / Cloudflare | découverte d'adresse publique | |
| TURN | relais entre réseaux incompatibles | le relais public openrelay est **mort** ; il faut `serveur-turn` ou un TURN perso (voir [RESEAU.md](RESEAU.md)) |
| Firebase Auth (`talkie-walkie-b0f2d`) | connexion Google | configuration incomplète (voir [INSTALLATION.md](INSTALLATION.md)) |
| GitHub (`releases/latest`) | page de mise à jour | ouverte dans le navigateur |
