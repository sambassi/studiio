'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  UserSquare2,
  Upload,
  Loader2,
  Sparkles,
  AlertTriangle,
  Check,
  Download,
  RefreshCw,
  Image as ImageIcon,
  Clapperboard,
} from 'lucide-react';

const AVATAR_VIDEO_COST = 40;
const MAX_SCRIPT_CHARS = 1200;
/** Limite imposée par HeyGen sur l'envoi d'un asset. */
const MAX_VIDEO_MB = 32;

type AvatarKind = 'photo' | 'video';

/** Statuts HeyGen signifiant « avatar utilisable ». */
const READY_STATUSES = ['completed', 'ready', 'success'];

interface AvatarRow {
  id: string;
  name: string | null;
  status: string;
  avatar_type?: AvatarKind;
  training_error?: string | null;
  source_url: string | null;
  created_at: string;
}

interface Voice {
  voiceId: string;
  name: string;
  language?: string;
}

type GenStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed';

export default function AvatarPage() {
  const [loading, setLoading] = useState(true);
  const [avatar, setAvatar] = useState<AvatarRow | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);

  // Création
  const [kind, setKind] = useState<AvatarKind>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [creating, setCreating] = useState(false);

  // Génération
  const [script, setScript] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [ratio, setRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const trainingPollRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Recharge l'avatar et les voix. Le GET rafraîchit au passage le statut
   * d'entraînement côté HeyGen — c'est ce qui permet de suivre la préparation
   * d'un avatar vidéo sans route dédiée.
   */
  const loadAvatar = useCallback(async (withVoices: boolean) => {
    const res = await fetch('/api/avatar/create');
    const json = await res.json();
    if (!json.success) return null;

    setAvatar(json.data.avatar);

    if (withVoices) {
      const list: Voice[] = json.data.voices || [];
      setVoices(list);
      // On présélectionne une vraie voix : aucun choix « vide » n'est proposé,
      // car un voice_id absent fait échouer HeyGen en 400.
      setVoiceId(json.data.defaultVoiceId || list[0]?.voiceId || '');
      if (list.length === 0) {
        setNotice(
          "Les voix HeyGen n'ont pas pu être chargées. La génération utilisera une voix de secours — le résultat peut ne pas être en français.",
        );
      }
    }
    return json.data.avatar as AvatarRow | null;
  }, []);

  // ── Chargement initial ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!cancelled) await loadAvatar(true);
      } catch {
        // La page reste utilisable : l'utilisateur pourra réessayer.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAvatar]);

  // ── Suivi de l'entraînement ─────────────────────────────────────────
  // Un avatar vidéo (digital twin) s'entraîne pendant plusieurs minutes. Tant
  // qu'il n'est pas prêt, on réinterroge périodiquement — la génération reste
  // bloquée côté serveur (409) pendant ce temps.
  const training = !!avatar && !READY_STATUSES.includes(avatar.status);
  const trainingFailed = avatar?.status === 'failed';

  useEffect(() => {
    if (!training || trainingFailed) return;
    let cancelled = false;

    const tick = async () => {
      try {
        await loadAvatar(false);
      } catch {
        // Erreur transitoire : on retentera au prochain tour.
      }
      if (!cancelled) trainingPollRef.current = setTimeout(tick, 10000);
    };

    trainingPollRef.current = setTimeout(tick, 10000);
    return () => {
      cancelled = true;
      if (trainingPollRef.current) clearTimeout(trainingPollRef.current);
    };
  }, [training, trainingFailed, loadAvatar]);

  // Nettoyage du timer de polling au démontage — évite une fuite si
  // l'utilisateur quitte la page pendant une génération.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Libère l'URL d'objet de l'aperçu quand elle change ou au démontage.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // Progression estimée pendant la génération.
  //
  // HeyGen ne renvoie qu'un statut (pending/processing/completed), pas de
  // pourcentage. On monte donc de façon asymptotique vers 90 % : rapide au
  // début, de plus en plus lente ensuite. La barre n'est jamais bloquée à 0 et
  // n'atteint jamais 100 % avant la fin réelle. Si l'API expose un jour un
  // pourcentage réel, poll() le prend en compte et il l'emporte.
  useEffect(() => {
    if (genStatus !== 'pending' && genStatus !== 'processing') return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const estimated = 90 * (1 - Math.exp(-elapsedSec / 45));
      // Math.max : la progression ne recule jamais, même quand le statut
      // passe de "pending" à "processing" et relance cet effet.
      setProgress((prev) => Math.max(prev, Math.min(90, estimated)));
    }, 200);
    return () => clearInterval(id);
  }, [genStatus]);

  // ── Création de l'avatar ────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);

    // Contrôle côté client de la limite HeyGen : évite un upload de plusieurs
    // dizaines de Mo pour rien.
    if (f.type.startsWith('video/') && f.size > MAX_VIDEO_MB * 1024 * 1024) {
      setError(
        `Vidéo trop lourde (${Math.round(f.size / 1024 / 1024)} Mo). HeyGen limite l'envoi à ${MAX_VIDEO_MB} Mo — réduisez la durée ou la qualité.`,
      );
      e.target.value = '';
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    // Aperçu local pour l'image comme pour la vidéo.
    setPreview(URL.createObjectURL(f));
  };

  const selectKind = (k: AvatarKind) => {
    if (k === kind) return;
    setKind(k);
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    setConsent(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCreate = async () => {
    if (!file || !consent || creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('consent', 'true');
      fd.append('name', kind === 'video' ? 'Mon avatar vidéo' : 'Mon avatar');

      const res = await fetch('/api/avatar/create', { method: 'POST', body: fd });
      const json = await res.json();

      if (!json.success) {
        setError(json.error || "La création de l'avatar a échoué.");
        return;
      }
      setAvatar(json.data.avatar);
      setNotice(
        kind === 'video'
          ? "Avatar vidéo créé. L'entraînement chez HeyGen prend plusieurs minutes — la page se met à jour toute seule."
          : "Avatar créé. HeyGen l'entraîne quelques minutes — vous pouvez déjà écrire votre texte.",
      );
      setFile(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setConsent(false);
    } catch {
      setError('Connexion impossible. Réessayez.');
    } finally {
      setCreating(false);
    }
  };

  // ── Génération de la vidéo ──────────────────────────────────────────
  const poll = useCallback(async (generationId: string) => {
    try {
      const res = await fetch(`/api/avatar/status?generationId=${generationId}`);
      const json = await res.json();

      if (!json.success) {
        // Erreur transitoire : on retente, le serveur ne marque pas d'échec.
        pollRef.current = setTimeout(() => poll(generationId), 8000);
        return;
      }

      const { status, videoUrl: url, error: errMsg, progress: realProgress } = json.data;

      if (status === 'completed' && url) {
        setProgress(100);
        setVideoUrl(url);
        setGenStatus('completed');
        return;
      }
      if (status === 'failed') {
        setGenStatus('failed');
        setError(errMsg || 'La génération a échoué.');
        return;
      }
      // Pourcentage réel s'il existe un jour côté API : il prime sur l'estimation.
      if (typeof realProgress === 'number' && Number.isFinite(realProgress)) {
        setProgress((prev) => Math.max(prev, Math.min(99, realProgress)));
      }
      setGenStatus('processing');
      pollRef.current = setTimeout(() => poll(generationId), 5000);
    } catch {
      pollRef.current = setTimeout(() => poll(generationId), 8000);
    }
  }, []);

  const handleGenerate = async () => {
    if (!avatar || !script.trim() || genStatus === 'pending' || genStatus === 'processing') return;
    setError(null);
    setNotice(null);
    setVideoUrl(null);
    setProgress(0);
    setGenStatus('pending');

    try {
      const res = await fetch('/api/avatar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatarId: avatar.id,
          script: script.trim(),
          voiceId: voiceId || undefined,
          aspectRatio: ratio,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        setGenStatus('failed');
        setError(
          json.refunded
            ? `${json.error} Vos crédits ont été remboursés.`
            : json.error || 'La génération a échoué.',
        );
        return;
      }
      setGenStatus('processing');
      poll(json.data.generationId);
    } catch {
      setGenStatus('failed');
      setError('Connexion impossible. Réessayez.');
    }
  };

  const busy = genStatus === 'pending' || genStatus === 'processing';

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center flex-shrink-0">
          <UserSquare2 className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Mon avatar qui parle</h1>
          <p className="text-sm text-gray-400">
            Votre photo prend vie et prononce le texte de votre choix.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {/* ÉTAPE 1 — création (première visite uniquement) */}
      {!avatar && (
        <div className="card-base p-6 space-y-5">
          <div>
            <h2 className="font-semibold mb-1">1. À partir de quoi ?</h2>
            <p className="text-sm text-gray-400">
              Créez votre avatar à partir d’une photo. L’avatar vidéo (rendu encore plus réaliste)
              arrive bientôt.
            </p>
          </div>

          {/* Choix de la nature de l'avatar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              {
                id: 'photo' as const,
                Icon: ImageIcon,
                title: 'À partir d’une photo',
                sub: 'Prêt en quelques minutes',
                soon: false,
              },
              {
                id: 'video' as const,
                Icon: Clapperboard,
                title: 'À partir d’une vidéo',
                sub: 'Plus réaliste, entraînement plus long',
                soon: true,
              },
            ]).map(({ id, Icon, title, sub, soon }) => (
              <button
                key={id}
                onClick={() => !soon && selectKind(id)}
                disabled={soon}
                aria-disabled={soon}
                className={`relative rounded-xl p-4 text-left transition ${
                  soon
                    ? 'bg-gray-900/40 opacity-60 cursor-not-allowed'
                    : kind === id
                      ? 'bg-purple-600/20 ring-1 ring-purple-500/50'
                      : 'bg-gray-900/60 hover:bg-gray-800/70'
                }`}
              >
                {soon && (
                  <span className="absolute top-2 right-2 rounded-full bg-purple-500/20 text-purple-200 text-[10px] font-semibold px-2 py-0.5 ring-1 ring-purple-500/40">
                    Bientôt disponible
                  </span>
                )}
                <Icon
                  className={`w-5 h-5 mb-2 ${kind === id && !soon ? 'text-purple-300' : 'text-gray-400'}`}
                />
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
              </button>
            ))}
          </div>

          {/* Recommandations HeyGen, propres à chaque mode */}
          <div className="rounded-xl bg-gray-900/60 p-4 text-xs text-gray-400 leading-relaxed">
            {kind === 'photo' ? (
              <>
                <span className="text-gray-300 font-medium">Pour un bon résultat :</span> un
                portrait net, de face, visage bien éclairé et non masqué. JPG, PNG ou WebP,
                10 Mo maximum.
              </>
            ) : (
              <>
                <span className="text-gray-300 font-medium">Pour un bon résultat :</span> visage
                de face, bien éclairé, en train de parler. Idéalement 1 à 2 minutes, arrière-plan
                calme et peu de mouvement, cadrage stable. MP4 ou WebM,{' '}
                <span className="text-gray-300">{MAX_VIDEO_MB} Mo maximum</span> — c&apos;est la
                limite d&apos;envoi de HeyGen, pensez à compresser.
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={
              kind === 'video'
                ? 'video/mp4,video/webm,video/quicktime'
                : 'image/jpeg,image/png,image/webp'
            }
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-gray-700 hover:border-purple-500 transition p-8 flex flex-col items-center gap-3 text-gray-400 hover:text-white"
          >
            {preview && kind === 'video' ? (
              <video
                src={preview}
                className="w-40 rounded-xl bg-black"
                muted
                playsInline
                controls
              />
            ) : preview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={preview}
                alt="Aperçu de votre photo"
                className="w-32 h-32 object-cover rounded-xl"
              />
            ) : (
              <Upload className="w-8 h-8" />
            )}
            <span className="text-sm">
              {file
                ? `${file.name} — ${Math.round(file.size / 1024 / 1024)} Mo`
                : kind === 'video'
                  ? 'Choisir une vidéo'
                  : 'Choisir une photo'}
            </span>
          </button>

          {/* Consentement — obligatoire, également vérifié côté serveur */}
          <label className="flex items-start gap-3 cursor-pointer rounded-xl bg-gray-900/60 p-4">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 flex-shrink-0 accent-purple-600"
            />
            <span className="text-sm text-gray-300">
              {kind === 'video'
                ? "Je certifie être la personne visible dans la vidéo et j'autorise Studiio et HeyGen à l'utiliser pour entraîner un avatar à mon effigie."
                : "Je certifie être la personne visible sur l'image et j'autorise Studiio à en créer un avatar animé."}
            </span>
          </label>

          <button
            onClick={handleCreate}
            disabled={!file || !consent || creating}
            className="w-full button-primary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {kind === 'video' ? 'Envoi de la vidéo…' : 'Création…'}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {kind === 'video' ? 'Créer mon avatar vidéo' : 'Créer mon avatar'}
              </>
            )}
          </button>
        </div>
      )}

      {/* ÉTAPE 2 — génération */}
      {avatar && (
        <div className="card-base p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {avatar.source_url &&
                (avatar.avatar_type === 'video' ? (
                  <video
                    src={avatar.source_url}
                    className="w-12 h-12 rounded-xl object-cover flex-shrink-0 bg-black"
                    muted
                    playsInline
                  />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={avatar.source_url}
                    alt="Votre avatar"
                    className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                  />
                ))}
              <div className="min-w-0">
                <div className="font-semibold truncate">{avatar.name || 'Mon avatar'}</div>
                <div className="text-xs text-gray-500">
                  {avatar.avatar_type === 'video' ? 'Avatar vidéo' : 'Avatar photo'}
                  {training ? ' — en préparation' : ' — prêt à parler'}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setAvatar(null);
                setVideoUrl(null);
                setProgress(0);
                setGenStatus('idle');
                setError(null);
                setNotice(null);
              }}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 flex-shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Changer de source
            </button>
          </div>

          {/* Entraînement en cours — la génération reste bloquée (409 côté serveur) */}
          {training && !trainingFailed && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              <Loader2 className="w-5 h-5 flex-shrink-0 mt-0.5 animate-spin" />
              <div>
                <div className="font-medium">Entraînement en cours…</div>
                <div className="text-xs mt-1 text-amber-200/80">
                  {avatar.avatar_type === 'video'
                    ? "HeyGen entraîne votre avatar vidéo à partir du footage. Cela prend généralement plusieurs minutes. Cette page se met à jour toute seule."
                    : "HeyGen prépare votre avatar. Encore un instant — cette page se met à jour toute seule."}
                </div>
              </div>
            </div>
          )}

          {trainingFailed && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">L&apos;entraînement a échoué</div>
                <div className="text-xs mt-1 text-red-200/80">
                  {avatar.training_error ||
                    "HeyGen n'a pas pu entraîner cet avatar."}{' '}
                  Utilisez « Changer de source » pour réessayer avec un autre fichier.
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Ce que dit votre avatar</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value.slice(0, MAX_SCRIPT_CHARS))}
              rows={5}
              placeholder="Bonjour, je suis…"
              className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-3 text-sm resize-y"
            />
            <div className="mt-1 text-right text-xs text-gray-500">
              {script.length} / {MAX_SCRIPT_CHARS}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Voix</label>
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                disabled={voices.length === 0}
                className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm disabled:opacity-50"
              >
                {voices.length === 0 && <option value="">Voix indisponibles</option>}
                {voices.map((v) => (
                  <option key={v.voiceId} value={v.voiceId}>
                    {v.name}
                    {v.language ? ` — ${v.language}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Format</label>
              <div className="flex gap-2">
                {(['9:16', '16:9', '1:1'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRatio(r)}
                    className={`flex-1 rounded-xl px-3 py-2.5 text-sm transition ${
                      ratio === r
                        ? 'bg-purple-600/30 text-purple-200 ring-1 ring-purple-500/50'
                        : 'bg-gray-900 text-gray-400 hover:text-white'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!script.trim() || busy || training}
            className="w-full button-primary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {genStatus === 'pending' ? 'Lancement…' : 'Génération en cours…'}
              </>
            ) : training ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Avatar en préparation…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> Générer ({AVATAR_VIDEO_COST} crédits)
              </>
            )}
          </button>

          {/* Barre de progression — masquée à l'état initial et en cas d'échec. */}
          {(busy || genStatus === 'completed') && (
            <div className="flex items-center gap-3">
              <div
                className="flex-1 rounded-full overflow-hidden"
                style={{ height: 5, backgroundColor: '#1F2937' }}
                role="progressbar"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progression de la génération"
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${progress}%`,
                    background: 'linear-gradient(90deg, #7C3AED 0%, #EC4899 100%)',
                    transition: 'width 300ms ease-out',
                  }}
                />
              </div>
              <span
                className="text-xs font-medium text-gray-400 text-right"
                style={{ minWidth: 34, fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(progress)}%
              </span>
            </div>
          )}

          {busy && (
            <p className="text-center text-xs text-gray-500">
              La génération prend généralement 1 à 5 minutes. Vous pouvez laisser cette page
              ouverte.
            </p>
          )}
        </div>
      )}

      {/* Aperçu du résultat */}
      {videoUrl && (
        <div className="card-base p-6 space-y-4">
          <h2 className="font-semibold">Votre vidéo</h2>
          <video
            src={videoUrl}
            controls
            playsInline
            className="w-full rounded-xl bg-black"
            style={{ maxHeight: '70vh' }}
          />
          <a
            href={videoUrl}
            download
            className="inline-flex items-center gap-2 text-sm text-purple-300 hover:text-purple-200"
          >
            <Download className="w-4 h-4" /> Télécharger la vidéo
          </a>
        </div>
      )}
    </div>
  );
}
