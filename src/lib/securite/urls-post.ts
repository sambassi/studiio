/**
 * URLS D'UN POST DU CALENDRIER, À L'ÉCRITURE (`POST` / `PUT /api/posts`,
 * `PATCH /api/posts/[id]`).
 *
 * Certaines URLs d'un post sont plus tard LUES PAR LE SERVEUR (publication,
 * muxage, conversion, couverture) : `media_url`, `metadata.renderedVideoUrl`,
 * `metadata.videoUrl`… Le fetch sûr protège la lecture ; ce module refuse en
 * plus, dès l'écriture, ce qui ne peut être qu'une tentative : schéma autre que
 * http(s), identifiants (`user:pass@`), hôte local ou privé écrit en clair.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NEUTRALISER, PAS REFUSER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un champ refusé est RETIRÉ (et nommé dans `refusees`), la requête passe.
 * Même règle que la liste blanche de `PUT /api/posts` : le Calendrier renvoie
 * le post ENTIER à chaque enregistrement, y compris des valeurs anciennes ;
 * un 400 sur l'une d'elles rendrait le post impossible à déplacer. Retirée de
 * `metadata`, la clé n'écrase pas la valeur en base (fusion) ; retirée de
 * `media_url` en création, la colonne reste vide.
 *
 * Les lignes anciennes ne sont pas touchées : la validation vit à l'écriture,
 * la lecture est protégée par le fetch sûr.
 */
import { isIP } from 'net';
import { ipInterdite } from '@/lib/securite/fetch-sur';
import { originesStockageConfigurees } from '@/lib/storage/acces-objet';

/** Suffixes de noms de réseau interne. */
const SUFFIXES_INTERNES = /(^|\.)(localhost|local|internal|localdomain|lan|home|intranet|corp)$/i;

export interface OptionsUrlEcrivable {
  /** Accepter une image `data:image/…` (vignettes calculées dans le navigateur). */
  imageData?: boolean;
  origines?: readonly string[];
}

/**
 * Cette valeur peut-elle être ENREGISTRÉE dans un champ d'URL lu par le
 * serveur ? Pure (hors lecture de la configuration des origines).
 *
 * `null`, `undefined` et `''` : oui (champ vide). Chemin relatif `/…` : oui
 * (résolu contre l'application). Chaîne sans schéma : oui (inerte). Autre
 * schéma que http(s) (`blob:`, `file:`, `javascript:`…) : non. Origine de notre stockage : oui, même locale
 * (développement). Sinon : `http:`/`https:` bien formée, sans identifiants,
 * hôte nommé avec un point (un nom de service Docker n'en a pas), non interne,
 * IP littérale publique seulement.
 */
export function urlEcrivable(valeur: unknown, opts: OptionsUrlEcrivable = {}): boolean {
  if (valeur === null || valeur === undefined || valeur === '') return true;
  if (typeof valeur !== 'string') return false;
  if (valeur !== valeur.trim()) return false;
  if (valeur.includes('\\')) return false;
  if (valeur.startsWith('/')) return !valeur.startsWith('//');
  if (opts.imageData && /^data:image\/[a-z0-9.+-]+[;,]/i.test(valeur)) return true;
  // Sans schéma (identifiant de piste, nom de fichier) : inerte — aucun
  // lecteur serveur ne sait l'ouvrir (le fetch sûr le refuse). Gardé tel quel.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(valeur)) return true;
  if (!/^https?:\/\//i.test(valeur)) return false;
  let url: URL;
  try { url = new URL(valeur); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const origines = opts.origines ?? originesStockageConfigurees();
  if (origines.includes(url.origin)) return true;
  // L'analyseur WHATWG a déjà normalisé les formes encodées (`2130706433`,
  // `0x7f.1`) en `127.0.0.1`.
  const hote = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hote) return false;
  if (isIP(hote)) return !ipInterdite(hote);
  if (!hote.includes('.')) return false;
  if (SUFFIXES_INTERNES.test(hote)) return false;
  return true;
}

/** Clés de `metadata` dont la valeur est une URL de média lue côté serveur. */
export const CLES_URL_METADATA = [
  'renderedVideoUrl', 'videoUrl', 'rawVideoUrl', 'musicUrl', 'voiceUrl',
] as const;
/** Clés d'IMAGE : la vignette `data:image/…` du navigateur y reste permise. */
export const CLES_IMAGE_METADATA = ['posterUrl', 'thumbnailUrl'] as const;

export interface UrlsNeutralisees {
  /** `undefined` : champ absent OU retiré (voir `refusees`). */
  media_url?: string | null;
  metadata?: Record<string, unknown>;
  /** Champs retirés, par nom (`media_url`, `metadata.renderedVideoUrl`…). */
  refusees: string[];
}

/**
 * Retire d'un post entrant les URLs non enregistrables. Ne modifie pas
 * l'entrée ; les autres clés de `metadata` passent telles quelles.
 */
export function neutraliserUrlsPost(
  entree: { media_url?: unknown; metadata?: unknown },
  opts: Pick<OptionsUrlEcrivable, 'origines'> = {},
): UrlsNeutralisees {
  const refusees: string[] = [];
  const out: UrlsNeutralisees = { refusees };

  if ('media_url' in entree && entree.media_url !== undefined) {
    if (urlEcrivable(entree.media_url, opts)) out.media_url = entree.media_url as string | null;
    else refusees.push('media_url');
  }

  const meta = entree.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const m: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
    for (const cle of CLES_URL_METADATA) {
      if (cle in m && !urlEcrivable(m[cle], opts)) { delete m[cle]; refusees.push(`metadata.${cle}`); }
    }
    for (const cle of CLES_IMAGE_METADATA) {
      if (cle in m && !urlEcrivable(m[cle], { ...opts, imageData: true })) { delete m[cle]; refusees.push(`metadata.${cle}`); }
    }
    if (Array.isArray(m.rushUrls)) {
      // Seules les CHAÎNES sont jugées : une entrée d'une autre forme passe
      // telle quelle, comme avant.
      const gardees = (m.rushUrls as unknown[]).filter((u) => typeof u !== 'string' || urlEcrivable(u, opts));
      if (gardees.length !== (m.rushUrls as unknown[]).length) { m.rushUrls = gardees; refusees.push('metadata.rushUrls'); }
    }
    const cover = m.cover;
    if (cover && typeof cover === 'object' && !Array.isArray(cover) && 'imageUrl' in (cover as object)) {
      const c = cover as Record<string, unknown>;
      if (!urlEcrivable(c.imageUrl, { ...opts, imageData: false })) {
        const { imageUrl: _retiree, ...reste } = c;
        m.cover = reste;
        refusees.push('metadata.cover.imageUrl');
      }
    }
    out.metadata = m;
  } else if (meta !== undefined) {
    out.metadata = meta as Record<string, unknown>;
  }
  return out;
}
