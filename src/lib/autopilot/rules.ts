/**
 * Règles de l'Autopilote.
 *
 * Fonctions PURES : le moteur récurrent ne fera que les appliquer. C'est ce
 * qui rend vérifiable sur des valeurs ce qui, autrement, ne se constaterait
 * qu'en production — un cron qui génère trop souvent, ou qui vide un solde.
 *
 * Ce module est livré AVANT le moteur : il fixe le contrat que celui-ci devra
 * respecter, et l'écran de configuration s'en sert déjà pour annoncer la
 * prochaine génération.
 */

import {
  sanitizeDesignStyle, type AutopilotDesignStyle,
} from '@/lib/autopilot/textStyle';
import { sanitizeBrief, type VideoBrief } from '@/lib/creer/brief';

/**
 * Le brief RÉCURRENT, relu et écrit par ce module comme par l'écran.
 *
 * Réexporté d'un module pur partagé avec le brouillon de « Créer » : une
 * seule règle de nettoyage (chaînes rognées, ≤ 300 caractères, clés vides
 * absentes) pour les deux parcours.
 */
export { sanitizeBrief, type VideoBrief };

export type AutopilotMode = 'auto' | 'review';

export type AutopilotCadence = 'daily' | 'every_2_days' | 'weekly';

/** D'où vient la photo d'affiche d'un montage. */
export type AutopilotPosterMode = 'auto' | 'custom' | 'reference';

export const POSTER_MODES: readonly AutopilotPosterMode[] = Object.freeze(['auto', 'custom', 'reference']);

export const POSTER_MODE_LABELS: Record<AutopilotPosterMode, string> = {
  auto: 'Automatique',
  custom: 'Mes photos',
  reference: 'Mes photos comme référence IA',
};

export const POSTER_MODE_HINTS: Record<AutopilotPosterMode, string> = {
  auto: 'Studiio cherche une photo qui colle au thème de chaque vidéo.',
  custom: 'Vos photos, en rotation — comme la banque de rushes.',
  // ⚠️ CHAQUE MONTAGE GÉNÈRE ALORS UNE IMAGE (facturée) à partir d'UNE de vos
  // photos, avec le modèle qui préserve votre visage/vos vêtements. En cas
  // d'échec, votre photo est gardée telle quelle — jamais remplacée par une
  // banque d'images.
  reference: 'Une affiche IA est créée à partir de vos photos (visage/tenue préservés), une par vidéo.',
};

/** Combien de jours séparent deux générations. */
export const CADENCE_DAYS: Record<AutopilotCadence, number> = {
  daily: 1,
  every_2_days: 2,
  weekly: 7,
};

export const CADENCE_LABELS: Record<AutopilotCadence, string> = {
  daily: 'Chaque jour',
  every_2_days: 'Un jour sur deux',
  weekly: 'Chaque semaine',
};

export const MODE_LABELS: Record<AutopilotMode, string> = {
  auto: 'Publier automatiquement',
  review: 'Préparer et me laisser valider',
};

export const MODE_HINTS: Record<AutopilotMode, string> = {
  // « à l'heure de publication » et non « à l'heure prévue » : l'heure prévue
  // se lisait comme l'heure de PRODUCTION (8 h), alors que la publication se
  // fait le lendemain, à `publishTime`.
  auto: 'Les vidéos sont programmées sur vos réseaux, le lendemain de leur production, à l’heure de publication choisie — sans intervention.',
  review: 'Les vidéos arrivent en brouillon dans le Calendrier. Rien ne part sans vous.',
};

/** Cadences et modes acceptés — la seule liste, pour l'écran comme pour la base. */
export const CADENCES: readonly AutopilotCadence[] = Object.freeze(['daily', 'every_2_days', 'weekly']);
export const MODES: readonly AutopilotMode[] = Object.freeze(['auto', 'review']);

/**
 * Ce que Studiio fait des vidéos — les trois intentions que l'écran présente.
 *
 * ⚠️ AUCUN NOUVEAU STATUT, AUCUNE NOUVELLE COLONNE. L'intention se DÉRIVE de
 * `(mode, platforms)`, et s'y RAMÈNE : « produire seulement » n'est que
 * `review` sans réseau — un brouillon dans le Calendrier, que l'on
 * télécharge par l'export sécurisé. Un troisième mode en base aurait exigé
 * que le cron, `statusForMode` et le Calendrier apprennent une valeur de plus
 * pour un comportement qu'ils savent déjà produire.
 *
 *   publier  → mode `auto`,   réseaux requis   : posts `scheduled`, le cron publie ;
 *   valider  → mode `review`, réseaux au choix : posts `draft`, à programmer soi-même ;
 *   produire → mode `review`, aucun réseau     : posts `draft`, à télécharger.
 */
export type AutopilotIntention = 'publier' | 'valider' | 'produire';

export const INTENTIONS: readonly AutopilotIntention[] = Object.freeze(['publier', 'valider', 'produire']);

/** Le mode que chaque intention ÉCRIT. */
export const INTENTION_MODE: Record<AutopilotIntention, AutopilotMode> = {
  publier: 'auto',
  valider: 'review',
  produire: 'review',
};

export const INTENTION_LABELS: Record<AutopilotIntention, string> = {
  publier: MODE_LABELS.auto,
  valider: MODE_LABELS.review,
  produire: 'Produire seulement — téléchargement',
};

