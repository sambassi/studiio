/**
 * LE JUMEAU NUMÉRIQUE DU COMPTE — un seul contrat serveur.
 *
 * « Utiliser mon jumeau » = MON avatar VALIDÉ (version courante) + MA voix
 * personnelle + MES prononciations. Rien n'est reçu du navigateur : tout est
 * RELU ici, à chaque appel — avant d'afficher « prêt », et de nouveau
 * juste avant toute génération, même si c'était prêt il y a dix minutes.
 *
 * Les motifs sont nommés, jamais un faux « prêt » :
 *   avatar_absent        aucun avatar vivant
 *   avatar_non_pret      source enregistrée, entraînement en cours, ou échec
 *                        fournisseur (`etatAvatar` ≠ entraîné)
 *   avatar_non_valide    entraîné mais jamais regardé et accepté
 *                        (`validated_at` NULL pour cette version)
 *   voix_absente         aucune voix personnelle
 *   choix_voix_requis    plusieurs voix, aucune choisie — on ne choisit pas
 *                        à la place de la personne
 *   voix_inutilisable    voix choisie disparue ou sans identifiant
 *                        fournisseur exploitable
 *
 * Ce que le navigateur reçoit (`JumeauPublic`) ne contient AUCUN identifiant
 * fournisseur ; `prive` reste au serveur, pour le moteur vidéo — quand il
 * existera.
 */

import { avatarVivantDuCompte } from '@/lib/avatar/lecture';
import { etatAvatar } from '@/lib/avatar/contrat';
import { resoudreVoixDuCompte, MESSAGES_VOIX, type MotifVoix } from '@/lib/voice/profil';
import { scripts, type Prononciation } from '@/lib/voice/prononciations';

export type MotifJumeau =
  | 'avatar_absent' | 'avatar_non_pret' | 'avatar_non_valide'
  | 'voix_absente' | 'choix_voix_requis' | 'voix_inutilisable';

export const MESSAGES_JUMEAU: Record<MotifJumeau, string> = {
  avatar_absent: 'Créez et validez votre avatar avant de pouvoir utiliser votre jumeau.',
  avatar_non_pret: 'Votre avatar doit être entraîné puis validé avant de pouvoir utiliser votre jumeau.',
  avatar_non_valide: 'Votre avatar doit être validé avant de pouvoir utiliser votre jumeau.',
  voix_absente: 'Ajoutez ou sélectionnez votre voix personnelle avant d’utiliser votre jumeau.',
  choix_voix_requis: 'Sélectionnez la voix que votre jumeau doit utiliser.',
  voix_inutilisable: 'La voix choisie ne peut pas être utilisée. Vérifiez votre voix personnelle.',
};

/** Fournisseurs d'avatar connus du contrat ; tout autre est traité comme inconnu. */
export type FournisseurAvatar = 'heygen' | 'did';

/** Ce que l'écran reçoit : de quoi dire « prêt » et nommer les choses. Rien de plus. */
export interface JumeauPublic {
  avatar: {
    id: string; version: number; nom: string | null; valideLe: string;
    /**
     * Le FOURNISSEUR (pas son identifiant) : l'écran en a besoin pour dire
     * honnêtement ce que le moteur vidéo sait faire de cet avatar. Un avatar
     * D-ID (créé à partir d'une vidéo) a une voix utilisable partout, mais
     * pas encore de moteur vidéo — voir `moteurJumeauDisponiblePour`.
     */
    fournisseur: FournisseurAvatar | 'inconnu';
  };
  voix: { id: string; nom: string };
  prononciations: number;
}

/** Ce que le moteur vidéo recevra — jamais le navigateur. */
export interface JumeauPrive {
  providerAvatarId: string;
  /** Le fournisseur de `providerAvatarId` : le moteur refuse tout ce qu'il ne sait pas animer. */
  fournisseurAvatar: FournisseurAvatar | 'inconnu';
  providerVoiceId: string;
  prononciations: Prononciation[];
}

/**
 * `provider` absent ou nul = HeyGen : c'est le défaut de la colonne
 * (`user_avatars.provider default 'heygen'`) et le seul fournisseur qui
 * existait avant D-ID. Toute autre valeur est inconnue — le moteur refuse.
 */
function fournisseurDe(a: { provider?: unknown }): FournisseurAvatar | 'inconnu' {
  if (a.provider === 'did') return 'did';
  if (a.provider === 'heygen' || a.provider === undefined || a.provider === null) return 'heygen';
  return 'inconnu';
}

export type ResolutionJumeau =
  | { ok: true; jumeau: JumeauPublic; prive: JumeauPrive }
  | { ok: false; motif: MotifJumeau; message: string }
  | { ok: false; erreur: string };

const MOTIF_VOIX: Record<MotifVoix, MotifJumeau> = {
  aucune_voix: 'voix_absente',
  choix_requis: 'choix_voix_requis',
  voix_inexistante: 'voix_inutilisable',
  voix_inutilisable: 'voix_inutilisable',
};

