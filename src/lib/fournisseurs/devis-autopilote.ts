/**
 * Coût fournisseur de l'AUTOPILOTE — ce que chaque vidéo avatar coûtera chez
 * HeyGen, et le budget par jour / par mois qui en découle. Une ESTIMATION
 * pour l'admin, jamais un prélèvement.
 *
 * Le moteur est celui que l'Autopilote ENVOIE réellement (aucune qualité
 * demandée → `moteurAvatar(env)`, Avatar III par défaut). Le script de
 * l'avatar (`scriptJumeauMontage`) n'est connu qu'au moment du créneau :
 * avant, la durée est une PLAGE PRUDENTE bornée par sa longueur maximale.
 */
import { resoudreJumeauDuCompte } from '@/lib/avatar/jumeau';
import { moteurAvatar } from '@/lib/avatar/moteurs';
import { avatarActifConfig } from '@/lib/autopilot/sources';
import type { AutopilotConfig } from '@/lib/autopilot/rules';
import {
  budgetAutopilote, devisVideoHeygen, dureeParoleEstimee,
  type BudgetAutopilote, type DevisFournisseur, type Intervalle,
} from '@/lib/fournisseurs/devis-fournisseur';

/**
 * Plage de durée d'une vidéo avatar de l'Autopilote AVANT que son script
 * existe : au moins 3 s (plancher d'estimation), au plus 45 s — le script est
 * tronqué à 600 caractères (`scriptJumeauMontage`), ≈ 43 s à 14 car./s.
 */
export const DUREE_VIDEO_AUTOPILOTE: Intervalle = { min: 3, max: 45 };

/** Le jumeau que l'Autopilote animerait : fournisseur et type, `null` s'il n'est pas prêt. */
async function jumeauAutopilote(userId: string, avatarId: string | null): Promise<{ fournisseur: string; typeAvatar: string | null } | null> {
  const j = await resoudreJumeauDuCompte(userId, { avatarId, voixId: null }).catch(() => null);
  if (!j || !j.ok) return null;
  return { fournisseur: j.prive.fournisseurAvatar, typeAvatar: j.prive.typeAvatar };
}

/**
 * Devis d'UNE vidéo avatar de l'Autopilote. `script` connu (Produire
 * maintenant) → durée estimée du texte ; sinon la plage prudente.
 * `null` : pas d'avatar HeyGen utilisable (rien ne sera facturé chez HeyGen).
 */
export async function devisVideoAutopilote(
  userId: string,
  config: Pick<AutopilotConfig, 'jumeauAvatarId'> & Parameters<typeof avatarActifConfig>[0],
  script: string | null,
  env: NodeJS.ProcessEnv = process.env,
  /** Le devis de l'avatar CONFIGURÉ même si l'avatar n'est pas activé (pour l'estimer avant activation). */
  memeInactif = false,
): Promise<DevisFournisseur | null> {
  if (!memeInactif && !avatarActifConfig(config)) return null;
  const jumeau = await jumeauAutopilote(userId, config.jumeauAvatarId ?? null);
  if (!jumeau || jumeau.fournisseur !== 'heygen') return null;
  const parole = script ? dureeParoleEstimee([script]) : null;
  return devisVideoHeygen({
    operation: 'video_autopilote',
    moteurEnvoye: moteurAvatar(env),
    avatarType: jumeau.typeAvatar,
    dureeSecondes: parole ?? DUREE_VIDEO_AUTOPILOTE,
    origineDuree: parole ? 'texte' : 'plage',
    creditsStudiio: 0,
  });
}

/**
 * Budget estimé d'une configuration Autopilote (par vidéo, par jour, par mois).
 * `devisParVideo` est celui de l'avatar CONFIGURÉ, même inactif : l'écran
 * recalcule le budget sur la configuration en cours d'édition, avant activation.
 */
export async function budgetAutopiloteDuCompte(
  userId: string,
  config: AutopilotConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ devisParVideo: DevisFournisseur | null; budget: BudgetAutopilote }> {
  const avatarUtilise = avatarActifConfig(config);
  const devisParVideo = await devisVideoAutopilote(userId, config, null, env, true);
  return {
    devisParVideo,
    budget: budgetAutopilote({ avatarUtilise, countPerCycle: config.countPerCycle, cadence: config.cadence, devisParVideo }),
  };
}
