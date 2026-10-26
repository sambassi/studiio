/**
 * MP4 DURABLE d'un rendu confirmé — les décisions, sans aucune E/S.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le compositeur navigateur produit un WebM, déposé à la clé attribuée par
 * le serveur (`<userId>/rendus/<uuid>.webm`) puis confirmé. Ce fichier ne
 * devenait JAMAIS un MP4 stocké : le Calendrier, l'export et la publication
 * reconvertissaient à la volée, et le menu « Télécharger » natif livrait le
 * WebM tel quel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE GARANTIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  - Le MP4 vit À CÔTÉ du WebM, sous le même compte : `<id>.mp4`. Seule une
 *    clé de rendu exacte (`<uid>/rendus/<uuid>.webm`) en a une ; tout autre
 *    chemin n'est jamais transcodé ici.
 *  - Un fichier n'est déclaré MP4 que sur preuve de son contenu (boîte
 *    `ftyp`), jamais sur son nom : on ne renomme JAMAIS un WebM en `.mp4`.
 *  - Le post n'est mis à jour que s'il pointe ENCORE sur ce WebM : un
 *    nouveau rendu arrivé entre-temps n'est jamais écrasé par l'ancien.
 *  - En cas d'échec, le WebM reste la vidéo du post, et c'est signalé
 *    (`mp4Indisponible`) — jamais en silence.
 *
 * Posts antérieurs : aucun champ n'est ajouté tant que la route n'est pas
 * appelée pour eux. Comportement d'avant inchangé.
 */

/** Clé d'un rendu navigateur : `<uid>/rendus/<uuid>.webm`, et rien d'autre. */
const CLE_RENDU_WEBM = /^([^/]+)\/rendus\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webm$/i;

/** Plancher d'un MP4 plausible (même seuil que `/api/convert/to-mp4`). */
export const TAILLE_MIN_MP4 = 1024;

/**
 * La clé du MP4 qui accompagne ce rendu, ou `null` s'il n'en a pas.
 *
 * Le compte est revérifié : la clé doit commencer par `<userId>/`. Un rendu
 * qui ne serait pas un WebM (déjà MP4, ou autre) n'a pas de jumeau MP4.
 */
export function cleMp4DuRendu(cleWebm: unknown, userId: unknown): string | null {
  if (typeof cleWebm !== 'string' || typeof userId !== 'string' || !userId) return null;
  if (cleWebm.includes('..')) return null;
  const m = CLE_RENDU_WEBM.exec(cleWebm);
  if (!m || m[1] !== userId) return null;
  return `${m[1]}/rendus/${m[2]}.mp4`;
}

/** Le post porte-t-il un MP4 durable (conversion du rendu confirmé) ? */
export function aUnMp4Durable(metadata: unknown): boolean {
  if (typeof metadata !== 'object' || metadata === null) return false;
  const m = metadata as Record<string, unknown>;
  // Le drapeau ne vaut que si la vidéo EST encore ce MP4 : une régénération
  // ultérieure (nouveau WebM) le rend caduc sans avoir à l'effacer.
  return m.mp4Durable === true && typeof m.renderedVideoUrl === 'string'
    && /\.mp4$/i.test(m.renderedVideoUrl.split('?')[0]);
}

/** L'identifiant de rendu porté par une clé de rendu WebM, ou `null`. */
export function idRenduDeCle(cleWebm: unknown, userId: unknown): string | null {
  if (typeof cleWebm !== 'string' || typeof userId !== 'string' || !userId) return null;
  const m = CLE_RENDU_WEBM.exec(cleWebm);
  return m && m[1] === userId ? m[2].toLowerCase() : null;
}

/**
 * Le contenu est-il un MP4 (ISO BMFF) ? Preuve par les octets : la boîte
 * `ftyp` en position 4. Un WebM commence par `1A 45 DF A3` (EBML) et échoue.
 */
