/**
 * Codemod i18n Studiio — remplace le français ÉCRIT EN DUR par `tUi('clé')`.
 *
 *   node scripts/i18n/convertir.cjs <fichier|dossier>... [--appliquer] [--rapport=chemin.json]
 *
 * Sans --appliquer : plan à blanc (rien n'est écrit). Avec : réécrit les fichiers et
 * ajoute les clés (valeur = texte d'origine, au caractère près) sous `ui.<fichier>.*`
 * de messages/fr.json.
 *
 * GARANTIES
 *  - Le français affiché ne change pas : la valeur de chaque clé est le texte d'origine.
 *  - Une chaîne n'est convertie que si c'est un texte AFFICHÉ : enfant JSX, attribut de
 *    texte (placeholder, title, aria-label, alt…), branche d'un ternaire / `&&` / `||`
 *    dans le JSX, argument d'un setter de message. JAMAIS un opérande de comparaison
 *    (`x === 'Terminé'`), un `case`, un argument de `.includes()`, une clé d'objet, une
 *    classe CSS : ce serait casser la logique.
 *  - Un fragment de phrase (texte + `{variable}` + texte) n'est PAS converti : l'ordre des
 *    mots change d'une langue à l'autre, il se fait à la main avec ses variables.
 *  - Hors composant (constante de module, fonction utilitaire) : ignoré et listé, car un
 *    hook n'y est pas permis.
 *  - Fichier sans 'use client' et sans hook : ignoré (probable composant serveur).
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const racine = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const appliquer = args.includes('--appliquer');
const rapportChemin = (args.find((a) => a.startsWith('--rapport=')) || '').slice(10);
const entrees = args.filter((a) => !a.startsWith('--'));
const CATALOGUE = path.join(racine, 'messages', 'fr.json');
const HOOK = 'tUi';

const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'description', 'helperText', 'tooltip', 'emptyText', 'confirmLabel', 'cancelLabel']);
const SETTERS = /^(alert|toast|setError|setMessage|setStatus|setSuccess|setNotice|setInfo|setErr\w*|set\w*(Error|Erreur|Message|Msg|Toast|Notice))$/;
const MOTS_FR = /\b(le|la|les|des|du|un|une|et|est|vous|votre|vos|nous|notre|pour|avec|sur|dans|par|ton|ta|tes|tu|ce|cette|ces|qui|que|au|aux|ou|pas|ne|se|sont|mon|ma|mes|chez|ajouter|choisir|créer|supprimer|modifier|enregistrer|annuler|valider|générer|erreur|chargement|aucun|aucune|obligatoire|crédits?|vidéo|séquence|carte|titre|suivant|retour|fermer|continuer)\b/i;
const ACCENT = /[àâçéèêëîïôùûüœÀÂÇÉÈÊËÎÏÔÙÛÜŒ]/;
const MARQUES = /^(studiio|stripe|twint|paypal|visa|mastercard|instagram|tiktok|youtube|facebook|pexels|google|facebook|whatsapp|pro|starter|enterprise|ok|mp4|webm|json|hd|4k|9:16|16:9|chf|eur|usd)$/i;

function exclu(t) {
  const s = t.trim();
  if (MARQUES.test(s)) return 'marque';
  if (/@/.test(s) || /^https?:/.test(s)) return 'contact';
  if (/^[a-z0-9]+([_-][a-z0-9]+)+$/i.test(s) && !/\s/.test(s)) return 'identifiant';
  if (/^[\W\d_]+$/.test(s)) return 'symboles';
  if (/[{};]/.test(s) && /[:;]/.test(s)) return 'css';
  if (/^(rgba?|hsla?|#)/.test(s)) return 'couleur';
  return null;
}
function francais(t) {
  const s = t.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || !/[A-Za-zÀ-ÿ]{2,}/.test(s)) return false;
  if (exclu(s)) return false;
  return ACCENT.test(s) || (s.split(' ').length >= 2 && MOTS_FR.test(s)) || /^(Fermer|Retour|Suivant|Annuler|Valider|Continuer|Supprimer|Modifier|Ajouter|Enregistrer|Précédent|Terminer|Charger|Télécharger|Rechercher|Générer|Créer|Aperçu|Titre|Description|Durée|Musique|Voix|Vidéo|Image|Style|Texte|Couleur|Police|Taille)\b/.test(s);
}
const norm = (t) => t.replace(/\s+/g, ' ').trim();

function slugTexte(t) {
  const b = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (b.slice(0, 38).replace(/_+$/, '') || 'texte');
}
function slugFichier(rel) {
  const p = rel.replace(/^src\//, '').replace(/\.(tsx|ts|jsx|js)$/, '').replace(/\/page$/, '').split(/[\/\\]/);
  return p.map((x, i) => x.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))).map((x, i) => (i === 0 ? x.charAt(0).toLowerCase() + x.slice(1) : x.charAt(0).toUpperCase() + x.slice(1))).join('');
}

function lister(entree, sortie = []) {
  const p = path.resolve(racine, entree);
  const st = fs.statSync(p);
  if (st.isFile()) { sortie.push(p); return sortie; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (['node_modules', '__tests__', '.next'].includes(e.name) || e.name.startsWith('.')) continue;
    lister(path.join(p, e.name), sortie);
  }
  return sortie;
}


/** Expression « simple » (affichable telle quelle comme variable) : identifiant ou chaîne de propriétés. */
function nomVariable(e) {
  if (ts.isNonNullExpression(e)) return nomVariable(e.expression);
  if (ts.isParenthesizedExpression(e)) return nomVariable(e.expression);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) { return nomVariable(e.expression) ? e.name.text : null; }
  return null;
}

