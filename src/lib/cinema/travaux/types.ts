/**
 * CINEMA IA — le modele d'un TRAVAIL de production (module pur).
 *
 * Un travail est une production de film lancee sans bloquer le navigateur :
 * la requete rend un identifiant, un executeur du serveur fait le reste, et
 * l'ecran interroge l'etat. Tout ce qu'il faut pour reprendre apres une
 * interruption est dans la ligne du travail, pas dans la memoire d'un
 * processus.
 */
import { hash } from '@/lib/cinema/empreinte';
import { empreinteScene } from '@/lib/cinema/empreinte';
import type { Film } from '@/lib/cinema/types';

export type StatutTravail = 'en_attente' | 'en_cours' | 'termine' | 'echec' | 'annule';
export type EtapeTravail = 'preparation' | 'voix' | 'rendu' | 'assemblage' | 'termine';
/** `reutilisee` : le MP4 de cette scene existait deja pour cette empreinte — rien n'a ete recalcule. */
export type EtatSceneTravail = 'a_faire' | 'en_cours' | 'faite' | 'reutilisee' | 'echec';

export interface ProgressionTravail {
  etape: EtapeTravail;
  scenes: Record<string, EtatSceneTravail>;
  /** 0-100, DERIVE de l'etat reel par `pourcent` : jamais une animation. */
  pourcent: number;
  /** Une phrase lisible, ou `null`. */
  message: string | null;
}

export interface ResultatTravail {
  /** Cle durable du MP4 du film (jamais une URL). `null` si le travail n'en produit pas. */
  cleMp4: string | null;
  scenesRendues: string[];
  scenesReutilisees: string[];
  avertissements: string[];
  dureeS: number | null;
  octets: number | null;
  largeur: number | null;
  hauteur: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
  /** Ce que le travail a coute : toujours 0 tant que le fournisseur est simule. */
  coutUsd: number;
}

export interface Travail {
  id: string;
  filmId: string;
  proprietaire: string;
  statut: StatutTravail;
  cle: string;
  scenesDemandees: string[];
  progression: ProgressionTravail;
  resultat: ResultatTravail | null;
  erreur: string | null;
  reference: string | null;
  tentatives: number;
  annulationDemandee: boolean;
  bailJusqua: string | null;
  creeLe: string;
  majLe: string;
  termineLe: string | null;
}

export const STATUTS_ACTIFS: readonly StatutTravail[] = ['en_attente', 'en_cours'];
export const estActif = (s: StatutTravail): boolean => STATUTS_ACTIFS.includes(s);
export const estFini = (s: StatutTravail): boolean => !estActif(s);

/** Au plus cinq prises (la base impose la meme borne). */
export const TENTATIVES_MAX = 5;
/** Travaux simultanes par compte (la base impose le plafond passe a la creation). */
export const TRAVAUX_ACTIFS_MAX_PAR_COMPTE = 2;
/** Duree d'un bail. Renouvele par l'executeur ; expire = le travail est reprenable. */
export const BAIL_S = 90;

/**
 * La part de chaque etape dans la barre : la preparation et l'assemblage sont
 * courts, le rendu des scenes est ce qui prend du temps — il porte l'essentiel.
 */
const PART = { preparation: 5, voix: 10, rendu: 75, assemblage: 10 } as const;

/**
 * Le pourcentage, calcule depuis ce qui est REELLEMENT fait. Une scene
 * `reutilisee` compte comme faite : elle est livree.
 */
export function pourcent(p: Pick<ProgressionTravail, 'etape' | 'scenes'>): number {
  if (p.etape === 'termine') return 100;
  const scenes = Object.values(p.scenes);
  const faites = scenes.filter((s) => s === 'faite' || s === 'reutilisee').length;
  const partRendu = scenes.length ? (faites / scenes.length) * PART.rendu : 0;
  switch (p.etape) {
    case 'preparation': return 0;
    case 'voix': return PART.preparation;
    case 'rendu': return Math.min(99, Math.round(PART.preparation + PART.voix + partRendu));
    case 'assemblage': return Math.min(99, Math.round(PART.preparation + PART.voix + PART.rendu));
    default: return 0;
  }
}

export function progressionInitiale(film: Pick<Film, 'scenes'>): ProgressionTravail {
  const scenes: Record<string, EtatSceneTravail> = {};
  for (const s of film.scenes) scenes[s.id] = 'a_faire';
  return { etape: 'preparation', scenes, pourcent: 0, message: null };
}

/**
 * La cle d'un travail : ce qui est demande, a partir de ce que le film
 * CONTIENT maintenant. Deux demandes identiques sur un film inchange donnent
 * la meme cle — c'est ce qui rend « relancer » inoffensif : tout est deja en
 * cache a cette empreinte.
 */
export function cleTravail(film: Film, scenesDemandees: readonly string[]): string {
  const empreintes = film.scenes.map((s) => `${s.id}:${empreinteScene(s, film.personnages)}`);
  return hash([film.id, film.format, film.qualite, ...empreintes, '|', ...[...scenesDemandees].sort()].join('\n'));
}

/** Les identifiants de scene demandes, ramenes aux scenes qui EXISTENT, sans doublon. */
export function scenesValides(film: Pick<Film, 'scenes'>, demandees: unknown): string[] {
  if (!Array.isArray(demandees)) return [];
  const connues = new Set(film.scenes.map((s) => s.id));
  return [...new Set(demandees.filter((s): s is string => typeof s === 'string' && connues.has(s)))];
}

/** Une reprise est-elle encore permise pour ce travail ? */
export function repriseAutorisee(t: Pick<Travail, 'statut' | 'tentatives' | 'bailJusqua'>, maintenant: Date): boolean {
  if (t.tentatives >= TENTATIVES_MAX) return false;
  if (t.statut === 'en_attente') return true;
  return t.statut === 'en_cours' && t.bailJusqua !== null && new Date(t.bailJusqua).getTime() < maintenant.getTime();
}

/** Ce que le navigateur recoit : jamais un chemin du serveur ni une cle d'objet. */
export interface TravailPublic {
  id: string;
  filmId: string;
  statut: StatutTravail;
  progression: ProgressionTravail;
  erreur: string | null;
  reference: string | null;
  annulationDemandee: boolean;
  creeLe: string;
  termineLe: string | null;
  resultat: (Omit<ResultatTravail, 'cleMp4'> & { aMp4: boolean }) | null;
}

export function presenterTravail(t: Travail): TravailPublic {
  const { cleMp4, ...reste } = t.resultat ?? ({} as ResultatTravail);
  return {
    id: t.id,
    filmId: t.filmId,
    statut: t.statut,
    progression: t.progression,
    erreur: t.erreur,
    reference: t.reference,
    annulationDemandee: t.annulationDemandee,
    creeLe: t.creeLe,
    termineLe: t.termineLe,
    resultat: t.resultat ? { ...reste, aMp4: !!cleMp4 } : null,
  };
}
