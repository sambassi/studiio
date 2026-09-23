/**
 * TTS Client — Server API with browser SpeechSynthesis fallback.
 * Tries server-side Edge TTS first, falls back to browser voices if server fails.
 */

import { isHeyGenVoiceId, isElevenLabsVoiceId } from '@/lib/types/voice';

export interface TtsVoice {
  id: string;
  name: string;
  lang: string;
  /** `Neutral` = genre inconnu (voix clonee) : aucune lettre affichee. */
  gender: 'Female' | 'Male' | 'Neutral';
  flag: string;
  /**
   * Optional. Absent = legacy Edge TTS (default).
   * 'openai' routes to /api/tts/openai, 'heygen' to /api/tts/heygen,
   * 'elevenlabs' to /api/tts/elevenlabs.
   */
  provider?: 'edge' | 'openai' | 'heygen' | 'elevenlabs';
  /**
   * Optional. `true` = voix CLONEE de l'utilisateur (listee a la volee par
   * HeyGen ou ElevenLabs). Les selecteurs la proposent d'office quand aucun
   * choix explicite n'a ete fait : c'est la voix que l'utilisateur cherche.
   */
  cloned?: boolean;
}

export const TTS_VOICES: TtsVoice[] = [
  // Francais — Coralie removed: Microsoft Edge TTS upstream returns 0 bytes
  // for fr-FR-CoralieMultilingualNeural as of 2026-04-28 (verified via direct
  // msedge-tts test, 3 consecutive attempts). Other Multilingual voices like
  // Vivienne still work, so this is voice-specific, not a Multilingual rule.
  { id: 'fr-FR-DeniseNeural', name: 'Denise', lang: 'FR', gender: 'Female', flag: '\u{1F1EB}\u{1F1F7}' },
  { id: 'fr-FR-HenriNeural', name: 'Henri', lang: 'FR', gender: 'Male', flag: '\u{1F1EB}\u{1F1F7}' },
  { id: 'fr-FR-VivienneMultilingualNeural', name: 'Vivienne', lang: 'FR', gender: 'Female', flag: '\u{1F1EB}\u{1F1F7}' },
  // English
  { id: 'en-US-AriaNeural', name: 'Aria', lang: 'EN', gender: 'Female', flag: '\u{1F1FA}\u{1F1F8}' },
  { id: 'en-US-GuyNeural', name: 'Guy', lang: 'EN', gender: 'Male', flag: '\u{1F1FA}\u{1F1F8}' },
  { id: 'en-US-JennyNeural', name: 'Jenny', lang: 'EN', gender: 'Female', flag: '\u{1F1FA}\u{1F1F8}' },
  { id: 'en-US-DavisNeural', name: 'Davis', lang: 'EN', gender: 'Male', flag: '\u{1F1FA}\u{1F1F8}' },
  // Espanol
  { id: 'es-ES-ElviraNeural', name: 'Elvira', lang: 'ES', gender: 'Female', flag: '\u{1F1EA}\u{1F1F8}' },
  { id: 'es-ES-AlvaroNeural', name: 'Alvaro', lang: 'ES', gender: 'Male', flag: '\u{1F1EA}\u{1F1F8}' },
  // Portugais
  { id: 'pt-BR-FranciscaNeural', name: 'Francisca', lang: 'PT', gender: 'Female', flag: '\u{1F1E7}\u{1F1F7}' },
  { id: 'pt-BR-AntonioNeural', name: 'Antonio', lang: 'PT', gender: 'Male', flag: '\u{1F1E7}\u{1F1F7}' },
  // Allemand
  { id: 'de-DE-KatjaNeural', name: 'Katja', lang: 'DE', gender: 'Female', flag: '\u{1F1E9}\u{1F1EA}' },
  { id: 'de-DE-ConradNeural', name: 'Conrad', lang: 'DE', gender: 'Male', flag: '\u{1F1E9}\u{1F1EA}' },
  // OpenAI TTS — natural voices (English-only for now). Routed via /api/tts/openai.
  { id: 'openai-alloy', name: 'Alloy (OpenAI)', lang: 'EN', gender: 'Female', flag: '\u{1F916}', provider: 'openai' },
  { id: 'openai-echo', name: 'Echo (OpenAI)', lang: 'EN', gender: 'Male', flag: '\u{1F916}', provider: 'openai' },
  { id: 'openai-fable', name: 'Fable (OpenAI)', lang: 'EN', gender: 'Male', flag: '\u{1F916}', provider: 'openai' },
  { id: 'openai-onyx', name: 'Onyx (OpenAI)', lang: 'EN', gender: 'Male', flag: '\u{1F916}', provider: 'openai' },
  { id: 'openai-nova', name: 'Nova (OpenAI)', lang: 'EN', gender: 'Female', flag: '\u{1F916}', provider: 'openai' },
  { id: 'openai-shimmer', name: 'Shimmer (OpenAI)', lang: 'EN', gender: 'Female', flag: '\u{1F916}', provider: 'openai' },
];

