import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { detectAndReportServiceError } from '@/lib/service-alerts';
import { ELEVENLABS_VOICE_PREFIX } from '@/lib/types/voice';
import {
  validateCloneRequest,
  voiceStoreReady,
  listUserVoices,
  saveUserVoice,
  MAX_SAMPLES,
} from '@/lib/voice/store';

/**
 * Clonage vocal instantane — enregistrement de l'utilisateur → voix ElevenLabs.
 *
 * Endpoint reel, verifie sur elevenlabs.io/docs : `POST /v1/voices/add`, en
 * **multipart** (`name` + `files`, au pluriel et sans crochets), en-tete
 * `xi-api-key`, reponse `{ voice_id, requires_verification }`.
 *
 * ⚠️ L'ORDRE DES OPERATIONS EST LE POINT DELICAT.
 *
 * La table `user_voices` est sondee AVANT d'appeler ElevenLabs. Cloner puis
 * decouvrir qu'on ne peut pas ranger le `voice_id` laisserait dans le compte
 * partage une voix orpheline : plus personne ne saurait a qui elle appartient,
 * ni ne pourrait la supprimer, et elle compterait dans le quota du plan. Mieux
 * vaut refuser avant que d'echouer apres.
 *
 * Si l'ecriture echoue MALGRE la sonde, la voix est supprimee chez ElevenLabs
 * — un rattrapage, pour ne pas laisser de trace inexploitable.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
const CLONE_TIMEOUT_MS = 90_000;
/** Une voix clonee par utilisateur : au-dela, le quota du plan part vite. */
const MAX_VOICES_PER_USER = 3;

function apiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

