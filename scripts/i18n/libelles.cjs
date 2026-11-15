/**
 * Codemod « libellés de constantes » — traduit les textes français qui VIVENT DANS DES
 * CONSTANTES de module (listes d'offres, étapes, thèmes, conseils…) sans toucher aux constantes.
 *
 *   node scripts/i18n/libelles.cjs <fichier|dossier>... [--appliquer] [--sauf=a,b]
 *
 * Principe : les constantes restent identiques (la logique qui les compare ne bouge pas).
 * Chaque texte français qu'elles contiennent est enregistré dans `ui.libelles.<empreinte>`
 * de messages/fr.json, et l'ENDROIT OÙ IL EST AFFICHÉ est enveloppé : `{plan.name}` devient
 * `{tUi.fr(plan.name)}`. `tUi.fr` traduit par texte exact et RENVOIE L'ORIGINAL sans entrée :
 * un contenu de l'utilisateur n'est jamais altéré.
 *
 * Sites reconnus (JSX uniquement : enfant ou attribut de texte) :
 *   - `{P}`, `{P.prop}`, `{label}` où P/`label` est le paramètre d'un `.map` sur la constante
 *     (ou sur une propriété tableau de ses éléments, récursivement) ;
 *   - `{CONSTANTE[clé]}` et `{CONSTANTE[clé].prop}`.
 * Tout le reste est LISTÉ (« non branché »), jamais deviné.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { empreinte, normaliser } = require('./hash.cjs');

const racine = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const appliquer = args.includes('--appliquer');
const entrees = args.filter((a) => !a.startsWith('--'));
const sauf = (args.find((a) => a.startsWith('--sauf=')) || '').slice(7).split(',').filter(Boolean);
const CATALOGUE = path.join(racine, 'messages', 'fr.json');
// Fonctions importées qui RENDENT un libellé français d'une constante déjà moissonnée (ex. themeLabel).
const FONCTIONS = new Set(((args.find((a) => a.startsWith('--fonctions=')) || '').slice(12)).split(',').filter(Boolean));
const HOOK = 'tUi';

const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'description', 'helperText', 'tooltip']);
const PROPS_EXCLUES = new Set(['id', 'key', 'type', 'href', 'url', 'src', 'icon', 'color', 'className', 'value', 'slug', 'kind', 'mode', 'format', 'status', 'to', 'path', 'route', 'name_id']);
const MOTS_FR = /\b(le|la|les|des|du|un|une|et|est|vous|votre|vos|nous|notre|pour|avec|sur|dans|par|ton|ta|tes|tu|ce|cette|ces|qui|que|au|aux|ou|pas|ne|se|sont|mon|ma|mes|chez|crédits?|vidéo|séquence|carte|titre|aucun|aucune)\b/i;
const ACCENT = /[àâçéèêëîïôùûüœÀÂÇÉÈÊËÎÏÔÙÛÜŒ]/;
const MARQUES = /^(studiio|stripe|twint|paypal|visa|mastercard|instagram|tiktok|youtube|facebook|pexels|google|whatsapp|pro|starter|enterprise|ok|mp4|webm|json|hd|4k|9:16|16:9|chf|eur|usd)$/i;

function francais(t) {
  const s = normaliser(t);
  if (s.length < 2 || !/[A-Za-zÀ-ÿ]{2,}/.test(s)) return false;
  if (MARQUES.test(s) || /@/.test(s) || /^https?:/.test(s) || /^[\W\d_]+$/.test(s)) return false;
  if (/^[a-z0-9]+([_-][a-z0-9]+)+$/i.test(s) && !/\s/.test(s)) return false;
  if (/^(rgba?|hsla?|#)/.test(s) || (/[{};]/.test(s) && /[:;]/.test(s))) return false;
  return ACCENT.test(s) || (s.split(' ').length >= 2 && MOTS_FR.test(s)) || /^(Aperçu|Titre|Description|Durée|Musique|Voix|Vidéo|Image|Style|Texte|Couleur|Police|Taille|Retour|Suivant|Fermer|Beauté|Nutrition|Fitness|Santé|Bien-être|Productivité|Entraînement)\b/.test(s);
}

function lister(entree, sortie = []) {
  const p = path.resolve(racine, entree); const st = fs.statSync(p);
  if (st.isFile()) { sortie.push(p); return sortie; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (['node_modules', '__tests__', '.next'].includes(e.name) || e.name.startsWith('.')) continue;
    lister(path.join(p, e.name), sortie);
  }
  return sortie;
}
const fonction = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
function nomFonction(f) {
  if (f.name && ts.isIdentifier(f.name)) return f.name.text;
  let p = f.parent; while (p && ts.isCallExpression(p)) p = p.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isExportAssignment(p)) return 'default';
  return '';
}
function composantDe(n) {
  for (let a = n.parent; a; a = a.parent) {
    if (ts.isClassDeclaration(a) || ts.isClassExpression(a)) return null;
    if (fonction(a)) { const nom = nomFonction(a); if (/^[A-Z]/.test(nom) || nom === 'default' || /^use[A-Z]/.test(nom)) return a; }
  }
  return null;
}
function slugFichier(rel) {
  const p = rel.replace(/^src\//, '').replace(/\.(tsx|ts|jsx|js)$/, '').replace(/\/page$/, '').split(/[\/\\]/);
  return p.map((x) => x.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))).map((x, i) => (i === 0 ? x.charAt(0).toLowerCase() + x.slice(1) : x.charAt(0).toUpperCase() + x.slice(1))).join('');
}
// Enveloppes sans effet sur le contenu : `as const`, `satisfies`, parenthèses, `Object.freeze([...])`.
const deballer = (e) => {
  let x = e;
  for (;;) {
    if (x && (ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isParenthesizedExpression(x) || ts.isTypeAssertionExpression(x))) x = x.expression;
    else if (x && ts.isCallExpression(x) && x.expression.getText() === 'Object.freeze' && x.arguments.length === 1) x = x.arguments[0];
    else return x;
  }
};
const nomProp = (n) => (n.name ? n.name.getText().replace(/['"]/g, '') : '');

/** Moissonne les textes français d'un littéral ; renvoie { textes, propsTexte, propsTableau, elementsChaines }. */
function moissonner(init) {
  const info = { textes: [], propsTexte: new Set(), propsTableau: new Set(), elementsChaines: false, recordChaines: false };
  const visite = (n, parentProp) => {
    n = deballer(n);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (francais(n.text) && !PROPS_EXCLUES.has(parentProp || '')) { info.textes.push(normaliser(n.text)); if (parentProp) info.propsTexte.add(parentProp); return true; }
      return false;
    }
    if (ts.isArrayLiteralExpression(n)) {
      let chaines = false;
      for (const e of n.elements) { const r = visite(e, parentProp); const d = deballer(e); if (r && (ts.isStringLiteral(d) || ts.isNoSubstitutionTemplateLiteral(d))) chaines = true; }
      if (chaines && parentProp) { info.propsTableau.add(parentProp); info.propsTexte.delete(parentProp); }
      return chaines;
    }
    if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) { if (ts.isPropertyAssignment(p)) visite(p.initializer, nomProp(p)); }
      return false;
    }
    return false;
  };
  const d = deballer(init);
  if (ts.isArrayLiteralExpression(d)) {
    const direct = d.elements.some((e) => { const x = deballer(e); return ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x); });
    info.elementsChaines = direct;
    for (const e of d.elements) visite(e, '');
  } else if (ts.isObjectLiteralExpression(d)) {
    // Record<string,string> : { a: 'Texte', b: 'Texte' } — les valeurs sont les libellés
    const valeursChaines = d.properties.length > 0 && d.properties.every((p) => ts.isPropertyAssignment(p) && ['StringLiteral', 'NoSubstitutionTemplateLiteral'].includes(ts.SyntaxKind[deballer(p.initializer).kind]));
    info.recordChaines = valeursChaines;
    for (const p of d.properties) { if (ts.isPropertyAssignment(p)) visite(p.initializer, valeursChaines ? '' : nomProp(p)); }
  }
  return info;
}

