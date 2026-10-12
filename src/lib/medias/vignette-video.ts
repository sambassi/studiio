/**
 * MINIATURE D'UNE VIDÉO — extraite UNE fois dans le navigateur, puis gardée.
 *
 * ⚠️ AUCUN CHAMP « VIGNETTE » N'EXISTE pour un rush : `/api/media/list` ne
 * rend que `url, name, type`, et la base ne garde rien d'autre. Les écrans
 * posaient donc un `<video src="…#t=0.1" preload="metadata">` par carte. Or
 * le relais de stockage privé (#554) sert le propriétaire avec
 * `Cache-Control: private, no-store` : chaque affichage de la banque, du plan
 * ou de la liste retéléchargeait les en-têtes de CHAQUE rush — et la moindre
 * lenteur laissait une case noire ou une icône.
 *
 * Ici : une vidéo cachée (muette, `playsInline`) lit UNE image vers
 * min(1 s, durée/2), la réduit à ~240 px de large sur un canvas (ratio de la
 * source conservé) et l'encode en JPEG 0,7. Le résultat est gardé :
 *   - en MÉMOIRE (Map de module) pour la session ;
 *   - dans IndexedDB pour les visites suivantes — try/catch partout, tout
 *     fonctionne sans (navigation privée, stockage bloqué, jsdom).
 *
 * ⚠️ LA CLÉ EST LA CLÉ D'OBJET, pas l'URL : le même rush arrive en relatif,
 * en absolu, sur un autre hôte ou avec un jeton `?sr=` différent à chaque
 * signature. Comparer les chaînes réextrairait le même fichier à l'infini.
 *
 * ⚠️ WEBM DE MediaRecorder : durée `Infinity` à `loadedmetadata` (aucune
 * durée dans l'en-tête). Un saut à 1e101 force le calcul (`durationchange`),
 * PUIS on vise l'instant voulu — le même contournement que
 * `ReglagesPublicationReseaux`.
 *
 * Aucun appel réseau autre que la lecture du fichier lui-même (même origine,
 * cookie de session) : aucun fournisseur, aucun crédit, rien de rendu public.
 */
import { cleObjetStockage } from '@/lib/storage/cle-objet-client';

export interface VignetteVideo {
  /** URL locale (`blob:`) de l'image JPEG. */
  url: string;
  /** Largeur / hauteur de la SOURCE. */
  ratio: number;
  /** Durée de la source en secondes, si elle a pu être lue. */
  duree: number | null;
}

/** Ce que rend un extracteur : la vignette, et le JPEG pour le cache persistant. */
export interface ExtractionVignette extends VignetteVideo {
  blob?: Blob | null;
}

export type Extracteur = (url: string) => Promise<ExtractionVignette>;

/** Largeur de la miniature (px). */
export const LARGEUR_VIGNETTE = 240;
/** Au-delà, l'extraction est abandonnée. */
export const DELAI_EXTRACTION_MS = 8000;
/** Extractions simultanées au plus — une banque de 20 rushes ne lance pas 20 décodeurs. */
export const EXTRACTIONS_MAX = 2;
/** Un échec est retenu ce temps-là (pas de nouvelle tentative à chaque rendu). */
export const TTL_ECHEC_MS = 60_000;

/**
 * Clé de cache d'une URL vidéo : la clé d'objet de stockage (`<bucket>/<chemin>`)
 * si c'en est une, sinon le chemin SANS hôte ni requête ni fragment.
 */
export function cleVignette(url: string): string {
  const objet = cleObjetStockage(url);
  if (objet) return `objet:${objet}`;
  try {
    const u = new URL(url, 'http://local.invalid');
    return `chemin:${u.pathname}`;
  } catch {
    return `chemin:${url.split(/[?#]/)[0]}`;
  }
}

/* ── EXTRACTION DANS LE NAVIGATEUR ──────────────────────────────────── */

