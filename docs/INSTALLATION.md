# Installation, compilation et signature

Date : 2026-10-24 · Application `com.anzaimuki.talkiewalkie` v17 (versionCode 17)
Les commandes sont données pour Git Bash sous Windows. Adapter les chemins sous macOS/Linux.

## 1. Prérequis

| Élément | Version / emplacement | Remarque |
|---|---|---|
| JDK | 17 ou plus — le JBR d'Android Studio convient | `java` n'est pas dans le PATH : définir `JAVA_HOME` |
| Android SDK | platform 36, build-tools 36.x (`zipalign`, `apksigner`) | `%LOCALAPPDATA%\Android\Sdk` |
| Gradle | wrapper 9.1.0 (téléchargé par `gradlew`) | cache facultatif via `GRADLE_USER_HOME` |
| Node.js | 18 ou plus (testé avec Node 24) | outils de test uniquement, jamais dans l'APK |
| Chrome | stable | E2E web et second pair des tests sur appareil |
| Téléphone | Android 8.0 (API 26) ou plus, débogage USB activé | testé : Infinix X680, Android 10 |

Variables d'environnement utilisées pendant la campagne :

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export GRADLE_USER_HOME='D:\Android\gradle-cache'   # facultatif
export PATH="/c/Users/hp/AppData/Local/Android/Sdk/platform-tools:$PATH"
export ANDROID_SERIAL=0555711047011843              # numéro de série du téléphone (adb devices)
```

`ANDROID_SERIAL` est indispensable si plusieurs appareils sont listés par `adb devices` (un émulateur hors ligne, par exemple).

## 2. Configuration : `android/local.properties`

Ce fichier n'est **pas** versionné. Il contient le chemin du SDK et les réglages de l'application. `build.gradle.kts` lit les clés `tw.*` d'abord dans `local.properties`, puis dans `gradle.properties`. Aucune de ces valeurs n'est un secret : elles finissent dans `BuildConfig`, donc dans l'APK.

```properties
sdk.dir=C\:\\Users\\<utilisateur>\\AppData\\Local\\Android\\Sdk

