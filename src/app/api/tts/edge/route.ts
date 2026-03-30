import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const VOICES: Record<string, string> = {
  'fr-FR-DeniseNeural': 'fr-FR-DeniseNeural',
  'fr-FR-HenriNeural': 'fr-FR-HenriNeural',
  'en-US-AriaNeural': 'en-US-AriaNeural',
  'en-US-GuyNeural': 'en-US-GuyNeural',
};

// POST /api/tts/edge - Synthesize speech from text
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { text, voice = 'fr-FR-DeniseNeural', rate = '+0%', pitch = '+0Hz' } = body;

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

    const voiceId = VOICES[voice];
    if (!voiceId) {
      return NextResponse.json(
        { success: false, error: `Invalid voice. Available: ${Object.keys(VOICES).join(', ')}` },
        { status: 400 }
      );
    }

    // Initialize Edge TTS
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    // Synthesize
    const readable = tts.toStream(text);
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      readable.on('data', (chunk: any) => {
        if (chunk.type === 'audio') {
          chunks.push(chunk.data);
        }
      });
      readable.on('end', () => resolve());
      readable.on('error', reject);
    });

    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      return NextResponse.json(
        { success: false, error: 'TTS synthesis produced no audio' },
        { status: 500 }
      );
    }

    // Return audio as MP3
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
        'Content-Disposition': 'attachment; filename="tts-output.mp3"',
      },
    });
  } catch (error) {
    console.error('TTS error:', error);
    return NextResponse.json(
      { success: false, error: 'TTS synthesis failed' },
      { status: 500 }
    );
  }
}

// GET /api/tts/edge - List available voices
export async function GET() {
  return NextResponse.json({
    success: true,
    voices: [
      { id: 'fr-FR-DeniseNeural', name: 'Denise', language: 'Francais', gender: 'Female' },
      { id: 'fr-FR-HenriNeural', name: 'Henri', language: 'Francais', gender: 'Male' },
      { id: 'en-US-AriaNeural', name: 'Aria', language: 'English', gender: 'Female' },
      { id: 'en-US-GuyNeural', name: 'Guy', language: 'English', gender: 'Male' },
    ],
  });
}
