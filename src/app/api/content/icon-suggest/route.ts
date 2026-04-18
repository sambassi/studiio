import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';

// POST /api/content/icon-suggest
// Body:
//   { title, description, mode: 'emoji' }                       → returns { emoji: string }
//   { title, description, mode: 'svg', allowed: string[] }      → returns { iconName: string }
// Defaults to emoji mode for backwards compatibility.
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'Anthropic API not configured' }, { status: 500 });
    }

    const { title = '', description = '', mode = 'emoji', allowed = [] } = await req.json();
    if (!title.trim() && !description.trim()) {
      return NextResponse.json({ success: false, error: 'title or description required' }, { status: 400 });
    }

    const isSvg = mode === 'svg' && Array.isArray(allowed) && allowed.length > 0;

    const prompt = isSvg
      ? `Suggère UN SEUL nom d'icône lucide-react pour cette carte. Titre: ${title}. Description: ${description}. Choisis UNIQUEMENT parmi cette liste: [${allowed.join(', ')}]. Réponds UNIQUEMENT avec le nom exact (ex: 'Dumbbell'), rien d'autre.`
      : `Suggère un emoji pertinent pour cette carte d'information. Titre: ${title}. Description: ${description}. Réponds UNIQUEMENT avec l'emoji, rien d'autre.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 32,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) {
      return NextResponse.json({ success: false, error: `Anthropic ${r.status}` }, { status: 500 });
    }
    const d = await r.json();
    const block = d.content?.find((c: any) => c.type === 'text');
    const raw = (block?.text || '').trim().replace(/^['"`]|['"`]$/g, '').trim();

    if (isSvg) {
      // Extract a candidate name (alphanumeric word) and snap to the allowed list
      const match = raw.match(/[A-Za-z][A-Za-z0-9]*/);
      const candidate = match ? match[0] : raw;
      const exact = allowed.find((n: string) => n === candidate);
      const ci = exact || allowed.find((n: string) => n.toLowerCase() === candidate.toLowerCase());
      const iconName = ci || allowed[0] || 'Sparkles';
      return NextResponse.json({ success: true, iconName });
    }

    // Emoji mode — take only the first emoji-like character
    const chars = Array.from(raw);
    const emoji = chars[0] || '✨';
    return NextResponse.json({ success: true, emoji });
  } catch (err: any) {
    console.error('[icon-suggest] error:', err?.message);
    return NextResponse.json({ success: false, error: 'Failed to suggest icon' }, { status: 500 });
  }
}
