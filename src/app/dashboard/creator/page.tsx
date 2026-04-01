'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  ChevronLeft,
  Upload,
  Loader2,
  Plus,
  X,
  Volume2,
  Zap,
  Music,
  Sparkles,
  Search,
  Image as ImageIcon,
  Film,
  Mic,
  Eye,
  GripVertical,
  Play,
  Pause,
  Type,
} from 'lucide-react';
// Edge TTS removed - voice-off via mic recording or file upload
import { useBranding } from '@/lib/hooks/useBranding';
import BrandingPanel from '@/components/BrandingPanel';
import { composeAndUpload, downloadBlob } from '@/lib/video-composer';
import { detectClips, extractClip, type DetectedClip } from '@/lib/clip-detector';

// ---- Types ----

interface VideoRush {
  id: string;
  file?: File;
  previewUrl?: string;
  title?: string;
  // Clip detection results
  detectedClips?: DetectedClip[];
  selectedClipId?: string; // ID of selected clip, or 'full' for full video
  isAnalyzing?: boolean;
  analyzeProgress?: number;
}

interface TextCard {
  id: string;
  text: string;
  color: string;
  fontSize: 'sm' | 'md' | 'lg';
  fontFamily: string;
  position: number; // index in the timeline
}

const FONT_OPTIONS = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Mono' },
  { value: "'Georgia', serif", label: 'Georgia' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet' },
  { value: "'Impact', sans-serif", label: 'Impact' },
];

interface PexelsPhoto {
  id: number;
  url: string;
  medium: string;
  small: string;
  photographer: string;
  alt: string;
}

type VoiceMode = 'none' | 'edge' | 'upload';

interface Toast {
  message: string;
  type: 'success' | 'error';
}

interface UserObjective {
  id: string;
  name: string;
  description: string;
  platform: string;
  tone: string;
  target_audience: string;
}

// ---- Constants ----

const STEP_LABELS = ['Format & Objectif', 'Médias & Voix', 'Personnalisation', 'Aperçu & Export'];
const STEP_COLORS = ['bg-red-500', 'bg-pink-500', 'bg-purple-500', 'bg-gray-500'];

const FORMAT_OPTIONS = [
  { value: 'reel', label: 'Reel 9:16', icon: '📱' },
  { value: 'tv', label: 'TV 16:9', icon: '📺' },
];

const MODE_OPTIONS = [
  { value: 'cardio', label: 'Cardio / Dynamique' },
  { value: 'testimony', label: 'Témoignage / Clean' },
];

const DEFAULT_OBJECTIVES = [
  { value: 'promotion', label: 'Promotion' },
  { value: 'subscription', label: 'Abonnement' },
  { value: 'motivation', label: 'Motivation' },
  { value: 'benefits', label: 'Bienfaits' },
  { value: 'nutrition', label: 'Nutrition' },
];

