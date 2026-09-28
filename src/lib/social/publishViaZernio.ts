import { supabaseAdmin } from '@/lib/db/supabase';
import { droitDePublier, comptesConnectes, mediaPubliable } from '@/lib/social/publishing';
import { createPost, uploadMedia, ZernioError } from '@/lib/social/zernio';
import { toAbsoluteMediaUrl } from '@/lib/storage/resolve-url';

/**
 * Publier un post Studiio sur les réseaux de l'utilisateur, via Zernio.
 *
 * ⚠️ CE CHEMIN NE REMPLACE PAS CELUI DE L'ADMINISTRATEUR. `/api/social/*` et
 * `token-refresh.ts` continuent de fonctionner exactement comme avant : ils
 * publient sur les comptes que Studiio détient en propre. Zernio publie sur
 * les comptes DES UTILISATEURS. Les deux coexistent, et l'administrateur
 * choisit.
 *
 * ⚠️ UN ÉCHEC DE PUBLICATION N'EST JAMAIS FATAL. Le montage est rendu, le
 * post existe : refuser tout le cycle parce qu'un réseau répond mal ferait
 * perdre une vidéo payée pour une panne qui ne nous appartient pas. On
 * journalise, on marque `failed`, et on continue.
 */

export type ResultatPublication =
  /** `dejaEnvoye` : Zernio avait deja accepte ce post, rien n'a ete recree. */
  | { ok: true; zernioPostId: string; comptes: number; dejaEnvoye?: boolean }
  | { ok: false; motif: string; reessayable: boolean };

export interface PostAPublier {
  id: string;
  userId: string;
  email?: string | null;
  caption: string;
  /** URL de la vidéo rendue — doit être un MP4 (voir `mediaPubliable`). */
  mediaUrl: string | null;
  /** Plateformes demandées, telles qu'écrites sur le post. */
  platforms: string[];
  /** ISO. Absent : publication immédiate. */
  scheduledFor?: string | null;
  timezone?: string;
}

/**
 * Publie, ou dit précisément pourquoi il ne peut pas.
 *
 * L'ordre des refus n'est pas anodin : on vérifie le DROIT avant le média, et
 * le média avant d'appeler Zernio. Téléverser une vidéo de 30 Mo pour
 * découvrir ensuite que l'utilisateur n'a pas l'option serait payer un
 * transfert pour rien.
 */
