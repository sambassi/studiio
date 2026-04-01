/**
 * TTS Client — Server API with browser SpeechSynthesis fallback.
 * Tries server-side Edge TTS first, falls back to browser voices if server fails.
 */

export interface TtsVoice {
  id: string;
  name: string;
  lang: string;
  gender: 'Female' | 'Male';
  flag: string;
}

export const TTS_VOICES: TtsVoice[] = [
  // Francais
  { id: 'fr-FR-DeniseNeural', name: 'Denise', lang: 'FR', gender: 'Female', flag: '\u{1F1EB}\u{1F1F7}' },
  { id: 'fr-FR-HenriNeural', name: 'Henri', lang: 'FR', gender: 'Male', flag: '\u{1F1EB}\u{1F1F7}' },
  { id: 'fr-FR-CoralieMultilingualNeural', name: 'Coralie', lang: 'FR', gender: 'Female', flag: '\u{1F1EB}\u{1F1F7}' },
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
 * Browser-based TTS using Web Speech API (SpeechSynthesis).
 * Records the audio output via MediaRecorder for use in video composition.
 */
async function browserSynthesize(
  text: string,
  voiceId: string,
): Promise<Blob> {
  console.log('[TTS] Using browser SpeechSynthesis fallback');

  // Determine language from voice ID
  const voice = TTS_VOICES.find((v) => v.id === voiceId);
  const langCode = VOICE_LANG_MAP[voice?.lang || 'FR'] || 'fr-FR';
  const gender = voice?.gender || 'Female';

  return new Promise<Blob>((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('SpeechSynthesis not supported in this browser'));
      return;
    }

    const synth = window.speechSynthesis;

    // Wait for voices to load (they load async in some browsers)
    const getVoices = (): Promise<SpeechSynthesisVoice[]> => {
      return new Promise((res) => {
        const voices = synth.getVoices();
        if (voices.length > 0) {
          res(voices);
          return;
        }
        synth.onvoiceschanged = () => res(synth.getVoices());
        // Timeout after 2s
        setTimeout(() => res(synth.getVoices()), 2000);
      });
    };

    getVoices().then((voices) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langCode;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // Try to find a matching voice
      const matchingVoice = voices.find(
        (v) => v.lang.startsWith(langCode.split('-')[0]) &&
          (gender === 'Female' ? !v.name.toLowerCase().includes('male') : v.name.toLowerCase().includes('male'))
      ) || voices.find((v) => v.lang.startsWith(langCode.split('-')[0])) || voices[0];

      if (matchingVoice) {
        utterance.voice = matchingVoice;
        console.log('[TTS] Using browser voice:', matchingVoice.name, matchingVoice.lang);
      }

      // Use AudioContext + MediaRecorder to capture the audio
      try {
        const audioCtx = new AudioContext();
        const dest = audioCtx.createMediaStreamDestination();
        const oscillator = audioCtx.createOscillator();
        oscillator.connect(dest);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.001); // Tiny blip to init stream

        const recorder = new MediaRecorder(dest.stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm',
        });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          audioCtx.close();
          const blob = new Blob(chunks, { type: 'audio/webm' });
          console.log('[TTS] Browser audio captured:', (blob.size / 1024).toFixed(1), 'KB');
          resolve(blob);
        };

        // Start recording just before speech
        recorder.start();

        utterance.onend = () => {
          // Small delay to capture trailing audio
          setTimeout(() => recorder.stop(), 200);
        };

        utterance.onerror = (event) => {
          recorder.stop();
          audioCtx.close();
          reject(new Error(`SpeechSynthesis error: ${event.error}`));
        };

        // Timeout safety
        const timeout = setTimeout(() => {
          synth.cancel();
          if (recorder.state === 'recording') recorder.stop();
          audioCtx.close();
          reject(new Error('Browser TTS timed out after 30s'));
        }, 30000);

        utterance.onend = () => {
          clearTimeout(timeout);
          setTimeout(() => recorder.stop(), 200);
        };

        synth.speak(utterance);
      } catch {
        // If MediaRecorder capture fails, just speak without recording
        // and return an empty blob (the voice will still be heard live)
        utterance.onend = () => {
          // Return empty blob — the user heard the voice live
          resolve(new Blob([], { type: 'audio/webm' }));
        };
        utterance.onerror = (event) => {
          reject(new Error(`SpeechSynthesis error: ${event.error}`));
        };
        synth.speak(utterance);
      }
    });
  });
}

/**
 * Synthesize text to speech.
 * Tries server-side Edge TTS first, falls back to browser SpeechSynthesis.
 * Returns an audio Blob.
 */
export async function synthesize(
  text: string,
  voiceId: string,
  options?: { rate?: string; pitch?: string },
): Promise<Blob> {
  // Try server first
  const serverBlob = await tryServerSynthesize(text, voiceId, options);
  if (serverBlob) return serverBlob;

  // Fallback to browser TTS
  console.log('[TTS] Server failed, falling back to browser SpeechSynthesis');
  return browserSynthesize(text, voiceId);
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
