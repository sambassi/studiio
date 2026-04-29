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
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useBranding } from '@/lib/hooks/useBranding';
import { composeAndUpload, CURRENT_COMPOSER_VERSION } from '@/lib/video-composer';
import { useTranslations, useLocale } from '@/i18n/client';
import { AgentIAModal } from '@/components/creer/AgentIAModal';
import { CardIcon } from '@/components/ui/CardIcon';
import { useAgentIAEnabled } from '@/lib/hooks/useAgentIAEnabled';

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
  /** JPEG thumbnail captured by the composer at export time (~100-200 KB). Used as the sidebar miniature. */
  thumbnailUrl?: string;
  /** Composer version that produced `renderedVideoUrl`. Used to detect stale
   *  videos that need regeneration after a composer bug fix. */
  composerVersion?: string;
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
  design?: {
    font?: string;
    filter?: string;
    cardStyle?: string;
    textScale?: number;
    ctaTextScale?: number;
    titleColor?: string;
    ctaColor?: string;
    ctaSubColor?: string;
    ctaMainText?: string;
    ctaSubText?: string;
    noColorBg?: boolean;
    noColorSequences?: boolean;
    gradientColor1?: string;
    gradientColor2?: string;
    gradientOpacity?: number;
    positions?: {
      title?: { x: number; y: number };
      logo?: { x: number; y: number };
      watermark?: { x: number; y: number };
      cards?: { x: number; y: number };
      overlay?: { x: number; y: number };
    };
    sizes?: {
      title?: number;
      cards?: number;
      watermark?: number;
    };
    logoScale?: number;
    logoSequences?: string[];
    logoUrl?: string;
    typography?: {
      title?: { letterSpacing?: number; lineHeight?: number; bold?: boolean; italic?: boolean };
      cta?: { letterSpacing?: number; lineHeight?: number; bold?: boolean; italic?: boolean };
      overlay?: { letterSpacing?: number; lineHeight?: number; bold?: boolean; italic?: boolean };
    };
    cardCustomIcons?: Record<string, string>;
    overlayColor?: string;
  };
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

/**
 * Sidebar thumbnail with an on-demand frame-extraction fallback.
 *
 * Priority chain:
 *   1. `thumbnailUrl` (JPEG captured by the composer at export time, ~100 KB)
 *   2. `posterUrl / pexelsUrl / characterUrl` (static images)
 *   3. Frame extracted CLIENT-SIDE from the composed video at t=0.5s (~100 ms)
 *   4. `<video>` fallback (30 MB download, slow on mobile)
 *   5. Title text on black (last resort)
 *
 * Step 3 kicks in for older posts that predate the thumbnailUrl feature but
 * still have a `renderedVideoUrl`. It avoids the "sans photo" state while
 * we progressively regenerate old posts via the "Régénérer" button.
 */