// Map voice IDs to BCP47 language codes for browser fallback
const VOICE_LANG_MAP: Record<string, string> = {
  FR: 'fr-FR',
  EN: 'en-US',
  ES: 'es-ES',
  PT: 'pt-BR',
  DE: 'de-DE',
};

/**
 * Try server-side TTS synthesis.
 * Returns null on failure (instead of throwing) so fallback can run.
 */
async function tryServerSynthesize(
  text: string,
  voiceId: string,
  options?: { rate?: string; pitch?: string },
): Promise<Blob | null> {
  // ── HeyGen provider branch ─────────────────────────────────────────────
  // Les voix HeyGen sont listees dynamiquement (voix clonee comprise) : elles
  // n'existent pas dans TTS_VOICES, on route donc sur le prefixe de l'id.
  // En cas d'echec on renvoie null — inutile de tenter Edge avec un id HeyGen.
  // C'est une voix CLONEE : synthesize() n'y substitue aucune autre voix, il
  // remonte une erreur explicite.
  if (isHeyGenVoiceId(voiceId)) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 50_000);
    try {
      const res = await fetch('/api/tts/heygen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceId }),
        signal: ctl.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn('[TTS] HeyGen failed:', data.error || res.status);
        return null;
      }
      const blob = await res.blob();
      if (blob.size === 0) {
        console.warn('[TTS] HeyGen returned empty audio');
        return null;
      }
      console.log('[TTS] HeyGen success:', (blob.size / 1024).toFixed(1), 'KB');
      return blob;
    } catch (err) {
      console.warn('[TTS] HeyGen exception:', err instanceof Error ? err.message : err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── ElevenLabs provider branch ─────────────────────────────────────────
  // Comme HeyGen, les voix ElevenLabs sont listees a la volee — voix clonee
  // comprise — et n'existent donc pas dans TTS_VOICES : le routage se fait sur
  // le PREFIXE de l'id, pas sur une recherche dans la liste statique.
  //
  // On renvoie null plutot que de retomber sur Edge : Edge rejetterait un id
  // `elevenlabs-*`. Et c'est une voix CLONEE : synthesize() n'y substitue
  // aucune autre voix, il remonte une erreur explicite.
  if (isElevenLabsVoiceId(voiceId)) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 50_000);
    try {
      const res = await fetch('/api/tts/elevenlabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceId }),
        signal: ctl.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn('[TTS] ElevenLabs failed:', data.error || res.status);
        return null;
      }
      const blob = await res.blob();
      if (blob.size === 0) {
        console.warn('[TTS] ElevenLabs returned empty audio');
        return null;
      }
      console.log('[TTS] ElevenLabs success:', (blob.size / 1024).toFixed(1), 'KB');
      return blob;
    } catch (err) {
      console.warn('[TTS] ElevenLabs exception:', err instanceof Error ? err.message : err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── OpenAI provider branch ─────────────────────────────────────────────
  // Routes openai-* voice IDs to /api/tts/openai. On any failure, falls
  // through to the existing Edge code below (Edge will return 4xx for an
  // openai-* ID, then synthesize() falls back to browser SpeechSynthesis).
  // This branch is purely additive — the Edge code path below is unchanged.
  const voice = TTS_VOICES.find((v) => v.id === voiceId);
  if (voice?.provider === 'openai') {
    try {
      const openaiVoice = voiceId.replace(/^openai-/, '');
      const openaiCtl = new AbortController();
      const openaiTimer = setTimeout(() => openaiCtl.abort(), 30_000);
      try {
        const res = await fetch('/api/tts/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: openaiVoice }),
          signal: openaiCtl.signal,
        });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 0) {
            console.log('[TTS] OpenAI success:', (blob.size / 1024).toFixed(1), 'KB');
            return blob;
          }
          console.warn('[TTS] OpenAI returned empty audio, falling through to Edge');
        } else {
          console.warn('[TTS] OpenAI failed (status', res.status, '), falling through to Edge');
        }
      } finally {
        clearTimeout(openaiTimer);
      }
    } catch (err) {
      console.warn('[TTS] OpenAI exception, falling through to Edge:', err instanceof Error ? err.message : err);
    }
    // Intentional fall-through to Edge code below.
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000); // 15s timeout (server times out at 25s)

  try {
    console.log('[TTS] Trying server synthesis:', text.substring(0, 40), '...');
    const res = await fetch('/api/tts/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: voiceId,
        rate: options?.rate || '+0%',
        pitch: options?.pitch || '+0Hz',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Server TTS failed' }));
      console.warn('[TTS] Server failed:', data.error || res.status);
      return null;
    }

    const blob = await res.blob();
    if (blob.size === 0) {
      console.warn('[TTS] Server returned empty audio');
      return null;
    }

    console.log('[TTS] Server success:', (blob.size / 1024).toFixed(1), 'KB');
    return blob;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    console.warn('[TTS] Server error:', err instanceof Error ? err.message : 'unknown');
    return null;
  }
}

