'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Upload, Loader2, Music, X, Clock, ShieldCheck, Trash2 } from 'lucide-react';
import { getExpiresAt, formatRemaining, getRetentionColor, getRetentionBgColor } from '@/lib/storage/retention';
import { uploadFile } from '@/lib/storage/uploadFile';

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
  /**
   * PLUSIEURS FICHIERS EN UNE SEULE SELECTION — CREER_PREMIUM_3D.
   *
   * ⚠️ OPTIONNEL, ET PAR DEFAUT ABSENT. Ce selecteur sert aussi aux logos, aux
   * images de fond et aux rushes ; leur ouvrir le multiple ferait accepter, en
   * silence, des lots la ou l'appelant n'attend qu'un media. C'est donc
   * l'appelant qui le demande.
   *
   * Present, `onSelect` est appele UNE FOIS PAR FICHIER REUSSI, et la fenetre
   * ne se ferme pas toute seule : on regarde les imports finir.
   */
  multiple?: boolean;
}

/** Ce qu'un fichier traverse. Un etat par fichier, jamais un seul global. */
export type EtatImport = 'attente' | 'envoi' | 'importe' | 'erreur';

export interface ImportEnCours {
  nom: string;
  etat: EtatImport;
  pourcent: number;
  motif?: string;
}

/**
 * Combien d'envois simultanes.
 *
 * ⚠️ PAS `Promise.all` SUR LA LISTE ENTIERE. Dix fichiers lances d'un coup
 * saturent la liaison, et chaque barre de progression avance alors trop
 * lentement pour dire quoi que ce soit. Deux a la fois gardent le transfert
 * lisible sans allonger sensiblement le total.
 */
export const CONCURRENCE_IMPORT_MEDIA = 2;

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