function traiter(fichier) {
  const rel = path.relative(racine, fichier);
  const src = fs.readFileSync(fichier, 'utf8');
  const res = { fichier: rel, textes: [], branches: 0, nonBranches: 0 };
  const client = /^\s*(['"])use client\1/.test(src);
  if (!client && !/\buse(State|Effect|Ref|Memo|Callback|Context|Translations|Locale|Router|Session)\b/.test(src)) return { res, nouveau: null };
  const sf = ts.createSourceFile(fichier, src, ts.ScriptTarget.Latest, true, fichier.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // 1. constantes de module à libellés
  const constantes = new Map();   // nom -> info
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const info = moissonner(d.initializer);
      if (info.textes.length) { constantes.set(d.name.text, info); res.textes.push(...info.textes); }
    }
  }
  // 1b. constantes IMPORTÉES depuis `@/lib/...` (thèmes, listes d'offres…) : leurs libellés sont
  // moissonnés dans le fichier source, et le nom local importé devient une « constante » du fichier.
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause || !st.importClause.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    const spec = st.moduleSpecifier.text;
    if (!spec.startsWith('@/lib/')) continue;
    const base = path.join(racine, 'src', spec.slice(2));
    const cible = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((c) => fs.existsSync(c));
    if (!cible) continue;
    const sfc = ts.createSourceFile(cible, fs.readFileSync(cible, 'utf8'), ts.ScriptTarget.Latest, true);
    const exportees = new Map();
    for (const e of sfc.statements) {
      if (!ts.isVariableStatement(e) || !(e.modifiers || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const d of e.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) exportees.set(d.name.text, d.initializer);
    }
    for (const el of st.importClause.namedBindings.elements) {
      const distant = (el.propertyName || el.name).text;
      if (!exportees.has(distant)) continue;
      const info = moissonner(exportees.get(distant));
      if (info.textes.length) { constantes.set(el.name.text, info); res.textes.push(...info.textes); }
    }
  }
  // 1c. alias : `const THEMES = SHARED_THEMES;`
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const init = d.initializer && deballer(d.initializer);
      if (ts.isIdentifier(d.name) && init && ts.isIdentifier(init) && constantes.has(init.text) && !constantes.has(d.name.text)) constantes.set(d.name.text, constantes.get(init.text));
    }
  }
  if (!constantes.size && !FONCTIONS.size) return { res, nouveau: null };

  // 2. racines dérivées : nom -> { genre: 'objet'|'chaine', info }
  const derives = new Map();
  for (const [nom, info] of constantes) derives.set(nom, { genre: info.elementsChaines ? 'chaine-tableau' : 'objet-tableau', info, constante: true });
  const racineDe = (e) => { // racine identifiant d'une chaîne de propriétés/appels
    let x = deballer(e);
    while (x) {
      if (ts.isIdentifier(x)) return x.text;
      if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
      else if (ts.isCallExpression(x)) x = x.expression;
      else return null;
    }
    return null;
  };
  const dernierProp = (e) => { const x = deballer(e); return ts.isPropertyAccessExpression(x) ? x.name.text : ''; };
  const toutesInfos = [...constantes.values()];
  const propsTexte = new Set(toutesInfos.flatMap((i) => [...i.propsTexte]));
  const propsTableau = new Set(toutesInfos.flatMap((i) => [...i.propsTableau]));

  // 2b. `const r = RENDU[statut];` / `const t = THEMES.find(...)` : la variable porte un élément de la constante
  const variables = [];
  const collecterVars = (n) => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) variables.push(n); ts.forEachChild(n, collecterVars); };
  collecterVars(sf);
  for (const v of variables) {
    const init = deballer(v.initializer);
    if (ts.isElementAccessExpression(init)) {
      const r = deballer(init.expression);
      if (ts.isIdentifier(r) && constantes.has(r.text) && !derives.has(v.name.text)) derives.set(v.name.text, { genre: constantes.get(r.text).recordChaines ? 'chaine' : 'objet', info: constantes.get(r.text), constante: false });
    } else if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && ['find', 'at'].includes(init.expression.name.text)) {
      const r = deballer(init.expression.expression);
      if (ts.isIdentifier(r) && constantes.has(r.text) && !derives.has(v.name.text)) derives.set(v.name.text, { genre: 'objet', info: constantes.get(r.text), constante: false });
    }
  }
  let change = true; let tours = 0;
  const maps = [];
  const collecter = (n) => { if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'map' && n.arguments[0] && (ts.isArrowFunction(n.arguments[0]) || ts.isFunctionExpression(n.arguments[0]))) maps.push(n); ts.forEachChild(n, collecter); };
  collecter(sf);
  while (change && tours < 6) {
    change = false; tours += 1;
    for (const call of maps) {
      const source = call.expression.expression;
      const rac = racineDe(source);
      if (!rac || !derives.has(rac)) continue;
      const cb = call.arguments[0]; const p0 = cb.parameters[0]; if (!p0) continue;
      const parent = derives.get(rac);
      const dp = dernierProp(source);
      let genre;
      if (parent.constante && !dp) genre = parent.info.elementsChaines ? 'chaine' : 'objet';
      else if (dp && propsTableau.has(dp)) genre = 'chaine';
      else if (!parent.constante && ['objet-tableau', 'objet'].includes(parent.genre)) genre = null;
      else genre = null;
      if (!genre) continue;
      const noms = [];
      if (ts.isIdentifier(p0.name)) noms.push([p0.name.text, genre]);
      else if (ts.isObjectBindingPattern(p0.name) && genre === 'objet') for (const el of p0.name.elements) { const prop = (el.propertyName || el.name).getText(); if (propsTexte.has(prop) && ts.isIdentifier(el.name)) noms.push([el.name.text, 'chaine']); else if (propsTableau.has(prop) && ts.isIdentifier(el.name)) noms.push([el.name.text, 'objet-tableau-chaines']); }
      else if (ts.isArrayBindingPattern(p0.name)) continue;
      for (const [nom, g] of noms) { if (!derives.has(nom) || derives.get(nom).genre !== g) { derives.set(nom, { genre: g, info: parent.info, constante: false }); change = true; } }
    }
  }

  // 3. sites d'affichage
  const edits = []; const composants = new Map();
  const enveloppe = (expr, comp) => { edits.push({ debut: expr.getStart(), fin: expr.end, texte: `${HOOK}.fr(${expr.getText()})` }); composants.set(comp, true); res.branches += 1; };
  const estSiteTexte = (jsxExpr) => {
    const p = jsxExpr.parent;
    if (ts.isJsxAttribute(p)) return ATTRS.has(p.name.getText());
    return ts.isJsxElement(p) || ts.isJsxFragment(p);
  };
  const siteValide = (e) => {
    const x = deballer(e);
    // {P}
    if (ts.isIdentifier(x)) { const d = derives.get(x.text); return !!d && !d.constante && d.genre === 'chaine'; }
    // {P.prop} / {P?.prop}
    if (ts.isPropertyAccessExpression(x)) {
      const base = deballer(x.expression);
      if (ts.isIdentifier(base)) { const d = derives.get(base.text); if (d && !d.constante && d.genre === 'objet' && propsTexte.has(x.name.text)) return true; }
      // {CONST[clé].prop}
      if (ts.isElementAccessExpression(base)) { const r = racineDe(base.expression); if (r && constantes.has(r) && propsTexte.has(x.name.text)) return true; }
      return false;
    }
    // {themeLabel(x)} : fonction de libellé déclarée dans --fonctions
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && FONCTIONS.has(x.expression.text)) return true;
    // {CONST[clé]}
    if (ts.isElementAccessExpression(x)) { const r = deballer(x.expression); return ts.isIdentifier(r) && constantes.has(r.text) && constantes.get(r.text).recordChaines; }
    return false;
  };
  const visiteSites = (n) => {
    if (ts.isJsxExpression(n) && n.expression && estSiteTexte(n)) {
      if (siteValide(n.expression)) { const comp = composantDe(n); if (comp) enveloppe(n.expression, comp); else res.nonBranches += 1; }
    }
    ts.forEachChild(n, visiteSites);
  };
  visiteSites(sf);
  if (!edits.length) { res.textes = []; return { res, nouveau: null }; }

  // 4. hook + import
  const ns = `ui.${slugFichier(rel)}`;
  for (const f of composants.keys()) {
    if (!f.body) continue;
    if (ts.isBlock(f.body)) {
      if (src.slice(f.body.getStart(), f.body.end).includes(`const ${HOOK} =`)) continue;
      edits.push({ debut: f.body.getStart() + 1, fin: f.body.getStart() + 1, texte: `\n  const ${HOOK} = useTranslations('${ns}');` });
    } else {
      edits.push({ debut: f.body.getStart(), fin: f.body.getStart(), texte: `{ const ${HOOK} = useTranslations('${ns}'); return ` });
      edits.push({ debut: f.body.end, fin: f.body.end, texte: '; }' });
    }
  }
  if (!/import\s*\{[^}]*\buseTranslations\b[^}]*\}\s*from\s*['"]@\/i18n\/client['"]/.test(src)) {
    const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
    const pos = imports.length ? imports[imports.length - 1].end : (client ? sf.statements[0].end : 0);
    edits.push({ debut: pos, fin: pos, texte: `\nimport { useTranslations } from '@/i18n/client';` });
  }
  edits.sort((a, b) => (b.debut - a.debut) || (b.fin - a.fin));
  let nouveau = src; for (const e of edits) nouveau = nouveau.slice(0, e.debut) + e.texte + nouveau.slice(e.fin);
  return { res, nouveau };
}

