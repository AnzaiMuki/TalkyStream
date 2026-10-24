# Rapport final — Talkie-walkie v17 pour Android

Date : 2026-10-24 · Dépôt `AnzaiMuki/TalkyStream`, branche `main`
Source : `talkie-walkie-final3.html` (v16), **non modifié** : SHA-256 `681b007f79e74f19c633743e69bdb6c9ea60827b066f60f952d5cad18fec3e39`, conforme à [`reference-sha256.txt`](reference-sha256.txt).
Statuts : RÉUSSI / ÉCHOUÉ / BLOQUÉ / NON TESTÉ / NON APPLICABLE.

## A. Synthèse

L'application est une **WebView contrôlée** qui affiche `web/index.html` (v17), copie corrigée de l'original et source unique de l'interface. Ce choix conserve le DOM, le CSS et la pile WebRTC d'origine. La couche Android ajoute un service de premier plan pour le micro, MediaSession, la connexion Google native, le partage natif et un coffre Keystore pour les secrets TURN ([01-AUDIT-INITIAL.md](01-AUDIT-INITIAL.md) §6).

| Objectif | Résultat |
|---|---|
| Fidélité | 12 états sur 15 identiques au pixel près ; les 3 autres ne diffèrent que par des changements voulus |
| Robustesse | 3 défauts P0 et 6 P1 de l'original corrigés ; aucune erreur JavaScript sur le téléphone ; 0 ÉCHOUÉ dans toutes les campagnes |
| Sécurité | micro muet hors PTT, appels d'inconnus refusés, aucun secret dans les APK, CSP stricte, pont natif restreint |
| Limite principale | son de bout en bout **non vérifié** sur le téléphone : réseau de test sans chemin ICE et pas de TURN fonctionnel (§D) |

## B. Livrables

| Livrable | Fichier | Taille | SHA-256 | Statut |
|---|---|---|---|---|
| APK debug | `android/app/build/outputs/apk/debug/app-debug.apk` | 4 186 815 octets | `dd1f708edf6e779bee3b7809ccb6795c42033671e07f94fcde125156cf1d288c` | RÉUSSI (installation) ; démarrage sur l'appareil BLOQUÉ (téléphone passé hors ligne) |
| APK release | `android/app/build/outputs/apk/release/app-release-unsigned.apk` | 1 033 297 octets | `bf9428a49a72b22911cb3f56c17b7f9975d14f916b286bcf5a29e351e17dfcd0` | RÉUSSI, **non signé** ; identique octet pour octet au build précédent |
| APK release signé | — | — | — | NON APPLICABLE : aucune clé disponible ; procédure dans [INSTALLATION.md](INSTALLATION.md) §5 |
| Tests ADB sur l'appareil | [03-TESTS-ADB.md](03-TESTS-ADB.md), [`tests/appareil-resultats.json`](tests/appareil-resultats.json) | | | RÉUSSI (avec étapes BLOQUÉ, §D) |
| Rapports | 01 à 07, [RESEAU.md](RESEAU.md), [INSTALLATION.md](INSTALLATION.md), ce document | | | RÉUSSI |

Les 4 valeurs TURN de l'original sont absentes des deux APK (recherche : 0 occurrence).

Les deux APK livrés ont été recompilés à partir de zéro (`clean`) depuis le commit `5d9c29f`, puis contrôlés : Node 24/24, JVM 5/5, `versionCode` 17, aucune valeur TURN dans le contenu décompressé, aucun script CDN dans `assets/index.html`. Le seul script CDN se trouve dans `assets/reference/`, la copie masquée de l'original, présente dans l'APK debug uniquement. L'APK release est identique à celui de la campagne. L'APK debug diffère de celui testé dans [03-TESTS-ADB.md](03-TESTS-ADB.md) (`a06fb391…f385153`, 4 208 932 octets), parce qu'un build debug n'est pas reproductible après `clean`. Le nouvel APK debug s'installe sur le téléphone, mais son démarrage n'a pas pu être vérifié : le téléphone est passé hors ligne.

## C. Fidélité visuelle — [02-FIDELITE-VISUELLE.md](02-FIDELITE-VISUELLE.md)

