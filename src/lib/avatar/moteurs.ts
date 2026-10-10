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
// Mon avatar — parcours « voix HeyGen » (POST /api/avatar/generate)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ce parcours n'a jamais envoyé de moteur : le fournisseur prend alors
 * Avatar IV (documentation HeyGen, « models »). Avatar IV y est donc le
 * comportement EXISTANT — ouvert sans configuration, et présélectionné, pour
 * qu'aucun déploiement ne baisse la qualité en silence.
 */
export const MOTEURS_DEJA_UTILISES_MON_AVATAR: readonly MoteurAvatar[] = ['avatar_iv'];
export const QUALITE_PAR_DEFAUT_MON_AVATAR: QualiteRendu = 'qualite';

export interface QualiteOfferte { qualite: QualiteRendu; libelle: string; ouverte: boolean; recommandee: boolean; motif: string | null }

/** Lecture tolérante de `supported_api_engines` (fournisseur) : seuls les moteurs connus sont gardés. */
export function lireMoteursSupportes(brut: unknown): MoteurAvatar[] | null {
  if (!Array.isArray(brut)) return null;
  return brut.filter((m): m is MoteurAvatar => typeof m === 'string' && (MOTEURS_AVATAR as readonly string[]).includes(m));
}

/**
 * Les qualités de Mon avatar (voix HeyGen), avec leur motif quand elles sont
 * fermées. `moteursSupportes` : ce que le fournisseur CONFIRME pour cet
 * avatar (`supported_api_engines`), `null` s'il n'a pas pu le dire.
 *
 *   Standard  ouvert (moteur par défaut du serveur), sauf refus explicite du fournisseur ;
 *   Qualité   ouvert (comportement existant), recommandé et présélectionné ;
 *   Premium   ouvert SEULEMENT si le serveur l'autorise ET que le fournisseur
 *             confirme `avatar_v` pour cet avatar — sinon fermé, motif dit.
 */
export function qualitesMonAvatar(moteursSupportes: readonly MoteurAvatar[] | null, env: NodeJS.ProcessEnv = process.env): QualiteOfferte[] {
  const autorises = moteursAutorises(env);
  return QUALITES.map((q) => {
    const moteur = MOTEUR_PAR_QUALITE[q];
    const refuseFournisseur = moteursSupportes !== null && !moteursSupportes.includes(moteur);
    let motif: string | null = null;
    if (q === 'premium') {
      if (!autorises.includes(moteur)) motif = 'Pas encore ouvert sur Studiio.';
      else if (moteursSupportes === null) motif = 'Compatibilité de votre avatar non confirmée par le service de génération.';
      else if (refuseFournisseur) motif = 'Non pris en charge par votre avatar.';
    } else if (refuseFournisseur) {
      motif = 'Non pris en charge par votre avatar.';
    } else if (!autorises.includes(moteur) && !MOTEURS_DEJA_UTILISES_MON_AVATAR.includes(moteur)) {
      motif = 'Pas encore ouvert sur Studiio.';
    }
    return { qualite: q, libelle: LIBELLE_QUALITE[q], ouverte: motif === null, recommandee: q === QUALITE_PAR_DEFAUT_MON_AVATAR, motif };
  });
}
