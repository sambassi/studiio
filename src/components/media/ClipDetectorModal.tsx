'use client';

/**
 * ClipDetectorModal — détection des « temps forts » d'un rush vidéo.
 *
 * Couche NON DESTRUCTIVE : ce composant est propre à la page /dashboard/media.
 * Il ne réutilise QUE `detectClips` / `extractClip` de `@/lib/clip-detector`
 * (inchangés) et le flux d'upload signed-url existant. Le modal équivalent de
 * `/dashboard/creer` reste intact — rien n'a été extrait ni partagé, pour
 * qu'une évolution ici ne puisse pas régresser l'éditeur.
 *
 * Cycle de vie : téléchargement du rush → analyse (progression) → revue des
 * séquences (vignette + score + durée, sélection) → extraction + upload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Loader2,
  Pause,
  Play,
  Sparkles,
  X,
} from 'lucide-react';
import { detectClips, extractClip, type DetectedClip } from '@/lib/clip-detector';

export interface ExtractedClip {
  url: string;
  name: string;
}

export interface ClipSource {
  url: string;
  name: string;
}

interface ClipDetectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Rush à analyser. L'identité de l'objet pilote le (re)lancement de l'analyse. */
  source: ClipSource | null;
  /**
   * Appelé après upload des clips. `failure` est renseigné en succès PARTIEL
   * (échec ou interruption après N clips) : l'appelant doit alors afficher un
   * message d'échec, pas un message de succès — sinon l'erreur disparaît avec
   * le modal et l'utilisateur croit que tout est passé.
   */
  onExtracted?: (clips: ExtractedClip[], failure?: string) => void;
}

type Phase = 'downloading' | 'analyzing' | 'review' | 'extracting' | 'done';

const ACCENT = '#7C3AED';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'erreur inconnue';
}

/**
 * Borne une promesse dans le temps.
 * `extractClip` attend `onloadedmetadata` puis `seeked` SANS timeout, alors que
 * `detectClips` documente lui-même que certains MP4 mal indexés ne déclenchent
 * jamais `seeked`. Un tel rush passe donc l'analyse puis fige l'extraction
 * indéfiniment. `clip-detector.ts` étant réutilisé tel quel (contrainte de la
 * couche non destructive), la garde est posée ici, côté appelant.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Nom lisible pour un clip : `<rush>-temps-fort-<n>.webm`, sans le préfixe timestamp. */
function clipFilename(sourceName: string, index: number): string {
  const withoutTimestamp = /^\d{10,}-(.+)$/.exec(sourceName)?.[1] ?? sourceName;
  const base = withoutTimestamp.replace(/\.[^.]+$/, '').slice(0, 60) || 'rush';
  return `${base}-temps-fort-${index + 1}.webm`;
}

/**
 * Upload d'un clip via le flux signed-url existant.
 * Le HEAD final applique la leçon du 2026-06-03 : ne jamais considérer un
 * upload comme réussi sans avoir vérifié que l'objet est réellement servi —
 * une URL morte persistée devient un « média absent » silencieux plus tard.
 * Une erreur réseau/CORS sur le HEAD est tolérée (on ne peut pas conclure),
 * mais un statut explicite d'échec (404, 403…) fait échouer l'étape.
 */
async function uploadClip(file: File): Promise<ExtractedClip> {
  const res = await fetch('/api/upload/signed-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'video/webm',
      purpose: 'clip',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `signed-url ${res.status}`);
  }

  // Pas de `credentials: 'include'` — même contrat que MediaLibrary.tsx. En s3
  // le signedUrl est relatif (le cookie de session part déjà en same-origin) ;
  // sur le chemin Supabase legacy il est cross-origin, et `include` y ferait
  // échouer le CORS faute de `Access-Control-Allow-Credentials`.
  const put = await fetch(data.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'video/webm' },
    body: file,
  });
  if (!put.ok) throw new Error(`upload ${put.status}`);

  let head: Response | null = null;
  try {
    head = await fetch(data.publicUrl, { method: 'HEAD' });
  } catch {
    head = null; // réseau/CORS : on ne peut pas conclure, on n'échoue pas
  }
  if (head && !head.ok) {
    throw new Error(`fichier introuvable après upload (${head.status})`);
  }

  return { url: data.publicUrl as string, name: file.name };
}