export default function CreatorPage() {
  useSession();
  const router = useRouter();
  const { branding, setBranding } = useBranding();

  // Step navigation
  const [step, setStep] = useState(0);

  // Step 0: Config
  const [format, setFormat] = useState('reel');
  const [mode, setMode] = useState('cardio');
  const [objective, setObjective] = useState('promotion');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');

  // Dynamic objectives from API
  const [userObjectives, setUserObjectives] = useState<UserObjective[]>([]);
  const [loadingObjectives, setLoadingObjectives] = useState(true);

  // Step 1: Médias
  const [videoRushes, setVideoRushes] = useState<VideoRush[]>([
    { id: 'rush-0' },
    { id: 'rush-1' },
    { id: 'rush-2' },
  ]);
  const [textCards, setTextCards] = useState<TextCard[]>([]);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  // Global text settings
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [globalTextColor, setGlobalTextColor] = useState('#7C3AED');
  const [globalFontFamily, setGlobalFontFamily] = useState('sans-serif');
  const [globalFontSize, setGlobalFontSize] = useState<'sm' | 'md' | 'lg'>('md');

  // Character / Personnage
  const [characterTab, setCharacterTab] = useState<'upload' | 'ai'>('upload');
  const [characterImage, setCharacterImage] = useState<File | null>(null);
  const [characterPreview, setCharacterPreview] = useState<string | null>(null);
  const [characterPrompt, setCharacterPrompt] = useState('');
  const [pexelsResults, setPexelsResults] = useState<PexelsPhoto[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [selectedPexelsUrl, setSelectedPexelsUrl] = useState<string | null>(null);

  // Music
  const [backgroundMusic, setBackgroundMusic] = useState<File | null>(null);
  const [musicName, setMusicName] = useState('');

  // Voice
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('none');
  const [ttsVoice, setTtsVoice] = useState('fr-FR-DeniseNeural');
  const [ttsText, setTtsText] = useState('');
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);

  const [voiceOverFile, setVoiceOverFile] = useState<File | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const voiceMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);  const [generatedVoiceUrl, setGeneratedVoiceUrl] = useState<string | null>(null);
  const [generatedVoiceBlob, setGeneratedVoiceBlob] = useState<Blob | null>(null);
  const [voiceUploadFile, setVoiceUploadFile] = useState<File | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);

  // Logo
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Personnalisation
  const [batchCount, setBatchCount] = useState(2);
  const [destination, setDestination] = useState('calendar');
  const [salesPhrase, setSalesPhrase] = useState('');

  // Step 3: Render
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');

  // Drag & drop reorder
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number; idx: number } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Music preview
  const [musicPreviewUrl, setMusicPreviewUrl] = useState<string | null>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);

  // UI
  const [toast, setToast] = useState<Toast | null>(null);

  // Clip detection modal
  const [clipModalRushId, setClipModalRushId] = useState<string | null>(null);

  // Montage preview (like Infographie "Lire le montage")
  const [previewSeqIndex, setPreviewSeqIndex] = useState(0);
  const [previewAutoPlay, setPreviewAutoPlay] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previewProgressRef = useRef<NodeJS.Timeout | null>(null);

  // Refs
  const rushInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const characterInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  // Cleanup
  useEffect(() => {
    return () => {
      videoRushes.forEach((r) => {
        if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
      });
      if (characterPreview) URL.revokeObjectURL(characterPreview);
      if (generatedVoiceUrl) URL.revokeObjectURL(generatedVoiceUrl);
    };
  }, []);

  // Fetch user objectives from API
  useEffect(() => {
    const fetchObjectives = async () => {
      try {
        const res = await fetch('/api/user/objectives');
        const data = await res.json();
        if (data.success && data.data && data.data.length > 0) {
          setUserObjectives(data.data);
          setObjective(data.data[0].id);
        }
      } catch {
        // Fallback to default objectives
      } finally {
        setLoadingObjectives(false);
      }
    };
    fetchObjectives();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = (message: string, type: 'success' | 'error' = 'error') => setToast({ message, type });

  // Montage sequences definition (like Infographie page)
  const montageSequences = [
    { id: 'intro', type: 'intro', label: 'Affiche + Titre', duration: 5, color: '#ec4899', icon: '🖼️' },
    { id: 'cards', type: 'cards', label: 'Cartes Texte', duration: 6, color: '#a855f7', icon: '📊' },
    { id: 'video', type: 'video', label: 'Vidéo Rush', duration: 10, color: '#3b82f6', icon: '🎬' },
    { id: 'cta', type: 'cta', label: 'CTA', duration: 5, color: '#22c55e', icon: '📢' },
  ];
  const activeMontageSequences = montageSequences.filter(s => s.type !== 'video' || videoRushes.some(r => r.file));
  const montageTotalDuration = activeMontageSequences.reduce((s, x) => s + x.duration, 0);

  // Auto-play montage preview
  useEffect(() => {
    if (!previewAutoPlay) {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      if (previewProgressRef.current) clearInterval(previewProgressRef.current);
      return;
    }
    const currentDur = (activeMontageSequences[previewSeqIndex]?.duration || 5) * 1000;
    let elapsed = 0;
    if (previewProgressRef.current) clearInterval(previewProgressRef.current);
    setPreviewProgress(0);
    previewProgressRef.current = setInterval(() => { elapsed += 50; setPreviewProgress(Math.min(100, (elapsed / currentDur) * 100)); }, 50);
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      if (previewSeqIndex < activeMontageSequences.length - 1) setPreviewSeqIndex(previewSeqIndex + 1);
      else setPreviewSeqIndex(0);
    }, currentDur);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); if (previewProgressRef.current) clearInterval(previewProgressRef.current); };
  }, [previewAutoPlay, previewSeqIndex, videoRushes]);

  // Render a sequence preview panel (like Infographie)
  const renderMontageSequence = (seqType: string) => {
    const accent = branding.accentColor || '#D91CD2';
    const bgImg = characterPreview || videoRushes.find(r => r.previewUrl)?.previewUrl;

    if (seqType === 'intro') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {bgImg ? <img src={typeof bgImg === 'string' ? bgImg : ''} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div className="absolute inset-0 bg-gradient-to-b from-black to-purple-950" />}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-purple-950/80" />
          <div className="absolute inset-0" style={{ background: bgImg ? 'linear-gradient(to top, rgba(100,0,140,0.8) 0%, rgba(0,0,0,0.3) 40%, transparent 65%)' : 'transparent' }} />
          <div className="relative z-10 text-center px-3">
            <h3 className="text-sm font-black text-white uppercase tracking-wider leading-tight" style={{ textShadow: `0 0 12px ${accent}CC, 0 0 30px ${accent}66` }}>{title || 'TITRE'}</h3>
            {subtitle && <p className="text-[8px] text-white/80 mt-1" style={{ textShadow: `0 0 8px ${accent}80` }}>{subtitle}</p>}
            <div className="w-8 h-0.5 mt-1.5 mx-auto rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
          </div>
        </div>
      );
    }

    if (seqType === 'cards') {
      const visibleCards = textCards.filter(c => c.text.trim()).slice(0, 4);
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="absolute inset-0 bg-gradient-to-b from-purple-950 to-black" />
          <div className="relative z-10 w-full px-3 space-y-1">
            <p className="text-[7px] font-bold text-white/60 uppercase tracking-widest text-center mb-1">Informations</p>
            {visibleCards.length > 0 ? visibleCards.map((card, i) => (
              <div key={i} className="flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-lg px-2 py-1 border-l-2" style={{ borderColor: card.color }}>
                <span className="text-[8px] text-white font-bold" style={{ fontFamily: card.fontFamily }}>{card.text}</span>
              </div>
            )) : (
              <div className="text-center py-4">
                <Type size={16} className="text-gray-600 mx-auto mb-1" />
                <p className="text-[8px] text-gray-500">Ajoutez des cartes texte</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (seqType === 'video') {
      const firstRush = videoRushes.find(r => r.previewUrl);
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {firstRush?.previewUrl ? (
            <video src={firstRush.previewUrl} className="absolute inset-0 w-full h-full object-cover" muted loop autoPlay playsInline />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-b from-gray-900 to-black flex items-center justify-center">
              <div className="text-center">
                <Film size={20} className="text-gray-600 mx-auto mb-1" />
                <p className="text-[8px] text-gray-500">Aucune vidéo</p>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (seqType === 'cta') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: `linear-gradient(135deg, ${accent}CC, #FF2DAA99, ${accent}66)` }}>
          <div className="text-center px-3">
            <p className="text-xs font-black text-white uppercase tracking-wider mb-1" style={{ textShadow: `0 0 15px ${accent}` }}>
              {branding.ctaText || 'CHAT POUR PLUS D\'INFOS'}
            </p>
            <p className="text-[7px] text-white/70 uppercase tracking-wider">{branding.ctaSubText || 'LIEN EN BIO'}</p>
            {salesPhrase && <p className="text-[8px] text-white/90 mt-1 italic font-medium">{salesPhrase}</p>}
            {branding.watermarkText && <p className="text-[5px] text-white/30 mt-2 tracking-[0.15em]">{branding.watermarkText}</p>}
          </div>
        </div>
      );
    }

    return null;
  };

  // AI sales phrase generator
  const generateSalesPhrase = () => {
    const phrases: Record<string, string[]> = {
      promotion: [
        'Offre limitée ! Réserve ta place maintenant',
        'Profite de -20% cette semaine seulement',
        'Ne rate pas cette opportunité unique',
        'Rejoins-nous et transforme ta vie',
      ],
      subscription: [
        'Abonne-toi et ne rate rien !',
        'Rejoins notre communauté maintenant',
        'Active la cloche pour ne rien manquer',
        'Follow pour du contenu exclusif',
      ],
      motivation: [
        'Ton futur commence maintenant',
        'Chaque jour est une nouvelle chance',
        'Tu es plus fort que tu ne le crois',
        'Dépasse tes limites aujourd\'hui',
      ],
      benefits: [
        'Découvre les bienfaits incroyables',
        'Ton corps te remerciera',
        'Les résultats parlent d\'eux-mêmes',
        'Transforme ton quotidien en 30 jours',
      ],
      nutrition: [
        'Mange sain, vis mieux',
        'La nutrition est la clé du succès',
        'Fuel ton corps avec le meilleur',
        'Des recettes qui changent tout',
      ],
    };
    const objectivePhrases = phrases[objective] || phrases['promotion'] || [];
    const allPhrases = [...objectivePhrases, ...phrases['motivation'] || []];
    const random = allPhrases[Math.floor(Math.random() * allPhrases.length)];
    setSalesPhrase(random);
    showToast('Phrase générée !', 'success');
  };

  const generateTitleSubtitle = () => {
    const data: Record<string, { titles: string[]; subtitles: string[] }> = {
      promotion: {
        titles: ['OFFRE EXCLUSIVE', 'PROMO FLASH', 'BON PLAN', 'DEAL DU JOUR', 'OFFRE LIMITÉE'],
        subtitles: ['Ne rate pas cette offre incroyable', 'Profite avant qu\'il soit trop tard', 'Une opportunité à saisir maintenant'],
      },
      subscription: {
        titles: ['ABONNE-TOI', 'REJOINS-NOUS', 'FOLLOW NOW', 'ON T\'ATTEND'],
        subtitles: ['Rejoins la communauté maintenant', 'Du contenu exclusif chaque jour', 'Active la cloche pour ne rien manquer'],
      },
      motivation: {
        titles: ['C\'EST TON MOMENT', 'LÈVE-TOI', 'NO EXCUSES', 'DÉPASSE-TOI', 'GO GO GO'],
        subtitles: ['Ton futur commence aujourd\'hui', 'Chaque jour est une nouvelle chance', 'Tu es capable de tout'],
      },
      benefits: {
        titles: ['LES BIENFAITS', 'DÉCOUVRE', 'TOP RÉSULTATS', 'LE SECRET'],
        subtitles: ['Des résultats visibles rapidement', 'Ton corps va te remercier', 'La science a prouvé que...'],
      },
      nutrition: {
        titles: ['MANGE MIEUX', 'RECETTE DU JOUR', 'NUTRITION', 'HEALTHY LIFE'],
        subtitles: ['La clé d\'une vie saine', 'Des recettes simples et efficaces', 'Transforme ton alimentation'],
      },
    };

    // Try exact match first, then match by name for user-created objectives
    let match = data[objective];
    if (!match) {
      const obj = userObjectives.find((o) => o.id === objective);
      if (obj) {
        const lowerName = obj.name.toLowerCase();
        for (const key of Object.keys(data)) {
          if (lowerName.includes(key)) { match = data[key]; break; }
        }
      }
    }
    if (!match) match = data['promotion'];

    const title = match.titles[Math.floor(Math.random() * match.titles.length)];
    const subtitle = match.subtitles[Math.floor(Math.random() * match.subtitles.length)];
    setTitle(title);
    setSubtitle(subtitle);
    showToast('Titre & sous-titre générés !', 'success');
  };

  // ---- Handlers ----

  const handleRushUpload = (rushId: string, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setVideoRushes((prev) =>
      prev.map((r) => {
        if (r.id !== rushId) return r;
        if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
        return { ...r, file, previewUrl, title: file.name.replace(/\.[^.]+$/, ''), selectedClipId: 'full', detectedClips: undefined, isAnalyzing: false };
      })
    );

    // Auto-analyze video for clip detection (>5s videos)
    if (file.type.startsWith('video/') && file.size > 500_000) {
      analyzeRushClips(rushId, file);
    }
  };

  const analyzeRushClips = async (rushId: string, file: File) => {
    setVideoRushes((prev) => prev.map((r) => r.id === rushId ? { ...r, isAnalyzing: true, analyzeProgress: 0 } : r));
    try {
      const result = await detectClips(file, {
        maxClips: 5,
        minClipDuration: 2,
        maxClipDuration: 12,
        sampleInterval: 0.3,
        onProgress: (pct) => {
          setVideoRushes((prev) => prev.map((r) => r.id === rushId ? { ...r, analyzeProgress: pct } : r));
        },
      });
      setVideoRushes((prev) => prev.map((r) =>
        r.id === rushId ? { ...r, detectedClips: result.clips, isAnalyzing: false, analyzeProgress: 100 } : r
      ));
    } catch (err) {
      console.error('[ClipDetector] Analysis failed:', err);
      setVideoRushes((prev) => prev.map((r) => r.id === rushId ? { ...r, isAnalyzing: false } : r));
    }
  };

  const handleSelectClip = async (rushId: string, clipId: string) => {
    // Mark selected immediately
    setVideoRushes((prev) => prev.map((r) => r.id === rushId ? { ...r, selectedClipId: clipId } : r));

    // If 'full' selected, restore original file
    const rush = videoRushes.find((r) => r.id === rushId);
    if (!rush?.file || !rush.detectedClips) return;

    if (clipId === 'full') {
      // Restore original preview
      const previewUrl = URL.createObjectURL(rush.file);
      setVideoRushes((prev) => prev.map((r) => {
        if (r.id !== rushId) return r;
        if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
        return { ...r, previewUrl, selectedClipId: 'full' };
      }));
      showToast('Vidéo complète sélectionnée', 'success');
      return;
    }

    // Extract the selected clip segment
    const clip = rush.detectedClips.find((c) => c.id === clipId);
    if (!clip) return;

    setVideoRushes((prev) => prev.map((r) => r.id === rushId ? { ...r, isAnalyzing: true, analyzeProgress: 0 } : r));
    try {
      const clipFile = await extractClip(rush.file, clip.startTime, clip.endTime, (pct) => {
        setVideoRushes((prev) => prev.map((r) => r.id === rushId ? { ...r, analyzeProgress: pct } : r));
      });
      const previewUrl = URL.createObjectURL(clipFile);
      setVideoRushes((prev) => prev.map((r) => {
        if (r.id !== rushId) return r;
        if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
        return { ...r, file: clipFile, previewUrl, isAnalyzing: false, analyzeProgress: 100, selectedClipId: clipId, title: clip.label };
      }));
      showToast(`Clip "${clip.label}" extrait (${clip.duration}s)`, 'success');
    } catch (err) {
      console.error('[ClipExtract] Failed:', err);
      setVideoRushes((prev) => prev.map((r) => r.id === rushId ? { ...r, isAnalyzing: false } : r));
      showToast('Erreur lors de l\'extraction du clip', 'error');
    }
  };

  const handleRemoveRush = (id: string) => {
    setVideoRushes((prev) => {
      const rush = prev.find((r) => r.id === id);
      if (rush?.previewUrl) URL.revokeObjectURL(rush.previewUrl);
      return prev.filter((r) => r.id !== id);
    });
  };

  const handleAddRush = () => {
    if (videoRushes.length < 10) {
      setVideoRushes((prev) => [...prev, { id: `rush-${Date.now()}` }]);
    }
  };

  // Generate text for a card based on objective
  const generateCardText = (): string => {
    const texts: Record<string, string[]> = {
      promotion: ['OFFRE SPÉCIALE', 'PROMO -30%', 'DEAL EXCLUSIF', 'FLASH SALE', 'PRIX CASSÉ', 'PROFITEZ-EN'],
      subscription: ['ABONNE-TOI', 'FOLLOW NOW', 'REJOINS-NOUS', 'NE RATE RIEN', 'CLIQUE ICI', 'LINK IN BIO'],
      motivation: ['TU PEUX LE FAIRE', 'NO LIMIT', 'GO HARD', 'DÉPASSE-TOI', 'BELIEVE', 'NEVER GIVE UP'],
      benefits: ['RÉSULTATS', 'AVANT / APRÈS', 'EFFICACE', 'PROUVÉ', 'TOP QUALITÉ', 'GARANTIE'],
      nutrition: ['RECETTE DU JOUR', 'HEALTHY', 'PROTÉINES', 'CLEAN EATING', 'MEAL PREP', 'NUTRITION'],
    };
    let options = texts[objective];
    if (!options) {
      const obj = userObjectives.find((o) => o.id === objective);
      if (obj) {
        const lowerName = obj.name.toLowerCase();
        for (const key of Object.keys(texts)) {
          if (lowerName.includes(key)) { options = texts[key]; break; }
        }
      }
    }
    if (!options) options = texts['promotion'];
    return options[Math.floor(Math.random() * options.length)];
  };

  // Text card handlers
  const handleAddTextCard = (position: number) => {
    const newCard: TextCard = {
      id: `card-${Date.now()}`,
      text: generateCardText(),
      color: globalTextColor,
      fontSize: globalFontSize,
      fontFamily: globalFontFamily,
      position,
    };
    setTextCards((prev) => [...prev, newCard]);
    setEditingCardId(newCard.id);
  };

  const handleUpdateTextCard = (id: string, updates: Partial<TextCard>) => {
    setTextCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const handleRemoveTextCard = (id: string) => {
    setTextCards((prev) => prev.filter((c) => c.id !== id));
    if (editingCardId === id) setEditingCardId(null);
  };

  // Apply global settings to all text cards
  const applyGlobalSettings = () => {
    setTextCards((prev) =>
      prev.map((c) => ({ ...c, color: globalTextColor, fontFamily: globalFontFamily, fontSize: globalFontSize }))
    );
    showToast('Paramètres appliqués à toutes les cartes', 'success');
  };

  // ---- Drag & Drop reorder ----
  const handleDragStart = (idx: number) => {
    setDragIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  };

  const handleDrop = (idx: number) => {
    if (dragIndex === null || dragIndex === idx) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    setVideoRushes((prev) => {
      const updated = [...prev];
      const [removed] = updated.splice(dragIndex, 1);
      updated.splice(idx, 0, removed);
      return updated;
    });
    // Also update text card positions
    setTextCards((prev) =>
      prev.map((c) => {
        if (c.position === dragIndex) return { ...c, position: idx };
        if (dragIndex < idx) {
          if (c.position > dragIndex && c.position <= idx) return { ...c, position: c.position - 1 };
        } else {
          if (c.position >= idx && c.position < dragIndex) return { ...c, position: c.position + 1 };
        }
        return c;
      })
    );
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // Touch drag for mobile
  const handleTouchStart = (idx: number, e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY, idx };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos.current || !timelineRef.current) return;
    const touch = e.touches[0];
    const children = Array.from(timelineRef.current.children) as HTMLElement[];
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right) {
        setDragOverIndex(i);
        break;
      }
    }
  };

  const handleTouchEnd = () => {
    if (touchStartPos.current !== null && dragOverIndex !== null) {
      handleDrop(dragOverIndex);
    }
    touchStartPos.current = null;
    setDragOverIndex(null);
  };

  // ---- Music preview ----
  const handleMusicTogglePlay = () => {
    if (!musicPreviewUrl) return;
    if (musicAudioRef.current) {
      if (isMusicPlaying) {
        musicAudioRef.current.pause();
        setIsMusicPlaying(false);
      } else {
        musicAudioRef.current.play();
        setIsMusicPlaying(true);
      }
    } else {
      const audio = new Audio(musicPreviewUrl);
      audio.onended = () => setIsMusicPlaying(false);
      musicAudioRef.current = audio;
      audio.play();
      setIsMusicPlaying(true);
    }
  };

  // Pexels search for Personnage
  const searchPexelsCharacter = async (query?: string) => {
    const q = query || characterPrompt;
    if (!q.trim()) return;
    setPexelsLoading(true);
    try {
      const res = await fetch(`/api/pexels?query=${encodeURIComponent(q)}&count=6`);
      const data = await res.json();
      if (data.success && data.photos) {
        setPexelsResults(data.photos);
      } else {
        setPexelsResults([]);
        showToast('Aucune image trouvée');
      }
    } catch {
      showToast('Erreur lors de la recherche Pexels');
      setPexelsResults([]);
    } finally {
      setPexelsLoading(false);
    }
  };

  const handleSelectPexelsCharacter = (photo: PexelsPhoto) => {
    setSelectedPexelsUrl(photo.url);
    setCharacterPreview(photo.medium);
    setCharacterImage(null); // clear file upload, using pexels URL instead
  };

  const handleCharacterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCharacterImage(file);
    if (characterPreview) URL.revokeObjectURL(characterPreview);
    setCharacterPreview(URL.createObjectURL(file));
  };

  const handleMusicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackgroundMusic(file);
    setMusicName(file.name);
    // Create preview URL for playback
    if (musicPreviewUrl) URL.revokeObjectURL(musicPreviewUrl);
    if (musicAudioRef.current) {
      musicAudioRef.current.pause();
      musicAudioRef.current = null;
    }
    setIsMusicPlaying(false);
    setMusicPreviewUrl(URL.createObjectURL(file));
  };

  const handleVoiceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVoiceUploadFile(file);
  };

    // handleGenerateVoice removed - Edge TTS no longer used
  const handleGenerateVoice = async () => { /* TTS removed */ };


  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      voiceMediaRecorderRef.current = recorder;
      voiceChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) voiceChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm' });
        setVoiceOverFile(new File([blob], 'voix-off-recording.webm', { type: 'audio/webm' }));
        stream.getTracks().forEach(t => t.stop());
        setIsRecordingVoice(false);
      };
      recorder.start();
      setIsRecordingVoice(true);
    } catch (err) {
      console.error('Mic error:', err);
      alert('Impossible d\'acceder au microphone.');
    }
  };

  const stopVoiceRecording = () => {
    if (voiceMediaRecorderRef.current && voiceMediaRecorderRef.current.state !== 'inactive') {
      voiceMediaRecorderRef.current.stop();
    }
  };
    // previewVoice removed - Edge TTS no longer used
  const handlePreviewVoice = async () => { /* TTS removed */ };

  const uploadFile = async (file: File, purpose: string): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', purpose);
      const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
      const data = await res.json();
      return data.success ? data.file.url : null;
    } catch {
      return null;
    }
  };

  const handleStartRendering = async () => {
    const rushesWithFiles = videoRushes.filter((r) => r.file);
    if (rushesWithFiles.length === 0) {
      showToast('Ajoutez au moins une vidéo rush');
      return;
    }

    setIsRendering(true);
    setRenderProgress(0);
    setRenderStage('Initialisation...');

    try {
      // ═══ PHASE 1: Upload files (0-20%) ═══
      setRenderStage('Upload des vidéos...');
      const rushUrls: string[] = [];
      for (let i = 0; i < rushesWithFiles.length; i++) {
        setRenderProgress(Math.round(((i + 1) / rushesWithFiles.length) * 15));
        const url = await uploadFile(rushesWithFiles[i].file!, 'rush');
        if (url) rushUrls.push(url);
      }

      // Generate Edge TTS voice if selected and no manual upload
      let actualVoiceFile = voiceUploadFile;
      // TTS voice generation block removed - user provides their own audio file


      setRenderStage('Upload des médias...');
      setRenderProgress(17);

      // If using Pexels image (no characterImage file), download it to create a File for upload
      let charImageToUpload = characterImage;
      if (!charImageToUpload && selectedPexelsUrl && characterPreview) {
        try {
          console.log('[Creator] Downloading Pexels image for upload:', characterPreview.substring(0, 80));
          const pexelsRes = await fetch(characterPreview);
          if (pexelsRes.ok) {
            const pexelsBlob = await pexelsRes.blob();
            charImageToUpload = new File([pexelsBlob], 'pexels-character.jpg', { type: pexelsBlob.type || 'image/jpeg' });
            console.log('[Creator] Pexels image downloaded:', (pexelsBlob.size / 1024).toFixed(1), 'KB');
          }
        } catch (pexelsErr) {
          console.warn('[Creator] Failed to download Pexels image:', pexelsErr);
        }
      }

      const [musicUrl, charUrl, voiceUrl, logoUrl] = await Promise.all([
        backgroundMusic ? uploadFile(backgroundMusic, 'music') : null,
        charImageToUpload ? uploadFile(charImageToUpload, 'thumbnail') : null,
        actualVoiceFile ? uploadFile(actualVoiceFile, 'voice') : null,
        logoFile ? uploadFile(logoFile, 'logo') : null,
      ]);
      console.log('[Creator] Upload results — music:', !!musicUrl, 'char:', !!charUrl, 'voice:', !!voiceUrl, 'logo:', !!logoUrl);
      // Fallback: if charUrl is null but we have a characterPreview (blob/pexels URL), use it directly
      const effectiveCharUrl = charUrl || characterPreview || null;
      const effectiveLogoUrl = logoUrl || logoPreview || null;
      setRenderProgress(20);

      // ═══ PHASE 2: Batch variations ═══
      const batchTitles: Record<string, string[]> = {
        promotion: ['OFFRE EXCLUSIVE', 'PROMO FLASH', 'BON PLAN', 'DEAL DU JOUR', 'OFFRE LIMITÉE', 'SOLDES', 'DERNIÈRE CHANCE', 'PRIX CASSÉ', 'OFFRE SPÉCIALE', 'VENTE FLASH'],
        subscription: ['ABONNE-TOI', 'REJOINS-NOUS', 'FOLLOW NOW', 'ON T\'ATTEND', 'LINK IN BIO', 'ACTIVE LA CLOCHE', 'STAY TUNED', 'REJOINS LA TRIBU', 'NE RATE RIEN', 'FOLLOW MAINTENANT'],
        motivation: ['C\'EST TON MOMENT', 'LÈVE-TOI', 'NO EXCUSES', 'DÉPASSE-TOI', 'GO GO GO', 'BELIEVE', 'TU PEUX', 'NEVER GIVE UP', 'PUSH HARDER', 'NO LIMIT'],
        benefits: ['LES BIENFAITS', 'DÉCOUVRE', 'TOP RÉSULTATS', 'LE SECRET', 'AVANT/APRÈS', 'PROUVÉ', 'EFFICACE', 'TESTÉ', 'RÉSULTATS', 'TRANSFORME-TOI'],
        nutrition: ['MANGE MIEUX', 'RECETTE DU JOUR', 'NUTRITION', 'HEALTHY LIFE', 'CLEAN EATING', 'MEAL PREP', 'SUPER FOOD', 'BOOST NATUREL', 'ÉNERGIE SAINE', 'FUEL YOUR BODY'],
      };
      const batchSubtitles: Record<string, string[]> = {
        promotion: ['Ne rate pas cette offre', 'Profite avant qu\'il soit trop tard', 'Une opportunité unique', 'Seulement cette semaine', 'Places limitées'],
        subscription: ['Rejoins la communauté', 'Du contenu exclusif chaque jour', 'Contenu premium gratuit', 'La team t\'attend', 'Première vidéo gratuite'],
        motivation: ['Ton futur commence ici', 'Chaque jour est une chance', 'Tu es capable de tout', 'Rien n\'est impossible', 'Le moment c\'est maintenant'],
        benefits: ['Résultats visibles rapidement', 'Ton corps va te remercier', 'La science a parlé', 'Testé et approuvé', 'Transformation garantie'],
        nutrition: ['La clé d\'une vie saine', 'Recettes simples et efficaces', 'Transforme ton alimentation', 'Bon pour toi et délicieux', 'Nutrition optimale'],
      };
      const batchPhrases: Record<string, string[]> = {
        promotion: ['Offre limitée !', '-30% cette semaine', 'Réserve ta place', 'Profite maintenant', 'Code promo en bio'],
        subscription: ['Abonne-toi !', 'Follow pour + de contenu', 'Active les notifs', 'Lien en bio', 'Rejoins-nous maintenant'],
        motivation: ['C\'est maintenant ou jamais', 'Chaque jour compte', 'Pas d\'excuses', 'Lève-toi et brille', 'Go hard or go home'],
        benefits: ['Découvre les résultats', 'Essaie et compare', 'Prouvé cliniquement', 'Les chiffres parlent', 'Testé par + de 5000'],
        nutrition: ['Teste cette recette', 'Mange sain, vis mieux', 'Ton corps te remerciera', 'Simple, rapide, efficace', 'La nutrition c\'est la clé'],
      };
      const pickRandom = (arr: string[], exclude: string[] = []) => {
        const filtered = arr.filter((x) => !exclude.includes(x));
        return filtered.length > 0 ? filtered[Math.floor(Math.random() * filtered.length)] : arr[Math.floor(Math.random() * arr.length)];
      };

      // Video dimensions based on format
      const isReel = format !== 'tv';
      const vidWidth = isReel ? 1080 : 1920;
      const vidHeight = isReel ? 1920 : 1080;

      // ═══ PHASE 3: Client-side render + Create calendar posts (20-90%) ═══
      let successCount = 0;

      if (destination === 'calendar' || destination === 'both') {
        const today = new Date();
        const usedTitles: string[] = [];
        const usedSubtitles: string[] = [];
        const titlePool = batchTitles[objective] || batchTitles['promotion'];
        const subtitlePool = batchSubtitles[objective] || batchSubtitles['promotion'];
        const phrasePool = batchPhrases[objective] || batchPhrases['promotion'];

        for (let b = 0; b < batchCount; b++) {
          const bTitle = b === 0 ? (title || 'Nouvelle vidéo') : pickRandom(titlePool, usedTitles);
          const bSubtitle = b === 0 ? (subtitle || '') : pickRandom(subtitlePool, usedSubtitles);
          const bPhrase = b === 0 ? (salesPhrase || '') : pickRandom(phrasePool);
          usedTitles.push(bTitle);
          usedSubtitles.push(bSubtitle);

          const rushUrl = rushUrls[b % rushUrls.length] || rushUrls[0] || null;
          const renderProgressBase = 20 + (b / batchCount) * 70;
          const renderProgressSpan = 70 / batchCount;

          // Build text cards for info cards sequence
          const cardItems = textCards.filter((c) => c.text.trim()).map((c) => ({
            emoji: '📝', label: '', value: c.text, color: c.color,
          }));

          let renderedVideoUrl: string | null = null;
          try {
            setRenderStage(batchCount > 1 ? `Montage vidéo ${b + 1}/${batchCount}...` : 'Montage vidéo en cours...');
            setRenderProgress(Math.round(renderProgressBase));

            const { url } = await composeAndUpload({
              width: vidWidth,
              height: vidHeight,
              fps: 30,
              title: bTitle,
              subtitle: bSubtitle || undefined,
              salesPhrase: bPhrase || undefined,
              cards: cardItems.length > 0 ? cardItems : undefined,
              posterUrl: effectiveCharUrl,
              videoUrl: rushUrl,
              logoUrl: effectiveLogoUrl,
              musicUrl: musicUrl || null,
              voiceUrl: voiceUrl || null,
              introDuration: 5,
              cardsDuration: cardItems.length > 0 ? 8 : 0,
              videoDuration: 12,
              ctaDuration: 5,
              accentColor: branding.accentColor || '#D91CD2',
              ctaText: branding.ctaText || 'CHAT POUR PLUS D\'INFOS',
              ctaSubText: branding.ctaSubText || 'LIEN EN BIO',
              watermarkText: branding.watermarkText || undefined,
              onProgress: (pct, stage) => {
                setRenderProgress(Math.round(renderProgressBase + (pct / 100) * renderProgressSpan));
                setRenderStage(stage);
              },
            });
            if (url) renderedVideoUrl = url;
          } catch (renderErr) { console.error(`[Composer] Error vidéo ${b + 1}:`, renderErr); }

          // Create calendar post — prefer rendered montage, fallback to poster (never raw rush)
          const schedDate = new Date(today);
          schedDate.setDate(today.getDate() + b);
          const scheduledDate = `${schedDate.getFullYear()}-${String(schedDate.getMonth() + 1).padStart(2, '0')}-${String(schedDate.getDate()).padStart(2, '0')}`;
          const postMediaUrl = renderedVideoUrl || effectiveCharUrl || null;
          if (!renderedVideoUrl) console.warn(`[Creator] Montage URL is null for post ${b + 1} — upload may have failed`);

          try {
            await fetch('/api/posts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: bTitle, caption: `${bSubtitle}\n${bPhrase}`.trim(),
                media_url: postMediaUrl, media_type: renderedVideoUrl ? 'video' : (effectiveCharUrl ? 'image' : 'video'),
                format: format === 'tv' ? 'tv' : 'reel', platforms: [],
                scheduled_date: scheduledDate, scheduled_time: '12:00', status: 'draft',
                metadata: {
                  type: 'creator', subtitle: bSubtitle, salesPhrase: bPhrase, objective, mode,
                  rushUrls, musicUrl: musicUrl || null, characterUrl: effectiveCharUrl || null,
                  renderedVideoUrl: renderedVideoUrl || null, videoUrl: renderedVideoUrl || rushUrl || null,
                  voiceMode, ttsVoice: voiceMode === 'edge' ? ttsVoice : null, ttsText: voiceMode === 'edge' ? ttsText : null,
                  textCards: textCards.filter((c) => c.text.trim()).map((c) => ({ text: c.text, color: c.color })),
                  branding: { watermarkText: branding.watermarkText, borderColor: branding.borderEnabled ? branding.borderColor : null, ctaText: branding.ctaText, ctaSubText: branding.ctaSubText, accentColor: branding.accentColor },
                },
              }),
            });
            successCount++;
          } catch (postErr) { console.error(`[Post] Error ${b + 1}:`, postErr); }

          // Also create a video record in the library
          try {
            await fetch('/api/videos', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: bTitle,
                format: format === 'tv' ? 'tv' : 'reel',
                type: 'creator',
                status: renderedVideoUrl ? 'completed' : 'draft',
                video_url: renderedVideoUrl || null,
                thumbnail_url: effectiveCharUrl || null,
                metadata: {
                  title: bTitle, subtitle: bSubtitle, salesPhrase: bPhrase, objective,
                  posterPhotoUrl: effectiveCharUrl || null, characterUrl: effectiveCharUrl || null,
                  rushUrls, musicUrl: musicUrl || null, voiceUrl: voiceUrl || null,
                  renderedVideoUrl: renderedVideoUrl || null,
                },
              }),
            });
          } catch (vidErr) { console.error(`[Creator] Video record creation failed:`, vidErr); }
          setRenderProgress(Math.round(renderProgressBase + renderProgressSpan));
        }
      }

      setRenderProgress(90);

      // Export: download the composed video
      if (destination === 'export' || destination === 'both') {
        setRenderStage('Montage vidéo pour export...');
        const cardItems = textCards.filter((c) => c.text.trim()).map((c) => ({
          emoji: '📝', label: '', value: c.text, color: c.color,
        }));
        try {
          const { blob } = await composeAndUpload({
            width: vidWidth,
            height: vidHeight,
            fps: 30,
            title: title || 'Nouvelle vidéo',
            subtitle: subtitle || undefined,
            salesPhrase: salesPhrase || undefined,
            cards: cardItems.length > 0 ? cardItems : undefined,
            posterUrl: effectiveCharUrl,
            videoUrl: rushUrls[0] || null,
            logoUrl: null,
            musicUrl: musicUrl || null,
            voiceUrl: voiceUrl || null,
            introDuration: 5,
            cardsDuration: cardItems.length > 0 ? 8 : 0,
            videoDuration: 12,
            ctaDuration: 5,
            accentColor: branding.accentColor || '#D91CD2',
            ctaText: branding.ctaText || 'CHAT POUR PLUS D\'INFOS',
            ctaSubText: branding.ctaSubText || 'LIEN EN BIO',
            watermarkText: branding.watermarkText || undefined,
            onProgress: (pct, stage) => {
              setRenderProgress(90 + Math.round(pct * 0.08));
              setRenderStage(stage);
            },
          });
          downloadBlob(blob, `${(title || 'video').replace(/\s+/g, '_')}.webm`);
        } catch (exportErr) {
          console.error('[Composer] Export error:', exportErr);
          showToast('Erreur lors du montage vidéo. Veuillez réessayer.');
        }
      }

      setRenderStage('Finalisation...');
      await new Promise((r) => setTimeout(r, 800));
      setRenderProgress(100);
      setRenderStage('Terminé !');

      showToast(successCount > 0 ? `${successCount} vidéo${successCount > 1 ? 's' : ''} montée${successCount > 1 ? 's' : ''} avec succès !` : 'Vidéo montée avec succès !', 'success');

      if (destination === 'calendar' || destination === 'both') {
        await new Promise((r) => setTimeout(r, 1500));
        router.push('/dashboard/calendar');
      }
    } catch (err) {
      console.error('Render error:', err);
      showToast('Erreur lors de la création');
    } finally {
      setTimeout(() => {
        setIsRendering(false);
        setRenderProgress(0);
      }, 2000);
    }
  };

  const goNext = () => {
    if (step === 0) {
      if (!title.trim()) {
        showToast('Veuillez entrer un titre');
        return;
      }
    }
    if (step < 3) setStep(step + 1);
  };

  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const rushCount = videoRushes.filter((r) => r.file).length;

  // ---- Render ----

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col text-white">
      {/* Hidden file inputs */}
      <input ref={characterInputRef} type="file" accept="image/*" className="hidden" onChange={handleCharacterUpload} />
      <input ref={musicInputRef} type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
      <input ref={voiceInputRef} type="file" accept="audio/*" className="hidden" onChange={handleVoiceUpload} />
      <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) {
          setLogoFile(file);
          if (logoPreview) URL.revokeObjectURL(logoPreview);
          setLogoPreview(URL.createObjectURL(file));
        }
      }} />
      {videoRushes.map((rush) => (
        <input
          key={rush.id}
          ref={(el) => { rushInputRefs.current[rush.id] = el; }}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleRushUpload(rush.id, file);
          }}
        />
      ))}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="px-8 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Créer une vidéo</h1>
            <p className="text-sm text-gray-400 mt-1">Étape {step + 1} sur {STEP_LABELS.length}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">15 crédits</span>
            <div className="flex gap-1.5">
              {STEP_COLORS.map((color, i) => (
                <div
                  key={i}
                  className={`h-2.5 w-8 rounded-full transition-all ${
                    i <= step ? color : 'bg-gray-700'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Two Column */}
      <div className="flex flex-1 overflow-hidden px-8 pb-0 gap-6">
        {/* LEFT COLUMN - Main Form */}
        <div className="flex-1 overflow-y-auto pb-24 pr-2">

          {/* ============ STEP 0: FORMAT & OBJECTIF ============ */}
          {step === 0 && (
            <div className="space-y-6">
              {/* Format */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold mb-4">Format</h2>
                <div className="flex gap-3">
                  {FORMAT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setFormat(opt.value)}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium text-sm transition-all border-2 ${
                        format === opt.value
                          ? 'border-purple-500 bg-purple-500/10 text-white'
                          : 'border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <span className="mr-2">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold mb-4">Mode</h2>
                <div className="flex gap-3">
                  {MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setMode(opt.value)}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium text-sm transition-all border-2 ${
                        mode === opt.value
                          ? 'border-pink-500 bg-pink-500/10 text-white'
                          : 'border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Objectif — defaults + user-created merged */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">Objectif</h2>
                  <button
                    onClick={() => router.push('/dashboard/objectives')}
                    className="text-xs text-purple-400 hover:text-purple-300 border border-purple-500/30 px-2 py-1 rounded-lg transition"
                  >
                    + Creer un objectif
                  </button>
                </div>
                {loadingObjectives ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-purple-400 mr-2" />
                    <span className="text-xs text-gray-400">Chargement...</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {/* Default objectives always shown */}
                    {DEFAULT_OBJECTIVES.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setObjective(opt.value)}
                        className={`py-2 px-4 rounded-lg font-medium text-sm transition-all border ${
                          objective === opt.value
                            ? 'border-purple-500 bg-purple-500/10 text-white'
                            : 'border-gray-700 text-gray-400 hover:border-gray-600'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                    {/* User-created objectives */}
                    {userObjectives.map((obj) => (
                      <button
                        key={obj.id}
                        onClick={() => setObjective(obj.id)}
                        className={`py-2 px-4 rounded-lg font-medium text-sm transition-all border ${
                          objective === obj.id
                            ? 'border-pink-500 bg-pink-500/10 text-white'
                            : 'border-gray-700 text-gray-400 hover:border-gray-600'
                        }`}
                      >
                        {obj.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Titre & Sous-titre */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">Titre & Sous-titre</h2>
                  <button
                    onClick={generateTitleSubtitle}
                    className="flex items-center gap-1 text-xs text-purple-400 border border-purple-500/30 px-2.5 py-1.5 rounded-lg hover:bg-purple-500/10 transition"
                  >
                    <Sparkles size={12} />
                    IA
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-2">Titre principal</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: ABONNE-TOI MAINTENANT"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-2">Sous-titre</label>
                  <input
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder="Ex: Ton futur commence ici"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ============ STEP 1: MEDIAS ============ */}
          {step === 1 && (
            <div className="space-y-6">
              {/* Rush Vidéos */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <Film size={20} />
                    Rush vidéos ({rushCount})
                  </h2>
                  <div className="flex items-center gap-2">
                    {/* Global settings toggle */}
                    <button
                      onClick={() => setShowGlobalSettings(!showGlobalSettings)}
                      className={`flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-lg border transition ${
                        showGlobalSettings
                          ? 'bg-purple-600 border-purple-500 text-white'
                          : 'border-gray-600 text-gray-400 hover:text-white hover:border-gray-500'
                      }`}
                      title="Paramètres globaux des cartes"
                    >
                      <Type size={14} />
                      Paramètres
                    </button>
                    <button
                      onClick={handleAddRush}
                      className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 transition"
                    >
                      <Plus size={16} />
                      Ajouter
                    </button>
                  </div>
                </div>

                {/* Global settings panel */}
                {showGlobalSettings && (
                  <div className="mb-4 bg-gray-900 rounded-lg p-4 border border-gray-700 space-y-3">
                    <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wide">Paramètres des cartes texte</h3>
                    <div className="flex gap-3 items-center">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-gray-500">Couleur</label>
                        <input
                          type="color"
                          value={globalTextColor}
                          onChange={(e) => setGlobalTextColor(e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                        />
                      </div>
                      <div className="flex items-center gap-2 flex-1">
                        <label className="text-[10px] text-gray-500">Police</label>
                        <select
                          value={globalFontFamily}
                          onChange={(e) => setGlobalFontFamily(e.target.value)}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                        >
                          {FONT_OPTIONS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-1">
                        {(['sm', 'md', 'lg'] as const).map((size) => (
                          <button
                            key={size}
                            onClick={() => setGlobalFontSize(size)}
                            className={`px-2.5 py-1.5 rounded text-[10px] font-medium transition ${
                              globalFontSize === size ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'
                            }`}
                          >
                            {size === 'sm' ? 'Petit' : size === 'md' ? 'Moyen' : 'Grand'}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={applyGlobalSettings}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg transition"
                      >
                        Appliquer
                      </button>
                    </div>
                  </div>
                )}

                {/* Rush Grid with text card inserts — Drag & Drop */}
                <div
                  ref={timelineRef}
                  className="flex gap-0 flex-wrap pb-2 items-end"
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                >
                  {videoRushes.map((rush, idx) => {
                    const cardsAtPosition = textCards.filter((c) => c.position === idx);
                    const isDragging = dragIndex === idx;
                    const isDragOver = dragOverIndex === idx && dragIndex !== idx;
                    return (
                      <div
                        key={rush.id}
                        className={`flex items-end gap-0 transition-transform ${isDragging ? 'opacity-40 scale-95' : ''} ${isDragOver ? 'ring-2 ring-purple-500 rounded-xl' : ''}`}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={() => handleDrop(idx)}
                        onDragEnd={handleDragEnd}
                        onTouchStart={(e) => handleTouchStart(idx, e)}
                      >
                        {/* Rush slot */}
                        <div className="flex-shrink-0 flex flex-col items-center gap-2">
                          <div
                            className={`relative w-28 h-40 rounded-xl border-2 border-dashed cursor-grab active:cursor-grabbing transition-all flex items-center justify-center overflow-hidden group ${
                              rush.file
                                ? 'border-purple-500/50 bg-black'
                                : 'border-gray-600 hover:border-gray-500 bg-gray-900/50'
                            }`}
                          >
                            {/* Drag handle */}
                            <div className="absolute top-1 left-1 p-0.5 bg-black/40 rounded text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-grab">
                              <GripVertical size={12} />
                            </div>
                            {rush.file && rush.previewUrl ? (
                              <>
                                <video
                                  src={rush.previewUrl}
                                  className="w-full h-full object-cover pointer-events-none"
                                  muted
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveRush(rush.id);
                                  }}
                                  className="absolute top-1 right-1 p-1 bg-black/60 rounded-full text-white hover:text-red-400 transition z-10"
                                >
                                  <X size={12} />
                                </button>
                                {rush.title && (
                                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                                    <p className="text-[10px] text-white font-medium truncate text-center">{rush.title}</p>
                                  </div>
                                )}
                                {/* Click overlay to upload */}
                                <div
                                  onClick={() => rushInputRefs.current[rush.id]?.click()}
                                  className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 hover:opacity-100 cursor-pointer z-[5]"
                                >
                                  <Upload size={16} className="text-white" />
                                </div>
                              </>
                            ) : (
                              <div onClick={() => rushInputRefs.current[rush.id]?.click()} className="w-full h-full flex items-center justify-center cursor-pointer">
                                <Upload size={18} className="text-gray-500" />
                              </div>
                            )}
                          </div>

                          {/* Clip detection: analyzing indicator */}
                          {rush.isAnalyzing && (
                            <div className="w-28 mt-1">
                              <div className="flex items-center gap-1 mb-0.5">
                                <Loader2 size={8} className="animate-spin text-purple-400" />
                                <span className="text-[8px] text-purple-400">Analyse clips...</span>
                              </div>
                              <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${rush.analyzeProgress || 0}%` }} />
                              </div>
                            </div>
                          )}

                          {/* Clip detection: detected clips thumbnails */}
                          {rush.detectedClips && rush.detectedClips.length > 0 && !rush.isAnalyzing && (
                            <div className="w-28 mt-1">
                              <div className="flex items-center gap-1 mb-1">
                                <Zap size={8} className="text-yellow-400" />
                                <span className="text-[8px] text-gray-400">{rush.detectedClips.length} clips détectés</span>
                              </div>
                              <div className="flex gap-0.5 flex-wrap">
                                {/* Full video option */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSelectClip(rush.id, 'full'); }}
                                  className={`w-6 h-8 rounded border text-[6px] flex items-center justify-center transition ${
                                    rush.selectedClipId === 'full' || !rush.selectedClipId
                                      ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                                      : 'border-gray-600 bg-gray-800 text-gray-500 hover:border-gray-500'
                                  }`}
                                  title="Vidéo complète"
                                >
                                  Full
                                </button>
                                {rush.detectedClips.map((clip) => (
                                  <button
                                    key={clip.id}
                                    onClick={(e) => { e.stopPropagation(); handleSelectClip(rush.id, clip.id); }}
                                    className={`w-8 h-8 rounded border overflow-hidden relative transition ${
                                      rush.selectedClipId === clip.id
                                        ? 'border-pink-500 ring-1 ring-pink-400'
                                        : 'border-gray-600 hover:border-gray-500'
                                    }`}
                                    title={`${clip.label} (${clip.duration}s)`}
                                  >
                                    <img src={clip.thumbnailUrl} alt={clip.label} className="w-full h-full object-cover" />
                                    <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[5px] text-white text-center">{clip.duration}s</span>
                                  </button>
                                ))}
                              </div>
                              {/* Show selected clip info */}
                              {rush.selectedClipId && rush.selectedClipId !== 'full' && (
                                <p className="text-[7px] text-pink-400 mt-0.5 truncate">
                                  {rush.detectedClips.find(c => c.id === rush.selectedClipId)?.label}
                                </p>
                              )}
                            </div>
                          )}

                          <span className="text-[10px] text-gray-500">Rush {idx + 1}</span>
                        </div>

                        {/* Text cards inserted at this position */}
                        {cardsAtPosition.map((card) => (
                          <div key={card.id} className="flex-shrink-0 flex flex-col items-center gap-2 mx-1 relative">
                            <div
                              className="relative w-28 h-40 rounded-xl border-2 border-solid cursor-pointer flex items-center justify-center overflow-hidden"
                              style={{ borderColor: card.color, backgroundColor: `${card.color}15` }}
                              onClick={() => setEditingCardId(editingCardId === card.id ? null : card.id)}
                            >
                              <p
                                className={`text-center font-bold px-2 leading-tight ${
                                  card.fontSize === 'sm' ? 'text-xs' : card.fontSize === 'lg' ? 'text-base' : 'text-sm'
                                }`}
                                style={{ color: card.color, fontFamily: card.fontFamily }}
                              >
                                {card.text}
                              </p>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveTextCard(card.id); }}
                                className="absolute top-1 right-1 p-0.5 bg-black/50 rounded-full text-white hover:text-red-400 transition"
                              >
                                <X size={10} />
                              </button>
                            </div>
                            {/* Mini editor when selected */}
                            {editingCardId === card.id && (
                              <div className="absolute top-44 left-0 z-20 bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl space-y-2 w-60">
                                <div className="flex gap-1.5">
                                  <input
                                    type="text"
                                    value={card.text}
                                    onChange={(e) => handleUpdateTextCard(card.id, { text: e.target.value })}
                                    className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                                    placeholder="Texte de la carte"
                                  />
                                  <button
                                    onClick={() => handleUpdateTextCard(card.id, { text: generateCardText() })}
                                    className="flex items-center gap-1 px-2 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-[10px] font-medium text-white transition flex-shrink-0"
                                    title="Générer un texte IA selon l'objectif"
                                  >
                                    <Sparkles size={10} /> IA
                                  </button>
                                </div>
                                <div className="flex gap-2 items-center">
                                  <input
                                    type="color"
                                    value={card.color}
                                    onChange={(e) => handleUpdateTextCard(card.id, { color: e.target.value })}
                                    className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                                  />
                                  <div className="flex gap-1 flex-1">
                                    {(['sm', 'md', 'lg'] as const).map((size) => (
                                      <button
                                        key={size}
                                        onClick={() => handleUpdateTextCard(card.id, { fontSize: size })}
                                        className={`flex-1 py-1 rounded text-[10px] font-medium transition ${
                                          card.fontSize === size
                                            ? 'bg-purple-600 text-white'
                                            : 'bg-gray-700 text-gray-400'
                                        }`}
                                      >
                                        {size === 'sm' ? 'Petit' : size === 'md' ? 'Moyen' : 'Grand'}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                {/* Font family selector */}
                                <div className="flex items-center gap-2">
                                  <Type size={14} className="text-gray-400 flex-shrink-0" />
                                  <select
                                    value={card.fontFamily}
                                    onChange={(e) => handleUpdateTextCard(card.id, { fontFamily: e.target.value })}
                                    className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                                  >
                                    {FONT_OPTIONS.map((f) => (
                                      <option key={f.value} value={f.value}>{f.label}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}

                        {/* "+" button between rushes to add a text card */}
                        <div className="flex-shrink-0 flex flex-col items-center gap-2 mx-0.5">
                          <button
                            onClick={() => handleAddTextCard(idx)}
                            className="w-6 h-40 rounded-lg border border-dashed border-gray-600 hover:border-green-500 hover:bg-green-500/10 flex items-center justify-center transition group"
                            title="Ajouter une carte titre"
                          >
                            <Plus size={12} className="text-gray-600 group-hover:text-green-400" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Add more rush slots */}
                  {videoRushes.length < 10 && (
                    <div className="flex-shrink-0 flex flex-col items-center gap-2">
                      <button
                        onClick={handleAddRush}
                        className="w-28 h-40 rounded-xl border-2 border-dashed border-gray-700 hover:border-purple-500/50 bg-gray-900/30 flex items-center justify-center transition cursor-pointer"
                      >
                        <Plus size={20} className="text-gray-600" />
                      </button>
                    </div>
                  )}
                </div>

                <p className="text-xs text-gray-500 mt-3 text-center">
                  <GripVertical size={12} className="inline text-gray-400 mr-1" />
                  Glisser pour réorganiser • Cliquez <span className="text-green-400 font-bold">+</span> pour ajouter des cartes titres
                </p>
              </div>

              {/* Personnage */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                  <ImageIcon size={20} />
                  Personnage
                </h2>

                {/* Tab Toggle */}
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setCharacterTab('upload')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition border ${
                      characterTab === 'upload'
                        ? 'bg-gray-700 border-gray-600 text-white'
                        : 'border-gray-700 text-gray-400 hover:bg-gray-700/50'
                    }`}
                  >
                    <Upload size={14} className="inline mr-2" />
                    Uploader
                  </button>
                  <button
                    onClick={() => setCharacterTab('ai')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition border ${
                      characterTab === 'ai'
                        ? 'bg-purple-600 border-purple-500 text-white'
                        : 'border-gray-700 text-gray-400 hover:bg-gray-700/50'
                    }`}
                  >
                    <Sparkles size={14} className="inline mr-2" />
                    IA propose
                  </button>
                </div>

                {characterTab === 'upload' ? (
                  characterPreview && !selectedPexelsUrl ? (
                    <div className="relative">
                      <img src={characterPreview} alt="Personnage" className="w-full h-48 rounded-lg object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-3">
                        <button
                          onClick={() => characterInputRef.current?.click()}
                          className="px-3 py-2 bg-white/20 backdrop-blur rounded-lg text-sm text-white hover:bg-white/30 transition"
                        >
                          Changer
                        </button>
                        <button
                          onClick={() => {
                            setCharacterImage(null);
                            if (characterPreview && !selectedPexelsUrl) URL.revokeObjectURL(characterPreview);
                            setCharacterPreview(null);
                          }}
                          className="px-3 py-2 bg-red-500/50 backdrop-blur rounded-lg text-sm text-white hover:bg-red-500/70 transition"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => characterInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-lg border-2 border-dashed border-gray-700 hover:border-purple-500/50 text-gray-500 hover:text-gray-400 transition cursor-pointer"
                    >
                      <Upload size={24} />
                      <span className="text-sm">Cliquez pour ajouter une image</span>
                      <span className="text-xs text-gray-600">PNG, JPG jusqu&apos;à 10MB</span>
                    </button>
                  )
                ) : (
                  <div className="space-y-3">
                    {/* Search bar */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={characterPrompt}
                        onChange={(e) => setCharacterPrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') searchPexelsCharacter(); }}
                        placeholder="Ex: femme noir musclée, homme sport..."
                        className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                      />
                      <button
                        onClick={() => searchPexelsCharacter()}
                        disabled={pexelsLoading}
                        className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg transition"
                      >
                        {pexelsLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                      </button>
                    </div>

                    {/* Selected image preview */}
                    {selectedPexelsUrl && characterPreview && (
                      <div className="relative">
                        <img src={characterPreview} alt="Personnage Pexels" className="w-full h-48 rounded-lg object-cover" />
                        <button
                          onClick={() => searchPexelsCharacter()}
                          className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-full text-white hover:bg-black/70 transition"
                          title="Changer d'image"
                        >
                          <Search size={14} />
                        </button>
                      </div>
                    )}

                    {/* Pexels results grid */}
                    {pexelsResults.length > 0 && !selectedPexelsUrl && (
                      <div className="grid grid-cols-3 gap-2">
                        {pexelsResults.map((photo) => (
                          <button
                            key={photo.id}
                            onClick={() => handleSelectPexelsCharacter(photo)}
                            className="relative aspect-square rounded-lg overflow-hidden hover:ring-2 hover:ring-purple-500 transition"
                          >
                            <img src={photo.small} alt={photo.alt || 'Pexels'} className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}

                    {pexelsLoading && (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 size={24} className="animate-spin text-purple-400" />
                      </div>
                    )}

                    {!pexelsLoading && pexelsResults.length === 0 && !selectedPexelsUrl && (
                      <div className="flex flex-col items-center py-6 text-gray-500">
                        <Sparkles size={28} className="mb-2 text-purple-500/40" />
                        <p className="text-sm">Tapez une description ou cliquez rechercher</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Music & Voice - Side by Side */}
              <div className="grid grid-cols-2 gap-4">
                {/* Musique */}
                <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                  <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <Music size={20} />
                    Musique
                  </h2>
                  {backgroundMusic ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 bg-gray-900 rounded-lg p-3">
                        <button
                          onClick={handleMusicTogglePlay}
                          className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 hover:bg-purple-700 flex items-center justify-center transition"
                        >
                          {isMusicPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-white truncate block">{musicName}</span>
                          <span className="text-[10px] text-gray-500">{isMusicPlaying ? 'Lecture en cours...' : 'Cliquez ▶ pour écouter'}</span>
                        </div>
                        <button
                          onClick={() => {
                            if (musicAudioRef.current) {
                              musicAudioRef.current.pause();
                              musicAudioRef.current = null;
                            }
                            if (musicPreviewUrl) URL.revokeObjectURL(musicPreviewUrl);
                            setBackgroundMusic(null);
                            setMusicName('');
                            setMusicPreviewUrl(null);
                            setIsMusicPlaying(false);
                          }}
                          className="text-gray-400 hover:text-red-400 transition"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <button
                        onClick={() => musicInputRef.current?.click()}
                        className="w-full text-xs text-purple-400 hover:text-purple-300 py-1.5 transition text-center"
                      >
                        Changer de musique
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => musicInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-lg border-2 border-dashed border-gray-700 hover:border-purple-500/50 text-gray-500 hover:text-gray-400 transition cursor-pointer"
                    >
                      <Upload size={20} />
                      <span className="text-xs">MP3, WAV, OGG</span>
                    </button>
                  )}
                </div>

                {/* Voix off */}
                <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                  <h2 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
                    <Mic className="w-4 h-4 text-pink-400" />
                    Voix off
                  </h2>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <button onClick={() => { if (voiceInputRef?.current) voiceInputRef.current.click(); }} className="flex-1 px-3 py-2 text-xs rounded-lg border bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 transition-all">
                        <Upload className="w-3 h-3 inline mr-1" />Uploader MP3/WAV
                      </button>
                      <button onClick={() => { if (!isRecordingVoice) { startVoiceRecording(); } else { stopVoiceRecording(); } }} className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-all ${isRecordingVoice ? 'bg-red-600/20 border-red-500 text-red-400 animate-pulse' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}>
                        <Mic className="w-3 h-3 inline mr-1" />{isRecordingVoice ? 'Stop enregistrement' : 'Enregistrer'}
                      </button>
                    </div>
                    {voiceOverFile && (
                      <div className="flex items-center gap-2 p-2 bg-gray-800 rounded-lg">
                        <Volume2 className="w-4 h-4 text-pink-400" />
                        <span className="text-xs text-gray-300 flex-1 truncate">{voiceOverFile.name}</span>
                        <button onClick={() => { const url = URL.createObjectURL(voiceOverFile); const a = new Audio(url); a.play(); }} className="text-pink-400 hover:text-pink-300"><Play className="w-3 h-3" /></button>
                        <button onClick={() => setVoiceOverFile(null)} className="text-gray-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                      </div>
                    )}
                    <input ref={voiceInputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setVoiceOverFile(e.target.files[0]); }} />
                  </div>
                </div>

              {/* Logo */}
              <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/50">
                <h2 className="text-sm font-bold flex items-center gap-2 mb-3">
                  <ImageIcon size={16} />
                  Logo (optionnel)
                </h2>
                {logoFile ? (
                  <div className="flex items-center gap-3">
                    <img src={logoPreview || ''} alt="Logo" className="w-12 h-12 rounded-lg object-contain bg-black/50 p-1" />
                    <span className="text-xs text-white truncate flex-1">{logoFile.name}</span>
                    <button
                      onClick={() => { setLogoFile(null); if (logoPreview) URL.revokeObjectURL(logoPreview); setLogoPreview(null); }}
                      className="text-gray-400 hover:text-red-400 transition"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-4 rounded-lg border border-dashed border-gray-700 hover:border-purple-500/50 text-gray-500 hover:text-gray-400 transition cursor-pointer text-xs"
                  >
                    <Upload size={14} />
                    Ajouter un logo
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ============ STEP 2: PERSONNALISATION ============ */}
          {step === 2 && (
            <div className="space-y-6">
              {/* Batch count */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold mb-4">Nombre de vidéos</h2>
                <div className="flex gap-3">
                  {[1, 2, 3, 5, 10].map((count) => (
                    <button
                      key={count}
                      onClick={() => setBatchCount(count)}
                      className={`flex-1 py-3 rounded-lg font-bold text-sm transition border-2 ${
                        batchCount === count
                          ? 'border-purple-500 bg-purple-500/10 text-white'
                          : 'border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      x{count}
                    </button>
                  ))}
                </div>
              </div>

              {/* Phrase de vente */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">Phrase de vente</h2>
                  <button
                    onClick={generateSalesPhrase}
                    className="flex items-center gap-1 text-xs text-purple-400 border border-purple-500/30 px-2 py-1 rounded-lg hover:bg-purple-500/10 transition"
                  >
                    <Sparkles size={12} />
                    IA
                  </button>
                </div>
                <input
                  type="text"
                  value={salesPhrase}
                  onChange={(e) => setSalesPhrase(e.target.value)}
                  placeholder="Ex: Réserve ta place maintenant !"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                />
              </div>

              {/* Branding / Personnalisation visuelle */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold mb-1">Branding</h2>
                <p className="text-xs text-gray-500 mb-4">Ces réglages sont mémorisés automatiquement.</p>
                <BrandingPanel branding={branding} onChange={setBranding} />
              </div>

              {/* Destination */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold mb-4">Destination</h2>
                <div className="space-y-2">
                  {[
                    { value: 'calendar', label: '📅 Calendrier (brouillon)', desc: 'Ajouté comme brouillon dans votre calendrier' },
                    { value: 'export', label: '📦 Export fichier', desc: 'Télécharger directement le fichier' },
                    { value: 'both', label: '🔄 Les deux', desc: 'Calendrier + Export' },
                  ].map((dest) => (
                    <button
                      key={dest.value}
                      onClick={() => setDestination(dest.value)}
                      className={`w-full text-left px-4 py-3 rounded-lg text-sm transition border ${
                        destination === dest.value
                          ? 'bg-purple-500/10 border-purple-500 text-white'
                          : 'border-gray-700 text-gray-400 hover:bg-gray-700/50'
                      }`}
                    >
                      <div className="font-medium">{dest.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{dest.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============ STEP 3: APERÇU & EXPORT ============ */}
          {step === 3 && (
            <div className="space-y-6">
              {!isRendering ? (
                <>
                  {/* Summary */}
                  <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                    <h2 className="text-lg font-bold mb-4">Résumé</h2>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">Format</span>
                        <p className="font-medium mt-1">{format === 'reel' ? '📱 Reel 9:16' : '📺 TV 16:9'}</p>
                      </div>
                      <div className="bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">Mode</span>
                        <p className="font-medium mt-1">{mode === 'cardio' ? 'Cardio' : 'Témoignage'}</p>
                      </div>
                      <div className="bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">Vidéos</span>
                        <p className="font-medium mt-1">{rushCount} rush(es) • x{batchCount} batch</p>
                      </div>
                      <div className="bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">Destination</span>
                        <p className="font-medium mt-1">{destination === 'calendar' ? 'Calendrier' : destination === 'export' ? 'Export' : 'Les deux'}</p>
                      </div>
                      <div className="col-span-2 bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">Titre</span>
                        <p className="font-medium mt-1">{title || '(non défini)'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Generate Button */}
                  <button
                    onClick={handleStartRendering}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 text-lg"
                  >
                    <Zap size={20} />
                    Générer {batchCount} vidéo{batchCount > 1 ? 's' : ''}
                  </button>
                </>
              ) : (
                /* Rendering Progress */
                <div className="bg-gray-800/60 rounded-xl p-12 border border-gray-700/50 text-center space-y-6">
                  <h2 className="text-2xl font-bold">Création en cours...</h2>

                  <div className="text-6xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                    {Math.round(renderProgress)}%
                  </div>

                  <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-600 to-pink-500 rounded-full transition-all duration-500"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>

                  <p className="text-gray-400">{renderStage}</p>

                  <Loader2 size={40} className="animate-spin text-purple-500 mx-auto" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN - Live Preview */}
        <div className="w-80 flex-shrink-0 overflow-y-auto pb-24">
          <div className="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5 sticky top-0">
            <div className="flex items-center gap-2 mb-3">
              <Eye size={16} className="text-pink-400" />
              <h3 className="text-sm font-semibold text-gray-300">Aperçu en temps réel</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">Mise à jour automatique</p>

            {/* Phone Preview — Remotion-style montage */}
            <div className="flex justify-center">
              <div
                className={`rounded-2xl overflow-hidden shadow-2xl ${
                  format === 'reel'
                    ? 'w-48 aspect-[9/16]'
                    : 'w-full aspect-video'
                }`}
                style={{
                  border: branding.borderEnabled ? `3px solid ${branding.borderColor}` : '2px solid rgba(124,58,237,0.4)',
                  boxShadow: branding.borderEnabled
                    ? `0 0 20px ${branding.borderColor}40, 0 0 40px ${branding.borderColor}20`
                    : '0 0 20px rgba(217,28,210,0.3), inset 0 0 20px rgba(0,0,0,0.3)',
                }}
              >
                <div className="w-full h-full relative flex flex-col justify-between overflow-hidden bg-black">
                  {/* Layer 1: Background media — character image > first rush > gradient */}
                  {characterPreview ? (
                    <img src={characterPreview} alt="BG" className="absolute inset-0 w-full h-full object-cover" />
                  ) : videoRushes.find((r) => r.previewUrl) ? (
                    <video
                      src={videoRushes.find((r) => r.previewUrl)!.previewUrl}
                      className="absolute inset-0 w-full h-full object-cover"
                      muted
                      autoPlay
                      loop
                      playsInline
                    />
                  ) : null}

                  {/* Layer 2: Violet gradient overlay (Remotion style) */}
                  <div className="absolute inset-0" style={{
                    background: characterPreview || videoRushes.some((r) => r.previewUrl)
                      ? 'linear-gradient(to top, rgba(100,0,140,0.7) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)'
                      : 'linear-gradient(135deg, #7C3AED 0%, #EC4899 50%, #7C3AED 100%)'
                  }} />

                  {/* Layer 3: Content overlay */}
                  <div className="relative z-10 flex flex-col justify-between h-full p-2.5">
                    {/* Top badges */}
                    <div className="flex justify-between items-start">
                      <span className="text-[7px] font-bold text-white px-1.5 py-0.5 rounded" style={{ background: 'linear-gradient(135deg, #D91CD2, #FF2DAA)' }}>
                        {userObjectives.find((o) => o.id === objective)?.name || objective}
                      </span>
                      <span className="bg-black/50 text-[7px] font-bold text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
                        {format === 'reel' ? '9:16' : '16:9'}
                      </span>
                    </div>

                    {/* Center — title + subtitle with neon glow */}
                    <div className="text-center flex-1 flex flex-col items-center justify-center gap-1">
                      <h4 className="text-sm font-black text-white leading-tight tracking-wide uppercase" style={{
                        textShadow: `0 0 10px ${branding.accentColor}CC, 0 0 30px ${branding.accentColor}66, 0 2px 4px rgba(0,0,0,0.8)`
                      }}>
                        {title || 'TITRE'}
                      </h4>
                      <p className="text-[8px] text-white/90" style={{
                        textShadow: `0 0 8px ${branding.accentColor}99, 0 1px 3px rgba(0,0,0,0.8)`
                      }}>{subtitle || 'Sous-titre'}</p>

                      {/* Text cards preview (neon keywords) */}
                      {textCards.filter((c) => c.text.trim()).length > 0 && (
                        <div className="flex flex-wrap justify-center gap-0.5 mt-1">
                          {textCards.filter((c) => c.text.trim()).slice(0, 3).map((card, i) => (
                            <span key={i} className="text-[6px] font-bold text-white px-1 py-0.5 rounded" style={{
                              background: 'rgba(217,28,210,0.5)',
                              textShadow: '0 0 6px rgba(255,255,255,0.8)',
                              backdropFilter: 'blur(4px)',
                            }}>
                              {card.text.slice(0, 20)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Bottom — sales phrase + audio indicators + CTA */}
                    <div className="space-y-1">
                      {salesPhrase && (
                        <p className="text-[7px] text-white/90 text-center font-semibold italic" style={{
                          textShadow: '0 0 6px rgba(217,28,210,0.6)'
                        }}>{salesPhrase}</p>
                      )}

                      {/* Audio indicators */}
                      <div className="flex items-center justify-center gap-1">
                        {backgroundMusic && (
                          <span className="text-[6px] text-white px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: 'linear-gradient(135deg, #7C3AED, #D91CD2)' }}>
                            <Music size={5} />
                            Musique
                          </span>
                        )}
                        {voiceMode !== 'none' && (
                          <span className="text-[6px] text-white px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: 'linear-gradient(135deg, #059669, #10B981)' }}>
                            <Mic size={5} />
                            Voix off
                          </span>
                        )}
                      </div>

                      {/* Watermark */}
                      {branding.watermarkText && (
                        <p className="text-[5px] text-white/40 text-center font-medium tracking-widest">{branding.watermarkText}</p>
                      )}

                      {/* Progress bar (Remotion style) */}
                      <div className="w-full h-0.5 rounded-full overflow-hidden bg-white/10">
                        <div className="h-full rounded-full" style={{
                          width: '65%',
                          background: `linear-gradient(90deg, ${branding.accentColor}, #FF2DAA, #00D4FF)`,
                        }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Preview details below phone */}
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">Format</span>
                <span className="text-white">{format === 'reel' ? 'Reel 9:16' : 'TV 16:9'}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">Mode</span>
                <span className="text-white">{mode === 'cardio' ? 'Cardio' : 'Témoignage'}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">Rushes</span>
                <span className="text-white">{rushCount} vidéo{rushCount !== 1 ? 's' : ''}</span>
              </div>
              {textCards.length > 0 && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Cartes texte</span>
                  <span className="text-white">{textCards.length}</span>
                </div>
              )}
              {backgroundMusic && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Musique</span>
                  <span className="text-green-400 truncate ml-2">{musicName}</span>
                </div>
              )}
              {voiceMode !== 'none' && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Voix off</span>
                  <span className="text-green-400">{voiceMode === 'edge' ? 'Edge TTS' : 'Upload'}</span>
                </div>
              )}
              {batchCount > 1 && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Batch</span>
                  <span className="text-purple-400">x{batchCount} vidéos</span>
                </div>
              )}
            </div>

            {/* Lire le montage — animated sequence preview */}
            <div className="mt-4 pt-4 border-t border-gray-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Montage Preview</span>
                <button
                  onClick={() => { if (!previewAutoPlay) { setPreviewSeqIndex(0); setPreviewProgress(0); } setPreviewAutoPlay(!previewAutoPlay); }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition ${
                    previewAutoPlay ? 'bg-pink-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600 border border-gray-600'
                  }`}
                >
                  {previewAutoPlay ? <><span className="text-[10px]">❚❚</span> Pause</> : <><Play size={10} /> Lire le montage</>}
                </button>
              </div>

              {/* Montage phone preview */}
              <div className="flex justify-center">
                <div
                  className={`rounded-xl overflow-hidden shadow-xl relative ${
                    format === 'reel' ? 'w-40 aspect-[9/16]' : 'w-full aspect-video'
                  }`}
                  style={{
                    border: branding.borderEnabled ? `2px solid ${branding.borderColor}` : '1px solid rgba(124,58,237,0.3)',
                    boxShadow: branding.borderEnabled ? `0 0 15px ${branding.borderColor}30` : '0 0 15px rgba(217,28,210,0.2)',
                  }}
                >
                  {/* All sequences rendered with CSS transitions */}
                  {activeMontageSequences.map((seq, idx) => {
                    const isCurrent = idx === previewSeqIndex;
                    return (
                      <div key={seq.id} className="absolute inset-0 transition-all duration-[800ms] ease-in-out"
                        style={{
                          opacity: isCurrent ? 1 : 0,
                          transform: isCurrent ? 'scale(1) translateY(0)' : (seq.type === 'cards' ? 'translateY(20px)' : seq.type === 'cta' ? 'scale(0.95)' : 'scale(1.05)'),
                          zIndex: isCurrent ? 10 : 1,
                        }}>
                        {renderMontageSequence(seq.type)}
                      </div>
                    );
                  })}

                  {/* Current sequence label */}
                  <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: activeMontageSequences[previewSeqIndex]?.color, animation: previewAutoPlay ? 'pulse 1.5s infinite' : 'none' }} />
                    <span className="text-[7px] font-bold text-white/70 bg-black/40 backdrop-blur-sm px-1 py-0.5 rounded">
                      {activeMontageSequences[previewSeqIndex]?.type === 'intro' ? 'Affiche' : activeMontageSequences[previewSeqIndex]?.type === 'cards' ? 'Cartes' : activeMontageSequences[previewSeqIndex]?.type === 'video' ? 'Vidéo' : 'CTA'}
                    </span>
                  </div>

                  {/* Timeline bar — bottom */}
                  <div className="absolute bottom-0 left-0 right-0 z-20">
                    <div className="flex h-1 bg-black/30">
                      {activeMontageSequences.map((seq, idx) => {
                        const w = (seq.duration / montageTotalDuration) * 100;
                        const isCurrent = idx === previewSeqIndex;
                        const isPast = idx < previewSeqIndex;
                        return (
                          <div key={seq.id} className="h-full relative overflow-hidden cursor-pointer" style={{ width: `${w}%` }} onClick={() => { setPreviewSeqIndex(idx); setPreviewProgress(0); }}>
                            <div className="absolute inset-0" style={{ background: seq.color, opacity: isPast ? 1 : 0.2 }} />
                            {isCurrent && previewAutoPlay && <div className="absolute inset-y-0 left-0" style={{ width: `${previewProgress}%`, background: seq.color, transition: 'width 50ms linear' }} />}
                            {isCurrent && !previewAutoPlay && <div className="absolute inset-0" style={{ background: seq.color, opacity: 0.8 }} />}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Duration badge */}
                  <div className="absolute bottom-1.5 right-1.5 z-20 bg-black/50 backdrop-blur-sm px-1 py-0.5 rounded text-[7px] font-bold text-white/60">{montageTotalDuration}s</div>
                </div>
              </div>

              {/* Sequence navigation buttons */}
              <div className="mt-2 flex gap-0.5">
                {activeMontageSequences.map((seq, idx) => (
                  <button key={seq.id} onClick={() => { setPreviewSeqIndex(idx); setPreviewProgress(0); setPreviewAutoPlay(false); }}
                    className={`flex-1 py-1 rounded text-[8px] font-medium transition ${previewSeqIndex === idx ? 'text-white' : 'bg-gray-700 text-gray-500 hover:bg-gray-600'}`}
                    style={previewSeqIndex === idx ? { background: seq.color } : undefined}>
                    {seq.icon} {seq.duration}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-64 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-700 px-8 py-4 flex items-center justify-between z-30">
        <button
          onClick={goBack}
          disabled={step === 0}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition ${
            step === 0
              ? 'text-gray-600 cursor-not-allowed'
              : 'text-gray-300 hover:text-white hover:bg-gray-800'
          }`}
        >
          <ChevronLeft size={16} />
          Retour
        </button>

        {step < 3 ? (
          <button
            onClick={goNext}
            className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition text-sm"
          >
            Suivant
            <ChevronRight size={16} />
          </button>
        ) : !isRendering ? (
          <button
            onClick={handleStartRendering}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-bold rounded-lg transition text-sm"
          >
            <Zap size={16} />
            Lancer la création
          </button>
        ) : null}
      </div>
    </div>
  );
}
