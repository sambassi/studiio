/**
 * Remotion Rendering Worker
 * Bundles the Remotion project and renders video compositions.
 * Designed for serverless (Vercel Functions) with fallback to local rendering.
 */

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { supabaseAdmin } from '@/lib/db/supabase';

// Bundle cache (in-memory for the function lifecycle)
let cachedBundleUrl: string | null = null;
let bundleTimestamp = 0;
const BUNDLE_TTL_MS = 120_000; // 2 minutes

type RenderProgress = {
  progress: number;
  stage: string;
};

export async function getOrCreateBundle(): Promise<string> {
  const now = Date.now();
  if (cachedBundleUrl && now - bundleTimestamp < BUNDLE_TTL_MS) {
    return cachedBundleUrl;
  }

  const entryPoint = path.resolve(process.cwd(), 'remotion/index.tsx');

  // Check entry point exists
  if (!fs.existsSync(entryPoint)) {
    throw new Error(`Remotion entry point not found: ${entryPoint}`);
  }

  const bundleLocation = await bundle({
    entryPoint,
    onProgress: (progress) => {
      // Bundle progress (0-100)
    },
  });

  cachedBundleUrl = bundleLocation;
  bundleTimestamp = now;
  return bundleLocation;
}

export async function renderVideo(options: {
  jobId: string;
  compositionId: string;
  inputProps: Record<string, any>;
  onProgress?: (progress: RenderProgress) => void;
}): Promise<{ outputPath: string }> {
  const { jobId, compositionId, inputProps, onProgress } = options;

  // Update job status
  await updateJobStatus(jobId, 'rendering', 0, 'Bundling Remotion project...');
  onProgress?.({ progress: 5, stage: 'Bundling...' });

  // Get or create bundle
  const serveUrl = await getOrCreateBundle();

  await updateJobStatus(jobId, 'rendering', 15, 'Selecting composition...');
  onProgress?.({ progress: 15, stage: 'Preparation...' });

  // Select composition
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
    timeoutInMilliseconds: 60000,
  });

  // Create temp output file
  const tmpDir = os.tmpdir();
  const outputPath = path.join(tmpDir, `studiio-render-${jobId}.mp4`);

  await updateJobStatus(jobId, 'rendering', 20, 'Rendu video en cours...');
  onProgress?.({ progress: 20, stage: 'Rendering...' });

  // Render
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    timeoutInMilliseconds: 60000,
    videoBitrate: '8M',
    encodingMaxRate: '12M',
    encodingBufferSize: '16M',
    pixelFormat: 'yuv420p',
    chromiumOptions: {
      disableWebSecurity: true,
      gl: 'angle',
    },
    onProgress: (renderProgress) => {
      const pct = Math.round(20 + renderProgress.progress * 75);
      const stage = `Rendu: ${Math.round(renderProgress.progress * 100)}%`;
      updateJobStatus(jobId, 'rendering', pct / 100, stage).catch(() => {});
      onProgress?.({ progress: pct, stage });
    },
  });

  await updateJobStatus(jobId, 'rendering', 98, 'Finalisation...');
  onProgress?.({ progress: 98, stage: 'Finalizing...' });

  return { outputPath };
}

async function updateJobStatus(
  jobId: string,
  status: string,
  progress: number,
  stage: string,
) {
  try {
    await supabaseAdmin
      .from('render_jobs')
      .update({
        status,
        progress,
        stage,
        ...(status === 'rendering' && progress === 0 ? { started_at: new Date().toISOString() } : {}),
      })
      .eq('id', jobId);
  } catch (error) {
    console.error('Failed to update job status:', error);
  }
}

export async function completeJob(
  jobId: string,
  videoId: string,
  outputUrl: string,
  thumbnailUrl?: string,
) {
  await supabaseAdmin
    .from('render_jobs')
    .update({
      status: 'completed',
      progress: 1,
      stage: 'Termine!',
      output_url: outputUrl,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  await supabaseAdmin
    .from('videos')
    .update({
      status: 'completed',
      video_url: outputUrl,
      thumbnail_url: thumbnailUrl || null,
    })
    .eq('id', videoId);
}

export async function failJob(
  jobId: string,
  videoId: string,
  userId: string,
  creditsCharged: number,
  errorMessage: string,
) {
  await supabaseAdmin
    .from('render_jobs')
    .update({
      status: 'failed',
      stage: 'Erreur',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  await supabaseAdmin
    .from('videos')
    .update({ status: 'failed' })
    .eq('id', videoId);

  // Refund credits
  if (creditsCharged > 0) {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();

    if (user) {
      await supabaseAdmin
        .from('users')
        .update({ credits: user.credits + creditsCharged })
        .eq('id', userId);

      await supabaseAdmin.from('credit_transactions').insert({
        user_id: userId,
        amount: creditsCharged,
        type: 'refund',
        description: `Remboursement rendu echoue - job ${jobId}`,
      });
    }
  }
}
