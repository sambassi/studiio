'use client';

import {
  lireObjectif, normaliserObjectif, type ObjectifCommunication,
} from '@/lib/autopilot/analyse/objectif-communication';
import {
  lireRecetteAudio, RECETTE_AUDIO_DEFAUT, type RecetteAudio,
} from '@/lib/autopilot/analyse/recette-audio';
import {
  MONTAGE_DEFAUT, MONTAGE_FORMATS, type AutopilotMontageStyle,
} from '@/lib/autopilot/textStyle';
import {
  DUREE_CIBLE_MAX_SECONDES, DUREE_CIBLE_MIN_SECONDES,
} from '@/lib/autopilot/analyse/montage-contrat';

/**
 * LE BROUILLON DE **CETTE** VIDÉO — écriture, relecture, validation.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUE CE MODULE CORRIGE, ET POURQUOI C'ÉTAIT SILENCIEUX
 * ---------------------------------------------------------------------------
 *
 * Trois réglages de l'Autopilote ne vivaient QUE dans l'état React :
 * l'objectif de cette vidéo, le format et la durée, la recette audio. Le
 * compte, lui, garde ses défauts côté serveur. Un rafraîchissement — un
 * réflexe, une notification, un onglet restauré — remplaçait donc les trois
 * choix par les défauts du compte, sans un mot. L'utilisateur ne voyait pas
 * qu'il avait perdu quelque chose : il voyait des valeurs plausibles.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ UN BROUILLON N'EST PAS UN DÉFAUT DE COMPTE, ET NE LE DEVIENT JAMAIS
 * ---------------------------------------------------------------------------
 *
 * Ce module écrit dans `localStorage`, et NULLE PART ailleurs. Il n'appelle
 * aucune route, ne touche ni `autopilot_config` ni `design_style`. Le seul
 * geste qui change le défaut du compte reste la case « Utiliser aussi comme
 * objectif par défaut » du wizard — c'est précisément la confusion qui a
 * coûté un objectif de compte le 2026-09-07, et rien ici ne la rouvre.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LA CLÉ EST LE RUSH, ET C'EST CE QUI ISOLE LES COMPTES
 * ---------------------------------------------------------------------------
 *
 * `rushId` est un UUID attribué par la base et rattaché à UN utilisateur. Un
 * autre compte, sur le même navigateur, ne connaît aucun de ces
 * identifiants : il ne peut donc jamais lire ce brouillon-ci, faute de savoir
 * quelle clé demander. Ajouter un `userId` à la clé aurait exigé de faire
 * descendre la session dans quatre composants qui ne l'ont pas, pour une
 * isolation que l'UUID donne déjà.
 *
 * Et c'est aussi ce qui isole les rushes entre eux : régler le rush A puis
 * passer au rush B ne transporte rien — B lit SA clé, la trouve vide, et part
 * des défauts du compte.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ RIEN DE CE QUI EST RELU N'EST DIGNE DE CONFIANCE
 * ---------------------------------------------------------------------------
 *
 * Un brouillon peut dater d'une version antérieure, d'un autre onglet, ou
 * avoir été modifié à la main. Chaque champ repasse donc par le validateur
 * DU PRODUIT — `lireObjectif`, `lireRecetteAudio`, les bornes de
 * `montage-contrat` — jamais par une copie de leurs règles. Un champ qui ne
 * tient pas est remplacé par son défaut ; un brouillon partiellement
 * invalide rend ce qu'il a de bon plutôt que de tout perdre.
 *
 * C'est le même contrat que `lib/creer/draft.ts`, qui protège l'éditeur
 * simple depuis des mois. On en reprend les règles plutôt que d'en inventer
 * d'autres.
 */

/** Version du format. Un brouillon d'une autre version est ignoré, pas deviné. */
export const VERSION_BROUILLON = 1;

const PREFIXE_CLE = `studiio:autopilote:brouillon:v${VERSION_BROUILLON}`;

/**
 * La clé d'un rush. `null` quand aucun rush n'est choisi — il n'y a alors
 * rien à retenir, et surtout rien à écrire sous une clé fourre-tout que le
 * rush suivant relirait.
 */
export function cleBrouillon(rushId: string | null | undefined): string | null {
  return rushId ? `${PREFIXE_CLE}:${rushId}` : null;
}

/**
 * Ce qui est conservé : de la CONFIGURATION, et rien d'autre.
 *
 * Aucun média, aucune URL signée, aucun jeton, aucun état de rendu en cours.
 * Restaurer une progression ferait croire à un travail qui ne tourne plus ;
 * restaurer une URL signée rendrait un lien déjà mort.
 */
