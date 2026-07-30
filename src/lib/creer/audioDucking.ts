/**
 * Audio ducking helpers — keyframe types and the auto-duck analyzer.
 *
 * The analyzer fetches a rush video's audio track, decodes it via Web
 * Audio, slides a 500 ms window across the samples, computes RMS (root
 * mean square) of each chunk, and emits a keyframe list with music set
 * LOUD where the rush is silent and SOFT where the rush has voice /
 * sound above a configurable threshold. A minimum-duration "hold" keeps
 * us from flip-flopping gain on every micro-pause.
 */

export interface AudioKeyframe {
  id: string;
  time: number;         // seconds from the start of the final montage
  musicVolume: number;  // 0-1
  rushVolume: number;   // 0-1
  /**
   * Voice-off volume 0-1 (legacy `voiceUrl` + per-sequence voices share
   * this gain bus). Optional for backwards-compat with old saved keyframes
   * — when undefined, the composer treats it as 1.0 (full volume) so old
   * posts keep their voice intact.
   */
  voiceVolume?: number; // 0-1
}

/** dBFS threshold that marks a chunk as "speech/audio present". */
const SPEECH_THRESHOLD_DB = -40;
/** Chunk duration in seconds. 500 ms gives a responsive-but-stable curve. */
const CHUNK_DURATION_S = 0.5;

/** Music volume applied while rush is speaking ("ducked down"). */
const DUCKED_MUSIC = 0.25;
/** Music volume while rush is silent. */
const UNDUCKED_MUSIC = 1.0;
/** Rush volume while speaking — full. */
const SPEECH_RUSH = 1.0;
/** Rush volume during silence — still audible so ambient sound stays. */
const SILENCE_RUSH = 0.5;

function rms(samples: Float32Array, start: number, length: number): number {
  let sum = 0;
  const end = Math.min(samples.length, start + length);
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (end - start));
}

function linearToDb(v: number): number {
  if (v <= 1e-6) return -120;
  return 20 * Math.log10(v);
}

/**
 * Fetch a rush video's audio, detect speech chunks, and return a
 * keyframe list that ducks music whenever the rush has voice.
 *
 * Throws if the audio can't be decoded or the URL is unreachable.
 */
export async function analyseRushForDucking(rushUrl: string): Promise<AudioKeyframe[]> {
  const res = await fetch(rushUrl);
  if (!res.ok) throw new Error(`rush fetch ${res.status}`);
  const buf = await res.arrayBuffer();

  // Web Audio's OfflineAudioContext decodes without starting playback.
  const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const decodeCtx = new AudioCtx();
  const audioBuf = await decodeCtx.decodeAudioData(buf.slice(0));
  decodeCtx.close().catch(() => { /* ignore */ });

  const samples = audioBuf.getChannelData(0); // left channel is enough for RMS
  const sampleRate = audioBuf.sampleRate;
  const chunkSamples = Math.floor(sampleRate * CHUNK_DURATION_S);
  const totalChunks = Math.ceil(samples.length / chunkSamples);

  // Build a boolean mask: true = speech in this chunk.
  const speech: boolean[] = new Array(totalChunks);
  for (let i = 0; i < totalChunks; i++) {
    const r = rms(samples, i * chunkSamples, chunkSamples);
    speech[i] = linearToDb(r) > SPEECH_THRESHOLD_DB;
  }

  // Walk the mask and emit a keyframe at every state transition.
  const keyframes: AudioKeyframe[] = [];
  let prevSpeech: boolean | null = null;
  for (let i = 0; i < speech.length; i++) {
    const curr = speech[i];
    if (curr === prevSpeech) continue;
    const time = i * CHUNK_DURATION_S;
    keyframes.push({
      id: `auto-${Math.round(time * 100)}`,
      time: Math.max(0, time),
      musicVolume: curr ? DUCKED_MUSIC : UNDUCKED_MUSIC,
      rushVolume: curr ? SPEECH_RUSH : SILENCE_RUSH,
      voiceVolume: 1.0, // voice-off stays full by default — user can duck manually
    });
    prevSpeech = curr;
  }

  // Always anchor an opening keyframe at t=0 so the curve is defined from
  // frame one, even if the first sampled chunk matches the default state.
  if (keyframes.length === 0 || keyframes[0].time > 0) {
    keyframes.unshift({
      id: 'auto-0',
      time: 0,
      musicVolume: speech[0] ? DUCKED_MUSIC : UNDUCKED_MUSIC,
      rushVolume: speech[0] ? SPEECH_RUSH : SILENCE_RUSH,
      voiceVolume: 1.0,
    });
  }

  return keyframes;
}

/**
 * Intervalle parle, en secondes depuis le debut de la piste analysee.
 */
export interface SpeechSegment {
  start: number;
  end: number;
}

/**
 * Convertit un masque « ca parle / ca ne parle pas » en intervalles.
 *
 * Fonction PURE, et c'est voulu : c'est la seule partie de la detection
 * qu'on peut verifier sans decoder un vrai fichier audio. Le decodage,
 * lui, appartient au navigateur.
 */
export function maskToSegments(mask: boolean[], chunkDuration: number): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  let start: number | null = null;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && start === null) start = i * chunkDuration;
    if (!mask[i] && start !== null) {
      out.push({ start, end: i * chunkDuration });
      start = null;
    }
  }
  // Un dernier segment encore ouvert court jusqu'a la fin de la piste.
  if (start !== null) out.push({ start, end: mask.length * chunkDuration });
  return out;
}

