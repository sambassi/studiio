import { supabaseAdmin } from '@/lib/db/supabase';
import { isAdmin } from '@/lib/admin';
import { reseauDepuisLibelle } from '@/lib/social/etatReseaux';

/**
 * Qui a le droit de publier sur ses réseaux, et avec quel média.
 *
 * ⚠️ DEUX DRAPEAUX, ET IL FAUT LES DEUX. `site_settings.user_publishing_enabled`
 * est le coupe-circuit de l'administrateur — il coupe TOUT le monde d'un
 * coup ; `users.publishing_enabled` est l'option payée par l'utilisateur. Un
 * seul drapeau aurait obligé à désactiver les comptes un par un le jour où
 * Zernio tombe.
 *
 * ⚠️ LES DEUX VALENT `false` PAR DÉFAUT. Une table absente, une ligne
 * manquante, une migration pas encore appliquée : tous ces cas se lisent
 * « fermé ». C'est la seule lecture sûre — l'inverse ouvrirait la publication
 * à tout le monde au premier déploiement.
 *
 * ⚠️ L'ADMINISTRATEUR EST TOUJOURS AUTORISÉ, et garde ses intégrations
 * directes (`/api/social/*`). Zernio lui est ouvert s'il le veut : le chemin
 * est un choix, pas une migration forcée.
 */

export type RefusPublication =
  | 'coupe-circuit'
  | 'option-absente'
  | 'zernio-absent'
  | 'profil-absent';

export interface DroitPublication {
  autorise: boolean;
  admin: boolean;
  raison?: RefusPublication;
  profileId?: string | null;
}

/** Message rendu à l'utilisateur — un refus sans motif se vit comme une panne. */
export const MESSAGES_REFUS: Record<RefusPublication, string> = {
  'coupe-circuit': 'La publication sur les réseaux est momentanément désactivée.',
  'option-absente': 'Activez l’option Publication pour publier sur vos réseaux.',
  'zernio-absent': 'La publication sur les réseaux n’est pas configurée sur ce serveur.',
  'profil-absent': 'Votre espace de publication n’est pas encore prêt. Réessayez dans un instant.',
};

/** L'interrupteur global. Absent, illisible, table manquante : `false`. */
export async function publicationOuverte(): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', 'user_publishing_enabled')
      .limit(1);
    if (error) {
      console.error(
        `[Publication] site_settings illisible (${error.message}) — publication FERMEE. `
        + 'Appliquer migrations/2026-08-08-zernio.sql puis '
        + '`docker kill -s SIGUSR1 studiio-postgrest`.',
      );
      return false;
    }
    return (data?.[0] as { value?: string } | undefined)?.value === 'true';
  } catch (err) {
    console.error('[Publication] Sonde site_settings impossible :', err);
    return false;
  }
}

