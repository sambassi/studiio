/**
 * Miniature / couverture d'un post, et réglages TikTok — UN modèle, une
 * traduction par réseau.
 *
 * ⚠️ AUCUN CHAMP « thumbnail » NE MARCHE PARTOUT. Ce que Zernio accepte
 * réellement (docs.zernio.com, vérifié le 2026-10-08) :
 *
 * | Réseau          | Image fournie                         | Moment de la vidéo                    |
 * |-----------------|---------------------------------------|---------------------------------------|
 * | Instagram Reel  | `platformSpecificData.instagramThumbnail` | `platformSpecificData.thumbOffset` (ms) |
 * | TikTok          | `tiktokSettings.video_cover_image_url`    | `tiktokSettings.video_cover_timestamp_ms` |
 * | Facebook        | `mediaItems[].thumbnail` (guide médias)   | — → image EXTRAITE par Studiio        |
 * | YouTube vidéo   | `mediaItems[].thumbnail` (≤ 2 Mo)         | — → image EXTRAITE par Studiio        |
 * | YouTube Short   | non pris en charge par l'API              | non pris en charge                    |
 *
 * ⚠️ ABSENCE DE COUVERTURE = COMPORTEMENT D'AVANT, au champ près : aucun
 * réglage n'est ajouté à la requête (sauf TikTok, dont les réglages sont
 * obligatoires chez Zernio et ne dépendent pas de la miniature).
 *
 * Pur : utilisable par l'écran (résumé par réseau) et par le serveur.
 */

export type ModeCouverture = 'auto' | 'frame' | 'upload';
export type ReseauCouverture = 'instagram' | 'facebook' | 'tiktok' | 'youtube';

export interface Couverture {
  mode: ModeCouverture;
  /** Moment choisi dans la vidéo, en millisecondes (mode `frame`). */
  frameMs?: number;
  /** Image fournie, URL publique absolue ou relative du stockage (mode `upload`). */
  imageUrl?: string;
}

/** Couverture lue d'une métadonnée de post — `null` si absente ou incohérente. */
export function lireCouverture(meta: unknown): Couverture | null {
  const c = (meta as { cover?: unknown } | null | undefined)?.cover as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return null;
  if (c.mode === 'frame' && typeof c.frameMs === 'number' && Number.isFinite(c.frameMs) && c.frameMs >= 0) {
    return { mode: 'frame', frameMs: Math.round(c.frameMs) };
  }
  if (c.mode === 'upload' && typeof c.imageUrl === 'string' && /^(https?:\/\/|\/)/.test(c.imageUrl)) {
    return { mode: 'upload', imageUrl: c.imageUrl };
  }
  if (c.mode === 'auto') return { mode: 'auto' };
  return null;
}

/** Un format vertical (Studiio `reel`, 9:16) part en Short sur YouTube. */
export function estShortYoutube(format: string | null | undefined): boolean {
  return format === 'reel' || format === '9:16';
}

// ── TikTok ───────────────────────────────────────────────────────────────

/** Valeurs de confidentialité TikTok (docs Zernio). */
export const CONFIDENTIALITES_TIKTOK = [
  'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY',
] as const;
export type ConfidentialiteTiktok = typeof CONFIDENTIALITES_TIKTOK[number];

/** Repli de sécurité quand les niveaux autorisés du compte sont inconnus. */
export const CONFIDENTIALITE_SECURITE: ConfidentialiteTiktok = 'SELF_ONLY';

export const LIBELLES_CONFIDENTIALITE: Record<ConfidentialiteTiktok, string> = {
  PUBLIC_TO_EVERYONE: 'Public',
  MUTUAL_FOLLOW_FRIENDS: 'Amis',
  FOLLOWER_OF_CREATOR: 'Abonnés',
  SELF_ONLY: 'Moi uniquement',
};

export interface ReglagesTiktok {
  privacy_level: ConfidentialiteTiktok;
  allow_comment: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  /**
   * ⚠️ LA CASE COCHÉE PAR L'UTILISATEUR, ET RIEN D'AUTRE. Elle seule pilote
   * `content_preview_confirmed` et `express_consent_given` : aucune valeur
   * par défaut ne peut la mettre à `true`.
   */
  consentement: boolean;
}

/** Réglages TikTok lus d'une métadonnée — `null` si absents ou incomplets. */
export function lireReglagesTiktok(meta: unknown): ReglagesTiktok | null {
  const t = (meta as { tiktok?: unknown } | null | undefined)?.tiktok as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object') return null;
  if (!(CONFIDENTIALITES_TIKTOK as readonly string[]).includes(String(t.privacy_level))) return null;
  if (typeof t.allow_comment !== 'boolean' || typeof t.allow_duet !== 'boolean' || typeof t.allow_stitch !== 'boolean') return null;
  return {
    privacy_level: t.privacy_level as ConfidentialiteTiktok,
    allow_comment: t.allow_comment,
    allow_duet: t.allow_duet,
    allow_stitch: t.allow_stitch,
    consentement: t.consentement === true,
  };
}

