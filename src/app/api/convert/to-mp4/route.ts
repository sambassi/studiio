import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink, access } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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

      // Convert with FFmpeg — capture stderr/stdout so a failure surfaces
      // the actual reason (codec issue, corrupted moov atom, missing audio
      // stream, etc.) rather than the opaque "Conversion failed" string.
      const startTime = Date.now();
      let stderrCaptured = '';
      try {
        const result = await execFileAsync(ffmpegPath, [
          '-i', inputPath,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-y',
          outputPath,
        ], { timeout: 270000, maxBuffer: 10 * 1024 * 1024 }); // 4 min 30, sous Vercel maxDuration 300s
        stderrCaptured = result.stderr || '';
        console.log(`[CONVERT-API] Conversion done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      } catch (ffmpegErr: unknown) {
        const errObj = ffmpegErr as { stderr?: string; stdout?: string; message?: string; code?: number };
        stderrCaptured = errObj.stderr || '';
        console.error(`[CONVERT-API] FFmpeg failed (exit code ${errObj.code ?? 'unknown'}):`, errObj.message);
        console.error(`[CONVERT-API] FFmpeg stderr (last 2KB):`, stderrCaptured.slice(-2000));
        // Re-throw with the most useful detail available so the outer catch
        // forwards it to the client.
        const detail = stderrCaptured.slice(-500) || errObj.message || 'unknown FFmpeg failure';
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

      console.log(`[CONVERT-API] MP4 uploaded: ${publicUrl.substring(0, 80)}...`);
      return NextResponse.json({ success: true, mp4Url: publicUrl });
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