# ID client OAuth de type « Web » du projet Firebase (nécessaire à la connexion Google)
tw.googleWebClientId=<id>.apps.googleusercontent.com
# Service HTTPS qui renvoie des identifiants TURN temporaires (voir RESEAU.md §4)
tw.turnServiceUrl=https://<projet>.vercel.app/api/turn
# URL publique utilisée dans les liens d'invitation (défaut : https://anzaimuki.github.io/TalkyStream/)
tw.publicUrl=https://anzaimuki.github.io/TalkyStream/
# Page ouverte par « Mise à jour » (défaut : https://github.com/AnzaiMuki/TalkyStream/releases/latest)
tw.updateUrl=https://github.com/AnzaiMuki/TalkyStream/releases/latest
```

| Clé | Si elle est absente |
|---|---|
| `tw.googleWebClientId` | le bouton Google échoue ; le mode invité fonctionne |
| `tw.turnServiceUrl` | pas de relais, sauf un TURN personnel saisi dans Paramètres › Avancé |
| `tw.publicUrl`, `tw.updateUrl` | valeurs par défaut ci-dessus |

Ne jamais mettre dans ce fichier, ni ailleurs dans le dépôt, un identifiant TURN permanent, une clé secrète Metered ou une clé privée.

## 3. Compilation

Depuis `android/` :

```bash
./gradlew assembleDebug
```

```bash
./gradlew assembleRelease
```

| Variante | Fichier produit | Remarques |
|---|---|---|
| debug | `app/build/outputs/apk/debug/app-debug.apk` | signé avec la clé de débogage ; DevTools activé ; contient l'original sous `assets/reference/` (identifiants TURN masqués par la tâche `copierReference`) pour la comparaison visuelle |
| release | `app/build/outputs/apk/release/app-release-unsigned.apk` | R8 + réduction des ressources ; **non signé** : pas de `signingConfig` dans le build (voir §5) |

L'interface vient de `web/` (source unique, déclarée comme dossier d'assets). Pour régénérer les bibliothèques embarquées dans `web/vendor/` : `cd tools && node vendor.mjs` (il faut d'abord installer les outils, §7).

## 4. Installation sur le téléphone

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

```bash
adb shell am start -W -n com.anzaimuki.talkiewalkie/.MainActivity
```

- `-r` conserve les données de l'application.
- Une APK release signée avec une autre clé que celle de l'APK installé ne s'installe pas par-dessus : désinstaller d'abord (`adb uninstall com.anzaimuki.talkiewalkie`), ce qui efface les données locales.
- `connectedDebugAndroidTest` **désinstalle** l'application à la fin : la réinstaller avant toute autre campagne.

## 5. Signature de la release

Aucune clé de production n'existe à ce jour : l'APK release livré est **non signé**. Le build ne contient volontairement aucun `signingConfig`, pour qu'aucun mot de passe ni chemin de clé ne passe par le dépôt. La signature se fait hors de Gradle.

**1. Créer la clé, une seule fois.** La conserver hors du dépôt, avec une sauvegarde : une clé perdue empêche toute mise à jour de l'application.

```bash
keytool -genkeypair -v -keystore ~/cles/talkie-release.jks -alias talkie -keyalg EC -groupname secp256r1 -sigalg SHA256withECDSA -validity 10000
```

`keytool` demande le mot de passe de manière interactive : ne pas le passer en argument (il resterait dans l'historique du shell). RSA 3072 (`-keyalg RSA -keysize 3072`) convient aussi.

**2. Aligner, puis signer.** L'ordre compte : `zipalign` doit passer **avant** `apksigner`, sinon la signature v2/v3 est invalidée.

```bash
BT=/c/Users/hp/AppData/Local/Android/Sdk/build-tools/36.1.0
"$BT/zipalign" -v -p 4 android/app/build/outputs/apk/release/app-release-unsigned.apk app-release-aligne.apk
"$BT/apksigner.bat" sign --ks ~/cles/talkie-release.jks --ks-key-alias talkie --out talkie-walkie-v17.apk app-release-aligne.apk
```

**3. Vérifier.**

```bash
"$BT/apksigner.bat" verify --verbose --print-certs talkie-walkie-v17.apk
```

Le résultat attendu est `Verified using v2 scheme: true`, puis l'empreinte du certificat.

## 6. Connexion Google : empreinte SHA-1 dans Firebase

Credential Manager n'accepte un compte Google que si le couple (nom de paquet, SHA-1 du certificat de signature) est déclaré dans le projet Firebase `talkie-walkie-b0f2d`.

1. Lire l'empreinte de **chaque** certificat utilisé :
   - debug : `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android` (mot de passe public par défaut d'Android) ;
   - release : `keytool -list -v -keystore ~/cles/talkie-release.jks -alias talkie`.
2. Console Firebase › Paramètres du projet › application Android `com.anzaimuki.talkiewalkie` › **Ajouter une empreinte** : coller le SHA-1 (et le SHA-256).
3. Copier l'**ID client OAuth de type Web** (Google Cloud › Identifiants, ou `google-services.json` › `oauth_client` de type 3) dans `tw.googleWebClientId`, puis recompiler.
4. Tester sur le téléphone : bouton Google, puis vérifier que le pseudo Gmail s'affiche.

État au 2026-10-24 : ni l'ID client ni l'empreinte ne sont enregistrés. La connexion Google est **BLOQUÉE** (non vérifiée).

## 7. Outils de test

```bash
cd tools && npm install --ignore-scripts
```

`--ignore-scripts` est nécessaire sous Windows : un script post-installation échoue sinon (« spawn cmd ENOENT »).

## 8. Commandes de test

**PC, sans téléphone** (depuis `tools/`) :

| Commande | Contenu | Dernier résultat |
|---|---|---|
| `node --test "tests/*.test.mjs"` | code JS embarqué, ECC, validation, `serveur-turn` | 24/24 RÉUSSI |
| `node --test --test-concurrency=1 e2e/web.e2e.test.mjs` | deux Chrome via PeerJS Cloud | 7/7 RÉUSSI |
| `node --test e2e/original-defauts.e2e.test.mjs` | reproduction des défauts P0 de l'original | — |

Depuis `android/` :

| Commande | Contenu | Dernier résultat |
|---|---|---|
| `./gradlew testDebugUnitTest` | tests JVM (`PolitiqueTest`) | 5/5 RÉUSSI |
| `./gradlew lintDebug` | analyse statique | 0 erreur, 11 avertissements |

**Avec le téléphone branché** (`ANDROID_SERIAL` défini, platform-tools dans le PATH) :

| Commande | Contenu | Dernier résultat |
|---|---|---|
| `./gradlew connectedDebugAndroidTest` (depuis `android/`) | tests instrumentés | 11/11 RÉUSSI — désinstalle l'APK ensuite |
| `node visuel/comparer-appareil.mjs` (depuis `tools/`) | 15 états, original ↔ APK dans la même WebView | 12 identiques, 3 écarts voulus |
| `node e2e/appareil.e2e.mjs` (depuis `tools/`) | campagne E2E téléphone ↔ PC | 9 RÉUSSI · 9 BLOQUÉ · 0 ÉCHOUÉ |

`node e2e/appareil.e2e.mjs --etapes=a,b` n'exécute que certaines étapes (par exemple `--etapes=bouton` ou `--etapes=relais`), mais **écrase** `docs/tests/appareil-resultats.json`. Le sauvegarder avant.

Pour lever les étapes BLOQUÉ : mettre le téléphone et le PC sur le **même Wi-Fi** (le câble USB reste branché pour ADB, sans partage de connexion), ou configurer un TURN. Voir [RESEAU.md](RESEAU.md) et [03-TESTS-ADB.md](03-TESTS-ADB.md) §4.

## 9. Contrôles avant publication

- Aucun identifiant TURN permanent dans les APK : chercher les valeurs révoquées avec `unzip -p <apk> | grep -c <valeur>` (doit afficher 0). Ne pas écrire ces valeurs dans un fichier versionné.
- L'original reste intact : `sha256sum talkie-walkie-final3.html` doit correspondre à [`reference-sha256.txt`](reference-sha256.txt).
- Version : `APP_VERSION` dans `web/index.html` = `versionCode` dans `android/app/build.gradle.kts`.
