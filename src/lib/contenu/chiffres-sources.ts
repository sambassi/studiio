/**
 * AUCUN CHIFFRE INVENTÉ — filtre partagé des textes GÉNÉRÉS (Créer + Autopilote).
 *
 * Les générateurs (base locale `smart-content`, IA de `/api/content/ai-generate`)
 * produisaient des statistiques, pourcentages et promesses sans source :
 * « VOLS -40% », « 7 kg = 10 jours », « +40 % de globules blancs »… Un chiffre
 * n'est gardé QUE s'il figure dans ce que l'utilisateur a lui-même écrit
 * (sujet, brief, CTA). Sinon il est retiré, et la phrase reste qualitative :
 *
 *   - VALEUR d'une carte : vidée (la carte s'affiche sans badge chiffré) ;
 *   - TITRE : le nombre et son unité sont retirés (« VOLS -40% » → « VOLS ») ;
 *   - DESCRIPTION / sous-titre : la phrase qui porte le chiffre est retirée
 *     s'il en reste une autre ; sinon le chiffre est retiré avec ses
 *     prépositions (« jusqu'à 40 % moins chers » → « moins chers »).
 *
 * Valeur répétée dans le titre (« -40% » + « VOLS -40% » = « -40% VOLS -40% »
 * à l'écran) : le titre perd la valeur (`titreSansValeur`).
 *
 * Module PUR, déterministe, sans réseau.
 */

/** Une expression chiffrée : signe, nombre, unité éventuelle. */
const UNITE = String.raw`(?:\s?(?:%|★|\*|×\s?\d*|x\s?\d+|x(?![a-zà-ÿ])|/\s?\d+(?:\s?[a-zà-ÿ]+)?|(?:ans?|jours?|semaines?|mois|heures?|minutes?|secondes?|fois|nuits?|pas|litres?|euros?|kcal|cal|kg|mg|ml|km|cm|g|l|h|min|mn|s|j|k)(?![a-zà-ÿ])|€|\$|chf(?![a-zà-ÿ])))?`;
const NOMBRE = String.raw`(?:[+\-−–~≈]\s?)?(?:[x×]\s?)?\d+(?:[.,]\d+)?`;
const EXPR = `${NOMBRE}${UNITE}`;
/** Expressions précédées d'une préposition qui n'a plus de sens sans le chiffre. */
const AVEC_PREPOSITION = new RegExp(
  String.raw`(?:\b(?:entre|de|du|d['’])\s*${EXPR}\s*(?:et|à|a|-|–)\s*${EXPR})|(?:\b(?:jusqu['’]à|jusqu['’]a|plus\s+de|plus\s+d['’]|moins\s+de|moins\s+d['’]|près\s+de|pres\s+de|environ|au\s+moins|au\s+plus|de|d['’]|en|par|pour|sur|à|a)\s*${EXPR}(?![\d]))`,
  'gi',
);
const SEULE = new RegExp(`${EXPR}`, 'gi');
const A_UN_CHIFFRE = /\d/;
/**
 * ⚠️ Textes générés (IA comprise) : longueur bornée AVANT toute regex, pour
 * qu'aucun motif à quantificateurs voisins (`\s*…\s?`, classes ancrées en
 * fin) ne puisse dégénérer sur une entrée démesurée.
 */
const MAX_TEXTE = 600;
const borne = (t: string | null | undefined, max = MAX_TEXTE) => (t ?? '').slice(0, max);

/** Les nombres d'un texte, normalisés (« 40 », « 1.5 »). */
function nombresDe(t: string): string[] {
  return Array.from((t || '').matchAll(/\d+(?:[.,]\d+)?/g)).map((m) => m[0].replace(',', '.').replace(/^0+(?=\d)/, ''));
}

/** Les nombres que l'utilisateur a écrits lui-même : seuls ceux-là peuvent apparaître. */
export function chiffresAutorises(...textes: Array<string | null | undefined>): Set<string> {
  return new Set(textes.flatMap((t) => nombresDe(borne(t, 4000))));
}

/** Tous les nombres de `t` viennent-ils de l'utilisateur ? */
export function chiffresSoutenus(t: string, autorises: ReadonlySet<string>): boolean {
  return nombresDe(t).every((n) => autorises.has(n));
}

const PREPOSITIONS_ORPHELINES = /^(?:(?:sur|de|des|du|en|à|a|au|aux|pour|par|avec|et|ou)\b|d['’]|l['’]|=|\+|-|–|:)/i;
/** Mot resté en fin de fragment une fois le chiffre retiré (« avant », « divisé par »). */
const FIN_ORPHELINE = /\s+(?:avant|après|apres|de|du|des|en|par|pendant|sur|à|a|pour|divisée?s?|multipliée?s?|toutes|tous|les|le|la|chaque|=|\+|-|–|×|x)$/i;

