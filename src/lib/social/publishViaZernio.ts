import { supabaseAdmin } from '@/lib/db/supabase';
import { droitDePublier, comptesConnectes, resoudreCibles, mediaPubliable } from '@/lib/social/publishing';
import { randomUUID } from 'crypto';
import { createPost, trouverPostStudiio, uploadMedia, ZernioError, type ZernioPostResult } from '@/lib/social/zernio';
import { signerSiNotreStockage } from '@/lib/storage/jeton-relais';
import { toAbsoluteMediaUrl } from '@/lib/storage/resolve-url';
import { traduireErreurZernio, type TraductionErreur } from '@/lib/social/erreursZernio';
import {
  besoinImageExtraite, lireCouverture, lireReglagesTiktok, reglagesCouverture, tiktokSettings, validerTiktok,
  type PlanCouverture, type ReseauCouverture,
} from '@/lib/social/couverture';
import { imageDepuisVideo } from '@/lib/social/imageDepuisVideo';
import { ErreurMediaPublication } from '@/lib/social/media-publication';

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
      /** Statut rendu par Zernio quand le post a été RETROUVÉ chez lui (`published`…). */
      statutZernio?: string;
      /** Le post est parti mais sa preuve n'a pas pu être écrite (2 essais). */
      preuveNonEcrite?: boolean;
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
      details?: TraductionErreur['details'] | ResultatReseau[];
      /** Code et message rendus par Zernio — pour `metadata.zernioErreur`. */
      technique?: TraductionErreur['technique'];
      /**
       * Clés à fusionner dans `metadata` en marquant l'échec (marqueur de
       * tentative, preuve d'un envoi partiel…). L'appelant écrit `failed`
       * depuis SA copie de `metadata`, antérieure à l'envoi : sans ceci, il
       * effacerait le marqueur posé avant `createPost`.
       */
      metadataAjout?: Record<string, unknown>;
      /** Clés à retirer de `metadata` (refus net : rien n'a été créé chez Zernio). */
      metadataRetrait?: string[];
      /** Zernio a peut-être créé le post, sans qu'on le sache (délai, coupure). */
      confirmationPerdue?: boolean;
      /** Vérification impossible : seul un « Réessayer » confirmé par l'utilisateur republiera. */
      confirmationRequise?: boolean;
      /** Publié sur une partie des réseaux seulement (`post.partial`). */
      partiel?: boolean;
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

/**
 * Les metadonnees sans preuve Zernio — pour autoriser une reprogrammation.
 * Le marqueur de tentative et ses drapeaux partent aussi : on n'appelle
 * ceci que quand Zernio a dit l'échec (`post.failed`) ou que la preuve est
 * écartée explicitement.
 */
export function sansPreuveZernio(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const {
    zernioPostId: _id, zernioForPostId: _pour,
    zernioTentative: _t, confirmationPerdue: _cp, confirmationRequise: _cr,
    ...reste
  } = metadata ?? {};
  return reste;
}

/**
 * MARQUEUR DE TENTATIVE — posé dans `metadata.zernioTentative` AVANT
 * `createPost`, et lié au post comme la preuve (`pour`).
 *
 * Il distingue les deux échecs que rien ne séparait :
 * - FAILED_BEFORE_PUBLISH : pas de marqueur, ou refus net de Zernio (4xx) →
 *   republier est sans risque ;
 * - PUBLISHED_BUT_CONFIRMATION_LOST : marqueur sans preuve (délai dépassé,
 *   coupure, preuve non écrite) → Zernio a PEUT-ÊTRE créé le post. Aucun
 *   nouvel envoi sans avoir d'abord demandé à Zernio (`trouverPostStudiio`) ;
 *   le renvoi réutilise `cle` comme `Idempotency-Key`, que Zernio honore 24 h.
 */
export interface TentativeZernio { cle: string; pour: string; le: string }

/** Au-delà, la clé d'idempotence a pu expirer chez Zernio (24 h) : marge d'une heure. */
export const DUREE_CLE_IDEMPOTENCE_MS = 23 * 60 * 60 * 1000;

