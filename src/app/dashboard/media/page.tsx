'use client';

/**
 * Page Média — rend découvrable la détection des « temps forts » d'un rush.
 *
 * Couche NON DESTRUCTIVE : cette page ne fait que consommer des routes API
 * existantes (`/api/media/list`, `/api/upload/signed-url`, `/api/media/delete`)
 * et le composant dédié `ClipDetectorModal`. Aucun fichier de l'éditeur
 * `/dashboard/creer` ni de la publication sociale n'est touché.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Clock,
  Film,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import ClipDetectorModal, {
  type ClipSource,
} from '@/components/media/ClipDetectorModal';
import {
  formatRemaining,
  getExpiresAt,
  getRetentionBgColor,
  getRetentionColor,
} from '@/lib/storage/retention';

const ACCENT = '#7C3AED';

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

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Les uploads préfixent le nom d'un timestamp (`1776962255956-<nom>`).
// Même convention d'affichage que la médiathèque de l'éditeur.
function displayFilename(raw: string): string {
  return /^\d{10,}-(.+)$/.exec(raw)?.[1] ?? raw;
}

function ExpiryBadge({ file }: { file: MediaFile }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (file.preserved) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-green-500/30 bg-green-500/15 px-1.5 py-0.5 text-[9px] font-medium text-green-400">
        <ShieldCheck size={9} /> Préservé
      </span>
    );
  }

  const remaining = getExpiresAt(new Date(file.createdAt), file.type).getTime() - now;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${getRetentionColor(remaining)} ${getRetentionBgColor(remaining)}`}
    >
      <Clock size={9} /> {remaining > 0 ? formatRemaining(remaining) : 'Expiré'}
    </span>
  );
}

export default function MediaPage() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [clipSource, setClipSource] = useState<ClipSource | null>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/media/list?type=video');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'liste indisponible');
      setFiles(data.files || []);
    } catch (err) {
      console.error('[Media] list:', err);
      setNotice({
        kind: 'err',
        text: `Impossible de charger vos rushes : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;

    setUploading(true);
    setNotice(null);
    let ok = 0;
    try {
      for (let i = 0; i < picked.length; i++) {
        const file = picked[i];
        setUploadStage(`Envoi ${i + 1}/${picked.length} — ${file.name}`);
        const res = await fetch('/api/upload/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || 'video/mp4',
            purpose: 'rush',
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || `signed-url ${res.status}`);

        // Pas de `credentials: 'include'` — même contrat que MediaLibrary.tsx
        // (cf. commentaire dans ClipDetectorModal.uploadClip).
        const put = await fetch(data.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'video/mp4' },
          body: file,
        });
        if (!put.ok) throw new Error(`upload ${put.status}`);
        ok++;
      }
      setNotice({
        kind: 'ok',
        text: `${ok} vidéo${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}.`,
      });
    } catch (err) {
      console.error('[Media] upload:', err);
      // Toute erreur d'upload est surfacée à l'utilisateur (jamais console seule).
      setNotice({
        kind: 'err',
        text: `Échec de l'envoi${ok > 0 ? ` après ${ok} fichier(s)` : ''} : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
      });
    } finally {
      setUploading(false);
      setUploadStage('');
      e.target.value = '';
      if (ok > 0) fetchFiles();
    }
  };

  const handleDelete = async (file: MediaFile) => {
    if (!window.confirm(`Supprimer « ${displayFilename(file.name)} » ?`)) return;
    try {
      const res = await fetch('/api/media/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: file.bucket, path: file.path }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `suppression ${res.status}`);
      }
      setFiles((prev) => prev.filter((f) => f.url !== file.url));
    } catch (err) {
      console.error('[Media] delete:', err);
      setNotice({
        kind: 'err',
        text: `Suppression impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
      });
    }
  };

  const filtered = search
    ? files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : files;

  return (
    <div className="mx-auto max-w-6xl">
      {/* En-tête */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Média</h1>
          <p className="mt-1 text-sm text-gray-400">
            Vos rushes vidéo. Lancez la détection des temps forts pour en extraire
            automatiquement les meilleures séquences.
          </p>
        </div>
        <label
          className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition ${
            uploading ? 'pointer-events-none opacity-50' : 'hover:opacity-90'
          }`}
          style={{ backgroundColor: ACCENT }}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {uploading ? 'Envoi…' : 'Ajouter une vidéo'}
          <input
            type="file"
            accept="video/*"
            multiple
            onChange={handleUpload}
            className="hidden"
            disabled={uploading}
          />
        </label>
      </div>

      {uploading && uploadStage && (
        <p className="mb-4 text-xs text-gray-400">{uploadStage}</p>
      )}

      {notice && (
        <div
          className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-xs ${
            notice.kind === 'ok'
              ? 'border-green-500/25 bg-green-500/10 text-green-300'
              : 'border-red-500/25 bg-red-500/10 text-red-300'
          }`}
        >
          <span className="leading-relaxed">{notice.text}</span>
          <button
            onClick={() => setNotice(null)}
            className="flex-shrink-0 opacity-70 transition hover:opacity-100"
          >
            Fermer
          </button>
        </div>
      )}

      {/* Rétention — même politique que la médiathèque de l'éditeur */}
      <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
        <Clock size={14} className="mt-0.5 flex-shrink-0 text-amber-400" />
        <p className="text-[11px] leading-relaxed text-amber-300/90">
          Les vidéos sont conservées <strong>24h</strong>. Les fichiers liés à un post
          programmé sont conservés jusqu&apos;à publication.
        </p>
      </div>

      {/* Recherche */}
      <div className="relative mb-5 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un rush…"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
      </div>

      {/* Grille */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={26} className="animate-spin" style={{ color: ACCENT }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-700 py-16 text-center">
          <Film size={30} className="mx-auto mb-3 text-gray-600" />
          <p className="text-sm text-gray-400">
            {search ? 'Aucun rush ne correspond à cette recherche.' : 'Aucun rush pour le moment.'}
          </p>
          {!search && (
            <p className="mt-1 text-xs text-gray-600">
              Ajoutez une vidéo pour détecter ses temps forts.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((file) => (
            <div
              key={file.url}
              className="group overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 transition hover:border-gray-700"
            >
              <div className="relative aspect-video bg-black">
                <video
                  src={file.url}
                  muted
                  playsInline
                  controls
                  preload="metadata"
                  className="h-full w-full object-contain"
                />
                <div className="pointer-events-none absolute right-2 top-2">
                  <ExpiryBadge file={file} />
                </div>
              </div>

              <div className="p-3">
                <p
                  className="truncate text-sm font-medium text-white"
                  title={displayFilename(file.name)}
                >
                  {displayFilename(file.name)}
                </p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {formatSize(file.size)}
                  {file.size > 0 && ' · '}
                  {new Date(file.createdAt).toLocaleDateString('fr-FR')}
                </p>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => setClipSource({ url: file.url, name: file.name })}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
                    style={{ backgroundColor: ACCENT }}
                  >
                    <Sparkles size={14} />
                    Temps forts
                  </button>
                  <button
                    onClick={() => handleDelete(file)}
                    className="rounded-lg border border-gray-700 p-2 text-gray-500 transition hover:border-red-500/40 hover:text-red-400"
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ClipDetectorModal
        isOpen={clipSource !== null}
        source={clipSource}
        onClose={() => setClipSource(null)}
        onExtracted={(clips, failure) => {
          // `failure` renseigné = succès partiel ou interruption. Le message du
          // modal disparaît avec lui : c'est ici que l'échec doit survivre,
          // sinon l'utilisateur ne voit qu'un bandeau vert trompeur.
          setNotice(
            failure
              ? { kind: 'err', text: failure }
              : {
                  kind: 'ok',
                  text: `${clips.length} séquence${clips.length > 1 ? 's' : ''} ajoutée${clips.length > 1 ? 's' : ''} à votre médiathèque.`,
                },
          );
          fetchFiles();
        }}
      />
    </div>
  );
}
