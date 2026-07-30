'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Music, Mic, Upload, Trash2, Volume2, VolumeX, Loader2, Play, Pause, Square, Sparkles, Image as ImageIcon, LayoutGrid, Film, Megaphone, SlidersHorizontal, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import { TTS_VOICES, synthesize, type TtsVoice } from '@/lib/tts/edge-tts-client';
import { fetchHeyGenVoices, isHeyGenVoiceId } from '@/lib/types/voice';
import { analyseRushForDucking, type AudioKeyframe } from '@/lib/creer/audioDucking';
import AudioMixer from './AudioMixer';

const VOICE_STORAGE_KEY = 'tts.voiceId';
const DEFAULT_VOICE_ID = 'fr-FR-DeniseNeural';

function loadInitialVoiceId(): string {
  if (typeof window === 'undefined') return DEFAULT_VOICE_ID;
  try {
    const saved = window.localStorage.getItem(VOICE_STORAGE_KEY);
    // Reject anything not in TTS_VOICES (e.g., legacy SpeechSynthesisVoice
    // names from before this lib was wired up). Silent fallback to Denise.
    // Les voix HeyGen sont listees a la volee : on les accepte sur leur
    // prefixe, sinon un rechargement perdrait la voix clonee choisie.
    if (saved && (isHeyGenVoiceId(saved) || TTS_VOICES.some((v) => v.id === saved))) return saved;
  } catch { /* ignore */ }
  return DEFAULT_VOICE_ID;
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
  /**
   * URL du rush — necessaire au mixeur unifie : l'auto-mix analyse sa piste
   * audio et l'ecoute du mixage la rejoue au bon moment.
   */
  rushUrl?: string | null;
  /**
   * Mixeur unifie (musique + voix off + son de la video en UN seul endroit).
   *
   * **Opt-in** : il ne s'affiche que si `onAudioKeyframesChange` est fourni.
   * Sans ce branchement, le panneau garde ses curseurs de volume par source —
   * c'est ce qui evite un doublon dans /creer, qui affiche deja son propre
   * `AudioDuckingTimeline` + `AudioMixPreview` sous le panneau.
   *
   * Quand il est branche, ce sont les keyframes qui pilotent l'export : le
   * compositeur ecrase le bus musique avec `kf.musicVolume`, automatise le bus
   * rush avec `kf.rushVolume` et le bus voix avec `kf.voiceVolume`.
   */
  audioKeyframes?: AudioKeyframe[];
  onAudioKeyframesChange?: (next: AudioKeyframe[]) => void;
  /**
   * Geometrie REELLE du montage, telle que l'export la verra.
   *
   * Obligatoire des que les sequences sont masquables ou reordonnables : les
   * durees brutes passees separement ignorent l'ordre et les sequences
   * desactivees, et la timeline decrirait alors un montage qui n'existe pas.
   */
  mixLayout?: {
    totalDuration: number;
    videoSeqStart: number;
    videoSeqDuration: number;
  };
}

