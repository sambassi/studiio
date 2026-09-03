'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Rocket, Loader2, Check, AlertTriangle, Film, Trash2, Plus, Music, Mic, ImageIcon,
  Sparkles,
} from 'lucide-react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import SessionsTournagePanel from '@/components/creer/SessionsTournagePanel';
import { montageDepuisStyle, audioDepuisStyle } from '@/lib/autopilot/textStyle';
import { CardIcon } from '@/components/ui/CardIcon';
import ColorWheel from '@/components/ui/ColorWheel';
import { THEMES, themeLabel, isCustomTopic } from '@/lib/themes';
import {
  sanitizeConfig, statusMessage, DEFAULT_CONFIG, MAX_PER_CYCLE,
  CADENCES, CADENCE_LABELS, MODES, MODE_LABELS, MODE_HINTS,
  POSTER_MODES, POSTER_MODE_LABELS, POSTER_MODE_HINTS, type AutopilotPosterMode,
  type AutopilotConfig, type AutopilotCadence, type AutopilotMode,
} from '@/lib/autopilot/rules';

/** Une voix clonée, telle que la rend `GET /api/voice/clone`. */
interface VoixClonee {
  id: string;
  name: string;
  lang: string | null;
}

/** Le nom d'un fichier, à partir de son adresse — pour ne pas afficher l'URL. */
function nomDeFichier(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
  } catch {
    return url.split('/').pop() || url;
  }
}

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
  // ⚠️ CETTE ETAPE EST CELLE DE CE QUI NE CHANGE PAS. Les trois autres
  // reglent ce que l'Autopilote fait VARIER ; celle-ci, l'identite que
  // toutes les videos partagent.
  { titre: 'Style & médias', aide: 'Ce qui ne change jamais' },
  { titre: 'Rythme & diffusion', aide: 'Quand et où' },
  { titre: 'Options', aide: 'Voix et garde-fous' },
  { titre: 'Récapitulatif', aide: 'Vérifier, puis activer' },
] as const;

/** « 80 % » — un niveau du mixeur, tel que l'utilisateur le lit. */
function pourcent(v: number): string {
  return `${Math.round(v * 100)} %`;
}

/** « 08:00 » — l'heure telle que l'utilisateur la lit. */
function heureLisible(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * Prochain depart, dans le fuseau de l'utilisateur.
 *
 * ⚠️ ON CHERCHE L'INSTANT, PAS L'HEURE. Ajouter « runHour heures » a minuit
 * local supposerait des journees de 24 h : les jours de changement d'heure
 * elles en font 23 ou 25, et l'annonce se decalerait. On avance donc heure
 * par heure jusqu'a ce que l'horloge du fuseau affiche l'heure voulue — au
 * plus 48 essais, ce qui couvre tous les cas.
 */
function prochainDepart(
  runHour: number,
  timezone: string,
  maintenant: Date = new Date(),
): string {
  const heureLocale = (d: Date) => {
    try {
      return Number(new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', hour12: false, timeZone: timezone,
      }).format(d));
    } catch {
      return d.getUTCHours();
    }
  };
  const d = new Date(maintenant);
  d.setMinutes(0, 0, 0);
  // Toujours STRICTEMENT dans le futur : a l'heure pile, le passage courant
  // est deja fait ou en cours.
  d.setHours(d.getHours() + 1);
  for (let i = 0; i < 48 && heureLocale(d) !== runHour; i += 1) {
    d.setHours(d.getHours() + 1);
  }
  try {
    return d.toLocaleString('fr-FR', {
      timeZone: timezone,
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return d.toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris',
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit',
    });
  }
}

/**
 * Ce que l'utilisateur doit pouvoir relire d'un coup d'oeil avant d'activer.
 *
 * ⚠️ LE RECAP EST COUPE EN DEUX, ET C'EST LE POINT. « Ce qui change » et « ce
 * qui ne change jamais » repondent a la seule question qu'on se pose avant
 * d'activer un pilote automatique : qu'est-ce qui va se ressembler d'une
 * video a l'autre ? Une liste unique de quinze lignes ne repondait pas.
 */
