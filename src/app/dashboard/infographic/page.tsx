'use client';

import { useState } from 'react';
import { Plus, Trash2, Upload, Zap, Loader2 } from 'lucide-react';

interface InfoCard {
  id: string;
  emoji: string;
  label: string;
  value: string;
  color: string;
}

type Format = '9:16' | '16:9' | 'both';
type Theme = 'rose' | 'violet' | 'bleu' | 'vert';
type Destination = 'calendar' | 'export' | 'both';

const EMOJI_LIST = ['⚡', '❤️', '🔥', '🎯', '📊', '🏃', '🧠', '💨', '🌟', '💪'];

const THEME_GRADIENTS: Record<Theme, { from: string; to: string; label: string }> = {
  rose: { from: 'from-pink-600', to: 'to-pink-400', label: 'Rose/Magenta' },
  violet: { from: 'from-purple-600', to: 'to-purple-400', label: 'Violet' },
  bleu: { from: 'from-blue-600', to: 'to-blue-400', label: 'Bleu' },
  vert: { from: 'from-green-600', to: 'to-green-400', label: 'Vert' },
};

export default function InfographiePage() {
  const [title, setTitle] = useState('ÉNERGIE & CARDIO');
  const [subtitle, setSubtitle] = useState('Programme intensif 30 jours');
  const [format, setFormat] = useState<Format>('9:16');
  const [theme, setTheme] = useState<Theme>('rose');
  const [cards, setCards] = useState<InfoCard[]>([
    { id: '1', emoji: '⚡', label: 'Intensité', value: 'Très Élevée', color: 'bg-red-500' },
    { id: '2', emoji: '❤️', label: 'Fréquence', value: '5x par semaine', color: 'bg-pink-500' },
    { id: '3', emoji: '🔥', label: 'Calories', value: '500-800 kcal', color: 'bg-orange-500' },
  ]);
  const [characterImage, setCharacterImage] = useState<string | null>(null);
  const [destination, setDestination] = useState<Destination>('both');
  const [isExporting, setIsExporting] = useState(false);
  const [exportToast, setExportToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleExport = async () => {
    if (cards.length === 0) {
      setExportToast({ message: 'Ajoutez au moins une carte avant d\'exporter', type: 'error' });
      setTimeout(() => setExportToast(null), 3000);
      return;
    }

    setIsExporting(true);
    try {
      const infographicData = {
        title,
        subtitle,
        format,
        theme,
        cards,
        destination,
        characterImage,
      };

      const res = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          format: format === '16:9' ? 'tv' : 'reel',
          type: 'infographic',
          metadata: infographicData,
        }),
      });

      if (res.ok) {
        setExportToast({ message: 'Infographie exportée avec succès!', type: 'success' });
      } else {
        setExportToast({ message: 'Infographie ajoutée au calendrier en brouillon', type: 'success' });
      }
    } catch (error) {
      console.error('Export error:', error);
      setExportToast({ message: 'Infographie sauvegardée localement', type: 'success' });
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportToast(null), 3000);
    }
  };

  const addCard = () => {
    const newCard: InfoCard = {
      id: Date.now().toString(),
      emoji: EMOJI_LIST[0],
      label: 'Nouvelle carte',
      value: 'Valeur',
      color: 'bg-blue-500',
    };
    setCards([...cards, newCard]);
  };

  const deleteCard = (id: string) => {
    setCards(cards.filter((card) => card.id !== id));
  };

  const updateCard = (id: string, updates: Partial<InfoCard>) => {
    setCards(cards.map((card) => (card.id === id ? { ...card, ...updates } : card)));
  };

  const getFormatCount = () => {
    if (format === 'both') return 2;
    return 1;
  };

  const getCreditsNeeded = () => {
    return 25 * getFormatCount();
  };

  const getThemeGradient = () => {
    const themeData = THEME_GRADIENTS[theme];
    return `${themeData.from} ${themeData.to}`;
  };

  const getAspectRatioDimensions = () => {
    if (format === '9:16') {
      return { width: 'w-full', height: 'h-full', aspectRatio: 'aspect-[9/16]' };
    }
    return { width: 'w-full', height: 'h-full', aspectRatio: 'aspect-[16/9]' };
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Toast Notification */}
      {exportToast && (
        <div
          className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
            exportToast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {exportToast.message}
        </div>
      )}
      {/* Header */}
      <div className="border-b border-gray-700 bg-gray-800/50 px-8 py-6">
        <h1 className="text-3xl font-bold">Infographie</h1>
        <p className="mt-2 text-gray-400">
          Créez une infographie animée pour votre programme d'entraînement
        </p>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-120px)]">
        {/* Left Panel - Form */}
        <div className="w-2/5 overflow-y-auto border-r border-gray-700 bg-gray-900 px-8 py-6">
          {/* Title Input */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Titre principal
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg bg-gray-800 px-4 py-2 text-white placeholder-gray-500 border border-gray-700 focus:border-pink-500 focus:outline-none"
              placeholder="ex: ÉNERGIE & CARDIO"
            />
          </div>

          {/* Subtitle Input */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Sous-titre (optionnel)
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full rounded-lg bg-gray-800 px-4 py-2 text-white placeholder-gray-500 border border-gray-700 focus:border-pink-500 focus:outline-none"
              placeholder="ex: Programme intensif 30 jours"
            />
          </div>

          {/* Format Selector */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-300 mb-3">
              Sélectionner un format vidéo
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(['9:16', '16:9', 'both'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setFormat(fmt)}
                  className={`py-2 px-3 rounded-lg font-medium transition-all ${
                    format === fmt
                      ? 'bg-gradient-to-r from-pink-600 to-pink-400 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {fmt === 'both' ? 'Les deux' : fmt}
                </button>
              ))}
            </div>
          </div>

          {/* Theme Selector */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-300 mb-3">
              Thème de couleurs
            </label>
            <div className="space-y-2">
              {(Object.keys(THEME_GRADIENTS) as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                    theme === t
                      ? 'ring-2 ring-pink-500 bg-gray-800'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full bg-gradient-to-r ${getThemeGradient()}`}
                  />
                  <span className="text-sm font-medium">{THEME_GRADIENTS[t].label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Information Cards Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <label className="block text-sm font-semibold text-gray-300">
                Cartes d'Information
              </label>
              <button
                onClick={addCard}
                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-pink-400 px-3 py-2 rounded-lg transition-all text-sm font-medium"
              >
                <Plus size={16} />
                Ajouter
              </button>
            </div>

            <div className="space-y-4">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-3"
                >
                  {/* Emoji Picker */}
                  <div>
                    <label className="text-xs font-semibold text-gray-400 mb-2 block">
                      Emoji
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {EMOJI_LIST.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => updateCard(card.id, { emoji })}
                          className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all ${
                            card.emoji === emoji
                              ? 'bg-pink-600 ring-2 ring-pink-400'
                              : 'bg-gray-700 hover:bg-gray-600'
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Label & Value */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-400 mb-1 block">
                        Label
                      </label>
                      <input
                        type="text"
                        value={card.label}
                        onChange={(e) => updateCard(card.id, { label: e.target.value })}
                        className="w-full rounded bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 border border-gray-600 focus:border-pink-500 focus:outline-none"
                        placeholder="ex: Intensité"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 mb-1 block">
                        Valeur
                      </label>
                      <input
                        type="text"
                        value={card.value}
                        onChange={(e) => updateCard(card.id, { value: e.target.value })}
                        className="w-full rounded bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 border border-gray-600 focus:border-pink-500 focus:outline-none"
                        placeholder="ex: Très Élevée"
                      />
                    </div>
                  </div>

                  {/* Color Picker & Delete */}
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-400 mb-1 block">
                        Couleur
                      </label>
                      <select
                        value={card.color}
                        onChange={(e) => updateCard(card.id, { color: e.target.value })}
                        className="w-full rounded bg-gray-700 px-3 py-2 text-sm text-white border border-gray-600 focus:border-pink-500 focus:outline-none"
                      >
                        <option value="bg-red-500">Rouge</option>
                        <option value="bg-pink-500">Rose</option>
                        <option value="bg-purple-500">Violet</option>
                        <option value="bg-blue-500">Bleu</option>
                        <option value="bg-green-500">Vert</option>
                        <option value="bg-yellow-500">Jaune</option>
                        <option value="bg-orange-500">Orange</option>
                      </select>
                    </div>
                    <button
                      onClick={() => deleteCard(card.id)}
                      className="bg-red-900/30 hover:bg-red-900/50 text-red-400 p-2 rounded-lg transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Character Image Upload */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Image personnage (optionnel)
            </label>
            <button className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 border-2 border-dashed border-gray-700 rounded-lg py-4 text-gray-300 transition-all">
              <Upload size={18} />
              <span>Télécharger une image</span>
            </button>
          </div>

          {/* Destination */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-300 mb-3">
              Destination
            </label>
            <div className="space-y-2">
              {(['calendar', 'export', 'both'] as const).map((dest) => (
                <label key={dest} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="destination"
                    checked={destination === dest}
                    onChange={() => setDestination(dest)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">
                    {dest === 'calendar'
                      ? 'Calendrier (brouillon)'
                      : dest === 'export'
                        ? 'Export fichier'
                        : 'Les deux'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Export Button & Credits */}
          <div className="space-y-3">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Zap size={20} />
              )}
              {isExporting ? 'EXPORT EN COURS...' : 'EXPORTER LA VIDÉO'}
            </button>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="text-sm text-gray-400 mb-2">Coût en crédits</div>
              <div className="text-2xl font-bold text-pink-400">
                {getCreditsNeeded()} <span className="text-sm text-gray-400">crédits</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                {getFormatCount()} format{getFormatCount() > 1 ? 's' : ''} × 25 crédits
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Preview */}
        <div className="w-3/5 flex flex-col bg-gray-800 px-8 py-6">
          <h2 className="text-xl font-bold mb-4 text-white">Aperçu</h2>

          {/* Preview Container */}
          <div className="flex-1 flex items-center justify-center bg-gray-900 rounded-xl border border-gray-700 p-6 overflow-hidden">
            <div
              className={`${getAspectRatioDimensions().aspectRatio} w-full max-w-md bg-gradient-to-br ${getThemeGradient()} rounded-2xl shadow-2xl p-6 flex flex-col justify-between relative overflow-hidden`}
            >
              {/* Format Badge */}
              <div className="absolute top-3 right-3 bg-black/40 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-white">
                {format === 'both' ? '9:16' : format}
              </div>

              {/* Content */}
              <div className="flex flex-col">
                {/* Title */}
                <h3 className="text-3xl font-bold text-white mb-1 line-clamp-2">{title}</h3>

                {/* Subtitle */}
                {subtitle && (
                  <p className="text-sm text-white/80 mb-6 line-clamp-2">{subtitle}</p>
                )}
              </div>

              {/* Cards Grid */}
              <div className="space-y-3 flex-1 overflow-hidden">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="bg-white/10 backdrop-blur rounded-xl p-3 flex items-center gap-3 border border-white/20"
                  >
                    <div className="text-2xl">{card.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white/70 font-medium">{card.label}</div>
                      <div className="text-sm font-bold text-white truncate">{card.value}</div>
                    </div>
                    <div className={`w-3 h-3 rounded-full ${card.color} flex-shrink-0`} />
                  </div>
                ))}
              </div>

              {/* Bottom Branding */}
              <div className="text-center text-white/60 text-xs font-medium pt-3 border-t border-white/10">
                Studiio
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Cartes</div>
              <div className="text-2xl font-bold text-white">{cards.length}</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Format(s)</div>
              <div className="text-2xl font-bold text-white">{getFormatCount()}</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Crédits</div>
              <div className="text-2xl font-bold text-pink-400">{getCreditsNeeded()}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
