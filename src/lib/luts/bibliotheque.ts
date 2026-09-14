import {
  EMPREINTE_LUT_LONGUEUR, MAX_LUT_1D_SIZE, MAX_LUT_BYTES, MAX_LUT_SIZE,
  type LutAsset, type LutRef, type OrigineLut,
} from './types';

/**
 * La bibliothèque de LUT d'un compte : clés, bornes, relecture.
 *
 * Module PUR et isomorphe — aucun accès au stockage ni à la base. Il dit ce
 * qu'est une fiche valide, où vit son objet, et ce qu'un compte a le droit de
 * désigner. La persistance (table `lut_assets`) et l'API viennent au lot
 * suivant et s'appuient sur ces fonctions ; le wizard Créer et l'Autopilote
 * relisent une fiche par le même chemin.
 *
 * ⚠️ LA CLÉ PORTE LA PROPRIÉTÉ. Elle commence par l'identifiant du compte :
 * c'est la même primitive que les clés audio et avatar de l'Autopilote. Une
 * fiche dont la clé désigne un autre compte n'est pas « réparée », elle est
 * écartée — elle n'aurait pas dû exister.
 */

/** Plafond de la bibliothèque personnelle : une collection, pas une liste de courses. */
export const LUTS_MAX = 40;

/** Longueur maximale du nom affiché et du titre. */
export const NOM_LUT_MAX = 100;

/** Le segment de stockage des LUT du compte. Même valeur que le namespace refusé au relais public. */
export const SEGMENT_LUT = 'lut';

/**
 * La clé de l'objet privé d'une LUT.
 *
 * L'empreinte fait le nom : deux imports du même contenu retombent sur le
 * même objet. Le nom de fichier n'entre JAMAIS dans la clé — `../x.cube`
 * n'est qu'un libellé à nettoyer, pas un chemin à atteindre.
 */
export function cleLutAsset(userId: string, empreinte: string): string {
  return `${userId}/${SEGMENT_LUT}/${empreinte}.cube`;
}

export function cleLutValide(cle: unknown, userId: string): cle is string {
  if (typeof cle !== 'string' || cle.length === 0 || cle.length > 400) return false;
  if (!userId) return false;
  if (cle.includes('..') || cle.includes('\\') || cle.includes('://')) return false;
  return cle.startsWith(`${userId}/${SEGMENT_LUT}/`);
}

/** Une empreinte SHA-256 en hexadécimal minuscule, et rien d'autre. */
export function empreinteValide(brut: unknown): brut is string {
  return typeof brut === 'string'
    && brut.length === EMPREINTE_LUT_LONGUEUR
    && /^[0-9a-f]+$/.test(brut);
}

/** Nom nettoyé et borné, ou `null` s'il ne reste rien. */
export function nomLutValide(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const propre = brut.replace(/[\r\n\t]+/g, ' ').trim().slice(0, NOM_LUT_MAX);
  return propre.length > 0 ? propre : null;
}

/**
 * Le nom d'affichage par défaut : le `TITLE` du fichier, sinon son nom
 * nettoyé de son chemin et de son extension.
 */
export function nomParDefaut(titre: string | null, nomFichier: unknown): string {
  const t = nomLutValide(titre);
  if (t) return t;
  const brut = typeof nomFichier === 'string' ? nomFichier : '';
  const base = brut.split(/[\\/]/).pop() ?? '';
  const sansExtension = base.replace(/\.(cube|png)$/i, '');
  return nomLutValide(sansExtension) ?? 'Mon look';
}