function RECAP_VARIABLE(config: AutopilotConfig): Array<[string, string]> {
  const n = config.rushUrls.length;
  return [
    ['Thèmes', config.topics.length === 0
      ? 'Tous (12 thèmes)'
      : config.topics.map(themeLabel).join(', ')],
    ['Affiche', config.posterMode === 'custom' && config.posterUrls.length > 0
      ? `Vos ${config.posterUrls.length} photo${config.posterUrls.length > 1 ? 's' : ''}, en rotation`
      : 'Choisie par Studiio selon le thème'],
    ['Textes', 'Différents à chaque vidéo'],
    ['Rushes', n === 0
      ? 'Aucun — rien ne sera produit'
      : n === 1
        ? '1 seul — il sera répété sur toutes les vidéos'
        : `${n} en rotation — jamais deux fois de suite le même`],
  ];
}

function RECAP_CONSTANT(
  config: AutopilotConfig,
  voix: VoixClonee[],
): Array<[string, string]> {
  const choisie = voix.find((v) => v.id === config.voiceId);
  return [
    ['Couleurs', `${config.cardGradientStart} → ${config.cardGradientEnd}, titre ${config.titleColor}`],
    ['Fond des cartes', config.cardsShowPoster ? 'L’affiche' : 'Les couleurs choisies'],
    ['Musique', config.musicUrl ? `${nomDeFichier(config.musicUrl)} · ${pourcent(config.musicVolume)}` : 'Aucune'],
    ['Voix off', config.voiceEnabled
      ? `${choisie ? choisie.name : 'Voix par défaut'} · ${pourcent(config.voiceVolume)} (payante)`
      : 'Désactivée'],
    ['Son du rush', config.keepRushAudio ? `Gardé · ${pourcent(config.rushVolume)}` : 'Coupé'],
  ];
}

function RECAP_DIFFUSION(config: AutopilotConfig): Array<[string, string]> {
  return [
    ['Rythme', CADENCE_LABELS[config.cadence]],
    ['Heure de départ', `${heureLisible(config.runHour)} (${config.runTimezone})`],
    ['Par cycle', `${config.countPerCycle} vidéo${config.countPerCycle > 1 ? 's' : ''}`],
    ['Diffusion', MODE_LABELS[config.mode]],
    ['Plateformes', config.platforms.length
      ? config.platforms.join(', ')
      : 'Aucune — les vidéos restent dans le Calendrier'],
    ['Seuil de crédits', `${config.creditFloor} crédits`],
  ];
}

const PLATEFORMES = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube' },
];

