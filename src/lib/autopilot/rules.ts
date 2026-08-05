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
  /** Dernier passage réellement effectué, ISO. */
  lastRunAt: string | null;
  /** Dernier rush utilisé — pour ne pas le reprendre deux fois de suite. */
  lastRushUrl: string | null;
  /**
   * Narration IA sur les montages produits.
   *
   * ⚠️ FAUX PAR DÉFAUT, ET CE N'EST PAS UNE PRUDENCE DE PRINCIPE. La voix
   * passe par ElevenLabs, facturé à l'usage : l'activer d'office ferait payer
   * une narration que personne n'a demandée, sur chaque montage, sans que
   * l'utilisateur ait rien changé.
   */
  voiceEnabled: boolean;
}

export const DEFAULT_CONFIG: AutopilotConfig = {
  enabled: false,
  mode: 'review',
  cadence: 'weekly',
  countPerCycle: 1,
  platforms: [],
  creditFloor: DEFAULT_CREDIT_FLOOR,
  rushUrls: [],
  lastRunAt: null,
  lastRushUrl: null,
  voiceEnabled: false,
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
 * image, c'est exactement ce que la banque de rushes existe pour éviter. Avec
 * un seul rush, on le reprend — mieux vaut le même qu'aucun.
 */
export function pickRush(
  rushUrls: string[],
  lastRushUrl: string | null | undefined,
  index = 0,
): string | null {
  const propres = rushUrls.filter((u) => typeof u === 'string' && u);
  if (propres.length === 0) return null;
  if (propres.length === 1) return propres[0];
  const depart = lastRushUrl ? propres.indexOf(lastRushUrl) : -1;
  // Le suivant de celui d'avant, puis on avance d'un cran par montage du cycle.
  return propres[(depart + 1 + index) % propres.length];
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
    lastRunAt: typeof o.lastRunAt === 'string' ? o.lastRunAt : null,
    lastRushUrl: typeof o.lastRushUrl === 'string' ? o.lastRushUrl : null,
    // `=== true` et non un test de véracité : une colonne absente (migration
    // pas encore appliquée) vaut `undefined`, donc « pas de voix », donc
    // aucun appel facturé.
    voiceEnabled: o.voiceEnabled === true,
  };
}
