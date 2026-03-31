import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { RENDER_COSTS } from '@/lib/stripe/constants';

// Dynamic imports to avoid webpack bundling issues with @remotion/bundler
const loadRenderWorker = () => import('@/lib/render/worker');
const loadStorage = () => import('@/lib/storage/upload');

// ═══ CRITICAL: maxDuration allows Vercel to keep function alive for rendering ═══
// Free plan: 60s, Pro plan: 300s (5 min), Enterprise: 900s (15 min)
// Remotion renders for 30s video typically take 2-5 minutes
export const maxDuration = 300;

// Async render trigger — runs as background task via waitUntil
async function triggerRender(params: {
  jobId: string;
  videoId: string;
  userId: string;
  compositionId: string;
  inputProps: Record<string, any>;
  creditsCharged: number;
}) {
  const { jobId, videoId, userId, compositionId, inputProps, creditsCharged } = params;

  try {
    const { renderVideo, completeJob } = await loadRenderWorker();
    const { uploadToStorage } = await loadStorage();

    const { outputPath } = await renderVideo({
      jobId,
      compositionId,
      inputProps,
    });

    // Upload rendered video to Supabase Storage
    const outputUrl = await uploadToStorage({
      filePath: outputPath,
      bucket: 'videos',
      storagePath: `${userId}/${videoId}.mp4`,
    });

    await completeJob(jobId, videoId, outputUrl);
    console.log(`[Render] Job ${jobId} completed successfully: ${outputUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown render error';
    console.error(`[Render] Job ${jobId} failed:`, message);
    try {
      const { failJob } = await loadRenderWorker();
      await failJob(jobId, videoId, userId, creditsCharged, message);
    } catch (e) {
      console.error('[Render] Failed to mark job as failed:', e);
    }
  }
}

// POST /api/render - Start a video render job
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      compositionId,
      format = 'reel',
      inputProps = {},
      title = 'Video sans titre',
      batchIndex,
      batchTotal,
    } = body;

    // Validate composition
    const validCompositions = ['AfroboostReel', 'AfroboostTV', 'InfographicReel', 'InfographicTV'];
    const composition = compositionId || (format === 'reel' ? 'AfroboostReel' : 'AfroboostTV');

    if (!validCompositions.includes(composition)) {
      return NextResponse.json(
        { success: false, error: `Invalid composition: ${composition}` },
        { status: 400 }
      );
    }

    // Check credits
    const creditCost = format === 'tv' ? RENDER_COSTS.tv : RENDER_COSTS.reel;
    const isInfographic = composition.startsWith('Infographic');
    const actualCost = isInfographic ? 25 : creditCost;

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('credits')
      .eq('id', session.user.id)
      .single();

    if (userError || !user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (user.credits < actualCost) {
      return NextResponse.json(
        { success: false, error: `Credits insuffisants. Requis: ${actualCost}, disponible: ${user.credits}` },
        { status: 402 }
      );
    }

    // Deduct credits BEFORE rendering
    const { error: creditError } = await supabase
      .from('users')
      .update({ credits: user.credits - actualCost })
      .eq('id', session.user.id);

    if (creditError) {
      console.error('Failed to deduct credits:', creditError);
      return NextResponse.json({ success: false, error: 'Failed to deduct credits' }, { status: 500 });
    }

    // Log credit transaction
    await supabase.from('credit_transactions').insert({
      user_id: session.user.id,
      amount: -actualCost,
      type: 'render',
      description: `Rendu ${composition} - ${title}`,
    });

    // Create video record
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .insert({
        user_id: session.user.id,
        title,
        format: format === 'tv' ? 'tv' : 'reel',
        status: 'rendering',
        credits_used: actualCost,
        metadata: {
          compositionId: composition,
          batchIndex,
          batchTotal,
          ...inputProps,
        },
      })
      .select()
      .single();

    if (videoError) {
      // Refund credits on failure
      await supabase
        .from('users')
        .update({ credits: user.credits })
        .eq('id', session.user.id);
      await supabase.from('credit_transactions').insert({
        user_id: session.user.id,
        amount: actualCost,
        type: 'refund',
        description: `Remboursement - echec creation video`,
      });
      console.error('Failed to create video:', videoError);
      return NextResponse.json({ success: false, error: 'Failed to create video' }, { status: 500 });
    }

    // Create render job
    const { data: renderJob, error: renderError } = await supabase
      .from('render_jobs')
      .insert({
        user_id: session.user.id,
        video_id: video.id,
        status: 'queued',
        composition_id: composition,
        input_props: inputProps,
        credits_charged: actualCost,
      })
      .select()
      .single();

    if (renderError) {
      console.error('Failed to create render job:', renderError);
      await supabase
        .from('videos')
        .update({ status: 'failed' })
        .eq('id', video.id);
    }

    // Update video with render job ID
    if (renderJob) {
      await supabase
        .from('videos')
        .update({ render_job_id: renderJob.id })
        .eq('id', video.id);
    }

    // ═══ CRITICAL FIX: Use waitUntil to keep function alive during rendering ═══
    // On Vercel, fire-and-forget promises are killed after response is sent.
    // waitUntil tells Vercel to keep the function running until the render completes.
    if (renderJob) {
      let waitUntilFn: ((promise: Promise<unknown>) => void) | null = null;
      try {
        // Dynamic import — only available on Vercel production, not local dev
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = await (Function('return import("@vercel/functions")')() as Promise<{ waitUntil: (p: Promise<unknown>) => void }>);
        waitUntilFn = mod.waitUntil;
      } catch {
        // @vercel/functions not available (local dev) — fall back
        console.log('[Render] @vercel/functions not available, using fire-and-forget fallback');
      }

      const renderPromise = triggerRender({
        jobId: renderJob.id,
        videoId: video.id,
        userId: session.user.id,
        compositionId: composition,
        inputProps,
        creditsCharged: actualCost,
      });

      if (waitUntilFn) {
        // Vercel production: extend function lifetime
        waitUntilFn(renderPromise);
      } else {
        // Local dev fallback: fire-and-forget (function won't die locally)
        renderPromise.catch((error) => {
          console.error('Background render failed:', error);
        });
      }
    }

    return NextResponse.json({
      success: true,
      video: {
        id: video.id,
        title: video.title,
        format: video.format,
        status: video.status,
      },
      renderJob: renderJob ? {
        id: renderJob.id,
        status: renderJob.status,
      } : null,
      creditsCharged: actualCost,
      creditsRemaining: user.credits - actualCost,
    });
  } catch (error) {
    console.error('Render API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
