import { supabaseAdmin } from '@/lib/db/supabase';
import { listUserVoices } from '@/lib/voice/store';
import {
  resoudreJumeauPourGeneration, type ConfigJumeauNumerique, type IssueJumeau,
  type AvatarPourJumeau, type VoixPourJumeau, type IdentiteJumeau, type MotifJumeau,
} from '@/lib/avatar/jumeau';
import { voixJumeauUtilisable, type IssueVoixJumeau } from '@/lib/avatar/voix-jumeau';
import { preparerParoleJumeau, type ParoleJumeau } from '@/lib/avatar/parole-jumeau';
import type { Prononciation } from '@/lib/voice/prononciations';

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

/* ═════════════════════════════════════════════════════════════════════════
   A_8g — LA VOIX DU JUMEAU, RESOLUE PAR LE SERVEUR
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * La voix designee par `userVoiceId` peut-elle parler pour ce compte ?
 *
 * ⚠️ UNE SEULE LECTURE, UNE SEULE DECISION. La ligne est relue sous le compte
 * de la session (`lireVoixDuCompte` filtre par `user_id`) ; la decision est
 * celle de `voixJumeauUtilisable`, la meme que dans le portail. Un
 * identifiant venu du navigateur n'entre donc jamais tel quel dans une
 * configuration ni dans une synthese.
 */
export async function resoudreVoixJumeau(
  userId: string, userVoiceId: string | null | undefined,
): Promise<IssueVoixJumeau> {
  if (!userId || !userVoiceId) return { ok: false, motif: 'voix_absente' };
  const voix = await lireVoixDuCompte(userId, userVoiceId);
  return voixJumeauUtilisable({ userId, userVoiceId, voix });
}

export type IssuePreparationJumeau =
  | { etat: 'desactive' }
  | { etat: 'bloque'; motif: MotifJumeau | 'script_absent' }
  | { etat: 'pret'; identite: IdentiteJumeau; parole: ParoleJumeau };

/**
 * TOUT CE QU'IL FAUT POUR FAIRE PARLER LE JUMEAU, OU LA RAISON NOMMEE DU REFUS.
 *
 * Le portail decide si la personne numerique peut servir (avatar valide,
 * voix du compte) ; ce qui manquait est ce qu'elle DIT. Le texte affiche est
 * celui que la personne a ecrit pour sa voix-off (`bibliotheque.voixOff.
 * script`) — Studiio ne compose aucun script a sa place. Il traverse
 * `texteParle` (A_8d), avec les prononciations du compte et la langue de la
 * voix.
 *
 * ⚠️ AUCUN REPLI. Sans texte, sans voix, sans clone valide : un motif, pas une
 * video ordinaire produite en silence sous le nom de la personne.
 */
export async function preparerJumeauDuCompte(
  userId: string,
  config: ConfigJumeauNumerique | null | undefined,
  bibliotheque: {
    voixOff?: { script?: unknown } | null;
    prononciations?: readonly Prononciation[];
  } | null | undefined,
): Promise<IssuePreparationJumeau> {
  const { issue, voix } = await resoudreJumeauDuCompte(userId, config);
  if (issue.etat !== 'pret') return issue;

  /* La voix a deja ete jugee utilisable par le portail ; on la relit sous la
     meme decision pour obtenir sa forme complete (fournisseur, nom, langue). */
  const issueVoix = voixJumeauUtilisable({ userId, userVoiceId: issue.identite.userVoiceId, voix });
  if (!issueVoix.ok) return { etat: 'bloque', motif: issueVoix.motif };

  const parole = preparerParoleJumeau({
    voix: issueVoix.voix,
    displayScript: bibliotheque?.voixOff?.script ?? null,
    prononciations: bibliotheque?.prononciations ?? [],
  });
  if (!parole.ok) return { etat: 'bloque', motif: parole.motif };
  return { etat: 'pret', identite: issue.identite, parole: parole.parole };
}
