# Sécurité

Date : 2026-10-24 · Périmètre : `web/index.html` (v17), application Android `com.anzaimuki.talkiewalkie`, `serveur-turn/`.
Principe : aucune cryptographie maison, aucun secret dans le code, l'APK ou les journaux.

## 1. Défauts de sécurité de l'original et traitement

| Gravité | Défaut de l'original | Correction | Vérification |
|---|---|---|---|
| P0 | Micro « chaud » dès la connexion (`track.enabled = true`) | pistes `enabled=false` après `getMic()` ; le micro ne s'ouvre que pendant le PTT, y compris pendant un appel 1-à-1 | test Node, E2E web (micro muet avant PTT), test instrumenté sur le téléphone, E2E appareil |
| P0 | Tout pair connaissant `canal-pseudo` est **décroché automatiquement** avec le flux micro : écoute à distance | `peer.on('call')` n'accepte que les contacts ou un appel accepté ; l'identité vient de l'ID PeerJS (`nomDePeer(conn.peer)`), jamais du champ `de` falsifiable | E2E web « un pair inconnu ne peut ni écouter ni usurper un nom » ; E2E appareil « appel inconnu refusé » ; reproduction sur l'original : `tools/e2e/original-defauts.e2e.test.mjs` |
| P0 | Identifiants TURN permanents codés en dur et publiés | supprimés ; identifiants temporaires via `serveur-turn` ou relais perso stocké chiffré (Keystore) | test Node « aucun identifiant TURN permanent » ; recherche des 4 valeurs dans les APK debug et release : 0 occurrence |
| P2 | Injection HTML (noms de contacts, modale d'appel, diagnostic, annonce distante) | `esc()` partout, `textContent` pour l'annonce, `ajouterContact` nettoie et valide | E2E web « nom malveillant affiché comme du texte » |
| P2 | Code canal de 4 chiffres issu de `Math.random` | 6 caractères sans ambiguïté via `crypto.getRandomValues` | E2E web |
| P2 | « Supprimer données locales » incomplet | efface contacts, favoris, TURN et annonce | revue de code |

> **Action requise de ta part** : les identifiants ExpressTURN et Metered de l'original sont **toujours publiés** sur `https://anzaimuki.github.io/TalkyStream/`. Il faut les révoquer ou les changer dans les deux tableaux de bord, puis publier la version corrigée. Tant que ce n'est pas fait, n'importe qui peut consommer ton quota de relais.

## 2. Durcissement de l'application Android

**WebView**
- Pages chargées uniquement depuis `https://appassets.androidplatform.net/assets/` (WebViewAssetLoader). Toute autre navigation est refusée (`Politique.estPageApp`). Les liens externes autorisés (HTTPS uniquement) s'ouvrent dans le navigateur.
- `setAllowFileAccess(false)`, `setAllowContentAccess(false)`, géolocalisation désactivée, Safe Browsing activé.
- Débogage DevTools seulement en debug (`setWebContentsDebuggingEnabled(BuildConfig.DEBUG)`). En release, la console n'est pas recopiée dans logcat.
- Liens d'invitation : seuls les paramètres `canal`, `ip` et `code` sont repris, après validation par expression régulière.

**Pont natif**
- `addWebMessageListener` restreint à l'origine `https://appassets.androidplatform.net` **et** au cadre principal. L'iframe Firebase ne peut donc pas l'appeler.
- Liste blanche de commandes. `secretGet`/`secretSet` sont limitées à l'emplacement `turn`, ce que vérifie un test instrumenté.

**Secrets**
- `CoffreSecrets` : AES-256-GCM avec une clé non exportable du Android Keystore, IV aléatoire, AAD = nom de l'entrée. Testé sur l'appareil : 4/4.

**Manifeste**
- `allowBackup=false` et règles d'extraction excluant tout.
- Service `exported=false`, de type `microphone`, actif uniquement pendant une session.
- Permissions limitées à l'usage : micro, caméra pour le QR uniquement, notifications, service de premier plan, réseau.

**CSP de la page**
- `default-src 'self'`, scripts, polices et images en `'self'` (plus `data:`/`blob:` pour les images).
- `connect-src 'self' https: wss: ws:`, sans `http:`.
- `frame-src` limité au domaine Firebase du projet, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.

**Dépendances**
- Toutes embarquées : aucun script chargé depuis un CDN (test Node), avec leurs SHA-256 dans `web/vendor/MANIFEST.json`.

## 3. Trafic en clair : décision assumée (mode Local)

Le mode Local se connecte en `ws://` à un serveur PeerJS du réseau privé, comme dans l'original. Sur le téléphone, la WebView refusait cette connexion (`net::ERR_CLEARTEXT_NOT_PERMITTED`) tant que le network security config interdisait le clair. Le NSC ne sait pas exprimer des plages d'adresses IP privées : il est donc passé à `cleartextTrafficPermitted="true"` (décision validée par l'utilisateur le 2026-10-24). Trois verrous indépendants limitent la surface en clair à `ws://` vers une adresse privée :

1. **CSP** : `connect-src` n'autorise pas `http:`. Testé sur l'appareil : `fetch('http://…')` est refusé. Scripts, polices et images restent en `'self'`.
2. **`analyserServeurLocal()`** : `ws://` n'est accepté que vers 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8, `localhost`, `*.local`, fd00::/8 et fe80::/10. Toute autre adresse exige `wss://`. Couvert par un test Node.
3. **`Politique`** : aucune navigation hors de l'origine embarquée.

Les autorités de certification restent celles du système uniquement : les certificats ajoutés par l'utilisateur ne sont pas acceptés. L'avertissement lint `InsecureBaseConfiguration` est marqué comme assumé (`tools:ignore`), avec cette justification en commentaire dans le fichier.

Risque résiduel : sur un réseau local hostile, le trafic de **signalisation** du mode Local est lisible et modifiable. L'audio reste chiffré par DTLS-SRTP, mais un attaquant qui contrôle la signalisation peut s'interposer (voir §5).

## 4. Transport vers les services externes

Inspection `openssl s_client` (session précédente, 2026-10-24) :

| Service | TLS | Échange de clés | Certificat |
|---|---|---|---|
| 0.peerjs.com | 1.3 | X25519MLKEM768 | ECDSA P-256 |
| googleapis (Firebase Auth) | 1.3 | X25519MLKEM768 | ECDSA P-256 |
| talkie-walkie-b0f2d.firebaseapp.com | 1.3 | X25519MLKEM768 | RSA-PSS |
| anzaimuki.github.io | 1.3 | X25519MLKEM768 | RSA-PSS |
| metered | 1.3 | X25519 | RSA-PSS |

Remarque : 0.peerjs.com accepte aussi la suite héritée ECDHE-RSA-AES128-SHA en TLS 1.2. Ce réglage est côté serveur, hors de notre contrôle. La WebView négocie TLS 1.3.

Audio : WebRTC impose DTLS-SRTP (pas de mode non chiffré). Les suites réellement négociées (`dtlsCipher`, `srtpCipher`) sont relevées par l'étape audio de la campagne appareil, qui est BLOQUÉE par le réseau : elles restent NON TESTÉES.

## 5. Limites résiduelles (non corrigeables sans changer d'architecture)

- **PeerJS Cloud n'authentifie pas les identifiants** : quiconque connaît `canal-pseudo` peut s'enregistrer sous cet ID s'il est libre, et donc usurper un absent. Le code canal de 6 caractères aléatoires rend l'ID difficile à deviner, sans plus.
- **Pas de chiffrement de bout en bout indépendant de la signalisation** : DTLS-SRTP protège l'audio, mais les empreintes DTLS transitent par le serveur de signalisation (PeerJS Cloud ou serveur local). Un serveur malveillant ou compromis pourrait s'interposer. La contre-mesure serait de comparer les empreintes hors bande ; elle n'est pas implémentée.
- **Malléabilité ECDSA des codes Pro** : voir [05-ECC.md](05-ECC.md). Impact faible.
- **Connexion Google** : non vérifiée de bout en bout (configuration Firebase manquante, voir [INSTALLATION.md](INSTALLATION.md)).
- **Clé API Firebase dans la page** : publique par conception. La protection repose sur les règles Firebase et sur la liste des domaines autorisés du projet.

## 6. Analyse statique

`./gradlew lintDebug` : **0 erreur**, 11 avertissements :
- 9 `GradleDependency` (versions plus récentes disponibles) ;
- 1 `OldTargetApi` ;
- 1 `AppLinkWarning` (pas d'`autoVerify`, car le domaine github.io n'est pas contrôlé par le projet).
