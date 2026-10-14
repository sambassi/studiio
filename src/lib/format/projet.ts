/**
 * PROJECT_VIDEO_FORMAT — source unique du format d'un projet vidéo.
 *
 * Contrat : `docs/product-contracts/video-generation.md` (C-FORMAT).
 * Tests : `src/__tests__/contracts/format.contract.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le format d'un projet vivait à quatre endroits qui ne disaient pas la même
 * chose : la colonne `scheduled_posts.format` (« reel » | « tv », deux
 * ratios seulement), `metadata.videoSize` (dimensions réelles, écrit par
 * Créer et l'Autopilote mais pas par le montage de rushes),
 * `metadata.format` (écrit par le montage de rushes seul) et une table de
 * dimensions recopiée dans l'assistant. Résultat observé : un montage de
 * rushes 16:9 était posté sans format (défaut « reel ») ni dimensions, et le
 * Calendrier le jouait dans un cadre 9:16.
 *
 * Ici : UN type, UNE table de dimensions (celle de `designSpec`), UNE façon
 * d'écrire le format dans un post (`metadataFormat`) et UNE façon de le
 * relire (`formatDuPost`).
 *
 * ⚠️ FACTURATION INCHANGÉE. `formatRenduFacturation` reproduit exactement la
 * valeur que Créer envoie aujourd'hui au serveur de rendu : 9:16 → « reel »,
 * tout le reste (carré compris) → « tv ».
 */
import { VIDEO_SIZE } from '@/lib/creer/designSpec';

export type ProjectVideoFormat = '9:16' | '1:1' | '16:9';

/** Les trois formats, dans l'ordre d'affichage historique. */
export const PROJECT_VIDEO_FORMATS: readonly ProjectVideoFormat[] = Object.freeze(['9:16', '1:1', '16:9']);

/** Le vertical, celui des réseaux — défaut de Créer et de l'Autopilote. */
export const PROJECT_VIDEO_FORMAT_DEFAUT: ProjectVideoFormat = '9:16';

export type FormatRendu = 'reel' | 'tv';

export interface Dimensions { w: number; h: number }

/** Ce qu'un post peut porter, lu défensivement (`metadata` est du jsonb). */
export interface PostAvecFormat {
  format?: string | null;
  metadata?: unknown;
}

export function estFormatProjet(v: unknown): v is ProjectVideoFormat {
  return v === '9:16' || v === '1:1' || v === '16:9';
}

/** Dimensions natives d'un format — la table de `designSpec`, jamais une copie. */
export function dimensionsDuFormat(f: ProjectVideoFormat): Dimensions {
  const { w, h } = VIDEO_SIZE[f];
  return { w, h };
}

/**
 * Valeur « reel » | « tv » : colonne `scheduled_posts.format` et format envoyé
 * au serveur de rendu (qui choisit le tarif). Le carré part en « tv », comme
 * Créer le fait depuis toujours — ne pas changer sans décision de facturation.
 */
export function formatRenduFacturation(f: ProjectVideoFormat): FormatRendu {
  return f === '9:16' ? 'reel' : 'tv';
}

const dimensionsValides = (v: unknown): v is Dimensions => typeof v === 'object' && v !== null
  && typeof (v as Dimensions).w === 'number' && typeof (v as Dimensions).h === 'number'
  && Number.isFinite((v as Dimensions).w) && Number.isFinite((v as Dimensions).h)
  && (v as Dimensions).w > 0 && (v as Dimensions).h > 0;

/**
 * Format le plus proche de dimensions réelles (écart de ratio logarithmique).
 * Un montage de rushes peut sortir en 720x1280 ou 1080x1350 : il reçoit le
 * format le plus proche, et garde ses dimensions exactes dans `videoSize`.
 */
