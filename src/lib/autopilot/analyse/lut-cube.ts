/**
 * A_2 — LIRE, VALIDER ET DOSER UN `.cube`. Fonctions PURES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN `node:fs` ICI — la même règle qu'en A_1
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce module est atteignable depuis `rendu-style`, lui-même atteint par des
 * composants client. Une arête vers le disque ferait échouer le build entier
 * (« UnhandledSchemeError: Reading from "node:fs" »), et c'est arrivé.
 * Le disque vit dans `rendu-lut.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMMENT L'INTENSITÉ EST APPLIQUÉE, ET POURQUOI AINSI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `lut3d` n'a pas d'opacité. Le réflexe serait `split` + `lut3d` + `blend` —
 * mais le look est inséré dans une CHAÎNE LINÉAIRE de filtres, par clip
 * (`[look, transition].join(',')`) : un graphe à branches n'y entre pas sans
 * réécrire tout l'assemblage.
 *
 * On dose donc LA TABLE, pas l'image : chaque entrée est ramenée vers
 * l'identité. Ce n'est pas une approximation — `lut3d` interpole
 * linéairement, et l'interpolation d'un mélange linéaire de deux tables EST
 * le mélange des interpolations. Le résultat est exactement celui qu'un
 * `blend` aurait donné, avec un filtre au lieu de trois et sans toucher au
 * reste du graphe.
 */

/** Une table lue : sa taille par axe, et ses entrées dans l'ordre du `.cube`. */
export interface Cube {
  taille: number;
  /** `taille³` triplets, rouge le plus rapide. */
  entrees: Float64Array;
}

/** Les bornes de ce qu'on accepte de lire. */
export const TAILLE_CUBE_MIN = 2;
export const TAILLE_CUBE_MAX = 64;

/** Ce qui peut clocher dans un `.cube`. Liste fermée. */
export const MOTIFS_CUBE = [
  'vide', 'taille_absente', 'taille_hors_bornes', 'entrees_manquantes',
  'entrees_en_trop', 'valeur_invalide',
] as const;
export type MotifCube = (typeof MOTIFS_CUBE)[number];

export type LectureCube =
  | { ok: true; cube: Cube }
  | { ok: false; motif: MotifCube };

/**
 * Lit un `.cube`.
 *
 * ⚠️ TOLÉRANT SUR LA FORME, STRICT SUR LES NOMBRES. Les commentaires, les
 * lignes vides, `TITLE`, `DOMAIN_MIN/MAX` sont ignorés — ils varient d'un
 * logiciel à l'autre. Mais une valeur non finie, une entrée manquante ou une
 * taille aberrante font échouer la lecture : une table à moitié lue
 * produirait des couleurs fausses sans lever la moindre erreur.
 */
export function lireCube(texte: string): LectureCube {
  if (typeof texte !== 'string' || texte.trim() === '') return { ok: false, motif: 'vide' };
  let taille = 0;
  const valeurs: number[] = [];

  for (const brute of texte.split('\n')) {
    const ligne = brute.trim();
    if (ligne === '' || ligne.startsWith('#')) continue;
    const hautNiveau = ligne.toUpperCase();
    if (hautNiveau.startsWith('LUT_3D_SIZE')) {
      taille = Number.parseInt(ligne.split(/\s+/)[1] ?? '', 10);
      continue;
    }
    // `LUT_1D_SIZE` n'est pas gere : une table 1D ne sait pas ce que `lut3d`
    // attend, et l'accepter en silence donnerait un grade faux.
    if (hautNiveau.startsWith('TITLE') || hautNiveau.startsWith('DOMAIN_')
      || hautNiveau.startsWith('LUT_1D_SIZE')) continue;

    const parts = ligne.split(/\s+/);
    if (parts.length < 3) continue;
    for (let i = 0; i < 3; i += 1) {
      const v = Number(parts[i]);
      if (!Number.isFinite(v)) return { ok: false, motif: 'valeur_invalide' };
      valeurs.push(v);
    }
  }

  if (!Number.isFinite(taille) || taille === 0) return { ok: false, motif: 'taille_absente' };
  if (taille < TAILLE_CUBE_MIN || taille > TAILLE_CUBE_MAX) {
    return { ok: false, motif: 'taille_hors_bornes' };
  }
  const attendu = taille ** 3 * 3;
  if (valeurs.length < attendu) return { ok: false, motif: 'entrees_manquantes' };
  if (valeurs.length > attendu) return { ok: false, motif: 'entrees_en_trop' };

  return { ok: true, cube: { taille, entrees: Float64Array.from(valeurs) } };
}

/**
 * Ramène la table vers l'identité selon l'intensité.
 *
 * `1` rend la table telle quelle ; `0` rendrait l'identité — mais l'appelant
 * ne devrait jamais arriver ici à 0, où l'on n'ajoute aucun filtre du tout.
 */
export function doserCube(cube: Cube, intensite: number): Cube {
  const i = Math.max(0, Math.min(1, intensite));
  if (i >= 1) return cube;
  const { taille } = cube;
  const sortie = new Float64Array(cube.entrees.length);
  const pas = taille - 1;
  let k = 0;
  for (let b = 0; b < taille; b += 1) {
    for (let g = 0; g < taille; g += 1) {
      for (let r = 0; r < taille; r += 1) {
        /* L'identité au point de grille : c'est la coordonnée elle-même. */
        sortie[k] = r / pas + (cube.entrees[k] - r / pas) * i;
        sortie[k + 1] = g / pas + (cube.entrees[k + 1] - g / pas) * i;
        sortie[k + 2] = b / pas + (cube.entrees[k + 2] - b / pas) * i;
        k += 3;
      }
    }
  }
  return { taille, entrees: sortie };
}

/** Réécrit une table au format `.cube`. Six décimales, comme le générateur. */
export function ecrireCube(cube: Cube, titre: string): string {
  const lignes = [
    `# Studiio — ${titre}`,
    `LUT_3D_SIZE ${cube.taille}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ];
  for (let i = 0; i < cube.entrees.length; i += 3) {
    lignes.push(
      `${cube.entrees[i].toFixed(6)} `
      + `${cube.entrees[i + 1].toFixed(6)} `
      + `${cube.entrees[i + 2].toFixed(6)}`,
    );
  }
  return `${lignes.join('\n')}\n`;
}

/**
 * Le filtre, une fois le fichier prêt.
 *
 * ⚠️ LE CHEMIN EST FABRIQUÉ PAR LE SERVEUR, jamais reçu. `interp=tetrahedral`
 * plutôt que le défaut trilinéaire : sur une table de 16 pas, il suit mieux
 * les diagonales de couleur, pour le même coût.
 */
export function filtreLut3d(chemin: string): string {
  return `lut3d=file='${chemin}':interp=tetrahedral`;
}
