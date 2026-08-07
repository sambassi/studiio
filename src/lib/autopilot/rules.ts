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

export type AutopilotMode = 'auto' | 'review';

export type AutopilotCadence = 'daily' | 'every_2_days' | 'weekly';

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
  auto: 'Les vidéos partent sur vos réseaux à l’heure prévue, sans intervention.',
  review: 'Les vidéos arrivent en brouillon dans le Calendrier. Rien ne part sans vous.',
};

/** Cadences et modes acceptés — la seule liste, pour l'écran comme pour la base. */
export const CADENCES: readonly AutopilotCadence[] = Object.freeze(['daily', 'every_2_days', 'weekly']);
export const MODES: readonly AutopilotMode[] = Object.freeze(['auto', 'review']);

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
  /** Fuseau dans lequel `runHour` se lit. */
  runTimezone: string;
  /**
   * Narration IA sur les montages produits.
   *
   * ⚠️ FAUX PAR DÉFAUT, ET CE N'EST PAS UNE PRUDENCE DE PRINCIPE. La voix
   * passe par ElevenLabs, facturé à l'usage : l'activer d'office ferait payer
   * une narration que personne n'a demandée, sur chaque montage, sans que
   * l'utilisateur ait rien changé.
   */
  voiceEnabled: boolean;

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
  voiceEnabled: false,
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
  | 'credits'
  | 'sans-rush';

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
  const quand = prochain.getTime() <= now ? 'au prochain passage' : formatDate(prochain);
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
    // `=== true` et non un test de véracité : une colonne absente (migration
    // pas encore appliquée) vaut `undefined`, donc « pas de voix », donc
    // aucun appel facturé.
    voiceEnabled: o.voiceEnabled === true,

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
  };
}
