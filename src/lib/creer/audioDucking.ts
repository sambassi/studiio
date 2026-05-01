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
