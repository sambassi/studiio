'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Upload,
  Edit2,
  Copy,
  FileVideo,
  Eye,
  Send,
  Trash2,
  Clock,
  Bot,
  Loader2,
  FileText,
  Calendar,
  Music,
  Folder,
  CheckSquare,
  Image as ImageIcon,
  Sparkles,
  Play,
  CalendarDays,
  Mic,
  Volume2,
  VolumeX,
  Download,
  Film,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useBranding } from '@/lib/hooks/useBranding';
import { useCreatorPreferences } from '@/lib/hooks/useCreatorPreferences';
import BrandingPanel from '@/components/BrandingPanel';
import { composeAndUpload, downloadBlob } from '@/lib/video-composer';
import { useTranslations, useLocale } from '@/i18n/client';
import { getContentPools, pickRandom as pickRandomI18n } from '@/lib/i18n-content';

interface PostBranding {
  watermarkText?: string;
  borderColor?: string;
  borderEnabled?: boolean;
  ctaText?: string;
  ctaSubText?: string;
  accentColor?: string;
}

interface PostMetadata {
  type?: 'creator' | 'infographic';
  subtitle?: string;
  salesPhrase?: string;
  objective?: string;
  mode?: string;
  theme?: string;
  rushUrls?: string[];
  musicUrl?: string;
  characterUrl?: string;
  voiceMode?: string;
  ttsVoice?: string;
  ttsText?: string;
  textCards?: { text: string; color?: string }[];
  cards?: { emoji: string; label: string; value: string; color?: string }[];
  posterUrl?: string;
  pexelsUrl?: string;
  videoUrl?: string;
  logoUrl?: string;
  voiceUrl?: string;
  renderedVideoUrl?: string;
  rawVideoUrl?: string;
  hasAudio?: boolean;
  sequences?: {
    intro?: number;
    cards?: number;
    video?: number;
    cta?: number;
    total?: number;
    order?: string[];
  };
  branding?: PostBranding;
}

interface Post {
  id: string;
  title: string;
  caption: string;
  media_url?: string;
  media_type: 'video' | 'image';
  format: 'reel' | 'tv';
  platforms: string[];
  scheduled_date: string;
  scheduled_time: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'publishing';
  metadata?: PostMetadata;
}

const platformColors: Record<string, string> = {
  Instagram: 'bg-pink-500',
  TikTok: 'bg-black',
  Facebook: 'bg-blue-600',
  YouTube: 'bg-red-600',
  'YouTube Shorts': 'bg-red-600',
};

