import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { RENDER_COSTS } from '@/lib/stripe/constants';
// Dynamic imports to avoid webpack bundling issues with @remotion/bundler
// These are only imported at runtime, not build time
const loadRenderWorker = () => import('@/lib/render/worker');
const loadStorage = () => import('@/lib/storage/upload');

// Async render trigger - runs after response is sent
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown render error';
    console.error(`Render failed for job ${jobId}:`, message);
    try {
      const { failJob } = await loadRenderWorker();
      await failJob(jobId, videoId, userId, creditsCharged, message);
    } catch (e) {
      console.error('Failed to mark job as failed:', e);
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
      // Mark video as failed
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

    // Trigger async rendering
    // On Vercel, this runs in the background after the response is sent.
    // The client polls /api/render/status?jobId=xxx for progress.
    if (renderJob) {
      // Fire-and-forget: start the render process
      triggerRender({
        jobId: renderJob.id,
        videoId: video.id,
        userId: session.user.id,
        compositionId: composition,
        inputProps,
        creditsCharged: actualCost,
      }).catch((error) => {
        console.error('Background render failed:', error);
      });
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
