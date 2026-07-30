import { parseCube, parseLutPng } from './parse';
import { Lut, LutRef, MAX_LUT_BYTES } from './types';

/**
 * Import d'un fichier de LUT, du disque de l'utilisateur jusqu'à une
 * référence persistable.
 *
 * Deux règles portent tout ce module :
 *
 * 1. **On valide AVANT de téléverser.** Un fichier illisible ne doit jamais
 *    atteindre le stockage : sinon l'utilisateur voit une LUT dans son
 *    montage et l'échec ne survient qu'au rendu, loin de sa cause.
 * 2. **Seule la référence est persistée** (`LutRef`) — jamais la table, jamais
 *    une data URL. Une `.cube` de 6 Mo en base64 ferait sauter le quota
 *    `localStorage` (l'auto-sauvegarde échouerait en silence) et partirait
 *    dans le `metadata` de chaque post.
 *
 * Les accès au monde extérieur (décodage d'image, téléversement) sont
 * **injectés** : le navigateur fournit les vrais, les tests des doubles.
 */
export interface LutImportDeps {
  /** Téléverse le fichier tel quel et rend son URL publique. */
  upload: (file: File) => Promise<string>;
  /** Décode une image en pixels bruts. */
  decodeImage: (file: Blob) => Promise<{
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }>;
}

const CUBE_EXT = /\.cube$/i;
const IMAGE_EXT = /\.png$/i;

export async function importLutFile(
  file: File,
  deps: LutImportDeps,
): Promise<{ ref: LutRef; lut: Lut }> {
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

  // Lecture et validation d'abord — rien ne part au stockage avant.
  const lut = isCube
    ? parseCube(await file.text())
    : await (async () => {
        const { data, width, height } = await deps.decodeImage(file);
        return parseLutPng(data, width, height);
      })();

  const url = await deps.upload(file);

  return { ref: { url, name: file.name, intensity: 1 }, lut };
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

/**
 * Téléversement via le flux d'URL signée — le même que les rushes et l'audio.
 * Jamais via une route API classique : la limite de charge utile s'applique.
 */
export async function uploadLutFile(file: File): Promise<string> {
  const res = await fetch('/api/upload/signed-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      purpose: 'library',
    }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Signature refusée');

  const put = await fetch(data.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error(`Téléversement refusé (${put.status})`);

  return data.publicUrl;
}
