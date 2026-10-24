# Cryptographie à courbes elliptiques (ECC)

Date : 2026-10-24

## 1. Où l'ECC intervient

| Usage | Courbe / algorithme | Implémentation | Contrôle du projet |
|---|---|---|---|
| Codes « Mode Pro » | ECDSA P-256 / SHA-256, signature brute r‖s (64 octets) | WebCrypto (`crypto.subtle.importKey` `raw` + `verify`) | oui |
| Échange de clés TLS (PeerJS, Firebase, GitHub Pages, Metered) | X25519MLKEM768 (hybride post-quantique) ; X25519 pour Metered | pile TLS de la WebView | non (serveurs) |
| Certificats serveurs | ECDSA P-256 (peerjs, googleapis) ; RSA-PSS ailleurs | autorités système | non |
| DTLS de WebRTC | ECDSA P-256 (certificat auto-généré par pair) + ECDHE | Chromium | non |
| Coffre Android | — (AES-256-GCM symétrique, pas d'ECC) | Android Keystore | oui |

Aucune primitive n'est implémentée à la main : signature et vérification passent par WebCrypto, TLS et DTLS par la pile de la plateforme.

## 2. Vérification des codes Pro

Format du code : `base64url(charge utile JSON ‖ signature r‖s)`, vérifié **localement** avec la clé publique `PRO_PUBKEY`, un point P-256 non compressé de 65 octets. La charge utile porte le type, la version, la date d'expiration et la liaison à l'appareil (ou à l'adresse Gmail normalisée).

État actuel : `PRO_PUBKEY` est **vide**, dans l'original comme dans l'APK. Le Mode Pro est donc inactif. Le verrou ne retire plus le relais TURN à tout le monde (`PRO_EXIGE = PRO_ACTIF && !!PRO_PUBKEY`) et le bouton « Mode Pro » est masqué. Pour l'activer, il faut générer une paire de clés hors de l'application, garder la clé privée hors du dépôt et renseigner la clé publique.

## 3. Tests — `tools/tests/ecc-pro.test.mjs` : 11/11 RÉUSSI

Les tests exécutent le **code réellement embarqué** (extrait de `web/index.html`), avec de vraies clés P-256 générées par WebCrypto (Node).

| Test | Statut |
|---|---|
| La clé publique attendue est un point P-256 non compressé de 65 octets | RÉUSSI |
| Un code valide signé par la bonne clé est accepté | RÉUSSI |
| Toute modification de la charge utile invalide la signature | RÉUSSI |
| Signature altérée, tronquée ou nulle rejetée | RÉUSSI |
| Un code signé par une autre clé est rejeté | RÉUSSI |
| Clé publique invalide (point hors courbe, longueur fausse) refusée | RÉUSSI |
| Expiration, version, type et liaison à l'appareil vérifiés | RÉUSSI |
| Code lié à l'adresse Gmail normalisée | RÉUSSI |
| Données malformées rejetées sans exception | RÉUSSI |
| Constat : malléabilité ECDSA, la signature (r, n−s) est aussi acceptée | RÉUSSI (comportement documenté) |
| Sans clé publique configurée, le verrou Pro ne bloque plus le relais | RÉUSSI |

Sur le téléphone, le test instrumenté `cryptoEcdsaP256DisponibleDansLaWebView` confirme que la WebView 155 génère, signe et vérifie en ECDSA P-256 : RÉUSSI.

## 4. Constats

1. **Malléabilité ECDSA** : pour toute signature valide (r, s), (r, n−s) est aussi valide. WebCrypto n'impose pas la forme « low-S ». **Impact faible** : on ne peut pas forger de nouveau code, et la charge utile (droits, appareil, expiration) reste identique et signée. Le risque n'existerait que si un code était un jour identifié par sa signature (liste de révocation, usage unique). Il faudrait alors identifier le code par un hachage de la **charge utile** ou exiger s ≤ n/2.
2. **Codes administrateur non liés à un appareil** : choix de conception de l'original, conservé. Une fuite d'un tel code vaut pour tous les appareils jusqu'à son expiration.
3. **Pas de révocation** : la vérification est hors ligne. Un code compromis reste valide jusqu'à sa date d'expiration. Il faut donc des expirations courtes.
4. **Rotation de clé** : changer `PRO_PUBKEY` invalide tous les codes émis. Il faut prévoir une liste de clés publiques si une rotation sans coupure est nécessaire.

## 5. Ce qui n'est pas testé

- Négociation ECDHE et certificats DTLS entre le téléphone et le PC : NON TESTÉ (audio bloqué par le réseau, voir [03-TESTS-ADB.md](03-TESTS-ADB.md)).
- Codes Pro de production : NON APPLICABLE (aucune clé configurée).
