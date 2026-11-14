// Inventaire du texte français CODÉ EN DUR dans le JSX de Studiio (lecture seule).
//   node scripts/i18n/inventaire.cjs [dossier=src] [--detail=chemin]
const fs = require('fs');
const path = require('path');

const racine = path.resolve(__dirname, '..', '..');
const arg = process.argv.slice(2);
const dossier = path.resolve(racine, arg.find((a) => !a.startsWith('--')) || 'src');
const detail = (arg.find((a) => a.startsWith('--detail=')) || '').slice(9);

const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'description', 'helperText', 'tooltip']);
const MOTS_FR = /\b(le|la|les|des|du|un|une|et|est|vous|votre|vos|nous|notre|pour|avec|sur|dans|par|ton|ta|tes|tu|ce|cette|ces|qui|que|au|aux|ou|pas|ne|se|sont|mon|ma|mes|chez|ajouter|choisir|créer|supprimer|modifier|enregistrer|annuler|valider|générer|erreur|chargement|aucun|aucune|obligatoire|votre|crédits?|vidéo|séquence|carte|titre)\b/i;
const ACCENT = /[àâçéèêëîïôùûüœÀÂÇÉÈÊËÎÏÔÙÛÜŒ]/;

function ressembleAuFrancais(t) {
  const s = t.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || !/[A-Za-zÀ-ÿ]{2,}/.test(s)) return false;
  if (/^[\w./:#@-]+$/.test(s) && !ACCENT.test(s)) return false;           // identifiants, chemins, classes
  return ACCENT.test(s) || (s.split(' ').length >= 2 && MOTS_FR.test(s));
}

function fichiers(d, sortie = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) fichiers(p, sortie);
    else if (/\.(tsx|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) sortie.push(p);
  }
  return sortie;
}

const ts = require('typescript');
const MSG_APPELS = /^(alert|toast|setError|setMessage|setStatus|setErr\w*|set\w*(Error|Message|Msg|Toast))$/;
const MSG_CLES = /^(error|erreur|message|msg|label|title|description|placeholder|subtitle)$/;

function dansExpressionJsx(n) {
  for (let a = n.parent; a; a = a.parent) {
    if (ts.isJsxExpression(a)) return true;
    if (ts.isArrowFunction(a) || ts.isFunctionDeclaration(a) || ts.isFunctionExpression(a) || ts.isSourceFile(a)) return false;
  }
  return false;
}

const res = [];
for (const f of fichiers(dossier)) {
  const src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const textes = [];
  const visite = (n) => {
    if (ts.isJsxText(n)) { if (ressembleAuFrancais(n.text)) textes.push(n.text.replace(/\s+/g, ' ').trim()); }
    else if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && ATTRS.has(n.name.getText())) {
      if (ressembleAuFrancais(n.initializer.text)) textes.push(n.initializer.text);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const par = n.parent;
      if (ts.isCallExpression(par) && ts.isIdentifier(par.expression) && MSG_APPELS.test(par.expression.text) && ressembleAuFrancais(n.text)) textes.push(n.text);
      else if (ts.isPropertyAssignment(par) && par.initializer === n && MSG_CLES.test(par.name.getText().replace(/['"]/g, '')) && ressembleAuFrancais(n.text)) textes.push(n.text);
      else if (dansExpressionJsx(n) && ressembleAuFrancais(n.text)) textes.push(n.text);                 // ternaires, &&, ||
      else if (ts.isPropertyAssignment(par) && par.initializer === n && /^(name|nom|text|texte|hint|desc|cta|content|help|aide|summary|resume|tagline|heading|button|bouton|empty|vide|loading|success|warning|info)$/i.test(par.name.getText().replace(/['"]/g, '')) && ressembleAuFrancais(n.text)) textes.push(n.text);
      else if (ts.isArrayLiteralExpression(par) && ressembleAuFrancais(n.text) && n.text.split(' ').length >= 2) textes.push(n.text);   // listes de libellés
    } else if (ts.isTemplateExpression(n) && ts.isJsxExpression(n.parent)) {
      const t = [n.head.text, ...n.templateSpans.map((x) => x.literal.text)].join(' ');
      if (ressembleAuFrancais(t)) textes.push(t.replace(/\s+/g, ' ').trim());
    }
    ts.forEachChild(n, visite);
  };
  visite(sf);
  const utilise = /useTranslations|useLocale/.test(src);
  if (textes.length) res.push({ f: path.relative(racine, f), n: textes.length, utilise, textes });
}
res.sort((a, b) => (b.n || 0) - (a.n || 0));
if (detail) { const r = res.find((x) => x.f === detail); (r ? r.textes : []).forEach((t) => console.log(t.slice(0, 120))); process.exit(0); }
let tot = 0; const zones = {};
for (const r of res) {
  tot += r.n;
  const parts = r.f.split('/');
  const z = parts.slice(0, r.f.startsWith('src/app/dashboard') ? 4 : 3).join('/');
  zones[z] = zones[z] || { n: 0, fichiers: 0 }; zones[z].n += r.n; zones[z].fichiers += 1;
}
console.log('TOTAL textes français en dur :', tot, 'dans', res.length, 'fichiers\n');
Object.entries(zones).sort((a, b) => b[1].n - a[1].n).slice(0, 45).forEach(([z, v]) => console.log(String(v.n).padStart(6), String(v.fichiers).padStart(4), z));
