/**
 * Autopilote MULTI-SOURCES — le contrat commun de l'écran et du moteur.
 *
 * ⚠️ DES SOURCES, PAS DES PARCOURS. Rushes personnels, avatar, médias stock
 * (vidéos Pexels importées, photos Pexels/Unsplash choisies) sont des sources
 * INDÉPENDANTES et COMBINABLES d'un même Autopilote. Le moteur reçoit un plan
 * de montage multi-sources (`planMultiSources`) ; il ne choisit jamais un mode
 * exclusif « avatar seul » OU « rushes seuls ».
 *
 * ⚠️ AUCUNE MIGRATION. La configuration vit dans `autopilot_config.design_style`
 * (jsonb existant), clé `sources`, nettoyée par `sanitizeDesignStyle`.
 *
 * ⚠️ RÉTRO-COMPATIBLE. Clé absente → `sourcesParDefaut(config)` : rushes ON,
 * avatar = l'ancien `jumeauAvatar`, stock OFF — exactement le comportement
 * d'avant.
 *
 * ⚠️ STOCK EN PRODUCTION = MÉDIAS DÉJÀ CHOISIS. Le cron n'interroge jamais
 * Pexels/Unsplash : il n'utilise que les médias que l'utilisateur a retenus à
 * l'écran (les règles Unsplash interdisent l'usage automatisé).
 */

export interface SourcesActives {
  /** Mes rushes personnels (la banque `rush_urls`, hors médias stock importés). */
  rushes: boolean;
  /** Mon avatar (le jumeau ; `jumeau_avatar` reste la colonne de vérité). */
  avatar: boolean;
  /** Compléter avec Pexels / Unsplash (médias retenus ci-dessous). */
  stock: boolean;
}

export type FournisseurStockRetenu = 'pexels' | 'unsplash';

/** Un média stock RETENU par l'utilisateur (jamais cherché par le cron). */
export interface MediaStockRetenu {
  /** Vidéo : URL de stockage Studiio (importée) ; photo : URL fournisseur (hotlink exigé par Unsplash). */
  url: string;
  type: 'video' | 'photo';
  provider: FournisseurStockRetenu;
  providerAssetId: string;
  auteur: string;
  sourceUrl: string;
  licence: string;
  vignetteUrl: string;
}

/** Ce qu'un créneau du plan doit montrer. `auto` : l'orchestrateur choisit. */
export type TypeCreneau = 'auto' | 'avatar' | 'rush' | 'stock';

/**
 * Le gabarit du plan, édité AVANT génération : l'ordre et la nature des plans
 * de la séquence Vidéo. Chaque montage le remplit avec ses médias réels ; un
 * `media` forcé (URL) est repris tel quel s'il est encore disponible.
 */
export interface CreneauGabarit {
  id: string;
  type: TypeCreneau;
  media?: string;
}

export interface ConfigSources {
  actives: SourcesActives;
  stock: MediaStockRetenu[];
  /** Vide = l'orchestrateur décide seul (alternance avatar / rushes / stock). */
  gabarit: CreneauGabarit[];
}

export const MAX_STOCK_RETENU = 24;
export const MAX_CRENEAUX = 12;

/** Le comportement d'AVANT, pour une configuration sans clé `sources`. */
export function sourcesParDefaut(jumeauAvatar: boolean): ConfigSources {
  return { actives: { rushes: true, avatar: !!jumeauAvatar, stock: false }, stock: [], gabarit: [] };
}

const estUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v) && v.length <= 2048;
const texte = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Nettoyage strict (corps client et lecture en base) — jamais d'exception. */
export function normaliserConfigSources(brut: unknown): ConfigSources | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  const a = (o.actives && typeof o.actives === 'object' ? o.actives : {}) as Record<string, unknown>;
  const actives: SourcesActives = { rushes: a.rushes !== false, avatar: a.avatar === true, stock: a.stock === true };
  const stock: MediaStockRetenu[] = [];
  for (const m of Array.isArray(o.stock) ? o.stock : []) {
    const x = m as Record<string, unknown>;
    if (!estUrl(x?.url) || (x.type !== 'video' && x.type !== 'photo') || (x.provider !== 'pexels' && x.provider !== 'unsplash')) continue;
    // Garde SSRF : seules nos vidéos stockées et les photos des CDN stock passent.
    if (!urlStockAutorisee(x.url, x.type)) continue;
    // Unsplash ne fournit que des photos.
    if (x.provider === 'unsplash' && x.type !== 'photo') continue;
    if (stock.some((s) => s.url === x.url)) continue;
    stock.push({
      url: x.url, type: x.type, provider: x.provider,
      providerAssetId: texte(x.providerAssetId, 64), auteur: texte(x.auteur), sourceUrl: estUrl(x.sourceUrl) ? x.sourceUrl : '',
      licence: texte(x.licence, 60), vignetteUrl: estUrl(x.vignetteUrl) ? x.vignetteUrl : '',
    });
    if (stock.length >= MAX_STOCK_RETENU) break;
  }
  const gabarit: CreneauGabarit[] = [];
  for (const c of Array.isArray(o.gabarit) ? o.gabarit : []) {
    const x = c as Record<string, unknown>;
    if (!['auto', 'avatar', 'rush', 'stock'].includes(String(x?.type))) continue;
    gabarit.push({ id: texte(x.id, 40) || `c${gabarit.length + 1}`, type: x.type as TypeCreneau, ...(estUrl(x.media) ? { media: x.media } : {}) });
    if (gabarit.length >= MAX_CRENEAUX) break;
  }
  return { actives, stock, gabarit };
}

/** Le fichier d'un média stock importé dans la Médiathèque (`/api/stock/importer`). */
export function estRushStock(url: string): boolean {
  return /\/stock-(pexels|unsplash)-(video|photo)-[A-Za-z0-9_-]+\.(mp4|jpg)(\?|$)/.test(url);
}

/** Hôtes des PHOTOS stock acceptées (hotlink exigé par Unsplash ; CDN Pexels). */
export const HOTES_PHOTOS_STOCK = ['images.pexels.com', 'images.unsplash.com', 'plus.unsplash.com'] as const;

/**
 * ⚠️ GARDE SSRF. Le serveur SONDE (HEAD) puis le moteur de rendu TÉLÉCHARGE les
 * médias stock retenus : une URL libre ferait contacter n'importe quelle
 * adresse (réseau interne compris) au nom du serveur. Seules passent :
 *   - une VIDÉO rangée dans NOTRE stockage (`…/storage/v1/object/public/media/…`,
 *     ce qu'écrit `/api/stock/importer`) ;
 *   - une PHOTO https sur un hôte Pexels/Unsplash connu.
 * Appliquée à l'enregistrement (`normaliserConfigSources`) ET juste avant la
 * sonde (`produire.ts`).
 */
export function urlStockAutorisee(url: unknown, type: 'video' | 'photo'): url is string {
  if (typeof url !== 'string') return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.username || u.password) return false;
  if (type === 'photo') return u.protocol === 'https:' && (HOTES_PHOTOS_STOCK as readonly string[]).includes(u.hostname);
  return (u.protocol === 'https:' || u.protocol === 'http:')
    && /^\/storage\/v1\/object\/public\/media\/[^?#]+$/.test(u.pathname)
    && !/\.\./.test(u.pathname)
    && estHoteStockageStudiio(u.hostname);
}

/** Le stockage public de Studiio : le domaine de l'application (et ses alias connus). */
function estHoteStockageStudiio(hote: string): boolean {
  // Jamais une adresse locale ou privée, même si l'application tourne en local.
  if (estHotePrive(hote)) return false;
  const app = (() => { try { return process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).hostname : null; } catch { return null; } })();
  return hote === 'studiio.pro' || hote === 'www.studiio.pro' || (!!app && hote === app);
}

/** Boucle locale, réseaux privés, lien local, nom sans domaine (service Docker interne). */
function estHotePrive(hote: string): boolean {
  const h = hote.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 10 || x === 127 || x === 0 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
}

export interface EtatSourcesVisuelles {
  rushesPersonnels: number;
  avatarActif: boolean;
  avatarPret: boolean;
  bibliotheque: number;
  stockRetenus: number;
}

/**
 * LA règle de validation — plus de « au moins un rush » global :
 * la vidéo est possible s'il existe AU MOINS UNE source visuelle exploitable.
 */
