import { NextRequest, NextResponse } from 'next/server';
import { MESSAGES_AVATAR } from '@/lib/avatar/fournisseurs';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits, deductCredits, addCredits } from '@/lib/credits/system';
import { compteExempteDeCredits } from '@/lib/facturation/exemption';
import { AVATAR_MAX_SCRIPT_CHARS } from '@/lib/stripe/constants';
import { prixDe } from '@/lib/tarifs/serveur';
import { cleTarifMoteurAvatar } from '@/lib/avatar/prix';
import {
  generateAvatarVideo,
  getAvatarTrainingStatus,
  moteursSupportesDuLook,
  resolveVoiceId,
  HeyGenError,
  type AvatarAspectRatio,
} from '@/lib/avatar/heygen';
import { versionDuCompte, ecrireVersion } from '@/lib/avatar/versions';
import { INTENTION_APERCU, SCRIPT_APERCU, lireIntention, etatAvatar } from '@/lib/avatar/contrat';
import { moteurPourMonAvatar, motifPremium } from '@/lib/avatar/moteurs';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const VALID_RATIOS: AvatarAspectRatio[] = ['9:16', '16:9', '1:1'];

/** Statuts HeyGen consideres comme « avatar utilisable ». */
const READY_STATUSES = ['completed', 'ready', 'success'];

/** Une réservation d'aperçu qui n'ira pas plus loin : marquée en échec, la place est libre. */
async function libererReservation(generationId: string, motif: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('avatar_generations')
    .update({ status: 'failed', error_message: motif })
    .eq('id', generationId);
  if (error) console.error(`[Avatar][apercu] Reservation ${generationId} non liberee :`, error.message);
}

