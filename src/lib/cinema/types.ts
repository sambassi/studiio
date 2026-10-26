/**
 * STUDIIO CINEMA IA — le vocabulaire du module, et lui seul.
 *
 * Cinema IA est un module A PART de Creer et de l'Autopilote : il ne partage
 * avec eux que des briques PURES et deja prouvees (debit de parole, Remotion,
 * ffmpeg). Il ne lit ni n'ecrit aucune de leurs structures, pour qu'un
 * changement dans l'un ne puisse pas casser l'autre.
 *
 * Un FILM est un arbre a trois etages, et cet ordre est ce qui rend la
 * regeneration d'UNE scene possible sans toucher aux autres :
 *
 *     Film ── Scene[] ── PlanCinema[]        (plan = un « shot »)
 *
 * Chaque scene porte son EMPREINTE (`empreinte.ts`) : le hash de ce qui la
 * decrit. Tant que l'empreinte ne change pas, ses medias restent valides et
 * aucun fournisseur n'est rappele — c'est la seule defense contre un cout qui
 * se repaie a chaque aperçu.
 */

import { VIDEO_SIZE } from '@/lib/creer/designSpec';

/** Les deux cadrages livres. Le format est une propriete du FILM, pas du rendu. */
export type FormatFilm = '9:16' | '16:9';

/**
 * Niveaux de qualite. Ils ne changent QUE la resolution et le fournisseur
 * visuel retenu — jamais le montage, jamais la voix (cf. `couts.ts`).
 */
export type NiveauQualite = 'brouillon' | 'standard' | 'cinema';

/** Les intentions dramatiques, dans l'ordre ou le scenariste les pose. */
export type IntentionScene = 'exposition' | 'incident' | 'confrontation' | 'resolution' | 'epilogue';

/** Cadres disponibles pour un plan. */
export type CadrePlan = 'ensemble' | 'moyen' | 'rapproche' | 'insert';

/**
 * Une REFERENCE de personnage : l'apparence a reinjecter dans chaque plan ou
 * il figure. Versionnee, jamais ecrasee — remplacer la reference d'un
 * personnage deja filme invaliderait des scenes validees sans trace, ce qui
 * est exactement l'incident avatar du 2026-10-09. Une nouvelle reference =
 * une nouvelle version ; les anciennes restent lisibles.
 */
export interface ReferencePersonnage {
  id: string;
  version: number;
  /** Apparence stable, en mots. C'est elle qui part dans un prompt. */
  description: string;
  /** Visuel importe localement (chemin ou URL). `null` = pas encore de visuel. */
  urlImage: string | null;
  creeeLe: string;
}

export interface Personnage {
  id: string;
  nom: string;
  role: string;
  /** Voix de ses repliques (identifiant de voix TTS). */
  voix: string;
  references: ReferencePersonnage[];
  /** Reference active ; les plans deja rendus gardent celle qu'ils ont eue. */
  referenceActiveId: string | null;
}

/**
 * Une ligne dite. Deux genres, et la distinction n'est pas cosmetique :
 *
 *  - `replique` : du texte ENTRE GUILLEMETS dans l'histoire. Un personnage le
 *    dit, son nom s'affiche.
 *  - `narration` : une phrase de recit. Le NARRATEUR la dit. Lui coller le
 *    nom d'un personnage ferait lire « Nina : Marco la regarde sans bouger »,
 *    ce qui est faux a l'image comme a l'oreille.
 *
 * Le scenariste local n'invente pas de dialogue : il ne peut donc produire
 * une `replique` que si l'utilisateur en a ecrit une.
 */
export interface Dialogue {
  personnageId: string | null;
  genre: 'replique' | 'narration';
  texte: string;
  /** Duree ESTIMEE au debit de parole, jamais imposee a la voix. */
  dureeS: number;
}

export interface PlanCinema {
  id: string;
  cadre: CadrePlan;
  /** Ce que l'on voit. Sert de prompt visuel quand un fournisseur est branche. */
  description: string;
  /** Personnages presents, par id. */
  personnages: string[];
  dialogue: Dialogue | null;
  dureeS: number;
  /** Media du plan. `null` = carte de plan dessinee par Remotion (cout zero). */
  mediaUrl: string | null;
  origineMedia: 'aucun' | 'import' | 'genere';
  /** Reference utilisee au moment du rendu de ce plan (tracabilite). */
  referencesUtilisees?: string[];
}

export interface SceneCinema {
  id: string;
  index: number;
  titre: string;
  lieu: string;
  intention: IntentionScene;
  personnages: string[];
  plans: PlanCinema[];
  /** `validee` = l'utilisateur la garde ; une regeneration du film l'epargne. */
  etat: 'brouillon' | 'validee';
  /** Hash du contenu de la scene au dernier rendu (voir `empreinte.ts`). */
  empreinte: string;
  /** Cout fournisseur deja depense sur cette scene, en USD. */
  coutUsd: number;
}

export interface Film {
  id: string;
  titre: string;
  /** L'histoire telle que l'utilisateur l'a ecrite — la source de verite. */
  histoire: string;
  format: FormatFilm;
  qualite: NiveauQualite;
  personnages: Personnage[];
  scenes: SceneCinema[];
  creeLe: string;
  majLe: string;
}

/** Duree totale d'un film : la somme des plans, jamais une valeur stockee. */
export function dureeFilm(film: Pick<Film, 'scenes'>): number {
  return Math.round(
    film.scenes.reduce((t, s) => t + s.plans.reduce((u, p) => u + p.dureeS, 0), 0) * 10,
  ) / 10;
}

/** Duree d'une scene. */
export function dureeScene(scene: Pick<SceneCinema, 'plans'>): number {
  return Math.round(scene.plans.reduce((t, p) => t + p.dureeS, 0) * 10) / 10;
}

/**
 * Dimensions du rendu, DERIVEES de `VIDEO_SIZE` — la table du depot, et la
 * seule. Les reecrire ici aurait cree un seul endroit de plus a corriger le
 * jour ou une taille change ; le contrat `C-FORMAT` l'interdit d'ailleurs
 * explicitement.
 *
 * `brouillon` est la moitie exacte : meme ratio, quatre fois moins de pixels
 * a rendre.
 */
const moitie = (t: { w: number; h: number }) => ({ w: Math.round(t.w / 2), h: Math.round(t.h / 2) });
const PLEIN: Record<FormatFilm, { w: number; h: number }> = {
  '9:16': { ...VIDEO_SIZE['9:16'] },
  '16:9': { ...VIDEO_SIZE['16:9'] },
};

export const TAILLES: Record<NiveauQualite, Record<FormatFilm, { w: number; h: number }>> = {
  brouillon: { '9:16': moitie(PLEIN['9:16']), '16:9': moitie(PLEIN['16:9']) },
  standard: PLEIN,
  cinema: PLEIN,
};
