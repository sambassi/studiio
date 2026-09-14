import type { Lut } from './types';

/**
 * Écriture d'une LUT au format `.cube`, et dosage.
 *
 * Deux usages, un seul écrivain :
 *
 * 1. **Canonicalisation** — une LUT venue d'une image (PNG HALD / tuiles) est
 *    stockée sous forme `.cube` : un seul format au repos, lisible par tous
 *    les moteurs, et une empreinte calculée sur des octets qui ne dépendent
 *    pas de l'outil d'origine.
 * 2. **Dosage** — le moteur de rendu (ffmpeg `lut3d`/`lut1d`) n'a pas
 *    d'intensité : on lui donne un fichier déjà mélangé avec l'identité.
 *
 * ⚠️ DÉTERMINISTE, ET C'EST TOUTE LA VALEUR. Même table → mêmes octets, à
 * l'octet près : c'est ce qui rend l'empreinte stable, donc la déduplication
 * possible. Toute liberté d'écriture (locale, précision variable, `-0`) est
 * verrouillée ici.
 *
 * Le PARSING n'est pas réécrit : `parseCube` reste la seule lecture du format.
 */

/** Six décimales, comme DaVinci Resolve et le générateur du catalogue. */
const DECIMALES = 6;

/** `-0.000000` et `0.000000` sont la même valeur ; une seule graphie. */
function nombre(v: number): string {
  const s = v.toFixed(DECIMALES);
  return s === `-0.${'0'.repeat(DECIMALES)}` ? s.slice(1) : s;
}

function triplet(a: number, b: number, c: number): string {
  return `${nombre(a)} ${nombre(b)} ${nombre(c)}`;
}

/**
 * Le titre passe entre guillemets : il ne doit pas pouvoir en contenir, ni
 * de retour à la ligne — sans quoi le fichier réécrit ne se relirait pas.
 */
function titreSur(title: string | undefined): string | null {
  if (typeof title !== 'string') return null;
  const propre = title.replace(/["\r\n]+/g, ' ').trim();
  return propre.length > 0 ? propre : null;
}

/**
 * Sérialise une LUT (3D ou 1D) en texte `.cube`.
 *
 * `DOMAIN_MIN`/`DOMAIN_MAX` ne sont écrits que s'ils diffèrent du défaut
 * `[0,0,0]`/`[1,1,1]` : un fichier canonique ne porte rien d'implicite.
 */
export function ecrireCube(lut: Lut, titre?: string): string {
  const lignes: string[] = [];
  const t = titreSur(titre ?? lut.title);
  if (t) lignes.push(`TITLE "${t}"`);
  lignes.push(`${lut.kind === '3d' ? 'LUT_3D_SIZE' : 'LUT_1D_SIZE'} ${lut.size}`);
  const [a0, a1, a2] = lut.domainMin;
  const [b0, b1, b2] = lut.domainMax;
  if (a0 !== 0 || a1 !== 0 || a2 !== 0) lignes.push(`DOMAIN_MIN ${triplet(a0, a1, a2)}`);
  if (b0 !== 1 || b1 !== 1 || b2 !== 1) lignes.push(`DOMAIN_MAX ${triplet(b0, b1, b2)}`);

  const table = lut.table;
  for (let i = 0; i < table.length; i += 3) {
    lignes.push(triplet(table[i], table[i + 1], table[i + 2]));
  }
  return `${lignes.join('\n')}\n`;
}

/**
 * Ramène une LUT vers l'identité selon l'intensité.
 *
 * `1` rend la table telle quelle (même objet) ; `0` rend l'identité exacte.
 * L'identité au nœud de grille est la coordonnée du nœud, exprimée dans le
 * domaine de la LUT : `domainMin + (i / (n-1)) · (domainMax − domainMin)`.
 *
 * Exact, et non approché : `lut3d`/`lut1d` interpolent linéairement, et
 * l'interpolation d'un mélange linéaire de deux tables EST le mélange des
 * interpolations. Le résultat est celui qu'un fondu après filtre aurait donné.
 */
export function doserLut(lut: Lut, intensite: number): Lut {
  const k = Math.max(0, Math.min(1, intensite));
  if (k >= 1) return lut;

  const n = lut.size;
  const pas = n - 1;
  const src = lut.table;
  const out = new Float32Array(src.length);
  const mn = lut.domainMin;
  const mx = lut.domainMax;
  const coord = (i: number, c: number) => mn[c] + (i / pas) * (mx[c] - mn[c]);

  if (lut.kind === '1d') {
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      for (let c = 0; c < 3; c++) {
        const id = coord(i, c);
        out[j + c] = id + (src[j + c] - id) * k;
      }
    }
  } else {
    let j = 0;
    for (let b = 0; b < n; b++) {
      const ib = coord(b, 2);
      for (let g = 0; g < n; g++) {
        const ig = coord(g, 1);
        for (let r = 0; r < n; r++) {
          const ir = coord(r, 0);
          out[j] = ir + (src[j] - ir) * k;
          out[j + 1] = ig + (src[j + 1] - ig) * k;
          out[j + 2] = ib + (src[j + 2] - ib) * k;
          j += 3;
        }
      }
    }
  }

  return { ...lut, table: out };
}