const fichiers = entrees.flatMap((e) => lister(e)).filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\./.test(f) && !/\.d\.ts$/.test(f) && !sauf.some((x) => f.includes(`/${x}/`)));
const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
catalogue.ui = catalogue.ui || {}; catalogue.ui.libelles = catalogue.ui.libelles || {};
let fichiersTouches = 0; let branches = 0; let nouveauxTextes = 0; let sansSite = 0;
for (const f of fichiers) {
  let r; try { r = traiter(f); } catch (e) { console.error('ERREUR', f, e.message); continue; }
  if (r.nouveau) {
    fichiersTouches += 1; branches += r.res.branches;
    for (const t of r.res.textes) { const h = empreinte(t); if (!catalogue.ui.libelles[h]) { catalogue.ui.libelles[h] = normaliser(t); nouveauxTextes += 1; } }
    if (appliquer) fs.writeFileSync(f, r.nouveau);
  } else if (r.res.textes.length) sansSite += r.res.textes.length;
}
if (appliquer) fs.writeFileSync(CATALOGUE, JSON.stringify(catalogue, null, 2) + '\n');
console.log(`${appliquer ? 'APPLIQUÉ' : 'PLAN'} : ${branches} sites d'affichage branchés dans ${fichiersTouches} fichiers, ${nouveauxTextes} libellés enregistrés ; ${sansSite} libellés de fichiers sans site reconnu (non branchés)`);
