import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink, access } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Resolve FFmpeg binary path — tries multiple locations for Vercel compatibility
async function resolveFFmpegPath(): Promise<string> {
  // 1. Try ffmpeg-static package
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath) {
      await access(staticPath);
      console.log(`[CONVERT] FFmpeg found via ffmpeg-static: ${staticPath}`);
      return staticPath;
    }
  } catch {}

  // 2. Try common node_modules locations on Vercel
  const candidates = [
    join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    '/var/task/node_modules/ffmpeg-static/ffmpeg',
    '/var/task/node_modules/.cache/ffmpeg-static/ffmpeg',
  ];
  for (const p of candidates) {
    try {
      await access(p);
      console.log(`[CONVERT] FFmpeg found at: ${p}`);
      return p;
    } catch {}
  }

  // 3. Fallback to system ffmpeg
  console.log(`[CONVERT] Using system ffmpeg as fallback`);
  return 'ffmpeg';
}

// Allow up to 300s for this function (Vercel Pro plan)
// Needed because WebM→MP4 conversion + Instagram polling can take 2-4 minutes
export const maxDuration = 300;

// Verify the request comes from Vercel Cron
function verifyCronSecret(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

// GET /api/cron/publish - Automatically publish scheduled posts whose time has passed
// Supports ?force=true — picks the first scheduled/draft post and publishes it immediately,
// skipping the time check. CRON_SECRET bearer check is still required.
export async function GET(req: NextRequest) {
  // Security: only allow Vercel Cron (or authenticated manual triggers) to run
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === 'true';

  try {
    const now = new Date();

    // force=true — pick the first scheduled/draft post and publish immediately
    let forcedPosts: any[] | null = null;
    if (force) {
      console.log('[CRON] force=true — picking first scheduled/draft post, skipping time check');
      const { data: forcePosts, error: forceErr } = await supabase
        .from('scheduled_posts')
        .select('*, videos:video_id(*)')
        .in('status', ['scheduled', 'draft'])
        .order('scheduled_date', { ascending: true })
        .order('scheduled_time', { ascending: true })
        .limit(1);
      if (forceErr) {
        console.error('[CRON] force query error:', forceErr);
        return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
      }
      if (!forcePosts || forcePosts.length === 0) {
        return NextResponse.json({ success: true, published: 0, message: 'No scheduled/draft post found' });
      }
      forcedPosts = forcePosts;
    }

    // We need to check posts across all timezones
    // Strategy: get all scheduled posts, then check each one against its own timezone
    // Default timezone is Europe/Paris if not specified in post metadata
    // For the main query, we use a generous window: check posts where date <= today UTC+14 (earliest timezone)
    // Then filter precisely per-post timezone in code

    // Use the latest possible timezone (UTC+14) to ensure we don't miss any posts
    const latestTzFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Kiritimati', // UTC+14, the latest timezone
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const latestDate = latestTzFormatter.format(now);
    const latestTimeFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Pacific/Kiritimati',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const latestTime = latestTimeFormatter.format(now);

    console.log(`[CRON] Checking scheduled posts. Server UTC: ${now.toISOString()}, Latest TZ date: ${latestDate} ${latestTime}`);

    // ── Recover posts stuck at 'publishing' ──
    // PR #64's atomic claim flips status to 'publishing' before the
    // platform publish call. If the function times out or crashes
    // mid-publish (Vercel 5min timeout, Anthropic 5xx, etc.), the row
    // is stranded at 'publishing' forever and the candidate query
    // (status='scheduled') never picks it up again — visible symptom:
    // "scheduled posts stop publishing entirely". Reset any post that
    // has been stuck at 'publishing' for more than 10 min so the next
    // candidate fetch can re-claim it.
    const stuckThreshold = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const { data: stuckPosts, error: stuckErr } = await supabase
      .from('scheduled_posts')
      .update({ status: 'scheduled' })
      .eq('status', 'publishing')
      .lt('updated_at', stuckThreshold)
      .select('id, title, updated_at');
    if (stuckErr) {
      console.error('[CRON] stuck-reset query failed:', stuckErr.message);
    } else if (stuckPosts && stuckPosts.length > 0) {
      console.warn(`[CRON] Recovered ${stuckPosts.length} stuck publishing post(s):`, stuckPosts.map((p: any) => `${p.id} ("${p.title}") last updated ${p.updated_at}`));
    }

    // Find all posts that are scheduled and whose date/time has potentially passed
    // We use the latest timezone (UTC+14) for the query to cast a wide net,
    // then filter precisely per-post timezone in code
    const { data: candidatePosts, error: fetchError } = forcedPosts
      ? { data: null, error: null }
      : await supabase
          .from('scheduled_posts')
          .select('*, videos:video_id(*)')
          .eq('status', 'scheduled')
          .or(`scheduled_date.lt.${latestDate},and(scheduled_date.eq.${latestDate},scheduled_time.lte.${latestTime})`)
          .order('scheduled_date', { ascending: true })
          .order('scheduled_time', { ascending: true })
          .limit(20);

    // Diagnostic — explicit count of candidates returned by the DB query.
    // Lets us tell apart "DB returned nothing" vs "all filtered out by
    // per-post timezone check below".
    console.log(`[CRON] Candidate posts from DB: ${candidatePosts?.length ?? 0}`,
      candidatePosts ? candidatePosts.map((p: any) => ({ id: p.id, status: p.status, scheduled_date: p.scheduled_date, scheduled_time: p.scheduled_time, platforms: p.platforms })) : 'none');

    // Filter posts by their actual timezone (skipped when force=true)
    const duePosts = forcedPosts ?? (candidatePosts || []).filter((post) => {
      // Get user's timezone from post metadata, default to Europe/Paris
      const userTz = post.metadata?.timezone || 'Europe/Paris';
      try {
        const userDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: userTz, year: 'numeric', month: '2-digit', day: '2-digit' });
        const userTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false });
        const userDate = userDateFmt.format(now);
        const userTime = userTimeFmt.format(now);

        // Check if post is due in user's timezone
        // Normalize time to HH:MM for comparison (PostgreSQL time type returns HH:MM:SS)
        const postTime = (post.scheduled_time || '').substring(0, 5);
        const isDue = post.scheduled_date < userDate ||
          (post.scheduled_date === userDate && postTime <= userTime);
        return isDue;
      } catch {
        // If timezone is invalid, fall back to Europe/Paris
        const parisFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
        const parisTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false });
        const parisDate = parisFmt.format(now);
        const parisTime = parisTimeFmt.format(now);
        const postTimeFallback = (post.scheduled_time || '').substring(0, 5);
        return post.scheduled_date < parisDate ||
          (post.scheduled_date === parisDate && postTimeFallback <= parisTime);
      }
    });

    if (fetchError) {
      console.error('[CRON] Error fetching due posts:', fetchError);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    if (!duePosts || duePosts.length === 0) {
      // No publishable posts — surface a status snapshot so we can spot
      // stranded 'publishing' rows the next time logs are checked.
      const { data: snapshot } = await supabase
        .from('scheduled_posts')
        .select('id, status')
        .in('status', ['scheduled', 'publishing', 'draft'])
        .limit(50);
      const counts: Record<string, number> = {};
      (snapshot || []).forEach((p: any) => { counts[p.status] = (counts[p.status] || 0) + 1; });
      console.log('[CRON] No posts due for publishing. Recent-pipeline snapshot:', counts);
      return NextResponse.json({ success: true, published: 0, message: 'No posts due', pipeline: counts });
    }

    console.log(`[CRON] Found ${duePosts.length} posts to publish`);

    const results: Array<{
      postId: string;
      title: string;
      platforms: string[];
      success: boolean;
      details: any;
    }> = [];

    for (const post of duePosts) {
      console.log(`[CRON] Processing post: id=${post.id}, title="${post.title}", platforms=${JSON.stringify(post.platforms)}, video_id=${post.video_id}, media_url=${post.media_url ? 'SET' : 'NULL'}`);

      // Atomic claim: flip status scheduled/draft → publishing only if no
      // other cron invocation got there first. The `.in('status', …)`
      // guard turns this into a single conditional UPDATE — Supabase /
      // Postgres serialise it, so if two instances race only one row gets
      // updated. The other reads `data.length === 0` and skips.
      const { data: claimed, error: claimErr } = await supabase
        .from('scheduled_posts')
        .update({ status: 'publishing' })
        .eq('id', post.id)
        .in('status', ['scheduled', 'draft'])
        .select('id');

      if (claimErr) {
        console.error(`[CRON] Claim error for post ${post.id}:`, claimErr.message);
        continue;
      }
      if (!claimed || claimed.length === 0) {
        console.log(`[CRON] Post ${post.id} already claimed by another invocation (status moved to publishing/published/failed) — skip`);
        continue;
      }

      try {
        // Get the user's social accounts
        const { data: accounts, error: accountsError } = await supabase
          .from('social_accounts')
          .select('*')
          .eq('user_id', post.user_id)
          .eq('connected', true);

        console.log(`[CRON] Social accounts found: ${accounts?.length || 0}, platforms: ${accounts?.map((a: any) => a.platform).join(', ') || 'none'}${accountsError ? ', ERROR: ' + accountsError.message : ''}`);

        // Check if platforms are specified
        if (!post.platforms || post.platforms.length === 0) {
          console.log(`[CRON] FAIL: No platforms selected for post ${post.id}`);
          await supabase
            .from('scheduled_posts')
            .update({ status: 'failed', metadata: { ...post.metadata, error: 'Aucun réseau social sélectionné / No platforms selected' } })
            .eq('id', post.id);
          results.push({ postId: post.id, title: post.title, platforms: post.platforms, success: false, details: 'No platforms' });
          continue;
        }

        if (!accounts || accounts.length === 0) {
          await supabase
            .from('scheduled_posts')
            .update({ status: 'failed', metadata: { ...post.metadata, error: 'Aucun compte social connecté / No connected social accounts' } })
            .eq('id', post.id);
          results.push({ postId: post.id, title: post.title, platforms: post.platforms, success: false, details: 'No social accounts' });
          continue;
        }

        // Check if post has a video with a URL
        // STRICT Priority: renderedVideoUrl (montage composé) > media_url > raw video
        // IMPORTANT: meta.videoUrl is EXCLUDED from priority because it often contains the raw rush URL,
        // NOT the composed montage. Only renderedVideoUrl is the real montage.
        const video = post.videos;
        const meta = post.metadata || {};
        const renderedUrl = meta.renderedVideoUrl; // Only the composed montage, NOT meta.videoUrl
        console.log(`[CRON] Video data: video_id=${post.video_id}, video exists=${!!video}, video_url=${video?.video_url ? 'SET' : 'NULL'}, post.media_url=${post.media_url ? 'SET' : 'NULL'}, renderedVideoUrl=${renderedUrl ? 'SET' : 'NULL'}, meta.videoUrl=${meta.videoUrl ? 'SET (ignored — may be raw rush)' : 'NULL'}`);

        // Utiliser le montage composé en priorité (la vraie vidéo infographique avec titre, cartes, etc.)
        // Fallback: media_url (which is also set to renderedUrl during scheduling), puis la vidéo brute
        let videoUrl = renderedUrl || post.media_url || video?.video_url;

        if (!videoUrl) {
          console.log(`[CRON] FAIL: No video or media URL for post ${post.id}`);
          await supabase
            .from('scheduled_posts')
            .update({ status: 'failed', metadata: { ...meta, error: 'Aucune vidéo ou média / No video or media URL. Le montage doit être exporté avant la publication.' } })
            .eq('id', post.id);
          results.push({ postId: post.id, title: post.title, platforms: post.platforms, success: false, details: 'No media' });
          continue;
        }

        const videoData = video || { title: post.title, video_url: videoUrl };
        // Remplacer l'URL vidéo avec la meilleure disponible (montage > brut)
        videoData.video_url = videoUrl;
        const videoSource = renderedUrl ? 'renderedVideoUrl (montage composé ✅)' : post.media_url ? 'media_url' : 'video.video_url (rush brut ⚠️)';
        console.log(`[CRON] Using video URL: ${videoUrl?.substring(0, 80)}... (source: ${videoSource})`);
        // Warn if using raw rush instead of composed montage
        if (!renderedUrl && !post.media_url && video?.video_url) {
          console.warn(`[CRON] ⚠️ Post ${post.id} is using RAW rush video, not the composed montage! The published video will NOT have title/cards/transitions.`);
        }

        // ═══ MUXAGE AUDIO : Si le post a des pistes audio séparées (musicUrl/voiceUrl) ═══
        // Cela arrive quand le Studio Son a sauvé les métadonnées audio mais la composition
        // client-side a échoué ou le fichier vidéo n'a pas d'audio embarqué.
        const hasAudioMeta = meta.hasAudio && (meta.musicUrl || meta.voiceUrl);
        if (hasAudioMeta && videoData.video_url) {
          console.log(`[CRON] Post a des pistes audio séparées — tentative de muxage`);
          console.log(`[CRON]   musicUrl: ${meta.musicUrl ? 'OUI' : 'NON'}, voiceUrl: ${meta.voiceUrl ? 'OUI' : 'NON'}`);
          try {
            const muxedUrl = await muxAudioIntoVideo(videoData.video_url, meta.musicUrl, meta.voiceUrl);
            if (muxedUrl) {
              videoData.video_url = muxedUrl;
              videoUrl = muxedUrl;
              console.log(`[CRON] ✅ Muxage audio réussi: ${muxedUrl.substring(0, 80)}...`);
            }
          } catch (muxErr) {
            console.error(`[CRON] ⚠️ Muxage audio échoué, publication sans audio:`, muxErr);
            // Continuer sans audio — mieux que de ne pas publier du tout
          }
        }

        const platformResults: Array<{ platform: string; success: boolean; error?: string }> = [];

        for (const platform of (post.platforms || [])) {
          const account = accounts.find((a: any) => a.platform === platform.toLowerCase());
          if (!account) {
            platformResults.push({ platform, success: false, error: `${platform} not connected` });
            continue;
          }

          try {
            let result: { success: boolean; platformPostId?: string; platformUrl?: string; error?: string };

            switch (platform.toLowerCase()) {
              case 'instagram':
                result = await publishToInstagram(account, videoData, post.caption);
                break;
              case 'facebook':
                result = await publishToFacebook(account, videoData, post.caption);
                break;
              case 'tiktok':
                result = await publishToTikTok(account, videoData, post.caption);
                break;
              case 'youtube':
                result = await publishToYouTube(account, videoData, post.caption);
                break;
              default:
                result = { success: false, error: `Unsupported platform: ${platform}` };
            }

            // Record in publishing_history
            await supabase
              .from('publishing_history')
              .insert({
                video_id: post.video_id || null,
                social_account_id: account.id,
                scheduled_post_id: post.id,
                platform: platform.toLowerCase(),
                status: result.success ? 'published' : 'failed',
                platform_post_id: result.platformPostId,
                platform_url: result.platformUrl,
                error_message: result.error,
                published_at: result.success ? new Date().toISOString() : null,
              });

            platformResults.push({
              platform,
              success: result.success,
              error: result.error,
            });
          } catch (err) {
            platformResults.push({
              platform,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }

        const anySuccess = platformResults.some((r) => r.success);
        const allFailed = platformResults.every((r) => !r.success);

        // Update post status
        await supabase
          .from('scheduled_posts')
          .update({
            status: allFailed ? 'failed' : 'published',
            published_at: anySuccess ? new Date().toISOString() : null,
            metadata: {
              ...post.metadata,
              cron_publish_results: platformResults,
              cron_published_at: new Date().toISOString(),
            },
          })
          .eq('id', post.id);

        // Update video status if applicable
        if (anySuccess && post.video_id) {
          await supabase
            .from('videos')
            .update({ status: 'published' })
            .eq('id', post.video_id);
        }

        results.push({
          postId: post.id,
          title: post.title,
          platforms: post.platforms,
          success: anySuccess,
          details: platformResults,
        });
      } catch (err) {
        console.error(`[CRON] Error processing post ${post.id}:`, err);
        await supabase
          .from('scheduled_posts')
          .update({
            status: 'failed',
            metadata: { ...post.metadata, error: err instanceof Error ? err.message : 'Unknown error' },
          })
          .eq('id', post.id);
        results.push({
          postId: post.id,
          title: post.title,
          platforms: post.platforms,
          success: false,
          details: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const summary = {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };

    console.log(`[CRON] Publishing complete:`, summary);

    return NextResponse.json({
      success: true,
      ...summary,
      results,
    });
  } catch (error) {
    console.error('[CRON] Fatal error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


// ══════════════════════════════════════════════════════════════
// WEBM → MP4 CONVERSION (Instagram/TikTok require H.264 MP4)
// ══════════════════════════════════════════════════════════════

async function convertToMp4IfNeeded(videoUrl: string): Promise<string> {
  // Only convert if the URL contains .webm or webm in the path
  const urlLower = videoUrl.toLowerCase();
  if (!urlLower.includes('.webm') && !urlLower.includes('/webm')) {
    console.log(`[CONVERT] Video is not WebM, skipping conversion`);
    return videoUrl;
  }

  console.log(`[CONVERT] WebM detected, converting to MP4 (H.264)...`);

  // Resolve FFmpeg binary path (handles Vercel's serverless environment)
  const ffmpegPath = await resolveFFmpegPath();
  console.log(`[CONVERT] Using FFmpeg at: ${ffmpegPath}`);

  const tmpDir = '/tmp';
  const timestamp = Date.now();
  const inputPath = join(tmpDir, `cron_input_${timestamp}.webm`);
  const outputPath = join(tmpDir, `cron_output_${timestamp}.mp4`);

  try {
    // Step 1: Download the WebM file
    console.log(`[CONVERT] Downloading WebM...`);
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(inputPath, buffer);
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
    console.log(`[CONVERT] Downloaded ${sizeMB}MB to ${inputPath}`);

    // Step 2: Convert with FFmpeg (H.264 + AAC, fast preset, Instagram-compatible)
    console.log(`[CONVERT] Running FFmpeg conversion...`);
    const startTime = Date.now();
    await execFileAsync(ffmpegPath, [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',     // Required for Instagram compatibility
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',  // Move moov atom to start for streaming
      '-y',                       // Overwrite output
      outputPath,
    ], { timeout: 270000 }); // 4 min 30, sous Vercel maxDuration 300s
    const conversionTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[CONVERT] Conversion done in ${conversionTime}s`);

    // Step 3: Read the converted MP4
    const mp4Buffer = await readFile(outputPath);
    const mp4SizeMB = (mp4Buffer.length / 1024 / 1024).toFixed(1);
    console.log(`[CONVERT] MP4 size: ${mp4SizeMB}MB`);

    // Step 4: Upload to Supabase Storage
    const fileName = `converted_${timestamp}.mp4`;
    const storagePath = `converted/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(storagePath, mp4Buffer, {
        contentType: 'video/mp4',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Supabase upload failed: ${uploadError.message}`);
    }

    // Step 5: Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('media')
      .getPublicUrl(storagePath);

    console.log(`[CONVERT] MP4 uploaded: ${publicUrl.substring(0, 80)}...`);
    return publicUrl;
  } catch (error) {
    console.error(`[CONVERT] Conversion failed:`, error);
    // Return original URL as fallback (will likely fail on Instagram but worth trying)
    throw new Error(`WebM→MP4 conversion failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Cleanup temp files
    try { await unlink(inputPath); } catch {}
    try { await unlink(outputPath); } catch {}
  }
}

// ══════════════════════════════════════════════════════════════
// MUXAGE AUDIO : Combiner vidéo + musique + voix en un seul MP4
// Utilisé quand le Studio Son a sauvé l'audio séparément
// ══════════════════════════════════════════════════════════════

async function muxAudioIntoVideo(
  videoUrl: string,
  musicUrl?: string | null,
  voiceUrl?: string | null,
): Promise<string | null> {
  if (!musicUrl && !voiceUrl) return null;

  console.log(`[MUX] Démarrage du muxage audio dans la vidéo...`);
  const ffmpegPath = await resolveFFmpegPath();
  const tmpDir = '/tmp';
  const ts = Date.now();
  const videoPath = join(tmpDir, `mux_video_${ts}.webm`);
  const musicPath = join(tmpDir, `mux_music_${ts}.mp3`);
  const voicePath = join(tmpDir, `mux_voice_${ts}.mp3`);
  const outputPath = join(tmpDir, `mux_output_${ts}.mp4`);

  try {
    // Étape 1 : Télécharger la vidéo
    console.log(`[MUX] Téléchargement vidéo...`);
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Téléchargement vidéo échoué: HTTP ${videoRes.status}`);
    await writeFile(videoPath, Buffer.from(await videoRes.arrayBuffer()));

    // Étape 2 : Télécharger les fichiers audio
    const inputArgs: string[] = ['-i', videoPath];
    let audioInputCount = 1; // L'entrée 0 est la vidéo

    if (musicUrl) {
      console.log(`[MUX] Téléchargement musique...`);
      const musicRes = await fetch(musicUrl);
      if (musicRes.ok) {
        await writeFile(musicPath, Buffer.from(await musicRes.arrayBuffer()));
        inputArgs.push('-i', musicPath);
        audioInputCount++;
      } else {
        console.warn(`[MUX] Téléchargement musique échoué: HTTP ${musicRes.status}`);
      }
    }

    if (voiceUrl) {
      console.log(`[MUX] Téléchargement voix...`);
      const voiceRes = await fetch(voiceUrl);
      if (voiceRes.ok) {
        await writeFile(voicePath, Buffer.from(await voiceRes.arrayBuffer()));
        inputArgs.push('-i', voicePath);
        audioInputCount++;
      } else {
        console.warn(`[MUX] Téléchargement voix échoué: HTTP ${voiceRes.status}`);
      }
    }

    if (audioInputCount <= 1) {
      console.log(`[MUX] Aucun fichier audio téléchargé, annulation`);
      return null;
    }

    // Étape 3 : Construire la commande FFmpeg
    // Mixer musique (volume 0.5) + voix (volume 1.0) ensemble, puis muxer avec la vidéo
    const ffmpegArgs: string[] = [...inputArgs];

    if (audioInputCount === 2) {
      // Un seul fichier audio — le mixer directement
      ffmpegArgs.push(
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-map', '0:v:0', '-map', '1:a:0',
        '-shortest',
        '-movflags', '+faststart',
        '-y', outputPath,
      );
    } else {
      // Deux fichiers audio — mixer avec filtergraph (musique + voix)
      // La musique est en boucle (-stream_loop -1) et à volume réduit
      // On doit reconfigurer les inputs pour la boucle de musique
      ffmpegArgs.length = 0; // Reset
      ffmpegArgs.push('-i', videoPath);
      if (musicUrl) ffmpegArgs.push('-stream_loop', '-1', '-i', musicPath);
      if (voiceUrl) ffmpegArgs.push('-i', voicePath);
      ffmpegArgs.push(
        '-filter_complex', '[1:a]volume=0.5[music];[2:a]volume=1.0[voice];[music][voice]amix=inputs=2:duration=shortest[aout]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-map', '0:v:0', '-map', '[aout]',
        '-shortest',
        '-movflags', '+faststart',
        '-y', outputPath,
      );
    }

    console.log(`[MUX] Exécution FFmpeg...`);
    const startTime = Date.now();
    await execFileAsync(ffmpegPath, ffmpegArgs, { timeout: 270000 }); // 4 min 30, sous Vercel maxDuration 300s
    console.log(`[MUX] Conversion terminée en ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

    // Étape 4 : Upload du MP4 final
    const mp4Buffer = await readFile(outputPath);
    const fileName = `muxed_${ts}.mp4`;
    const storagePath = `converted/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(storagePath, mp4Buffer, { contentType: 'video/mp4', upsert: true });

    if (uploadError) throw new Error(`Upload Supabase échoué: ${uploadError.message}`);

    const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(storagePath);
    console.log(`[MUX] ✅ MP4 avec audio uploadé: ${publicUrl.substring(0, 80)}...`);
    return publicUrl;
  } catch (err) {
    console.error(`[MUX] Erreur:`, err);
    return null;
  } finally {
    // Nettoyage des fichiers temporaires
    try { await unlink(videoPath); } catch {}
    try { await unlink(musicPath); } catch {}
    try { await unlink(voicePath); } catch {}
    try { await unlink(outputPath); } catch {}
  }
}

// ══════════════════════════════════════════════════════════════
// FONCTIONS DE PUBLICATION PAR PLATEFORME (identique à /api/social/publish)
// ══════════════════════════════════════════════════════════════

// Resolve a publicly-fetchable URL for the Graph API / platform fetchers.
// If the URL is a private Supabase path, create a 1h signed URL.
async function ensurePublicUrl(url: string): Promise<string> {
  if (!url) return url;
  if (url.includes('/storage/v1/object/public/')) return url;
  if (!url.includes('/storage/v1/object/')) return url;
  try {
    const m = url.match(/\/storage\/v1\/object\/(?:sign|authenticated|private)\/([^/]+)\/([^?]+)/);
    if (!m) return url;
    const [, bucket, path] = m;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return url;
    return data.signedUrl;
  } catch {
    return url;
  }
}

async function publishToInstagram(
  account: any,
  video: any,
  caption?: string,
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;
  const igAccountId = account.account_id;

  console.log(`[CRON][IG] Starting Instagram publish. igAccountId=${igAccountId}, hasToken=${!!accessToken}, tokenPreview=${accessToken ? accessToken.substring(0, 15) + '...' : 'NULL'}`);
  console.log(`[CRON][IG] Video URL: ${video.video_url?.substring(0, 100) || 'NULL'}`);

  if (!accessToken || !igAccountId) {
    console.log(`[CRON][IG] FAIL: Missing credentials. token=${!!accessToken}, accountId=${!!igAccountId}`);
    return { success: false, error: 'Instagram credentials missing' };
  }

  const fullCaption = caption || video.title || '';

  try {
    // Step 0: Convert WebM to MP4 if needed (Instagram only accepts MP4/MOV H.264)
    let publishableVideoUrl = video.video_url;
    if (video.video_url && video.video_url.toLowerCase().includes('webm')) {
      console.log(`[CRON][IG] Video is WebM format — converting to MP4 for Instagram...`);
      publishableVideoUrl = await convertToMp4IfNeeded(video.video_url);
      console.log(`[CRON][IG] Using converted MP4: ${publishableVideoUrl.substring(0, 80)}...`);
    }
    publishableVideoUrl = await ensurePublicUrl(publishableVideoUrl);

    // Step 1: Create media container (Reels)
    console.log(`[CRON][IG] Step 1: Creating media container for Reel...`);
    const createBody = {
      media_type: 'REELS',
      video_url: publishableVideoUrl,
      caption: fullCaption,
      share_to_feed: true,
      access_token: accessToken,
    };
    const createRes = await fetch(
      `https://graph.facebook.com/v24.0/${igAccountId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      }
    );

    const createData = await createRes.json();
    console.log(`[CRON][IG] Step 1 response: status=${createRes.status}, data=${JSON.stringify(createData)}`);

    if (!createData.id) {
      const errMsg = createData.error?.message || JSON.stringify(createData);
      console.log(`[CRON][IG] FAIL at Step 1: ${errMsg}`);
      console.error('[SOCIAL_PUBLISH_ERROR]', {
        platform: 'instagram',
        step: 'container_create',
        code: createData.error?.code,
        message: createData.error?.message,
        fbtrace_id: createData.error?.fbtrace_id,
        response: createData,
      });
      return { success: false, error: `IG container creation failed: ${errMsg}` };
    }

    const containerId = createData.id;
    console.log(`[CRON][IG] Container created: ${containerId}`);

    // Step 2: Poll until processing is complete (max 30 attempts for cron, 5s each = 150s)
    let status = 'IN_PROGRESS';
    let attempts = 0;
    while (status === 'IN_PROGRESS' && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const statusRes = await fetch(
        `https://graph.facebook.com/v24.0/${containerId}?fields=status_code&access_token=${accessToken}`
      );
      const statusData = await statusRes.json();
      status = statusData.status_code;
      attempts++;
      console.log(`[CRON][IG] Step 2 poll #${attempts}: status=${status}`);
    }

    if (status !== 'FINISHED') {
      console.log(`[CRON][IG] FAIL at Step 2: Processing not finished after ${attempts} polls. Status: ${status}`);
      return { success: false, error: `Instagram processing failed after ${attempts} polls. Status: ${status}` };
    }

    // Step 3: Publish
    console.log(`[CRON][IG] Step 3: Publishing container ${containerId}...`);
    const publishRes = await fetch(
      `https://graph.facebook.com/v24.0/${igAccountId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      }
    );

    const publishData = await publishRes.json();
    console.log(`[CRON][IG] Step 3 response: status=${publishRes.status}, data=${JSON.stringify(publishData)}`);

    if (publishData.id) {
      console.log(`[CRON][IG] SUCCESS! Post ID: ${publishData.id}`);
      return {
        success: true,
        platformPostId: publishData.id,
        platformUrl: `https://www.instagram.com/p/${publishData.id}/`,
      };
    }

    const errMsg = publishData.error?.message || JSON.stringify(publishData);
    console.log(`[CRON][IG] FAIL at Step 3: ${errMsg}`);
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'instagram',
      step: 'media_publish',
      code: publishData.error?.code,
      message: publishData.error?.message,
      fbtrace_id: publishData.error?.fbtrace_id,
      response: publishData,
    });
    return { success: false, error: `IG publish failed: ${errMsg}` };
  } catch (error) {
    console.log(`[CRON][IG] EXCEPTION: ${error instanceof Error ? error.message : String(error)}`);
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'instagram',
      step: 'exception',
      message: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: error instanceof Error ? error.message : 'Instagram API error' };
  }
}

async function publishToFacebook(
  account: any,
  video: any,
  caption?: string,
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;
  const pageId = account.account_id;

  if (!accessToken || !pageId) {
    console.log(`[CRON][FB] FAIL: Missing credentials. accessToken=${!!accessToken}, pageId=${pageId}`);
    return { success: false, error: 'Facebook credentials missing' };
  }

  console.log(`[CRON][FB] Starting publish to page ${pageId}, video_url=${video.video_url?.substring(0, 80)}...`);

  try {
    const publicUrl = await ensurePublicUrl(video.video_url);
    const res = await fetch(
      `https://graph.facebook.com/v24.0/${pageId}/videos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: publicUrl,
          description: caption || video.title || '',
          access_token: accessToken,
        }),
      }
    );

    const data = await res.json();
    console.log(`[CRON][FB] API response: status=${res.status}, data=${JSON.stringify(data).substring(0, 500)}`);

    if (data.id) {
      console.log(`[CRON][FB] SUCCESS! Video ID: ${data.id}`);
      return {
        success: true,
        platformPostId: data.id,
        platformUrl: `https://www.facebook.com/${pageId}/videos/${data.id}`,
      };
    }

    const errMsg = data.error?.message || JSON.stringify(data);
    console.log(`[CRON][FB] FAIL: ${errMsg}`);
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'facebook',
      step: 'video_post',
      code: data.error?.code,
      message: data.error?.message,
      fbtrace_id: data.error?.fbtrace_id,
      response: data,
    });
    return { success: false, error: errMsg };
  } catch (error) {
    console.log(`[CRON][FB] EXCEPTION: ${error instanceof Error ? error.message : String(error)}`);
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'facebook',
      step: 'exception',
      message: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: error instanceof Error ? error.message : 'Facebook API error' };
  }
}

async function publishToTikTok(
  account: any,
  video: any,
  caption?: string,
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;

  if (!accessToken) {
    return { success: false, error: 'TikTok credentials missing' };
  }

  try {
    const initRes = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: (caption || video.title || '').slice(0, 150),
            privacy_level: 'SELF_ONLY',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: video.video_url,
          },
        }),
      }
    );

    const initData = await initRes.json();
    if (initData.data?.publish_id) {
      return { success: true, platformPostId: initData.data.publish_id };
    }
    return { success: false, error: initData.error?.message || 'TikTok upload failed' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'TikTok API error' };
  }
}

