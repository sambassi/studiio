/**
 * « Suggérer » une prononciation — une PROPOSITION de forme dite pour un
 * texte affiché, calculée localement, sans réseau.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE ÇA FAIT, ET CE QUE ÇA NE FAIT JAMAIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   - Le texte AFFICHÉ n'est jamais modifié : on rend une forme dite à part.
 *   - Rien n'est enregistré : la suggestion remplit un champ modifiable,
 *     l'enregistrement reste le bouton « Enregistrer » existant.
 *   - On RÉUTILISE la normalisation du moteur vocal (`normaliserPourTTS` :
 *     « 3-en-1 », « % », « 24h/24 », « 10x », unités, NEJM…), puis trois
 *     règles propres à une entrée courte :
 *       1. les nombres entiers de 0 à 99 s'écrivent en lettres
 *          (`nombreEnLettres`) — « -33 % » → « moins trente-trois pour cent » ;
 *       2. un mot EN CAPITALES qui est un vrai mot français (petit lexique,
 *          lettre accentuée, ou mot long) est remis en minuscules —
 *          « OS RENFORCÉS » → « os renforcés » ;
 *       3. un vrai sigle se dit comme un mot s'il est connu (« HIIT » →
 *          « hit »), sinon il est épelé lettre par lettre (« ADN » → « A D N »).
 *
 * `incertain` dit quand la règle locale ne sait pas : rien n'a changé (un nom
 * propre comme « Afroboost »), ou un sigle inconnu a été épelé. C'est le seul
 * cas où l'écran demande l'aide du serveur.
 */
import { normaliserPourTTS, nombreEnLettres } from '@/lib/voice/normalisation-tts';
import { cleAffiche, MAX_LONGUEUR_PRONONCIATION, prononciationIdentique } from '@/lib/voice/prononciations';

/** Le message quand aucune forme dite FIABLE n'existe : le champ n'est pas touché. */
export const MESSAGE_AUCUNE_SUGGESTION = 'Aucune suggestion fiable — vous pouvez saisir la prononciation vous-même.';

/** Réponse exacte attendue du modèle quand la prononciation est déjà correcte. */
export const REPONSE_AUCUNE = 'AUCUNE';

/**
 * Clé phonétique GROSSIÈRE : minuscules, sans accents, sans ponctuation ni
 * tirets, lettres doublées réduites, sans espaces. « lien en bio » et
 * « Lien-en-bioo » ont la même clé : la voix les dit pareil.
 */
export function clePhonetique(t: string): string {
  return (t ?? '')
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/(.)\1+/gu, '$1');
}

/** Distance d'édition (Levenshtein), en points de code. */
export function distanceEdition(a: string, b: string): number {
  const x = Array.from(a); const y = Array.from(b);
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prec = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    const cour = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prec = cour;
  }
  return prec[y.length];
}

const RE_CHIFFRE = /\p{N}/u;
const RE_SIGLE = /(?<![\p{L}\p{N}])\p{Lu}{2,}(?![\p{L}\p{N}])/gu;
const RE_GROUPE_CHIFFRES = /\p{N}+(?:[ ,.]\p{N}+)*/gu;

/**
 * Nombre de « transformations » légitimes dans le texte affiché : groupes de
 * chiffres et sigles. Elles seules justifient une forme dite très éloignée
 * (« 3 » → « trois », « ADN » → « A D N ») ou de même clé (« HIIT » → « hit »).
 */
function transformationsChiffreSigle(affiche: string): number {
  return (affiche.match(RE_GROUPE_CHIFFRES)?.length ?? 0) + (affiche.match(RE_SIGLE)?.length ?? 0);
}

const nbMots = (t: string) => t.split(/\s+/).filter(Boolean).length;

/**
 * Expression française ORDINAIRE : en minuscules, sans chiffre ni sigle ni
 * nom propre (aucune capitale). La voix la dit déjà correctement : inutile
 * d'interroger un modèle (coût, et risque de « bioo »).
 */
export function expressionOrdinaire(affiche: string): boolean {
  const t = (affiche ?? '').trim();
  return t.length > 0 && !RE_CHIFFRE.test(t) && !/\p{Lu}/u.test(t);
}

/**
 * Une suggestion n'est UTILE que si elle est FIABLE. Sinon `null` : on ne
 * simule jamais une correction.
 *  - vide, « AUCUNE », ou identique au texte (même normalisation que
 *    l'enregistrement) → null ;
 *  - sans chiffre ni sigle à transformer :
 *      · même clé phonétique grossière → null (« lien en bio » / « Lien-en-bioo ») ;
 *      · micro-variation : distance ≤ 2 ou ratio < 0,2 → null (« bioo ») ;
 *      · non plausible : ratio > 0,8 ou plus de deux fois plus de mots → null ;
 *  - avec chiffres / sigles : seule une forme démesurée est refusée
 *    (plus de 2 × mots + 4 par transformation).
 */
export function suggestionUtile(affiche: string, suggestion: string | null | undefined): string | null {
  const s = (suggestion ?? '').trim();
  if (!s || s.toLocaleUpperCase('fr') === REPONSE_AUCUNE || prononciationIdentique(affiche, s)) return null;
  const a = (affiche ?? '').trim();
  const transfos = transformationsChiffreSigle(a);
  const motsA = Math.max(1, nbMots(a));
  if (transfos > 0) return nbMots(s) > 2 * motsA + 4 * transfos ? null : s;
  const ka = clePhonetique(a);
  const ks = clePhonetique(s);
  if (ka === ks) return null;
  const d = distanceEdition(ka, ks);
  const ratio = d / Math.max(ka.length, ks.length, 1);
  if (d <= 2 || ratio < 0.2) return null;
  if (ratio > 0.8 || nbMots(s) > 2 * motsA) return null;
  return s;
}