/**
 * POST /api/avatar/generate — lance une video ou l'avatar prononce un texte.
 *
 * Ordre des operations (volontaire) :
 *   1. verification du solde        → 402 si insuffisant, aucun appel HeyGen
 *   2. debit des credits            → AVANT HeyGen, pour bloquer les requetes
 *                                     paralleles qui depasseraient le solde
 *   3. appel HeyGen                 → si echec, REMBOURSEMENT immediat
 *
 * La video n'est pas attendue ici : HeyGen rend en asynchrone. Le client
 * interroge ensuite GET /api/avatar/status.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let creditsDeducted = false;
  let coutFacture = 0;

  try {
    const body = await req.json();
    const avatarRowId: string | undefined = body?.avatarId;
    // L'INTENTION : un APERÇU (texte fixe de Studiio, une fois par version,
    // pour juger le clone avant de le valider) ou une génération NORMALE
    // (texte libre). Tout inconnu est « normale », comme la colonne.
    const intention = lireIntention(body?.intention);
    const script: string = intention === INTENTION_APERCU
      ? SCRIPT_APERCU
      : (body?.script ?? '').toString().trim();
    const voiceId: string | undefined = body?.voiceId || undefined;
    const aspectRatio: AvatarAspectRatio = VALID_RATIOS.includes(body?.aspectRatio)
      ? body.aspectRatio
      : '9:16';

    if (!script) {
      return NextResponse.json(
        { success: false, error: 'Le texte a prononcer est vide.' },
        { status: 400 },
      );
    }
    // La QUALITÉ de rendu (Standard / Qualité / Premium), pour une génération
    // normale seulement : le serveur décide du moteur et REFUSE une qualité
    // fermée — avant tout débit et tout appel fournisseur, jamais rabattue en
    // silence. Sans qualité (et pour l'aperçu) : corps inchangé.
    // Avatar III et IV ouverts ; Avatar V seulement si HeyGen le confirme pour CE look (revérifié plus bas, avant tout débit).
    const choixMoteur = intention === INTENTION_APERCU ? null : body?.qualite === undefined ? null : moteurPourMonAvatar(body.qualite);
    if (choixMoteur && !choixMoteur.ok) {
      return NextResponse.json(
        { success: false, error: choixMoteur.message, code: 'qualite_indisponible' },
        { status: 400 },
      );
    }
    if (script.length > AVATAR_MAX_SCRIPT_CHARS) {
      return NextResponse.json(
        {
          success: false,
          error: `Texte trop long (${script.length} caracteres). Maximum : ${AVATAR_MAX_SCRIPT_CHARS}.`,
        },
        { status: 400 },
      );
    }

    // Avatar de l'utilisateur — on verifie explicitement la propriete, et
    // seul un avatar VIVANT (`deleted_at` NULL) peut parler.
    const query = supabaseAdmin.from('user_avatars').select('*').eq('user_id', userId).is('deleted_at', null);
    const { data: avatarRows } = avatarRowId
      ? await query.eq('id', avatarRowId).limit(1)
      : await query.order('created_at', { ascending: false }).limit(1);

    let avatarRow = avatarRows?.[0];
    // APERÇU D'UNE VERSION CANDIDATE (remplacement) : le clone à juger est
    // celui de la candidate, pas l'avatar actif. On lit la candidate DU
    // COMPTE, puis son identité ; le statut ne sera écrit que sur elle.
    let candidateId: string | null = null;
    const versionIdDemande = typeof body?.versionId === 'string' ? body.versionId : null;
    if (versionIdDemande && intention === INTENTION_APERCU) {
      const cand = await versionDuCompte(userId, versionIdDemande);
      if (!cand || cand.abandoned_at) {
        return NextResponse.json({ success: false, error: 'Version introuvable.', code: 'version_introuvable' }, { status: 404 });
      }
      const { data: identites } = await supabaseAdmin.from('user_avatars').select('*')
        .eq('id', cand.user_avatar_id).eq('user_id', userId).is('deleted_at', null).limit(1);
      const ident = identites?.[0];
      if (!ident || ident.active_version_id === cand.id) {
        return NextResponse.json({ success: false, error: 'Version introuvable.', code: 'version_introuvable' }, { status: 404 });
      }
      candidateId = cand.id;
      avatarRow = {
        ...ident,
        provider: cand.provider, avatar_type: cand.avatar_type, status: cand.status,
        provider_avatar_id: cand.provider_avatar_id, version: cand.version,
        validated_at: cand.validated_at, consent_at: ident.consent_at ?? cand.created_at,
      };
    }
    if (!avatarRow) {
      return NextResponse.json(
        { success: false, error: "Aucun avatar. Creez d'abord votre avatar." },
        { status: 404 },
      );
    }
    if (!avatarRow.consent_at) {
      return NextResponse.json(
        { success: false, error: 'Consentement manquant sur cet avatar.' },
        { status: 403 },
      );
    }
    // Cette route est HeyGen (script + voix HeyGen sur /v3/videos). Un avatar
    // D-ID a son propre apercu (`/api/avatar/did/apercu`, sur MA voix) : on
    // refuse ici, avant tout debit — jamais un identifiant D-ID chez HeyGen.
    if (avatarRow.provider === 'did') {
      return NextResponse.json(
        { success: false, error: 'Cette generation n’est pas disponible pour un avatar video. Utilisez l’apercu de votre avatar video.', code: 'provider_did' },
        { status: 409 },
      );
    }
    // Sans identifiant fournisseur, il n'y a pas de clone : la source est
    // enregistree, mais rien ne peut parler. On ne sollicite jamais HeyGen
    // avec `null` — ni pour le statut, ni pour une video.
    if (!avatarRow.provider_avatar_id) {
      return NextResponse.json(
        {
          success: false,
          error: "Votre avatar n'est pas encore entraine. Renvoyez votre source depuis la page Avatar.",
          code: 'avatar_no_provider',
        },
        { status: 409 },
      );
    }

    // 1. L'avatar est-il pret ? HeyGen entraine l'avatar photo en asynchrone
    //    et refuse une generation sur un avatar encore en cours.
    //    Ce controle est fait AVANT tout debit : un avatar pas pret ne doit
    //    jamais consommer de credits, meme rembourses ensuite.
    const isVideoAvatar = avatarRow.avatar_type === 'video';

    if (!READY_STATUSES.includes(avatarRow.status)) {
      const training = await getAvatarTrainingStatus(avatarRow.provider_avatar_id);
      const remoteStatus = training?.status ?? null;
      console.log(
        `[Avatar] Avatar ${avatarRow.provider_avatar_id} (${avatarRow.avatar_type ?? 'photo'}) — statut local "${avatarRow.status}", statut HeyGen "${remoteStatus ?? 'inconnu'}"`,
      );

      if (remoteStatus && remoteStatus !== avatarRow.status) {
        const patch: Record<string, unknown> = { status: remoteStatus };
        if (remoteStatus === 'failed' && training?.error) patch.training_error = training.error;
        // Une candidate se met à jour ELLE-MÊME — jamais le miroir de l'actif.
        if (candidateId) await ecrireVersion(userId, candidateId, patch as { status: string; training_error?: string });
        else await supabaseAdmin.from('user_avatars').update(patch).eq('id', avatarRow.id);
        avatarRow.status = remoteStatus;
      }

      if (remoteStatus === 'failed') {
        if (training?.error) console.warn('[Avatar] entrainement en echec chez le fournisseur :', training.error);
        return NextResponse.json(
          {
            success: false,
            error: `L'entrainement de votre avatar a echoue. Renvoyez ${isVideoAvatar ? 'une video' : 'une photo'}.`,
            code: 'avatar_failed',
          },
          { status: 409 },
        );
      }
      if (remoteStatus === 'pending_consent') {
        return NextResponse.json(
          {
            success: false,
            error:
              "Votre avatar attend encore une validation. Reessayez dans quelques minutes.",
            code: 'avatar_pending_consent',
          },
          { status: 409 },
        );
      }
      if (remoteStatus && !READY_STATUSES.includes(remoteStatus)) {
        return NextResponse.json(
          {
            success: false,
            error: isVideoAvatar
              ? "Votre avatar video est encore en cours d'entrainement. Cela peut prendre plusieurs minutes."
              : 'Votre avatar est encore en cours de preparation. Reessayez dans une minute.',
            code: 'avatar_not_ready',
          },
          { status: 409 },
        );
      }
      // remoteStatus null = endpoint de statut indisponible : on continue et
      // on laissera HeyGen trancher, avec son message reel desormais visible.
    }

    // 2. Voix — OBLIGATOIRE. HeyGen l'a confirme explicitement :
    //    "voice_id is required: this avatar has no default voice configured".
    //    resolveVoiceId() garantit une valeur (liste HeyGen, puis env, puis
    //    constante documentee).
    const resolvedVoiceId = await resolveVoiceId(voiceId);
    console.log(
      `[Avatar][HeyGen] Requete a envoyer — avatar_id=${avatarRow.provider_avatar_id} voice_id=${resolvedVoiceId} ratio=${aspectRatio} script=${script.length} car.`,
    );

    // 2b. APERÇU : une seule génération vivante par version, RÉSERVÉE AVANT
    //     tout débit et tout appel — c'est l'index
    //     `avatar_generations_apercu_unique` qui tranche deux clics
    //     simultanés (23505 → 409, sans frais). Un aperçu n'a de sens que
    //     pour un clone entraîné et pas encore validé.
    let reservation: { id: string } | null = null;
    if (intention === INTENTION_APERCU) {
      const etat = etatAvatar({
        status: avatarRow.status, provider_avatar_id: avatarRow.provider_avatar_id,
        validated_at: avatarRow.validated_at ?? null, deleted_at: avatarRow.deleted_at ?? null,
      });
      if (etat !== 'entraine_non_valide') {
        return NextResponse.json(
          {
            success: false,
            error: etat === 'valide' ? 'Votre avatar est déjà validé.' : "Votre avatar n'est pas encore prêt pour un aperçu.",
            code: etat === 'valide' ? 'avatar_deja_valide' : 'avatar_not_ready',
          },
          { status: 409 },
        );
      }
      const { data: reservee, error: erreurReservation } = await supabaseAdmin
        .from('avatar_generations')
        .insert({
          user_id: userId,
          user_avatar_id: avatarRow.id,
          avatar_version: avatarRow.version,
          ...(candidateId ? { avatar_version_id: candidateId } : {}),
          intention: INTENTION_APERCU,
          provider_video_id: null,
          script,
          voice_id: resolvedVoiceId,
          aspect_ratio: aspectRatio,
          status: 'pending',
          credits_charged: 0,
        })
        .select('id')
        .single();
      if (erreurReservation || !reservee) {
        if (erreurReservation?.code === '23505') {
          return NextResponse.json(
            { success: false, error: 'Un aperçu est déjà en cours ou disponible pour cette version.', code: 'apercu_existant' },
            { status: 409 },
          );
        }
        console.error('[Avatar][apercu] Reservation impossible :', erreurReservation?.message);
        return NextResponse.json({ success: false, error: "L'aperçu n'a pas pu être réservé. Réessayez." }, { status: 500 });
      }
      reservation = reservee;
    }

    // 2 bis. Premium (Avatar V) : seulement si le fournisseur CONFIRME ce moteur
    //        pour CE look — vérifié AVANT tout débit (lecture gratuite, mémorisée).
    if (choixMoteur?.ok && choixMoteur.verifierFournisseur) {
      const supportes = avatarRow.avatar_type === 'video' ? await moteursSupportesDuLook(String(avatarRow.provider_avatar_id)) : null;
      const motif = motifPremium(avatarRow.avatar_type, supportes);
      if (motif) {
        // Jamais rabattu en silence sur un autre moteur : la vraie raison, avant tout débit.
        return NextResponse.json({ success: false, error: motif, code: 'qualite_indisponible' }, { status: 400 });
      }
    }

    // 3. Solde — un APERÇU de validation est OFFERT : il sert à vérifier son
    //    clone, pas à produire une vidéo. Aucun contrôle de solde, aucun
    //    débit, donc rien à rembourser s'il échoue. La génération normale
    //    garde strictement son coût.
    //    Le PRIX vient de la grille centrale, selon le MOTEUR de cette
    //    génération, lu UNE fois : 402, débit, `credits_charged`, réponse et
    //    remboursement utilisent ce même `coutFacture`. Sans qualité demandée,
    //    aucun moteur n'est transmis et HeyGen prend Avatar IV
    //    (`lib/avatar/prix.ts`) : c'est lui qui est facturé.
    const coutUtilisateur = intention === INTENTION_APERCU
      ? 0
      : await prixDe(cleTarifMoteurAvatar(choixMoteur?.ok ? choixMoteur.moteur : null));
    const credits = coutUtilisateur > 0 ? await getUserCredits(userId) : 0;
    if (coutUtilisateur > 0 && credits < coutUtilisateur) {
      return NextResponse.json(
        {
          success: false,
          error: `Credits insuffisants. Requis : ${coutUtilisateur}, disponible : ${credits}.`,
          code: 'insufficient_credits',
        },
        { status: 402 },
      );
    }

    // 4. Debit avant appel externe (jamais pour un aperçu)
    // ⚠️ Un administrateur n'est jamais débité (`deductCredits` l'exempte) : il
    // ne doit donc ni être noté « 40 crédits facturés », ni « remboursé » de
    // crédits qu'on ne lui a jamais pris. HeyGen, lui, est appelé pareil.
    const exempte = coutUtilisateur > 0 && await compteExempteDeCredits(userId);
    coutFacture = exempte ? 0 : coutUtilisateur;
    if (coutFacture > 0) {
      await deductCredits(userId, coutFacture, 'avatar');
      creditsDeducted = true;
    }

    // 5. HeyGen
    let videoId: string;
    let status: string;
    try {
      ({ videoId, status } = await generateAvatarVideo({
        avatarId: avatarRow.provider_avatar_id,
        script,
        voiceId: resolvedVoiceId,
        aspectRatio,
        ...(choixMoteur?.ok ? { moteur: choixMoteur.moteur } : {}),
        // Mon avatar : le format choisi est REMPLI (jamais de bandes dans le fichier),
        // l'avatar recadré par HeyGen, sans déformation. Aperçu compris.
        cadrage: 'cover',
      }));
    } catch (erreurFournisseur) {
      // L'aperçu réservé ne doit pas rester « pending » pour toujours : marqué
      // en échec, il libère la place (l'index unique ignore `failed`).
      if (reservation) {
        // `error_message` est relu par l'écran : message Studiio seulement ;
        // l'erreur brute est journalisée plus bas (catch principal).
        await libererReservation(reservation.id, MESSAGES_AVATAR.echecAvantLancement);
      }
      throw erreurFournisseur;
    }

    if (reservation) {
      // La réservation devient la génération : identifiant fournisseur, statut, coût.
      const { data: generation, error: majError } = await supabaseAdmin
        .from('avatar_generations')
        .update({
          provider_video_id: videoId,
          status: status === 'completed' ? 'processing' : 'pending',
          credits_charged: 0,
        })
        .eq('id', reservation.id)
        .eq('user_id', userId)
        .select()
        .single();
      if (majError || !generation) {
        console.error(`[Avatar][apercu] Generation lancee (video ${videoId}) mais reservation ${reservation.id} non mise a jour :`, majError);
        return NextResponse.json(
          { success: false, error: 'Aperçu lancé mais non enregistré. Contactez le support.' },
          { status: 500 },
        );
      }
      return NextResponse.json({
        success: true,
        data: { generationId: generation.id, status: generation.status, creditsCharged: 0, intention: INTENTION_APERCU },
      });
    }

    const { data: generation, error: insertError } = await supabaseAdmin
      .from('avatar_generations')
      .insert({
        user_id: userId,
        user_avatar_id: avatarRow.id,
        // La version du clone qui parle : l'historique sait, plus tard, quelle
        // source a produit cette video (NULL = anterieure au versioning).
        avatar_version: avatarRow.version ?? null,
        intention,
        provider_video_id: videoId,
        script,
        voice_id: resolvedVoiceId,
        aspect_ratio: aspectRatio,
        status: status === 'completed' ? 'processing' : 'pending',
        credits_charged: coutFacture,
      })
      .select()
      .single();

    if (insertError || !generation) {
      // La video est lancee et facturee chez HeyGen : on ne rembourse pas,
      // mais on trace pour pouvoir la retrouver manuellement.
      console.error(
        `[Avatar] Generation lancee (video ${videoId}) mais insert echoue pour ${userId}:`,
        insertError,
      );
      return NextResponse.json(
        { success: false, error: 'Generation lancee mais non enregistree. Contactez le support.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        generationId: generation.id,
        status: generation.status,
        creditsCharged: coutFacture,
      },
    });
  } catch (error) {
    // Remboursement systematique si les credits ont ete debites et que la
    // generation n'a pas demarre.
    if (creditsDeducted) {
      try {
        await addCredits(userId, coutFacture, 'refund');
        console.log(`[Avatar] ${coutFacture} credits rembourses a ${userId}`);
      } catch (refundError) {
        console.error('[Avatar] REMBOURSEMENT ECHOUE pour', userId, refundError);
      }
    }

    if (error instanceof HeyGenError) {
      // Le corps brut a deja ete journalise par heygenFetch ; on trace ici le
      // contexte applicatif pour relier les deux dans les logs Coolify.
      console.error(
        `[Avatar][HeyGen] Generation refusee pour ${userId} — code=${error.code} http=${error.httpStatus} : ${error.message}`,
      );
      return NextResponse.json(
        { success: false, error: creditsDeducted ? MESSAGES_AVATAR.echecRembourse : MESSAGES_AVATAR.echecAvantLancement, code: 'avatar_service', refunded: creditsDeducted },
        { status: error.httpStatus },
      );
    }
    console.error('[Avatar] Generate failed:', error);
    return NextResponse.json(
      { success: false, error: 'La generation a echoue.', refunded: creditsDeducted },
      { status: 500 },
    );
  }
}