export const INTENTION_HINTS: Record<AutopilotIntention, string> = {
  publier: MODE_HINTS.auto,
  valider: MODE_HINTS.review,
  produire: 'Aucun réseau. Les vidéos arrivent en brouillon dans le Calendrier ; vous les téléchargez depuis l’export sécurisé (rendu facturé aux conditions habituelles).',
};

/** L'intention que dit une configuration — la lecture inverse de `patchPourIntention`. */
export function intentionDiffusion(config: Pick<AutopilotConfig, 'mode' | 'platforms'>): AutopilotIntention {
  if (config.mode === 'auto') return 'publier';
  return config.platforms.length > 0 ? 'valider' : 'produire';
}

/**
 * Ce qu'il faut ÉCRIRE pour passer à une intention — en UN seul enregistrement.
 *
 * « Produire seulement » vide les réseaux dans le MÊME patch que le mode :
 * deux appels séparés laisseraient, entre les deux, une configuration
 * `review` + réseaux que l'écran lirait « valider ». Les deux autres ne
 * touchent pas aux réseaux : revenir de « produire » à « valider » rend le
 * sélecteur, vide, à l'utilisateur.
 */
export function patchPourIntention(intention: AutopilotIntention): Partial<AutopilotConfig> {
  return intention === 'produire'
    ? { mode: 'review', platforms: [] }
    : { mode: INTENTION_MODE[intention] };
}

/**
 * Seuil de crédits par défaut.
 *
 * Un Autopilote qui vide le solde jusqu'à zéro laisse l'utilisateur incapable
 * de produire quoi que ce soit à la main le jour où il en a besoin. Le seuil
 * lui garde de quoi travailler.
 */
export const DEFAULT_CREDIT_FLOOR = 50;

/** Nombre de montages par cycle, borné. */
export const MAX_PER_CYCLE = 5;

/** Heure de départ par défaut — celle du cron quotidien actuel. */
export const DEFAULT_RUN_HOUR = 8;

/** Fuseau par défaut, et repli de tout fuseau illisible. */
export const DEFAULT_TIMEZONE = 'Europe/Paris';

/**
 * Heure de PUBLICATION par défaut des posts produits — « HH:MM ».
 *
 * ⚠️ CE N'EST PAS `DEFAULT_RUN_HOUR`. L'Autopilote PRODUIT à `runHour`
 * (8 h) et PROGRAMME la publication du lendemain à cette heure-ci. Les deux
 * ont longtemps été confondues à l'écran (« chaque jour à 08:00 … publiée
 * automatiquement ») alors que le moteur écrivait 18:00 en dur.
 *
 * Défini ICI, et le moteur l'importe : une seule source, sinon l'écran et le
 * moteur finiraient par annoncer deux heures différentes.
 */
export const DEFAULT_PUBLISH_TIME = '18:00';

/** « HH:MM », 24 h — la seule forme que `scheduled_time` (colonne TIME) et le cron relisent. */
export const PUBLISH_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Heure de publication relue, ou son défaut.
 *
 * Les MINUTES sont conservées : « 18:45 » reste « 18:45 ». Une forme
 * illisible (« 18h », « 25:00 », `undefined` d'une colonne encore absente)
 * retombe sur 18:00 — l'heure qui était en dur, donc aucune configuration
 * existante ne change de créneau.
 */
export function sanitizePublishTime(raw: unknown): string {
  return typeof raw === 'string' && PUBLISH_TIME_RE.test(raw.trim()) ? raw.trim() : DEFAULT_PUBLISH_TIME;
}

/** « YYYY-MM-DD » strict — la forme qu'échangent `<input type="date">` et une colonne `date`. */
export const START_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Date de début relue, ou `null`.
 *
 * `null` veut dire « dès le prochain passage » — le comportement d'avant,
 * donc celui de toute configuration existante et de toute ligne relue avant
 * la migration (`start_date` absent → `undefined` → `null`).
 *
 * La forme ne suffit pas : « 2026-02-30 » passe la regex et n'existe pas.
 * On refait le tour par `Date.UTC` et on vérifie que les champs reviennent
 * intacts — une date qui « déborde » (30 février → 2 mars) est rejetée, pas
 * corrigée : corriger en silence programmerait une production à une date
 * que personne n'a saisie.
 */
export function sanitizeStartDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!START_DATE_RE.test(s)) return null;
  const [y, m, j] = s.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, j));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null;
  return s;
}

/**
 * Date qu'il est chez l'utilisateur, « YYYY-MM-DD ».
 *
 * Même politique de repli que `localHour` : un fuseau illisible ne doit pas
 * interrompre le cycle, on retombe sur Paris, puis sur l'UTC.
 */
