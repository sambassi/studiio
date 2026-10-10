/**
 * LISSAGE — L'APERÇU EN DIRECT, dans le navigateur.
 *
 * Le rendu FINAL est fait par ffmpeg sur le serveur (`bilateral`, voir
 * `parametresLissage`). Pendant que le curseur bouge, on ne lance AUCUN
 * transcodage ni aucun fournisseur : on applique le MÊME algorithme — un
 * filtre bilatéral, mêmes paramètres — à l'image AFFICHÉE (photo, ou image
 * courante d'une vidéo), à sa taille d'affichage.
 *
 * L'image affichée est réduite : le rayon spatial est donc mis à l'échelle
 * (`echelle` = largeur affichée / largeur réelle), pour que l'effet visible
 * corresponde à ce que ffmpeg fera en pleine résolution. Le seuil de valeur
 * (`sigmaR`) ne dépend pas de la taille. C'est un APERÇU fidèle, pas le
 * fichier : ffmpeg travaille en YUV, ici en RVB.
 *
 * Module PUR : aucune dépendance au DOM, testable tel quel.
 */
import { parametresLissage } from '@/lib/avatar/preparation-source-regles';

/**
 * Applique le lissage à une image RVBA (`donnees`, `largeur` × `hauteur`) et
 * rend une NOUVELLE image : l'entrée n'est jamais modifiée (l'original reste
 * l'original). 0 % rend une copie identique.
 */
export function lisserImage(
  donnees: Uint8ClampedArray, largeur: number, hauteur: number, lissage: number, echelle = 1,
): Uint8ClampedArray {
  const sortie = new Uint8ClampedArray(donnees);
  const p = parametresLissage(lissage);
  if (!p || largeur <= 0 || hauteur <= 0) return sortie;
  const sigmaS = Math.max(0.35, p.sigmaS * Math.max(0.05, Math.min(1, echelle)));
  const rayon = Math.max(1, Math.min(6, Math.ceil(sigmaS * 2)));
  const sigmaR = p.sigmaR * 255;
  // Poids spatiaux et de valeur pré-calculés (la boucle reste rapide à la taille d'affichage).
  const poidsS: number[] = [];
  for (let dy = -rayon; dy <= rayon; dy += 1) {
    for (let dx = -rayon; dx <= rayon; dx += 1) poidsS.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS)));
  }
  const poidsR = new Float32Array(256);
  for (let d = 0; d < 256; d += 1) poidsR[d] = Math.exp(-(d * d) / (2 * sigmaR * sigmaR));

  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const i = (y * largeur + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const centre = donnees[i + c];
        let somme = 0; let total = 0; let k = 0;
        for (let dy = -rayon; dy <= rayon; dy += 1) {
          const yy = Math.min(hauteur - 1, Math.max(0, y + dy));
          for (let dx = -rayon; dx <= rayon; dx += 1) {
            const xx = Math.min(largeur - 1, Math.max(0, x + dx));
            const v = donnees[(yy * largeur + xx) * 4 + c];
            const w = poidsS[k] * poidsR[Math.abs(v - centre)];
            somme += v * w; total += w; k += 1;
          }
        }
        sortie[i + c] = total > 0 ? Math.round(somme / total) : centre;
      }
    }
  }
  return sortie;
}

/**
 * Dessine `source` (image ou vidéo à son image COURANTE) dans `toile`, à la
 * taille d'affichage, lissée — sans toucher à la source. `largeurReelle` sert
 * à mettre le rayon à l'échelle. Rend `false` si l'image n'est pas lisible
 * (pas encore chargée, origine étrangère).
 */
export function dessinerApercuLisse(
  toile: HTMLCanvasElement, source: CanvasImageSource, largeurReelle: number, hauteurReelle: number, lissage: number, largeurMax = 360,
): boolean {
  if (!(largeurReelle > 0 && hauteurReelle > 0)) return false;
  const largeur = Math.max(1, Math.round(Math.min(largeurMax, largeurReelle)));
  const hauteur = Math.max(1, Math.round((largeur * hauteurReelle) / largeurReelle));
  toile.width = largeur;
  toile.height = hauteur;
  const ctx = toile.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!ctx) return false;
  try {
    ctx.drawImage(source, 0, 0, largeur, hauteur);
    const image = ctx.getImageData(0, 0, largeur, hauteur);
    image.data.set(lisserImage(image.data, largeur, hauteur, lissage, largeur / largeurReelle));
    ctx.putImageData(image, 0, 0);
    return true;
  } catch {
    return false;
  }
}
