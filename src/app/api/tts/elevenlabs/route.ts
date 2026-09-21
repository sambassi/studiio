import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { detectAndReportServiceError } from '@/lib/service-alerts';
import { mapElevenLabsVoice, ELEVENLABS_VOICE_PREFIX, type ElevenLabsTtsVoice } from '@/lib/types/voice';
import { listUserVoices } from '@/lib/voice/store';
import { voixUtilisable } from '@/lib/voice/profil';

/**
 * TTS ElevenLabs — synthese vocale, et liste des voix du compte.
 *
 * Endpoints reels, verifies sur elevenlabs.io/docs (et non devines) :
 *
 * | Usage | Appel |
 * |-------|-------|
 * | Synthese | `POST /v1/text-to-speech/{voice_id}` — corps `{ text, model_id }`, repond en **audio brut** |
 * | Liste | `GET /v2/voices` (v2, pas v1) — repond `{ voices: [{ voice_id, name, category, labels }] }` |
 *
 * Authentification par en-tete **`xi-api-key`**, jamais `Authorization: Bearer`.
 *
 * La reponse de synthese a exactement la meme forme que celle de
 * `/api/tts/openai` — audio brut, `Content-Type: audio/*` — pour que le client
 * TTS n'ait aucune branche de deballage a gerer.
 *
 * ⚠️ **Les voix clonees ne viennent PAS de `GET /v2/voices`.** La cle API
 * designe UN compte ElevenLabs, partage par tous les utilisateurs de Studiio :
 * le catalogue distant renverrait les voix clonees de TOUT LE MONDE, sans
 * notion de proprietaire. Les categories clonees y sont donc filtrees, et les
 * voix clonees de l'utilisateur sont relues dans `user_voices`, qui seule dit
 * a qui appartient quoi.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
/**
 * Modele multilingue : le francais est la langue de l'immense majorite des
 * montages. Les modeles `*_english_*` liraient un texte francais avec un
 * accent anglais.
 */
const MODEL_ID = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
const MAX_TEXT_LENGTH = 5000;
const TTS_TIMEOUT_MS = 45_000;
const LIST_TIMEOUT_MS = 20_000;

/** Categories que l'on peut proposer a tout le monde sans fuite de voix. */
const SHARED_CATEGORIES = new Set(['premade', 'default', 'famous', 'high_quality']);

function apiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

/**
 * Cache memoire (5 min) : le selecteur interroge cette route a chaque montage
 * de panneau — meme raison que pour HeyGen.
 */
let voicesCache: { at: number; voices: ElevenLabsTtsVoice[] } | null = null;
const VOICES_CACHE_MS = 5 * 60 * 1000;