export function localDate(now: number, timezone: string): string {
  try {
    return lireDateLocale(now, timezone || DEFAULT_TIMEZONE);
  } catch { /* fuseau illisible : repli ci-dessous */ }
  try {
    return lireDateLocale(now, DEFAULT_TIMEZONE);
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** La date « YYYY-MM-DD » dans un fuseau — LÈVE si le fuseau est illisible. */
function lireDateLocale(now: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const champ = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const s = `${champ('year')}-${champ('month')}-${champ('day')}`;
  if (!START_DATE_RE.test(s)) throw new Error(`date illisible : ${s}`);
  return s;
}

/**
 * Créneau d'une production IMMÉDIATE : « aujourd'hui, à l'heure courante
 * arrondie », chez l'utilisateur.
 *
 * ⚠️ CE N'EST PAS L'HEURE DE PUBLICATION CONFIGURÉE. `publishTime` est
 * l'heure des posts que le CRON programme pour le lendemain ; un brouillon
 * demandé « maintenant » se dépose à maintenant — sinon l'écran le rangerait
 * à 18:00 demain, et l'utilisateur chercherait sa vidéo au mauvais jour.
 * Un brouillon ne part de toute façon jamais seul : la date ne commande
 * aucune publication.
 *
 * L'instant est arrondi AU-DESSUS au multiple de `pasMinutes` (5 min par
 * défaut) après `delaiMinutes` : deux clics dans la même fenêtre tombent sur
 * le MÊME créneau, et c'est ce jeton commun qui refuse la seconde
 * production. Arrondir l'INSTANT (UTC) puis lire l'heure locale garde les
 * minutes exactes dans tout fuseau à décalage multiple de 5 min — tous ceux
 * que `Intl` connaît — et passe minuit sans arithmétique de date.
 */
export function creneauImmediat(
  now: number,
  timezone: string,
  delaiMinutes = 5,
  pasMinutes = 5,
): { date: string; time: string } {
  const pas = Math.max(1, pasMinutes) * 60_000;
  const t = Math.ceil((now + Math.max(0, delaiMinutes) * 60_000) / pas) * pas;
  const date = localDate(t, timezone);
  const lire = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(t));
    const champ = (k: string) => parts.find((p) => p.type === k)?.value ?? '';
    // `en-GB` rend « 24 » pour minuit dans certains moteurs : on le ramène.
    const h = champ('hour') === '24' ? '00' : champ('hour');
    const s = `${h}:${champ('minute')}`;
    if (!PUBLISH_TIME_RE.test(s)) throw new Error(`heure illisible : ${s}`);
    return s;
  };
  let time: string;
  try {
    time = lire(timezone || DEFAULT_TIMEZONE);
  } catch {
    try {
      time = lire(DEFAULT_TIMEZONE);
    } catch {
      const d = new Date(t);
      time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    }
  }
  return { date, time };
}

/** « YYYY-MM-DD » + `jours`, par arithmétique de CHAMPS — jamais de millisecondes. */
export function ajouterJours(date: string, jours: number): string {
  const [y, m, j] = date.split('-').map(Number);
  // `Date.UTC` normalise les débordements de mois et d'année, et l'UTC ne
  // connaît aucune heure d'été : un jour y fait toujours 24 h.
  const d = new Date(Date.UTC(y, m - 1, j + jours));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** La date locale du SERVEUR, « YYYY-MM-DD » — le repli historique de `slotDate`. */
function dateServeur(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Date du n-ième montage du cycle.
 *
 * ⚠️ RÈGLE DE LA DATE DE DÉBUT. Le premier montage part de « demain » —
 * ou de `startDate` si elle est plus tard : la première publication est
 * programmée AU PLUS TÔT le jour choisi. Une date de début déjà passée, ou
 * égale à aujourd'hui, ne change rien : c'est « demain », comme avant. Une
 * date de début absente non plus.
 *
 *   premier = max(demain, startDate) ; n-ième = premier + n.
 *
 * ⚠️ « DEMAIN » SE LIT DANS LE FUSEAU DE L'UTILISATEUR quand `timezone` est
 * donné. Sans lui, c'est la date LOCALE DU SERVEUR — le comportement
 * historique, conservé pour les appels existants. Un compte à Nouméa dont le
 * cron tourne à 8 h locales est déjà « demain » pour un serveur à Paris :
 * lire la date serveur lui programmait sa vidéo le jour même, à une heure
 * déjà passée, donc publiée immédiatement par le cron.
 *
 * L'arithmétique se fait sur les CHAMPS de la date (année, mois, jour), pas
 * sur des millisecondes : un jour de changement d'heure fait 23 ou 25 h, et
 * « + 24 h » y tombe sur le mauvais jour. Comparer deux « YYYY-MM-DD » en
 * chaînes est exact : la forme est à largeur fixe.
 *
 * Vit ICI, avec les autres règles pures, parce que l'écran l'applique aussi
 * pour annoncer la prochaine publication — la même fonction que le moteur,
 * et non une seconde estimation. `engine.ts` la réexporte pour ses lecteurs.
 */
export function slotDate(
  base: Date,
  index: number,
  timezone?: string,
  startDate?: string | null,
): string {
  // Fuseau illisible : la date serveur, comme avant — et non un cycle
  // interrompu pour tous les comptes suivants. (Lecture STRICTE et non
  // `localDate` : celle-ci retomberait sur Paris, ce qui changerait le repli
  // historique des appels existants.)
  let aujourdHui: string;
  try {
    aujourdHui = timezone ? lireDateLocale(base.getTime(), timezone) : dateServeur(base);
  } catch {
    aujourdHui = dateServeur(base);
  }
  // Demain, puis un jour de plus par montage : deux publications le même jour
  // se feraient concurrence dans le fil de l'utilisateur.
  const demain = ajouterJours(aujourdHui, 1);
  const debut = sanitizeStartDate(startDate);
  const premier = debut && debut > demain ? debut : demain;
  return ajouterJours(premier, Math.max(0, Math.floor(index) || 0));
}

/**
 * L'identité constante par défaut.
 *
 * ⚠️ CES COULEURS SONT CELLES QUI ÉTAIENT EN DUR dans `buildAutopilotDesign`
 * (`DEFAULT_COLORS` de `designSpec`). Les recopier ici plutôt que les importer
 * garde ce module PUR — il est relu par l'écran comme par le cron, et ne doit
 * dépendre d'aucun module de rendu. Un test vérifie qu'elles n'ont pas dérivé.
 */
export const DEFAULT_BRANDING = Object.freeze({
  cardGradientStart: '#7C3AED',
  cardGradientEnd: '#EC4899',
  titleColor: '#FFFFFF',
});

/** Niveaux par défaut du mixeur — les mêmes valeurs que le compositeur. */
export const DEFAULT_VOLUMES = Object.freeze({
  music: 0.8,
  voice: 1.0,
  rush: 0.5,
});

/** `#ABC` ou `#AABBCC`, rien d'autre. */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Couleur relue, ou son défaut.
 *
 * Une couleur illisible ne doit pas produire un montage transparent ou un
 * `linear-gradient` invalide qui ferait tomber le fond en noir : on retombe
 * sur la couleur d'origine, que l'utilisateur reconnaît.
 */
export function sanitizeHexColor(raw: unknown, parDefaut: string): string {
  return typeof raw === 'string' && HEX.test(raw.trim()) ? raw.trim() : parDefaut;
}

/**
 * Niveau du mixeur, borné à 0–1.
 *
 * Un gain supérieur à 1 sature le montage, un gain négatif inverse la phase :
 * ni l'un ni l'autre n'est un réglage, ce sont des accidents de saisie.
 */
export function sanitizeVolume(raw: unknown, parDefaut: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return parDefaut;
  return Math.min(1, Math.max(0, n));
}

/** URL http(s) exploitable, ou `null`. */
function sanitizeUrl(raw: unknown): string | null {
  return typeof raw === 'string' && /^https?:\/\//.test(raw.trim()) ? raw.trim() : null;
}

/**
 * Heure qu'il est chez l'utilisateur, de 0 à 23.
 *
 * ⚠️ UN FUSEAU INVALIDE NE DOIT PAS INTERROMPRE LE CYCLE. `Intl` lève sur un
 * identifiant inconnu, et la valeur vient de la base : une saisie fautive
 * — ou une colonne encore absente — bloquerait la production de TOUS les
 * comptes traités après elle. On retombe donc sur Paris.
 */
export function localHour(now: number, timezone: string): number {
  const lire = (tz: string) => Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz })
      .format(new Date(now)),
  );
  try {
    const h = lire(timezone || DEFAULT_TIMEZONE);
    if (Number.isInteger(h) && h >= 0 && h <= 23) return h;
  } catch { /* fuseau illisible : repli ci-dessous */ }
  try {
    return lire(DEFAULT_TIMEZONE);
  } catch {
    // `Intl` sans données de fuseau : on rend une heure UTC plutôt que rien.
    return new Date(now).getUTCHours();
  }
}

