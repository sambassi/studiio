'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Sparkles, Loader2, Trash2, Play, Pause, AlertTriangle, Info } from 'lucide-react';
import { TTS_VOICES, synthesize } from '@/lib/tts/edge-tts-client';
import {
  SEQUENCE_KEYS,
  type SequenceKey,
  type SequenceVoice,
  type SequenceVoices,
  type SequenceVoicesUserEdited,
} from '@/lib/types/voice';

const VOICE_STORAGE_KEY = 'tts.voiceId';
const DEFAULT_VOICE_ID = 'fr-FR-DeniseNeural';

const SEQUENCE_LABELS: Record<SequenceKey, string> = {
  titre: 'Titre',
  cartes: 'Cartes',
  video: 'Vidéo',
  cta: 'CTA',
};

const SEQUENCE_ACCENT: Record<SequenceKey, string> = {
  titre: 'border-purple-500/40 bg-purple-500/[0.06]',
  cartes: 'border-pink-500/40 bg-pink-500/[0.06]',
  video: 'border-cyan-500/40 bg-cyan-500/[0.06]',
  cta: 'border-amber-500/40 bg-amber-500/[0.06]',
};

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Inline mini audio player — local to this panel so we don't have to
 *  refactor AudioStudioPanel's MiniPlayer.
 *
 *  Bug history: prior version silently swallowed every play() rejection
 *  (`.catch(() => setPlaying(false))`), so CORS / 404 / format errors
 *  produced a button that "did nothing" with no signal. Now we log the
 *  error and surface it via the optional onError callback so the parent
 *  can showToast() the user.
 */
