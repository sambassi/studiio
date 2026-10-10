/**
 * QUALITÉ DE RENDU — choisie au moment de GÉNÉRER, jamais attachée à
 * l'identité ni à la version de l'avatar.
 *
 *   Standard → avatar_iii   Qualité → avatar_iv   Premium → avatar_v
 *
 * Une même version d'avatar sert avec tous les moteurs qu'elle supporte.
 *
 * ⚠️ COÛT : Avatar IV coûte ≈ 8× Avatar III chez le fournisseur. Seul
 * Standard est ouvert par défaut ; `AVATAR_MOTEURS_AUTORISES`
 * (ex. « avatar_iii,avatar_iv ») ouvre les autres côté serveur, une fois
 * leur prix en crédits décidé. Le navigateur ne choisit qu'une QUALITÉ, le
 * serveur décide du moteur.
 */

/** Les moteurs du fournisseur. Défaut : Avatar III (coût mesuré, validé en production). */
export const MOTEURS_AVATAR = ['avatar_iii', 'avatar_iv', 'avatar_v'] as const;
export type MoteurAvatar = typeof MOTEURS_AVATAR[number];
export const MOTEUR_AVATAR_DEFAUT: MoteurAvatar = 'avatar_iii';
/** Le moteur par défaut du serveur (`HEYGEN_AVATAR_ENGINE`, sinon Avatar III). */
export function moteurAvatar(env: NodeJS.ProcessEnv = process.env): MoteurAvatar {
  const v = env.HEYGEN_AVATAR_ENGINE?.trim() as MoteurAvatar | undefined;
  return v && (MOTEURS_AVATAR as readonly string[]).includes(v) ? v : MOTEUR_AVATAR_DEFAUT;
}

export type QualiteRendu = 'standard' | 'qualite' | 'premium';
export const QUALITES: readonly QualiteRendu[] = ['standard', 'qualite', 'premium'];

export const MOTEUR_PAR_QUALITE: Record<QualiteRendu, MoteurAvatar> = {
  standard: 'avatar_iii',
  qualite: 'avatar_iv',
  premium: 'avatar_v',
};

export const LIBELLE_QUALITE: Record<QualiteRendu, string> = {
  standard: 'Standard',
  qualite: 'Qualité',
  premium: 'Premium',
};

export const estQualite = (v: unknown): v is QualiteRendu => v === 'standard' || v === 'qualite' || v === 'premium';

/** Les moteurs ouverts sur ce serveur : la liste configurée, toujours avec le moteur par défaut. */
export function moteursAutorises(env: NodeJS.ProcessEnv = process.env): MoteurAvatar[] {
  const liste = (env.AVATAR_MOTEURS_AUTORISES ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m): m is MoteurAvatar => (MOTEURS_AVATAR as readonly string[]).includes(m));
  return Array.from(new Set<MoteurAvatar>([moteurAvatar(env), ...liste]));
}

/** Les qualités proposées à l'écran, et celles qui sont réellement ouvertes. */
export function qualitesDisponibles(env: NodeJS.ProcessEnv = process.env): Array<{ qualite: QualiteRendu; libelle: string; ouverte: boolean }> {
  const ouverts = moteursAutorises(env);
  return QUALITES.map((q) => ({ qualite: q, libelle: LIBELLE_QUALITE[q], ouverte: ouverts.includes(MOTEUR_PAR_QUALITE[q]) }));
}

/**
 * Le moteur d'UNE génération. Sans qualité demandée : le moteur par défaut
 * du serveur (comportement d'avant). Une qualité non ouverte est REFUSÉE,
 * avant tout débit et tout appel fournisseur — jamais rabattue en silence.
 */
export function moteurPourGeneration(
  qualite: unknown,
  env: NodeJS.ProcessEnv = process.env,
  /** Moteurs DÉJÀ utilisés par ce parcours sans configuration (ex. Avatar IV, défaut du fournisseur pour Mon avatar). */
  dejaUtilises: readonly MoteurAvatar[] = [],
): { ok: true; moteur: MoteurAvatar } | { ok: false; message: string } {
  if (qualite === undefined || qualite === null || qualite === '') return { ok: true, moteur: moteurAvatar(env) };
  if (!estQualite(qualite)) return { ok: false, message: 'Qualité de rendu inconnue.' };
  const moteur = MOTEUR_PAR_QUALITE[qualite];
  if (!moteursAutorises(env).includes(moteur) && !dejaUtilises.includes(moteur)) {
    return { ok: false, message: `La qualité « ${LIBELLE_QUALITE[qualite]} » n’est pas encore disponible.` };
  }
  return { ok: true, moteur };
}

/** La qualité dont le moteur est celui du serveur par défaut — celle que l'écran présélectionne. */
export function qualiteParDefaut(env: NodeJS.ProcessEnv = process.env): QualiteRendu {
  const m = moteurAvatar(env);
  return QUALITES.find((q) => MOTEUR_PAR_QUALITE[q] === m) ?? 'standard';
}

