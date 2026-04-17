'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Loader2,
  Folder,
  FileVideo,
  Image as ImageIcon,
  Music,
  CalendarDays,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useBranding } from '@/lib/hooks/useBranding';
import { useCreatorPreferences } from '@/lib/hooks/useCreatorPreferences';
import { BrandingIndicator } from '@/components/shared/BrandingIndicator';
import { composeAndUpload } from '@/lib/video-composer';
import { useTranslations, useLocale } from '@/i18n/client';
import { getContentPools } from '@/lib/i18n-content';

const AGENT_THEMES = [
  { id: 'sommeil-sport', label: 'Sommeil & Sport', emoji: '😴' },
  { id: 'nutrition-danse', label: 'Nutrition & Danse', emoji: '🍎' },
  { id: 'energie-cardio', label: 'Énergie & Cardio', emoji: '⚡' },
  { id: 'stress-mental', label: 'Stress & Mental', emoji: '🧠' },
  { id: 'communaute', label: 'Communauté', emoji: '👥' },
  { id: 'beauty', label: 'Beauté', emoji: '💄' },
  { id: 'parenting', label: 'Parentalité', emoji: '👶' },
  { id: 'travel', label: 'Voyage', emoji: '✈️' },
  { id: 'productivity', label: 'Productivité', emoji: '🚀' },
  { id: 'finance', label: 'Finance', emoji: '💰' },
  { id: 'coding', label: 'Coding', emoji: '💻' },
  { id: 'crypto', label: 'Crypto', emoji: '🪙' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },
  { id: 'food', label: 'Food', emoji: '🍕' },
  { id: 'pets', label: 'Animaux', emoji: '🐾' },
  { id: 'cars', label: 'Auto', emoji: '🚗' },
  { id: 'realestate', label: 'Immobilier', emoji: '🏠' },
  { id: 'education', label: 'Éducation', emoji: '📚' },
  { id: 'astrology', label: 'Astrologie', emoji: '🔮' },
  { id: 'motivation', label: 'Motivation', emoji: '🔥' },
];

interface AgentIAModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after posts have been generated and persisted. Use this to refresh
   *  parent-page data (e.g. calendar.fetchPosts). */
  onAfterGenerate?: () => void | Promise<void>;
}