async function publishToYouTube(
  account: any,
  video: any,
  caption?: string,
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;

  if (!accessToken) {
    return { success: false, error: 'YouTube credentials missing' };
  }

  try {
    const metadata = {
      snippet: {
        title: (caption || video.title || '').slice(0, 100),
        description: `${caption || video.title || ''}\n\nPowered by Afroboost - afroboost.com`,
        categoryId: '22',
      },
      status: {
        privacyStatus: 'private',
        selfDeclaredMadeForKids: false,
      },
    };

    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!initRes.ok) {
      const errData = await initRes.json().catch(() => ({}));
      console.error('[SOCIAL_PUBLISH_ERROR]', {
        platform: 'youtube',
        step: 'upload_init',
        status: initRes.status,
        message: errData.error?.message,
        response: errData,
      });
      return { success: false, error: errData.error?.message || `YouTube API error: ${initRes.status}` };
    }

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      console.error('[SOCIAL_PUBLISH_ERROR]', { platform: 'youtube', step: 'upload_init', message: 'No Location header' });
      return { success: false, error: 'YouTube did not return upload URL' };
    }

    const publicVideoUrl = await ensurePublicUrl(video.video_url);
    const videoRes = await fetch(publicVideoUrl);
    if (!videoRes.ok) {
      console.error('[SOCIAL_PUBLISH_ERROR]', { platform: 'youtube', step: 'download', status: videoRes.status });
      return { success: false, error: 'Failed to download video for YouTube upload' };
    }

    const videoBuffer = await videoRes.arrayBuffer();
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(videoBuffer.byteLength),
      },
      body: videoBuffer,
    });

    const uploadData = await uploadRes.json();
    if (uploadData.id) {
      return {
        success: true,
        platformPostId: uploadData.id,
        platformUrl: `https://www.youtube.com/shorts/${uploadData.id}`,
      };
    }
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'youtube',
      step: 'upload',
      message: uploadData.error?.message,
      response: uploadData,
    });
    return { success: false, error: uploadData.error?.message || 'YouTube upload failed' };
  } catch (error) {
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'youtube',
      step: 'exception',
      message: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: error instanceof Error ? error.message : 'YouTube API error' };
  }
}