/** TikTok peut-il partir ? Sinon, le motif à afficher — AVANT tout appel au fournisseur. */
export function validerTiktok(r: ReglagesTiktok | null): { ok: true } | { ok: false; motif: string } {
  if (!r) {
    return { ok: false, motif: 'TikTok : réglages de publication manquants — ouvrez le post et complétez les réglages TikTok.' };
  }
  if (!r.consentement) {
    return { ok: false, motif: 'TikTok : cochez « Je confirme avoir vérifié ce contenu et j’accepte sa publication sur TikTok ».' };
  }
  return { ok: true };
}

// ── Traduction par réseau ────────────────────────────────────────────────

export interface PlanCouverture {
  reseau: ReseauCouverture;
  /** Ce qui sera réellement appliqué. */
  applique: 'auto' | 'image' | 'moment' | 'image-extraite';
  /** À fusionner dans `platforms[].platformSpecificData` (hors TikTok, voir `tiktokSettings`). */
  platformSpecificData?: Record<string, unknown>;
  /** Réglages de couverture à fusionner dans `tiktokSettings`. */
  tiktokCouverture?: Record<string, unknown>;
  /** Image à poser sur `mediaItems[].thumbnail` (Facebook, YouTube). */
  miniatureMedia?: string;
  /** Repli utilisé, en clair — `null` si la couverture choisie est appliquée. */
  repli: string | null;
}

/**
 * Traduit la couverture pour UN réseau.
 *
 * `imageExtraite` : l'image tirée de la vidéo au moment choisi, pour les
 * réseaux qui n'acceptent pas de moment (Facebook, YouTube). Absente en mode
 * `frame` → repli automatique, dit en clair.
 */
export function reglagesCouverture(
  reseau: ReseauCouverture,
  cover: Couverture | null,
  ctx: { format?: string | null; imageExtraite?: string | null } = {},
): PlanCouverture {
  const auto = (repli: string | null = null): PlanCouverture => ({ reseau, applique: 'auto', repli });
  if (!cover || cover.mode === 'auto') return auto();

  switch (reseau) {
    case 'instagram':
      return cover.mode === 'upload'
        ? { reseau, applique: 'image', platformSpecificData: { instagramThumbnail: cover.imageUrl }, repli: null }
        : { reseau, applique: 'moment', platformSpecificData: { thumbOffset: cover.frameMs }, repli: null };
    case 'tiktok':
      return cover.mode === 'upload'
        ? { reseau, applique: 'image', tiktokCouverture: { video_cover_image_url: cover.imageUrl }, repli: null }
        : { reseau, applique: 'moment', tiktokCouverture: { video_cover_timestamp_ms: cover.frameMs }, repli: null };
    case 'youtube':
      if (estShortYoutube(ctx.format)) {
        return auto('YouTube Shorts ne prend pas de miniature personnalisée : YouTube la choisit automatiquement.');
      }
      // fallthrough : même mécanisme que Facebook
    case 'facebook': {
      if (cover.mode === 'upload') return { reseau, applique: 'image', miniatureMedia: cover.imageUrl, repli: null };
      if (ctx.imageExtraite) return { reseau, applique: 'image-extraite', miniatureMedia: ctx.imageExtraite, repli: null };
      return auto('Image de la vidéo non extraite : couverture choisie automatiquement par le réseau.');
    }
    default:
      return auto();
  }
}

/**
 * Le réglage `tiktokSettings` complet : obligatoires + couverture éventuelle.
 * À n'appeler qu'après `validerTiktok(r).ok`.
 */
export function tiktokSettings(r: ReglagesTiktok, plan: PlanCouverture | null): Record<string, unknown> {
  return {
    privacy_level: r.privacy_level,
    allow_comment: r.allow_comment,
    allow_duet: r.allow_duet,
    allow_stitch: r.allow_stitch,
    content_preview_confirmed: r.consentement,
    express_consent_given: r.consentement,
    ...(plan?.tiktokCouverture ?? {}),
  };
}

/** Résumé par réseau, pour l'écran — sans jargon. */
export function resumeCouverture(
  reseau: ReseauCouverture,
  cover: Couverture | null,
  format: string | null | undefined,
): string {
  const nom = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: estShortYoutube(format) ? 'YouTube Short' : 'YouTube' }[reseau];
  if (!cover || cover.mode === 'auto') return `${nom} : couverture choisie automatiquement`;
  if (reseau === 'youtube' && estShortYoutube(format)) return `${nom} : couverture choisie automatiquement par YouTube`;
  if (cover.mode === 'upload') return `${nom} : votre image`;
  if (reseau === 'facebook' || reseau === 'youtube') return `${nom} : image extraite de la vidéo`;
  return `${nom} : moment choisi dans la vidéo`;
}

/** Réseaux pour lesquels l'image extraite de la vidéo est nécessaire. */
export function besoinImageExtraite(
  reseaux: readonly ReseauCouverture[],
  cover: Couverture | null,
  format: string | null | undefined,
): boolean {
  if (cover?.mode !== 'frame') return false;
  return reseaux.some((r) => r === 'facebook' || (r === 'youtube' && !estShortYoutube(format)));
}