export default function AutopilotPanel({
  accent, onConfigChange, onPatchReady, onSessionChange, onVideoLancee,
}: {
  accent: string;
  /**
   * Remonte le tournage regardé, et le départ d'une création.
   *
   * ⚠️ C'EST CE QUI PERMET UN SEUL APERÇU. Le lecteur de la vidéo produite
   * vit dans la colonne de droite, hors de cet arbre : sans ces deux signaux,
   * il faudrait un second lecteur ici — la duplication qu'on vient d'enlever.
   */
  onSessionChange?: (etat: { sessionId: string | null; aucunRush: boolean; format: string }) => void;
  onVideoLancee?: () => void;
  /**
   * Remonte la configuration à chaque changement — c'est ce qui alimente
   * l'aperçu de la colonne de droite.
   *
   * ⚠️ APPELÉ SUR L'ÉTAT LOCAL, PAS APRÈS L'ENREGISTREMENT. L'aperçu doit
   * suivre la roue chromatique PENDANT qu'on la tourne ; les couleurs, elles,
   * ne partent au serveur qu'au relâchement. Attendre la réponse aurait figé
   * l'aperçu pendant tout le réglage — exactement le moment où il sert.
   *
   * Absent, le panneau se comporte exactement comme avant.
   */
  onConfigChange?: (config: AutopilotConfig) => void;
  /**
   * Remonte la fonction d'enregistrement — c'est elle que l'aperçu appelle
   * pour écrire police, taille, positions et icônes.
   *
   * ⚠️ UN SEUL ÉCRIVAIN, ET C'EST CELUI-CI. L'aperçu vit dans une autre
   * colonne de l'écran ; lui donner son propre `fetch` aurait fait deux
   * sources de vérité pour la même configuration, et le dernier à écrire
   * aurait gagné au hasard des rendus. Il emprunte donc CETTE fonction —
   * celle qui possède déjà l'état, la fusion et l'appel réseau.
   *
   * Rappelé à chaque changement de `config` : `enregistrer` se referme
   * dessus, et une référence gardée trop longtemps enverrait une
   * configuration périmée.
   */
  onPatchReady?: (patch: (p: Partial<AutopilotConfig>) => void) => void;
}) {
  const [config, setConfig] = useState<AutopilotConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Quelle médiathèque est ouverte, et pour quoi.
   *
   * ⚠️ PAS UN BOOLEEN. Il y a maintenant DEUX points d'ouverture — les rushes
   * (vidéo) et la musique (audio) — et un seul drapeau les ferait s'ouvrir
   * ensemble, l'un filtré par le type de l'autre.
   */
  const [libOpen, setLibOpen] = useState<null | 'rush' | 'musique' | 'affiche'>(null);
  const [etape, setEtape] = useState(0);
  const [themePerso, setThemePerso] = useState('');
  /** Les colonnes d'identité existent-elles en base ? Voir `brandingReady`. */
  const [identiteReady, setIdentiteReady] = useState(true);
  const [voixClonees, setVoixClonees] = useState<VoixClonee[]>([]);

  // ⚠️ UN SEUL POINT DE REMONTÉE, sur l'état lui-même. Le panneau écrit
  // `config` par une demi-douzaine de chemins — `enregistrer`, les roues
  // chromatiques, les curseurs du mixeur, la relecture au montage. Appeler le
  // parent depuis chacun d'eux aurait garanti qu'on en oublie un, et l'aperçu
  // aurait cessé de suivre ce réglage-là sans que rien ne le signale.
  useEffect(() => { onConfigChange?.(config); }, [config, onConfigChange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/autopilot/config');
        const data = await res.json();
        if (cancelled) return;
        setReady(data?.ready !== false);
        setIdentiteReady(data?.brandingReady !== false);
        if (data?.config) setConfig(sanitizeConfig(data.config));
      } catch {
        if (!cancelled) setReady(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Les voix clonées du compte. Silencieux en cas d'échec : le sélecteur
  // reste vide et l'Autopilote retombe sur la voix par défaut du serveur —
  // une liste indisponible ne doit pas empêcher de régler le reste.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/voice/clone')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.success || !Array.isArray(d.voices)) return;
        setVoixClonees(d.voices as VoixClonee[]);
      })
      .catch(() => {});
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

  // ⚠️ APRES `enregistrer`, ET A CHAQUE CHANGEMENT. La fonction se referme sur
  // `config` : la publier une seule fois au montage aurait fige la
  // configuration de depart, et l'apercu aurait ecrase tous les reglages faits
  // entre-temps a chaque geste.
  useEffect(() => { onPatchReady?.(enregistrer); }, [enregistrer, onPatchReady]);

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
      {/* Le DIRE plutôt que de laisser croire que c'est enregistré : sans les
          colonnes, l'écran accepte les réglages de style et le serveur les
          jette. Un formulaire silencieusement sans effet est pire qu'un
          formulaire absent. */}
      {ready && !identiteReady && (
        <p className="flex items-start gap-1.5 text-xs text-amber-400" data-autopilot-identite-absente>
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Couleurs, musique, voix et mixeur ne seront pas conservés : la migration
          <code className="mx-1">2026-08-07-autopilot-branding</code> n’a pas été appliquée.
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
{/* ── SESSIONS DE TOURNAGE ──────────────────────────────────────
              Le socle M3-A, monte ICI plutot que dans une route de plus :
              c'est l'etape ou l'on parle deja des rushes, et l'utilisateur
              n'a pas a chercher ailleurs ce qui prolonge ce qu'il regarde.

              La banque de rushes historique (`config.rushUrls`) reste juste
              en dessous, INTACTE. Les deux coexistent : migrer l'une vers
              l'autre est une decision de produit, pas un effet de bord de ce
              lot. */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-300">Sessions de tournage</p>
            <SessionsTournagePanel
              /* ⚠️ LA BANQUE DE RUSHES N'EST PAS SUPPRIMEE, ELLE DEMENAGE.
                 Elle alimente la rotation de l'Autopilote et reste donc une
                 fonction vivante — mais elle faisait DOUBLON a l'ecran avec
                 les rushes de la session : deux listes, deux « Ajouter »,
                 deux corbeilles, pour deux magasins differents. Dans le
                 tiroir, elle garde tout son comportement et cesse d'etre
                 confondue avec les rushes du tournage. */
              avance={<div className="space-y-3">{/* ── Banque de rushes ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-medium text-gray-300">
                Vos rushes <span className="text-gray-500">({config.rushUrls.length})</span>
              </p>
              <button
                type="button"
                onClick={() => setLibOpen('rush')}
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
            {/* ⚠️ LA LIMITE DU RUSH UNIQUE, DITE AVANT QU'ELLE SURPRENNE.
                Avec un seul rush, la rotation n'a pas le choix : toutes les
                vidéos partagent la même séquence vidéo. L'utilisateur qui
                attendait « des rushes différents » doit l'apprendre ici, pas
                en découvrant deux montages identiques dans son Calendrier. */}
            {config.rushUrls.length === 1 && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-400 mb-2" data-autopilot-rush-unique>
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                Un seul rush : il sera repris sur toutes les vidéos. Ajoutez-en un
                second pour qu’ils alternent.
              </p>
            )}
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
              isOpen={libOpen === 'rush'}
              onClose={() => setLibOpen(null)}
              mediaType="video"
              onSelect={(url) => {
                setLibOpen(null);
                if (url) enregistrer({ rushUrls: [...config.rushUrls, url] });
              }}
            />
          </div></div>}
              montageDefaut={montageDepuisStyle(config.designStyle)}
              onEnregistrerDefaut={(m) => enregistrer({
                // ⚠️ FUSION, JAMAIS REMPLACEMENT : `designStyle` porte aussi
                // les polices et les icônes de cartes. Les écraser ici les
                // perdrait sans un mot.
                designStyle: { ...config.designStyle, montage: m },
              })}
              audioDefaut={audioDepuisStyle(config.designStyle)}
              onEnregistrerAudioDefaut={async (audio) => {
                // ⚠️ MEME FUSION QUE POUR `montage`, ET POUR LA MEME RAISON :
                // `designStyle` porte aussi les polices, les icones et le
                // reglage de montage. Les ecraser ici les perdrait sans un mot.
                await enregistrer({
                  designStyle: { ...config.designStyle, audio },
                });
                return true;
              }}
              onSessionChange={onSessionChange}
              onVideoLancee={onVideoLancee}
            />
          </div>

{/* ── VOS AFFICHES ─────────────────────────────────────────────
              ⚠️ L'AUTOPILOTE CHOISISSAIT SEUL. Il cherche une photo chez
              Pexels a partir du theme — un bon defaut, et ce n'en est qu'un :
              une marque qui a ses propres visuels veut les siens.

              Ici, et non dans une etape de plus : c'est la meme idee que la
              banque de rushes, au meme endroit. Le wizard reste a six
              etapes. */}
          <div className="pt-3 border-t border-gray-800">
            <p className="text-xs font-medium text-gray-300 mb-2">Affiches</p>
            <div className="grid grid-cols-2 gap-1.5">
              {POSTER_MODES.map((m: AutopilotPosterMode) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => enregistrer({ posterMode: m })}
                  disabled={!ready || saving}
                  aria-pressed={config.posterMode === m}
                  data-autopilot-poster-mode={m}
                  className={`rounded-lg border px-2.5 py-2 text-left transition disabled:opacity-40 ${
                    config.posterMode === m
                      ? 'border-purple-500/50 bg-gray-800'
                      : 'border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium">
                    {m === 'auto'
                      ? <Sparkles className="w-3 h-3" />
                      : <ImageIcon className="w-3 h-3" />}
                    {POSTER_MODE_LABELS[m]}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">
              {POSTER_MODE_HINTS[config.posterMode]}
            </p>

            {config.posterMode === 'custom' && (
              <div className="mt-2">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[11px] text-gray-400">
                    Vos affiches <span className="text-gray-500">({config.posterUrls.length})</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setLibOpen('affiche')}
                    disabled={!ready || saving}
                    data-autopilot-add-poster
                    className="flex items-center gap-1 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Ajouter
                  </button>
                </div>
                {config.posterUrls.length === 0 ? (
                  // ⚠️ ON LE DIT PLUTOT QUE DE PRODUIRE UN MONTAGE SANS
                  // AFFICHE : le moteur retombe sur la recherche par theme
                  // tant que la banque est vide.
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-400">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    Aucune affiche : Studiio continue de les chercher par thème
                    tant que vous n’en ajoutez pas.
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {config.posterUrls.map((url) => (
                        <li
                          key={url}
                          className="flex items-center justify-between gap-2 rounded-lg bg-gray-900 border border-gray-800 px-2 py-1.5"
                        >
                          <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-gray-300">
                            <ImageIcon className="w-3 h-3 shrink-0" />
                            <span className="truncate">{nomDeFichier(url)}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => enregistrer({
                              posterUrls: config.posterUrls.filter((u) => u !== url),
                            })}
                            disabled={saving}
                            aria-label="Retirer cette affiche"
                            className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {config.posterUrls.length === 1 && (
                      <p className="flex items-start gap-1.5 text-[11px] text-amber-400 mt-2">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        Une seule affiche : elle sera reprise sur toutes les vidéos.
                      </p>
                    )}
                  </>
                )}
                <MediaLibrary
                  isOpen={libOpen === 'affiche'}
                  onClose={() => setLibOpen(null)}
                  mediaType="image"
                  onSelect={(url) => {
                    setLibOpen(null);
                    if (url) enregistrer({ posterUrls: [...config.posterUrls, url] });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Étape 3 · Style & médias — L'IDENTITÉ CONSTANTE ───────────
          Tout ce qui est réglé ici vaut pour TOUTES les futures vidéos. Le
          reste du wizard décrit ce qui varie ; cette étape, ce qui reste. */}
      {etape === 2 && (
        <div className="space-y-4">
          <p className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-[11px] text-gray-400">
            Ces réglages s’appliquent à <span className="text-gray-200 font-medium">toutes
            les futures vidéos</span>. L’affiche, les textes et le rush, eux, changent
            à chaque fois.
          </p>

{/* ── Couleurs ─────────────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Couleurs des cartes</p>
            <div className="grid grid-cols-2 gap-3">
              <div data-autopilot-color-start>
                <ColorWheel
                  color={config.cardGradientStart}
                  onChange={(c) => setConfig((x) => ({ ...x, cardGradientStart: c }))}
                  label="Dégradé — début"
                />
              </div>
              <div data-autopilot-color-end>
                <ColorWheel
                  color={config.cardGradientEnd}
                  onChange={(c) => setConfig((x) => ({ ...x, cardGradientEnd: c }))}
                  label="Dégradé — fin"
                />
              </div>
            </div>
            <div className="mt-3" data-autopilot-color-title>
              <ColorWheel
                color={config.titleColor}
                onChange={(c) => setConfig((x) => ({ ...x, titleColor: c }))}
                label="Couleur du titre"
              />
            </div>
            {/* ⚠️ ENREGISTREMENT AU RELACHEMENT, PAS A CHAQUE PIXEL. Une roue
                chromatique émet une couleur par mouvement de souris :
                enregistrer sur `onChange` enverrait des centaines de requêtes
                pour un seul choix. L'état bouge en direct, la base au
                relâchement — comme le seuil de crédits juste à côté. */}
            <button
              type="button"
              onClick={() => enregistrer({
                cardGradientStart: config.cardGradientStart,
                cardGradientEnd: config.cardGradientEnd,
                titleColor: config.titleColor,
              })}
              disabled={!ready || saving}
              data-autopilot-colors-save
              className="mt-3 w-full rounded-lg border border-gray-800 px-3 py-1.5 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer les couleurs'}
            </button>
          </div>

{/* ── Fond des cartes ──────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Fond des cartes</p>
            <button
              type="button"
              onClick={() => enregistrer({ cardsShowPoster: !config.cardsShowPoster })}
              disabled={!ready || saving}
              aria-pressed={config.cardsShowPoster}
              data-autopilot-cards-poster
              className={`w-full flex items-start gap-3 text-left rounded-lg border px-3 py-2 transition disabled:opacity-40 ${
                config.cardsShowPoster ? 'border-purple-500/50 bg-gray-800' : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full transition ${
                  config.cardsShowPoster ? 'bg-purple-500' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-white transition-transform ${
                    config.cardsShowPoster ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <ImageIcon className="w-3.5 h-3.5" />
                  Afficher l’affiche derrière les cartes
                </span>
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  {config.cardsShowPoster
                    ? 'Les cartes se posent sur la photo d’affiche.'
                    : 'Les cartes se posent sur vos couleurs. L’affiche reste sur la séquence titre.'}
                </span>
              </span>
            </button>
          </div>

{/* ── Musique ──────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-medium text-gray-300">Musique</p>
              <button
                type="button"
                onClick={() => setLibOpen('musique')}
                disabled={!ready || saving}
                data-autopilot-add-music
                className="flex items-center gap-1 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
              >
                <Plus className="w-3 h-3" /> {config.musicUrl ? 'Changer' : 'Choisir'}
              </button>
            </div>
            {config.musicUrl ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-900 border border-gray-800 px-2 py-1.5">
                <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-gray-300">
                  <Music className="w-3 h-3 shrink-0" />
                  <span className="truncate">{nomDeFichier(config.musicUrl)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => enregistrer({ musicUrl: null })}
                  disabled={saving}
                  aria-label="Retirer la musique"
                  data-autopilot-remove-music
                  className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-gray-500">
                Aucune musique — les vidéos sortiront sans fond sonore.
              </p>
            )}
            <MediaLibrary
              isOpen={libOpen === 'musique'}
              onClose={() => setLibOpen(null)}
              mediaType="audio"
              onSelect={(url) => {
                setLibOpen(null);
                if (url) enregistrer({ musicUrl: url });
              }}
            />
          </div>

{/* ── Voix off clonée ──────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Voix off clonée</p>
            {voixClonees.length === 0 ? (
              <p className="text-[11px] text-gray-500">
                Aucune voix clonée. Rendez-vous dans <span className="text-gray-300">Mon avatar</span> pour
                en enregistrer une — sans elle, la narration utilise la voix par défaut.
              </p>
            ) : (
              <>
                <select
                  id="autopilot-voice-id"
                  value={config.voiceId ?? ''}
                  onChange={(e) => enregistrer({ voiceId: e.target.value || null })}
                  disabled={!ready || saving}
                  data-autopilot-voice-id
                  className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
                >
                  <option value="">Voix par défaut</option>
                  {voixClonees.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}{v.lang ? ` (${v.lang})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  La même voix sur toutes les séquences de toutes les vidéos.
                </p>
              </>
            )}
            {!config.voiceEnabled && (
              <p className="flex items-start gap-1.5 text-[11px] text-gray-500 mt-1.5">
                <Mic className="w-3 h-3 mt-0.5 shrink-0" />
                La narration est désactivée : activez-la à l’étape <span className="text-gray-300">Options</span> pour
                que ce choix serve.
              </p>
            )}
          </div>

{/* ── Son du rush ──────────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Son du rush</p>
            <button
              type="button"
              onClick={() => enregistrer({ keepRushAudio: !config.keepRushAudio })}
              disabled={!ready || saving}
              aria-pressed={config.keepRushAudio}
              data-autopilot-keep-rush-audio
              className={`w-full flex items-start gap-3 text-left rounded-lg border px-3 py-2 transition disabled:opacity-40 ${
                config.keepRushAudio ? 'border-purple-500/50 bg-gray-800' : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full transition ${
                  config.keepRushAudio ? 'bg-purple-500' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-white transition-transform ${
                    config.keepRushAudio ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">Garder le son du rush</span>
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  {config.keepRushAudio
                    ? 'L’ambiance du rush se mélange à la musique et à la voix.'
                    : 'La séquence vidéo est muette : seules la musique et la voix s’entendent.'}
                </span>
              </span>
            </button>
          </div>

{/* ── Mixeur ───────────────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-1">Mixeur</p>
            <p className="text-[11px] text-gray-500 mb-2">
              Ces niveaux valent pour toutes les vidéos.
            </p>
            <div className="space-y-3">
              {/* ⚠️ L'ICONE EST RENDUE ICI, PAS PASSEE DANS LA TABLE. Un
                  composant destructure sous un nom local (`icone: Icone`) est
                  invisible au garde-fou « aucun composant employé sans être
                  défini » : il le lit comme un identifiant jamais importé.
                  Le garde a raison de ne pas savoir — c'est à ce code de
                  rester lisible pour lui. */}
              {([
                { cle: 'musicVolume', label: 'Musique', actif: true },
                { cle: 'voiceVolume', label: 'Voix off', actif: true },
                // ⚠️ GRISE, PAS CACHE. Le niveau du rush reste visible quand
                // le son est coupé : le masquer ferait croire qu'il n'existe
                // pas, et le réglage serait perdu de vue en le rallumant.
                { cle: 'rushVolume', label: 'Son du rush', actif: config.keepRushAudio },
              ] as const).map(({ cle, label, actif }) => (
                <div key={cle}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label
                      htmlFor={`autopilot-${cle}`}
                      className={`flex items-center gap-1.5 text-[11px] ${actif ? 'text-gray-300' : 'text-gray-600'}`}
                    >
                      {cle === 'musicVolume' && <Music className="w-3 h-3" />}
                      {cle === 'voiceVolume' && <Mic className="w-3 h-3" />}
                      {cle === 'rushVolume' && <Film className="w-3 h-3" />}
                      {label}
                    </label>
                    <span className={`text-[11px] tabular-nums ${actif ? 'text-gray-400' : 'text-gray-600'}`}>
                      {pourcent(config[cle])}
                    </span>
                  </div>
                  <input
                    id={`autopilot-${cle}`}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(config[cle] * 100)}
                    onChange={(e) => setConfig((x) => ({ ...x, [cle]: Number(e.target.value) / 100 }))}
                    // Le relâchement enregistre — pas chaque pas du curseur.
                    onMouseUp={() => enregistrer({ [cle]: config[cle] })}
                    onTouchEnd={() => enregistrer({ [cle]: config[cle] })}
                    onKeyUp={() => enregistrer({ [cle]: config[cle] })}
                    disabled={!ready || saving || !actif}
                    data-autopilot-volume={cle}
                    className="w-full accent-purple-500 disabled:opacity-40"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Étape 4 · Rythme & diffusion ─────────────────────────────── */}
      {etape === 3 && (
        <div className="space-y-4">
          <div>
            <label htmlFor="autopilot-hour" className="block text-xs font-medium text-gray-300 mb-1.5">
              Heure de départ
            </label>
            <select
              id="autopilot-hour"
              value={config.runHour}
              onChange={(e) => enregistrer({ runHour: Number(e.target.value) })}
              disabled={!ready || saving}
              data-autopilot-hour
              className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{heureLisible(h)}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Heure de {config.runTimezone.replace('_', ' ')}. La fréquence
              ci-dessous décide de l’espacement ; celle-ci, du moment.
            </p>
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

      {/* ── Étape 5 · Options & garde-fous ───────────────────────────── */}
      {etape === 4 && (
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

      {/* ── Étape 6 · Récapitulatif & activation ─────────────────────── */}
      {etape === 5 && (
        <div className="space-y-3">
          {([
            ['Ce qui change à chaque vidéo', RECAP_VARIABLE(config), 'variable'],
            ['Ce qui ne change jamais', RECAP_CONSTANT(config, voixClonees), 'constant'],
            ['Rythme & diffusion', RECAP_DIFFUSION(config), 'diffusion'],
          ] as Array<[string, Array<[string, string]>, string]>).map(([titre, lignes, jeton]) => (
            <dl
              key={jeton}
              data-autopilot-recap={jeton}
              className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 space-y-1.5 text-[11px]"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                {titre}
              </p>
              {lignes.map(([cle, valeur]) => (
                <div key={cle} className="flex items-baseline justify-between gap-3">
                  <dt className="text-gray-500 shrink-0">{cle}</dt>
                  <dd className="text-right text-gray-200">{valeur}</dd>
                </div>
              ))}
            </dl>
          ))}

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
              Départ à {heureLisible(config.runHour)} ({config.runTimezone}),
              {' '}{CADENCE_LABELS[config.cadence].toLowerCase()}.
              Prochain départ : {prochainDepart(config.runHour, config.runTimezone)}.
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
