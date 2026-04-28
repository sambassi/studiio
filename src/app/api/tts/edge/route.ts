import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_VOICE_PATTERN = /^[a-z]{2}-[A-Z]{2}-\w+Neural$/;

// Timeout for TTS synthesis (45 seconds — Vercel Pro allows up to 300s)
const TTS_TIMEOUT_MS = 45_000;

// POST /api/tts/edge - Synthesize speech from text
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { text, voice = 'fr-FR-DeniseNeural', rate, pitch } = body;

    console.log('[TTS/Edge] request | voice:', voice, '| text.length:', text?.length || 0);

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Text is required' },
        { status: 400 }
      );
    }

    if (text.length > 5000) {
      return NextResponse.json(
        { success: false, error: 'Text must be under 5000 characters' },
        { status: 400 }
      );
    }

    if (!VALID_VOICE_PATTERN.test(voice)) {
      console.warn('[TTS/Edge] invalid voice ID rejected:', voice);
      return NextResponse.json(
        { success: false, error: 'Invalid voice ID format' },
        { status: 400 }
      );
    }

    // Wrap TTS synthesis with timeout
    const audioBuffer = await Promise.race([
      synthesizeTTS(text, voice, rate, pitch),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TTS synthesis timeout')), TTS_TIMEOUT_MS)
      ),
    ]);

    if (!audioBuffer || audioBuffer.length === 0) {
      // Edge upstream sometimes "succeeds" with zero bytes when a voice has
      // been removed from the catalog (observed 2026-04-28 with Coralie).
      // Surface this clearly so the client doesn't cascade into a silent
      // browser-fallback masquerading as Edge TTS.
      console.warn('[TTS/Edge] upstream returned 0 bytes for voice:', voice, '— voice may be removed from MS catalog');
      return NextResponse.json(
        { success: false, error: `TTS synthesis returned empty audio for voice "${voice}". The voice may have been removed from the upstream catalog.` },
        { status: 502 }
      );
    }

    // Return audio as MP3
    return new NextResponse(new Uint8Array(audioBuffer) as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('TTS error:', errMsg);

    if (errMsg.includes('timeout')) {
      return NextResponse.json(
        { success: false, error: 'TTS synthesis timed out. Try shorter text or a different voice.' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { success: false, error: `TTS synthesis failed: ${errMsg}` },
      { status: 500 }
    );
  }
}

async function synthesizeTTS(
  text: string,
  voice: string,
  rate?: string,
  pitch?: string,
): Promise<Buffer> {
  const tts = new MsEdgeTTS();

  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    const prosodyOptions: { rate?: string; pitch?: string } = {};
    if (rate) prosodyOptions.rate = rate;
    if (pitch) prosodyOptions.pitch = pitch;

    const { audioStream } = tts.toStream(text, prosodyOptions);
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      let timeout = setTimeout(() => {
        reject(new Error('Stream timeout — no data received'));
      }, 30_000);

      audioStream.on('data', (chunk: Buffer) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          reject(new Error('Stream timeout — no new data after chunk'));
        }, 20_000);
        chunks.push(chunk);
      });
      audioStream.on('end', () => {
        clearTimeout(timeout);
        resolve();
      });
      audioStream.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    return Buffer.concat(chunks);
  } finally {
    try { tts.close(); } catch { /* ignore close errors */ }
  }
}

// GET /api/tts/edge - List available voices
export async function GET() {
  return NextResponse.json({
    success: true,
    voices: [
      { id: 'fr-FR-DeniseNeural', name: 'Denise', language: 'Francais', gender: 'Female', flag: '\u{1F1EB}\u{1F1F7}' },
      { id: 'fr-FR-HenriNeural', name: 'Henri', language: 'Francais', gender: 'Male', flag: '\u{1F1EB}\u{1F1F7}' },
      // fr-FR-CoralieMultilingualNeural removed 2026-04-28: returns 0 bytes upstream
      { id: 'fr-FR-VivienneMultilingualNeural', name: 'Vivienne', language: 'Francais', gender: 'Female', flag: '\u{1F1EB}\u{1F1F7}' },
      { id: 'en-US-AriaNeural', name: 'Aria', language: 'English', gender: 'Female', flag: '\u{1F1FA}\u{1F1F8}' },
      { id: 'en-US-GuyNeural', name: 'Guy', language: 'English', gender: 'Male', flag: '\u{1F1FA}\u{1F1F8}' },
      { id: 'en-US-JennyNeural', name: 'Jenny', language: 'English', gender: 'Female', flag: '\u{1F1FA}\u{1F1F8}' },
      { id: 'en-US-DavisNeural', name: 'Davis', language: 'English', gender: 'Male', flag: '\u{1F1FA}\u{1F1F8}' },
      { id: 'es-ES-ElviraNeural', name: 'Elvira', language: 'Espanol', gender: 'Female', flag: '\u{1F1EA}\u{1F1F8}' },
      { id: 'es-ES-AlvaroNeural', name: 'Alvaro', language: 'Espanol', gender: 'Male', flag: '\u{1F1EA}\u{1F1F8}' },
      { id: 'pt-BR-FranciscaNeural', name: 'Francisca', language: 'Portugais', gender: 'Female', flag: '\u{1F1E7}\u{1F1F7}' },
      { id: 'pt-BR-AntonioNeural', name: 'Antonio', language: 'Portugais', gender: 'Male', flag: '\u{1F1E7}\u{1F1F7}' },
      { id: 'de-DE-KatjaNeural', name: 'Katja', language: 'Allemand', gender: 'Female', flag: '\u{1F1E9}\u{1F1EA}' },
      { id: 'de-DE-ConradNeural', name: 'Conrad', language: 'Allemand', gender: 'Male', flag: '\u{1F1E9}\u{1F1EA}' },
    ],
  });
}
