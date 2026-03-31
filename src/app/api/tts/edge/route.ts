import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// Accept all Edge TTS neural voices (including Multilingual variants)
const VALID_VOICE_PATTERN = /^[a-z]{2}-[A-Z]{2}-\w+Neural$/;

// Timeout for TTS synthesis (25 seconds — Vercel serverless limit is 60s on Pro, 10s on Hobby)
const TTS_TIMEOUT_MS = 25_000;

// POST /api/tts/edge - Synthesize speech from text
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { text, voice = 'fr-FR-DeniseNeural', rate, pitch } = body;

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
      return NextResponse.json(
        { success: false, error: 'TTS synthesis produced no audio' },
        { status: 500 }
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
      // Initial timeout: wait up to 15s for first data
      let timeout = setTimeout(() => {
        reject(new Error('Stream timeout — no data received'));
      }, 15_000);

      audioStream.on('data', (chunk: Buffer) => {
        // Reset timeout for each chunk (10s between chunks)
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          reject(new Error('Stream timeout — no new data after chunk'));
        }, 10_000);
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

// Increase function timeout for Vercel
export const maxDuration = 30;

// GET /api/tts/edge - List available voices
export async function GET() {
  return NextResponse.json({
    success: true,
    voices: [
      { id: 'fr-FR-DeniseNeural', name: 'Denise', language: 'Francais', gender: 'Female', flag: '\u{1F1EB}\u{1F1F7}' },
      { id: 'fr-FR-HenriNeural', name: 'Henri', language: 'Francais', gender: 'Male', flag: '\u{1F1EB}\u{1F1F7}' },
      { id: 'fr-FR-CoralieMultilingualNeural', name: 'Coralie', language: 'Francais', gender: 'Female', flag: '\u{1F1EB}\u{1F1F7}' },
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
