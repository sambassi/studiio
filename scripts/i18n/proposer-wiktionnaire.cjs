// Propose des traductions à partir des extraits Wiktionary (kaikki.org, CC BY-SA 4.0), en CORRESPONDANCE EXACTE seulement.
//   node scripts/i18n/proposer-wiktionnaire.cjs <dossier-extraits> [--ecrire]
// Règles : libellé court (≤ 3 mots, sans variable) ; une définition EXACTEMENT égale au libellé (français : édition fr ;
// anglais : édition en, via le catalogue en) ; un seul mot candidat par langue ; jamais d'écrasement d'une entrée existante.
// Rien n'est ajouté aux catalogues : sortie CSV de propositions, à relire puis importer dans /admin/traductions.
const fs = require('fs'); const path = require('path');
const [, , dossier, ...opts] = process.argv; const ecrire = opts.includes('--ecrire');
const racine = path.resolve(__dirname, '..', '..');
const lire = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const aplatir = (o, p = '', out = {}) => { for (const k of Object.keys(o)) { const v = o[k]; const c = p ? `${p}.${k}` : k; if (v && typeof v === 'object') aplatir(v, c, out); else if (typeof v === 'string') out[c] = v; } return out; };
function poser(o, chemin, valeur) { const p = chemin.split('.'); let n = o; for (let i = 0; i < p.length - 1; i += 1) { if (typeof n[p[i]] !== 'object' || n[p[i]] === null) n[p[i]] = {}; n = n[p[i]]; } n[p[p.length - 1]] = valeur; }
const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const fr = aplatir(lire(path.join(racine, 'messages', 'fr.json'))); const en = aplatir(lire(path.join(racine, 'messages', 'en.json')));
const norm = (s) => String(s).toLowerCase().normalize('NFC').replace(/[.!?…:]+$/g, '').replace(/\s+/g, ' ').trim();
const court = (s) => s && !/[{}<>0-9]/.test(s) && s.trim().split(/\s+/).length <= 3 && s.length <= 28 && s.trim().length >= 4;
// Pièges connus : abréviations de jours/mois (« Mer » = mercredi, pas mer), mots-outils, libellés propres à l'écran.
const exclue = (k) => /dayHeaders|monthNames|months|weekdays/i.test(k);
function indexer(fichier, nettoyer) {
  const idx = new Map(); if (!fs.existsSync(fichier)) return idx;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
    if (!ligne) continue; let e; try { e = JSON.parse(ligne); } catch { continue; }
    if (!e.word || /\s/.test(e.word) || /^[-]|[-]$/.test(e.word)) continue;     // pas d'affixes ni d'expressions
    for (const s of e.senses || []) {
      if (s.form_of || s.alt_of || (s.tags || []).some((t) => ['form-of', 'alt-of', 'obsolete', 'dated', 'archaic', 'rare', 'vulgar', 'offensive'].includes(t))) continue;
      for (const g of s.glosses || []) { const k = nettoyer(g); if (!k) continue; if (!idx.has(k)) idx.set(k, new Set()); idx.get(k).add(e.word); }
    }
  }
  return idx;
}
const nFr = (g) => { const k = norm(g); return k.split(' ').length <= 3 ? k : null; };
const nEn = (g) => { const k = norm(g).replace(/^to /, ''); return k.split(' ').length <= 3 && !/[(;]/.test(k) ? k : null; };
const bilan = {};
for (const l of ['ln', 'wo', 'bm']) {
  const idxFr = indexer(path.join(dossier, `fr-${l}.jsonl`), nFr); const idxEn = indexer(path.join(dossier, `en-${l}.jsonl`), nEn);
  const cat = fs.existsSync(path.join(racine, 'messages', `${l}.json`)) ? aplatir(lire(path.join(racine, 'messages', `${l}.json`))) : {};
  const meta = fs.existsSync(path.join(racine, 'messages', 'meta', `${l}.json`)) ? lire(path.join(racine, 'messages', 'meta', `${l}.json`)) : {};
  const lignes = ['cle;francais;proposition;concordance;source']; let n = 0; let double = 0; const nouveau = {};
  for (const [k, v] of Object.entries(fr)) {
    if (k in cat || exclue(k) || !court(v)) continue;
    const a = idxFr.get(norm(v)); const b = court(en[k]) ? idxEn.get(nEn(en[k]) || '') : null;
    const cA = a && a.size === 1 ? [...a][0] : null; const cB = b && b.size === 1 ? [...b][0] : null;
    let mot = null; let conc = '';
    if (cA && cB && norm(cA) === norm(cB)) { mot = cA; conc = 'deux éditions concordantes'; double += 1; }
    else if (cA && !(b && b.size > 1)) { mot = cA; conc = 'Wiktionnaire fr seul'; }
    else if (cB && !(a && a.size > 1)) { mot = cB; conc = 'Wiktionary en seul'; }
    if (!mot) continue;
    const source = `Wiktionary (${conc}), CC BY-SA 4.0, via kaikki.org`;
    nouveau[k] = { t: mot, s: source }; n += 1; lignes.push([k, v, mot, conc, source].map(esc).join(';'));
  }
  bilan[l] = { propositions: n, deuxEditions: double };
  if (ecrire) {
    // Propositions SEULEMENT en CSV : jamais dans les catalogues avant relecture humaine (import via /admin/traductions).
    fs.writeFileSync(path.join(racine, 'docs', 'langues-africaines', `${l}-propositions-wiktionnaire.csv`), lignes.join('\n') + '\n');
  } else { console.log(`--- ${l} échantillon`); lignes.slice(1, 13).forEach((x) => console.log(x)); }
}
console.log(JSON.stringify(bilan));
