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
