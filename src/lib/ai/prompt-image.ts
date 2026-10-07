/**
 * Prompt de génération d'image (Affiche IA, « Générer arrière-plan »).
 *
 * Module PUR partagé par `/api/ai/image` (ce qui part réellement au
 * générateur) et par `/api/content/ai-generate` (`fieldType: 'promptImage'`,
 * le bouton « Détailler avec l'IA »).
 *
 * Règle : le texte de l'utilisateur est la SOURCE PRINCIPALE. Il part en
 * TÊTE du prompt, mot pour mot, sans traduction mot à mot ni suffixe qui le
 * contredise. Avant ce module, le chemin texte → image ajoutait
 * « professional background » (le modèle produisait un décor vide au lieu de
 * la personne demandée) et le chemin « partir de ma photo » passait la
 * demande dans une substitution mot à mot français → anglais qui la rendait
 * bancale. Les générateurs tronquent un prompt trop long PAR LA FIN : ce qui
 * est en tête — la demande — est donc ce qui survit.
 */

/** Longueur maximale d'un prompt accepté par `/api/ai/image` (`generate-bg`). */
export const PROMPT_IMAGE_MAX = 1000;

/** Longueur visée pour un prompt détaillé par l'IA (marge sous la limite). */
export const PROMPT_IMAGE_DETAILLE_MAX = 700;

const CONSIGNE_FIDELITE =
  'faithful to this exact description (same subject, person and gender, outfit, action, setting, accessories and style), high quality, detailed, sharp focus';

const CONSIGNE_REFERENCE =
  'Apply the description above faithfully. Keep the person from the input image (face, identity) and keep their outfit unless the description changes it.';

/**
 * Prompt texte → image : la demande, puis une consigne de fidélité et le
 * format (déjà passé en paramètre au générateur, rappelé pour la cohérence).
 */
export function construirePromptTexteImage(consigne: string, format?: string): string {
  return `${consigne.trim()}, ${CONSIGNE_FIDELITE}${format ? `, ${format} aspect ratio` : ''}`;
}

/** Prompt « partir de ma photo » (image + consigne → image). */
export function construirePromptReferenceImage(consigne: string): string {
  return `${consigne.trim()}\n\n${CONSIGNE_REFERENCE}`;
}

// Mots vides FR/EN ignorés quand on relève les éléments d'une demande.
const MOTS_VIDES = new Set([
  'les', 'des', 'une', 'aux', 'avec', 'dans', 'sur', 'sous', 'pour', 'par', 'qui', 'que', 'quoi',
  'est', 'son', 'sa', 'ses', 'leur', 'leurs', 'du', 'de', 'la', 'le', 'un', 'et', 'ou', 'en',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'tres', 'plus', 'pas',
  'the', 'and', 'with', 'for', 'from', 'into', 'onto', 'this', 'that', 'its', 'are', 'was',
  'image', 'photo', 'affiche', 'style', 'fond',
]);

/** Minuscule, sans accent, ponctuation → espace. */
export function normaliserTexte(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Les éléments porteurs de sens d'une demande (sujet, personne, tenue, action,
 * décor, accessoires, style, format) : ses mots significatifs, dédoublonnés.
 */
export function termesEssentiels(prompt: string): string[] {
  const vus = new Set<string>();
  for (const mot of normaliserTexte(prompt).split(' ')) {
    if (mot.length < 3 && !/^\d+$/.test(mot)) continue;
    if (MOTS_VIDES.has(mot)) continue;
    vus.add(mot);
  }
  return Array.from(vus);
}

const prefixeCommun = (a: string, b: string): number => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/**
 * Les éléments de `original` absents de `final`. Comparaison mot à mot,
 * tolérante aux accents, à la casse et aux accords : deux mots se valent
 * s'ils sont égaux, ou s'ils partagent un préfixe d'au moins quatre lettres
 * couvrant le plus long des deux à deux lettres près (miroir/miroirs,
 * noir/noire). Un mot vide de `final` (« dans ») ne compte jamais pour un
 * élément (« danse »).
 */
export function termesManquants(original: string, final: string): string[] {
  const mots = normaliserTexte(final).split(' ').filter((m) => m && !MOTS_VIDES.has(m));
  return termesEssentiels(original).filter((terme) => !mots.some((m) => {
    if (m === terme) return true;
    if (/^\d+$/.test(terme) || m.length < 4 || terme.length < 4) return false;
    return prefixeCommun(m, terme) >= Math.max(4, Math.max(m.length, terme.length) - 2);
  }));
}

/**
 * Consigne du modèle texte pour DÉTAILLER une demande d'image sans la trahir.
 */
export function consigneDetaillerPromptImage(original: string): string {
  const demande = original.trim().slice(0, PROMPT_IMAGE_MAX);
  return `Tu aides à rédiger un prompt pour un générateur d'images.

DEMANDE DE L'UTILISATEUR (source principale, prioritaire sur tout le reste) :
"""${demande}"""

Transforme cette demande en un prompt détaillé, en respectant STRICTEMENT ces règles :
1. Commence par la demande de l'utilisateur, mot pour mot.
2. Ne retire, ne remplace et ne contredis AUCUN élément demandé : sujet, personne (sexe, âge, apparence), tenue, action, décor, accessoires, style, format, couleurs.
3. Ajoute seulement des précisions compatibles : cadrage, lumière, ambiance, matières, qualité photo — jamais de nouvelle personne, de nouvelle tenue ni de nouveau lieu.
4. Même langue que la demande. Une seule phrase ou une courte liste séparée par des virgules, ${PROMPT_IMAGE_DETAILLE_MAX} caractères maximum.
5. Aucun emoji, aucun texte à écrire dans l'image sauf si la demande en contient.

Réponds UNIQUEMENT en JSON: {"text":"..."}`;
}

export type VerdictPromptDetaille =
  | { ok: true; prompt: string }
  | { ok: false; motif: 'manquants'; manquants: string[] }
  | { ok: false; motif: 'trop-long' | 'vide' };

/**
 * Le prompt détaillé n'est accepté que s'il garde CHAQUE élément de la
 * demande et tient dans la limite du générateur. Sinon il est écarté : on ne
 * propose jamais à l'utilisateur un prompt qui a perdu une partie de sa demande.
 */
export function verifierPromptDetaille(original: string, detaille: string | null | undefined): VerdictPromptDetaille {
  const p = (detaille ?? '').trim();
  if (!p) return { ok: false, motif: 'vide' };
  if (p.length > PROMPT_IMAGE_MAX) return { ok: false, motif: 'trop-long' };
  const manquants = termesManquants(original, p);
  if (manquants.length) return { ok: false, motif: 'manquants', manquants };
  return { ok: true, prompt: p };
}
