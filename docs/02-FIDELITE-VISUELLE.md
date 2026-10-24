# Fidélité visuelle — original ↔ APK

Date : 2026-10-24 · Appareil : Infinix X680, Android 10 (API 29), 720×1640, densité 2, WebView 155.0.8059.43
Outil : [`tools/visuel/comparer-appareil.mjs`](../tools/visuel/comparer-appareil.mjs) · Données brutes : [`visuel/rapport.json`](visuel/rapport.json)

## Méthode

- Les deux versions sont rendues **par la même WebView, sur le téléphone**, au même endroit de l'écran :
  - l'original non modifié, embarqué dans l'APK debug sous `assets/reference/index.html`, identifiants TURN masqués ;
  - l'application, `assets/index.html`.

  Les écarts mesurés viennent donc du code, pas du moteur de rendu ni des polices.
- Viewport : 360×772 px CSS @2 (zone WebView sous la barre d'état de 64 px physiques).
- Animations et transitions désactivées, même `localStorage` et même script d'état de part et d'autre.
- Capture par `adb exec-out screencap`, puis comparaison `pixelmatch` (seuil 0,1) sur la zone WebView.
- Géométrie et style calculé (`getBoundingClientRect`, couleurs, police, taille, rayon) de 15 éléments clés : un écart > 1 px est signalé.
- Chaque planche `visuel/NN-*.png` montre : référence | application | différences en rouge.

## Résultats

| État | Pixels différents | Géométrie | Statut |
|---|---|---|---|
| 01 lancement (splash) | 0 % | identique | RÉUSSI |
| 02 choix de langue | 0 % | identique | RÉUSSI |
| 03 authentification | 0 % | identique | RÉUSSI |
| 04 accueil | 0 % | identique | RÉUSSI |
| 05 connecté + contacts | 0 % | identique | RÉUSSI |
| 06 PTT actif | 0 % | identique | RÉUSSI |
| 07 paramètres | 11,17 % | identique | RÉUSSI — écart voulu (voir ci-dessous) |
| 08 partage QR | 16,37 % | boîte modale : y 119→99, h 534→575 | RÉUSSI — écart voulu |
| 09 chat | 0 % | identique | RÉUSSI |
| 10 appel entrant | 0 % | identique | RÉUSSI |
| 11 connexion directe | 0 % | identique | RÉUSSI |
| 12 choix d'appel | 0 % | identique | RÉUSSI |
| 13 thème sombre | 0 % | identique | RÉUSSI |
| 14 paramètres (sombre) | 11,11 % | identique | RÉUSSI — écart voulu |
| 15 anglais | 0 % | identique | RÉUSSI |

**12 états sur 15 sont identiques au pixel près.** Les 3 autres ne diffèrent que par des changements de contenu décidés et documentés ; la mise en page, les couleurs, les polices et les rayons sont les mêmes.

## Écarts voulus

1. **Paramètres (07, 14)** : l'APK n'affiche plus « Mon plan : Basique » ni le bouton « ⭐ Mode Pro ». L'original n'a pas de clé publique Pro (`PRO_PUBKEY = ''`) : aucun code ne pouvait y être validé, et le verrou privait tout le monde du relais TURN (défaut P1, voir [07-DEFAUTS-ET-RISQUES.md](07-DEFAUTS-ET-RISQUES.md)). Le Pro reste dans le code et réapparaît dès qu'une clé est configurée (`PRO_EXIGE = PRO_ACTIF && !!PRO_PUBKEY`). La version affichée passe de v16 à v17. Les lignes suivantes remontent d'autant, d'où le pourcentage de pixels.
2. **Partage QR (08)** : bouton « 📤 Partager » ajouté, qui ouvre le partage natif Android. Dans l'original, il n'apparaît pas dans une WebView (`navigator.share` absent). La boîte modale s'allonge de la hauteur de ce bouton.

## Correction de l'outil pendant la campagne

La première passe donnait 8 % d'écart sur l'état 01. La capture de l'original tombait après le minuteur du splash (2 s), celle de l'APK avant : c'était une course de timing de l'outil, alors que les deux sources ont le même `setTimeout(…, 2000)`. L'état 01 réaffiche désormais le splash après le minuteur, des deux côtés, et donne 0 %.

## Limites

- Comparaison sur un seul appareil (720×1640, densité 2). Les autres densités et tailles d'écran ne sont pas testées : NON TESTÉ.
- Les bords à bord (encoches, barre de navigation gestuelle) sont gérés par des marges natives et n'apparaissent pas dans la zone comparée.