export default function ClipDetectorModal({
  isOpen,
  onClose,
  source,
  onExtracted,
}: ClipDetectorModalProps) {
  const [phase, setPhase] = useState<Phase>('downloading');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [clips, setClips] = useState<DetectedClip[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedClip[]>([]);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const sourceFileRef = useRef<File | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // Incrémenté à chaque nouvelle analyse : toute promesse d'un run précédent
  // (fermeture du modal, changement de rush) est ignorée à son retour.
  const runIdRef = useRef(0);
  // Annulation coopérative de la boucle d'extraction (bouton Interrompre).
  const cancelRef = useRef(false);

  const stopPreview = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      previewVideoRef.current?.pause();
    } catch {
      /* élément déjà démonté */
    }
    setPlaying(false);
  }, []);

  const releaseSource = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewSrc(null);
    sourceFileRef.current = null;
  }, []);

  // ── Analyse : téléchargement du rush puis detectClips ──────────────────
  useEffect(() => {
    if (!isOpen || !source) return;

    const runId = ++runIdRef.current;
    const isStale = () => runIdRef.current !== runId;

    setPhase('downloading');
    setProgress(0);
    setStage('Téléchargement de la vidéo…');
    setClips([]);
    setSelectedIds(new Set());
    setPreviewId(null);
    setExtracted([]);
    setError(null);

    (async () => {
      try {
        const res = await fetch(source.url);
        if (!res.ok) throw new Error(`téléchargement impossible (${res.status})`);
        const blob = await res.blob();
        if (isStale()) return;

        const file = new File([blob], source.name, {
          type: blob.type || 'video/mp4',
        });
        sourceFileRef.current = file;
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = URL.createObjectURL(file);
        setPreviewSrc(previewUrlRef.current);

        setPhase('analyzing');
        const result = await detectClips(file, {
          onProgress: (p, s) => {
            if (isStale()) return;
            setProgress(p);
            setStage(s);
          },
        });
        if (isStale()) return;

        setClips(result.clips);
        setSelectedIds(new Set(result.clips.map((c) => c.id)));
        setPreviewId(result.clips[0]?.id ?? null);
        setPhase('review');
        if (result.clips.length === 0) {
          setError(
            'Aucune séquence détectée. La vidéo est peut-être trop courte ou illisible par le navigateur.',
          );
        }
      } catch (err) {
        if (isStale()) return;
        console.error('[ClipDetectorModal] analyse:', err);
        setError(`Échec de l'analyse : ${errorMessage(err)}`);
        setPhase('review');
      }
    })();
  }, [isOpen, source]);

  // Libération des ressources à la fermeture (l'objet URL survivrait sinon
  // jusqu'au rechargement de la page).
  useEffect(() => {
    if (isOpen) return;
    runIdRef.current++;
    stopPreview();
    releaseSource();
  }, [isOpen, stopPreview, releaseSource]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const playClip = (clip: DetectedClip) => {
    const vid = previewVideoRef.current;
    if (!vid) return;
    stopPreview();
    setPreviewId(clip.id);
    try {
      vid.currentTime = clip.startTime;
      vid.play().catch(() => {
        /* autoplay refusé : l'utilisateur peut relancer */
      });
    } catch {
      return;
    }
    setPlaying(true);
    const tick = () => {
      const v = previewVideoRef.current;
      if (!v) {
        rafRef.current = null;
        return;
      }
      // `endTime` est arrondi au dixième par le détecteur et peut dépasser la
      // durée réelle : sans les gardes `ended`/`paused`, la boucle tournerait
      // indéfiniment sur la dernière séquence.
      if (v.ended || v.paused || v.currentTime >= clip.endTime) {
        if (!v.paused) v.pause();
        rafRef.current = null;
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const handleExtract = async () => {
    const file = sourceFileRef.current;
    if (!file || !source) return;
    const chosen = clips.filter((c) => selectedIds.has(c.id));
    if (chosen.length === 0) return;

    stopPreview();
    cancelRef.current = false;
    setPhase('extracting');
    setError(null);
    setProgress(0);

    // La fermeture du modal incrémente `runIdRef` : la boucle s'en sert pour
    // savoir qu'elle est périmée et cesser d'écrire dans l'état.
    const runId = runIdRef.current;
    const aborted = () => cancelRef.current || runIdRef.current !== runId;

    const done: ExtractedClip[] = [];
    const doneIds: string[] = [];
    let failure: string | null = null;

    try {
      for (let i = 0; i < chosen.length; i++) {
        if (aborted()) break;
        const clip = chosen[i];
        setStage(`Extraction ${i + 1}/${chosen.length} — ${clip.label}`);
        setProgress(0);
        // L'extraction se fait en temps réel : budget = 3× la durée du clip,
        // plus une marge fixe pour l'ouverture et le seek initial.
        const raw = await withTimeout(
          extractClip(file, clip.startTime, clip.endTime, (p) =>
            setProgress(Math.max(0, Math.min(100, p))),
          ),
          clip.duration * 3000 + 30_000,
          `extraction trop longue sur « ${clip.label} » — la vidéo est peut-être mal indexée`,
        );
        if (aborted()) break;
        // L'index vient de la liste complète, pour que le nom du fichier
        // corresponde au libellé affiché (« Séquence 4 » → …-temps-fort-4).
        const named = new File([raw], clipFilename(source.name, clips.indexOf(clip)), {
          type: 'video/webm',
        });
        setStage(`Envoi ${i + 1}/${chosen.length}…`);
        const uploaded = await uploadClip(named);
        if (aborted()) break;
        done.push(uploaded);
        doneIds.push(clip.id);
      }

      if (cancelRef.current) {
        failure =
          done.length > 0
            ? `Extraction interrompue — ${done.length} séquence(s) déjà ajoutée(s).`
            : 'Extraction interrompue.';
      }
    } catch (err) {
      console.error('[ClipDetectorModal] extraction:', err);
      failure =
        done.length > 0
          ? `${done.length} séquence(s) ajoutée(s), puis échec : ${errorMessage(err)}`
          : `Échec de l'extraction : ${errorMessage(err)}`;
    } finally {
      // try/finally : l'état de progression est restauré même en cas d'erreur.
      setProgress(0);
      setStage('');
      if (runIdRef.current === runId) {
        setExtracted(done);
        setError(failure);
        setPhase(failure ? 'review' : 'done');
        // Les clips déjà envoyés sortent de la sélection : sans ça, relancer
        // après un échec partiel les ré-extrait et crée des doublons (les
        // chemins de stockage sont horodatés, aucune déduplication serveur).
        if (failure && doneIds.length > 0) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            doneIds.forEach((id) => next.delete(id));
            return next;
          });
        }
      }
      // Remonté même si le modal a été fermé : les fichiers sont bien en ligne,
      // la page doit rafraîchir sa grille et signaler l'échec partiel.
      if (done.length > 0 || failure) {
        onExtracted?.(done, failure ?? undefined);
      }
      cancelRef.current = false;
    }
  };

  // Interrompre pendant l'extraction : arrêt coopératif entre deux clips, et
  // fermeture immédiate du modal pour ne jamais laisser l'utilisateur bloqué
  // (la promesse en vol, si elle ne rend jamais la main, devient orpheline —
  // le garde `runIdRef` empêche tout écriture d'état tardive).
  const cancelExtraction = () => {
    cancelRef.current = true;
    onClose();
  };

  if (!isOpen || !source) return null;

  const busy = phase === 'downloading' || phase === 'analyzing' || phase === 'extracting';
  const maxScore = clips.reduce((m, c) => Math.max(m, c.score), 0) || 1;
  const selectedCount = clips.filter((c) => selectedIds.has(c.id)).length;
  const previewClip = clips.find((c) => c.id === previewId) || null;

  // Une extraction en cours n'est jamais une raison de piéger l'utilisateur :
  // on demande confirmation, puis on interrompt. Les clips déjà envoyés sont
  // conservés et signalés par `onExtracted`.
  const requestClose = () => {
    if (phase === 'extracting') {
      if (window.confirm('Interrompre l’extraction en cours ?')) cancelExtraction();
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={requestClose}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
            >
              <Sparkles size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white">Temps forts</h2>
              <p className="truncate text-[11px] text-gray-500">{source.name}</p>
            </div>
          </div>
          <button
            onClick={requestClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white"
            title={phase === 'extracting' ? 'Interrompre l’extraction' : 'Fermer'}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Progression (téléchargement / analyse / extraction) */}
          {busy && (
            <div className="py-10">
              <div className="mb-3 flex items-center justify-center gap-2 text-sm text-gray-300">
                <Loader2 size={16} className="animate-spin" style={{ color: ACCENT }} />
                {stage || 'Traitement…'}
              </div>
              <div className="mx-auto h-2 w-full max-w-md overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{
                    width: `${Math.max(2, progress)}%`,
                    background: `linear-gradient(90deg, ${ACCENT}, #EC4899)`,
                  }}
                />
              </div>
              <p className="mt-2 text-center text-xs tabular-nums text-gray-500">
                {progress}%
              </p>
              {phase === 'extracting' && (
                <>
                  <p className="mt-4 text-center text-[11px] text-gray-500">
                    L&apos;extraction se fait en temps réel dans le navigateur —
                    gardez cet onglet au premier plan.
                  </p>
                  <div className="mt-4 text-center">
                    <button
                      onClick={cancelExtraction}
                      className="rounded-lg border border-gray-700 px-3 py-1.5 text-[11px] font-medium text-gray-400 transition hover:border-red-500/40 hover:text-red-400"
                    >
                      Interrompre
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {error && !busy && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-300/90">{error}</p>
            </div>
          )}

          {/* Récapitulatif après extraction */}
          {phase === 'done' && (
            <div className="py-8 text-center">
              <div
                className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
              >
                <Check size={24} />
              </div>
              <p className="text-sm font-semibold text-white">
                {extracted.length} séquence{extracted.length > 1 ? 's' : ''} ajoutée
                {extracted.length > 1 ? 's' : ''} à la médiathèque
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Retrouvez-les dans la grille, prêtes à être utilisées dans vos montages.
              </p>
            </div>
          )}

          {/* Revue des séquences détectées */}
          {phase === 'review' && clips.length > 0 && (
            <>
              {previewSrc && (
                <div className="mb-4 overflow-hidden rounded-xl border border-gray-800 bg-black">
                  <video
                    ref={previewVideoRef}
                    src={previewSrc}
                    muted
                    playsInline
                    preload="metadata"
                    className="mx-auto max-h-56 w-auto"
                  />
                  {previewClip && (
                    <div className="flex items-center justify-between gap-3 border-t border-gray-800 px-3 py-2">
                      <span className="truncate text-[11px] text-gray-400">
                        {previewClip.label} · {formatTime(previewClip.startTime)} →{' '}
                        {formatTime(previewClip.endTime)}
                      </span>
                      <button
                        onClick={() => (playing ? stopPreview() : playClip(previewClip))}
                        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-gray-800 px-2.5 py-1.5 text-[11px] font-medium text-gray-200 transition hover:bg-gray-700"
                      >
                        {playing ? <Pause size={12} /> : <Play size={12} />}
                        {playing ? 'Pause' : 'Aperçu'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  {clips.length} séquence{clips.length > 1 ? 's' : ''} détectée
                  {clips.length > 1 ? 's' : ''} — {selectedCount} sélectionnée
                  {selectedCount > 1 ? 's' : ''}
                </p>
                <button
                  onClick={() =>
                    setSelectedIds(
                      selectedCount === clips.length
                        ? new Set()
                        : new Set(clips.map((c) => c.id)),
                    )
                  }
                  className="rounded-lg bg-gray-800 px-2.5 py-1.5 text-[11px] font-medium text-gray-300 transition hover:text-white"
                >
                  {selectedCount === clips.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {clips.map((clip) => {
                  const isSelected = selectedIds.has(clip.id);
                  const intensity = Math.round((clip.score / maxScore) * 100);
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      onClick={() => toggle(clip.id)}
                      onDoubleClick={() => playClip(clip)}
                      className={`group relative overflow-hidden rounded-xl border-2 text-left transition ${
                        isSelected ? '' : 'border-gray-700 hover:border-gray-500'
                      }`}
                      // Couleur d'accent en style inline : les classes Tailwind à
                      // valeur arbitraire sont un piège connu du projet (purge prod).
                      style={
                        isSelected
                          ? { borderColor: ACCENT, boxShadow: `0 0 0 1px ${ACCENT}4D` }
                          : undefined
                      }
                    >
                      {/*
                        Hauteur fixe + object-contain : la vignette est
                        desormais generee au ratio de la source, et
                        `aspect-video object-cover` la recadrait — un rush 9:16
                        perdait le haut et le bas de l'image. `object-contain`
                        montre la frame entiere, quel que soit le format.
                      */}
                      <img
                        src={clip.thumbnailUrl}
                        alt={clip.label}
                        className="h-32 w-full bg-black object-contain"
                      />
                      <span
                        className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border-2 text-[10px] transition ${
                          isSelected ? 'text-white' : 'border-gray-300 bg-black/50 text-transparent'
                        }`}
                        style={
                          isSelected
                            ? { borderColor: ACCENT, backgroundColor: ACCENT }
                            : undefined
                        }
                      >
                        <Check size={11} />
                      </span>
                      <span
                        className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white"
                        style={{ backgroundColor: `${ACCENT}CC` }}
                        title={`Score d'intérêt brut : ${clip.score}`}
                      >
                        {intensity}%
                      </span>
                      <div className="space-y-1 bg-gray-800/80 px-2 py-1.5">
                        <p className="truncate text-[11px] font-medium text-white">
                          {clip.label}
                        </p>
                        <p className="text-[10px] tabular-nums text-gray-400">
                          {formatTime(clip.startTime)} → {formatTime(clip.endTime)} ·{' '}
                          {clip.duration}s
                        </p>
                        <div className="h-1 overflow-hidden rounded-full bg-gray-700">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(4, intensity)}%`,
                              background: `linear-gradient(90deg, ${ACCENT}, #EC4899)`,
                            }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] text-gray-500">
                Le pourcentage indique l&apos;intensité de la séquence (mouvement et
                luminosité) par rapport à la plus dynamique de cette vidéo. Double-cliquez
                une vignette pour la prévisualiser.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        {(phase === 'review' || phase === 'done') && (
          <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-gray-900/95 px-5 py-3">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-xs font-medium text-gray-400 transition hover:text-white"
            >
              {phase === 'done' ? 'Fermer' : 'Annuler'}
            </button>
            {phase === 'review' && clips.length > 0 && (
              <button
                onClick={handleExtract}
                disabled={selectedCount === 0}
                className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: ACCENT }}
              >
                <Sparkles size={13} />
                Extraire {selectedCount > 0 ? selectedCount : ''} séquence
                {selectedCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
