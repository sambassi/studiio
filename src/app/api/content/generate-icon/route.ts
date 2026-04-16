import { NextRequest, NextResponse } from 'next/server';

// POST /api/content/generate-icon
// Body: { prompt: string }
// Returns: { icon: string } — a single Unicode emoji character.
export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 });
    }
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY missing' }, { status: 500 });
    }

    const system =
      "Tu reçois un mot ou une courte description. Retourne UNIQUEMENT un seul emoji unicode pertinent (1 caractère max), rien d'autre.";

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: prompt.slice(0, 200) }],
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Anthropic API error: ${res.status} ${errTxt.slice(0, 200)}` },
        { status: 500 },
      );
    }

    const data = await res.json();
    const txt: string = Array.isArray(data?.content)
      ? data.content
          .map((c: any) => (c?.type === 'text' ? c.text : ''))
          .join('')
          .trim()
      : '';
    const emoji = Array.from(txt)[0] || '✨';
    return NextResponse.json({ icon: emoji });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'generation failed' }, { status: 500 });
  }
}