/** Écrit l'interrupteur global — réservé à l'écran d'administration. */
export async function definirPublicationOuverte(ouverte: boolean): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from('site_settings')
      .upsert(
        { key: 'user_publishing_enabled', value: ouverte ? 'true' : 'false', updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    if (error) {
      console.error('[Publication] Ecriture du coupe-circuit echouee :', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Publication] Ecriture du coupe-circuit impossible :', err);
    return false;
  }
}

/**
 * Cet utilisateur peut-il publier ?
 *
 * Rend le MOTIF du refus et non un simple booléen : l'écran doit pouvoir
 * distinguer « activez votre option » de « le service est coupé », qui
 * n'appellent pas la même action.
 */
export async function droitDePublier(userId: string, email?: string | null): Promise<DroitPublication> {
  const { zernioConfigured } = await import('@/lib/social/zernio');

  let profileId: string | null = null;
  let optionActive = false;
  // ⚠️ L'EMAIL EST RELU EN BASE QUAND L'APPELANT NE L'A PAS. Le cron n'a pas
  // de session : il appelait `droitDePublier(userId, undefined)`, l'admin
  // n'était donc jamais reconnu, le coupe-circuit fermé le refusait, et le
  // post retombait sur l'ancien chemin Meta (« Aucun compte social
  // connecté ») alors que ses quatre comptes Zernio étaient connectés.
  let emailEnBase: string | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('users')
      .select('zernio_profile_id, publishing_enabled, email')
      .eq('id', userId)
      .limit(1);
    const ligne = data?.[0] as { zernio_profile_id?: string | null; publishing_enabled?: boolean; email?: string | null } | undefined;
    profileId = ligne?.zernio_profile_id ?? null;
    optionActive = ligne?.publishing_enabled === true;
    emailEnBase = ligne?.email ?? null;
  } catch (err) {
    console.error('[Publication] Lecture du droit impossible :', err);
  }
  const admin = isAdmin(email ?? emailEnBase);

  if (!zernioConfigured()) {
    return { autorise: false, admin, raison: 'zernio-absent', profileId };
  }
  // ⚠️ L'ADMIN SAUTE LES DEUX DRAPEAUX, mais PAS la configuration : sans clé
  // API, personne ne publie — y compris lui.
  if (admin) return { autorise: true, admin, profileId };

  if (!(await publicationOuverte())) {
    return { autorise: false, admin, raison: 'coupe-circuit', profileId };
  }
  if (!optionActive) {
    return { autorise: false, admin, raison: 'option-absente', profileId };
  }
  return { autorise: true, admin, profileId };
}

/**
 * Le média d'un post est-il publiable sur les réseaux ?
 *
 * ⚠️ C'EST LE GARDE-FOU LE PLUS IMPORTANT DE CE LOT. Instagram, TikTok et
 * YouTube exigent un MP4 H.264 valide. Le compositeur navigateur produit du
 * WebM — et, en mode rapide, un WebM aux métadonnées temporelles CASSÉES
 * (cf. CLAUDE.md) : les dix premiers posts du Calendrier sont dans ce cas.
 *
 * Envoyer un tel fichier ne produit pas une erreur franche : le réseau
 * l'accepte, puis le rejette des heures plus tard, ou publie une vidéo
 * illisible. Mieux vaut refuser tout de suite, en le disant.
 */
export function mediaPubliable(url: string | null | undefined): { ok: boolean; motif?: string } {
  if (!url) {
    return { ok: false, motif: 'Ce montage n’a pas encore de vidéo.' };
  }
  if (!/^https?:\/\//.test(url)) {
    return { ok: false, motif: 'La vidéo de ce montage n’a pas d’adresse publique.' };
  }
  // Le nom de fichier fait foi : c'est ce que le compositeur et le rendu
  // serveur écrivent, et c'est ce que le stockage sert.
  const chemin = url.split('?')[0].toLowerCase();
  if (chemin.endsWith('.webm')) {
    return {
      ok: false,
      motif: 'Ce montage doit d’abord être finalisé en vidéo avec audio (MP4) — '
        + 'le format actuel n’est pas accepté par les réseaux.',
    };
  }
  if (!chemin.endsWith('.mp4') && !chemin.endsWith('.mov')) {
    return {
      ok: false,
      motif: 'Format vidéo non accepté par les réseaux : un MP4 est requis.',
    };
  }
  return { ok: true };
}

/** Les comptes Zernio connectés d'un utilisateur, par plateforme. */
export async function comptesConnectes(userId: string): Promise<Array<{
  accountId: string; platform: string; username: string | null;
}>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('zernio_accounts')
      .select('account_id, platform, username, status')
      .eq('user_id', userId)
      .eq('status', 'connected');
    if (error) {
      console.error('[Publication] Lecture des comptes echouee :', error.message);
      return [];
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      accountId: String(r.account_id),
      platform: String(r.platform),
      username: (r.username as string | null) ?? null,
    }));
  } catch (err) {
    console.error('[Publication] Lecture des comptes impossible :', err);
    return [];
  }
}

