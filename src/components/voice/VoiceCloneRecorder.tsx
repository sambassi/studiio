'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, Loader2, Trash2, AlertTriangle, Check } from 'lucide-react';
import {
  pickRecorderMimeType,
  formatDuration,
  recordingAdvice,
  recordingQuality,
  micErrorMessage,
  MIN_RECORDING_SECONDS,
  MAX_RECORDING_SECONDS,
} from '@/lib/voice/recording';

/**
 * « Ma voix » — enregistrer, ecouter, cloner.
 *
 * Trois precautions qui ne se voient pas a l'usage mais se remarquent quand
 * elles manquent :
 *
 * 1. **Les pistes du micro sont arretees** a la fin de l'enregistrement et au
 *    demontage. Sans cela le voyant « micro actif » du navigateur reste
 *    allume apres avoir quitte la page — l'utilisateur croit etre ecoute.
 * 2. **L'URL de l'objet est revoquee** a chaque nouvel enregistrement et au
 *    demontage : chaque prise garde sinon son blob en memoire.
 * 3. **Le chrono s'arrete tout seul** a deux minutes. ElevenLabs n'en demande
 *    pas plus, et la route plafonne l'envoi a 10 Mo.
 */

/** Une voix deja clonee, telle que la rend `GET /api/voice/clone`. */
export interface ClonedVoice {
  id: string;
  name: string;
  lang: string | null;
  createdAt: string;
}

