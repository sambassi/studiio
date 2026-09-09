import { MAX_LUT_SIZE } from '@/lib/luts/types';

/**
 * A_9b — LES LOOKS QUI APPARTIENNENT AU COMPTE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE RESSEMBLE A LA BANQUE AUDIO
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Parce que c'est le MEME probleme, et qu'il a deja ete resolu une fois. Une
 * musique de compte n'est pas une entree d'un catalogue partage : c'est un
 * FICHIER, designe par une cle de stockage dont le prefixe prouve a qui il
 * appartient. Une LUT importee est exactement cela.
 *
 * Le catalogue natif (`looks.ts`) garde donc ses identifiants-slugs, et rien
 * n'y est ajoute : un `MyCinema` grave dans le code de tous les comptes serait
 * la marque d'une personne dans la liste de tout le monde. `catalogues-creatifs`
 * l'avait ecrit noir sur blanc avant ce lot : « le jour ou des LUT PAR COMPTE
 * seront possibles, elles vivront dans le stockage du compte ».
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ L'IDENTITE, C'EST L'EMPREINTE DES OCTETS — PAS LE NOM DU FICHIER
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `MyCinema.cube` et `CinemaFinal.cube` avec les memes octets sont LA MEME
 * LUT. Les traiter comme deux entrees ferait deux objets, deux vignettes, deux
 * favoris possibles — et deux rendus differents pour une image identique.
 *
 * Et l'inverse compte autant : deux fichiers DIFFERENTS sous le meme nom
 * doivent rester deux LUT. C'est la lecon deja payee par `PisteAudio.empreinte`.
 */

/** Ce qu'une LUT importee porte, une fois validee et rangee. */
export interface LutUtilisateur {
  /**
   * L'empreinte SHA-256 des octets ORIGINAUX, en hexadecimal.
   *
   * ⚠️ C'EST L'IDENTITE, et c'est aussi la cle de deduplication. Elle n'est
   * jamais calculee sur le nom, ni sur la table parsee : deux ecritures
   * differentes du meme cube — un espace de plus, un commentaire — sont deux
   * fichiers, et le rendu les distinguera.
   */
  empreinte: string;
  /**
   * La cle de l'objet prive, dans le compartiment du compte.
   *
   * ⚠️ CONSTRUITE PAR LE SERVEUR, JAMAIS RECUE. Le navigateur envoie des
   * octets et un nom d'affichage ; il ne choisit pas ou ils atterrissent.
   */
  cle: string;
  /** Le nom affiche. Modifiable plus tard sans toucher a l'objet. */
  nom: string;
  /** Le `TITLE` declare dans le `.cube`, s'il y en avait un. */
  titre: string | null;
  /** Le poids du fichier d'origine. */
  octets: number;
  /** Le nombre de pas par axe. Toujours une 3D dans ce lot. */
  taille: number;
  domainMin: readonly [number, number, number];
  domainMax: readonly [number, number, number];
  /** ISO 8601. */
  importeeLe: string;
}

/**
 * Le plafond de la bibliotheque personnelle.
 *
 * ⚠️ QUARANTE, COMME LES FAVORIS — pas un nombre invente. `FAVORIS_MAX_PAR_FAMILLE`
 * vaut deja 40 et decrit la meme chose : « une vraie collection, pas une liste
 * de courses ». Deux plafonds differents pour deux facons de collectionner des
 * looks n'auraient aucun sens a l'ecran.
 */
export const LUTS_UTILISATEUR_MAX = 40;

/** Un nom d'affichage tient sur une ligne. */
export const NOM_LUT_MAX = 100;

/**
 * LA SEULE LIMITE DE TAILLE DU CHEMIN D'IMPORT.
 *
 * ⚠️ IL Y EN AVAIT DEUX, ET C'ETAIT LE DEFAUT. `rendu-lut` refuse a l'ouverture
 * ce qui depasse 4 Mio ; `luts/types` annoncait 8 Mio a l'import. Un fichier de
 * 6 Mio aurait donc ete accepte, range, affiche — puis ignore au rendu, sans
 * message. On garde la borne du RENDU : accepter ce qui ne sera jamais applique
 * est la pire des deux erreurs.
 *
 * Repere : un `.cube` natif de Studiio (16³) pese 110 Ko, un 33³ du marche
 * environ 1 Mo, un 64³ environ 6 Mo — donc hors limite, et c'est assume.
 */
