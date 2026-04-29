/**
 * Per-sequence voice-over state.
 *
 * Each video has 4 sequences (titre, cartes, video, cta) and each can have
 * its own voice-over: a recorded clip from the user's mic OR a TTS-synthesized
 * audio from msedge-tts. The `text` is auto-filled from the editor content
 * (title+subtitle for titre, cards for cartes, etc.) but the user can override
 * it freely — the `userEdited` flag prevents auto-fill from clobbering the
 * manual edits.
 *
 * Legacy: posts created before this feature ship have a single `audioVoiceUrl`
 * that plays in the background across the whole video. That field stays
 * supported in `creer/page.tsx` and `video-composer.ts` — `sequenceVoices`
 * is purely additive. PR A introduces the data shape only; PR B builds the
 * UI; PR C wires the composer to play each clip on its own sequence offset.
 */

export type SequenceKey = 'titre' | 'cartes' | 'video' | 'cta';

export type VoiceSource = 'tts' | 'record' | null;

export interface SequenceVoice {
  /** Editable text used for TTS synthesis (auto-filled from editor content). */
  text: string;
  /** Supabase public URL of the generated audio. null = no voice for this sequence. */
  audioUrl: string | null;
  /** How the audio was produced. `null` mirrors `audioUrl === null`. */
  source: VoiceSource;
  /** msedge-tts voice ID (e.g. `fr-FR-DeniseNeural`) when source is 'tts'. */
  ttsVoice?: string;
  /** Audio duration in seconds, populated after generation/recording so the UI
   *  can flag overruns vs the sequence's configured length. */
  duration?: number;
}

export type SequenceVoices = Record<SequenceKey, SequenceVoice>;

/** True flag = user has manually edited the text → auto-fill must NOT
 *  overwrite it. */
export type SequenceVoicesUserEdited = Record<SequenceKey, boolean>;

export const SEQUENCE_KEYS: SequenceKey[] = ['titre', 'cartes', 'video', 'cta'];

export function emptySequenceVoice(): SequenceVoice {
  return { text: '', audioUrl: null, source: null };
}

export function emptySequenceVoices(): SequenceVoices {
  return {
    titre: emptySequenceVoice(),
    cartes: emptySequenceVoice(),
    video: emptySequenceVoice(),
    cta: emptySequenceVoice(),
  };
}

export function emptySequenceVoicesUserEdited(): SequenceVoicesUserEdited {
  return { titre: false, cartes: false, video: false, cta: false };
}

/**
 * Build the auto-fill text for each sequence from the current editor content.
 * Returns a partial object keyed by sequence — the caller merges it with the
 * existing `sequenceVoices` and skips any key whose `userEdited[key]` is true.
 */
export function buildAutoFillText(input: {
  title?: string;
  subtitle?: string;
  cards: Array<{ label?: string; value?: string; description?: string }>;
  videoOverlayText?: string;
  ctaMainText?: string;
  ctaSubText?: string;
}): Record<SequenceKey, string> {
  const titre = [input.title, input.subtitle].filter((s) => s && s.trim().length > 0).join('. ').trim();

  const cartes = input.cards
    .map((c) => [c.label, c.description, c.value].filter((s) => s && String(s).trim().length > 0).join('. '))
    .filter((s) => s.length > 0)
    .join(' ')
    .trim();

  const video = (input.videoOverlayText || '').trim();

  const cta = [input.ctaMainText, input.ctaSubText].filter((s) => s && s.trim().length > 0).join('. ').trim();

  return { titre, cartes, video, cta };
}
