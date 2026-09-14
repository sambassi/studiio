import { parseCube, parseLutPng } from './parse';
import { ecrireCube } from './serialize';
import { refDeLutAsset } from './bibliotheque';
import { MAX_LUT_BYTES, type Lut, type LutAsset, type LutRef, type OrigineLut } from './types';

/**
 * Import d'une LUT depuis le NAVIGATEUR, jusqu'à la bibliothèque du compte.
 *
 * Flux :
 *   fichier → pré-validation (socle) → canonicalisation si image
 *   → POST /api/creatif/luts → validation serveur A1 → SHA-256 serveur
 *   → objet privé → `lut_assets` → `LutAsset` → `LutRef` pour le brouillon.
 *
 * Trois règles portent ce module :
 *
 * 1. **Le navigateur n'est PAS l'autorité.** Il pré-valide pour répondre
 *    vite — un `.cube` tronqué est refusé sans aller-retour réseau — mais le
 *    serveur revalide tout ce qu'il reçoit. Aucun second parseur : c'est
 *    `parseCube` / `parseLutPng` du socle, ici comme là-bas.
 * 2. **Un PNG est canonicalisé ICI.** Le serveur n'a pas de décodeur d'image ;
 *    le navigateur en a un. La table lue est réécrite en `.cube` par
 *    `ecrireCube` (déterministe) et c'est ce `.cube` qui part, avec
 *    `origine: 'png'`. Le même look en `.cube` et en PNG donne alors la même
 *    empreinte : une seule LUT.
 * 3. **Seule la référence est persistée** (`LutRef` : empreinte, nom,
 *    intensité) — jamais la table, jamais une URL, jamais une clé de
 *    stockage. L'identité est l'empreinte ; les octets se lisent par la route
 *    authentifiée de la bibliothèque.
 *
 * Les accès au monde extérieur (décodage d'image, appel API) sont
 * **injectés** : le navigateur fournit les vrais, les tests des doubles.
 */

/** Ce que rend `POST /api/creatif/luts`, tel que vu du navigateur. */
export type ReponseImportLut =
  | { ok: true; issue: 'creee' | 'existante'; lut: LutAsset; avertissement?: string }
  | { ok: false; statut: number; motif?: string; error?: string };

export interface LutImportDeps {
  /** Envoie un `.cube` à l'API commune et rend sa réponse. */
  envoyer: (fichier: File, origine: OrigineLut) => Promise<ReponseImportLut>;
  /** Décode une image en pixels bruts. */
  decodeImage: (file: Blob) => Promise<{
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }>;
}

export interface LutImportee {
  asset: LutAsset;
  ref: LutRef;
  issue: 'creee' | 'existante';
  /** La table pré-validée, pour un aperçu futur — jamais persistée. */
  lut: Lut;
  avertissement?: string;
}

/** Extensions acceptées — les seules que le socle sait lire. */
export const LUT_ACCEPT = '.cube,.png';

const CUBE_EXT = /\.cube$/i;
const IMAGE_EXT = /\.png$/i;

/** Message d'un refus de l'API, en français, sans jamais relayer un `statut` nu. */
function messageRefus(r: { statut: number; motif?: string; error?: string }): string {
  if (r.error) return r.error;
  if (r.statut === 401) return 'Connectez-vous pour importer un filtre.';
  if (r.statut === 409) return 'Votre bibliothèque de filtres est pleine.';
  if (r.statut === 413) return `Fichier trop lourd : le maximum est ${MAX_LUT_BYTES / (1024 * 1024)} Mo.`;
  if (r.statut === 503) return 'La bibliothèque de filtres n’est pas encore disponible sur ce serveur.';
  return 'Le filtre n’a pas pu être enregistré. Réessayez.';
}

export async function importLutFile(file: File, deps: LutImportDeps): Promise<LutImportee> {
  const isCube = CUBE_EXT.test(file.name);
  const isImage = IMAGE_EXT.test(file.name);
  if (!isCube && !isImage) {
    throw new Error(
      `Format non pris en charge : « ${file.name} ». Formats acceptés : .cube et .png.`,
    );
  }
  if (file.size > MAX_LUT_BYTES) {
    const mo = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Fichier trop lourd (${mo} Mo) : le maximum est ${MAX_LUT_BYTES / (1024 * 1024)} Mo.`,
    );
  }

  // Pré-validation par le SEUL parseur du dépôt — rien ne part avant.
  let lut: Lut;
  let aEnvoyer: File;
  let origine: OrigineLut;
  if (isCube) {
    lut = parseCube(await file.text());
    aEnvoyer = file;
    origine = 'cube';
  } else {
    const { data, width, height } = await deps.decodeImage(file);
    lut = parseLutPng(data, width, height);
    // Canonicalisation : la table lue, réécrite en `.cube` déterministe.
    const canonique = ecrireCube(lut, file.name.replace(IMAGE_EXT, ''));
    aEnvoyer = new File([canonique], file.name.replace(IMAGE_EXT, '.cube'), { type: 'text/plain' });
    origine = 'png';
  }

  const reponse = await deps.envoyer(aEnvoyer, origine);
  if (!reponse.ok) throw new Error(messageRefus(reponse));

  return {
    asset: reponse.lut,
    ref: refDeLutAsset(reponse.lut, 1),
    issue: reponse.issue,
    lut,
    avertissement: reponse.avertissement,
  };
}

/**
 * Décodeur d'image du navigateur. Isolé ici pour que `importLutFile` reste
 * testable hors navigateur : `createImageBitmap` et `canvas` n'existent pas
 * dans l'environnement de test.
 */
export async function decodeImageInBrowser(file: Blob): Promise<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error("Impossible de lire l'image (canvas indisponible).");
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data: img.data, width: img.width, height: img.height };
  } finally {
    bitmap.close();
  }
}

/** L'API commune de la bibliothèque — le SEUL chemin d'écriture d'une LUT. */
export const LUT_API = '/api/creatif/luts';

/**
 * Envoi à `POST /api/creatif/luts`. Multipart, comme la route l'attend.
 * Jamais `/api/upload/signed-url` : le namespace `lut` y est refusé (A1), et
 * c'est le serveur qui construit la clé, calcule l'empreinte et range la fiche.
 */
export async function envoyerLutApi(fichier: File, origine: OrigineLut): Promise<ReponseImportLut> {
  const form = new FormData();
  form.set('fichier', fichier);
  form.set('origine', origine);
  const res = await fetch(LUT_API, { method: 'POST', body: form });
  const corps = await res.json().catch(() => null) as
    | { ok?: boolean; issue?: 'creee' | 'existante'; lut?: LutAsset; avertissement?: string; motif?: string; error?: string }
    | null;
  if (res.ok && corps?.ok && corps.lut && corps.issue) {
    return { ok: true, issue: corps.issue, lut: corps.lut, avertissement: corps.avertissement };
  }
  return { ok: false, statut: res.status, motif: corps?.motif, error: corps?.error };
}

/**
 * La bibliothèque du compte, pour retrouver la fiche d'une référence relue
 * d'un brouillon (nature de la LUT, existence). `null` si l'appel échoue :
 * l'appelant garde alors la référence, sans en déduire quoi que ce soit.
 */
export async function listerLutsApi(): Promise<readonly LutAsset[] | null> {
  try {
    const res = await fetch(LUT_API, { method: 'GET' });
    const corps = await res.json().catch(() => null) as { ok?: boolean; luts?: LutAsset[] } | null;
    if (!res.ok || !corps?.ok || !Array.isArray(corps.luts)) return null;
    return corps.luts;
  } catch {
    return null;
  }
}
