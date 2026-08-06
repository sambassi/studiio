'use client';

import { useState, useEffect, useCallback } from 'react';
import { Rocket, Loader2, Check, AlertTriangle, Film, Trash2, Plus } from 'lucide-react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import { CardIcon } from '@/components/ui/CardIcon';
import { THEMES, themeLabel, isCustomTopic } from '@/lib/themes';
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

/**
 * Les etapes du wizard.
 *
 * ⚠️ CE N'EST QU'UNE MISE EN PAGE. Les reglages, les gestionnaires et
 * l'enregistrement automatique sont ceux d'avant : sept blocs empiles
 * faisaient une page qu'on ne lisait pas jusqu'au bout, pas sept reglages de
 * trop.
 */
const ETAPES = [
  { titre: 'Thèmes', aide: 'Sur quoi parler' },
  { titre: 'Vos rushes', aide: 'Les images à réutiliser' },
  { titre: 'Rythme & diffusion', aide: 'Quand et où' },
  { titre: 'Options', aide: 'Voix et garde-fous' },
  { titre: 'Récapitulatif', aide: 'Vérifier, puis activer' },
] as const;

/**
 * Prochain depart du declencheur planifie.
 *
 * Il tourne a 06:00 UTC, soit 08:00 a Paris en heure d'ete. On calcule le
 * prochain passage en UTC puis on l'affiche dans le fuseau de l'utilisateur —
 * annoncer une heure fixe se serait decale d'une heure a chaque changement
 * d'heure.
 */
