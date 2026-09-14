import { supabaseAdmin } from '@/lib/db/supabase';
import { listUserVoices } from '@/lib/voice/store';
import {
  resoudreJumeauPourGeneration, type ConfigJumeauNumerique, type IssueJumeau,
  type AvatarPourJumeau, type VoixPourJumeau, type IdentiteJumeau, type MotifJumeau,
} from '@/lib/avatar/jumeau';
import { voixJumeauUtilisable, type IssueVoixJumeau } from '@/lib/avatar/voix-jumeau';
import { preparerParoleJumeau, type ParoleJumeau } from '@/lib/avatar/parole-jumeau';
import type { Prononciation } from '@/lib/voice/prononciations';
import {
  lireJumeauUtilisateur, lireBibliothequeUtilisateur,
} from '@/lib/autopilot/analyse/profil-compte';

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

/* ═════════════════════════════════════════════════════════════════════════
   A_8h — LE JUMEAU DANS « CREER » : LA MEME CONFIGURATION, SANS L'OPT-IN AUTOPILOTE
   ═════════════════════════════════════════════════════════════════════════

   Dans Autopilote, la personne numerique sert si elle a ete ACTIVEE une fois
   pour toutes. Dans « Creer », le consentement est donne PAR VIDEO : c'est
   l'interrupteur de la page, pas un reglage global. La configuration passee
   au portail est donc construite ici, a chaque demande :

     avatarId / avatarVersion  ← l'avatar VIVANT du compte, relu maintenant
                                 (jamais un identifiant range hier) ;
     userVoiceId               ← la voix choisie dans « Ma voix » (A_8g),
                                 la seule source de ce choix ;
     active                    ← true : l'opt-in, c'est l'interrupteur.

   ⚠️ RIEN NE VIENT DU NAVIGATEUR. Il n'envoie ni avatar ni voix ; il dit
   « utiliser mon clone », et le serveur decide avec quoi. Un identifiant
   glisse dans le corps de la requete n'est jamais lu.

   ⚠️ ET LA VERSION EST CELLE D'AUJOURD'HUI. Un brouillon d'hier ne porte que
   l'intention ; si le clone est passe en version 2 depuis, c'est la version
   2 — validee ou non — qui est jugee. Pas de version fantome. */

/** La configuration de jumeau qu'une creation manuelle soumet au portail. */
export async function configJumeauPourCreer(userId: string): Promise<{
  config: ConfigJumeauNumerique;
  avatar: AvatarPourJumeau | null;
}> {
  const [rangee, { data }] = await Promise.all([
    lireJumeauUtilisateur(userId),
    supabaseAdmin
      .from('user_avatars')
      .select(CHAMPS_AVATAR)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  const avatar = (Array.isArray(data) ? data[0] : null) as AvatarPourJumeau | null ?? null;
  const avatarId = typeof avatar?.id === 'string' ? avatar.id : null;
  return {
    avatar,
    config: {
      active: avatarId !== null,
      avatarId,
      avatarVersion: typeof avatar?.version === 'number' ? avatar.version : null,
      userVoiceId: rangee.userVoiceId,
    },
  };
}

export type IssueJumeauCreer =
  | { etat: 'bloque'; motif: MotifJumeau | 'script_absent' }
  | { etat: 'pret'; identite: IdentiteJumeau; voix: { userVoiceId: string; nom: string | null } };

/**
 * L'ETAT DU JUMEAU POUR L'ECRAN « CREER » — sans texte, donc sans parole.
 *
 * Meme portail que l'activation Autopilote et que la generation : un clone
 * que « Creer » dirait pret est un clone qu'Autopilote dirait pret.
 */
export async function etatJumeauPourCreer(userId: string): Promise<IssueJumeauCreer> {
  const { config, avatar } = await configJumeauPourCreer(userId);
  if (!avatar || !config.avatarId) return { etat: 'bloque', motif: 'avatar_absent' };
  const { issue, voix } = await resoudreJumeauDuCompte(userId, config);
  if (issue.etat === 'desactive') return { etat: 'bloque', motif: 'avatar_absent' };
  if (issue.etat === 'bloque') return issue;
  const issueVoix = voixJumeauUtilisable({ userId, userVoiceId: issue.identite.userVoiceId, voix });
  if (!issueVoix.ok) return { etat: 'bloque', motif: issueVoix.motif };
  return {
    etat: 'pret',
    identite: issue.identite,
    voix: { userVoiceId: issueVoix.voix.userVoiceId, nom: issueVoix.voix.nom },
  };
}

/**
 * LE CONTRAT D'UNE CREATION MANUELLE AVEC LE JUMEAU : identite + parole.
 *
 * `displayScript` est le texte que la personne a ecrit pour sa video (les
 * voix-off des sequences) ; il traverse le pipeline parle A_8d comme dans
 * Autopilote — `preparerJumeauDuCompte`, la meme fonction, avec les
 * prononciations du compte.
 */
export async function preparerJumeauPourCreer(
  userId: string, displayScript: unknown,
): Promise<IssuePreparationJumeau> {
  const { config, avatar } = await configJumeauPourCreer(userId);
  if (!avatar || !config.avatarId) return { etat: 'bloque', motif: 'avatar_absent' };
  const biblio = await lireBibliothequeUtilisateur(userId);
  const issue = await preparerJumeauDuCompte(userId, config, {
    voixOff: { script: displayScript },
    prononciations: biblio.prononciations,
  });
  if (issue.etat === 'desactive') return { etat: 'bloque', motif: 'avatar_absent' };
  return issue;
}