export async function publierViaZernio(post: PostAPublier): Promise<ResultatPublication> {
  // ⚠️ IDEMPOTENCE, AVANT TOUT. Si Zernio a deja accepte ce post, un second
  // `createPost` le publierait une deuxieme fois sur les reseaux de
  // l'utilisateur. La preuve est relue EN BASE, jamais prise de l'appelant :
  // sa copie du post peut dater d'avant le premier envoi.
  let dejaEnvoye: string | null;
  try {
    dejaEnvoye = await zernioPostIdExistant(post.id);
  } catch (e) {
    // Sans pouvoir verifier, on ne publie pas : un echec se rejoue, une
    // double publication ne se rattrape pas.
    console.error(`[Zernio/Publication] post ${post.id} : verification d'idempotence impossible :`, e);
    return { ok: false, motif: 'Publication impossible.', reessayable: true };
  }
  if (dejaEnvoye) {
    console.warn(`[Zernio/Publication] post ${post.id} deja remis a Zernio (${dejaEnvoye}) — pas de nouvel envoi.`);
    return { ok: true, zernioPostId: dejaEnvoye, comptes: 0, dejaEnvoye: true };
  }

  const droit = await droitDePublier(post.userId, post.email);
  if (!droit.autorise) {
    return { ok: false, motif: droit.raison ?? 'option-absente', reessayable: false };
  }

  // ⚠️ LE GARDE MEDIA, AVANT TOUT APPEL RESEAU. Un WebM « mode rapide » est
  // accepte par certains reseaux puis rejete des heures plus tard, ou publie
  // illisible : le refuser ici est la seule facon de le dire a temps.
  // ⚠️ URL ABSOLUE AVANT LE GARDE. Sous MinIO, la `publicUrl` enregistree est
  // RELATIVE : le garde la refusait (« pas d'adresse publique ») et le
  // telechargement cote serveur ne pourrait pas la lire. Une URL deja
  // absolue ressort inchangee.
  const mediaSource = post.mediaUrl ? toAbsoluteMediaUrl(post.mediaUrl) : post.mediaUrl;
  const media = mediaPubliable(mediaSource);
  if (!media.ok) {
    return { ok: false, motif: media.motif!, reessayable: false };
  }

  const comptes = await comptesConnectes(post.userId);
  const cibles = comptes
    .filter((c) => post.platforms.includes(c.platform))
    .map((c) => ({ platform: c.platform, accountId: c.accountId }));

  if (cibles.length === 0) {
    return {
      ok: false,
      motif: 'Aucun compte connecté pour les réseaux demandés.',
      reessayable: false,
    };
  }

  try {
    // Le téléversement se fait MAINTENANT : l'URL présignée de Zernio ne vaut
    // qu'une heure, et son fichier temporaire sept jours.
    const mediaUrl = await uploadMedia(
      mediaSource!,
      `studiio-${post.id}.mp4`,
      'video/mp4',
    );

    const zernio = await createPost({
      content: post.caption,
      platforms: cibles,
      mediaUrl,
      ...(post.scheduledFor
        ? { scheduledFor: post.scheduledFor, timezone: post.timezone ?? 'Europe/Paris' }
        : { publishNow: true }),
      // ⚠️ C'EST CE QUI PERMETTRA AU WEBHOOK DE RETROUVER LE POST. Sans cet
      // identifiant, `post.published` arriverait sans savoir quoi mettre a
      // jour, et le Calendrier resterait indefiniment « programme ».
      metadata: { studiioPostId: post.id },
    });

    // ⚠️ L'IDENTIFIANT ZERNIO VA DANS `metadata`, PAS DANS UNE COLONNE. En
    // ajouter une aurait demande une migration de plus pour une valeur de
    // diagnostic ; `scheduled_posts.metadata` est deja un JSON libre.
    //
    // Relecture puis fusion : un `update` direct ECRASERAIT tout le reste des
    // metadonnees — sequences, design, URLs du montage.
    try {
      const { data } = await supabaseAdmin
        .from('scheduled_posts').select('metadata').eq('id', post.id).limit(1);
      const meta = ((data?.[0] as { metadata?: Record<string, unknown> } | undefined)?.metadata) ?? {};
      await supabaseAdmin
        .from('scheduled_posts')
        .update({ metadata: { ...meta, zernioPostId: zernio._id } })
        .eq('id', post.id);
    } catch (e) {
      // Le post EST parti : ne pas le compter en echec pour une note de
      // diagnostic manquee.
      console.error('[Zernio/Publication] identifiant non memorise :', e);
    }

    return { ok: true, zernioPostId: zernio._id, comptes: cibles.length };
  } catch (err) {
    if (err instanceof ZernioError) {
      console.error(`[Zernio/Publication] post ${post.id} :`, err.message);
      if (err.paymentRequired) {
        // ⚠️ NE JAMAIS REESSAYER : la facturation Zernio est suspendue, et
        // aucun nombre de tentatives n'y changera quoi que ce soit.
        console.error('[Zernio/Publication] FACTURATION SUSPENDUE — intervention requise.');
      }
      return {
        ok: false,
        motif: err.paymentRequired
          ? 'Service de publication suspendu.'
          : 'Le réseau a refusé la publication.',
        reessayable: err.retryable,
      };
    }
    console.error(`[Zernio/Publication] post ${post.id} :`, err);
    return { ok: false, motif: 'Publication impossible.', reessayable: true };
  }
}

/** `metadata.zernioPostId` du post, relu en base. Leve si la lecture echoue. */
async function zernioPostIdExistant(postId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('scheduled_posts').select('metadata').eq('id', postId).limit(1);
  if (error) throw new Error(error.message);
  const meta = (data?.[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata;
  const id = meta?.zernioPostId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
