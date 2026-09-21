'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Upload, Loader2, Music, X, Clock, ShieldCheck, Trash2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { getExpiresAt, formatRemaining, getRetentionColor, getRetentionBgColor } from '@/lib/storage/retention';
import { useUploadQueue, trierFichiersRecus, type ElementEnvoi, type FichierRefuse } from '@/lib/storage/useUploadQueue';
import { urlPubliqueAbsolue } from '@/lib/creer/posterUpload';
import { OptionBouton } from '@/components/ui/OptionBouton';
import { ETAT_INTERACTIF_SANS_FOND } from '@/lib/ui/etats';

type MediaType = 'image' | 'video' | 'audio' | 'all';
type TypeFichier = 'image' | 'video' | 'audio';

/** Un fichier envoyé, tel que la Médiathèque le remet à l'appelant. */
export interface FichierChoisi {
  url: string;
  name: string;
  type?: TypeFichier;
}

function typeDeFichier(mime: string): TypeFichier | undefined {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return undefined;
}

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
   * Reçoit EN UN SEUL APPEL tous les fichiers d'un envoi groupé qui ont
   * abouti (URL absolues). Un appelant qui se referme sur son état — la
   * banque de rushes de l'Autopilote — perdrait tous les fichiers sauf le
   * dernier s'il recevait N appels `onSelect` dans la même tâche.
   *
   * Absent, chaque fichier passe par `onSelect`, comme avant.
   */
  onSelectMany?: (items: FichierChoisi[]) => void;
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

