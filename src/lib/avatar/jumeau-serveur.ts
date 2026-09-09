import { supabaseAdmin } from '@/lib/db/supabase';
import { listUserVoices } from '@/lib/voice/store';
import {
  resoudreJumeauPourGeneration, type ConfigJumeauNumerique, type IssueJumeau,
  type AvatarPourJumeau, type VoixPourJumeau,
} from '@/lib/avatar/jumeau';

/**
 * A_8f — LES LECTURES QUE LE PORTAIL EXIGE, FAITES UNE SEULE FOIS.
 *
 * ⚠️ POURQUOI ELLES NE VIVENT PAS DANS LA FONCTION PURE. `resoudreJumeau…`
 * doit rester verifiable sur des valeurs ; ce module lui apporte les faits.
 * Mais il n'y a qu'UNE facon de les lire, et elle est ici : deux appelants
 * qui liraient differemment — l'un filtrant par compte, l'autre non —
 * finiraient par ne pas etre d'accord sur qui a le droit de parler.
 *
 * ⚠️ LES DEUX LECTURES SONT FILTREES PAR LE COMPTE. La ligne d'autrui ne
 * revient pas ; il n'y a donc rien a decider ensuite.
 */

const CHAMPS_AVATAR =
  'id, user_id, status, provider_avatar_id, validated_at, deleted_at, subject_type, version';

export interface FaitsJumeau {
  issue: IssueJumeau;
  avatar: AvatarPourJumeau | null;
  voix: VoixPourJumeau | null;
}

export async function lireAvatarDuCompte(
  userId: string, avatarId: string,
): Promise<AvatarPourJumeau | null> {
  if (!userId || !avatarId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('user_avatars')
      .select(CHAMPS_AVATAR)
      .eq('id', avatarId)
      .eq('user_id', userId)
      .maybeSingle();
    return (data ?? null) as AvatarPourJumeau | null;
  } catch {
    /* Une base injoignable n'autorise rien : l'absence de ligne se traduit en
       blocage nomme, jamais en laissez-passer. */
    return null;
  }
}

export async function lireVoixDuCompte(
  userId: string, voixId: string | null,
): Promise<VoixPourJumeau | null> {
  if (!userId || !voixId) return null;
  const voix = await listUserVoices(userId);
  return voix.find((v) => v.id === voixId) ?? null;
}

/**
 * L'etat REEL de la personne numerique d'un compte, maintenant.
 *
 * ⚠️ LA CONFIGURATION DIT CE QUI A ETE DEMANDE, PAS CE QUI EST VRAI. Un clone
 * active il y a un mois a pu etre supprime, sa voix effacee, sa validation
 * jamais faite. C'est pour cela que rien n'est deduit du reglage : les deux
 * lignes sont relues a chaque fois.
 */
export async function resoudreJumeauDuCompte(
  userId: string, config: ConfigJumeauNumerique | null | undefined,
): Promise<FaitsJumeau> {
  if (!config?.active || !config.avatarId) {
    return { issue: { etat: 'desactive' }, avatar: null, voix: null };
  }
  const [avatar, voix] = await Promise.all([
    lireAvatarDuCompte(userId, config.avatarId),
    lireVoixDuCompte(userId, config.userVoiceId),
  ]);
  return {
    issue: resoudreJumeauPourGeneration({ config, userId, avatar, voix }),
    avatar, voix,
  };
}
