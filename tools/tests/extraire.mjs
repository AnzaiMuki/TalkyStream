// Extrait des fonctions/constantes du script de web/index.html pour les tester isolément (code réellement livré).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');

function blocFonction(nom) {
  const i = html.search(new RegExp('(async )?function ' + nom + '\\('));
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let j = html.indexOf('{', i), niveau = 0;
  for (; j < html.length; j++) {
    if (html[j] === '{') niveau++;
    else if (html[j] === '}' && --niveau === 0) break;
  }
  return html.slice(i, j + 1);
}
function ligneConst(nom) {
  const m = html.match(new RegExp('^\\s*const ' + nom + ' = ', 'm'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  const lignes = html.slice(m.index).split('\n'), out = [];
  for (const l of lignes) { out.push(l); if (/;\s*(\/\/.*)?$/.test(l)) break; }   // jusqu'à la fin de l'instruction
  return out.join('\n').trim();
}

// noms : ['f:nomFonction', 'c:NOM_CONST', ...] ; globaux : valeurs injectées
export function charger(noms, globaux = {}) {
  const src = noms.map(n => n.startsWith('f:') ? blocFonction(n.slice(2)) : ligneConst(n.slice(2))).join('\n');
  const exporte = noms.map(n => n.slice(2)).map(n => `globalThis.${n} = ${n};`).join('\n');
  const ctx = vm.createContext({ ...globaux });
  vm.runInContext(src + '\n' + exporte, ctx);
  return ctx;
}
