import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { HEYGEN_VOICE_PREFIX, type HeyGenTtsVoice } from '@/lib/types/voice';

/**
 * TTS HeyGen — synthese vocale avec les voix du compte, **voix clonee comprise**.
 *
 * ⚠️ Endpoint reel : `POST /v3/voices/speech` (moteur « starfish »), verifie sur
 * developers.heygen.com/docs/voices/speech. Il n'existe pas d'endpoint
 * `text_to_speech.generate` dans l'API actuelle.
 *
 * Difference majeure avec OpenAI : HeyGen ne renvoie PAS l'audio dans la reponse
 * mais une URL (`data.audio_url`). Cette route telecharge donc le fichier et le
 * renvoie en binaire, dans le **meme format de reponse que /api/tts/openai**
 * (corps audio brut + Content-Type audio), pour que le client TTS n'ait aucune
 * branche specifique a gerer.
 *
 * GET sur la meme route liste les voix HeyGen exploitables en TTS
 * (`GET /v3/voices?engine=starfish`), voix privees en premier : la voix clonee
 * de l'utilisateur apparait ainsi automatiquement dans le selecteur, sans
 * aucun identifiant code en dur.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const HEYGEN_BASE = 'https://api.heygen.com';
/** Limite documentee de POST /v3/voices/speech. */
const MAX_TEXT_LENGTH = 5000;
const TTS_TIMEOUT_MS = 45_000;
const LIST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

// ── Voix ──────────────────────────────────────────────────────────────────
// Le type `HeyGenTtsVoice` et le prefixe d'identifiant vivent dans
// `@/lib/types/voice` : un fichier route.ts ne doit exporter que ses handlers
// et sa config, sinon Next.js rejette l'export a la compilation.

/** Libelle de langue HeyGen ("French") → code court du selecteur ("FR"). */
const LANG_CODES: Record<string, string> = {
  french: 'FR',
  english: 'EN',
  spanish: 'ES',
  portuguese: 'PT',
  german: 'DE',
  italian: 'IT',
  dutch: 'NL',
  arabic: 'AR',
  japanese: 'JA',
  korean: 'KO',
  chinese: 'ZH',
};

const LANG_FLAGS: Record<string, string> = {
  FR: '\u{1F1EB}\u{1F1F7}',
  EN: '\u{1F1FA}\u{1F1F8}',
  ES: '\u{1F1EA}\u{1F1F8}',
  PT: '\u{1F1E7}\u{1F1F7}',
  DE: '\u{1F1E9}\u{1F1EA}',
  IT: '\u{1F1EE}\u{1F1F9}',
  NL: '\u{1F1F3}\u{1F1F1}',
};

function toLangCode(language?: string): string {
  const raw = (language || '').trim();
  if (!raw) return 'EN';
  const mapped = LANG_CODES[raw.toLowerCase()];
  if (mapped) return mapped;
  // "fr-FR" / "fr" → FR ; libelle inconnu → 2 premieres lettres.
  return raw.slice(0, 2).toUpperCase();
}

function apiKey(): string | null {
  return process.env.HEYGEN_API_KEY?.trim() || null;
}

