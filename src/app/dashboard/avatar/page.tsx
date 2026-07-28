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
} from 'lucide-react';

const AVATAR_VIDEO_COST = 40;
const MAX_SCRIPT_CHARS = 1200;

interface AvatarRow {
  id: string;
  name: string | null;
  status: string;
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

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Chargement initial ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/avatar/create');
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          setAvatar(json.data.avatar);
          const list: Voice[] = json.data.voices || [];
          setVoices(list);
          // On preselectionne une vraie voix : aucun choix "vide" n'est
          // propose, car un voice_id absent fait echouer HeyGen en 400.
          const fallback = json.data.defaultVoiceId || list[0]?.voiceId || '';
          setVoiceId(fallback);
          if (list.length === 0) {
            setNotice(
              "Les voix HeyGen n'ont pas pu être chargées. La génération utilisera une voix de secours — le résultat peut ne pas être en français.",
            );
          }
        }
      } catch {
        // La page reste utilisable : l'utilisateur pourra réessayer.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // ── Création de l'avatar ────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
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
      fd.append('name', 'Mon avatar');

      const res = await fetch('/api/avatar/create', { method: 'POST', body: fd });
      const json = await res.json();

      if (!json.success) {
        setError(json.error || "La création de l'avatar a échoué.");
        return;
      }
      setAvatar(json.data.avatar);
      setNotice(
        "Avatar créé. HeyGen l'entraîne quelques minutes — vous pouvez déjà écrire votre texte.",
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

      const { status, videoUrl: url, error: errMsg } = json.data;

      if (status === 'completed' && url) {
        setVideoUrl(url);
        setGenStatus('completed');
        return;
      }
      if (status === 'failed') {
        setGenStatus('failed');
        setError(errMsg || 'La génération a échoué.');
        return;
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
            <h2 className="font-semibold mb-1">1. Votre photo</h2>
            <p className="text-sm text-gray-400">
              Un portrait net, de face, visage bien visible. JPG, PNG ou WebP, 10 Mo maximum.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-gray-700 hover:border-purple-500 transition p-8 flex flex-col items-center gap-3 text-gray-400 hover:text-white"
          >
            {preview ? (
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
              {file ? file.name : 'Choisir une photo'}
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
              Je certifie être la personne visible sur l&apos;image et j&apos;autorise Studiio à en
              créer un avatar animé.
            </span>
          </label>

          <button
            onClick={handleCreate}
            disabled={!file || !consent || creating}
            className="w-full button-primary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Création…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> Créer mon avatar
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
              {avatar.source_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={avatar.source_url}
                  alt="Votre avatar"
                  className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="font-semibold truncate">{avatar.name || 'Mon avatar'}</div>
                <div className="text-xs text-gray-500">Avatar prêt à parler</div>
              </div>
            </div>
            <button
              onClick={() => {
                setAvatar(null);
                setVideoUrl(null);
                setGenStatus('idle');
                setError(null);
                setNotice(null);
              }}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 flex-shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Changer de photo
            </button>
          </div>

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
            disabled={!script.trim() || busy}
            className="w-full button-primary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {genStatus === 'pending' ? 'Lancement…' : 'Génération en cours…'}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> Générer ({AVATAR_VIDEO_COST} crédits)
              </>
            )}
          </button>

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
