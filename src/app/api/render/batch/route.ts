import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { RENDER_COSTS } from '@/lib/stripe/constants';

// POST /api/render/batch - Start multiple render jobs
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      count = 2,
      format = 'reel',
      title = 'Video batch',
      compositionId,
      baseProps = {},
    } = body;

    if (count < 1 || count > 10) {
      return NextResponse.json(
        { success: false, error: 'Batch count must be between 1 and 10' },
        { status: 400 }
      );
    }

    const composition = compositionId || (format === 'reel' ? 'AfroboostReel' : 'AfroboostTV');
    const isInfographic = composition.startsWith('Infographic');
    const costPerVideo = isInfographic ? 25 : (format === 'tv' ? RENDER_COSTS.tv : RENDER_COSTS.reel);
    const totalCost = costPerVideo * count;

    // Check credits
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('credits')
      .eq('id', session.user.id)
      .single();

    if (userError || !user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (user.credits < totalCost) {
      return NextResponse.json(
        {
          success: false,
          error: `Credits insuffisants. Requis: ${totalCost} (${count} x ${costPerVideo}), disponible: ${user.credits}`,
        },
        { status: 402 }
      );
    }

    // Deduct all credits upfront
    await supabase
      .from('users')
      .update({ credits: user.credits - totalCost })
      .eq('id', session.user.id);

    await supabase.from('credit_transactions').insert({
      user_id: session.user.id,
      amount: -totalCost,
      type: 'render',
      description: `Batch ${count}x ${composition} - ${title}`,
    });

    // Create videos and render jobs
    const results = [];
    for (let i = 0; i < count; i++) {
      const renderSeed = Date.now() + i * 1000 + Math.floor(Math.random() * 1000);
      const videoTitle = `${title} #${i + 1}`;

      const { data: video } = await supabase
        .from('videos')
        .insert({
          user_id: session.user.id,
          title: videoTitle,
          format: format === 'tv' ? 'tv' : 'reel',
          status: 'rendering',
          credits_used: costPerVideo,
          metadata: {
            compositionId: composition,
            batchIndex: i,
            batchTotal: count,
            renderSeed,
            ...baseProps,
          },
        })
        .select()
        .single();

      if (video) {
        const { data: job } = await supabase
          .from('render_jobs')
          .insert({
            user_id: session.user.id,
            video_id: video.id,
            status: 'queued',
            composition_id: composition,
            input_props: { ...baseProps, renderSeed },
            credits_charged: costPerVideo,
          })
          .select()
          .single();

        if (job) {
          await supabase
            .from('videos')
            .update({ render_job_id: job.id })
            .eq('id', video.id);
        }

        results.push({
          videoId: video.id,
          jobId: job?.id,
          title: videoTitle,
          renderSeed,
        });
      }
    }

    return NextResponse.json({
      success: true,
      batch: {
        count,
        totalCost,
        creditsRemaining: user.credits - totalCost,
        videos: results,
      },
    });
  } catch (error) {
    console.error('Batch render error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
