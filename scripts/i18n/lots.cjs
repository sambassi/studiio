// Découpe les clés à traduire en lots (un lot = un fichier JSON { clé: français }).
//   node scripts/i18n/lots.cjs <dossier-sortie> <langue> [taille=550]
// en/de : seulement les clés absentes de leur catalogue. sw/ht : toutes les clés.
const fs = require('fs'); const path = require('path');
const [, , sortie, langue, tailleArg] = process.argv;
const taille = Number(tailleArg || 550);
const racine = path.resolve(__dirname, '..', '..');
const lire = (l) => JSON.parse(fs.readFileSync(path.join(racine, 'messages', `${l}.json`), 'utf8'));
function aplatir(o, pre = '', out = {}) { for (const k of Object.keys(o)) { const v = o[k]; const c = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object') aplatir(v, c, out); else if (typeof v === 'string') out[c] = v; } return out; }
const fr = aplatir(lire('fr'));
const deja = aplatir(lire(langue));
const cles = Object.keys(fr).filter((k) => !(deja[k] && deja[k].trim()));   // ce qui reste à faire
const lots = [];
for (let i = 0; i < cles.length; i += taille) lots.push(cles.slice(i, i + taille));
lots.forEach((l, i) => fs.writeFileSync(path.join(sortie, `${langue}-${String(i + 1).padStart(2, '0')}.json`), JSON.stringify(Object.fromEntries(l.map((k) => [k, fr[k]])), null, 1)));
console.log(`${langue} : ${cles.length} clés à traduire → ${lots.length} lots`);