export function formatDepuisDimensions(w: number, h: number): ProjectVideoFormat | null {
  if (!dimensionsValides({ w, h })) return null;
  const r = Math.log(w / h);
  let meilleur: ProjectVideoFormat = PROJECT_VIDEO_FORMAT_DEFAUT;
  let ecart = Infinity;
  for (const f of PROJECT_VIDEO_FORMATS) {
    const d = dimensionsDuFormat(f);
    const e = Math.abs(r - Math.log(d.w / d.h));
    if (e < ecart) { ecart = e; meilleur = f; }
  }
  return meilleur;
}

/**
 * Les champs à écrire dans `metadata` pour un projet de ce format.
 *
 * `videoSize` = dimensions natives du format, sauf si l'appelant connaît les
 * dimensions RÉELLES du fichier (montage de rushes) : elles font alors foi
 * pour le cadre du lecteur.
 *
 * `format` (« reel » | « tv ») est aussi écrit dans `metadata` : la
 * Bibliothèque le relit pour les posts.
 */
export function metadataFormat(
  f: ProjectVideoFormat,
  dimensionsReelles?: Dimensions | null,
): { videoFormat: ProjectVideoFormat; videoSize: Dimensions; format: FormatRendu } {
  const videoSize = dimensionsValides(dimensionsReelles)
    ? { w: dimensionsReelles.w, h: dimensionsReelles.h }
    : dimensionsDuFormat(f);
  return { videoFormat: f, videoSize, format: formatRenduFacturation(f) };
}

const formatLegacy = (v: unknown): ProjectVideoFormat | null => {
  if (v === 'reel') return '9:16';
  if (v === 'tv') return '16:9';
  return null;
};

const metaDe = (post: PostAvecFormat | null | undefined): Record<string, unknown> => {
  const m = post?.metadata;
  return typeof m === 'object' && m !== null && !Array.isArray(m) ? m as Record<string, unknown> : {};
};

/**
 * Format qu'un post DIT porter, ou `null` s'il ne dit rien.
 *
 * Priorité : `metadata.videoFormat` > ratio de `metadata.videoSize` >
 * `metadata.format` (seul champ des anciens montages de rushes, dont la
 * colonne valait « reel » par défaut) > colonne `post.format` > rien.
 */
export function formatExpliciteDuPost(post: PostAvecFormat | null | undefined): ProjectVideoFormat | null {
  const meta = metaDe(post);
  if (estFormatProjet(meta.videoFormat)) return meta.videoFormat;
  if (dimensionsValides(meta.videoSize)) return formatDepuisDimensions(meta.videoSize.w, meta.videoSize.h);
  return formatLegacy(meta.format) ?? formatLegacy(post?.format);
}

/** Format d'un post, avec le défaut voulu quand le post ne dit rien. */
export function formatDuPost(
  post: PostAvecFormat | null | undefined,
  defaut: ProjectVideoFormat = PROJECT_VIDEO_FORMAT_DEFAUT,
): ProjectVideoFormat {
  return formatExpliciteDuPost(post) ?? defaut;
}

/**
 * Dimensions à utiliser pour un post (cadre du lecteur, recomposition).
 *
 * `metadata.videoSize` fait foi — ce sont les dimensions réelles — sauf s'il
 * contredit `metadata.videoFormat` (format changé, dimensions périmées) :
 * on prend alors celles du format.
 */
export function dimensionsDuPost(
  post: PostAvecFormat | null | undefined,
  defaut: ProjectVideoFormat = PROJECT_VIDEO_FORMAT_DEFAUT,
): Dimensions {
  const meta = metaDe(post);
  const f = formatDuPost(post, defaut);
  if (dimensionsValides(meta.videoSize)
    && formatDepuisDimensions(meta.videoSize.w, meta.videoSize.h) === f) {
    return { w: meta.videoSize.w, h: meta.videoSize.h };
  }
  return dimensionsDuFormat(f);
}

/** Valeur CSS `aspect-ratio` d'un format : '9 / 16', '1 / 1', '16 / 9'. */
export function ratioCss(f: ProjectVideoFormat): string {
  const [a, b] = f.split(':');
  return `${a} / ${b}`;
}
