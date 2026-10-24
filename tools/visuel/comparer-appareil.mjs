// Comparaison visuelle sur le téléphone : HTML de référence (non modifié) ↔ application Android.
// Les deux pages sont rendues par LA MÊME WebView, au même endroit de l'écran, avec les mêmes états :
// les écarts mesurés viennent donc du code, pas du moteur de rendu ni des polices.
// Lancer : cd tools && node visuel/comparer-appareil.mjs   (APK debug installé, téléphone branché)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { capture, connecterWebView, lancerApp, infosAppareil, URL_APP, URL_REF } from '../appareil/adb.mjs';
import { RACINE } from '../e2e/harness.mjs';

const SORTIE = join(RACINE, 'docs', 'visuel');
mkdirSync(SORTIE, { recursive: true });

// Script commun appliqué aux deux pages (fonctions présentes dans l'original ET dans l'APK)
const CONNECTE = `
  monPseudo='Moi'; monCanal='AB12CD'; document.getElementById('in-canal').value='AB12CD';
  contacts=['Alice','Bruno']; enLigne.add('alice'); etatServeur='ok';
  document.getElementById('card-contacts').style.display='block';
  document.getElementById('ptt-zone').style.display='flex';
  document.getElementById('btn-11').style.display='block';
  document.getElementById('btn-set').style.visibility='visible';
  afficherContacts(); st('✅ Connecté : Moi');`;
