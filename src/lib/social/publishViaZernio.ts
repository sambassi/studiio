import { supabaseAdmin } from '@/lib/db/supabase';
import { droitDePublier, comptesConnectes, resoudreCibles, mediaPubliable } from '@/lib/social/publishing';
import { createPost, uploadMedia, ZernioError } from '@/lib/social/zernio';
import { toAbsoluteMediaUrl } from '@/lib/storage/resolve-url';
import { traduireErreurZernio, type TraductionErreur } from '@/lib/social/erreursZernio';
import {
  besoinImageExtraite, lireCouverture, lireReglagesTiktok, reglagesCouverture, tiktokSettings, validerTiktok,
  type PlanCouverture, type ReseauCouverture,
} from '@/lib/social/couverture';
import { imageDepuisVideo } from '@/lib/social/imageDepuisVideo';

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
  | {
      ok: true; zernioPostId: string; comptes: number; dejaEnvoye?: boolean;
      /** Ce qui a été appliqué comme couverture, réseau par réseau. */
      couvertures?: Array<{ reseau: string; applique: PlanCouverture['applique']; repli: string | null }>;
      /** Phrases à montrer dans le Calendrier (réseau écarté, repli de couverture). */
      avertissements?: string[];
    }
  /**
   * `preuveAncienne` : le post porte un `zernioPostId` sans `zernioForPostId`
   * (ecrit avant ce correctif). L'appelant doit retirer cette preuve en
   * marquant le post `failed`, pour qu'une reprogrammation EXPLICITE
   * republie. Voir `etatPreuveZernio`.
   */
  | {
      ok: false; motif: string; reessayable: boolean; preuveAncienne?: boolean;
      /** Une ligne par réseau visé — pour `metadata.cron_publish_results`. */
      details?: TraductionErreur['details'];
      /** Code et message rendus par Zernio — pour `metadata.zernioErreur`. */
      technique?: TraductionErreur['technique'];
    };

/**
 * La preuve qu'une tentative a ete remise a Zernio, lue dans `metadata`.
 *
 * ⚠️ ELLE EST LIEE AU POST QUI L'A ECRITE. `metadata` voyage : « Dupliquer »
 * dans le Calendrier recopie tout, `zernioPostId` compris. Sans
 * `zernioForPostId`, la copie se croirait deja publiee et resterait bloquee a
 * `publishing` pour toujours.
 *
 * - `valide`    : `zernioPostId` + `zernioForPostId === postId` → deja envoye.
 * - `etrangere` : `zernioForPostId` designe un AUTRE post → une copie, a publier.
 * - `ancienne`  : `zernioPostId` sans `zernioForPostId` (ecrit avant ce
 *                 correctif). Impossible de distinguer l'original d'une copie :
 *                 on ne publie PAS (une double publication ne se rattrape
 *                 pas), on echoue EXPLICITEMENT (jamais un blocage muet).
 * - `absente`   : rien → a publier.
 */
export type EtatPreuveZernio = 'valide' | 'etrangere' | 'ancienne' | 'absente';

export function etatPreuveZernio(
  metadata: Record<string, unknown> | null | undefined,
  postId: string,
): EtatPreuveZernio {
  const id = metadata?.zernioPostId;
  if (typeof id !== 'string' || id.length === 0) return 'absente';
  const pour = metadata?.zernioForPostId;
  if (typeof pour !== 'string' || pour.length === 0) return 'ancienne';
  return pour === postId ? 'valide' : 'etrangere';
}