export default function CalendarPage() {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const locale = useLocale();
  const localeMap: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', de: 'de-DE' };
  const intlLocale = localeMap[locale] || 'fr-FR';
  const { branding, setBranding } = useBranding();
  const { prefs, updatePrefs, loaded: prefsLoaded } = useCreatorPreferences();
  const prefsAppliedRef = useRef(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showAIAgent, setShowAIAgent] = useState(false);
  const [saving, setSaving] = useState(false);

  // Bulk selection
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);

  // Edit modal state
  const [editTab, setEditTab] = useState<'draft' | 'scheduled' | 'published'>('draft');
  const [editFormData, setEditFormData] = useState<Partial<Post>>({
    platforms: [],
    status: 'draft',
  });

  // AI Agent state
  const [aiPlanDuration, setAiPlanDuration] = useState<'7' | '14' | '30'>('30');
  const [aiPlatforms, setAiPlatforms] = useState<string[]>(['Instagram']);
  const [aiObjectives, setAiObjectives] = useState<string[]>(['promo']);
  const [aiRushFiles, setAiRushFiles] = useState<File[]>([]);
  const [aiMusicFile, setAiMusicFile] = useState<File | null>(null);
  const [aiPhotoAffiche, setAiPhotoAffiche] = useState(false);

  // Drag & drop state
  const [draggedPost, setDraggedPost] = useState<Post | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [touchDragPost, setTouchDragPost] = useState<Post | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Bulk date change
  const [showBulkDateModal, setShowBulkDateModal] = useState(false);
  const [bulkNewDate, setBulkNewDate] = useState('');
  const [bulkNewTime, setBulkNewTime] = useState('12:00');

  // Full preview modal
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [fullPreviewPost, setFullPreviewPost] = useState<Post | null>(null);
  const [infoSeqIndex, setInfoSeqIndex] = useState(0);
  const [montageAutoPlay, setMontageAutoPlay] = useState(true);
  const [montageMuted, setMontageMuted] = useState(true);
  const [videoPlayable, setVideoPlayable] = useState(false); // Track if video file is loadable — default false until proven
  const montageTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [montageProgress, setMontageProgress] = useState(0); // only used for non-CSS fallback
  const montageProgressRef = useRef<NodeJS.Timeout | null>(null);
  const seqDurationRef = useRef<number>(5000); // current sequence duration in ms for CSS animation
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiStage, setAiStage] = useState('');

  // Export rendering state (for on-the-fly montage composition)
  const [exportRendering, setExportRendering] = useState(false);
  const [exportRenderProgress, setExportRenderProgress] = useState(0);
  const [exportRenderStage, setExportRenderStage] = useState('');
  const rushInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  // Load saved preferences
  useEffect(() => {
    if (!prefsLoaded || prefsAppliedRef.current) return;
    prefsAppliedRef.current = true;
    if (prefs.aiPlanDuration) setAiPlanDuration(prefs.aiPlanDuration);
    if (prefs.aiPlatforms && prefs.aiPlatforms.length > 0) setAiPlatforms(prefs.aiPlatforms);
    if (prefs.aiObjectives && prefs.aiObjectives.length > 0) setAiObjectives(prefs.aiObjectives);
  }, [prefsLoaded]);

  // Auto-save preferences when AI agent settings change
  useEffect(() => {
    if (!prefsAppliedRef.current) return;
    updatePrefs({
      aiPlanDuration,
      aiPlatforms,
      aiObjectives,
    });
  }, [aiPlanDuration, aiPlatforms, aiObjectives]);

  // Fetch posts
  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const month = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/posts?month=${month}`);
      const data = await res.json();
      if (data.success && data.posts) {
        const mapped = data.posts.map((p: any) => ({
          id: p.id,
          title: p.title,
          caption: p.caption,
          media_url: p.media_url,
          media_type: p.media_type,
          format: p.format,
          platforms: p.platforms || [],
          scheduled_date: p.scheduled_date,
          scheduled_time: p.scheduled_time,
          status: p.status,
          metadata: p.metadata || undefined,
        }));
        setPosts(mapped);
      }
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setLoading(false);
    }
  }, [currentDate]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Stats
  const totalPosts = posts.length;
  const draftPosts = posts.filter((p) => p.status === 'draft').length;
  const scheduledPosts = posts.filter((p) => p.status === 'scheduled').length;
  const publishedPosts = posts.filter((p) => p.status === 'published').length;

  // Calendar helpers
  const getDaysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date: Date) => {
    const day = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    return day === 0 ? 6 : day - 1;
  };

  const getPostsForDay = (day: number): Post[] => {
    const dateStr = formatDateForStorage(currentDate, day);
    return posts.filter((post) => post.scheduled_date === dateStr);
  };

  const formatDateForStorage = (date: Date, day: number): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    return `${year}-${month}-${dayStr}`;
  };

  const formatMonthYear = (date: Date): string => {
    const str = date.toLocaleDateString(intlLocale, { month: 'long', year: 'numeric' });
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const handlePrevMonth = () => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1)); setSelectedDay(null); };
  const handleNextMonth = () => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1)); setSelectedDay(null); };
  const handleDayClick = (day: number) => { setSelectedDay(selectedDay === day ? null : day); };

  const handlePostClick = (post: Post) => {
    setSelectedPost(post);
    const meta = post.metadata as Record<string, unknown> | undefined;
    const hasMontage = meta?.type === 'infographic' || meta?.type === 'creator' || meta?.sequences;
    if (hasMontage) {
      handleFullPreview(post);
    } else {
      setShowPreviewModal(true);
    }
  };

  const handleEditPost = (post?: Post) => {
    const target = post || selectedPost;
    if (target) {
      setSelectedPost(target);
      setEditFormData({ ...target });
      setEditTab(target.status as 'draft' | 'scheduled' | 'published');
      setShowEditModal(true);
      setShowPreviewModal(false);
    }
  };

  const handleDuplicatePost = async (post?: Post) => {
    const target = post || selectedPost;
    if (!target) return;
    setSaving(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...target, id: undefined, status: 'draft' }),
      });
      const data = await res.json();
      if (data.success) await fetchPosts();
    } catch (error) { console.error('Error duplicating:', error); }
    finally { setSaving(false); setShowPreviewModal(false); }
  };

  const handleDeletePost = async (post?: Post) => {
    const target = post || selectedPost;
    if (!target) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/posts?id=${target.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) setPosts(posts.filter((p) => p.id !== target.id));
    } catch (error) { console.error('Error deleting:', error); }
    finally { setSaving(false); setShowPreviewModal(false); }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    if (selectedPostIds.size === 0) return;
    setSaving(true);
    try {
      const ids = Array.from(selectedPostIds);
      for (const id of ids) {
        await fetch(`/api/posts?id=${id}`, { method: 'DELETE' });
      }
      setPosts((prev) => prev.filter((p) => !selectedPostIds.has(p.id)));
      setSelectedPostIds(new Set());
      setBulkMode(false);
    } catch (error) { console.error('Bulk delete error:', error); }
    finally { setSaving(false); }
  };

  // Bulk duplicate
  const handleBulkDuplicate = async () => {
    if (selectedPostIds.size === 0) return;
    setSaving(true);
    try {
      const ids = Array.from(selectedPostIds);
      for (const id of ids) {
        const post = posts.find((p) => p.id === id);
        if (post) {
          await fetch('/api/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...post, id: undefined, status: 'draft' }),
          });
        }
      }
      await fetchPosts();
      setSelectedPostIds(new Set());
      setBulkMode(false);
    } catch (error) { console.error('Bulk duplicate error:', error); }
    finally { setSaving(false); }
  };

  const togglePostSelection = (id: string) => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSchedulePost = async (post: Post) => {
    // Validate: must have at least one platform selected
    if (!post.platforms || post.platforms.length === 0) {
      alert(t('validation.noPlatforms') || 'Veuillez sélectionner au moins un réseau social avant de planifier.');
      return;
    }

    const meta = post.metadata || {};

    // Auto-compose montage if not already rendered
    // The montage (with title, cards, transitions) is required for social media publishing.
    // Without it, only the raw poster/rush would be published.
    if (!meta.renderedVideoUrl && meta.posterUrl) {
      console.log('[Schedule] No renderedVideoUrl — auto-composing montage before scheduling...');
      setExportRendering(true);
      setExportRenderProgress(0);
      setExportRenderStage('Rendu du montage...');

      try {
        const posterUrl = meta.posterUrl || meta.pexelsUrl || meta.characterUrl || null;
        const videoUrl = meta.rushUrls?.[0] || null;
        const musicUrl = meta.musicUrl || null;
        const voiceUrl = meta.voiceUrl || null;
        const logoUrl = meta.logoUrl || null;
        const seq = meta.sequences;
        const brand = meta.branding;
        const isReel = post.format === 'reel';

        const { url: renderedUrl } = await composeAndUpload({
          width: isReel ? 1080 : 1920,
          height: isReel ? 1920 : 1080,
          fps: 30,
          title: post.title || 'Vidéo',
          subtitle: meta.subtitle || undefined,
          salesPhrase: meta.salesPhrase || undefined,
          cards: meta.cards?.length > 0
            ? meta.cards.map((c: any) => ({ emoji: c.emoji, label: c.label, value: c.value, color: c.color }))
            : (meta.textCards || []).map((tCard: any) => ({ emoji: '📝', label: tCard.text, value: tCard.text, color: tCard.color })),
          posterUrl,
          videoUrl,
          logoUrl,
          musicUrl,
          voiceUrl,
          introDuration: seq?.intro ?? 5,
          cardsDuration: seq?.cards ?? ((meta.cards?.length > 0 || meta.textCards?.length > 0) ? 6 : 0),
          videoDuration: seq?.video ?? 12,
          ctaDuration: seq?.cta ?? 5,
          accentColor: brand?.accentColor || '#D91CD2',
          ctaText: brand?.ctaText || 'CHAT POUR PLUS D\'INFOS',
          ctaSubText: brand?.ctaSubText || 'LIEN EN BIO',
          watermarkText: brand?.watermarkText || undefined,
          onProgress: (pct, stage) => {
            setExportRenderProgress(pct);
            setExportRenderStage(stage);
          },
        });

        if (renderedUrl) {
          // Update post metadata with rendered video URL
          post = {
            ...post,
            media_url: renderedUrl,
            media_type: 'video',
            metadata: {
              ...meta,
              renderedVideoUrl: renderedUrl,
              videoUrl: renderedUrl,
            },
          };
          console.log('[Schedule] Montage composed and uploaded:', renderedUrl);
        }
      } catch (err) {
        console.error('[Schedule] Auto-compose failed:', err);
        setExportRenderStage('Erreur de rendu');
        setTimeout(() => { setExportRendering(false); setExportRenderProgress(0); setExportRenderStage(''); }, 3000);
        return; // Don't schedule if compose failed
      } finally {
        setExportRendering(false);
        setExportRenderProgress(0);
        setExportRenderStage('');
      }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post, status: 'scheduled' }),
      });
      const data = await res.json();
      if (data.success) await fetchPosts();
    } catch (error) { console.error('Error scheduling:', error); }
    finally { setSaving(false); }
  };

  const handleSavePost = async () => {
    // Validate: if scheduling, must have platforms
    if (editTab === 'scheduled' && (!editFormData.platforms || editFormData.platforms.length === 0)) {
      alert(t('validation.noPlatforms') || 'Veuillez sélectionner au moins un réseau social avant de planifier.');
      return;
    }
    setSaving(true);
    try {
      if (editFormData.id) {
        const res = await fetch('/api/posts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...editFormData, status: editTab }),
        });
        const data = await res.json();
        if (data.success) await fetchPosts();
      } else {
        const res = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editFormData.title || 'Nouveau post',
            caption: editFormData.caption || '',
            media_url: editFormData.media_url,
            media_type: editFormData.media_type || 'video',
            format: editFormData.format || 'reel',
            platforms: editFormData.platforms || [],
            scheduled_date: editFormData.scheduled_date || formatDateForStorage(new Date(), new Date().getDate()),
            scheduled_time: editFormData.scheduled_time || '12:00',
            status: editTab,
          }),
        });
        const data = await res.json();
        if (data.success) await fetchPosts();
      }
    } catch (error) { console.error('Error saving:', error); }
    finally { setSaving(false); setShowEditModal(false); setEditFormData({}); }
  };

  // Drag & drop: move post to a new date
  const handleDropOnDay = async (day: number) => {
    const post = draggedPost || touchDragPost;
    if (!post) return;
    const newDate = formatDateForStorage(currentDate, day);
    if (newDate === post.scheduled_date) { setDraggedPost(null); setTouchDragPost(null); setDragOverDay(null); return; }
    setSaving(true);
    try {
      await fetch('/api/posts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post, scheduled_date: newDate }),
      });
      await fetchPosts();
    } catch (error) { console.error('Error moving post:', error); }
    finally { setSaving(false); setDraggedPost(null); setTouchDragPost(null); setDragOverDay(null); }
  };

  // Touch drag handlers
  const handleTouchStart = (post: Post) => { setTouchDragPost(post); };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchDragPost || !calendarRef.current) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el) {
      const dayAttr = el.closest('[data-day]')?.getAttribute('data-day');
      if (dayAttr) setDragOverDay(parseInt(dayAttr));
    }
  };
  const handleTouchEnd = () => {
    if (touchDragPost && dragOverDay) handleDropOnDay(dragOverDay);
    else { setTouchDragPost(null); setDragOverDay(null); }
  };

  // Bulk date change
  const handleBulkDateChange = async () => {
    if (!bulkNewDate || selectedPostIds.size === 0) return;
    setSaving(true);
    try {
      const ids = Array.from(selectedPostIds);
      for (let i = 0; i < ids.length; i++) {
        const post = posts.find((p) => p.id === ids[i]);
        if (post) {
          // Stagger times: first post gets the selected time, each subsequent post +30min
          const baseHour = parseInt(bulkNewTime.split(':')[0]) || 12;
          const baseMin = parseInt(bulkNewTime.split(':')[1]) || 0;
          const totalMin = baseHour * 60 + baseMin + (i * 30);
          const h = Math.min(Math.floor(totalMin / 60), 23);
          const m = totalMin % 60;
          const scheduledTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          await fetch(`/api/posts/${post.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduled_date: bulkNewDate, scheduled_time: scheduledTime }),
          });
        }
      }
      await fetchPosts();
      setSelectedPostIds(new Set());
      setBulkMode(false);
      setShowBulkDateModal(false);
      setBulkNewDate('');
      setBulkNewTime('12:00');
    } catch (error) { console.error('Bulk date change error:', error); }
    finally { setSaving(false); }
  };

  // IA caption generator
  const generateIACaption = () => {
    const captions: Record<string, string[]> = {
      promotion: [
        '🔥 Offre exclusive ! Ne rate pas cette opportunité, places limitées 💥\n\n#promo #offre #fitness',
        '⚡ FLASH SALE - Profite de -30% cette semaine seulement !\n\nLien en bio 👆\n\n#promotion #deal #sport',
        '🎯 Ton objectif commence ici. Premier cours GRATUIT !\n\n#decouverte #gratuit #afroboost',
        '💪 Investis en toi. L\'offre expire bientôt ⏰\n\n#motivation #promo #transformation',
      ],
      motivation: [
        '🔥 Pas d\'excuses. C\'est maintenant ou jamais !\n\nTu es plus fort(e) que tu ne le crois 💪\n\n#motivation #noexcuse #fitness',
        '⚡ Chaque jour est une nouvelle chance de se dépasser\n\nQui est prêt ? 🙋‍♂️\n\n#motivation #workout #energie',
        '💥 Le succès commence quand tu sors de ta zone de confort\n\n#mindset #strong #afroboost',
        '🌟 Ton corps peut tout. C\'est ton esprit qu\'il faut convaincre\n\n#motivation #believe #power',
      ],
      bienfaits: [
        '✨ Savais-tu ? 30 min de danse = 400 calories brûlées !\n\nTon corps te remerciera 🙏\n\n#bienfaits #sante #danse',
        '❤️ Le sport réduit le stress de 70% et améliore ton sommeil\n\nProuvé scientifiquement 📊\n\n#bienfaits #wellness',
        '💪 Résultats visibles en 30 jours. Testé par +5000 personnes\n\n#resultats #transformation #bienfaits',
      ],
      abonnement: [
        '🔔 Abonne-toi pour ne rien rater !\n\nContenu exclusif chaque jour 🎬\n\n#follow #subscribe #contenu',
        '❤️ Rejoins la communauté ! +5000 membres actifs\n\nLien en bio 👆\n\n#communaute #team #abonnement',
        '🚀 Active la cloche ! Du contenu qui va changer ta routine\n\n#followme #notification #afroboost',
      ],
      nutrition: [
        '🥗 Mange sain, performe mieux !\n\nRecette du jour dans le post ➡️\n\n#nutrition #healthy #recette',
        '💚 La nutrition c\'est 70% de tes résultats\n\nFuel ton corps avec le meilleur 🍎\n\n#nutrition #mealprep #sante',
        '🔥 Recette protéinée en 5 min chrono ⏱️\n\nSimple, rapide, efficace\n\n#nutrition #recipe #fitness',
      ],
    };
    const postTitle = (editFormData.title || '').toLowerCase();
    let pool = captions['motivation'];
    for (const [key, phrases] of Object.entries(captions)) {
      if (postTitle.includes(key.slice(0, 4))) { pool = phrases; break; }
    }
    const random = pool[Math.floor(Math.random() * pool.length)];
    setEditFormData({ ...editFormData, caption: random });
  };

  // Full preview before publish
  const handleFullPreview = (post: Post) => {
    setFullPreviewPost(post);
    setInfoSeqIndex(0);
    setMontageAutoPlay(true);
    setMontageMuted(true);
    setVideoPlayable(false); // Default false — only set true after video actually loads
    setMontageProgress(0);
    setShowFullPreview(true);
  };

  // Auto-play montage: cycle through sequences automatically
  useEffect(() => {
    if (!showFullPreview || !fullPreviewPost || !montageAutoPlay) {
      if (montageTimerRef.current) clearTimeout(montageTimerRef.current);
      return;
    }
    const meta = fullPreviewPost.metadata;
    const isMontagePost = meta?.type === 'infographic' || (meta?.type === 'creator' && meta?.sequences);
    if (!isMontagePost) return;

    const seqOrder: string[] = meta?.sequences?.order || ['intro', 'cards', 'video', 'cta'];
    // Only include video sequence if the video file has been proven playable
    // videoPlayable starts false and is only set true after onloadeddata fires
    const activeSeqs = videoPlayable ? seqOrder : seqOrder.filter((s: string) => s !== 'video');
    const seqs = (meta?.sequences || {}) as Record<string, number>;
    const currentDuration = (seqs[activeSeqs[infoSeqIndex]] || 5) * 1000; // ms

    // Store duration for CSS-driven progress bar (no setInterval, no re-renders)
    seqDurationRef.current = currentDuration;

    // Auto-advance to next sequence — stop at end (no loop), pause music
    if (montageTimerRef.current) clearTimeout(montageTimerRef.current);
    montageTimerRef.current = setTimeout(() => {
      if (infoSeqIndex < activeSeqs.length - 1) {
        setInfoSeqIndex(infoSeqIndex + 1);
      } else {
        // End of montage: stop auto-play and pause music/voice
        setMontageAutoPlay(false);
        document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice, #preview-audio-rendered').forEach(a => { a.pause(); });
        document.querySelectorAll<HTMLVideoElement>('#preview-video-infographic, #preview-video').forEach(v => { v.pause(); });
      }
    }, currentDuration);

    return () => {
      if (montageTimerRef.current) clearTimeout(montageTimerRef.current);
    };
  }, [showFullPreview, fullPreviewPost, infoSeqIndex, montageAutoPlay, videoPlayable]);

  // Explicit video play/pause when sequence changes — browser autoplay is unreliable
  useEffect(() => {
    if (!showFullPreview || !fullPreviewPost || !videoPlayable) return;
    const meta = fullPreviewPost.metadata;
    // Only use raw rush video — never rendered montage (has CTA baked in)
    const videoSrc = meta?.rawVideoUrl || meta?.rushUrls?.[0];
    if (!videoSrc) return;
    const seqOrder: string[] = meta?.sequences?.order || ['intro', 'cards', 'video', 'cta'];
    const safeIdx = infoSeqIndex < seqOrder.length ? infoSeqIndex : 0;
    const currentSeq = seqOrder[safeIdx] || 'intro';

    const vid = document.getElementById('preview-video-infographic') as HTMLVideoElement | null;
    if (!vid || vid.readyState === 0) return; // Don't try play() if video hasn't loaded

    if (currentSeq === 'video') {
      vid.muted = true; // Must be muted for autoplay policy
      vid.currentTime = 0;
      const playPromise = vid.play();
      if (playPromise) {
        playPromise.then(() => {
          if (!montageMuted) vid.muted = false;
        }).catch(() => {}); // Silently handle — videoPlayable detection will skip this sequence
      }
    } else {
      // Pause video when not in video sequence to save resources
      if (!vid.paused) vid.pause();
    }
  }, [showFullPreview, fullPreviewPost, infoSeqIndex, montageMuted]);

  // Initial video preload when full preview opens — detect broken files
  useEffect(() => {
    if (!showFullPreview || !fullPreviewPost) return;
    const meta = fullPreviewPost.metadata;
    // ONLY test raw rush video — never rendered montage (has full montage with CTA baked in)
    const videoSrc = meta?.rawVideoUrl || meta?.rushUrls?.[0];
    if (!videoSrc) { setVideoPlayable(false); return; }

    // Give React a tick to render the video elements
    const timer = setTimeout(() => {
      const vid = document.getElementById('preview-video-infographic') as HTMLVideoElement | null;
      if (!vid) return;
      vid.muted = true;

      // Detect if video can actually load — 8s timeout for large files (rush MP4 can be 15-20MB)
      const loadTimeout = setTimeout(() => {
        if (vid.readyState === 0) {
          console.warn('[Calendar] Video failed to load after 8s, skipping video sequence:', vid.src);
          setVideoPlayable(false);
        }
      }, 8000);

      vid.onloadeddata = () => {
        clearTimeout(loadTimeout);
        console.log('[Calendar] Video loaded OK, readyState:', vid.readyState, 'duration:', vid.duration);
        setVideoPlayable(true);
      };
      vid.onerror = () => {
        clearTimeout(loadTimeout);
        console.error('[Calendar] Video load error, skipping video sequence');
        setVideoPlayable(false);
      };

      vid.load();
    }, 100);

    return () => clearTimeout(timer);
  }, [showFullPreview, fullPreviewPost]);

  // Force separate audio elements to play (muted) when montage preview opens
  // This ensures they are loaded and ready for unmute
  // NOTE: #preview-audio-rendered uses preload="none" — it loads lazily on unmute to avoid
  // consuming bandwidth/connections that the rush video needs to load
  useEffect(() => {
    if (!showFullPreview || !fullPreviewPost) return;
    const timer = setTimeout(() => {
      document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice').forEach(a => {
        a.muted = true;
        a.play().catch(() => {});
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [showFullPreview, fullPreviewPost]);

  // Force video play/pause when the active sequence changes
  useEffect(() => {
    if (!showFullPreview || !fullPreviewPost) return;
    const meta = fullPreviewPost.metadata;
    // Only use raw rush video — never rendered montage
    const videoSrc = meta?.rawVideoUrl || meta?.rushUrls?.[0];
    if (!videoSrc) return;

    const seqOrder: string[] = meta?.sequences?.order || ['intro', 'cards', 'video', 'cta'];
    const activeSeqs = videoPlayable ? seqOrder : seqOrder.filter((s: string) => s !== 'video');
    const currentSeq = activeSeqs[infoSeqIndex] || 'intro';

    const vid = document.getElementById('preview-video-infographic') as HTMLVideoElement | null;
    if (!vid) return;

    let timeout: ReturnType<typeof setTimeout> | null = null;
    let onLoaded: (() => void) | null = null;

    if (currentSeq === 'video') {
      // Don't call play() if video hasn't loaded (readyState 0 = HAVE_NOTHING)
      if (vid.readyState === 0) {
        // Video not loaded — skip sequence after 3s timeout
        timeout = setTimeout(() => {
          console.warn('[Calendar] Video readyState still 0 after 3s, skipping sequence');
          setInfoSeqIndex(prev => {
            const next = prev + 1;
            return next < activeSeqs.length ? next : 0;
          });
        }, 3000);
        onLoaded = () => {
          if (timeout) clearTimeout(timeout);
          vid.currentTime = 0;
          vid.play().catch(() => {});
        };
        vid.addEventListener('loadeddata', onLoaded, { once: true });
      } else {
        // Video is loaded — play it
        vid.currentTime = 0;
        const playPromise = vid.play();
        if (playPromise) playPromise.catch(() => {}); // Silence AbortError
      }
    } else {
      // Pause video when not in video sequence
      if (!vid.paused) vid.pause();
    }

    return () => {
      if (timeout) clearTimeout(timeout);
      if (onLoaded) vid.removeEventListener('loadeddata', onLoaded);
    };
  }, [showFullPreview, fullPreviewPost, infoSeqIndex]);

  const handlePublishPost = async (post: Post) => {
    setSaving(true);
    try {
      await fetch('/api/posts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post, status: 'published' }),
      });
      await fetchPosts();
      setShowFullPreview(false);
    } catch (error) { console.error('Error publishing:', error); }
    finally { setSaving(false); }
  };

  const handleNewPost = () => {
    setEditFormData({
      platforms: [],
      status: 'draft',
      format: 'reel',
      scheduled_date: selectedDay
        ? formatDateForStorage(currentDate, selectedDay)
        : formatDateForStorage(new Date(), new Date().getDate()),
      scheduled_time: '12:00',
      title: '',
      caption: '',
      media_type: 'video',
    });
    setEditTab('draft');
    setShowEditModal(true);
  };

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp,image/gif';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const isVideo = file.type.startsWith('video/');
      const title = file.name.replace(/\.[^/.]+$/, '');
      try {
        let mediaUrl: string | null = null;
        // Use signed URL for large files (> 4MB) to bypass Vercel's 4.5MB body limit
        if (file.size > 4 * 1024 * 1024) {
          const signRes = await fetch('/api/upload/signed-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, contentType: file.type, purpose: isVideo ? 'rush' : 'thumbnail' }),
          });
          const signData = await signRes.json();
          if (signData.success) {
            const putRes = await fetch(signData.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
            if (putRes.ok) mediaUrl = signData.publicUrl;
          }
        } else {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('purpose', isVideo ? 'rush' : 'thumbnail');
          const uploadRes = await fetch('/api/upload/media', { method: 'POST', body: formData });
          const uploadData = await uploadRes.json();
          mediaUrl = uploadData.success ? uploadData.file.url : null;
        }
        setEditFormData({
          platforms: [], status: 'draft', format: 'reel',
          scheduled_date: selectedDay ? formatDateForStorage(currentDate, selectedDay) : formatDateForStorage(new Date(), new Date().getDate()),
          scheduled_time: '12:00', title, caption: '', media_url: mediaUrl, media_type: isVideo ? 'video' : 'image',
        });
        setEditTab('draft');
        setShowEditModal(true);
      } catch (error) {
        console.error('Upload failed:', error);
      }
    };
    input.click();
  };

  // AI Agent handler
  // Export / download a post's rendered montage video
  // If renderedVideoUrl exists, download it. Otherwise, compose on-the-fly using metadata.
  const handleExportPost = async (post: Post) => {
    const meta = post.metadata;

    // If we already have a rendered montage URL in WebM format, convert server-side to MP4 then download
    // NEVER reuse old .mp4 montages — Chrome MediaRecorder produces corrupted MP4 in fast mode
    if (meta?.renderedVideoUrl && !meta.renderedVideoUrl.endsWith('.mp4')) {
      setExportRendering(true);
      setExportRenderProgress(30);
      setExportRenderStage('Conversion MP4...');
      try {
        // Use server-side FFmpeg conversion (reliable H.264 output)
        const convertRes = await fetch('/api/convert/to-mp4', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: meta.renderedVideoUrl }),
        });
        const convertData = await convertRes.json();
        if (convertData.success && convertData.mp4Url) {
          setExportRenderProgress(80);
          setExportRenderStage('Téléchargement...');
          const mp4Res = await fetch(convertData.mp4Url);
          const mp4Blob = await mp4Res.blob();
          const url = URL.createObjectURL(mp4Blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(post.title || 'video').replace(/\s+/g, '_')}.mp4`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          setExportRenderProgress(100);
          setExportRenderStage('MP4 prêt !');
        } else {
          // Fallback: download WebM with correct extension
          console.warn('[Export] Server conversion failed:', convertData.error);
          const res = await fetch(meta.renderedVideoUrl);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(post.title || 'video').replace(/\s+/g, '_')}.webm`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
      } catch (err) {
        console.error('[Export] Server conversion error:', err);
        setExportRenderStage('Erreur de conversion');
      } finally {
        setTimeout(() => { setExportRendering(false); setExportRenderProgress(0); setExportRenderStage(''); }, 3000);
      }
      return;
    }

    // No rendered video — compose montage on-the-fly using stored metadata
    console.log('[Export] No renderedVideoUrl — composing montage on-the-fly for:', post.title);
    setExportRendering(true);
    setExportRenderProgress(0);
    setExportRenderStage(t('exportOverlay.preparingMontage'));

    try {
      const posterUrl = meta?.posterUrl || meta?.pexelsUrl || meta?.characterUrl || null;
      const videoUrl = meta?.rushUrls?.[0] || null;
      const musicUrl = meta?.musicUrl || null;
      const voiceUrl = meta?.voiceUrl || null;
      const logoUrl = meta?.logoUrl || null;
      const seq = meta?.sequences;
      const brand = meta?.branding;
      const isReel = post.format === 'reel';

      const { blob, url: renderedUrl } = await composeAndUpload({
        width: isReel ? 1080 : 1920,
        height: isReel ? 1920 : 1080,
        fps: 30,
        title: post.title || 'Vidéo',
        subtitle: meta?.subtitle || undefined,
        salesPhrase: meta?.salesPhrase || undefined,
        cards: meta?.cards?.length > 0
          ? meta.cards.map((c: { emoji: string; label: string; value: string; color?: string }) => ({ emoji: c.emoji, label: c.label, value: c.value, color: c.color }))
          : (meta?.textCards || []).map((tCard: { text: string; color?: string }) => ({ emoji: '📝', label: tCard.text, value: tCard.text, color: tCard.color })),
        posterUrl,
        videoUrl,
        logoUrl,
        musicUrl,
        voiceUrl,
        introDuration: seq?.intro ?? 5,
        cardsDuration: seq?.cards ?? ((meta?.cards?.length > 0 || meta?.textCards?.length > 0) ? 6 : 0),
        videoDuration: seq?.video ?? 12,
        ctaDuration: seq?.cta ?? 5,
        accentColor: brand?.accentColor || '#D91CD2',
        ctaText: brand?.ctaText || 'CHAT POUR PLUS D\'INFOS',
        ctaSubText: brand?.ctaSubText || 'LIEN EN BIO',
        watermarkText: brand?.watermarkText || undefined,
        onProgress: (pct, stage) => {
          setExportRenderProgress(pct);
          setExportRenderStage(stage);
        },
      });

      // Download the composed video — use server-side conversion for proper MP4
      if (blob && blob.size > 0) {
        if (renderedUrl && renderedUrl.includes('webm')) {
          // Server-side conversion for reliable MP4 output
          setExportRenderStage('Conversion MP4...');
          try {
            const convertRes = await fetch('/api/convert/to-mp4', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videoUrl: renderedUrl }),
            });
            const convertData = await convertRes.json();
            if (convertData.success && convertData.mp4Url) {
              setExportRenderStage('Téléchargement...');
              const mp4Res = await fetch(convertData.mp4Url);
              const mp4Blob = await mp4Res.blob();
              const url = URL.createObjectURL(mp4Blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${(post.title || 'montage').replace(/\s+/g, '_')}.mp4`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            } else {
              // Fallback to client-side (may produce WebM)
              downloadBlob(blob, `${(post.title || 'montage').replace(/\s+/g, '_')}.mp4`);
            }
          } catch {
            downloadBlob(blob, `${(post.title || 'montage').replace(/\s+/g, '_')}.mp4`);
          }
        } else {
          downloadBlob(blob, `${(post.title || 'montage').replace(/\s+/g, '_')}.mp4`);
        }
      }

      // Update the post with the rendered URL if upload succeeded
      if (renderedUrl) {
        try {
          await fetch('/api/posts', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...post,
              media_url: renderedUrl,
              media_type: 'video',
              metadata: {
                ...meta,
                renderedVideoUrl: renderedUrl,
                videoUrl: renderedUrl,
              },
            }),
          });
          await fetchPosts();
          console.log('[Export] Post updated with renderedVideoUrl:', renderedUrl);
        } catch (err) {
          console.error('[Export] Failed to update post:', err);
        }
      }
    } catch (err) {
      console.error('[Export] Montage composition failed:', err);
      setExportRenderStage(t('exportOverlay.errorMontage'));
    } finally {
      setTimeout(() => {
        setExportRendering(false);
        setExportRenderProgress(0);
        setExportRenderStage('');
      }, 3000);
    }
  };

  const handleAIGenerate = async () => {
    if (aiRushFiles.length === 0) return;
    setAiGenerating(true);
    setAiProgress(0);
    setAiStage(t('aiAgent.stages.preparing'));
    try {
      const days = parseInt(aiPlanDuration);
      const postsToCreate = Math.min(days, 30);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 1); // Start from tomorrow
      const totalSteps = aiRushFiles.length + (aiMusicFile ? 1 : 0) + (aiPhotoAffiche ? 1 : 0) + postsToCreate;
      let completedSteps = 0;

      // --- 1. Upload rush files to Supabase ---
      setAiStage(t('aiAgent.stages.uploadingRush', { current: '0', total: String(aiRushFiles.length) }));
      const rushUrls: string[] = [];
      for (let fi = 0; fi < aiRushFiles.length; fi++) {
        setAiStage(t('aiAgent.stages.uploadingRush', { current: String(fi + 1), total: String(aiRushFiles.length) }));
        const rushFile = aiRushFiles[fi];
        try {
          // Use signed URL for large files (> 4MB) to bypass Vercel's 4.5MB body limit
          if (rushFile.size > 4 * 1024 * 1024) {
            const signRes = await fetch('/api/upload/signed-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: rushFile.name, contentType: rushFile.type, purpose: 'rush' }),
            });
            const signData = await signRes.json();
            if (signData.success) {
              const putRes = await fetch(signData.signedUrl, { method: 'PUT', headers: { 'Content-Type': rushFile.type }, body: rushFile });
              if (putRes.ok) rushUrls.push(signData.publicUrl);
            }
          } else {
            const formData = new FormData();
            formData.append('file', rushFile);
            formData.append('purpose', 'rush');
            const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.success && data.file?.url) rushUrls.push(data.file.url);
          }
        } catch (err) { console.error('Rush upload error:', err); }
        completedSteps++;
        setAiProgress(Math.round((completedSteps / totalSteps) * 100));
      }

      // --- 2. Upload music ---
      let musicUrl: string | null = null;
      if (aiMusicFile) {
        setAiStage(t('aiAgent.stages.uploadingMusic'));
        try {
          // Use signed URL for large audio files (> 4MB)
          if (aiMusicFile.size > 4 * 1024 * 1024) {
            const signRes = await fetch('/api/upload/signed-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: aiMusicFile.name, contentType: aiMusicFile.type, purpose: 'music' }),
            });
            const signData = await signRes.json();
            if (signData.success) {
              const putRes = await fetch(signData.signedUrl, { method: 'PUT', headers: { 'Content-Type': aiMusicFile.type }, body: aiMusicFile });
              if (putRes.ok) musicUrl = signData.publicUrl;
            }
          } else {
            const formData = new FormData();
            formData.append('file', aiMusicFile);
            formData.append('purpose', 'music');
            const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.success && data.file?.url) musicUrl = data.file.url;
          }
        } catch (err) { console.error('Music upload error:', err); }
        completedSteps++;
        setAiProgress(Math.round((completedSteps / totalSteps) * 100));
      }

      // --- 3. Fetch poster photos from Pexels (different per objective) ---
      const posterUrlsByObjective: Record<string, string[]> = {};
      if (aiPhotoAffiche) {
        setAiStage(t('aiAgent.stages.searchingPhotos'));
        const objQueries: Record<string, string> = {
          promo: 'fitness promotion sale offer',
          motiv: 'athlete motivation sport training',
          bienfaits: 'wellness health yoga meditation',
          abo: 'gym membership community fitness',
          nutri: 'healthy food nutrition smoothie',
        };
        for (const obj of aiObjectives) {
          try {
            const q = objQueries[obj] || 'fitness dance workout';
            const pxRes = await fetch(`/api/pexels?query=${encodeURIComponent(q)}&count=15`);
            const pxData = await pxRes.json();
            if (pxData.success && pxData.photos) {
              posterUrlsByObjective[obj] = pxData.photos.map((p: { url: string }) => p.url);
            }
          } catch (err) { console.error('Pexels fetch error:', err); }
        }
        completedSteps++;
        setAiProgress(Math.round((completedSteps / totalSteps) * 100));
      }

      // --- Variation pools per objective (locale-aware) ---
      const contentPools = getContentPools(locale as 'fr' | 'en' | 'de');
      const titlePools = contentPools.titles;
      const subtitlePools = contentPools.subtitles;
      const phrasePools = contentPools.phrases;
      const objectiveLabels = contentPools.objectiveLabels;

      const pickRandom = (arr: string[], exclude: string[] = []) => {
        const filtered = arr.filter((x) => !exclude.includes(x));
        return (filtered.length > 0 ? filtered : arr)[Math.floor(Math.random() * (filtered.length > 0 ? filtered : arr).length)] || '';
      };
      const usedTitles: string[] = [];

      // --- 4. Client-side compose + Create posts ---
      setAiStage(t('aiAgent.stages.composingPosts'));
      for (let i = 0; i < postsToCreate; i++) {
        const postDate = new Date(startDate);
        postDate.setDate(startDate.getDate() + i);
        const dateStr = `${postDate.getFullYear()}-${String(postDate.getMonth() + 1).padStart(2, '0')}-${String(postDate.getDate()).padStart(2, '0')}`;
        const platform = aiPlatforms[i % aiPlatforms.length] || 'Instagram';
        const objective = aiObjectives[i % aiObjectives.length] || 'promo';

        const bTitle = pickRandom(titlePools[objective] || titlePools['promo'], usedTitles);
        usedTitles.push(bTitle);
        const bSubtitle = pickRandom(subtitlePools[objective] || subtitlePools['promo']);
        const bPhrase = pickRandom(phrasePools[objective] || phrasePools['promo']);

        const rushUrl = rushUrls.length > 0 ? rushUrls[i % rushUrls.length] : null;
        const objPosters = posterUrlsByObjective[objective] || [];
        const posterUrl = objPosters.length > 0 ? objPosters[i % objPosters.length] : null;
        const rushFile = aiRushFiles.length > 0 ? aiRushFiles[i % aiRushFiles.length] : null;
        const mediaType = rushFile?.type?.startsWith('image/') ? 'image' as const : 'video' as const;

        setAiStage(t('aiAgent.stages.composingVideo', { current: String(i + 1), total: String(postsToCreate), title: bTitle }));

        // Client-side video composition
        let renderedVideoUrl: string | null = null;
        if (rushUrls.length > 0 || posterUrl) {
          try {
            const { url } = await composeAndUpload({
              width: 1080,
              height: 1920,
              fps: 30,
              title: bTitle,
              subtitle: bSubtitle || undefined,
              salesPhrase: bPhrase || undefined,
              posterUrl: posterUrl || null,
              videoUrl: rushUrl,
              logoUrl: null,
              musicUrl: musicUrl || null,
              voiceUrl: null,
              introDuration: posterUrl ? 5 : 0,
              cardsDuration: 0,
              videoDuration: 12,
              ctaDuration: 5,
              accentColor: branding.accentColor || '#D91CD2',
              ctaText: branding.ctaText || 'CHAT POUR PLUS D\'INFOS',
              ctaSubText: branding.ctaSubText || 'LIEN EN BIO',
              watermarkText: branding.watermarkText || undefined,
              onProgress: (_pct, stage) => {
                setAiStage(t('aiAgent.stages.videoStage', { current: String(i + 1), total: String(postsToCreate), stage }));
              },
            });
            if (url) renderedVideoUrl = url;
          } catch (err) { console.error(`[Agent IA] Compose error post ${i + 1}:`, err); }
        }

        // Create calendar post — prefer rendered montage, fallback to poster (never raw rush)
        const postMediaUrl = renderedVideoUrl || posterUrl || null;
        if (!renderedVideoUrl) console.warn('[Agent IA] Montage URL is null — upload may have failed');
        await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: bTitle,
            caption: `${bSubtitle}\n${bPhrase}\n\n#${objectiveLabels[objective]} #Afroboost #${platform}`,
            media_url: postMediaUrl,
            media_type: renderedVideoUrl ? 'video' : (rushUrl ? mediaType : (posterUrl ? 'image' : 'video')),
            format: 'reel',
            platforms: [platform],
            scheduled_date: dateStr,
            scheduled_time: `${String(9 + (i % 12)).padStart(2, '0')}:00:00`,
            status: 'draft',
            metadata: {
              type: 'creator' as const,
              subtitle: bSubtitle,
              salesPhrase: bPhrase,
              objective,
              rushUrls: rushUrls.length > 0 ? rushUrls : undefined,
              musicUrl: musicUrl || undefined,
              renderedVideoUrl: renderedVideoUrl || undefined,
              videoUrl: renderedVideoUrl || rushUrl || undefined,
              posterUrl: posterUrl || undefined,
              pexelsUrl: posterUrl || undefined,
              characterUrl: posterUrl || undefined,
              voiceMode: musicUrl ? 'music' : 'none',
              sequences: {
                intro: 5, cards: 0, video: 12, cta: 5, total: 22,
                order: posterUrl ? ['intro', 'video', 'cta'] : ['video', 'cta'],
              },
              branding: {
                watermarkText: branding.watermarkText,
                borderColor: branding.borderColor,
                borderEnabled: branding.borderEnabled,
                ctaText: branding.ctaText,
                ctaSubText: branding.ctaSubText,
                accentColor: branding.accentColor,
              },
            },
          }),
        });
        // Also create a video record in the library
        try {
          await fetch('/api/videos', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: bTitle,
              format: 'reel',
              type: 'creator',
              status: renderedVideoUrl ? 'completed' : 'draft',
              video_url: renderedVideoUrl || null,
              thumbnail_url: posterUrl || null,
              metadata: {
                title: bTitle, subtitle: bSubtitle, salesPhrase: bPhrase, objective,
                posterPhotoUrl: posterUrl || null, characterUrl: posterUrl || null,
                rushUrls: rushUrls.length > 0 ? rushUrls : [], musicUrl: musicUrl || null,
                renderedVideoUrl: renderedVideoUrl || null,
              },
            }),
          });
        } catch (vidErr) { console.error(`[Agent IA] Video record creation failed:`, vidErr); }

        completedSteps++;
        setAiProgress(Math.round((completedSteps / totalSteps) * 100));
      }

      setAiStage(t('aiAgent.stages.done'));
      setAiProgress(100);
      await new Promise((r) => setTimeout(r, 800));
      await fetchPosts();
    } catch (error) {
      console.error('AI generation error:', error);
    } finally {
      setAiGenerating(false);
      setAiProgress(0);
      setAiStage('');
      setShowAIAgent(false);
    }
  };

  const toggleAiPlatform = (p: string) => {
    setAiPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  };

  const toggleAiObjective = (o: string) => {
    setAiObjectives((prev) => prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]);
  };

  // Calendar grid
  const renderCalendarGrid = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days: React.ReactNode[] = [];
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === currentDate.getFullYear() && today.getMonth() === currentDate.getMonth();

    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="aspect-square bg-gray-800/50 rounded-md sm:rounded-lg" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayPosts = getPostsForDay(day);
      const isSelected = selectedDay === day;
      const isToday = isCurrentMonth && today.getDate() === day;

      days.push(
        <div
          key={day}
          data-day={day}
          onClick={() => handleDayClick(day)}
          onDragOver={(e) => { e.preventDefault(); setDragOverDay(day); }}
          onDragLeave={() => { if (dragOverDay === day) setDragOverDay(null); }}
          onDrop={(e) => { e.preventDefault(); handleDropOnDay(day); }}
          className={`aspect-square p-0.5 sm:p-1.5 rounded-md sm:rounded-lg cursor-pointer transition-all relative ${
            dragOverDay === day
              ? 'bg-purple-600/30 ring-2 ring-purple-400 scale-105'
              : isSelected
              ? 'bg-gradient-to-br from-purple-600 to-pink-500 shadow-lg shadow-purple-500/20'
              : isToday
              ? 'bg-gray-700 ring-2 ring-pink-500'
              : 'bg-gray-800 hover:bg-gray-700 border border-gray-700/50'
          }`}
        >
          <div className={`text-xs sm:text-sm font-medium ${isToday ? 'text-pink-400' : isSelected ? 'text-white' : 'text-gray-300'}`}>
            {day}
          </div>
          {dayPosts.length > 0 && (
            <div className="absolute bottom-0.5 sm:bottom-1.5 left-0.5 sm:left-1.5 right-0.5 sm:right-1.5 flex gap-0.5 flex-wrap">
              {dayPosts.slice(0, 3).map((post) => (
                <div key={post.id} className={`w-1 sm:w-1.5 h-1 sm:h-1.5 rounded-full ${platformColors[post.platforms[0]] || 'bg-gray-400'}`} />
              ))}
              {dayPosts.length > 3 && <span className="text-[6px] sm:text-[8px] text-gray-400">+{dayPosts.length - 3}</span>}
            </div>
          )}
        </div>
      );
    }
    return days;
  };

  const selectedDayPosts = selectedDay ? getPostsForDay(selectedDay) : [];

  return (
    <div className="min-h-[calc(100vh-64px)] text-white">
      {/* Hidden inputs */}
      <input ref={rushInputRef} type="file" accept="video/*,image/*" multiple className="hidden" onChange={(e) => {
        if (e.target.files) setAiRushFiles(Array.from(e.target.files));
      }} />
      <input ref={musicInputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => {
        if (e.target.files?.[0]) setAiMusicFile(e.target.files[0]);
      }} />

      {/* Export rendering overlay */}
      {exportRendering && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-purple-500/30">
            <div className="flex items-center gap-3 mb-4">
              <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
              <h3 className="text-lg font-bold text-white">{t('exportOverlay.title')}</h3>
            </div>
            <p className="text-sm text-gray-300 mb-4">{exportRenderStage}</p>
            <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${exportRenderProgress}%`, background: 'linear-gradient(90deg, #7C3AED, #EC4899)' }}
              />
            </div>
            <p className="text-xs text-purple-400 text-right mt-2 font-bold">{exportRenderProgress}%</p>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="px-4 sm:px-8 pt-6 pb-4">
        <h1 className="text-2xl sm:text-3xl font-bold">{t('title')}</h1>
        <p className="text-gray-400 text-xs sm:text-sm mt-1">{t('subtitle')}</p>
      </div>

      {/* Stats Cards */}
      <div className="px-4 sm:px-8 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          {[
            { label: t('stats.total'), value: totalPosts, color: 'text-white' },
            { label: t('stats.drafts'), value: draftPosts, color: 'text-yellow-400' },
            { label: t('stats.scheduled'), value: scheduledPosts, color: 'text-blue-400' },
            { label: t('stats.published'), value: publishedPosts, color: 'text-red-400' },
          ].map((stat) => (
            <div key={stat.label} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3 sm:p-4 text-center">
              <div className={`text-xl sm:text-2xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="px-4 sm:px-8 pb-8 flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* Left: Calendar */}
        <div className="flex-1 w-full">
          <Card className="p-4 sm:p-6">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-6">
              <button onClick={handlePrevMonth} className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition">
                <ChevronLeft size={18} className="sm:w-5 sm:h-5" />
              </button>
              <h2 className="text-lg sm:text-xl font-bold capitalize">{formatMonthYear(currentDate)}</h2>
              <button onClick={handleNextMonth} className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition">
                <ChevronRight size={18} className="sm:w-5 sm:h-5" />
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 sm:mb-3">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                const weekdayFull = new Date(2024, 0, day).toLocaleDateString(intlLocale, { weekday: 'short' });
                return (
                  <div key={day} className="text-center text-gray-500 text-[9px] sm:text-xs font-medium py-1">
                    <span className="sm:hidden">{weekdayFull[0]}</span>
                    <span className="hidden sm:inline">{weekdayFull}</span>
                  </div>
                );
              })}
            </div>

            {/* Calendar Grid */}
            <div ref={calendarRef} className="grid grid-cols-7 gap-1 sm:gap-2" onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
              {loading ? (
                <div className="col-span-7 flex items-center justify-center py-20">
                  <Loader2 className="animate-spin text-purple-500 mr-2" size={20} />
                  <span className="text-gray-400 text-sm">{t('loading')}</span>
                </div>
              ) : (
                renderCalendarGrid()
              )}
            </div>

            {/* Bottom Action Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 mt-6 pt-4 border-t border-gray-700/50">
              <div className="flex flex-col xs:flex-row gap-1.5 w-full sm:w-auto">
                <button
                  onClick={() => setShowAIAgent(true)}
                  className="flex items-center justify-center sm:justify-start gap-1 px-2.5 sm:px-4 py-2 sm:py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-[10px] sm:text-sm font-medium transition"
                >
                  <Bot size={12} className="sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">{t('agentIA')}</span>
                  <span className="sm:hidden">{t('agentIA').substring(0, 3)}</span>
                </button>
                <button
                  onClick={handleImportClick}
                  className="flex items-center justify-center sm:justify-start gap-1 px-2.5 sm:px-4 py-2 sm:py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-[10px] sm:text-sm font-medium transition"
                >
                  <Upload size={12} className="sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">{t('import')}</span>
                  <span className="sm:hidden">{t('import').substring(0, 3)}</span>
                </button>
              </div>
              <button
                onClick={handleNewPost}
                className="flex items-center justify-center gap-1 px-3 sm:px-5 py-2 sm:py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 rounded-lg text-[10px] sm:text-sm font-bold transition w-full sm:w-auto"
              >
                <Plus size={12} className="sm:w-4 sm:h-4" />
                {t('newPost')}
              </button>
            </div>
          </Card>
        </div>

        {/* Right: Sidebar */}
        <div className="w-full lg:w-80 lg:flex-shrink-0">
          <Card className="p-4 sm:p-5 sticky top-0 lg:sticky">
            {selectedDay ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
                  <h3 className="text-base sm:text-lg font-bold">
                    {new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDay).toLocaleDateString(intlLocale, { weekday: 'short', day: 'numeric', month: 'short' })}
                  </h3>
                  {selectedDayPosts.length > 0 && (
                    <button
                      onClick={() => { setBulkMode(!bulkMode); setSelectedPostIds(new Set()); }}
                      className={`text-[10px] sm:text-xs px-2 py-1 rounded transition w-fit ${bulkMode ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-white'}`}
                    >
                      <CheckSquare size={10} className="sm:w-3 sm:h-3 inline mr-1" />
                      {bulkMode ? tc('cancel') : t('select')}
                    </button>
                  )}
                </div>
                <p className="text-[10px] sm:text-xs text-gray-400 mb-3">{selectedDayPosts.length} {selectedDayPosts.length !== 1 ? t('posts') : t('post')}</p>

                {/* Select all / deselect */}
                {bulkMode && (
                  <div className="flex flex-col xs:flex-row xs:items-center gap-2 mb-2">
                    <button
                      onClick={() => {
                        if (selectedPostIds.size === selectedDayPosts.length) {
                          setSelectedPostIds(new Set());
                        } else {
                          setSelectedPostIds(new Set(selectedDayPosts.map(p => p.id)));
                        }
                      }}
                      className="text-[10px] sm:text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
                    >
                      {selectedPostIds.size === selectedDayPosts.length ? t('deselectAll') : t('selectAll')}
                    </button>
                    <span className="text-[8px] sm:text-[10px] text-gray-500">{selectedPostIds.size}/{selectedDayPosts.length}</span>
                  </div>
                )}

                {/* Bulk actions bar */}
                {bulkMode && selectedPostIds.size > 0 && (
                  <div className="flex flex-col xs:flex-row gap-1.5 xs:gap-2 mb-3 p-1.5 xs:p-2 bg-gray-800 rounded-lg border border-gray-700">
                    <button
                      onClick={handleBulkDuplicate}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-1 py-1 xs:py-1.5 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[8px] xs:text-[10px] font-medium transition"
                    >
                      <Copy className="w-2.5 xs:w-3 h-2.5 xs:h-3" /> {t('bulkDuplicate')}
                    </button>
                    <button
                      onClick={() => { setShowBulkDateModal(true); setBulkNewDate(''); }}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-1 py-1 xs:py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[8px] xs:text-[10px] font-medium transition"
                    >
                      <CalendarDays className="w-2.5 xs:w-3 h-2.5 xs:h-3" /> {t('bulkMove')}
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-1 py-1 xs:py-1.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[8px] xs:text-[10px] font-medium transition"
                    >
                      <Trash2 className="w-2.5 xs:w-3 h-2.5 xs:h-3" /> {t('bulkDelete')}
                    </button>
                  </div>
                )}

                {/* Post preview — 9:16 phone format with montage-style overlay */}
                {selectedDayPosts.length > 0 && !bulkMode && (() => {
                  const fp = selectedDayPosts[0];
                  const fpMeta = fp.metadata;
                  const fpAccent = fpMeta?.branding?.accentColor || '#D91CD2';
                  const fpImg = fp.media_url || fpMeta?.posterUrl || fpMeta?.pexelsUrl || fpMeta?.characterUrl;
                  const fpTextCards = (fpMeta?.textCards as Array<{ text: string; color: string }>) || [];
                  if (!fpImg && !fp.title && fpTextCards.length === 0) return null;
                  return (
                    <div className="flex justify-center mb-3">
                      <div className="w-28 sm:w-36 aspect-[9/16] rounded-xl overflow-hidden border border-gray-700 bg-black relative">
                        {fpImg && (
                          fp.media_type === 'video' && fp.media_url ? (
                            <video src={fp.media_url} className="w-full h-full object-cover" muted />
                          ) : (
                            <img src={fpImg} alt="" className="w-full h-full object-cover" />
                          )
                        )}
                        {!fpImg && <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-black to-pink-900" />}
                        {/* Gradient overlay */}
                        <div className="absolute inset-0" style={{ background: `linear-gradient(to top, ${fpAccent}CC 0%, rgba(0,0,0,0.3) 40%, transparent 65%)` }} />
                        {/* Title + subtitle + text cards overlay */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2 z-10">
                          <h4 className="text-[11px] font-black text-white uppercase tracking-wide leading-tight" style={{ textShadow: `0 0 8px ${fpAccent}CC, 0 0 20px ${fpAccent}66` }}>
                            {fp.title || 'TITRE'}
                          </h4>
                          {fpMeta?.subtitle && (
                            <p className="text-[7px] text-white/80 mt-0.5" style={{ textShadow: `0 0 6px ${fpAccent}80` }}>{fpMeta.subtitle}</p>
                          )}
                          <div className="w-6 h-px mt-1 mx-auto rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${fpAccent}, transparent)` }} />
                          {fpTextCards.length > 0 && (
                            <div className="mt-1.5 space-y-0.5 w-full max-w-[90%]">
                              {fpTextCards.slice(0, 2).map((card, ci) => (
                                <div key={ci} className="flex items-center gap-1 bg-black/40 backdrop-blur-sm rounded px-1 py-px">
                                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: card.color || fpAccent }} />
                                  <span className="text-[6px] text-white/80 truncate">{card.text}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Bottom bar */}
                        <div className="absolute bottom-0 inset-x-0 h-0.5 z-20" style={{ background: `linear-gradient(90deg, ${fpAccent}, #FF2DAA, #00D4FF)` }} />
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                  {selectedDayPosts.length === 0 ? (
                    <div className="flex flex-col items-center py-6 text-gray-500">
                      <Calendar size={28} className="mb-2 text-gray-600" />
                      <p className="text-sm">{t('noPosts')}</p>
                    </div>
                  ) : (
                    selectedDayPosts.map((post) => (
                      <div
                        key={post.id}
                        draggable={!bulkMode}
                        onDragStart={() => setDraggedPost(post)}
                        onDragEnd={() => { setDraggedPost(null); setDragOverDay(null); }}
                        onTouchStart={() => !bulkMode && handleTouchStart(post)}
                        className={`bg-gray-800 rounded-lg p-2.5 border transition ${
                          bulkMode && selectedPostIds.has(post.id) ? 'border-purple-500 bg-purple-500/10' :
                          draggedPost?.id === post.id ? 'border-purple-400 opacity-50' :
                          'border-gray-700 hover:border-gray-600'
                        } ${!bulkMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
                        onClick={bulkMode ? () => togglePostSelection(post.id) : undefined}
                      >
                        {bulkMode && (
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center text-white transition ${
                              selectedPostIds.has(post.id) ? 'bg-purple-600 border-purple-600' : 'border-gray-600'
                            }`}>
                              {selectedPostIds.has(post.id) && <span className="text-[10px]">✓</span>}
                            </div>
                            <p className="text-sm font-medium text-white truncate flex-1">{post.title}</p>
                          </div>
                        )}

                        {!bulkMode && (
                          <>
                            <div className="flex items-start gap-2 mb-1.5">
                              <FileText className="w-3 h-3 text-gray-400 flex-shrink-0 mt-0.5" />
                              <p className="text-xs font-medium text-white truncate flex-1">{post.title}</p>
                            </div>

                            <div className="flex items-center gap-2 mb-1.5">
                              {post.platforms.length > 0 && (
                                <div className="flex gap-1">
                                  {post.platforms.map((platform) => (
                                    <div key={platform} className={`w-4 h-4 rounded flex items-center justify-center text-white text-[8px] font-bold ${platformColors[platform]}`}>
                                      {platform[0]}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <Badge className={`text-white text-[9px] px-1 py-0 ${
                                post.status === 'published' ? 'bg-green-600' : post.status === 'scheduled' ? 'bg-blue-600' : post.status === 'failed' ? 'bg-red-600' : post.status === 'publishing' ? 'bg-yellow-600' : 'bg-gray-600'
                              }`} title={post.status === 'failed' ? (post.metadata?.error || post.metadata?.cron_publish_results?.map((r: any) => `${r.platform}: ${r.error}`).join(', ') || '') : ''}>
                                {t(`status.${post.status}`)}
                              </Badge>
                              {post.metadata?.hasAudio && (
                                <span className="text-[9px] text-pink-400 flex items-center gap-0.5" title={t('actions.addAudio')}><Volume2 className="w-2.5 h-2.5" /></span>
                              )}
                              <span className="text-[9px] text-gray-400 flex items-center gap-0.5 ml-auto">
                                <Clock className="w-2.5 h-2.5" />{post.scheduled_time}
                              </span>
                            </div>

                            <div className="flex gap-1">
                              <button onClick={() => handlePostClick(post)} className="p-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition" title={t('actions.preview')}><Eye className="w-3 h-3" /></button>
                              <button onClick={() => handleEditPost(post)} className="p-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition" title={t('actions.edit')}><Edit2 className="w-3 h-3" /></button>
                              <button onClick={() => handleDuplicatePost(post)} className="p-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition" title={t('actions.duplicate')}><Copy className="w-3 h-3" /></button>
                              {(post.media_url || post.metadata?.characterUrl) && (
                                <button onClick={() => handleExportPost(post)} className="p-1 rounded bg-gray-700 hover:bg-blue-600 text-gray-300 hover:text-white transition" title={t('actions.export')}><Download className="w-3 h-3" /></button>
                              )}
                              {!post.metadata?.hasAudio && post.media_type === 'video' && (
                                <button onClick={() => { window.location.href = `/dashboard/audio-studio?postId=${post.id}`; }} className="p-1 rounded bg-purple-600 hover:bg-purple-700 text-white transition" title={t('actions.addAudio')}><Volume2 className="w-3 h-3" /></button>
                              )}
                              <button onClick={() => handleFullPreview(post)} className="p-1 rounded bg-green-600 hover:bg-green-700 text-white transition ml-auto" title={t('actions.fullPreview')}><Play className="w-3 h-3" /></button>
                              <button disabled={saving} onClick={() => handleDeletePost(post)} className="p-1 rounded bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white transition" title={t('actions.delete')}><Trash2 className="w-3 h-3" /></button>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  )}

                  {selectedDay && (
                    <button
                      onClick={handleNewPost}
                      className="w-full p-2 rounded-lg border-2 border-dashed border-gray-700 hover:border-purple-500 text-gray-400 hover:text-white transition flex items-center justify-center gap-2 text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t('addPost')}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <h3 className="text-lg font-bold text-white mb-4">{t('selectDate')}</h3>
                <Calendar size={48} className="mb-3 text-gray-600" />
                <p className="text-sm text-center">{t('clickDayToSee')}</p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Preview Modal */}
      <Modal isOpen={showPreviewModal} onClose={() => setShowPreviewModal(false)} title={t('previewModal.title')} size="lg">
        {selectedPost && (() => {
          const spMeta = selectedPost.metadata as Record<string, unknown> | undefined;
          const spAccent = (spMeta?.branding as Record<string, unknown>)?.accentColor as string || '#D91CD2';
          const spSubtitle = spMeta?.subtitle as string || '';
          const spPosterUrl = spMeta?.posterUrl as string || spMeta?.characterUrl as string || null;
          const spImgSrc = selectedPost.media_type === 'video' ? (spPosterUrl || selectedPost.media_url) : selectedPost.media_url;
          const spTextCards = (spMeta?.textCards as Array<{ text: string; color: string }>) || [];
          return (
          <div className="space-y-4">
            {/* Always show preview card — with media, or gradient + info cards */}
            <div className="flex justify-center bg-black rounded-lg p-4">
              <div className={`relative overflow-hidden rounded-xl ${
                selectedPost.format === 'reel' ? 'w-48 aspect-[9/16]' : 'w-full max-w-lg aspect-video'
              }`}>
                {selectedPost.media_type === 'video' && selectedPost.media_url ? (
                  <video src={selectedPost.media_url} controls className="w-full h-full object-cover rounded" />
                ) : (
                  <>
                    {spImgSrc ? (
                      <img src={spImgSrc} alt={selectedPost.title} className="w-full h-full object-cover rounded" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-black to-pink-900" />
                    )}
                    {/* Gradient + title/subtitle overlay */}
                    <div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(to top, ${spAccent}CC 0%, rgba(0,0,0,0.3) 40%, transparent 65%)` }} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
                      <h4 className="text-lg font-black text-white uppercase tracking-wider leading-tight" style={{ textShadow: `0 0 12px ${spAccent}CC, 0 0 30px ${spAccent}66, 0 2px 4px rgba(0,0,0,0.8)` }}>
                        {selectedPost.title || 'TITRE'}
                      </h4>
                      {spSubtitle && (
                        <p className="text-xs text-white/80 mt-1" style={{ textShadow: `0 0 8px ${spAccent}80` }}>{spSubtitle}</p>
                      )}
                      <div className="w-12 h-0.5 mt-2 mx-auto rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${spAccent}, transparent)` }} />
                      {/* Text cards preview */}
                      {spTextCards.length > 0 && (
                        <div className="mt-3 space-y-1 w-full max-w-[80%]">
                          {spTextCards.slice(0, 3).map((card, ci) => (
                            <div key={ci} className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded px-2 py-0.5">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: card.color || spAccent }} />
                              <span className="text-[9px] text-white/90 truncate">{card.text}</span>
                            </div>
                          ))}
                          {spTextCards.length > 3 && (
                            <span className="text-[8px] text-white/50">+{spTextCards.length - 3} {t('previewModal.cards')}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-lg font-bold text-white mb-2">{selectedPost.title}</h4>
              <p className="text-gray-400 text-sm mb-3">{selectedPost.caption}</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedPost.platforms.map((p) => (
                  <Badge key={p} className={`${platformColors[p]} text-white text-xs`}>{p}</Badge>
                ))}
              </div>
              <div className="text-xs text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {selectedPost.scheduled_date} {t('previewModal.at')} {selectedPost.scheduled_time}
              </div>
            </div>
            <div className="flex gap-3">
              <Button className="flex-1 bg-studiio-primary text-white" onClick={() => handleEditPost()}>
                <Edit2 className="w-4 h-4 mr-2" />{t('actions.edit')}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => handleDuplicatePost()} disabled={saving}>
                <Copy className="w-4 h-4 mr-2" />{t('actions.duplicate')}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => handleDeletePost()} disabled={saving}>
                <Trash2 className="w-4 h-4 mr-2" />{t('actions.delete')}
              </Button>
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title={t('editModal.title')} size="lg">
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <div className="flex gap-4 mb-6 border-b border-gray-700 pb-3">
            {(['draft', 'scheduled', 'published'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setEditTab(tab)}
                className={`text-sm font-medium pb-2 transition ${
                  editTab === tab ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-400 hover:text-white'
                }`}
              >
                {t(`editModal.${tab}`)}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white mb-2">{t('editModal.titleField')}</label>
              <input type="text" value={editFormData.title || ''} onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500" placeholder={t('editModal.titlePlaceholder')} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-white">{t('editModal.captionField')}</label>
                <button
                  onClick={generateIACaption}
                  className="flex items-center gap-1 px-2.5 py-1 bg-purple-600 hover:bg-purple-500 rounded-lg text-[10px] font-medium text-white transition"
                >
                  <Sparkles size={10} /> {t('editModal.generateCaption')}
                </button>
              </div>
              <textarea value={editFormData.caption || ''} onChange={(e) => setEditFormData({ ...editFormData, caption: e.target.value })} rows={4}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm" placeholder={t('editModal.captionPlaceholder')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">{t('editModal.platforms')}</label>
              <div className="flex flex-wrap gap-2">
                {['Instagram', 'TikTok', 'Facebook', 'YouTube'].map((p) => (
                  <button key={p} onClick={() => {
                    const pls = editFormData.platforms || [];
                    setEditFormData({ ...editFormData, platforms: pls.includes(p) ? pls.filter((x) => x !== p) : [...pls, p] });
                  }}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                      editFormData.platforms?.includes(p) ? `${platformColors[p]} text-white` : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >{p}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">{t('editModal.media')}</label>
              <div onClick={handleImportClick} className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center cursor-pointer hover:border-purple-500 transition">
                {editFormData.media_url ? (
                  <div className="text-white"><FileVideo className="w-8 h-8 mx-auto mb-2 text-purple-400" /><p className="text-sm">{t('editModal.mediaAdded')}</p><p className="text-xs text-gray-400 mt-1">{t('editModal.mediaClickToChange')}</p></div>
                ) : (
                  <div className="text-gray-400"><Upload className="w-8 h-8 mx-auto mb-2" /><p className="text-sm">{t('editModal.mediaDragDrop')}</p><p className="text-xs text-gray-400 mt-1">{t('editModal.mediaClickToImport')}</p></div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">{t('editModal.format')}</label>
              <div className="flex gap-2">
                {(['reel', 'tv'] as const).map((fmt) => (
                  <button key={fmt} onClick={() => setEditFormData({ ...editFormData, format: fmt })}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${editFormData.format === fmt ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                  >{tc(`formats.${fmt}`)}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">{t('editModal.date')}</label>
                <input type="date" value={editFormData.scheduled_date || ''} onChange={(e) => setEditFormData({ ...editFormData, scheduled_date: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-2">{t('editModal.time')}</label>
                <input type="time" value={editFormData.scheduled_time || ''} onChange={(e) => setEditFormData({ ...editFormData, scheduled_time: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500" />
              </div>
            </div>
          </div>
          <div className="flex gap-3 mt-6 pt-4 border-t border-gray-700">
            <Button variant="secondary" className="flex-1" onClick={() => setShowEditModal(false)}>{tc('cancel')}</Button>
            <Button className="flex-1 bg-purple-600 hover:bg-purple-700 text-white" onClick={handleSavePost} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {t('editModal.save')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* AI Agent Modal — Compact, No Scroll */}
      <Modal isOpen={showAIAgent} onClose={() => setShowAIAgent(false)} title="" size="lg">
        <div>
          <div className="text-center mb-4">
            <h2 className="text-lg font-bold flex items-center justify-center gap-2">
              <span className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: '#3B82F620', color: '#3B82F6' }}><CalendarDays size={16} /></span>
              {t('aiAgent.title')}
            </h2>
            <p className="text-gray-400 text-xs mt-1">
              {t('aiAgent.description')}
            </p>
          </div>

          {/* Dossier de Rushes — accept videos + images */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Folder size={14} className="text-gray-400" />
              <span className="text-xs font-semibold">{t('aiAgent.rushFolder')}</span>
            </div>
            <button
              onClick={() => rushInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-700 hover:border-purple-500 rounded-lg py-3 text-center transition cursor-pointer"
            >
              {aiRushFiles.length > 0 ? (
                <div>
                  <span className="text-sm text-white font-medium">{t('aiAgent.filesCount', { count: String(aiRushFiles.length) })}</span>
                  <div className="flex flex-wrap gap-1 justify-center mt-1.5">
                    {aiRushFiles.slice(0, 6).map((f, i) => (
                      <span key={i} className="text-[9px] bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded truncate max-w-[80px]">
                        {f.type.startsWith('video/') ? <FileVideo className="inline w-2.5 h-2.5 mr-0.5" /> : <ImageIcon className="inline w-2.5 h-2.5 mr-0.5" />}
                        {f.name.slice(0, 10)}
                      </span>
                    ))}
                    {aiRushFiles.length > 6 && <span className="text-[9px] text-gray-400">+{aiRushFiles.length - 6}</span>}
                  </div>
                </div>
              ) : (
                <span className="text-sm text-gray-400">{t('aiAgent.selectVideosOrImages')}</span>
              )}
            </button>
          </div>

          {/* Compact config — all in two columns */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Left col */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">{t('aiAgent.planFor')}</label>
                <div className="flex gap-1.5">
                  {(['7', '14', '30'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setAiPlanDuration(d)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${
                        aiPlanDuration === d
                          ? 'bg-gradient-to-r from-purple-600 to-pink-500 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {t(`aiAgent.duration.${d}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">{t('aiAgent.platforms.label')}</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {['Instagram', 'Facebook', 'YouTube Shorts', 'TikTok'].map((p) => (
                    <button
                      key={p}
                      onClick={() => toggleAiPlatform(p)}
                      className={`py-2 rounded-lg text-xs font-medium transition border ${
                        aiPlatforms.includes(p)
                          ? 'bg-pink-500/20 border-pink-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right col */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">{t('aiAgent.objectives.label')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'promo', emoji: '📁' },
                    { id: 'motiv', emoji: '💪' },
                    { id: 'bienfaits', emoji: '✨' },
                    { id: 'abo', emoji: '❤️' },
                    { id: 'nutri', emoji: '🥗' },
                  ].map((obj) => (
                    <button
                      key={obj.id}
                      onClick={() => toggleAiObjective(obj.id)}
                      className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition border ${
                        aiObjectives.includes(obj.id)
                          ? 'bg-purple-500/20 border-purple-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {obj.emoji} {t(`aiAgent.objectives.${obj.id}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Photo affiche toggle */}
              <div>
                <button
                  onClick={() => setAiPhotoAffiche(!aiPhotoAffiche)}
                  className={`w-full py-2 rounded-lg text-xs font-medium transition border ${
                    aiPhotoAffiche ? 'bg-pink-500/20 border-pink-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  <ImageIcon size={12} className="inline mr-1" />
                  {t('aiAgent.posterPhoto.label')}
                </button>
              </div>

              {/* Musique */}
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <Music size={12} className="text-gray-400" />
                  <label className="text-xs text-gray-400">{t('aiAgent.musicFile.label')}</label>
                </div>
                <button
                  onClick={() => musicInputRef.current?.click()}
                  className="w-full py-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg text-xs text-gray-400 transition truncate px-2"
                >
                  {aiMusicFile ? aiMusicFile.name : t('aiAgent.musicFile.selectFile')}
                </button>
              </div>
            </div>
          </div>

          {/* Branding / Personnalisation */}
          <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <h3 className="text-xs font-bold text-gray-300 mb-2 flex items-center gap-1.5">
              <Sparkles size={12} className="text-purple-400" />
              {t('aiAgent.branding.title')}
            </h3>
            <BrandingPanel branding={branding} onChange={setBranding} compact />
          </div>

          {/* Progress bar during generation */}
          {aiGenerating && (
            <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-300 font-medium">{aiStage}</span>
                <span className="text-xs text-purple-400 font-bold">{aiProgress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${aiProgress}%`, background: 'linear-gradient(90deg, #7C3AED, #EC4899)' }}
                />
              </div>
            </div>
          )}

          {/* Generate Button */}
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => !aiGenerating && setShowAIAgent(false)} disabled={aiGenerating}>{tc('cancel')}</Button>
            <button
              onClick={handleAIGenerate}
              disabled={aiGenerating || aiRushFiles.length === 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 disabled:opacity-50 rounded-lg text-sm font-bold transition"
            >
              {aiGenerating ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
              {aiGenerating ? t('aiAgent.generating') : t('aiAgent.generateWithDays', { days: aiPlanDuration })}
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Date Change Modal */}
      <Modal isOpen={showBulkDateModal} onClose={() => setShowBulkDateModal(false)} title={t('bulkDateModal.title')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-400">{t('bulkDateModal.selectedPosts', { count: String(selectedPostIds.size) })}</p>
          <div>
            <label className="block text-sm font-medium text-white mb-2">{t('bulkDateModal.newDate')}</label>
            <input
              type="date"
              value={bulkNewDate}
              onChange={(e) => setBulkNewDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white mb-2">{t('bulkDateModal.newTime')}</label>
            <input
              type="time"
              value={bulkNewTime}
              onChange={(e) => setBulkNewTime(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
            />
            {selectedPostIds.size > 1 && (
              <p className="text-[10px] text-gray-500 mt-1">{t('bulkDateModal.staggerNote')}</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowBulkDateModal(false)}>{tc('cancel')}</Button>
            <Button className="flex-1 bg-purple-600 hover:bg-purple-700 text-white" onClick={handleBulkDateChange} disabled={saving || !bulkNewDate}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarDays className="w-4 h-4 mr-2" />}
              {t('bulkDateModal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Full Preview Modal — Rich Montage Preview Before Publication */}
      {showFullPreview && fullPreviewPost && (() => {
        const meta = fullPreviewPost.metadata;
        const metaBranding = meta?.branding;
        const brd = metaBranding || branding;
        const accent = brd?.accentColor || branding.accentColor || '#D91CD2';
        const wm = brd?.watermarkText ?? branding.watermarkText;
        const borderCol = brd?.borderColor || (branding.borderEnabled ? branding.borderColor : null);
        const isCreator = meta?.type === 'creator';
        const isInfographic = meta?.type === 'infographic';
        const hasMontage = isInfographic || (isCreator && meta?.sequences);
        const hasMetadata = !!meta;
        const previewMusicUrl = meta?.musicUrl as string | undefined;
        const previewVoiceUrl = meta?.voiceUrl as string | undefined;
        // Detect audio: explicit hasAudio flag OR renderedVideoUrl exists (Studio Son always embeds audio)
        const postHasAudio = !!meta?.hasAudio || !!meta?.renderedVideoUrl;
        // Display title: use metadata subtitle for the overlay text, keep raw title for the sidebar
        const displayTitle = meta?.subtitle
          ? fullPreviewPost.title.replace(/\s*\(Rush\s*\d+\)\s*/gi, '').replace(/\s*-\s*(Instagram|Facebook|TikTok|YouTube|YouTube Shorts)\s*/gi, '')
          : fullPreviewPost.title;
        return (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4" onClick={() => setShowFullPreview(false)}>
          {/* Audio caché : utilise un <video> caché pour lire l'audio embarqué
              dans le fichier WebM rendu. Les <audio> ne chargent pas les WebM de
              MediaRecorder (métadonnées de durée manquantes), mais les <video> oui. */}
          <>
            {postHasAudio && meta?.renderedVideoUrl && (
              <video id="preview-audio-rendered" src={meta.renderedVideoUrl} loop muted playsInline preload="none" style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', zIndex: -1 }}
                onError={() => {
                  // If rendered video fails, try separate music file as fallback
                  if (previewMusicUrl && !document.getElementById('preview-audio-music')) {
                    const fallback = document.createElement('audio');
                    fallback.id = 'preview-audio-music';
                    fallback.src = previewMusicUrl;
                    fallback.loop = true;
                    fallback.muted = montageMuted;
                    fallback.autoplay = true;
                    fallback.style.display = 'none';
                    document.body.appendChild(fallback);
                    fallback.play().catch(() => {});
                  }
                }}
              />
            )}
            {/* Fallback: if hasAudio but no renderedVideoUrl, try separate files */}
            {postHasAudio && !meta?.renderedVideoUrl && previewMusicUrl && (
              <audio id="preview-audio-music" src={previewMusicUrl} autoPlay loop muted={montageMuted} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
            )}
            {postHasAudio && !meta?.renderedVideoUrl && previewVoiceUrl && (
              <audio id="preview-audio-voice" src={previewVoiceUrl} autoPlay muted={montageMuted} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
            )}
          </>
          <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-2xl max-w-5xl w-full flex max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {/* Left: Rich Montage Preview */}
            <div className="flex-1 bg-black flex flex-col items-center justify-center min-h-[60vh] p-4">
              {/* Montage video preview — infographic & creator with sequences */}
              {hasMontage ? (() => {
                const seqOrder: string[] = meta?.sequences?.order || ['intro', 'cards', 'video', 'cta'];
                // Only include video sequence if the video has been proven playable (onloadeddata fired)
                const activeSeqs = videoPlayable ? seqOrder : seqOrder.filter((s: string) => s !== 'video');
                const posterImgSrc = meta?.pexelsUrl || meta?.posterUrl || meta?.characterUrl || null;
                const safeIdx = infoSeqIndex < activeSeqs.length ? infoSeqIndex : 0;
                const currentSeq = activeSeqs[safeIdx] || 'intro';

                return (
                  <div
                    className={`relative overflow-hidden rounded-xl ${fullPreviewPost.format === 'reel' ? 'aspect-[9/16] h-[78vh] max-h-[78vh]' : 'aspect-video w-full'}`}
                    style={{
                      border: borderCol ? `3px solid ${borderCol}` : undefined,
                      boxShadow: borderCol ? `0 0 30px ${borderCol}40, 0 0 60px ${borderCol}15` : `0 0 30px ${accent}4D, 0 0 60px ${accent}1A`,
                    }}
                  >
                    {/* === INTRO : Photo Affiche + Titre + Sous-titre === */}
                    <div className="absolute inset-0" style={{ opacity: currentSeq === 'intro' ? 1 : 0, transform: currentSeq === 'intro' ? 'scale(1)' : 'scale(1.08)', zIndex: currentSeq === 'intro' ? 10 : 1, transition: 'opacity 800ms ease-in-out, transform 800ms ease-in-out', willChange: 'opacity, transform' }}>
                      {posterImgSrc ? <img src={posterImgSrc} alt="Affiche" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-b from-black to-purple-950" />}
                      <div className="absolute inset-0" style={{ background: posterImgSrc ? 'linear-gradient(to top, rgba(100,0,140,0.85) 0%, rgba(0,0,0,0.35) 40%, transparent 60%)' : 'transparent' }} />
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10">
                        <h3 className="text-3xl font-black text-white uppercase tracking-wider leading-tight" style={{ textShadow: `0 0 20px ${accent}CC, 0 0 50px ${accent}66` }}>{displayTitle || 'TITRE'}</h3>
                        {meta?.subtitle && <p className="text-base text-white/90 mt-3" style={{ textShadow: `0 0 12px ${accent}80` }}>{meta.subtitle}</p>}
                        <div className="w-20 h-0.5 mt-4 mx-auto rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
                      </div>
                    </div>

                    {/* === CARTES : Cartes d'info avec animation décalée === */}
                    <div className="absolute inset-0" style={{ opacity: currentSeq === 'cards' ? 1 : 0, zIndex: currentSeq === 'cards' ? 10 : 1, transition: 'opacity 800ms ease-in-out', willChange: 'opacity' }}>
                      <div className="absolute inset-0 bg-gradient-to-b from-purple-950 via-gray-900 to-black" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center z-10 px-6">
                        <p className="text-xs font-bold text-white/50 uppercase tracking-[0.25em] text-center mb-5">{t('fullPreview.information')}</p>
                        <div className="w-full space-y-2.5">
                          {(() => {
                            // Use cards if available, otherwise convert textCards
                            const displayCards = meta?.cards?.length > 0
                              ? meta.cards.map((c: { emoji: string; label: string; value: string; color?: string }) => c)
                              : (meta?.textCards || []).map((tCard: { text: string; color?: string }) => ({ emoji: '📝', label: tCard.text, value: tCard.text, color: tCard.color }));
                            return displayCards.map((card: { emoji: string; label: string; value: string; color?: string }, i: number) => (
                              <div key={i} className="flex items-center gap-3 bg-black/40 rounded-xl px-4 py-3" style={{ borderLeft: `3px solid ${card.color || accent}`, transition: 'opacity 0.5s ease-out, transform 0.5s ease-out', transitionDelay: currentSeq === 'cards' ? `${i * 150}ms` : '0ms', opacity: currentSeq === 'cards' ? 1 : 0, transform: currentSeq === 'cards' ? 'translateX(0) translateZ(0)' : 'translateX(-20px) translateZ(0)', willChange: 'opacity, transform' }}>
                                <span className="text-2xl">{card.emoji}</span>
                                <span className="text-sm text-white/80 flex-1">{card.label}</span>
                                <span className="text-lg font-bold text-white" style={{ textShadow: `0 0 10px ${accent}80` }}>{card.value}</span>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* === VIDEO: Full-screen raw rush video only === */}
                    {(() => {
                      // ONLY use raw rush video for preview — NEVER the rendered montage.
                      // The rendered montage (.webm) already contains intro/cards/cta sequences baked in,
                      // which causes a "double CTA" effect when played inside the HTML montage preview.
                      const rawSrc = meta?.rawVideoUrl || meta?.rushUrls?.[0];
                      if (!rawSrc) return null;
                      return (
                      <div className="absolute inset-0" style={{ opacity: currentSeq === 'video' ? 1 : 0, zIndex: currentSeq === 'video' ? 10 : 1, transition: 'opacity 800ms ease-in-out', willChange: 'opacity' }}>
                        <video id="preview-video-infographic" src={rawSrc} muted loop playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover"
                          onLoadedData={(e) => { console.log('[Calendar] Rush video loaded, readyState:', (e.target as HTMLVideoElement).readyState); }}
                          onError={(e) => { console.error('[Calendar] Rush video error:', (e.target as HTMLVideoElement).error); }}
                        />
                      </div>
                      );
                    })()}

                    {/* === CTA: Call to action — black bg, colored text, logo once centered === */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ opacity: currentSeq === 'cta' ? 1 : 0, transform: currentSeq === 'cta' ? 'scale(1)' : 'scale(0.92)', zIndex: currentSeq === 'cta' ? 10 : 1, background: '#000000', transition: 'opacity 800ms ease-in-out, transform 800ms ease-in-out', willChange: 'opacity, transform' }}>
                      <div className="text-center px-6">
                        {meta?.logoUrl && <img src={meta.logoUrl} alt="Logo" className="w-40 h-40 object-contain mx-auto mb-6" />}
                        <p className="text-3xl font-black uppercase tracking-wider mb-4 leading-tight px-2" style={{ color: accent, textShadow: `0 0 30px ${accent}` }}>{brd?.ctaText || branding.ctaText || 'CHAT POUR PLUS D\'INFOS'}</p>
                        <p className="text-2xl uppercase tracking-wider font-bold" style={{ color: '#FFFFFF' }}>{brd?.ctaSubText || branding.ctaSubText || 'LIEN EN BIO'}</p>
                        {meta?.salesPhrase && <p className="text-xl mt-5 italic font-medium" style={{ color: `${accent}DD` }}>{meta.salesPhrase}</p>}
                      </div>
                    </div>

                    {/* === Lien site web — visible sur toutes les séquences (intro, cards, video, cta) === */}
                    <div className="absolute bottom-8 left-0 right-0 z-30 flex justify-center pointer-events-none">
                      <p className="text-base font-bold text-white/90 tracking-wider" style={{ textShadow: `0 0 10px ${accent}80, 0 2px 4px rgba(0,0,0,0.8)` }}>Afroboost.com</p>
                    </div>

                    {/* Play/Pause + Volume — top-right overlay */}
                    <div className="absolute top-3 right-3 z-40 flex items-center gap-1.5">
                      <button className="w-7 h-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center hover:bg-black/50 transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMontageMuted(m => {
                            const newMuted = !m;
                            // Sync all preview videos AND audio elements
                            document.querySelectorAll<HTMLVideoElement>('#preview-video-infographic, #preview-video').forEach(v => { v.muted = newMuted; });
                            document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice, #preview-audio-rendered').forEach(a => {
                              a.muted = newMuted;
                              // Lazy-load audio: if preload="none", load on first unmute
                              if (!newMuted && (a as HTMLMediaElement).readyState === 0 && (a as HTMLMediaElement).getAttribute('preload') === 'none') {
                                (a as HTMLMediaElement).load();
                              }
                              // Chrome nécessite play() explicite après interaction utilisateur pour activer l'audio
                              if (!newMuted) a.play().catch(() => {});
                            });
                            return newMuted;
                          });
                        }}
                        title={montageMuted ? t('fullPreview.enableSound') : t('fullPreview.muteSound')}
                      >
                        {montageMuted ? <VolumeX size={12} className="text-white" /> : <Volume2 size={12} className="text-white" />}
                      </button>
                      <button className="w-7 h-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center hover:bg-black/50 transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (montageAutoPlay) {
                            setMontageAutoPlay(false);
                            document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice, #preview-audio-rendered').forEach(a => { a.pause(); });
                          } else {
                            // Restart montage from beginning with music
                            setInfoSeqIndex(0);
                            setMontageAutoPlay(true);
                            document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice, #preview-audio-rendered').forEach(a => { a.currentTime = 0; a.play().catch(() => {}); });
                          }
                        }}
                      >
                        {montageAutoPlay ? <span className="text-white text-[10px] font-bold">❚❚</span> : <Play size={12} className="text-white ml-0.5" fill="white" />}
                      </button>
                    </div>

                    {/* Continuous progress bar — CSS animation only, no React re-renders */}
                    {(() => {
                      const startPct = (safeIdx / activeSeqs.length) * 100;
                      const endPct = ((safeIdx + 1) / activeSeqs.length) * 100;
                      const dur = seqDurationRef.current;
                      return (
                        <div className="absolute bottom-0 left-0 right-0 z-40 h-[3px] bg-black/20">
                          <div
                            key={`progress-${infoSeqIndex}`}
                            className="h-full rounded-r-full"
                            style={{
                              background: `linear-gradient(90deg, ${accent}, #FF2DAA, #00D4FF)`,
                              animation: `seqProgress ${dur}ms linear forwards`,
                            }}
                          />
                          <style>{`@keyframes seqProgress { from { width: ${startPct}%; } to { width: ${endPct}%; } }`}</style>
                        </div>
                      );
                    })()}
                  </div>
                );
              })() : (
              /* Non-infographic preview (Creator, regular posts) */
              <div
                className={`relative overflow-hidden rounded-xl ${
                  fullPreviewPost.format === 'reel' ? 'aspect-[9/16] h-[75vh] max-h-[75vh]' : 'aspect-video w-full'
                }`}
                style={{
                  border: borderCol ? `3px solid ${borderCol}` : undefined,
                  boxShadow: borderCol
                    ? `0 0 30px ${borderCol}40, 0 0 60px ${borderCol}15`
                    : `0 0 30px ${accent}4D, 0 0 60px ${accent}1A`,
                }}
              >
                {/* Background layer */}
                {(() => {
                  const hasVideo = fullPreviewPost.media_type === 'video' && fullPreviewPost.media_url;
                  const videoSrc = hasVideo ? fullPreviewPost.media_url : (meta?.videoUrl || null);
                  const posterImgSrc = meta?.pexelsUrl || meta?.posterUrl || meta?.characterUrl || null;
                  const imgSrc = hasVideo ? posterImgSrc : (fullPreviewPost.media_url || posterImgSrc);

                  return (
                    <>
                      {posterImgSrc && videoSrc && (
                        <img src={posterImgSrc} alt="Poster" className="absolute inset-0 w-full h-full object-cover" />
                      )}
                      {videoSrc ? (
                        <video id="preview-video" src={videoSrc} muted loop playsInline autoPlay preload="auto" className="absolute inset-0 w-full h-full object-cover"
                          onLoadedData={(e) => { const v = e.target as HTMLVideoElement; console.log('[Calendar] BG video loaded, readyState:', v.readyState); v.play().catch(() => {}); }}
                        />
                      ) : imgSrc ? (
                        <img src={imgSrc} alt={fullPreviewPost.title} className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-black to-pink-900" />
                      )}
                    </>
                  );
                })()}

                <div className="absolute inset-0" style={{ background: `linear-gradient(to top, ${accent}BF 0%, rgba(0,0,0,0.35) 40%, transparent 65%)` }} />
                <div className="absolute inset-0 rounded-xl pointer-events-none" style={{ boxShadow: `inset 0 0 40px ${accent}26, inset 0 0 80px ${accent}0D` }} />

                {(fullPreviewPost.media_type === 'video' || meta?.videoUrl) && (
                  <button className="absolute inset-0 z-20 flex items-center justify-center group" id="play-btn-overlay"
                    onClick={(e) => {
                      e.stopPropagation();
                      const vid = document.getElementById('preview-video') as HTMLVideoElement;
                      if (vid) {
                        const btn = document.getElementById('play-btn-overlay');
                        if (vid.paused) {
                          vid.muted = false; vid.play(); if (btn) btn.style.opacity = '0';
                          // Also play audio tracks (include rendered video fallback)
                          document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice, #preview-audio-rendered').forEach(a => {
                            a.muted = false;
                            // Lazy-load: trigger load if preload="none" and not yet loaded
                            if (a.readyState === 0 && a.getAttribute('preload') === 'none') a.load();
                            a.play().catch(() => {});
                          });
                          setMontageMuted(false);
                        } else {
                          vid.pause(); if (btn) btn.style.opacity = '1';
                          document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice, #preview-audio-rendered').forEach(a => { a.pause(); });
                        }
                      }
                    }}
                  >
                    <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/30 transition-all group-hover:scale-110">
                      <Play size={28} className="text-white ml-1" fill="white" />
                    </div>
                  </button>
                )}

                <div className="absolute inset-0 z-10 flex flex-col justify-between p-4 pointer-events-none">
                  <div className="flex justify-between items-start">
                    {(meta?.objective || meta?.theme) && (
                      <span className="text-[10px] font-bold text-white px-2 py-1 rounded" style={{ background: `linear-gradient(135deg, ${accent}, #FF2DAA)` }}>
                        {meta?.objective || meta?.theme}
                      </span>
                    )}
                    <span className="bg-black/50 text-[10px] font-bold text-white px-2 py-1 rounded backdrop-blur-sm">
                      {fullPreviewPost.format === 'reel' ? '9:16' : '16:9'}
                    </span>
                  </div>

                  <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <h3 className="text-2xl font-black text-white uppercase tracking-wider leading-tight" style={{
                      textShadow: `0 0 15px ${accent}CC, 0 0 40px ${accent}66, 0 3px 6px rgba(0,0,0,0.9)`
                    }}>
                      {displayTitle || 'TITRE'}
                    </h3>
                    {(meta?.subtitle || fullPreviewPost.caption) && (
                      <p className="text-sm text-white/90 mt-2 max-w-[80%]" style={{
                        textShadow: `0 0 10px ${accent}99, 0 2px 4px rgba(0,0,0,0.8)`
                      }}>
                        {meta?.subtitle || fullPreviewPost.caption?.split('\n')[0]}
                      </p>
                    )}

                    {isCreator && meta?.textCards && meta.textCards.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                        {meta.textCards.map((card: { text: string }, i: number) => (
                          <span key={i} className="text-xs font-bold text-white px-2 py-1 rounded" style={{
                            background: `${accent}80`, textShadow: '0 0 8px rgba(255,255,255,0.8)', backdropFilter: 'blur(4px)',
                          }}>
                            {card.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    {(brd?.ctaText || branding.ctaText) && (
                      <div className="mx-auto max-w-[80%] py-2 px-4 rounded-lg text-center" style={{ background: `${accent}CC` }}>
                        <p className="text-[10px] font-bold text-white uppercase tracking-wider">{brd?.ctaText || branding.ctaText}</p>
                        {(brd?.ctaSubText || branding.ctaSubText) && (
                          <p className="text-[7px] text-white/70 uppercase tracking-wider mt-0.5">{brd?.ctaSubText || branding.ctaSubText}</p>
                        )}
                      </div>
                    )}
                    {meta?.salesPhrase && (
                      <p className="text-xs text-white/90 text-center font-semibold italic" style={{ textShadow: `0 0 8px ${accent}99` }}>{meta.salesPhrase}</p>
                    )}
                    {hasMetadata && (
                      <div className="flex items-center justify-center gap-2">
                        {meta?.musicUrl && (
                          <span className="text-[9px] text-white px-2 py-1 rounded-full flex items-center gap-1" style={{ background: `linear-gradient(135deg, #7C3AED, ${accent})` }}>
                            <Music size={8} /> {t('fullPreview.music')}
                          </span>
                        )}
                        {meta?.voiceMode && meta.voiceMode !== 'none' && (
                          <span className="text-[9px] text-white px-2 py-1 rounded-full flex items-center gap-1" style={{ background: 'linear-gradient(135deg, #059669, #10B981)' }}>
                            <Mic size={8} /> {t('fullPreview.voiceOffLabel')}
                          </span>
                        )}
                      </div>
                    )}
                    {wm && <p className="text-[8px] text-white/30 text-center font-medium tracking-[0.2em]">{wm}</p>}
                    <div className="w-full h-1 rounded-full overflow-hidden bg-white/10">
                      <div className="h-full rounded-full" style={{ width: '100%', background: `linear-gradient(90deg, ${accent}, #FF2DAA, #00D4FF)` }} />
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>

            {/* Right: Post Details */}
            <div className="w-80 p-6 flex flex-col border-l border-gray-800">
              <h3 className="text-xl font-bold text-white mb-1">{fullPreviewPost.title}</h3>
              {meta?.subtitle && <p className="text-sm text-purple-300 mb-2">{meta.subtitle}</p>}
              <p className="text-sm text-gray-300 mb-4 whitespace-pre-line flex-1 overflow-y-auto max-h-32">{fullPreviewPost.caption || t('previewModal.noCaption')}</p>

              <div className="space-y-2.5 mb-6">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Calendar className="w-3 h-3" />
                  {fullPreviewPost.scheduled_date} {t('previewModal.at')} {fullPreviewPost.scheduled_time}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <FileVideo className="w-3 h-3" />
                  {tc(`formats.${fullPreviewPost.format}`)} • {fullPreviewPost.media_type}
                </div>
                {hasMetadata && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Sparkles className="w-3 h-3 text-purple-400" />
                    {isCreator ? t('fullPreview.videoCreator') : isInfographic ? t('fullPreview.infographic') : t('fullPreview.postLabel')}
                    {meta?.objective && <span className="text-purple-300">• {meta.objective}</span>}
                    {meta?.theme && <span className="text-purple-300">• {meta.theme}</span>}
                  </div>
                )}
                {meta?.musicUrl && (
                  <div className="flex items-center gap-2 text-xs text-green-400">
                    <Volume2 className="w-3 h-3" /> {t('fullPreview.musicIncluded')}
                  </div>
                )}
                {meta?.voiceMode && meta.voiceMode !== 'none' && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400">
                    <Mic className="w-3 h-3" /> {t('fullPreview.voiceOver')} ({meta.voiceMode === 'edge' ? 'Edge TTS' : 'Upload'})
                  </div>
                )}
                {meta?.logoUrl && (
                  <div className="flex items-center gap-2 text-xs text-blue-400">
                    <ImageIcon className="w-3 h-3" /> {t('fullPreview.logoIncluded')}
                  </div>
                )}
                {hasMontage && (
                  <div className="flex items-center gap-2 text-xs text-purple-400">
                    <Film className="w-3 h-3" /> {t('fullPreview.sequences', { count: String((meta?.sequences?.order || ['intro', 'cards', 'cta']).length) })} • {meta?.sequences?.total || 30}s
                  </div>
                )}
                {meta?.videoUrl && !hasMontage && (
                  <div className="flex items-center gap-2 text-xs text-blue-400">
                    <Film className="w-3 h-3" /> {t('fullPreview.videoIncluded')}
                  </div>
                )}
                {meta?.rushUrls && meta.rushUrls.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <FileVideo className="w-3 h-3" /> {t('fullPreview.rushes', { count: String(meta.rushUrls.length) })}
                  </div>
                )}
                {fullPreviewPost.platforms.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {fullPreviewPost.platforms.map((p) => (
                      <Badge key={p} className={`${platformColors[p]} text-white text-xs`}>{p}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-white text-xs ${
                      fullPreviewPost.status === 'published' ? 'bg-green-600' : fullPreviewPost.status === 'scheduled' ? 'bg-blue-600' : fullPreviewPost.status === 'failed' ? 'bg-red-600' : fullPreviewPost.status === 'publishing' ? 'bg-yellow-600' : 'bg-gray-600'
                    }`}>
                      {t(`status.${fullPreviewPost.status}`)}
                    </Badge>
                  </div>
                  {fullPreviewPost.status === 'failed' && (fullPreviewPost.metadata?.error || fullPreviewPost.metadata?.cron_publish_results) && (
                    <p className="text-xs text-red-400">
                      {fullPreviewPost.metadata?.error || fullPreviewPost.metadata?.cron_publish_results?.filter((r: any) => !r.success).map((r: any) => `${r.platform}: ${r.error}`).join(', ')}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2 mt-auto">
                <button
                  onClick={() => handleEditPost(fullPreviewPost)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm font-medium transition"
                >
                  <Edit2 size={14} /> {t('fullPreview.edit')}
                </button>
                {(fullPreviewPost.media_url || meta?.characterUrl) && (
                  <button
                    onClick={() => handleExportPost(fullPreviewPost)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm font-medium transition"
                  >
                    <Download size={14} /> {t('actions.exportDesktop')}
                  </button>
                )}
                {!meta?.hasAudio && fullPreviewPost.media_type === 'video' && (
                  <button
                    onClick={() => { window.location.href = `/dashboard/audio-studio?postId=${fullPreviewPost.id}`; }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 border border-purple-500 rounded-lg text-sm font-medium text-white transition"
                  >
                    <Volume2 size={14} /> {t('actions.addAudio')}
                  </button>
                )}
                {fullPreviewPost.status !== 'scheduled' && (
                  <button
                    onClick={() => {
                      if (!fullPreviewPost.platforms || fullPreviewPost.platforms.length === 0) {
                        // No platforms selected — open edit modal so user can pick them
                        setShowFullPreview(false);
                        handleEditPost(fullPreviewPost);
                        alert(t('validation.noPlatforms') || 'Veuillez sélectionner au moins un réseau social avant de planifier.');
                        return;
                      }
                      handleSchedulePost(fullPreviewPost).then(() => { setShowFullPreview(false); });
                    }}
                    disabled={saving}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-bold text-white transition"
                  >
                    <Send size={14} /> {t('fullPreview.schedule')}
                  </button>
                )}
                <button
                  onClick={() => handlePublishPost(fullPreviewPost)}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 disabled:opacity-50 rounded-lg text-sm font-bold text-white transition"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {t('fullPreview.publishNow')}
                </button>
                <button
                  onClick={() => setShowFullPreview(false)}
                  className="w-full text-center text-xs text-gray-500 hover:text-white transition py-1"
                >
                  {t('fullPreview.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
