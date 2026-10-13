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

/** Le message quand aucune forme dite DIFFÉRENTE n'existe : le champ n'est pas touché. */
export const MESSAGE_AUCUNE_SUGGESTION = 'Aucune suggestion de prononciation différente trouvée.';

/**
 * Une suggestion n'est UTILE que si elle diffère du texte affiché (même
 * normalisation que l'enregistrement). Sinon `null` : on ne simule jamais une
 * correction en rendant le même texte.
 */
export function suggestionUtile(affiche: string, suggestion: string | null | undefined): string | null {
  const s = (suggestion ?? '').trim();
  if (!s || prononciationIdentique(affiche, s)) return null;
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
  if (cleAffiche(net) === cleAffiche(propre(affiche))) return null;
  return net;
}
