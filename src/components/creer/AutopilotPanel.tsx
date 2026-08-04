'use client';

import { useState, useEffect, useCallback } from 'react';
import { Rocket, Loader2, Check, AlertTriangle, Film, Trash2, Plus } from 'lucide-react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import {
  sanitizeConfig, statusMessage, DEFAULT_CONFIG, MAX_PER_CYCLE,
  CADENCES, CADENCE_LABELS, MODES, MODE_LABELS, MODE_HINTS,
  type AutopilotConfig, type AutopilotCadence, type AutopilotMode,
} from '@/lib/autopilot/rules';

/**
 * Configuration de l'Autopilote.
 *
 * L'écran ne fait que régler : le moteur qui produit est livré séparément.
 * Il s'appuie sur les MÊMES règles (`lib/autopilot/rules`) que ce moteur —
 * l'état annoncé ici (« prochaine génération… ») est donc calculé par le code
 * qui décidera réellement, et non par une seconde estimation qui finirait par
 * ne plus dire la même chose.
 */

const PLATEFORMES = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube' },
];

export default function AutopilotPanel({ accent }: { accent: string }) {
  const [config, setConfig] = useState<AutopilotConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [libOpen, setLibOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/autopilot/config');
        const data = await res.json();
        if (cancelled) return;
        setReady(data?.ready !== false);
        if (data?.config) setConfig(sanitizeConfig(data.config));
      } catch {
        if (!cancelled) setReady(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Enregistre. Le champ modifié est passé en argument plutôt que lu dans
   * l'état : un `setState` n'est pas encore visible dans la même tâche, et on
   * enverrait la valeur d'AVANT le clic.
   */
  const enregistrer = useCallback(async (patch: Partial<AutopilotConfig>) => {
    const suivant = sanitizeConfig({ ...config, ...patch });
    setConfig(suivant);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/autopilot/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(suivant),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Erreur ${res.status}`);
      }
      if (data.config) setConfig(sanitizeConfig(data.config));
      setNotice('Enregistré.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const etat = statusMessage(config, Date.now(), (d) =>
    d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-4" data-autopilot-panel>
      {!ready && (
        <p className="flex items-start gap-1.5 text-xs text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          L’Autopilote n’est pas encore disponible sur ce serveur : la migration
          <code className="mx-1">autopilot_config</code> n’a pas été appliquée.
        </p>
      )}

      {/* ── Interrupteur ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/60 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{config.enabled ? 'Actif' : 'En pause'}</p>
          <p className="text-xs text-gray-500 mt-0.5">{etat}</p>
        </div>
        <button
          type="button"
          onClick={() => enregistrer({ enabled: !config.enabled })}
          disabled={!ready || saving}
          aria-pressed={config.enabled}
          data-autopilot-toggle
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          style={
            config.enabled
              ? { backgroundColor: '#1F2937', color: '#E5E7EB' }
              : { backgroundColor: accent, color: '#fff' }
          }
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : config.enabled ? 'Mettre en pause' : 'Activer'}
        </button>
      </div>

      {/* ── Mode ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-medium text-gray-300 mb-2">Que fait Studiio des vidéos ?</p>
        <div className="space-y-1.5">
          {MODES.map((m: AutopilotMode) => (
            <button
              key={m}
              type="button"
              onClick={() => enregistrer({ mode: m })}
              disabled={!ready || saving}
              aria-pressed={config.mode === m}
              data-autopilot-mode={m}
              className={`w-full text-left rounded-lg border px-3 py-2 transition disabled:opacity-40 ${
                config.mode === m
                  ? 'border-purple-500/50 bg-gray-800'
                  : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              <span className="text-xs font-medium">{MODE_LABELS[m]}</span>
              <span className="block text-[11px] text-gray-500 mt-0.5">{MODE_HINTS[m]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Cadence et nombre ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="autopilot-cadence" className="block text-xs font-medium text-gray-300 mb-1.5">
            À quelle fréquence ?
          </label>
          <select
            id="autopilot-cadence"
            value={config.cadence}
            onChange={(e) => enregistrer({ cadence: e.target.value as AutopilotCadence })}
            disabled={!ready || saving}
            className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>{CADENCE_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="autopilot-count" className="block text-xs font-medium text-gray-300 mb-1.5">
            Combien à chaque fois ?
          </label>
          <select
            id="autopilot-count"
            value={config.countPerCycle}
            onChange={(e) => enregistrer({ countPerCycle: Number(e.target.value) })}
            disabled={!ready || saving}
            className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
          >
            {Array.from({ length: MAX_PER_CYCLE }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n} vidéo{n > 1 ? 's' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Plateformes ──────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-medium text-gray-300 mb-2">Où publier ?</p>
        <div className="flex flex-wrap gap-1.5">
          {PLATEFORMES.map((p) => {
            const retenue = config.platforms.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => enregistrer({
                  platforms: retenue
                    ? config.platforms.filter((x) => x !== p.id)
                    : [...config.platforms, p.id],
                })}
                disabled={!ready || saving}
                aria-pressed={retenue}
                data-autopilot-platform={p.id}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition disabled:opacity-40 ${
                  retenue ? 'border-purple-500/50 bg-gray-800 text-white' : 'border-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Banque de rushes ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-medium text-gray-300">
            Vos rushes <span className="text-gray-500">({config.rushUrls.length})</span>
          </p>
          <button
            type="button"
            onClick={() => setLibOpen(true)}
            disabled={!ready || saving}
            data-autopilot-add-rush
            className="flex items-center gap-1 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
          >
            <Plus className="w-3 h-3" /> Ajouter
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mb-2">
          L’Autopilote y pioche à tour de rôle. Sans rush, il ne produit rien —
          il vous le dira plutôt que de générer des montages sans image.
        </p>
        {config.rushUrls.length > 0 && (
          <ul className="space-y-1">
            {config.rushUrls.map((url) => (
              <li
                key={url}
                className="flex items-center justify-between gap-2 rounded-lg bg-gray-900 border border-gray-800 px-2 py-1.5"
              >
                <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-gray-300">
                  <Film className="w-3 h-3 shrink-0" />
                  <span className="truncate">{url.split('/').pop()}</span>
                </span>
                <button
                  type="button"
                  onClick={() => enregistrer({ rushUrls: config.rushUrls.filter((u) => u !== url) })}
                  disabled={saving}
                  aria-label="Retirer ce rush"
                  className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <MediaLibrary
          isOpen={libOpen}
          onClose={() => setLibOpen(false)}
          mediaType="video"
          onSelect={(url) => {
            setLibOpen(false);
            if (url) enregistrer({ rushUrls: [...config.rushUrls, url] });
          }}
        />
      </div>

      {/* ── Seuil de crédits ─────────────────────────────────────────── */}
      <div>
        <label htmlFor="autopilot-floor" className="block text-xs font-medium text-gray-300 mb-1.5">
          Ne jamais descendre sous
        </label>
        <div className="flex items-center gap-2">
          <input
            id="autopilot-floor"
            type="number"
            min={0}
            max={10000}
            value={config.creditFloor}
            onChange={(e) => setConfig((c) => ({ ...c, creditFloor: Number(e.target.value) }))}
            onBlur={() => enregistrer({ creditFloor: config.creditFloor })}
            disabled={!ready || saving}
            className="w-24 rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
          />
          <span className="text-xs text-gray-500">crédits</span>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          L’Autopilote s’arrête avant ce seuil, pour qu’il vous reste toujours
          de quoi produire à la main.
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && !error && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-400">
          <Check className="w-3.5 h-3.5" /> {notice}
        </p>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
        <Rocket className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        La production automatique démarre une fois le déclencheur planifié
        configuré sur le serveur.
      </p>
    </div>
  );
}
