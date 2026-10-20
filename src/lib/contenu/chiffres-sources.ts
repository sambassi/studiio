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
 * Noms qui PORTENT un chiffre sans être une statistique (« oméga-3 »,
 * « vitamine B12 », « CO2 ») : masqués avant le filtre, rendus après.
 */
function masquerNoms(t: string): { texte: string; rendre: (x: string) => string } {
  const noms: string[] = [];
  const texte = t.replace(/[A-WYZa-wyzÀ-ÿ]-?\d+(?![\d%])/g, (m) => {
    noms.push(m);
    return `\uE000${String.fromCharCode(0xE100 + noms.length - 1)}`;
  });
  return { texte, rendre: (x) => x.replace(/\uE000([\uE100-\uEFFF])/g, (_, c: string) => noms[c.charCodeAt(0) - 0xE100] ?? '') };
}

/** Citation d'étude, de revue ou d'institution : jamais une phrase utile. */
const CITATION = /\b(?:étude|etude|études|etudes|selon|nejm|harvard|lancet|universit[ée]|study|journal|chercheurs|recherche publiée)\b/i;
const mots = (t: string) => t.split(/\s+/).filter((m) => /[A-Za-zÀ-ÿ]/.test(m));

/**
 * Une phrase qui reste lisible une fois nettoyée : au moins quatre mots,
 * un mot qui peut être un verbe conjugué / infinitif, et pas une citation.
 */
export function phraseLisible(p: string): boolean {
  const m = mots(p);
  if (m.length < 4 || CITATION.test(p)) return false;
  return m.some((w) => /^(?:est|sont|a|as|ont|va|vas|font|fait|peut|peux|doit|dois|aide|rend)$/i.test(w.replace(/[^\p{L}]/gu, ''))
    || /(?:er|ir|re|ent|ons|ez|e|es|is|it|ait|aient)$/i.test(w.replace(/[^\p{L}]/gu, '')));
}

/**
 * Une phrase sans chiffre inventé. Une PHRASE (« . ! ? ») porteuse d'un
 * chiffre non soutenu est RETIRÉE entière — jamais réparée sur place (une
 * réparation laissait « La danse sollicite muscles. »). Si le texte avait un
 * chiffre, les phrases restantes trop courtes, sans verbe ou réduites à une
 * citation sont retirées aussi. Plus rien : `''` (l'appelant prend un repli
 * qualitatif, `carteSansChiffresInventes`).
 */
export function texteSansChiffresInventes(texte: string | null | undefined, autorises: ReadonlySet<string>): string {
  const brut = borne(texte).trim();
  if (!brut) return brut;
  const { texte: t, rendre } = masquerNoms(brut);
  if (!A_UN_CHIFFRE.test(t) || chiffresSoutenus(t, autorises)) return brut;
  const phrases = t.match(/[^.!?…]+[.!?…]*/g)?.map((p) => p.trim()).filter(Boolean) ?? [t];
  const gardees = phrases
    .filter((p) => chiffresSoutenus(p, autorises))
    .map((p) => rendre(p))
    .filter((p) => phraseLisible(p));
  if (!gardees.length) return '';
  const out = majusculeInitiale(gardees.join(' ').trim());
  return /[.!?…]$/.test(out) ? out : `${out}.`;
}