L'original et l'APK sont rendus par la **même WebView, sur le téléphone** (Infinix X680, 720×1640, densité 2), puis comparés au pixel (`pixelmatch`) et par géométrie (15 éléments clés, tolérance 1 px).

| Résultat | États | Statut |
|---|---|---|
| Identiques (0 % de pixels différents) | 01–06, 09–13, 15 | RÉUSSI |
| 07, 14 — Paramètres | « Mon plan » et « Mode Pro » masqués (pas de clé Pro) ; version v16 → v17 | RÉUSSI, écart voulu |
| 08 — Partage QR | bouton « 📤 Partager » natif ajouté | RÉUSSI, écart voulu |
| Autres tailles et densités d'écran | — | NON TESTÉ |

## D. Tests — [03-TESTS-ADB.md](03-TESTS-ADB.md)

| Campagne | Résultat | Statut |
|---|---|---|
| Tests Node (code embarqué, ECC, validation, `serveur-turn`) | 24/24 | RÉUSSI |
| E2E web (deux Chrome via PeerJS Cloud) | 7/7 | RÉUSSI |
| Tests JVM `PolitiqueTest` | 5/5 | RÉUSSI |
| `lintDebug` | 0 erreur, 11 avertissements | RÉUSSI |
| `assembleDebug`, `assembleRelease` | OK | RÉUSSI |
| Tests instrumentés `connectedDebugAndroidTest` (téléphone) | 11/11 | RÉUSSI |
| Campagne E2E téléphone ↔ PC | 9 RÉUSSI · 9 BLOQUÉ · 0 ÉCHOUÉ | voir ci-dessous |

Vérifié sur le téléphone : installation, démarrage à froid ≈ 2,2 s, permission micro, micro muet après connexion, service de premier plan, refus d'un appel inconnu, retour au premier plan, ressources (PSS 107–140 Mo, CPU 9–15 %), libération du micro et du service à la déconnexion. La reconnexion à la signalisation après coupure des données est atteinte, et le mode Local ouvre sa signalisation (`peer.open`).

**Instable** : bouton casque (MediaSession), réussi 1 fois sur 3.

**BLOQUÉ (9 étapes)** : présence du pair, audio dans les deux sens, arrière-plan, écran éteint, reconnexion complète, relais TURN, modes Local et Direct. Cause diagnostiquée avec `getStats()` : le PC sort par le partage USB du téléphone, donc les deux pairs ont la même IP publique derrière le CGNAT, sans hairpin. La WebView ne publie aucun candidat sur `rndis0`, et ICE reste en `checking`. C'est une limite de l'environnement, pas de l'application. Pour lever le blocage : téléphone et PC sur le même Wi-Fi, ou un TURN configuré.

**NON TESTÉ** : routage haut-parleur/écouteur, scan de QR code par la caméra, autres versions d'Android et de WebView. **BLOQUÉ** : connexion Google (configuration Firebase manquante).

## E. Sécurité et ECC — [04-SECURITE.md](04-SECURITE.md), [05-ECC.md](05-ECC.md)

| Point | Traitement | Statut |
|---|---|---|
| P0 micro ouvert dès la connexion | muet hors PTT, y compris en appel 1-à-1 | CORRIGÉ, vérifié sur l'appareil |
| P0 appels décrochés automatiquement (écoute à distance) | contacts ou appel accepté uniquement ; identité tirée de l'ID PeerJS | CORRIGÉ, vérifié sur l'appareil |
| P0 identifiants TURN publiés | retirés ; identifiants temporaires via `serveur-turn` ou TURN perso chiffré (AES-256-GCM, Keystore) | CORRIGÉ dans l'APK ; **toujours en ligne sur GitHub Pages** |
| WebView | origine unique `appassets.androidplatform.net`, navigation externe refusée, pas d'accès fichiers, DevTools en debug seulement | RÉUSSI (tests instrumentés) |
| Pont natif | origine et cadre principal uniquement, liste blanche, coffre limité à `turn` | RÉUSSI (test instrumenté) |
| Trafic en clair | autorisé dans le NSC pour le mode Local (décision validée), limité à `ws://` vers des adresses privées par trois verrous : CSP sans `http:`, `analyserServeurLocal()`, `Politique` | RÉUSSI ; risque résiduel faible |
| TLS des services | TLS 1.3, X25519MLKEM768 en majorité | RÉUSSI |
| DTLS-SRTP téléphone ↔ PC | — | NON TESTÉ (réseau) |
| ECDSA P-256 (codes Pro) | WebCrypto, 11/11 tests ; vérifié dans la WebView 155 | RÉUSSI ; Pro inactif (`PRO_PUBKEY` vide) |
| Malléabilité ECDSA (r, n−s) | documentée, impact faible | ACCEPTÉ |