const fonction = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

/** Nom du binding d'une fonction (déclaration, const x = () =>, memo(forwardRef(...))). */
function nomFonction(f) {
  if (f.name && ts.isIdentifier(f.name)) return f.name.text;
  let p = f.parent;
  while (p && ts.isCallExpression(p)) p = p.parent;          // memo(...), forwardRef(...)
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isExportAssignment(p)) return 'default';
  return '';
}
const estComposant = (nom) => /^[A-Z]/.test(nom) || nom === 'default';

/** Le composant qui ENGLOBE le nœud (null si hors composant, ou dans une classe). */
function composantDe(n) {
  for (let a = n.parent; a; a = a.parent) {
    if (ts.isClassDeclaration(a) || ts.isClassExpression(a)) return null;
    if (fonction(a)) {
      const nom = nomFonction(a);
      if (estComposant(nom)) return a;
      if (/^use[A-Z]/.test(nom)) return a;                   // hook personnalisé
    }
  }
  return null;
}

/** La chaîne est-elle dans une position de VALEUR affichée (et non de comparaison / logique) ? */
function positionAffichee(n) {
  let c = n;
  let p = n.parent;
  while (p && ts.isParenthesizedExpression(p)) { c = p; p = p.parent; }
  if (!p) return false;
  if (ts.isJsxExpression(p)) return !ts.isJsxAttribute(p.parent) || ATTRS.has(p.parent.name.getText());
  if (ts.isConditionalExpression(p)) {
    if (p.condition === c) return false;
    return positionAfficheeExpr(p);
  }
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken && p.right === c) return positionAfficheeExpr(p);
    if ((op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) && p.right === c) return positionAfficheeExpr(p);
    return false;
  }
  return false;
}
/** Une expression composée (ternaire, &&) est affichée si elle l'est elle-même, récursivement. */
function positionAfficheeExpr(e) { return positionAffichee(e); }

