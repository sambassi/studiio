/**
 * Prononciations personnalisées — ce qui est AFFICHÉ, et ce qui est DIT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX TEXTES, JAMAIS CONFONDUS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   DISPLAY_SCRIPT  ce que la personne écrit et voit — jamais modifié.
 *   SPOKEN_SCRIPT   ce qui part au moteur vocal — le même texte, où chaque
 *                   mot d'une prononciation est remplacé par sa forme dite.
 *
 * `scriptParle()` est LA fonction commune : l'écran d'aperçu, l'écoute, et
 * plus tard Créer et l'Autopilote, doivent tous passer par elle. Elle est
 * pure et déterministe : mêmes entrées, même sortie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA POLITIQUE DE CORRESPONDANCE, ÉCRITE NOIR SUR BLANC
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   - MOT ENTIER : « Afroboost » ne touche pas « Afroboosté » ni
 *     « superAfroboost ». Les frontières sont Unicode (lettres, chiffres,
 *     et marques combinantes) : les accents comptent comme des lettres ;
 *   - INSENSIBLE À LA CASSE : « afroboost », « AFROBOOST » et « Afroboost »
 *     sont le même mot — on l'a enregistré pour qu'il soit bien dit, pas
 *     pour une graphie précise. Les accents, eux, ne sont PAS repliés :
 *     « Neuchâtel » et « Neuchatel » sont deux mots ;
 *   - UNE SEULE PASSE : les formes dites ne sont jamais re-remplacées
 *     (« Afroboost → Afro » puis « Afro → X » ne s'enchaînent pas) ;
 *   - LE PLUS LONG D'ABORD : « Cours Afroboost » l'emporte sur
 *     « Afroboost » quand les deux s'appliquent au même endroit ;
 *   - AUCUNE REGEX UTILISATEUR : le texte affiché est échappé
 *     littéralement. Une correspondance simple suffit.
 *
 * Une entrée est identifiée par son texte affiché, comparé sans casse et
 * sans espaces superflus : deux entrées « Afroboost » et « afroboost » sont
 * un doublon.
 */

export interface Prononciation {
  /** Le mot ou groupe tel qu'il est écrit dans le texte. */
  affiche: string;
  /** Ce que le moteur vocal doit dire à la place. */
  prononce: string;
}

export const MAX_PRONONCIATIONS = 100;
export const MAX_LONGUEUR_PRONONCIATION = 80;