export function AudioStudioPanel({
  musicUrl, musicName, voiceUrl, voiceName,
  musicVolume, voiceVolume,
  onMusicChange, onVoiceChange,
  onMusicVolumeChange, onVoiceVolumeChange,
  introDuration, cardsDuration, videoDuration, ctaDuration,
  onIntroDurationChange, onCardsDurationChange, onVideoDurationChange, onCtaDurationChange,
  hasRush, contentTheme,
  rushUrl = null, audioKeyframes, onAudioKeyframesChange, mixLayout,
}: AudioStudioPanelProps) {
  const [ttsText, setTtsText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(loadInitialVoiceId);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState('');
  const [ttsSuggestLoading, setTtsSuggestLoading] = useState(false);
  // Voix HeyGen du compte (voix clonee comprise), chargees a la volee.
  // Echec ou compte sans HeyGen → liste vide, le selecteur ne change pas.
  const [heygenVoices, setHeygenVoices] = useState<TtsVoice[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchHeyGenVoices().then((voices) => {
      if (!cancelled) setHeygenVoices(voices);
    });
    return () => { cancelled = true; };
  }, []);
  const allVoices: TtsVoice[] = [...heygenVoices, ...TTS_VOICES];
  useEffect(() => {
    try { window.localStorage.setItem(VOICE_STORAGE_KEY, selectedVoiceId); } catch { /* ignore */ }
  }, [selectedVoiceId]);
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

  // ── Progression de la synthese vocale ───────────────────────────────────
  // Ni synthesize() ni le PUT de stockage n'exposent d'octets transferes : la
  // progression est donc une rampe temporelle par etape, plafonnee tant que
  // l'etape n'est pas finie. Elle ne ment jamais en montrant 100 % avant la
  // fin — elle sature a 70 % (synthese) puis 95 % (upload).
  const [ttsProgress, setTtsProgress] = useState(0);
  const [ttsStage, setTtsStage] = useState<'idle' | 'synth' | 'upload' | 'done'>('idle');
  const ttsRampRef = useRef<NodeJS.Timeout | null>(null);

  const stopTtsRamp = useCallback(() => {
    if (ttsRampRef.current) { clearInterval(ttsRampRef.current); ttsRampRef.current = null; }
  }, []);

  /** Rampe asymptotique vers `ceiling` — avance vite au debut, ralentit ensuite. */
  const startTtsRamp = useCallback((ceiling: number) => {
    stopTtsRamp();
    ttsRampRef.current = setInterval(() => {
      setTtsProgress((p) => (p >= ceiling ? ceiling : p + Math.max(0.4, (ceiling - p) * 0.06)));
    }, 120);
  }, [stopTtsRamp]);

  // Un demontage pendant une generation laisserait l'intervalle tourner.
  useEffect(() => () => stopTtsRamp(), [stopTtsRamp]);

  // ── Mixeur unifie ───────────────────────────────────────────────────────
  const [mixerOpen, setMixerOpen] = useState(false);
  const [autoDuckRunning, setAutoDuckRunning] = useState(false);
  const [mixError, setMixError] = useState('');
  /** Geometrie du montage au moment du dernier auto-mix (voir `mixStale`). */
  const [autoMixSignature, setAutoMixSignature] = useState<string | null>(null);

  /** Le mixeur ne s'affiche que si le parent branche les keyframes. */
  const mixerEnabled = typeof onAudioKeyframesChange === 'function';

  /**
   * Fenetre temporelle du montage.
   *
   * ⚠️ Les durees brutes recues en props NE SUFFISENT PAS : une sequence peut
   * etre masquee (duree effective 0) ou reordonnee. Le parent qui autorise ca
   * doit fournir `mixLayout`, sinon la timeline et l'ecoute decrivent un
   * montage different de celui qui sera exporte (keyframe pose « au milieu »
   * atterrissant dans une autre sequence). La somme naive ci-dessous n'est
   * qu'un repli pour un parcours a 4 sequences fixes.
   */
  const videoSeqDuration = mixLayout ? mixLayout.videoSeqDuration : (hasRush ? videoDuration : 0);
  const videoSeqStart = mixLayout ? mixLayout.videoSeqStart : introDuration + cardsDuration;
  const totalDuration = mixLayout
    ? mixLayout.totalDuration
    : introDuration + cardsDuration + videoSeqDuration + ctaDuration;

  /**
   * Signature de la geometrie. Les temps d'un auto-mix sont cales sur le
   * montage tel qu'il etait ; changer une duree, masquer ou deplacer une
   * sequence apres coup decale toute la courbe sans que rien ne le signale.
   */
  const layoutSignature = `${videoSeqStart}|${videoSeqDuration}|${totalDuration}`;
  const mixStale = autoMixSignature !== null && autoMixSignature !== layoutSignature;

  /** Le rush ne compte comme source audio que si sa sequence est reellement jouee. */
  const rushInMix = !!rushUrl && hasRush && videoSeqDuration > 0;
  const hasAnyAudio = !!(musicUrl || voiceUrl || rushInMix);

  /**
   * Keyframe d'amorce : tant que l'utilisateur n'a rien touche, le parent n'a
   * AUCUN keyframe et l'export garde exactement le comportement actuel. Le
   * seed doit donc afficher CE que le compositeur ferait sans keyframes,
   * sinon le mixeur ment : cote compositeur le rush vaut 0.5 seulement s'il
   * y a une autre source audio, sinon 1.0 (video-composer.ts, `hasMixAudio`).
   *
   * Memoise : `AudioMixPreview` redemarre la lecture des que l'identite du
   * tableau change. Un tableau recree a chaque rendu — et le playhead en
   * recree un par frame — relancait la lecture ~60 fois par seconde.
   */
  const effectiveKeyframes = useMemo<AudioKeyframe[]>(() => {
    if (audioKeyframes && audioKeyframes.length > 0) return audioKeyframes;
    return [{
      id: 'mix-0',
      time: 0,
      musicVolume,
      rushVolume: (musicUrl || voiceUrl) ? 0.5 : 1.0,
      voiceVolume,
    }];
  }, [audioKeyframes, musicVolume, voiceVolume, musicUrl, voiceUrl]);

  // Volumes affiches par les mini-lecteurs : quand le mixeur pilote, ils
  // suivent le mixage, sinon les props historiques.
  const mixMusicVolume = mixerEnabled ? (effectiveKeyframes[0]?.musicVolume ?? musicVolume) : musicVolume;
  const mixVoiceVolume = mixerEnabled ? (effectiveKeyframes[0]?.voiceVolume ?? voiceVolume) : voiceVolume;

  const handleKeyframesChange = useCallback((next: AudioKeyframe[]) => {
    setMixError('');
    onAudioKeyframesChange?.(next);
  }, [onAudioKeyframesChange]);

  /**
   * Auto-mix : analyse la piste du rush et baisse la musique quand ca parle.
   *
   * Deux recalages indispensables, que l'analyseur ne peut pas faire seul :
   *   1. Ses temps partent du DEBUT DU FICHIER rush ; le compositeur, lui, les
   *      applique depuis le debut du MONTAGE. Sans decalage de `videoSeqStart`,
   *      la musique baisse pendant le titre et les cartes, et plus du tout
   *      pendant la video. On coupe aussi ce qui depasse la fenetre video.
   *   2. Les valeurs rendues sont absolues (0.25 / 1.0) : on les met a l'echelle
   *      du niveau de musique choisi, sinon l'auto-mix ecrase le reglage
   *      manuel. Le niveau de voix off est preserve tel quel ; le niveau du
   *      rush, lui, est bien remplace par la courbe analysee — c'est l'objet
   *      meme de l'auto-mix.
   */
  const runAutoDuck = useCallback(async () => {
    if (!rushUrl || videoSeqDuration <= 0) return;
    setAutoDuckRunning(true);
    setMixError('');
    try {
      const raw = await analyseRushForDucking(rushUrl);
      const inWindow = raw.filter((k) => k.time < videoSeqDuration);
      if (inWindow.length === 0) {
        setMixError('Aucune variation detectee dans le rush — niveaux inchanges');
        return;
      }
      const baseMusic = effectiveKeyframes[0]?.musicVolume ?? musicVolume;
      const keepVoice = effectiveKeyframes[0]?.voiceVolume ?? voiceVolume;
      const shifted: AudioKeyframe[] = inWindow.map((k, i) => ({
        id: `mix-auto-${i}`,
        time: videoSeqStart + k.time,
        musicVolume: k.musicVolume * baseMusic,
        rushVolume: k.rushVolume,
        voiceVolume: keepVoice,
      }));
      // Avant la sequence video : musique au niveau choisi, rien a ducker.
      //
      // ⚠️ Uniquement si la video ne commence PAS a 0 : l'analyseur pose
      // toujours un keyframe a t=0, et quand la sequence video est la premiere
      // ce keyframe EST le premier duck. Un head a `baseMusic` le remplacerait
      // et rendrait la courbe plate — l'auto-mix ne duckerait plus rien.
      const head: AudioKeyframe[] = videoSeqStart > 0
        ? [{
            id: 'mix-auto-head',
            time: 0,
            musicVolume: baseMusic,
            rushVolume: shifted[0].rushVolume,
            voiceVolume: keepVoice,
          }]
        : [];
      // Apres : on remonte la musique, le rush ne joue plus.
      const tailTime = videoSeqStart + videoSeqDuration;
      const tail: AudioKeyframe[] = tailTime < totalDuration
        ? [{ id: 'mix-auto-tail', time: tailTime, musicVolume: baseMusic, rushVolume: shifted[shifted.length - 1].rushVolume, voiceVolume: keepVoice }]
        : [];
      const body = head.length > 0 ? shifted.filter((k) => k.time > 0) : shifted;
      onAudioKeyframesChange?.([...head, ...body, ...tail]);
      // Signature de la geometrie au moment de l'analyse : si les durees ou
      // l'ordre changent ensuite, la courbe ne colle plus au montage et on
      // previent au lieu de laisser exporter un ducking decale.
      setAutoMixSignature(layoutSignature);
    } catch (err) {
      console.error('[AudioPanel] auto-mix failed:', err);
      setMixError('Analyse du rush impossible — regle les niveaux a la main');
    } finally {
      setAutoDuckRunning(false);
    }
  }, [rushUrl, videoSeqStart, videoSeqDuration, totalDuration, layoutSignature, effectiveKeyframes, musicVolume, voiceVolume, onAudioKeyframesChange]);

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
    setTtsLoading(true);
    setTtsError('');
    setTtsProgress(0);
    setTtsStage('synth');
    startTtsRamp(70);
    try {
      const voice = allVoices.find((v) => v.id === selectedVoiceId);
      const voiceLabel = voice?.name || 'Voix';

      // synthesize() handles the full chain: OpenAI (if openai-* id) →
      // Edge → browser SpeechSynthesis. Returns a Blob (mp3 or webm).
      const blob = await synthesize(ttsText, selectedVoiceId);

      if (!blob || blob.size < 50) {
        setTtsError('Synthèse vocale indisponible — réessaie ou choisis une autre voix');
        return;
      }

      // Synthese terminee : on quitte le plafond des 70 % pour l'upload.
      setTtsStage('upload');
      setTtsProgress((p) => Math.max(p, 70));
      startTtsRamp(95);

      const isWebm = blob.type.includes('webm');
      const ext = isWebm ? 'webm' : 'mp3';
      const contentType = isWebm ? 'audio/webm' : 'audio/mpeg';
      const localUrl = URL.createObjectURL(blob);
      const file = new File([blob], `tts-${Date.now()}.${ext}`, { type: contentType });

      try {
        const uploadRes = await fetch('/api/upload/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType, purpose: 'voice' }),
        });
        const uploadData = await uploadRes.json();
        if (uploadData.success) {
          await fetch(uploadData.signedUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
          setTtsProgress(100);
          setTtsStage('done');
          onVoiceChange(uploadData.publicUrl, `TTS — ${voiceLabel}`);
          return;
        }
      } catch { /* fall through to local URL */ }
      setTtsProgress(100);
      setTtsStage('done');
      onVoiceChange(localUrl, `TTS — ${voiceLabel}`);
    } catch (err: any) {
      console.error('[AudioPanel] TTS error:', err);
      setTtsError(err.message || 'Erreur de synthèse vocale');
    } finally {
      // Toujours arreter la rampe, meme sur erreur : sinon la barre continue
      // d'avancer alors que plus rien ne tourne (cf. lecons, regle 6).
      stopTtsRamp();
      setTtsLoading(false);
      setTtsStage((s) => (s === 'done' ? 'done' : 'idle'));
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
            <MiniPlayer src={musicUrl} onDelete={() => onMusicChange(null, '')} volume={musicMuted ? 0 : mixMusicVolume} />
            {/* Curseur par source — masque quand le mixeur unifie est branche :
                c'est tout l'objet du bouton « Mixer », ne plus regler le volume
                a plusieurs endroits. */}
            {!mixerEnabled && (
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 w-8">Vol.</span>
                <input type="range" min={0} max={1} step={0.05} value={musicMuted ? 0 : musicVolume}
                  onChange={(e) => { onMusicVolumeChange(Number(e.target.value)); setMusicMuted(false); }}
                  className="flex-1 accent-purple-500" />
                <span className="text-[9px] text-gray-400 w-8 text-right">{Math.round((musicMuted ? 0 : musicVolume) * 100)}%</span>
              </div>
            )}
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
            <MiniPlayer src={voiceUrl} onDelete={() => onVoiceChange(null, '')} volume={voiceMuted ? 0 : mixVoiceVolume} />
            {/* Idem musique : un seul endroit pour les niveaux quand le
                mixeur unifie est branche. */}
            {!mixerEnabled && (
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 w-8">Vol.</span>
                <input type="range" min={0} max={1} step={0.05} value={voiceMuted ? 0 : voiceVolume}
                  onChange={(e) => { onVoiceVolumeChange(Number(e.target.value)); setVoiceMuted(false); }}
                  className="flex-1 accent-purple-500" />
                <span className="text-[9px] text-gray-400 w-8 text-right">{Math.round((voiceMuted ? 0 : voiceVolume) * 100)}%</span>
              </div>
            )}
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

      {/* ── Mixer unifié ──
          Un seul bouton pour les trois niveaux (musique, voix off, son de la
          vidéo). Il remplace les curseurs par source ci-dessus. Le contenu
          réutilise tel quel AudioDuckingTimeline (3 niveaux globaux +
          auto-mix) et AudioMixPreview (écoute du mixage réel). */}
      {mixerEnabled && (
        <div className="border-t border-gray-700 pt-3">
          <button
            onClick={() => setMixerOpen((v) => !v)}
            disabled={!hasAnyAudio}
            className={`w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${
              hasAnyAudio
                ? 'bg-purple-600/20 border border-purple-500/40 text-white hover:bg-purple-600/30'
                : 'border border-gray-700 text-gray-500 cursor-not-allowed'
            }`}
            title={hasAnyAudio
              ? 'Régler musique, voix off et son de la vidéo au même endroit'
              : 'Ajoute une musique, une voix off ou un rush pour mixer'}
          >
            <SlidersHorizontal size={14} className={hasAnyAudio ? 'text-purple-300' : ''} />
            <span className="flex-1 text-left">Mixer</span>
            <span className="text-[9px] font-normal text-gray-400">musique · voix · vidéo</span>
            {mixerOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>

          {mixerOpen && hasAnyAudio && (
            <>
              {/* UN seul bloc. `AudioMixer` porte une ligne par piste
                  (volume + coupure), un seul bouton de lecture, et replie
                  auto-mix et keyframes derriere « Avance ». Il reutilise
                  `AudioDuckingTimeline` et `AudioMixPreview` tels quels :
                  rien n'est retire, tout est reagence. */}
              <AudioMixer
                keyframes={effectiveKeyframes}
                onChange={handleKeyframesChange}
                totalDuration={totalDuration}
                rushUrl={rushInMix ? rushUrl : null}
                musicUrl={musicUrl}
                voiceUrl={voiceUrl}
                autoDuckRunning={autoDuckRunning}
                onAutoDuck={runAutoDuck}
                introDuration={introDuration}
                cardsDuration={cardsDuration}
                ctaDuration={ctaDuration}
                videoSeqStart={videoSeqStart}
                videoSeqDuration={videoSeqDuration}
              />
              {mixError && (
                <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-amber-400" />
                  <p className="text-[10px] text-amber-200 leading-snug">{mixError}</p>
                </div>
              )}
              {mixStale && !mixError && (
                <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-amber-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-amber-200 leading-snug">
                      Les durées ont changé depuis l&apos;auto-mix : la courbe ne tombe plus au bon moment.
                    </p>
                    <button
                      onClick={runAutoDuck}
                      disabled={autoDuckRunning || !rushInMix}
                      className="mt-1 text-[10px] font-medium text-amber-100 underline underline-offset-2 hover:text-white disabled:opacity-50"
                    >
                      Relancer l&apos;auto-mix
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

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
        <textarea value={ttsText} onChange={(e) => { setTtsText(e.target.value); setTtsError(''); setTtsStage('idle'); setTtsProgress(0); }} placeholder="Tapez votre texte ici..."
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none resize-none" rows={3} />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <select value={selectedVoiceId} onChange={(e) => setSelectedVoiceId(e.target.value)}
            className="flex-1 min-w-[140px] rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white">
            {allVoices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.flag} {v.name} ({v.lang}, {v.gender === 'Female' ? 'F' : 'M'})
              </option>
            ))}
          </select>
          <button onClick={generateTTS} disabled={ttsLoading || !ttsText.trim()}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition">
            {ttsLoading ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />} Générer
          </button>
        </div>

        {/* Progression de la génération — étapes nommées + pourcentage.
            Le pourcentage sature tant que l'étape n'est pas finie, il
            n'atteint 100 % qu'une fois le fichier réellement disponible. */}
        {(ttsLoading || ttsStage === 'done') && (
          <div className="mt-2 rounded-lg bg-gray-800/70 px-2.5 py-2">
            <div className="flex items-center justify-between text-[9px] mb-1">
              <span className="flex items-center gap-1.5 text-gray-300">
                {ttsStage === 'done'
                  ? <Sparkles size={10} className="text-emerald-400" />
                  : <Loader2 size={10} className="animate-spin text-purple-400" />}
                {ttsStage === 'synth' && 'Synthèse de la voix…'}
                {ttsStage === 'upload' && 'Envoi du fichier audio…'}
                {ttsStage === 'done' && 'Voix off prête'}
              </span>
              <span className="font-mono tabular-nums text-gray-400">{Math.round(ttsProgress)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden">
              <div
                className={`h-full rounded-full ${ttsStage === 'done' ? 'bg-emerald-500' : 'bg-purple-500'}`}
                style={{ width: `${Math.min(100, Math.max(2, ttsProgress))}%`, transition: 'width 150ms linear' }}
              />
            </div>
          </div>
        )}

        {ttsError && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-red-400" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-red-300 leading-snug">{ttsError}</p>
              <button
                onClick={generateTTS}
                disabled={ttsLoading || !ttsText.trim()}
                className="mt-1 text-[10px] font-medium text-red-200 underline underline-offset-2 hover:text-white disabled:opacity-50"
              >
                Réessayer
              </button>
            </div>
          </div>
        )}
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
