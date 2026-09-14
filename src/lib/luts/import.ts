import { parseCube, parseLutPng } from './parse';
import { uploadFile } from '@/lib/storage/uploadFile';
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

/** Extensions acceptées — les seules que `parse.ts` sait lire. */
export const LUT_ACCEPT = '.cube,.png';

const CUBE_EXT = /\.cube$/i;
const IMAGE_EXT = /\.png$/i;

/** Dossier logique de stockage. Un segment simple, accepté par `purposeAcceptable`. */
export const LUT_UPLOAD_PURPOSE = 'lut';

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
 * Téléversement par le flux partagé (`uploadFile`) — celui des rushes, des
 * photos et de l'audio. Jamais via une route API classique.
 *
 * Un `.cube` n'a pas de type MIME connu du navigateur : `file.type` est vide,
 * et `/api/upload/signed-url` refuse un `contentType` vide (400). Le fichier
 * est donc ré-emballé avec `application/octet-stream` — même contenu, même
 * nom, un type explicite.
 */
export async function uploadLutFile(file: File): Promise<string> {
  const typed = file.type
    ? file
    : new File([file], file.name, { type: 'application/octet-stream' });
  const { publicUrl } = await uploadFile(typed, { purpose: LUT_UPLOAD_PURPOSE });
  if (!publicUrl) throw new Error('Téléversement du filtre : aucune URL rendue.');
  return publicUrl;
}