/** Réseau publié par Zernio. */
export type ReseauZernio = 'instagram' | 'facebook' | 'tiktok' | 'youtube';

/**
 * Les réseaux Zernio demandés par un post, en identifiant CANONIQUE
 * (`instagram`, `facebook`, `tiktok`, `youtube`), sans doublon.
 *
 * ⚠️ C'EST LA SEULE CONVERSION. Le Calendrier écrit des libellés
 * (« Instagram »), l'Autopilote des identifiants (« instagram ») : comparer
 * les uns aux autres sans passer par ici donnait zéro cible. Les autres
 * canaux (Email, WhatsApp…) ne sont pas des réseaux Zernio : ignorés.
 */
export function reseauxZernioDemandes(platforms: readonly unknown[] | null | undefined): ReseauZernio[] {
  const out: ReseauZernio[] = [];
  for (const p of platforms ?? []) {
    if (typeof p !== 'string') continue;
    const r = reseauDepuisLibelle(p);
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

export interface ResolutionCibles {
  /** Réseaux Zernio demandés par le post (canoniques). */
  demandes: ReseauZernio[];
  /** Comptes Zernio connectés de l'utilisateur — la source de la page Réseaux. */
  comptes: ReadonlyArray<{ accountId: string; platform: string }>;
  /** Comptes à cibler : un par réseau demandé ET connecté. */
  cibles: Array<{ platform: ReseauZernio; accountId: string }>;
  /** Réseaux demandés sans compte connecté. */
  manquants: ReseauZernio[];
}

/**
 * LA résolution des comptes de publication — partagée par le cron et par
 * `publierViaZernio`. Pure : l'appelant lui passe les comptes lus par
 * `comptesConnectes` (même table que la page Réseaux sociaux), relus à
 * CHAQUE publication — un compte connecté après la création du post compte.
 */
export function resoudreCibles(
  platforms: readonly unknown[] | null | undefined,
  comptes: ReadonlyArray<{ accountId: string; platform: string }>,
): ResolutionCibles {
  const demandes = reseauxZernioDemandes(platforms);
  const cibles: ResolutionCibles['cibles'] = [];
  const manquants: ReseauZernio[] = [];
  for (const r of demandes) {
    const compte = comptes.find((c) => reseauDepuisLibelle(c.platform) === r);
    if (compte) cibles.push({ platform: r, accountId: compte.accountId });
    else manquants.push(r);
  }
  return { demandes, comptes, cibles, manquants };
}

/**
 * Le profil Zernio de l'utilisateur, créé au besoin.
 *
 * ⚠️ IDEMPOTENT, ET C'EST UNE QUESTION D'ARGENT. Chaque profil est facturé :
 * en créer un second parce qu'un appel a expiré ferait payer deux fois. D'où
 * le rattrapage par nom avant toute création.
 */
export async function assurerProfil(userId: string, email?: string | null): Promise<string | null> {
  const { createProfile, findProfileByName } = await import('@/lib/social/zernio');
  try {
    const { data } = await supabaseAdmin
      .from('users').select('zernio_profile_id').eq('id', userId).limit(1);
    const existant = (data?.[0] as { zernio_profile_id?: string | null } | undefined)?.zernio_profile_id;
    if (existant) return existant;

    // Le nom EST l'identifiant Studiio : unique par équipe chez Zernio, et
    // c'est ce qui permet de retrouver un profil créé par un appel perdu.
    const deja = await findProfileByName(userId);
    const profil = deja ?? await createProfile(userId, email ?? undefined);

    const { error } = await supabaseAdmin
      .from('users').update({ zernio_profile_id: profil._id }).eq('id', userId);
    if (error) console.error('[Publication] Profil non memorise :', error.message);
    return profil._id;
  } catch (err) {
    console.error('[Publication] Provisionnement impossible :', err);
    return null;
  }
}
