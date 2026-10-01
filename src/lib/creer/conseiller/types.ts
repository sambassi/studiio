/**
 * CONSEILLER ÉDITORIAL — types partagés.
 *
 * Un conseil ne modifie RIEN : il dit ce qui a été MESURÉ, ce que ça pose
 * comme problème, et ce que l'utilisateur peut faire. Toute mesure qui
 * n'existe pas (rendu sans images de textes, analyse ancienne sans couleur…)
 * est déclarée « non mesurée », jamais devinée.
 */

export type SectionConseil = 'Montage' | 'Rushes' | 'Rythme' | 'Textes' | 'CTA';
export type PrioriteConseil = 'FAIBLE' | 'MOYENNE' | 'IMPORTANTE';

export interface Conseil {
  /** Identifiant stable (ignorer un conseil le retrouve d'une fois sur l'autre). */
  id: string;
  section: SectionConseil;
  priorite: PrioriteConseil;
  /** Élément visé : 'accroche', 'carte:2', 'cta', 'extrait:5', 'rush:…'. */
  cible: string;
  texteActuel: string | null;
  /** Le problème, en mots simples. */
  probleme: string;
  /** Ce qu'il faut faire, en mots simples. */
  conseil: string;
  propositionReecrite: string | null;
  placementRecommande: string | null;
  dureeRecommandee: string | null;
  /** Les chiffres qui fondent le conseil (vérifiables, jamais affichés tels quels). */
  mesures?: Record<string, number | string | boolean | null>;
}

/** Ce que le conseiller sait mesurer pour CETTE vidéo. */
export interface CouvertureConseils {
  textes: boolean;
  /** Taille et contraste réels des textes (images du rendu hybride). */
  lisibilite: boolean;
  /** Zones calmes de l'image (vidéo de base, rendu hybride). */
  placement: boolean;
  couleur: boolean;
  repetition: boolean;
  rythme: boolean;
  /** Toujours faux : Studiio ne reconnaît ni visages ni valeurs de plan. */
  visages: false;
}

export interface RapportConseils {
  version: 1;
  profil: string;
  conseils: Conseil[];
  couverture: CouvertureConseils;
  /** 0..1 — écart visuel moyen de chaque extrait avec le plus proche des autres. */
  scoreDifferenceVisuelle: number | null;
}
