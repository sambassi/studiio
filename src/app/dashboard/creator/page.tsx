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
  Sparkles,
  Search,
  Image as ImageIcon,
  Film,
  Eye,
  GripVertical,
  Play,
  Type,
} from 'lucide-react';
import { useBranding } from '@/lib/hooks/useBranding';
import { useTranslations, useLocale } from '@/i18n/client';
import { getContentPools, pickRandom as pickRandomI18n } from '@/lib/i18n-content';
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

const STEP_COLORS = ['bg-red-500', 'bg-pink-500', 'bg-purple-500', 'bg-gray-500'];

export default function CreatorPage() {
  useSession();
  const router = useRouter();
  const { branding, setBranding } = useBranding();
  const t = useTranslations('creator');
  const tc = useTranslations('common');
  const locale = useLocale();

  // Translated constants (must be inside component for i18n)
  const STEP_LABELS = [t('stepLabels.0'), t('stepLabels.1'), t('stepLabels.2'), t('stepLabels.3')];

  const FORMAT_OPTIONS = [
    { value: 'reel', label: t('format.reel'), icon: '📱' },
    { value: 'tv', label: t('format.tv'), icon: '📺' },
  ];

  const MODE_OPTIONS = [
    { value: 'cardio', label: t('mode.cardio') },
    { value: 'testimony', label: t('mode.testimony') },
  ];

  const DEFAULT_OBJECTIVES = [
    { value: 'promotion', label: t('objective.promotion') },
    { value: 'subscription', label: t('objective.subscription') },
    { value: 'motivation', label: t('objective.motivation') },
    { value: 'benefits', label: t('objective.benefits') },
    { value: 'nutrition', label: t('objective.nutrition') },
  ];

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
  const [rushVideoDuration, setRushVideoDuration] = useState(10);
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

  // Audio removed — handled in Studio Son page

  // Logo
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Personnalisation
  const [batchCount, setBatchCount] = useState(1);
  const [destination, setDestination] = useState('calendar');
  const [salesPhrase, setSalesPhrase] = useState('');

  // Sequence durations (editable)
  const [introDuration, setIntroDuration] = useState(5);
  const [cardsDuration, setCardsDuration] = useState(6);
  const [ctaDuration, setCtaDuration] = useState(5);

  // Step 3: Render
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');

  // Drag & drop reorder
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number; idx: number } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // UI
  const [toast, setToast] = useState<Toast | null>(null);

  // Clip detection modal
  const [clipModalRushId, setClipModalRushId] = useState<string | null>(null);

  // Montage preview (like Infographie "Lire le montage")
  const [previewSeqIndex, setPreviewSeqIndex] = useState(0);
  const [previewAutoPlay, setPreviewAutoPlay] = useState(false);

  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);


  // Refs
  const rushInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const characterInputRef = useRef<HTMLInputElement>(null);

  // Cleanup
  useEffect(() => {
    return () => {
      videoRushes.forEach((r) => {
        if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
      });
      if (characterPreview) URL.revokeObjectURL(characterPreview);
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

  // Auto-search Pexels photos based on objective when batch > 1
  useEffect(() => {
    if (batchCount > 1 && objective) {
      const count = batchCount * 2;
      searchPexelsCharacter(objective);
    }
  }, [objective, batchCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Montage sequences definition (like Infographie page)
  const montageSequences = [
    { id: 'intro', type: 'intro', label: t('montageSequences.intro'), duration: introDuration, color: '#ec4899', icon: '🖼️' },
    { id: 'cards', type: 'cards', label: t('montageSequences.cards'), duration: cardsDuration, color: '#a855f7', icon: '📊' },
    { id: 'video', type: 'video', label: t('montageSequences.video'), duration: rushVideoDuration, color: '#3b82f6', icon: '🎬' },
    { id: 'cta', type: 'cta', label: t('montageSequences.cta'), duration: ctaDuration, color: '#22c55e', icon: '📢' },
  ];
  const activeMontageSequences = montageSequences.filter(s => s.type !== 'video' || videoRushes.some(r => r.file));
  const montageTotalDuration = activeMontageSequences.reduce((s, x) => s + x.duration, 0);

  // Auto-play montage preview — uses CSS animation instead of setInterval for smooth playback
  const previewSeqDurRef = useRef<number>(5000);
  useEffect(() => {
    if (!previewAutoPlay) {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      return;
    }
    const currentDur = (activeMontageSequences[previewSeqIndex]?.duration || 5) * 1000;
    previewSeqDurRef.current = currentDur;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      if (previewSeqIndex < activeMontageSequences.length - 1) setPreviewSeqIndex(previewSeqIndex + 1);
      else setPreviewSeqIndex(0);
    }, currentDur);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
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
            <p className="text-[7px] font-bold text-white/60 uppercase tracking-widest text-center mb-1">{t('textCards.information')}</p>
            {visibleCards.length > 0 ? visibleCards.map((card, i) => (
              <div key={i} className="flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-lg px-2 py-1 border-l-2" style={{ borderColor: card.color }}>
                <span className="text-[8px] text-white font-bold" style={{ fontFamily: card.fontFamily }}>{card.text}</span>
              </div>
            )) : (
              <div className="text-center py-4">
                <Type size={16} className="text-gray-600 mx-auto mb-1" />
                <p className="text-[8px] text-gray-500">{t('textCards.addText')}</p>
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
                <p className="text-[8px] text-gray-500">{t('montageSequences.noVideo')}</p>
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
    showToast(t('salesPhrase.generated'), 'success');
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
    showToast(t('salesPhrase.titleGenerated'), 'success');
  };

  // ---- Handlers ----

  const handleRushUpload = (rushId: string, file: File) => {
    const previewUrl = URL.createObjectURL(file);

    // Detect actual video duration
    if (file.type.startsWith('video/')) {
      const tempVid = document.createElement('video');
      tempVid.preload = 'metadata';
      tempVid.onloadedmetadata = () => {
        const dur = Math.round(tempVid.duration);
        if (dur > 0 && dur < 300) {
          setRushVideoDuration(dur);
          console.log(`[Creator] Rush video duration detected: ${dur}s`);
        }
        URL.revokeObjectURL(tempVid.src);
      };
      tempVid.src = URL.createObjectURL(file);
    }

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
      showToast(t('rushVideos.fullVideo'), 'success');
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
      showToast(t('rushVideos.clipExtracted', { label: clip.label, duration: String(clip.duration) }), 'success');
    } catch (err) {
      console.error('[ClipExtract] Failed:', err);
      setVideoRushes((prev) => prev.map((r) => r.id === rushId ? { ...r, isAnalyzing: false } : r));
      showToast(t('rushVideos.extractError'), 'error');
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
    showToast(t('textCards.appliedToAll'), 'success');
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

  // Pexels search for Personnage
  const searchPexelsCharacter = async (query?: string) => {
    const q = query || characterPrompt;
    if (!q.trim()) return;
    setPexelsLoading(true);
    try {
      const count = batchCount > 1 ? Math.max(batchCount * 2, 6) : 6;
      const res = await fetch(`/api/pexels?query=${encodeURIComponent(q)}&count=${count}`);
      const data = await res.json();
      if (data.success && data.photos) {
        setPexelsResults(data.photos);
      } else {
        setPexelsResults([]);
        showToast(t('character.noImageFound'));
      }
    } catch {
      showToast(t('character.pexelsError'));
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

  const uploadFile = async (file: File, purpose: string): Promise<string | null> => {
    try {
      // Use signed URL for large files (videos > 4MB) to bypass Vercel's 4.5MB body limit
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
      // Small files (images, logos) use regular upload
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', purpose);
      const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
      const data = await res.json();
      return data.success ? data.file.url : null;
    } catch (err) {
      console.error('[Upload] Error:', err);
      return null;
    }
  };

  const handleStartRendering = async () => {
    const rushesWithFiles = videoRushes.filter((r) => r.file);
    if (rushesWithFiles.length === 0) {
      showToast(t('render.errorNoRush'));
      return;
    }

    setIsRendering(true);
    setRenderProgress(0);
    setRenderStage(t('render.initializing'));

    try {
      // ═══ PHASE 1: Upload files (0-20%) ═══
      setRenderStage(t('render.uploadingVideos'));
      const rushUrls: string[] = [];
      for (let i = 0; i < rushesWithFiles.length; i++) {
        setRenderProgress(Math.round(((i + 1) / rushesWithFiles.length) * 15));
        const url = await uploadFile(rushesWithFiles[i].file!, 'rush');
        if (url) rushUrls.push(url);
      }

      // Audio (music/voice) is handled in Studio Son page — compose without audio here
      setRenderStage(t('render.uploadingMedia'));
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

      const [charUrl, logoUrl] = await Promise.all([
        charImageToUpload ? uploadFile(charImageToUpload, 'thumbnail') : null,
        logoFile ? uploadFile(logoFile, 'logo') : null,
      ]);
      console.log('[Creator] Upload results — char:', !!charUrl, 'logo:', !!logoUrl);

      const effectiveCharUrl = charUrl || characterPreview || null;
      const effectiveLogoUrl = logoFile ? URL.createObjectURL(logoFile) : (logoPreview || logoUrl || null);

      // No audio — music/voice handled in Studio Son page
      const effectiveMusicUrl: string | null = null;
      const effectiveVoiceUrl: string | null = null;

      // ═══ Batch poster variety: upload additional Pexels images ═══
      const batchPosterUrls: string[] = [];
      if (batchCount > 1 && pexelsResults.length > 1) {
        console.log(`[Creator] Uploading ${Math.min(batchCount, pexelsResults.length)} different Pexels photos for batch variety`);
        for (let pi = 0; pi < Math.min(batchCount, pexelsResults.length); pi++) {
          const photo = pexelsResults[pi];
          try {
            const pRes = await fetch(photo.medium);
            if (pRes.ok) {
              const pBlob = await pRes.blob();
              const pFile = new File([pBlob], `pexels-batch-${pi}.jpg`, { type: pBlob.type || 'image/jpeg' });
              const pUrl = await uploadFile(pFile, 'thumbnail');
              if (pUrl) batchPosterUrls.push(pUrl);
            }
          } catch { /* skip failed downloads */ }
        }
        console.log(`[Creator] Batch posters uploaded: ${batchPosterUrls.length} different images`);
      }

      setRenderProgress(20);

      // ═══ PHASE 2: Batch variations (locale-aware) ═══
      const contentPools = getContentPools(locale as 'fr' | 'en' | 'de');
      const batchTitles = contentPools.titles;
      const batchSubtitles = contentPools.subtitles;
      const batchPhrases = contentPools.phrases;
      const pickRandom = pickRandomI18n;

      // Video dimensions based on format
      const isReel = format !== 'tv';
      const vidWidth = isReel ? 1080 : 1920;
      const vidHeight = isReel ? 1920 : 1080;

      // ═══ PHASE 3: Client-side render + Create calendar posts + Export (20-98%) ═══
      let successCount = 0;
      let firstCreatedPostId: string | null = null;
      const allCreatedPostIds: string[] = [];
      // For "both" mode: compose once, reuse blob for export + url for calendar
      let savedBlobForExport: Blob | null = null;

      const cardItems = textCards.filter((c) => c.text.trim()).map((c) => ({
        emoji: '📝', label: '', value: c.text, color: c.color,
      }));

      console.log(`[Creator] ═══ CONFIG: batchCount=${batchCount}, destination=${destination} ═══`);

      if (destination === 'calendar' || destination === 'both' || destination === 'studio') {
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

          // Use different poster photo for each batch video when available
          const batchPosterUrl = batchPosterUrls.length > 0
            ? batchPosterUrls[b % batchPosterUrls.length]
            : effectiveCharUrl;

          let renderedVideoUrl: string | null = null;
          let renderedBlob: Blob | null = null;
          try {
            setRenderStage(batchCount > 1 ? t('render.composingBatch', { current: String(b + 1), total: String(batchCount) }) : t('render.composingVideo'));
            setRenderProgress(Math.round(renderProgressBase));

            const result = await composeAndUpload({
              width: vidWidth,
              height: vidHeight,
              fps: 24,
              title: bTitle,
              subtitle: bSubtitle || undefined,
              salesPhrase: bPhrase || undefined,
              cards: cardItems.length > 0 ? cardItems : undefined,
              posterUrl: batchPosterUrl,
              videoUrl: rushUrl,
              logoUrl: effectiveLogoUrl,
              musicUrl: effectiveMusicUrl || null,
              voiceUrl: effectiveVoiceUrl || null,
              introDuration,
              cardsDuration: cardItems.length > 0 ? cardsDuration : 0,
              videoDuration: rushVideoDuration,
              ctaDuration,
              accentColor: branding.accentColor || '#D91CD2',
              ctaText: branding.ctaText || 'CHAT POUR PLUS D\'INFOS',
              ctaSubText: branding.ctaSubText || 'LIEN EN BIO',
              watermarkText: branding.watermarkText || undefined,
              onProgress: (pct, stage) => {
                setRenderProgress(Math.round(renderProgressBase + (pct / 100) * renderProgressSpan));
                setRenderStage(stage);
              },
            });
            if (result.url) renderedVideoUrl = result.url;
            renderedBlob = result.blob;
            // Save first blob for desktop export in "both" mode
            if (b === 0 && destination === 'both' && renderedBlob && renderedBlob.size > 0) {
              savedBlobForExport = renderedBlob;
            }
          } catch (renderErr) { console.error(`[Composer] Error vidéo ${b + 1}:`, renderErr); }

          // Create calendar post — prefer rendered montage, fallback to poster (never raw rush)
          const schedDate = new Date(today);
          schedDate.setDate(today.getDate() + b);
          const scheduledDate = `${schedDate.getFullYear()}-${String(schedDate.getMonth() + 1).padStart(2, '0')}-${String(schedDate.getDate()).padStart(2, '0')}`;
          const postMediaUrl = renderedVideoUrl || batchPosterUrl || effectiveCharUrl || null;
          if (!renderedVideoUrl) console.warn(`[Creator] Montage URL is null for post ${b + 1} — upload may have failed`);

          try {
            const postRes = await fetch('/api/posts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: bTitle, caption: `${bSubtitle}\n${bPhrase}`.trim(),
                media_url: postMediaUrl, media_type: renderedVideoUrl ? 'video' : (effectiveCharUrl ? 'image' : 'video'),
                format: format === 'tv' ? 'tv' : 'reel', platforms: [],
                scheduled_date: scheduledDate, scheduled_time: '12:00', status: 'draft',
                metadata: {
                  type: 'creator', subtitle: bSubtitle, salesPhrase: bPhrase, objective, mode,
                  rushUrls, rawVideoUrl: rushUrl || null, musicUrl: effectiveMusicUrl || null, voiceUrl: effectiveVoiceUrl || null, characterUrl: batchPosterUrl || effectiveCharUrl || null, logoUrl: effectiveLogoUrl || null,
                  posterUrl: batchPosterUrl || effectiveCharUrl || null, pexelsUrl: batchPosterUrl || null,
                  renderedVideoUrl: renderedVideoUrl || null, videoUrl: renderedVideoUrl || rushUrl || null,
                  voiceMode: 'none', ttsVoice: null, ttsText: null,
                  textCards: textCards.filter((c) => c.text.trim()).map((c) => ({ text: c.text, color: c.color })),
                  // Cards in the format expected by calendar preview & video-composer
                  cards: cardItems.map((c) => ({ emoji: c.emoji || '📝', label: c.label || c.value, value: c.value, color: c.color })),
                  // Sequence timing so calendar can reconstruct the montage
                  sequences: {
                    intro: introDuration,
                    cards: cardItems.length > 0 ? cardsDuration : 0,
                    video: rushUrl ? rushVideoDuration : 0,
                    cta: ctaDuration,
                    total: introDuration + (cardItems.length > 0 ? cardsDuration : 0) + (rushUrl ? rushVideoDuration : 0) + ctaDuration,
                    order: ['intro', ...(cardItems.length > 0 ? ['cards'] : []), ...(rushUrl ? ['video'] : []), 'cta'],
                  },
                  branding: { watermarkText: branding.watermarkText, borderColor: branding.borderEnabled ? branding.borderColor : null, ctaText: branding.ctaText, ctaSubText: branding.ctaSubText, accentColor: branding.accentColor },
                },
              }),
            });
            if (postRes.ok) {
              const postData = await postRes.json().catch(() => ({}));
              successCount++;
              // Save post IDs for Studio Son redirect
              const createdId = postData.post?.id || postData.data?.id || null;
              console.log(`[Creator] Post ${b + 1} created, id:`, createdId);
              if (createdId) {
                allCreatedPostIds.push(createdId);
                if (b === 0) firstCreatedPostId = createdId;
              }
            } else {
              console.error(`[Creator] Post ${b + 1} failed:`, postRes.status, await postRes.text().catch(() => ''));
            }
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
                  rushUrls, musicUrl: effectiveMusicUrl || null, voiceUrl: effectiveVoiceUrl || null,
                  renderedVideoUrl: renderedVideoUrl || null, logoUrl: effectiveLogoUrl || null,
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
        try {
          let exportBlob: Blob;
          if (destination === 'both' && savedBlobForExport && savedBlobForExport.size > 0) {
            // Reuse the blob from calendar compose — no need to render twice
            exportBlob = savedBlobForExport;
            setRenderProgress(98);
          } else {
            // Export-only: compose fresh
            setRenderStage(t('render.composingForExport'));
            const result = await composeAndUpload({
              width: vidWidth,
              height: vidHeight,
              fps: 24,
              title: title || 'Nouvelle vidéo',
              subtitle: subtitle || undefined,
              salesPhrase: salesPhrase || undefined,
              cards: cardItems.length > 0 ? cardItems : undefined,
              posterUrl: effectiveCharUrl,
              videoUrl: rushUrls[0] || null,
              logoUrl: effectiveLogoUrl,
              musicUrl: effectiveMusicUrl || null,
              voiceUrl: effectiveVoiceUrl || null,
              introDuration,
              cardsDuration: cardItems.length > 0 ? cardsDuration : 0,
              videoDuration: rushVideoDuration,
              ctaDuration,
              accentColor: branding.accentColor || '#D91CD2',
              ctaText: branding.ctaText || 'CHAT POUR PLUS D\'INFOS',
              ctaSubText: branding.ctaSubText || 'LIEN EN BIO',
              watermarkText: branding.watermarkText || undefined,
              onProgress: (pct, stage) => {
                setRenderProgress(90 + Math.round(pct * 0.08));
                setRenderStage(stage);
              },
            });
            exportBlob = result.blob;
          }
          downloadBlob(exportBlob, `${(title || 'video').replace(/\s+/g, '_')}.mp4`);
        } catch (exportErr) {
          console.error('[Composer] Export error:', exportErr);
          showToast(t('render.errorCompose'));
        }
      }

      setRenderStage(t('render.finalizing'));
      await new Promise((r) => setTimeout(r, 800));
      setRenderProgress(100);
      setRenderStage(t('render.done'));

      showToast(successCount > 1 ? t('render.successBatch', { count: String(successCount) }) : t('render.successSingle'), 'success');

      if (destination === 'studio') {
        // Redirect to Audio Studio with ALL created post IDs
        console.log('[Creator] Studio redirect — allCreatedPostIds:', allCreatedPostIds);
        await new Promise((r) => setTimeout(r, 1000));
        const studioUrl = allCreatedPostIds.length > 1
          ? `/dashboard/audio-studio?postIds=${allCreatedPostIds.join(',')}`
          : allCreatedPostIds.length === 1
            ? `/dashboard/audio-studio?postId=${allCreatedPostIds[0]}`
            : '/dashboard/audio-studio';
        console.log('[Creator] Redirecting to:', studioUrl);
        router.push(studioUrl);
      } else if (destination === 'calendar' || destination === 'both') {
        await new Promise((r) => setTimeout(r, 1500));
        router.push('/dashboard/calendar');
      }
    } catch (err) {
      console.error('Render error:', err);
      showToast(t('render.errorCreate'));
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
        showToast(t('render.errorNoTitle'));
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
            <h1 className="text-2xl font-bold">{t('title')}</h1>
            <p className="text-sm text-gray-400 mt-1">{t('stepOf', { current: String(step + 1), total: String(STEP_LABELS.length) })}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">{t('credits')}</span>
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
                <h2 className="text-lg font-bold mb-4">{t('format.title')}</h2>
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
                <h2 className="text-lg font-bold mb-4">{t('mode.title')}</h2>
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
                  <h2 className="text-lg font-bold">{t('objective.title')}</h2>
                  <button
                    onClick={() => router.push('/dashboard/objectives')}
                    className="text-xs text-purple-400 hover:text-purple-300 border border-purple-500/30 px-2 py-1 rounded-lg transition"
                  >
                    {t('objective.createObjective')}
                  </button>
                </div>
                {loadingObjectives ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-purple-400 mr-2" />
                    <span className="text-xs text-gray-400">{tc('loading')}</span>
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
                  <h2 className="text-lg font-bold">{t('titleSubtitle.title')}</h2>
                  <button
                    onClick={generateTitleSubtitle}
                    className="flex items-center gap-1 text-xs text-purple-400 border border-purple-500/30 px-2.5 py-1.5 rounded-lg hover:bg-purple-500/10 transition"
                  >
                    <Sparkles size={12} />
                    {t('titleSubtitle.ia')}
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-2">{t('titleSubtitle.mainTitle')}</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('titleSubtitle.titlePlaceholder')}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-2">{t('titleSubtitle.subtitle')}</label>
                  <input
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder={t('titleSubtitle.subtitlePlaceholder')}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                  />
                </div>

                {/* Audio note — Studio Son */}
                <div className="bg-purple-900/20 rounded-xl p-3 border border-purple-500/30 flex items-center gap-3">
                  <Volume2 size={18} className="text-purple-400 shrink-0" />
                  <div>
                    <p className="text-sm text-white font-medium">{t('audioNote.title')}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t('audioNote.description')} <span className="text-purple-400 font-medium">{t('audioNote.studioSon')}</span>.</p>
                  </div>
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
                    {t('rushVideos.title')} ({rushCount})
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
                      title={t('rushVideos.settings')}
                    >
                      <Type size={14} />
                      {t('rushVideos.settings')}
                    </button>
                    <button
                      onClick={handleAddRush}
                      className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 transition"
                    >
                      <Plus size={16} />
                      {t('rushVideos.add')}
                    </button>
                  </div>
                </div>

                {/* Global settings panel */}
                {showGlobalSettings && (
                  <div className="mb-4 bg-gray-900 rounded-lg p-4 border border-gray-700 space-y-3">
                    <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wide">{t('textCards.title')}</h3>
                    <div className="flex gap-3 items-center">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-gray-500">{t('textCards.color')}</label>
                        <input
                          type="color"
                          value={globalTextColor}
                          onChange={(e) => setGlobalTextColor(e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                        />
                      </div>
                      <div className="flex items-center gap-2 flex-1">
                        <label className="text-[10px] text-gray-500">{t('textCards.font')}</label>
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
                            {size === 'sm' ? t('textCards.small') : size === 'md' ? t('textCards.medium') : t('textCards.large')}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={applyGlobalSettings}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg transition"
                      >
                        {t('textCards.apply')}
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
                                <span className="text-[8px] text-purple-400">{t('rushVideos.analyzeClips')}</span>
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
                                <span className="text-[8px] text-gray-400">{rush.detectedClips.length} {t('rushVideos.clipsDetected')}</span>
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
                                  title={t('rushVideos.fullVideo')}
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

                          <span className="text-[10px] text-gray-500">{t('rush', { index: String(idx + 1) })}</span>
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
                                    placeholder={t('cardTextPlaceholder')}
                                  />
                                  <button
                                    onClick={() => handleUpdateTextCard(card.id, { text: generateCardText() })}
                                    className="flex items-center gap-1 px-2 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-[10px] font-medium text-white transition flex-shrink-0"
                                    title={t('titleSubtitle.ia')}
                                  >
                                    <Sparkles size={10} /> {t('titleSubtitle.ia')}
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
                                        {size === 'sm' ? t('textCards.small') : size === 'md' ? t('textCards.medium') : t('textCards.large')}
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
                            title={t('addTitleCard')}
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
                  {t('dragReorder')} • {t('addTitleCards', { icon: '' })}<span className="text-green-400 font-bold">+</span>
                </p>
              </div>

              {/* Nombre de vidéos */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold mb-4">{t('batch.count')}</h2>
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

              {/* Personnage */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                  <ImageIcon size={20} />
                  {t('character.title')}
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
                    {t('uploadCharacter')}
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
                    {t('aiSuggest')}
                  </button>
                </div>

                {characterTab === 'upload' ? (
                  characterPreview && !selectedPexelsUrl ? (
                    <div className="relative">
                      <img src={characterPreview} alt={t('characterLabel')} className="w-full h-48 rounded-lg object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-3">
                        <button
                          onClick={() => characterInputRef.current?.click()}
                          className="px-3 py-2 bg-white/20 backdrop-blur rounded-lg text-sm text-white hover:bg-white/30 transition"
                        >
                          {t('change')}
                        </button>
                        <button
                          onClick={() => {
                            setCharacterImage(null);
                            if (characterPreview && !selectedPexelsUrl) URL.revokeObjectURL(characterPreview);
                            setCharacterPreview(null);
                          }}
                          className="px-3 py-2 bg-red-500/50 backdrop-blur rounded-lg text-sm text-white hover:bg-red-500/70 transition"
                        >
                          {tc('delete')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => characterInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-lg border-2 border-dashed border-gray-700 hover:border-purple-500/50 text-gray-500 hover:text-gray-400 transition cursor-pointer"
                    >
                      <Upload size={24} />
                      <span className="text-sm">{t('clickToAddImage')}</span>
                      <span className="text-xs text-gray-600">{t('imageFormats')}</span>
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
                        placeholder={t('character.searchPlaceholder')}
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
                        <img src={characterPreview} alt={t('characterLabel')} className="w-full h-48 rounded-lg object-cover" />
                        <button
                          onClick={() => searchPexelsCharacter()}
                          className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-full text-white hover:bg-black/70 transition"
                          title={t('change')}
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
                        <p className="text-sm">{t('typeDescription')}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Logo */}
              <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/50">
                <h2 className="text-sm font-bold flex items-center gap-2 mb-3">
                  <ImageIcon size={16} />
                  {t('logoOptional')}
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
                    {t('addLogo')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ============ STEP 2: PERSONNALISATION ============ */}
          {step === 2 && (
            <div className="space-y-6">
              {/* Phrase de vente */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">{t('salesPhrase.title')}</h2>
                  <button
                    onClick={generateSalesPhrase}
                    className="flex items-center gap-1 text-xs text-purple-400 border border-purple-500/30 px-2 py-1 rounded-lg hover:bg-purple-500/10 transition"
                  >
                    <Sparkles size={12} />
                    {t('titleSubtitle.ia')}
                  </button>
                </div>
                <input
                  type="text"
                  value={salesPhrase}
                  onChange={(e) => setSalesPhrase(e.target.value)}
                  placeholder={t('salesPlaceholder')}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                />
              </div>

              {/* Branding / Personnalisation visuelle */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold mb-1">{t('branding.title')}</h2>
                <p className="text-xs text-gray-500 mb-4">{t('branding.memo')}</p>
                <BrandingPanel branding={branding} onChange={setBranding} />
              </div>

              {/* Durée des séquences */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold mb-4">Durée des séquences</h2>
                <div className="space-y-3">
                  {[
                    { label: '🖼️ Affiche (Intro)', value: introDuration, setter: setIntroDuration, min: 2, max: 15, disabled: false },
                    { label: '📊 Cartes', value: cardsDuration, setter: setCardsDuration, min: 3, max: 20, disabled: textCards.filter(c => c.text.trim()).length === 0 },
                    { label: '🎬 Vidéo', value: rushVideoDuration, setter: setRushVideoDuration, min: 3, max: 60, disabled: !videoRushes.some(r => r.file) },
                    { label: '📢 CTA', value: ctaDuration, setter: setCtaDuration, min: 2, max: 15, disabled: false },
                  ].map((item) => (
                    <div key={item.label} className={`flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-2.5 ${item.disabled ? 'opacity-40' : ''}`}>
                      <span className="flex-1 text-xs font-medium text-gray-300">{item.label}</span>
                      <button
                        onClick={() => item.setter(Math.max(item.min, item.value - 1))}
                        disabled={item.disabled || item.value <= item.min}
                        className="flex h-7 w-7 items-center justify-center rounded bg-gray-700 text-sm font-bold text-white hover:bg-gray-600 disabled:opacity-30"
                      >−</button>
                      <span className="w-10 text-center text-sm font-bold text-purple-400">{item.value}s</span>
                      <button
                        onClick={() => item.setter(Math.min(item.max, item.value + 1))}
                        disabled={item.disabled || item.value >= item.max}
                        className="flex h-7 w-7 items-center justify-center rounded bg-gray-700 text-sm font-bold text-white hover:bg-gray-600 disabled:opacity-30"
                      >+</button>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Durée totale: <span className="font-bold text-purple-400">{montageTotalDuration}s</span>
                </p>
              </div>

              {/* Destination */}
              <div className="bg-gray-800/60 rounded-xl p-6 border border-gray-700/50">
                <h2 className="text-lg font-bold mb-4">{t('batch.destination')}</h2>
                <div className="flex gap-2 mb-2">
                  {[
                    { value: 'calendar', label: `📅 ${t('batch.calendar')}` },
                    { value: 'studio', label: `🎵 ${t('batch.studio')}` },
                    { value: 'export', label: `📦 ${t('batch.export')}` },
                    { value: 'both', label: `🔄 ${t('batch.both')}` },
                  ].map((dest) => (
                    <button
                      key={dest.value}
                      onClick={() => setDestination(dest.value)}
                      className={`flex-1 text-center px-1.5 py-2.5 rounded-lg font-medium text-[11px] transition border ${
                        destination === dest.value
                          ? 'bg-purple-500/20 border-purple-500 text-white'
                          : 'bg-gray-700 border-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {dest.label}
                    </button>
                  ))}
                </div>
                {destination === 'studio' && (
                  <p className="text-[10px] text-purple-400 mt-1">{t('studioRedirectNote')}</p>
                )}
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
                    <h2 className="text-lg font-bold mb-4">{t('summary.title')}</h2>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">{t('summary.format')}</span>
                        <p className="font-medium mt-1">{format === 'reel' ? `📱 ${t('format.reel')}` : `📺 ${t('format.tv')}`}</p>
                      </div>
                      <div className="bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">{t('summary.mode')}</span>
                        <p className="font-medium mt-1">{mode === 'cardio' ? t('summary.cardio') : t('summary.testimony')}</p>
                      </div>
                      <div className="bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">{t('summary.videos')}</span>
                        <p className="font-medium mt-1">{t('summary.rushBatch', { rushes: String(rushCount), batch: String(batchCount) })}</p>
                      </div>
                      <div className="bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">{t('summary.destination')}</span>
                        <p className="font-medium mt-1">{destination === 'calendar' ? t('batch.calendar') : destination === 'export' ? t('batch.export') : t('batch.both')}</p>
                      </div>
                      <div className="col-span-2 bg-gray-900 rounded-lg p-3">
                        <span className="text-gray-500 text-xs">{t('summary.titleLabel')}</span>
                        <p className="font-medium mt-1">{title || t('summary.notDefined')}</p>
                      </div>
                    </div>
                  </div>

                  {/* Generate Button */}
                  <button
                    onClick={handleStartRendering}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 text-lg"
                  >
                    <Zap size={20} />
                    {batchCount > 1 ? t('render.generatePlural', { count: String(batchCount) }) : t('render.generate', { count: String(batchCount) })}
                  </button>
                </>
              ) : (
                /* Rendering Progress */
                <div className="bg-gray-800/60 rounded-xl p-12 border border-gray-700/50 text-center space-y-6">
                  <h2 className="text-2xl font-bold">{t('render.creating')}</h2>

                  <div className="text-6xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                    {Math.round(renderProgress)}%
                  </div>

                  <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-600 to-pink-500 rounded-full transition-all duration-500"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>

                  <p className="text-gray-400 text-sm">{renderStage}</p>
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
              <h3 className="text-sm font-semibold text-gray-300">{t('preview.title')}</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">{t('preview.autoUpdate')}</p>

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

                      {/* Audio note */}
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-[6px] text-white/50 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 bg-gray-700/50">
                          <Volume2 size={5} />
                          {t('preview.audioAddedInStudio')}
                        </span>
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
                <span className="text-gray-500">{t('preview.format')}</span>
                <span className="text-white">{format === 'reel' ? t('format.reel') : t('format.tv')}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">{t('preview.mode')}</span>
                <span className="text-white">{mode === 'cardio' ? t('summary.cardio') : t('summary.testimony')}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">{t('preview.rushes')}</span>
                <span className="text-white">{rushCount} {rushCount !== 1 ? tc('videos') : tc('video')}</span>
              </div>
              {textCards.length > 0 && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">{t('preview.textCardsLabel')}</span>
                  <span className="text-white">{textCards.length}</span>
                </div>
              )}
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">{t('preview.audio')}</span>
                <span className="text-purple-400">{t('preview.audioStudioSon')}</span>
              </div>
              {batchCount > 1 && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">{t('preview.batch')}</span>
                  <span className="text-purple-400">{t('preview.batchVideos', { count: String(batchCount) })}</span>
                </div>
              )}
            </div>

            {/* Lire le montage — animated sequence preview */}
            <div className="mt-4 pt-4 border-t border-gray-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{t('preview.montagePreview')}</span>
                <button
                  onClick={() => { if (!previewAutoPlay) { setPreviewSeqIndex(0); setPreviewProgress(0); } setPreviewAutoPlay(!previewAutoPlay); }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition ${
                    previewAutoPlay ? 'bg-pink-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600 border border-gray-600'
                  }`}
                >
                  {previewAutoPlay ? <><span className="text-[10px]">❚❚</span> {t('preview.pause')}</> : <><Play size={10} /> {t('preview.playMontage')}</>}
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
                      {activeMontageSequences[previewSeqIndex]?.type === 'intro' ? t('preview.seqIntro') : activeMontageSequences[previewSeqIndex]?.type === 'cards' ? t('preview.seqCards') : activeMontageSequences[previewSeqIndex]?.type === 'video' ? t('preview.seqVideo') : t('preview.seqCta')}
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
                          <div key={seq.id} className="h-full relative overflow-hidden cursor-pointer" style={{ width: `${w}%` }} onClick={() => { setPreviewSeqIndex(idx); }}>
                            <div className="absolute inset-0" style={{ background: seq.color, opacity: isPast ? 1 : 0.2 }} />
                            {isCurrent && previewAutoPlay && (
                              <>
                                <div
                                  key={`seq-progress-${previewSeqIndex}`}
                                  className="absolute inset-y-0 left-0"
                                  style={{ background: seq.color, animation: `creatorSeqFill ${previewSeqDurRef.current}ms linear forwards` }}
                                />
                                <style>{`@keyframes creatorSeqFill { from { width: 0%; } to { width: 100%; } }`}</style>
                              </>
                            )}
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
          {tc('back')}
        </button>

        {step < 3 ? (
          <button
            onClick={goNext}
            className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition text-sm"
          >
            {tc('next')}
            <ChevronRight size={16} />
          </button>
        ) : !isRendering ? (
          <button
            onClick={handleStartRendering}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-bold rounded-lg transition text-sm"
          >
            <Zap size={16} />
            {t('render.launchCreation')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