export interface SuggestionLocale {
  /** La forme dite proposée (peut être vide si l'entrée l'est). */
  suggestion: string;
  /** Vrai quand la règle locale n'a rien pu déterminer de sûr. */
  incertain: boolean;
  /** Les sigles inconnus épelés lettre par lettre. */
  siglesEpeles: string[];
}

const MOT = '\\p{L}\\p{N}\\p{M}';

/** Mots courts écrits en capitales qui sont de VRAIS mots français (ou d'usage courant). */
const MOTS_COURANTS = new Set([
  'os', 'et', 'ou', 'où', 'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'au', 'aux', 'en', 'à',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'nos', 'vos', 'leur', 'ce', 'ces',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'qui', 'que', 'quoi',
  'tout', 'tous', 'plus', 'sans', 'avec', 'pour', 'par', 'sur', 'sous', 'non', 'oui', 'mais', 'donc',
  'vie', 'corps', 'dos', 'bras', 'cou', 'pied', 'pieds', 'main', 'mains', 'cœur', 'peau', 'yeux', 'tête',
  'fort', 'forte', 'forts', 'sain', 'saine', 'sains', 'bio', 'neuf', 'zen', 'yoga', 'gym', 'abdos',
  'top', 'super', 'max', 'mini', 'ultra', 'extra', 'pro', 'fit', 'fun', 'go', 'stop', 'new',
  'kilo', 'kilos', 'cours', 'club', 'danse', 'sport', 'coach', 'force', 'bien', 'mal', 'vite',
  'gras', 'sucre', 'sel', 'eau', 'lait', 'pain', 'riz', 'fruit', 'jour', 'jours', 'nuit', 'an', 'ans',
  'offre', 'prix', 'promo', 'gratuit', 'vrai', 'faux', 'mieux', 'moins', 'très', 'trop', 'fois',
]);

/** Sigles qui se DISENT comme un mot. NEJM est déjà géré par `normaliserPourTTS`. */
const SIGLES_DITS: Record<string, string> = {
  HIIT: 'hit',
  COVID: 'covid',
  NASA: 'nasa',
  OTAN: 'otan',
  UNESCO: 'unesco',
};

const LETTRE_ACCENTUEE = /[àâäéèêëîïôöùûüÿçœæ]/;
/** Au-delà de cette longueur, un mot en capitales est un mot, pas un sigle. */
const LONGUEUR_MOT = 6;

/** Espaces normalisés, sans caractères de contrôle. */
function propre(valeur: unknown): string {
  if (typeof valeur !== 'string') return '';
  return valeur.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Les entiers de 0 à 99, seuls (ni décimale, ni milliers, ni collés à un mot). */
function nombresEnLettres(t: string): string {
  return t.replace(new RegExp(`(?<![${MOT},])\\d+(?: \\d{3})*(?:,\\d+)?(?![${MOT}])`, 'gu'), (m) => {
    if (!/^\d+$/.test(m)) return m;
    return nombreEnLettres(Number(m)) ?? m;
  });
}

/** Les mots en capitales : vrai mot → minuscules ; sigle → dit ou épelé. */
function capitales(t: string, epeles: string[]): string {
  return t.replace(new RegExp(`(?<![${MOT}])\\p{Lu}{2,}(?![${MOT}])`, 'gu'), (mot) => {
    const dit = SIGLES_DITS[mot];
    if (dit) return dit;
    const minuscule = mot.toLocaleLowerCase('fr');
    if (MOTS_COURANTS.has(minuscule) || LETTRE_ACCENTUEE.test(minuscule) || mot.length >= LONGUEUR_MOT) return minuscule;
    epeles.push(mot);
    return mot.split('').join(' ');
  });
}

/**
 * La suggestion LOCALE — pure, déterministe, sans réseau. Le texte affiché
 * reçu n'est jamais modifié (chaînes immuables).
 */
export function suggererPrononciationLocale(affiche: string): SuggestionLocale {
  const source = propre(affiche);
  if (!source) return { suggestion: '', incertain: true, siglesEpeles: [] };
  const siglesEpeles: string[] = [];
  let t = normaliserPourTTS(source);
  t = nombresEnLettres(t);
  t = capitales(t, siglesEpeles);
  const suggestion = t.replace(/\s+/g, ' ').trim().slice(0, MAX_LONGUEUR_PRONONCIATION).trim();
  const incertain = !suggestion || cleAffiche(suggestion) === cleAffiche(source) || siglesEpeles.length > 0;
  return { suggestion, incertain, siglesEpeles };
}

/**
 * Nettoie une forme dite venue d'ailleurs (la réponse d'un modèle) : une
 * seule ligne, sans guillemets, bornée. `null` si elle est inutilisable
 * (vide, trop longue, ou identique au texte affiché).
 */
export function nettoyerSuggestion(brut: unknown, affiche: string): string | null {
  if (typeof brut !== 'string') return null;
  const premiereLigne = brut.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const sansGuillemets = premiereLigne.replace(/^[«"“'`\s]+|[»"”'`\s]+$/g, '');
  const net = propre(sansGuillemets);
  if (!net || net.length > MAX_LONGUEUR_PRONONCIATION) return null;
  // « AUCUNE » : le modèle juge la prononciation déjà correcte.
  if (net.replace(/[.!\s]+$/, '').toLocaleUpperCase('fr') === REPONSE_AUCUNE) return null;
  if (cleAffiche(net) === cleAffiche(propre(affiche))) return null;
  return net;
}