/** Les metadonnees sans preuve Zernio — pour autoriser une reprogrammation. */
export function sansPreuveZernio(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const { zernioPostId: _id, zernioForPostId: _pour, ...reste } = metadata ?? {};
  return reste;
}

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
  /** `reel` / `tv` — un `reel` part en Short sur YouTube (pas de miniature personnalisée). */
  format?: string | null;
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
  let meta: Record<string, unknown> | null;
  try {
    meta = await metadataEnBase(post.id);
  } catch (e) {
    // Sans pouvoir verifier, on ne publie pas : un echec se rejoue, une
    // double publication ne se rattrape pas.
    console.error(`[Zernio/Publication] post ${post.id} : verification d'idempotence impossible :`, e);
    return { ok: false, motif: 'Publication impossible.', reessayable: true };
  }
  const preuve = etatPreuveZernio(meta, post.id);
  if (preuve === 'valide') {
    const dejaEnvoye = String(meta!.zernioPostId);
    console.warn(`[Zernio/Publication] post ${post.id} deja remis a Zernio (${dejaEnvoye}) — pas de nouvel envoi.`);
    return { ok: true, zernioPostId: dejaEnvoye, comptes: 0, dejaEnvoye: true };
  }
  if (preuve === 'ancienne') {
    console.warn(`[Zernio/Publication] post ${post.id} : preuve Zernio sans zernioForPostId — envoi refuse par prudence.`);
    return {
      ok: false,
      motif: 'Ce post a peut-être déjà été publié. Vérifiez vos réseaux, puis reprogrammez-le pour le publier à nouveau.',
      reessayable: false,
      preuveAncienne: true,
    };
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

  const { demandes, comptes, cibles, manquants } = resoudreCibles(post.platforms, await comptesConnectes(post.userId));
  console.log(`[Zernio/Publication] post ${post.id} : demandes=${demandes.join(',') || 'aucun'} connectes=${comptes.length} cibles=${cibles.length}${manquants.length ? ` manquants=${manquants.join(',')}` : ''}`);

  if (cibles.length === 0) {
    return {
      ok: false,
      motif: 'Aucun compte connecté pour les réseaux demandés.',
      reessayable: false,
    };
  }

  // ── TikTok : réglages obligatoires + consentement explicite ──────────────
  // Sans consentement (case cochée par l'utilisateur), TikTok est ÉCARTÉ
  // avant tout appel au fournisseur ; les autres réseaux partent quand même.
  const avertissements: string[] = [];
  const reglagesTt = lireReglagesTiktok(meta);
  const verdictTt = validerTiktok(reglagesTt);
  let ciblesRetenues = cibles;
  if (cibles.some((c) => c.platform === 'tiktok') && !verdictTt.ok) {
    ciblesRetenues = cibles.filter((c) => c.platform !== 'tiktok');
    avertissements.push(verdictTt.motif);
    if (ciblesRetenues.length === 0) {
      return {
        ok: false,
        motif: verdictTt.motif,
        reessayable: false,
        details: [{ platform: 'TikTok', success: false, error: verdictTt.motif }],
      };
    }
  }

  // ── Couverture ──────────────────────────────────────────────────────────
  // Absente (anciens posts) : aucun réglage ajouté — la requête d'avant.
  const cover = lireCouverture(meta);
  const format = post.format ?? (typeof meta?.format === 'string' ? meta.format : null);
  const reseauxRetenus = ciblesRetenues.map((c) => c.platform as ReseauCouverture);
  const imageExtraite = besoinImageExtraite(reseauxRetenus, cover, format) && cover?.frameMs !== undefined
    ? await imageDepuisVideo(mediaSource!, cover.frameMs, post.userId)
    : null;
  const absolue = (u: string | undefined) => (u ? toAbsoluteMediaUrl(u) : u);
  const plans = ciblesRetenues.map((c) => {
    const plan = reglagesCouverture(c.platform as ReseauCouverture, cover, { format, imageExtraite });
    if (plan.platformSpecificData?.instagramThumbnail) {
      plan.platformSpecificData = { ...plan.platformSpecificData, instagramThumbnail: absolue(String(plan.platformSpecificData.instagramThumbnail)) };
    }
    if (plan.tiktokCouverture?.video_cover_image_url) {
      plan.tiktokCouverture = { ...plan.tiktokCouverture, video_cover_image_url: absolue(String(plan.tiktokCouverture.video_cover_image_url)) };
    }
    if (plan.repli) avertissements.push(plan.repli);
    return plan;
  });
  // ⚠️ LA MINIATURE VA SUR LE MÉDIA DU SEUL RÉSEAU QUI LA VEUT. Posée sur
  // `mediaItems[].thumbnail` (commun à TOUS les réseaux du post), elle
  // partait aussi vers un YouTube Short — qui ne l'accepte pas : un refus
  // aurait fait retirer la couverture de Facebook avec. `customMedia`
  // (docs Zernio, guide médias) remplace le média pour UNE entrée : la même
  // vidéo, avec sa miniature, pour Facebook / YouTube classique seulement.
  const construireCibles = (avecCouverture: boolean, mediaUrl: string) => ciblesRetenues.map((c, i) => {
    const plan = avecCouverture ? plans[i] : null;
    const psd: Record<string, unknown> = {
      ...(plan?.platformSpecificData ?? {}),
      ...(c.platform === 'tiktok' && reglagesTt ? { tiktokSettings: tiktokSettings(reglagesTt, plan) } : {}),
    };
    const miniature = absolue(plan?.miniatureMedia);
    return {
      ...c,
      ...(Object.keys(psd).length ? { platformSpecificData: psd } : {}),
      ...(miniature ? { customMedia: [{ type: 'video' as const, url: mediaUrl, thumbnail: miniature }] } : {}),
    };
  });
  const couvertureAppliquee = plans.some((p) => p.applique !== 'auto');

  try {
    // Le téléversement se fait MAINTENANT : l'URL présignée de Zernio ne vaut
    // qu'une heure, et son fichier temporaire sept jours.
    const mediaUrl = await uploadMedia(
      mediaSource!,
      `studiio-${post.id}.mp4`,
      'video/mp4',
    );

    const envoyer = (avecCouverture: boolean) => createPost({
      content: post.caption,
      platforms: construireCibles(avecCouverture, mediaUrl),
      mediaUrl,
      ...(post.scheduledFor
        ? { scheduledFor: post.scheduledFor, timezone: post.timezone ?? 'Europe/Paris' }
        : { publishNow: true }),
      // ⚠️ C'EST CE QUI PERMETTRA AU WEBHOOK DE RETROUVER LE POST. Sans cet
      // identifiant, `post.published` arriverait sans savoir quoi mettre a
      // jour, et le Calendrier resterait indefiniment « programme ».
      metadata: { studiioPostId: post.id },
    });

    // ⚠️ UNE MINIATURE NE FAIT JAMAIS ÉCHOUER LA PUBLICATION. Un refus de
    // validation (400/422) alors qu'une couverture était posée : le post
    // n'a PAS été créé chez Zernio, on renvoie donc UNE fois sans couverture
    // — aucune double publication possible. Les refus d'autorisation, de
    // facturation ou de quota (401/402/403/429) ne sont pas concernés.
    let couverturesEnvoyees = couvertureAppliquee;
    let zernio;
    try {
      zernio = await envoyer(true);
    } catch (e) {
      if (!(couvertureAppliquee && e instanceof ZernioError && (e.status === 400 || e.status === 422))) throw e;
      console.warn(`[Zernio/Publication] post ${post.id} : couverture refusee (${e.status}) — renvoi sans couverture`);
      avertissements.push(`Couverture refusée par le réseau${e.detail ? ` (${e.detail.slice(0, 160)})` : ''} : couverture choisie automatiquement.`);
      couverturesEnvoyees = false;
      zernio = await envoyer(false);
    }
    const couvertures = plans.map((p) => (couverturesEnvoyees
      ? { reseau: p.reseau, applique: p.applique, repli: p.repli }
      : { reseau: p.reseau, applique: 'auto' as const, repli: p.applique === 'auto' ? p.repli : 'couverture refusée par le réseau' }));

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
        // `zernioForPostId` lie la preuve a CE post : une copie qui la
        // recopierait sera reconnue comme etrangere, donc publiee.
        .update({ metadata: {
          ...meta, zernioPostId: zernio._id, zernioForPostId: post.id,
          // Ce qui a vraiment été appliqué : le Calendrier l'affiche.
          couvertures,
          avertissementsPublication: avertissements,
        } })
        .eq('id', post.id);
    } catch (e) {
      // Le post EST parti : ne pas le compter en echec pour une note de
      // diagnostic manquee.
      console.error('[Zernio/Publication] identifiant non memorise :', e);
    }

    return { ok: true, zernioPostId: zernio._id, comptes: ciblesRetenues.length, couvertures, avertissements };
  } catch (err) {
    if (err instanceof ZernioError) {
      console.error(`[Zernio/Publication] post ${post.id} :`, err.message);
      if (err.paymentRequired) {
        // ⚠️ NE JAMAIS REESSAYER : la facturation Zernio est suspendue, et
        // aucun nombre de tentatives n'y changera quoi que ce soit.
        console.error('[Zernio/Publication] FACTURATION SUSPENDUE — intervention requise.');
      }
      const traduction = traduireErreurZernio({ status: err.status, code: err.code, detail: err.detail }, cibles);
      if (traduction.compteDeconnecte) {
        // ⚠️ LA PAGE RÉSEAUX DOIT LE DIRE. Zernio a refusé ce compte (jeton
        // expiré ou révoqué) : le laisser « connecté » chez nous ferait
        // échouer chaque publication suivante sans que personne ne sache
        // qu'il faut reconnecter.
        await marquerDeconnecte(post.userId, traduction.compteDeconnecte);
      }
      return {
        ok: false,
        motif: traduction.motif,
        reessayable: err.retryable,
        details: traduction.details,
        technique: traduction.technique,
      };
    }
    console.error(`[Zernio/Publication] post ${post.id} :`, err);
    return { ok: false, motif: 'Publication impossible.', reessayable: true };
  }
}

/** Compte Zernio refusé par Zernio : `disconnected`, pour que la page Réseaux le montre. */
async function marquerDeconnecte(userId: string, accountId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('zernio_accounts')
      .update({ status: 'disconnected', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('account_id', accountId);
    if (error) console.error('[Zernio/Publication] compte non marque deconnecte :', error.message);
  } catch (e) {
    console.error('[Zernio/Publication] compte non marque deconnecte :', e);
  }
}

/** `metadata` du post, relue en base. Leve si la lecture echoue. */
async function metadataEnBase(postId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from('scheduled_posts').select('metadata').eq('id', postId).limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata ?? null;
}