/**
 * Map an Edge voice ID to an OpenAI TTS voice ID for automatic fallback.
 * Edge TTS upstream is unstable from Vercel (msedge-tts WebSocket frequently
 * blocked / timing out), so we keep OpenAI as a transparent fallback. OpenAI
 * `tts-1-hd` auto-detects the input language so the same model works for
 * FR / EN / ES / PT / DE — we just pick a voice with the matching gender.
 */
function pickOpenAiFallbackVoice(edgeVoiceId: string): 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' {
  const edgeVoice = TTS_VOICES.find((v) => v.id === edgeVoiceId);
  // Female voices: nova (warm), shimmer (clear). Male: echo, onyx, fable.
  // Default mapping prioritizes a single, recognizable voice per gender so
  // batch-generated content sounds consistent across sequences.
  if (edgeVoice?.gender === 'Male') return 'echo';
  return 'nova';
}

/**
 * Try OpenAI TTS as a server-side fallback when Edge TTS fails.
 * Returns null on any failure (caller decides what to do next).
 */
async function tryOpenAiFallback(text: string, edgeVoiceId: string): Promise<Blob | null> {
  const openaiVoice = pickOpenAiFallbackVoice(edgeVoiceId);
  console.log('[TTS] Trying OpenAI fallback voice:', openaiVoice, '(original:', edgeVoiceId, ')');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 50_000);
  try {
    const res = await fetch('/api/tts/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: openaiVoice }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn('[TTS] OpenAI fallback failed:', data.error || res.status);
      return null;
    }
    const blob = await res.blob();
    if (blob.size === 0) {
      console.warn('[TTS] OpenAI fallback returned empty audio');
      return null;
    }
    console.log('[TTS] OpenAI fallback success:', (blob.size / 1024).toFixed(1), 'KB');
    return blob;
  } catch (err) {
    console.warn('[TTS] OpenAI fallback exception:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthesize text to speech.
 *
 * Order:
 *   1. Server Edge TTS (free, unofficial msedge-tts WebSocket)
 *   2. **OpenAI TTS** (requires OPENAI_API_KEY, but reliable on Vercel)
 *
 * The previous browser-fallback path (`browserSynthesize`) is intentionally
 * NOT reached here. It records `AudioContext.createMediaStreamDestination()`
 * but `SpeechSynthesisUtterance.speak()` outputs to the system audio device
 * and never touches the AudioContext graph — `MediaRecorder` captures only
 * the oscillator blip, producing a ~1-5KB silent WebM that crashes Chrome
 * with `DEMUXER_ERROR_COULD_NOT_OPEN` at playback. We keep the function
 * exported for legacy callers (live preview button) but `synthesize()` —
 * the path used for files that get uploaded and embedded in MP4 exports —
 * MUST NOT use it.
 *
 * Throws if both server paths fail. The caller (SequenceVoicesPanel /
 * AudioStudioPanel) catches and surfaces the error via showToast.
 *
 * ⚠️ Une voix CLONEE (`elevenlabs-*`, `heygen-*`) n'a AUCUN repli. Avant,
 * un echec de son fournisseur retombait en silence sur OpenAI « nova », et
 * le fichier obtenu etait etiquete « TTS — Bassi (ma voix) » : l'utilisateur
 * entendait une inconnue sous son propre nom. Ici l'echec est une erreur
 * explicite, et rien d'autre n'est appele.
 */
export async function synthesize(
  text: string,
  voiceId: string,
  options?: { rate?: string; pitch?: string },
): Promise<Blob> {
  // 1. Try server first (Edge or OpenAI based on voice ID)
  const serverBlob = await tryServerSynthesize(text, voiceId, options);

  if (isElevenLabsVoiceId(voiceId) || isHeyGenVoiceId(voiceId)) {
    // Pas de seuil « fichier suspect » ici : un mot lu par ElevenLabs pese
    // moins de 8 000 octets, et il n'y a de toute facon rien pour le
    // remplacer. La branche fournisseur a deja ecarte l'audio vide.
    if (serverBlob) return serverBlob;
    throw new Error(
      'Votre voix clonée n’a pas pu être synthétisée (service vocal indisponible ou voix non autorisée). '
      + 'Aucune voix de remplacement n’a été utilisée.',
    );
  }

  if (serverBlob && serverBlob.size >= 8000) return serverBlob;
  if (serverBlob) {
    console.warn('[TTS] Server returned suspiciously small blob:', serverBlob.size, 'bytes — trying fallback');
  }

  // 2. If the original was an Edge voice, try OpenAI as automatic fallback.
  //    (If the original was already an openai-* voice, no point retrying it.)
  const voice = TTS_VOICES.find((v) => v.id === voiceId);
  if (voice?.provider !== 'openai') {
    const openaiBlob = await tryOpenAiFallback(text, voiceId);
    if (openaiBlob && openaiBlob.size >= 8000) return openaiBlob;
  }

  // Both paths failed — throw so the caller surfaces a clear error.
  // We deliberately do NOT call `browserSynthesize` here; it produces a
  // silent blob that crashes playback (see docstring above).
  throw new Error(
    'Synthèse vocale indisponible — Edge TTS upstream a échoué et le fallback OpenAI n\'a pas réussi (vérifie que OPENAI_API_KEY est configuré côté serveur).'
  );
}

/**
 * Preview a voice with a short sample text.
 * Returns an audio URL that can be played.
 */
export async function previewVoice(voiceId: string): Promise<string> {
  const voice = TTS_VOICES.find((v) => v.id === voiceId);
  const sampleTexts: Record<string, string> = {
    FR: 'Bonjour, bienvenue sur Studiio.',
    EN: 'Hello, welcome to Studiio.',
    ES: 'Hola, bienvenido a Studiio.',
    PT: 'Ola, bem-vindo ao Studiio.',
    DE: 'Hallo, willkommen bei Studiio.',
  };

  const sampleText = sampleTexts[voice?.lang || 'FR'] || sampleTexts.FR;

  // For preview, try server first then browser fallback
  const serverBlob = await tryServerSynthesize(sampleText, voiceId);
  if (serverBlob) return URL.createObjectURL(serverBlob);

  // Browser fallback: speak live and return empty URL
  console.log('[TTS] Preview: using browser speech directly');
  if ('speechSynthesis' in window) {
    const synth = window.speechSynthesis;
    const langCode = VOICE_LANG_MAP[voice?.lang || 'FR'] || 'fr-FR';
    const utterance = new SpeechSynthesisUtterance(sampleText);
    utterance.lang = langCode;
    utterance.rate = 1.0;

    // Try to pick matching voice
    const voices = synth.getVoices();
    const match = voices.find((v) => v.lang.startsWith(langCode.split('-')[0]));
    if (match) utterance.voice = match;

    synth.speak(utterance);
    // Return a data URL of silence so the caller doesn't error
    return 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  }

  throw new Error('TTS unavailable — server timeout and no browser speech support');
}
