import { createHash } from 'node:crypto';
import { parseCube } from './parse';
import {
  OCTETS_LUT_MAX, TAILLE_CUBE_MIN, TAILLE_CUBE_MAX,
} from '@/lib/creatif/lut-utilisateur';

/**
 * A_9b — CE QU'ON ACCEPTE D'APPELER « UNE LUT ».
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ NI L'EXTENSION NI LE TYPE MIME NE SONT CRUS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Un `.txt` renomme `.cube` arrive ici avec le type que le navigateur a bien
 * voulu annoncer. C'est le CONTENU qui tranche, et lui seul — exactement comme
 * l'enrollment video ne croit pas l'extension et laisse ffprobe decider.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUN SECOND PARSEUR
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `parseCube` existe, il gere TITLE, DOMAIN_MIN/MAX, les commentaires, la
 * notation scientifique et les 1D, et il est couvert par ses propres tests. En
 * ecrire un autre ferait deux lectures du meme format qui divergeraient au
 * premier fichier exotique — et la divergence se verrait apres le rendu.
 *
 * Ce module l'ENTOURE : il ajoute les gardes de PRODUIT que le parseur n'a pas
 * a connaitre — le poids, les octets binaires, et la politique 1D.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ LES 1D SONT REFUSEES, ET C'EST DIT
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Le rendu applique `lut3d`. Une table 1D ne sait pas ce qu'il attend :
 * `lut-cube.ts` l'ignore explicitement depuis A_2. Accepter une 1D a l'import
 * la ferait apparaitre dans la bibliotheque, se mettre en favori, se choisir —
 * et ne rien faire a l'image. Un refus qui explique vaut mieux qu'un silence
 * qui se decouvre au montage.
 */

/** Pourquoi un fichier n'est pas devenu une LUT. Liste fermee. */
export const MOTIFS_IMPORT_LUT = [
  'fichier_absent',
  'fichier_vide',
  'trop_volumineux',
  'binaire',
  'cube_invalide',
  'lut_1d_non_supportee',
  'taille_hors_bornes',
] as const;
export type MotifImportLut = (typeof MOTIFS_IMPORT_LUT)[number];

export const MESSAGES_IMPORT_LUT: Record<MotifImportLut, string> = {
  fichier_absent: 'Aucun fichier n’a été envoyé.',
  fichier_vide: 'Ce fichier est vide.',
  trop_volumineux: `Ce fichier dépasse ${OCTETS_LUT_MAX / (1024 * 1024)} Mo. Les LUT .cube utiles pèsent bien moins.`,
  binaire: 'Ce fichier n’est pas une LUT .cube valide.',
  cube_invalide: 'Ce fichier n’est pas une LUT .cube valide.',
  lut_1d_non_supportee:
    'Les LUT 1D ne sont pas encore prises en charge. Importez une LUT 3D au format .cube.',
  taille_hors_bornes:
    `Cette LUT déclare une taille hors des limites acceptées (${TAILLE_CUBE_MIN} à ${TAILLE_CUBE_MAX} pas par axe).`,
};

/**
 * ⚠️ UN AVERTISSEMENT, PAS UNE DETECTION. Rien dans le pipeline ne sait lire le
 * profil couleur d'une LUT — ni S-Log3, ni V-Log, ni Rec.709. Pretendre le
 * contraire donnerait un badge faux sur la moitie des imports. On dit donc a la
 * personne ce qu'elle seule peut verifier.
 */
export const AVERTISSEMENT_COLORIMETRIE =
  'Pour un rendu fidèle, utilisez une LUT conçue pour le profil couleur de votre vidéo.';