export function AgentIAModal({ isOpen, onClose, onAfterGenerate }: AgentIAModalProps) {
  const router = useRouter();
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { branding } = useBranding();
  const { prefs, updatePrefs, loaded: prefsLoaded } = useCreatorPreferences();
  const prefsAppliedRef = useRef(false);

  const [aiPlanDuration, setAiPlanDuration] = useState<'7' | '14' | '30'>('30');
  const [aiPlatforms, setAiPlatforms] = useState<string[]>(['Instagram']);
  const [aiObjectives, setAiObjectives] = useState<string[]>(['promo']);
  const [aiRushFiles, setAiRushFiles] = useState<File[]>([]);
  const [aiMusicFile, setAiMusicFile] = useState<File | null>(null);
  const [aiPhotoAffiche, setAiPhotoAffiche] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiStage, setAiStage] = useState('');
  const [montageMode, setMontageMode] = useState(false);
  const [montageDuration, setMontageDuration] = useState<15 | 20 | 30>(20);
  const [montageCount, setMontageCount] = useState(1);
  const [customPrompt, setCustomPrompt] = useState('');

  const rushInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!prefsLoaded || prefsAppliedRef.current) return;
    prefsAppliedRef.current = true;
    if (prefs.aiPlanDuration) setAiPlanDuration(prefs.aiPlanDuration);
    if (prefs.aiPlatforms && prefs.aiPlatforms.length > 0) setAiPlatforms(prefs.aiPlatforms);
    if (prefs.aiObjectives && prefs.aiObjectives.length > 0) setAiObjectives(prefs.aiObjectives);
  }, [prefsLoaded]);

  useEffect(() => {
    if (!prefsAppliedRef.current) return;
    updatePrefs({ aiPlanDuration, aiPlatforms, aiObjectives });
  }, [aiPlanDuration, aiPlatforms, aiObjectives]);

  const toggleAiPlatform = (p: string) => {
    setAiPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const toggleAiObjective = (o: string) => {
    setAiObjectives((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));
  };

  const handleMontagGenerate = async () => {
    if (aiRushFiles.length === 0) return;
    setAiGenerating(true);
    setAiProgress(0);
    setAiStage('Upload des rushes...');
    try {
      // 1. Upload all rush files
      const rushUrls: string[] = [];
      for (let i = 0; i < aiRushFiles.length; i++) {
        setAiStage(`Upload rush ${i + 1}/${aiRushFiles.length}...`);
        const file = aiRushFiles[i];
        try {
          const signRes = await fetch('/api/upload/signed-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, contentType: file.type, purpose: 'rush' }),
          });
          const signData = await signRes.json();
          if (signData.success) {
            await fetch(signData.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
            rushUrls.push(signData.publicUrl);
          }
        } catch {}
        setAiProgress(Math.round(((i + 1) / (aiRushFiles.length + montageCount + 1)) * 100));
      }

      // 2. Upload music
      let musicUrl: string | null = null;
      if (aiMusicFile) {
        setAiStage('Upload musique...');
        try {
          const signRes = await fetch('/api/upload/signed-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: aiMusicFile.name, contentType: aiMusicFile.type, purpose: 'music' }),
          });
          const signData = await signRes.json();
          if (signData.success) {
            await fetch(signData.signedUrl, { method: 'PUT', headers: { 'Content-Type': aiMusicFile.type }, body: aiMusicFile });
            musicUrl = signData.publicUrl;
          }
        } catch {}
      }

      const theme = aiObjectives[0] || 'motivation';

      // Fetch poster URL if user enabled it
      let posterUrl: string | null = null;
      if (aiPhotoAffiche) {
        const themeObj = AGENT_THEMES.find(t => t.id === theme);
        const query = themeObj?.label || theme || 'fitness';
        try {
          const pxRes = await fetch(`/api/pexels?query=${encodeURIComponent(query)}&count=5`);
          const pxData = await pxRes.json();
          if (pxData.success && pxData.photos?.length > 0) posterUrl = pxData.photos[0]?.url || null;
        } catch {}
      }

      // Single server-side call — Remotion renders everything
      setAiStage(`Rendu IA en cours... jusqu'à ${montageCount > 1 ? montageCount * 2 : 3} minutes`);
      setAiProgress(80);

      const res = await fetch('/api/agent/montage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rushUrls,
          count: montageCount,
          duration: montageDuration,
          theme,
          customPrompt: customPrompt || undefined,
          musicUrl,
          posterUrl,
          platforms: aiPlatforms,
          subtitle: AGENT_THEMES.find(t => t.id === theme)?.label || '',
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setAiStage(`Erreur : ${data.error || 'Rendu échoué'}`);
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        setAiStage(`Montage terminé ! ${data.postIds?.length || 0} vidéo(s) créée(s). Redirection...`);
        setAiProgress(100);
        await new Promise((r) => setTimeout(r, 1000));
        if (onAfterGenerate) await onAfterGenerate();
        onClose();
        router.push('/dashboard/calendar');
        return;
      }
    } catch (err) {
      console.error('[AgentIA Montage] Error:', err);
      setAiStage('Erreur de génération');
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      setAiGenerating(false);
      setAiProgress(0);
      setAiStage('');
    }
  };

  const handleAIGenerate = async () => {
    if (aiRushFiles.length === 0) return;
    if (montageMode) { handleMontagGenerate(); return; }
    setAiGenerating(true);
    setAiProgress(0);
    setAiStage(t('aiAgent.stages.preparing'));
    try {
      const days = parseInt(aiPlanDuration);
      const postsToCreate = Math.min(days, 30);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 1);
      const totalSteps =
        aiRushFiles.length + (aiMusicFile ? 1 : 0) + (aiPhotoAffiche ? 1 : 0) + postsToCreate;
      let completedSteps = 0;

      // --- 1. Upload rush files ---
      setAiStage(t('aiAgent.stages.uploadingRush', { current: '0', total: String(aiRushFiles.length) }));
      const rushUrls: string[] = [];
      for (let fi = 0; fi < aiRushFiles.length; fi++) {
        setAiStage(t('aiAgent.stages.uploadingRush', { current: String(fi + 1), total: String(aiRushFiles.length) }));
        const rushFile = aiRushFiles[fi];
        try {
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
        } catch (err) {
          console.error('Rush upload error:', err);
        }
        completedSteps++;
        setAiProgress(Math.round((completedSteps / totalSteps) * 100));
      }

      // --- 2. Upload music ---
      let musicUrl: string | null = null;
      if (aiMusicFile) {
        setAiStage(t('aiAgent.stages.uploadingMusic'));
        try {
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
        } catch (err) {
          console.error('Music upload error:', err);
        }
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
          } catch (err) {
            console.error('Pexels fetch error:', err);
          }
        }
        completedSteps++;
        setAiProgress(Math.round((completedSteps / totalSteps) * 100));
      }

      // --- Variation pools per objective ---
      const contentPools = getContentPools(locale as 'fr' | 'en' | 'de');
      const titlePools = contentPools.titles;
      const subtitlePools = contentPools.subtitles;
      const phrasePools = contentPools.phrases;
      const objectiveLabels = contentPools.objectiveLabels;

      const pickRandom = (arr: string[], exclude: string[] = []) => {
        const filtered = arr.filter((x) => !exclude.includes(x));
        const pool = filtered.length > 0 ? filtered : arr;
        return pool[Math.floor(Math.random() * pool.length)] || '';
      };
      const usedTitles: string[] = [];

      // --- 4. Compose + Create posts ---
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
        const mediaType = rushFile?.type?.startsWith('image/') ? ('image' as const) : ('video' as const);

        setAiStage(t('aiAgent.stages.composingVideo', { current: String(i + 1), total: String(postsToCreate), title: bTitle }));

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
              ctaText: branding.ctaText || "CHAT POUR PLUS D'INFOS",
              ctaSubText: branding.ctaSubText || 'LIEN EN BIO',
              watermarkText: branding.watermarkText || undefined,
              design: {
                font: (branding as any).font || undefined,
                titleColor: (branding as any).titleColor || undefined,
                gradientColor1: (branding as any).gradientColor1 || undefined,
                gradientColor2: (branding as any).gradientColor2 || undefined,
                ctaSubColor: (branding as any).ctaSubColor || undefined,
              },
              onProgress: (_pct, stage) => {
                setAiStage(t('aiAgent.stages.videoStage', { current: String(i + 1), total: String(postsToCreate), stage }));
              },
            });
            if (url) renderedVideoUrl = url;
          } catch (err) {
            console.error(`[Agent IA] Compose error post ${i + 1}:`, err);
          }
        }

        const postMediaUrl = renderedVideoUrl || posterUrl || null;
        if (!renderedVideoUrl) console.warn('[Agent IA] Montage URL is null — upload may have failed');
        await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: bTitle,
            caption: `${bSubtitle}\n${bPhrase}\n\n#${objectiveLabels[objective]} #Afroboost #${platform}`,
            media_url: postMediaUrl,
            media_type: renderedVideoUrl ? 'video' : rushUrl ? mediaType : posterUrl ? 'image' : 'video',
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
                intro: 5,
                cards: 0,
                video: 12,
                cta: 5,
                total: 22,
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
        try {
          await fetch('/api/videos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: bTitle,
              format: 'reel',
              type: 'creator',
              status: renderedVideoUrl ? 'completed' : 'draft',
              video_url: renderedVideoUrl || null,
              thumbnail_url: posterUrl || null,
              metadata: {
                title: bTitle,
                subtitle: bSubtitle,
                salesPhrase: bPhrase,
                objective,
                posterPhotoUrl: posterUrl || null,
                characterUrl: posterUrl || null,
                rushUrls: rushUrls.length > 0 ? rushUrls : [],
                musicUrl: musicUrl || null,
                renderedVideoUrl: renderedVideoUrl || null,
              },
            }),
          });
        } catch (vidErr) {
          console.error(`[Agent IA] Video record creation failed:`, vidErr);
        }

        completedSteps++;
        setAiProgress(Math.round((completedSteps / totalSteps) * 100));
      }

      setAiStage(t('aiAgent.stages.done'));
      setAiProgress(100);
      await new Promise((r) => setTimeout(r, 800));
      if (onAfterGenerate) await onAfterGenerate();
    } catch (error) {
      console.error('AI generation error:', error);
    } finally {
      setAiGenerating(false);
      setAiProgress(0);
      setAiStage('');
      onClose();
    }
  };

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={rushInputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) setAiRushFiles(Array.from(e.target.files));
        }}
      />
      <input
        ref={musicInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) setAiMusicFile(e.target.files[0]);
        }}
      />

      <Modal isOpen={isOpen} onClose={onClose} title="" size="lg">
        <div>
          <div className="text-center mb-4">
            <h2 className="text-lg font-bold flex items-center justify-center gap-2">
              <span
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ backgroundColor: '#3B82F620', color: '#3B82F6' }}
              >
                <CalendarDays size={16} />
              </span>
              {t('aiAgent.title')}
            </h2>
            <p className="text-gray-400 text-xs mt-1">{t('aiAgent.description')}</p>
          </div>

          {/* Dossier de Rushes */}
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
                  <span className="text-sm text-white font-medium">
                    {t('aiAgent.filesCount', { count: String(aiRushFiles.length) })}
                  </span>
                  <div className="flex flex-wrap gap-1 justify-center mt-1.5">
                    {aiRushFiles.slice(0, 6).map((f, i) => (
                      <span key={i} className="text-[9px] bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded truncate max-w-[80px]">
                        {f.type.startsWith('video/') ? (
                          <FileVideo className="inline w-2.5 h-2.5 mr-0.5" />
                        ) : (
                          <ImageIcon className="inline w-2.5 h-2.5 mr-0.5" />
                        )}
                        {f.name.slice(0, 10)}
                      </span>
                    ))}
                    {aiRushFiles.length > 6 && (
                      <span className="text-[9px] text-gray-400">+{aiRushFiles.length - 6}</span>
                    )}
                  </div>
                </div>
              ) : (
                <span className="text-sm text-gray-400">{t('aiAgent.selectVideosOrImages')}</span>
              )}
            </button>
          </div>

          {/* Mode selector: Planning vs Montage */}
          <div className="flex gap-2 mb-4">
            <button onClick={() => setMontageMode(false)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition border ${!montageMode ? 'bg-purple-500/20 border-purple-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
              📅 Planning ({aiPlanDuration}j)
            </button>
            <button onClick={() => setMontageMode(true)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition border ${montageMode ? 'bg-pink-500/20 border-pink-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
              🎬 Montage IA
            </button>
          </div>

          {/* Montage mode options */}
          {montageMode && (
            <div className="mb-4 space-y-3 rounded-lg border border-pink-500/20 bg-pink-500/5 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Nombre de montages</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMontageCount(Math.max(1, montageCount - 1))} disabled={montageCount <= 1}
                      className="h-8 w-8 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 font-bold">−</button>
                    <span className="text-lg font-bold text-pink-400 w-8 text-center">{montageCount}</span>
                    <button onClick={() => setMontageCount(Math.min(30, montageCount + 1))} disabled={montageCount >= 30}
                      className="h-8 w-8 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 font-bold">+</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Durée par vidéo</label>
                  <div className="flex gap-1">
                    {([15, 20, 30] as const).map((d) => (
                      <button key={d} onClick={() => setMontageDuration(d)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${montageDuration === d ? 'bg-gradient-to-r from-pink-600 to-purple-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                        {d}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Prompt personnalisé (optionnel)</label>
                <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Ex: montre l'ambiance joyeuse du cours de danse, focus sur les sourires"
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-pink-500 focus:outline-none resize-none" rows={2} />
              </div>
            </div>
          )}

          {/* Compact config — two columns */}
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
                <label className="block text-xs text-gray-400 mb-1.5">Thèmes de contenu</label>
                <div className="grid grid-cols-2 gap-1 max-h-[180px] overflow-y-auto pr-1">
                  {AGENT_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => toggleAiObjective(theme.id)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition border ${
                        aiObjectives.includes(theme.id)
                          ? 'bg-purple-500/20 border-purple-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      <span>{theme.emoji}</span>
                      <span className="truncate">{theme.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Photo affiche toggle */}
              <div>
                <button
                  onClick={() => setAiPhotoAffiche(!aiPhotoAffiche)}
                  className={`w-full py-2 rounded-lg text-xs font-medium transition border ${
                    aiPhotoAffiche
                      ? 'bg-pink-500/20 border-pink-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
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

          {/* Branding indicator */}
          <div className="mb-4">
            <BrandingIndicator branding={branding} />
          </div>

          {/* Progress bar */}
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
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => !aiGenerating && onClose()}
              disabled={aiGenerating}
            >
              {tc('cancel')}
            </Button>
            <button
              onClick={handleAIGenerate}
              disabled={aiGenerating || aiRushFiles.length === 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 disabled:opacity-50 rounded-lg text-sm font-bold transition"
            >
              {aiGenerating ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
              {aiGenerating
                ? t('aiAgent.generating')
                : montageMode
                  ? `Générer (${montageCount} vidéo${montageCount > 1 ? 's' : ''})`
                  : t('aiAgent.generateWithDays', { days: aiPlanDuration })}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default AgentIAModal;