const ETATS = [
  // Le splash est réaffiché après son minuteur (2 s) : une capture adb pendant le splash serait une course
  { nom: '01-lancement', stockage: { 'tw-langue': 'fr' }, script: `document.getElementById('main').style.display='none'; document.getElementById('splash').style.display='flex';` },
  { nom: '02-choix-langue', stockage: {}, script: '' },
  { nom: '03-authentification', stockage: { 'tw-langue': 'fr' }, script: '' },
  { nom: '04-accueil', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi' }, script: '' },
  { nom: '05-connecte-contacts', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi' }, script: CONNECTE },
  { nom: '06-ptt-actif', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi' }, script: CONNECTE + `pttBtn.classList.add('actif'); pttBtn.textContent='En ligne'; document.getElementById('status').textContent='🔴 Micro ACTIVÉ';` },
  { nom: '07-parametres', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi' }, script: CONNECTE + `ouvrirParametres();` },
  { nom: '08-partage-qr', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi' }, script: CONNECTE + `lienInvitation = () => 'https://anzaimuki.github.io/TalkyStream/?canal=AB12CD'; ouvrirPartage();` },
  { nom: '09-chat', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi' }, script: CONNECTE + `chatAjouter('Alice','Salut, tu me reçois ?',false); chatAjouter('Moi','Oui, 5 sur 5',true); document.getElementById('modal-chat').classList.add('show');` },
  { nom: '10-appel-entrant', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi' }, script: CONNECTE + `document.getElementById('caller-name').textContent='Alice'; document.getElementById('call-notif').classList.add('show');` },
  { nom: '11-connexion-directe', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi' }, script: `document.querySelectorAll('.tgl-btn')[2].click(); directOuvrir();` },
  { nom: '12-appel-choix', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi' }, script: CONNECTE + `peer={}; afficherModalAppel(); peer=null;` },
  { nom: '13-theme-sombre', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi', 'tw-theme': 'sombre' }, script: CONNECTE },
  { nom: '14-sombre-parametres', stockage: { 'tw-langue': 'fr', 'tw-session-guest': 'Moi', 'tw-theme': 'sombre' }, script: CONNECTE + `ouvrirParametres();` },
  { nom: '15-anglais', stockage: { 'tw-langue': 'en', 'tw-session-guest': 'Moi' }, script: CONNECTE },
];
// Éléments dont la géométrie et le style calculé sont comparés
const ELEMENTS = ['#net', '.title', '#btn-set', '.card', '#in-pseudo', '#in-canal', '.toggle', '#ptt-btn', '#bcast-btn', '#status', '#chips', '#btn-11', '#btn-chat', '.modal.show .modal-box', '#vu'];
const SANS_ANIMATION = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;

async function charger(page, url, etat) {
  await page.evaluate(s => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, etat.stockage);
  await page.goto(url + '?capture=' + Date.now());
  await page.addStyleTag({ content: SANS_ANIMATION });
  await page.waitForTimeout(etat.attente || 2600);   // fin du splash (2 s) + polices
  if (etat.script) await page.evaluate(etat.script);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.waitForTimeout(700);
  return page.evaluate(sels => {
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      out[s] = { x: Math.round(r.x), y: Math.round(r.y), l: Math.round(r.width), h: Math.round(r.height),
        fond: cs.backgroundColor, image: cs.backgroundImage.slice(0, 60), couleur: cs.color, police: cs.fontFamily.split(',')[0], taille: cs.fontSize, rayon: cs.borderRadius };
    }
    return out;
  }, ELEMENTS);
}

function decouper(png, haut, hauteur) {
  const out = new PNG({ width: png.width, height: hauteur });
  PNG.bitblt(png, out, 0, haut, png.width, hauteur, 0, 0);
  return out;
}

lancerApp({ effacer: true });
await new Promise(r => setTimeout(r, 2500));
const { navigateur, page } = await connecterWebView();
const appareil = infosAppareil();
const geom = await page.evaluate(async () => { const c = await natifPret; return { haut: c.encartHaut || 0, dpr: devicePixelRatio, w: innerWidth, h: innerHeight }; });
const haut = geom.haut, hauteur = Math.round(geom.h * geom.dpr);
const rapport = { date: new Date().toISOString(), appareil, viewport: geom, methode: 'pixelmatch seuil 0.1 sur la zone WebView ; géométrie getBoundingClientRect en px CSS', etats: [] };

for (const etat of ETATS) {
  const geoRef = await charger(page, URL_REF, etat);
  const imgRef = decouper(PNG.sync.read(capture()), haut, hauteur);
  const geoApp = await charger(page, URL_APP, etat);
  const imgApp = decouper(PNG.sync.read(capture()), haut, hauteur);
  const diff = new PNG({ width: imgRef.width, height: hauteur });
  const n = pixelmatch(imgRef.data, imgApp.data, diff.data, imgRef.width, hauteur, { threshold: 0.1 });
  // Planche : référence | application | différences
  const planche = new PNG({ width: imgRef.width * 3 + 40, height: hauteur, colorType: 6 });
  planche.data.fill(255);
  PNG.bitblt(imgRef, planche, 0, 0, imgRef.width, hauteur, 0, 0);
  PNG.bitblt(imgApp, planche, 0, 0, imgRef.width, hauteur, imgRef.width + 20, 0);
  PNG.bitblt(diff, planche, 0, 0, imgRef.width, hauteur, imgRef.width * 2 + 40, 0);
  writeFileSync(join(SORTIE, etat.nom + '.png'), PNG.sync.write(planche));
  const ecarts = [];
  for (const s of new Set([...Object.keys(geoRef), ...Object.keys(geoApp)])) {
    const a = geoRef[s], b = geoApp[s];
    if (!a || !b) { ecarts.push({ element: s, ref: a ? 'visible' : 'absent', app: b ? 'visible' : 'absent' }); continue; }
    const champs = Object.keys(a).filter(k => (typeof a[k] === 'number' ? Math.abs(a[k] - b[k]) > 1 : a[k] !== b[k]));
    if (champs.length) ecarts.push({ element: s, champs: Object.fromEntries(champs.map(k => [k, [a[k], b[k]]])) });
  }
  const pct = +(100 * n / (imgRef.width * hauteur)).toFixed(3);
  rapport.etats.push({ etat: etat.nom, pixelsDifferents: n, pourcentage: pct, ecartsElements: ecarts });
  console.log(`${etat.nom.padEnd(24)} ${String(pct).padStart(7)} %  ${ecarts.length ? JSON.stringify(ecarts).slice(0, 160) : 'géométrie identique'}`);
}
writeFileSync(join(SORTIE, 'rapport.json'), JSON.stringify(rapport, null, 2));
await navigateur.close();