/** Est-ce l'heure de produire, chez cet utilisateur ? */
export function isRunHour(config: AutopilotConfig, now: number): boolean {
  return localHour(now, config.runTimezone) === config.runHour;
}

export interface AutopilotConfig {
  enabled: boolean;
  mode: AutopilotMode;
  cadence: AutopilotCadence;
  /** Montages produits à chaque passage. */
  countPerCycle: number;
  platforms: string[];
  creditFloor: number;
  /** Rushes dans lesquels piocher, dans l'ordre d'ajout. */
  rushUrls: string[];
  /**
   * Thèmes que l'Autopilote fait tourner.
   *
   * ⚠️ VIDE = TOUS LES THÈMES, et c'est ce qui rend l'ajout rétro-compatible :
   * une configuration qui n'a jamais choisi continue de parcourir les douze
   * thèmes du Mode simple, exactement comme avant.
   *
   * Accepte des thèmes PERSONNALISÉS, écrits à la main : ils ne figurent dans
   * aucune liste, et les filtrer sur les thèmes connus les jetterait
   * silencieusement.
   */
  topics: string[];
  /** Dernier passage réellement effectué, ISO. */
  lastRunAt: string | null;
  /** Dernier rush utilisé — pour ne pas le reprendre deux fois de suite. */
  lastRushUrl: string | null;
  /**
   * Heure de départ, dans le fuseau de l'utilisateur (0–23).
   *
   * Le déclencheur passe TOUTES LES HEURES ; c'est cette valeur qui décide
   * pour qui il produit. La cadence, elle, continue de gérer l'espacement
   * entre deux cycles — les deux jauges répondent à des questions
   * différentes : « à quelle heure » et « tous les combien ».
   */
  runHour: number;
  /** Fuseau dans lequel `runHour` — et `publishTime` — se lisent. */
  runTimezone: string;
  /**
   * Heure de PUBLICATION des posts produits, « HH:MM », dans `runTimezone`.
   *
   * Distincte de `runHour` : celle-ci dit QUAND le moteur tourne, celle-là à
   * quelle heure les vidéos produites sont programmées (le lendemain, puis
   * un jour de plus par montage). Les minutes comptent : « 18:45 » est
   * écrit tel quel dans `scheduled_time`, et le cron de publication compare
   * en « HH:MM ».
   */
  publishTime: string;
  /**
   * Date de DÉBUT de la programmation, « YYYY-MM-DD » dans `runTimezone`.
   *
   * `null` = dès le prochain passage — le comportement d'avant, celui de
   * toute configuration existante. Deux effets, et deux seulement :
   *
   *   1. le moteur REFUSE de produire avant ce jour (`decideRun` →
   *      `avant-la-date-de-debut`, silencieux comme `pas-encore`) ;
   *   2. la première publication est programmée AU PLUS TÔT ce jour
   *      (`slotDate` part de `startDate` quand elle est après « demain »).
   *
   * Ni l'heure de production ni l'heure de publication n'en dépendent :
   * c'est une date, elles restent des heures.
   */
  startDate: string | null;
  /**
   * Narration IA sur les montages produits.
   *
   * ⚠️ FAUX PAR DÉFAUT, ET CE N'EST PAS UNE PRUDENCE DE PRINCIPE. La voix
   * passe par ElevenLabs, facturé à l'usage : l'activer d'office ferait payer
   * une narration que personne n'a demandée, sur chaque montage, sans que
   * l'utilisateur ait rien changé.
   */
  voiceEnabled: boolean;

