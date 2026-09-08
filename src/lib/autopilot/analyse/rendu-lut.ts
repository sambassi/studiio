/**
 * A_2 — LA RÉSOLUTION DES LUT. Serveur uniquement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN IDENTIFIANT, JAMAIS UN CHEMIN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `lut3d=file=…` ouvre un fichier du serveur. Accepter ce chemin depuis un
 * réglage donnerait la lecture de n'importe quel fichier de la machine — et
 * son contenu se retrouverait, transformé en couleurs, dans un MP4 publié.
 * Le profil ne porte donc qu'un identifiant du catalogue, résolu ici vers un
 * chemin que NOUS fabriquons, sous une racine que nous fixons.
 *
 * Le nom du fichier n'est même pas concaténé depuis l'identifiant reçu : il
 * vient de l'entrée de catalogue trouvée. Un identifiant inconnu ne produit
 * aucun chemin du tout.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EST SÉPARÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Même raison que `rendu-polices` : il touche au disque, et `rendu-style` est
 * atteint de proche en proche par des composants CLIENT. Une arête vers
 * `node:fs` depuis là ferait échouer le build entier — c'est arrivé au lot
 * A_1, et le test qui le tient vit dans `autopilote-a1-texte-rendu`.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { lutParId } from './catalogues-creatifs';

/**
 * La racine des LUT intégrées, FIXÉE ICI.
 *
 * ⚠️ ELLE NE VIENT D'AUCUN RÉGLAGE. C'est ce qui fait qu'aucun `..` ne peut
 * remonter ailleurs : le chemin est construit à partir d'un nom de fichier
 * que le catalogue possède, sous une racine que ce module seul choisit.
 */
const RACINE_LUTS = path.join(process.cwd(), 'public', 'luts');

/** Un `.cube` de 4 096 entrées pèse ~110 Ko ; au-delà, ce n'est pas des nôtres. */
export const TAILLE_MAX_LUT_OCTETS = 4 * 1024 * 1024;

/** L'identité d'une LUT résolue — ce que le rendu a réellement ouvert. */
export interface LutResolue {
  id: string;
  chemin: string;
  octets: number;
}

/**
 * Pourquoi une LUT n'a pas été appliquée. Liste fermée : un montage doit
 * pouvoir DIRE ce qui manque, pas seulement sortir sans couleur.
 */
export const MOTIFS_LUT = [
  'inactive', 'id_inconnu', 'fichier_absent', 'fichier_trop_gros',
] as const;
export type MotifLut = (typeof MOTIFS_LUT)[number];

export type IssueLut =
  | { sorte: 'appliquee'; lut: LutResolue }
  | { sorte: 'aucune'; motif: MotifLut };

/**
 * Résout la LUT d'un profil, ou dit pourquoi elle ne s'applique pas.
 *
 * ⚠️ INTENSITÉ NULLE = AUCUN FILTRE, PAS UN FILTRE NEUTRE. Ajouter un
 * `lut3d` à 0 % ferait traverser toute l'image par une interpolation qui ne
 * change rien : du temps de calcul et une perte d'arrondi, pour un résultat
 * censé être l'original.
 */
export function resoudreLut(
  lut: { active: boolean; lutId: string | null; intensite: number } | null | undefined,
): IssueLut {
  if (!lut || !lut.active || lut.lutId === null || !(lut.intensite > 0)) {
    return { sorte: 'aucune', motif: 'inactive' };
  }
  const entree = lutParId(lut.lutId);
  if (!entree || entree.ressourceServeur === null) {
    return { sorte: 'aucune', motif: 'id_inconnu' };
  }
  /* Le nom vient du CATALOGUE, pas de l'identifiant reçu : `basename` ferme
     la porte à un `../` qui aurait survécu à une entrée mal écrite. */
  const nom = path.basename(entree.ressourceServeur);
  const chemin = path.join(RACINE_LUTS, nom);
  if (!chemin.startsWith(RACINE_LUTS + path.sep)) {
    return { sorte: 'aucune', motif: 'id_inconnu' };
  }
  if (!existsSync(chemin)) return { sorte: 'aucune', motif: 'fichier_absent' };
  const octets = statSync(chemin).size;
  if (octets > TAILLE_MAX_LUT_OCTETS) {
    return { sorte: 'aucune', motif: 'fichier_trop_gros' };
  }
  return { sorte: 'appliquee', lut: { id: entree.id, chemin, octets } };
}
