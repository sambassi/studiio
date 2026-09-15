import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits, deductCredits, addCredits } from '@/lib/credits/system';
import { AVATAR_VIDEO_COST, AVATAR_MAX_SCRIPT_CHARS } from '@/lib/stripe/constants';
import {
  generateAvatarVideo,
  getAvatarTrainingStatus,
  resolveVoiceId,
  HeyGenError,
  type AvatarAspectRatio,
} from '@/lib/avatar/heygen';
import { INTENTION_APERCU, SCRIPT_APERCU, lireIntention, etatAvatar } from '@/lib/avatar/contrat';

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

    const avatarRow = avatarRows?.[0];
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
        await supabaseAdmin.from('user_avatars').update(patch).eq('id', avatarRow.id);
        avatarRow.status = remoteStatus;
      }

      if (remoteStatus === 'failed') {
        const detail = training?.error ? ` (${training.error})` : '';
        return NextResponse.json(
          {
            success: false,
            error: `L'entrainement de votre avatar a echoue chez HeyGen${detail}. Renvoyez ${isVideoAvatar ? 'une video' : 'une photo'}.`,
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
              "HeyGen attend une validation de consentement sur cet avatar. Verifiez votre compte HeyGen pour la finaliser.",
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

    // 3. Solde — un APERÇU de validation est OFFERT : il sert à vérifier son
    //    clone, pas à produire une vidéo. Aucun contrôle de solde, aucun
    //    débit, donc rien à rembourser s'il échoue. La génération normale
    //    garde strictement son coût.
    const coutUtilisateur = intention === INTENTION_APERCU ? 0 : AVATAR_VIDEO_COST;
    const credits = coutUtilisateur > 0 ? await getUserCredits(userId) : 0;
    if (coutUtilisateur > 0 && credits < coutUtilisateur) {
      return NextResponse.json(
        {
          success: false,
          error: `Credits insuffisants. Requis : ${AVATAR_VIDEO_COST}, disponible : ${credits}.`,
          code: 'insufficient_credits',
        },
        { status: 402 },
      );
    }

    // 4. Debit avant appel externe (jamais pour un aperçu)
    if (coutUtilisateur > 0) {
      await deductCredits(userId, coutUtilisateur, 'avatar');
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
      }));
    } catch (erreurFournisseur) {
      // L'aperçu réservé ne doit pas rester « pending » pour toujours : marqué
      // en échec, il libère la place (l'index unique ignore `failed`).
      if (reservation) {
        await libererReservation(
          reservation.id,
          erreurFournisseur instanceof HeyGenError ? erreurFournisseur.message : "Le fournisseur n'a pas repondu.",
        );
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
        credits_charged: AVATAR_VIDEO_COST,
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
        creditsCharged: AVATAR_VIDEO_COST,
      },
    });
  } catch (error) {
    // Remboursement systematique si les credits ont ete debites et que la
    // generation n'a pas demarre.
    if (creditsDeducted) {
      try {
        await addCredits(userId, AVATAR_VIDEO_COST, 'refund');
        console.log(`[Avatar] ${AVATAR_VIDEO_COST} credits rembourses a ${userId}`);
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
        { success: false, error: error.message, code: error.code, refunded: creditsDeducted },
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
