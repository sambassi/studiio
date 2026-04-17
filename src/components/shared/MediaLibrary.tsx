'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Upload, Loader2, Music, X, Clock, ShieldCheck, Trash2 } from 'lucide-react';
import { getExpiresAt, formatRemaining, getRetentionColor, getRetentionBgColor } from '@/lib/storage/retention';

type MediaType = 'image' | 'video' | 'audio' | 'all';

interface MediaFile {
  name: string;
  url: string;
  path: string;
  bucket: string;
  type: 'image' | 'video' | 'audio';
  size: number;
  createdAt: string;
  preserved?: boolean;
}

interface MediaLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  mediaType: MediaType;
  onSelect: (url: string, name: string) => void;
}

const TYPE_FILTERS: Array<{ key: MediaType; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Vidéos' },
  { key: 'audio', label: 'Audio' },
];

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ExpiryBadge({ file }: { file: MediaFile }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (file.preserved) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-green-500/15 border border-green-500/30 px-1.5 py-0.5 text-[9px] font-medium text-green-400">
        <ShieldCheck size={9} /> Préservé
      </span>
    );
  }

  const created = new Date(file.createdAt);
  const expires = getExpiresAt(created, file.type);
  const remaining = expires.getTime() - now;
  const color = getRetentionColor(remaining);
  const bgColor = getRetentionBgColor(remaining);

  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${color} ${bgColor}`}>
      <Clock size={9} /> {remaining > 0 ? formatRemaining(remaining) : 'Expiré'}
    </span>
  );
}

export function MediaLibrary({ isOpen, onClose, mediaType, onSelect }: MediaLibraryProps) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MediaType>(mediaType === 'all' ? 'all' : mediaType);
  const [uploading, setUploading] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const typeParam = filter === 'all' && mediaType !== 'all' ? mediaType : filter;
      const res = await fetch(`/api/media/list?type=${typeParam}`);
      const data = await res.json();
      if (data.success) setFiles(data.files || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [filter, mediaType]);

  useEffect(() => {
    if (isOpen) {
      setFilter(mediaType === 'all' ? 'all' : mediaType);
      fetchFiles();
    }
  }, [isOpen, fetchFiles, mediaType]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const res = await fetch('/api/upload/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          purpose: 'library',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      await fetch(data.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      onSelect(data.publicUrl, file.name);
      onClose();
    } catch (err) {
      console.error('[MediaLibrary] Upload error:', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const filtered = files.filter((f) => {
    if (search) {
      return f.name.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  const acceptType = mediaType === 'image' ? 'image/*' : mediaType === 'video' ? 'video/*' : mediaType === 'audio' ? 'audio/*' : '*/*';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-2xl mx-4 bg-gray-900 rounded-2xl border border-gray-700 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">Médiathèque</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Retention policy banner */}
        <div className="mx-5 mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <Clock size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-amber-300/90 leading-relaxed">
            Vidéos conservées <strong>24h</strong> · Audio et images conservés <strong>7 jours</strong> · Fichiers liés à un post programmé : conservés jusqu'à publication
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un fichier..."
              className="w-full rounded-lg bg-gray-800 border border-gray-700 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
          </div>
          {mediaType === 'all' && (
            <div className="flex gap-1">
              {TYPE_FILTERS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setFilter(t.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    filter === t.key
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <label className={`flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-2 text-xs font-semibold text-white cursor-pointer transition ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Uploader
            <input type="file" accept={acceptType} onChange={handleUpload} className="hidden" disabled={uploading} />
          </label>
        </div>

        {/* Grid */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-purple-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-sm">Aucun fichier trouvé</p>
              <p className="text-gray-600 text-xs mt-1">Uploadez un fichier pour commencer</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {filtered.map((file, i) => (
                <div
                  key={`${file.url}-${i}`}
                  className="group relative rounded-xl overflow-hidden border border-gray-700 bg-gray-800 hover:border-purple-500 transition-all aspect-square cursor-pointer"
                  onClick={() => { onSelect(file.url, file.name); onClose(); }}
                >
                  {file.type === 'image' ? (
                    <img src={file.url} alt={file.name} loading="lazy" className="absolute inset-0 h-full w-full rounded-lg object-cover" />
                  ) : file.type === 'video' ? (
                    <video
                      src={file.url}
                      muted
                      playsInline
                      preload="metadata"
                      className="absolute inset-0 h-full w-full rounded-lg object-cover"
                      onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = 0.5; } catch {} }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-800 rounded-lg">
                      <Music size={28} className="text-cyan-400" />
                    </div>
                  )}
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm('Supprimer ce fichier ?')) return;
                      fetch('/api/media/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ bucket: file.bucket, path: file.path }),
                      }).then(() => {
                        setFiles((prev) => prev.filter((f) => f.url !== file.url));
                      }).catch(() => {});
                    }}
                    className="absolute top-1 left-1 z-10 rounded-lg bg-red-600/80 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                    title="Supprimer"
                  >
                    <Trash2 size={12} />
                  </button>
                  {/* Expiry badge */}
                  <div className="absolute top-1 right-1 z-10">
                    <ExpiryBadge file={file} />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <p className="text-[10px] text-white truncate">{file.name}</p>
                    {file.size > 0 && <p className="text-[9px] text-gray-400">{formatSize(file.size)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
