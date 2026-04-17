'use client';

import { useState, useRef } from 'react';
import { Music, Mic, Upload, Trash2, Volume2, VolumeX, Loader2 } from 'lucide-react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';

const TTS_VOICES = [
  { id: 'fr-FR-DeniseNeural', label: 'Denise (FR)' },
  { id: 'fr-FR-HenriNeural', label: 'Henri (FR)' },
  { id: 'en-US-JennyNeural', label: 'Jenny (EN)' },
  { id: 'en-US-GuyNeural', label: 'Guy (EN)' },
  { id: 'de-DE-KatjaNeural', label: 'Katja (DE)' },
  { id: 'de-DE-ConradNeural', label: 'Conrad (DE)' },
];

interface AudioStudioPanelProps {
  musicUrl: string | null;
  musicName: string;
  voiceUrl: string | null;
  voiceName: string;
  musicVolume: number;
  voiceVolume: number;
  onMusicChange: (url: string | null, name: string) => void;
  onVoiceChange: (url: string | null, name: string) => void;
  onMusicVolumeChange: (v: number) => void;
  onVoiceVolumeChange: (v: number) => void;
}

export function AudioStudioPanel({
  musicUrl,
  musicName,
  voiceUrl,
  voiceName,
  musicVolume,
  voiceVolume,
  onMusicChange,
  onVoiceChange,
  onMusicVolumeChange,
  onVoiceVolumeChange,
}: AudioStudioPanelProps) {
  const [ttsText, setTtsText] = useState('');
  const [ttsVoice, setTtsVoice] = useState('fr-FR-DeniseNeural');
  const [ttsLoading, setTtsLoading] = useState(false);
  const [musicMuted, setMusicMuted] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [mediaLibOpen, setMediaLibOpen] = useState(false);
  const [mediaLibTarget, setMediaLibTarget] = useState<'music' | 'voice'>('music');
  const musicInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File, target: 'music' | 'voice') => {
    try {
      const res = await fetch('/api/upload/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, purpose: target === 'music' ? 'music' : 'voice' }),
      });
      const data = await res.json();
      if (!data.success) return;

      await fetch(data.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (target === 'music') onMusicChange(data.publicUrl, file.name);
      else onVoiceChange(data.publicUrl, file.name);
    } catch (err) {
      console.error('[AudioPanel] Upload error:', err);
    }
  };

  const generateTTS = async () => {
    if (!ttsText.trim()) return;
    setTtsLoading(true);
    try {
      const res = await fetch('/api/tts/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ttsText, voice: ttsVoice }),
      });
      if (!res.ok) throw new Error('TTS failed');

      const blob = await res.blob();
      const file = new File([blob], `tts-${Date.now()}.mp3`, { type: 'audio/mpeg' });

      const uploadRes = await fetch('/api/upload/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, purpose: 'voice' }),
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.success) throw new Error('Upload failed');

      await fetch(uploadData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      onVoiceChange(uploadData.publicUrl, `TTS — ${ttsVoice.split('-')[0]}`);
    } catch (err) {
      console.error('[AudioPanel] TTS error:', err);
    } finally {
      setTtsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Music */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
          <Music size={12} className="text-cyan-400" /> Musique
        </div>
        {musicUrl ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2">
              <Music size={14} className="text-cyan-400 flex-shrink-0" />
              <span className="text-xs text-white flex-1 truncate">{musicName || 'Musique'}</span>
              <button
                onClick={() => setMusicMuted(!musicMuted)}
                className="text-gray-400 hover:text-white p-1"
                title={musicMuted ? 'Activer' : 'Couper'}
              >
                {musicMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <button
                onClick={() => onMusicChange(null, '')}
                className="text-gray-400 hover:text-red-400 p-1"
                title="Supprimer"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500 w-8">Vol.</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={musicMuted ? 0 : musicVolume}
                onChange={(e) => { onMusicVolumeChange(Number(e.target.value)); setMusicMuted(false); }}
                className="flex-1 accent-cyan-500"
              />
              <span className="text-[9px] text-gray-400 w-8 text-right">{Math.round((musicMuted ? 0 : musicVolume) * 100)}%</span>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <label className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-600 px-2 py-3 text-xs text-gray-400 cursor-pointer hover:border-cyan-500 hover:text-white transition">
              <Upload size={12} /> Importer
              <input
                ref={musicInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, 'music'); }}
              />
            </label>
            <button
              onClick={() => { setMediaLibTarget('music'); setMediaLibOpen(true); }}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-600 px-2 py-3 text-xs text-gray-400 hover:border-cyan-500 hover:text-white transition"
            >
              <Music size={12} /> Médiathèque
            </button>
          </div>
        )}
      </div>

      {/* Voice */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
          <Mic size={12} className="text-pink-400" /> Voix off
        </div>
        {voiceUrl ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2">
              <Mic size={14} className="text-pink-400 flex-shrink-0" />
              <span className="text-xs text-white flex-1 truncate">{voiceName || 'Voix off'}</span>
              <button
                onClick={() => setVoiceMuted(!voiceMuted)}
                className="text-gray-400 hover:text-white p-1"
                title={voiceMuted ? 'Activer' : 'Couper'}
              >
                {voiceMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <button
                onClick={() => onVoiceChange(null, '')}
                className="text-gray-400 hover:text-red-400 p-1"
                title="Supprimer"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500 w-8">Vol.</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={voiceMuted ? 0 : voiceVolume}
                onChange={(e) => { onVoiceVolumeChange(Number(e.target.value)); setVoiceMuted(false); }}
                className="flex-1 accent-pink-500"
              />
              <span className="text-[9px] text-gray-400 w-8 text-right">{Math.round((voiceMuted ? 0 : voiceVolume) * 100)}%</span>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <label className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-600 px-2 py-3 text-xs text-gray-400 cursor-pointer hover:border-pink-500 hover:text-white transition">
              <Upload size={12} /> Importer
              <input
                ref={voiceInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, 'voice'); }}
              />
            </label>
            <button
              onClick={() => { setMediaLibTarget('voice'); setMediaLibOpen(true); }}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-600 px-2 py-3 text-xs text-gray-400 hover:border-pink-500 hover:text-white transition"
            >
              <Mic size={12} /> Médiathèque
            </button>
          </div>
        )}
      </div>

      {/* TTS */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
          Synthèse vocale (TTS)
        </div>
        <textarea
          value={ttsText}
          onChange={(e) => setTtsText(e.target.value)}
          placeholder="Tapez votre texte ici..."
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-pink-500 focus:outline-none resize-none"
          rows={3}
        />
        <div className="flex items-center gap-2 mt-2">
          <select
            value={ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value)}
            className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white"
          >
            {TTS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
          <button
            onClick={generateTTS}
            disabled={ttsLoading || !ttsText.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition"
          >
            {ttsLoading ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
            Générer
          </button>
        </div>
      </div>

      <MediaLibrary
        isOpen={mediaLibOpen}
        onClose={() => setMediaLibOpen(false)}
        mediaType="audio"
        onSelect={(url, name) => {
          if (mediaLibTarget === 'music') onMusicChange(url, name);
          else onVoiceChange(url, name);
        }}
      />
    </div>
  );
}