export function estContenuMp4(octets: Uint8Array | null | undefined): boolean {
  if (!octets || octets.length < TAILLE_MIN_MP4) return false;
  return octets[4] === 0x66 && octets[5] === 0x74 && octets[6] === 0x79 && octets[7] === 0x70;
}

/** Le stockage durable d'un MP4 : seulement si clé ET contenu le prouvent. */
export function decisionStockageMp4(params: {
  cleWebm: unknown;
  userId: unknown;
  sortie: Uint8Array | null | undefined;
}): { stocker: true; cleMp4: string } | { stocker: false; motif: 'non_applicable' | 'sortie_invalide' } {
  const cleMp4 = cleMp4DuRendu(params.cleWebm, params.userId);
  if (!cleMp4) return { stocker: false, motif: 'non_applicable' };
  if (!estContenuMp4(params.sortie)) return { stocker: false, motif: 'sortie_invalide' };
  return { stocker: true, cleMp4 };
}

type Meta = Record<string, unknown>;

function enObjet(v: unknown): Meta {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Meta) : {};
}

/**
 * Ce qu'il faut écrire sur le post une fois le MP4 stocké — ou `null` si le
 * post ne pointe plus sur ce WebM (nouveau rendu, post modifié) : on ne
 * touche alors à rien.
 *
 * `mp4Durable: true` — et SURTOUT PAS `serverRendered` : ce dernier désigne
 * un montage RENDU par le serveur (Autopilote), que le Calendrier interdit de
 * régénérer. Un post Créer reste régénérable ; son MP4 durable est seulement
 * une conversion fidèle du WebM confirmé. L'export Bureau le télécharge tel
 * quel (`decisionExportBureau`), la publication le prend comme tout `.mp4`.
 */
export function patchPostAvecMp4(
  post: { media_url?: unknown; metadata?: unknown },
  urls: { webmUrl: string; mp4Url: string },
  /** Contrôle qualité du MP4 (`controle-qualite-mp4.ts`) : écrit tel quel, ses avertissements s'ajoutent à ceux du post. */
  controle?: { resultat: unknown; avertissements: string[] } | null,
): { media_url?: string; metadata: Meta } | null {
  const meta = enObjet(post.metadata);
  if (meta.renderedVideoUrl !== urls.webmUrl) return null;
  if (!urls.mp4Url || !/\.mp4$/i.test(urls.mp4Url.split('?')[0])) return null;
  const metadata: Meta = {
    ...meta,
    renderedVideoUrl: urls.mp4Url,
    // Le WebM d'origine reste nommé : c'est la preuve confirmée du rendu.
    renderedWebmUrl: urls.webmUrl,
    mp4Durable: true,
    mp4Indisponible: false,
  };
  if (meta.videoUrl === urls.webmUrl) metadata.videoUrl = urls.mp4Url;
  if (controle) {
    metadata.controleQualiteMp4 = controle.resultat;
    // Le Calendrier lit `avertissements` : même endroit que l'Autopilote, sans doublon.
    const deja = Array.isArray(meta.avertissements) ? meta.avertissements.filter((a): a is string => typeof a === 'string') : [];
    const tous = [...deja, ...controle.avertissements.filter((a) => !deja.includes(a))];
    if (tous.length) metadata.avertissements = tous;
  }
  return post.media_url === urls.webmUrl
    ? { media_url: urls.mp4Url, metadata }
    : { metadata };
}

/**
 * Échec de la production du MP4 : le WebM reste la vidéo du post, et c'est
 * DIT. `null` si le post ne pointe plus sur ce WebM.
 */
export function patchPostEchecMp4(
  post: { metadata?: unknown },
  webmUrl: string,
  motif: string,
): { metadata: Meta } | null {
  const meta = enObjet(post.metadata);
  if (meta.renderedVideoUrl !== webmUrl) return null;
  return { metadata: { ...meta, mp4Indisponible: true, mp4Motif: motif.slice(0, 80) } };
}
