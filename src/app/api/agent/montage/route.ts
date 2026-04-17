import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    let userId: string;
    if (process.env.DEV_AUTH_BYPASS === '1') {
      userId = 'dev-user';
    } else {
      const session = await auth();
      if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      userId = session.user.id;
    }

    const body = await req.json();
    const { rushUrls, count = 1, duration = 20, theme, customPrompt, musicUrl, posterUrl, platforms = ['Instagram'], subtitle } = body;

    if (!rushUrls || !Array.isArray(rushUrls) || rushUrls.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one rush URL required' }, { status: 400 });
    }

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
      } catch {}
    }

    // Build montage specs (one per count)
    const specs = [];
    for (let i = 0; i < count; i++) {
      const rotated = [...rushUrls.slice(i % rushUrls.length), ...rushUrls.slice(0, i % rushUrls.length)];
      const clipDur = Math.max(3, Math.floor(duration / rotated.length));
      const clips = rotated.map((src: string) => ({ src, startSec: 0, endSec: clipDur }));

      const titleText = count > 1 && aiHints.titleText
        ? `${aiHints.titleText} #${i + 1}`
        : aiHints.titleText || theme?.toUpperCase() || 'MONTAGE IA';

      specs.push({
        clips,
        transition: (aiHints.transition || 'crossfade') as 'crossfade' | 'cut',
        title: { text: titleText, color: '#FFFFFF' },
        subtitle: subtitle || theme || '',
        cta: { text: aiHints.ctaText || 'DÉCOUVRIR', subText: 'LIEN EN BIO', color: '#FFFFFF' },
        posterUrl: posterUrl || null,
        musicUrl: musicUrl || null,
        totalDuration: duration,
        format: '9:16' as const,
        theme: theme || 'motivation',
        platforms,
      });
    }

    return NextResponse.json({ success: true, specs, userId });
  } catch (error: any) {
    console.error('[montage] Error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Failed' }, { status: 500 });
  }
}