  /**
   * Monter la VIDÉO de mon jumeau (avatar animé sur ma voix clonée) dans les
   * montages produits — « Produire maintenant » ET le cron programmé.
   *
   * ⚠️ FAUX PAR DÉFAUT, et ce n'est pas une prudence de principe : chaque
   * montage avec jumeau lance une génération D-ID facturée (AVATAR_VIDEO_COST)
   * en plus du rendu. On ne l'active jamais à la place de l'utilisateur. Une
   * colonne absente (migration pas encore appliquée) vaut `undefined` → faux :
   * aucune configuration existante ne se met à générer un avatar sans l'avoir
   * demandé.
   *
   * Vrai : la vidéo du jumeau tient la séquence « Vidéo » et porte la voix
   * clonée (seule voix du montage) ; le rush n'est pas utilisé pour ces
   * montages. La disponibilité RÉELLE du moteur (D-ID configuré) est
   * revérifiée au lancement — un drapeau à vrai ne force jamais une génération
   * que le serveur ne sait pas produire.
   */
  jumeauAvatar: boolean;

  // ── L'identité CONSTANTE ────────────────────────────────────────────────
  //
  // ⚠️ CE BLOC EST CE QUI NE VARIE PAS. L'affiche, les textes et le rush
  // changent à chaque vidéo — c'est le propre de l'Autopilote. Ces réglages-là
  // sont posés UNE fois et TOUTES les vidéos suivantes en héritent : sans eux,
  // une chaîne produite en pilote automatique n'aurait aucune identité
  // reconnaissable d'un post à l'autre.

  /** Début du dégradé des cartes et du montage. */
  cardGradientStart: string;
  /** Fin du dégradé. */
  cardGradientEnd: string;
  /** Couleur du titre. */
  titleColor: string;
  /**
   * L'affiche est-elle peinte derrière les CARTES (et le CTA) ?
   *
   * ⚠️ FAUX PAR DÉFAUT, ET C'EST UN CHANGEMENT ASSUMÉ. Jusqu'ici l'affiche
   * couvrait toutes les séquences. Les cartes se lisent mal sur une photo, et
   * l'utilisateur a demandé qu'elles s'affichent sur SES couleurs. La séquence
   * titre, elle, garde l'affiche — c'est là que la variété se voit.
   */
  cardsShowPoster: boolean;
  /** Musique de fond, commune à toutes les vidéos. `null` = aucune. */
  musicUrl: string | null;
  /**
   * Voix clonée de l'utilisateur (`user_voices`), identifiant préfixé.
   *
   * `null` = la voix par défaut du serveur. Ne sert que si `voiceEnabled`.
   */
  voiceId: string | null;
  /**
   * Garder la piste audio du rush ?
   *
   * ⚠️ FAUX PAR DÉFAUT. Le montage porte déjà une musique et, en option, une
   * voix off : y ajouter d'office l'ambiance du rush fait trois pistes
   * concurrentes que personne n'a demandées.
   */
  keepRushAudio: boolean;
  /** Mixeur — niveau de la musique, 0 à 1. */
  musicVolume: number;
  /** Mixeur — niveau de la voix off, 0 à 1. */
  voiceVolume: number;
  /** Mixeur — niveau du son du rush, 0 à 1. Sans effet si `keepRushAudio` est faux. */
  rushVolume: number;
  /**
   * Police, taille, position et icônes — réglées sur l'aperçu, une fois.
   *
   * ⚠️ `{}` EST LE COMPORTEMENT ACTUEL. Une propriété absente laisse
   * `buildAutopilotDesign` poser son défaut ; c'est ce qui rend l'ajout
   * rétro-compatible pour toute configuration existante, et pour toute
   * configuration relue avant que la migration ne soit appliquée.
   */
  designStyle: AutopilotDesignStyle;
  /**
   * Affiches fournies par l'utilisateur, dans l'ordre d'ajout.
   *
   * Elles ne servent QUE si `posterMode === 'custom'` — et si elles existent :
   * un mode « mes photos » sur une banque vide retombe sur la recherche
   * automatique plutôt que de produire un montage sans affiche.
   */
  posterUrls: string[];
  /**
   * D'où vient l'affiche : de la banque de l'utilisateur, ou de la recherche
   * par thème.
   *
   * ⚠️ `'auto'` PAR DÉFAUT — le comportement actuel, à l'identique.
   */
  posterMode: AutopilotPosterMode;
  /**
   * Le brief RÉCURRENT — objectif, message, public, CTA — commun à toutes
   * les vidéos produites. À distinguer du SCRIPT de chaque vidéo, qui est
   * généré à sa production à partir de ce brief et du sujet du jour.
   *
   * ⚠️ `{}` EST LE COMPORTEMENT ACTUEL : sans brief, le cron génère les
   * textes exactement comme avant. Colonne `brief jsonb`, absente tant que
   * `2026-09-21-autopilot-brief.sql` n'est pas appliquée : `sanitizeBrief`
   * rend alors `{}`.
   */
  brief: VideoBrief;
}