export const OCTETS_LUT_MAX = 4 * 1024 * 1024;

/** Les bornes de taille de cube, reprises du parseur et du rendu. */
export const TAILLE_CUBE_MIN = 2;
export const TAILLE_CUBE_MAX = MAX_LUT_SIZE;

/** Le segment de stockage des LUT du compte. */
export const SEGMENT_LUT = 'lut';

/**
 * La cle d'une LUT du compte.
 *
 * Le prefixe PORTE la propriete — meme primitive que `cleAudioValide` et
 * `cleSourceAvatarDuCompte`. L'empreinte fait le nom : deux imports du meme
 * contenu retombent sur le meme objet, sans qu'on ait a le chercher.
 */
export function cleLutUtilisateur(userId: string, empreinte: string): string {
  return `${userId}/${SEGMENT_LUT}/${empreinte}.cube`;
}

export function cleLutValide(cle: unknown, userId: string): cle is string {
  if (typeof cle !== 'string' || cle.length === 0 || cle.length > 400) return false;
  if (!userId) return false;
  if (cle.includes('..') || cle.includes('\\') || cle.includes('://')) return false;
  return cle.startsWith(`${userId}/${SEGMENT_LUT}/`);
}

/** Une empreinte SHA-256 en hexadecimal, et rien d'autre. */
export function empreinteValide(brut: unknown): brut is string {
  return typeof brut === 'string' && /^[0-9a-f]{64}$/.test(brut);
}

export function nomLutValide(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const propre = brut.replace(/[\r\n\t]+/g, ' ').trim().slice(0, NOM_LUT_MAX);
  return propre.length > 0 ? propre : null;
}

function triplet(brut: unknown): [number, number, number] | null {
  if (!Array.isArray(brut) || brut.length !== 3) return null;
  const v = brut.map(Number);
  return v.every((n) => Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;
}

/**
 * Relit une entree rangee en base.
 *
 * ⚠️ RELUE AVEC LE COMPTE, comme la banque audio. Sans `userId`, une cle
 * d'autrui entrerait dans le catalogue — ou elle serait affichee, cherchee,
 * mise en favori, et finirait par ressembler a une LUT legitime.
 */
export function lutUtilisateurValide(brut: unknown, userId: string): LutUtilisateur | null {
  if (!brut || typeof brut !== 'object') return null;
  const o = brut as Record<string, unknown>;
  if (!empreinteValide(o.empreinte)) return null;
  if (!cleLutValide(o.cle, userId)) return null;
  const nom = nomLutValide(o.nom);
  if (nom === null) return null;
  const octets = Number(o.octets);
  if (!Number.isFinite(octets) || octets <= 0 || octets > OCTETS_LUT_MAX) return null;
  const taille = Number(o.taille);
  if (!Number.isInteger(taille) || taille < TAILLE_CUBE_MIN || taille > TAILLE_CUBE_MAX) {
    return null;
  }
  const min = triplet(o.domainMin) ?? [0, 0, 0];
  const max = triplet(o.domainMax) ?? [1, 1, 1];
  const importeeLe = typeof o.importeeLe === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(o.importeeLe)
    ? o.importeeLe : new Date(0).toISOString();
  const titre = typeof o.titre === 'string' ? o.titre.slice(0, NOM_LUT_MAX) : null;
  return {
    empreinte: o.empreinte, cle: o.cle, nom, titre, octets, taille,
    domainMin: min, domainMax: max, importeeLe,
  };
}

/** Le catalogue du compte, assaini. Les doublons d'empreinte sont fondus. */
export function lutsUtilisateurValides(
  brut: unknown, userId: string,
): readonly LutUtilisateur[] {
  if (!Array.isArray(brut)) return [];
  const vues = new Set<string>();
  const sortie: LutUtilisateur[] = [];
  for (const v of brut) {
    const lut = lutUtilisateurValide(v, userId);
    if (!lut || vues.has(lut.empreinte)) continue;
    vues.add(lut.empreinte);
    sortie.push(lut);
    if (sortie.length >= LUTS_UTILISATEUR_MAX) break;
  }
  return sortie;
}

export function lutParEmpreinte(
  luts: readonly LutUtilisateur[], empreinte: string,
): LutUtilisateur | undefined {
  return luts.find((l) => l.empreinte === empreinte);
}