export async function resoudreJumeauDuCompte(userId: string): Promise<ResolutionJumeau> {
  const lecture = await avatarVivantDuCompte(userId);
  if (!lecture.ok) return { ok: false, erreur: lecture.erreur };
  const a = lecture.avatar;
  if (!a) return { ok: false, motif: 'avatar_absent', message: MESSAGES_JUMEAU.avatar_absent };
  // Un avatar D-ID n'est PLUS refusé ici. « Prêt » veut dire : avatar validé
  // + voix nommée — et la voix, elle, sert partout (narration Autopilote,
  // voix par séquence). Ce que le moteur VIDÉO sait animer est une autre
  // question, répondue par `moteurJumeauDisponiblePour(fournisseur)` ; le
  // moteur lui-même refuse tout identifiant qui n'est pas HeyGen, avant tout
  // débit. Un identifiant D-ID n'est donc JAMAIS envoyé à HeyGen.
  // L'état est DÉRIVÉ, au même endroit que la validation : vivant, fournisseur
  // présent, entraînement réellement terminé, validated_at posé.
  const etat = etatAvatar(a);
  if (etat === 'entraine_non_valide') return { ok: false, motif: 'avatar_non_valide', message: MESSAGES_JUMEAU.avatar_non_valide };
  // « valide » implique fournisseur présent et validated_at posé (contrat
  // etatAvatar) ; les deux tests de droite ne font que le dire au typage.
  if (etat !== 'valide' || !a.provider_avatar_id || !a.validated_at) {
    return { ok: false, motif: 'avatar_non_pret', message: MESSAGES_JUMEAU.avatar_non_pret };
  }

  const voix = await resoudreVoixDuCompte(userId);
  if (!voix.ok) {
    if ('motif' in voix) {
      const motif = MOTIF_VOIX[voix.motif];
      return { ok: false, motif, message: MESSAGES_JUMEAU[motif] ?? MESSAGES_VOIX[voix.motif] };
    }
    return { ok: false, erreur: voix.erreur };
  }

  return {
    ok: true,
    jumeau: {
      avatar: { id: a.id, version: a.version, nom: a.name ?? null, valideLe: a.validated_at, fournisseur: fournisseurDe(a) },
      voix: { id: voix.voix.id, nom: voix.voix.nom },
      prononciations: voix.prononciations.length,
    },
    prive: { providerAvatarId: a.provider_avatar_id, fournisseurAvatar: fournisseurDe(a), providerVoiceId: voix.providerVoiceId, prononciations: voix.prononciations },
  };
}

/** Les textes d'une vidéo, DISPLAY intact et SPOKEN prêt pour le moteur — par la fonction commune. */
export function scriptsDuJumeau(textes: readonly string[], prononciations: readonly Prononciation[]): Array<{ display: string; spoken: string }> {
  return textes.map((t) => scripts(t, prononciations));
}

/**
 * Le moteur vidéo « avatar animé + voix personnelle » vit dans
 * `@/lib/avatar/moteur-jumeau`. Il n'est DISPONIBLE que si
 * `JUMEAU_MOTEUR_ACTIVE=1` et que les deux fournisseurs sont configurés — le
 * drapeau ne passe à 1 qu'après une génération réelle constatée sur un vrai
 * compte. Tant qu'il est à zéro, on le dit ; on ne simule rien.
 */
import { moteurJumeauDisponible } from '@/lib/avatar/moteur-jumeau';
export { moteurJumeauDisponible };
export const MESSAGE_MOTEUR_JUMEAU_INDISPONIBLE = 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible — votre voix reste utilisable pour la narration.';
/**
 * Un avatar D-ID (créé à partir d'une vidéo) : le moteur vidéo du jumeau est
 * câblé sur HeyGen (`audio_asset_id` sur /v3/videos) et ne sait pas encore
 * l'animer. On dit exactement ce qui manque et ce qui marche déjà — jamais
 * « pas pris en charge » sans dire quoi ni pourquoi.
 */
export const MESSAGE_MOTEUR_JUMEAU_AVATAR_VIDEO = 'Votre avatar est prêt et votre voix est enregistrée, mais la génération de vidéos avec votre jumeau n’est disponible que pour les avatars créés à partir d’une photo. Votre voix reste utilisable pour la narration, et vous pouvez générer un aperçu dans Mon avatar.';

/**
 * Le moteur vidéo peut-il animer CET avatar ? Le drapeau global ne suffit
 * pas : il dit que le moteur HeyGen est actif, pas qu'il sait animer un
 * avatar d'un autre fournisseur.
 */
export function moteurJumeauDisponiblePour(
  fournisseur: FournisseurAvatar | 'inconnu',
  env: NodeJS.ProcessEnv = process.env,
): { disponible: boolean; message: string | null } {
  if (fournisseur !== 'heygen') return { disponible: false, message: MESSAGE_MOTEUR_JUMEAU_AVATAR_VIDEO };
  return moteurJumeauDisponible(env)
    ? { disponible: true, message: null }
    : { disponible: false, message: MESSAGE_MOTEUR_JUMEAU_INDISPONIBLE };
}
