import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import path from 'path';
import fs from 'fs/promises';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const log = (msg: string) => console.log(`[montage] ${msg} (+${Date.now() - startTime}ms)`);

  try {
    let userId: string;
    if (process.env.DEV_AUTH_BYPASS === '1') {
      userId = 'dev-user';
    } else {
      const session = await auth();
      if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      userId = session.user.id;
    }

    const body = await req.json();
    const {
      rushUrls, count = 1, duration = 20, theme, customPrompt,
      musicUrl, platforms = ['Instagram'], posterUrl, title: reqTitle, subtitle: reqSubtitle,
    } = body;

    if (!rushUrls || !Array.isArray(rushUrls) || rushUrls.length === 0) {
      return NextResponse.json({ error: 'At least one rush URL required' }, { status: 400 });
    }
    if (count * duration > 180) {
      return NextResponse.json({ error: 'Total render time too long (max 180s total)' }, { status: 400 });
    }

    // Check file sizes via HEAD requests
    for (const url of rushUrls) {
      try {
        const head = await fetch(url, { method: 'HEAD' });
        const size = parseInt(head.headers.get('content-length') || '0');
        if (size > 50 * 1024 * 1024) {
          return NextResponse.json({ error: `Rush file too large (>50MB): ${url.substring(0, 60)}` }, { status: 400 });
        }
      } catch {}
    }

    log('validated inputs');

    // AI hints for title/CTA
    let aiHints: { titleText?: string; ctaText?: string; transition?: string } = {};
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const prompt = customPrompt
          ? `Intention: "${customPrompt}". Thème: "${theme || 'fitness'}". Durée: ${duration}s.`
          : `Thème: "${theme || 'fitness'}". Durée: ${duration}s. Vidéo pour réseaux sociaux.`;
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 200,
            messages: [{ role: 'user', content: `Tu es éditeur vidéo. Retourne UNIQUEMENT en JSON:\n{"titleText":"TITRE MAJUSCULES 3-5 mots","ctaText":"CTA 2-3 mots","transition":"crossfade"}\n\n${prompt}` }],
          }),
        });
        if (r.ok) {
          const d = await r.json();
          const block = d.content?.find((c: any) => c.type === 'text');
          if (block?.text) {
            try { aiHints = JSON.parse(block.text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch {}
          }
        }
        log('AI hints: ' + JSON.stringify(aiHints));
      } catch {}
    }

    // Bundle Remotion (once, reused for all iterations)
    const entryPoint = path.join(process.cwd(), 'remotion/index.tsx');
    log('entry point path: ' + entryPoint);

    const existsSync = (await import('fs')).existsSync;
    if (!existsSync(entryPoint)) {
      const remotionDir = path.join(process.cwd(), 'remotion');
      let dirContents = '(dir not found)';
      try { dirContents = (await fs.readdir(remotionDir)).join(', '); } catch {}
      log(`CRITICAL: remotion/index.tsx not found at ${entryPoint}. remotion/ contents: ${dirContents}. cwd: ${process.cwd()}`);
      return NextResponse.json({
        success: false,
        error: `Remotion entry point not found: ${entryPoint}`,
        detail: `remotion/ contents: ${dirContents}`,
      }, { status: 503 });
    }

    log('bundling Remotion...');
    let bundled: string;
    try {
      const { bundle } = await import('@remotion/bundler');
      bundled = await bundle({
        entryPoint,
        outDir: '/tmp/remotion-bundle-' + Date.now(),
      });
      log('bundle done: ' + bundled);
    } catch (bundleErr: any) {
      console.error('[montage] bundle error FULL:', bundleErr, bundleErr?.stack, bundleErr?.message);
      return NextResponse.json({
        success: false,
        error: `Remotion: ${bundleErr?.message || String(bundleErr)}`,
      }, { status: 503 });
    }

    const postIds: string[] = [];
    const videoUrls: string[] = [];
    const fps = 30;

    for (let i = 0; i < count; i++) {
      log(`iteration ${i + 1}/${count}`);

      // Rotate rushes for variety
      const rotated = [...rushUrls.slice(i % rushUrls.length), ...rushUrls.slice(0, i % rushUrls.length)];
      const clipDur = Math.max(3, Math.floor(duration / rotated.length));
      const clips = rotated.map((src: string) => ({ src, startSec: 0, endSec: clipDur }));

      const titleText = count > 1 && aiHints.titleText
        ? `${aiHints.titleText} #${i + 1}`
        : aiHints.titleText || reqTitle || theme?.toUpperCase() || 'MONTAGE IA';

      const inputProps = {
        clips,
        transition: (aiHints.transition || 'crossfade') as 'crossfade' | 'cut',
        title: { text: titleText, color: '#FFFFFF' },
        subtitle: reqSubtitle || theme || '',
        cta: { text: aiHints.ctaText || 'DÉCOUVRIR', subText: 'LIEN EN BIO', color: '#FFFFFF' },
        posterUrl: posterUrl || null,
        musicUrl: musicUrl || null,
        totalDurationFrames: duration * fps,
        format: '9:16' as const,
        watermark: false,
      };

      // Render
      log(`rendering ${i + 1}/${count}...`);
      const outputPath = `/tmp/montage-${Date.now()}-${i}.mp4`;
      try {
        const { renderMedia, selectComposition } = await import('@remotion/renderer');

        let chromiumPath: string | undefined;
        try {
          const chromium = (await import('@sparticuz/chromium')).default;
          chromiumPath = await chromium.executablePath();
        } catch {
          // Local dev: use system Chrome
          chromiumPath = undefined;
        }

        const composition = await selectComposition({
          serveUrl: bundled,
          id: 'AiMontage',
          inputProps,
        });

        await renderMedia({
          composition,
          serveUrl: bundled,
          codec: 'h264',
          outputLocation: outputPath,
          inputProps,
          ...(chromiumPath ? {
            chromiumOptions: {
              executablePath: chromiumPath,
              args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
          } : {}),
          concurrency: 1,
          imageFormat: 'jpeg',
          logLevel: 'warn',
        });

        log(`render ${i + 1} done: ${outputPath}`);
      } catch (renderErr: any) {
        log(`render ${i + 1} FAILED: ${renderErr.message}`);
        continue;
      }

      // Upload to Supabase
      log(`uploading ${i + 1}...`);
      try {
        const fileBuf = await fs.readFile(outputPath);
        const fileName = `${userId}/montage/${Date.now()}-${i}.mp4`;
        const { error } = await supabaseAdmin.storage.from('videos').upload(fileName, fileBuf, {
          contentType: 'video/mp4',
          upsert: false,
        });
        if (error) throw error;

        const { data: urlData } = supabaseAdmin.storage.from('videos').getPublicUrl(fileName);
        const publicUrl = urlData.publicUrl;
        videoUrls.push(publicUrl);

        // Create post
        const postDate = new Date();
        postDate.setDate(postDate.getDate() + 1 + i);
        const dateStr = `${postDate.getFullYear()}-${String(postDate.getMonth() + 1).padStart(2, '0')}-${String(postDate.getDate()).padStart(2, '0')}`;

        const { data: post } = await supabaseAdmin.from('scheduled_posts').insert({
          user_id: userId,
          title: inputProps.title.text,
          caption: `${inputProps.subtitle}\n\n#${theme || 'montage'} #IA`,
          media_url: publicUrl,
          media_type: 'video',
          format: 'reel',
          platforms,
          scheduled_date: dateStr,
          scheduled_time: '10:00:00',
          status: 'draft',
          metadata: {
            type: 'ai-montage',
            renderedVideoUrl: publicUrl,
            videoUrl: publicUrl,
            rushUrls,
            musicUrl,
            theme,
            aiHints,
          },
        }).select('id').single();

        if (post?.id) postIds.push(post.id);
        log(`post ${i + 1} created: ${post?.id}`);
      } catch (uploadErr: any) {
        log(`upload ${i + 1} FAILED: ${uploadErr.message}`);
      }

      // Cleanup temp file
      try { await fs.unlink(outputPath); } catch {}
    }

    // Debit credits
    if (userId !== 'dev-user') {
      const creditCost = 25 * count;
      const { data: user } = await supabaseAdmin.from('users').select('credits').eq('id', userId).single();
      const current = user?.credits ?? 0;
      if (current >= creditCost) {
        await supabaseAdmin.from('users').update({ credits: current - creditCost }).eq('id', userId);
        await supabaseAdmin.from('credit_transactions').insert({
          user_id: userId, amount: -creditCost, type: 'render',
          created_at: new Date().toISOString(),
        });
      }
    }

    // Cleanup bundle
    try { await fs.rm(bundled, { recursive: true }); } catch {}

    log(`done — ${postIds.length} posts, ${videoUrls.length} videos`);
    return NextResponse.json({ success: true, postIds, videoUrls });
  } catch (error: any) {
    console.error('[montage] Fatal error:', error);
    return NextResponse.json({ error: error.message || 'Montage generation failed' }, { status: 500 });
  }
}