/** Supprime une voix chez ElevenLabs — rattrapage, jamais bloquant. */
async function deleteRemoteVoice(voiceId: string, key: string): Promise<void> {
  try {
    await fetch(`${ELEVENLABS_BASE}/v1/voices/${voiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': key },
      cache: 'no-store',
    });
  } catch (err) {
    console.error('[Voice/Clone] Nettoyage impossible pour', voiceId, err);
  }
}

/** POST /api/voice/clone — multipart `{ name, consent, lang?, files[] }`. */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const key = apiKey();
    if (!key) {
      return NextResponse.json(
        { success: false, error: 'Le clonage vocal n’est pas configuré sur ce serveur.' },
        { status: 503 },
      );
    }

    // Sonde AVANT l'appel paye : voir l'en-tete de fichier.
    if (!(await voiceStoreReady())) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Le clonage vocal n’est pas encore disponible : la migration user_voices n’a pas été appliquée.',
        },
        { status: 503 },
      );
    }

    const form = await req.formData();
    const samples = form
      .getAll('files')
      .filter((v): v is File => typeof v === 'object' && v !== null && 'size' in v);

    const verdict = validateCloneRequest({
      name: form.get('name'),
      consent: form.get('consent'),
      samples: samples.map((f) => ({ type: f.type, size: f.size })),
    });
    if (!verdict.ok) {
      return NextResponse.json({ success: false, error: verdict.error }, { status: verdict.status });
    }

    const name = String(form.get('name')).trim();
    const lang = typeof form.get('lang') === 'string' ? String(form.get('lang')).trim() : null;

    // Plafond par utilisateur — le quota de voix du plan est global au compte.
    const existing = await listUserVoices(userId);
    if (existing.length >= MAX_VOICES_PER_USER) {
      return NextResponse.json(
        {
          success: false,
          error: `Vous avez déjà ${MAX_VOICES_PER_USER} voix clonées. Supprimez-en une avant d’en créer une nouvelle.`,
        },
        { status: 409 },
      );
    }

    // ── Clonage chez ElevenLabs ──────────────────────────────────────────
    const upstreamForm = new FormData();
    upstreamForm.append('name', name);
    // Le champ s'appelle `files`, au pluriel et SANS crochets : `files[]`
    // produit un 422 « field required ».
    for (const sample of samples.slice(0, MAX_SAMPLES)) {
      upstreamForm.append('files', sample, sample.name || 'sample.webm');
    }
    upstreamForm.append('remove_background_noise', 'true');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLONE_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(`${ELEVENLABS_BASE}/v1/voices/add`, {
        method: 'POST',
        // Pas de `Content-Type` a la main : `fetch` doit poser lui-meme la
        // frontiere multipart, qu'un en-tete ecrit en dur ecraserait.
        headers: { 'xi-api-key': key },
        body: upstreamForm,
        signal: controller.signal,
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timer);
    }

    const rawBody = await upstream.text();
    if (!upstream.ok) {
      console.error('[Voice/Clone] upstream error', upstream.status, rawBody.slice(0, 400));
      detectAndReportServiceError(
        'elevenlabs',
        new Error(`ElevenLabs clone ${upstream.status}: ${rawBody.slice(0, 200)}`),
      );
      // Le message REEL du fournisseur est relaye : la doc ne publie pas de
      // liste fermee de formats, et un « erreur 422 » sec obligerait a
      // deviner ce que l'enregistrement a de fautif.
      return NextResponse.json(
        {
          success: false,
          error: `Clonage refusé par ElevenLabs (${upstream.status}).`,
          detail: rawBody.slice(0, 300),
        },
        { status: 502 },
      );
    }

    let parsed: { voice_id?: string; requires_verification?: boolean } | null = null;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      console.error('[Voice/Clone] reponse non-JSON', rawBody.slice(0, 200));
      return NextResponse.json(
        { success: false, error: 'Réponse illisible d’ElevenLabs.' },
        { status: 502 },
      );
    }

    const voiceId = String(parsed?.voice_id ?? '').trim();
    if (!voiceId) {
      return NextResponse.json(
        { success: false, error: 'ElevenLabs n’a renvoyé aucun identifiant de voix.' },
        { status: 502 },
      );
    }

    // ── Rattachement ─────────────────────────────────────────────────────
    const saved = await saveUserVoice({ userId, providerVoiceId: voiceId, name, lang });
    if (!saved) {
      // Rattrapage : sans rattachement, cette voix serait inexploitable ET
      // impossible a retrouver dans le compte partage.
      await deleteRemoteVoice(voiceId, key);
      return NextResponse.json(
        { success: false, error: 'Voix créée mais impossible à enregistrer — elle a été supprimée.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      voice: {
        id: `${ELEVENLABS_VOICE_PREFIX}${voiceId}`,
        name: saved.name,
        lang: saved.lang,
      },
      // `requires_verification` a true = la voix existe mais ElevenLabs
      // demande une verification avant de la rendre utilisable.
      requiresVerification: parsed?.requires_verification === true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('aborted') || msg.includes('timeout')) {
      return NextResponse.json(
        { success: false, error: 'Le clonage a pris trop de temps.' },
        { status: 504 },
      );
    }
    console.error('[Voice/Clone] error:', msg);
    detectAndReportServiceError('elevenlabs', err);
    return NextResponse.json({ success: false, error: `Clonage impossible : ${msg}` }, { status: 500 });
  }
}

/** GET /api/voice/clone — voix clonees de l'utilisateur, pour l'ecran « Ma voix ». */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const voices = await listUserVoices(session.user.id);
    return NextResponse.json({
      success: true,
      configured: !!apiKey(),
      voices: voices.map((v) => ({
        id: `${ELEVENLABS_VOICE_PREFIX}${v.provider_voice_id}`,
        name: v.name,
        lang: v.lang,
        createdAt: v.created_at,
      })),
    });
  } catch (err) {
    console.error('[Voice/Clone] list error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: true, configured: !!apiKey(), voices: [] });
  }
}

/** DELETE /api/voice/clone?id=elevenlabs-xxx — retire une voix clonee. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const raw = req.nextUrl.searchParams.get('id') || '';
    const voiceId = raw.replace(new RegExp(`^${ELEVENLABS_VOICE_PREFIX}`), '').trim();
    if (!voiceId) {
      return NextResponse.json({ success: false, error: 'Identifiant manquant.' }, { status: 400 });
    }

    // On ne supprime QUE parmi les voix de cet utilisateur : sans ce filtre,
    // n'importe qui pourrait supprimer la voix de n'importe qui d'autre dans
    // le compte partage.
    const mine = await listUserVoices(session.user.id);
    const cible = mine.find((v) => v.provider_voice_id === voiceId);
    if (!cible) {
      return NextResponse.json({ success: false, error: 'Voix introuvable.' }, { status: 404 });
    }

    const key = apiKey();
    if (key) await deleteRemoteVoice(voiceId, key);

    const { supabaseAdmin } = await import('@/lib/db/supabase');
    const { error } = await supabaseAdmin.from('user_voices').delete().eq('id', cible.id);
    if (error) {
      console.error('[Voice/Clone] suppression echouee :', error.message);
      return NextResponse.json({ success: false, error: 'Suppression impossible.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Voice/Clone] delete error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Suppression impossible.' }, { status: 500 });
  }
}
