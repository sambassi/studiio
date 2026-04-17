'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Music, Mic, Upload, Trash2, Volume2, VolumeX, Loader2, Play, Pause, Square, Sparkles, Image as ImageIcon, LayoutGrid, Film, Megaphone } from 'lucide-react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';

function useBrowserVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () => {
      const all = window.speechSynthesis?.getVoices() || [];
      const filtered = all.filter((v) => /^(fr|en|de)/i.test(v.lang));
      setVoices(filtered.length > 0 ? filtered : all.slice(0, 12));
    };
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function MiniPlayer({ src, onDelete, volume = 1 }: { src: string; onDelete: () => void; volume?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    const onMeta = () => { setDuration(el.duration || 0); setError(false); };
    const onEnd = () => setPlaying(false);
    const onErr = () => { console.error('[MiniPlayer] Audio error for', src); setError(true); setPlaying(false); };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onErr);
    return () => { el.removeEventListener('timeupdate', onTime); el.removeEventListener('loadedmetadata', onMeta); el.removeEventListener('ended', onEnd); el.removeEventListener('error', onErr); };
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el || error) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().catch((err) => { console.error('[MiniPlayer] Play failed:', err); setError(true); }); setPlaying(true); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
  };

  return (
    <div className="flex items-center gap-2 rounded-lg bg-gray-800/80 px-2 py-1.5">
      <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />
      <button onClick={toggle} className="text-gray-400 hover:text-white p-0.5" disabled={error}>
        {error ? <span className="text-[9px] text-red-400">Err</span> : playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="flex-1 flex items-center gap-1.5 min-w-0">
        <span className="text-[9px] text-gray-400 w-8 text-right font-mono">{formatTime(currentTime)}</span>
        <div className="flex-1 h-1.5 bg-gray-700 rounded-full cursor-pointer relative" onClick={seek}>
          <div
            className="h-full rounded-full bg-purple-500 transition-all"
            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
        <span className="text-[9px] text-gray-500 w-8 font-mono">{formatTime(duration)}</span>
      </div>
      <button onClick={onDelete} className="text-gray-500 hover:text-red-400 p-0.5" title="Supprimer">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

interface AudioStudioPanelProps {
  musicUrl: string | null;
  musicName: string;
  voiceUrl: string | null;
  voiceName: string;
  musicVolume: number;
  voiceVolume: number;
  onMusicChange: (url: string | null, name: string) => void;
  onVoiceChange: (url: string | null, name: string) => void;
  onMusicVolumeChange: (v: number) => void;
  onVoiceVolumeChange: (v: number) => void;
  introDuration: number;
  cardsDuration: number;
  videoDuration: number;
  ctaDuration: number;
  onIntroDurationChange: (v: number) => void;
  onCardsDurationChange: (v: number) => void;
  onVideoDurationChange: (v: number) => void;
  onCtaDurationChange: (v: number) => void;
  hasRush: boolean;
  contentTheme?: string;
}

export function AudioStudioPanel({
  musicUrl, musicName, voiceUrl, voiceName,
  musicVolume, voiceVolume,
  onMusicChange, onVoiceChange,
  onMusicVolumeChange, onVoiceVolumeChange,
  introDuration, cardsDuration, videoDuration, ctaDuration,
  onIntroDurationChange, onCardsDurationChange, onVideoDurationChange, onCtaDurationChange,
  hasRush, contentTheme,
}: AudioStudioPanelProps) {
  const [ttsText, setTtsText] = useState('');
  const [ttsVoiceIdx, setTtsVoiceIdx] = useState(0);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState('');
  const [ttsSuggestLoading, setTtsSuggestLoading] = useState(false);
  const browserVoices = useBrowserVoices();
  const [musicMuted, setMusicMuted] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [mediaLibOpen, setMediaLibOpen] = useState(false);
  const [mediaLibTarget, setMediaLibTarget] = useState<'music' | 'voice'>('music');
  const [isUploadingMusic, setIsUploadingMusic] = useState(false);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleFileUpload = async (file: File, target: 'music' | 'voice') => {
    if (target === 'music') setIsUploadingMusic(true);
    else setIsUploadingVoice(true);
    try {
      console.log(`[AudioPanel] Uploading ${target}: ${file.name} (${file.size} bytes, ${file.type})`);

      if (file.size < 4 * 1024 * 1024) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('purpose', target === 'music' ? 'music' : 'voice');
        const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
        const data = await res.json();
        console.log('[AudioPanel] FormData upload result:', data);
        if (data.success && data.file?.url) {
          if (target === 'music') onMusicChange(data.file.url, file.name);
          else onVoiceChange(data.file.url, file.name);
          return;
        }
      }

      const res = await fetch('/api/upload/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, purpose: target === 'music' ? 'music' : 'voice' }),
      });
      const data = await res.json();
      console.log('[AudioPanel] Signed URL result:', data.success, data.error || '');
      if (!data.success) {
        console.error('[AudioPanel] Signed URL failed:', data.error);
        return;
      }
      const putRes = await fetch(data.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      console.log('[AudioPanel] PUT to storage:', putRes.status);
      if (target === 'music') onMusicChange(data.publicUrl, file.name);
      else onVoiceChange(data.publicUrl, file.name);
    } catch (err) {
      console.error('[AudioPanel] Upload error:', err);
    } finally {
      setIsUploadingMusic(false);
      setIsUploadingVoice(false);
    }
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
        await handleFileUpload(file, 'voice');
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      console.error('[AudioPanel] Microphone access denied');
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const generateTTS = async () => {
    if (!ttsText.trim()) return;
    if (!window.speechSynthesis) {
      setTtsError('Votre navigateur ne supporte pas la synthèse vocale');
      return;
    }
    setTtsLoading(true);
    setTtsError('');
    try {
      const voice = browserVoices[ttsVoiceIdx] || null;
      const voiceLabel = voice?.name || 'Voix système';

      const utterance = new SpeechSynthesisUtterance(ttsText);
      if (voice) utterance.voice = voice;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const done = new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
        utterance.onerror = (e) => reject(new Error(`TTS error: ${e.error}`));
        utterance.onend = () => { setTimeout(() => recorder.stop(), 200); };
        setTimeout(() => { try { recorder.stop(); } catch {} reject(new Error('TTS timeout (30s)')); }, 30000);
      });

      recorder.start();
      window.speechSynthesis.speak(utterance);
      const blob = await done;

      if (blob.size < 50) {
        const localUrl = URL.createObjectURL(new Blob([new ArrayBuffer(0)], { type: 'audio/webm' }));
        utterance.onend = null;
        setTtsError('');
        onVoiceChange(localUrl, `TTS — ${voiceLabel} (lecture directe)`);
        setTtsLoading(false);
        return;
      }

      const localUrl = URL.createObjectURL(blob);
      const file = new File([blob], `tts-${Date.now()}.webm`, { type: 'audio/webm' });

      try {
        const uploadRes = await fetch('/api/upload/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type, purpose: 'voice' }),
        });
        const uploadData = await uploadRes.json();
        if (uploadData.success) {
          await fetch(uploadData.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
          onVoiceChange(uploadData.publicUrl, `TTS — ${voiceLabel}`);
          return;
        }
      } catch {}
      onVoiceChange(localUrl, `TTS — ${voiceLabel}`);
    } catch (err: any) {
      console.error('[AudioPanel] TTS error:', err);
      setTtsError(err.message || 'Erreur de synthèse vocale');
    } finally {
      setTtsLoading(false);
    }
  };

  const suggestTtsText = async () => {
    setTtsSuggestLoading(true);
    try {
      const res = await fetch('/api/content/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: contentTheme || 'fitness et bien-être', locale: 'fr', cardCount: 1 }),
      });
      const data = await res.json();
      if (data.success && data.cards?.[0]) {
        const card = data.cards[0];
        setTtsText(`${card.label}. ${card.description}`);
      }
    } catch {
      // silently fail
    } finally {
      setTtsSuggestLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Music ── */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
          <Music size={12} className="text-cyan-400" /> Musique
        </div>
        {isUploadingMusic ? (
          <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-3">
            <Loader2 size={14} className="animate-spin text-cyan-400" />
            <span className="text-xs text-gray-300">Upload en cours...</span>
          </div>
        ) : musicUrl ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2">
              <Music size={14} className="text-gray-400 flex-shrink-0" />
              <span className="text-xs text-white flex-1 truncate">{musicName || 'Musique'}</span>
              <button onClick={() => setMusicMuted(!musicMuted)} className="text-gray-400 hover:text-white p-1" title={musicMuted ? 'Activer' : 'Couper'}>
                {musicMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            </div>
            <MiniPlayer src={musicUrl} onDelete={() => onMusicChange(null, '')} volume={musicMuted ? 0 : musicVolume} />
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500 w-8">Vol.</span>
              <input type="range" min={0} max={1} step={0.05} value={musicMuted ? 0 : musicVolume}
                onChange={(e) => { onMusicVolumeChange(Number(e.target.value)); setMusicMuted(false); }}
                className="flex-1 accent-purple-500" />
              <span className="text-[9px] text-gray-400 w-8 text-right">{Math.round((musicMuted ? 0 : musicVolume) * 100)}%</span>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <label className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-600 px-2 py-3 text-xs text-gray-400 cursor-pointer hover:border-gray-500 hover:text-white transition">
              <Upload size={12} /> Importer
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, 'music'); }} />
            </label>
            <button onClick={() => { setMediaLibTarget('music'); setMediaLibOpen(true); }}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-600 px-2 py-3 text-xs text-gray-400 hover:border-gray-500 hover:text-white transition">
              <Music size={12} /> Médiathèque
            </button>
          </div>
        )}
      </div>

      {/* ── Voice ── */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
          <Mic size={12} className="text-pink-400" /> Voix off
        </div>
        {isUploadingVoice ? (
          <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-3">
            <Loader2 size={14} className="animate-spin text-pink-400" />
            <span className="text-xs text-gray-300">Upload en cours...</span>
          </div>
        ) : voiceUrl ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2">
              <Mic size={14} className="text-gray-400 flex-shrink-0" />
              <span className="text-xs text-white flex-1 truncate">{voiceName || 'Voix off'}</span>
              <button onClick={() => setVoiceMuted(!voiceMuted)} className="text-gray-400 hover:text-white p-1" title={voiceMuted ? 'Activer' : 'Couper'}>
                {voiceMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            </div>
            <MiniPlayer src={voiceUrl} onDelete={() => onVoiceChange(null, '')} volume={voiceMuted ? 0 : voiceVolume} />
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500 w-8">Vol.</span>
              <input type="range" min={0} max={1} step={0.05} value={voiceMuted ? 0 : voiceVolume}
                onChange={(e) => { onVoiceVolumeChange(Number(e.target.value)); setVoiceMuted(false); }}
                className="flex-1 accent-purple-500" />
              <span className="text-[9px] text-gray-400 w-8 text-right">{Math.round((voiceMuted ? 0 : voiceVolume) * 100)}%</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <label className="flex-1 min-w-[80px] flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-600 px-2 py-3 text-xs text-gray-400 cursor-pointer hover:border-pink-500 hover:text-white transition">
              <Upload size={12} /> Importer
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, 'voice'); }} />
            </label>
            <button onClick={() => { setMediaLibTarget('voice'); setMediaLibOpen(true); }}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-600 px-2 py-3 text-xs text-gray-400 hover:border-pink-500 hover:text-white transition">
              <Mic size={12} /> Médiathèque
            </button>
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-3 text-xs font-medium transition ${
                isRecording
                  ? 'bg-red-600 text-white animate-pulse'
                  : 'border border-gray-600 text-gray-400 hover:border-red-500 hover:text-white'
              }`}
            >
              {isRecording ? <><Square size={12} /> {formatTime(recordingTime)}</> : <><Mic size={12} /> Enregistrer</>}
            </button>
          </div>
        )}
      </div>

      {/* ── TTS ── */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center justify-between">
          <span>Synthèse vocale (TTS)</span>
          <button
            onClick={suggestTtsText}
            disabled={ttsSuggestLoading}
            className="flex items-center gap-1 text-purple-400 hover:text-purple-300 disabled:opacity-50 transition"
            title="Suggérer un texte avec IA"
          >
            {ttsSuggestLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            <span className="text-[9px]">IA</span>
          </button>
        </div>
        <textarea value={ttsText} onChange={(e) => { setTtsText(e.target.value); setTtsError(''); }} placeholder="Tapez votre texte ici..."
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none resize-none" rows={3} />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <select value={ttsVoiceIdx} onChange={(e) => setTtsVoiceIdx(Number(e.target.value))}
            className="flex-1 min-w-[140px] rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white">
            {browserVoices.length === 0 && <option value={0}>Voix par défaut</option>}
            {browserVoices.map((v, i) => <option key={`${v.name}-${i}`} value={i}>{v.name} ({v.lang})</option>)}
          </select>
          <button onClick={generateTTS} disabled={ttsLoading || !ttsText.trim()}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition">
            {ttsLoading ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />} Générer
          </button>
        </div>
        {ttsError && <p className="mt-1 text-[10px] text-red-400">{ttsError}</p>}
      </div>

      {/* ── Sequence Durations ── */}
      <div className="border-t border-gray-700 pt-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Durées des séquences</div>
        <div className={`grid gap-2 ${hasRush ? 'grid-cols-4' : 'grid-cols-3'}`}>
          <div>
            <label className="flex items-center gap-1 text-[9px] text-gray-500 mb-1">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-amber-500/[0.12]"><ImageIcon size={10} className="text-amber-500" fill="currentColor" /></span>
              Titre
            </label>
            <input type="number" min={1} max={30} value={introDuration} onChange={(e) => onIntroDurationChange(Number(e.target.value))}
              className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[9px] text-gray-500 mb-1">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-pink-500/[0.12]"><LayoutGrid size={10} className="text-pink-500" fill="currentColor" /></span>
              Cartes
            </label>
            <input type="number" min={1} max={30} value={cardsDuration} onChange={(e) => onCardsDurationChange(Number(e.target.value))}
              className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white" />
          </div>
          {hasRush && (
            <div>
              <label className="flex items-center gap-1 text-[9px] text-gray-500 mb-1">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-emerald-500/[0.12]"><Film size={10} className="text-emerald-500" fill="currentColor" /></span>
                Vidéo
              </label>
              <input type="number" min={1} max={30} value={videoDuration} onChange={(e) => onVideoDurationChange(Number(e.target.value))}
                className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white" />
            </div>
          )}
          <div>
            <label className="flex items-center gap-1 text-[9px] text-gray-500 mb-1">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-500/[0.12]"><Megaphone size={10} className="text-blue-500" fill="currentColor" /></span>
              CTA
            </label>
            <input type="number" min={1} max={30} value={ctaDuration} onChange={(e) => onCtaDurationChange(Number(e.target.value))}
              className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white" />
          </div>
        </div>
      </div>

      <MediaLibrary isOpen={mediaLibOpen} onClose={() => setMediaLibOpen(false)} mediaType="audio"
        onSelect={(url, name) => { if (mediaLibTarget === 'music') onMusicChange(url, name); else onVoiceChange(url, name); }} />
    </div>
  );
}