function triplet(brut: unknown): [number, number, number] | null {
  if (!Array.isArray(brut) || brut.length !== 3) return null;
  const v = brut.map(Number);
  return v.every((n) => Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;
}

const ORIGINES: readonly OrigineLut[] = ['cube', 'png'];

/** Bornes de taille par nature — les mêmes que le parseur. */
export function tailleLutValide(kind: unknown, taille: unknown): taille is number {
  if (!Number.isInteger(taille) || (taille as number) < 2) return false;
  if (kind === '3d') return (taille as number) <= MAX_LUT_SIZE;
  if (kind === '1d') return (taille as number) <= MAX_LUT_1D_SIZE;
  return false;
}

/**
 * Relit une fiche rangée en base.
 *
 * ⚠️ RELUE AVEC LE COMPTE. Sans `userId`, une clé d'autrui entrerait dans la
 * bibliothèque — affichée, choisie, et elle finirait par ressembler à une LUT
 * légitime. Une fiche incohérente est écartée, jamais réparée.
 */
export function lutAssetValide(brut: unknown, userId: string): LutAsset | null {
  if (!brut || typeof brut !== 'object') return null;
  const o = brut as Record<string, unknown>;
  if (!empreinteValide(o.empreinte)) return null;
  if (!cleLutValide(o.cle, userId)) return null;
  const nom = nomLutValide(o.nom);
  if (nom === null) return null;
  const kind = o.kind === '3d' || o.kind === '1d' ? o.kind : null;
  if (!kind) return null;
  const origine = ORIGINES.includes(o.origine as OrigineLut) ? (o.origine as OrigineLut) : null;
  if (!origine) return null;
  const octets = Number(o.octets);
  if (!Number.isFinite(octets) || octets <= 0 || octets > MAX_LUT_BYTES) return null;
  const taille = Number(o.taille);
  if (!tailleLutValide(kind, taille)) return null;
  const min = triplet(o.domainMin) ?? [0, 0, 0];
  const max = triplet(o.domainMax) ?? [1, 1, 1];
  const importeeLe = typeof o.importeeLe === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(o.importeeLe)
    ? o.importeeLe
    : new Date(0).toISOString();
  const titre = typeof o.titre === 'string' ? o.titre.slice(0, NOM_LUT_MAX) : null;
  return {
    empreinte: o.empreinte, cle: o.cle, nom, titre, kind, origine, taille, octets,
    domainMin: min, domainMax: max, importeeLe,
  };
}

/** La bibliothèque du compte, assainie. Les doublons d'empreinte sont fondus, le plafond tenu. */
export function lutAssetsValides(brut: unknown, userId: string): readonly LutAsset[] {
  if (!Array.isArray(brut)) return [];
  const vues = new Set<string>();
  const sortie: LutAsset[] = [];
  for (const v of brut) {
    const lut = lutAssetValide(v, userId);
    if (!lut || vues.has(lut.empreinte)) continue;
    vues.add(lut.empreinte);
    sortie.push(lut);
    if (sortie.length >= LUTS_MAX) break;
  }
  return sortie;
}

export function lutParEmpreinte(
  luts: readonly LutAsset[], empreinte: string,
): LutAsset | undefined {
  return luts.find((l) => l.empreinte === empreinte);
}

/**
 * Référence relue d'un brouillon, d'un `metadata` ou d'un profil.
 *
 * Une intensité hors plage revient à la pleine intensité ; une empreinte
 * douteuse rend `undefined` — la référence ne désignerait rien de sûr.
 */
export function lutRefValide(brut: unknown): LutRef | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const o = brut as Record<string, unknown>;
  if (!empreinteValide(o.empreinte)) return undefined;
  const intensite = typeof o.intensite === 'number' && Number.isFinite(o.intensite)
    && o.intensite >= 0 && o.intensite <= 1
    ? o.intensite
    : 1;
  return { empreinte: o.empreinte, nom: nomLutValide(o.nom) ?? '', intensite };
}

/** La référence légère d'une fiche, à pleine intensité. */
export function refDeLutAsset(asset: LutAsset, intensite = 1): LutRef {
  return { empreinte: asset.empreinte, nom: asset.nom, intensite: Math.max(0, Math.min(1, intensite)) };
}
