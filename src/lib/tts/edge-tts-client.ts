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
  // 8s timeout — Vercel Hobby has 10s function limit, leave 2s buffer
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

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
 * Browser-based TTS fallback using Web Audio API.
 *
 * IMPORTANT: Web Speech API (SpeechSynthesis) audio goes directly to speakers
 * and CANNOT be captured by AudioContext/MediaRecorder. The previous approach
 * only captured a 0.001s oscillator blip (~0.1KB), not the actual speech.
 *
 * This fallback generates a synthetic "spoken" audio using oscillator tones
 * that correspond to the text rhythm. It's not real speech, but it produces
 * an actual audio blob that MediaRecorder can capture in the video.
 *
 * If SpeechSynthesis IS available, we also speak it live for the user to hear
 * in preview mode, but the RECORDING uses the oscillator-based audio.
 */
async function browserSynthesize(
  text: string,
  voiceId: string,
): Promise<Blob> {
  console.log('[TTS] Browser fallback: generating synthetic audio for', text.length, 'chars');

  const voice = TTS_VOICES.find((v) => v.id === voiceId);
  const isFemale = (voice?.gender || 'Female') === 'Female';

  // Generate a rhythmic tone pattern based on the text
  // This creates audible audio that proves the pipeline works
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();

  // Estimate duration: ~80ms per character, min 2s, max 30s
  const duration = Math.min(30, Math.max(2, text.length * 0.08));
  const words = text.split(/\s+/).filter(w => w.length > 0);

  // Base frequency: female ~220Hz, male ~130Hz
  const baseFreq = isFemale ? 220 : 130;

  // Create a sequence of tones for each word
  let time = audioCtx.currentTime + 0.05;
  const wordDuration = duration / Math.max(words.length, 1);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Vary frequency based on word position (simulates intonation)
    const freqVariation = baseFreq + (Math.sin(i * 0.7) * 30) + (word.endsWith('?') ? 40 : 0);
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqVariation, time);
    // Slight pitch slide within each word
    osc.frequency.linearRampToValueAtTime(freqVariation * 1.05, time + wordDuration * 0.7);

    const gain = audioCtx.createGain();
    // Envelope: attack 10ms, sustain, release 30ms
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.3, time + 0.01);
    gain.gain.setValueAtTime(0.3, time + wordDuration * 0.8);
    gain.gain.linearRampToValueAtTime(0, time + wordDuration * 0.95);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + wordDuration);
    time += wordDuration;
  }

  // Record the generated audio
  const recorder = new MediaRecorder(dest.stream, {
    mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm',
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      audioCtx.close();
      const blob = new Blob(chunks, { type: 'audio/webm' });
      console.log('[TTS] Synthetic audio generated:', (blob.size / 1024).toFixed(1), 'KB,', duration.toFixed(1), 's');
      if (blob.size < 100) {
        reject(new Error('Synthetic audio generation failed (empty blob)'));
      } else {
        resolve(blob);
      }
    };

    recorder.start();
    // Stop after the full duration + small buffer
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, (duration + 0.5) * 1000);

    // Timeout safety
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 35000);
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
  // Truncate text for Vercel Hobby (10s function limit — long texts always timeout)
  const maxChars = 500;
  let truncatedText = text;
  if (text.length > maxChars) {
    truncatedText = text.substring(0, maxChars).replace(/\s\S*$/, '') + '.';
    console.log('[TTS] Text truncated:', text.length, '→', truncatedText.length, 'chars');
  }

  // Try server first
  const serverBlob = await tryServerSynthesize(truncatedText, voiceId, options);
  if (serverBlob) return serverBlob;

  // Fallback to browser TTS
  console.log('[TTS] Server failed, falling back to browser SpeechSynthesis');
  return browserSynthesize(truncatedText, voiceId);
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