export function MediaLibrary({ isOpen, onClose, mediaType, onSelect, onSelectMany }: MediaLibraryProps) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MediaType>(mediaType === 'all' ? 'all' : mediaType);
  /**
   * La file d'envoi — plusieurs fichiers, deux à la fois, un état par fichier.
   *
   * Sur un rush de 75 Mo, un simple « Uploader… » laissait une minute d'ecran
   * fige : impossible de distinguer un envoi lent d'un envoi mort. C'est la
   * plainte qui a mene a la barre de progression ; l'envoi groupé garde cette
   * barre (pondérée par la taille) et y ajoute une ligne par fichier.
   */
  const envoi = useUploadQueue({ purpose: 'library' });
  const uploading = envoi.enCours;
  const progress = envoi.progression.pourcent;
  /** Refusés AVANT l'envoi (type, taille) : signalés, jamais relancés. */
  const [refuses, setRefuses] = useState<FichierRefuse[]>([]);
  const [survolDepot, setSurvolDepot] = useState(false);
  /** Les identifiants déjà remis à l'appelant — jamais deux fois le même. */
  const livresRef = useRef<Set<string>>(new Set());
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

  const acceptType = mediaType === 'image' ? 'image/*' : mediaType === 'video' ? 'video/*' : mediaType === 'audio' ? 'audio/*' : '*/*';

  /** Ferme et oublie l'envoi en cours d'affichage — la prochaine ouverture repart propre. */
  const fermer = () => {
    envoi.vider();
    setRefuses([]);
    livresRef.current = new Set();
    onClose();
  };

  /**
   * Envoie les fichiers reçus (sélecteur ou dépôt), puis remet à l'appelant
   * ceux qui ont abouti.
   *
   * ⚠️ L'URL REMISE EST ABSOLUE. En production (`STORAGE_PROVIDER=s3`) la
   * route `signed-url` répond une URL relative, que le filtre strict de
   * l'Autopilote (`^https?://`) écarterait EN SILENCE : le rush serait
   * « ajouté » à l'écran et absent de la configuration enregistrée. C'est le
   * point unique `urlPubliqueAbsolue` qui tranche (cf. lessons 2026-09-21).
   */
  const livrer = (finaux: ElementEnvoi[], echecPrealable: boolean) => {
    const choisis: FichierChoisi[] = [];
    let echec = echecPrealable;
    for (const e of finaux) {
      if (e.statut !== 'ok' || !e.resultat || livresRef.current.has(e.id)) {
        if (e.statut === 'erreur') echec = true;
        continue;
      }
      const absolue = urlPubliqueAbsolue(e.resultat.publicUrl, window.location.origin);
      if (!absolue) { echec = true; continue; }
      livresRef.current.add(e.id);
      console.log(`[MediaLibrary] Upload ${e.resultat.mode} termine : ${e.nom}`);
      choisis.push({ url: absolue, name: e.nom, type: typeDeFichier(e.file.type) });
    }
    if (choisis.length > 0) {
      if (onSelectMany) onSelectMany(choisis);
      else for (const c of choisis) onSelect(c.url, c.name, c.type);
    }
    // Un échec garde la fenêtre ouverte : la ligne en erreur et son
    // « Réessayer » sont là, et rien n'a été perdu de ce qui a abouti.
    if (!echec) fermer();
  };

  // Sans `onSelectMany`, l'appelant attend UN fichier (affiche, musique) :
  // on n'en prend qu'un plutot que d'appeler `onSelect` N fois, ou le
  // dernier « gagnerait » en silence.
  const multiple = typeof onSelectMany === 'function';
  const envoyerFichiers = async (recusBruts: File[]) => {
    const recus = multiple ? recusBruts : recusBruts.slice(0, 1);
    const { acceptes, refuses: horsJeu } = trierFichiersRecus(recus, acceptType);
    setRefuses((prev) => [...prev, ...horsJeu]);
    if (acceptes.length === 0) return;
    const finaux = await envoi.ajouter(acceptes);
    // La grille montre les nouveaux venus même si l'un d'eux a échoué.
    await fetchFiles();
    livrer(finaux, horsJeu.length > 0 || refuses.length > 0);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const recus = Array.from(e.target.files ?? []);
    // Vidé tout de suite : re-choisir le même fichier doit redéclencher `change`.
    e.target.value = '';
    if (recus.length === 0) return;
    void envoyerFichiers(recus);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setSurvolDepot(false);
    if (uploading) return;
    const recus = Array.from(e.dataTransfer?.files ?? []);
    if (recus.length === 0) return;
    void envoyerFichiers(recus);
  };

  /** Relance les échecs — tous, ou un seul. Les réussites ne repartent pas. */
  const reessayer = async (ids?: string[]) => {
    const finaux = await envoi.reessayer(ids);
    if (finaux.length === 0) return;
    await fetchFiles();
    // Même remise qu'au premier envoi — `livresRef` empêche un doublon. La
    // fenêtre ne se ferme que si plus rien n'est en erreur, y compris ce
    // qui n'a pas été relancé.
    const autresEnErreur = envoi.elements.some((x) => x.statut === 'erreur' && !finaux.some((f) => f.id === x.id));
    livrer(finaux, autresEnErreur || refuses.length > 0);
  };

  const filtered = files.filter((f) => {
    if (search) {
      return f.name.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  if (!isOpen) return null;

  const echecs = envoi.progression.echecs + refuses.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={fermer}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className={`relative w-full max-w-2xl mx-4 bg-gray-900 rounded-2xl border overflow-hidden transition-colors ${
          survolDepot ? 'border-purple-500' : 'border-gray-700'
        }`}
        onClick={(e) => e.stopPropagation()}
        // Dépôt de plusieurs fichiers n'importe où sur la fenêtre. `preventDefault`
        // sur `dragover` est ce qui autorise le `drop` — sans lui, le
        // navigateur ouvre le fichier à la place.
        onDragOver={(e) => { e.preventDefault(); if (!survolDepot) setSurvolDepot(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSurvolDepot(false); }}
        onDrop={handleDrop}
        data-mediatheque-depot
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">Médiathèque</h2>
          <button onClick={fermer} aria-label="Fermer" className={`rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white ${ETAT_INTERACTIF_SANS_FOND}`}>
            <X size={18} />
          </button>
        </div>

        {survolDepot && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-purple-600/20 text-sm font-semibold text-white">
            Déposez vos fichiers ici
          </div>
        )}

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
              {/* Filtre = option persistante : coche + aria-pressed + violet. */}
              {TYPE_FILTERS.map((t) => (
                <OptionBouton key={t.key} selected={filter === t.key} onSelect={() => setFilter(t.key)}>
                  {t.label}
                </OptionBouton>
              ))}
            </div>
          )}
          {filtered.length > 0 && (
            <button
              onClick={() => {
                if (selected.size === filtered.length) setSelected(new Set());
                else setSelected(new Set(filtered.map((f) => f.url)));
              }}
              className={`rounded-lg px-2 py-1.5 text-[10px] font-medium bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 whitespace-nowrap ${ETAT_INTERACTIF_SANS_FOND}`}
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
              {uploading
                ? `Envoi ${envoi.progression.termines}/${envoi.progression.total} · ${progress} %`
                : 'Uploader'}
            </span>
            <input
              type="file"
              accept={acceptType}
              multiple={multiple}
              onChange={handleUpload}
              className="hidden"
              disabled={uploading}
              data-mediatheque-input
            />
          </label>
        </div>

        {/* Envois en cours ou terminés : une ligne par fichier. La liste
            reste tant qu'un fichier est en erreur — c'est là qu'on relance. */}
        {(envoi.elements.length > 0 || refuses.length > 0) && (
          <div className="px-5 py-2 border-b border-gray-800 bg-gray-900/60" data-mediatheque-envois>
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {envoi.elements.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-[11px]" data-mediatheque-envoi={e.statut}>
                  {e.statut === 'erreur'
                    ? <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                    : e.statut === 'ok'
                      ? <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                      : <Loader2 size={12} className={`shrink-0 ${e.statut === 'envoi' ? 'animate-spin text-purple-400' : 'text-gray-600'}`} />}
                  <span className="flex-1 truncate text-gray-300" title={e.nom}>{e.nom}</span>
                  {e.statut === 'erreur' ? (
                    <>
                      <span className="truncate text-amber-400" title={e.erreur}>{e.erreur}</span>
                      <button
                        type="button"
                        onClick={() => { void reessayer([e.id]); }}
                        disabled={uploading}
                        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-800 text-gray-200 hover:text-white hover:bg-gray-700 ${ETAT_INTERACTIF_SANS_FOND}`}
                        data-mediatheque-reessayer={e.id}
                      >
                        <RefreshCw size={10} /> Réessayer
                      </button>
                    </>
                  ) : (
                    <span className="tabular-nums text-gray-500">{e.statut === 'attente' ? 'En attente' : `${e.pourcent} %`}</span>
                  )}
                </li>
              ))}
              {refuses.map((r, i) => (
                <li key={`refuse-${i}-${r.file.name}`} className="flex items-center gap-2 text-[11px]" data-mediatheque-envoi="refuse">
                  <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                  <span className="flex-1 truncate text-gray-300" title={r.file.name}>{r.file.name}</span>
                  <span className="truncate text-amber-400">{r.raison}</span>
                </li>
              ))}
            </ul>
            {echecs > 0 && !uploading && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-amber-400">
                  {echecs} fichier{echecs > 1 ? 's' : ''} non envoyé{echecs > 1 ? 's' : ''} — les autres sont bien ajoutés.
                </span>
                {envoi.progression.echecs > 0 && (
                  <button
                    type="button"
                    onClick={() => { void reessayer(); }}
                    className={`flex items-center gap-1 rounded-lg bg-gray-800 hover:bg-gray-700 px-2 py-1 text-[10px] font-medium text-white whitespace-nowrap ${ETAT_INTERACTIF_SANS_FOND}`}
                    data-mediatheque-reessayer-echecs
                  >
                    <RefreshCw size={10} /> Réessayer les échecs
                  </button>
                )}
              </div>
            )}
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
                    onSelect(file.url, file.name, file.type); fermer();
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
              aria-busy={deleting || undefined}
              className={`flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-3 py-2 text-xs font-semibold text-white ${ETAT_INTERACTIF_SANS_FOND}`}
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
