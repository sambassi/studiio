'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';
import {
  Upload, X, Play, Film, GripVertical, Plus, Trash2,
  Zap, Target, Eye, Heart, TrendingUp, ChevronRight,
  Volume2, Type, Image, Clock, Loader2, AlertCircle,
  Music, Mic, Sparkles, LayoutGrid
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────
interface VideoSlot {
  id: string;
  file: File | null;
  preview: string | null;
  duration: number;
  startTime: number;
  name: string;
}

interface TimelineItem {
  id: string;
  type: 'video' | 'text';
  slotIndex?: number;
  text?: string;
  duration: number;
}

type VideoFormat = 'reel' | 'tv';
type VideoMode = 'cardio' | 'temoignage';
type Objective = 'promotion' | 'abonnement' | 'motivation' | 'bienfaits' | 'nutrition';

const OBJECTIVES: { value: Objective; label: string; icon: any; color: string; description: string }[] = [
  { value: 'promotion', label: 'Promotion', icon: TrendingUp, color: 'text-orange-400', description: 'Promouvoir un produit ou service' },
  { value: 'abonnement', label: 'Abonnement', icon: Heart, color: 'text-pink-400', description: 'Gagner des abonn\u00e9s' },
  { value: 'motivation', label: 'Motivation', icon: Zap, color: 'text-yellow-400', description: 'Inspirer et motiver' },
  { value: 'bienfaits', label: 'Bienfaits', icon: Eye, color: 'text-green-400', description: 'Mettre en avant les bienfaits' },
  { value: 'nutrition', label: 'Nutrition', icon: Target, color: 'text-blue-400', description: 'Conseils nutrition et sant\u00e9' },
];

const MAX_SLOTS = 10;
const DEFAULT_CLIP_DURATION = 3;
const TEXT_CARD_DURATION = 1;

// ─── Component ───────────────────────────────────────────────────
export default function CreatorPage() {
  const { data: session } = useSession();

  // Step management
  const [step, setStep] = useState<'setup' | 'media' | 'timeline' | 'preview'>('setup');

  // Video settings
  const [format, setFormat] = useState<VideoFormat>('reel');
  const [mode, setMode] = useState<VideoMode>('cardio');
  const [objective, setObjective] = useState<Objective>('promotion');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');

  // Media slots (up to 10 rush clips)
  const [slots, setSlots] = useState<VideoSlot[]>(
    Array.from({ length: 3 }, (_, i) => ({
      id: `slot-${i}`,
      file: null,
      preview: null,
      duration: 0,
      startTime: 0,
      name: '',
    }))
  );

  // Timeline
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [textCards, setTextCards] = useState<string[]>(['']);

  // Audio
  const [bgMusic, setBgMusic] = useState<File | null>(null);
  const [voiceOver, setVoiceOver] = useState<File | null>(null);
  const [characterImage, setCharacterImage] = useState<File | null>(null);
  const [characterPreview, setCharacterPreview] = useState<string | null>(null);

  // Rendering state
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // File input refs
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Fetch credits
  useEffect(() => {
    async function fetchCredits() {
      try {
        const res = await fetch('/api/credits/balance');
        const data = await res.json();
        if (data.success) setCredits(data.data?.credits || 0);
      } catch { /* silently fail */ }
    }
    fetchCredits();
  }, []);

  // ─── Handlers ────────────────────────────────────────────────
  const handleVideoUpload = useCallback((slotIndex: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    // Create preview URL
    const preview = URL.createObjectURL(file);

    // Get video duration
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      setSlots(prev => prev.map((slot, i) =>
        i === slotIndex
          ? { ...slot, file, preview, duration: video.duration, name: file.name }
          : slot
      ));
    };
    video.src = URL.createObjectURL(file);
  }, []);

  const addSlot = useCallback(() => {
    if (slots.length >= MAX_SLOTS) return;
    setSlots(prev => [...prev, {
      id: `slot-${Date.now()}`,
      file: null,
      preview: null,
      duration: 0,
      startTime: 0,
      name: '',
    }]);
  }, [slots.length]);

  const removeSlot = useCallback((index: number) => {
    if (slots.length <= 1) return;
    setSlots(prev => {
      const newSlots = [...prev];
      if (newSlots[index].preview) URL.revokeObjectURL(newSlots[index].preview!);
      newSlots.splice(index, 1);
      return newSlots;
    });
  }, [slots.length]);

  const buildTimeline = useCallback(() => {
    const filledSlots = slots.filter(s => s.file !== null);
    const items: TimelineItem[] = [];

    filledSlots.forEach((slot, i) => {
      const slotIndex = slots.indexOf(slot);
      items.push({
        id: `vid-${slotIndex}`,
        type: 'video',
        slotIndex,
        duration: Math.min(slot.duration, DEFAULT_CLIP_DURATION),
      });

      // Add text card between clips (if text exists)
      if (i < filledSlots.length - 1 && textCards[i]) {
        items.push({
          id: `txt-${i}`,
          type: 'text',
          text: textCards[i],
          duration: TEXT_CARD_DURATION,
        });
      }
    });

    setTimeline(items);
  }, [slots, textCards]);

  // Auto-build timeline when moving to timeline step
  useEffect(() => {
    if (step === 'timeline') {
      buildTimeline();
    }
  }, [step, buildTimeline]);

  const addTextCard = useCallback(() => {
    setTextCards(prev => [...prev, '']);
  }, []);

  const updateTextCard = useCallback((index: number, text: string) => {
    setTextCards(prev => prev.map((t, i) => i === index ? text : t));
  }, []);

  const removeTextCard = useCallback((index: number) => {
    setTextCards(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleCharacterImage = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setCharacterImage(file);
    setCharacterPreview(URL.createObjectURL(file));
  }, []);

  const totalDuration = timeline.reduce((acc, item) => acc + item.duration, 0);
  const filledSlotsCount = slots.filter(s => s.file !== null).length;
  const renderCost = format === 'reel' ? 10 : 15;
  const canRender = filledSlotsCount > 0 && title.trim() && objective && (credits !== null && credits >= renderCost);

  // ─── Submit render ────────────────────────────────────────────
  const handleRender = async () => {
    if (!canRender || isRendering) return;
    setIsRendering(true);
    setRenderProgress(0);
    setError(null);

    try {
      // Upload files to temp storage
      const formData = new FormData();
      formData.append('title', title);
      formData.append('subtitle', subtitle);
      formData.append('format', format);
      formData.append('mode', mode);
      formData.append('objective', objective);
      formData.append('timeline', JSON.stringify(timeline));
      formData.append('textCards', JSON.stringify(textCards.filter(t => t.trim())));

      slots.forEach((slot, i) => {
        if (slot.file) {
          formData.append(`video_${i}`, slot.file);
        }
      });

      if (bgMusic) formData.append('bgMusic', bgMusic);
      if (voiceOver) formData.append('voiceOver', voiceOver);
      if (characterImage) formData.append('characterImage', characterImage);

      // Simulate progress while uploading
      const progressInterval = setInterval(() => {
        setRenderProgress(prev => Math.min(prev + 2, 90));
      }, 500);

      const res = await fetch('/api/videos/render', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Erreur lors du rendu');
      }

      setRenderProgress(100);

      // Redirect to library after success
      setTimeout(() => {
        window.location.href = '/dashboard/library';
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
      setIsRendering(false);
      setRenderProgress(0);
    }
  };

  // ─── Step Navigation ──────────────────────────────────────────
  const steps = [
    { id: 'setup', label: 'Configuration', number: 1 },
    { id: 'media', label: 'M\u00e9dias', number: 2 },
    { id: 'timeline', label: 'Timeline', number: 3 },
    { id: 'preview', label: 'Aper\u00e7u & Rendu', number: 4 },
  ] as const;

  const canProceed = {
    setup: !!title.trim() && !!objective,
    media: filledSlotsCount > 0,
    timeline: timeline.length > 0,
    preview: canRender,
  };

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Cr\u00e9er une vid\u00e9o</h1>
        <p className="text-gray-400">Cr\u00e9ez des vid\u00e9os virales en quelques \u00e9tapes</p>
      </div>

      {/* Step Progress */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center">
            <button
              onClick={() => setStep(s.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition text-sm font-medium ${
                step === s.id
                  ? 'bg-studiio-primary/20 text-studiio-primary border border-studiio-primary/40'
                  : steps.findIndex(x => x.id === step) > i
                    ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                    : 'bg-gray-800 text-gray-500 border border-gray-700'
              }`}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step === s.id ? 'bg-studiio-primary text-white' :
                steps.findIndex(x => x.id === step) > i ? 'bg-green-500 text-white' :
                'bg-gray-700 text-gray-400'
              }`}>{s.number}</span>
              {s.label}
            </button>
            {i < steps.length - 1 && <ChevronRight size={16} className="text-gray-600 mx-1" />}
          </div>
        ))}
      </div>

      {/* ─── STEP 1: Configuration ─── */}
      {step === 'setup' && (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            {/* Format */}
            <Card>
              <CardHeader className="border-b border-gray-800">
                <CardTitle>Format vid\u00e9o</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setFormat('reel')}
                    className={`p-5 rounded-xl border-2 transition text-left ${
                      format === 'reel'
                        ? 'border-studiio-primary bg-studiio-primary/10'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-6 h-10 border-2 border-current rounded-md" />
                      <div>
                        <p className="font-bold text-white">Reel 9:16</p>
                        <p className="text-xs text-gray-400">Instagram, TikTok, Shorts</p>
                      </div>
                    </div>
                    <Badge variant="primary">10 cr\u00e9dits</Badge>
                  </button>
                  <button
                    onClick={() => setFormat('tv')}
                    className={`p-5 rounded-xl border-2 transition text-left ${
                      format === 'tv'
                        ? 'border-studiio-primary bg-studiio-primary/10'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-6 border-2 border-current rounded-md" />
                      <div>
                        <p className="font-bold text-white">TV 16:9</p>
                        <p className="text-xs text-gray-400">YouTube, Facebook</p>
                      </div>
                    </div>
                    <Badge variant="primary">15 cr\u00e9dits</Badge>
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Mode */}
            <Card>
              <CardHeader className="border-b border-gray-800">
                <CardTitle>Style de montage</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setMode('cardio')}
                    className={`p-4 rounded-xl border-2 transition text-left ${
                      mode === 'cardio'
                        ? 'border-studiio-accent bg-studiio-accent/10'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <Zap className="mb-2 text-studiio-accent" size={24} />
                    <p className="font-bold text-white">Cardio / Dynamique</p>
                    <p className="text-xs text-gray-400 mt-1">Montage rapide, transitions punch\u00e9es</p>
                  </button>
                  <button
                    onClick={() => setMode('temoignage')}
                    className={`p-4 rounded-xl border-2 transition text-left ${
                      mode === 'temoignage'
                        ? 'border-studiio-accent bg-studiio-accent/10'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <Mic className="mb-2 text-studiio-accent" size={24} />
                    <p className="font-bold text-white">T\u00e9moignage / Clean</p>
                    <p className="text-xs text-gray-400 mt-1">Montage sobre, focus contenu</p>
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Objectif */}
            <Card>
              <CardHeader className="border-b border-gray-800">
                <CardTitle>Objectif marketing</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-5 gap-3">
                  {OBJECTIVES.map((obj) => {
                    const Icon = obj.icon;
                    return (
                      <button
                        key={obj.value}
                        onClick={() => setObjective(obj.value)}
                        className={`p-3 rounded-xl border-2 transition text-center ${
                          objective === obj.value
                            ? 'border-studiio-primary bg-studiio-primary/10'
                            : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                        }`}
                      >
                        <Icon className={`mx-auto mb-1 ${obj.color}`} size={20} />
                        <p className="text-xs font-medium text-white">{obj.label}</p>
                      </button>
                    );
                  })}
                </div>
                {objective && (
                  <p className="text-xs text-gray-400 mt-3">
                    {OBJECTIVES.find(o => o.value === objective)?.description}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Titre & sous-titre */}
            <Card>
              <CardHeader className="border-b border-gray-800">
                <CardTitle>Texte de la vid\u00e9o</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <Input
                  label="Titre principal"
                  placeholder="Ex: Transforme ton corps en 30 jours"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <Input
                  label="Sous-titre (optionnel)"
                  placeholder="Ex: Programme fitness complet"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="border-studiio-accent/30">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-gray-400">Cr\u00e9dits disponibles</p>
                  <Zap className="text-studiio-accent" size={20} />
                </div>
                <p className="text-3xl font-bold text-studiio-accent mb-1">
                  {credits !== null ? credits.toLocaleString() : '...'}
                </p>
                <p className="text-xs text-gray-500">Co\u00fbt de cette vid\u00e9o: {renderCost} cr\u00e9dits</p>
                {credits !== null && credits < renderCost && (
                  <Link href="/dashboard/billing" className="text-xs text-red-400 mt-2 block">
                    Cr\u00e9dits insuffisants \u2192 Recharger
                  </Link>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <h3 className="font-semibold text-white mb-3">R\u00e9sum\u00e9</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Format</span>
                    <span className="text-white">{format === 'reel' ? 'Reel 9:16' : 'TV 16:9'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Style</span>
                    <span className="text-white">{mode === 'cardio' ? 'Dynamique' : 'T\u00e9moignage'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Objectif</span>
                    <span className="text-white">{OBJECTIVES.find(o => o.value === objective)?.label || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Titre</span>
                    <span className="text-white truncate ml-2">{title || '-'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!canProceed.setup}
              onClick={() => setStep('media')}
            >
              Continuer <ChevronRight size={16} className="ml-1 inline" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 2: M\u00e9dias ─── */}
      {step === 'media' && (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            {/* Rush Slots */}
            <Card>
              <CardHeader className="border-b border-gray-800">
                <div className="flex items-center justify-between">
                  <CardTitle>Vos rushes vid\u00e9o ({filledSlotsCount}/{slots.length})</CardTitle>
                  {slots.length < MAX_SLOTS && (
                    <button
                      onClick={addSlot}
                      className="text-studiio-primary hover:text-purple-300 text-sm flex items-center gap-1"
                    >
                      <Plus size={16} /> Ajouter un slot
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {slots.map((slot, index) => (
                    <div
                      key={slot.id}
                      className={`relative rounded-xl border-2 border-dashed transition overflow-hidden ${
                        slot.file
                          ? 'border-green-500/40 bg-green-500/5'
                          : 'border-gray-700 bg-gray-800/30 hover:border-gray-500'
                      }`}
                    >
                      {slot.preview ? (
                        <div className="relative aspect-video">
                          <video
                            src={slot.preview}
                            className="w-full h-full object-cover rounded-lg"
                            muted
                            playsInline
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 p-2">
                            <p className="text-xs text-white truncate">{slot.name}</p>
                            <p className="text-xs text-gray-400">{slot.duration.toFixed(1)}s</p>
                          </div>
                          <button
                            onClick={() => {
                              if (slot.preview) URL.revokeObjectURL(slot.preview);
                              setSlots(prev => prev.map((s, i) =>
                                i === index ? { ...s, file: null, preview: null, duration: 0, name: '' } : s
                              ));
                            }}
                            className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-500 rounded-full p-1 transition"
                          >
                            <X size={14} className="text-white" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center aspect-video cursor-pointer p-4">
                          <Upload size={24} className="text-gray-500 mb-2" />
                          <p className="text-xs text-gray-500 text-center">Rush {index + 1}</p>
                          <p className="text-xs text-gray-600 text-center mt-1">Cliquez ou glissez</p>
                          <input
                            type="file"
                            accept="video/*"
                            className="hidden"
                            onChange={(e) => handleVideoUpload(index, e.target.files)}
                          />
                        </label>
                      )}
                      {slots.length > 1 && !slot.file && (
                        <button
                          onClick={() => removeSlot(index)}
                          className="absolute top-1 right-1 text-gray-600 hover:text-red-400 transition"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-4">
                  Importez jusqu&apos;\u00e0 {MAX_SLOTS} rushes vid\u00e9o. Formats accept\u00e9s: MP4, MOV, WebM
                </p>
              </CardContent>
            </Card>

            {/* Audio & Character Image */}
            <div className="grid grid-cols-2 gap-6">
              <Card>
                <CardHeader className="border-b border-gray-800">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Music size={18} /> Musique de fond
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {bgMusic ? (
                    <div className="flex items-center gap-2 bg-gray-800/50 rounded-lg p-3">
                      <Volume2 size={16} className="text-studiio-accent" />
                      <span className="text-sm text-white truncate flex-1">{bgMusic.name}</span>
                      <button onClick={() => setBgMusic(null)} className="text-gray-400 hover:text-red-400">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-gray-500 transition">
                      <Music size={24} className="text-gray-500 mb-2" />
                      <p className="text-xs text-gray-500">Ajouter une musique</p>
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => e.target.files && setBgMusic(e.target.files[0])}
                      />
                    </label>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b border-gray-800">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Image size={18} /> Image d&apos;intro
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {characterPreview ? (
                    <div className="relative">
                      <img src={characterPreview} alt="Character" className="w-full aspect-square object-cover rounded-lg" />
                      <button
                        onClick={() => { setCharacterImage(null); setCharacterPreview(null); }}
                        className="absolute top-2 right-2 bg-red-500/80 rounded-full p-1"
                      >
                        <X size={14} className="text-white" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-gray-500 transition">
                      <Image size={24} className="text-gray-500 mb-2" />
                      <p className="text-xs text-gray-500">Image personnage</p>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleCharacterImage(e.target.files)}
                      />
                    </label>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-semibold text-white mb-3">Rushes import\u00e9s</h3>
                <div className="text-center py-4">
                  <p className="text-4xl font-bold text-studiio-accent">{filledSlotsCount}</p>
                  <p className="text-xs text-gray-400 mt-1">vid\u00e9os charg\u00e9es</p>
                </div>
                {filledSlotsCount > 0 && (
                  <div className="space-y-1 mt-3">
                    {slots.filter(s => s.file).map((slot, i) => (
                      <div key={slot.id} className="flex items-center gap-2 text-xs text-gray-400">
                        <Play size={12} className="text-green-400" />
                        <span className="truncate">{slot.name}</span>
                        <span className="ml-auto">{slot.duration.toFixed(1)}s</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button variant="ghost" size="md" className="flex-1" onClick={() => setStep('setup')}>
                Retour
              </Button>
              <Button
                variant="primary"
                size="md"
                className="flex-1"
                disabled={!canProceed.media}
                onClick={() => setStep('timeline')}
              >
                Continuer <ChevronRight size={16} className="ml-1 inline" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── STEP 3: Timeline ─── */}
      {step === 'timeline' && (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader className="border-b border-gray-800">
                <div className="flex items-center justify-between">
                  <CardTitle>Timeline du montage</CardTitle>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Clock size={14} />
                    <span>Dur\u00e9e totale: {totalDuration.toFixed(1)}s</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {timeline.map((item, index) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border ${
                        item.type === 'video'
                          ? 'border-blue-500/30 bg-blue-500/5'
                          : 'border-purple-500/30 bg-purple-500/5'
                      }`}
                    >
                      <GripVertical size={16} className="text-gray-600" />
                      {item.type === 'video' ? (
                        <>
                          <div className="w-16 h-10 bg-gray-800 rounded overflow-hidden flex-shrink-0">
                            {item.slotIndex !== undefined && slots[item.slotIndex]?.preview && (
                              <video
                                src={slots[item.slotIndex].preview!}
                                className="w-full h-full object-cover"
                                muted
                              />
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm text-white font-medium">
                              {item.slotIndex !== undefined ? slots[item.slotIndex]?.name || `Rush ${item.slotIndex + 1}` : 'Vid\u00e9o'}
                            </p>
                            <p className="text-xs text-gray-400">{item.duration.toFixed(1)}s</p>
                          </div>
                          <Film size={16} className="text-blue-400" />
                        </>
                      ) : (
                        <>
                          <Type size={16} className="text-purple-400 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm text-white font-medium">Carte texte</p>
                            <p className="text-xs text-gray-400 truncate">{item.text || 'Texte vide'}</p>
                          </div>
                          <span className="text-xs text-gray-500">{item.duration}s</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Text Cards Editor */}
            <Card>
              <CardHeader className="border-b border-gray-800">
                <div className="flex items-center justify-between">
                  <CardTitle>Cartes texte</CardTitle>
                  <button
                    onClick={addTextCard}
                    className="text-studiio-primary hover:text-purple-300 text-sm flex items-center gap-1"
                  >
                    <Plus size={16} /> Ajouter
                  </button>
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                {textCards.map((text, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-6">{index + 1}.</span>
                    <input
                      type="text"
                      value={text}
                      onChange={(e) => updateTextCard(index, e.target.value)}
                      placeholder="Texte de la carte..."
                      className="input-base flex-1 text-sm"
                    />
                    <button
                      onClick={() => removeTextCard(index)}
                      className="text-gray-500 hover:text-red-400 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <p className="text-xs text-gray-500 mt-2">
                  Les cartes texte apparaissent entre les clips vid\u00e9o avec un effet n\u00e9on
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-semibold text-white mb-3">Composition</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Clips vid\u00e9o</span>
                    <span className="text-white">{timeline.filter(i => i.type === 'video').length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Cartes texte</span>
                    <span className="text-white">{timeline.filter(i => i.type === 'text').length}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-800">
                    <span className="text-gray-400">Dur\u00e9e totale</span>
                    <span className="text-studiio-accent font-bold">{totalDuration.toFixed(1)}s</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button variant="ghost" size="md" className="flex-1" onClick={() => setStep('media')}>
                Retour
              </Button>
              <Button
                variant="primary"
                size="md"
                className="flex-1"
                onClick={() => { buildTimeline(); setStep('preview'); }}
              >
                Continuer <ChevronRight size={16} className="ml-1 inline" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── STEP 4: Preview & Render ─── */}
      {step === 'preview' && (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            {/* Preview */}
            <Card>
              <CardHeader className="border-b border-gray-800">
                <CardTitle>Aper\u00e7u de la vid\u00e9o</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className={`w-full bg-gray-800/50 rounded-xl border border-gray-700 flex items-center justify-center mx-auto ${
                  format === 'reel' ? 'aspect-[9/16] max-w-[280px]' : 'aspect-video max-w-full'
                }`}>
                  <div className="text-center p-6">
                    <Sparkles className="mx-auto text-studiio-primary mb-3" size={32} />
                    <p className="text-white font-bold mb-1">{title}</p>
                    {subtitle && <p className="text-gray-400 text-sm mb-3">{subtitle}</p>}
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500">{filledSlotsCount} clips \u2022 {totalDuration.toFixed(0)}s \u2022 {format === 'reel' ? '1080\u00d71920' : '1920\u00d71080'}</p>
                      <p className="text-xs text-gray-500">
                        {OBJECTIVES.find(o => o.value === objective)?.label} \u2022 {mode === 'cardio' ? 'Dynamique' : 'T\u00e9moignage'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Rendering Progress */}
            {isRendering && (
              <Card className="border-studiio-primary/30">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Loader2 className="animate-spin text-studiio-primary" size={24} />
                      <div>
                        <p className="text-white font-semibold">Rendu en cours...</p>
                        <p className="text-xs text-gray-400">Cela peut prendre quelques minutes</p>
                      </div>
                    </div>
                    <p className="text-2xl font-bold text-studiio-accent">{renderProgress}%</p>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-studiio-primary to-studiio-accent rounded-full transition-all duration-500"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>
                  <p className="text-center text-sm text-gray-400 mt-3">
                    {renderProgress < 30 ? 'Pr\u00e9paration du rendu...' :
                     renderProgress < 60 ? 'Assemblage des clips...' :
                     renderProgress < 90 ? 'Encodage vid\u00e9o...' :
                     'Finalisation...'}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Error */}
            {error && (
              <Card className="border-red-500/30">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="text-red-400" size={20} />
                    <div>
                      <p className="text-red-400 font-semibold">Erreur</p>
                      <p className="text-sm text-gray-400">{error}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recap */}
            <Card>
              <CardHeader className="border-b border-gray-800">
                <CardTitle>R\u00e9capitulatif</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 text-xs mb-1">Format</p>
                    <p className="text-white font-medium">{format === 'reel' ? 'Reel 9:16' : 'TV 16:9'}</p>
                  </div>
                  <div className="p-3 bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 text-xs mb-1">Style</p>
                    <p className="text-white font-medium">{mode === 'cardio' ? 'Dynamique' : 'T\u00e9moignage'}</p>
                  </div>
                  <div className="p-3 bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 text-xs mb-1">Objectif</p>
                    <p className="text-white font-medium">{OBJECTIVES.find(o => o.value === objective)?.label}</p>
                  </div>
                  <div className="p-3 bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 text-xs mb-1">Dur\u00e9e</p>
                    <p className="text-white font-medium">{totalDuration.toFixed(1)} secondes</p>
                  </div>
                  <div className="p-3 bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 text-xs mb-1">Clips</p>
                    <p className="text-white font-medium">{filledSlotsCount} rushes</p>
                  </div>
                  <div className="p-3 bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 text-xs mb-1">Co\u00fbt</p>
                    <p className="text-studiio-accent font-bold">{renderCost} cr\u00e9dits</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="border-studiio-primary/30">
              <CardContent className="pt-6 text-center">
                <Sparkles className="mx-auto text-studiio-primary mb-3" size={32} />
                <h3 className="font-bold text-white text-lg mb-2">Pr\u00eat \u00e0 cr\u00e9er ?</h3>
                <p className="text-sm text-gray-400 mb-4">
                  Votre vid\u00e9o sera g\u00e9n\u00e9r\u00e9e par notre IA et disponible dans votre biblioth\u00e8que.
                </p>
                <Button
                  variant="accent"
                  size="lg"
                  className="w-full"
                  disabled={!canRender || isRendering}
                  onClick={handleRender}
                >
                  {isRendering ? (
                    <>
                      <Loader2 className="animate-spin mr-2 inline" size={16} />
                      Rendu en cours...
                    </>
                  ) : (
                    <>
                      <Zap className="mr-2 inline" size={16} />
                      Lancer le rendu ({renderCost} cr\u00e9dits)
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Button variant="ghost" size="md" className="w-full" onClick={() => setStep('timeline')} disabled={isRendering}>
              Retour \u00e0 la timeline
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
