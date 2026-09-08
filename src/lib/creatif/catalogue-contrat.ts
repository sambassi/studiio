/**
 * A_3 — LE CONTRAT COMMUN DE LA BIBLIOTHÈQUE CRÉATIVE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN SEUL CONTRAT POUR QUATRE FAMILLES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * LUT, styles de texte, animations et transitions posent les mêmes questions :
 * comment les nommer, les ranger, les chercher, les mettre en favori, dire
 * s'ils sont réellement rendus. Écrire quatre fois les mêmes réponses les
 * ferait diverger au troisième ajout — et la recherche marcherait sur trois
 * familles et pas la quatrième.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ `rendu` EST LE CHAMP QUI EMPÊCHE DE MENTIR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une entrée peut exister dans le catalogue sans que le moteur sache la
 * produire. Ce champ le dit, et l'écran n'affiche que ce qui est rendu :
 * une carte cliquable qui ne change rien à la vidéo est pire qu'une absence,
 * parce qu'elle se découvre après le rendu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ `version` N'EST PAS DE LA DÉCORATION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le jour où l'on retouche ce qu'un effet produit, son identifiant doit
 * changer — sinon les anciens rendus, réutilisés sur leur identité, sortiraient
 * avec l'ancien effet sous un nom qui en promet un autre.
 */

/** Les familles. Fermé : une cinquième demanderait son propre rendu. */
export const FAMILLES_CREATIVES = [
  'lut', 'style-texte', 'animation-texte', 'transition',
  // A_3e : un preset n'est pas un effet, c'est une COMBINAISON d'effets. Il
  // se cherche et se trie comme les autres, d'ou sa place dans le contrat.
  'preset',
  // A_4 : un sous-titre n'est pas un texte de marque. Il partage ASS/libass
  // avec les textes, mais son CONTENU vient de la parole, pas de l'ecran.
  'caption',
  // A_5 : une musique n'est pas un effet — c'est un FICHIER du compte. Elle
  // se cherche et se met en favori comme le reste, d'ou sa place ici.
  'audio',
] as const;
export type FamilleCreative = (typeof FAMILLES_CREATIVES)[number];

/**
 * Les rayons de la bibliothèque, communs aux quatre familles.
 *
 * Ils ne décrivent pas une technique mais une INTENTION — « je veux que ça
 * fasse cinéma », « je veux que ça bouge ». C'est ce qu'une personne cherche,
 * et non « contraste 1,14 ».
 */
export const CATEGORIES_CREATIVES = [
  'cinema', 'social', 'portrait', 'ambiance', 'energie', 'sobre',
] as const;
export type CategorieCreative = (typeof CATEGORIES_CREATIVES)[number];

export const LIBELLES_CATEGORIE: Record<CategorieCreative, string> = {
  cinema: 'Cinéma',
  social: 'Social',
  portrait: 'Portrait',
  ambiance: 'Ambiance',
  energie: 'Énergie',
  sobre: 'Sobre',
};

/** Une entrée de catalogue, quelle que soit sa famille. */
export interface EntreeCreative {
  id: string;
  nom: string;
  famille: FamilleCreative;
  categorie: CategorieCreative;
  /** Les mots par lesquels on la cherche. Minuscules, sans accent superflu. */
  tags: readonly string[];
  /** Une ligne, à l'écran, sous le nom. */
  description: string;
  /**
   * `true` seulement si le MOTEUR sait produire cet effet aujourd'hui.
   * L'écran n'affiche que celles-là.
   */
  rendu: boolean;
  /** `look-v1`, `pop-v1`… Change quand le RÉSULTAT change. */
  version: string;
}

/** L'ordre d'affichage : la catégorie, puis le nom. Déterministe. */
export function trierEntrees<T extends EntreeCreative>(entrees: readonly T[]): T[] {
  const rang = (c: CategorieCreative) => CATEGORIES_CREATIVES.indexOf(c);
  return [...entrees].sort((a, b) => (
    rang(a.categorie) - rang(b.categorie) || a.nom.localeCompare(b.nom, 'fr')
  ));
}

/**
 * Réduit un texte à sa forme cherchable : minuscules, sans accents.
 *
 * ⚠️ SANS CELA, « cinema » NE TROUVE PAS « Cinéma ». C'est le premier mot
 * qu'une personne tape, et le premier échec qu'elle rencontrerait.
 */
export function normaliserRecherche(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Cherche dans le nom, les tags et la catégorie.
 *
 * Une requête vide rend TOUT : un champ de recherche qui vide la grille
 * quand on efface sa saisie donne l'impression d'avoir cassé quelque chose.
 */
export function chercher<T extends EntreeCreative>(
  entrees: readonly T[], requete: string,
): T[] {
  const q = normaliserRecherche(requete ?? '');
  if (q === '') return [...entrees];
  const mots = q.split(/\s+/).filter(Boolean);
  return entrees.filter((e) => {
    const foin = normaliserRecherche(
      `${e.nom} ${e.categorie} ${LIBELLES_CATEGORIE[e.categorie]} ${e.tags.join(' ')}`,
    );
    // TOUS les mots doivent être là : « cinema chaud » ne doit pas rendre
    // tout le rayon cinéma.
    return mots.every((m) => foin.includes(m));
  });
}
