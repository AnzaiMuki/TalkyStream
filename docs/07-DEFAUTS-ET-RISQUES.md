# Défauts corrigés et risques restants

Date : 2026-10-24 · Référence : [01-AUDIT-INITIAL.md](01-AUDIT-INITIAL.md) (numéros de ligne de l'original v16).
L'original `talkie-walkie-final3.html` n'est pas modifié (SHA-256 `681b007f…ec3e39`, vérifié le 2026-10-24, voir `reference-sha256.txt`). Toutes les corrections sont dans `web/index.html` (v17) et `android/`.

## 1. Défauts de l'original

| Gravité | Défaut | Correction | Preuve | Statut |
|---|---|---|---|---|
| P0 | Micro ouvert dès la connexion | pistes muettes hors PTT, y compris en appel 1-à-1 (changement de comportement assumé) | test Node, E2E web, test instrumenté, E2E appareil | CORRIGÉ, vérifié sur l'appareil |
| P0 | Appels décrochés automatiquement, quel que soit l'appelant (écoute à distance) | n'accepte que les contacts ou un appel accepté ; identité tirée de l'ID PeerJS | E2E web ; E2E appareil « appel inconnu refusé » ; reproduction sur l'original (`original-defauts.e2e.test.mjs`) | CORRIGÉ, vérifié sur l'appareil |
| P0 | Identifiants TURN permanents publiés | retirés ; service d'identifiants temporaires + coffre Keystore | tests Node ; 0 occurrence dans les APK | CORRIGÉ dans l'APK — **toujours en ligne sur GitHub Pages** |
| P1 | Verrou Pro sans clé : relais TURN retiré pour tous, donc mode Internet cassé entre réseaux différents | `PRO_EXIGE = PRO_ACTIF && !!PRO_PUBKEY` ; le relais perso n'est pas soumis au verrou | test Node | CORRIGÉ (il faut encore un TURN fonctionnel) |
| P1 | Micro, RNNoise et audio non libérés à la déconnexion | `deconnecter()` libère tout et arrête le service | E2E appareil : pistes `ended`, service arrêté | CORRIGÉ, vérifié sur l'appareil |
| P1 | Double appui sur OK : deux pairs | garde `connexionEnCours` + déconnexion préalable | E2E web | CORRIGÉ |
| P1 | Une seule tentative de reconnexion ; flux non relancés | reconnexion avec backoff 1 s → 30 s ; rappel automatique des flux de diffusion | E2E appareil : reconnexion au serveur atteinte après coupure des données | CORRIGÉ (rappel des flux non vérifié : réseau) |
| P1 | Google `signInWithPopup` bloqué dans une WebView | Credential Manager natif → `signInWithCredential` | — | NON VÉRIFIÉ (configuration Firebase manquante) |
| P1 | Mode Local `ws://` bloqué (contenu mixte) | `MIXED_CONTENT_ALWAYS_ALLOW` + NSC autorisant le clair + filtre ws:// privé | téléphone : signalisation `ws://` ouverte | CORRIGÉ (audio non vérifié : réseau) |
| P2 | Injection HTML | `esc()` / `textContent` | E2E web | CORRIGÉ |
| P2 | Lien d'invitation basé sur `location.href` | `LIEN_PUBLIC` / `baseInvitation` (URL publique configurable) | revue de code | CORRIGÉ |
| P2 | Suppression des données locales incomplète | contacts, favoris, TURN et annonce effacés | revue de code | CORRIGÉ |
| P2 | Audio silencieux + Wake Lock dès le lancement | uniquement pendant une session, et jamais en natif (service de premier plan à la place) | revue de code ; E2E appareil : service actif seulement en session | CORRIGÉ |
| P2 | Code canal de 4 chiffres (`Math.random`) | 6 caractères via `crypto.getRandomValues` | E2E web | CORRIGÉ |
| P3 | `changerMode()` utilise le global implicite `event` | `changerMode(mode, this)` | revue de code | CORRIGÉ |
| P3 | Fuite de nœuds audio (VAD) | source déconnectée | revue de code | CORRIGÉ |

## 2. Défauts trouvés pendant les tests sur appareil

| Défaut | Correction | Statut |
|---|---|---|
| Mode Local cassé dans l'APK : `ERR_CLEARTEXT_NOT_PERMITTED` (NSC trop strict) | NSC `cleartextTrafficPermitted="true"`, avec les verrous CSP, filtre JS et `Politique` | CORRIGÉ, vérifié sur l'appareil |
| Tests et outils : double encodage JSON, `waitForFunction` refusé par le CSP, pseudo trop court, chemin du serveur PeerJS, timing du splash | corrigés dans les outils, sans toucher l'application | CORRIGÉ |

## 3. Changements de comportement assumés

- Le micro est muet hors PTT, même pendant un appel 1-à-1 accepté.
- Le bouton « Mode Pro » et la ligne « Mon plan » sont masqués tant qu'aucune clé publique n'est configurée.
- Bouton « Partager » via le partage natif Android ; mises à jour ouvertes dans le navigateur.
- « Supprimer données locales » conserve la langue, le thème, les options et le code Pro.

## 4. Risques restants

| Risque | Gravité | Mesure / action |
|---|---|---|
| Identifiants TURN de l'original toujours publiés sur GitHub Pages | **Élevée** | les révoquer ou les changer chez ExpressTURN et Metered, puis publier la v17 (**action de ta part**) |
| Mode Internet entre réseaux différents impossible sans TURN (relais public mort) | **Élevée** (fonctionnelle) | déployer `serveur-turn` ou saisir un TURN perso (voir [RESEAU.md](RESEAU.md)) |
| Audio, arrière-plan, écran éteint, modes Local et Direct non vérifiés de bout en bout sur le téléphone | Moyenne | relancer la campagne avec le téléphone et le PC sur un même Wi-Fi |
| Bouton casque (MediaSession) instable : 1 réussite sur 3 exécutions | Moyenne | à investiguer : délai de prise de focus de la MediaSession ou état PTT précédent ; relancer `--etapes=bouton` dans un état propre |
| Doze / limitation des minuteurs en arrière-plan avec un pair réel | Moyenne | le service de premier plan et le WifiLock sont en place ; NON TESTÉ avec de l'audio |
| PeerJS Cloud sans authentification (usurpation d'un ID absent) | Moyenne | limite d'architecture ; code canal aléatoire de 6 caractères |
| Pas de chiffrement de bout en bout indépendant de la signalisation | Moyenne | limite d'architecture ; comparaison d'empreintes DTLS non implémentée |
| Signalisation du mode Local en clair sur le LAN | Faible | limitée aux adresses privées ; audio chiffré par DTLS-SRTP |
| Malléabilité ECDSA des codes Pro | Faible | voir [05-ECC.md](05-ECC.md) |
| Connexion Google non vérifiée | Moyenne | renseigner `tw.googleWebClientId` et l'empreinte SHA-1 dans Firebase, puis tester |
| Dépendances Android en retard de quelques versions mineures | Faible | mettre à jour, puis relancer les tests instrumentés |
| Un seul appareil testé (Android 10, WebView 155) | Moyenne | tester Android 13+ (permission de notification, service de premier plan de type micro) |
| APK release non signé | — | aucune clé de production disponible (voir [INSTALLATION.md](INSTALLATION.md)) |
