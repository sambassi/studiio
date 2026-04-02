'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Upload, Zap, Loader2, Sparkles, Music, Film, Mic, X, Play, Square, Volume2, Image as ImageIcon, Search, ChevronRight, ChevronLeft, ArrowUp, ArrowDown } from 'lucide-react';
import { TTS_VOICES, previewVoice, synthesize } from '@/lib/tts/edge-tts-client';
import { generateSmartContent } from '@/lib/smart-content';
import { useBranding } from '@/lib/hooks/useBranding';
import BrandingPanel from '@/components/BrandingPanel';
import { composeAndUpload, downloadBlob } from '@/lib/video-composer';

interface InfoCard {
  id: string;
  emoji: string;
  label: string;
  value: string;
  color: string;
}

type Format = '9:16' | '16:9';
type Destination = 'calendar' | 'export' | 'both';
type VoiceOption = 'none' | 'edge' | 'upload';
type ThemeType = 'sommeil' | 'nutrition' | 'energie' | 'stress' | 'communaute' | 'custom';

interface SequenceItem {
  id: string;
  type: 'intro' | 'cards' | 'video' | 'cta';
  label: string;
  duration: number;
  color: string;
  icon: string;
}

const EMOJI_LIST = ['⚡', '❤️', '🔥', '🎯', '📊', '🏃', '🧠', '💨', '🌟', '💪', '🎵', '🎬', '🎙️', '🏆', '⭐', '🚀'];

const THEME_PRESETS: Record<ThemeType, { title: string; subtitle: string; cards: Omit<InfoCard, 'id'>[] }> = {
  sommeil: {
    title: 'SOMMEIL & SPORT',
    subtitle: 'Les bienfaits de la danse sur ton repos',
    cards: [
      { emoji: '😴', label: 'Qualité sommeil', value: '+45%', color: '#6366f1' },
      { emoji: '⚡', label: 'Énergie matin', value: '+60%', color: '#f59e0b' },
    ],
  },
  nutrition: {
    title: 'NUTRITION & DANSE',
    subtitle: 'Nourris ton corps, libère ton énergie',
    cards: [
      { emoji: '🥗', label: 'Métabolisme', value: '+35%', color: '#22c55e' },
      { emoji: '💪', label: 'Force', value: '+50%', color: '#ef4444' },
    ],
  },
  energie: {
    title: 'ÉNERGIE & CARDIO',
    subtitle: 'Pousse tes limites avec Afroboost',
    cards: [
      { emoji: '⚡', label: 'Intensité', value: 'MAX', color: '#ec4899' },
      { emoji: '❤️', label: 'Fréquence', value: '140+', color: '#ef4444' },
      { emoji: '💃', label: 'Chorégraphie', value: '50+', color: '#a855f7' },
      { emoji: '🎵', label: 'Playlist', value: '100%', color: '#3b82f6' },
      { emoji: '🔄', label: 'Récupération', value: '-45%', color: '#22c55e' },
    ],
  },
  stress: {
    title: 'STRESS & MENTAL',
    subtitle: 'Danse pour ton bien-être mental',
    cards: [
      { emoji: '🧠', label: 'Stress', value: '-70%', color: '#8b5cf6' },
      { emoji: '😊', label: 'Bien-être', value: '+80%', color: '#f59e0b' },
    ],
  },
  communaute: {
    title: 'COMMUNAUTÉ',
    subtitle: 'Rejoins la tribu Afroboost',
    cards: [
      { emoji: '👥', label: 'Membres actifs', value: '5000+', color: '#ec4899' },
      { emoji: '🎉', label: 'Événements', value: 'Chaque semaine', color: '#f59e0b' },
    ],
  },
  custom: {
    title: '',
    subtitle: '',
    cards: [],
  },
};

const SALES_PHRASES = [
  'Réserve ta place maintenant !',
  'Offre limitée cette semaine',
  'Premier cours GRATUIT',
  'Rejoins la communauté',
  '-50% sur ton abonnement',
  'Essai gratuit 7 jours',
  'Booste ton énergie !',
  'Transforme ton corps',
  'Résultats garantis',
  'Inscription ouverte',
];