export const MOTIF_CONFIRMATION_PERDUE =
  'Confirmation perdue : la publication est peut-être déjà partie. Vérifiez vos réseaux. '
  + '« Réessayer » vérifiera d’abord auprès du service de publication, sans jamais publier deux fois.';
export const MOTIF_VERIFICATION_IMPOSSIBLE =
  'Impossible de vérifier si ce post est déjà publié. Vérifiez vos réseaux : s’il n’y est pas, '
  + 'cliquez sur « Réessayer » et confirmez la republication.';
export const MOTIF_CONFIRMATION_REQUISE =
  'Ce post a peut-être déjà été publié il y a plus de 24 h, sans confirmation. Vérifiez vos réseaux : '
  + 's’il n’y est pas, cliquez sur « Réessayer » et confirmez la republication.';

/** Le marqueur de tentative de CE post (celui d'une copie « Dupliquer » est ignoré). */
export function tentativeZernio(
  metadata: Record<string, unknown> | null | undefined,
  postId: string,
): TentativeZernio | null {
  const t = metadata?.zernioTentative as Partial<TentativeZernio> | undefined;
  if (!t || typeof t !== 'object') return null;
  if (typeof t.cle !== 'string' || !t.cle || t.pour !== postId || typeof t.le !== 'string') return null;
  return { cle: t.cle, pour: t.pour, le: t.le };
}

type ResultatReseau = { platform: string; success: boolean; error?: string };

/** Résultats par réseau d'un post Zernio (webhook ou liste) → format `cron_publish_results`. */
export function resultatsParReseau(platforms: unknown): ResultatReseau[] {
  if (!Array.isArray(platforms)) return [];
  return platforms.map((p: any) => {
    const statut = String(p?.status ?? '');
    const erreur = p?.error ?? p?.errorMessage;
    return {
      platform: String(p?.platform ?? 'inconnu'),
      success: statut === 'published',
      ...(statut !== 'published' && typeof erreur === 'string' ? { error: erreur } : {}),
    };
  });
}