function prochainDepart(maintenant: Date = new Date()): string {
  const d = new Date(maintenant);
  d.setUTCHours(6, 0, 0, 0);
  if (d.getTime() <= maintenant.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Ce que l'utilisateur doit pouvoir relire d'un coup d'oeil avant d'activer. */
function RECAP(config: AutopilotConfig): Array<[string, string]> {
  const n = config.rushUrls.length;
  return [
    ['Thèmes', config.topics.length === 0
      ? 'Tous (12 thèmes)'
      : config.topics.map(themeLabel).join(', ')],
    ['Rythme', CADENCE_LABELS[config.cadence]],
    ['Par cycle', `${config.countPerCycle} vidéo${config.countPerCycle > 1 ? 's' : ''}`],
    ['Diffusion', MODE_LABELS[config.mode]],
    ['Plateformes', config.platforms.length
      ? config.platforms.join(', ')
      : 'Aucune — les vidéos restent dans le Calendrier'],
    ['Voix off', config.voiceEnabled ? 'Activée (payante)' : 'Désactivée'],
    ['Rushes', `${n} disponible${n > 1 ? 's' : ''}`],
    ['Seuil de crédits', `${config.creditFloor} crédits`],
  ];
}

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
  const [etape, setEtape] = useState(0);
  const [themePerso, setThemePerso] = useState('');

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

  /** Ajoute ou retire un theme de la rotation. */
  const basculerTheme = useCallback((topic: string) => {
    setConfig((c) => {
      const suivant = c.topics.includes(topic)
        ? c.topics.filter((t) => t !== topic)
        : [...c.topics, topic];
      enregistrer({ topics: suivant });
      return { ...c, topics: suivant };
    });
  }, [enregistrer]);

  const ajouterThemePerso = useCallback(() => {
    const propre = themePerso.trim().slice(0, 40);
    // Rien a ajouter, ou deja present : on vide le champ sans rien ecrire.
    if (propre && !config.topics.includes(propre)) basculerTheme(propre);
    setThemePerso('');
  }, [themePerso, config.topics, basculerTheme]);

  /** Thèmes écrits à la main — affichés en puces retirables. */
  const persos = config.topics.filter(isCustomTopic);

  // L'etape des rushes est la seule qui BLOQUE : sans rush, l'Autopilote ne
  // produit rien, et le laisser avancer serait promettre une production qui
  // n'aura pas lieu.
  const bloqueEtape = etape === 1 && config.rushUrls.length === 0;

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

      {/* ── Fil d'Ariane ─────────────────────────────────────────────── */}
      <ol className="flex items-center gap-1" data-autopilot-etapes>
        {ETAPES.map((e, i) => {
          const courante = i === etape;
          const franchie = i < etape;
          return (
            <li key={e.titre} className="flex-1">
              <button
                type="button"
                onClick={() => setEtape(i)}
                disabled={!ready}
                aria-current={courante ? 'step' : undefined}
                data-autopilot-etape={i}
                title={e.titre}
                className={`w-full rounded-full transition disabled:opacity-40 ${
                  courante ? 'h-1.5' : 'h-1'
                }`}
                style={{
                  backgroundColor: courante || franchie ? accent : '#1F2937',
                  opacity: franchie ? 0.55 : 1,
                }}
              />
            </li>
          );
        })}
      </ol>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          <span className="text-gray-500 text-xs mr-1.5">{etape + 1}/{ETAPES.length}</span>
          {ETAPES[etape].titre}
        </p>
        <p className="text-[11px] text-gray-500">{ETAPES[etape].aide}</p>
      </div>

      {/* ── Étape 1 · Thèmes ─────────────────────────────────────────── */}
      {etape === 0 && (
        <div className="space-y-3">
          <p className="text-[11px] text-gray-500">
            {config.topics.length === 0
              ? 'Aucun choix : l’Autopilote fait tourner les douze thèmes. Cochez-en pour le restreindre.'
              : `${config.topics.length} thème${config.topics.length > 1 ? 's' : ''} en rotation.`}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {THEMES.map((t) => {
              const retenu = config.topics.includes(t.topic);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => basculerTheme(t.topic)}
                  disabled={!ready || saving}
                  aria-pressed={retenu}
                  data-autopilot-topic={t.id}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition disabled:opacity-40 ${
                    retenu ? 'border-purple-500/50 bg-gray-800' : 'border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <CardIcon name={t.icon} size={14} color={retenu ? accent : '#9CA3AF'} className="" />
                  <span className="text-[11px] leading-tight">{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Thèmes écrits à la main — le pendant du `customTopic` de Créer
              simple, mais cumulable puisque l'Autopilote tourne. */}
          <div>
            <label htmlFor="autopilot-topic-perso" className="block text-xs font-medium text-gray-300 mb-1.5">
              Ajouter un thème
            </label>
            <div className="flex gap-1.5">
              <input
                id="autopilot-topic-perso"
                type="text"
                value={themePerso}
                onChange={(e) => setThemePerso(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterThemePerso(); } }}
                placeholder="Ex. : récupération après le sport"
                disabled={!ready || saving}
                data-autopilot-topic-input
                className="flex-1 rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
              />
              <button
                type="button"
                onClick={ajouterThemePerso}
                disabled={!ready || saving || !themePerso.trim()}
                data-autopilot-topic-add
                className="rounded-lg border border-gray-800 px-2.5 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {persos.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {persos.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 rounded-full border border-gray-800 bg-gray-900 px-2 py-1 text-[11px] text-gray-300"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => basculerTheme(t)}
                      disabled={saving}
                      aria-label={`Retirer ${t}`}
                      className="text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Étape 2 · Vos rushes ─────────────────────────────────────── */}
      {etape === 1 && (
        <div className="space-y-3">
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
        </div>
      )}

      {/* ── Étape 3 · Rythme & diffusion ─────────────────────────────── */}
      {etape === 2 && (
        <div className="space-y-4">
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
        </div>
      )}

      {/* ── Étape 4 · Options & garde-fous ───────────────────────────── */}
      {etape === 3 && (
        <div className="space-y-4">
{/* ── Voix off ─────────────────────────────────────────────────
              OPTION PAYANTE, donc EXPLICITE et desactivee par defaut. La
              narration passe par ElevenLabs, facture a l'usage : l'activer
              d'office ferait payer une voix que personne n'a demandee. Le cout
              est ecrit dans l'etiquette, pas cache dans une aide au survol. */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Narration</p>
            <button
              type="button"
              onClick={() => enregistrer({ voiceEnabled: !config.voiceEnabled })}
              disabled={!ready || saving}
              aria-pressed={config.voiceEnabled}
              data-autopilot-voice
              className={`w-full flex items-start gap-3 text-left rounded-lg border px-3 py-2 transition disabled:opacity-40 ${
                config.voiceEnabled
                  ? 'border-purple-500/50 bg-gray-800'
                  : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full transition ${
                  config.voiceEnabled ? 'bg-purple-500' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-white transition-transform ${
                    config.voiceEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">
                  Voix off — <span className="text-amber-400">option payante</span>
                </span>
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  {config.voiceEnabled
                    ? 'Chaque montage est narré par une voix IA (crédits ElevenLabs).'
                    : 'Aucune narration, aucun coût. Les vidéos sortent avec la musique seule.'}
                </span>
              </span>
            </button>
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
        </div>
      )}

      {/* ── Étape 5 · Récapitulatif & activation ─────────────────────── */}
      {etape === 4 && (
        <div className="space-y-3">
          <dl className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 space-y-1.5 text-[11px]">
            {RECAP(config).map(([cle, valeur]) => (
              <div key={cle} className="flex items-baseline justify-between gap-3">
                <dt className="text-gray-500 shrink-0">{cle}</dt>
                <dd className="text-right text-gray-200">{valeur}</dd>
              </div>
            ))}
          </dl>

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

          {config.enabled && (
            <p className="flex items-start gap-1.5 text-[11px] text-gray-400" data-autopilot-depart>
              <Rocket className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Départ automatique chaque jour à 08:00 (heure de Paris).
              Prochain départ : {prochainDepart()}.
            </p>
          )}
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setEtape((n) => Math.max(0, n - 1))}
          disabled={etape === 0}
          className="rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Précédent
        </button>
        {etape < ETAPES.length - 1 && (
          <button
            type="button"
            onClick={() => setEtape((n) => Math.min(ETAPES.length - 1, n + 1))}
            disabled={!ready || bloqueEtape}
            data-autopilot-suivant
            title={bloqueEtape ? 'Ajoutez au moins un rush pour continuer' : undefined}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
            style={{ backgroundColor: accent }}
          >
            Suivant
          </button>
        )}
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
    </div>
  );
}