/** Titre de carte sans chiffre inventé (« VOLS -40% » → « VOLS »). Jamais vide si l'original ne l'était pas. */
export function titreSansChiffresInventes(titre: string | null | undefined, autorises: ReadonlySet<string>): string {
  const brut = borne(titre, 200).trim();
  const { texte: t, rendre } = masquerNoms(brut);
  if (!t || !A_UN_CHIFFRE.test(t) || chiffresSoutenus(t, autorises)) return brut;
  let out = retirerChiffres(t, autorises);
  while (FIN_ORPHELINE.test(out)) out = out.replace(FIN_ORPHELINE, '');
  return rendre(out || t.replace(/[\d.,+\-−–~≈%★×/]+/g, ' ').replace(/\s{2,}/g, ' ').trim()) || brut;
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

/** Texte comparable : sans accents, minuscules, lettres et chiffres seulement (mots conservés). */
function motsNormalises(t: string | null | undefined): string[] {
  return borne(t, 200).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * La valeur ne fait-elle que RÉPÉTER le libellé ? Constat (MP4 « MOTIVATION »,
 * 20/10) : « DOPA / DOPAMINE ANTICIP. », « PROC / PROCESS > GOAL »,
 * « BOUCLE / BOUCLE HABITUDE » — un badge qui redit le titre, tronqué, sans
 * rien apprendre. 109 cartes sur 696 de la base locale avaient une valeur
 * égale à un mot du titre, 48 un préfixe. Redondante (accents, casse et
 * ponctuation ignorés) si elle est :
 *   - un mot du titre, ou une suite de mots du titre (« PROCESS GOAL ») ;
 *   - le début tronqué d'un mot du titre (≥ 2 lettres : « DOPA », « IDENT ») ;
 *   - le début tronqué du titre entier (« BOUCLEHAB »).
 * Une valeur porteuse d'information propre (« ANCRÉ » pour « HABIT
 * STACKING », « +ÉNERGIE », « 3-en-1 ») est gardée. Pure.
 */
export function valeurRedondante(valeur: string | null | undefined, titre: string | null | undefined): boolean {
  const v = motsNormalises(valeur);
  const t = motsNormalises(titre);
  if (!v.length || !t.length) return false;
  const joint = v.join('');
  if (v.every((m) => t.includes(m))) return true;
  if (v.length === 1 && joint.length >= 2 && t.some((m) => m.startsWith(joint))) return true;
  return joint.length >= 2 && t.join('').startsWith(joint);
}

/** Repli qualitatif d'une carte vidée : « Un point clé à retenir : bagage cabine. » */
export function descriptionDeSecours(titre: string): string {
  const t = titre.trim().toLowerCase().replace(/[.!?…:]+$/, '');
  return `Un point clé à garder en tête : ${t}.`;
}

export interface CarteTexte { title?: string; label?: string; description?: string; value?: string }

/**
 * Une carte générée, nettoyée : aucun chiffre que l'utilisateur n'a pas écrit,
 * et jamais la valeur répétée dans le titre. Les autres champs sont gardés.
 */
export function carteSansChiffresInventes<T extends CarteTexte>(carte: T, autorises: ReadonlySet<string>): T {
  const chiffree = valeurSansChiffresInventes(carte.value, autorises);
  // Valeur qui ne fait que redire le libellé (« DOPA » / « DOPAMINE
  // ANTICIP. ») : vidée — la carte s'affiche titre + icône (`badgeValide`).
  const value = valeurRedondante(chiffree, carte.title ?? carte.label) ? '' : chiffree;
  const out: T = { ...carte };
  if (typeof carte.value === 'string') out.value = value;
  if (typeof carte.title === 'string') out.title = titreSansValeur(titreSansChiffresInventes(carte.title, autorises), value);
  if (typeof carte.label === 'string') out.label = titreSansValeur(titreSansChiffresInventes(carte.label, autorises), value);
  if (typeof carte.description === 'string') {
    out.description = texteSansChiffresInventes(carte.description, autorises);
    // Plus rien de lisible : une phrase qualitative tirée du titre.
    const titre = (out.title ?? out.label ?? '').trim();
    if (!out.description && carte.description.trim() && titre) out.description = descriptionDeSecours(titre);
  }
  return out;
}

/** Consigne commune des prompts de génération (Créer, Autopilote). */
export const CONSIGNE_SANS_CHIFFRES = 'N’invente AUCUN chiffre, pourcentage, durée, poids, prix, réduction ni promesse de résultat ou de santé : '
  + 'un nombre n’est permis que s’il figure dans le sujet ou le brief de l’utilisateur. Sinon, formule de façon qualitative '
  + '(« moins cher », « plus léger », « au bon moment ») et laisse la valeur courte et sans chiffre (ex. « CLÉ », « MALIN », « ASTUCE »).';
