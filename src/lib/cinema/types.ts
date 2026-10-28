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

export type GenreMedia = 'image' | 'video';

/**
 * Le media d'un plan : une image ou une video LOCALE, mesuree a l'import.
 *
 * Les dimensions et la duree sont stockees parce qu'elles decident du
 * montage (cadrage sans deformation, coupe ou image figee). Les redemander a
 * ffprobe a chaque rendu couterait une sonde par plan et par passe.
 */
export interface MediaPlan {
  /** Chemin LOCAL servi par `public/`, toujours sous `cinema/`. */
  url: string;
  genre: GenreMedia;
  largeur: number;
  hauteur: number;
  /** Duree du media. `null` pour une image. */
  dureeS: number | null;
  octets: number;
  origine: 'import' | 'genere';
  /**
   * Fournisseur de generation (lot 3) a l'origine du media, quand
   * `origine === 'genere'`. Sert UNIQUEMENT a la tracabilite et au rapport
   * de continuite (`generation/coherence.ts`) ; ne change rien au montage.
   */
  fournisseurGeneration?: string;
  /**
   * Garder le son du media. Defaut `false` : le son d'ambiance d'un rush et
   * la voix du plan se couvrent, et c'est la parole qu'on perd.
   */
  sonActif?: boolean;
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
  /**
   * Media du plan. `null` = carte de plan dessinee par Remotion (cout zero).
   * Un media DECLARE et introuvable fait echouer la production : il n'est
   * jamais remplace en silence par la carte.
   */
  media: MediaPlan | null;
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
  /**
   * Le compte qui possede ce film. Optionnel dans le TYPE parce que le
   * scenariste, lui, ne connait aucun compte ; OBLIGATOIRE des que le film
   * passe par l'API, qui refuse tout film dont le proprietaire n'est pas
   * l'appelant (`acces.appartientA`).
   */
  proprietaire?: string | null;
  /**
   * Ce que la GENERATION IA (lot 3) a deja coute sur ce film, en USD.
   * Distinct de `SceneCinema.coutUsd` (cout de RENDU, lot 1) : deux depenses
   * de nature differente, jamais additionnees l'une dans l'autre. Absent ou
   * `undefined` = 0 — tous les films des lots 1 et 2 restent valides sans
   * migration.
   */
  coutGenerationUsd?: number;
  /**
   * Suivi DURABLE des generations IA de ce film (`generation/suivi.ts`) : une ligne
   * par tentative, son statut reel, et ce qu'elle a pris/rendu en credits. Absent =
   * aucune generation suivie (tous les films anterieurs restent valides).
   */
  generations?: GenerationSuivie[];
  /**
   * Budget de GENERATION approuve explicitement pour ce film (regimes abonnement et
   * administrateur) : plafond de `coutGenerationUsd` cumule. Ecrit UNIQUEMENT par le
   * serveur (`POST …/quota`), jamais par le PATCH du film. Absent = aucune generation
   * payante hors regime credits.
   */
  budgetApprouve?: BudgetApprouve;
}

export interface BudgetApprouve {
  /** Depense CUMULEE maximale du film, en USD (deja engage + devis approuve). */
  usd: number;
  perimetre: 'images' | 'complet';
  /** Le devis restant au moment de l'approbation, en USD. */
  devisUsd: number;
  approuveLe: string;
}

export type StatutGeneration = 'en_cours' | 'reussie' | 'echouee' | 'interrompue';

