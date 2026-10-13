/**
 * Le brief d'une vidéo — ce que le sujet seul ne dit pas.
 *
 * « Danse » n'explique pas ce que le jumeau dira. Le brief nomme l'OBJECTIF
 * de la vidéo, le MESSAGE à transmettre, le PUBLIC visé et le CTA. Il est
 * relu par trois endroits, et c'est pour cela qu'il vit dans un module PUR,
 * sans React ni accès réseau :
 *
 * - le brouillon de « Créer » (`Draft.brief`) ;
 * - la configuration de l'Autopilote (`AutopilotConfig.brief`, colonne
 *   `brief jsonb`) — le brief RÉCURRENT, commun à toutes les vidéos ;
 * - la génération de contenu (`/api/content/ai-generate`) et le
 *   pré-remplissage des narrations (`buildAutoFillText`).
 *
 * ⚠️ TOUT EST OPTIONNEL. Un brief vide (`{}`) doit laisser chaque appelant
 * se comporter EXACTEMENT comme avant : même prompt, mêmes textes. C'est ce
 * qui rend l'ajout rétro-compatible pour tous les brouillons et toutes les
 * configurations existants.
 */

export const BRIEF_KEYS = ['objectif', 'message', 'public', 'cta'] as const;

export type BriefKey = (typeof BRIEF_KEYS)[number];

/** Un champ du brief, une fois relu : jamais plus de `BRIEF_MAX_CHARS`. */
export const BRIEF_MAX_CHARS = 300;

/** Le rythme de la narration — il fixe le débit (caractères par seconde) du script. */
export type RythmeBrief = 'calme' | 'normal' | 'dynamique';

export const RYTHMES_BRIEF: readonly RythmeBrief[] = ['calme', 'normal', 'dynamique'];

export const RYTHME_LABELS: Record<RythmeBrief, string> = {
  calme: 'Calme',
  normal: 'Normal',
  dynamique: 'Dynamique',
};

/** Débit de parole par rythme (caractères par seconde) — `normal` = celui de l'estimation fournisseur (≈ 14). */
export const CARACTERES_PAR_SECONDE: Record<RythmeBrief, number> = {
  calme: 12,
  normal: 14,
  dynamique: 16,
};

/** Durées proposées en un clic ; toute valeur entière dans les bornes reste acceptée (« Personnalisée »). */
export const DUREES_BRIEF = [15, 30, 45] as const;
export const DUREE_BRIEF_MIN = 5;
export const DUREE_BRIEF_MAX = 90;

/**
 * Les quatre textes, plus — facultatifs eux aussi — la DURÉE CIBLE (secondes)
 * et le RYTHME. Rangés dans le même JSON (`brief jsonb`) : aucune migration.
 */
export type VideoBrief = Partial<Record<BriefKey, string>> & {
  duree?: number;
  rythme?: RythmeBrief;
};

/** Libellés et exemples — ceux de l'utilisateur, repris tels quels. */
export const BRIEF_LABELS: Record<BriefKey, string> = {
  objectif: 'Objectif de la vidéo',
  message: 'Message à transmettre',
  public: 'Public visé',
  cta: 'Appel à l’action (CTA)',
};

export const BRIEF_PLACEHOLDERS: Record<BriefKey, string> = {
  objectif: 'Donner envie de découvrir Afroboost à Neuchâtel et réserver un cours d’essai.',
  message: 'Un cours de danse fitness accessible, dans une ambiance qui donne de l’énergie.',
  public: 'Adultes de Neuchâtel qui veulent bouger sans se prendre au sérieux.',
  cta: 'Réservez votre cours d’essai sur afroboost.com.',
};

/**
 * Brief relu, ou `{}`.
 *
 * Chaque champ est une chaîne rognée, bornée à `BRIEF_MAX_CHARS` ; ce qui
 * n'est pas une chaîne — ou une chaîne vide — est simplement absent. Un
 * brief relu ne porte donc JAMAIS de clé vide : `briefRempli` et
 * `briefPourPrompt` s'y fient.
 */
export function sanitizeBrief(raw: unknown): VideoBrief {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: VideoBrief = {};
  for (const cle of BRIEF_KEYS) {
    const v = o[cle];
    if (typeof v !== 'string') continue;
    const propre = v.trim().slice(0, BRIEF_MAX_CHARS);
    if (propre) out[cle] = propre;
  }
  const d = o.duree;
  if (typeof d === 'number' && Number.isFinite(d)) {
    const n = Math.round(d);
    if (n >= DUREE_BRIEF_MIN && n <= DUREE_BRIEF_MAX) out.duree = n;
  }
  if (typeof o.rythme === 'string' && (RYTHMES_BRIEF as readonly string[]).includes(o.rythme)) {
    out.rythme = o.rythme as RythmeBrief;
  }
  return out;
}

/**
 * Longueur maximale (caractères) d'un script pour la durée et le rythme du
 * brief — `null` sans durée cible : l'appelant garde alors sa borne d'avant.
 */
export function longueurScriptCible(brief: VideoBrief | null | undefined): number | null {
  if (!brief?.duree) return null;
  return Math.round(brief.duree * CARACTERES_PAR_SECONDE[brief.rythme ?? 'normal']);
}

/** Au moins un champ renseigné ? */
export function briefRempli(brief: VideoBrief | null | undefined): boolean {
  if (!brief) return false;
  return BRIEF_KEYS.some((k) => typeof brief[k] === 'string' && brief[k]!.trim().length > 0);
}

/**
 * Le brief, prêt à être glissé dans le prompt du modèle.
 *
 * Rend `''` — et pas un en-tête vide — quand rien n'est renseigné : c'est
 * ce qui garantit qu'un appel SANS brief envoie exactement le prompt
 * d'avant. Les lignes citent les champs par leur nom, pour que le modèle
 * sache lequel gouverne le titre (objectif, message) et lequel gouverne la
 * phrase finale (CTA).
 */
export function briefPourPrompt(raw: unknown): string {
  const brief = sanitizeBrief(raw);
  if (!briefRempli(brief) && !brief.duree && !brief.rythme) return '';
  const lignes: string[] = [];
  if (brief.objectif) lignes.push(`- Objectif de la vidéo : ${brief.objectif}`);
  if (brief.message) lignes.push(`- Message à transmettre : ${brief.message}`);
  if (brief.public) lignes.push(`- Public visé : ${brief.public}`);
  if (brief.cta) lignes.push(`- Appel à l'action à reprendre tel quel dans le CTA : ${brief.cta}`);
  const longueur = longueurScriptCible(brief);
  if (brief.duree && longueur) lignes.push(`- Durée cible de la vidéo : ${brief.duree} secondes (narration complète ≈ ${longueur} caractères au plus)`);
  if (brief.rythme) lignes.push(`- Rythme : ${RYTHME_LABELS[brief.rythme].toLowerCase()}`);
  return `\n\nBRIEF DE LA VIDÉO (à respecter — le titre et les cartes servent cet objectif et ce message, pour ce public) :\n${lignes.join('\n')}`;
}