// ─────────────────────────────────────────────────────────────────────────
// Mon avatar — la qualité de GÉNÉRATION (moteur HeyGen)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Documentation HeyGen (developers.heygen.com, « models », « avatar-v »,
 * relue le 2026-10-10) : le moteur est un réglage de chaque GÉNÉRATION
 * (`engine` de POST /v3/videos), pas de l'entraînement. Sans `engine`, HeyGen
 * prend Avatar IV. Avatar V est réservé aux jumeaux numériques (`digital_twin`)
 * et « opt-in par look » : il n'est utilisable que si `supported_api_engines`
 * du look le contient (GET /v3/avatars/looks/{look_id}, lecture gratuite).
 *
 * Règle Studiio : AUCUN blocage interne de plus. Avatar III et IV sont ouverts ;
 * Avatar V l'est dès que HeyGen le CONFIRME pour l'avatar — sinon il reste
 * fermé avec la VRAIE raison. Le serveur revérifie au moment de générer.
 */
export const MOTEURS_DEJA_UTILISES_MON_AVATAR: readonly MoteurAvatar[] = ['avatar_iv'];
export const QUALITE_PAR_DEFAUT_MON_AVATAR: QualiteRendu = 'qualite';
/** Le nom du moteur HeyGen, affiché à côté de la qualité (jamais confondu avec la VERSION de l'avatar). */
export const LIBELLE_MOTEUR: Record<MoteurAvatar, string> = { avatar_iii: 'Avatar III', avatar_iv: 'Avatar IV', avatar_v: 'Avatar V' };
export const DESCRIPTION_QUALITE: Record<QualiteRendu, string> = {
  standard: 'Rapide, économique',
  qualite: 'Recommandé',
  premium: 'Meilleure qualité',
};

export const MOTIF_PREMIUM = {
  photo: 'Avatar V ne fonctionne qu’avec un avatar vidéo (jumeau numérique).',
  nonConfirme: 'HeyGen n’a pas pu confirmer la compatibilité Avatar V de cet avatar.',
  nonSupporte: 'Avatar V n’est pas disponible pour cet avatar (réponse HeyGen).',
} as const;

export interface QualiteOfferte {
  qualite: QualiteRendu; libelle: string; moteur: MoteurAvatar; moteurLibelle: string; description: string;
  ouverte: boolean; recommandee: boolean; meilleure: boolean; motif: string | null;
}

/** Lecture tolérante de `supported_api_engines` (fournisseur) : seuls les moteurs connus sont gardés. */
export function lireMoteursSupportes(brut: unknown): MoteurAvatar[] | null {
  if (!Array.isArray(brut)) return null;
  return brut.filter((m): m is MoteurAvatar => typeof m === 'string' && (MOTEURS_AVATAR as readonly string[]).includes(m));
}

/** Avatar V est-il utilisable pour CET avatar ? `null` = oui ; sinon la vraie raison. */
export function motifPremium(typeAvatar: string | null | undefined, moteursSupportes: readonly MoteurAvatar[] | null): string | null {
  if (typeAvatar !== 'video') return MOTIF_PREMIUM.photo;
  if (moteursSupportes === null) return MOTIF_PREMIUM.nonConfirme;
  if (!moteursSupportes.includes('avatar_v')) return MOTIF_PREMIUM.nonSupporte;
  return null;
}

/**
 * Les qualités de génération de Mon avatar, avec leur motif quand elles sont
 * fermées. `moteursSupportes` : ce que HeyGen CONFIRME pour ce look, `null`
 * s'il n'a pas pu le dire. Standard et Qualité ne se ferment que sur un refus
 * explicite du fournisseur.
 */
export function qualitesMonAvatar(
  moteursSupportes: readonly MoteurAvatar[] | null,
  typeAvatar: string | null | undefined = 'video',
): QualiteOfferte[] {
  return QUALITES.map((q) => {
    const moteur = MOTEUR_PAR_QUALITE[q];
    const motif = q === 'premium'
      ? motifPremium(typeAvatar, moteursSupportes)
      : moteursSupportes !== null && !moteursSupportes.includes(moteur) ? 'Non pris en charge par cet avatar (réponse HeyGen).' : null;
    return {
      qualite: q, libelle: LIBELLE_QUALITE[q], moteur, moteurLibelle: LIBELLE_MOTEUR[moteur], description: DESCRIPTION_QUALITE[q],
      ouverte: motif === null, recommandee: q === QUALITE_PAR_DEFAUT_MON_AVATAR, meilleure: q === 'premium', motif,
    };
  });
}

/**
 * Le moteur d'une génération DEMANDÉE depuis Mon avatar : III et IV ouverts,
 * V accepté ici SOUS RÉSERVE — `verifierFournisseur` impose à l'appelant de
 * relire la confirmation HeyGen AVANT tout débit. Sans qualité : défaut serveur.
 * Une qualité inconnue est refusée, jamais rabattue.
 */
export function moteurPourMonAvatar(
  qualite: unknown, env: NodeJS.ProcessEnv = process.env,
): { ok: true; moteur: MoteurAvatar; verifierFournisseur: boolean } | { ok: false; message: string } {
  if (qualite === undefined || qualite === null || qualite === '') return { ok: true, moteur: moteurAvatar(env), verifierFournisseur: false };
  if (!estQualite(qualite)) return { ok: false, message: 'Qualité de rendu inconnue.' };
  const moteur = MOTEUR_PAR_QUALITE[qualite];
  return { ok: true, moteur, verifierFournisseur: moteur === 'avatar_v' };
}