/** Ce qu'une lecture reussie apprend du fichier. */
export interface MesureLut {
  empreinte: string;
  octets: number;
  taille: number;
  titre: string | null;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export type LectureLut =
  | { ok: true; mesure: MesureLut }
  | { ok: false; motif: MotifImportLut };

/** L'empreinte des octets ORIGINAUX. Jamais du nom, jamais de la table lue. */
export function empreinteLut(octets: Buffer | Uint8Array): string {
  return createHash('sha256').update(octets).digest('hex');
}

/**
 * Un `.cube` est un fichier TEXTE. Un octet NUL n'y a rien a faire.
 *
 * ⚠️ CETTE GARDE PRECEDE LE PARSEUR, ET CE N'EST PAS DE LA PRUDENCE DECORATIVE.
 * `Buffer.toString('utf8')` ne rejette rien : il remplace ce qu'il ne comprend
 * pas par U+FFFD. Un binaire de trois megaoctets deviendrait donc un texte de
 * trois megaoctets, decoupe en lignes, et parcouru mot a mot pour rien.
 */
function contientBinaire(octets: Buffer | Uint8Array): boolean {
  const echantillon = octets.subarray(0, Math.min(octets.length, 64 * 1024));
  for (const o of echantillon) {
    if (o === 0) return true;
  }
  return false;
}

/**
 * LIT UN FICHIER ET DIT SI C'EST UNE LUT 3D UTILISABLE.
 *
 * L'ordre des gardes est celui du COUT : on refuse un fichier de six mega-
 * octets sur sa taille, avant de le decoder, avant de le parcourir.
 */
export function lireLutUtilisateur(octets: Buffer | Uint8Array | null | undefined): LectureLut {
  if (!octets) return { ok: false, motif: 'fichier_absent' };
  if (octets.length === 0) return { ok: false, motif: 'fichier_vide' };
  if (octets.length > OCTETS_LUT_MAX) return { ok: false, motif: 'trop_volumineux' };
  if (contientBinaire(octets)) return { ok: false, motif: 'binaire' };

  /* Le BOM UTF-8 est retire ici : le parseur lirait « ﻿LUT_3D_SIZE » comme
     une ligne de donnees, et rendrait « ligne 1 illisible » sur un fichier
     parfaitement valide exporte par un outil Windows. */
  const texte = Buffer.from(octets).toString('utf8').replace(/^﻿/, '');
  if (texte.trim().length === 0) return { ok: false, motif: 'fichier_vide' };

  let lut;
  try {
    lut = parseCube(texte);
  } catch {
    /* ⚠️ LE MESSAGE DU PARSEUR N'EST PAS RELAYE. Il nomme des numeros de ligne
       utiles en developpement, et il vient d'un fichier que l'appelant
       controle : le renvoyer tel quel ferait de la reponse un echo. */
    return { ok: false, motif: 'cube_invalide' };
  }

  if (lut.kind === '1d') return { ok: false, motif: 'lut_1d_non_supportee' };
  if (!Number.isInteger(lut.size) || lut.size < TAILLE_CUBE_MIN || lut.size > TAILLE_CUBE_MAX) {
    return { ok: false, motif: 'taille_hors_bornes' };
  }

  return {
    ok: true,
    mesure: {
      empreinte: empreinteLut(octets),
      octets: octets.length,
      taille: lut.size,
      titre: typeof lut.title === 'string' && lut.title.trim().length > 0
        ? lut.title.trim().slice(0, 100)
        : null,
      domainMin: lut.domainMin,
      domainMax: lut.domainMax,
    },
  };
}

/**
 * Le nom d'affichage par defaut : le TITLE du fichier, sinon son nom nettoye.
 *
 * ⚠️ LE NOM N'ENTRE JAMAIS DANS LA CLE. Elle est faite de l'empreinte, donc
 * `../../etc/passwd.cube` ne designe rien d'autre qu'un nom a l'ecran — et il
 * est nettoye pour ce qu'il est, pas pour ce qu'il pourrait atteindre.
 */
export function nomParDefaut(titre: string | null, nomFichier: unknown): string {
  if (titre && titre.trim().length > 0) return titre.trim().slice(0, 100);
  const brut = typeof nomFichier === 'string' ? nomFichier : '';
  const base = brut.split(/[\\/]/).pop() ?? '';
  const sansExtension = base.replace(/\.cube$/i, '').replace(/[\r\n\t]+/g, ' ').trim();
  return sansExtension.length > 0 ? sansExtension.slice(0, 100) : 'Mon look';
}
