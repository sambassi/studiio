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

// ── Voix HeyGen (voix clonee de l'utilisateur) ────────────────────────────
//
// Les voix HeyGen ne sont PAS codees en dur : elles sont listees a la volee
// par `GET /api/tts/heygen`, qui interroge `GET /v3/voices?engine=starfish`
// cote serveur (la cle API ne quitte jamais le serveur). La voix clonee du
// compte apparait donc toute seule dans le selecteur, sans rien redeployer.
//
// Convention d'identifiant : `heygen-<voice_id>`. C'est ce prefixe — et lui
// seul — qui route la synthese vers /api/tts/heygen dans edge-tts-client.

/** Prefixe des identifiants de voix HeyGen cote Studiio. */
export const HEYGEN_VOICE_PREFIX = 'heygen-';

/** Une voix HeyGen exploitable en TTS, au format attendu par le selecteur. */
export interface HeyGenTtsVoice {
  /** Identifiant prefixe (`heygen-...`) — c'est lui qui route la synthese. */
  id: string;
  name: string;
  /** Code langue court utilise par le selecteur (FR, EN, ES...). */
  lang: string;
  gender: 'Female' | 'Male';
  flag: string;
  provider: 'heygen';
  /** true = voix privee du compte, c'est-a-dire une voix clonee. */
  cloned: boolean;
}

/** true si cet identifiant de voix doit passer par HeyGen. */
export function isHeyGenVoiceId(voiceId: string | undefined | null): boolean {
  return typeof voiceId === 'string' && voiceId.startsWith(HEYGEN_VOICE_PREFIX);
}

/**
 * Voix HeyGen du compte, pour alimenter le selecteur.
 *
 * Ne leve jamais : HeyGen est optionnel (cle absente, quota, panne). En cas
 * d'echec on renvoie une liste vide et le selecteur garde les voix Edge et
 * OpenAI — aucune regression possible pour un compte sans HeyGen.
 */
export async function fetchHeyGenVoices(): Promise<HeyGenTtsVoice[]> {
  try {
    const res = await fetch('/api/tts/heygen', { method: 'GET' });
    if (!res.ok) return [];
    const data = (await res.json()) as { voices?: HeyGenTtsVoice[] };
    return Array.isArray(data?.voices) ? data.voices : [];
  } catch {
    return [];
  }
}

// ── Voix ElevenLabs ───────────────────────────────────────────────────────
//
// Meme principe que HeyGen : les voix sont listees a la volee par
// `GET /api/tts/elevenlabs` (la cle ne quitte jamais le serveur) et l'id porte
// un prefixe qui, seul, route la synthese vers /api/tts/elevenlabs.

/** Prefixe des identifiants de voix ElevenLabs cote Studiio. */
export const ELEVENLABS_VOICE_PREFIX = 'elevenlabs-';

/** Une voix ElevenLabs exploitable en TTS, au format attendu par le selecteur. */
export interface ElevenLabsTtsVoice {
  /** Identifiant prefixe (`elevenlabs-...`) — c'est lui qui route la synthese. */
  id: string;
  name: string;
  lang: string;
  gender: 'Female' | 'Male';
  flag: string;
  provider: 'elevenlabs';
  /** true = voix clonee, par opposition au catalogue. */
  cloned: boolean;
}

/** true si cet identifiant de voix doit passer par ElevenLabs. */
export function isElevenLabsVoiceId(voiceId: string | undefined | null): boolean {
  return typeof voiceId === 'string' && voiceId.startsWith(ELEVENLABS_VOICE_PREFIX);
}

/** Drapeau du code langue court, ou un micro quand la langue est inconnue. */
const ELEVENLABS_LANG_FLAGS: Record<string, string> = {
  FR: '\u{1F1EB}\u{1F1F7}',
  EN: '\u{1F1FA}\u{1F1F8}',
  ES: '\u{1F1EA}\u{1F1F8}',
  PT: '\u{1F1E7}\u{1F1F7}',
  DE: '\u{1F1E9}\u{1F1EA}',
  IT: '\u{1F1EE}\u{1F1F9}',
  NL: '\u{1F1F3}\u{1F1F1}',
};