/** Espaces normalisés, sans caractères de contrôle. */
function normaliser(valeur: unknown): string {
  if (typeof valeur !== 'string') return '';
  return valeur.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** La clé d'identité d'une entrée : le texte affiché, sans casse. */
export function cleAffiche(affiche: string): string {
  return normaliser(affiche).toLocaleLowerCase('fr');
}

export type RefusPrononciation = 'vide' | 'trop_long' | 'identique' | 'doublon' | 'trop_nombreuses';

export const MESSAGES_PRONONCIATION: Record<RefusPrononciation, string> = {
  vide: 'Le texte affiché et le texte prononcé sont obligatoires.',
  trop_long: `Chaque texte est limité à ${MAX_LONGUEUR_PRONONCIATION} caractères.`,
  identique: 'Le texte prononcé est identique au texte affiché.',
  doublon: 'Ce mot a déjà une prononciation.',
  trop_nombreuses: `Vous pouvez enregistrer ${MAX_PRONONCIATIONS} prononciations au maximum.`,
};

/** Une entrée valide, normalisée — ou le motif de refus. */
export function prononciationValide(brut: unknown): { ok: true; valeur: Prononciation } | { ok: false; motif: RefusPrononciation } {
  const o = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const affiche = normaliser(o.affiche);
  const prononce = normaliser(o.prononce);
  if (!affiche || !prononce) return { ok: false, motif: 'vide' };
  if (affiche.length > MAX_LONGUEUR_PRONONCIATION || prononce.length > MAX_LONGUEUR_PRONONCIATION) return { ok: false, motif: 'trop_long' };
  // Identique sans casse : « Afroboost → afroboost » ne changerait rien à l'oreille.
  if (cleAffiche(affiche) === cleAffiche(prononce)) return { ok: false, motif: 'identique' };
  return { ok: true, valeur: { affiche, prononce } };
}

/**
 * Lit une liste venue de la base ou du navigateur, TOLÉRANTE : les entrées
 * invalides sont ignorées, les doublons dédupliqués (première occurrence),
 * la liste bornée. Ne lève jamais — c'est ce qu'on relit, pas ce qu'on
 * accepte (pour accepter, voir `ajouterPrononciation` et compagnie).
 */
export function lirePrononciations(brut: unknown): Prononciation[] {
  if (!Array.isArray(brut)) return [];
  const vues = new Set<string>();
  const liste: Prononciation[] = [];
  for (const entree of brut) {
    const v = prononciationValide(entree);
    if (!v.ok) continue;
    const cle = cleAffiche(v.valeur.affiche);
    if (vues.has(cle)) continue;
    vues.add(cle);
    liste.push(v.valeur);
    if (liste.length >= MAX_PRONONCIATIONS) break;
  }
  return liste;
}

type Resultat = { ok: true; liste: Prononciation[] } | { ok: false; motif: RefusPrononciation | 'introuvable' };

/** Ajoute une entrée ; refuse le doublon (même texte affiché, sans casse). */
export function ajouterPrononciation(liste: Prononciation[], brut: unknown): Resultat {
  const v = prononciationValide(brut);
  if (!v.ok) return v;
  if (liste.length >= MAX_PRONONCIATIONS) return { ok: false, motif: 'trop_nombreuses' };
  const cle = cleAffiche(v.valeur.affiche);
  if (liste.some((p) => cleAffiche(p.affiche) === cle)) return { ok: false, motif: 'doublon' };
  return { ok: true, liste: [...liste, v.valeur] };
}

/**
 * Modifie l'entrée identifiée par son texte affiché ACTUEL. Le nouveau
 * texte affiché peut changer, tant qu'il n'entre pas en collision avec une
 * autre entrée.
 */
export function modifierPrononciation(liste: Prononciation[], afficheActuel: unknown, brut: unknown): Resultat {
  const cleActuelle = cleAffiche(normaliser(afficheActuel));
  const index = liste.findIndex((p) => cleAffiche(p.affiche) === cleActuelle);
  if (index < 0) return { ok: false, motif: 'introuvable' };
  const v = prononciationValide(brut);
  if (!v.ok) return v;
  const nouvelleCle = cleAffiche(v.valeur.affiche);
  if (liste.some((p, i) => i !== index && cleAffiche(p.affiche) === nouvelleCle)) return { ok: false, motif: 'doublon' };
  const copie = [...liste];
  copie[index] = v.valeur;
  return { ok: true, liste: copie };
}

/** Retire l'entrée identifiée par son texte affiché. */
export function supprimerPrononciation(liste: Prononciation[], affiche: unknown): Resultat {
  const cle = cleAffiche(normaliser(affiche));
  const reste = liste.filter((p) => cleAffiche(p.affiche) !== cle);
  if (reste.length === liste.length) return { ok: false, motif: 'introuvable' };
  return { ok: true, liste: reste };
}

// ─────────────────────────────────────────────────────────────────────────
// SPOKEN_SCRIPT
// ─────────────────────────────────────────────────────────────────────────

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Une lettre, un chiffre ou une marque combinante : ce qui prolonge un mot. */
const CARACTERE_DE_MOT = '[\\p{L}\\p{N}\\p{M}]';

/**
 * Le texte RÉELLEMENT PRONONCÉ. Le texte affiché passé en entrée n'est
 * jamais modifié (chaînes immuables) ; sans prononciation, il est rendu tel
 * quel — la même référence.
 */
export function scriptParle(display: string, prononciations: readonly Prononciation[]): string {
  if (typeof display !== 'string' || display.length === 0) return typeof display === 'string' ? display : '';
  const entrees = lirePrononciations(prononciations as unknown);
  if (entrees.length === 0) return display;
  // Le plus long d'abord ; à longueur égale, l'ordre d'enregistrement.
  const ordonnees = [...entrees].sort((a, b) => b.affiche.length - a.affiche.length);
  const parCle = new Map(ordonnees.map((p) => [cleAffiche(p.affiche), p.prononce] as const));
  const alternatives = ordonnees.map((p) => echapper(p.affiche).replace(/ /g, '\\s+')).join('|');
  const motif = new RegExp(`(?<!${CARACTERE_DE_MOT})(?:${alternatives})(?!${CARACTERE_DE_MOT})`, 'giu');
  // Une seule passe : `replace` avance dans le texte d'origine, jamais dans le résultat.
  return display.replace(motif, (trouve) => parCle.get(cleAffiche(trouve)) ?? trouve);
}

/** Les deux textes, ensemble — ce que les générations conserveront. */
export function scripts(display: string, prononciations: readonly Prononciation[]): { display: string; spoken: string } {
  return { display, spoken: scriptParle(display, prononciations) };
}