/**
 * Ou la voix off parle-t-elle ?
 *
 * Meme mesure que pour le rush — RMS sur des tranches de 500 ms, seuil a
 * -40 dBFS — mais la sortie n'est PAS une liste de keyframes : ce sont des
 * intervalles. La difference compte : le ducking de la voix doit pouvoir se
 * combiner a celui du rush sans que l'un ecrase la courbe de l'autre.
 *
 * ⚠️ Les temps sont ceux de la piste, et le compositeur demarre la voix off
 * a t=0 du montage (`voiceBufferSource.start(audioStartTime)`,
 * video-composer.ts). Ils sont donc deja en temps de montage — contrairement
 * au rush, qu'il faut decaler de `videoSeqStart`.
 */
export async function detectVoiceSpeech(voiceUrl: string): Promise<SpeechSegment[]> {
  const res = await fetch(voiceUrl);
  if (!res.ok) throw new Error(`voice fetch ${res.status}`);
  const buf = await res.arrayBuffer();

  const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const decodeCtx = new AudioCtx();
  const audioBuf = await decodeCtx.decodeAudioData(buf.slice(0));
  decodeCtx.close().catch(() => { /* ignore */ });

  const samples = audioBuf.getChannelData(0);
  const chunkSamples = Math.floor(audioBuf.sampleRate * CHUNK_DURATION_S);
  const totalChunks = Math.ceil(samples.length / chunkSamples);

  const mask: boolean[] = new Array(totalChunks);
  for (let i = 0; i < totalChunks; i++) {
    mask[i] = linearToDb(rms(samples, i * chunkSamples, chunkSamples)) > SPEECH_THRESHOLD_DB;
  }
  return maskToSegments(mask, CHUNK_DURATION_S);
}

/**
 * Baisse la musique pendant que la voix off parle, PAR-DESSUS une courbe
 * existante.
 *
 * Fonction PURE, appliquee APRES l'auto-mix du rush : celui-ci n'est pas
 * modifie d'une ligne, et sa courbe reste intacte partout ou la voix se
 * tait. La ou elle parle, la musique descend — sans jamais REMONTER un
 * passage que le rush avait deja baisse, d'ou le `Math.min`.
 *
 * `rushVolume` et `voiceVolume` sont herites du keyframe precedent : ce
 * sont deux reglages que la voix n'a aucune raison de toucher.
 */
export function applyVoiceDucking(
  keyframes: AudioKeyframe[],
  segments: SpeechSegment[],
  options: { duckedMusic?: number; totalDuration?: number } = {},
): AudioKeyframe[] {
  if (segments.length === 0) return keyframes;
  const ducked = options.duckedMusic ?? DUCKED_MUSIC;
  const limit = options.totalDuration ?? Infinity;

  const base = [...keyframes].sort((a, b) => a.time - b.time);
  /** Niveaux de la courbe existante juste avant `t`. */
  const at = (t: number): AudioKeyframe => {
    let picked = base[0];
    for (const k of base) {
      if (k.time <= t) picked = k;
      else break;
    }
    return picked ?? { id: 'v-0', time: 0, musicVolume: 1, rushVolume: 0.5, voiceVolume: 1 };
  };

  // Un keyframe a chaque bord de segment : entree = musique baissee,
  // sortie = retour a ce que la courbe disait a cet instant.
  const marks: AudioKeyframe[] = [];
  segments.forEach((seg, i) => {
    if (seg.start >= limit) return;
    const inside = at(seg.start);
    marks.push({
      id: `voice-duck-in-${i}`,
      time: seg.start,
      // Jamais plus fort que ce que le rush avait deja impose.
      musicVolume: Math.min(inside.musicVolume, ducked * (base[0]?.musicVolume ?? 1)),
      rushVolume: inside.rushVolume,
      voiceVolume: inside.voiceVolume ?? 1,
    });
    const end = Math.min(seg.end, limit);
    if (end > seg.start && end < limit) {
      const outside = at(end);
      marks.push({
        id: `voice-duck-out-${i}`,
        time: end,
        musicVolume: outside.musicVolume,
        rushVolume: outside.rushVolume,
        voiceVolume: outside.voiceVolume ?? 1,
      });
    }
  });

  // Fusion : les bords de la voix s'ajoutent, et un keyframe existant qui
  // tombe DANS un segment parle est baisse a son tour — sans quoi la
  // musique remonterait au milieu d'une phrase.
  const insideSegment = (t: number) => segments.some((s) => t >= s.start && t < s.end);
  const adjusted = base.map((k) =>
    insideSegment(k.time)
      ? { ...k, musicVolume: Math.min(k.musicVolume, ducked * (base[0]?.musicVolume ?? 1)) }
      : k,
  );

  const merged = [...adjusted, ...marks].sort((a, b) => a.time - b.time);
  // Deux keyframes au meme instant : le dernier pose gagne, comme le ferait
  // le compositeur en echantillonnant.
  const out: AudioKeyframe[] = [];
  for (const k of merged) {
    if (out.length > 0 && Math.abs(out[out.length - 1].time - k.time) < 1e-6) out.pop();
    out.push(k);
  }
  return out;
}

/**
 * Resolve the music + rush volumes at a given absolute second. Returns
 * the nearest PRIOR keyframe (stepped curve) so callers don't need to
 * reason about interpolation. Called by the composer on every frame.
 */
export function sampleKeyframes(
  keyframes: AudioKeyframe[],
  t: number,
): { musicVolume: number; rushVolume: number; voiceVolume: number } {
  if (keyframes.length === 0) return { musicVolume: 1, rushVolume: 0.5, voiceVolume: 1 };
  let picked = keyframes[0];
  for (const kf of keyframes) {
    if (kf.time <= t) picked = kf;
    else break;
  }
  return {
    musicVolume: picked.musicVolume,
    rushVolume: picked.rushVolume,
    voiceVolume: picked.voiceVolume ?? 1,
  };
}
