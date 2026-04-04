'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Trash2,
  Upload,
  Zap,
  Loader2,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Image as ImageIcon,
  Edit3,
  Check,
  Search,
  Video,
  AlertTriangle,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────
interface InfoCard {
  id: string;
  emoji: string;
  label: string;
  value: string;
  description: string;
  color: string;
}

interface PexelsPhoto {
  id: number;
  url: string;
  medium: string;
  small: string;
  photographer: string;
  alt: string;
}

type Format = '9:16' | '16:9';
type Destination = 'draft' | 'export' | 'both';

// ── Content Themes ─────────────────────────────────────────────
const CONTENT_THEMES = [
  { id: 'sommeil-sport', label: 'Sommeil & Sport', emoji: '😴', pexelsQuery: 'sleep fitness recovery rest', color: 'from-indigo-600 to-blue-500' },
  { id: 'nutrition-danse', label: 'Nutrition & Danse', emoji: '🍎', pexelsQuery: 'healthy food dance nutrition', color: 'from-green-600 to-emerald-400' },
  { id: 'energie-cardio', label: 'Énergie & Cardio', emoji: '⚡', pexelsQuery: 'cardio energy workout running', color: 'from-orange-500 to-yellow-400' },
  { id: 'stress-mental', label: 'Stress & Mental', emoji: '🧠', pexelsQuery: 'meditation mental health yoga calm', color: 'from-purple-600 to-pink-400' },
  { id: 'communaute', label: 'Communauté', emoji: '👥', pexelsQuery: 'group fitness community dance class', color: 'from-pink-600 to-rose-400' },
  { id: 'personnalise', label: 'Personnalisé', emoji: '✨', pexelsQuery: '', color: 'from-gray-600 to-gray-400' },
];

// ── Color Themes ───────────────────────────────────────────────
const COLOR_THEMES = [
  { id: 'pink', name: 'Rose', bg: 'from-pink-600 to-pink-400', accent: '#ec4899' },
  { id: 'purple', name: 'Violet', bg: 'from-purple-600 to-purple-400', accent: '#a855f7' },
  { id: 'blue', name: 'Bleu', bg: 'from-blue-600 to-blue-400', accent: '#3b82f6' },
  { id: 'green', name: 'Vert', bg: 'from-green-600 to-green-400', accent: '#10b981' },
  { id: 'orange', name: 'Orange', bg: 'from-orange-500 to-yellow-400', accent: '#f59e0b' },
  { id: 'red', name: 'Rouge', bg: 'from-red-600 to-rose-400', accent: '#ef4444' },
];

const EMOJIS = ['💪', '❤️', '⚡', '🔥', '🎯', '📊', '🏃', '🧠', '💨', '🌟', '😴', '🍎', '💧', '🛡️', '🏆', '👥', '🌿', '📈', '✨', '🦴'];

