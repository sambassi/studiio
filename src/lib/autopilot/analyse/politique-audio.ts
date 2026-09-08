/**
 * A_5c — CHOISIR LA MUSIQUE D'UNE VIDÉO, SANS TIRER AU SORT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA MÊME DOCTRINE QU'A_3e3, ET POUR LA MÊME RAISON
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un rendu est REJOUÉ. Avec du hasard, chaque tentative changerait de
 * musique — et `lireRenduReussiIdentique` ne retrouverait jamais rien, parce
 * que la recette entre dans l'identité du rendu. Le choix vient donc d'une
 * graine, et la variété vient du plan, pas d'un générateur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ MAIS C'EST UNE POLITIQUE À PART, PAS UNE SEPTIÈME FAMILLE D'EFFETS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une LUT est une entrée d'un catalogue partagé ; une musique est un FICHIER
 * du compte, avec une durée, des droits et une existence propre. Les fondre
 * dans le même sélecteur aurait obligé `StylePreset` à porter une clé de
 * stockage — donc à refuser chaque preset personnel déjà enregistré.
 *
 * MODULE PUR : aucune base, aucun disque, aucune horloge.
 */
import { graineHachee, PENALITE_RECENCE, HISTORIQUE_MAX } from './politique-creative';
import type { PisteAudio } from '@/lib/creatif/audio';
import type { PisteMusicale } from './recette-audio';

/** Ce que l'Autopilote a le droit de faire de la musique. */
export const MODES_AUDIO = ['fixe', 'varier'] as const;
export type ModeAudio = (typeof MODES_AUDIO)[number];

export const LIBELLES_MODE_AUDIO: Record<ModeAudio, string> = {
  fixe: 'Toujours la même musique',
  varier: 'Varier parmi mes musiques',
};

export const DESCRIPTIONS_MODE_AUDIO: Record<ModeAudio, string> = {
  fixe: 'Studiio garde la musique que tu as choisie.',
  varier: 'Studiio alterne entre les musiques que tu autorises.',
};

export interface ContexteAudio {
  graine: string;
  /** Les clés des dernières musiques utilisées, la plus récente d'abord. */
  historique: readonly string[];
}

export interface IssueAudio {
  /** La musique retenue, ou `null` pour « sans musique ». */
  musique: PisteMusicale | null;
  /** L'empreinte des octets, pour la trace et pour l'identité. */
  empreinte: string | null;
  varie: boolean;
  raison: string;
}

const ESPACE = 100_000;

function score(
  graine: string, cle: string, recents: readonly string[],
): number {
  const base = graineHachee(`${graine}|audio|${cle}`) % ESPACE;
  const rang = recents.indexOf(cle);
  if (rang < 0) return base;
  /* ⚠️ GRADUÉE, PAS PLATE. Bannir tout ce qui a servi rendrait le choix
     impossible dès la troisième vidéo avec deux musiques autorisées. Le coût
     décroît avec l'ancienneté — très cher hier, gratuit après dix vidéos. */
  return base - Math.round((PENALITE_RECENCE * (HISTORIQUE_MAX - rang)) / HISTORIQUE_MAX);
}

/**
 * La musique de CETTE vidéo.
 *
 * ⚠️ EN MODE FIXE, IL NE SE PASSE RIEN. La recette part telle quelle, et le
 * graphe émis est celui d'avant ce lot. La répétition n'y est pas une erreur :
 * c'est ce que le mode promet.
 */
export function resoudreMusiqueEffective(
  musiqueCourante: PisteMusicale | null,
  mode: ModeAudio,
  autorisees: readonly string[],
  banque: readonly PisteAudio[],
  ctx: ContexteAudio,
): IssueAudio {
  const fiche = (cle: string | null) => (cle === null
    ? null : banque.find((p) => p.cle === cle) ?? null);

  if (mode === 'fixe') {
    return {
      musique: musiqueCourante,
      empreinte: fiche(musiqueCourante?.cle ?? null)?.empreinte ?? null,
      varie: false,
      raison: 'Musique fixe : celle du compte, sans variation.',
    };
  }

  /* ⚠️ SEULES LES PISTES QUI EXISTENT ENCORE. Une clé autorisée puis retirée
     de la banque ferait choisir une musique introuvable — et un montage
     perdu pour une liste qu'on a oublié de nettoyer. */
  const candidates = autorisees.filter((c) => banque.some((p) => p.cle === c));

  if (candidates.length === 0) {
    return {
      musique: musiqueCourante,
      empreinte: fiche(musiqueCourante?.cle ?? null)?.empreinte ?? null,
      varie: false,
      raison: musiqueCourante === null
        ? 'Aucune musique autorisée : le montage reste sans musique.'
        : 'Aucune musique autorisée n’est disponible : celle du compte est conservée.',
    };
  }

  const recents = [...new Set(ctx.historique)].slice(0, HISTORIQUE_MAX);
  let retenue = candidates[0];
  let meilleur = score(ctx.graine, retenue, recents);
  for (const c of candidates.slice(1)) {
    const s = score(ctx.graine, c, recents);
    // ⚠️ L'ÉGALITÉ EST TRANCHÉE PAR L'ORDRE DE LA LISTE, jamais au hasard.
    if (s > meilleur) { retenue = c; meilleur = s; }
  }

  const p = fiche(retenue);
  return {
    musique: {
      bucket: musiqueCourante?.bucket ?? 'audio',
      cle: retenue,
      // ⚠️ L'EMPREINTE ENTRE DANS L'IDENTITÉ : deux fichiers différents sous
      // la même clé sont deux rendus différents.
      ...(p?.empreinte ? { version: p.empreinte } : {}),
    },
    empreinte: p?.empreinte ?? null,
    varie: candidates.length > 1,
    raison: `Choisie parmi ${candidates.length} musique(s) autorisée(s), en évitant `
      + `les ${Math.min(recents.length, HISTORIQUE_MAX)} dernières.`,
  };
}

/** Les musiques récemment utilisées, lues dans `usage.creatif`. */
export function historiqueAudioDepuisUsages(
  usages: readonly Record<string, unknown>[],
): string[] {
  const sortie: string[] = [];
  for (const u of usages) {
    const c = u?.creatif;
    if (!c || typeof c !== 'object') continue;
    const v = (c as Record<string, unknown>).musicTrackId;
    if (typeof v === 'string' && v.length > 0) sortie.push(v);
  }
  return sortie;
}