type VideoMin = Pick<HTMLVideoElement, 'duration' | 'videoWidth' | 'videoHeight' | 'currentTime' | 'addEventListener' | 'removeEventListener'>;

interface DependancesExtraction {
  creerVideo?: () => HTMLVideoElement;
  creerCanvas?: () => HTMLCanvasElement;
  creerUrl?: (b: Blob) => string;
  delaiMs?: number;
}

function attendre(v: VideoMin, evenement: string, condition: () => boolean = () => true): Promise<void> {
  const p = new Promise<void>((resolve, reject) => {
    const ok = () => { if (!condition()) return; nettoyer(); resolve(); };
    const ko = () => { nettoyer(); reject(new Error('video-erreur')); };
    const nettoyer = () => { v.removeEventListener(evenement, ok); v.removeEventListener('error', ko); };
    v.addEventListener(evenement, ok);
    v.addEventListener('error', ko);
  });
  // Une attente qui perd la course contre le délai ne doit pas lever plus tard.
  p.catch(() => {});
  return p;
}

/**
 * Extrait une image d'une vidéo. Lève en cas d'échec (erreur de lecture,
 * délai dépassé, canvas indisponible).
 */
export async function extraireVignetteDom(url: string, deps: DependancesExtraction = {}): Promise<ExtractionVignette> {
  const video = (deps.creerVideo ?? (() => document.createElement('video')))();
  const delai = deps.delaiMs ?? DELAI_EXTRACTION_MS;
  let minuteur: ReturnType<typeof setTimeout> | null = null;
  const expiration = new Promise<never>((_, reject) => {
    minuteur = setTimeout(() => reject(new Error('delai')), delai);
  });
  // Jamais de rejet « non géré » : chaque attente passe par `Promise.race`.
  expiration.catch(() => {});
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // Même origine : le cookie de session suffit, pas de `crossOrigin`.
    const meta = attendre(video, 'loadedmetadata');
    video.src = url;
    await Promise.race([meta, expiration]);

    // WebM sans durée : forcer le calcul avant de viser un instant.
    let duree: number | null = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    if (duree === null) {
      const calcul = attendre(video, 'durationchange', () => Number.isFinite(video.duration) && video.duration > 0);
      video.currentTime = 1e101;
      await Promise.race([calcul, expiration]);
      duree = video.duration;
    }
    const cible = Math.min(1, duree / 2);
    const vu = attendre(video, 'seeked');
    video.currentTime = cible;
    await Promise.race([vu, expiration]);

    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const ratio = vw / vh;
    const canvas = (deps.creerCanvas ?? (() => document.createElement('canvas')))();
    canvas.width = LARGEUR_VIGNETTE;
    canvas.height = Math.max(1, Math.round(LARGEUR_VIGNETTE / ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await Promise.race([
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.7);
      }),
      expiration,
    ]);
    const creerUrl = deps.creerUrl ?? ((b: Blob) => URL.createObjectURL(b));
    return { url: creerUrl(blob), ratio, duree, blob };
  } finally {
    if (minuteur) clearTimeout(minuteur);
    // Libère le décodeur et la connexion.
    try { video.removeAttribute('src'); } catch { /* rien à libérer */ }
  }
}

/* ── CACHE PERSISTANT (IndexedDB) — facultatif ──────────────────────── */

const BASE = 'studiio-vignettes';
const MAGASIN = 'vignettes';

interface EntreePersistante { blob: Blob; ratio: number; duree: number | null }

