/**
 * CARTES LISIBLES EN 16:9 ET 1:1 (Créer, projets aux défauts lisibles v2).
 *
 * Constat (démo « LE SPORT », 21/10) : « CARDIO COMPLET » à 26 px de corps
 * (capitales 19 px = 1,76 % de 1080) dans une case de 525 px en 16:9 —
 * illisible sur téléphone. Cible par format, en fraction de la HAUTEUR vidéo :
 *   - 16:9 : texte ≈ 4 % (43 px sur 1080) ;
 *   - 1:1  : texte ≈ 3,4 % (37 px sur 1080) ;
 *   - valeur ≥ 1,2 × le texte ; icône ≥ son ancienne taille.
 *
 * La taille ne doit JAMAIS faire sortir un texte de sa carte ni les cartes de
 * leur cadre (`CARDS_FRAME`, 84 % × 48 % de l'image, photographié puis
 * blitté) : la mise en page est ESTIMÉE (chasse prudente des polices,
 * `chassePolice`, mots jamais coupés), et la taille / les espacements
 * baissent jusqu'à ce que tout tienne — jamais sous la taille d'avant. Rien
 * ne tient : `null`, le rendu d'avant. Disposition :
 *   - 16:9 (grille de 3) : icône à gauche, titre (replié) puis valeur dessous ;
 *   - 1:1 (colonne) : icône | titre (replié) | valeur, comme avant.
 * L'échelle choisie par l'utilisateur s'applique ENSUITE (facteur au-dessus).
 * Module PUR.
 */
import { cardRatios } from '@/lib/creer/designSpec';
import { chassePolice, enCapitales, lignesRepliees } from '@/lib/creer/zones-sures-916';

/** Cible du texte de carte, en fraction de la hauteur vidéo. */
export const CIBLE_TEXTE_CARTE = { paysage: 0.04, carre: 0.034 } as const;
/** La valeur est au moins ce multiple du texte. */
export const RAPPORT_VALEUR = 1.2;
/** Interligne des cartes ajustées (titre replié, valeur). */
export const INTERLIGNE_CARTES = 1.2;
/** Part de la largeur estimée réellement utilisable (marge de sécurité de l'estimation). */
const MARGE_LARGEUR = 0.92;

export interface TaillesCartesLisibles {
  /** Ratios (fraction de la LARGEUR vidéo), à la place de `cardRatios`. */
  ratios: { text: number; value: number; icon: number; gap: number; padX: number; padY: number; radius: number };
  /** 16:9 : icône à gauche, titre puis valeur empilés. */
  empile: boolean;
  interligne: number;
}

export function taillesCartesLisibles(p: {
  /** Grille paysage (16:9) ou colonne (1:1). */
  paysage: boolean;
  largeur: number;
  hauteur: number;
  cartes: ReadonlyArray<{ title?: string | null; value?: string | null }>;
  police?: string | null;
  casse?: 'none' | 'uppercase' | 'lowercase';
}): TaillesCartesLisibles | null {
  const { largeur: W, hauteur: H, paysage } = p;
  if (!(W > 0) || !(H > 0) || !p.cartes.length) return null;
  const base = cardRatios(paysage);
  const texteAvant = W * base.text;
  const cible = H * (paysage ? CIBLE_TEXTE_CARTE.paysage : CIBLE_TEXTE_CARTE.carre);
  if (cible <= texteAvant + 1e-6) return null;
  const cadreL = W * 0.84;
  const cadreH = H * 0.48;
  const police = p.police ?? 'Inter';
  const chTitre = (t: string) => chassePolice(police, enCapitales(t, p.casse ?? 'none', 'none'));
  const chValeur = chassePolice(police, true);
  const n = p.cartes.length;

  const tient = (texte: number, esp: number): boolean => {
    const valeur = texte * RAPPORT_VALEUR;
    const icone = Math.max(W * base.icon, texte * 1.25);
    const gap = W * base.gap * esp;
    const padX = W * base.padX * esp;
    const padY = W * base.padY * esp;
    const lh = INTERLIGNE_CARTES;
    let hauteurs: number[] = [];
    for (const c of p.cartes) {
      const titre = (c.title ?? '').trim();
      const val = (c.value ?? '').trim();
      const ch = chTitre(titre);
      const largeurValeur = val.length * chValeur.em * valeur;
      let utile: number;
      if (paysage) {
        const col = (cadreL - 2 * gap) / 3;
        utile = (col - 2 * padX - icone - gap) * MARGE_LARGEUR;
        if (largeurValeur > utile) return false;
      } else {
        utile = (cadreL - 2 * padX - icone - (val ? largeurValeur + gap : 0) - gap) * MARGE_LARGEUR;
      }
      if (!(utile > 0)) return false;
      // Mots jamais coupés : le plus long tient sur une ligne.
      const plusLong = titre.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
      if (plusLong * ch.em * texte > utile) return false;
      const lignes = Math.max(1, lignesRepliees(titre, texte, utile, ch));
      const blocTexte = lignes * texte * lh + (paysage && val ? valeur * lh : 0);
      hauteurs.push(2 * padY + Math.max(icone, blocTexte, paysage ? 0 : valeur * lh));
    }
    if (paysage) {
      // Grille de 3 : chaque rangée prend la hauteur de sa plus haute carte.
      const rangs: number[] = [];
      for (let i = 0; i < n; i += 3) rangs.push(Math.max(...hauteurs.slice(i, i + 3)));
      hauteurs = rangs;
    }
    const total = hauteurs.reduce((t, h) => t + h, 0) + (hauteurs.length - 1) * gap;
    return total <= cadreH;
  };

  // La plus grande taille d'abord ; à taille égale, les espacements d'origine d'abord.
  for (let texte = cible; texte > texteAvant + 1e-6; texte *= 0.97) {
    for (const esp of [1, 0.75, 0.5]) {
      if (tient(texte, esp)) {
        return {
          ratios: {
            text: texte / W, value: (texte * RAPPORT_VALEUR) / W, icon: Math.max(base.icon, (texte * 1.25) / W),
            gap: base.gap * esp, padX: base.padX * esp, padY: base.padY * esp, radius: base.radius,
          },
          empile: paysage,
          interligne: INTERLIGNE_CARTES,
        };
      }
    }
  }
  return null;
}
