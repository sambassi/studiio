import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';

// POST /api/content/icon-suggest — suggest a single emoji for a card
// Body: { title: string; description?: string }
// Returns: { success: true, emoji: string } or { success: false, error: string }
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

    const { title = '', description = '' } = await req.json();
    if (!title.trim() && !description.trim()) {
      return NextResponse.json({ success: false, error: 'title or description required' }, { status: 400 });
    }

    const prompt = `Suggère un emoji pertinent pour cette carte d'information. Titre: ${title}. Description: ${description}. Réponds UNIQUEMENT avec l'emoji, rien d'autre.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) {
      return NextResponse.json({ success: false, error: `Anthropic ${r.status}` }, { status: 500 });
    }
    const d = await r.json();
    const block = d.content?.find((c: any) => c.type === 'text');
    const raw = (block?.text || '').trim();
    // Take only the first emoji-like character (handles multi-codepoint ones via Array.from)
    const chars = Array.from(raw);
    const emoji = chars[0] || '✨';

    return NextResponse.json({ success: true, emoji });
  } catch (err: any) {
    console.error('[icon-suggest] error:', err?.message);
    return NextResponse.json({ success: false, error: 'Failed to suggest icon' }, { status: 500 });
  }
}
