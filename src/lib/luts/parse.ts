import { Lut, MAX_LUT_SIZE } from './types';

/**
 * Parseur `.cube` (Adobe/IRIDAS).
 *
 * Règle de conduite du fichier : **on lève plutôt que de deviner**. Un `.cube`
 * tronqué dont on compléterait les triplets manquants par des zéros produirait
 * un étalonnage faux mais plausible — le pire cas, parce qu'il ne se voit ni à
 * l'écran ni en revue de code.
 */
export function parseCube(text: string): Lut {
  const lines = text.split(/\r?\n/);

  let kind: '3d' | '1d' | null = null;
  let size = 0;
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;

    const upper = line.toUpperCase();

    if (upper.startsWith('TITLE')) {
      const m = /"([^"]*)"/.exec(line);
      title = m ? m[1] : line.slice(5).trim();
      continue;
    }
    if (upper.startsWith('LUT_3D_SIZE') || upper.startsWith('LUT_1D_SIZE')) {
      kind = upper.startsWith('LUT_3D_SIZE') ? '3d' : '1d';
      size = Number(line.split(/\s+/)[1]);
      if (!Number.isInteger(size) || size < 2) {
        throw new Error(`Taille de LUT invalide (ligne ${i + 1}) : « ${line} ».`);
      }
      if (size > MAX_LUT_SIZE) {
        throw new Error(
          `LUT trop grande : ${size} pas par axe, le maximum accepté est ${MAX_LUT_SIZE}.`,
        );
      }
      continue;
    }
    if (upper.startsWith('DOMAIN_MIN') || upper.startsWith('DOMAIN_MAX')) {
      const parts = line.split(/\s+/).slice(1, 4).map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`Domaine illisible (ligne ${i + 1}) : « ${line} ».`);
      }
      const triplet = parts as [number, number, number];
      if (upper.startsWith('DOMAIN_MIN')) domainMin = triplet;
      else domainMax = triplet;
      continue;
    }

    // Toute autre ligne non vide doit être un triplet de données.
    const parts = line.split(/\s+/);
    if (parts.length !== 3) {
      throw new Error(`Ligne ${i + 1} illisible : « ${line} » (3 valeurs attendues).`);
    }
    const triplet = parts.map(Number);
    if (triplet.some((n) => !Number.isFinite(n))) {
      throw new Error(`Ligne ${i + 1} non numérique : « ${line} ».`);
    }
    values.push(triplet[0], triplet[1], triplet[2]);
  }

  if (kind === null) {
    throw new Error('Fichier .cube invalide : ni LUT_3D_SIZE ni LUT_1D_SIZE déclaré.');
  }

  const expected = kind === '3d' ? size ** 3 : size;
  const read = values.length / 3;
  if (read !== expected) {
    throw new Error(
      `Fichier .cube incomplet : ${expected} triplets attendus, ${read} lus.`,
    );
  }

  return { kind, size, table: Float32Array.from(values), title, domainMin, domainMax };
}

/**
 * Lit une LUT stockée dans une image (PNG).
 *
 * Deux dispositions circulent, et elles ont **exactement les mêmes
 * dimensions** — 512×512 pour un cube de 64 dans les deux cas :
 *
 * - **HALD CLUT** : les couleurs se suivent linéairement dans l'ordre de
 *   lecture de l'image, rouge le plus rapide ;
 * - **grille de tuiles** (« lookup.png » de GPUImage) : t×t tuiles, le bleu
 *   indexe la tuile, le rouge donne x et le vert y à l'intérieur.
 *
 * Impossible de trancher sur la taille : on lit donc l'image DANS LES DEUX
 * SENS et on garde celle qui produit un cube cohérent — une vraie LUT varie
 * doucement d'un nœud au suivant, la mauvaise lecture mélange les axes et
 * produit un cube en dents de scie. Quand aucune ne se détache, on lève :
 * livrer un étalonnage faux est pire que refuser le fichier.
 */
export function parseLutPng(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Lut {
  if (width !== height) {
    throw new Error(`L'image doit être carrée (reçu ${width}×${height}).`);
  }
  const t = Math.round(Math.cbrt(width));
  if (t < 2 || t * t * t !== width) {
    throw new Error(
      `Côté de ${width} px : ce n'est pas une LUT image reconnue (attendu 8, 64, 512…).`,
    );
  }
  const size = t * t;
  if (size > MAX_LUT_SIZE) {
    throw new Error(
      `LUT trop grande : ${size} pas par axe, le maximum accepté est ${MAX_LUT_SIZE}.`,
    );
  }
  if (data.length < width * height * 4) {
    throw new Error("Image incomplète : il manque des pixels.");
  }

  const hald = readHald(data, width, size);
  const tiles = readTiles(data, width, size, t);
  const scoreHald = roughness(hald, size);
  const scoreTiles = roughness(tiles, size);

  // Facteur 2 : la mauvaise lecture d'une vraie LUT est plus rugueuse de
  // plusieurs ordres de grandeur, jamais de quelques pourcents.
  if (scoreHald * 2 <= scoreTiles) {
    return { ...lutFrom(hald, size), layout: 'hald' };
  }
  if (scoreTiles * 2 <= scoreHald) {
    return { ...lutFrom(tiles, size), layout: 'tiles' };
  }
  throw new Error(
    "Disposition de LUT indécidable : cette image n'est ni un HALD ni une grille de tuiles reconnaissable. Utilisez un fichier .cube.",
  );
}

function lutFrom(table: Float32Array, size: number): Lut {
  return { kind: '3d', size, table, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

/** HALD : l'ordre de lecture de l'image EST l'ordre du cube. */
function readHald(data: Uint8ClampedArray, width: number, size: number): Float32Array {
  const table = new Float32Array(size * size * size * 3);
  const count = Math.min(width * width, size * size * size);
  for (let i = 0; i < count; i++) {
    table[i * 3] = data[i * 4] / 255;
    table[i * 3 + 1] = data[i * 4 + 1] / 255;
    table[i * 3 + 2] = data[i * 4 + 2] / 255;
  }
  return table;
}

/** Grille t×t de tuiles size×size : bleu = tuile, rouge = x, vert = y. */
function readTiles(
  data: Uint8ClampedArray,
  width: number,
  size: number,
  t: number,
): Float32Array {
  const table = new Float32Array(size * size * size * 3);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const b = Math.floor(y / size) * t + Math.floor(x / size);
      const r = x % size;
      const g = y % size;
      const src = (y * width + x) * 4;
      const dst = ((b * size + g) * size + r) * 3;
      table[dst] = data[src] / 255;
      table[dst + 1] = data[src + 1] / 255;
      table[dst + 2] = data[src + 2] / 255;
    }
  }
  return table;
}

/**
 * Rugosité du cube : somme des écarts au carré entre nœuds voisins sur les
 * trois axes. Une vraie LUT est lisse ; une lecture qui mélange les axes ne
 * l'est pas.
 */
function roughness(table: Float32Array, n: number): number {
  let sum = 0;
  const at = (r: number, g: number, b: number, c: number) =>
    table[((b * n + g) * n + r) * 3 + c];
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < 3; c++) {
          const v = at(r, g, b, c);
          if (r + 1 < n) sum += (at(r + 1, g, b, c) - v) ** 2;
          if (g + 1 < n) sum += (at(r, g + 1, b, c) - v) ** 2;
          if (b + 1 < n) sum += (at(r, g, b + 1, c) - v) ** 2;
        }
      }
    }
  }
  return sum;
}