export interface BrouillonVideo {
  version: number;
  enregistreLe: number;
  /** L'objectif de CETTE vidéo. `null` = on suit le défaut du compte. */
  objectif: ObjectifCommunication | null;
  montage: AutopilotMontageStyle;
  audio: RecetteAudio;
}

function stockageDisponible(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function objet(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? v as Record<string, unknown> : null;
}

/** Le format et la durée, bornés par le contrat de montage lui-même. */
export function nettoyerMontage(brut: unknown): AutopilotMontageStyle {
  const o = objet(brut);
  if (!o) return { ...MONTAGE_DEFAUT };
  const format = typeof o.format === 'string' && MONTAGE_FORMATS.includes(o.format)
    ? o.format : MONTAGE_DEFAUT.format;
  const d = o.dureeSecondes;
  const duree = typeof d === 'number' && Number.isFinite(d)
    && d >= DUREE_CIBLE_MIN_SECONDES && d <= DUREE_CIBLE_MAX_SECONDES
    ? d : MONTAGE_DEFAUT.dureeSecondes;
  return { format, dureeSecondes: duree };
}

/**
 * Relit un brouillon brut et rend ce qui est exploitable.
 *
 * ⚠️ UN CHAMP INVALIDE N'EN CONDAMNE PAS UN AUTRE. Une recette audio hors
 * bornes ne doit pas faire perdre le format choisi : chaque champ retombe sur
 * SON défaut, indépendamment des voisins.
 */
export function nettoyerBrouillon(brut: unknown): BrouillonVideo | null {
  const o = objet(brut);
  if (!o) return null;
  // ⚠️ LA VERSION D'ABORD. Un format futur peut avoir change le SENS d'un
  // champ sans en changer le type : le valider avec les regles d'aujourd'hui
  // produirait une valeur plausible et fausse.
  if (o.version !== VERSION_BROUILLON) return null;

  const luObjectif = o.objectif === null || o.objectif === undefined
    ? null : lireObjectif(o.objectif);
  const objectif = luObjectif && luObjectif.ok
    ? normaliserObjectif(luObjectif.objectif) : null;

  const luAudio = lireRecetteAudio(o.audio);
  const audio = luAudio.ok ? luAudio.recette : { ...RECETTE_AUDIO_DEFAUT };

  const enregistreLe = typeof o.enregistreLe === 'number' && Number.isFinite(o.enregistreLe)
    ? o.enregistreLe : 0;

  return {
    version: VERSION_BROUILLON,
    enregistreLe,
    objectif,
    montage: nettoyerMontage(o.montage),
    audio,
  };
}

/**
 * Relit le brouillon d'un rush. `null` s'il n'existe pas, s'il est illisible,
 * ou s'il vient d'une autre version.
 *
 * ⚠️ AUCUNE EXCEPTION NE SORT D'ICI. `localStorage` jette en navigation
 * privée, sur quota dépassé, ou quand un navigateur bloque le stockage : un
 * brouillon absent doit rendre l'écran à ses défauts, jamais le casser.
 */
export function lireBrouillon(rushId: string | null | undefined): BrouillonVideo | null {
  const cle = cleBrouillon(rushId);
  if (!cle || !stockageDisponible()) return null;
  try {
    const brut = window.localStorage.getItem(cle);
    if (!brut) return null;
    return nettoyerBrouillon(JSON.parse(brut));
  } catch {
    return null;
  }
}

/** Écrit le brouillon. `false` si le stockage est indisponible — jamais d'exception. */
export function ecrireBrouillon(
  rushId: string | null | undefined,
  brouillon: Omit<BrouillonVideo, 'version' | 'enregistreLe'>,
  maintenant: number = Date.now(),
): boolean {
  const cle = cleBrouillon(rushId);
  if (!cle || !stockageDisponible()) return false;
  try {
    const complet: BrouillonVideo = {
      version: VERSION_BROUILLON,
      enregistreLe: maintenant,
      objectif: brouillon.objectif,
      montage: brouillon.montage,
      audio: brouillon.audio,
    };
    window.localStorage.setItem(cle, JSON.stringify(complet));
    return true;
  } catch {
    return false;
  }
}

/**
 * Efface le brouillon d'un rush.
 *
 * ⚠️ APPELÉ PAR UN GESTE, JAMAIS PAR UN SUCCÈS. Un rendu réussi n'efface
 * rien : refaire la même vidéo en changeant un seul réglage est le geste le
 * plus courant qui suive un rendu, et lui reprendre ses choix à ce
 * moment-là serait le punir d'avoir abouti.
 */
export function effacerBrouillon(rushId: string | null | undefined): void {
  const cle = cleBrouillon(rushId);
  if (!cle || !stockageDisponible()) return;
  try {
    window.localStorage.removeItem(cle);
  } catch {
    /* Un brouillon qu'on ne peut pas effacer n'est pas une panne d'écran. */
  }
}