export const DEFAULT_CONFIG: AutopilotConfig = {
  enabled: false,
  mode: 'review',
  cadence: 'weekly',
  countPerCycle: 1,
  platforms: [],
  creditFloor: DEFAULT_CREDIT_FLOOR,
  rushUrls: [],
  topics: [],
  lastRunAt: null,
  lastRushUrl: null,
  // 8 h à Paris : ce que fait le cron quotidien aujourd'hui. Une
  // configuration existante ne change donc pas d'horaire.
  runHour: DEFAULT_RUN_HOUR,
  runTimezone: DEFAULT_TIMEZONE,
  // 18:00 : l'heure que le moteur écrivait en dur. Aucune configuration
  // existante ne change de créneau de publication.
  publishTime: DEFAULT_PUBLISH_TIME,
  // Aucune date de début : dès le prochain passage, comme avant.
  startDate: null,
  voiceEnabled: false,
  // Jumeau vidéo désactivé : aucune génération D-ID facturée sans demande.
  jumeauAvatar: false,
  cardGradientStart: DEFAULT_BRANDING.cardGradientStart,
  cardGradientEnd: DEFAULT_BRANDING.cardGradientEnd,
  titleColor: DEFAULT_BRANDING.titleColor,
  // Cartes sur les couleurs, pas sur la photo — la demande explicite.
  cardsShowPoster: false,
  musicUrl: null,
  voiceId: null,
  // Son du rush coupé : la musique et la voix off suffisent.
  keepRushAudio: false,
  musicVolume: DEFAULT_VOLUMES.music,
  voiceVolume: DEFAULT_VOLUMES.voice,
  rushVolume: DEFAULT_VOLUMES.rush,
  // Rien d'imposé : le montage garde les défauts du Mode simple.
  designStyle: {},
  posterUrls: [],
  // Le comportement actuel : Studiio cherche l'affiche par thème.
  posterMode: 'auto',
  // Aucun brief : les textes sont generes comme avant.
  brief: {},
};

/** Statut du post créé, selon le mode choisi. */
export function statusForMode(mode: AutopilotMode): 'scheduled' | 'draft' {
  // `review` laisse la main : rien ne part sans validation. C'est le défaut,
  // et le seul choix sûr quand on n'est pas certain de ce que l'utilisateur
  // attend.
  return mode === 'auto' ? 'scheduled' : 'draft';
}

/** Date du prochain passage, à partir du dernier. */
export function nextRunAt(
  cadence: AutopilotCadence,
  lastRunAt: string | null | undefined,
  now: number,
): Date {
  const jours = CADENCE_DAYS[cadence] ?? CADENCE_DAYS.weekly;
  const dernier = lastRunAt ? Date.parse(lastRunAt) : NaN;
  // Jamais passé : le prochain, c'est maintenant.
  if (!Number.isFinite(dernier)) return new Date(now);
  return new Date(dernier + jours * 24 * 60 * 60 * 1000);
}

/** Est-il temps de générer ? */
export function isDue(
  cadence: AutopilotCadence,
  lastRunAt: string | null | undefined,
  now: number,
): boolean {
  return nextRunAt(cadence, lastRunAt, now).getTime() <= now;
}

export type SkipReason =
  | 'desactive'
  | 'pas-encore'
  /** Ce n'est pas l'heure choisie — cas NORMAL, silencieux comme `pas-encore`. */
  | 'pas-l-heure'
  /** La date de début n'est pas atteinte — cas NORMAL, silencieux comme `pas-encore`. */
  | 'avant-la-date-de-debut'
  | 'credits'
  | 'sans-rush';

/** Est-on, chez l'utilisateur, avant la date de début choisie ? Sans date : jamais. */
export function isBeforeStartDate(config: Pick<AutopilotConfig, 'startDate' | 'runTimezone'>, now: number): boolean {
  const debut = sanitizeStartDate(config.startDate);
  if (!debut) return false;
  // Comparaison de deux « YYYY-MM-DD » : exacte, la forme est à largeur fixe.
  return localDate(now, config.runTimezone) < debut;
}

export type RunDecision =
  | { run: true; count: number; status: 'scheduled' | 'draft' }
  | { run: false; reason: SkipReason };

/**
 * Faut-il générer maintenant, et combien ?
 *
 * L'ORDRE DES REFUS COMPTE. Le solde est vérifié AVANT la cadence : un
 * utilisateur à court de crédits doit être prévenu même le jour où il n'était
 * de toute façon pas temps de générer — sinon il ne l'apprend qu'au prochain
 * cycle, une semaine plus tard, en découvrant qu'il ne s'est rien passé.
 *
 * Le nombre est ramené à ce que le solde permet réellement : générer trois
 * montages avec de quoi en payer un laisserait deux échecs et un solde à zéro.
 */
