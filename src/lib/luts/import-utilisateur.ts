import { createHash } from 'node:crypto';
import { parseCube } from './parse';
import { ecrireCube } from './serialize';
import { MAX_LUT_1D_SIZE, MAX_LUT_BYTES, MAX_LUT_SIZE, type Lut } from './types';

/**
 * CE QUE LE SERVEUR ACCEPTE D'APPELER « UNE LUT ».
 *
 * Module SERVEUR (il hache avec `node:crypto`). C'est l'autorité finale : ce
 * que le navigateur a pré-validé pour répondre vite est revalidé ici, sur les
 * octets reçus, sans rien croire de l'extension ni du type MIME annoncé. Un
 * `.txt` renommé `.cube` arrive avec le type que le navigateur a bien voulu
 * dire ; c'est le CONTENU qui tranche.
 *
 * ⚠️ AUCUN SECOND PARSEUR. `parseCube` (socle) gère `TITLE`, `DOMAIN_*`, les
 * commentaires et les 1D, et il est couvert par ses propres tests. Ce module
 * l'ENTOURE : il ajoute les gardes de produit que le parseur n'a pas à
 * connaître — le poids, les octets binaires — puis il CANONICALISE.
 *
 * ⚠️ CANONICALISÉ, PUIS HACHÉ. Ce qui est stocké n'est pas le fichier reçu
 * mais sa réécriture par `ecrireCube` : même table → mêmes octets, quelle que
 * soit la mise en forme de l'outil d'origine (espaces, commentaires, `1.0`
 * ou `1.000000`). L'empreinte est calculée sur CES octets — c'est ce qui
 * rend la déduplication réelle, et ce qui fait qu'un PNG canonicalisé côté
 * navigateur et le même look en `.cube` sont une seule LUT.
 *
 * ⚠️ LES 1D SONT ACCEPTÉES. Le moteur de rendu ne les applique pas encore ;
 * c'est `supportDeLut` qui le dit à l'écran, pas un refus à l'import qui
 * ferait disparaître le fichier de la personne.
 */

/** Pourquoi un fichier n'est pas devenu une LUT. Liste fermée. */
export const MOTIFS_IMPORT_LUT = [
  'fichier_absent',
  'fichier_vide',
  'trop_volumineux',
  'binaire',
  'cube_invalide',
  'taille_hors_bornes',
] as const;
export type MotifImportLut = (typeof MOTIFS_IMPORT_LUT)[number];

export const MESSAGES_IMPORT_LUT: Record<MotifImportLut, string> = {
  fichier_absent: 'Aucun fichier n’a été envoyé.',
  fichier_vide: 'Ce fichier est vide.',
  trop_volumineux: `Ce fichier dépasse ${MAX_LUT_BYTES / (1024 * 1024)} Mo.`,
  binaire: 'Ce fichier n’est pas une LUT .cube valide.',
  cube_invalide: 'Ce fichier n’est pas une LUT .cube valide.',
  taille_hors_bornes:
    `Cette LUT déclare une taille hors des limites acceptées (2 à ${MAX_LUT_SIZE} pas par axe pour un cube, ${MAX_LUT_1D_SIZE} points pour une courbe 1D).`,
};

/**
 * ⚠️ UN AVERTISSEMENT, PAS UNE DÉTECTION. Rien dans le pipeline ne sait lire
 * le profil couleur d'une LUT — ni S-Log3, ni V-Log, ni Rec.709. On dit à la
 * personne ce qu'elle seule peut vérifier.
 */
export const AVERTISSEMENT_COLORIMETRIE =
  'Pour un rendu fidèle, utilisez une LUT conçue pour le profil couleur de votre vidéo.';

/** Ce qu'une lecture réussie apprend du fichier. */
export interface MesureLut {
  /** SHA-256 hexadécimal des octets CANONIQUES. */
  empreinte: string;
  /** Les octets canoniques — ce qui doit être stocké, et rien d'autre. */
  canonique: Buffer;
  /** Poids des octets canoniques. */
  octets: number;
  kind: Lut['kind'];
  taille: number;
  titre: string | null;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** La table lue, pour l'appelant qui voudrait la doser ou la vérifier. */
  lut: Lut;
}

export type LectureLut =
  | { ok: true; mesure: MesureLut }
  | { ok: false; motif: MotifImportLut };

/** L'empreinte d'octets. Jamais du nom, jamais de la table lue. */
export function empreinteLut(octets: Buffer | Uint8Array): string {
  return createHash('sha256').update(octets).digest('hex');
}

/**
 * Un `.cube` est un fichier TEXTE. Un octet NUL n'y a rien à faire.
 *
 * ⚠️ CETTE GARDE PRÉCÈDE LE PARSEUR. `Buffer.toString('utf8')` ne rejette
 * rien : il remplace ce qu'il ne comprend pas par U+FFFD. Un binaire de
 * plusieurs mégaoctets deviendrait un texte de la même taille, découpé en
 * lignes et parcouru mot à mot pour rien.
 */
function contientBinaire(octets: Uint8Array): boolean {
  const echantillon = octets.subarray(0, Math.min(octets.length, 64 * 1024));
  for (const o of echantillon) {
    if (o === 0) return true;
  }
  return false;
}

/**
 * LIT UN FICHIER ET DIT SI C'EST UNE LUT UTILISABLE.
 *
 * L'ordre des gardes est celui du COÛT : on refuse un fichier de dix
 * mégaoctets sur sa taille, avant de le décoder, avant de le parcourir.
 */
export function lireLutAsset(octets: Buffer | Uint8Array | null | undefined): LectureLut {
  if (!octets) return { ok: false, motif: 'fichier_absent' };
  if (octets.length === 0) return { ok: false, motif: 'fichier_vide' };
  if (octets.length > MAX_LUT_BYTES) return { ok: false, motif: 'trop_volumineux' };
  if (contientBinaire(octets)) return { ok: false, motif: 'binaire' };

  /* Un BOM UTF-8 en tête (outils Windows) n'a pas à être retiré ici :
     `parseCube` passe chaque ligne par `trim()`, qui enlève U+FEFF. Le test
     « BOM » de ce module le prouve sur le comportement, pas sur une ligne. */
  const texte = Buffer.from(octets).toString('utf8');
  if (texte.trim().length === 0) return { ok: false, motif: 'fichier_vide' };

  let lut: Lut;
  try {
    lut = parseCube(texte);
  } catch (err) {
    /* ⚠️ LE MESSAGE DU PARSEUR N'EST PAS RELAYÉ TEL QUEL. Il vient d'un
       fichier que l'appelant contrôle : le renvoyer ferait de la réponse un
       écho. La seule nuance utile est la taille hors bornes, qui a sa propre
       explication. */
    const message = err instanceof Error ? err.message : '';
    return { ok: false, motif: /trop grande/.test(message) ? 'taille_hors_bornes' : 'cube_invalide' };
  }

  const canonique = Buffer.from(ecrireCube(lut), 'utf8');
  if (canonique.length > MAX_LUT_BYTES) return { ok: false, motif: 'trop_volumineux' };

  return {
    ok: true,
    mesure: {
      empreinte: empreinteLut(canonique),
      canonique,
      octets: canonique.length,
      kind: lut.kind,
      taille: lut.size,
      titre: typeof lut.title === 'string' && lut.title.trim().length > 0
        ? lut.title.trim().slice(0, 100)
        : null,
      domainMin: lut.domainMin,
      domainMax: lut.domainMax,
      lut,
    },
  };
}
