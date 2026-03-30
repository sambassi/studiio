'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  ChevronRight,
  Upload,
  Loader2,
  Plus,
  X,
  RotateCcw,
  Volume2,
  Zap,
  Music,
} from 'lucide-react';
import Link from 'next/link';

interface VideoRush {
  id: string;
  file?: File;
  url?: string;
}

interface TextCard {
  id: string;
  text: string;
  duration: number;
}

interface GeneratedTitle {
  text: string;
  videoIndex: number;
}

interface RenderingState {
  isRendering: boolean;
  progress: number;
  stage: string;
  currentVideo: number;
  totalVideos: number;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const GRADIENT_COMBINATIONS = [
  'from-purple-600 via-pink-500 to-red-500',
  'from-blue-600 via-cyan-500 to-teal-500',
  'from-orange-600 via-yellow-500 to-lime-500',
  'from-green-600 via-emerald-500 to-cyan-500',
  'from-indigo-600 via-purple-500 to-pink-500',
  'from-rose-600 via-pink-500 to-orange-500',
  'from-sky-600 via-blue-500 to-cyan-500',
  'from-fuchsia-600 via-purple-500 to-pink-500',
  'from-amber-600 via-orange-500 to-red-500',
  'from-teal-600 via-cyan-500 to-blue-500',
];

export default function CreatorPage() {
  const { data: session } = useSession();

  // Form states
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState('reel');
  const [mode, setMode] = useState('cardio');
  const [objective, setObjective] = useState('promotion');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [videoRushes, setVideoRushes] = useState<VideoRush[]>(
    Array.from({ length: 1 }, (_, i) => ({ id: `rush-${i}` }))
  );
  const [textCards, setTextCards] = useState<TextCard[]>([]);
  const [backgroundMusic, setBackgroundMusic] = useState<File | null>(null);
  const [voiceOverFile, setVoiceOverFile] = useState<File | null>(null);
  const [characterImage, setCharacterImage] = useState<File | null>(null);
  const [batchCount, setBatchCount] = useState(2);
  const [generatedTitles, setGeneratedTitles] = useState<GeneratedTitle[]>([]);
  const [destination, setDestination] = useState('calendar');
  const [ttsMode, setTtsMode] = useState<'edge' | 'upload' | 'none'>('none');
  const [ttsVoice, setTtsVoice] = useState('fr-FR-DeniseNeural');

  // UI states
  const [toast, setToast] = useState<Toast | null>(null);
  const [rendering, setRendering] = useState<RenderingState>({
    isRendering: false,
    progress: 0,
    stage: '',
    currentVideo: 0,
    totalVideos: 0,
  });
  const [activeNewCard, setActiveNewCard] = useState<Partial<TextCard> | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = (message: string, type: 'success' | 'error' = 'error') => {
    setToast({ message, type });
  };

  const handleAddVideoRush = () => {
    if (videoRushes.length < 10) {
      setVideoRushes([
        ...videoRushes,
        { id: `rush-${Date.now()}` },
      ]);
    }
  };

  const handleRemoveVideoRush = (id: string) => {
    setVideoRushes(videoRushes.filter((v) => v.id !== id));
  };

  const handleVideoRushUpload = (id: string, file: File) => {
    setVideoRushes(
      videoRushes.map((v) =>
        v.id === id ? { ...v, file } : v
      )
    );
  };

  const handleAddTextCard = () => {
    if (activeNewCard?.text && activeNewCard?.duration) {
      const newCard: TextCard = {
        id: `card-${Date.now()}`,
        text: activeNewCard.text,
        duration: activeNewCard.duration,
      };
      setTextCards([...textCards, newCard]);
      setActiveNewCard(null);
    }
  };

  const handleRemoveTextCard = (id: string) => {
    setTextCards(textCards.filter((c) => c.id !== id));
  };

  const handleRegenerateTitle = () => {
    // Simulate title generation
    const newTitles = Array.from({ length: batchCount }, (_, i) => ({
      text: `Vidéo ${i + 1} - ${title}`,
      videoIndex: i,
    }));
    setGeneratedTitles(newTitles);
    showToast('Titres régénérés avec succès', 'success');
  };

  const handleStartRendering = async () => {
    if (!title.trim()) {
      showToast('Veuillez entrer un titre', 'error');
      return;
    }

    if (videoRushes.every((v) => !v.file && !v.url)) {
      showToast('Veuillez ajouter au moins une vidéo', 'error');
      return;
    }

    setRendering({
      isRendering: true,
      progress: 0,
      stage: 'Initialisation...',
      currentVideo: 1,
      totalVideos: batchCount,
    });

    // Simulate rendering progress
    const stages = [
      'Initialisation...',
      'Téléchargement des fichiers...',
      'Traitement vidéo...',
      'Application des effets...',
      'Ajout du texte...',
      'Intégration audio...',
      'Rendu en cours...',
      'Finalisation...',
    ];

    let stageIndex = 0;
    const interval = setInterval(() => {
      setRendering((prev) => {
        const newProgress = Math.min(prev.progress + Math.random() * 15, 99);
        if (stageIndex < stages.length - 1 && newProgress > (stageIndex + 1) * 12) {
          stageIndex++;
        }

        return {
          ...prev,
          progress: newProgress,
          stage: stages[Math.min(stageIndex, stages.length - 1)],
        };
      });
    }, 800);

    // Simulate completion
    setTimeout(() => {
      clearInterval(interval);
      setRendering({
        isRendering: false,
        progress: 100,
        stage: 'Rendu terminé!',
        currentVideo: batchCount,
        totalVideos: batchCount,
      });
      showToast('Vidéos générées avec succès!', 'success');

      // Reset after 2 seconds
      setTimeout(() => {
        setStep(0);
        setRendering({
          isRendering: false,
          progress: 0,
          stage: '',
          currentVideo: 0,
          totalVideos: 0,
        });
      }, 2000);
    }, 6000);
  };

  const steps = [
    'Configuration',
    'Médias',
    'Timeline',
    'Aperçu & Rendu',
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/50 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold">Créateur de vidéos</h1>
            <Link href="/dashboard/library">
              <Button variant="secondary" size="sm">
                Vers la bibliothèque
              </Button>
            </Link>
          </div>

          {/* Step Indicator */}
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  onClick={() => setStep(i)}
                  className={`px-4 py-2 rounded-lg font-medium transition text-sm ${
                    step === i
                      ? 'bg-studiio-primary text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {s}
                </button>
                {i < steps.length - 1 && (
                  <ChevronRight className="text-gray-600" size={20} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Step 0: Configuration */}
        {step === 0 && (
          <div className="space-y-8 max-w-2xl">
            <div className="card-base p-6 space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Configuration</h2>
                <p className="text-gray-400">Configurez les paramètres de base de votre vidéo</p>
              </div>

              {/* Format Selection */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-300">
                  Format
                </label>
                <div className="flex gap-4">
                  {[
                    { value: 'reel', label: 'Reel 9:16', icon: 'ð±' },
                    { value: 'tv', label: 'TV 16:9', icon: 'ðº' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setFormat(opt.value)}
                      className={`flex-1 px-4 py-3 rounded-lg border-2 transition font-medium text-sm ${
                        format === opt.value
                          ? 'border-studiio-primary bg-studiio-primary/10'
                          : 'border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      <span className="mr-2">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode Selection */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-300">
                  Mode
                </label>
                <div className="flex gap-4">
                  {[
                    { value: 'cardio', label: 'Cardio/Dynamique' },
                    { value: 'testimony', label: 'Témoignage/Clean' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setMode(opt.value)}
                      className={`flex-1 px-4 py-3 rounded-lg border-2 transition font-medium text-sm ${
                        mode === opt.value
                          ? 'border-studiio-accent bg-studiio-accent/10'
                          : 'border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Objective Selection */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-300">
                  Objectif
                </label>
                <Select
                  options={[
                    { value: 'promotion', label: 'Promotion' },
                    { value: 'subscription', label: 'Abonnement' },
                    { value: 'motivation', label: 'Motivation' },
                    { value: 'benefits', label: 'Bienfaits' },
                    { value: 'nutrition', label: 'Nutrition' },
                  ]}
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                />
              </div>

              {/* Title & Subtitle */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-300">
                  Titre principal
                </label>
                <Input
                  placeholder="Ex: Ma nouvelle vidéo..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input-base"
                />
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-300">
                  Sous-titre
                </label>
                <Input
                  placeholder="Sous-titre optionnel..."
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  className="input-base"
                />
              </div>

              <Button
                variant="primary"
                onClick={() => setStep(1)}
                className="w-full"
              >
                Continuer vers les médias
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Médias */}
        {step === 1 && (
          <div className="space-y-8 max-w-2xl">
            <div className="card-base p-6 space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Médias</h2>
                <p className="text-gray-400">Ajoutez vos vidéos, images et audio</p>
              </div>

              {/* Video Rushes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-semibold text-gray-300">
                    Vidéos (Rush)
                  </label>
                  <span className="text-xs text-gray-500">
                    {videoRushes.length} / 10
                  </span>
                </div>
                <div className="space-y-2">
                  {videoRushes.map((rush, idx) => (
                    <div
                      key={rush.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-700 hover:border-gray-600"
                    >
                      <span className="text-xs text-gray-500 font-mono">
                        #{idx + 1}
                      </span>
                      <label className="flex-1 flex items-center gap-2 cursor-pointer">
                        <Upload size={16} className="text-gray-400" />
                        <span className="text-sm text-gray-300">
                          {rush.file
                            ? rush.file.name
                            : 'Cliquez pour ajouter une vidéo'}
                        </span>
                        <input
                          type="file"
                          accept="video/*"
                          onChange={(e) => {
                            if (e.target.files?.[0]) {
                              handleVideoRushUpload(rush.id, e.target.files[0]);
                            }
                          }}
                          className="hidden"
                        />
                      </label>
                      {videoRushes.length > 1 && (
                        <button
                          onClick={() => handleRemoveVideoRush(rush.id)}
                          className="text-gray-400 hover:text-red-400 transition"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {videoRushes.length < 10 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleAddVideoRush}
                    className="w-full"
                  >
                    <Plus size={14} className="mr-2" />
                    Ajouter une vidéo
                  </Button>
                )}
              </div>

              {/* Character Image */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-300">
                  Image du personnage
                </label>
                <label className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-gray-700 hover:border-gray-600 cursor-pointer transition">
                  <Upload size={20} className="text-gray-400" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-300">
                      {characterImage
                        ? characterImage.name
                        : 'Cliquez pour ajouter une image'}
                    </p>
                    <p className="text-xs text-gray-500">
                      PNG, JPG jusqu'à 10MB
                    </p>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        setCharacterImage(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Background Music */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-300">
                  Musique de fond
                </label>
                <label className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-gray-700 hover:border-gray-600 cursor-pointer transition">
                  <Music size={20} className="text-gray-400" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-300">
                      {backgroundMusic
                        ? backgroundMusic.name
                        : 'Cliquez pour ajouter de la musique'}
                    </p>
                    <p className="text-xs text-gray-500">
                      MP3, WAV jusqu'à 50MB
                    </p>
                  </div>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        setBackgroundMusic(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Voice-Over Section */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-300">
                  Voix-off
                </label>
                <div className="flex gap-2 mb-3">
                  {[
                    { value: 'edge', label: 'Edge TTS' },
                    { value: 'upload', label: 'Télécharger' },
                    { value: 'none', label: 'Aucune' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setTtsMode(opt.value as 'edge' | 'upload' | 'none')}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition border ${
                        ttsMode === opt.value
                          ? 'border-studiio-accent bg-studiio-accent/10 text-white'
                          : 'border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {ttsMode === 'edge' && (
                  <Select
                    options={[
                      { value: 'fr-FR-DeniseNeural', label: 'Denise (FR)' },
                      { value: 'fr-FR-HenriNeural', label: 'Henri (FR)' },
                      { value: 'en-US-AriaNeural', label: 'Aria (EN)' },
                      { value: 'en-US-GuyNeural', label: 'Guy (EN)' },
                    ]}
                    value={ttsVoice}
                    onChange={(e) => setTtsVoice(e.target.value)}
                  />
                )}

                {ttsMode === 'upload' && (
                  <label className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-gray-700 hover:border-gray-600 cursor-pointer transition">
                    <Volume2 size={20} className="text-gray-400" />
                    <div className="flex-1">
                      <p className="text-sm text-gray-300">
                        {voiceOverFile
                          ? voiceOverFile.name
                          : 'Cliquez pour ajouter une voix-off'}
                      </p>
                      <p className="text-xs text-gray-500">
                        MP3, WAV jusqu'à 30MB
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          setVoiceOverFile(e.target.files[0]);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  variant="secondary"
                  onClick={() => setStep(0)}
                  className="flex-1"
                >
                  Retour
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setStep(2)}
                  className="flex-1"
                >
                  Continuer vers la timeline
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Timeline */}
        {step === 2 && (
          <div className="space-y-8 max-w-2xl">
            <div className="card-base p-6 space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Timeline</h2>
                <p className="text-gray-400">Créez des cartes de texte pour votre vidéo</p>
              </div>

              {/* Text Cards List */}
              {textCards.length > 0 && (
                <div className="space-y-2">
                  {textCards.map((card) => (
                    <div
                      key={card.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-700 hover:border-gray-600"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">
                          {card.text}
                        </p>
                        <p className="text-xs text-gray-500">
                          {card.duration}s
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveTextCard(card.id)}
                        className="text-gray-400 hover:text-red-400 transition"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Card Form */}
              <div className="space-y-3 p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                <p className="text-sm font-semibold text-gray-300">
                  Ajouter une carte de texte
                </p>
                <Input
                  placeholder="Texte de la carte..."
                  value={activeNewCard?.text || ''}
                  onChange={(e) =>
                    setActiveNewCard({
                      ...activeNewCard,
                      text: e.target.value,
                    })
                  }
                  className="input-base"
                />
                <Input
                  type="number"
                  placeholder="Durée (secondes)"
                  min="1"
                  max="30"
                  value={activeNewCard?.duration || ''}
                  onChange={(e) =>
                    setActiveNewCard({
                      ...activeNewCard,
                      duration: parseInt(e.target.value) || 0,
                    })
                  }
                  className="input-base"
                />
                <Button
                  variant="secondary"
                  onClick={handleAddTextCard}
                  className="w-full"
                >
                  <Plus size={14} className="mr-2" />
                  Ajouter
                </Button>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  variant="secondary"
                  onClick={() => setStep(1)}
                  className="flex-1"
                >
                  Retour
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setStep(3)}
                  className="flex-1"
                >
                  Continuer vers l'aperçu
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Aperçu & Rendu */}
        {step === 3 && (
          <div className="space-y-8">
            {!rendering.isRendering ? (
              <>
                {/* Preview Section */}
                <div className="card-base p-6 space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Aperçu & Rendu</h2>
                    <p className="text-gray-400">
                      Vérifiez vos paramètres avant de générer
                    </p>
                  </div>

                  {/* Batch Settings */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="block text-sm font-semibold text-gray-300">
                        Nombre de vidéos
                      </label>
                      <div className="flex gap-2">
                        {[2, 3, 5, 10].map((count) => (
                          <button
                            key={count}
                            onClick={() => {
                              setBatchCount(count);
                              setGeneratedTitles([]);
                            }}
                            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition border ${
                              batchCount === count
                                ? 'border-studiio-primary bg-studiio-primary/10'
                                : 'border-gray-700 hover:border-gray-600'
                            }`}
                          >
                            x{count}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="block text-sm font-semibold text-gray-300">
                        Destination
                      </label>
                      <Select
                        options={[
                          { value: 'calendar', label: 'Brouillons calendrier' },
                          { value: 'export', label: 'Exporter' },
                          { value: 'both', label: 'Les deux' },
                        ]}
                        value={destination}
                        onChange={(e) => setDestination(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Title Generation */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-semibold text-gray-300">
                        Titres générés
                      </label>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRegenerateTitle}
                      >
                        <RotateCcw size={14} className="mr-2" />
                        Régénérer
                      </Button>
                    </div>

                    {generatedTitles.length > 0 ? (
                      <div className="space-y-2">
                        {generatedTitles.map((gt) => (
                          <div
                            key={gt.videoIndex}
                            className="p-3 rounded-lg bg-gray-800/50 border border-gray-700"
                          >
                            <p className="text-xs text-gray-500 mb-1">
                              Vidéo {gt.videoIndex + 1}
                            </p>
                            <p className="text-sm text-white">{gt.text}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 italic">
                        Cliquez sur "Régénérer" pour créer les titres
                      </p>
                    )}
                  </div>

                  {/* Video Preview Grid */}
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-gray-300">
                      Aperçu des vidéos
                    </p>
                    <div className={`grid gap-4 ${
                      batchCount === 2
                        ? 'grid-cols-2'
                        : batchCount === 3
                        ? 'grid-cols-3'
                        : 'grid-cols-5'
                    }`}>
                      {Array.from({ length: batchCount }, (_, i) => (
                        <div
                          key={i}
                          className={`rounded-lg overflow-hidden border border-gray-700 ${
                            format === 'reel'
                              ? 'aspect-[9/16]'
                              : 'aspect-video'
                          }`}
                        >
                          <div
                            className={`w-full h-full bg-gradient-to-br ${
                              GRADIENT_COMBINATIONS[i % GRADIENT_COMBINATIONS.length]
                            } flex items-center justify-center relative`}
                          >
                            <div className="absolute inset-0 bg-black/30" />
                            <div className="relative z-10 text-center px-4">
                              <p className="text-xs text-gray-200 mb-2">
                                Vidéo {i + 1}
                              </p>
                              <p className="text-sm font-semibold text-white line-clamp-2">
                                {title}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Render Controls */}
                <div className="card-base p-6 space-y-4">
                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => setStep(2)}
                      className="flex-1"
                    >
                      Retour
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleStartRendering}
                      className="flex-1"
                    >
                      <Zap size={16} className="mr-2" />
                      Générer les vidéos
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              // Rendering State
              <div className="card-base p-12 space-y-8 text-center">
                <div>
                  <h2 className="text-3xl font-bold mb-2">
                    Création en cours...
                  </h2>
                  <p className="text-gray-400">
                    Vidéo {rendering.currentVideo} sur {rendering.totalVideos}
                  </p>
                </div>

                {/* Progress Bar */}
                <div className="space-y-4">
                  <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-studiio-primary to-studiio-accent transition-all duration-300"
                      style={{ width: `${rendering.progress}%` }}
                    />
                  </div>

                  {/* Percentage Display */}
                  <div className="text-center">
                    <div className="text-6xl font-bold text-studiio-primary mb-2">
                      {Math.round(rendering.progress)}%
                    </div>
                    <p className="text-lg text-gray-300">
                      {rendering.stage}
                    </p>
                  </div>
                </div>

                {/* Loading Animation */}
                <div className="flex items-center justify-center">
                  <Loader2
                    className="animate-spin text-studiio-accent"
                    size={48}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
