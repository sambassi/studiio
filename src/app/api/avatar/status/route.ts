import { NextRequest, NextResponse } from 'next/server';
import { MESSAGES_AVATAR } from '@/lib/avatar/fournisseurs';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { HeyGenError } from '@/lib/avatar/heygen';
import { DidError } from '@/lib/providers/did/client';
import { avancerStatutGeneration } from '@/lib/avatar/statut';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET /api/avatar/status?generationId=uuid
 *
 * Un seul poll par appel (le client rappelle en boucle). Quand le fournisseur
 * a fini, la video est telechargee et re-hebergee sur notre stockage : l'URL
 * fournisseur expire, la notre non.
 *
 * ⚠️ LA LOGIQUE VIT DANS `@/lib/avatar/statut` (`avancerStatutGeneration`),
 * PARTAGÉE avec le finaliseur de l'Autopilote — un cron sans navigateur qui
 * doit faire avancer la MÊME génération jusqu'à la vidéo re-hébergée. Une
 * seule chaîne : Créer (ce navigateur) et l'Autopilote (le serveur) ne peuvent
 * pas diverger sur le poll, le rapatriement ou le remboursement.
 *
 * Sans `generationId`, renvoie les 10 dernieres generations de l'utilisateur.
 *
 * `avatarVersion` : la version du clone EPINGLEE a la generation
 * (`avatar_generations.avatar_version`, `null` si inconnue). Creer la compare
 * a l'avatar actif pour signaler une video d'une ancienne version — lecture
 * seule, rien n'est remplace.
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

    const r = await avancerStatutGeneration(userId, generationId);

    if (r.status === 'introuvable') {
      return NextResponse.json(
        { success: false, error: 'Generation introuvable.' },
        { status: 404 },
      );
    }
    // Présente seulement si la base la connaît : la forme des réponses ne change pas sinon.
    const avatarVersion = typeof r.avatarVersion === 'number' ? { avatarVersion: r.avatarVersion } : {};
    if (r.status === 'failed') {
      return NextResponse.json({
        success: true,
        data: { generationId, status: 'failed', videoUrl: null, error: r.error, ...avatarVersion },
      });
    }
    if (r.status === 'completed') {
      // `error: null` conservé — une génération terminée n'en a pas, et
      // l'ancienne branche « état terminal » le renvoyait déjà (forme stable
      // pour les lecteurs qui comparent l'objet entier).
      return NextResponse.json({
        success: true,
        data: { generationId, status: 'completed', videoUrl: r.videoUrl, error: null, ...avatarVersion },
      });
    }
    return NextResponse.json({
      success: true,
      data: { generationId, status: 'processing', videoUrl: null, ...avatarVersion },
    });
  } catch (error) {
    if (error instanceof DidError) {
      // Transitoire cote D-ID : meme regle que HeyGen, le prochain poll retentera.
      console.warn('[Avatar][status] transitoire :', error.message);
      return NextResponse.json({ success: false, error: MESSAGES_AVATAR.verificationTransitoire, code: 'transitoire' }, { status: error.httpStatus });
    }
    if (error instanceof HeyGenError) {
      // Erreur transitoire cote HeyGen : on ne marque pas la generation en
      // echec, le prochain poll retentera.
      console.warn('[Avatar][status] transitoire :', error.message);
      return NextResponse.json(
        { success: false, error: MESSAGES_AVATAR.verificationTransitoire, code: 'transitoire' },
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
