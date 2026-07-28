import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { addCredits } from '@/lib/credits/system';
import { getVideoStatus, downloadVideo, HeyGenError } from '@/lib/avatar/heygen';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Au-dela de cette duree, on considere la generation perdue et on rembourse.
 * HeyGen rend generalement une video courte en 1 a 5 minutes.
 */
const STALE_AFTER_MS = 30 * 60 * 1000; // 30 min

/**
 * GET /api/avatar/status?generationId=uuid
 *
 * Un seul poll par appel (le client rappelle en boucle). Quand HeyGen a fini,
 * la video est telechargee et re-hebergee sur notre stockage : l'URL HeyGen
 * expire, la notre non.
 *
 * Sans `generationId`, renvoie les 10 dernieres generations de l'utilisateur.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const generationId = req.nextUrl.searchParams.get('generationId');

    if (!generationId) {
      const { data: history } = await supabaseAdmin
        .from('avatar_generations')
        .select('id, status, video_url, script, created_at, error_message')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
      return NextResponse.json({ success: true, data: { generations: history ?? [] } });
    }

    const { data: gen } = await supabaseAdmin
      .from('avatar_generations')
      .select('*')
      .eq('id', generationId)
      .eq('user_id', userId) // propriete verifiee cote requete
      .single();

    if (!gen) {
      return NextResponse.json(
        { success: false, error: 'Generation introuvable.' },
        { status: 404 },
      );
    }

    // Etats terminaux : rien a re-interroger.
    if (gen.status === 'completed' || gen.status === 'failed') {
      return NextResponse.json({
        success: true,
        data: {
          generationId: gen.id,
          status: gen.status,
          videoUrl: gen.video_url,
          error: gen.error_message,
        },
      });
    }

    if (!gen.provider_video_id) {
      return NextResponse.json({
        success: true,
        data: { generationId: gen.id, status: gen.status, videoUrl: null },
      });
    }

    // Garde-fou : generation bloquee trop longtemps → echec + remboursement.
    const ageMs = Date.now() - new Date(gen.created_at).getTime();
    if (ageMs > STALE_AFTER_MS) {
      await failAndRefund(gen, "La generation a depasse le delai maximum (30 minutes).");
      return NextResponse.json({
        success: true,
        data: {
          generationId: gen.id,
          status: 'failed',
          error: 'La generation a depasse le delai maximum (30 minutes). Credits rembourses.',
        },
      });
    }

    const remote = await getVideoStatus(gen.provider_video_id);

    if (remote.status === 'failed') {
      await failAndRefund(gen, remote.failureMessage || 'HeyGen a signale un echec.');
      return NextResponse.json({
        success: true,
        data: {
          generationId: gen.id,
          status: 'failed',
          error: `${remote.failureMessage || 'Echec HeyGen'}. Credits rembourses.`,
        },
      });
    }

    if (remote.status !== 'completed' || !remote.videoUrl) {
      // Toujours en cours — on met a jour l'etat intermediaire.
      if (gen.status !== 'processing') {
        await supabaseAdmin
          .from('avatar_generations')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', gen.id);
      }
      return NextResponse.json({
        success: true,
        data: { generationId: gen.id, status: 'processing', videoUrl: null },
      });
    }

    // Termine : rapatriement sur notre stockage.
    let finalUrl = remote.videoUrl;
    try {
      const buffer = await downloadVideo(remote.videoUrl);
      const storagePath = `${userId}/avatar/${gen.id}.mp4`;
      const { error: upErr } = await supabaseAdmin.storage
        .from('media')
        .upload(storagePath, buffer, { contentType: 'video/mp4', upsert: true });

      if (upErr) {
        // On garde l'URL HeyGen (temporaire) plutot que de perdre la video.
        console.warn('[Avatar] Upload MinIO echoue, URL HeyGen conservee:', upErr.message);
      } else {
        const { data: pub } = supabaseAdmin.storage.from('media').getPublicUrl(storagePath);
        if (pub?.publicUrl) finalUrl = pub.publicUrl;
      }
    } catch (e) {
      console.warn('[Avatar] Rapatriement video echoue, URL HeyGen conservee:', e);
    }

    await supabaseAdmin
      .from('avatar_generations')
      .update({
        status: 'completed',
        video_url: finalUrl,
        duration_seconds: remote.durationSeconds ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gen.id);

    return NextResponse.json({
      success: true,
      data: { generationId: gen.id, status: 'completed', videoUrl: finalUrl },
    });
  } catch (error) {
    if (error instanceof HeyGenError) {
      // Erreur transitoire cote HeyGen : on ne marque pas la generation en
      // echec, le prochain poll retentera.
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    console.error('[Avatar] Status failed:', error);
    return NextResponse.json(
      { success: false, error: 'Impossible de verifier le statut.' },
      { status: 500 },
    );
  }
}

/**
 * Marque une generation en echec et rembourse les credits une seule fois
 * (le drapeau credits_refunded empeche tout double remboursement si plusieurs
 * polls arrivent en parallele).
 */
async function failAndRefund(
  gen: { id: string; user_id: string; credits_charged: number; credits_refunded: boolean },
  reason: string,
): Promise<void> {
  const shouldRefund = !gen.credits_refunded && gen.credits_charged > 0;

  if (shouldRefund) {
    // On pose le drapeau AVANT de crediter : en cas de polls concurrents, la
    // condition `.eq('credits_refunded', false)` ne laisse passer qu'un seul
    // update, donc un seul remboursement.
    const { data: claimed } = await supabaseAdmin
      .from('avatar_generations')
      .update({
        status: 'failed',
        error_message: reason,
        credits_refunded: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gen.id)
      .eq('credits_refunded', false)
      .select();

    if (claimed && claimed.length > 0) {
      try {
        await addCredits(gen.user_id, gen.credits_charged, 'refund');
        console.log(`[Avatar] ${gen.credits_charged} credits rembourses a ${gen.user_id}`);
      } catch (e) {
        console.error('[Avatar] REMBOURSEMENT ECHOUE pour', gen.user_id, e);
      }
    }
    return;
  }

  await supabaseAdmin
    .from('avatar_generations')
    .update({ status: 'failed', error_message: reason, updated_at: new Date().toISOString() })
    .eq('id', gen.id);
}