async function heygenGet(path: string, timeoutMs: number): Promise<unknown | null> {
  const key = apiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${HEYGEN_BASE}${path}`, {
      method: 'GET',
      headers: { 'X-Api-Key': key },
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[TTS/HeyGen] GET', path, res.status, text.slice(0, 300));
      return null;
    }
    return text ? JSON.parse(text) : null;
  } catch (err) {
    console.error('[TTS/HeyGen] GET', path, 'echec —', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** L'enveloppe varie selon les endpoints HeyGen : on ratisse les formes connues. */
function extractVoiceArray(body: unknown): Array<Record<string, any>> {
  if (!body) return [];
  if (Array.isArray(body)) return body as Array<Record<string, any>>;
  const b = body as Record<string, any>;
  for (const candidate of [b.data, b.voices, b.data?.voices, b.data?.list, b.data?.items, b.list, b.items]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function mapVoice(raw: Record<string, any>, cloned: boolean): HeyGenTtsVoice | null {
  const voiceId = String(raw.voice_id ?? raw.id ?? '').trim();
  if (!voiceId) return null;
  const lang = toLangCode(raw.language ? String(raw.language) : undefined);
  const gender = String(raw.gender ?? '').toLowerCase() === 'male' ? 'Male' : 'Female';
  const baseName = String(raw.display_name ?? raw.name ?? 'Voix').trim() || 'Voix';
  return {
    id: `${HEYGEN_VOICE_PREFIX}${voiceId}`,
    name: cloned ? `${baseName} (ma voix)` : `${baseName} (HeyGen)`,
    lang,
    gender,
    flag: LANG_FLAGS[lang] ?? '\u{1F3A4}',
    provider: 'heygen',
    cloned,
  };
}

/**
 * Cache memoire (5 min) : le selecteur interroge cette route a chaque montage
 * de panneau, inutile de refrapper HeyGen a chaque fois.
 */
let voicesCache: { at: number; voices: HeyGenTtsVoice[] } | null = null;
const VOICES_CACHE_MS = 5 * 60 * 1000;

async function listHeyGenVoices(): Promise<HeyGenTtsVoice[]> {
  if (voicesCache && Date.now() - voicesCache.at < VOICES_CACHE_MS) {
    return voicesCache.voices;
  }

  // Voix privees d'abord : ce sont les voix clonees du compte, celles que
  // l'utilisateur cherche en priorite dans le selecteur.
  const [privateBody, publicBody] = await Promise.all([
    heygenGet('/v3/voices?engine=starfish&type=private&limit=100', LIST_TIMEOUT_MS),
    heygenGet('/v3/voices?engine=starfish&type=public&limit=100', LIST_TIMEOUT_MS),
  ]);

  const seen = new Set<string>();
  const voices: HeyGenTtsVoice[] = [];
  for (const [body, cloned] of [
    [privateBody, true],
    [publicBody, false],
  ] as Array<[unknown, boolean]>) {
    for (const raw of extractVoiceArray(body)) {
      const voice = mapVoice(raw, cloned);
      if (!voice || seen.has(voice.id)) continue;
      seen.add(voice.id);
      voices.push(voice);
    }
  }

  // On ne met en cache qu'un resultat exploitable : une panne passagere de
  // HeyGen ne doit pas vider le selecteur pendant 5 minutes.
  if (voices.length > 0) voicesCache = { at: Date.now(), voices };
  return voices;
}

/** GET /api/tts/heygen — voix HeyGen du compte (voix clonee comprise). */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!apiKey()) {
      // Pas une erreur : HeyGen est optionnel, le selecteur garde les autres voix.
      return NextResponse.json({ voices: [], configured: false });
    }
    const voices = await listHeyGenVoices();
    return NextResponse.json({ voices, configured: true });
  } catch (err) {
    console.error('[TTS/HeyGen] list error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ voices: [], configured: true }, { status: 200 });
  }
}

// ── Synthese ──────────────────────────────────────────────────────────────

/** POST /api/tts/heygen — `{ text, voice }` → audio brut (meme forme que /api/tts/openai). */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const key = apiKey();
    if (!key) {
      return NextResponse.json({ error: 'HEYGEN_API_KEY not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { text, voice, speed } = body as { text?: string; voice?: string; speed?: number };

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Text must be under ${MAX_TEXT_LENGTH} characters` },
        { status: 400 },
      );
    }
    // Le client envoie l'identifiant prefixe (`heygen-<voice_id>`) ; HeyGen
    // attend le voice_id nu.
    const voiceId = typeof voice === 'string' ? voice.replace(/^heygen-/, '').trim() : '';
    if (!voiceId) {
      return NextResponse.json({ error: 'Invalid voice' }, { status: 400 });
    }

    const safeSpeed = typeof speed === 'number' && speed >= 0.5 && speed <= 2 ? speed : 1.0;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    let heygenRes: Response;
    try {
      heygenRes = await fetch(`${HEYGEN_BASE}/v3/voices/speech`, {
        method: 'POST',
        headers: {
          'X-Api-Key': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice_id: voiceId,
          input_type: 'text',
          speed: safeSpeed,
        }),
        signal: controller.signal,
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timeout);
    }

    const rawBody = await heygenRes.text();
    if (!heygenRes.ok) {
      console.error('[TTS/HeyGen] upstream error', heygenRes.status, rawBody.slice(0, 300));
      return NextResponse.json(
        { error: `HeyGen TTS upstream error (${heygenRes.status})` },
        { status: 500 },
      );
    }

    let parsed: any = null;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      console.error('[TTS/HeyGen] reponse non-JSON', rawBody.slice(0, 200));
      return NextResponse.json({ error: 'HeyGen returned an unreadable response' }, { status: 500 });
    }

    // HTTP 200 avec `error` non nul : HeyGen le fait sur certains endpoints.
    if (parsed?.error) {
      console.error('[TTS/HeyGen] 200-with-error', rawBody.slice(0, 300));
      return NextResponse.json({ error: 'HeyGen TTS refused the request' }, { status: 500 });
    }

    const audioUrl: string | undefined = parsed?.data?.audio_url ?? parsed?.audio_url;
    if (!audioUrl) {
      console.error('[TTS/HeyGen] audio_url absent', rawBody.slice(0, 300));
      return NextResponse.json({ error: 'HeyGen returned no audio URL' }, { status: 500 });
    }

    // HeyGen renvoie une URL : on telecharge pour servir le meme format de
    // reponse que /api/tts/openai (audio brut, pas de JSON a deballer).
    const dlController = new AbortController();
    const dlTimeout = setTimeout(() => dlController.abort(), DOWNLOAD_TIMEOUT_MS);
    let audioRes: Response;
    try {
      audioRes = await fetch(audioUrl, { signal: dlController.signal, cache: 'no-store' });
    } finally {
      clearTimeout(dlTimeout);
    }

    if (!audioRes.ok) {
      console.error('[TTS/HeyGen] download failed', audioRes.status);
      return NextResponse.json(
        { error: `HeyGen audio download failed (${audioRes.status})` },
        { status: 500 },
      );
    }

    const buf = Buffer.from(await audioRes.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: 'HeyGen returned empty audio' }, { status: 500 });
    }

    const upstreamType = audioRes.headers.get('content-type') || '';
    const contentType = upstreamType.startsWith('audio/') ? upstreamType : 'audio/mpeg';

    return new NextResponse(new Uint8Array(buf) as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buf.length),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('aborted') || msg.includes('timeout')) {
      return NextResponse.json({ error: 'HeyGen TTS timed out' }, { status: 504 });
    }
    console.error('[TTS/HeyGen] error:', msg);
    return NextResponse.json({ error: `HeyGen TTS failed: ${msg}` }, { status: 500 });
  }
}