function PostThumbnail({
  thumbnailUrl,
  posterUrl,
  videoUrl,
  title,
  format,
  className,
}: {
  thumbnailUrl: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  title: string;
  /** 'tv' → 16:9, 'reel' (default) → 9:16. Controls the miniature's aspect ratio. */
  format?: string | null;
  className?: string;
}) {
  const [extractedThumb, setExtractedThumb] = useState<string | null>(null);
  const staticImg = thumbnailUrl || posterUrl;

  useEffect(() => {
    // Only extract a frame when we have NO static image and we DO have a video.
    // CORS-safe: we crossOrigin='anonymous' and gracefully degrade on SecurityError.
    if (staticImg || !videoUrl || extractedThumb) return;
    let cancelled = false;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'metadata';
    v.src = videoUrl;
    v.onloadedmetadata = () => {
      try { v.currentTime = 0.5; } catch { /* ignore */ }
    };
    v.onseeked = () => {
      if (cancelled) return;
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 320;
        c.height = v.videoHeight || 568;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL('image/jpeg', 0.8);
        setExtractedThumb(dataUrl);
      } catch {
        // Tainted canvas (CORS) or decode error — fall back to <video> in the render.
      }
    };
    v.onerror = () => { /* ignore, fall back to <video> */ };
    return () => { cancelled = true; v.src = ''; };
  }, [videoUrl, staticImg, extractedThumb]);

  const displayImg = staticImg || extractedThumb;

  if (!displayImg && !videoUrl && !title) return null;

  // Match the post's format: 16:9 landscape for 'tv', 9:16 portrait otherwise.
  const isTv = format === 'tv';
  const defaultCls = isTv
    ? 'w-48 sm:w-64 aspect-[16/9] rounded-xl overflow-hidden border border-gray-700 bg-black relative'
    : 'w-28 sm:w-36 aspect-[9/16] rounded-xl overflow-hidden border border-gray-700 bg-black relative';

  return (
    <div className={className || defaultCls}>
      {displayImg ? (
        // `key` forces remount when the URL changes (e.g. after a regenerate),
        // so the new thumbnail actually displays instead of a stale cached <img>.
        <img key={displayImg} src={displayImg} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : videoUrl ? (
        <video
          key={videoUrl}
          src={videoUrl}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.target as HTMLVideoElement;
            try { v.currentTime = 0.5; } catch { /* ignore */ }
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white/50 text-xs">{title || 'TITRE'}</span>
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const locale = useLocale();
  const localeMap: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', de: 'de-DE' };
  const intlLocale = localeMap[locale] || 'fr-FR';
  const { branding } = useBranding();
  const agentIAEnabled = useAgentIAEnabled();
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
  // Cross-date bulk selection mode (select posts across multiple days from the calendar grid)
  const [crossDateBulk, setCrossDateBulk] = useState(false);
  const [selectedBulkDays, setSelectedBulkDays] = useState<Set<number>>(new Set());
  const [bulkScheduleTime, setBulkScheduleTime] = useState('12:00');

  // Edit modal state
  const [editTab, setEditTab] = useState<'draft' | 'scheduled' | 'published'>('draft');
  const [editFormData, setEditFormData] = useState<Partial<Post>>({
    platforms: [],
    status: 'draft',
  });

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

  // Import-file state (shown while a user uploads a local video/image via "Importer")
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStage, setImportStage] = useState('');

  // Regenerate-montage state (for posts missing renderedVideoUrl or thumbnailUrl)
  const [regenerating, setRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState(0);
  const [regenStage, setRegenStage] = useState('');
  const montageTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [montageProgress, setMontageProgress] = useState(0); // only used for non-CSS fallback
  const montageProgressRef = useRef<NodeJS.Timeout | null>(null);
  const seqDurationRef = useRef<number>(5000); // current sequence duration in ms for CSS animation

  // Export rendering state (for on-the-fly montage composition)
  const [exportRendering, setExportRendering] = useState(false);
  const [exportRenderProgress, setExportRenderProgress] = useState(0);
  const [exportRenderStage, setExportRenderStage] = useState('');

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

  /**
   * Regenerate the montage video + thumbnail for an existing post.
   *
   * Targets posts that predate the thumbnailUrl feature (or never passed
   * through the composer at all). Re-runs composeAndUpload with the stored
   * metadata so the new video matches the current editor→composer parity,
   * then PATCHes the post with the fresh `renderedVideoUrl` + `thumbnailUrl`
   * and reloads the month.
   */
  const regenerateMontage = useCallback(async (post: Post) => {
    if (regenerating) return;
    const meta: any = post.metadata || {};
    const brand = meta.branding;
    const designMeta: any = meta.design || {};
    const isReel = post.format === 'reel';
    const hasRush = !!meta.rushUrls?.[0];

    // Sanity-clamp durations: a stored `sequences.video = 1` (or any sub-2s value)
    // is almost certainly corrupted metadata from an old export and would produce
    // the "1 second flash" bug. Fall back to the editor defaults.
    const safeDuration = (val: unknown, fallback: number, min = 2) =>
      (typeof val === 'number' && val >= min) ? val : fallback;

    console.log('[Regenerate] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[Regenerate] Starting montage regeneration for post:', post.id);
    console.log('[Regenerate] Input metadata:', {
      title: post.title,
      format: post.format,
      hasRush,
      sequencesStored: meta.sequences,
      cardsCount: meta.cards?.length,
      cardStyle: designMeta.cardStyle,
      designKeys: Object.keys(designMeta),
      // These are what matter for visual parity — if any are undefined the
      // composer will fall back to defaults instead of the editor's values.
      positions: {
        title: designMeta.positions?.title,
        cards: designMeta.positions?.cards,
        watermark: designMeta.positions?.watermark,
        overlay: designMeta.positions?.overlay,
        logo: designMeta.positions?.logo,
      },
      sizes: {
        title: designMeta.sizes?.title,
        cards: designMeta.sizes?.cards,
        watermark: designMeta.sizes?.watermark,
      },
      typography: {
        title: designMeta.typography?.title,
        cta: designMeta.typography?.cta,
        overlay: designMeta.typography?.overlay,
      },
      seqGradients: designMeta.seqGradients,
    });

    setRegenerating(true);
    setRegenProgress(0);
    setRegenStage('Préparation...');

    try {
      const { url: renderedUrl, thumbnailUrl: freshThumb, composerVersion: freshVersion } = await composeAndUpload({
        width: isReel ? 1080 : 1920,
        height: isReel ? 1920 : 1080,
        fps: 30,
        title: post.title || 'Vidéo',
        subtitle: meta.subtitle || undefined,
        salesPhrase: meta.salesPhrase || undefined,
        cards: meta.cards?.length > 0
          ? meta.cards.map((c: any) => ({ emoji: c.emoji, label: c.label, value: c.value, description: c.description, color: c.color }))
          : (meta.textCards || []).map((tCard: any) => ({ emoji: '📝', label: tCard.text, value: tCard.text, color: tCard.color })),
        posterUrl: meta.posterUrl || meta.pexelsUrl || meta.characterUrl || null,
        videoUrl: meta.rushUrls?.[0] || null,
        logoUrl: meta.logoUrl || designMeta.logoUrl || null,
        musicUrl: meta.musicUrl || null,
        voiceUrl: meta.voiceUrl || null,
        introDuration: safeDuration(meta.sequences?.intro, 5),
        cardsDuration: (meta.cards?.length > 0 || meta.textCards?.length > 0)
          ? safeDuration(meta.sequences?.cards, 6)
          : 0,
        videoDuration: hasRush ? safeDuration(meta.sequences?.video, 12) : 0,
        ctaDuration: safeDuration(meta.sequences?.cta, 5),
        accentColor: brand?.accentColor || '#D91CD2',
        ctaText: brand?.ctaText || "CHAT POUR PLUS D'INFOS",
        ctaSubText: brand?.ctaSubText || 'LIEN EN BIO',
        watermarkText: brand?.watermarkText || undefined,
        siteText: designMeta.siteText || undefined,
        design: {
          font: designMeta.font || undefined,
          titleColor: designMeta.titleColor || undefined,
          gradientColor1: designMeta.gradientColor1 || undefined,
          gradientColor2: designMeta.gradientColor2 || undefined,
          gradientOpacity: designMeta.gradientOpacity ?? undefined,
          ctaSubColor: designMeta.ctaSubColor || brand?.ctaSubColor || undefined,
          ctaColor: designMeta.ctaColor || undefined,
          logoSequences: designMeta.logoSequences || undefined,
          logoPosition: designMeta.positions?.logo || undefined,
          logoPositions: designMeta.logoPositions || undefined,
          logoScale: designMeta.logoScale || undefined,
          overlayText: meta.videoOverlayText || undefined,
          overlayColor: designMeta.overlayColor || undefined,
          overlayTextScale: meta.overlayTextScale,
          overlayStartTime: meta.overlayStartTime,
          overlayEndTime: meta.overlayEndTime,
          // Extra overlays saved per-post so each one keeps its own
          // position/timing/style when the calendar re-composes.
          overlays: Array.isArray(meta.overlays) ? meta.overlays : undefined,
          textScale: designMeta.textScale || undefined,
          ctaTextScale: designMeta.ctaTextScale || undefined,
          cardStyle: designMeta.cardStyle || undefined,
          titlePosition: designMeta.positions?.title || undefined,
          cardsPosition: designMeta.positions?.cards || undefined,
          cardsSize: designMeta.sizes?.cards || undefined,
          ctaMainText: designMeta.ctaMainText || undefined,
          ctaSubTextDesign: designMeta.ctaSubText || undefined,
          titleTypography: designMeta.typography?.title || undefined,
          watermarkPosition: designMeta.positions?.watermark || undefined,
          watermarkSize: designMeta.sizes?.watermark || undefined,
          overlayPosition: meta.overlayPosition || designMeta.positions?.overlay || undefined,
          titleSize: designMeta.sizes?.title || undefined,
          ctaTypography: designMeta.typography?.cta || undefined,
          overlayTypography: designMeta.typography?.overlay || undefined,
          seqGradients: designMeta.seqGradients || undefined,
          noColorBg: designMeta.noColorBg || undefined,
          noColorSequences: designMeta.noColorSequences || undefined,
          filter: designMeta.filter || undefined,
          cardsTypography: ((designMeta as any).typography?.cards) || ((designMeta as any).cardsTypography) || undefined,
          extraTitle: (designMeta as any).extraTitle || undefined,
          extraSubtitle: (designMeta as any).extraSubtitle || undefined,
          extraTitlePosition: (designMeta as any).extraTitlePosition || undefined,
          extraSubtitlePosition: (designMeta as any).extraSubtitlePosition || undefined,
          extraTitleTypography: (designMeta as any).extraTitleTypography || undefined,
          extraSubtitleTypography: (designMeta as any).extraSubtitleTypography || undefined,
        },
        onProgress: (pct, stage) => { setRegenProgress(pct); setRegenStage(stage); },
      });

      if (!renderedUrl) {
        throw new Error('Le montage a été rendu mais l\'upload a échoué.');
      }

      console.log('[Regenerate] ✅ Composed:', { renderedUrl, thumbnailUrl: freshThumb });
      setRegenStage('Sauvegarde...');

      // Persist fresh URLs + composer version into metadata so future loads
      // know this post was produced by the current code and hide the button.
      const nextMetadata = {
        ...meta,
        renderedVideoUrl: renderedUrl,
        videoUrl: renderedUrl,
        thumbnailUrl: freshThumb || meta.thumbnailUrl,
        composerVersion: freshVersion,
      };
      const patchRes = await fetch(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_url: renderedUrl, media_type: 'video', metadata: nextMetadata }),
      });
      const patchData = await patchRes.json();
      if (!patchData?.success) {
        console.error('[Regenerate] ❌ PATCH failed:', patchData);
        throw new Error(`Sauvegarde en base échouée : ${patchData?.error || 'erreur inconnue'}`);
      }
      console.log('[Regenerate] ✅ Persisted to DB for post', post.id);

      // Reflect locally so the modal updates immediately
      const updatedPost: Post = { ...post, media_url: renderedUrl, media_type: 'video', metadata: nextMetadata };
      setFullPreviewPost(updatedPost);
      setPosts(prev => prev.map(p => p.id === post.id ? updatedPost : p));
      setRegenProgress(100);
      setRegenStage('Terminé !');
    } catch (err) {
      console.error('[Regenerate] ❌ Failed:', err);
      alert(`Erreur de régénération : ${err instanceof Error ? err.message : 'inconnue'}`);
    } finally {
      // Small delay so user sees "Terminé !" before the button reverts
      setTimeout(() => {
        setRegenerating(false);
        setRegenProgress(0);
        setRegenStage('');
      }, 800);
    }
  }, [regenerating]);

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
  const handleDayClick = (day: number) => {
    setSelectedDay(selectedDay === day ? null : day);
    // Clear any stale fullPreviewPost from a previously-opened preview.
    // Otherwise the sidebar miniature keeps showing the poster of the post
    // that was previewed on some earlier day instead of today's first post.
    setFullPreviewPost(null);
  };

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
      // Also close the full-preview modal; otherwise the edit modal opens
      // behind it and looks like the button did nothing. (Clicking empty
      // space next to the button closed full-preview via the backdrop,
      // revealing the already-open edit modal — the "redirect" symptom.)
      setShowFullPreview(false);
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

  // Bulk delete — with explicit confirmation + diagnostic logs so the UX
  // failure is visible if anything blocks (network error, auth, etc.).
  const handleBulkDelete = async () => {
    console.log('[Calendar] handleBulkDelete called, selected:', selectedPostIds.size);
    if (selectedPostIds.size === 0) return;
    const ids = Array.from(selectedPostIds);
    if (!confirm(`Supprimer ${ids.length} post${ids.length > 1 ? 's' : ''} ? Cette action est irréversible.`)) {
      console.log('[Calendar] handleBulkDelete cancelled by user');
      return;
    }
    setSaving(true);
    try {
      let okCount = 0;
      let failCount = 0;
      for (const id of ids) {
        try {
          const r = await fetch(`/api/posts?id=${id}`, { method: 'DELETE' });
          const d = await r.json().catch(() => null);
          if (r.ok && d?.success !== false) okCount++; else { failCount++; console.error('[Calendar] delete failed for', id, r.status, d); }
        } catch (err) {
          failCount++;
          console.error('[Calendar] delete network error for', id, err);
        }
      }
      console.log(`[Calendar] Bulk delete done: ${okCount} ok, ${failCount} failed`);
      setPosts((prev) => prev.filter((p) => !selectedPostIds.has(p.id)));
      setSelectedPostIds(new Set());
      setBulkMode(false);
      if (failCount > 0) alert(`${failCount} post${failCount > 1 ? 's' : ''} n'ont pas pu être supprimés.`);
    } catch (error) {
      console.error('Bulk delete error:', error);
      alert(`Erreur de suppression : ${error instanceof Error ? error.message : 'inconnue'}`);
    }
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

  // Cross-date bulk: toggle all posts for a day
  const toggleDaySelection = (day: number) => {
    const dayPosts = getPostsForDay(day);
    if (dayPosts.length === 0) return;
    setSelectedBulkDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      const allSelected = dayPosts.every(p => prev.has(p.id));
      if (allSelected) {
        dayPosts.forEach(p => next.delete(p.id));
      } else {
        dayPosts.forEach(p => next.add(p.id));
      }
      return next;
    });
  };

  // Cross-date bulk delete
  const handleCrossDateBulkDelete = async () => {
    if (selectedPostIds.size === 0) return;
    if (!confirm(`Supprimer ${selectedPostIds.size} post(s) ?`)) return;
    setSaving(true);
    try {
      const ids = Array.from(selectedPostIds);
      for (const id of ids) {
        await fetch(`/api/posts?id=${id}`, { method: 'DELETE' });
      }
      setPosts((prev) => prev.filter((p) => !selectedPostIds.has(p.id)));
      setSelectedPostIds(new Set());
      setSelectedBulkDays(new Set());
      setCrossDateBulk(false);
    } catch (error) { console.error('Cross-date bulk delete error:', error); }
    finally { setSaving(false); }
  };

  // Cross-date bulk schedule — set selected posts to 'scheduled' at the chosen time
  const handleCrossDateBulkSchedule = async () => {
    if (selectedPostIds.size === 0) return;
    // Validate: check each selected post has platforms and media
    const selectedPosts = Array.from(selectedPostIds).map(id => posts.find(p => p.id === id)).filter(Boolean) as Post[];
    const noPlatform = selectedPosts.filter(p => !p.platforms || p.platforms.length === 0);
    const noMedia = selectedPosts.filter(p => !p.media_url && !p.metadata?.renderedVideoUrl && !p.metadata?.posterUrl);
    const warnings: string[] = [];
    if (noPlatform.length > 0) warnings.push(`${noPlatform.length} post(s) sans réseau social`);
    if (noMedia.length > 0) warnings.push(`${noMedia.length} post(s) sans média/vidéo`);
    const msg = warnings.length > 0
      ? `Planifier ${selectedPosts.length} post(s) à ${bulkScheduleTime} ?\n\n⚠️ Attention :\n${warnings.join('\n')}\nCes posts risquent d'échouer à la publication.`
      : `Planifier ${selectedPosts.length} post(s) à ${bulkScheduleTime} ?`;
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      for (const post of selectedPosts) {
        // Update time first
        await fetch(`/api/posts/${post.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduled_time: bulkScheduleTime + ':00' }),
        });
        // Use handleSchedulePost to compose the montage before scheduling
        const updatedPost = { ...post, scheduled_time: bulkScheduleTime + ':00' };
        await handleSchedulePost(updatedPost);
      }
      await fetchPosts();
      setSelectedPostIds(new Set());
      setSelectedBulkDays(new Set());
      setCrossDateBulk(false);
    } catch (error) { console.error('Cross-date bulk schedule error:', error); }
    finally { setSaving(false); }
  };

  // Retry a failed post — reset status to 'scheduled' so the cron picks it up again
  const handleRetryPost = async (post: Post) => {
    if (!confirm('Réessayer la publication de ce post ?')) return;
    // Use the full publish flow (with composition) instead of just resetting status
    // This ensures the montage is composed and uploaded before scheduling
    const cleanPost = {
      ...post,
      status: 'draft' as const,
      metadata: { ...post.metadata, error: null, cron_publish_results: null },
    };
    await handlePublishPost(cleanPost);
  };

  const handleSchedulePost = async (post: Post) => {
    // Validate: must have at least one platform selected
    if (!post.platforms || post.platforms.length === 0) {
      alert(t('validation.noPlatforms') || 'Veuillez sélectionner au moins un réseau social avant de planifier.');
      return;
    }

    const meta = post.metadata || {};

    // Only compose if no rendered video exists yet (editor already composes at export time)
    // Skip recomposition if renderedVideoUrl or media_url already has a montage URL
    const alreadyHasVideo = !!(meta.renderedVideoUrl || post.media_url);
    const isInfographic = meta.type === 'infographic' || (meta.type === 'creator' && meta.sequences);
    const hasVisualSource = meta.posterUrl || meta.rushUrls?.length > 0 || meta.characterUrl || meta.pexelsUrl || post.media_url;
    const needsComposition = !alreadyHasVideo && (isInfographic || hasVisualSource);
    if (needsComposition) {
      console.log('[Schedule] No video found, composing montage...');
      setExportRendering(true);
      setExportRenderProgress(0);
      setExportRenderStage('Rendu du montage...');

      try {
        const posterUrl = meta.posterUrl || meta.pexelsUrl || meta.characterUrl || null;
        const videoUrl = meta.rushUrls?.[0] || null;
        const musicUrl = meta.musicUrl || null;
        const voiceUrl = meta.voiceUrl || null;
        const logoUrl = meta.logoUrl || meta.design?.logoUrl || null;
        const seq = meta.sequences;
        const brand = meta.branding;
        const isReel = post.format === 'reel';

        const designMeta = meta.design || {};
        const { url: renderedUrl } = await composeAndUpload({
          width: isReel ? 1080 : 1920,
          height: isReel ? 1920 : 1080,
          fps: 30,
          title: post.title || 'Vidéo',
          subtitle: meta.subtitle || undefined,
          salesPhrase: meta.salesPhrase || undefined,
          cards: meta.cards?.length > 0
            ? meta.cards.map((c: any) => ({ emoji: c.emoji, label: c.label, value: c.value, description: c.description, color: c.color }))
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
          siteText: designMeta.siteText || undefined,
          design: {
            font: designMeta.font || undefined,
            titleColor: designMeta.titleColor || undefined,
            gradientColor1: designMeta.gradientColor1 || undefined,
            gradientColor2: designMeta.gradientColor2 || undefined,
            gradientOpacity: designMeta.gradientOpacity ?? undefined,
            ctaSubColor: designMeta.ctaSubColor || brand?.ctaSubColor || undefined,
            ctaColor: designMeta.ctaColor || undefined,
            logoSequences: designMeta.logoSequences || undefined,
            logoPosition: designMeta.positions?.logo || undefined,
            logoPositions: designMeta.logoPositions || undefined,
            logoScale: designMeta.logoScale || undefined,
            overlayText: meta.videoOverlayText || undefined,
            overlayColor: designMeta.overlayColor || undefined,
            overlayTextScale: (meta as any).overlayTextScale,
            overlayStartTime: (meta as any).overlayStartTime,
            overlayEndTime: (meta as any).overlayEndTime,
            overlays: Array.isArray((meta as any).overlays) ? (meta as any).overlays : undefined,
            textScale: designMeta.textScale || undefined,
            ctaTextScale: designMeta.ctaTextScale || undefined,
            cardStyle: designMeta.cardStyle || undefined,
            titlePosition: designMeta.positions?.title || undefined,
            cardsPosition: designMeta.positions?.cards || undefined,
            cardsSize: designMeta.sizes?.cards || undefined,
            ctaMainText: designMeta.ctaMainText || undefined,
            ctaSubTextDesign: designMeta.ctaSubText || undefined,
            titleTypography: designMeta.typography?.title || undefined,
            watermarkPosition: designMeta.positions?.watermark || undefined,
            watermarkSize: designMeta.sizes?.watermark || undefined,
            overlayPosition: (meta as any).overlayPosition || designMeta.positions?.overlay || undefined,
            titleSize: designMeta.sizes?.title || undefined,
            ctaTypography: designMeta.typography?.cta || undefined,
            overlayTypography: designMeta.typography?.overlay || undefined,
            seqGradients: (designMeta as any).seqGradients || undefined,
            noColorBg: (designMeta as any).noColorBg || undefined,
            noColorSequences: (designMeta as any).noColorSequences || undefined,
            filter: designMeta.filter || undefined,
            cardsTypography: ((designMeta as any).typography?.cards) || ((designMeta as any).cardsTypography) || undefined,
            extraTitle: (designMeta as any).extraTitle || undefined,
            extraSubtitle: (designMeta as any).extraSubtitle || undefined,
            extraTitlePosition: (designMeta as any).extraTitlePosition || undefined,
            extraSubtitlePosition: (designMeta as any).extraSubtitlePosition || undefined,
            extraTitleTypography: (designMeta as any).extraTitleTypography || undefined,
            extraSubtitleTypography: (designMeta as any).extraSubtitleTypography || undefined,
          },
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

    // Final guard: refuse to schedule if no media URL exists after composition attempt
    if (!post.media_url && !post.metadata?.renderedVideoUrl) {
      alert('Erreur : le montage vidéo n\'a pas pu être généré. Veuillez réessayer ou exporter la vidéo d\'abord.');
      console.error('[Schedule] BLOCKED: no media_url or renderedVideoUrl after compose attempt');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post, status: 'scheduled' }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchPosts();
      } else {
        alert(`Erreur lors de la programmation : ${data.error || 'réponse inattendue du serveur'}`);
      }
    } catch (error) {
      alert(`Erreur réseau : ${error instanceof Error ? error.message : 'inconnue'}`);
    }
    finally { setSaving(false); }
  };

  const handleSavePost = async () => {
    // Validate: if scheduling, must have platforms
    if (editTab === 'scheduled' && (!editFormData.platforms || editFormData.platforms.length === 0)) {
      alert(t('validation.noPlatforms') || 'Veuillez sélectionner au moins un réseau social avant de planifier.');
      return;
    }

    // If scheduling an existing infographic post, use handleSchedulePost to compose the montage first
    if (editTab === 'scheduled' && editFormData.id) {
      const meta = editFormData.metadata || {};
      const isInfographic = meta.type === 'infographic' || (meta.type === 'creator' && meta.sequences);
      if (isInfographic) {
        console.log('[SavePost→Schedule] Delegating to handleSchedulePost for montage composition');
        setShowEditModal(false); setEditFormData({});
        await handleSchedulePost(editFormData as Post);
        return;
      }
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
        if (data.success) {
          await fetchPosts();
        } else {
          alert(`Erreur lors de la programmation : ${data.error || 'réponse inattendue du serveur'}`);
        }
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
            metadata: editFormData.metadata || {},
          }),
        });
        const data = await res.json();
        if (data.success) {
          await fetchPosts();
        } else {
          alert(`Erreur lors de la programmation : ${data.error || 'réponse inattendue du serveur'}`);
        }
      }
    } catch (error) {
      alert(`Erreur réseau : ${error instanceof Error ? error.message : 'inconnue'}`);
    }
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

    // IMPORTANT: Always use the full seqOrder (including video) to avoid index shifts
    // when videoPlayable changes mid-playback. If video isn't playable, we skip it
    // instantly rather than removing it from the array.
    const seqOrder: string[] = [...new Set((meta?.sequences?.order || ['intro', 'cards', 'video']).map((s: string) => ({ titre: 'intro', cartes: 'cards', video: 'video', cta: 'cta' }[s] || s)).filter((s: string) => { const dur = meta?.sequences?.[s]; return dur === undefined || dur > 0; }))];
    const seqs = (meta?.sequences || {}) as Record<string, number>;
    const currentSeq = seqOrder[infoSeqIndex] || 'intro';

    // If current sequence is 'video' but not playable, skip it instantly
    if (currentSeq === 'video' && !videoPlayable) {
      if (infoSeqIndex < seqOrder.length - 1) {
        setInfoSeqIndex(infoSeqIndex + 1);
      } else {
        setMontageAutoPlay(false);
      }
      return;
    }

    const currentDuration = (seqs[currentSeq] || 5) * 1000; // ms

    // Store duration for CSS-driven progress bar (no setInterval, no re-renders)
    seqDurationRef.current = currentDuration;

    // Auto-advance to next sequence — stop at end (no loop), pause music
    if (montageTimerRef.current) clearTimeout(montageTimerRef.current);
    montageTimerRef.current = setTimeout(() => {
      if (infoSeqIndex < seqOrder.length - 1) {
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
    const seqOrder: string[] = [...new Set((meta?.sequences?.order || ['intro', 'cards', 'video']).map((s: string) => ({ titre: 'intro', cartes: 'cards', video: 'video', cta: 'cta' }[s] || s)).filter((s: string) => { const dur = meta?.sequences?.[s]; return dur === undefined || dur > 0; }))];
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

    let cancelled = false;

    // Charger la vidéo rush — si le fichier est gros et le serveur ne supporte pas
    // les range requests (Supabase), on télécharge le fichier complet en blob URL.
    // Cela permet la lecture même sans range requests (moov atom à la fin du MP4).
    const MAX_SIZE_DIRECT = 8 * 1024 * 1024; // 8 Mo — au-delà, utiliser blob URL

    const checkAndLoad = async () => {
      try {
        const headRes = await fetch(videoSrc, { method: 'HEAD' });
        const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
        const acceptRanges = headRes.headers.get('accept-ranges');
        const supportsRanges = acceptRanges === 'bytes';

        if (contentLength > MAX_SIZE_DIRECT && !supportsRanges) {
          // Fichier gros sans range requests → télécharger en blob URL
          console.log(`[Calendar] Rush vidéo ${(contentLength / 1024 / 1024).toFixed(1)} Mo sans range requests — téléchargement en blob URL...`);
          if (cancelled) return;
          try {
            const res = await fetch(videoSrc);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            if (cancelled) { URL.revokeObjectURL(URL.createObjectURL(blob)); return; }
            const blobUrl = URL.createObjectURL(blob);
            console.log(`[Calendar] Blob URL créée: ${(blob.size / 1024 / 1024).toFixed(1)} Mo`);
            // Mettre à jour le src de la vidéo avec le blob URL
            setTimeout(() => {
              if (cancelled) { URL.revokeObjectURL(blobUrl); return; }
              const vid = document.getElementById('preview-video-infographic') as HTMLVideoElement | null;
              if (!vid) { URL.revokeObjectURL(blobUrl); return; }
              vid.muted = true;
              vid.onloadeddata = () => {
                console.log('[Calendar] Vidéo blob chargée OK, durée:', vid.duration);
                if (!cancelled) setVideoPlayable(true);
              };
              vid.onerror = () => {
                console.error('[Calendar] Erreur chargement vidéo blob');
                URL.revokeObjectURL(blobUrl);
                if (!cancelled) setVideoPlayable(false);
              };
              vid.src = blobUrl;
              vid.load();
            }, 100);
          } catch (dlErr) {
            console.warn('[Calendar] Téléchargement vidéo échoué:', dlErr);
            if (!cancelled) setVideoPlayable(false);
          }
          return;
        }
      } catch {
        // HEAD échoué — on essaie quand même de charger la vidéo directement
      }

      if (cancelled) return;

      // Fichier petit ou serveur supporte range requests — chargement direct
      setTimeout(() => {
        if (cancelled) return;
        const vid = document.getElementById('preview-video-infographic') as HTMLVideoElement | null;
        if (!vid) return;
        vid.muted = true;

        // Timeout de sécurité — 12s pour les fichiers accessibles directement
        const loadTimeout = setTimeout(() => {
          if (vid.readyState === 0) {
            console.warn('[Calendar] Vidéo non chargée après 12s, séquence vidéo ignorée:', vid.src);
            if (!cancelled) setVideoPlayable(false);
          }
        }, 12000);

        vid.onloadeddata = () => {
          clearTimeout(loadTimeout);
          console.log('[Calendar] Vidéo chargée OK, readyState:', vid.readyState, 'durée:', vid.duration);
          if (!cancelled) setVideoPlayable(true);
        };
        vid.onloadedmetadata = () => {
          console.log('[Calendar] Métadonnées vidéo chargées, durée:', vid.duration, 'readyState:', vid.readyState);
        };
        vid.onerror = () => {
          clearTimeout(loadTimeout);
          console.error('[Calendar] Erreur de chargement vidéo, séquence vidéo ignorée');
          if (!cancelled) setVideoPlayable(false);
        };

        vid.load();
      }, 100);
    };

    checkAndLoad();

    return () => { cancelled = true; };
  }, [showFullPreview, fullPreviewPost]);

  // Précharger TOUS les éléments audio (y compris le rendu WebM) quand la preview s'ouvre
  // #preview-audio-rendered utilise maintenant preload="auto" — on le charge aussi ici
  // pour qu'il soit prêt quand l'utilisateur clique sur unmute
  useEffect(() => {
    if (!showFullPreview || !fullPreviewPost) return;
    const timer = setTimeout(() => {
      // Charger musique et voix séparées
      document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice').forEach(a => {
        a.muted = true;
        a.play().catch(() => {});
      });
      // Charger le rendu vidéo/audio WebM — play() muted pour forcer le chargement complet
      const rendered = document.getElementById('preview-audio-rendered') as HTMLMediaElement | null;
      if (rendered) {
        rendered.muted = true;
        // Si pas encore chargé, forcer le chargement
        if (rendered.readyState === 0) {
          rendered.load();
        }
        rendered.play().catch(() => {});
      }
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

    const seqOrder: string[] = [...new Set((meta?.sequences?.order || ['intro', 'cards', 'video']).map((s: string) => ({ titre: 'intro', cartes: 'cards', video: 'video', cta: 'cta' }[s] || s)).filter((s: string) => { const dur = meta?.sequences?.[s]; return dur === undefined || dur > 0; }))];
    const currentSeq = seqOrder[infoSeqIndex] || 'intro';

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
            return next < seqOrder.length ? next : 0;
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
      let updatedPost = { ...post };
      const meta = post.metadata || {};

      // Only compose if no rendered video exists yet (editor already composes at export time)
      const alreadyHasVideo = !!(meta.renderedVideoUrl || updatedPost.media_url);
      const isMontagePost = meta.type === 'infographic' || (meta.type === 'creator' && meta.sequences);
      if (isMontagePost && !alreadyHasVideo) {
        console.log('[Publish] No video found, composing montage...');
        setExportRendering(true);
        setExportRenderProgress(0);
        setExportRenderStage('Rendu du montage...');

        try {
          const posterUrl = meta.posterUrl || meta.pexelsUrl || meta.characterUrl || null;
          const videoUrl = meta.rushUrls?.[0] || null;
          const musicUrl = meta.musicUrl || null;
          const voiceUrl = meta.voiceUrl || null;
          const logoUrl = meta.logoUrl || meta.design?.logoUrl || null;
          const seq = meta.sequences;
          const brand = meta.branding;
          const isReel = post.format === 'reel';
          const designMeta = meta.design || {};

          console.log('[Publish] Media URLs:', { posterUrl: posterUrl?.substring(0, 60), videoUrl: videoUrl?.substring(0, 60), logoUrl: logoUrl?.substring(0, 30), musicUrl: musicUrl?.substring(0, 60) });

          // Wrap composition in a 3-minute timeout to prevent hanging forever
          const composePromise = composeAndUpload({
            width: isReel ? 1080 : 1920,
            height: isReel ? 1920 : 1080,
            fps: 30,
            title: post.title || 'Vidéo',
            subtitle: meta.subtitle || undefined,
            salesPhrase: meta.salesPhrase || undefined,
            cards: meta.cards?.length > 0
              ? meta.cards.map((c: any) => ({ emoji: c.emoji, label: c.label, value: c.value, description: c.description, color: c.color }))
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
            siteText: designMeta.siteText || undefined,
            design: {
              font: designMeta.font || undefined,
              titleColor: designMeta.titleColor || undefined,
              gradientColor1: designMeta.gradientColor1 || undefined,
              gradientColor2: designMeta.gradientColor2 || undefined,
              gradientOpacity: designMeta.gradientOpacity ?? undefined,
              ctaSubColor: designMeta.ctaSubColor || brand?.ctaSubColor || undefined,
              ctaColor: designMeta.ctaColor || undefined,
              logoSequences: designMeta.logoSequences || undefined,
              logoPosition: designMeta.positions?.logo || undefined,
              logoPositions: designMeta.logoPositions || undefined,
              logoScale: designMeta.logoScale || undefined,
              overlayText: meta.videoOverlayText || undefined,
              overlayColor: designMeta.overlayColor || undefined,
              overlayTextScale: (meta as any).overlayTextScale,
              overlayStartTime: (meta as any).overlayStartTime,
              overlayEndTime: (meta as any).overlayEndTime,
              overlays: Array.isArray((meta as any).overlays) ? (meta as any).overlays : undefined,
              textScale: designMeta.textScale || undefined,
              ctaTextScale: designMeta.ctaTextScale || undefined,
              cardStyle: designMeta.cardStyle || undefined,
              titlePosition: designMeta.positions?.title || undefined,
              cardsPosition: designMeta.positions?.cards || undefined,
              cardsSize: designMeta.sizes?.cards || undefined,
              ctaMainText: designMeta.ctaMainText || undefined,
              ctaSubTextDesign: designMeta.ctaSubText || undefined,
              titleTypography: designMeta.typography?.title || undefined,
              watermarkPosition: designMeta.positions?.watermark || undefined,
              watermarkSize: designMeta.sizes?.watermark || undefined,
              overlayPosition: (meta as any).overlayPosition || designMeta.positions?.overlay || undefined,
              titleSize: designMeta.sizes?.title || undefined,
              ctaTypography: designMeta.typography?.cta || undefined,
              overlayTypography: designMeta.typography?.overlay || undefined,
              seqGradients: (designMeta as any).seqGradients || undefined,
              noColorBg: (designMeta as any).noColorBg || undefined,
              noColorSequences: (designMeta as any).noColorSequences || undefined,
              filter: designMeta.filter || undefined,
              cardsTypography: ((designMeta as any).typography?.cards) || ((designMeta as any).cardsTypography) || undefined,
              extraTitle: (designMeta as any).extraTitle || undefined,
              extraSubtitle: (designMeta as any).extraSubtitle || undefined,
              extraTitlePosition: (designMeta as any).extraTitlePosition || undefined,
              extraSubtitlePosition: (designMeta as any).extraSubtitlePosition || undefined,
              extraTitleTypography: (designMeta as any).extraTitleTypography || undefined,
              extraSubtitleTypography: (designMeta as any).extraSubtitleTypography || undefined,
            },
            onProgress: (pct, stage) => {
              setExportRenderProgress(pct);
              setExportRenderStage(stage);
            },
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Composition timeout after 3 minutes')), 180_000)
          );
          const { url: renderedUrl } = await Promise.race([composePromise, timeoutPromise]);
          console.log('[Publish] Composition result: url =', renderedUrl ? renderedUrl.substring(0, 60) : 'NULL');

          if (renderedUrl) {
            updatedPost = {
              ...updatedPost,
              media_url: renderedUrl,
              media_type: 'video',
              metadata: {
                ...meta,
                renderedVideoUrl: renderedUrl,
                videoUrl: renderedUrl,
              },
            };
            console.log('[Publish] Montage composed:', renderedUrl);
          }
        } catch (err: any) {
          console.error('[Publish] Compose failed:', err);
          const errMsg = err?.message || String(err);
          alert(`Erreur lors du rendu du montage:\n${errMsg}\n\nVeuillez réessayer.`);
          setSaving(false);
          return; // ABORT — don't schedule without a video
        } finally {
          setExportRendering(false);
          setExportRenderProgress(0);
          setExportRenderStage('');
        }
      }

      // Safety check: NEVER schedule a post without a media URL
      // This catches cases where composition silently failed, metadata was incomplete,
      // or hasVisualSource/isMontagePost conditions didn't match expectations
      const finalMediaUrl = updatedPost.metadata?.renderedVideoUrl || updatedPost.media_url;
      if (!finalMediaUrl) {
        console.error('[Publish] No media URL after composition — aborting. hasVisualSource:', hasVisualSource, 'isMontagePost:', isMontagePost, 'renderedVideoUrl:', updatedPost.metadata?.renderedVideoUrl, 'media_url:', updatedPost.media_url);
        alert('Le montage n\'a pas pu être généré — aucune URL vidéo disponible.\n\nVérifiez que les médias (image, vidéo) sont accessibles et réessayez.\nSi le problème persiste, essayez de ré-exporter depuis l\'éditeur.');
        setSaving(false);
        return;
      }

      // Set status to 'scheduled' with current date/time so the cron publishes it
      // within the next minute. We can't call the cron directly from the client.
      const now = new Date();
      const scheduledDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const scheduledTime = now.toTimeString().substring(0, 5); // HH:MM
      await fetch('/api/posts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...updatedPost,
          status: 'scheduled',
          scheduled_date: scheduledDate,
          scheduled_time: scheduledTime,
        }),
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

  // Extract the first visible frame of a remote video as a data-URL thumbnail
  // (~320px wide, JPEG quality 0.7). Tries t=0.5s like PostThumbnail's live
  // extraction, with a 5s timeout + graceful fallback to the video URL itself
  // (Chrome renders the video's first frame as a poster when loaded into <img>).
  const extractVideoThumbnail = (url: string): Promise<string> =>
    new Promise((resolve) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      let done = false;
      const finish = (result: string) => {
        if (done) return;
        done = true;
        video.src = '';
        resolve(result);
      };
      const timer = setTimeout(() => finish(url), 5000);
      video.onloadedmetadata = () => {
        try { video.currentTime = 0.5; } catch { /* ignore */ }
      };
      video.onseeked = () => {
        try {
          const maxW = 640;
          const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
          const c = document.createElement('canvas');
          c.width = Math.round(video.videoWidth * scale) || 320;
          c.height = Math.round(video.videoHeight * scale) || 568;
          const ctx = c.getContext('2d');
          if (!ctx) { clearTimeout(timer); finish(url); return; }
          ctx.drawImage(video, 0, 0, c.width, c.height);
          const data = c.toDataURL('image/jpeg', 0.7);
          clearTimeout(timer);
          finish(data);
        } catch {
          // SecurityError (tainted canvas) or draw failure — fall back to the URL
          clearTimeout(timer);
          finish(url);
        }
      };
      video.onerror = () => { clearTimeout(timer); finish(url); };
      video.src = url;
    });

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp,image/gif';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) {
        console.log('[Import] no file selected');
        return;
      }
      const isVideo = file.type.startsWith('video/');
      const title = file.name.replace(/\.[^/.]+$/, '');
      const useSignedUrl = file.size > 4 * 1024 * 1024;
      console.log('[Import] file selected:', { name: file.name, size: file.size, type: file.type, isVideo, useSignedUrl });

      setImporting(true);
      setImportProgress(0);
      setImportStage(`Préparation de "${file.name}"...`);

      let mediaUrl: string | null = null;
      try {
        if (useSignedUrl) {
          // Large files: PUT directly to Supabase via a signed URL (bypasses Vercel's 4.5MB limit)
          setImportStage('Obtention de l\'URL signée...');
          const signRes = await fetch('/api/upload/signed-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, contentType: file.type, purpose: isVideo ? 'rush' : 'thumbnail' }),
          });
          const signData = await signRes.json().catch(() => ({ success: false, error: 'Réponse invalide' }));
          console.log('[Import] sign response:', { httpStatus: signRes.status, success: signData?.success, error: signData?.error });
          if (!signRes.ok || !signData?.success) {
            const detail = signData?.error || `HTTP ${signRes.status}`;
            throw new Error(`Impossible d'obtenir une URL d'upload (${detail}). ${signRes.status === 401 ? 'Votre session a peut-être expiré — reconnectez-vous.' : ''}`);
          }
          setImportStage(`Envoi vers Supabase (${Math.round(file.size / 1024 / 1024)} Mo)...`);
          const putOk = await new Promise<{ ok: boolean; status: number }>((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', signData.signedUrl);
            xhr.setRequestHeader('Content-Type', file.type);
            xhr.upload.onprogress = (ev) => {
              if (ev.lengthComputable) setImportProgress(Math.round((ev.loaded / ev.total) * 100));
            };
            xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
            xhr.onerror = () => resolve({ ok: false, status: xhr.status || 0 });
            xhr.send(file);
          });
          console.log('[Import] PUT status:', putOk);
          if (!putOk.ok) {
            throw new Error(`Upload Supabase échoué (HTTP ${putOk.status}). Vérifiez votre connexion et réessayez.`);
          }
          mediaUrl = signData.publicUrl;
        } else {
          // Small files: go through the Next.js API route
          setImportStage('Envoi du fichier...');
          const formData = new FormData();
          formData.append('file', file);
          formData.append('purpose', isVideo ? 'rush' : 'thumbnail');
          const uploadRes = await fetch('/api/upload/media', { method: 'POST', body: formData });
          const uploadData = await uploadRes.json().catch(() => ({ success: false, error: 'Réponse invalide' }));
          console.log('[Import] /api/upload/media response:', { httpStatus: uploadRes.status, success: uploadData?.success, error: uploadData?.error });
          if (!uploadRes.ok || !uploadData?.success) {
            const detail = uploadData?.error || `HTTP ${uploadRes.status}`;
            throw new Error(`Upload échoué (${detail}).`);
          }
          mediaUrl = uploadData.file?.url || null;
          setImportProgress(100);
        }

        if (!mediaUrl) {
          throw new Error('Upload terminé mais aucune URL renvoyée.');
        }
        console.log('[Import] mediaUrl:', mediaUrl);

        // Derive a thumbnail so the post card isn't a black rectangle.
        // - Images: the file itself is the thumbnail.
        // - Videos: extract frame@0.5s client-side, fall back to the URL.
        setImportStage('Génération de la miniature...');
        const thumbnailUrl = isVideo ? await extractVideoThumbnail(mediaUrl) : mediaUrl;
        console.log('[Import] thumbnail ready:', thumbnailUrl.slice(0, 80), thumbnailUrl.startsWith('data:') ? '(data URL)' : '(remote URL)');

        setEditFormData({
          platforms: [], status: 'draft', format: 'reel',
          scheduled_date: selectedDay ? formatDateForStorage(currentDate, selectedDay) : formatDateForStorage(new Date(), new Date().getDate()),
          scheduled_time: '12:00', title, caption: '', media_url: mediaUrl, media_type: isVideo ? 'video' : 'image',
          metadata: {
            thumbnailUrl,
            posterUrl: isVideo ? undefined : mediaUrl,
          },
        });
        setEditTab('draft');
        setShowEditModal(true);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Import] upload failed:', msg, error);
        alert(`Upload échoué : ${msg}`);
      } finally {
        setImporting(false);
        setImportProgress(0);
        setImportStage('');
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
      setExportRenderStage('Conversion MP4 en cours (peut prendre 1-3 min)...');
      const safeName = (post.title || 'video').replace(/[^a-zA-Z0-9-_]+/g, '_');
      // Simulated progress 30→75 over ~67s while the server converts. The
      // real `/api/convert/to-mp4` doesn't stream progress, so without this
      // the bar appeared frozen at 30% for minutes — users assumed the
      // export was broken and gave up.
      let conversionProgress = 30;
      const progressInterval = setInterval(() => {
        conversionProgress = Math.min(conversionProgress + 1, 75);
        setExportRenderProgress(conversionProgress);
      }, 1500);
      // Client-side timeout — abort if the server takes too long. Vercel's
      // function maxDuration is 300s; we cut at 240s so the user gets a
      // proper "timeout, propose WebM fallback" prompt rather than a hang.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4 * 60 * 1000);
      // Helper: trigger a direct WebM download from the original Supabase URL
      // — used as the user-confirmed fallback when MP4 conversion fails or
      // times out. Direct URL avoids re-fetching a 20+ MB blob into memory.
      const downloadWebmDirect = () => {
        const a = document.createElement('a');
        a.href = meta.renderedVideoUrl as string;
        a.download = `${safeName}.webm`;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
      try {
        // Use server-side FFmpeg conversion (reliable H.264 output)
        const convertRes = await fetch('/api/convert/to-mp4', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: meta.renderedVideoUrl }),
          signal: controller.signal,
        });
        clearInterval(progressInterval);
        clearTimeout(timeoutId);
        const convertData = await convertRes.json();
        if (convertData.success && convertData.mp4Url) {
          // Direct URL download (no fetch + blob) — faster, no CORS issues,
          // no browser freeze on large files. Supabase serves the public URL
          // with `Content-Disposition: attachment` when the `download`
          // attribute is set on the anchor.
          setExportRenderProgress(100);
          setExportRenderStage('Téléchargement...');
          const a = document.createElement('a');
          a.href = convertData.mp4Url;
          a.download = `${safeName}.mp4`;
          a.target = '_blank';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setExportRenderStage('MP4 prêt !');
        } else {
          // Server conversion failed — let the user choose to download the
          // raw WebM (or just dismiss). Replaces the previous silent fallback
          // that downloaded a .webm without telling them why.
          const errMsg = convertData.error || 'erreur serveur';
          console.warn('[Export] Server conversion failed:', errMsg);
          if (confirm(`La conversion MP4 a échoué : ${errMsg}.\nTélécharger le fichier WebM brut à la place ? (lisible avec VLC ou QuickTime)`)) {
            downloadWebmDirect();
          }
        }
      } catch (err) {
        clearInterval(progressInterval);
        clearTimeout(timeoutId);
        if ((err as any)?.name === 'AbortError') {
          // 4-min client timeout — likely a very long video or server overloaded
          console.warn('[Export] Server conversion timed out after 4 min');
          if (confirm('La conversion MP4 prend trop de temps (>4 min). Télécharger le fichier WebM brut à la place ? (lisible avec VLC ou QuickTime)')) {
            downloadWebmDirect();
          }
        } else {
          const msg = (err as Error)?.message || 'erreur réseau';
          console.error('[Export] Server conversion error:', err);
          setExportRenderStage('Erreur de conversion');
          alert(`Export bureau échoué : ${msg}. Vérifiez votre connexion et réessayez.`);
        }
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
      const logoUrl = meta?.logoUrl || meta?.design?.logoUrl || null;
      const seq = meta?.sequences;
      const brand = meta?.branding;
      const isReel = post.format === 'reel';

      // Read site text config from design metadata
      const calDesign = meta?.design;
      const calSiteText = calDesign?.siteText;

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
        siteText: calSiteText || undefined,
        design: {
          font: calDesign?.font || undefined,
          titleColor: calDesign?.titleColor || undefined,
          gradientColor1: calDesign?.gradientColor1 || undefined,
          gradientColor2: calDesign?.gradientColor2 || undefined,
          gradientOpacity: calDesign?.gradientOpacity ?? undefined,
          ctaSubColor: calDesign?.ctaSubColor || brand?.ctaSubColor || undefined,
          ctaColor: calDesign?.ctaColor || undefined,
          logoSequences: calDesign?.logoSequences || undefined,
          logoPosition: calDesign?.positions?.logo || undefined,
          logoPositions: calDesign?.logoPositions || undefined,
          logoScale: calDesign?.logoScale || undefined,
          overlayText: meta?.videoOverlayText || undefined,
          overlayColor: calDesign?.overlayColor || undefined,
          overlayTextScale: (meta as any)?.overlayTextScale,
          overlayStartTime: (meta as any)?.overlayStartTime,
          overlayEndTime: (meta as any)?.overlayEndTime,
          overlays: Array.isArray((meta as any)?.overlays) ? (meta as any).overlays : undefined,
          overlayPosition: (meta as any)?.overlayPosition || calDesign?.positions?.overlay || undefined,
          textScale: calDesign?.textScale || undefined,
          ctaTextScale: calDesign?.ctaTextScale || undefined,
          cardStyle: calDesign?.cardStyle || undefined,
          titlePosition: calDesign?.positions?.title || undefined,
          cardsPosition: calDesign?.positions?.cards || undefined,
          cardsSize: calDesign?.sizes?.cards || undefined,
          ctaMainText: calDesign?.ctaMainText || undefined,
          ctaSubTextDesign: calDesign?.ctaSubText || undefined,
          titleTypography: calDesign?.typography?.title || undefined,
          cardsTypography: ((calDesign as any)?.typography?.cards) || ((calDesign as any)?.cardsTypography) || undefined,
          extraTitle: (calDesign as any)?.extraTitle || undefined,
          extraSubtitle: (calDesign as any)?.extraSubtitle || undefined,
          extraTitlePosition: (calDesign as any)?.extraTitlePosition || undefined,
          extraSubtitlePosition: (calDesign as any)?.extraSubtitlePosition || undefined,
          extraTitleTypography: (calDesign as any)?.extraTitleTypography || undefined,
          extraSubtitleTypography: (calDesign as any)?.extraSubtitleTypography || undefined,
        },
        onProgress: (pct, stage) => {
          setExportRenderProgress(pct);
          setExportRenderStage(stage);
        },
      });

      // Download the composed video — use server-side conversion for proper MP4
      if (blob && blob.size > 0) {
        const safeName = (post.title || 'montage').replace(/[^a-zA-Z0-9-_]+/g, '_');
        // Trigger a direct download of the composed blob with the right
        // extension. Used as the last-resort fallback when /api/convert/to-mp4
        // is unreachable. The previous `downloadBlob()` helper went through
        // client-side FFmpeg.wasm (CDN-loaded) which fails silently in many
        // browsers — replaced with explicit blob download to mirror the
        // /creer Bureau export fix (PR #100).
        const directDownload = (b: Blob, ext: 'mp4' | 'webm') => {
          const url = URL.createObjectURL(b);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${safeName}.${ext}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        };

        if (renderedUrl && renderedUrl.includes('webm')) {
          // Server-side conversion for reliable MP4 output. Mirrors the
          // first convert site above — simulated progress 30→75 + 4 min
          // timeout + direct URL download on success.
          setExportRenderProgress(30);
          setExportRenderStage('Conversion MP4 en cours (peut prendre 1-3 min)...');
          let conv2 = 30;
          const conv2Interval = setInterval(() => {
            conv2 = Math.min(conv2 + 1, 75);
            setExportRenderProgress(conv2);
          }, 1500);
          const conv2Controller = new AbortController();
          const conv2TimeoutId = setTimeout(() => conv2Controller.abort(), 4 * 60 * 1000);
          try {
            const convertRes = await fetch('/api/convert/to-mp4', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videoUrl: renderedUrl }),
              signal: conv2Controller.signal,
            });
            clearInterval(conv2Interval);
            clearTimeout(conv2TimeoutId);
            const convertData = await convertRes.json();
            if (convertData.success && convertData.mp4Url) {
              // Direct URL download (no fetch + blob)
              setExportRenderProgress(100);
              setExportRenderStage('Téléchargement...');
              const a = document.createElement('a');
              a.href = convertData.mp4Url;
              a.download = `${safeName}.mp4`;
              a.target = '_blank';
              a.rel = 'noopener';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            } else {
              const errMsg = convertData.error || 'erreur serveur';
              console.warn('[Export] Server conversion failed:', errMsg);
              if (confirm(`La conversion MP4 a échoué : ${errMsg}.\nTélécharger le fichier brut à la place ? (lisible avec VLC ou QuickTime)`)) {
                const isWebm = blob.type.includes('webm');
                directDownload(blob, isWebm ? 'webm' : 'mp4');
              }
            }
          } catch (convErr) {
            clearInterval(conv2Interval);
            clearTimeout(conv2TimeoutId);
            if ((convErr as any)?.name === 'AbortError') {
              console.warn('[Export] Server conversion timed out after 4 min');
              if (confirm('La conversion MP4 prend trop de temps (>4 min). Télécharger le fichier brut à la place ? (lisible avec VLC ou QuickTime)')) {
                const isWebm = blob.type.includes('webm');
                directDownload(blob, isWebm ? 'webm' : 'mp4');
              }
            } else {
              console.error('[Export] Server conversion error:', convErr);
              const isWebm = blob.type.includes('webm');
              directDownload(blob, isWebm ? 'webm' : 'mp4');
              alert(`Conversion MP4 indisponible (${(convErr as Error)?.message || 'erreur réseau'}). Le fichier a été téléchargé tel quel — ouvrez-le avec VLC ou QuickTime.`);
            }
          }
        } else {
          // No server-convertible URL — download the local blob with the
          // extension matching its actual MIME type so the user gets a file
          // they can open immediately.
          const isWebm = blob.type.includes('webm');
          directDownload(blob, isWebm ? 'webm' : 'mp4');
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
      const msg = (err as Error)?.message || 'erreur inconnue';
      console.error('[Export] Montage composition failed:', err);
      setExportRenderStage(t('exportOverlay.errorMontage'));
      alert(`Export bureau échoué : ${msg}. Si le post est incomplet (pas de cartes / pas de visuel), modifiez-le d'abord depuis /creer puis ré-exportez.`);
    } finally {
      setTimeout(() => {
        setExportRendering(false);
        setExportRenderProgress(0);
        setExportRenderStage('');
      }, 3000);
    }
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
          onClick={() => crossDateBulk ? toggleDaySelection(day) : handleDayClick(day)}
          onDragOver={(e) => { e.preventDefault(); setDragOverDay(day); }}
          onDragLeave={() => { if (dragOverDay === day) setDragOverDay(null); }}
          onDrop={(e) => { e.preventDefault(); handleDropOnDay(day); }}
          className={`aspect-square p-0.5 sm:p-1.5 rounded-md sm:rounded-lg cursor-pointer transition-all relative ${
            crossDateBulk && selectedBulkDays.has(day)
              ? 'bg-red-600/30 ring-2 ring-red-400 scale-105'
              : dragOverDay === day
              ? 'bg-purple-600/30 ring-2 ring-purple-400 scale-105'
              : isSelected
              ? 'bg-gradient-to-br from-purple-600 to-pink-500 shadow-lg shadow-purple-500/20'
              : isToday
              ? 'bg-gray-700 ring-2 ring-pink-500'
              : crossDateBulk && dayPosts.length > 0
              ? 'bg-gray-800 hover:bg-red-900/30 border border-gray-700/50 hover:border-red-500/50'
              : 'bg-gray-800 hover:bg-gray-700 border border-gray-700/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs sm:text-sm font-medium ${isToday ? 'text-pink-400' : isSelected ? 'text-white' : 'text-gray-300'}`}>
              {day}
            </span>
            {crossDateBulk && selectedBulkDays.has(day) && (
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] text-white font-bold">✓</span>
            )}
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
      {/* Agent IA modal — shared with /dashboard/creer */}
      <AgentIAModal
        isOpen={showAIAgent}
        onClose={() => setShowAIAgent(false)}
        onAfterGenerate={fetchPosts}
      />

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

      {importing && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-purple-500/30">
            <div className="flex items-center gap-3 mb-4">
              <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
              <h3 className="text-lg font-bold text-white">Import en cours</h3>
            </div>
            <p className="text-sm text-gray-300 mb-4 truncate">{importStage}</p>
            <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${importProgress}%`, background: 'linear-gradient(90deg, #7C3AED, #EC4899)' }}
              />
            </div>
            <p className="text-xs text-purple-400 text-right mt-2 font-bold">{importProgress}%</p>
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

            {/* Cross-date bulk selection bar */}
            {crossDateBulk && (
              <div className="mt-4 p-3 bg-gray-800/80 border border-purple-700/50 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-purple-300 font-medium">
                    {selectedPostIds.size} post(s) sur {selectedBulkDays.size} jour(s)
                  </p>
                  <button
                    onClick={() => { setCrossDateBulk(false); setSelectedPostIds(new Set()); setSelectedBulkDays(new Set()); }}
                    className="text-[10px] px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
                  >
                    Annuler
                  </button>
                </div>
                {/* Horaire de publication */}
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-gray-400 whitespace-nowrap">Heure :</label>
                  <input
                    type="time"
                    value={bulkScheduleTime}
                    onChange={(e) => setBulkScheduleTime(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCrossDateBulkSchedule}
                    disabled={saving || selectedPostIds.size === 0}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 disabled:opacity-50 text-white text-xs font-bold transition"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
                    Planifier à {bulkScheduleTime}
                  </button>
                  <button
                    onClick={handleCrossDateBulkDelete}
                    disabled={saving || selectedPostIds.size === 0}
                    className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-red-600/80 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold transition"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-[9px] text-gray-500">Cliquez sur les jours du calendrier pour sélectionner/désélectionner les posts</p>
              </div>
            )}

            {/* Bottom Action Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 mt-6 pt-4 border-t border-gray-700/50">
              <div className="flex flex-col xs:flex-row gap-1.5 w-full sm:w-auto">
                {agentIAEnabled && (
                  <button
                    onClick={() => setShowAIAgent(true)}
                    className="flex items-center justify-center sm:justify-start gap-1 px-2.5 sm:px-4 py-2 sm:py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-[10px] sm:text-sm font-medium transition"
                  >
                    <Bot size={12} className="sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">{t('agentIA')}</span>
                    <span className="sm:hidden">{t('agentIA').substring(0, 3)}</span>
                  </button>
                )}
                <button
                  onClick={handleImportClick}
                  className="flex items-center justify-center sm:justify-start gap-1 px-2.5 sm:px-4 py-2 sm:py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-[10px] sm:text-sm font-medium transition"
                >
                  <Upload size={12} className="sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">{t('import')}</span>
                  <span className="sm:hidden">{t('import').substring(0, 3)}</span>
                </button>
                <button
                  onClick={() => { setCrossDateBulk(!crossDateBulk); setSelectedPostIds(new Set()); setSelectedBulkDays(new Set()); }}
                  className={`flex items-center justify-center sm:justify-start gap-1 px-2.5 sm:px-4 py-2 sm:py-2.5 border rounded-lg text-[10px] sm:text-sm font-medium transition ${
                    crossDateBulk ? 'bg-red-600 border-red-500 text-white' : 'bg-gray-800 hover:bg-gray-700 border-gray-700'
                  }`}
                >
                  <CheckSquare size={12} className="sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">{crossDateBulk ? 'Annuler sélection' : 'Sélection multiple'}</span>
                  <span className="sm:hidden">{crossDateBulk ? 'Annuler' : 'Multi'}</span>
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
                {/* ── Sidebar thumbnail: show the ACTUAL composed video, not an HTML approximation ──
                     One export = one video = one rendering everywhere. */}
                {selectedDayPosts.length > 0 && !bulkMode && (() => {
                  const fp = fullPreviewPost || selectedDayPosts[0];
                  const fpMeta = fp.metadata;
                  const thumbnailUrl = fpMeta?.thumbnailUrl || null;
                  // For image posts the file itself IS the poster — route it to
                  // posterUrl so PostThumbnail renders <img>, not <video>.
                  const mediaIsImage = fp.media_type === 'image';
                  const fpPosterImg = fpMeta?.pexelsUrl || fpMeta?.posterUrl || fpMeta?.characterUrl || (mediaIsImage ? fp.media_url : null) || null;
                  const videoUrl = (fpMeta?.renderedVideoUrl || (mediaIsImage ? null : fp.media_url) || null) as string | null;
                  return (
                    <div className="flex justify-center mb-3">
                      {/* `key={fp.id}` forces React to remount PostThumbnail when
                           the post changes. Resets the internal `extractedThumb`
                           state so a previous day's extracted frame can't leak
                           into the current day's miniature. */}
                      <PostThumbnail
                        key={fp.id}
                        thumbnailUrl={thumbnailUrl}
                        posterUrl={fpPosterImg}
                        videoUrl={videoUrl}
                        title={fp.title}
                        format={fp.format}
                      />
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
                        onClick={bulkMode ? (e) => { e.stopPropagation(); console.log('[Calendar] post click in bulk mode, toggling', post.id); togglePostSelection(post.id); } : undefined}
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
                                <button onClick={() => { window.location.href = `/dashboard/creer?postId=${post.id}&tab=audio`; }} className="p-1 rounded bg-purple-600 hover:bg-purple-700 text-white transition" title={t('actions.addAudio')}><Volume2 className="w-3 h-3" /></button>
                              )}
                              {post.status === 'failed' && (
                                <button onClick={() => handleRetryPost(post)} className="p-1 rounded bg-orange-600 hover:bg-orange-700 text-white transition" title="Réessayer la publication"><RefreshCw className="w-3 h-3" /></button>
                              )}
                              <button onClick={() => handleFullPreview(post)} className="p-1 rounded bg-green-600 hover:bg-green-700 text-white transition ml-auto" title={t('actions.fullPreview')}><Play className="w-3 h-3" /></button>
                              <button disabled={saving} onClick={() => handleDeletePost(post)} className="p-1 rounded bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white transition" title={t('actions.delete')}><Trash2 className="w-3 h-3" /></button>
                            </div>
                            {post.status === 'failed' && (post.metadata?.error || post.metadata?.cron_publish_results) && (
                              <div className="flex items-start gap-1 px-1 py-1 bg-red-900/30 rounded text-[8px] text-red-300 leading-tight">
                                <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" />
                                <span className="break-all">{post.metadata?.error || post.metadata?.cron_publish_results?.filter((r: any) => !r.success).map((r: any) => `${r.platform}: ${r.error}`).join(' | ')}</span>
                              </div>
                            )}
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

        // ── Extraction du design avec fallbacks pour les anciens posts sans champ design ──
        const design = meta?.design;
        // Mapping CSS des polices — doit correspondre au FONT_CSS_MAP de l'éditeur
        const FONT_CSS_MAP: Record<string, string> = {
          Anton: 'var(--font-anton)',
          Syne: 'var(--font-syne)',
          'Bebas Neue': 'var(--font-bebas)',
          Poppins: 'var(--font-poppins)',
          'Space Grotesk': 'var(--font-space)',
        };
        const rawFontName = design?.font || 'sans-serif';
        const designFont = FONT_CSS_MAP[rawFontName] || rawFontName;
        const designTitleColor = design?.titleColor || '#FFFFFF';
        const designCtaColor = design?.ctaColor || accent;
        const designCtaSubColor = design?.ctaSubColor || '#FFFFFF';
        const designCtaTextScale = design?.ctaTextScale || 1.0;
        const designTextScale = design?.textScale || 1.0;
        const designGradient1 = design?.gradientColor1 || '#7C3AED';
        const designGradient2 = design?.gradientColor2 || '#EC4899';
        const designGradientOpacity = design?.gradientOpacity ?? 0.3;
        const designSeqGradients = design?.seqGradients || {};
        const designNoColorSequences: string[] = (design as any)?.noColorSequences || [];
        const designLogoScale = design?.logoScale || 1.0;
        const titleTypo = design?.typography?.title || {};
        const ctaTypo = design?.typography?.cta || {};
        const overlayTypo = design?.typography?.overlay || {};
        const positions = design?.positions || {};
        const sizes = design?.sizes || {};
        const designCtaMainText = design?.ctaMainText;
        const designCtaSubText = design?.ctaSubText;
        const designLogoUrl = design?.logoUrl || meta?.logoUrl;
        const designCardStyle = design?.cardStyle || 'Compact';
        const designCardCustomIcons = design?.cardCustomIcons;
        const rawLogoSequences = design?.logoSequences || [];
        // Mapper les noms de séquences éditeur → calendrier :
        // Éditeur utilise : "titre", "cartes", "video", "cta"
        // Calendrier utilise : "intro", "cards", "video", "cta"
        const seqNameMap: Record<string, string> = { titre: 'intro', cartes: 'cards', video: 'video', cta: 'cta' };
        const designLogoSequences = rawLogoSequences.map((s: string) => seqNameMap[s] || s);
        // Per-sequence logo positions (normalized from French → English)
        const rawLogoPositions = design?.logoPositions || {};
        const designLogoPositions: Record<string, { x: number; y: number }> = {};
        Object.entries(rawLogoPositions).forEach(([k, v]: [string, any]) => {
          designLogoPositions[seqNameMap[k] || k] = v;
        });
        const getCalLogoPos = (seq: string) => designLogoPositions[seq] || positions.logo || { x: 50, y: 85 };
        // Site text (Afroboost.com) from design metadata
        const designSiteText = design?.siteText;
        const siteTextConfig = designSiteText || { text: 'Afroboost.com', pos: { x: 50, y: 95 }, size: 1.0, color: '#FFFFFF', opacity: 0.7, sequences: ['titre', 'cartes', 'video', 'cta'], enabled: true };
        const siteTextSeqs = (siteTextConfig.sequences || []).map((s: string) => seqNameMap[s] || s);
        // Per-sequence siteText positions (normalized from French → English)
        const rawSiteTextPositions = (siteTextConfig as any).positions || {};
        const designSiteTextPositions: Record<string, { x: number; y: number }> = {};
        Object.entries(rawSiteTextPositions).forEach(([k, v]: [string, any]) => {
          designSiteTextPositions[seqNameMap[k] || k] = v;
        });
        const getCalSiteTextPos = (seq: string) => designSiteTextPositions[seq] || siteTextConfig.pos || { x: 50, y: 95 };

        // Échelle : L'aperçu éditeur pour 9:16 est ~max-w-xs (320px) avec des tailles en px.
        // L'aperçu calendrier utilise height:70dvh, aspect-ratio:9/16 → largeur ≈ 39.375dvh.
        // Titre base éditeur : (format=9:16 ? 14 : 18) * textScale px sur ~320px de large.
        // Calendrier : utilise dvh proportionnel à 39.375dvh → 1 editor-px ≈ 39.375/320 ≈ 0.123dvh
        const isReelFormat = fullPreviewPost.format === 'reel';
        // Convertir les pixels éditeur en unités dvh : editorPx / 320 * 39.375 (reel) ou editorPx / 512 * 70 (tv)
        const editorPxToDvh = (editorPx: number) => `${(editorPx * (isReelFormat ? 0.123 : 0.137)).toFixed(2)}dvh`;
        // Convertir les pixels du canvas 1080px en dvh : canvasPx / 1080 * 39.375 = canvasPx * 0.03646
        const canvasPxToDvh = (canvasPx: number) => `${(canvasPx * (isReelFormat ? 0.03646 : 0.02917)).toFixed(2)}dvh`;

        // Tronque une chaîne sur la dernière frontière de mot avant la limite
        // et ajoute une ellipse. MÊME implémentation que creer/page.tsx et
        // video-composer.ts pour garder la parité.
        const truncateAtWord = (text: string | undefined, maxChars: number): string => {
          if (!text) return '';
          if (text.length <= maxChars) return text;
          const cut = text.slice(0, maxChars);
          const lastSpace = cut.lastIndexOf(' ');
          const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
          return trimmed.replace(/[\s,;:.!?-]+$/, '') + '…';
        };

        // Utilitaire : convertir couleur hex en rgba avec opacité
        const hexToRgba = (hex: string, opacity: number) => {
          // If already rgba/rgb, just return
          if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
          const r = parseInt(hex.slice(1, 3), 16) || 0;
          const g = parseInt(hex.slice(3, 5), 16) || 0;
          const b = parseInt(hex.slice(5, 7), 16) || 0;
          return `rgba(${r},${g},${b},${opacity})`;
        };

        // Backdrop CSS — mirrors the editor (creer/page.tsx:5332-5351) and the
        // composer's `paintSeqBackdrop`: 135deg gradient of gradientColor1 →
        // gradientColor2, OR solid dark `#0A0A0F` if the sequence is listed in
        // `noColorSequences`.
        const getBackdropCSS = (seq: string) => {
          const editorKey = seq === 'intro' ? 'titre' : seq === 'cards' ? 'cartes' : seq;
          if (designNoColorSequences.includes(editorKey) || designNoColorSequences.includes(seq)) {
            return '#0A0A0F';
          }
          return `linear-gradient(135deg, ${designGradient1}, ${designGradient2})`;
        };

        // Helper function to get per-sequence gradient CSS
        const getGradientCSS = (seq: string) => {
          const editorKey = seq === 'intro' ? 'titre' : seq === 'cards' ? 'cartes' : seq;
          const override = designSeqGradients[editorKey];
          // Video sequence: gradient disabled by default unless user explicitly enables it
          const defaultEnabled = (seq === 'video') ? false : true;
          const enabled = override?.enabled ?? defaultEnabled;
          if (!enabled) return 'transparent';
          const c1 = override?.color1 || designGradient1;
          const c2 = override?.color2 || designGradient2;
          const op = override?.opacity ?? designGradientOpacity;
          const pos = override?.position || 'both';

          if (pos === 'top') return `linear-gradient(180deg, ${hexToRgba(c1, op)} 0%, transparent 50%)`;
          if (pos === 'bottom') return `linear-gradient(180deg, transparent 50%, ${hexToRgba(c2, op)} 100%)`;
          if (pos === 'left') return `linear-gradient(90deg, ${hexToRgba(c1, op)} 0%, transparent 50%)`;
          if (pos === 'right') return `linear-gradient(270deg, ${hexToRgba(c1, op)} 0%, transparent 50%)`;
          // 'both' — color1 at top, color2 at bottom (matches editor)
          return `linear-gradient(180deg, ${hexToRgba(c1, op)} 0%, transparent 40%, transparent 60%, ${hexToRgba(c2, op)} 100%)`;
        };

        // Display title: use metadata subtitle for the overlay text, keep raw title for the sidebar
        const displayTitle = meta?.subtitle
          ? fullPreviewPost.title.replace(/\s*\(Rush\s*\d+\)\s*/gi, '').replace(/\s*-\s*(Instagram|Facebook|TikTok|YouTube|YouTube Shorts)\s*/gi, '')
          : fullPreviewPost.title;
        return (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-0 md:p-4" onClick={() => setShowFullPreview(false)}>
          {/* Audio caché : toujours utiliser les fichiers audio séparés (musicUrl/voiceUrl) s'ils existent.
              Le renderedVideoUrl peut être un WebM mode rapide SANS audio embarqué.
              Les fichiers musicUrl/voiceUrl sont la source la plus fiable pour l'audio. */}
          <>
            {/* Source audio PRINCIPALE : fichiers séparés de musique et voix */}
            {postHasAudio && previewMusicUrl && (
              <audio id="preview-audio-music" src={previewMusicUrl} autoPlay loop muted={montageMuted} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
            )}
            {postHasAudio && previewVoiceUrl && (
              <audio id="preview-audio-voice" src={previewVoiceUrl} autoPlay muted={montageMuted} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
            )}
            {/* Fallback : si pas de fichiers séparés mais renderedVideoUrl existe, utiliser le <video> caché pour l'audio */}
            {postHasAudio && !previewMusicUrl && !previewVoiceUrl && meta?.renderedVideoUrl && (
              <video id="preview-audio-rendered" src={meta.renderedVideoUrl} loop muted playsInline preload="auto" style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', zIndex: -1 }} />
            )}
          </>
          {/* Floating back button — always visible on mobile, overlays on top of everything */}
          <button
            onClick={(e) => { e.stopPropagation(); setShowFullPreview(false); }}
            className="md:hidden fixed top-4 left-4 z-[60] flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/60 backdrop-blur-sm text-white border border-white/20 shadow-lg active:scale-95 transition-transform"
          >
            <ChevronLeft size={18} />
            <span className="text-sm font-medium">Retour</span>
          </button>

          {/* Regenerate-montage floating button — shown ONLY when the post
              is NOT up to date:
                - missing renderedVideoUrl  → never got a montage
                - missing thumbnailUrl      → legacy post pre-thumbnail feature
                - composerVersion outdated  → rendered by an older/buggy composer
              Freshly exported posts (all three present + matching version)
              hide the button so the UI stays clean. Also shown while a
              regeneration is in progress so the progress label is readable. */}
          {(regenerating
            || !meta?.renderedVideoUrl
            || !meta?.thumbnailUrl
            || meta?.composerVersion !== CURRENT_COMPOSER_VERSION) && (
            <button
              onClick={(e) => { e.stopPropagation(); regenerateMontage(fullPreviewPost); }}
              disabled={regenerating}
              className="fixed top-4 right-4 z-[60] flex items-center gap-2 px-4 py-2 rounded-full bg-purple-600 hover:bg-purple-500 backdrop-blur-sm text-white border-2 border-white/30 shadow-2xl disabled:opacity-70 disabled:cursor-wait active:scale-95 transition-transform font-semibold"
              title={regenerating ? `${regenStage} ${regenProgress}%` : 'Re-générer le montage avec la dernière version du composer'}
            >
              <RefreshCw size={16} className={regenerating ? 'animate-spin' : ''} />
              <span className={`text-sm ${regenerating ? 'animate-pulse' : ''}`}>
                {regenerating ? `${regenStage || 'Rendu...'} ${regenProgress}%` : 'Régénérer le montage'}
              </span>
            </button>
          )}
          <div className="bg-gray-900 rounded-none md:rounded-2xl overflow-hidden shadow-2xl max-w-5xl w-full flex flex-col md:flex-row max-h-[100dvh] md:max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Left: Rich Montage Preview */}
            <div className="flex-1 bg-black flex flex-col items-center justify-center p-2 md:p-4" style={{ minHeight: '60dvh' }}>
              {/* Montage video preview — infographic & creator with sequences */}
              {/* ── Parity with social media: if we have the composed video, PLAY IT
                   directly instead of rebuilding the montage in HTML. This guarantees
                   editor export == calendar preview == Instagram/TikTok post. The HTML
                   rebuild below is kept as a legacy fallback for posts that never got
                   a `renderedVideoUrl` (never passed through the composer). ── */}
              {hasMontage && meta?.renderedVideoUrl ? (
                <div
                  className={`relative overflow-hidden rounded-xl bg-black ${fullPreviewPost.format === 'reel' ? '' : 'aspect-video w-full'}`}
                  style={fullPreviewPost.format === 'reel' ? { aspectRatio: '9/16', height: '70dvh', maxHeight: '70dvh' } : undefined}
                >
                  {/* `key` forces React to remount the <video> element when the URL
                       changes — HTML5 `<video>` doesn't always reload a new `src`
                       without an explicit `.load()`, and without a remount the
                       user keeps seeing the old stale composed video even after
                       a successful regeneration. */}
                  <video
                    key={meta.renderedVideoUrl}
                    src={meta.renderedVideoUrl}
                    autoPlay
                    loop
                    muted={montageMuted}
                    playsInline
                    controls
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>
              ) : hasMontage ? (() => {
                // Legacy HTML montage rebuild — used only for posts without renderedVideoUrl.
                // Use stable sequence order (always includes video) to prevent index shifts
                const seqOrder: string[] = [...new Set((meta?.sequences?.order || ['intro', 'cards', 'video']).map((s: string) => ({ titre: 'intro', cartes: 'cards', video: 'video', cta: 'cta' }[s] || s)).filter((s: string) => { const dur = meta?.sequences?.[s]; return dur === undefined || dur > 0; }))];
                const posterImgSrc = meta?.pexelsUrl || meta?.posterUrl || meta?.characterUrl || null;
                const safeIdx = infoSeqIndex < seqOrder.length ? infoSeqIndex : 0;
                const currentSeq = seqOrder[safeIdx] || 'intro';

                return (
                  <div
                    className={`relative overflow-hidden rounded-xl ${fullPreviewPost.format === 'reel' ? '' : 'aspect-video w-full'}`}
                    style={{
                      ...(fullPreviewPost.format === 'reel' ? { aspectRatio: '9/16', height: '70dvh', maxHeight: '70dvh' } : {}),
                      border: borderCol ? `3px solid ${borderCol}` : undefined,
                      boxShadow: borderCol ? `0 0 30px ${borderCol}40, 0 0 60px ${borderCol}15` : `0 0 30px ${accent}4D, 0 0 60px ${accent}1A`,
                    }}
                  >
                    {/* === INTRO : Photo affiche + titre + sous-titre (mêmes valeurs que l'éditeur) === */}
                    <div className="absolute inset-0" style={{ opacity: currentSeq === 'intro' ? 1 : 0, transform: currentSeq === 'intro' ? 'scale(1)' : 'scale(1.08)', zIndex: currentSeq === 'intro' ? 10 : 1, transition: 'opacity 800ms ease-in-out, transform 800ms ease-in-out', willChange: 'opacity, transform' }}>
                      {posterImgSrc ? <img src={posterImgSrc} alt="Affiche" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0" style={{ background: getBackdropCSS('intro') }} />}
                      <div className="absolute inset-0" style={{ background: getGradientCSS('intro') }} />
                      {(() => {
                        // Title gradient (parité éditeur). Applies background-clip:text
                        // when titleTypography.textGradient is set so the HTML rebuild
                        // matches the video output instead of falling back to a flat
                        // designTitleColor (this was the source of the T=0 flash:
                        // HTML rebuild flat → 1s later video plays with gradient).
                        const titleHasGrad = !!(titleTypo.textGradient && titleTypo.gradColor1 && titleTypo.gradColor2);
                        const titleGradStyle = titleHasGrad ? {
                          backgroundImage: `linear-gradient(135deg, ${titleTypo.gradColor1}, ${titleTypo.gradColor2})`,
                          backgroundColor: 'transparent',
                          WebkitBackgroundClip: 'text' as const,
                          backgroundClip: 'text' as const,
                          WebkitTextFillColor: 'transparent',
                          color: 'transparent',
                          display: 'inline-block' as const,
                        } : null;
                        const exTT: any = (design as any)?.extraTitleTypography || {};
                        const exST: any = (design as any)?.extraSubtitleTypography || {};
                        const exTTHasGrad = !!(exTT.textGradient && exTT.gradColor1 && exTT.gradColor2);
                        const exSTHasGrad = !!(exST.textGradient && exST.gradColor1 && exST.gradColor2);
                        const exTitleGradStyle = exTTHasGrad ? {
                          backgroundImage: `linear-gradient(135deg, ${exTT.gradColor1}, ${exTT.gradColor2})`,
                          backgroundColor: 'transparent',
                          WebkitBackgroundClip: 'text' as const,
                          backgroundClip: 'text' as const,
                          WebkitTextFillColor: 'transparent',
                          color: 'transparent',
                          display: 'inline-block' as const,
                        } : null;
                        const exSubGradStyle = exSTHasGrad ? {
                          backgroundImage: `linear-gradient(135deg, ${exST.gradColor1}, ${exST.gradColor2})`,
                          backgroundColor: 'transparent',
                          WebkitBackgroundClip: 'text' as const,
                          backgroundClip: 'text' as const,
                          WebkitTextFillColor: 'transparent',
                          color: 'transparent',
                          display: 'inline-block' as const,
                        } : null;
                        const extraTitleText = (design as any)?.extraTitle as string | undefined;
                        const extraSubtitleText = (design as any)?.extraSubtitle as string | undefined;
                        const extraTitlePos = (design as any)?.extraTitlePosition || { x: 50, y: 50 };
                        const extraSubtitlePos = (design as any)?.extraSubtitlePosition || { x: 50, y: 58 };
                        return (
                          <>
                            <div className="absolute inset-0 z-10" style={{ pointerEvents: 'none' }}>
                              <div style={{
                                position: 'absolute',
                                left: `${positions.title?.x ?? 50}%`,
                                top: `${positions.title?.y ?? 10}%`,
                                transform: 'translate(-50%, 0)',
                                display: 'flex',
                                flexDirection: 'column' as const,
                                alignItems: 'center',
                                gap: editorPxToDvh(4),
                                maxWidth: '90%',
                                textAlign: 'center' as const,
                              }}>
                                <h3 style={{
                                  fontFamily: designFont,
                                  fontSize: editorPxToDvh((isReelFormat ? 14 : 18) * designTextScale),
                                  letterSpacing: `${titleTypo.letterSpacing || 0}px`,
                                  lineHeight: titleTypo.lineHeight || 1.1,
                                  fontWeight: titleTypo.bold !== false ? 900 : 400,
                                  fontStyle: titleTypo.italic ? 'italic' : 'normal',
                                  textTransform: 'uppercase' as const,
                                  textShadow: titleHasGrad ? 'none' : '0 4px 6px rgba(0,0,0,0.15)',
                                  margin: 0,
                                  whiteSpace: 'pre-wrap' as const,
                                  ...(titleGradStyle ?? { color: designTitleColor }),
                                }}>{displayTitle || 'TITRE'}</h3>
                                {meta?.subtitle && <p style={{
                                  fontFamily: designFont,
                                  fontSize: editorPxToDvh((isReelFormat ? 9 : 11) * designTextScale),
                                  letterSpacing: `${titleTypo.letterSpacing || 0}px`,
                                  lineHeight: titleTypo.lineHeight || 1.1,
                                  fontWeight: titleTypo.bold !== false ? 900 : 400,
                                  fontStyle: titleTypo.italic ? 'italic' : 'normal',
                                  textShadow: titleHasGrad ? 'none' : '0 2px 4px rgba(0,0,0,0.15)',
                                  margin: 0,
                                  whiteSpace: 'pre-wrap' as const,
                                  ...(titleGradStyle ?? { color: `${designTitleColor}CC` }),
                                }}>{meta.subtitle}</p>}
                              </div>
                            </div>
                            {/* Extra title / subtitle — independent absolute positions, parité éditeur */}
                            {extraTitleText && (
                              <div style={{
                                position: 'absolute',
                                left: `${extraTitlePos.x ?? 50}%`,
                                top: `${extraTitlePos.y ?? 50}%`,
                                transform: 'translate(-50%, -50%)',
                                zIndex: 10,
                                pointerEvents: 'none',
                                textAlign: 'center' as const,
                                fontFamily: designFont,
                                fontSize: editorPxToDvh((isReelFormat ? 9 : 11) * designTextScale * (exTT.scale ?? 1)),
                                letterSpacing: `${exTT.letterSpacing || 0}px`,
                                lineHeight: exTT.lineHeight || 1.1,
                                fontWeight: exTT.bold ? 900 : 400,
                                fontStyle: exTT.italic ? 'italic' : 'normal',
                                whiteSpace: 'pre-wrap' as const,
                                ...(exTitleGradStyle ?? { color: designTitleColor }),
                              }}>{extraTitleText}</div>
                            )}
                            {extraSubtitleText && (
                              <div style={{
                                position: 'absolute',
                                left: `${extraSubtitlePos.x ?? 50}%`,
                                top: `${extraSubtitlePos.y ?? 58}%`,
                                transform: 'translate(-50%, -50%)',
                                zIndex: 10,
                                pointerEvents: 'none',
                                textAlign: 'center' as const,
                                fontFamily: designFont,
                                fontSize: editorPxToDvh((isReelFormat ? 6.75 : 8.25) * designTextScale * (exST.scale ?? 1)),
                                letterSpacing: `${exST.letterSpacing || 0}px`,
                                lineHeight: exST.lineHeight || 1.2,
                                fontWeight: exST.bold ? 900 : 400,
                                fontStyle: exST.italic ? 'italic' : 'normal',
                                opacity: exSTHasGrad ? 1 : 0.8,
                                whiteSpace: 'pre-wrap' as const,
                                ...(exSubGradStyle ?? { color: designTitleColor }),
                              }}>{extraSubtitleText}</div>
                            )}
                          </>
                        );
                      })()}
                      {/* Logo sur intro si logoSequences inclut 'intro' — per-sequence position */}
                      {/* Height-based sizing matching editor's h-8 w-auto max-w-[60px] scale(logoScale) */}
                      {designLogoUrl && designLogoSequences?.includes('intro') && (
                        <img src={designLogoUrl} alt="Logo" style={{
                          position: 'absolute',
                          height: editorPxToDvh(32 * designLogoScale),
                          width: 'auto',
                          maxWidth: editorPxToDvh(60 * designLogoScale),
                          objectFit: 'contain',
                          left: `${getCalLogoPos('intro').x}%`,
                          top: `${getCalLogoPos('intro').y}%`,
                          transform: 'translate(-50%, -50%)',
                          zIndex: 20,
                        }} />
                      )}
                    </div>

                    {/* === CARTES : Cartes d'info avec les 5 styles de l'éditeur + animation === */}
                    <div className="absolute inset-0" style={{ opacity: currentSeq === 'cards' ? 1 : 0, zIndex: currentSeq === 'cards' ? 10 : 1, transition: 'opacity 800ms ease-in-out', willChange: 'opacity' }}>
                      <div className="absolute inset-0" style={{ background: getBackdropCSS('cards') }} />
                      <div className="absolute inset-0" style={{ background: getGradientCSS('cards') }} />
                      <div className="absolute z-10" style={{
                        position: 'absolute',
                        left: `${positions.cards?.x ?? 50}%`,
                        top: `${positions.cards?.y ?? 50}%`,
                        transform: 'translate(-50%, -50%)',
                        width: `${sizes.cards || 92}%`,
                        boxSizing: 'border-box',
                      }}>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: designCardStyle === 'Full Width' || designCardStyle === 'Minimal Line' ? '1fr' : isReelFormat ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                          gap: editorPxToDvh(6),
                          width: '100%',
                        }}>
                          {(() => {
                            const displayCards = meta?.cards?.length > 0
                              ? meta.cards.map((c: { emoji: string; label: string; value: string; description?: string; color?: string }) => c)
                              : (meta?.textCards || []).map((tCard: { text: string; color?: string }) => ({ emoji: '📝', label: tCard.text, value: tCard.text, color: tCard.color }));
                            // ── Cards-specific scale multiplier (parité /creer) ──
                            // /creer's editor multiplies card fonts by BOTH textScale AND
                            // (cardsTextScale / 100). Calendar previously only used
                            // textScale → cards rendered at the wrong absolute size when
                            // the user customised cardsTextScale (e.g. 50% → calendar 2×
                            // too big, 200% → calendar 2× too small).
                            const designCardsTextScale = (design as any)?.cardsTextScale ?? 100;
                            const cardsK = designCardsTextScale / 100;
                            const scaledLabel = editorPxToDvh(7 * designTextScale * cardsK);
                            const scaledValue = editorPxToDvh(9 * designTextScale * cardsK);
                            const scaledDesc = editorPxToDvh(6 * designTextScale * cardsK);
                            // Cards-specific font override (parité /creer line 8235)
                            const cardsFontFamily = (design as any)?.cardsFont
                              ? (FONT_CSS_MAP[(design as any).cardsFont] || (design as any).cardsFont)
                              : designFont;
                            // Per-element gradient (parité éditeur). Read from typography.cards
                            // (new shape) OR cardsTypography (alias). Backward-compat: legacy
                            // textGradient flag means all 3 elements get the gradient.
                            const cardsTypo: any = (design as any)?.typography?.cards || (design as any)?.cardsTypography || {};
                            const cardsHasColors = !!(cardsTypo.gradColor1 && cardsTypo.gradColor2);
                            const cardsLegacyAll = !!cardsTypo.textGradient;
                            const wantLabelGrad = cardsHasColors && (cardsLegacyAll || !!cardsTypo.labelGradient);
                            const wantValueGrad = cardsHasColors && (cardsLegacyAll || !!cardsTypo.valueGradient);
                            const wantDescGrad = cardsHasColors && (cardsLegacyAll || !!cardsTypo.descriptionGradient);
                            const _cardsGradStyle = cardsHasColors ? {
                              backgroundImage: `linear-gradient(135deg, ${cardsTypo.gradColor1}, ${cardsTypo.gradColor2})`,
                              backgroundColor: 'transparent',
                              WebkitBackgroundClip: 'text' as const,
                              backgroundClip: 'text' as const,
                              WebkitTextFillColor: 'transparent',
                              color: 'transparent',
                              display: 'inline-block' as const,
                            } : null;
                            const labelGradStyle = wantLabelGrad ? _cardsGradStyle : null;
                            const valueGradStyle = wantValueGrad ? _cardsGradStyle : null;
                            const descGradStyle = wantDescGrad ? _cardsGradStyle : null;
                            // Common text-flow base for every card text node — preserves \n,
                            // wraps long words instead of overflowing the slot (the previous
                            // whiteSpace: 'nowrap' on Full Width clipped both sides on long
                            // descriptions).
                            const textFlow = { whiteSpace: 'pre-wrap' as const, overflowWrap: 'break-word' as const, wordBreak: 'break-word' as const };
                            return displayCards.slice(0, isReelFormat ? 5 : 6).map((card: { emoji: string; label: string; value: string; description?: string; color?: string }, i: number) => {
                              const cardIcon = designCardCustomIcons?.[String(i)] || undefined;
                              const animStyle = {
                                transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
                                transitionDelay: currentSeq === 'cards' ? `${i * 150}ms` : '0ms',
                                opacity: currentSeq === 'cards' ? 1 : 0,
                                transform: currentSeq === 'cards' ? 'translateX(0)' : 'translateX(-20px)',
                              };
                              const emojiEl = cardIcon
                                ? <img src={cardIcon} alt="" style={{ width: editorPxToDvh(14), height: editorPxToDvh(14), objectFit: 'contain' as const }} />
                                : (card.iconType === 'svg' || (card.emoji && /^[A-Z]/.test(card.emoji)))
                                  ? <CardIcon name={card.emoji} size={editorPxToDvh((isReelFormat ? 10 : 14) * cardsK)} color="#FFFFFF" className="" />
                                  : <span style={{ fontSize: editorPxToDvh(isReelFormat ? 10 : 14) }}>{card.emoji}</span>;

                              // ── Compact ──
                              if (designCardStyle === 'Compact') {
                                return (
                                  <div key={i} style={{
                                    ...animStyle,
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: editorPxToDvh(2),
                                    borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.3)', padding: `${editorPxToDvh(6)} ${editorPxToDvh(6)}`,
                                    backdropFilter: 'blur(4px)', borderLeft: `2px solid ${card.color || accent}`,
                                    minWidth: 0,
                                  }}>
                                    {emojiEl}
                                    <p style={{ fontSize: scaledLabel, fontFamily: cardsFontFamily, fontWeight: 700, textAlign: 'center', ...textFlow, ...(labelGradStyle ?? { color: '#fff' }) }}>{card.label}</p>
                                    <p style={{ fontSize: scaledValue, fontFamily: cardsFontFamily, fontWeight: 900, textAlign: 'center', ...textFlow, ...(valueGradStyle ?? { color: card.color || accent }) }}>{card.value}</p>
                                    {card.description && <p style={{ fontSize: scaledDesc, textAlign: 'center', ...textFlow, ...(descGradStyle ?? { color: 'rgba(255,255,255,0.6)' }) }}>{truncateAtWord(card.description as string, 30)}</p>}
                                  </div>
                                );
                              }
                              // ── Educatif ──
                              if (designCardStyle === 'Educatif') {
                                return (
                                  <div key={i} style={{
                                    ...animStyle,
                                    borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.4)', padding: `${editorPxToDvh(8)} ${editorPxToDvh(8)}`,
                                    backdropFilter: 'blur(4px)', borderTop: `2px solid ${card.color || accent}`,
                                    minWidth: 0,
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: editorPxToDvh(4), marginBottom: editorPxToDvh(4) }}>
                                      {emojiEl}
                                      <p style={{ fontSize: scaledLabel, fontFamily: cardsFontFamily, fontWeight: 700, ...textFlow, ...(labelGradStyle ?? { color: '#fff' }) }}>{card.label}</p>
                                    </div>
                                    {card.description && <p style={{ fontSize: scaledDesc, lineHeight: 1.4, marginBottom: editorPxToDvh(4), ...textFlow, ...(descGradStyle ?? { color: 'rgba(255,255,255,0.7)' }) }}>{truncateAtWord(card.description as string, 60)}</p>}
                                    <p style={{ fontSize: scaledValue, fontFamily: cardsFontFamily, fontWeight: 900, ...textFlow, ...(valueGradStyle ?? { color: card.color || accent }) }}>{card.value}</p>
                                  </div>
                                );
                              }
                              // ── Stats Bold ──
                              if (designCardStyle === 'Stats Bold') {
                                return (
                                  <div key={i} style={{
                                    ...animStyle,
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                    borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.5)', padding: `${editorPxToDvh(8)} ${editorPxToDvh(8)}`,
                                    backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.1)',
                                    minWidth: 0,
                                  }}>
                                    <p style={{ fontSize: editorPxToDvh(13 * designTextScale * cardsK), fontFamily: cardsFontFamily, fontWeight: 900, ...textFlow, ...(valueGradStyle ?? { color: card.color || accent }) }}>{card.value}</p>
                                    <p style={{ fontSize: scaledDesc, fontFamily: cardsFontFamily, fontWeight: 500, marginTop: editorPxToDvh(2), textAlign: 'center', ...textFlow, ...(labelGradStyle ?? { color: 'rgba(255,255,255,0.8)' }) }}>{card.label}</p>
                                  </div>
                                );
                              }
                              // ── Minimal Line ──
                              if (designCardStyle === 'Minimal Line') {
                                return (
                                  <div key={i} style={{
                                    ...animStyle,
                                    display: 'flex', alignItems: 'center', gap: editorPxToDvh(4),
                                    padding: `${editorPxToDvh(4)} ${editorPxToDvh(4)}`,
                                    borderBottom: `1px solid ${(card.color || accent)}40`,
                                    minWidth: 0,
                                  }}>
                                    {(card.iconType === 'svg' || (card.emoji && /^[A-Z]/.test(card.emoji)))
                                      ? <CardIcon name={card.emoji} size={editorPxToDvh(8 * cardsK)} color="#FFFFFF" className="" />
                                      : <span style={{ fontSize: editorPxToDvh(8) }}>{card.emoji}</span>}
                                    <p style={{ fontSize: scaledLabel, fontFamily: cardsFontFamily, flex: 1, minWidth: 0, ...textFlow, ...(labelGradStyle ?? { color: 'rgba(255,255,255,0.8)' }) }}>{card.label}</p>
                                    <p style={{ fontSize: scaledValue, fontFamily: cardsFontFamily, fontWeight: 700, flexShrink: 0, ...textFlow, ...(valueGradStyle ?? { color: card.color || accent }) }}>{card.value}</p>
                                  </div>
                                );
                              }
                              // ── Full Width (default) ──
                              return (
                                <div key={i} style={{
                                  ...animStyle,
                                  display: 'flex', alignItems: 'center', gap: editorPxToDvh(6),
                                  borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.3)', padding: `${editorPxToDvh(6)} ${editorPxToDvh(10)}`,
                                  backdropFilter: 'blur(4px)', borderLeft: `3px solid ${card.color || accent}`,
                                  minWidth: 0,
                                }}>
                                  {emojiEl}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ fontSize: scaledLabel, fontFamily: cardsFontFamily, fontWeight: 700, ...textFlow, ...(labelGradStyle ?? { color: '#fff' }) }}>{card.label}</p>
                                    {card.description && <p style={{ fontSize: scaledDesc, ...textFlow, ...(descGradStyle ?? { color: 'rgba(255,255,255,0.5)' }) }}>{truncateAtWord(card.description as string, 40)}</p>}
                                  </div>
                                  <p style={{ fontSize: scaledValue, fontFamily: cardsFontFamily, fontWeight: 900, flexShrink: 0, ...textFlow, ...(valueGradStyle ?? { color: card.color || accent }) }}>{card.value}</p>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                      {/* Logo sur cartes si logoSequences inclut 'cards' — per-sequence position */}
                      {designLogoUrl && designLogoSequences?.includes('cards') && (
                        <img src={designLogoUrl} alt="Logo" style={{
                          position: 'absolute',
                          height: editorPxToDvh(32 * designLogoScale),
                          width: 'auto',
                          maxWidth: editorPxToDvh(60 * designLogoScale),
                          objectFit: 'contain',
                          left: `${getCalLogoPos('cards').x}%`,
                          top: `${getCalLogoPos('cards').y}%`,
                          transform: 'translate(-50%, -50%)',
                          zIndex: 20,
                        }} />
                      )}
                    </div>

                    {/* === VIDÉO : Rush vidéo brut plein écran uniquement === */}
                    {(() => {
                      // Utiliser UNIQUEMENT la vidéo rush brute — JAMAIS le montage rendu.
                      // Le montage rendu (.webm) contient déjà les séquences intro/cartes/cta intégrées,
                      // ce qui causerait un effet "double CTA" dans la preview HTML.
                      const rawSrc = meta?.rawVideoUrl || meta?.rushUrls?.[0];
                      if (!rawSrc) return null;
                      // Ajout du hint #t=0.1 pour forcer Chrome à faire une range-request
                      // Aide les gros MP4 sans faststart (moov atom à la fin du fichier)
                      const videoSrcWithHint = rawSrc.includes('#') ? rawSrc : `${rawSrc}#t=0.1`;
                      return (
                      <div className="absolute inset-0" style={{ opacity: currentSeq === 'video' ? 1 : 0, zIndex: currentSeq === 'video' ? 10 : 1, transition: 'opacity 800ms ease-in-out', willChange: 'opacity' }}>
                        <video id="preview-video-infographic" src={videoSrcWithHint} muted loop playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover"
                          onLoadedData={(e) => { console.log('[Calendar] Rush video loaded, readyState:', (e.target as HTMLVideoElement).readyState); }}
                          onError={(e) => { console.error('[Calendar] Rush video error:', (e.target as HTMLVideoElement).error); }}
                        />
                        {/* Dégradé overlay sur la vidéo — mêmes couleurs que l'éditeur */}
                        <div className="absolute inset-0 z-[5]" style={{
                          background: getGradientCSS('video'),
                          pointerEvents: 'none',
                        }} />
                        {/* Texte overlay vidéo — legacy single overlay + any extras saved in metadata.overlays[] */}
                        {meta?.videoOverlayText && (
                          <div className="absolute inset-0 z-10 pointer-events-none">
                            <p style={{
                              fontFamily: designFont,
                              color: design?.overlayColor || '#FFFFFF',
                              fontSize: editorPxToDvh(16 * designTextScale * ((meta as any)?.overlayTextScale ?? 1)),
                              letterSpacing: `${overlayTypo.letterSpacing || 0}px`,
                              lineHeight: overlayTypo.lineHeight || 1.2,
                              fontWeight: overlayTypo.bold ? 'bold' : 'normal',
                              fontStyle: overlayTypo.italic ? 'italic' : 'normal',
                              textTransform: 'uppercase',
                              textAlign: 'center',
                              textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)',
                              position: 'absolute',
                              left: `${(meta as any)?.overlayPosition?.x ?? positions.overlay?.x ?? 50}%`,
                              top: `${(meta as any)?.overlayPosition?.y ?? positions.overlay?.y ?? 33}%`,
                              transform: 'translate(-50%, -50%)',
                              width: '85%',
                            }}>{meta.videoOverlayText}</p>
                          </div>
                        )}
                        {Array.isArray((meta as any)?.overlays) && (meta as any).overlays.map((ov: any, idx: number) => ov?.text ? (
                          <div key={`extra-ov-${idx}`} className="absolute inset-0 z-10 pointer-events-none">
                            <p style={{
                              fontFamily: designFont,
                              color: ov.color || '#FFFFFF',
                              fontSize: editorPxToDvh(16 * designTextScale * (ov.scale ?? 1)),
                              letterSpacing: `${ov.letterSpacing || 0}px`,
                              lineHeight: ov.lineHeight || 1.2,
                              fontWeight: ov.bold ? 'bold' : 'normal',
                              fontStyle: ov.italic ? 'italic' : 'normal',
                              textTransform: 'uppercase',
                              textAlign: 'center',
                              textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)',
                              position: 'absolute',
                              left: `${ov.position?.x ?? 50}%`,
                              top: `${ov.position?.y ?? 55}%`,
                              transform: 'translate(-50%, -50%)',
                              width: '85%',
                            }}>{ov.text}</p>
                          </div>
                        ) : null)}
                        {/* Logo sur vidéo si logoSequences inclut 'video' — per-sequence position */}
                        {designLogoUrl && designLogoSequences?.includes('video') && (
                          <img src={designLogoUrl} alt="Logo" style={{
                            position: 'absolute',
                            height: editorPxToDvh(32 * designLogoScale),
                            width: 'auto',
                            maxWidth: editorPxToDvh(60 * designLogoScale),
                            objectFit: 'contain',
                            left: `${getCalLogoPos('video').x}%`,
                            top: `${getCalLogoPos('video').y}%`,
                            transform: 'translate(-50%, -50%)',
                            zIndex: 20,
                          }} />
                        )}
                      </div>
                      );
                    })()}

                    {/* === CTA : Appel à l'action — même fond dégradé que l'éditeur/composer, texte coloré, logo === */}
                    <div className="absolute inset-0" style={{ opacity: currentSeq === 'cta' ? 1 : 0, transform: currentSeq === 'cta' ? 'scale(1)' : 'scale(0.92)', zIndex: currentSeq === 'cta' ? 10 : 1, transition: 'opacity 800ms ease-in-out, transform 800ms ease-in-out', willChange: 'opacity, transform' }}>
                      <div className="absolute inset-0" style={{ background: getBackdropCSS('cta') }} />
                      <div className="absolute inset-0" style={{ background: getGradientCSS('cta') }} />
                      <div className="text-center" style={{
                        position: 'absolute',
                        left: `${positions.watermark?.x ?? 50}%`,
                        top: `${positions.watermark?.y ?? 97}%`,
                        transform: 'translate(-50%, -100%)',
                        width: `${sizes.watermark || 70}%`,
                      }}>
                        {/* Phrase de vente au-dessus du CTA */}
                        {meta?.salesPhrase && <p style={{
                          fontFamily: designFont,
                          color: `${designCtaColor}ee`,
                          fontSize: editorPxToDvh((isReelFormat ? 8 : 10) * designCtaTextScale),
                          letterSpacing: `${ctaTypo.letterSpacing || 0}px`,
                          lineHeight: ctaTypo.lineHeight || 1.2,
                          fontWeight: ctaTypo.bold !== false ? 900 : 400,
                          fontStyle: ctaTypo.italic ? 'italic' : 'normal',
                          marginBottom: editorPxToDvh(4),
                        }}>{meta.salesPhrase}</p>}
                        {/* Texte CTA principal (ex: AFROBOOST) */}
                        <p style={{
                          fontFamily: designFont,
                          color: designCtaColor,
                          fontSize: editorPxToDvh((isReelFormat ? 12 : 16) * designCtaTextScale),
                          letterSpacing: `${ctaTypo.letterSpacing || 0}px`,
                          lineHeight: ctaTypo.lineHeight || 1.2,
                          fontWeight: ctaTypo.bold !== false ? 900 : 400,
                          fontStyle: ctaTypo.italic ? 'italic' : 'normal',
                          textTransform: 'uppercase',
                          textShadow: `0 0 20px ${designCtaColor}60`,
                        }}>{designCtaMainText || brd?.ctaSubText || branding.ctaSubText || 'AFROBOOST'}</p>
                        {/* Texte CTA secondaire (ex: CHAT POUR PLUS D'INFOS) */}
                        <p style={{
                          fontFamily: designFont,
                          color: designCtaSubColor,
                          fontSize: editorPxToDvh((isReelFormat ? 9 : 12) * designCtaTextScale),
                          letterSpacing: `${ctaTypo.letterSpacing || 0}px`,
                          textTransform: 'uppercase',
                          fontWeight: ctaTypo.bold !== false ? 900 : 400,
                          fontStyle: ctaTypo.italic ? 'italic' : 'normal',
                          marginTop: editorPxToDvh(4),
                        }}>{designCtaSubText || brd?.ctaText || branding.ctaText || 'CHAT POUR PLUS D\'INFOS'}</p>
                      </div>
                      {/* Logo sur CTA — per-sequence position */}
                      {designLogoUrl && designLogoSequences?.includes('cta') && (
                        <img src={designLogoUrl} alt="Logo" style={{
                          position: 'absolute',
                          height: editorPxToDvh(32 * designLogoScale),
                          width: 'auto',
                          maxWidth: editorPxToDvh(60 * designLogoScale),
                          objectFit: 'contain',
                          left: `${getCalLogoPos('cta').x}%`,
                          top: `${getCalLogoPos('cta').y}%`,
                          transform: 'translate(-50%, -50%)',
                          zIndex: 20,
                        }} />
                      )}
                    </div>

                    {/* === Texte site web — affiché selon les séquences configurées === */}
                    {siteTextConfig.enabled && siteTextConfig.text && siteTextSeqs.includes(currentSeq) && (
                      <div className="absolute z-30 pointer-events-none" style={{
                        left: `${getCalSiteTextPos(currentSeq).x}%`,
                        top: `${getCalSiteTextPos(currentSeq).y}%`,
                        transform: 'translate(-50%, -50%)',
                      }}>
                        <p className="font-bold tracking-wider whitespace-nowrap" style={{
                          fontSize: editorPxToDvh(12 * (siteTextConfig.size || 1.0)),
                          color: siteTextConfig.color || '#FFFFFF',
                          opacity: siteTextConfig.opacity ?? 0.7,
                          textShadow: `0 0 10px ${(siteTextConfig.color || '#FFFFFF')}40, 0 2px 4px rgba(0,0,0,0.8)`,
                        }}>{siteTextConfig.text}</p>
                      </div>
                    )}

                    {/* Play/Pause + Volume — top-right overlay */}
                    <div className="absolute top-3 right-3 z-40 flex items-center gap-1.5">
                      <button className="w-7 h-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center hover:bg-black/50 transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMontageMuted(m => {
                            const newMuted = !m;
                            // Synchroniser tous les éléments vidéo et audio
                            document.querySelectorAll<HTMLVideoElement>('#preview-video-infographic, #preview-video').forEach(v => { v.muted = newMuted; });
                            document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice, #preview-audio-rendered').forEach(a => {
                              a.muted = newMuted;
                              if (!newMuted) {
                                // Si l'élément n'est pas encore chargé, attendre le chargement avant play()
                                if (a.readyState < 2) {
                                  // Forcer le chargement si pas encore fait
                                  if (a.readyState === 0) a.load();
                                  // Attendre que l'audio soit prêt puis jouer
                                  const onReady = () => {
                                    a.removeEventListener('canplay', onReady);
                                    a.play().catch(() => {});
                                  };
                                  a.addEventListener('canplay', onReady);
                                  // Timeout de sécurité — si ça charge pas en 5s, on abandonne silencieusement
                                  setTimeout(() => a.removeEventListener('canplay', onReady), 5000);
                                } else {
                                  // Déjà chargé — jouer immédiatement
                                  a.play().catch(() => {});
                                }
                              }
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
                            document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice, #preview-audio-rendered').forEach(a => {
                              a.currentTime = 0;
                              if (a.readyState >= 2) {
                                a.play().catch(() => {});
                              } else {
                                const onReady = () => { a.removeEventListener('canplay', onReady); a.play().catch(() => {}); };
                                a.addEventListener('canplay', onReady);
                                if (a.readyState === 0) a.load();
                                setTimeout(() => a.removeEventListener('canplay', onReady), 5000);
                              }
                            });
                          }
                        }}
                      >
                        {montageAutoPlay ? <span className="text-white text-[10px] font-bold">❚❚</span> : <Play size={12} className="text-white ml-0.5" fill="white" />}
                      </button>
                    </div>

                    {/* Continuous progress bar — CSS animation only, no React re-renders */}
                    {(() => {
                      const startPct = (safeIdx / seqOrder.length) * 100;
                      const endPct = ((safeIdx + 1) / seqOrder.length) * 100;
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
                  fullPreviewPost.format === 'reel' ? '' : 'aspect-video w-full'
                }`}
                style={{
                  ...(fullPreviewPost.format === 'reel' ? { aspectRatio: '9/16', height: '70dvh', maxHeight: '70dvh' } : {}),
                  border: borderCol ? `3px solid ${borderCol}` : undefined,
                  boxShadow: borderCol
                    ? `0 0 30px ${borderCol}40, 0 0 60px ${borderCol}15`
                    : `0 0 30px ${accent}4D, 0 0 60px ${accent}1A`,
                }}
              >
                {/* Background layer — use poster image, NOT the rendered montage video.
                    The rendered montage (.webm) is played as the full montage sequence (intro/cards/video/cta).
                    Loading it as background wastes a browser connection and blocks the rush video from loading. */}
                {(() => {
                  const posterImgSrc = meta?.pexelsUrl || meta?.posterUrl || meta?.characterUrl || null;
                  // Use raw rush video for background ONLY (never the rendered montage)
                  const rawVideoSrc = meta?.rawVideoUrl || meta?.rushUrls?.[0] || null;
                  // Fallback: media_url ONLY if it's NOT a rendered montage (avoid loading corrupted WebM)
                  const isRenderedMontage = fullPreviewPost.media_url && meta?.renderedVideoUrl && fullPreviewPost.media_url === meta.renderedVideoUrl;
                  const bgVideoSrc = !isRenderedMontage && fullPreviewPost.media_type === 'video' && fullPreviewPost.media_url
                    ? fullPreviewPost.media_url
                    : null;
                  const imgSrc = posterImgSrc || (!bgVideoSrc ? fullPreviewPost.media_url : null);

                  return (
                    <>
                      {posterImgSrc && (
                        <img src={posterImgSrc} alt="Poster" className="absolute inset-0 w-full h-full object-cover" />
                      )}
                      {!posterImgSrc && bgVideoSrc ? (
                        <video id="preview-video" src={bgVideoSrc} muted loop playsInline autoPlay preload="metadata" className="absolute inset-0 w-full h-full object-cover"
                          onLoadedData={(e) => { const v = e.target as HTMLVideoElement; console.log('[Calendar] BG video loaded, readyState:', v.readyState); v.play().catch(() => {}); }}
                        />
                      ) : !posterImgSrc && imgSrc ? (
                        <img src={imgSrc} alt={fullPreviewPost.title} className="absolute inset-0 w-full h-full object-cover" />
                      ) : !posterImgSrc ? (
                        <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-black to-pink-900" />
                      ) : null}
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
                          // Jouer aussi les pistes audio (y compris le rendu vidéo)
                          document.querySelectorAll<HTMLMediaElement>('#preview-audio-music, #preview-audio-voice, #preview-audio-rendered').forEach(a => {
                            a.muted = false;
                            // Attendre le chargement avant de jouer
                            if (a.readyState < 2) {
                              if (a.readyState === 0) a.load();
                              const onReady = () => { a.removeEventListener('canplay', onReady); a.play().catch(() => {}); };
                              a.addEventListener('canplay', onReady);
                              setTimeout(() => a.removeEventListener('canplay', onReady), 5000);
                            } else {
                              a.play().catch(() => {});
                            }
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

            {/* Right: Post Details (below on mobile, sidebar on desktop) */}
            <div className="w-full md:w-80 p-4 md:p-6 flex flex-col border-t md:border-t-0 md:border-l border-gray-800">
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
                    <Film className="w-3 h-3" /> {t('fullPreview.sequences', { count: String([...new Set((meta?.sequences?.order || ['intro', 'cards', 'video']).map((s: string) => ({ titre: 'intro', cartes: 'cards', video: 'video', cta: 'cta' }[s] || s)).filter((s: string) => { const dur = meta?.sequences?.[s]; return dur === undefined || dur > 0; }))].length) })} • {meta?.sequences?.total || 30}s
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
                    onClick={() => { window.location.href = `/dashboard/creer?postId=${fullPreviewPost.id}&tab=audio`; }}
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
// force redeploy 1776495506