export default function InfographicPage() {
  const router = useRouter();

  // ── Step wizard ─────────────────────────────────────────────
  const [step, setStep] = useState(0); // 0: Theme & Content, 1: Personnalisation, 2: Export

  // ── Step 0: Theme & Content ─────────────────────────────────
  const [contentTheme, setContentTheme] = useState('sommeil-sport');
  const [customTopic, setCustomTopic] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [cards, setCards] = useState<InfoCard[]>([]);
  const [salesPhrases, setSalesPhrases] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');

  // ── Step 1: Personnalisation ────────────────────────────────
  const [colorTheme, setColorTheme] = useState('purple');
  const [format, setFormat] = useState<Format>('9:16');
  const [batchCount, setBatchCount] = useState(1);
  const [characterImage, setCharacterImage] = useState<string | null>(null);

  // ── Video Upload ────────────────────────────────────────────
  const [rushUrl, setRushUrl] = useState<string | null>(null);
  const [rushFileName, setRushFileName] = useState<string | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);

  // ── Pexels Photos ───────────────────────────────────────────
  const [pexelsPhotos, setPexelsPhotos] = useState<PexelsPhoto[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [photoSearchQuery, setPhotoSearchQuery] = useState('');

  // ── Sequence Durations ──────────────────────────────────────
  const [introDuration, setIntroDuration] = useState(4);
  const [cardsDuration, setCardsDuration] = useState(6);
  const [videoDuration, setVideoDuration] = useState(12);
  const [ctaDuration, setCtaDuration] = useState(4);

  // ── Persist configurations across sessions ──────────────────
  const INFOGRAPHIC_CONFIG_KEY = 'studiio_infographic_config';
  const [configLoaded, setConfigLoaded] = useState(false);

  // Load saved config on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(INFOGRAPHIC_CONFIG_KEY);
      if (saved) {
        const cfg = JSON.parse(saved);
        if (cfg.colorTheme) setColorTheme(cfg.colorTheme);
        if (cfg.format) setFormat(cfg.format);
        if (cfg.introDuration) setIntroDuration(cfg.introDuration);
        if (cfg.cardsDuration) setCardsDuration(cfg.cardsDuration);
        if (cfg.videoDuration) setVideoDuration(cfg.videoDuration);
        if (cfg.ctaDuration) setCtaDuration(cfg.ctaDuration);
        if (cfg.rushUrl) { setRushUrl(cfg.rushUrl); setRushFileName(cfg.rushFileName || 'video.mp4'); }
        if (cfg.characterImage) setCharacterImage(cfg.characterImage);
      }
    } catch { /* ignore */ }
    // Marquer comme chargé APRÈS la restauration pour éviter que le save n'écrase les valeurs
    setConfigLoaded(true);
  }, []);

  // Save config on change — seulement APRÈS le chargement initial
  useEffect(() => {
    if (!configLoaded) return; // Ne pas sauvegarder avant que le load soit terminé
    try {
      localStorage.setItem(INFOGRAPHIC_CONFIG_KEY, JSON.stringify({
        colorTheme, format, introDuration, cardsDuration, videoDuration, ctaDuration,
        rushUrl, rushFileName, characterImage,
      }));
    } catch { /* ignore */ }
  }, [configLoaded, colorTheme, format, introDuration, cardsDuration, videoDuration, ctaDuration, rushUrl, rushFileName, characterImage]);

  // ── Step 2: Export ──────────────────────────────────────────
  const [destination, setDestination] = useState<Destination>('draft');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // ── Toast ───────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = (message: string, type: 'success' | 'error' = 'error') => setToast({ message, type });

  // ── Fetch Pexels photos based on theme ──────────────────────
  const [pexelsPage, setPexelsPage] = useState(1);

  const pexelsPageRef = useRef(1);
  const fetchPexelsPhotos = useCallback(async (query: string, newPage?: boolean) => {
    if (!query.trim()) return;
    setPexelsLoading(true);
    // Incrémente la page pour proposer de nouvelles photos à chaque clic
    const page = newPage ? pexelsPageRef.current + 1 : 1;
    pexelsPageRef.current = page;
    setPexelsPage(page);
    try {
      const count = Math.max(batchCount * 2, 6);
      const res = await fetch(`/api/pexels?query=${encodeURIComponent(query)}&count=${count}&page=${page}`);
      const data = await res.json();
      if (data.success && data.photos && data.photos.length > 0) {
        setPexelsPhotos(data.photos);
        setSelectedPhotoIndex(0);
      } else if (page > 1) {
        // Plus de résultats, retour à la page 1
        pexelsPageRef.current = 1;
        setPexelsPage(1);
        const res2 = await fetch(`/api/pexels?query=${encodeURIComponent(query)}&count=${count}&page=1`);
        const data2 = await res2.json();
        if (data2.success && data2.photos) {
          setPexelsPhotos(data2.photos);
          setSelectedPhotoIndex(0);
        }
      }
    } catch {
      console.error('Pexels fetch error');
    } finally {
      setPexelsLoading(false);
    }
  }, [batchCount]);

  // ── Generate content (AI or local) ──────────────────────────
  const generateContent = useCallback(async (themeId?: string) => {
    const theme = themeId || contentTheme;
    setIsGenerating(true);
    setGenerationError('');

    try {
      // Determine topic text
      const themeObj = CONTENT_THEMES.find(t => t.id === theme);
      const topicText = theme === 'personnalise' ? customTopic : (themeObj?.label || theme);

      if (theme === 'personnalise' && !customTopic.trim()) {
        setIsGenerating(false);
        return;
      }

      // Try AI generation first (with 8s timeout to avoid blocking UI)
      let aiSuccess = false;
      try {
        const aiController = new AbortController();
        const aiTimeout = setTimeout(() => aiController.abort(), 8000);
        const aiRes = await fetch('/api/content/ai-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: topicText,
            locale: 'fr',
            cardCount: 5,
          }),
          signal: aiController.signal,
        });
        clearTimeout(aiTimeout);

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          if (aiData.success && aiData.content) {
            const c = aiData.content;
            setTitle(c.title || topicText.toUpperCase());
            setSubtitle(c.subtitle || '');
            setCards(
              (c.cards || []).map((card: any, i: number) => ({
                id: `card-${Date.now()}-${i}`,
                emoji: card.emoji || '⭐',
                label: card.label || '',
                value: card.value || '',
                description: card.description || '',
                color: COLOR_THEMES.find(ct => ct.id === colorTheme)?.accent || '#a855f7',
              }))
            );
            setSalesPhrases(c.salesPhrases || []);

            // Fetch photos matching the AI-suggested query or theme
            const pQuery = c.pexelsQuery || themeObj?.pexelsQuery || topicText;
            setPhotoSearchQuery(pQuery);
            fetchPexelsPhotos(pQuery);
            aiSuccess = true;
          }
        }
      } catch (aiErr: any) {
        console.warn('[Infographie] AI generation failed/timeout, falling back to local:', aiErr?.name || aiErr?.message);
      }
      if (aiSuccess) return;

      // Fallback: try local smart content (instant, no external API)
      const localRes = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topicText }),
      });
      if (localRes.ok) {
        const localData = await localRes.json();
        if (localData.success && localData.content) {
          const c = localData.content;
          setTitle(c.tagLine || topicText.toUpperCase());
          setSubtitle(c.subtitle || '');
          setCards(
            (c.cards || []).map((card: any, i: number) => ({
              id: `card-${Date.now()}-${i}`,
              emoji: card.icon || '⭐',
              label: card.title || '',
              value: card.value || '',
              description: card.description || '',
              color: COLOR_THEMES.find(ct => ct.id === colorTheme)?.accent || '#a855f7',
            }))
          );
          setSalesPhrases([]);
          const pQuery = themeObj?.pexelsQuery || topicText;
          setPhotoSearchQuery(pQuery);
          fetchPexelsPhotos(pQuery);
          return;
        }
      }

      setGenerationError('Impossible de générer le contenu. Réessayez.');
    } catch (err) {
      console.error('Content generation error:', err);
      setGenerationError('Erreur de génération. Réessayez.');
    } finally {
      setIsGenerating(false);
    }
  }, [contentTheme, customTopic, colorTheme, fetchPexelsPhotos]);

  // ── Auto-generate on theme change ───────────────────────────
  useEffect(() => {
    if (contentTheme !== 'personnalise') {
      // Set photo search query to theme's pexels query
      const themeObj = CONTENT_THEMES.find(t => t.id === contentTheme);
      setPhotoSearchQuery(themeObj?.pexelsQuery || themeObj?.label || '');
      setPexelsPage(1); // Reset page counter for new theme
      generateContent(contentTheme);
    } else {
      // Clear content when switching to custom
      setTitle('');
      setSubtitle('');
      setCards([]);
      setSalesPhrases([]);
      setPexelsPhotos([]);
      setPhotoSearchQuery('');
      setPexelsPage(1);
    }
  }, [contentTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Régénérer: regenerate content + new photos ──────────────
  const handleRegenerate = () => {
    if (contentTheme === 'personnalise' && !customTopic.trim()) {
      showToast('Entrez un sujet personnalisé');
      return;
    }
    // Also fetch new photos (next page) in parallel
    const themeObj = CONTENT_THEMES.find(t => t.id === contentTheme);
    const query = photoSearchQuery.trim()
      || (contentTheme === 'personnalise' ? customTopic : '')
      || themeObj?.pexelsQuery || themeObj?.label || 'fitness';
    fetchPexelsPhotos(query, true);
    generateContent();
  };

  // ── Card manipulation ───────────────────────────────────────
  const [isAddingCard, setIsAddingCard] = useState(false);

  const addCard = async () => {
    const accent = COLOR_THEMES.find(ct => ct.id === colorTheme)?.accent || '#a855f7';
    const themeObj = CONTENT_THEMES.find(t => t.id === contentTheme);
    const topicText = contentTheme === 'personnalise' ? customTopic : (themeObj?.label || 'fitness');

    // Try to generate a smart card via Anthropic
    setIsAddingCard(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/api/content/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicText,
          locale: 'fr',
          cardCount: 1,
          existingCards: cards.map(c => c.label), // Avoid duplicate topics
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.content?.cards?.[0]) {
          const aiCard = data.content.cards[0];
          setCards([...cards, {
            id: `card-${Date.now()}`,
            emoji: aiCard.emoji || '⭐',
            label: aiCard.label || 'Info',
            value: aiCard.value || '',
            description: aiCard.description || '',
            color: accent,
          }]);
          setIsAddingCard(false);
          return;
        }
      }
    } catch {
      // AI failed, fallback to generic
    }

    // Fallback: generic card
    setCards([...cards, {
      id: `card-${Date.now()}`,
      emoji: '⭐',
      label: 'Nouveau',
      value: 'Valeur',
      description: '',
      color: accent,
    }]);
    setIsAddingCard(false);
  };

  const deleteCard = (id: string) => setCards(cards.filter(c => c.id !== id));

  const updateCard = (id: string, field: keyof InfoCard, value: string) => {
    setCards(cards.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  // ── Character upload ────────────────────────────────────────
  const handleCharacterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setCharacterImage(event.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  // ── Video upload ───────────────────────────────────────────
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/')) {
      showToast('Veuillez sélectionner un fichier vidéo');
      return;
    }

    // Validate file size (max 100MB)
    if (file.size > 100 * 1024 * 1024) {
      showToast('La vidéo ne doit pas dépasser 100 Mo');
      return;
    }

    setIsUploadingVideo(true);
    setRushFileName(file.name);

    try {
      // Use signed URL for large files (videos > 4MB) to bypass Vercel's 4.5MB body limit
      if (file.size > 4 * 1024 * 1024) {
        const signRes = await fetch('/api/upload/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type, purpose: 'infographic-video' }),
        });
        const signData = await signRes.json();
        if (!signData.success) { showToast('Erreur lors de l\'upload de la vidéo'); setRushFileName(null); setIsUploadingVideo(false); return; }
        const putRes = await fetch(signData.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!putRes.ok) { showToast('Erreur lors de l\'upload de la vidéo'); setRushFileName(null); setIsUploadingVideo(false); return; }
        console.log('[Upload] Signed URL upload OK:', signData.publicUrl);
        setRushUrl(signData.publicUrl);
        showToast('Vidéo uploadée avec succès', 'success');
      } else {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('purpose', 'infographic-video');
        const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success && data.file?.url) {
          setRushUrl(data.file.url);
          showToast('Vidéo uploadée avec succès', 'success');
        } else {
          showToast('Erreur lors de l\'upload de la vidéo');
          setRushFileName(null);
        }
      }
    } catch (err) {
      console.error('Video upload error:', err);
      showToast('Erreur lors de l\'upload de la vidéo');
      setRushFileName(null);
    } finally {
      setIsUploadingVideo(false);
    }
  };

  const removeVideo = () => {
    setRushUrl(null);
    setRushFileName(null);
  };

  // ── Export ──────────────────────────────────────────────────
  const handleExport = async () => {
    if (cards.length === 0) {
      showToast('Ajoutez au moins une carte avant d\'exporter');
      return;
    }

    // Safety check: if a video was expected but source is undefined, block export
    if (rushFileName && !rushUrl) {
      showToast('La vidéo n\'a pas été uploadée correctement. Veuillez re-sélectionner le média.');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      const total = batchCount;
      for (let b = 0; b < total; b++) {
        setExportProgress(Math.round(((b) / total) * 100));

        // Pick a different photo for each batch item
        const photo = pexelsPhotos.length > 0
          ? pexelsPhotos[b % pexelsPhotos.length]
          : null;
        const posterUrl = photo?.url || null;

        // Pick a different sales phrase per batch item
        const salesPhrase = salesPhrases.length > 0
          ? salesPhrases[b % salesPhrases.length]
          : '';

        // Upload character image if present (first iteration only)
        let mediaUrl: string | null = posterUrl;
        if (b === 0 && characterImage && characterImage.startsWith('data:')) {
          const blob = await fetch(characterImage).then((r) => r.blob());
          const file = new File([blob], 'infographic-character.png', { type: 'image/png' });
          if (file.size > 4 * 1024 * 1024) {
            const signRes = await fetch('/api/upload/signed-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: file.name, contentType: file.type, purpose: 'infographic' }),
            });
            const signData = await signRes.json();
            if (signData.success) {
              const putRes = await fetch(signData.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
              if (putRes.ok) mediaUrl = signData.publicUrl;
            }
          } else {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('purpose', 'infographic');
            const uploadRes = await fetch('/api/upload/media', { method: 'POST', body: formData });
            const uploadData = await uploadRes.json();
            if (uploadData.success) mediaUrl = uploadData.file.url;
          }
        }

        // Determine media type based on whether video is present
        const hasVideo = !!rushUrl;
        const mediaType = hasVideo ? 'video' : 'image';

        if (destination === 'draft' || destination === 'both') {
          const today = new Date();
          today.setDate(today.getDate() + b); // Spread across days
          const scheduledDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const caption = [
            subtitle,
            cards.map((c) => `${c.emoji} ${c.label}: ${c.value}`).join(' | '),
            salesPhrase ? `\n${salesPhrase}` : '',
            '\n💬 Plus d\'infos → https://afroboost.com',
          ].filter(Boolean).join('\n');

          await fetch('/api/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: title || 'Infographie',
              caption,
              media_url: hasVideo ? rushUrl : mediaUrl,
              media_type: mediaType,
              format: format === '16:9' ? 'tv' : 'reel',
              platforms: [],
              scheduled_date: scheduledDate,
              scheduled_time: '12:00',
              status: 'draft',
              metadata: {
                type: 'infographic',
                subtitle,
                theme: contentTheme,
                colorTheme,
                salesPhrase,
                cards: cards.map((c) => ({ emoji: c.emoji, label: c.label, value: c.value, description: c.description, color: c.color })),
                characterUrl: characterImage ? mediaUrl : null,
                posterUrl,
                pexelsUrl: posterUrl,
                // Video URL preservation: ensure Calendar page can access the video source
                videoUrl: rushUrl || undefined,
                rushUrls: rushUrl ? [rushUrl] : undefined,
                // Sequences object: required by Calendar montage preview & export renderer
                // Without this, Calendar falls back to defaults and video timing breaks
                sequences: {
                  intro: introDuration,
                  cards: cards.length > 0 ? cardsDuration : 0,
                  video: rushUrl ? videoDuration : 0,
                  cta: ctaDuration,
                  total: introDuration + (cards.length > 0 ? cardsDuration : 0) + (rushUrl ? videoDuration : 0) + ctaDuration,
                  order: [
                    'intro',
                    ...(cards.length > 0 ? ['cards'] : []),
                    ...(rushUrl ? ['video'] : []),
                    'cta',
                  ],
                },
                // Branding defaults for the infographic montage renderer
                branding: {
                  accentColor: COLOR_THEMES.find(ct => ct.id === colorTheme)?.accent || '#a855f7',
                  ctaText: 'CHAT POUR PLUS D\'INFOS',
                  ctaSubText: 'LIEN EN BIO',
                  watermarkText: 'AFROBOOST',
                  borderColor: null,
                },
              },
            }),
          });
        }
      }

      setExportProgress(100);
      showToast(`${total} infographie${total > 1 ? 's' : ''} ajoutée${total > 1 ? 's' : ''} au calendrier !`, 'success');

      if (destination === 'draft' || destination === 'both') {
        setTimeout(() => router.push('/dashboard/calendar'), 1500);
      }
    } catch (error) {
      console.error('Export error:', error);
      showToast('Erreur lors de l\'export');
    } finally {
      setIsExporting(false);
    }
  };

  // ── Preview helpers ─────────────────────────────────────────
  const activeColorTheme = COLOR_THEMES.find(ct => ct.id === colorTheme) || COLOR_THEMES[1];
  const previewPhoto = pexelsPhotos[selectedPhotoIndex] || null;

  const getPreviewClasses = () => {
    if (format === '16:9') return { aspect: 'aspect-[16/9]', maxW: 'max-w-lg', cols: 'grid-cols-3' };
    return { aspect: 'aspect-[9/16]', maxW: 'max-w-xs', cols: 'grid-cols-2' };
  };
  const previewClasses = getPreviewClasses();

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col lg:flex-row bg-gray-900 text-white overflow-x-hidden">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Left Panel - Form */}
      <div className="w-full lg:w-1/2 overflow-y-auto border-r-0 lg:border-r border-gray-800 p-3 sm:p-6 pb-24 lg:pb-6 lg:max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <h1 className="text-lg sm:text-2xl font-bold">Créer une Infographie</h1>
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-400 overflow-x-auto">
            {['Contenu', 'Style', 'Export'].map((label, i) => (
              <button
                key={label}
                onClick={() => setStep(i)}
                className={`flex items-center gap-1 rounded-full px-1.5 sm:px-3 py-1 text-[9px] sm:text-xs font-medium transition-all whitespace-nowrap ${
                  step === i ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/30 text-[10px]">
                  {i + 1}
                </span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* STEP 0: Content Theme & Generation */}
        {/* ═══════════════════════════════════════════════════════ */}
        {step === 0 && (
          <div className="space-y-6">
            {/* Content Theme Selector */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-300">Thème du contenu</label>
              <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
                {CONTENT_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => setContentTheme(theme.id)}
                    className={`flex flex-col sm:flex-row items-center gap-1 sm:gap-2 rounded-lg px-2 sm:px-3 py-2 sm:py-2.5 text-[11px] sm:text-sm font-medium transition-all ${
                      contentTheme === theme.id
                        ? 'ring-2 ring-purple-500 bg-gray-800'
                        : 'bg-gray-800/50 hover:bg-gray-800'
                    }`}
                  >
                    <span className="text-base sm:text-lg">{theme.emoji}</span>
                    <span className="text-center leading-tight">{theme.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Topic Input (only for Personnalisé) */}
            {contentTheme === 'personnalise' && (
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  Votre sujet personnalisé
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && customTopic.trim()) generateContent(); }}
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    placeholder="Ex: moringa, collagène, stretching..."
                  />
                  <button
                    onClick={() => generateContent()}
                    disabled={!customTopic.trim() || isGenerating}
                    className="rounded-lg bg-purple-600 px-4 py-2.5 font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  L'IA va générer des cartes d'information riches sur ce sujet
                </p>
              </div>
            )}

            {/* Loading / Error State */}
            {isGenerating && (
              <div className="flex items-center justify-center gap-3 rounded-lg border border-gray-700 bg-gray-800/50 py-8">
                <Loader2 size={24} className="animate-spin text-purple-400" />
                <span className="text-gray-300">Génération du contenu par l'IA...</span>
              </div>
            )}
            {generationError && (
              <div className="rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-300">
                {generationError}
              </div>
            )}

            {/* Photo Search — always visible in Step 0 for custom photo selection */}
            {pexelsPhotos.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-300">
                    Photos d'affiche ({pexelsPhotos.length})
                  </label>
                  <button
                    onClick={() => {
                      const query = photoSearchQuery.trim()
                        || (contentTheme === 'personnalise' ? customTopic : '')
                        || CONTENT_THEMES.find(t => t.id === contentTheme)?.pexelsQuery
                        || 'fitness';
                      fetchPexelsPhotos(query, true);
                    }}
                    disabled={pexelsLoading}
                    className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-gray-700"
                  >
                    <RefreshCw size={14} className={pexelsLoading ? 'animate-spin' : ''} />
                    Nouvelles photos
                  </button>
                </div>
                <div className="mb-2 flex gap-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      value={photoSearchQuery}
                      onChange={(e) => setPhotoSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && photoSearchQuery.trim()) {
                          pexelsPageRef.current = 0;
                          fetchPexelsPhotos(photoSearchQuery.trim(), true);
                        }
                      }}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                      placeholder="Rechercher des photos... (ex: manioc, yoga, danse)"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (photoSearchQuery.trim()) {
                        pexelsPageRef.current = 0;
                        fetchPexelsPhotos(photoSearchQuery.trim(), true);
                      }
                    }}
                    disabled={pexelsLoading || !photoSearchQuery.trim()}
                    className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {pexelsLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {pexelsPhotos.map((photo, i) => (
                    <button
                      key={photo.id}
                      onClick={() => setSelectedPhotoIndex(i)}
                      className={`relative overflow-hidden rounded-lg transition-all ${
                        selectedPhotoIndex === i ? 'ring-2 ring-purple-500' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img src={photo.small} alt={photo.alt} className="aspect-[3/4] w-full object-cover" />
                      {selectedPhotoIndex === i && (
                        <div className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500">
                          <Check size={10} />
                        </div>
                      )}
                      {batchCount > 1 && i < batchCount && (
                        <div className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 py-0.5 text-[8px] font-bold text-white">
                          #{i + 1}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Generated Content Preview */}
            {!isGenerating && cards.length > 0 && (
              <>
                {/* Title & Subtitle */}
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-400">Titre</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-400">Sous-titre</label>
                    <input
                      type="text"
                      value={subtitle}
                      onChange={(e) => setSubtitle(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Info Cards */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-300">
                      Cartes d'Information ({cards.length})
                    </h3>
                    <button
                      onClick={handleRegenerate}
                      disabled={isGenerating}
                      className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-gray-700"
                    >
                      <RefreshCw size={14} className={isGenerating ? 'animate-spin' : ''} />
                      Régénérer
                    </button>
                  </div>
                  <div className="space-y-3">
                    {cards.map((card) => (
                      <div key={card.id} className="rounded-lg border border-gray-700 bg-gray-800 p-3">
                        <div className="flex items-start gap-3">
                          {/* Emoji */}
                          <div className="relative">
                            <button
                              onClick={() => setShowEmojiPicker(showEmojiPicker === card.id ? null : card.id)}
                              className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700 text-xl hover:bg-gray-600"
                            >
                              {card.emoji}
                            </button>
                            {showEmojiPicker === card.id && (
                              <div className="absolute top-full left-0 z-10 mt-1 grid grid-cols-4 sm:grid-cols-5 gap-1 rounded-lg border border-gray-600 bg-gray-800 p-2 shadow-xl">
                                {EMOJIS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={() => { updateCard(card.id, 'emoji', emoji); setShowEmojiPicker(null); }}
                                    className="rounded p-1 text-lg hover:bg-gray-700"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Content */}
                          <div className="flex-1 space-y-1.5">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={card.label}
                                onChange={(e) => updateCard(card.id, 'label', e.target.value)}
                                className="flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-white focus:border-purple-500 focus:outline-none"
                                placeholder="Label"
                              />
                              <input
                                type="text"
                                value={card.value}
                                onChange={(e) => updateCard(card.id, 'value', e.target.value)}
                                className="w-20 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-purple-400 focus:border-purple-500 focus:outline-none"
                                placeholder="Valeur"
                              />
                            </div>
                            <input
                              type="text"
                              value={card.description}
                              onChange={(e) => updateCard(card.id, 'description', e.target.value)}
                              className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-300 focus:border-purple-500 focus:outline-none"
                              placeholder="Description courte"
                            />
                          </div>
                          {/* Delete */}
                          <button onClick={() => deleteCard(card.id)} className="rounded p-1 text-gray-500 hover:bg-red-600 hover:text-white">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addCard}
                    disabled={isAddingCard}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 bg-gray-800/50 py-2.5 text-xs font-medium text-gray-400 hover:border-purple-500 hover:text-purple-400 disabled:opacity-50"
                  >
                    {isAddingCard ? <Loader2 size={14} className="animate-spin" /> : <><Sparkles size={14} /> Ajouter une carte IA</>}
                  </button>
                </div>

                {/* Sales Phrases */}
                {salesPhrases.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-300">Phrases de vente</h3>
                    <div className="space-y-1.5">
                      {salesPhrases.map((phrase, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-xs text-gray-300">
                          <span className="text-purple-400">#{i + 1}</span>
                          <input
                            type="text"
                            value={phrase}
                            onChange={(e) => {
                              const updated = [...salesPhrases];
                              updated[i] = e.target.value;
                              setSalesPhrases(updated);
                            }}
                            className="flex-1 bg-transparent text-xs text-gray-300 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Next Step */}
                <button
                  onClick={() => setStep(1)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 py-3 font-bold text-white hover:bg-purple-700"
                >
                  Personnaliser le style
                  <ChevronRight size={18} />
                </button>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* STEP 1: Personnalisation */}
        {/* ═══════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div className="space-y-6">
            {/* Color Theme */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-300">Couleur du thème</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
                {COLOR_THEMES.map((ct) => (
                  <button
                    key={ct.id}
                    onClick={() => setColorTheme(ct.id)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all ${
                      colorTheme === ct.id ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-gray-600'
                    }`}
                  >
                    <div className={`h-5 w-5 rounded bg-gradient-to-br ${ct.bg}`} />
                    <span className="text-xs">{ct.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Format */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-300">Format</label>
              <div className="flex gap-2 sm:gap-3 w-full">
                {(['9:16', '16:9'] as Format[]).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    className={`flex-1 rounded-lg px-3 sm:px-4 py-2 text-sm sm:text-base font-medium transition-colors ${
                      format === fmt
                        ? 'bg-purple-600 text-white'
                        : 'border border-gray-700 bg-gray-800 text-gray-300 hover:border-purple-500'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Batch Count */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-300">
                Nombre d'infographies: <span className="text-purple-400 font-bold">x{batchCount}</span>
              </label>
              <div className="grid grid-cols-3 sm:flex flex-wrap gap-2 sm:gap-3">
                {[1, 2, 3, 5, 7, 10].map((count) => (
                  <button
                    key={count}
                    onClick={() => setBatchCount(count)}
                    className={`rounded-lg px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all ${
                      batchCount === count
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    x{count}
                  </button>
                ))}
              </div>
            </div>

            {/* Pexels Photos */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-300">
                  Photos d'affiche {pexelsPhotos.length > 0 && `(${pexelsPhotos.length})`}
                </label>
                <button
                  onClick={() => {
                    const query = photoSearchQuery.trim()
                      || (contentTheme === 'personnalise' ? customTopic : '')
                      || CONTENT_THEMES.find(t => t.id === contentTheme)?.pexelsQuery
                      || CONTENT_THEMES.find(t => t.id === contentTheme)?.label
                      || 'fitness';
                    fetchPexelsPhotos(query, true);
                  }}
                  disabled={pexelsLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-gray-700"
                >
                  <RefreshCw size={14} className={pexelsLoading ? 'animate-spin' : ''} />
                  Régénérer
                </button>
              </div>
              {/* Photo search input */}
              <div className="mb-3 flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={photoSearchQuery}
                    onChange={(e) => setPhotoSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && photoSearchQuery.trim()) {
                        fetchPexelsPhotos(photoSearchQuery.trim(), true);
                      }
                    }}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    placeholder="Rechercher des photos... (ex: manioc, yoga, danse)"
                  />
                </div>
                <button
                  onClick={() => {
                    if (photoSearchQuery.trim()) {
                      fetchPexelsPhotos(photoSearchQuery.trim(), true);
                    }
                  }}
                  disabled={pexelsLoading || !photoSearchQuery.trim()}
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {pexelsLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                </button>
              </div>
              {pexelsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-purple-400" />
                </div>
              ) : pexelsPhotos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {pexelsPhotos.map((photo, i) => (
                    <button
                      key={photo.id}
                      onClick={() => setSelectedPhotoIndex(i)}
                      className={`relative overflow-hidden rounded-lg transition-all ${
                        selectedPhotoIndex === i ? 'ring-2 ring-purple-500' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img src={photo.small} alt={photo.alt} className="aspect-[3/4] w-full object-cover" />
                      {selectedPhotoIndex === i && (
                        <div className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-purple-500">
                          <Check size={12} />
                        </div>
                      )}
                      {batchCount > 1 && i < batchCount && (
                        <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          #{i + 1}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-700 py-8 text-sm text-gray-500">
                  <ImageIcon size={18} className="mr-2" />
                  Aucune photo chargée
                </div>
              )}
              {batchCount > 1 && pexelsPhotos.length > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  Chaque infographie du batch utilisera une photo différente
                </p>
              )}
            </div>

            {/* Character Image Upload */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Image personnage (optionnel)
              </label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-700 bg-gray-800 px-4 py-4 hover:border-purple-500 hover:bg-gray-700">
                <Upload size={18} />
                <span className="text-sm text-gray-300">
                  {characterImage ? 'Changer l\'image' : 'Télécharger'}
                </span>
                <input type="file" accept="image/*" onChange={handleCharacterUpload} className="hidden" />
              </label>
            </div>

            {/* Video Upload (Médias) */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Vidéo de fond (optionnel)
              </label>
              {rushUrl ? (
                <div className="flex items-center gap-3 rounded-lg border border-green-700 bg-green-900/20 px-4 py-3">
                  <Video size={20} className="text-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-300 truncate">{rushFileName}</p>
                    <p className="text-xs text-green-500">Vidéo prête pour l'export</p>
                  </div>
                  <button
                    onClick={removeVideo}
                    className="rounded p-1 text-gray-400 hover:bg-red-600 hover:text-white"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed ${
                  isUploadingVideo ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700 bg-gray-800 hover:border-purple-500 hover:bg-gray-700'
                } px-4 py-4`}>
                  {isUploadingVideo ? (
                    <>
                      <Loader2 size={18} className="animate-spin text-purple-400" />
                      <span className="text-sm text-purple-300">Upload en cours...</span>
                    </>
                  ) : (
                    <>
                      <Video size={18} />
                      <span className="text-sm text-gray-300">Ajouter une vidéo</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleVideoUpload}
                    disabled={isUploadingVideo}
                    className="hidden"
                  />
                </label>
              )}
              <p className="mt-1 text-xs text-gray-500">
                La vidéo sera utilisée comme fond dans le montage final (max 100 Mo)
              </p>
            </div>

            {/* Sequence Durations */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-300">Durée des séquences</label>
              <div className="space-y-3">
                {[
                  { label: '🖼️ Affiche (Intro)', value: introDuration, setter: setIntroDuration, min: 2, max: 15 },
                  { label: '📊 Cartes d\'Information', value: cardsDuration, setter: setCardsDuration, min: 3, max: 20, disabled: cards.length === 0 },
                  { label: '🎬 Vidéo', value: videoDuration, setter: setVideoDuration, min: 3, max: 60, disabled: !rushUrl },
                  { label: '📢 CTA', value: ctaDuration, setter: setCtaDuration, min: 2, max: 15 },
                ].map((item) => (
                  <div key={item.label} className={`flex items-center gap-3 rounded-lg bg-gray-800 px-4 py-2.5 ${item.disabled ? 'opacity-40' : ''}`}>
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
                Durée totale: <span className="font-bold text-purple-400">
                  {introDuration + (cards.length > 0 ? cardsDuration : 0) + (rushUrl ? videoDuration : 0) + ctaDuration}s
                </span>
              </p>
            </div>

            {/* Navigation */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep(0)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 py-3 font-medium text-gray-300 hover:bg-gray-700"
              >
                <ChevronLeft size={18} />
                Contenu
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-purple-600 py-3 font-bold text-white hover:bg-purple-700"
              >
                Export
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* STEP 2: Export */}
        {/* ═══════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-300">Résumé</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Thème:</span>
                  <span className="ml-2 text-white">{CONTENT_THEMES.find(t => t.id === contentTheme)?.label}</span>
                </div>
                <div>
                  <span className="text-gray-500">Cartes:</span>
                  <span className="ml-2 text-white">{cards.length}</span>
                </div>
                <div>
                  <span className="text-gray-500">Format:</span>
                  <span className="ml-2 text-white">{format}</span>
                </div>
                <div>
                  <span className="text-gray-500">Batch:</span>
                  <span className="ml-2 text-white">x{batchCount}</span>
                </div>
                <div>
                  <span className="text-gray-500">Photos:</span>
                  <span className="ml-2 text-white">{pexelsPhotos.length}</span>
                </div>
                <div>
                  <span className="text-gray-500">Phrases:</span>
                  <span className="ml-2 text-white">{salesPhrases.length}</span>
                </div>
                <div>
                  <span className="text-gray-500">Vidéo:</span>
                  <span className={`ml-2 ${rushUrl ? 'text-green-400' : 'text-gray-500'}`}>
                    {rushUrl ? '✓ Prête' : 'Aucune'}
                  </span>
                </div>
              </div>
            </div>

            {/* Safety Warning: video source undefined */}
            {rushFileName && !rushUrl && (
              <div className="flex items-start gap-3 rounded-lg border border-yellow-700 bg-yellow-900/20 p-3">
                <AlertTriangle size={18} className="flex-shrink-0 text-yellow-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-300">Source vidéo indéfinie</p>
                  <p className="text-xs text-yellow-500 mt-0.5">
                    La vidéo n'a pas été uploadée correctement. Retournez à l'étape Style pour re-sélectionner le fichier vidéo avant d'exporter.
                  </p>
                </div>
              </div>
            )}

            {/* Destination */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-300">Destination</label>
              <div className="space-y-2">
                {[
                  { value: 'draft' as Destination, label: 'Calendrier (brouillon)' },
                  { value: 'export' as Destination, label: 'Export fichier' },
                  { value: 'both' as Destination, label: 'Les deux' },
                ].map((option) => (
                  <label key={option.value} className="flex items-center gap-3 rounded-lg bg-gray-800 px-4 py-3 cursor-pointer hover:bg-gray-700">
                    <input
                      type="radio"
                      name="destination"
                      value={option.value}
                      checked={destination === option.value}
                      onChange={(e) => setDestination(e.target.value as Destination)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    <span className="text-sm text-gray-300">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Export Progress */}
            {isExporting && (
              <div className="rounded-lg border border-purple-800 bg-purple-900/20 p-4">
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-purple-300">Export en cours...</span>
                  <span className="text-purple-400 font-bold">{exportProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Export Button */}
            <button
              onClick={handleExport}
              disabled={isExporting || cards.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-3 font-bold text-white hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Zap size={20} />
              )}
              {isExporting
                ? 'EXPORT EN COURS...'
                : batchCount > 1
                  ? `EXPORTER ${batchCount} INFOGRAPHIES`
                  : 'EXPORTER L\'INFOGRAPHIE'
              }
            </button>
            <div className="text-center text-sm text-gray-400">
              Coût: <span className="font-bold text-yellow-400">{25 * batchCount} crédits</span>
            </div>

            {/* Back */}
            <button
              onClick={() => setStep(1)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-700"
            >
              <ChevronLeft size={16} />
              Retour
            </button>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Right Panel - Preview */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex w-full lg:w-1/2 flex-col items-center justify-center border-l-0 lg:border-l border-gray-800 bg-gray-950 p-3 sm:p-6 mt-6 lg:mt-0 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
        <h2 className="mb-3 sm:mb-4 text-sm sm:text-lg font-bold text-gray-400">Aperçu Vidéo Finale</h2>

        {/* Preview Container */}
        <div className={`relative w-full ${previewClasses.maxW} mx-auto`}>
          <div
            className={`${previewClasses.aspect} relative flex flex-col items-center justify-between rounded-lg bg-gradient-to-br ${activeColorTheme.bg} p-4 shadow-2xl overflow-hidden transition-all duration-300`}
          >
            {/* Background Photo */}
            {previewPhoto && (
              <img
                src={previewPhoto.medium}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-20"
              />
            )}

            {/* Format Badge */}
            <div className="absolute top-2 right-2 rounded-full bg-black/40 px-2.5 py-0.5 text-[10px] font-bold text-white backdrop-blur z-10">
              {format}
            </div>

            {/* Top Section: Title */}
            <div className="relative z-10 text-center pt-2">
              <h3 className={`font-black text-white drop-shadow-lg ${format === '16:9' ? 'text-sm sm:text-lg lg:text-xl' : 'text-xs sm:text-sm lg:text-base'}`}>
                {title || 'TITRE'}
              </h3>
              {subtitle && (
                <p className={`mt-1 text-white/80 drop-shadow ${format === '16:9' ? 'text-[10px] sm:text-xs' : 'text-[8px] sm:text-[10px]'}`}>
                  {subtitle}
                </p>
              )}
            </div>

            {/* Cards Grid */}
            <div className={`relative z-10 grid gap-1.5 w-full ${previewClasses.cols}`}>
              {cards.slice(0, format === '16:9' ? 6 : 5).map((card) => (
                <div
                  key={card.id}
                  className="flex flex-col items-center gap-0.5 rounded-lg bg-black/30 px-1.5 py-1.5 backdrop-blur-sm"
                  style={{ borderLeft: `2px solid ${card.color}` }}
                >
                  <span className={format === '16:9' ? 'text-lg' : 'text-sm'}>{card.emoji}</span>
                  <p className={`text-center font-bold text-white drop-shadow ${format === '16:9' ? 'text-[9px]' : 'text-[7px]'}`}>
                    {card.label}
                  </p>
                  <p className={`text-center font-black drop-shadow ${format === '16:9' ? 'text-[10px]' : 'text-[8px]'}`} style={{ color: card.color }}>
                    {card.value}
                  </p>
                  {card.description && (
                    <p className={`text-center text-white/60 ${format === '16:9' ? 'text-[7px]' : 'text-[6px]'}`}>
                      {card.description.substring(0, 30)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom: Sales Phrase */}
            <div className="relative z-10 text-center pb-1">
              {salesPhrases.length > 0 && (
                <p className={`font-medium text-white/90 drop-shadow ${format === '16:9' ? 'text-[10px]' : 'text-[8px]'}`}>
                  {salesPhrases[0]}
                </p>
              )}
              <p className={`mt-0.5 font-bold text-white drop-shadow ${format === '16:9' ? 'text-[10px]' : 'text-[7px]'}`}>
                AFROBOOST
              </p>
            </div>

            {/* Character Image */}
            {characterImage && (
              <img
                src={characterImage}
                alt="Character"
                className="absolute bottom-2 right-2 h-1/4 w-auto rounded z-10"
              />
            )}
          </div>
        </div>

        {/* Batch Preview Dots */}
        {batchCount > 1 && (
          <div className="mt-4 flex items-center gap-1.5 sm:gap-3 flex-wrap justify-center">
            <span className="text-xs text-gray-500">Batch: x{batchCount}</span>
            <div className="flex gap-1.5 flex-wrap justify-center">
              {Array.from({ length: Math.min(batchCount, 10) }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedPhotoIndex(i % pexelsPhotos.length)}
                  className={`h-2.5 w-2.5 rounded-full transition-all ${
                    selectedPhotoIndex === i % pexelsPhotos.length
                      ? 'bg-purple-500 scale-125'
                      : 'bg-gray-600 hover:bg-gray-500'
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Photo Preview Grid (small thumbnails) */}
        {pexelsPhotos.length > 0 && (
          <div className="mt-4 flex gap-1.5 sm:gap-2 overflow-x-auto px-2 sm:px-4">
            {pexelsPhotos.slice(0, Math.max(batchCount, 4)).map((photo, i) => (
              <button
                key={photo.id}
                onClick={() => setSelectedPhotoIndex(i)}
                className={`flex-shrink-0 overflow-hidden rounded transition-all ${
                  selectedPhotoIndex === i ? 'ring-2 ring-purple-500' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img src={photo.small} alt="" className="h-10 sm:h-16 w-8 sm:w-12 object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="mt-3 sm:mt-6 grid w-full max-w-xs grid-cols-3 gap-1.5 sm:gap-4 rounded-lg bg-gray-800 p-2 sm:p-3">
          <div className="text-center">
            <p className="text-[10px] sm:text-xs text-gray-400">Cartes</p>
            <p className="text-base sm:text-lg font-bold text-white">{cards.length}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] sm:text-xs text-gray-400">Batch</p>
            <p className="text-base sm:text-lg font-bold text-white">x{batchCount}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] sm:text-xs text-gray-400">Crédits</p>
            <p className="text-base sm:text-lg font-bold text-yellow-400">{25 * batchCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