/** Libelle ElevenLabs ("french", "fr-FR") → code court du selecteur ("FR"). */
const ELEVENLABS_LANG_CODES: Record<string, string> = {
  french: 'FR',
  english: 'EN',
  spanish: 'ES',
  portuguese: 'PT',
  german: 'DE',
  italian: 'IT',
  dutch: 'NL',
};

/**
 * Une voix brute d'ElevenLabs, mise a la forme du selecteur.
 *
 * Vit ici et non dans `route.ts` : un fichier de route Next ne doit exporter
 * que ses handlers et sa config. C'est aussi ce qui la rend verifiable sur des
 * valeurs — la forme des `labels` varie d'une voix a l'autre, certaines n'en
 * ont aucun, et une lecture du source ne prouverait rien de tout cela.
 */
export function mapElevenLabsVoice(
  raw: Record<string, unknown> | null | undefined,
): ElevenLabsTtsVoice | null {
  if (!raw) return null;
  const voiceId = String(raw.voice_id ?? '').trim();
  if (!voiceId) return null;
  const labels = (raw.labels ?? {}) as Record<string, unknown>;
  const brut = String(labels.language ?? '').trim();
  const lang = !brut
    ? 'EN'
    : ELEVENLABS_LANG_CODES[brut.toLowerCase()] ?? brut.slice(0, 2).toUpperCase();
  const gender = String(labels.gender ?? '').toLowerCase() === 'male' ? 'Male' : 'Female';
  const category = String(raw.category ?? '');
  // `professional` designe une voix clonee en haute fidelite : elle appartient
  // a quelqu'un, au meme titre qu'une voix `cloned`.
  const cloned = category === 'cloned' || category === 'professional';
  const baseName = String(raw.name ?? '').trim() || 'Voix';
  return {
    id: `${ELEVENLABS_VOICE_PREFIX}${voiceId}`,
    name: cloned ? `${baseName} (ma voix)` : `${baseName} (ElevenLabs)`,
    lang,
    gender,
    flag: ELEVENLABS_LANG_FLAGS[lang] ?? '\u{1F3A4}',
    provider: 'elevenlabs',
    cloned,
  };
}

/**
 * Voix ElevenLabs du compte, pour alimenter le selecteur.
 *
 * Ne leve jamais, pour la meme raison que son equivalent HeyGen : le
 * fournisseur est optionnel, et son absence ne doit rien retirer au selecteur.
 */
export async function fetchElevenLabsVoices(): Promise<ElevenLabsTtsVoice[]> {
  try {
    const res = await fetch('/api/tts/elevenlabs', { method: 'GET' });
    if (!res.ok) return [];
    const data = (await res.json()) as { voices?: ElevenLabsTtsVoice[] };
    return Array.isArray(data?.voices) ? data.voices : [];
  } catch {
    return [];
  }
}

/**
 * Toutes les voix listees a la volee — HeyGen puis ElevenLabs.
 *
 * Un seul point d'entree pour les selecteurs : ajouter un fournisseur ici le
 * rend disponible partout, alors que deux panneaux qui appelleraient chacun
 * leurs fournisseurs finiraient par ne pas proposer les memes voix.
 *
 * `Promise.all` et non une sequence : les deux appels sont independants, et le
 * selecteur ne doit pas attendre la somme des deux latences. Ni l'un ni
 * l'autre ne rejette — un fournisseur en panne rend simplement une liste vide.
 */
export async function fetchCustomVoices(): Promise<Array<HeyGenTtsVoice | ElevenLabsTtsVoice>> {
  const [heygen, elevenlabs] = await Promise.all([
    fetchHeyGenVoices(),
    fetchElevenLabsVoices(),
  ]);
  return [...heygen, ...elevenlabs];
}

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