/** Une generation IA suivie : jamais un secret, jamais une URL de fournisseur. */
export interface GenerationSuivie {
  id: string;
  planId: string;
  operation: 'image' | 'video';
  mode: 'reelle' | 'simulee';
  statut: StatutGeneration;
  creeLe: string;
  majLe: string;
  erreur?: string | null;
  /** Credits Studiio pris pour cette generation (0/absent = rien de pris). */
  creditsPris?: number;
  /** Reference du debit — permet un remboursement IDEMPOTENT apres interruption. */
  referenceCredits?: string;
  creditsRembourses?: boolean;
  /**
   * References de la depense fournisseur (plafond par compte) et du quota d'abonnement
   * reserves pour cette generation — ecrites AVANT l'appel payant, pour qu'une
   * interruption puisse les reconcilier (passage en `incertaine`, jamais en `liberee`).
   */
  referenceDepense?: string;
  referenceQuota?: string;
  /** La depense et le quota d'une generation interrompue ont ete marques `incertaine`. */
  depenseReconciliee?: boolean;
  /**
   * Echeance du BAIL (meme principe que `travaux/types.ts`, `bailJusqua`) : tant que
   * l'executeur vivant le renouvelle, une generation longue (video lente) n'est JAMAIS
   * declaree interrompue a sa place. `null` une fois la generation terminale (reussie,
   * echouee, interrompue) : plus rien ne la protege d'une expiration, elle n'en a plus
   * besoin. Absent sur une generation creee AVANT ce champ (pas de migration) : traitee
   * comme avant, via `creeLe` (voir `statutEffectif`).
   */
  bailJusqua?: string | null;
}

/**
 * Duree d'un plan telle que le montage la retient — media compris.
 *
 * UNE seule regle, lue ici par tout le monde : le devis, l'aperçu et le MP4
 * annoncent la meme duree. Deux calculs finissaient par ne plus coincider,
 * et c'est l'ecart aperçu / rendu que ce module evite par construction.
 */
export function dureePlan(plan: Pick<PlanCinema, 'dureeS' | 'dialogue' | 'media'>): number {
  return dureePlanAvecMedia(plan, plan.media);
}

/** Duree totale d'un film : la somme des plans, jamais une valeur stockee. */
export function dureeFilm(film: Pick<Film, 'scenes'>): number {
  return Math.round(
    film.scenes.reduce((t, s) => t + s.plans.reduce((u, p) => u + dureePlan(p), 0), 0) * 10,
  ) / 10;
}

/** Duree d'une scene. */
export function dureeScene(scene: Pick<SceneCinema, 'plans'>): number {
  return Math.round(scene.plans.reduce((t, p) => t + dureePlan(p), 0) * 10) / 10;
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

export interface Cadrage {
  /** Facteur applique au media pour remplir le cadre SANS deformation. */
  echelle: number;
  /** Fraction rognee horizontalement et verticalement (0 = rien). */
  rogneX: number;
  rogneY: number;
  /** Le media a-t-il le meme rapport que le cadre ? */
  memeRapport: boolean;
}

/**
 * Le cadrage d'un media dans le cadre du film : `cover`, donc UN SEUL
 * facteur pour les deux axes — c'est ce qui garantit qu'aucune image n'est
 * etiree. Ce qui depasse est rogne, et `rogneX`/`rogneY` le chiffrent.
 */
export function cadrage(media: Pick<MediaPlan, 'largeur' | 'hauteur'>, cadre: { w: number; h: number }): Cadrage {
  const echelle = Math.max(cadre.w / media.largeur, cadre.h / media.hauteur);
  const largeurRendue = media.largeur * echelle;
  const hauteurRendue = media.hauteur * echelle;
  const arrondi = (v: number) => Math.round(v * 1000) / 1000;
  return {
    echelle: arrondi(echelle),
    rogneX: arrondi(Math.max(0, (largeurRendue - cadre.w) / largeurRendue)),
    rogneY: arrondi(Math.max(0, (hauteurRendue - cadre.h) / hauteurRendue)),
    memeRapport: Math.abs(media.largeur / media.hauteur - cadre.w / cadre.h) < 0.01,
  };
}

/**
 * La duree d'un plan qui porte une video.
 *
 * Regle : la PAROLE commande (elle n'est jamais acceleree, cf. `voix.ts`).
 * Une video plus courte que la parole ne raccourcit donc pas le plan : sa
 * derniere image est figee pour le reste (`CinemaFilm.tsx`). Une video plus
 * longue est coupee a la duree du plan.
 */
export function dureePlanAvecMedia(plan: Pick<PlanCinema, 'dureeS' | 'dialogue'>, media: MediaPlan | null): number {
  if (!media || media.genre !== 'video' || media.dureeS === null) return plan.dureeS;
  // Sans parole, le plan epouse la video (bornee a 12 s pour ne pas endormir
  // le montage sur un rush oublie).
  if (!plan.dialogue) return Math.round(Math.min(media.dureeS, 12) * 10) / 10;
  return plan.dureeS;
}