export function aUneSourceVisuelle(e: EtatSourcesVisuelles): boolean {
  return e.rushesPersonnels > 0 || (e.avatarActif && e.avatarPret) || e.bibliotheque > 0 || e.stockRetenus > 0;
}

/** Répartition des sources configurées (pour le résumé « Médias prévus »). */
export function compterSources(rushUrls: readonly string[], c: ConfigSources) {
  const perso = c.actives.rushes ? rushUrls.filter((u) => !estRushStock(u)) : [];
  const stockActif = c.actives.stock ? c.stock : [];
  const videosImportees = c.actives.stock ? rushUrls.filter(estRushStock) : [];
  return {
    rushesPersonnels: perso.length,
    pexelsVideos: stockActif.filter((m) => m.provider === 'pexels' && m.type === 'video').length
      + videosImportees.filter((u) => !stockActif.some((m) => m.url === u)).length,
    pexelsPhotos: stockActif.filter((m) => m.provider === 'pexels' && m.type === 'photo').length,
    unsplashPhotos: stockActif.filter((m) => m.provider === 'unsplash').length,
  };
}

// ── Lecture SERVEUR des sources d'une configuration (moteur, cron, routes) ──

/** Le strict nécessaire d'une `AutopilotConfig` (sans dépendre de `rules.ts`). */
export interface ConfigPourSources {
  rushUrls: readonly string[];
  jumeauAvatar: boolean;
  designStyle?: { sources?: ConfigSources } | null;
}

/**
 * Les sources de la configuration : la clé `sources` si l'utilisateur l'a
 * réglée (`explicite`), sinon `sourcesParDefaut` — le comportement d'avant.
 */
export function sourcesEffectives(c: ConfigPourSources): { sources: ConfigSources; explicite: boolean } {
  const s = c.designStyle?.sources;
  return s ? { sources: s, explicite: true } : { sources: sourcesParDefaut(c.jumeauAvatar), explicite: false };
}

/**
 * L'avatar est-il monté ? `jumeau_avatar` reste la colonne de vérité ; la clé
 * `sources` peut seulement l'éteindre. Sans clé : `jumeauAvatar`, comme avant.
 */
export function avatarActifConfig(c: ConfigPourSources): boolean {
  return !!c.jumeauAvatar && (c.designStyle?.sources?.actives.avatar ?? true);
}

/**
 * Les médias réellement utilisables, source par source, `actives` respectés.
 * Sans clé `sources` : toute la banque compte comme rushes personnels — la
 * règle d'avant, à l'identique (aucun stock).
 */
export function mediasDesSources(c: ConfigPourSources): { rushesPersonnels: string[]; videosStock: string[]; photosStock: string[] } {
  const { sources, explicite } = sourcesEffectives(c);
  const banque = Array.from(new Set((c.rushUrls ?? []).filter((u) => typeof u === 'string' && u)));
  if (!explicite) return { rushesPersonnels: banque, videosStock: [], photosStock: [] };
  const rushesPersonnels = sources.actives.rushes ? banque.filter((u) => !estRushStock(u)) : [];
  if (!sources.actives.stock) return { rushesPersonnels, videosStock: [], photosStock: [] };
  const videosStock = Array.from(new Set([
    ...banque.filter(estRushStock),
    ...sources.stock.filter((m) => m.type === 'video').map((m) => m.url),
  ]));
  const photosStock = sources.stock.filter((m) => m.type === 'photo').map((m) => m.url).filter((u) => !videosStock.includes(u));
  return { rushesPersonnels, videosStock, photosStock };
}

/**
 * L'état des sources, calculé CÔTÉ SERVEUR depuis la configuration — jamais
 * cru du navigateur. `avatarPret` est supposé vrai : la disponibilité réelle
 * du jumeau est vérifiée plus tard par son propre chemin (lancement).
 */
export function etatSourcesServeur(c: ConfigPourSources): EtatSourcesVisuelles {
  const m = mediasDesSources(c);
  return {
    rushesPersonnels: m.rushesPersonnels.length,
    avatarActif: avatarActifConfig(c),
    avatarPret: true,
    bibliotheque: 0,
    stockRetenus: m.videosStock.length + m.photosStock.length,
  };
}