export function MediaLibrary({
  isOpen, onClose, mediaType, onSelect, multiple = false,
}: MediaLibraryProps) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MediaType>(mediaType === 'all' ? 'all' : mediaType);
  const [uploading, setUploading] = useState(false);
  /** Une ligne par fichier du lot — l'etat global ne suffit pas a dire lequel a echoue. */
  const [imports, setImports] = useState<ImportEnCours[]>([]);
  /**
   * Avancement de l'envoi, de 0 a 100.
   *
   * Sur un rush de 75 Mo, un simple « Uploader… » laisse une minute d'ecran
   * fige : impossible de distinguer un envoi lent d'un envoi mort. C'est
   * exactement la plainte qui a mene a ce correctif.
   */
  const [progress, setProgress] = useState(0);
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

  /** Le type de media deduit du fichier, comme avant. */
  const typeDuFichier = (f: File): 'image' | 'video' | 'audio' | undefined => (
    f.type.startsWith('image/') ? 'image'
      : f.type.startsWith('video/') ? 'video'
        : f.type.startsWith('audio/') ? 'audio' : undefined);

  /**
   * Traduit une panne en phrase lisible.
   *
   * ⚠️ NI MINIO, NI TRACE, NI CODE HTTP. Ce qui remonte ici vient du reseau ou
   * du stockage ; le montrer tel quel demanderait a la personne de diagnostiquer
   * une infrastructure qu'elle ne connait pas.
   */
  const motifLisible = (err: unknown, f: File): string => {
    const brut = err instanceof Error ? err.message.toLowerCase() : '';
    if (!typeDuFichier(f)) return 'Format non pris en charge';
    if (brut.includes('trop') || brut.includes('large') || brut.includes('size')) {
      return 'Fichier trop lourd';
    }
    return 'Envoi impossible';
  };

  /**
   * ── UN ENVOI, PUIS LES SUIVANTS PAR PETITS PAQUETS ────────────────────
   *
   * ⚠️ CHAQUE FICHIER PASSE PAR `uploadFile`, LE MEME QU'AVANT. Le lot n'est
   * qu'une orchestration : ecrire un second chemin d'envoi aurait donne deux
   * facons de televerser, et le jour ou l'une serait corrigee, l'autre
   * continuerait.
   *
   * ⚠️ ET UN FICHIER REFUSE N'EMPORTE PAS LES AUTRES. Sur cinq musiques, il est
   * normal qu'une soit dans un format que le stockage refuse ; annuler les
   * quatre bonnes punirait la personne pour une erreur qui n'en est pas une.
   */
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fichiers = [...(e.target.files ?? [])];
    e.target.value = '';
    if (fichiers.length === 0) return;

    setUploading(true);
    setProgress(0);
    setImports(fichiers.map((f) => ({ nom: f.name, etat: 'attente' as const, pourcent: 0 })));

    const majLigne = (i: number, patch: Partial<ImportEnCours>) => {
      setImports((v) => v.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    };

    let reussis = 0;
    const traiter = async (i: number) => {
      const f = fichiers[i];
      majLigne(i, { etat: 'envoi' });
      try {
        const { publicUrl } = await uploadFile(f, {
          purpose: 'library',
          onProgress: (p) => {
            majLigne(i, { pourcent: p });
            // La barre globale suit le fichier le plus avance : un seul
            // chiffre pour un lot n'aurait aucun sens, celui-ci en a un.
            if (fichiers.length === 1) setProgress(p);
          },
        });
        majLigne(i, { etat: 'importe', pourcent: 100 });
        reussis += 1;
        onSelect(publicUrl, f.name, typeDuFichier(f));
      } catch (err) {
        majLigne(i, { etat: 'erreur', motif: motifLisible(err, f) });
      }
    };

    /* La file est consommee par `CONCURRENCE_IMPORT_MEDIA` ouvriers : l'ordre
       d'AFFICHAGE reste celui de la selection, seul l'ordre d'execution
       change. */
    let prochain = 0;
    const ouvrier = async () => {
      for (;;) {
        const i = prochain;
        prochain += 1;
        if (i >= fichiers.length) return;
        // eslint-disable-next-line no-await-in-loop
        await traiter(i);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCE_IMPORT_MEDIA, fichiers.length) }, ouvrier),
    );

    setUploading(false);
    setProgress(0);
    /* ⚠️ ON NE FERME QUE POUR UN FICHIER UNIQUE. Fermer sur un lot escamoterait
       le compte-rendu au moment precis ou il devient utile — celui ou l'un des
       fichiers n'est pas passe. */
    if (!multiple && reussis > 0) onClose();
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
          <label className={`relative flex items-center gap-1.5 overflow-hidden rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-2 text-xs font-semibold text-white cursor-pointer transition ${uploading ? 'pointer-events-none' : ''}`}>
            {/* Barre de progression : une teinte plus claire qui remplit le
                bouton de gauche a droite. Elle reste DERRIERE le libelle —
                le pourcentage doit rester lisible pendant tout l'envoi. */}
            {uploading && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-purple-400/60 transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? `Envoi ${progress} %` : 'Uploader'}
            </span>
            <input
              type="file"
              accept={acceptType}
              multiple={multiple}
              onChange={handleUpload}
              className="hidden"
              disabled={uploading}
              data-media-input
            />
          </label>
        </div>

        {/* ── LE COMPTE-RENDU DU LOT ────────────────────────────────────
            ⚠️ UN ETAT PAR FICHIER, PAS UNE ROUE QUI TOURNE. Une progression
            globale ne dit ni lequel avance, ni lequel a echoue — c'est-a-dire
            rien de ce qu'on a besoin de savoir quand un import se passe mal. */}
        {imports.length > 0 && (
          <div className="border-b border-white/10 px-5 py-3" data-media-imports>
            <p className="mb-1.5 text-[11px] text-gray-400" data-media-imports-resume>
              {imports.filter((i) => i.etat === 'importe').length}
              {' / '}
              {imports.length}
              {' importé'}
              {imports.length > 1 ? 'es' : 'e'}
              {imports.some((i) => i.etat === 'erreur')
                && ` — ${imports.filter((i) => i.etat === 'erreur').length} non ajouté`}
            </p>
            <ul className="space-y-1">
              {imports.map((i) => (
                <li
                  key={i.nom}
                  data-media-import={i.nom}
                  data-media-import-etat={i.etat}
                  className="flex items-center justify-between gap-2 text-[11px]"
                >
                  <span className="min-w-0 truncate text-gray-300">{i.nom}</span>
                  <span className={
                    i.etat === 'erreur' ? 'shrink-0 text-amber-400'
                      : i.etat === 'importe' ? 'shrink-0 text-emerald-400'
                        : 'shrink-0 text-gray-500'
                  }
                  >
                    {i.etat === 'attente' && 'En attente'}
                    {i.etat === 'envoi' && `Importation… ${i.pourcent} %`}
                    {i.etat === 'importe' && 'Importée ✓'}
                    {i.etat === 'erreur' && (i.motif ?? 'Échec')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

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