export function decideRun(input: {
  config: AutopilotConfig;
  credits: number;
  costPerVideo: number;
  now: number;
  /** L'Autopilote peut-il se passer de rush ? Par défaut non. */
  allowWithoutRush?: boolean;
}): RunDecision {
  const { config, credits, costPerVideo, now } = input;
  if (!config.enabled) return { run: false, reason: 'desactive' };

  const plancher = Number.isFinite(config.creditFloor) ? config.creditFloor : DEFAULT_CREDIT_FLOOR;
  const disponible = credits - plancher;
  const cout = costPerVideo > 0 ? costPerVideo : 1;
  const abordables = Math.floor(disponible / cout);
  if (abordables < 1) return { run: false, reason: 'credits' };

  if (!config.rushUrls.length && !input.allowWithoutRush) {
    return { run: false, reason: 'sans-rush' };
  }

  // La date de début se lit comme un JOUR chez l'utilisateur : la veille au
  // soir, même à l'heure de production, on ne produit pas. Refus APRÈS les
  // crédits et les rushes — ce que l'utilisateur peut lever se dit même
  // avant la date — et AVANT l'heure : une jauge de plus, silencieuse.
  if (isBeforeStartDate(config, now)) {
    return { run: false, reason: 'avant-la-date-de-debut' };
  }

  // ⚠️ DEUX JAUGES, DEUX QUESTIONS. `isRunHour` répond « est-ce l'heure ? »,
  // `isDue` répond « a-t-on assez attendu ? ». Le déclencheur passant toutes
  // les heures, sans la première un compte quotidien produirait vingt-quatre
  // fois par jour dès que la cadence le permettrait.
  if (!isRunHour(config, now)) {
    return { run: false, reason: 'pas-l-heure' };
  }

  if (!isDue(config.cadence, config.lastRunAt, now)) {
    return { run: false, reason: 'pas-encore' };
  }

  const voulus = Math.max(1, Math.min(MAX_PER_CYCLE, Math.floor(config.countPerCycle) || 1));
  return { run: true, count: Math.min(voulus, abordables), status: statusForMode(config.mode) };
}

/**
 * Rush à utiliser, en rotation.
 *
 * On évite celui du passage précédent : deux montages d'affilée sur la même
 * image, c'est exactement ce que la banque de rushes existe pour éviter.
 *
 * ⚠️ LA LISTE EST DÉDOUBLONNÉE ICI AUSSI, pas seulement dans
 * `sanitizeConfig`. Une même adresse présente deux fois — une banque
 * constituée à la main, une configuration écrite avant le dédoublonnage —
 * ferait tomber deux rangs différents de la rotation sur le MÊME fichier :
 * l'utilisateur verrait « deux rushes » et recevrait deux fois la même vidéo,
 * sans qu'aucune erreur ne le signale.
 *
 * ⚠️ AVEC UN SEUL RUSH, IL EST FORCÉMENT RÉPÉTÉ. Toutes les vidéos partagent
 * alors la même séquence vidéo ; seuls l'affiche et les textes varient. C'est
 * la limite de la banque, pas de la rotation — d'où l'invitation à en ajouter
 * dans l'écran de configuration.
 */
export function pickRush(
  rushUrls: string[],
  lastRushUrl: string | null | undefined,
  index = 0,
): string | null {
  const propres = Array.from(
    new Set(rushUrls.filter((u): u is string => typeof u === 'string' && !!u)),
  );
  if (propres.length === 0) return null;
  if (propres.length === 1) return propres[0];
  // `indexOf` rend -1 quand le dernier rush a été retiré de la banque : le
  // `+ 1` ramène alors au premier, ce qui est le comportement voulu.
  const depart = lastRushUrl ? propres.indexOf(lastRushUrl) : -1;
  // Le suivant de celui d'avant, puis on avance d'un cran par montage du cycle.
  // `index` peut dépasser la taille de la banque (cycle de 5 sur 2 rushes) :
  // le modulo boucle, et deux montages VOISINS restent toujours différents.
  const rang = (depart + 1 + Math.max(0, Math.floor(index))) % propres.length;
  return propres[rang];
}

/** Message d'état affiché sous l'interrupteur. */
export function statusMessage(
  config: AutopilotConfig,
  now: number,
  formatDate: (d: Date) => string,
): string {
  if (!config.enabled) return 'En pause. Rien n’est généré.';
  if (!config.rushUrls.length) {
    return 'Actif, mais aucun rush dans la banque — ajoutez-en pour lancer la production.';
  }
  const prochain = nextRunAt(config.cadence, config.lastRunAt, now);
  // La date de début prime sur la cadence : « au prochain passage » serait
  // faux tant qu'elle n'est pas atteinte. Elle est posée à MIDI UTC : un
  // libellé de date sans heure, que n'importe quel fuseau à ±12 h lit le
  // bon jour.
  const quand = isBeforeStartDate(config, now)
    ? `à partir du ${formatDate(new Date(`${config.startDate}T12:00:00Z`))}`
    : prochain.getTime() <= now ? 'au prochain passage' : formatDate(prochain);
  const n = config.rushUrls.length;
  return `Actif · prochaine génération ${quand} · ${n} rush${n > 1 ? 'es' : ''} disponible${n > 1 ? 's' : ''}`;
}

