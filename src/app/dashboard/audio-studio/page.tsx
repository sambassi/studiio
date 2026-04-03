'use client';

import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Music, Mic, Upload, Play, Pause, Square, Trash2, Volume2, VolumeX, Loader2, ChevronLeft, SkipBack, SkipForward } from 'lucide-react';
import { composeAndUpload, downloadBlob } from '@/lib/video-composer';
import { useTranslations } from '@/i18n/client';

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
  const t = useTranslations('audioStudio');
  const tc = useTranslations('common');
  const searchParams = useSearchParams();
  const router = useRouter();
  const postId = searchParams.get('postId');
  const postIdsParam = searchParams.get('postIds'); // comma-separated for batch

  // Post data — supports batch (multiple posts)
  const [posts, setPosts] = useState<PostData[]>([]);
  const [currentPostIndex, setCurrentPostIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const post = posts[currentPostIndex] || null;
  const isBatch = posts.length > 1;

  // Video loading state
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoFallbackIdx, setVideoFallbackIdx] = useState(0);
  const [detectedVideoDuration, setDetectedVideoDuration] = useState<number | null>(null);

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

  // ═══ LOAD POST DATA (single or batch) ═══
  useEffect(() => {
    const ids: string[] = [];
    if (postIdsParam) {
      ids.push(...postIdsParam.split(',').filter(Boolean));
    } else if (postId) {
      ids.push(postId);
    }
    if (ids.length === 0) { setLoading(false); return; }

    (async () => {
      try {
        const loaded: PostData[] = [];
        for (const id of ids) {
          try {
            const res = await fetch(`/api/posts/${id}`);
            const data = await res.json();
            if (data.success && data.data) loaded.push(data.data);
          } catch (err) { console.error(`[AudioStudio] Load error for ${id}:`, err); }
        }
        if (loaded.length > 0) setPosts(loaded);
        console.log(`[AudioStudio] Loaded ${loaded.length}/${ids.length} posts`);
      } catch (err) { console.error('[AudioStudio] Load error:', err); }
      finally { setLoading(false); }
    })();
  }, [postId, postIdsParam]);

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

  // ═══ PREVENT NAVIGATION DURING EXPORT ═══
  useEffect(() => {
    if (!isExporting) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isExporting]);

  // ═══ SEQUENCE BLOCKS ═══
  const meta = post?.metadata || {};
  const seq = (meta.sequences || {}) as Record<string, unknown>;
  const seqOrder = (seq.order as string[]) || ['intro', 'cards', 'video', 'cta'];
  const seqDurations: Record<string, number> = {
    intro: (seq.intro as number) || 4,
    cards: (seq.cards as number) || 0,
    video: (seq.video as number) || detectedVideoDuration || 10,
    cta: (seq.cta as number) || 4,
  };

  const seqConfig: Record<string, { label: string; emoji: string; color: string }> = {
    intro: { label: t('timeline.affiche'), emoji: '🖼️', color: '#D91CD2' },
    cards: { label: t('timeline.cards'), emoji: '📊', color: '#3B82F6' },
    video: { label: t('timeline.video'), emoji: '🎬', color: '#10B981' },
    cta: { label: t('timeline.cta'), emoji: '📢', color: '#F59E0B' },
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

  // ═══ TIMELINE PLAYBACK — independent real-time clock ═══
  // Uses performance.now() instead of video.currentTime to guarantee
  // the timeline runs at exactly 1 second per second regardless of video duration
  const playStartRef = useRef<number>(0); // performance.now() when playback started
  const timeOffsetRef = useRef<number>(0); // timeline offset when playback started

  // ═══ RESET VIDEO STATE ON POST CHANGE ═══
  useEffect(() => {
    setVideoLoading(true);
    setVideoError(false);
    setVideoFallbackIdx(0);
    setCurrentTime(0);
    setActiveSeqIdx(0);
    setIsPlaying(false);
    // Reset the independent clock refs so timeline starts fresh
    timeOffsetRef.current = 0;
    playStartRef.current = performance.now();
  }, [post?.id]);

  // ═══ DETECT ACTUAL VIDEO DURATION FROM SOURCE ═══
  useEffect(() => {
    const rUrls = ((meta.rushUrls || []) as string[]);
    const src = (meta.renderedVideoUrl || meta.videoUrl || rUrls[0] || post?.media_url || null) as string | null;
    if (!src) { setDetectedVideoDuration(null); return; }
    const tempVid = document.createElement('video');
    tempVid.preload = 'metadata';
    tempVid.onloadedmetadata = () => {
      const dur = Math.round(tempVid.duration);
      if (dur > 0 && dur < 300) {
        setDetectedVideoDuration(dur);
        console.log(`[AudioStudio] Detected video duration: ${dur}s`);
      }
    };
    tempVid.onerror = () => setDetectedVideoDuration(null);
    tempVid.src = src;
    return () => { tempVid.src = ''; };
  }, [post?.id, meta.renderedVideoUrl, meta.videoUrl, post?.media_url]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || videoLoading) return;
    let rafId = 0;
    let running = false;

    const syncTimeline = () => {
      if (!running) return;
      const now = performance.now();
      const elapsed = timeOffsetRef.current + (now - playStartRef.current) / 1000;
      const mapped = Math.min(Math.max(elapsed, 0), totalDuration);

      // Stop at end of timeline
      if (mapped >= totalDuration) {
        setCurrentTime(totalDuration);
        setActiveSeqIdx(sequences.length - 1);
        vid.pause();
        if (musicAudioRef.current) musicAudioRef.current.pause();
        if (voiceAudioRef.current) voiceAudioRef.current.pause();
        setIsPlaying(false);
        running = false;
        return;
      }

      setCurrentTime(mapped);
      let idx = 0;
      for (let i = sequences.length - 1; i >= 0; i--) {
        if (mapped >= seqStarts[i]) { idx = i; break; }
      }
      setActiveSeqIdx(idx);
      rafId = requestAnimationFrame(syncTimeline);
    };

    const onPlay = () => {
      playStartRef.current = performance.now();
      setIsPlaying(true);
      if (!running) { running = true; rafId = requestAnimationFrame(syncTimeline); }
    };
    const onPause = () => {
      // Save current position so we can resume from here
      const now = performance.now();
      timeOffsetRef.current = timeOffsetRef.current + (now - playStartRef.current) / 1000;
      setIsPlaying(false);
      running = false;
      cancelAnimationFrame(rafId);
    };

    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);
    if (!vid.paused) { playStartRef.current = performance.now(); running = true; setIsPlaying(true); rafId = requestAnimationFrame(syncTimeline); }
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
    };
  }, [post?.id, totalDuration, sequences, seqStarts, videoLoading]);

  const startPlayback = useCallback(() => {
    // Reset timeline clock to start from 0
    timeOffsetRef.current = 0;
    playStartRef.current = performance.now();
    setCurrentTime(0);
    setActiveSeqIdx(0);
    if (videoRef.current) { videoRef.current.currentTime = 0; videoRef.current.play().catch(() => {}); }
    if (musicAudioRef.current) { musicAudioRef.current.currentTime = 0; musicAudioRef.current.play().catch(() => {}); }
    if (voiceAudioRef.current) { voiceAudioRef.current.currentTime = 0; voiceAudioRef.current.play().catch(() => {}); }
  }, []);

  const stopPlayback = useCallback(() => {
    if (videoRef.current) videoRef.current.pause();
    if (musicAudioRef.current) musicAudioRef.current.pause();
    if (voiceAudioRef.current) voiceAudioRef.current.pause();
  }, []);

  const togglePlayback = () => { isPlaying ? stopPlayback() : startPlayback(); };

  const seekTo = (time: number) => {
    // Update timeline clock to the seek position
    timeOffsetRef.current = time;
    playStartRef.current = performance.now();
    setCurrentTime(time);
    if (videoRef.current) videoRef.current.currentTime = time;
    if (musicAudioRef.current) musicAudioRef.current.currentTime = time;
    if (voiceAudioRef.current) voiceAudioRef.current.currentTime = time;
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
        setVoiceName(t('voice.recordingName'));
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
      alert(t('voice.micDenied'));
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
      // Use signed URL for large files (audio/video > 4MB) to bypass Vercel's 4.5MB body limit
      if (file.size > 4 * 1024 * 1024) {
        const signRes = await fetch('/api/upload/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type, purpose }),
        });
        const signData = await signRes.json();
        if (!signData.success) { console.error('[Upload] Signed URL error:', signData.error); return null; }
        const putRes = await fetch(signData.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!putRes.ok) { console.error('[Upload] PUT failed:', putRes.status); return null; }
        console.log('[Upload] Signed URL upload OK:', signData.publicUrl);
        return signData.publicUrl;
      }
      // Small files use regular upload
      const fd = new FormData();
      fd.append('file', file);
      fd.append('purpose', purpose);
      const res = await fetch('/api/upload/media', { method: 'POST', body: fd });
      const data = await res.json();
      return data.success ? data.file?.url || null : null;
    } catch (err) { console.error('[Upload] Error:', err); return null; }
  };

  // ═══ EXPORT WITH AUDIO (supports batch) ═══
  const handleExport = async () => {
    if (posts.length === 0) return;

    // ═══ CRITICAL: Create AudioContext IMMEDIATELY in user gesture chain ═══
    // Chrome requires AudioContext creation within a user gesture (click/tap).
    // If we await anything first (like file uploads), the gesture expires and
    // the AudioContext starts in "suspended" state that cannot be resumed.
    let sharedAudioCtx: AudioContext | undefined;
    let musicBuffer: AudioBuffer | undefined;
    let voiceBuffer: AudioBuffer | undefined;
    if (musicFile || voiceFile) {
      sharedAudioCtx = new AudioContext({ sampleRate: 48000 });
      console.log(`[AudioStudio] AudioContext created IN user gesture, state: ${sharedAudioCtx.state}`);
    }

    setIsExporting(true);
    setExportProgress(0);
    setExportStage(t('export.preparing'));

    try {
      // Pre-decode audio files into AudioBuffers BEFORE uploading (faster, no network delay)
      if (sharedAudioCtx && musicFile) {
        try {
          console.log(`[AudioStudio] Decoding music: ${musicFile.name} (${(musicFile.size / 1024).toFixed(0)}KB, type: ${musicFile.type})`);
          const musicArrayBuf = await musicFile.arrayBuffer();
          console.log(`[AudioStudio] Music ArrayBuffer: ${musicArrayBuf.byteLength} bytes`);
          musicBuffer = await sharedAudioCtx.decodeAudioData(musicArrayBuf.slice(0));
          console.log(`[AudioStudio] ✅ Music decoded to AudioBuffer: ${musicBuffer.duration.toFixed(1)}s, ${musicBuffer.numberOfChannels}ch, ${musicBuffer.sampleRate}Hz`);
        } catch (err) {
          console.error('[AudioStudio] ❌ Music decode failed:', err);
        }
      }
      if (sharedAudioCtx && voiceFile) {
        try {
          console.log(`[AudioStudio] Decoding voice: ${voiceFile.name} (${(voiceFile.size / 1024).toFixed(0)}KB, type: ${voiceFile.type})`);
          const voiceArrayBuf = await voiceFile.arrayBuffer();
          voiceBuffer = await sharedAudioCtx.decodeAudioData(voiceArrayBuf.slice(0));
          console.log(`[AudioStudio] ✅ Voice decoded to AudioBuffer: ${voiceBuffer.duration.toFixed(1)}s, ${voiceBuffer.numberOfChannels}ch, ${voiceBuffer.sampleRate}Hz`);
        } catch (err) {
          console.error('[AudioStudio] ❌ Voice decode failed:', err);
        }
      }
      // Ensure AudioContext is running after decoding
      if (sharedAudioCtx && sharedAudioCtx.state !== 'running') {
        await sharedAudioCtx.resume();
        console.log(`[AudioStudio] AudioContext resumed, state: ${sharedAudioCtx.state}`);
      }

      // ═══ Step 1: Upload audio files to Supabase ONCE (shared across all posts) ═══
      let uploadedMusicUrl: string | null = null;
      let uploadedVoiceUrl: string | null = null;

      setExportStage(t('export.uploadingAudio'));
      setExportProgress(5);
      if (musicFile) uploadedMusicUrl = await uploadFile(musicFile, 'music');
      if (voiceFile) uploadedVoiceUrl = await uploadFile(voiceFile, 'voiceover');

      console.log(`[AudioStudio] Export: ${posts.length} post(s), music: ${uploadedMusicUrl ? 'yes' : 'none'}, voice: ${uploadedVoiceUrl ? 'yes' : 'none'}`);
      console.log(`[AudioStudio] AudioContext state after uploads: ${sharedAudioCtx?.state || 'N/A'}`);

      setExportProgress(20);

      // ═══ BATCH MODE: Re-compose each video with embedded audio ═══
      if (isBatch) {
        let successCount = 0;
        const localMusicBlobUrl = musicFile ? URL.createObjectURL(musicFile) : null;
        const localVoiceBlobUrl = voiceFile ? URL.createObjectURL(voiceFile) : null;

        console.log(`[AudioStudio] ═══ BATCH START: ${posts.length} videos ═══`);
        console.log(`[AudioStudio] musicBuffer: ${musicBuffer ? musicBuffer.duration.toFixed(1) + 's' : 'NULL'}`);
        console.log(`[AudioStudio] voiceBuffer: ${voiceBuffer ? voiceBuffer.duration.toFixed(1) + 's' : 'NULL'}`);
        console.log(`[AudioStudio] sharedAudioCtx: ${sharedAudioCtx?.state || 'NULL'}`);

        for (let i = 0; i < posts.length; i++) {
          const p = posts[i];
          const pm = p.metadata || {};

          // Update preview to show current video being processed
          setCurrentPostIndex(i);

          console.log(`[AudioStudio] ─── Video ${i + 1}/${posts.length} START: "${p.title}" (${p.id}) ───`);

          try {
            const brand = (pm.branding as Record<string, string>) || undefined;
            const isReel = p.format === 'reel';
            const pSeq = (pm.sequences || {}) as Record<string, unknown>;
            const pCards = (pm.cards as Array<{ emoji: string; label: string; value: string; color?: string }>) || [];
            const pTextCards = (pm.textCards as Array<{ text: string; color?: string }>) || [];
            const finalCards = pCards.length > 0 ? pCards : pTextCards.map(card => ({ emoji: '📝', label: card.text, value: card.text, color: card.color }));
            // Read poster from ALL possible metadata fields
            const posterUrl = (pm.posterUrl || pm.pexelsUrl || pm.characterUrl || pm.renderedVideoUrl || null) as string | null;
            const rushUrl = (pm.rushUrls as string[])?.[0] || (pm.rawVideoUrl as string) || null;

            console.log(`[AudioStudio]   posterUrl: ${posterUrl?.substring(0, 60) || 'NONE'}`);
            console.log(`[AudioStudio]   rushUrl: ${rushUrl?.substring(0, 60) || 'NONE'}`);
            console.log(`[AudioStudio]   musicBuffer: ${musicBuffer ? musicBuffer.duration.toFixed(1) + 's' : 'NULL'}, voiceBuffer: ${voiceBuffer ? voiceBuffer.duration.toFixed(1) + 's' : 'NULL'}`);
            console.log(`[AudioStudio]   musicBlobUrl: ${localMusicBlobUrl ? 'YES' : 'NONE'}, voiceBlobUrl: ${localVoiceBlobUrl ? 'YES' : 'NONE'}`);
            console.log(`[AudioStudio]   sharedAudioCtx: ${sharedAudioCtx ? sharedAudioCtx.state : 'NULL'}`);
            console.log(`[AudioStudio]   sequences: intro=${(pSeq.intro as number) || 0} cards=${(pSeq.cards as number) || 0} video=${(pSeq.video as number) || 0} cta=${(pSeq.cta as number) || 0}`);

            const progressBase = 20 + Math.round((i / posts.length) * 70);
            const progressSpan = Math.round(70 / posts.length);
            setExportStage(t('export.composingBatch', { current: String(i + 1), total: String(posts.length) }));
            setExportProgress(progressBase);

            // Resume shared AudioContext before each video (Chrome suspends after inactivity)
            if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
              await sharedAudioCtx.resume();
            }

            const result = await composeAndUpload({
              width: isReel ? 1080 : 1920,
              height: isReel ? 1920 : 1080,
              fps: 24,
              title: p.title || 'Vidéo',
              subtitle: (pm.subtitle as string) || undefined,
              salesPhrase: (pm.salesPhrase as string) || undefined,
              cards: finalCards.length > 0 ? finalCards : undefined,
              posterUrl, videoUrl: rushUrl,
              logoUrl: (pm.logoUrl as string) || null,
              musicUrl: localMusicBlobUrl,
              voiceUrl: localVoiceBlobUrl,
              introDuration: (pSeq.intro as number) || seqDurations.intro,
              cardsDuration: (pSeq.cards as number) || seqDurations.cards,
              videoDuration: (pSeq.video as number) || seqDurations.video,
              ctaDuration: (pSeq.cta as number) || seqDurations.cta,
              accentColor: (brand?.accentColor as string) || '#D91CD2',
              ctaText: (brand?.ctaText as string) || 'CHAT POUR PLUS D\'INFOS',
              ctaSubText: (brand?.ctaSubText as string) || 'LIEN EN BIO',
              watermarkText: (brand?.watermarkText as string) || undefined,
              sharedAudioCtx,
              musicBuffer,
              voiceBuffer,
              onProgress: (pct, stage) => {
                setExportProgress(Math.round(progressBase + (pct / 100) * progressSpan));
                setExportStage(`[${i + 1}/${posts.length}] ${stage}`);
              },
            });

            console.log(`[AudioStudio]   composeAndUpload result: blob=${(result.blob.size / 1024).toFixed(0)}KB, url=${result.url ? 'YES' : 'NULL'}`);

            // Update post with new rendered video + audio metadata
            if (result.url) {
              const patchRes = await fetch(`/api/posts/${p.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  media_url: result.url,
                  media_type: 'video',
                  status: 'completed',
                  metadata: { ...pm, renderedVideoUrl: result.url, videoUrl: result.url, hasAudio: true, musicUrl: uploadedMusicUrl, voiceUrl: uploadedVoiceUrl },
                }),
              });
              const patchData = await patchRes.json().catch(() => ({}));
              successCount++;
              console.log(`[AudioStudio]   ✅ PATCH OK post ${i + 1}/${posts.length}: ${p.id}`, patchData.success ? 'success' : 'failed');
            } else {
              console.warn(`[AudioStudio]   ⚠️ No URL returned for post ${i + 1}: ${p.id} — updating metadata only`);
              await fetch(`/api/posts/${p.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  status: 'completed',
                  metadata: { ...pm, hasAudio: true, musicUrl: uploadedMusicUrl, voiceUrl: uploadedVoiceUrl },
                }),
              });
              successCount++;
            }

            if ((exportDest === 'desktop' || exportDest === 'both') && result.blob) {
              downloadBlob(result.blob, `${(p.title || 'video').replace(/\s+/g, '_')}_${i + 1}.mp4`);
            }
          } catch (err) {
            console.error(`[AudioStudio]   ❌ FAILED post ${i + 1}/${posts.length} (${p.id}):`, err);
            // Fallback: just update metadata so the post still appears in calendar
            try {
              await fetch(`/api/posts/${p.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  status: 'completed',
                  metadata: { ...pm, hasAudio: true, musicUrl: uploadedMusicUrl, voiceUrl: uploadedVoiceUrl },
                }),
              });
              successCount++;
              console.log(`[AudioStudio]   ↪ Fallback PATCH OK for post ${p.id}`);
            } catch (patchErr) { console.error(`[AudioStudio]   ↪ Fallback PATCH also failed:`, patchErr); }
          }

          console.log(`[AudioStudio] ─── Video ${i + 1}/${posts.length} END (success total: ${successCount}) ───`);

          // Delay between batch items to let AudioContext fully release
          if (i < posts.length - 1) {
            await new Promise(r => setTimeout(r, 800));
          }
        }

        console.log(`[AudioStudio] ═══ BATCH DONE: ${successCount}/${posts.length} ═══`);

        // Close the shared AudioContext now that all videos are done
        if (sharedAudioCtx) {
          try { await sharedAudioCtx.close(); console.log('[AudioStudio] Shared AudioContext closed'); }
          catch (e) { console.warn('[AudioStudio] Shared AudioContext close error:', e); }
        }

        if (localMusicBlobUrl) URL.revokeObjectURL(localMusicBlobUrl);
        if (localVoiceBlobUrl) URL.revokeObjectURL(localVoiceBlobUrl);

        setExportProgress(100);
        setExportStage(t('export.batchDone', { success: String(successCount), total: String(posts.length) }));
        console.log(`[AudioStudio] Batch done: ${successCount}/${posts.length} composed`);

        if (exportDest === 'calendar' || exportDest === 'both') {
          setTimeout(() => router.push('/dashboard/calendar'), 1500);
        }

      } else {
        // ═══ SINGLE POST: Full composition with embedded audio ═══
        // Also uses sharedAudioCtx + musicBuffer (created at start of handleExport in user gesture)
        const p = posts[0];
        const pm = p.metadata || {};
        const brand = (pm.branding as Record<string, string>) || undefined;
        const isReel = p.format === 'reel';
        const pSeq = (pm.sequences || {}) as Record<string, unknown>;
        const pCards = (pm.cards as Array<{ emoji: string; label: string; value: string; color?: string }>) || [];
        const pTextCards = (pm.textCards as Array<{ text: string; color?: string }>) || [];
        const finalCards = pCards.length > 0 ? pCards : pTextCards.map(tc => ({ emoji: '📝', label: tc.text, value: tc.text, color: tc.color }));
        const posterUrl = (pm.posterUrl || pm.pexelsUrl || pm.characterUrl || null) as string | null;
        const rushUrl = (pm.rushUrls as string[])?.[0] || (pm.rawVideoUrl as string) || null;

        const localMusicBlobUrl = musicFile ? URL.createObjectURL(musicFile) : null;
        const localVoiceBlobUrl = voiceFile ? URL.createObjectURL(voiceFile) : null;

        // Resume context before composing
        if (sharedAudioCtx && sharedAudioCtx.state !== 'running') {
          await sharedAudioCtx.resume();
        }

        setExportStage(t('export.composingWithAudio'));
        setExportProgress(25);

        const result = await composeAndUpload({
          width: isReel ? 1080 : 1920,
          height: isReel ? 1920 : 1080,
          fps: 24,
          title: p.title || 'Vidéo',
          subtitle: (pm.subtitle as string) || undefined,
          salesPhrase: (pm.salesPhrase as string) || undefined,
          cards: finalCards.length > 0 ? finalCards : undefined,
          posterUrl, videoUrl: rushUrl,
          logoUrl: (pm.logoUrl as string) || null,
          musicUrl: localMusicBlobUrl,
          voiceUrl: localVoiceBlobUrl,
          introDuration: (pSeq.intro as number) || seqDurations.intro,
          cardsDuration: (pSeq.cards as number) || seqDurations.cards,
          videoDuration: (pSeq.video as number) || seqDurations.video,
          ctaDuration: (pSeq.cta as number) || seqDurations.cta,
          accentColor: (brand?.accentColor as string) || '#D91CD2',
          ctaText: (brand?.ctaText as string) || 'CHAT POUR PLUS D\'INFOS',
          ctaSubText: (brand?.ctaSubText as string) || 'LIEN EN BIO',
          watermarkText: (brand?.watermarkText as string) || undefined,
          sharedAudioCtx,
          musicBuffer,
          voiceBuffer,
          onProgress: (pct, stage) => {
            setExportProgress(25 + Math.round(pct * 0.60));
            setExportStage(stage);
          },
        });

        if (localMusicBlobUrl) URL.revokeObjectURL(localMusicBlobUrl);
        if (localVoiceBlobUrl) URL.revokeObjectURL(localVoiceBlobUrl);

        if (exportDest === 'desktop' || exportDest === 'both') {
          downloadBlob(result.blob, `${(p.title || 'video').replace(/\s+/g, '_')}_audio.mp4`);
        }

        if ((exportDest === 'calendar' || exportDest === 'both') && result.url) {
          setExportStage(t('export.updatingCalendar'));
          try {
            await fetch(`/api/posts/${p.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                media_url: result.url,
                media_type: 'video',
                metadata: { ...pm, renderedVideoUrl: result.url, videoUrl: result.url, hasAudio: true, musicUrl: uploadedMusicUrl, voiceUrl: uploadedVoiceUrl },
              }),
            });
          } catch (err) { console.error('[AudioStudio] Update failed:', err); }
        }

        setExportProgress(100);
        setExportStage(t('export.done'));

        if (exportDest === 'calendar' || exportDest === 'both') {
          setTimeout(() => router.push('/dashboard/calendar'), 1500);
        }
      }
    } catch (err) {
      console.error('[AudioStudio] Export error:', err);
      setExportStage(t('export.error'));
    } finally {
      setTimeout(() => { setIsExporting(false); setExportProgress(0); setExportStage(''); }, 2000);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const hasAudio = !!musicFile || !!voiceFile;
  // Video source: build a fallback chain of all available video URLs
  const rushUrls = (meta.rushUrls || []) as string[];
  const videoSrcCandidates = [
    meta.renderedVideoUrl as string | null,
    meta.videoUrl as string | null,
    ...rushUrls,
    post?.media_url || null,
  ].filter((u): u is string => !!u);
  // Remove duplicates while preserving order
  const uniqueVideoSrcs = [...new Set(videoSrcCandidates)];
  const videoSrc = uniqueVideoSrcs[videoFallbackIdx] || uniqueVideoSrcs[0] || null;
  // Static poster image for stable preview (avoids video flickering during re-renders)
  const posterImgSrc = (meta.posterUrl || meta.pexelsUrl || meta.characterUrl || null) as string | null;

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (loading) return <div className="flex items-center justify-center h-[70vh]"><Loader2 className="animate-spin text-pink-500" size={40} /></div>;

  if (posts.length === 0) return (
    <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
      <VolumeX size={48} className="text-gray-600" />
      <p className="text-gray-400">{t('noVideoSelected')}</p>
      <button onClick={() => router.push('/dashboard/calendar')} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white transition">{t('backToCalendar')}</button>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-128px)] -m-8">
      {/* ═══ TOP: Video Preview (takes most space) ═══ */}
      <div className="flex-1 flex bg-black relative overflow-hidden">
        {/* Video + batch strip */}
        <div className="flex-1 flex flex-col">
          {/* Main video preview */}
          <div className="flex-1 flex items-center justify-center p-2 overflow-hidden" style={{ minHeight: 0 }}>
            <div
              className="relative bg-gray-900 rounded-xl overflow-hidden border border-gray-700/50"
              style={post.format === 'tv'
                ? { width: '100%', aspectRatio: '16/9', maxHeight: '100%' }
                : { height: '100%', aspectRatio: '9/16', maxWidth: 'calc((100vh - 300px) * 9 / 16)' }
              }
            >
              {isExporting ? (
                <>
                  {/* During export: ALWAYS show static content — never render <video> */}
                  {posterImgSrc ? (
                    <img src={posterImgSrc} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-b from-gray-800 to-gray-900 flex items-center justify-center">
                      <Music size={48} className="text-pink-500/30" />
                    </div>
                  )}
                  {/* Export progress overlay with title info */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10">
                    <Loader2 className="animate-spin text-pink-500 mb-3" size={36} />
                    <p className="text-lg text-white font-bold">{exportProgress}%</p>
                    <p className="text-xs text-gray-300 mt-1 px-4 text-center">{exportStage}</p>
                    {post?.title && (
                      <p className="text-[10px] text-pink-300 mt-2 px-4 text-center truncate max-w-full">{post.title}</p>
                    )}
                  </div>
                </>
              ) : videoSrc ? (
                <>
                  <video
                    key={`${post?.id}-${videoFallbackIdx}`}
                    ref={videoRef}
                    src={videoSrc}
                    poster={posterImgSrc || undefined}
                    className="w-full h-full object-contain"
                    playsInline
                    autoPlay
                    loop
                    muted
                    onLoadedData={() => { setVideoLoading(false); setVideoError(false); }}
                    onError={() => {
                      console.warn(`[AudioStudio] Video load failed (idx ${videoFallbackIdx}): ${videoSrc?.substring(0, 80)}`);
                      // Try next fallback URL if available
                      if (videoFallbackIdx < uniqueVideoSrcs.length - 1) {
                        setVideoFallbackIdx(prev => prev + 1);
                        setVideoLoading(true);
                      } else {
                        setVideoLoading(false);
                        setVideoError(true);
                      }
                    }}
                    onWaiting={() => setVideoLoading(true)}
                    onPlaying={() => setVideoLoading(false)}
                  />
                  {videoLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
                      <Loader2 className="animate-spin text-pink-500" size={32} />
                    </div>
                  )}
                  {videoError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-10">
                      {posterImgSrc ? (
                        <>
                          <img src={posterImgSrc} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
                          <div className="relative z-10 flex flex-col items-center">
                            <Play size={32} className="text-white/60 mb-2" />
                            <p className="text-xs text-white/60">{t('videoPreview')}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <Volume2 size={32} className="text-gray-600 mb-2" />
                          <p className="text-xs text-gray-500">{t('videoPreview')}</p>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : posterImgSrc ? (
                <div className="w-full h-full relative">
                  <img src={posterImgSrc} alt={post?.title || ''} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30">
                    <Play size={40} className="text-white/60 mb-2" />
                    <p className="text-xs text-white/60">{t('videoPreview')}</p>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900">
                  <Volume2 size={48} className="text-gray-700 mb-2" />
                  <p className="text-sm text-gray-600">{t('videoPreview')}</p>
                </div>
              )}

              {/* Recording indicator */}
              {isRecording && (
                <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-600/90 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full z-20">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  REC {fmt(recordingTime)}
                </div>
              )}

              {/* Batch indicator overlay */}
              {isBatch && (
                <div className="absolute top-4 right-4 bg-pink-600/90 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full z-20 font-medium">
                  {currentPostIndex + 1}/{posts.length}
                </div>
              )}
            </div>
          </div>

          {/* ═══ Batch video thumbnails strip ═══ */}
          {isBatch && (
            <div className="bg-gray-900/80 border-t border-gray-800 px-3 py-2 flex gap-2 overflow-x-auto">
              {posts.map((p, i) => {
                const pMeta = p.metadata || {};
                // Prefer static image for thumbnail (avoids video reload flickering)
                const imgThumb = (pMeta.posterUrl || pMeta.pexelsUrl || pMeta.characterUrl || null) as string | null;
                const videoThumb = !imgThumb ? ((pMeta.renderedVideoUrl || pMeta.videoUrl || p.media_url || null) as string | null) : null;
                const isActive = i === currentPostIndex;
                return (
                  <button
                    key={p.id}
                    onClick={() => setCurrentPostIndex(i)}
                    className={`shrink-0 w-16 rounded-lg overflow-hidden border-2 transition-all ${isActive ? 'border-pink-500 ring-1 ring-pink-500/50 scale-105' : 'border-gray-700 hover:border-gray-500 opacity-60 hover:opacity-100'}`}
                  >
                    <div className="bg-gray-800 relative" style={{ aspectRatio: p.format === 'tv' ? '16/9' : '9/16' }}>
                      {imgThumb ? (
                        <img src={imgThumb} alt={p.title || ''} className="w-full h-full object-cover" />
                      ) : videoThumb ? (
                        <video src={videoThumb} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Volume2 size={10} className="text-gray-600" /></div>
                      )}
                      <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-center text-white py-0.5 truncate px-0.5">
                        {p.title || `${t('timeline.video')} ${i + 1}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right sidebar: Audio controls */}
        <div className="w-72 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto flex flex-col gap-4">
          {/* Back + title */}
          <div className="flex items-center gap-2">
            <button onClick={() => { if (isExporting) { alert(t('export.navigateWarning') || 'Export en cours ! Ne quittez pas cette page.'); return; } router.back(); }} className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition"><ChevronLeft size={16} className="text-gray-400" /></button>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-white truncate flex items-center gap-1.5">
                <Volume2 size={14} className="text-pink-500 shrink-0" /> {t('title')}
                {isBatch && <span className="text-[10px] font-normal bg-pink-600/30 text-pink-300 px-1.5 py-0.5 rounded-full ml-1">{t('batchLabel', { count: String(posts.length) })}</span>}
              </h2>
              <p className="text-[10px] text-gray-500 truncate">{isBatch ? t('batchVideoOf', { current: String(currentPostIndex + 1), total: String(posts.length), title: post.title }) : post.title}</p>
            </div>
          </div>

          {/* Batch navigation */}
          {isBatch && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPostIndex(i => Math.max(0, i - 1))}
                disabled={currentPostIndex === 0}
                className="flex-1 py-1.5 rounded-lg text-[10px] font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-30 transition text-center"
              >{`← ${t('previousVideo')}`}</button>
              <span className="text-[10px] text-gray-400 px-1">{currentPostIndex + 1}/{posts.length}</span>
              <button
                onClick={() => setCurrentPostIndex(i => Math.min(posts.length - 1, i + 1))}
                disabled={currentPostIndex === posts.length - 1}
                className="flex-1 py-1.5 rounded-lg text-[10px] font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-30 transition text-center"
              >{`${t('nextVideo')} →`}</button>
            </div>
          )}

          {/* Music */}
          <div className="bg-gray-800 rounded-xl p-3 border border-gray-700/50">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Music size={13} className="text-pink-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">{t('music.title')}</span>
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
                <Upload size={13} /> {t('music.import')}
              </button>
            )}
            <input ref={musicInputRef} type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
          </div>

          {/* Voice */}
          <div className="bg-gray-800 rounded-xl p-3 border border-gray-700/50">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Mic size={13} className="text-purple-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">{t('voice.title')}</span>
            </div>
            {/* Record */}
            {!isRecording ? (
              <button onClick={startRecording} className="w-full flex items-center justify-center gap-1.5 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white text-xs font-medium transition mb-2">
                <Mic size={13} /> {t('voice.record')}
              </button>
            ) : (
              <button onClick={stopRecording} className="w-full flex items-center justify-center gap-1.5 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white text-xs font-medium transition mb-2 animate-pulse">
                <Square size={13} /> {t('voice.stop')} ({fmt(recordingTime)})
              </button>
            )}
            {voiceFile ? (
              <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-2">
                <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center shrink-0">{recordedBlob ? <Mic size={12} className="text-white" /> : <Volume2 size={12} className="text-white" />}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{voiceName}</p>
                  <p className="text-[10px] text-gray-500">{recordedBlob ? `${fmt(recordingTime)}` : t('voice.file')}</p>
                </div>
                <button onClick={handleRemoveVoice} className="p-1 rounded hover:bg-red-500/20 text-red-400"><Trash2 size={12} /></button>
              </div>
            ) : (
              <button onClick={() => voiceInputRef.current?.click()} className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-gray-600 hover:border-purple-500 rounded-lg text-gray-400 hover:text-purple-400 transition text-xs">
                <Upload size={13} /> {t('voice.importFile')}
              </button>
            )}
            <input ref={voiceInputRef} type="file" accept="audio/*" className="hidden" onChange={handleVoiceUpload} />
          </div>

          {/* Destination + Export */}
          <div className="bg-gray-800 rounded-xl p-3 border border-gray-700/50">
            <span className="text-xs font-bold text-white uppercase tracking-wider mb-2 block">{t('destination.title')}</span>
            <div className="flex gap-1.5 mb-3">
              {([
                { v: 'calendar' as ExportDest, l: `📅 ${t('destination.calendar')}` },
                { v: 'desktop' as ExportDest, l: `💾 ${t('destination.desktop')}` },
                { v: 'both' as ExportDest, l: `🔄 ${t('destination.both')}` },
              ]).map(d => (
                <button key={d.v} onClick={() => setExportDest(d.v)} className={`flex-1 text-center px-1 py-2 rounded-lg font-medium text-[10px] transition border ${exportDest === d.v ? 'bg-pink-600/20 border-pink-500 text-white' : 'bg-gray-700 border-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                  {d.l}
                </button>
              ))}
            </div>

            <button onClick={handleExport} disabled={isExporting || !hasAudio} className="w-full relative overflow-hidden bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 disabled:opacity-40 text-white font-bold py-2.5 px-3 rounded-xl transition-all text-xs">
              {isExporting && <div className="absolute inset-0 bg-gradient-to-r from-pink-700 to-purple-700 transition-all duration-500" style={{ width: `${exportProgress}%` }} />}
              <span className="relative z-10 flex items-center justify-center gap-1.5">
                {isExporting ? <><Loader2 size={14} className="animate-spin" /> {Math.round(exportProgress)}%</> : <><Volume2 size={14} /> {isBatch ? t('export.exportBatch', { count: String(posts.length) }) : t('export.exportWithAudio')}</>}
              </span>
            </button>
            {!hasAudio && <p className="text-[10px] text-gray-500 text-center mt-1.5">{t('export.addAudioFirst')}</p>}
            {isExporting && exportStage && <p className="text-[10px] text-pink-400 text-center mt-1">{exportStage}</p>}
          </div>

          {/* Skip — hidden during export */}
          {!isExporting && (
            <button onClick={() => router.push('/dashboard/calendar')} className="flex items-center justify-center gap-1.5 py-2 text-xs text-gray-500 hover:text-gray-300 transition">
              {t('export.skipKeepWithoutAudio')}
            </button>
          )}
          {isExporting && (
            <p className="text-[10px] text-yellow-400/80 text-center py-2 animate-pulse">
              ⚠️ Ne quittez pas cette page pendant l&apos;export
            </p>
          )}
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
            <span className="text-[10px] text-pink-400 w-14 shrink-0 flex items-center gap-1"><Music size={10} /> {t('timeline.music')}</span>
            <button
              onClick={() => setMusicMuted(m => !m)}
              className="shrink-0 p-1 rounded hover:bg-gray-700/50 transition"
              title={musicMuted ? t('music.unmute') : t('music.mute')}
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
                  <span className="text-[9px] text-gray-600">{t('music.noMusic')}</span>
                </div>
              )}
            </div>
          </div>

          {/* Voice track with volume */}
          <div className="flex items-center gap-2 h-8">
            <span className="text-[10px] text-purple-400 w-14 shrink-0 flex items-center gap-1"><Mic size={10} /> {t('timeline.voice')}</span>
            <button
              onClick={() => setVoiceMuted(m => !m)}
              className="shrink-0 p-1 rounded hover:bg-gray-700/50 transition"
              title={voiceMuted ? t('voice.unmute') : t('voice.mute')}
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
                  <span className="text-[9px] text-gray-600">{t('voice.noVoice')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
