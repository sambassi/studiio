'use client';

import { useState } from 'react';
import {
  Plus,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';

interface InfoCard {
  id: string;
  emoji: string;
  label: string;
  value: string;
  color: string;
}

type Format = '9:16' | '16:9' | 'both';
type Theme = 'pink' | 'purple' | 'blue' | 'green';
type Destination = 'draft' | 'export' | 'both';

const THEMES = {
  pink: {
    name: 'Rose/Magenta',
    bg: 'from-pink-600 to-pink-400',
    accent: '#ec4899',
  },
  purple: {
    name: 'Violet',
    bg: 'from-purple-600 to-purple-400',
    accent: '#a855f7',
  },
  blue: {
    name: 'Bleu',
    bg: 'from-blue-600 to-blue-400',
    accent: '#3b82f6',
  },
  green: {
    name: 'Vert',
    bg: 'from-green-600 to-green-400',
    accent: '#10b981',
  },
};

const EMOJIS = ['💪', '❤️', '⚡', '🔥', '🎯', '📊', '🏃', '🧠', '💨', '🌟'];

export default function InfographicPage() {
  const [title, setTitle] = useState('ÉNERGIE & CARDIO');
  const [subtitle, setSubtitle] = useState('');
  const [format, setFormat] = useState<Format>('9:16');
  const [theme, setTheme] = useState<Theme>('purple');
  const [cards, setCards] = useState<InfoCard[]>([
    {
      id: '1',
      emoji: '⚡',
      label: 'Intensité',
      value: 'MAX',
      color: '#ec4899',
    },
    {
      id: '2',
      emoji: '❤️',
      label: 'Fréquence',
      value: '140+',
      color: '#f43f5e',
    },
  ]);
  const [destination, setDestination] = useState<Destination>('draft');
  const [characterImage, setCharacterImage] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);

  const addCard = () => {
    const newCard: InfoCard = {
      id: Date.now().toString(),
      emoji: '⭐',
      label: 'Nouveau',
      value: 'Valeur',
      color: '#a855f7',
    };
    setCards([...cards, newCard]);
  };

  const deleteCard = (id: string) => {
    setCards(cards.filter((card) => card.id !== id));
  };

  const updateCard = (id: string, field: keyof InfoCard, value: string) => {
    setCards(
      cards.map((card) =>
        card.id === id ? { ...card, [field]: value } : card
      )
    );
  };

  const handleCharacterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCharacterImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const getPreviewDimensions = () => {
    if (format === '9:16') {
      return { width: 300, height: 534 };
    } else if (format === '16:9') {
      return { width: 480, height: 270 };
    }
    return { width: 300, height: 534 };
  };

  const getFormatBadgeText = () => {
    return format === '9:16' ? '9:16' : '16:9';
  };

  const previewDims = getPreviewDimensions();
  const themeConfig = THEMES[theme];

  return (
    <div className="flex h-full min-h-screen bg-gray-900 text-white">
      {/* Left Panel - Form */}
      <div className="w-1/2 overflow-y-auto border-r border-gray-800 p-8">
        <h1 className="mb-8 text-3xl font-bold">Créer une Infographie</h1>

        {/* Title Input */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-300">
            Titre
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            placeholder="Ex: ÉNERGIE & CARDIO"
          />
        </div>

        {/* Subtitle Input */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-300">
            Sous-titre (optionnel)
          </label>
          <input
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            placeholder="Sous-titre optionnel"
          />
        </div>

        {/* Format Selector */}
        <div className="mb-6">
          <label className="mb-3 block text-sm font-medium text-gray-300">
            Format
          </label>
          <div className="flex gap-3">
            {['9:16', '16:9', 'both'].map((fmt) => (
              <button
                key={fmt}
                onClick={() => setFormat(fmt as Format)}
                className={`flex-1 rounded-lg px-4 py-2 font-medium transition-colors ${
                  format === fmt
                    ? 'bg-purple-600 text-white'
                    : 'border border-gray-700 bg-gray-800 text-gray-300 hover:border-purple-500'
                }`}
              >
                {fmt === 'both' ? 'Les deux' : fmt}
              </button>
            ))}
          </div>
        </div>

        {/* Theme Selector */}
        <div className="mb-6">
          <label className="mb-3 block text-sm font-medium text-gray-300">
            Thème
          </label>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(THEMES).map(([key, themeInfo]) => (
              <button
                key={key}
                onClick={() => setTheme(key as Theme)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-all ${
                  theme === key
                    ? 'ring-2 ring-purple-500'
                    : 'hover:ring-1 hover:ring-gray-600'
                }`}
              >
                <div
                  className={`h-6 w-6 rounded bg-gradient-to-br ${themeInfo.bg}`}
                />
                <span className="text-sm">{themeInfo.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Cartes d'Information */}
        <div className="mb-6">
          <h3 className="mb-4 text-sm font-semibold text-gray-300">
            Cartes d'Information
          </h3>
          <div className="space-y-4">
            {cards.map((card) => (
              <div
                key={card.id}
                className="space-y-3 rounded-lg border border-gray-700 bg-gray-800 p-4"
              >
                {/* Emoji Picker */}
                <div className="relative">
                  <label className="mb-2 block text-xs font-medium text-gray-400">
                    Emoji
                  </label>
                  <button
                    onClick={() =>
                      setShowEmojiPicker(
                        showEmojiPicker === card.id ? null : card.id
                      )
                    }
                    className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 text-2xl hover:bg-gray-600"
                  >
                    {card.emoji}
                  </button>
                  {showEmojiPicker === card.id && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-2 grid grid-cols-5 gap-2 rounded-lg border border-gray-600 bg-gray-800 p-3">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => {
                            updateCard(card.id, 'emoji', emoji);
                            setShowEmojiPicker(null);
                          }}
                          className="rounded px-2 py-1 text-xl hover:bg-gray-700"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Label */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-gray-400">
                    Libellé
                  </label>
                  <input
                    type="text"
                    value={card.label}
                    onChange={(e) =>
                      updateCard(card.id, 'label', e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    placeholder="Ex: Intensité"
                  />
                </div>

                {/* Value */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-gray-400">
                    Valeur
                  </label>
                  <input
                    type="text"
                    value={card.value}
                    onChange={(e) =>
                      updateCard(card.id, 'value', e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    placeholder="Ex: MAX"
                  />
                </div>

                {/* Color Picker */}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="mb-2 block text-xs font-medium text-gray-400">
                      Couleur
                    </label>
                    <input
                      type="color"
                      value={card.color}
                      onChange={(e) =>
                        updateCard(card.id, 'color', e.target.value)
                      }
                      className="h-10 w-full cursor-pointer rounded-lg border border-gray-600"
                    />
                  </div>
                  <button
                    onClick={() => deleteCard(card.id)}
                    className="mb-0 rounded-lg bg-red-600 p-2 hover:bg-red-700"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add Card Button */}
          <button
            onClick={addCard}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 bg-gray-800 py-3 text-sm font-medium text-gray-300 hover:border-purple-500 hover:text-purple-400"
          >
            <Plus size={18} />
            Ajouter une carte
          </button>
        </div>

        {/* Character Image Upload */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-300">
            Image du personnage (optionnel)
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-700 bg-gray-800 px-4 py-6 hover:border-purple-500 hover:bg-gray-700">
            <Upload size={20} />
            <span className="text-sm text-gray-300">
              {characterImage ? 'Changer l\'image' : 'Télécharger une image'}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleCharacterUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Destination */}
        <div className="mb-6">
          <label className="mb-3 block text-sm font-medium text-gray-300">
            Destination
          </label>
          <div className="space-y-2">
            {[
              { value: 'draft', label: 'Calendrier (brouillon)' },
              { value: 'export', label: 'Export fichier' },
              { value: 'both', label: 'Les deux' },
            ].map((option) => (
              <label key={option.value} className="flex items-center gap-3">
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

        {/* Export Button */}
        <div className="flex flex-col gap-3">
          <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-3 font-bold text-white hover:from-purple-700 hover:to-pink-700">
            <Zap size={20} />
            EXPORTER LA VIDÉO
          </button>
          <div className="text-center text-sm text-gray-400">
            Coût: <span className="font-bold text-yellow-400">25 crédits</span>
          </div>
        </div>
      </div>

      {/* Right Panel - Preview */}
      <div className="w-1/2 flex flex-col items-center justify-center border-l border-gray-800 bg-gray-950 p-8">
        <h2 className="mb-8 text-2xl font-bold text-gray-300">Aperçu</h2>

        {/* Preview Container */}
        <div className="relative">
          <div
            style={{
              width: `${previewDims.width}px`,
              height: `${previewDims.height}px`,
            }}
            className={`relative flex flex-col items-center justify-center gap-4 rounded-lg bg-gradient-to-br ${themeConfig.bg} p-6 shadow-2xl overflow-hidden`}
          >
            {/* Format Badge */}
            <div className="absolute top-2 right-2 rounded-full bg-black/40 px-3 py-1 text-xs font-bold text-white backdrop-blur">
              {getFormatBadgeText()}
            </div>

            {/* Title */}
            <div className="text-center">
              <h3
                className="font-black text-white drop-shadow-lg"
                style={{
                  fontSize: previewDims.width < 400 ? '18px' : '24px',
                }}
              >
                {title}
              </h3>
              {subtitle && (
                <p
                  className="mt-1 text-white/80 drop-shadow"
                  style={{
                    fontSize: previewDims.width < 400 ? '10px' : '12px',
                  }}
                >
                  {subtitle}
                </p>
              )}
            </div>

            {/* Info Cards Grid */}
            <div
              className={`grid gap-2 ${
                previewDims.width < 400
                  ? 'grid-cols-2'
                  : format === '16:9'
                    ? 'grid-cols-3'
                    : 'grid-cols-2'
              }`}
            >
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="flex flex-col items-center gap-1 rounded-lg bg-black/20 px-2 py-2 backdrop-blur-sm"
                  style={{
                    borderLeft: `3px solid ${card.color}`,
                  }}
                >
                  <span
                    style={{
                      fontSize: previewDims.width < 400 ? '16px' : '20px',
                    }}
                  >
                    {card.emoji}
                  </span>
                  <p
                    className="text-center font-bold text-white drop-shadow"
                    style={{
                      fontSize: previewDims.width < 400 ? '8px' : '10px',
                    }}
                  >
                    {card.label}
                  </p>
                  <p
                    className="text-center font-black text-white drop-shadow"
                    style={{
                      fontSize: previewDims.width < 400 ? '9px' : '11px',
                      color: card.color,
                    }}
                  >
                    {card.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Character Image */}
            {characterImage && (
              <img
                src={characterImage}
                alt="Character"
                className="absolute bottom-2 right-2 h-1/3 w-auto rounded"
              />
            )}
          </div>
        </div>

        {/* Destination Indicator */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-400">
            Destination:{' '}
            <span className="font-bold text-purple-400">
              {destination === 'draft'
                ? 'Calendrier'
                : destination === 'export'
                  ? 'Export'
                  : 'Calendrier + Export'}
            </span>
          </p>
        </div>

        {/* Info Stats */}
        <div className="mt-8 grid w-full max-w-xs grid-cols-3 gap-4 rounded-lg bg-gray-800 p-4">
          <div className="text-center">
            <p className="text-xs text-gray-400">Cartes</p>
            <p className="text-lg font-bold text-white">{cards.length}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400">Format</p>
            <p className="text-lg font-bold text-white">
              {format === 'both' ? '2' : '1'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400">Crédits</p>
            <p className="text-lg font-bold text-yellow-400">
              {format === 'both' ? '50' : '25'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