export default function InfographiePage() {
  const { branding, setBranding } = useBranding();
  const [step, setStep] = useState(1);

  // Main content state
  const [selectedTheme, setSelectedTheme] = useState<ThemeType>('energie');
  const [title, setTitle] = useState('ÉNERGIE & CARDIO');
  const [subtitle, setSubtitle] = useState('Pousse tes limites avec Afroboost');
  const [cards, setCards] = useState<InfoCard[]>([
    { id: '1', emoji: '⚡', label: 'Intensité', value: 'MAX', color: '#ec4899' },
    { id: '2', emoji: '❤️', label: 'Fréquence', value: '140+', color: '#ef4444' },
    { id: '3', emoji: '💃', label: 'Chorégraphie', value: '50+', color: '#a855f7' },
  ]);

  // Format and batch state
  const [format, setFormat] = useState<Format>('9:16');
  const [batchMode, setBatchMode] = useState(false);

  // Photo and media state
  const [posterPhoto, setPosterPhoto] = useState(false);
  const [posterPhotoFile, setPosterPhotoFile] = useState<File | null>(null);
  const [posterPhotoPreview, setPosterPhotoPreview] = useState<string | null>(null);
  const [pexelsQuery, setPexelsQuery] = useState('');
  const [pexelsResults, setPexelsResults] = useState<{ id: number; url: string; medium: string; small: string; photographer: string; alt: string }[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [selectedPexelsUrl, setSelectedPexelsUrl] = useState<string | null>(null);
  const [_characterImage, setCharacterImage] = useState(false);
  const [characterImageFile, setCharacterImageFile] = useState<File | null>(null);
  const [characterImagePreview, setCharacterImagePreview] = useState<string | null>(null);

  // Music state
  const [selectedMusic, setSelectedMusic] = useState<File | null>(null);
  const [musicName, setMusicName] = useState<string>('');
  const [musicPreviewUrl, setMusicPreviewUrl] = useState<string | null>(null);
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);

  // Video state
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoName, setVideoName] = useState<string>('');
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);

  // Logo state
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);
  const [logoName, setLogoName] = useState<string>('');
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  // Voice state
  const [voiceOption, setVoiceOption] = useState<VoiceOption>('none');
  const [selectedVoice, setSelectedVoice] = useState(TTS_VOICES[0].id);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceFileName, setVoiceFileName] = useState<string>('');
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);

  // Batch preview state
  interface BatchVariation { title: string; subtitle: string; salesPhrase: string; photoUrl: string | null; }
  const [batchVariations, setBatchVariations] = useState<BatchVariation[]>([]);
  const [batchPhotosLoading, setBatchPhotosLoading] = useState(false);
  const [selectedBatchPreview, setSelectedBatchPreview] = useState<number | null>(null);

  // Sequences (reorderable)
  const [sequences, setSequences] = useState<SequenceItem[]>([
    { id: 'intro', type: 'intro', label: 'Photo Affiche + Titre', duration: 5, color: '#ec4899', icon: '🖼️' },
    { id: 'cards', type: 'cards', label: 'Cartes d\'Information', duration: 8, color: '#a855f7', icon: '📊' },
    { id: 'video', type: 'video', label: 'Vidéo', duration: 12, color: '#3b82f6', icon: '🎬' },
    { id: 'cta', type: 'cta', label: 'CTA (Appel à l\'action)', duration: 5, color: '#22c55e', icon: '📢' },
  ]);
  const totalDuration = sequences.reduce((sum, s) => sum + s.duration, 0);

  // Preview sequence navigation
  const [previewSeqIndex, setPreviewSeqIndex] = useState(0);
  const [previewAutoPlay, setPreviewAutoPlay] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previewProgressRef = useRef<NodeJS.Timeout | null>(null);

  // Other state
  const [salesPhrase, setSalesPhrase] = useState('');
  const [destination, setDestination] = useState<Destination>('calendar');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportToast, setExportToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const router = useRouter();

  // File input refs
  const posterPhotoInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (musicPreviewUrl) URL.revokeObjectURL(musicPreviewUrl);
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
      if (characterImagePreview) URL.revokeObjectURL(characterImagePreview);
      if (posterPhotoPreview) URL.revokeObjectURL(posterPhotoPreview);
    };
  }, []);

  // Auto-play montage preview
  useEffect(() => {
    if (!previewAutoPlay) {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      if (previewProgressRef.current) clearInterval(previewProgressRef.current);
      return;
    }
    const active = sequences.filter(s => s.type !== 'video' || selectedVideo);
    const currentDur = (active[previewSeqIndex]?.duration || 5) * 1000;
    let elapsed = 0;
    if (previewProgressRef.current) clearInterval(previewProgressRef.current);
    setPreviewProgress(0);
    previewProgressRef.current = setInterval(() => { elapsed += 50; setPreviewProgress(Math.min(100, (elapsed / currentDur) * 100)); }, 50);
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      if (previewSeqIndex < active.length - 1) setPreviewSeqIndex(previewSeqIndex + 1);
      else setPreviewSeqIndex(0);
    }, currentDur);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); if (previewProgressRef.current) clearInterval(previewProgressRef.current); };
  }, [previewAutoPlay, previewSeqIndex, sequences, selectedVideo]);

  const handleThemeSelect = (theme: ThemeType) => {
    setSelectedTheme(theme);
    const preset = THEME_PRESETS[theme];
    setTitle(preset.title);
    setSubtitle(preset.subtitle);
    if (preset.cards.length > 0) {
      setCards(preset.cards.map((card, idx) => ({ ...card, id: `${idx}`, color: card.color || '#ec4899' })));
    }
  };

  const ICON_TO_EMOJI: Record<string, string> = {
    energy: '⚡', heart: '❤️', dance: '💃', audio: '🎧', apple: '🍎',
    moon: '🌙', fire: '🔥', droplet: '💧', muscle: '💪', clock: '⏱️',
    star: '⭐', brain: '🧠', shield: '🛡️', target: '🎯', trophy: '🏆',
    people: '👥', sun: '☀️', leaf: '🌿', chart: '📈', sparkle: '✨',
    thermometer: '🌡️', bone: '🦴', eye: '👁️', lungs: '🫁', dna: '🧬',
  };

  const handleGenerateTitleAndSubtitle = () => {
    const suggestions = [
      { title: 'TRANSFORME TON CORPS', subtitle: 'La danse est ton arme secrète' },
      { title: 'ÉNERGIE SANS LIMITE', subtitle: 'Repousse tes limites chaque jour' },
      { title: 'DANSE & PERFORMANCE', subtitle: 'Atteins tes objectifs plus vite' },
      { title: 'BIEN-ÊTRE TOTAL', subtitle: 'Corps et esprit en harmonie' },
    ];
    const pick = suggestions[Math.floor(Math.random() * suggestions.length)];
    setTitle(pick.title);
    setSubtitle(pick.subtitle);
  };

  const handleGenerateFromTitle = () => {
    if (!title.trim()) return;
    const result = generateSmartContent(title);
    setSubtitle(result.subtitle);
    if (result.cards.length > 0) {
      const colors = ['#ec4899', '#ef4444', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b', '#6366f1'];
      setCards(result.cards.slice(0, 5).map((card, idx) => ({
        id: `smart-${idx}-${Date.now()}`,
        emoji: ICON_TO_EMOJI[card.icon] || '⭐',
        label: card.title,
        value: card.value,
        color: colors[idx % colors.length],
      })));
    }
  };

  const addCard = () => setCards([...cards, { id: Date.now().toString(), emoji: '⭐', label: 'Nouvelle carte', value: 'Valeur', color: '#ec4899' }]);
  const deleteCard = (id: string) => setCards(cards.filter((c) => c.id !== id));
  const updateCard = (id: string, updates: Partial<InfoCard>) => setCards(cards.map((c) => (c.id === id ? { ...c, ...updates } : c)));

  // --- FILE HANDLERS ---
  const handlePosterPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPosterPhotoFile(file);
    if (posterPhotoPreview) URL.revokeObjectURL(posterPhotoPreview);
    setPosterPhotoPreview(URL.createObjectURL(file));
    setSelectedPexelsUrl(null);
    setPosterPhoto(true);
  };

  const THEME_TO_QUERY: Record<string, string> = {
    sommeil: 'sleep rest wellness night', nutrition: 'healthy food nutrition fruits',
    energie: 'energy cardio fitness dance', stress: 'mental health meditation calm',
    communaute: 'community dance group fitness', custom: 'fitness workout dance',
  };

  const searchPexels = async (query?: string) => {
    const searchQuery = query || pexelsQuery || THEME_TO_QUERY[selectedTheme] || 'fitness dance';
    setPexelsLoading(true);
    try {
      const res = await fetch(`/api/pexels?query=${encodeURIComponent(searchQuery)}&count=8`);
      const data = await res.json();
      setPexelsResults(data.success && data.photos ? data.photos : []);
    } catch { setPexelsResults([]); } finally { setPexelsLoading(false); }
  };

  const handleSelectPexelsImage = (url: string) => {
    setSelectedPexelsUrl(url);
    setPosterPhotoFile(null);
    if (posterPhotoPreview) URL.revokeObjectURL(posterPhotoPreview);
    setPosterPhotoPreview(null);
    setPosterPhoto(true);
  };

  useEffect(() => {
    if (posterPhoto && pexelsResults.length === 0) searchPexels(THEME_TO_QUERY[selectedTheme]);
  }, [posterPhoto]);

  // --- BATCH ---
  const BATCH_TITLE_VARIATIONS: Record<string, string[]> = {
    sommeil: ['SOMMEIL & SPORT', 'REPOS RÉPARATEUR', 'DORS MIEUX', 'NUIT DE CHAMPION', 'RÉCUPÉRATION MAX', 'SLEEP BETTER', 'REPOS ACTIF', 'BIEN DORMIR', 'NUIT PROFONDE', 'SOMMEIL SPORTIF'],
    nutrition: ['NUTRITION & DANSE', 'MANGE & DANSE', 'FUEL YOUR BODY', 'HEALTHY MOVES', 'EAT CLEAN', 'SUPER FOOD', 'ÉNERGIE SAINE', 'NUTRITION FIT', 'BON & SAIN', 'BIEN MANGER'],
    energie: ['ÉNERGIE & CARDIO', 'CARDIO MAX', 'FULL ENERGY', 'BOOST TOTAL', 'FIRE UP', 'POWER MOVE', 'HIGH INTENSITY', 'CARDIO BLAST', 'ÉNERGIE PURE', 'MAX EFFORT'],
    stress: ['STRESS & MENTAL', 'MENTAL FORT', 'ZÉRO STRESS', 'INNER PEACE', 'BIEN-ÊTRE', 'MIND POWER', 'CALME INTÉRIEUR', 'FEEL GOOD', 'ANTI-STRESS', 'ÉQUILIBRE'],
    communaute: ['COMMUNAUTÉ', 'TEAM SPIRIT', 'ENSEMBLE', 'LA TRIBU', 'CREW GOALS', 'REJOINS-NOUS', 'ON EST LÀ', 'UNITED', 'SQUAD UP', 'FAMILY FIRST'],
    custom: ['DÉCOUVRE', 'À TESTER', 'NOUVEAU', 'EXCLUSIF', 'INÉDIT', 'TENDANCE', 'HOT TOPIC', 'VIRAL', 'MUST SEE', 'TOP CONTENU'],
  };
  const BATCH_SUB_VARIATIONS: Record<string, string[]> = {
    sommeil: ['Danse pour mieux dormir', 'Booste ta récupération', 'Le sport améliore ton sommeil', 'Qualité de sommeil x2', 'Repose-toi comme un champion', 'Nuit réparatrice garantie', 'Endors-toi plus vite', 'Récupère comme un pro', 'Ton sommeil optimisé', 'Le repos du guerrier'],
    nutrition: ['Nourris ton corps', 'L\'énergie vient de l\'assiette', 'Mange bien, danse mieux', 'Alimente ta performance', 'Recettes de champion', 'Nutrition sportive', 'Boost naturel', 'Ton corps te remerciera', 'Aliments magiques', 'La clé de la forme'],
    energie: ['Pousse tes limites', 'Dépasse-toi', 'Ton cardio au max', 'Brûle des calories', 'Énergie explosive', 'Full puissance', 'Intensité maximale', 'Le feu intérieur', 'Repousse tes limites', 'Énergie sans fin'],
    stress: ['Libère ton esprit', 'Danse ta sérénité', 'Le mouvement guérit', 'Respire et danse', 'Trouve ton équilibre', 'Paix intérieure', 'Zéro pression', 'Calme et puissance', 'L\'esprit libre', 'Bien dans ta peau'],
    communaute: ['Rejoins la tribu', 'On danse ensemble', 'La force du groupe', 'Partage l\'énergie', 'Communauté de feu', 'Ensemble on est fort', 'La team grandit', 'Bienvenue dans la famille', 'L\'union fait la force', 'Danse et partage'],
    custom: ['Contenu exclusif', 'Découvre maintenant', 'Ne rate rien', 'Nouveau concept', 'À toi de jouer', 'C\'est le moment', 'Fais le premier pas', 'Tu vas adorer', 'Essaie maintenant', 'Le changement commence ici'],
  };

  const generateBatchVariations = async (): Promise<BatchVariation[]> => {
    const titlePool = BATCH_TITLE_VARIATIONS[selectedTheme] || BATCH_TITLE_VARIATIONS['custom'];
    const subPool = BATCH_SUB_VARIATIONS[selectedTheme] || BATCH_SUB_VARIATIONS['custom'];
    const usedT: string[] = []; const usedS: string[] = [];
    const pickUniq = (arr: string[], used: string[]) => { const pool = arr.filter((x) => !used.includes(x)); return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : arr[Math.floor(Math.random() * arr.length)]; };
    setBatchPhotosLoading(true);
    let photos: string[] = [];
    try {
      const pRes = await fetch(`/api/pexels?query=${encodeURIComponent(THEME_TO_QUERY[selectedTheme] || 'fitness dance')}&count=12`);
      const pData = await pRes.json();
      if (pData.success && pData.photos) photos = pData.photos.map((p: { url: string; medium: string }) => p.medium || p.url);
    } catch { /* ignore */ }
    const variations: BatchVariation[] = [];
    for (let i = 0; i < 10; i++) {
      const bTitle = i === 0 ? (title || titlePool[0]) : pickUniq(titlePool, usedT);
      const bSub = i === 0 ? (subtitle || subPool[0]) : pickUniq(subPool, usedS);
      const bPhrase = i === 0 ? (salesPhrase || SALES_PHRASES[0]) : SALES_PHRASES[Math.floor(Math.random() * SALES_PHRASES.length)];
      usedT.push(bTitle); usedS.push(bSub);
      variations.push({ title: bTitle, subtitle: bSub, salesPhrase: bPhrase, photoUrl: photos[i] || photos[i % Math.max(photos.length, 1)] || null });
    }
    setBatchVariations(variations); setBatchPhotosLoading(false); setSelectedBatchPreview(null);
    return variations;
  };

  useEffect(() => { if (batchMode) generateBatchVariations(); else { setBatchVariations([]); setSelectedBatchPreview(null); } }, [batchMode, selectedTheme]);

  // --- Media handlers ---
  const handleMusicSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setSelectedMusic(f); setMusicName(f.name); if (musicPreviewUrl) URL.revokeObjectURL(musicPreviewUrl); setMusicPreviewUrl(URL.createObjectURL(f)); };
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setSelectedVideo(f); setVideoName(f.name); if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl); setVideoPreviewUrl(URL.createObjectURL(f)); };
  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setSelectedLogo(f); setLogoName(f.name); if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl); setLogoPreviewUrl(URL.createObjectURL(f)); };
  const handleCharacterImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setCharacterImageFile(f); if (characterImagePreview) URL.revokeObjectURL(characterImagePreview); setCharacterImagePreview(URL.createObjectURL(f)); setCharacterImage(true); };
  const handleVoiceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setVoiceFile(f); setVoiceFileName(f.name); };

  const handlePreviewVoice = async () => {
    if (isPreviewingVoice) return;
    setIsPreviewingVoice(true);
    try { const audioUrl = await previewVoice(selectedVoice); const audio = new Audio(audioUrl); audio.onended = () => setIsPreviewingVoice(false); audio.onerror = () => setIsPreviewingVoice(false); await audio.play(); }
    catch { setIsPreviewingVoice(false); setExportToast({ message: 'Impossible de lire l\'aperçu vocal.', type: 'error' }); setTimeout(() => setExportToast(null), 4000); }
  };

  const toggleMusicPlayback = () => {
    if (!musicPreviewUrl) return;
    if (isPlayingMusic && musicAudioRef.current) { musicAudioRef.current.pause(); setIsPlayingMusic(false); }
    else { if (!musicAudioRef.current) { musicAudioRef.current = new Audio(musicPreviewUrl); musicAudioRef.current.onended = () => setIsPlayingMusic(false); } musicAudioRef.current.play(); setIsPlayingMusic(true); }
  };

  // --- Sequence reorder ---
  const moveSequence = (index: number, direction: 'up' | 'down') => {
    const newSeqs = [...sequences];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newSeqs.length) return;
    [newSeqs[index], newSeqs[targetIdx]] = [newSeqs[targetIdx], newSeqs[index]];
    setSequences(newSeqs);
  };

  const updateSequenceDuration = (id: string, duration: number) => {
    setSequences(sequences.map((s) => s.id === id ? { ...s, duration: Math.max(1, duration) } : s));
  };

  // --- Export ---
  const uploadFile = async (file: File, purpose: string): Promise<string | null> => {
    try { const fd = new FormData(); fd.append('file', file); fd.append('purpose', purpose); const r = await fetch('/api/upload/media', { method: 'POST', body: fd }); const d = await r.json(); return d.success ? d.file.url : null; } catch { return null; }
  };

  const handleExport = async () => {
    if (cards.length === 0) { setExportToast({ message: 'Ajoutez au moins une carte avant d\'exporter', type: 'error' }); setTimeout(() => setExportToast(null), 3000); return; }
    setIsExporting(true); setExportProgress(0);
    try {
      // ═══ PHASE 0: Generate Edge TTS voice if selected ═══
      let actualVoiceFile = voiceFile;
      if (voiceOption === 'edge' && !voiceFile) {
        setExportToast({ message: 'Génération de la voix off...', type: 'success' });
        setExportProgress(1);
        try {
          // Build TTS text from title + subtitle + salesPhrase + card labels
          const ttsText = [
            title || 'Votre vidéo',
            subtitle,
            salesPhrase,
            ...cards.map(c => `${c.label}: ${c.value}`),
          ].filter(Boolean).join('. ');
          console.log('[Export] Generating Edge TTS with text:', ttsText.substring(0, 100));
          const ttsBlob = await synthesize(ttsText, selectedVoice);
          actualVoiceFile = new File([ttsBlob], 'voiceover-tts.mp3', { type: 'audio/mpeg' });
          console.log('[Export] Edge TTS generated:', (ttsBlob.size / 1024).toFixed(1), 'KB');
        } catch (ttsErr) {
          console.error('[Export] Edge TTS generation failed:', ttsErr);
        }
      }

      // ═══ PHASE 1: Upload raw files to get URLs (0-20%) ═══
      setExportToast({ message: 'Upload des fichiers...', type: 'success' });
      setExportProgress(3);
      const filesToUpload = [
        selectedMusic ? uploadFile(selectedMusic, 'music') : Promise.resolve(null),
        selectedVideo ? uploadFile(selectedVideo, 'rush') : Promise.resolve(null),
        selectedLogo ? uploadFile(selectedLogo, 'logo') : Promise.resolve(null),
        characterImageFile ? uploadFile(characterImageFile, 'thumbnail') : Promise.resolve(null),
        actualVoiceFile ? uploadFile(actualVoiceFile, 'voiceover') : Promise.resolve(null),
        posterPhotoFile ? uploadFile(posterPhotoFile, 'poster') : Promise.resolve(null),
      ];
      const totalFiles = filesToUpload.filter((_, i) => [selectedMusic, selectedVideo, selectedLogo, characterImageFile, actualVoiceFile, posterPhotoFile][i]).length;
      let uploadedCount = 0;
      const uploadResults = await Promise.all(filesToUpload.map(async (p, i) => {
        const result = await p;
        if ([selectedMusic, selectedVideo, selectedLogo, characterImageFile, actualVoiceFile, posterPhotoFile][i]) { uploadedCount++; setExportProgress(Math.round(3 + (uploadedCount / Math.max(totalFiles, 1)) * 17)); }
        return result;
      }));
      const [musicUrl, videoUrl, logoUrl, characterUrl, voiceUrl, posterUrl] = uploadResults;

      // ═══ PHASE 2: Batch variations ═══
      const batchTotal = batchMode ? 10 : 1;
      let variations = batchVariations;
      if (batchMode && variations.length === 0) variations = await generateBatchVariations();

      const seqIntro = sequences.find(s => s.type === 'intro')?.duration || 5;
      const seqCards = sequences.find(s => s.type === 'cards')?.duration || 8;
      const seqVideo = sequences.find(s => s.type === 'video')?.duration || 12;
      const seqCta = sequences.find(s => s.type === 'cta')?.duration || 5;
      const seqOrder = sequences.map(s => s.type);
      const isReel = format !== '16:9';
      const compWidth = isReel ? 1080 : 1920;
      const compHeight = isReel ? 1920 : 1080;

      let successCount = 0;
      let lastError = '';

      if (destination === 'calendar' || destination === 'both') {
        const today = new Date();

        for (let b = 0; b < batchTotal; b++) {
          const variation = batchMode && variations[b] ? variations[b] : null;
          const bTitle = variation ? variation.title : (title || 'Infographie');
          const bSub = variation ? variation.subtitle : subtitle;
          const bPhrase = variation ? variation.salesPhrase : salesPhrase;
          const bMediaUrl = variation?.photoUrl || posterUrl || selectedPexelsUrl || characterUrl || null;

          const progressBase = 20 + (b / batchTotal) * 70;
          const progressSpan = 70 / batchTotal;

          setExportToast({ message: batchTotal > 1 ? `Montage vidéo ${b + 1}/${batchTotal}...` : 'Montage vidéo en cours...', type: 'success' });
          setExportProgress(Math.round(progressBase));

          // ═══ CLIENT-SIDE VIDEO RENDERING ═══
          let renderedVideoUrl: string | null = null;
          try {
            const { url } = await composeAndUpload({
              width: compWidth, height: compHeight, fps: 30,
              title: bTitle, subtitle: bSub, salesPhrase: bPhrase,
              cards: cards.map(c => ({ emoji: c.emoji, label: c.label, value: c.value, color: c.color })),
              posterUrl: bMediaUrl || characterUrl, videoUrl, logoUrl, musicUrl, voiceUrl,
              introDuration: seqIntro, cardsDuration: seqCards, videoDuration: seqVideo, ctaDuration: seqCta,
              accentColor: branding.accentColor || '#D91CD2',
              ctaText: branding.ctaText || 'CHAT POUR PLUS D\'INFOS',
              ctaSubText: branding.ctaSubText || 'LIEN EN BIO',
              watermarkText: branding.watermarkText,
              onProgress: (pct, stage) => {
                setExportProgress(Math.round(progressBase + (pct / 100) * progressSpan));
                setExportToast({ message: stage, type: 'success' });
              },
            });
            renderedVideoUrl = url;
          } catch (err) {
            console.error(`[Compose] Erreur vidéo ${b + 1}:`, err);
            lastError = String(err);
          }

          // Create calendar post with rendered video
          const scheduledDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const hour = 9 + Math.floor(b / 2);
          const minute = (b % 2) * 30;
          const scheduledTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          const caption = [bSub, bPhrase, cards.map((c) => `${c.emoji} ${c.label}: ${c.value}`).join(' | ')].filter(Boolean).join('\n');
          // ALWAYS use the rendered montage video — never fall back to raw video
          const postMediaUrl = renderedVideoUrl || bMediaUrl;
          const postMediaType = renderedVideoUrl ? 'video' : (bMediaUrl ? 'image' : 'video');
          if (!renderedVideoUrl) {
            console.warn('[Export] Montage video URL is null — upload may have failed');
          }

          try {
            const postRes = await fetch('/api/posts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: bTitle, caption, media_url: postMediaUrl, media_type: postMediaType,
                format: isReel ? 'reel' : 'tv', platforms: [],
                scheduled_date: scheduledDate, scheduled_time: scheduledTime, status: 'draft',
                metadata: {
                  type: 'infographic', subtitle: bSub, salesPhrase: bPhrase, theme: selectedTheme,
                  cards: cards.map((c) => ({ emoji: c.emoji, label: c.label, value: c.value, color: c.color })),
                  posterUrl: posterUrl || null, pexelsUrl: bMediaUrl, characterUrl: characterUrl || null,
                  videoUrl: renderedVideoUrl || null, renderedVideoUrl: renderedVideoUrl || null, rawVideoUrl: videoUrl || null,
                  logoUrl: logoUrl || null, musicUrl: musicUrl || null, voiceUrl: voiceUrl || null,
                  voiceMode: voiceOption !== 'none' ? voiceOption : null,
                  sequences: { intro: seqIntro, cards: seqCards, video: seqVideo, cta: seqCta, total: totalDuration, order: seqOrder },
                  branding: { watermarkText: branding.watermarkText, borderColor: branding.borderEnabled ? branding.borderColor : null, ctaText: branding.ctaText, ctaSubText: branding.ctaSubText, accentColor: branding.accentColor },
                },
              }),
            });
            const postData = await postRes.json();
            if (postData.success) { successCount++; }
            else { lastError = postData.error || 'Unknown error'; }
          } catch (postErr) { lastError = String(postErr); }

          // Also create a video record in the library
          try {
            await fetch('/api/videos', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: bTitle,
                format: isReel ? 'reel' : 'tv',
                type: 'infographic',
                status: renderedVideoUrl ? 'completed' : 'draft',
                video_url: renderedVideoUrl || null,
                thumbnail_url: bMediaUrl || null,
                metadata: {
                  title: bTitle, subtitle: bSub, salesPhrase: bPhrase,
                  posterPhotoUrl: posterUrl || null, characterUrl: characterUrl || null, characterImageUrl: bMediaUrl || null,
                  rushUrls: videoUrl ? [videoUrl] : [], musicUrl: musicUrl || null, voiceUrl: voiceUrl || null,
                  renderedVideoUrl: renderedVideoUrl || null,
                },
              }),
            });
          } catch (vidErr) { console.error('[Export] Video record creation failed:', vidErr); }
          setExportProgress(Math.round(progressBase + progressSpan));
        }
      }

      // Direct export (download)
      if (destination === 'export' || destination === 'both') {
        setExportToast({ message: 'Montage vidéo pour export...', type: 'success' });
        try {
          const { blob } = await composeAndUpload({
            width: compWidth, height: compHeight, fps: 30,
            title: title || 'Infographie', subtitle, salesPhrase,
            cards: cards.map(c => ({ emoji: c.emoji, label: c.label, value: c.value, color: c.color })),
            posterUrl: posterUrl || selectedPexelsUrl || characterUrl, videoUrl, logoUrl, musicUrl, voiceUrl,
            introDuration: seqIntro, cardsDuration: seqCards, videoDuration: seqVideo, ctaDuration: seqCta,
            accentColor: branding.accentColor || '#D91CD2',
            ctaText: branding.ctaText || 'CHAT POUR PLUS D\'INFOS',
            ctaSubText: branding.ctaSubText || 'LIEN EN BIO',
            watermarkText: branding.watermarkText,
            onProgress: (pct, stage) => { setExportProgress(pct); setExportToast({ message: stage, type: 'success' }); },
          });
          const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
          downloadBlob(blob, `${(title || 'infographie').replace(/\s+/g, '_')}.${ext}`);
        } catch (err) { console.error('Export render error:', err); }
      }

      setExportProgress(100);
      if (destination === 'calendar' || destination === 'both') {
        if (successCount > 0) {
          setExportToast({ message: `${successCount} vidéo${successCount > 1 ? 's' : ''} montée${successCount > 1 ? 's' : ''} au calendrier !`, type: 'success' });
          await new Promise((r) => setTimeout(r, 1500)); router.push('/dashboard/calendar');
        } else {
          setExportToast({ message: `Erreur: aucun post créé. ${lastError}`, type: 'error' });
        }
      } else { setExportToast({ message: 'Vidéo montée exportée !', type: 'success' }); }
    } catch (error) {
      console.error('Export error:', error); setExportProgress(0);
      setExportToast({ message: 'Erreur lors de l\'export. Veuillez réessayer.', type: 'error' });
    } finally { setTimeout(() => { setIsExporting(false); setExportProgress(0); setExportToast(null); }, 5000); }
  };

  // --- Preview for a single sequence screen ---
  const renderSequencePreview = (seqType: string) => {
    const accent = branding.accentColor || '#D91CD2';
    const bgImg = selectedPexelsUrl || posterPhotoPreview || characterImagePreview;

    if (seqType === 'intro') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {bgImg ? <img src={bgImg} alt="BG" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-b from-black to-purple-950" />}
          <div className="absolute inset-0" style={{ background: bgImg ? 'linear-gradient(to top, rgba(100,0,140,0.8) 0%, rgba(0,0,0,0.3) 40%, transparent 65%)' : 'transparent' }} />
          <div className="relative z-10 text-center px-3">
            <h3 className="text-lg font-black text-white uppercase tracking-wider leading-tight" style={{ textShadow: `0 0 12px ${accent}CC, 0 0 30px ${accent}66` }}>{title || 'TITRE'}</h3>
            {subtitle && <p className="text-[9px] text-white/80 mt-1" style={{ textShadow: `0 0 8px ${accent}80` }}>{subtitle}</p>}
            <div className="w-10 h-0.5 mt-2 mx-auto rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
          </div>
        </div>
      );
    }

    if (seqType === 'cards') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="absolute inset-0 bg-gradient-to-b from-purple-950 to-black" />
          <div className="relative z-10 w-full px-3 space-y-1.5">
            <p className="text-[8px] font-bold text-white/60 uppercase tracking-widest text-center mb-2">Informations</p>
            {cards.slice(0, 5).map((card, i) => (
              <div key={i} className="flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-lg px-2 py-1.5 border-l-2" style={{ borderColor: card.color }}>
                <span className="text-sm">{card.emoji}</span>
                <span className="text-[8px] text-white/70 flex-1">{card.label}</span>
                <span className="text-[10px] font-bold text-white" style={{ textShadow: `0 0 6px ${accent}80` }}>{card.value}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (seqType === 'video') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {videoPreviewUrl ? (
            <video src={videoPreviewUrl} className="absolute inset-0 w-full h-full object-cover" muted loop autoPlay playsInline />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-b from-gray-900 to-black flex items-center justify-center">
              <div className="text-center">
                <Film size={24} className="text-gray-600 mx-auto mb-1" />
                <p className="text-[9px] text-gray-500">Aucune vidéo</p>
              </div>
            </div>
          )}
          {logoPreviewUrl && (
            <div className="absolute bottom-2 right-2 z-10">
              <img src={logoPreviewUrl} alt="Logo" className="w-8 h-8 rounded object-contain bg-black/50 p-0.5" />
            </div>
          )}
        </div>
      );
    }

    if (seqType === 'cta') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: `linear-gradient(135deg, ${accent}CC, #FF2DAA99, ${accent}66)` }}>
          <div className="text-center px-4">
            <p className="text-sm font-black text-white uppercase tracking-wider mb-2" style={{ textShadow: `0 0 15px ${accent}` }}>
              {branding.ctaText || 'CHAT POUR PLUS D\'INFOS'}
            </p>
            <p className="text-[8px] text-white/70 uppercase tracking-wider">{branding.ctaSubText || 'LIEN EN BIO'}</p>
            {salesPhrase && <p className="text-[9px] text-white/90 mt-2 italic font-medium">{salesPhrase}</p>}
            {branding.watermarkText && <p className="text-[6px] text-white/30 mt-3 tracking-[0.15em]">{branding.watermarkText}</p>}
          </div>
        </div>
      );
    }

    return null;
  };

  const activeSequences = sequences.filter(s => s.type !== 'video' || selectedVideo);

  // ========================== RENDER ==========================
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Hidden file inputs */}
      <input ref={posterPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePosterPhotoSelect} />
      <input ref={musicInputRef} type="file" accept="audio/*" className="hidden" onChange={handleMusicSelect} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoSelect} />
      <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
      <input ref={characterInputRef} type="file" accept="image/*" className="hidden" onChange={handleCharacterImageSelect} />
      <input ref={voiceInputRef} type="file" accept="audio/*" className="hidden" onChange={handleVoiceFileSelect} />

      {/* Toast — only show final messages, not during rendering progress */}
      {exportToast && !isExporting && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${exportToast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {exportToast.message}
        </div>
      )}

      {/* Header + Step Indicator */}
      <div className="border-b border-gray-700 bg-gray-800/50 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Créateur d&apos;Infographie</h1>
            <p className="text-sm text-gray-400 mt-0.5">Étape {step} sur 3</p>
          </div>
          <div className="flex items-center gap-1">
            {[1, 2, 3].map((s) => (
              <button key={s} onClick={() => setStep(s)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${step === s ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white' : s < step ? 'bg-green-600/20 text-green-400 border border-green-600/30' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: step === s ? 'white' : 'transparent', color: step === s ? '#D91CD2' : 'inherit' }}>{s < step ? '✓' : s}</span>
                {s === 1 && 'Contenu'}
                {s === 2 && 'Médias'}
                {s === 3 && 'Finaliser'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT COLUMN — Form (60%) */}
        <div className="w-3/5 overflow-y-auto border-r border-gray-700 bg-gray-900 px-8 py-6">

          {/* ===== STEP 1: CONTENU ===== */}
          {step === 1 && (
            <div>
              {/* Theme selector */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Sélectionner un thème</h3>
                <div className="grid grid-cols-3 gap-2">
                  {(['sommeil', 'nutrition', 'energie', 'stress', 'communaute', 'custom'] as ThemeType[]).map((theme) => (
                    <button key={theme} onClick={() => handleThemeSelect(theme)} className={`py-2.5 px-3 rounded-lg font-medium text-sm transition-all ${selectedTheme === theme ? 'bg-gradient-to-r from-pink-600 to-pink-400 text-white' : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'}`}>
                      {theme === 'sommeil' && 'Sommeil & Sport'}{theme === 'nutrition' && 'Nutrition & Danse'}{theme === 'energie' && 'Énergie & Cardio'}{theme === 'stress' && 'Stress & Mental'}{theme === 'communaute' && 'Communauté'}{theme === 'custom' && 'Personnalisé'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Batch mode */}
              <div className="mb-6 flex items-center gap-3 bg-gray-800 rounded-lg p-3 border border-gray-700">
                <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} className="w-4 h-4 rounded accent-pink-500" />
                <div className="flex-1">
                  <div className="font-semibold text-sm">Mode BATCH x10</div>
                  <div className="text-xs text-gray-400">10 vidéos avec des textes et photos différents</div>
                </div>
                {batchMode && (
                  <button onClick={generateBatchVariations} disabled={batchPhotosLoading} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-white transition flex items-center gap-1 disabled:opacity-50">
                    {batchPhotosLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Régénérer
                  </button>
                )}
              </div>

              {/* Batch preview grid */}
              {batchMode && batchVariations.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-semibold text-gray-400 mb-2">Aperçu des 10 variantes</h3>
                  <div className="grid grid-cols-5 gap-1.5">
                    {batchVariations.map((v, i) => (
                      <button key={i} onClick={() => setSelectedBatchPreview(selectedBatchPreview === i ? null : i)} className={`relative rounded-lg overflow-hidden border-2 aspect-[9/16] transition-all ${selectedBatchPreview === i ? 'border-pink-500 ring-2 ring-pink-500/30' : 'border-gray-700 hover:border-gray-500'}`}>
                        {v.photoUrl ? <img src={v.photoUrl} alt={v.title} className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-b from-black to-purple-950" />}
                        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(100,0,140,0.85) 0%, transparent 70%)' }} />
                        <div className="relative z-10 flex flex-col justify-end h-full p-1">
                          <p className="text-[6px] font-black text-white uppercase text-center leading-tight" style={{ textShadow: '0 0 8px rgba(217,28,210,0.8)' }}>{v.title}</p>
                        </div>
                        <div className="absolute top-0.5 left-0.5 bg-black/60 text-[6px] font-bold text-white w-3 h-3 rounded-full flex items-center justify-center">{i + 1}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Title */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-400">Titre</label>
                  <button onClick={() => { if (selectedTheme === 'custom') handleGenerateFromTitle(); else handleGenerateTitleAndSubtitle(); if (batchMode) generateBatchVariations(); }} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-[#D91CD2] border border-[#D91CD2]/30 hover:bg-[#D91CD2]/10 transition">
                    <Sparkles size={12} /> IA
                  </button>
                </div>
                <div className="flex gap-2">
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && selectedTheme === 'custom') handleGenerateFromTitle(); }} className="flex-1 rounded-lg bg-gray-800 px-4 py-2 text-white placeholder-gray-500 border border-gray-700 focus:border-pink-500 focus:outline-none text-sm" placeholder={selectedTheme === 'custom' ? 'Tape un sujet: moringa, eau, cardio...' : 'ex: ÉNERGIE & CARDIO'} />
                  {selectedTheme === 'custom' && <button onClick={handleGenerateFromTitle} className="px-3 py-2 bg-gradient-to-r from-purple-600 to-pink-500 rounded-lg text-xs font-bold text-white flex items-center gap-1"><Sparkles size={12} /> Générer</button>}
                </div>
              </div>

              {/* Subtitle */}
              <div className="mb-6">
                <label className="block text-xs font-semibold text-gray-400 mb-2">Sous-titre</label>
                <input type="text" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="w-full rounded-lg bg-gray-800 px-4 py-2 text-white placeholder-gray-500 border border-gray-700 focus:border-pink-500 focus:outline-none text-sm" placeholder="ex: Pousse tes limites avec Afroboost" />
              </div>

              {/* Info cards */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-300">Cartes d&apos;Information</h3>
                  <button onClick={addCard} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#D91CD2] border border-[#D91CD2]/30 hover:bg-[#D91CD2]/10 transition"><Plus size={14} /> Ajouter</button>
                </div>
                <div className="space-y-2">
                  {cards.map((card) => (
                    <div key={card.id} className="flex items-center gap-2 bg-gray-800 rounded-lg p-2.5 border border-gray-700">
                      <div className="flex-shrink-0 relative group">
                        <button className="w-8 h-8 bg-gray-700 hover:bg-gray-600 rounded text-lg flex items-center justify-center">{card.emoji}</button>
                        <div className="absolute bottom-full mb-2 left-0 hidden group-hover:grid grid-cols-4 gap-1 bg-gray-700 p-2 rounded-lg shadow-lg z-10">
                          {EMOJI_LIST.map((emoji) => (<button key={emoji} onClick={() => updateCard(card.id, { emoji })} className="w-6 h-6 text-sm hover:bg-gray-600 rounded flex items-center justify-center">{emoji}</button>))}
                        </div>
                      </div>
                      <input type="text" value={card.label} onChange={(e) => updateCard(card.id, { label: e.target.value })} className="flex-1 min-w-0 rounded bg-gray-700 px-2 py-1 text-xs text-white border border-gray-600 focus:border-pink-500 focus:outline-none" />
                      <input type="text" value={card.value} onChange={(e) => updateCard(card.id, { value: e.target.value })} className="flex-1 min-w-0 rounded bg-gray-700 px-2 py-1 text-xs text-white border border-gray-600 focus:border-pink-500 focus:outline-none" />
                      <input type="color" value={card.color} onChange={(e) => updateCard(card.id, { color: e.target.value })} className="h-8 w-10 rounded cursor-pointer border-0 bg-transparent flex-shrink-0" />
                      <button onClick={() => deleteCard(card.id)} className="flex-shrink-0 p-1 text-gray-400 hover:text-red-400 transition"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sales phrase */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-300">Phrase de vente</h3>
                  <button onClick={() => setSalesPhrase(SALES_PHRASES[Math.floor(Math.random() * SALES_PHRASES.length)])} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-[#D91CD2] border border-[#D91CD2]/30 hover:bg-[#D91CD2]/10 transition"><Sparkles size={12} /> IA</button>
                </div>
                <input type="text" value={salesPhrase} onChange={(e) => setSalesPhrase(e.target.value)} className="w-full rounded-lg bg-gray-800 px-4 py-2 text-white placeholder-gray-500 border border-gray-700 focus:border-pink-500 focus:outline-none text-sm mb-2" placeholder="ex: Réserve ta place maintenant !" />
                <div className="flex flex-wrap gap-1.5">
                  {SALES_PHRASES.map((phrase) => (
                    <button key={phrase} onClick={() => setSalesPhrase(phrase)} className={`text-xs border px-2 py-1 rounded transition ${salesPhrase === phrase ? 'bg-pink-600/20 border-pink-500 text-pink-300' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>{phrase}</button>
                  ))}
                </div>
              </div>

              {/* Next step button */}
              <button onClick={() => setStep(2)} className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 rounded-lg text-sm font-bold transition">
                Étape suivante : Médias <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* ===== STEP 2: MEDIAS ===== */}
          {step === 2 && (
            <div>
              {/* Photo Affiche */}
              <div className="mb-6">
                <div className="flex items-center justify-between bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <div>
                    <div className="text-sm font-semibold">Photo Affiche</div>
                    <div className="text-xs text-gray-400">Image de fond pour la séquence Intro</div>
                  </div>
                  <button onClick={() => { if (posterPhoto) { setPosterPhoto(false); setPosterPhotoFile(null); setSelectedPexelsUrl(null); if (posterPhotoPreview) URL.revokeObjectURL(posterPhotoPreview); setPosterPhotoPreview(null); } else { setPosterPhoto(true); } }} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${posterPhoto ? 'bg-pink-600' : 'bg-gray-700'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${posterPhoto ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                {posterPhoto && (
                  <div className="mt-2 bg-gray-800 rounded-lg border border-gray-700 p-3 space-y-3">
                    <div className="flex gap-2">
                      <input type="text" value={pexelsQuery} onChange={(e) => setPexelsQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') searchPexels(); }} placeholder="Rechercher (ex: fitness, danse, yoga...)" className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-pink-500 focus:outline-none" />
                      <button onClick={() => searchPexels()} disabled={pexelsLoading} className="px-3 py-2 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 rounded-lg transition">
                        {pexelsLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      </button>
                    </div>
                    {(selectedPexelsUrl || posterPhotoPreview) && (
                      <div className="relative">
                        <img src={selectedPexelsUrl || posterPhotoPreview || ''} alt="Photo Affiche" className="w-full h-32 rounded-lg object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                          <button onClick={() => posterPhotoInputRef.current?.click()} className="flex items-center gap-1 bg-white/20 backdrop-blur px-3 py-1.5 rounded-lg text-white text-xs font-medium"><Upload size={12} /> Importer</button>
                          <button onClick={() => { setSelectedPexelsUrl(null); setPosterPhotoFile(null); if (posterPhotoPreview) URL.revokeObjectURL(posterPhotoPreview); setPosterPhotoPreview(null); }} className="flex items-center gap-1 bg-red-500/50 backdrop-blur px-3 py-1.5 rounded-lg text-white text-xs font-medium"><X size={12} /> Retirer</button>
                        </div>
                      </div>
                    )}
                    {pexelsResults.length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-500 mb-2">Cliquez pour sélectionner</p>
                        <div className="grid grid-cols-4 gap-2">
                          {pexelsResults.map((photo) => (
                            <button key={photo.id} onClick={() => handleSelectPexelsImage(photo.url)} className={`relative rounded-lg overflow-hidden aspect-square transition-all ${selectedPexelsUrl === photo.url ? 'ring-2 ring-pink-500 ring-offset-2 ring-offset-gray-800' : 'hover:opacity-80'}`}>
                              <img src={photo.small} alt={photo.alt || 'Pexels'} className="w-full h-full object-cover" />
                              {selectedPexelsUrl === photo.url && <div className="absolute inset-0 bg-pink-500/20 flex items-center justify-center"><div className="w-5 h-5 bg-pink-500 rounded-full flex items-center justify-center"><span className="text-white text-xs">✓</span></div></div>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {pexelsLoading && <div className="flex items-center justify-center py-4"><Loader2 size={20} className="animate-spin text-pink-400" /></div>}
                    {!pexelsLoading && pexelsResults.length === 0 && !selectedPexelsUrl && !posterPhotoPreview && (
                      <div className="flex flex-col items-center py-4 text-gray-500">
                        <ImageIcon size={20} className="mb-1" /><p className="text-xs">Recherchez ou importez une image</p>
                        <button onClick={() => posterPhotoInputRef.current?.click()} className="mt-2 text-xs text-pink-400 hover:text-pink-300 transition">Importer depuis votre ordinateur</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Video */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Vidéo (séquence 3)</h3>
                {selectedVideo ? (
                  <div className="flex items-center gap-3 bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700">
                    <Film size={18} className="text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{videoName}</p><p className="text-xs text-gray-400">{(selectedVideo.size / (1024 * 1024)).toFixed(1)} Mo</p></div>
                    <button onClick={() => { setSelectedVideo(null); setVideoName(''); if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl); setVideoPreviewUrl(null); }} className="p-1 text-gray-400 hover:text-red-400 transition"><X size={16} /></button>
                  </div>
                ) : (
                  <button onClick={() => videoInputRef.current?.click()} className="w-full flex flex-col items-center gap-2 bg-gray-800 hover:bg-gray-700 border-2 border-dashed border-gray-700 hover:border-blue-500/50 rounded-lg py-5 text-gray-400 hover:text-gray-300 transition cursor-pointer">
                    <Film size={20} /><span className="text-sm">Choisir une vidéo</span>
                  </button>
                )}
              </div>

              {/* Music */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Musique</h3>
                {selectedMusic ? (
                  <div className="flex items-center gap-3 bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700">
                    <button onClick={toggleMusicPlayback} className="flex-shrink-0 hover:text-pink-400 transition">{isPlayingMusic ? <Square size={18} /> : <Play size={18} />}</button>
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{musicName}</p><p className="text-xs text-gray-400">{(selectedMusic.size / (1024 * 1024)).toFixed(1)} Mo</p></div>
                    <button onClick={() => { setSelectedMusic(null); setMusicName(''); if (musicPreviewUrl) URL.revokeObjectURL(musicPreviewUrl); setMusicPreviewUrl(null); if (musicAudioRef.current) { musicAudioRef.current.pause(); musicAudioRef.current = null; } setIsPlayingMusic(false); }} className="p-1 text-gray-400 hover:text-red-400 transition"><X size={16} /></button>
                  </div>
                ) : (
                  <button onClick={() => musicInputRef.current?.click()} className="w-full flex flex-col items-center gap-2 bg-gray-800 hover:bg-gray-700 border-2 border-dashed border-gray-700 hover:border-pink-500/50 rounded-lg py-5 text-gray-400 hover:text-gray-300 transition cursor-pointer">
                    <Music size={20} /><span className="text-sm">Choisir une musique</span>
                  </button>
                )}
              </div>

              {/* Voice */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Voix Off</h3>
                <div className="flex gap-2 mb-2">
                  {(['none', 'edge', 'upload'] as VoiceOption[]).map((opt) => (
                    <button key={opt} onClick={() => setVoiceOption(opt)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition border ${voiceOption === opt ? 'bg-pink-600/20 border-pink-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}>
                      {opt === 'none' && 'Aucune'}{opt === 'edge' && 'Edge TTS'}{opt === 'upload' && 'Upload'}
                    </button>
                  ))}
                </div>
                {voiceOption === 'edge' && (
                  <div className="space-y-2">
                    <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:border-pink-500 focus:outline-none">
                      {TTS_VOICES.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.lang})</option>)}
                    </select>
                    <button onClick={handlePreviewVoice} disabled={isPreviewingVoice} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg transition">
                      {isPreviewingVoice ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />} {isPreviewingVoice ? 'Lecture...' : 'Aperçu'}
                    </button>
                  </div>
                )}
                {voiceOption === 'upload' && (
                  voiceFile ? (
                    <div className="flex items-center gap-2 bg-gray-800 px-3 py-2 rounded-lg border border-gray-700">
                      <Mic size={14} className="text-green-400" /><span className="text-xs text-white flex-1 truncate">{voiceFileName}</span>
                      <button onClick={() => { setVoiceFile(null); setVoiceFileName(''); }} className="text-gray-400 hover:text-red-400"><X size={14} /></button>
                    </div>
                  ) : (
                    <button onClick={() => voiceInputRef.current?.click()} className="w-full py-3 bg-gray-800 border border-dashed border-gray-700 rounded-lg text-xs text-gray-400 hover:border-green-500/50 transition">Importer un fichier audio</button>
                  )
                )}
              </div>

              {/* Logo */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Logo (affiché sur la page CTA)</h3>
                {selectedLogo ? (
                  <div className="flex items-center gap-3 bg-gray-800 px-4 py-3 rounded-lg border border-gray-700">
                    <img src={logoPreviewUrl || ''} alt="Logo" className="w-12 h-12 rounded-lg object-contain bg-gray-600 p-1 flex-shrink-0" />
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{logoName}</p></div>
                    <button onClick={() => { setSelectedLogo(null); setLogoName(''); if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl); setLogoPreviewUrl(null); }} className="p-1 text-gray-400 hover:text-red-400 transition"><X size={16} /></button>
                  </div>
                ) : (
                  <button onClick={() => logoInputRef.current?.click()} className="w-full flex flex-col items-center gap-2 bg-gray-800 hover:bg-gray-700 border-2 border-dashed border-gray-700 hover:border-purple-500/50 rounded-lg py-5 text-gray-400 hover:text-gray-300 transition cursor-pointer">
                    <Upload size={20} /><span className="text-sm">Ajouter un logo</span>
                  </button>
                )}
              </div>

              {/* Nav */}
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 flex items-center justify-center gap-2 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm font-medium transition"><ChevronLeft size={16} /> Retour</button>
                <button onClick={() => setStep(3)} className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 rounded-lg text-sm font-bold transition">Finaliser <ChevronRight size={16} /></button>
              </div>
            </div>
          )}

          {/* ===== STEP 3: FINALISER ===== */}
          {step === 3 && (
            <div>
              {/* Sequence order + durations */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Ordre des Séquences</h3>
                <p className="text-[10px] text-gray-500 mb-3">Utilisez les flèches pour réorganiser l&apos;ordre des séquences</p>
                <div className="space-y-2">
                  {sequences.map((seq, idx) => (
                    <div key={seq.id} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border transition ${seq.type === 'video' && !selectedVideo ? 'bg-gray-800/40 border-gray-700/50 opacity-50' : 'bg-gray-800 border-gray-700'}`}>
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => moveSequence(idx, 'up')} disabled={idx === 0} className="text-gray-500 hover:text-white disabled:opacity-20 transition"><ArrowUp size={12} /></button>
                        <button onClick={() => moveSequence(idx, 'down')} disabled={idx === sequences.length - 1} className="text-gray-500 hover:text-white disabled:opacity-20 transition"><ArrowDown size={12} /></button>
                      </div>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: `${seq.color}30`, color: seq.color }}>{seq.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white">{seq.label}</p>
                        <p className="text-[10px] text-gray-500">
                          {seq.type === 'intro' && (selectedPexelsUrl || posterPhotoPreview ? 'Photo sélectionnée' : 'Pas de photo')}
                          {seq.type === 'cards' && `${cards.length} carte${cards.length > 1 ? 's' : ''}`}
                          {seq.type === 'video' && (selectedVideo ? videoName : 'Aucune vidéo')}
                          {seq.type === 'cta' && (branding.ctaText || 'CTA par défaut')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <input type="number" value={seq.duration} onChange={(e) => updateSequenceDuration(seq.id, parseInt(e.target.value) || 1)} className="w-12 bg-gray-700 border border-gray-600 rounded text-center text-xs text-white py-1 focus:border-pink-500 focus:outline-none" min="1" disabled={seq.type === 'video' && !selectedVideo} />
                        <span className="text-[10px] text-gray-500">s</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-pink-600/10 to-purple-600/10 rounded-lg border border-pink-500/20">
                    <span className="text-xs font-semibold text-white">Durée totale</span>
                    <span className="text-sm font-bold text-pink-400">{totalDuration}s</span>
                  </div>
                </div>
              </div>

              {/* Format */}
              <div className="mb-6">
                <label className="block text-xs font-semibold text-gray-400 mb-2">Format</label>
                <div className="flex gap-2">
                  {(['9:16', '16:9'] as Format[]).map((fmt) => (
                    <button key={fmt} onClick={() => setFormat(fmt)} className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${format === fmt ? 'bg-gradient-to-r from-pink-600 to-pink-400 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>{fmt}</button>
                  ))}
                </div>
              </div>

              {/* Branding */}
              <div className="mb-6 p-4 bg-gray-800 rounded-xl border border-gray-700">
                <h3 className="text-sm font-semibold text-gray-300 mb-1">Branding</h3>
                <p className="text-[10px] text-gray-500 mb-3">Mémorisé automatiquement</p>
                <BrandingPanel branding={branding} onChange={setBranding} compact />
              </div>

              {/* Destination */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Destination</h3>
                <div className="space-y-2">
                  {(['calendar', 'export', 'both'] as Destination[]).map((dest) => (
                    <button key={dest} onClick={() => setDestination(dest)} className={`w-full text-left px-4 py-2.5 rounded-lg font-medium text-sm transition-all border ${destination === dest ? 'bg-pink-600/20 border-pink-500 text-white' : 'bg-gray-700 border-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                      {dest === 'calendar' && '📅 Calendrier (brouillon)'}{dest === 'export' && '📦 Export fichier'}{dest === 'both' && '🔄 Les deux'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Export button with integrated progress */}
              <button onClick={handleExport} disabled={isExporting} className="w-full relative overflow-hidden bg-gradient-to-r from-pink-600 to-pink-400 hover:from-pink-700 hover:to-pink-500 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 mb-3">
                {isExporting && (
                  <div className="absolute inset-0 bg-gradient-to-r from-pink-700 to-pink-500 transition-all duration-500" style={{ width: `${exportProgress}%` }} />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
                  {isExporting ? `EXPORT... ${exportProgress}%` : batchMode ? '⚡ EXPORTER 10 VIDÉOS' : '⚡ EXPORTER LA VIDÉO'}
                </span>
              </button>

              <div className="bg-gray-700 rounded-lg p-2.5 text-center text-xs text-gray-300 mb-4">
                <div>{batchMode ? '250 crédits (10 vidéos)' : '25 crédits'}</div>
              </div>

              {/* Back button */}
              <button onClick={() => setStep(2)} className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm font-medium transition"><ChevronLeft size={16} /> Retour aux médias</button>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN — Montage Preview (40%) */}
        <div className="w-2/5 bg-gray-800 border-l border-gray-700 px-6 py-6 overflow-y-auto flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300">Aperçu Vidéo Finale</h3>
            <button onClick={() => { if (!previewAutoPlay) { setPreviewSeqIndex(0); setPreviewProgress(0); } setPreviewAutoPlay(!previewAutoPlay); }} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition ${previewAutoPlay ? 'bg-pink-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600 border border-gray-600'}`}>
              {previewAutoPlay ? <><span className="text-[10px]">❚❚</span> Pause</> : <><Play size={10} /> Lire le montage</>}
            </button>
          </div>

          {/* Montage preview — all sequences stacked with transitions */}
          <div className="flex items-center justify-center bg-gray-900 rounded-xl border border-gray-700 p-3 flex-1">
            <div className={`${format === '9:16' ? 'h-[60vh] max-h-[60vh]' : 'h-48'} aspect-[9/16] rounded-xl shadow-xl relative overflow-hidden`}
              style={{
                border: branding.borderEnabled ? `3px solid ${branding.borderColor}` : 'none',
                boxShadow: branding.borderEnabled ? `0 0 25px ${branding.borderColor}40` : '0 0 25px rgba(217,28,210,0.3)',
              }}>

              {/* All sequences rendered simultaneously with CSS transitions */}
              {activeSequences.map((seq, idx) => {
                const isCurrent = idx === previewSeqIndex;
                return (
                  <div key={seq.id} className="absolute inset-0 transition-all duration-[800ms] ease-in-out"
                    style={{
                      opacity: isCurrent ? 1 : 0,
                      transform: isCurrent ? 'scale(1) translateY(0)' : (seq.type === 'cards' ? 'translateY(20px)' : seq.type === 'cta' ? 'scale(0.95)' : 'scale(1.05)'),
                      zIndex: isCurrent ? 10 : 1,
                    }}>
                    {renderSequencePreview(seq.type)}
                  </div>
                );
              })}

              {/* Current sequence label */}
              <div className="absolute top-2 left-2 z-20 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: activeSequences[previewSeqIndex]?.color, animation: previewAutoPlay ? 'pulse 1.5s infinite' : 'none' }} />
                <span className="text-[8px] font-bold text-white/70 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded">
                  {activeSequences[previewSeqIndex]?.type === 'intro' ? 'Affiche' : activeSequences[previewSeqIndex]?.type === 'cards' ? 'Cartes' : activeSequences[previewSeqIndex]?.type === 'video' ? 'Vidéo' : 'CTA'}
                </span>
              </div>

              {/* Animated timeline bar — bottom */}
              <div className="absolute bottom-0 left-0 right-0 z-20">
                <div className="flex h-1 bg-black/30">
                  {activeSequences.map((seq, idx) => {
                    const seqTotal = activeSequences.reduce((s, x) => s + x.duration, 0);
                    const w = (seq.duration / seqTotal) * 100;
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
              <div className="absolute bottom-2 right-2 z-20 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded text-[8px] font-bold text-white/60">{totalDuration}s</div>
            </div>
          </div>

          {/* Sequence navigation (manual) */}
          <div className="mt-3">
            <div className="flex gap-1">
              {activeSequences.map((seq, idx) => (
                <button key={seq.id} onClick={() => { setPreviewSeqIndex(idx); setPreviewProgress(0); setPreviewAutoPlay(false); }} className={`flex-1 py-1 rounded-lg text-[9px] font-medium transition ${previewSeqIndex === idx ? 'text-white' : 'bg-gray-700 text-gray-500 hover:bg-gray-600'}`} style={previewSeqIndex === idx ? { background: seq.color } : undefined}>
                  {seq.icon} {seq.type === 'intro' ? 'Affiche' : seq.type === 'cards' ? 'Cartes' : seq.type === 'video' ? 'Vidéo' : 'CTA'} {seq.duration}s
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