function PreviewPlayer({
  src,
  onDelete,
  onError,
  label,
}: {
  src: string;
  onDelete: () => void;
  onError?: (msg: string) => void;
  label: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [errored, setErrored] = useState(false);

  const reportError = (where: string, detail: string) => {
    setErrored(true);
    setPlaying(false);
    const msg = `Voix ${label} : ${detail}`;
    console.error(`[VoicePreview:${where}]`, label, src, detail);
    onError?.(msg);
  };

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    setErrored(false);
    try {
      // Some browsers reject play() if the audio isn't loaded yet. load()
      // forces a fetch + decode pass before we attempt playback.
      if (el.readyState < 2) {
        try { el.load(); } catch { /* ignore */ }
      }
      console.log('[VoicePreview] play attempt:', label, src.substring(0, 80));
      await el.play();
      setPlaying(true);
      console.log('[VoicePreview] play OK:', label);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'lecture bloquée';
      reportError('play', errMsg);
    }
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnd = () => setPlaying(false);
    const onErr = () => {
      const code = el.error?.code;
      const detail = el.error?.message || `code ${code ?? '?'}`;
      reportError('media', detail);
    };
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onErr);
    return () => {
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onErr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Reset errored state when src changes (user generated a new voice)
  useEffect(() => { setErrored(false); }, [src]);

  return (
    <div className="flex items-center gap-2 rounded bg-gray-800/60 px-2 py-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={errored}
        className="rounded bg-purple-500/20 p-1.5 text-purple-300 hover:bg-purple-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <span className={`flex-1 truncate text-[10px] ${errored ? 'text-red-400' : 'text-gray-400'}`}>
        {errored ? 'Audio indisponible' : 'Audio prêt'}
      </span>
      <button
        type="button"
        onClick={onDelete}
        className="rounded bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20"
        aria-label="Supprimer l'audio"
      >
        <Trash2 size={12} />
      </button>
      {/* preload="auto" + crossOrigin help with Supabase Storage URLs;
          without crossOrigin some Chromium configs fail the CORS preflight
          even for plain playback. */}
      <audio ref={audioRef} src={src} preload="auto" crossOrigin="anonymous" />
    </div>
  );
}

interface Props {
  sequenceVoices: SequenceVoices;
  userEdited: SequenceVoicesUserEdited;
  onChange: (key: SequenceKey, patch: Partial<SequenceVoice>) => void;
  onUserEditedChange: (key: SequenceKey, edited: boolean) => void;
  onResetText: (key: SequenceKey) => void;
  introDuration: number;
  cardsDuration: number;
  videoDuration: number;
  ctaDuration: number;
  hasCardsContent: boolean;
  hasVideoOverlay: boolean;
  /** Batch count from the editor — when > 1, a banner explains how voices
   *  will be regenerated per iteration. */
  batchCount: number;
  /** Optional toast bridge so audio playback errors surface to the user
   *  instead of dying silently in the console. */
  onAudioError?: (message: string) => void;
}

export function SequenceVoicesPanel({
  sequenceVoices,
  userEdited,
  onChange,
  onUserEditedChange,
  onResetText,
  introDuration,
  cardsDuration,
  videoDuration,
  ctaDuration,
  hasCardsContent,
  hasVideoOverlay,
  batchCount,
  onAudioError,
}: Props) {
  // Shared TTS voice picker (one voice for all sequences in this panel —
  // simpler UX than per-sequence voice selectors). Persists in localStorage
  // so the choice survives a refresh.
  const [selectedTtsVoiceId, setSelectedTtsVoiceId] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_VOICE_ID;
    try {
      const saved = window.localStorage.getItem(VOICE_STORAGE_KEY);
      if (saved && TTS_VOICES.some((v) => v.id === saved)) return saved;
    } catch { /* ignore */ }
    return DEFAULT_VOICE_ID;
  });
  useEffect(() => {
    try { window.localStorage.setItem(VOICE_STORAGE_KEY, selectedTtsVoiceId); } catch { /* ignore */ }
  }, [selectedTtsVoiceId]);

  // Per-sequence loading + recording state
  const [busy, setBusy] = useState<Record<SequenceKey, boolean>>({ titre: false, cartes: false, video: false, cta: false });
  const [recording, setRecording] = useState<SequenceKey | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [generateAllBusy, setGenerateAllBusy] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);

  const sequenceDuration = useCallback((key: SequenceKey): number => {
    switch (key) {
      case 'titre': return introDuration;
      case 'cartes': return cardsDuration;
      case 'video': return videoDuration;
      case 'cta': return ctaDuration;
    }
  }, [introDuration, cardsDuration, videoDuration, ctaDuration]);

  /** Decide whether a given sequence is meaningful for this video. The
   *  "cartes" voice-over is hidden when the user has no card content;
   *  "video" is hidden when no overlay text — these are the same gating
   *  rules as the export pipeline. */
  const isSequenceRelevant = useCallback((key: SequenceKey): boolean => {
    if (key === 'cartes') return hasCardsContent;
    if (key === 'video') return hasVideoOverlay || sequenceDuration('video') > 0;
    return sequenceDuration(key) > 0;
  }, [hasCardsContent, hasVideoOverlay, sequenceDuration]);

  /** Upload an audio Blob to Supabase and return the public URL. Falls
   *  back to a local blob URL if the upload fails so the user still
   *  hears their recording in the preview. */
  const uploadAudioBlob = async (blob: Blob): Promise<{ url: string; isLocal: boolean }> => {
    const isWebm = blob.type.includes('webm');
    const ext = isWebm ? 'webm' : 'mp3';
    const contentType = isWebm ? 'audio/webm' : 'audio/mpeg';
    const filename = `voice-seq-${Date.now()}.${ext}`;
    try {
      const res = await fetch('/api/upload/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, contentType, purpose: 'voice' }),
      });
      const data = await res.json();
      if (data.success && data.signedUrl) {
        const upload = await fetch(data.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: blob,
        });
        if (upload.ok && data.publicUrl) {
          return { url: data.publicUrl, isLocal: false };
        }
      }
    } catch (err) {
      console.warn('[SequenceVoices] upload failed, falling back to blob URL:', err);
    }
    return { url: URL.createObjectURL(blob), isLocal: true };
  };

  /** Probe a Blob URL to read its duration. Used to populate
   *  `sequenceVoices[key].duration` so the UI can flag overruns. */
  const probeDuration = (url: string): Promise<number> => {
    return new Promise((resolve) => {
      const a = new Audio();
      a.preload = 'metadata';
      const onMeta = () => { resolve(a.duration || 0); cleanup(); };
      const onErr = () => { resolve(0); cleanup(); };
      const cleanup = () => {
        a.removeEventListener('loadedmetadata', onMeta);
        a.removeEventListener('error', onErr);
      };
      a.addEventListener('loadedmetadata', onMeta);
      a.addEventListener('error', onErr);
      a.src = url;
    });
  };

  /**
   * Generate a TTS clip for one sequence and persist it to Supabase Storage.
   *
   * Uses `synthesize()` from edge-tts-client which now (post-PR #132)
   * cascades: Edge TTS → OpenAI TTS → throw. The previous broken
   * `browserSynthesize` fallback was removed from `synthesize()` (it
   * produced silent ~1-5KB WebM that crashed playback with DEMUXER_ERROR).
   *
   * The chain here:
   *   1. synthesize() — Edge → OpenAI auto-fallback (50s timeout each)
   *   2. Validate size >= 8KB (defensive — synthesize already enforces it)
   *   3. POST /api/upload/signed-url + PUT blob → Supabase
   *   4. HEAD the publicUrl to verify the uploaded file is actually
   *      reachable before we store the URL in state. This catches bucket
   *      misconfiguration (private, MIME mismatch, quota) early.
   *   5. probeDuration to populate the overrun warning UI
   *   6. onChange — state is updated ONLY if every step above succeeded
   *
   * No silent fallback: any failure surfaces via onAudioError → red toast.
   * The output is always MP3 (Edge or OpenAI both return MP3).
   */
  const generateTts = async (key: SequenceKey) => {
    const text = sequenceVoices[key].text.trim();
    if (!text) return;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      // Step 1: TTS via synthesize() (Edge → OpenAI fallback chain)
      const audioBlob = await synthesize(text, selectedTtsVoiceId);
      console.log(`[SequenceVoices] TTS ${key} | size: ${audioBlob.size} bytes | type: ${audioBlob.type}`);
      // 8KB ≈ 0.7s of MP3 @96kbps — defensive (synthesize enforces this internally)
      if (audioBlob.size < 8000) {
        throw new Error(`Audio TTS trop petit (${audioBlob.size} octets, minimum 8000) — réessaie ou choisis une autre voix`);
      }

      // Step 2: Upload to Supabase via signed URL
      const filename = `tts-seq-${key}-${Date.now()}.mp3`;
      const signRes = await fetch('/api/upload/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, contentType: 'audio/mpeg', purpose: 'voice' }),
      });
      const signData = await signRes.json();
      if (!signRes.ok || !signData.success || !signData.signedUrl || !signData.publicUrl) {
        throw new Error(`Signed URL : ${signData.error || signRes.status}`);
      }
      const putRes = await fetch(signData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'audio/mpeg' },
        body: audioBlob,
      });
      if (!putRes.ok) {
        throw new Error(`Upload Supabase : HTTP ${putRes.status}`);
      }

      // Step 3: HEAD verify before storing the URL
      const headRes = await fetch(signData.publicUrl, { method: 'HEAD' });
      if (!headRes.ok) {
        throw new Error(`Fichier uploadé inaccessible : HEAD HTTP ${headRes.status} (bucket privé ou non configuré ?)`);
      }
      const cl = headRes.headers.get('content-length');
      if (cl && Number(cl) < 8000) {
        throw new Error(`Fichier uploadé trop petit (${cl} octets) — Supabase a peut-être tronqué l'upload`);
      }

      // Step 4: probe duration + persist
      const duration = await probeDuration(signData.publicUrl);
      console.log(`[SequenceVoices] TTS ${key} ready: ${signData.publicUrl} (${duration.toFixed(2)}s)`);
      onChange(key, {
        audioUrl: signData.publicUrl,
        source: 'tts',
        ttsVoice: selectedTtsVoiceId,
        duration,
      });
    } catch (err) {
      console.error('[SequenceVoices] TTS error for', key, err);
      const msg = err instanceof Error ? err.message : 'erreur inconnue';
      onAudioError?.(`Synthèse vocale ${SEQUENCE_LABELS[key]} : ${msg}`);
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const generateAllTts = async () => {
    setGenerateAllBusy(true);
    try {
      // Sequential rather than parallel so the user sees per-sequence
      // progress and we don't hammer the TTS endpoint.
      for (const key of SEQUENCE_KEYS) {
        if (!isSequenceRelevant(key)) continue;
        if (!sequenceVoices[key].text.trim()) continue;
        await generateTts(key);
      }
    } finally {
      setGenerateAllBusy(false);
    }
  };

  const startRecording = async (key: SequenceKey) => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recordChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(recordChunksRef.current, { type: 'audio/webm' });
        recordChunksRef.current = [];
        // Stop the mic stream so the recording indicator disappears
        stream.getTracks().forEach((t) => t.stop());
        if (blob.size < 200) {
          console.warn('[SequenceVoices] Recording too short for', key);
          return;
        }
        setBusy((b) => ({ ...b, [key]: true }));
        try {
          const { url } = await uploadAudioBlob(blob);
          const duration = await probeDuration(url);
          onChange(key, { audioUrl: url, source: 'record', ttsVoice: undefined, duration });
        } finally {
          setBusy((b) => ({ ...b, [key]: false }));
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(key);
      setRecordingTime(0);
      recordTimerRef.current = window.setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch (err) {
      console.error('[SequenceVoices] Mic access denied:', err);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(null);
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setRecordingTime(0);
  };

  const removeAudio = (key: SequenceKey) => {
    onChange(key, { audioUrl: null, source: null, ttsVoice: undefined, duration: undefined });
  };

  const handleTextChange = (key: SequenceKey, value: string) => {
    onChange(key, { text: value });
    if (!userEdited[key]) onUserEditedChange(key, true);
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <Mic size={14} className="text-purple-400" />
            Voix-off par séquence
          </h3>
          <p className="mt-0.5 text-[10px] text-gray-400">
            Une voix-off indépendante pour chaque séquence. Texte auto-rempli depuis le contenu — modifiable.
          </p>
        </div>
      </div>

      {/* Shared TTS voice + Generate all */}
      <div className="flex flex-wrap items-center gap-2 rounded bg-gray-800/40 px-2 py-2">
        <label className="text-[10px] text-gray-400">Voix TTS</label>
        <select
          value={selectedTtsVoiceId}
          onChange={(e) => setSelectedTtsVoiceId(e.target.value)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-white focus:border-purple-500 focus:outline-none"
        >
          {TTS_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.flag} {v.name} ({v.lang})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={generateAllTts}
          disabled={generateAllBusy}
          className="ml-auto flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generateAllBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          Générer toutes les voix TTS
        </button>
      </div>

      {batchCount > 1 && (
        <div className="flex items-start gap-1.5 rounded bg-blue-500/10 px-2 py-1.5 text-[10px] text-blue-300">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            Mode batch ×{batchCount} — la voix TTS sélectionnée s'applique aux {batchCount} vidéos.
            Les textes seront re-générés depuis le contenu propre à chaque itération.
          </span>
        </div>
      )}

      {/* Per-sequence cards */}
      <div className="space-y-2">
        {SEQUENCE_KEYS.map((key) => {
          if (!isSequenceRelevant(key)) return null;
          const sv = sequenceVoices[key];
          const seqDur = sequenceDuration(key);
          const audioDur = sv.duration ?? 0;
          const overrun = sv.audioUrl && audioDur > seqDur + 0.3; // 300ms tolerance
          const isRecordingThis = recording === key;
          const isBusy = busy[key];

          return (
            <div key={key} className={`rounded-md border p-2 ${SEQUENCE_ACCENT[key]}`}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white">{SEQUENCE_LABELS[key]}</span>
                <span className={`text-[10px] ${overrun ? 'text-orange-300' : 'text-gray-400'}`}>
                  {seqDur}s {sv.audioUrl && `/ ${audioDur.toFixed(1)}s audio`}
                </span>
              </div>

              {overrun && (
                <div className="mb-1.5 flex items-start gap-1 rounded bg-orange-500/10 px-1.5 py-1 text-[10px] text-orange-300">
                  <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" />
                  <span>L'audio dépasse la durée de la séquence — raccourcir le texte ou allonger la séquence.</span>
                </div>
              )}

              <textarea
                value={sv.text}
                onChange={(e) => handleTextChange(key, e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Texte de la voix-off…"
                className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />

              <div className="mt-1.5 flex items-center gap-1.5">
                {!isRecordingThis ? (
                  <button
                    type="button"
                    onClick={() => startRecording(key)}
                    disabled={!!recording || isBusy}
                    className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Enregistrer au micro"
                  >
                    <Mic size={11} /> Enregistrer
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-[11px] text-white hover:bg-red-700"
                  >
                    <Square size={11} /> Stop ({formatTime(recordingTime)})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => generateTts(key)}
                  disabled={isBusy || !sv.text.trim() || isRecordingThis}
                  className="flex items-center gap-1 rounded bg-purple-600/80 px-2 py-1 text-[11px] text-white hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Synthétiser avec la voix TTS sélectionnée"
                >
                  {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  TTS
                </button>
                {userEdited[key] && (
                  <button
                    type="button"
                    onClick={() => onResetText(key)}
                    className="ml-auto text-[10px] text-gray-500 hover:text-gray-300"
                    title="Réinitialiser le texte depuis le contenu de l'éditeur"
                  >
                    ↺ auto
                  </button>
                )}
              </div>

              {sv.audioUrl && (
                <div className="mt-1.5">
                  <PreviewPlayer
                    src={sv.audioUrl}
                    label={SEQUENCE_LABELS[key]}
                    onDelete={() => removeAudio(key)}
                    onError={onAudioError}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
