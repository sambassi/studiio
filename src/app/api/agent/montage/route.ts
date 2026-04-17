import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { rushUrls, duration = 20, theme, customPrompt, musicUrl, platforms = ['Instagram'], title, subtitle } = body;

    if (!rushUrls || !Array.isArray(rushUrls) || rushUrls.length === 0) {
      return NextResponse.json({ error: 'At least one rush URL required' }, { status: 400 });
    }

    // Use AI to generate montage hints if custom prompt provided
    let aiHints: { titleText?: string; ctaText?: string; transition?: string } = {};
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (customPrompt && apiKey) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 256,
            messages: [{ role: 'user', content: `Tu es éditeur vidéo. Analyse cette intention créative et retourne en JSON :
{ "titleText": "TITRE EN MAJUSCULES (3-5 mots)", "ctaText": "TEXTE CTA (2-3 mots)", "transition": "crossfade" ou "cut" }

Intention : "${customPrompt}"
Thème : "${theme || 'fitness'}"
Durée : ${duration}s

Réponds UNIQUEMENT en JSON.` }],
          }),
        });
        if (r.ok) {
          const d = await r.json();
          const block = d.content?.find((c: any) => c.type === 'text');
          if (block?.text) {
            try { aiHints = JSON.parse(block.text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch {}
          }
        }
      } catch {}
    }

    // Calculate clip durations: spread evenly across rushes
    const clipDuration = Math.max(3, Math.floor(duration / rushUrls.length));
    const clips = rushUrls.map((src: string, i: number) => ({
      src,
      startSec: 0,
      endSec: clipDuration,
      index: i,
    }));

    // Build montage spec for client-side composition
    const montageSpec = {
      clips,
      transition: aiHints.transition || 'crossfade',
      title: aiHints.titleText || title || theme?.toUpperCase() || 'MONTAGE IA',
      subtitle: subtitle || '',
      cta: aiHints.ctaText || 'DÉCOUVRIR',
      musicUrl: musicUrl || null,
      totalDuration: duration,
      format: '9:16' as const,
      theme: theme || 'motivation',
      platforms,
    };

    // Create a draft post for the montage
    const postDate = new Date();
    postDate.setDate(postDate.getDate() + 1);
    const dateStr = `${postDate.getFullYear()}-${String(postDate.getMonth() + 1).padStart(2, '0')}-${String(postDate.getDate()).padStart(2, '0')}`;

    const { data: post } = await supabaseAdmin.from('scheduled_posts').insert({
      user_id: session.user.id,
      title: montageSpec.title,
      caption: `${montageSpec.subtitle}\n\n#${theme || 'montage'} #IA`,
      media_type: 'video',
      format: 'reel',
      platforms,
      scheduled_date: dateStr,
      scheduled_time: '10:00:00',
      status: 'draft',
      metadata: {
        type: 'ai-montage',
        montageSpec,
        rushUrls,
        musicUrl,
        customPrompt,
        aiHints,
      },
    }).select('id').single();

    // Debit 25 credits
    const { data: user } = await supabaseAdmin.from('users').select('credits').eq('id', session.user.id).single();
    const currentCredits = user?.credits ?? 0;
    if (currentCredits >= 25) {
      await supabaseAdmin.from('users').update({ credits: currentCredits - 25 }).eq('id', session.user.id);
      await supabaseAdmin.from('credit_transactions').insert({
        user_id: session.user.id,
        amount: -25,
        type: 'render',
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      montageSpec,
      postId: post?.id,
    });
  } catch (error: any) {
    console.error('[Agent Montage] Error:', error);
    return NextResponse.json({ error: error.message || 'Montage generation failed' }, { status: 500 });
  }
}