function nettoyerEspaces(t: string): string {
  return t
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.…])/g, '$1')
    .replace(/\s*=\s*(?=[,.;:!?]|$)/g, '')
    .replace(/^[\s,.;:=+\-–—]+/, '')
    .replace(/[\s,;:=+\-–—]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Retire les expressions chiffrées NON soutenues, prépositions comprises. */
function retirerChiffres(t: string, autorises: ReadonlySet<string>): string {
  const garder = (m: string) => chiffresSoutenus(m, autorises);
  let out = t.replace(AVEC_PREPOSITION, (m) => (garder(m) ? m : ' '));
  out = out.replace(SEULE, (m) => (garder(m) ? m : ' '));
  return nettoyerEspaces(out);
}

const majusculeInitiale = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/**
 * Une phrase sans chiffre inventé. Phrases (« . ! ? ») porteuses d'un chiffre
 * non soutenu retirées s'il en reste une autre ; sinon le chiffre est retiré
 * sur place, fragment par fragment (un fragment qui ne commence plus que par
 * une préposition orpheline — « sur les hôtels » — est retiré).
 */
export function texteSansChiffresInventes(texte: string | null | undefined, autorises: ReadonlySet<string>): string {
  const t = borne(texte).trim();
  if (!t || !A_UN_CHIFFRE.test(t) || chiffresSoutenus(t, autorises)) return t;
  const phrases = t.match(/[^.!?…]+[.!?…]*/g)?.map((p) => p.trim()).filter(Boolean) ?? [t];
  const saines = phrases.filter((p) => chiffresSoutenus(p, autorises));
  if (saines.length > 0 && saines.length < phrases.length) return majusculeInitiale(saines.join(' ').trim());
  const fragments = t.split(/(\s*[,;:]\s*)/);
  const gardes: string[] = [];
  for (let i = 0; i < fragments.length; i += 2) {
    const brut = fragments[i];
    const sep = fragments[i + 1] ?? '';
    let f = brut;
    if (!chiffresSoutenus(brut, autorises)) {
      f = retirerChiffres(brut, autorises);
      while (FIN_ORPHELINE.test(f)) f = f.replace(FIN_ORPHELINE, '');
      // Retiré en tête : la préposition restée seule n'a plus de sens.
      if (PREPOSITIONS_ORPHELINES.test(f) || f.split(/\s+/).filter(Boolean).length < 2) f = '';
    }
    if (f.trim()) gardes.push(f.trim() + sep);
  }
  let out = nettoyerEspaces(gardes.join('').replace(/\s*[,;:]\s*$/, ''));
  if (!out) {
    // Rien de lisible fragment par fragment : le texte entier, chiffres retirés,
    // sans les prépositions restées en tête (« de danse = … » → « danse = … »).
    out = retirerChiffres(t, autorises);
    const TETE = /^(?:(?:sur|de|des|du|en|à|a|au|aux|pour|par|avec|et|ou|qui)\s+|d['’]|l['’]|[=+\-–:]\s*)/i;
    while (TETE.test(out)) out = out.replace(TETE, '');
    while (FIN_ORPHELINE.test(out)) out = out.replace(FIN_ORPHELINE, '');
    if (out.split(/\s+/).filter(Boolean).length < 2) return '';
  }
  const fin = /[.!?…]$/.test(t) && !/[.!?…]$/.test(out) ? '.' : '';
  return majusculeInitiale(out) + fin;
}

/** Titre de carte sans chiffre inventé (« VOLS -40% » → « VOLS »). Jamais vide si l'original ne l'était pas. */
export function titreSansChiffresInventes(titre: string | null | undefined, autorises: ReadonlySet<string>): string {
  const t = borne(titre, 200).trim();
  if (!t || !A_UN_CHIFFRE.test(t) || chiffresSoutenus(t, autorises)) return t;
  const out = retirerChiffres(t, autorises);
  return out || t.replace(/[\d.,+\-−–~≈%★×/]+/g, ' ').replace(/\s{2,}/g, ' ').trim() || t;
}

/** Valeur d'une carte : vidée si elle porte un chiffre non soutenu (« -40% » → « »). */
export function valeurSansChiffresInventes(valeur: string | null | undefined, autorises: ReadonlySet<string>): string {
  const v = borne(valeur, 60).trim();
  if (!v || !A_UN_CHIFFRE.test(v)) return v;
  return chiffresSoutenus(v, autorises) ? v : '';
}

/** Le titre sans la valeur qu'il répète (« VOLS -40% » avec la valeur « -40% » → « VOLS »). */
export function titreSansValeur(titre: string, valeur: string | null | undefined): string {
  const v = borne(valeur, 60).trim();
  // Seule une valeur CHIFFRÉE se répète à l'écran (« -40% VOLS -40% ») ; un
  // mot (« GROOVE ») peut légitimement ouvrir le titre.
  if (!v || !titre || !A_UN_CHIFFRE.test(v)) return titre;
  const echappe = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  const out = titre.replace(new RegExp(`(^|\\s)${echappe}(?=\\s|$)`, 'i'), ' ').replace(/\s{2,}/g, ' ').trim();
  return out || titre;
}

export interface CarteTexte { title?: string; label?: string; description?: string; value?: string }

/**
 * Une carte générée, nettoyée : aucun chiffre que l'utilisateur n'a pas écrit,
 * et jamais la valeur répétée dans le titre. Les autres champs sont gardés.
 */
export function carteSansChiffresInventes<T extends CarteTexte>(carte: T, autorises: ReadonlySet<string>): T {
  const value = valeurSansChiffresInventes(carte.value, autorises);
  const out: T = { ...carte };
  if (typeof carte.value === 'string') out.value = value;
  if (typeof carte.title === 'string') out.title = titreSansValeur(titreSansChiffresInventes(carte.title, autorises), value);
  if (typeof carte.label === 'string') out.label = titreSansValeur(titreSansChiffresInventes(carte.label, autorises), value);
  if (typeof carte.description === 'string') out.description = texteSansChiffresInventes(carte.description, autorises);
  return out;
}

/** Consigne commune des prompts de génération (Créer, Autopilote). */
export const CONSIGNE_SANS_CHIFFRES = 'N’invente AUCUN chiffre, pourcentage, durée, poids, prix, réduction ni promesse de résultat ou de santé : '
  + 'un nombre n’est permis que s’il figure dans le sujet ou le brief de l’utilisateur. Sinon, formule de façon qualitative '
  + '(« moins cher », « plus léger », « au bon moment ») et laisse la valeur courte et sans chiffre (ex. « CLÉ », « MALIN », « ASTUCE »).';