/** Message d'un envoi partiel — dit quoi est parti et comment republier le reste. */
export function motifPartiel(resultats: ResultatReseau[] | null | undefined): string {
  const echecs = (resultats ?? []).filter((r) => !r.success).map((r) => r.platform);
  return `Publié partiellement${echecs.length ? ` — échec sur : ${echecs.join(', ')}` : ''}. `
    + 'Les réseaux déjà servis ne seront pas republiés. Pour publier sur les autres, '
    + 'dupliquez ce post et ne gardez que ces réseaux.';
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
  if (preuve === 'valide' && meta?.zernioPartiel === true) {
    // ⚠️ ENVOI PARTIEL : la preuve reste (republier doublerait les réseaux
    // déjà servis), mais « Réessayer » ne doit pas finir bloqué à
    // `publishing` en attendant un webhook qui ne viendra plus : échec
    // explicite, avec la marche à suivre.
    const resultats = Array.isArray(meta.zernioResultatsReseaux) ? meta.zernioResultatsReseaux as ResultatReseau[] : [];
    console.warn(`[Zernio/Publication] post ${post.id} publie partiellement — pas de nouvel envoi.`);
    return {
      ok: false, motif: motifPartiel(resultats), reessayable: false, partiel: true,
      ...(resultats.length ? { details: resultats } : {}),
    };
  }
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
  // #547 : Zernio (et le réseau derrière lui) vient CHERCHER la miniature
  // sans cookie. Une image de NOTRE stockage reçoit un jeton du relais — et
  // seulement si elle appartient au publieur : la couverture vient du post,
  // donc du navigateur ; celle d'un autre compte reste nue et le relais la
  // refuse.
  const absolue = (u: string | undefined) => (u
    ? signerSiNotreStockage(toAbsoluteMediaUrl(u), { lecteur: post.userId }) as string
    : u);
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

  // ── Tentative précédente sans preuve : DEMANDER À ZERNIO avant tout envoi ──
  let tentative = tentativeZernio(meta, post.id);
  const sansVerification = meta?.publierSansVerification === true;
  if (tentative && !sansVerification) {
    let trouve: ZernioPostResult | null;
    try {
      trouve = await trouverPostStudiio(post.id, { depuis: tentative.le, accountId: cibles[0].accountId });
    } catch (e) {
      // « Je ne sais pas » ne vaut jamais « absent » : aucun envoi.
      console.error(`[Zernio/Publication] post ${post.id} : verification de la tentative impossible :`, e);
      return {
        ok: false, motif: MOTIF_VERIFICATION_IMPOSSIBLE, reessayable: false,
        confirmationPerdue: true, confirmationRequise: true,
        metadataAjout: { zernioTentative: tentative, confirmationPerdue: true, confirmationRequise: true },
      };
    }
    if (trouve) {
      const statut = String(trouve.status ?? '');
      if (statut !== 'failed' && statut !== 'cancelled') {
        console.warn(`[Zernio/Publication] post ${post.id} retrouve chez Zernio (${trouve._id}, ${statut}) — pas de nouvel envoi.`);
        const preuveTrouvee = { zernioPostId: trouve._id, zernioForPostId: post.id };
        if (statut === 'partial') {
          const resultats = resultatsParReseau(trouve.platforms);
          return {
            ok: false, motif: motifPartiel(resultats), reessayable: false, partiel: true,
            ...(resultats.length ? { details: resultats } : {}),
            metadataAjout: { ...preuveTrouvee, zernioPartiel: true, zernioResultatsReseaux: resultats },
            metadataRetrait: ['confirmationPerdue', 'confirmationRequise', 'publierSansVerification'],
          };
        }
        const ecrite = await fusionnerMetadata(post.id, preuveTrouvee,
          ['confirmationPerdue', 'confirmationRequise', 'publierSansVerification']);
        return {
          ok: true, zernioPostId: trouve._id, comptes: 0, dejaEnvoye: true, statutZernio: statut,
          ...(ecrite ? {} : { preuveNonEcrite: true }),
        };
      }
      // Zernio l'a en échec : rien n'est parti. Nouvelle clé — l'ancienne
      // rendrait ce post échoué au lieu d'en créer un.
      tentative = null;
    } else if (!(Date.now() - Date.parse(tentative.le) < DUREE_CLE_IDEMPOTENCE_MS)) {
      // Absent de la liste, mais la clé a pu expirer chez Zernio : plus de
      // seconde barrière. On demande à l'utilisateur.
      return {
        ok: false, motif: MOTIF_CONFIRMATION_REQUISE, reessayable: false, confirmationRequise: true,
        metadataAjout: { zernioTentative: tentative, confirmationRequise: true },
      };
    }
  }
  // Republication CONFIRMÉE par l'utilisateur : la clé encore valide est
  // gardée (Zernio rendra l'original s'il existe), sinon une nouvelle.
  if (tentative && sansVerification && !(Date.now() - Date.parse(tentative.le) < DUREE_CLE_IDEMPOTENCE_MS)) {
    tentative = null;
  }
  const tentativeCourante: TentativeZernio = tentative ?? { cle: randomUUID(), pour: post.id, le: new Date().toISOString() };
  let envoiTente = false;

  try {
    // Le téléversement se fait MAINTENANT : l'URL présignée de Zernio ne vaut
    // qu'une heure, et son fichier temporaire sept jours.
    const mediaUrl = await uploadMedia(
      mediaSource!,
      `studiio-${post.id}.mp4`,
      'video/mp4',
      post.userId,
    );

    // ⚠️ LE MARQUEUR AVANT L'ENVOI. Sans lui, un délai dépassé ou une preuve
    // non écrite rendait le post indiscernable d'un post jamais parti.
    // Pas de marqueur écrit → pas d'envoi (rien n'est parti : réessayable).
    const marque = await fusionnerMetadata(post.id, { zernioTentative: tentativeCourante },
      ['publierSansVerification', 'confirmationRequise']);
    if (!marque) {
      return { ok: false, motif: 'Publication impossible.', reessayable: true };
    }
    envoiTente = true;

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
    }, { idempotencyKey: tentativeCourante.cle });

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
    // Relecture puis fusion (`fusionnerMetadata`) : un `update` direct
    // ECRASERAIT tout le reste des metadonnees. Le `{ error }` de l'update
    // est VÉRIFIÉ et l'écriture rejouée une fois : ignoré, il laissait le
    // post sans preuve, et le reset des « bloqués » le republiait.
    // Si elle échoue encore, le marqueur de tentative reste : le reset met le
    // post en « confirmation perdue », jamais en `scheduled`.
    const preuveEcrite = await fusionnerMetadata(post.id, {
      // `zernioForPostId` lie la preuve a CE post : une copie qui la
      // recopierait sera reconnue comme etrangere, donc publiee.
      zernioPostId: zernio._id, zernioForPostId: post.id,
      // Ce qui a vraiment été appliqué : le Calendrier l'affiche.
      couvertures,
      avertissementsPublication: avertissements,
    }, ['confirmationPerdue', 'confirmationRequise']);
    if (!preuveEcrite) {
      // Le post EST parti : ne pas le compter en echec.
      console.error(`[Zernio/Publication] post ${post.id} : preuve d'envoi NON ecrite (${zernio._id}).`);
    }

    return {
      ok: true, zernioPostId: zernio._id, comptes: ciblesRetenues.length, couvertures, avertissements,
      ...(preuveEcrite ? {} : { preuveNonEcrite: true }),
    };
  } catch (err) {
    // ⚠️ MÉDIA REFUSÉ OU ILLISIBLE : motif FIXE (« Média de publication
    // refusé. »), jamais l'URL, l'adresse, le port ni le statut de la cible —
    // il finit dans `metadata.error`, lisible par l'auteur du post.
    if (err instanceof ErreurMediaPublication) {
      console.warn(`[Zernio/Publication] post ${post.id} : media ${err.code}`);
      return { ok: false, motif: err.message, reessayable: err.reessayable };
    }
    // ⚠️ PUBLISHED_BUT_CONFIRMATION_LOST. Après l'envoi, un délai dépassé,
    // une coupure, un 5xx, un 408 ou un 409 (traitement en cours, doublon)
    // ne prouvent PAS que rien n'a été créé : le marqueur reste, « Réessayer »
    // interrogera Zernio d'abord.
    const ambigu = envoiTente && (!(err instanceof ZernioError)
      || err.status >= 500 || err.status === 408 || err.status === 409);
    if (ambigu) {
      console.error(`[Zernio/Publication] post ${post.id} : confirmation perdue apres envoi :`, err);
      return {
        ok: false, motif: MOTIF_CONFIRMATION_PERDUE, reessayable: false, confirmationPerdue: true,
        metadataAjout: { zernioTentative: tentativeCourante, confirmationPerdue: true },
      };
    }
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
        // Refus net APRÈS l'envoi (4xx) : rien n'a été créé, le marqueur part.
        ...(envoiTente ? { metadataRetrait: ['zernioTentative'] } : {}),
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

/**
 * Relit `metadata`, retire `retrait`, fusionne `ajout`, et ÉCRIT — en
 * vérifiant le `{ error }` de chaque étape. Deux essais. `false` si rien n'a
 * pu être écrit. Une lecture en échec n'écrit JAMAIS (ce serait tout effacer).
 */
async function fusionnerMetadata(
  postId: string,
  ajout: Record<string, unknown>,
  retrait: string[] = [],
): Promise<boolean> {
  for (let essai = 1; essai <= 2; essai++) {
    try {
      const actuelle = { ...((await metadataEnBase(postId)) ?? {}) };
      for (const cle of retrait) delete actuelle[cle];
      const { error } = await supabaseAdmin
        .from('scheduled_posts')
        .update({ metadata: { ...actuelle, ...ajout } })
        .eq('id', postId);
      if (!error) return true;
      console.error(`[Zernio/Publication] post ${postId} : ecriture metadata en echec (essai ${essai}) :`, error.message);
    } catch (e) {
      console.error(`[Zernio/Publication] post ${postId} : ecriture metadata en echec (essai ${essai}) :`, e);
    }
  }
  return false;
}

/** `metadata` du post, relue en base. Leve si la lecture echoue. */
async function metadataEnBase(postId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from('scheduled_posts').select('metadata').eq('id', postId).limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata ?? null;
}