function traiter(fichier) {
  const rel = path.relative(racine, fichier);
  const src = fs.readFileSync(fichier, 'utf8');
  const sf = ts.createSourceFile(fichier, src, ts.ScriptTarget.Latest, true, fichier.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const res = { fichier: rel, converti: [], ignores: [], clés: {} };

  const clientDirective = /^\s*(['"])use client\1/.test(src);
  const aDesHooks = /\buse(State|Effect|Ref|Memo|Callback|Context|Reducer|Router|Session|Translations|Locale)\b/.test(src);
  if (!clientDirective && !aDesHooks) { res.ignores.push({ raison: 'fichier sans use client ni hook (composant serveur probable)', n: 1 }); return { res, nouveau: null }; }
  if (/\btUi\b/.test(src) && !/useTranslations\('ui\./.test(src)) { res.ignores.push({ raison: 'identifiant tUi déjà utilisé', n: 1 }); return { res, nouveau: null }; }

  const ns = `ui.${slugFichier(rel)}`;
  const edits = [];
  const composantsEquipes = new Map();     // fonction -> vrai
  const cles = new Map();                  // slug -> texte
  const parTexte = new Map();              // texte -> slug

  const cleDe = (texte) => {
    if (parTexte.has(texte)) return parTexte.get(texte);
    let s = slugTexte(texte); let k = s; let i = 2;
    while (cles.has(k) && cles.get(k) !== texte) { k = `${s}_${i}`; i += 1; }
    cles.set(k, texte); parTexte.set(texte, k); return k;
  };
  const ignore = (raison, texte) => res.ignores.push({ raison, texte: texte ? norm(texte).slice(0, 70) : undefined });

  const convertir = (noeud, debut, fin, texte, brut, forme, litteral) => {
    // Une CHAÎNE (par opposition à du texte JSX) qui commence ou finit par une espace, ou
    // par une ponctuation de liaison, est un FRAGMENT de concaténation (` (original conservé)`,
    // ` · image figée`) : normaliser l'espace casse l'affichage. À traiter à la main.
    if (litteral && (texte !== texte.trim() || /^[\s·—–(),;:!?.\-/+&|]/.test(texte))) { ignore('fragment de concaténation (espace ou ponctuation de liaison en bordure)', texte); return; }
    const comp = composantDe(noeud);
    if (!comp) { ignore('hors composant (constante ou fonction utilitaire)', texte); return; }
    const k = cleDe(brut);
    composantsEquipes.set(comp, true);
    edits.push({ debut, fin, texte: forme(k) });
    res.converti.push(brut);
  };

  const nomsUniques = (exprs) => {
    const vus = new Map(); const out = [];
    for (const e of exprs) {
      let base = nomVariable(e); let nom = base; let i = 2;
      // collision : on remonte le chemin (a.size / b.size → a_size / b_size) avant de numéroter
      if (vus.has(nom)) nom = e.getText().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || base;
      const racine = nom;
      while (vus.has(nom)) { nom = `${racine}${i}`; i += 1; }
      vus.set(nom, true); out.push({ nom, expr: e });
    }
    return out;
  };
  const paramsDe = (vars) => `{ ${vars.map((v) => (v.nom === v.expr.getText() ? v.nom : `${v.nom}: ${v.expr.getText()}`)).join(', ')} }`;

  /** <p>Bonjour {nom}, il reste {n} crédits</p> -> {tUi('k', { nom, n })} (clé « Bonjour {nom}, … »). */
  const essaiFragment = (n) => {
    const enfants = (n.children || []).filter((c) => !(ts.isJsxText(c) && !c.text.trim()));
    if (enfants.length < 2) return false;
    const toutSimple = enfants.every((c) => ts.isJsxText(c) || (ts.isJsxExpression(c) && c.expression && (nomVariable(c.expression) || (ts.isStringLiteral(c.expression) && c.expression.text === ' '))));
    if (!toutSimple) return false;
    const vars = nomsUniques(enfants.filter((c) => ts.isJsxExpression(c) && c.expression && nomVariable(c.expression)).map((c) => c.expression));
    if (!vars.length) return false;
    // deux variables collées (`{a}{b}`) : fragments cachés, à traiter à la main
    for (let j = 1; j < enfants.length; j += 1) if (ts.isJsxExpression(enfants[j]) && ts.isJsxExpression(enfants[j - 1])) return false;
    let i = 0; let texte = '';
    for (const c of enfants) {
      if (ts.isJsxText(c)) texte += c.text;
      else if (ts.isStringLiteral(c.expression)) texte += ' ';
      else { texte += `{${vars[i].nom}}`; i += 1; }
    }
    const coeur = norm(texte);
    const sansVars = coeur.replace(/\{[^}]+\}/g, ' ');
    if (!francais(sansVars)) return false;
    if (/[{}]/.test(sansVars)) return false;
    const comp = composantDe(n);
    if (!comp) { ignore('hors composant (constante ou fonction utilitaire)', coeur); return true; }
    const k = cleDe(coeur);
    composantsEquipes.set(comp, true);
    const debut = enfants[0].pos + (ts.isJsxText(enfants[0]) ? enfants[0].text.indexOf(enfants[0].text.trim()) : (enfants[0].getStart() - enfants[0].pos));
    const dernier = enfants[enfants.length - 1];
    const fin = ts.isJsxText(dernier) ? dernier.pos + dernier.text.trimEnd().length : dernier.end;
    const debutReel = ts.isJsxText(enfants[0]) ? enfants[0].pos + enfants[0].text.length - enfants[0].text.trimStart().length : enfants[0].getStart();
    edits.push({ debut: debutReel, fin, texte: `{${HOOK}('${k}', ${paramsDe(vars)})}` });
    res.converti.push(coeur);
    return true;
  };

  /** `Il reste ${n} crédits` affiché -> tUi('k', { n }) */
  const essaiGabarit = (n) => {
    const p = n.parent;
    const affiche = (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && SETTERS.test(p.expression.text) && p.arguments[0] === n) || positionAffichee(n);
    if (!affiche) return false;
    if (!n.templateSpans.every((sp) => nomVariable(sp.expression))) return false;
    const vars = nomsUniques(n.templateSpans.map((sp) => sp.expression));
    let texte = n.head.text; n.templateSpans.forEach((sp, i) => { texte += `{${vars[i].nom}}` + sp.literal.text; });
    if (/[{}]/.test(texte.replace(/\{[a-zA-Z_][\w]*\}/g, ''))) return false;
    if (!francais(texte.replace(/\{[^}]+\}/g, ' '))) return false;
    if (texte !== texte.trim() || /^[\s·—–(),;:!?.\-/+&|]/.test(texte)) { ignore('fragment de concaténation (espace ou ponctuation de liaison en bordure)', texte); return true; }
    const comp = composantDe(n);
    if (!comp) { ignore('hors composant (constante ou fonction utilitaire)', texte); return true; }
    const k = cleDe(norm(texte));
    composantsEquipes.set(comp, true);
    edits.push({ debut: n.getStart(), fin: n.end, texte: `${HOOK}('${k}', ${paramsDe(vars)})` });
    res.converti.push(norm(texte));
    return true;
  };

  const visite = (n) => {
    if ((ts.isJsxElement(n) || ts.isJsxFragment(n)) && essaiFragment(n)) return;
    if (ts.isTemplateExpression(n) && essaiGabarit(n)) return;
    if (ts.isJsxText(n)) {
      const brut = n.text;
      const coeur = brut.trim();
      if (coeur && francais(coeur)) {
        const par = n.parent;
        const enfants = (par.children || []).filter((c) => !(ts.isJsxText(c) && !c.text.trim()));
        const textes = enfants.filter((c) => ts.isJsxText(c));
        const expr = enfants.filter((c) => ts.isJsxExpression(c));
        if (expr.length || textes.length > 1) ignore('fragment de phrase (texte + variable/balise en ligne)', coeur);
        else if (/[{}]/.test(coeur)) ignore('accolades dans le texte', coeur);
        else {
          const dec = n.pos + brut.indexOf(coeur);
          convertir(n, dec, dec + coeur.length, coeur, norm(coeur), (k) => `{${HOOK}('${k}')}`);
        }
      }
    } else if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && ATTRS.has(n.name.getText())) {
      const v = n.initializer.text;
      if (francais(v)) convertir(n, n.initializer.getStart(), n.initializer.end, v, norm(v), (k) => `{${HOOK}('${k}')}`);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      const v = n.text;
      if (francais(v)) {
        if (ts.isJsxAttribute(p)) { /* géré plus haut (ATTRS) */ }
        else if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && SETTERS.test(p.expression.text) && p.arguments[0] === n) {
          convertir(n, n.getStart(), n.end, v, norm(v), (k) => `${HOOK}('${k}')`, true);
        } else if (positionAffichee(n)) {
          convertir(n, n.getStart(), n.end, v, norm(v), (k) => `${HOOK}('${k}')`, true);
        } else if (ts.isPropertyAssignment(p) && p.initializer === n && /^(label|title|description|placeholder|hint|name|text|subtitle|message|error|cta)$/i.test(p.name.getText().replace(/['"]/g, ''))) {
          ignore('libellé dans un objet/tableau (à traiter à la main : clé + rendu)', v);
        } else if (ts.isArrayLiteralExpression(p) && v.split(' ').length >= 2) {
          ignore('libellé dans un tableau (à traiter à la main)', v);
        }
      }
    }
    ts.forEachChild(n, visite);
  };
  visite(sf);

  if (!edits.length) return { res, nouveau: null };

  // --- Équiper chaque composant du hook (au tout début du corps) --------------------------
  for (const f of composantsEquipes.keys()) {
    const decl = `const ${HOOK} = useTranslations('${ns}');`;
    if (f.body && ts.isBlock(f.body)) {
      if (src.slice(f.body.getStart(), f.body.end).includes(`const ${HOOK} =`)) continue;
      edits.push({ debut: f.body.getStart() + 1, fin: f.body.getStart() + 1, texte: `\n  ${decl}` });
    } else if (f.body) {
      // Corps en expression : `() => (<div/>)` devient `() => { const tUi = …; return (<div/>); }`
      edits.push({ debut: f.body.getStart(), fin: f.body.getStart(), texte: `{ ${decl} return ` });
      edits.push({ debut: f.body.end, fin: f.body.end, texte: '; }' });
    }
  }
  // --- Import -----------------------------------------------------------------------------
  const aImport = /import\s*\{[^}]*\buseTranslations\b[^}]*\}\s*from\s*['"]@\/i18n\/client['"]/.test(src);
  if (!aImport) {
    const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
    const pos = imports.length ? imports[imports.length - 1].end : (clientDirective ? sf.statements[0].end : 0);
    edits.push({ debut: pos, fin: pos, texte: `\nimport { useTranslations } from '@/i18n/client';` });
  }

  // --- Appliquer, de la fin vers le début -------------------------------------------------
  edits.sort((a, b) => (b.debut - a.debut) || (b.fin - a.fin));
  let nouveau = src;
  for (const e of edits) nouveau = nouveau.slice(0, e.debut) + e.texte + nouveau.slice(e.fin);
  res.clés = Object.fromEntries(cles);
  res.ns = ns;
  return { res, nouveau };
}

function insererCle(catalogue, ns, cles) {
  const parts = ns.split('.');
  let n = catalogue;
  for (const p of parts) { if (typeof n[p] !== 'object' || n[p] === null) n[p] = {}; n = n[p]; }
  for (const [k, v] of Object.entries(cles)) n[k] = v;
}

const sauf = (args.find((a) => a.startsWith('--sauf=')) || '').slice(7).split(',').filter(Boolean);
const fichiers = entrees.flatMap((e) => lister(e)).filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\./.test(f) && !/\.d\.ts$/.test(f) && !sauf.some((x) => f.includes(`/${x}/`)));
const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
const rapport = [];
let total = 0; const raisons = {};
for (const f of fichiers) {
  let r;
  try { r = traiter(f); } catch (e) { console.error('ERREUR', f, e.message); continue; }
  const { res, nouveau } = r;
  total += res.converti.length;
  for (const i of res.ignores) raisons[i.raison] = (raisons[i.raison] || 0) + (i.n || 1);
  if (res.converti.length || res.ignores.length) rapport.push(res);
  if (nouveau && res.converti.length) {
    if (appliquer) { fs.writeFileSync(f, nouveau); insererCle(catalogue, res.ns, res.clés); }
  }
}
if (appliquer) fs.writeFileSync(CATALOGUE, JSON.stringify(catalogue, null, 2) + '\n');
if (rapportChemin) fs.writeFileSync(rapportChemin, JSON.stringify(rapport, null, 2));
console.log(`${appliquer ? 'APPLIQUÉ' : 'PLAN'} : ${total} textes convertis dans ${rapport.filter((r) => r.converti.length).length} fichiers`);
for (const [k, v] of Object.entries(raisons).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