function ouvrirBase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
      if (!idb) { resolve(null); return; }
      const req = idb.open(BASE, 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(MAGASIN); } catch { /* déjà là */ }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function lirePersistant(cle: string): Promise<EntreePersistante | null> {
  try {
    const db = await ouvrirBase();
    if (!db) return null;
    return await new Promise((resolve) => {
      try {
        const req = db.transaction(MAGASIN, 'readonly').objectStore(MAGASIN).get(cle);
        req.onsuccess = () => {
          const v = req.result as EntreePersistante | undefined;
          resolve(v && v.blob && typeof v.ratio === 'number' ? v : null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

async function ecrirePersistant(cle: string, entree: EntreePersistante): Promise<void> {
  try {
    const db = await ouvrirBase();
    if (!db) return;
    db.transaction(MAGASIN, 'readwrite').objectStore(MAGASIN).put(entree, cle);
  } catch { /* le cache mémoire suffit */ }
}

/* ── CACHE MÉMOIRE + FILE ───────────────────────────────────────────── */

type EntreeMemoire = { ok: VignetteVideo } | { echecJusqua: number };

const memoire = new Map<string, EntreeMemoire>();
const enCours = new Map<string, Promise<VignetteVideo | null>>();
let actives = 0;
const file: Array<() => void> = [];
let extracteur: Extracteur = (url) => extraireVignetteDom(url);
let maintenant: () => number = () => Date.now();
let persistance = true;

function prendrePlace(): Promise<void> {
  if (actives < EXTRACTIONS_MAX) { actives += 1; return Promise.resolve(); }
  return new Promise((resolve) => file.push(() => { actives += 1; resolve(); }));
}

function rendrePlace() {
  actives = Math.max(0, actives - 1);
  const suivant = file.shift();
  if (suivant) suivant();
}

/** Lecture SYNCHRONE du cache mémoire : `undefined` = inconnu, `null` = échec récent. */
export function vignetteEnMemoire(url: string): VignetteVideo | null | undefined {
  const e = memoire.get(cleVignette(url));
  if (!e) return undefined;
  if ('ok' in e) return e.ok;
  if (e.echecJusqua > maintenant()) return null;
  memoire.delete(cleVignette(url));
  return undefined;
}

/**
 * La vignette d'une vidéo : mémoire → IndexedDB → extraction (2 à la fois).
 * `null` si l'extraction échoue (échec retenu `TTL_ECHEC_MS`). Ne lève jamais.
 */
export function obtenirVignette(url: string): Promise<VignetteVideo | null> {
  const cle = cleVignette(url);
  const connue = vignetteEnMemoire(url);
  if (connue !== undefined) return Promise.resolve(connue);
  const deja = enCours.get(cle);
  if (deja) return deja;

  const travail = (async (): Promise<VignetteVideo | null> => {
    if (persistance) {
      const p = await lirePersistant(cle);
      if (p) {
        try {
          const v: VignetteVideo = { url: URL.createObjectURL(p.blob), ratio: p.ratio, duree: p.duree };
          memoire.set(cle, { ok: v });
          return v;
        } catch { /* on réextrait */ }
      }
    }
    await prendrePlace();
    try {
      const r = await extracteur(url);
      if (!r || !r.url || !(r.ratio > 0)) throw new Error('vignette-vide');
      const v: VignetteVideo = { url: r.url, ratio: r.ratio, duree: r.duree ?? null };
      memoire.set(cle, { ok: v });
      if (persistance && r.blob) void ecrirePersistant(cle, { blob: r.blob, ratio: v.ratio, duree: v.duree });
      return v;
    } catch {
      memoire.set(cle, { echecJusqua: maintenant() + TTL_ECHEC_MS });
      return null;
    } finally {
      rendrePlace();
    }
  })().finally(() => { enCours.delete(cle); });

  enCours.set(cle, travail);
  return travail;
}

/** Réservé aux tests : remplace l'extracteur, l'horloge, et vide les caches. */
export const vignettesPourTests = {
  definirExtracteur(f: Extracteur) { extracteur = f; },
  definirHorloge(f: () => number) { maintenant = f; },
  desactiverPersistance(v = true) { persistance = !v; },
  reinitialiser() {
    memoire.clear();
    enCours.clear();
    file.length = 0;
    actives = 0;
    extracteur = (url) => extraireVignetteDom(url);
    maintenant = () => Date.now();
    persistance = true;
  },
};
