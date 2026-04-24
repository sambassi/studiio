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
  onSelect: (url: string, name: string, type?: 'image' | 'video' | 'audio') => void;
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

// Uploads prefix a timestamp like `1776962255956-<original>`. Strip it so
// users see their actual filename. The fallback is the raw name, which is
// better than a blank label if the pattern ever changes.
function displayFilename(raw: string): string {
  const m = /^\d{10,}-(.+)$/.exec(raw);
  return m ? m[1] : raw;
}

// Format seconds as M:SS (or H:MM:SS for hour-long files). Pads seconds
// so 3:06 renders correctly instead of the raw "3:6".
function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Probes audio metadata client-side to extract duration. Uses a detached
// <audio> element with preload=metadata so the browser only fetches the
// header bytes, not the full file. Fails silently on CORS / decode errors.
function AudioDuration({ url }: { url: string }) {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    const onLoaded = () => setDuration(audio.duration);
    audio.addEventListener('loadedmetadata', onLoaded, { once: true });
    audio.src = url;
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.src = '';
    };
  }, [url]);
  const formatted = formatDuration(duration);
  if (!formatted) return null;
  return <span className="tabular-nums">{formatted}</span>;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (!window.confirm(`Supprimer ${selected.size} fichier(s) ?`)) return;
    setDeleting(true);
    const toDelete = files.filter((f) => selected.has(f.url));
    await Promise.allSettled(
      toDelete.map((f) =>
        fetch('/api/media/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: f.bucket, path: f.path }),
        }),
      ),
    );
    setFiles((prev) => prev.filter((f) => !selected.has(f.url)));
    setSelected(new Set());
    setDeleting(false);
  };

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

      const putRes = await fetch(data.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Supabase PUT ${putRes.status}`);

      const uploadType: 'image' | 'video' | 'audio' | undefined = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'audio'
            : undefined;
      onSelect(data.publicUrl, file.name, uploadType);
      onClose();
    } catch (err) {
      console.error('[MediaLibrary] Upload error:', err);
      alert(`Upload échoué : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
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
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
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
          {filtered.length > 0 && (
            <button
              onClick={() => {
                if (selected.size === filtered.length) setSelected(new Set());
                else setSelected(new Set(filtered.map((f) => f.url)));
              }}
              className="rounded-lg px-2 py-1.5 text-[10px] font-medium bg-gray-800 text-gray-400 hover:text-white transition whitespace-nowrap"
            >
              {selected.size === filtered.length ? 'Désélectionner' : 'Tout sélectionner'}
            </button>
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
              {filtered.map((file, i) => {
                const isSelected = selected.has(file.url);
                return (
                <div
                  key={`${file.url}-${i}`}
                  className={`group relative rounded-xl overflow-hidden border-2 bg-gray-800 transition-all aspect-square cursor-pointer ${
                    isSelected ? 'border-purple-500 ring-1 ring-purple-500/30' : 'border-gray-700 hover:border-purple-500'
                  }`}
                  onClick={(e) => {
                    if (selected.size > 0) { e.stopPropagation(); toggleSelect(file.url); return; }
                    onSelect(file.url, file.name, file.type); onClose();
                  }}
                  onContextMenu={(e) => { e.preventDefault(); toggleSelect(file.url); }}
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
                  {/* Selection checkbox */}
                  {(selected.size > 0 || isSelected) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelect(file.url); }}
                      className={`absolute bottom-1 left-1 z-10 h-5 w-5 rounded border-2 flex items-center justify-center text-[10px] transition ${
                        isSelected ? 'bg-purple-600 border-purple-600 text-white' : 'bg-black/40 border-gray-400 text-transparent'
                      }`}
                    >
                      {isSelected && '✓'}
                    </button>
                  )}
                  <div
                    className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-2 pl-7"
                    title={displayFilename(file.name)}
                  >
                    <p className="text-[10px] text-white truncate">{displayFilename(file.name)}</p>
                    <p className="flex items-center gap-1.5 text-[9px] text-gray-400">
                      {file.type === 'audio' && <AudioDuration url={file.url} />}
                      {file.size > 0 && <span>{formatSize(file.size)}</span>}
                    </p>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 bg-gray-900/95">
            <span className="text-xs text-gray-300">{selected.size} fichier(s) sélectionné(s)</span>
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 transition"
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Supprimer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
