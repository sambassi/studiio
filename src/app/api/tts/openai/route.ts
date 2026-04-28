import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const TTS_TIMEOUT_MS = 45_000;

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { text, voice, speed } = body as { text?: string; voice?: string; speed?: number };

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }
    if (text.length > 5000) {
      return NextResponse.json({ error: 'Text must be under 5000 characters' }, { status: 400 });
    }
    if (!voice || !ALLOWED_VOICES.has(voice)) {
      return NextResponse.json({ error: 'Invalid voice' }, { status: 400 });
    }

    const safeSpeed = typeof speed === 'number' && speed >= 0.25 && speed <= 4 ? speed : 1.0;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    let openaiRes: Response;
    try {
      openaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1-hd',
          input: text,
          voice,
          response_format: 'mp3',
          speed: safeSpeed,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(() => '');
      console.error('[TTS/OpenAI] upstream error', openaiRes.status, errText.substring(0, 200));
      return NextResponse.json(
        { error: `OpenAI TTS upstream error (${openaiRes.status})` },
        { status: 500 }
      );
    }

    const buf = Buffer.from(await openaiRes.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: 'OpenAI returned empty audio' }, { status: 500 });
    }

    return new NextResponse(new Uint8Array(buf) as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(buf.length),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('aborted') || msg.includes('timeout')) {
      return NextResponse.json({ error: 'OpenAI TTS timed out' }, { status: 504 });
    }
    console.error('[TTS/OpenAI] error:', msg);
    return NextResponse.json({ error: `OpenAI TTS failed: ${msg}` }, { status: 500 });
  }
}
