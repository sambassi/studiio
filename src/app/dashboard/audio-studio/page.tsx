'use client';

import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Music, Mic, Upload, Play, Pause, Square, Trash2, Volume2, VolumeX, Loader2, ChevronLeft, SkipBack, SkipForward } from 'lucide-react';
import { composeAndUpload, downloadBlob } from '@/lib/video-composer';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface PostData {
  id: string;
  title: string;
  caption?: string;
  media_url?: string;
  media_type?: string;
  format?: string;
  scheduled_date?: string;
  metadata?: Record<string, unknown>;
}

interface SeqBlock {
  type: string;
  label: string;
  emoji: string;
  duration: number;
  color: string;
}

type ExportDest = 'calendar' | 'desktop' | 'both';

// ═══════════════════════════════════════════════════════════
// WRAPPER — Suspense boundary required for useSearchParams
// ═══════════════════════════════════════════════════════════

export default function AudioStudioPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-[70vh]"><Loader2 className="animate-spin text-pink-500" size={40} /></div>}>
      <AudioStudioContent />
    </Suspense>
  );
}

function AudioStudioContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const postId = searchParams.get('postId');

  // Post data
  const [post, setPost] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(true);

  // Audio files
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicName, setMusicName] = useState('');
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState('');

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timeline playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSeqIdx, setActiveSeqIdx] = useState(0);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);

  // Export
  const [exportDest, setExportDest] = useState<ExportDest>('calendar');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState('');

  // Volume
  const [musicVolume, setMusicVolume] = useState(0.5);
  const [voiceVolume, setVoiceVolume] = useState(1.0);
  const [musicMuted, setMusicMuted] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);

  // Refs
  const musicInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  // ═══ SYNC VOLUME TO AUDIO ELEMENTS ═══
  useEffect(() => {
    if (musicAudioRef.current) {
      musicAudioRef.current.volume = musicMuted ? 0 : musicVolume;
    }
  }, [musicVolume, musicMuted]);

  useEffect(() => {
    if (voiceAudioRef.current) {
      voiceAudioRef.current.volume = voiceMuted ? 0 : voiceVolume;
    }
  }, [voiceVolume, voiceMuted]);

  // ═══ LOAD POST DATA ═══
  useEffect(() => {
    if (!postId) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/posts/${postId}`);
        const data = await res.json();
        if (data.success && data.data) setPost(data.data);
      } catch (err) { console.error('[AudioStudio] Load error:', err); }
      finally { setLoading(false); }
    })();
  }, [postId]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (musicUrl) URL.revokeObjectURL(musicUrl);
      if (voiceUrl) URL.revokeObjectURL(voiceUrl);
      if (musicAudioRef.current) musicAudioRef.current.pause();
      if (voiceAudioRef.current) voiceAudioRef.current.pause();
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [musicUrl, voiceUrl]);

  // ═══ SEQUENCE BLOCKS ═══
  const meta = post?.metadata || {};
  const seq = (meta.sequences || {}) as Record<string, unknown>;
  const seqOrder = (seq.order as string[]) || ['intro', 'cards', 'video', 'cta'];
  const seqDurations: Record<string, number> = {
    intro: (seq.intro as number) || 4,
    cards: (seq.cards as number) || 0,
    video: (seq.video as number) || 10,
    cta: (seq.cta as number) || 4,
  };

  const seqConfig: Record<string, { label: string; emoji: string; color: string }> = {
    intro: { label: 'Affiche', emoji: '🖼️', color: '#D91CD2' },
    cards: { label: 'Cartes', emoji: '📊', color: '#3B82F6' },
    video: { label: 'Vidéo', emoji: '🎬', color: '#10B981' },
    cta: { label: 'CTA', emoji: '📢', color: '#F59E0B' },
  };

  const sequences: SeqBlock[] = seqOrder
    .filter(t => seqDurations[t] > 0)
    .map(t => ({
      type: t,
      label: seqConfig[t]?.label || t,
      emoji: seqConfig[t]?.emoji || '📄',
      duration: seqDurations[t],
      color: seqConfig[t]?.color || '#666',
    }));

  const totalDuration = sequences.reduce((s, b) => s + b.duration, 0);

  // Calculate sequence start times
  const seqStarts: number[] = [];
  let cumTime = 0;
  sequences.forEach(s => { seqStarts.push(cumTime); cumTime += s.duration; });

  // ═══ TIMELINE PLAYBACK ═══
  const startPlayback = useCallback(() => {
    setIsPlaying(true);
    if (videoRef.current) { videoRef.current.currentTime = 0; videoRef.current.play().catch(() => {}); }
    if (musicAudioRef.current) { musicAudioRef.current.currentTime = 0; musicAudioRef.current.play().catch(() => {}); }
    if (voiceAudioRef.current) { voiceAudioRef.current.currentTime = 0; voiceAudioRef.current.play().catch(() => {}); }

    playIntervalRef.current = setInterval(() => {
      setCurrentTime(t => {
        const next = t + 0.1;
        if (next >= totalDuration) {
          stopPlayback();
          return 0;
        }
        // Update active sequence
        let idx = 0;
        for (let i = sequences.length - 1; i >= 0; i--) {
          if (next >= seqStarts[i]) { idx = i; break; }
        }
        setActiveSeqIdx(idx);
        return next;
      });
    }, 100);
  }, [totalDuration, sequences, seqStarts]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (playIntervalRef.current) { clearInterval(playIntervalRef.current); playIntervalRef.current = null; }
    if (videoRef.current) videoRef.current.pause();
    if (musicAudioRef.current) musicAudioRef.current.pause();
    if (voiceAudioRef.current) voiceAudioRef.current.pause();
  }, []);

  const togglePlayback = () => { isPlaying ? stopPlayback() : startPlayback(); };

  const seekTo = (time: number) => {
    setCurrentTime(time);
    let idx = 0;
    for (let i = sequences.length - 1; i >= 0; i--) {
      if (time >= seqStarts[i]) { idx = i; break; }
    }
    setActiveSeqIdx(idx);
  };

  // ═══ MUSIC HANDLING ═══
  const handleMusicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (musicUrl) URL.revokeObjectURL(musicUrl);
    const url = URL.createObjectURL(file);
    setMusicFile(file);
    setMusicUrl(url);
    setMusicName(file.name);
    // Setup audio element for preview
    if (musicAudioRef.current) musicAudioRef.current.pause();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = musicMuted ? 0 : musicVolume;
    musicAudioRef.current = audio;
  };

  const handleRemoveMusic = () => {
    if (musicUrl) URL.revokeObjectURL(musicUrl);
    if (musicAudioRef.current) { musicAudioRef.current.pause(); musicAudioRef.current = null; }
    setMusicFile(null); setMusicUrl(null); setMusicName('');
  };

  // ═══ VOICE FILE HANDLING ═══
  const handleVoiceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    const url = URL.createObjectURL(file);
    setVoiceFile(file); setVoiceUrl(url); setVoiceName(file.name);
    setRecordedBlob(null);
    if (voiceAudioRef.current) voiceAudioRef.current.pause();
    voiceAudioRef.current = new Audio(url);
  };

  const handleRemoveVoice = () => {
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    if (voiceAudioRef.current) { voiceAudioRef.current.pause(); voiceAudioRef.current = null; }
    setVoiceFile(null); setVoiceUrl(null); setVoiceName(''); setRecordedBlob(null);
  };

  // ═══ VOICE RECORDING ═══
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      recordingChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType });
        setRecordedBlob(blob);
        const url = URL.createObjectURL(blob);
        if (voiceUrl) URL.revokeObjectURL(voiceUrl);
        setVoiceUrl(url);
        setVoiceName('Enregistrement micro');
        setVoiceFile(new File([blob], `voix-off-${Date.now()}.webm`, { type: blob.type }));
        voiceAudioRef.current = new Audio(url);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);

      // Start video playback while recording
      startPlayback();

      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (err) {
      console.error('[AudioStudio] Mic denied:', err);
      alert('Veuillez autoriser l\'accès au microphone.');
    }
  }, [voiceUrl, startPlayback]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      stopPlayback();
    }
  }, [isRecording, stopPlayback]);

  // ═══ UPLOAD FILE ═══
  const uploadFile = async (file: File, purpose: string): Promise<string | null> => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('purpose', purpose);
      const res = await fetch('/api/upload/media', { method: 'POST', body: fd });
      const data = await res.json();
      return data.success ? data.file?.url || null : null;
    } catch { return null; }
  };

  // ═══ EXPORT WITH AUDIO ═══
  const handleExport = async () => {
    if (!post) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportStage('Préparation...');

    try {
      // ═══ Step 1: Create LOCAL blob URLs for audio (avoids CORS issues) ═══
      // Use blob URLs directly for the composer — no remote upload needed for mixing
      const localMusicBlobUrl = musicFile ? URL.createObjectURL(musicFile) : null;
      const localVoiceBlobUrl = voiceFile ? URL.createObjectURL(voiceFile) : null;

      console.log('[AudioStudio] Local music blob URL:', localMusicBlobUrl ? 'yes' : 'none');
      console.log('[AudioStudio] Local voice blob URL:', localVoiceBlobUrl ? 'yes' : 'none');

      setExportProgress(10);

      // Extract composition params from metadata
      const m = meta;
      const brand = m.branding as Record<string, string> | undefined;
      const isReel = post.format === 'reel';
      const cards = (m.cards as Array<{ emoji: string; label: string; value: string; color?: string }>) || [];
      const textCards = (m.textCards as Array<{ text: string; color?: string }>) || [];
      const finalCards = cards.length > 0 ? cards : textCards.map(tc => ({ emoji: '📝', label: tc.text, value: tc.text, color: tc.color }));
      const posterUrl = (m.posterUrl || m.pexelsUrl || m.characterUrl || null) as string | null;
      const rushUrl = (m.rushUrls as string[])?.[0] || (m.rawVideoUrl as string) || null;

      setExportStage('Montage vidéo avec son...');
      setExportProgress(15);

      // ═══ Step 2: Compose video with LOCAL blob audio (guaranteed no CORS) ═══
      const result = await composeAndUpload({
        width: isReel ? 1080 : 1920,
        height: isReel ? 1920 : 1080,
        fps: 24,
        title: post.title || 'Vidéo',
        subtitle: (m.subtitle as string) || undefined,
        salesPhrase: (m.salesPhrase as string) || undefined,
        cards: finalCards.length > 0 ? finalCards : undefined,
        posterUrl, videoUrl: rushUrl,
        logoUrl: (m.logoUrl as string) || null,
        musicUrl: localMusicBlobUrl,
        voiceUrl: localVoiceBlobUrl,
        introDuration: seqDurations.intro,
        cardsDuration: seqDurations.cards,
        videoDuration: seqDurations.video,
        ctaDuration: seqDurations.cta,
        accentColor: (brand?.accentColor as string) || '#D91CD2',
        ctaText: (brand?.ctaText as string) || 'CHAT POUR PLUS D\'INFOS',
        ctaSubText: (brand?.ctaSubText as string) || 'LIEN EN BIO',
        watermarkText: (brand?.watermarkText as string) || undefined,
        onProgress: (pct, stage) => {
          setExportProgress(15 + Math.round(pct * 0.65));
          setExportStage(stage);
        },
      });

      // Cleanup local blob URLs
      if (localMusicBlobUrl) URL.revokeObjectURL(localMusicBlobUrl);
      if (localVoiceBlobUrl) URL.revokeObjectURL(localVoiceBlobUrl);

      setExportProgress(85);

      if (exportDest === 'desktop' || exportDest === 'both') {
        const ext = result.blob.type.includes('mp4') ? 'mp4' : 'webm';
        downloadBlob(result.blob, `${(post.title || 'video').replace(/\s+/g, '_')}_audio.${ext}`);
      }

      // ═══ Step 3: Upload audio files to Supabase for metadata (background) ═══
      let uploadedMusicUrl: string | null = null;
      let uploadedVoiceUrl: string | null = null;

      if ((exportDest === 'calendar' || exportDest === 'both') && result.url) {
        setExportStage('Sauvegarde des fichiers audio...');
        if (musicFile) uploadedMusicUrl = await uploadFile(musicFile, 'music');
        if (voiceFile) uploadedVoiceUrl = await uploadFile(voiceFile, 'voiceover');

        setExportStage('Mise à jour du calendrier...');
        try {
          await fetch(`/api/posts/${post.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              media_url: result.url,
              media_type: 'video',
              metadata: { ...m, renderedVideoUrl: result.url, videoUrl: result.url, hasAudio: true, musicUrl: uploadedMusicUrl, voiceUrl: uploadedVoiceUrl },
            }),
          });
        } catch (err) { console.error('[AudioStudio] Update failed:', err); }
      }

      setExportProgress(100);
      setExportStage('Terminé !');

      if (exportDest === 'calendar' || exportDest === 'both') {
        setTimeout(() => router.push('/dashboard/calendar'), 1500);
      }
    } catch (err) {
      console.error('[AudioStudio] Export error:', err);
      setExportStage('Erreur');
    } finally {
      setTimeout(() => { setIsExporting(false); setExportProgress(0); setExportStage(''); }, 2000);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const hasAudio = !!musicFile || !!voiceFile;
  const videoSrc = (meta.renderedVideoUrl || meta.videoUrl || post?.media_url || null) as string | null;

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (loading) return <div className="flex items-center justify-center h-[70vh]"><Loader2 className="animate-spin text-pink-500" size={40} /></div>;

  if (!post) return (
    <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
      <VolumeX size={48} className="text-gray-600" />
      <p className="text-gray-400">Aucune vidéo sélectionnée</p>
      <button onClick={() => router.push('/dashboard/calendar')} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white transition">Retour au calendrier</button>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-128px)] -m-8">
      {/* ═══ TOP: Video Preview (takes most space) ═══ */}
      <div className="flex-1 flex bg-black relative overflow-hidden">
        {/* Video */}
        <div className="flex-1 flex items-center justify-center">
          <div className={`${post.format === 'reel' ? 'h-full max-h-full aspect-[9/16]' : 'w-full max-w-3xl aspect-video'} relative`}>
            {videoSrc ? (
              <video ref={videoRef} src={videoSrc} className="w-full h-full object-contain" muted playsInline />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900">
                <Volume2 size={48} className="text-gray-700 mb-2" />
                <p className="text-sm text-gray-600">Aperçu vidéo</p>
              </div>
            )}

            {/* Recording indicator */}
            {isRecording && (
              <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-600/90 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full z-20">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                REC {fmt(recordingTime)}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar: Audio controls */}
        <div className="w-72 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto flex flex-col gap-4">
          {/* Back + title */}
          <div className="flex items-center gap-2">
            <button onClick={() => router.back()} className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition"><ChevronLeft size={16} className="text-gray-400" /></button>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate flex items-center gap-1.5"><Volume2 size={14} className="text-pink-500 shrink-0" /> Studio Son</h2>
              <p className="text-[10px] text-gray-500 truncate">{post.title}</p>
            </div>
          </div>

          {/* Music */}
          <div className="bg-gray-800 rounded-xl p-3 border border-gray-700/50">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Music size={13} className="text-pink-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">Musique</span>
            </div>
            {musicFile ? (
              <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-2">
                <div className="w-7 h-7 rounded-full bg-pink-600 flex items-center justify-center shrink-0"><Music size={12} className="text-white" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{musicName}</p>
                </div>
                <button onClick={handleRemoveMusic} className="p-1 rounded hover:bg-red-500/20 text-red-400"><Trash2 size={12} /></button>
              </div>
            ) : (
              <button onClick={() => musicInputRef.current?.click()} className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-gray-600 hover:border-pink-500 rounded-lg text-gray-400 hover:text-pink-400 transition text-xs">
                <Upload size={13} /> Importer musique
              </button>
            )}
            <input ref={musicInputRef} type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
          </div>

          {/* Voice */}
          <div className="bg-gray-800 rounded-xl p-3 border border-gray-700/50">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Mic size={13} className="text-purple-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">Voix Off</span>
            </div>
            {/* Record */}
            {!isRecording ? (
              <button onClick={startRecording} className="w-full flex items-center justify-center gap-1.5 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white text-xs font-medium transition mb-2">
                <Mic size={13} /> Enregistrer
              </button>
            ) : (
              <button onClick={stopRecording} className="w-full flex items-center justify-center gap-1.5 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white text-xs font-medium transition mb-2 animate-pulse">
                <Square size={13} /> Stop ({fmt(recordingTime)})
              </button>
            )}
            {voiceFile ? (
              <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-2">
                <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center shrink-0">{recordedBlob ? <Mic size={12} className="text-white" /> : <Volume2 size={12} className="text-white" />}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{voiceName}</p>
                  <p className="text-[10px] text-gray-500">{recordedBlob ? `${fmt(recordingTime)}` : 'Fichier'}</p>
                </div>
                <button onClick={handleRemoveVoice} className="p-1 rounded hover:bg-red-500/20 text-red-400"><Trash2 size={12} /></button>
              </div>
            ) : (
              <button onClick={() => voiceInputRef.current?.click()} className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-gray-600 hover:border-purple-500 rounded-lg text-gray-400 hover:text-purple-400 transition text-xs">
                <Upload size={13} /> Importer fichier
              </button>
            )}
            <input ref={voiceInputRef} type="file" accept="audio/*" className="hidden" onChange={handleVoiceUpload} />
          </div>

          {/* Destination + Export */}
          <div className="bg-gray-800 rounded-xl p-3 border border-gray-700/50">
            <span className="text-xs font-bold text-white uppercase tracking-wider mb-2 block">Destination</span>
            <div className="flex gap-1.5 mb-3">
              {([
                { v: 'calendar' as ExportDest, l: '📅 Calendrier' },
                { v: 'desktop' as ExportDest, l: '💾 Bureau' },
                { v: 'both' as ExportDest, l: '🔄 Les deux' },
              ]).map(d => (
                <button key={d.v} onClick={() => setExportDest(d.v)} className={`flex-1 text-center px-1 py-2 rounded-lg font-medium text-[10px] transition border ${exportDest === d.v ? 'bg-pink-600/20 border-pink-500 text-white' : 'bg-gray-700 border-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                  {d.l}
                </button>
              ))}
            </div>

            <button onClick={handleExport} disabled={isExporting || !hasAudio} className="w-full relative overflow-hidden bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 disabled:opacity-40 text-white font-bold py-2.5 px-3 rounded-xl transition-all text-xs">
              {isExporting && <div className="absolute inset-0 bg-gradient-to-r from-pink-700 to-purple-700 transition-all duration-500" style={{ width: `${exportProgress}%` }} />}
              <span className="relative z-10 flex items-center justify-center gap-1.5">
                {isExporting ? <><Loader2 size={14} className="animate-spin" /> {Math.round(exportProgress)}%</> : <><Volume2 size={14} /> EXPORTER AVEC SON</>}
              </span>
            </button>
            {!hasAudio && <p className="text-[10px] text-gray-500 text-center mt-1.5">Ajoutez musique ou voix off</p>}
            {isExporting && exportStage && <p className="text-[10px] text-pink-400 text-center mt-1">{exportStage}</p>}
          </div>

          {/* Skip */}
          <button onClick={() => router.push('/dashboard/calendar')} className="flex items-center justify-center gap-1.5 py-2 text-xs text-gray-500 hover:text-gray-300 transition">
            Passer — garder sans son
          </button>
        </div>
      </div>

      {/* ═══ BOTTOM: Timeline ═══ */}
      <div className="bg-gray-900 border-t border-gray-800">
        {/* Transport controls */}
        <div className="flex items-center justify-center gap-4 py-2 border-b border-gray-800">
          <span className="text-xs text-gray-400 font-mono w-10 text-right">{fmt(currentTime)}</span>
          <button onClick={() => seekTo(0)} className="p-1 text-gray-400 hover:text-white transition"><SkipBack size={16} /></button>
          <button onClick={togglePlayback} className="p-2 rounded-full bg-pink-600 hover:bg-pink-700 text-white transition">
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button onClick={() => seekTo(totalDuration)} className="p-1 text-gray-400 hover:text-white transition"><SkipForward size={16} /></button>
          <span className="text-xs text-gray-400 font-mono w-10">{fmt(totalDuration)}</span>
        </div>

        {/* Sequence blocks (like slides) */}
        <div className="px-4 py-2">
          <div className="flex gap-1">
            {sequences.map((s, i) => {
              const widthPct = (s.duration / totalDuration) * 100;
              const isActive = i === activeSeqIdx && isPlaying;
              return (
                <button
                  key={i}
                  onClick={() => seekTo(seqStarts[i])}
                  className={`relative rounded-lg overflow-hidden transition-all border-2 ${isActive ? 'border-pink-500 ring-1 ring-pink-500/50' : 'border-gray-700 hover:border-gray-500'}`}
                  style={{ width: `${widthPct}%`, minWidth: '60px' }}
                >
                  <div className="bg-gray-800 px-2 py-2.5 text-center">
                    <span className="text-lg block">{s.emoji}</span>
                    <span className="text-[10px] text-gray-300 font-medium block mt-0.5">{s.label}</span>
                    <span className="text-[9px] text-gray-500">{s.duration}s</span>
                  </div>
                  {/* Progress within active block */}
                  {isActive && (
                    <div className="absolute bottom-0 left-0 h-0.5 bg-pink-500 transition-all" style={{ width: `${((currentTime - seqStarts[i]) / s.duration) * 100}%` }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Audio tracks */}
        <div className="px-4 pb-3 space-y-1">
          {/* Playhead progress bar */}
          <div
            className="relative h-1 bg-gray-800 rounded-full cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              seekTo(pct * totalDuration);
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-pink-500 rounded-full transition-all" style={{ width: `${(currentTime / totalDuration) * 100}%` }} />
          </div>

          {/* Music track with volume */}
          <div className="flex items-center gap-2 h-8">
            <span className="text-[10px] text-pink-400 w-14 shrink-0 flex items-center gap-1"><Music size={10} /> Musique</span>
            <button
              onClick={() => setMusicMuted(m => !m)}
              className="shrink-0 p-1 rounded hover:bg-gray-700/50 transition"
              title={musicMuted ? 'Activer musique' : 'Couper musique'}
            >
              {musicMuted ? <VolumeX size={12} className="text-gray-500" /> : <Volume2 size={12} className="text-pink-400" />}
            </button>
            <input
              type="range" min="0" max="1" step="0.05"
              value={musicMuted ? 0 : musicVolume}
              onChange={(e) => { setMusicVolume(parseFloat(e.target.value)); if (musicMuted) setMusicMuted(false); }}
              className="w-16 shrink-0 h-1 accent-pink-500 cursor-pointer"
              title={`Volume: ${Math.round((musicMuted ? 0 : musicVolume) * 100)}%`}
            />
            <div className="flex-1 h-full rounded-md overflow-hidden relative bg-gray-800/50">
              {musicFile ? (
                <div className={`absolute inset-0 bg-gradient-to-r from-pink-600/40 to-pink-500/20 flex items-center px-2 ${musicMuted ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-px h-full w-full">
                    {Array.from({ length: 80 }).map((_, i) => (
                      <div key={i} className="flex-1 bg-pink-500/60 rounded-full" style={{ height: `${(20 + Math.sin(i * 0.7) * 30 + Math.random() * 30) * (musicMuted ? 0.3 : musicVolume)}%`, minHeight: '2px' }} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[9px] text-gray-600">Pas de musique</span>
                </div>
              )}
            </div>
          </div>

          {/* Voice track with volume */}
          <div className="flex items-center gap-2 h-8">
            <span className="text-[10px] text-purple-400 w-14 shrink-0 flex items-center gap-1"><Mic size={10} /> Voix</span>
            <button
              onClick={() => setVoiceMuted(m => !m)}
              className="shrink-0 p-1 rounded hover:bg-gray-700/50 transition"
              title={voiceMuted ? 'Activer voix' : 'Couper voix'}
            >
              {voiceMuted ? <VolumeX size={12} className="text-gray-500" /> : <Volume2 size={12} className="text-purple-400" />}
            </button>
            <input
              type="range" min="0" max="1" step="0.05"
              value={voiceMuted ? 0 : voiceVolume}
              onChange={(e) => { setVoiceVolume(parseFloat(e.target.value)); if (voiceMuted) setVoiceMuted(false); }}
              className="w-16 shrink-0 h-1 accent-purple-500 cursor-pointer"
              title={`Volume: ${Math.round((voiceMuted ? 0 : voiceVolume) * 100)}%`}
            />
            <div className="flex-1 h-full rounded-md overflow-hidden relative bg-gray-800/50">
              {voiceFile ? (
                <div className={`absolute inset-0 bg-gradient-to-r from-purple-600/40 to-purple-500/20 flex items-center px-2 ${voiceMuted ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-px h-full w-full">
                    {Array.from({ length: 80 }).map((_, i) => (
                      <div key={i} className="flex-1 bg-purple-500/60 rounded-full" style={{ height: `${(15 + Math.cos(i * 0.5) * 25 + Math.random() * 35) * (voiceMuted ? 0.3 : voiceVolume)}%`, minHeight: '2px' }} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[9px] text-gray-600">Pas de voix off</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
