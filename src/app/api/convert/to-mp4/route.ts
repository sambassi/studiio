import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { writeFile, readFile, unlink, access } from 'fs/promises';
import { join } from 'path';
import { transcodeWebmToMp4WithLadder } from '@/lib/ffmpeg/transcode-to-mp4';

// Allow up to 300s for video conversion (Vercel Pro plan)
export const maxDuration = 300;

// Resolve FFmpeg binary path — tries multiple locations for Vercel compatibility
async function resolveFFmpegPath(): Promise<string> {
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath) {
      await access(staticPath);
      return staticPath;
    }
  } catch {}

  const candidates = [
    join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    '/var/task/node_modules/ffmpeg-static/ffmpeg',
  ];
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {}
  }

  return 'ffmpeg'; // system fallback
}

// POST /api/convert/to-mp4
// Body: { videoUrl: string } — URL of a WebM video (typically from Supabase Storage)
// Returns: { success: true, mp4Url: string } or { success: false, error: string }
export async function POST(req: NextRequest) {
  try {
    const { videoUrl } = await req.json();

    if (!videoUrl || typeof videoUrl !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing videoUrl' }, { status: 400 });
    }

    // Skip if already MP4
    if (!videoUrl.toLowerCase().includes('webm')) {
      return NextResponse.json({ success: true, mp4Url: videoUrl, skipped: true });
    }

    console.log(`[CONVERT-API] Converting WebM to MP4: ${videoUrl.substring(0, 80)}...`);

    const ffmpegPath = await resolveFFmpegPath();
    console.log(`[CONVERT-API] FFmpeg at: ${ffmpegPath}`);

    const tmpDir = '/tmp';
    const timestamp = Date.now();
    const inputPath = join(tmpDir, `convert_input_${timestamp}.webm`);
    const outputPath = join(tmpDir, `convert_output_${timestamp}.mp4`);

    try {
      // Download WebM
      const response = await fetch(videoUrl);
      if (!response.ok) {
        return NextResponse.json({ success: false, error: `Download failed: HTTP ${response.status}` }, { status: 500 });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(inputPath, buffer);
      console.log(`[CONVERT-API] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB (${buffer.length} bytes)`);

      // Guard: refuse to feed FFmpeg a suspiciously small file. FFmpeg will
      // emit cryptic "Invalid data" errors instead of erroring out cleanly,
      // and waste 1-3 min before failing — surface this to the client right
      // away with the actual byte count for debugging.
      if (buffer.length < 1024) {
        console.warn(`[CONVERT-API] Source file too small (${buffer.length} bytes) — skipping FFmpeg`);
        return NextResponse.json({
          success: false,
          error: `Source file too small (${buffer.length} bytes) — likely corrupted or empty. Re-render the post in /creer or click Régénérer in /calendar.`,
          sourceSize: buffer.length,
        }, { status: 422 });
      }

      // Convert with FFmpeg via the shared helper — uses a quality ladder
      // (1080p → 720p → 540p) with per-attempt timeouts so longer videos
      // stay under Vercel's 300s function maxDuration. Each attempt uses
      // ultrafast + zerolatency + threads 0 + crf 28 for ~2× the throughput
      // of the previous "preset ultrafast crf 23" baseline.
      let stderrCaptured = '';
      let attemptUsed = '';
      try {
        const result = await transcodeWebmToMp4WithLadder(ffmpegPath, inputPath, outputPath, '[CONVERT-API]');
        stderrCaptured = result.stderr;
        attemptUsed = result.attempt;
      } catch (ffmpegErr: unknown) {
        const errObj = ffmpegErr as { message?: string };
        const detail = errObj.message || 'unknown FFmpeg failure';
        throw new Error(`FFmpeg conversion failed: ${detail}`);
      }

      // Read and validate output
      const mp4Buffer = await readFile(outputPath);
      console.log(`[CONVERT-API] MP4 size: ${(mp4Buffer.length / 1024 / 1024).toFixed(1)}MB (${mp4Buffer.length} bytes)`);

      // Output validation — FFmpeg may exit 0 yet produce a near-empty file
      // when the input has issues that didn't trigger an outright error
      // (corrupted timestamps, etc.).
      if (mp4Buffer.length < 1024) {
        console.error(`[CONVERT-API] Output MP4 too small (${mp4Buffer.length} bytes) — conversion produced empty file`);
        return NextResponse.json({
          success: false,
          error: `Output MP4 too small (${mp4Buffer.length} bytes) — conversion produced an unusable file`,
          outputSize: mp4Buffer.length,
          stderr: stderrCaptured.slice(-500),
        }, { status: 500 });
      }

      const fileName = `converted_${timestamp}.mp4`;
      const storagePath = `converted/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(storagePath, mp4Buffer, {
          contentType: 'video/mp4',
          upsert: true,
        });

      if (uploadError) {
        return NextResponse.json({ success: false, error: `Upload failed: ${uploadError.message}` }, { status: 500 });
      }

      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(storagePath);

      console.log(`[CONVERT-API] MP4 uploaded: ${publicUrl.substring(0, 80)}... (attempt: ${attemptUsed})`);
      return NextResponse.json({ success: true, mp4Url: publicUrl, attempt: attemptUsed });
    } finally {
      try { await unlink(inputPath); } catch {}
      try { await unlink(outputPath); } catch {}
    }
  } catch (error) {
    console.error(`[CONVERT-API] Error:`, error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Conversion failed',
    }, { status: 500 });
  }
}
