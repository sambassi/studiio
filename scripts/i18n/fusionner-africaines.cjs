// Fusionne les lots ln/wo/bm/bas (format { traductions: {clé:{t,c,s}}, omis }) dans messages/<langue>.json
// et exporte la liste À VALIDER (CSV : clé ; français ; traduction ; confiance ; source).
//   node scripts/i18n/fusionner-africaines.cjs <dossier-out> <langue>...
const fs = require('fs'); const path = require('path');
const [, , dossier, ...langues] = process.argv;
const racine = path.resolve(__dirname, '..', '..');
const lire = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const aplatir = (o, p = '', out = {}) => { for (const k of Object.keys(o)) { const v = o[k]; const c = p ? `${p}.${k}` : k; if (v && typeof v === 'object') aplatir(v, c, out); else if (typeof v === 'string') out[c] = v; } return out; };
function poser(o, chemin, valeur) { const p = chemin.split('.'); let n = o; for (let i = 0; i < p.length - 1; i += 1) { if (typeof n[p[i]] !== 'object' || n[p[i]] === null) n[p[i]] = {}; n = n[p[i]]; } n[p[p.length - 1]] = valeur; }
const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const fr = aplatir(lire(path.join(racine, 'messages', 'fr.json')));
fs.mkdirSync(path.join(racine, 'docs', 'langues-africaines'), { recursive: true });
for (const l of langues) {
  const catalogue = {}; const meta = {}; const lignes = ['cle;francais;traduction;confiance;source'];
  let h = 0; let m = 0;
  for (const nom of fs.readdirSync(dossier).filter((x) => x.startsWith(`${l}-`) && x.endsWith('.json')).sort()) {
    const lot = lire(path.join(dossier, nom));
    for (const [k, e] of Object.entries(lot.traductions || {})) {
      if (!(k in fr) || !e || typeof e.t !== 'string' || !e.t.trim() || !['h', 'm'].includes(e.c)) continue;
      poser(catalogue, k, e.t.trim()); meta[k] = { c: e.c, s: e.s || '' };
      if (e.c === 'h') h += 1; else m += 1;
      lignes.push([k, fr[k], e.t.trim(), e.c === 'h' ? 'attestée' : 'à vérifier en priorité', e.s || ''].map(esc).join(';'));
    }
  }
  fs.writeFileSync(path.join(racine, 'messages', `${l}.json`), JSON.stringify(catalogue, null, 2) + '\n');
  fs.mkdirSync(path.join(racine, 'messages', 'meta'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'messages', 'meta', `${l}.json`), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(racine, 'docs', 'langues-africaines', `${l}-a-valider.csv`), lignes.join('\n') + '\n');
  const total = Object.keys(fr).length;
  console.log(`${l} : ${h + m} traductions (${h} attestées, ${m} à vérifier) sur ${total} clés → ${Math.round(((h + m) / total) * 100)} % du catalogue`);
}
