import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits, deductCredits, addCredits } from '@/lib/credits/system';
import { AVATAR_VIDEO_COST, AVATAR_MAX_SCRIPT_CHARS } from '@/lib/stripe/constants';
import {
  generateAvatarVideo,
  getAvatarStatus,
  resolveVoiceId,
  HeyGenError,
  type AvatarAspectRatio,
} from '@/lib/avatar/heygen';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const VALID_RATIOS: AvatarAspectRatio[] = ['9:16', '16:9', '1:1'];

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
    const script: string = (body?.script ?? '').toString().trim();
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

    // Avatar de l'utilisateur — on verifie explicitement la propriete.
    const query = supabaseAdmin.from('user_avatars').select('*').eq('user_id', userId);
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

    // 1. L'avatar est-il pret ? HeyGen entraine l'avatar photo en asynchrone
    //    et refuse une generation sur un avatar encore en cours.
    //    Ce controle est fait AVANT tout debit : un avatar pas pret ne doit
    //    jamais consommer de credits, meme rembourses ensuite.
    if (avatarRow.status !== 'completed') {
      const remoteStatus = await getAvatarStatus(avatarRow.provider_avatar_id);
      console.log(
        `[Avatar] Avatar ${avatarRow.provider_avatar_id} — statut local "${avatarRow.status}", statut HeyGen "${remoteStatus ?? 'inconnu'}"`,
      );

      if (remoteStatus && remoteStatus !== avatarRow.status) {
        await supabaseAdmin
          .from('user_avatars')
          .update({ status: remoteStatus })
          .eq('id', avatarRow.id);
        avatarRow.status = remoteStatus;
      }

      if (remoteStatus === 'failed') {
        return NextResponse.json(
          {
            success: false,
            error: "L'entrainement de votre avatar a echoue chez HeyGen. Renvoyez une photo.",
            code: 'avatar_failed',
          },
          { status: 409 },
        );
      }
      if (remoteStatus && remoteStatus !== 'completed') {
        return NextResponse.json(
          {
            success: false,
            error: "Votre avatar est encore en cours de preparation. Reessayez dans une minute.",
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

    // 3. Solde
    const credits = await getUserCredits(userId);
    if (credits < AVATAR_VIDEO_COST) {
      return NextResponse.json(
        {
          success: false,
          error: `Credits insuffisants. Requis : ${AVATAR_VIDEO_COST}, disponible : ${credits}.`,
          code: 'insufficient_credits',
        },
        { status: 402 },
      );
    }

    // 4. Debit avant appel externe
    await deductCredits(userId, AVATAR_VIDEO_COST, 'avatar');
    creditsDeducted = true;

    // 5. HeyGen
    const { videoId, status } = await generateAvatarVideo({
      avatarId: avatarRow.provider_avatar_id,
      script,
      voiceId: resolvedVoiceId,
      aspectRatio,
    });

    const { data: generation, error: insertError } = await supabaseAdmin
      .from('avatar_generations')
      .insert({
        user_id: userId,
        user_avatar_id: avatarRow.id,
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