async function listCatalogVoices(): Promise<ElevenLabsTtsVoice[]> {
  if (voicesCache && Date.now() - voicesCache.at < VOICES_CACHE_MS) {
    return voicesCache.voices;
  }
  const key = apiKey();
  if (!key) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ELEVENLABS_BASE}/v2/voices?page_size=100`, {
      method: 'GET',
      headers: { 'xi-api-key': key },
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[TTS/ElevenLabs] GET /v2/voices', res.status, text.slice(0, 300));
      return [];
    }
    const body = text ? (JSON.parse(text) as { voices?: Array<Record<string, unknown>> }) : null;
    const voices = (Array.isArray(body?.voices) ? body!.voices : [])
      .filter((raw) => SHARED_CATEGORIES.has(String(raw?.category ?? '')))
      .map((raw) => mapElevenLabsVoice(raw))
      .filter((v): v is ElevenLabsTtsVoice => v !== null);

    // On ne met en cache qu'un resultat exploitable : une panne passagere ne
    // doit pas vider le selecteur pendant cinq minutes.
    if (voices.length > 0) voicesCache = { at: Date.now(), voices };
    return voices;
  } catch (err) {
    console.error('[TTS/ElevenLabs] liste échouée —', err instanceof Error ? err.message : err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/tts/elevenlabs — voix de CET utilisateur, puis le catalogue.
 *
 * Les voix clonees d'abord : c'est celle que l'utilisateur cherche en premier,
 * et le selecteur affiche la liste dans l'ordre recu.
 *
 * Le catalogue est mis en cache globalement — il est le meme pour tous. Les
 * voix clonees, elles, ne le sont JAMAIS : un cache partage les ferait fuiter
 * d'un utilisateur a l'autre, ce que tout le reste de ce fichier s'emploie a
 * empecher.
 *
 * ⚠️ La cle API ne conditionne que le CATALOGUE — un appel reseau vers
 * ElevenLabs. Les voix clonees sont une donnee locale (`user_voices`), lue
 * quoi qu'il arrive : sans cela, la meme voix apparaissait dans l'Autopilote
 * (qui lit `/api/voice/clone`, independant de la cle) et pas dans Creer, et
 * l'utilisateur croyait sa voix perdue. `configured: false` dit seulement
 * que la synthese n'est pas possible pour l'instant — pas que la voix
 * n'existe pas.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const [mine, catalogue] = await Promise.all([
      listUserVoices(session.user.id),
      // Sans cle, pas de catalogue : `listCatalogVoices` le sait deja, mais
      // l'eviter ici epargne un appel inutile et rend l'intention lisible.
      apiKey() ? listCatalogVoices() : Promise.resolve([] as ElevenLabsTtsVoice[]),
    ]);
    const clonees: ElevenLabsTtsVoice[] = mine.map((v) => ({
      id: `${ELEVENLABS_VOICE_PREFIX}${v.provider_voice_id}`,
      name: `${v.name} (ma voix)`,
      lang: v.lang || 'FR',
      // `user_voices` ne stocke pas le genre : on ne l'invente pas. Un
      // « Female » en dur etait faux pour la moitie des comptes et s'affichait
      // « F » a cote de la voix de l'utilisateur.
      gender: 'Neutral',
      flag: '\u{1F3A4}',
      provider: 'elevenlabs',
      cloned: true,
    }));
    return NextResponse.json({ voices: [...clonees, ...catalogue], configured: !!apiKey() });
  } catch (err) {
    console.error('[TTS/ElevenLabs] list error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ voices: [], configured: !!apiKey() }, { status: 200 });
  }
}

/**
 * Une voix est-elle AUTORISÉE pour ce compte ?
 *
 * ⚠️ LE `voice_id` VIENT DU NAVIGATEUR, ET LE COMPTE ELEVENLABS EST PARTAGÉ :
 * la forme seule ne dit pas à qui la voix appartient. Deux familles, et
 * rien d'autre :
 *   A. une voix CLONÉE de CE compte — `user_voices` pour `user_id` de la
 *      session, fournisseur ElevenLabs, `provider_voice_id` exact,
 *      utilisable (`voixUtilisable`) ;
 *   B. une voix du CATALOGUE partagé — présente dans `listCatalogVoices()`
 *      (catégories publiques seulement : les voix clonées de tout le monde
 *      en sont filtrées).
 * La voix clonée d'autrui n'est dans aucune des deux : refusée, et le
 * fournisseur n'est pas appelé. Le refus est un 404 uniforme — un 403
 * confirmerait l'existence d'une voix qui n'est pas à vous.
 */
async function voixAutorisee(userId: string, voiceId: string): Promise<boolean> {
  const miennes = await listUserVoices(userId);
  if (miennes.some((v) => v.provider === 'elevenlabs' && v.provider_voice_id === voiceId && voixUtilisable(v))) return true;
  const catalogue = await listCatalogVoices();
  return catalogue.some((v) => v.id === `${ELEVENLABS_VOICE_PREFIX}${voiceId}`);
}

/** POST /api/tts/elevenlabs — `{ text, voice }` → audio brut. */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const key = apiKey();
    if (!key) {
      return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { text, voice } = body as { text?: string; voice?: string };

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Text must be under ${MAX_TEXT_LENGTH} characters` },
        { status: 400 },
      );
    }
    // Le client envoie l'identifiant prefixe ; ElevenLabs attend le voice_id nu.
    const voiceId = typeof voice === 'string'
      ? voice.replace(new RegExp(`^${ELEVENLABS_VOICE_PREFIX}`), '').trim()
      : '';
    // Le voice_id part dans le CHEMIN de l'URL : une valeur exotique y
    // fabriquerait une requete vers un autre endpoint.
    if (!voiceId || !/^[A-Za-z0-9_-]{8,64}$/.test(voiceId)) {
      return NextResponse.json({ error: 'Invalid voice' }, { status: 400 });
    }
    // ⚠️ AVANT tout appel de synthèse : la voix doit être la mienne ou publique.
    if (!(await voixAutorisee(session.user.id, voiceId))) {
      return NextResponse.json({ error: 'Unknown voice' }, { status: 404 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    let upstream: Response;
    try {
      upstream = await fetch(
        `${ELEVENLABS_BASE}/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': key,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({ text, model_id: MODEL_ID }),
          signal: controller.signal,
          cache: 'no-store',
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.error('[TTS/ElevenLabs] upstream error', upstream.status, errText.slice(0, 300));
      detectAndReportServiceError(
        'elevenlabs',
        new Error(`ElevenLabs TTS ${upstream.status}: ${errText.slice(0, 200)}`),
      );
      return NextResponse.json(
        { error: `ElevenLabs TTS upstream error (${upstream.status})` },
        { status: 500 },
      );
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: 'ElevenLabs returned empty audio' }, { status: 500 });
    }

    const upstreamType = upstream.headers.get('content-type') || '';
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
      return NextResponse.json({ error: 'ElevenLabs TTS timed out' }, { status: 504 });
    }
    console.error('[TTS/ElevenLabs] error:', msg);
    detectAndReportServiceError('elevenlabs', err);
    return NextResponse.json({ error: `ElevenLabs TTS failed: ${msg}` }, { status: 500 });
  }
}