Limites d'architecture : PeerJS Cloud n'authentifie pas les identifiants, et il n'existe pas de vérification des empreintes DTLS hors bande.

## F. Dépendances et réseau — [06-DEPENDANCES.md](06-DEPENDANCES.md), [RESEAU.md](RESEAU.md)

- Toutes les bibliothèques web sont **embarquées**, à version figée, avec leur SHA-256 dans `web/vendor/MANIFEST.json` : PeerJS 1.5.5, qrcode-generator 1.4.4, jsQR 1.4.0, Firebase compat 10.12.2, RNNoise 0.4.1, polices Barlow 5.1.0. Aucun script ne vient d'un CDN (test Node et test instrumenté).
- Les alertes `npm audit` (`undici`, `grpc`) concernent l'arbre Node de Firebase, absent des bundles navigateur embarqués.
- Android : AGP 8.13.1, Gradle 9.1.0, Java 17, SDK 36/36/26. 9 dépendances ont une version mineure plus récente (lint), non appliquée : toute mise à jour devra être suivie d'un nouveau passage des tests sur l'appareil.
- Réseau : trois modes (Internet via PeerJS Cloud, Local via un serveur PeerJS en `ws://` privé, Direct par QR). Le relais public openrelay est **mort** : sans TURN, le mode Internet échoue entre réseaux incompatibles (CGNAT). Option recommandée : déployer `serveur-turn` (identifiants temporaires), puis renseigner `tw.turnServiceUrl`.

## G. Risques restants et actions requises — [07-DEFAUTS-ET-RISQUES.md](07-DEFAUTS-ET-RISQUES.md)

**Actions de ta part :**

1. **Révoquer ou changer les identifiants ExpressTURN et Metered**, toujours publiés sur `https://anzaimuki.github.io/TalkyStream/`, puis publier la v17. Gravité élevée.
2. **Configurer un TURN** (`serveur-turn` ou TURN personnel) : sans lui, le mode Internet entre réseaux mobiles ne fonctionne pas.
3. **Connexion Google** : enregistrer le SHA-1 dans Firebase et renseigner `tw.googleWebClientId` ([INSTALLATION.md](INSTALLATION.md) §6).
4. **Signer la release** avec une clé de production gardée hors du dépôt ([INSTALLATION.md](INSTALLATION.md) §5).

**À vérifier ensuite :**

| Risque | Gravité | Prochaine étape |
|---|---|---|
| Audio, arrière-plan, écran éteint, modes Local et Direct non vérifiés de bout en bout | Moyenne | relancer `node e2e/appareil.e2e.mjs` avec le téléphone et le PC sur un même Wi-Fi |
| Bouton casque instable (1/3) | Moyenne | investiguer la prise de focus MediaSession ; relancer `--etapes=bouton` dans un état propre |
| Doze / minuteurs en arrière-plan avec un pair réel | Moyenne | même campagne Wi-Fi |
| Un seul appareil testé (Android 10) | Moyenne | tester Android 13+ (notifications, service de type micro) |
| Routage haut-parleur, scan QR caméra | Faible | tests manuels |
| PeerJS Cloud sans authentification, pas de vérification DTLS hors bande | Moyenne | limite d'architecture |
| Signalisation Local en clair sur le LAN | Faible | limitée aux adresses privées ; audio chiffré |
| Dépendances Android en retard de versions mineures | Faible | mettre à jour, puis relancer les tests instrumentés |