export default function VoiceCloneRecorder({
  onCloned,
}: {
  /** Appele apres un clonage reussi — pour rafraichir les selecteurs de voix. */
  onCloned?: (voice: ClonedVoice) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voices, setVoices] = useState<ClonedVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const urlRef = useRef<string | null>(null);

  /** Coupe le micro — le voyant du navigateur s'eteint. */
  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Un demontage en pleine prise laisserait le micro ouvert et le blob en
  // memoire.
  useEffect(() => {
    return () => {
      clearTimer();
      releaseMic();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [clearTimer, releaseMic]);

  const loadVoices = useCallback(async () => {
    try {
      const res = await fetch('/api/voice/clone');
      const data = await res.json();
      setVoices(Array.isArray(data?.voices) ? data.voices : []);
    } catch {
      setVoices([]);
    } finally {
      setLoadingVoices(false);
    }
  }, []);

  useEffect(() => { loadVoices(); }, [loadVoices]);

  const stopRecording = useCallback(() => {
    clearTimer();
    // `stop()` declenche `onstop`, qui assemble le blob.
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
  }, [clearTimer]);

  const startRecording = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickRecorderMimeType(
        typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported : undefined,
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const assemble = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(assemble);
        urlRef.current = url;
        setBlob(assemble);
        setAudioUrl(url);
        releaseMic();
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      setBlob(null);

      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          const next = s + 1;
          // Arret automatique : au-dela, l'echantillon grossit sans rien
          // apporter au clone.
          if (next >= MAX_RECORDING_SECONDS) stopRecording();
          return next;
        });
      }, 1000);
    } catch (err) {
      releaseMic();
      setError(micErrorMessage(err));
    }
  }, [releaseMic, stopRecording]);

  const discard = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setBlob(null);
    setAudioUrl(null);
    setSeconds(0);
  }, []);

  const clone = useCallback(async () => {
    if (!blob || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('name', name.trim());
      form.append('consent', consent ? 'true' : 'false');
      form.append('lang', 'FR');
      // Une extension coherente avec le type : ElevenLabs lit les deux.
      const ext = (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
      form.append('files', blob, `ma-voix.${ext}`);

      const res = await fetch('/api/voice/clone', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        // `detail` porte le message reel d'ElevenLabs quand il y en a un :
        // c'est lui qui dit ce que l'enregistrement a de fautif.
        setError([data?.error, data?.detail].filter(Boolean).join(' — ') || 'Clonage impossible.');
        return;
      }
      setNotice(
        data.requiresVerification
          ? 'Voix créée — ElevenLabs demande une vérification avant de l’utiliser.'
          : 'Voix créée. Elle apparaît maintenant dans le sélecteur de voix.',
      );
      discard();
      setName('');
      setConsent(false);
      await loadVoices();
      if (data.voice) onCloned?.(data.voice as ClonedVoice);
    } catch {
      setError('Clonage impossible — vérifiez votre connexion.');
    } finally {
      setSending(false);
    }
  }, [blob, sending, name, consent, discard, loadVoices, onCloned]);

  const removeVoice = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/voice/clone?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) await loadVoices();
    } catch {
      setError('Suppression impossible.');
    }
  }, [loadVoices]);

  const quality = recordingQuality(seconds);
  const pret = !!blob && name.trim().length > 0 && consent && !sending;

  return (
    <div className="card-base p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Mic className="w-4 h-4 text-purple-400" />
        <h2 className="font-semibold">Ma voix</h2>
      </div>
      <p className="text-sm text-gray-400">
        Enregistrez-vous pendant une minute environ, dans un endroit calme. Votre voix devient
        ensuite une voix de synthèse utilisable dans tous vos montages.
      </p>

      {/* ── Voix déjà clonées ──────────────────────────────────────── */}
      {!loadingVoices && voices.length > 0 && (
        <ul className="space-y-1.5">
          {voices.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-lg bg-gray-900 border border-gray-800 px-3 py-2"
            >
              <span className="text-sm text-gray-200">{v.name}</span>
              <button
                type="button"
                onClick={() => removeVoice(v.id)}
                title="Supprimer cette voix"
                className="text-gray-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Enregistrement ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-3">
        <div className="flex items-center gap-3">
          {recording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="flex items-center gap-2 rounded-xl bg-red-600/20 text-red-300 ring-1 ring-red-500/40 px-4 py-2.5 text-sm hover:bg-red-600/30 transition"
            >
              <Square className="w-4 h-4" />
              Arrêter
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={sending}
              className="flex items-center gap-2 rounded-xl bg-purple-600/25 text-purple-200 ring-1 ring-purple-500/50 px-4 py-2.5 text-sm hover:bg-purple-600/35 disabled:opacity-40 transition"
            >
              <Mic className="w-4 h-4" />
              {blob ? 'Recommencer' : 'Enregistrer'}
            </button>
          )}

          <span
            className="text-lg font-medium text-gray-200"
            style={{ fontVariantNumeric: 'tabular-nums' }}
            aria-live="polite"
          >
            {formatDuration(seconds)}
          </span>
          {recording && (
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden />
          )}
        </div>

        {(recording || blob) && (
          <p
            className={`text-xs ${quality === 'trop-court' ? 'text-amber-400' : 'text-gray-500'}`}
          >
            {recordingAdvice(seconds)}
          </p>
        )}

        {audioUrl && !recording && (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={audioUrl} controls className="w-full" />
            <button
              type="button"
              onClick={discard}
              title="Supprimer cet enregistrement"
              className="text-gray-500 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Nom, consentement, envoi ───────────────────────────────── */}
      {blob && (
        <div className="space-y-3">
          <div>
            <label htmlFor="voice-name" className="block text-sm font-medium mb-2">
              Nom de la voix
            </label>
            <input
              id="voice-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder="Ma voix"
              className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm"
            />
          </div>

          <label className="flex items-start gap-2.5 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Je certifie que la voix enregistrée est la mienne et j’autorise Studiio et ElevenLabs
              à en créer un clone.
            </span>
          </label>

          <button
            type="button"
            onClick={clone}
            disabled={!pret}
            className="w-full button-primary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {sending ? 'Clonage en cours…' : 'Cloner ma voix'}
          </button>

          {seconds < MIN_RECORDING_SECONDS && (
            <p className="text-xs text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Enregistrement court : le clone sera moins fidèle.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 flex items-start gap-1.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-emerald-400 flex items-start gap-1.5">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          {notice}
        </p>
      )}
    </div>
  );
}