/** Nettoie une configuration relue de la base ou reçue de l'écran. */
export function sanitizeConfig(raw: unknown): AutopilotConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cadence = CADENCES.includes(o.cadence as AutopilotCadence)
    ? (o.cadence as AutopilotCadence)
    : DEFAULT_CONFIG.cadence;
  const mode = MODES.includes(o.mode as AutopilotMode)
    ? (o.mode as AutopilotMode)
    : DEFAULT_CONFIG.mode;
  const floorBrut = Number(o.creditFloor);
  return {
    enabled: o.enabled === true,
    mode,
    cadence,
    countPerCycle: Math.max(1, Math.min(MAX_PER_CYCLE, Math.floor(Number(o.countPerCycle)) || 1)),
    platforms: Array.isArray(o.platforms)
      ? o.platforms.filter((p): p is string => typeof p === 'string' && !!p)
      : [],
    // Un plancher négatif reviendrait à autoriser un solde négatif ; un
    // plancher absurde bloquerait tout sans le dire.
    creditFloor: Number.isFinite(floorBrut) && floorBrut >= 0
      ? Math.min(10_000, Math.floor(floorBrut))
      : DEFAULT_CREDIT_FLOOR,
    rushUrls: Array.isArray(o.rushUrls)
      ? Array.from(new Set(o.rushUrls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))))
      : [],
    // Chaînes non vides, rognées, dédoublonnées et bornées : un thème de
    // 4 000 caractères ou répété vingt fois ne rendrait service à personne.
    topics: Array.isArray(o.topics)
      ? Array.from(new Set(
        o.topics
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim().slice(0, 40))
          .filter((t) => t.length > 0),
      )).slice(0, 20)
      : [],
    lastRunAt: typeof o.lastRunAt === 'string' ? o.lastRunAt : null,
    lastRushUrl: typeof o.lastRushUrl === 'string' ? o.lastRushUrl : null,
    // Bornée 0–23 : une valeur hors plage ne correspondrait à aucune heure et
    // l'Autopilote ne partirait jamais, sans rien dire.
    runHour: Number.isFinite(Number(o.runHour))
      ? Math.min(23, Math.max(0, Math.floor(Number(o.runHour))))
      : DEFAULT_RUN_HOUR,
    runTimezone: typeof o.runTimezone === 'string' && o.runTimezone.trim()
      ? o.runTimezone.trim()
      : DEFAULT_TIMEZONE,
    // « HH:MM » strict, minutes conservées ; colonne absente ou valeur
    // illisible → 18:00, l'heure jusqu'ici en dur dans le moteur.
    publishTime: sanitizePublishTime(o.publishTime),
    // « YYYY-MM-DD » valide, ou `null` = dès le prochain passage. Colonne
    // absente (migration du 21 septembre non appliquée) → `undefined` →
    // `null` : aucune configuration existante n'attend une date.
    startDate: sanitizeStartDate(o.startDate),
    // `=== true` et non un test de véracité : une colonne absente (migration
    // pas encore appliquée) vaut `undefined`, donc « pas de voix », donc
    // aucun appel facturé.
    voiceEnabled: o.voiceEnabled === true,
    // `=== true` : colonne absente (migration pas encore appliquée) → faux,
    // donc aucune génération d'avatar facturée sans que l'utilisateur l'ait
    // demandé. Même politique que `voiceEnabled`.
    jumeauAvatar: o.jumeauAvatar === true,

    // ── L'identité constante ─────────────────────────────────────────────
    cardGradientStart: sanitizeHexColor(o.cardGradientStart, DEFAULT_BRANDING.cardGradientStart),
    cardGradientEnd: sanitizeHexColor(o.cardGradientEnd, DEFAULT_BRANDING.cardGradientEnd),
    titleColor: sanitizeHexColor(o.titleColor, DEFAULT_BRANDING.titleColor),
    // `=== true` et non un test de véracité : une colonne absente (migration
    // pas encore appliquée) vaut `undefined`, donc « pas de photo derrière les
    // cartes » — le défaut demandé, pas un accident de lecture.
    cardsShowPoster: o.cardsShowPoster === true,
    musicUrl: sanitizeUrl(o.musicUrl),
    // Pas de contrainte de forme sur l'identifiant : il vient du fournisseur,
    // et une liste fermée écrite ici rejetterait toute voix future. Seule la
    // longueur est bornée, contre une valeur aberrante.
    voiceId: typeof o.voiceId === 'string' && o.voiceId.trim()
      ? o.voiceId.trim().slice(0, 120)
      : null,
    keepRushAudio: o.keepRushAudio === true,
    musicVolume: sanitizeVolume(o.musicVolume, DEFAULT_VOLUMES.music),
    voiceVolume: sanitizeVolume(o.voiceVolume, DEFAULT_VOLUMES.voice),
    rushVolume: sanitizeVolume(o.rushVolume, DEFAULT_VOLUMES.rush),
    // Polices restreintes au catalogue, echelles et positions bornees, icones
    // restreintes aux noms lucide connus — voir `textStyle.ts`.
    designStyle: sanitizeDesignStyle(o.designStyle),
    // Memes regles que la banque de rushes : http(s), dedoublonnee, bornee.
    posterUrls: Array.isArray(o.posterUrls)
      ? Array.from(new Set(
        o.posterUrls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)),
      )).slice(0, 50)
      : [],
    // Un mode inconnu vaut `auto` : c'est le seul repli qui produise
    // toujours une affiche.
    posterMode: POSTER_MODES.includes(o.posterMode as AutopilotPosterMode)
      ? (o.posterMode as AutopilotPosterMode)
      : 'auto',
    // Chaines rognees, bornees a 300 caracteres, cles vides absentes ;
    // colonne absente ou valeur illisible → `{}`, aucun changement de texte.
    brief: sanitizeBrief(o.brief),
  };
}
