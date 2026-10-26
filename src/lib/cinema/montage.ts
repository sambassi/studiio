/**
 * LE MONTAGE — le film en UNE chronologie, source unique du rendu.
 *
 * Tout ce qui lit le film pour le montrer (aperçu, export MP4, chiffrage de
 * duree) passe par `monterFilm`. Un seul calcul de chronologie signifie qu'un
 * aperçu qui dure 42 s donne un MP4 de 42 s — deux calculs auraient fini par
 * divergent, et c'est l'ecart aperçu/MP4 que le projet paye depuis longtemps.
 *
 * Les segments portent des temps ABSOLUS (debut, fin) : Remotion en derive ses
 * `Sequence`, ffmpeg en derive ses points de coupe, sans recalculer l'ordre.
 */
import type { Cadrage, Film, FormatFilm, MediaPlan } from '@/lib/cinema/types';
// ⚠️ Rien de ce fichier ne doit tirer un module SERVEUR : il est compile
// dans le bundle navigateur de Remotion (`CinemaFilm.tsx`). `cadrage` et
// `dureePlanAvecMedia` sont donc pris dans `types.ts`, pas dans `medias.ts`
// qui ouvre des fichiers.
import { TAILLES, cadrage, dureePlanAvecMedia } from '@/lib/cinema/types';
import { apparencePourPrompt } from '@/lib/cinema/personnages';

/** Palette Studiio — violet primaire, rose accent. Aucune couleur d'une autre marque. */
export const PALETTE: Array<[string, string]> = [
  ['#7C3AED', '#4C1D95'],
  ['#EC4899', '#7C3AED'],
  ['#4C1D95', '#0A0A0F'],
  ['#7C3AED', '#EC4899'],
  ['#1E1B4B', '#4C1D95'],
];

export interface SegmentMontage {
  sceneId: string;
  sceneIndex: number;
  planId: string;
  cadre: string;
  titreScene: string;
  lieu: string;
  intention: string;
  /** Le texte a l'image : la replique, sinon la description du plan. */
  texte: string;
  /** Nom affiche du locuteur. `null` pour une narration ou un plan muet. */
  locuteur: string | null;
  /** Ce que le plan dit : une replique, du recit, ou rien. */
  genre: 'replique' | 'narration' | 'muet';
  /** Apparence des personnages PRESENTS (tracabilite + futur prompt visuel). */
  apparence: string | null;
  debutS: number;
  finS: number;
  dureeS: number;
  /** Le media du plan, mesure a l'import. `null` = carte de plan dessinee. */
  media: MediaPlan | null;
  /** Cadrage du media dans le cadre du film (jamais d'etirement). */
  cadrage: Cadrage | null;
  /** Fichier de voix deja synthetise pour ce plan, s'il existe. */
  voixUrl: string | null;
  couleurs: [string, string];
}

export interface MontageFilm {
  filmId: string;
  titre: string;
  format: FormatFilm;
  largeur: number;
  hauteur: number;
  fps: number;
  segments: SegmentMontage[];
  dureeS: number;
}

export const FPS = 30;

/** Voix deja synthetisees, par identifiant de plan. */
export type VoixParPlan = Readonly<Record<string, string>>;

export function monterFilm(film: Film, voix: VoixParPlan = {}): MontageFilm {
  const taille = TAILLES[film.qualite][film.format];
  const segments: SegmentMontage[] = [];
  let curseur = 0;

  for (const scene of film.scenes) {
    for (const plan of scene.plans) {
      const parlant = plan.dialogue?.personnageId
        ? film.personnages.find((p) => p.id === plan.dialogue?.personnageId) ?? null
        : null;
      const apparence = apparencePourPrompt(film.personnages, plan.personnages) || null;
      // La duree tient compte du media : une video sans parole epouse sa
      // propre duree (voir `dureePlanAvecMedia`).
      const duree = Math.max(0.5, Math.round(dureePlanAvecMedia(plan, plan.media) * 10) / 10);
      segments.push({
        sceneId: scene.id,
        sceneIndex: scene.index,
        planId: plan.id,
        cadre: plan.cadre,
        titreScene: scene.titre,
        lieu: scene.lieu,
        intention: scene.intention,
        texte: plan.dialogue?.texte ?? plan.description,
        locuteur: parlant?.nom ?? null,
        genre: plan.dialogue ? plan.dialogue.genre : 'muet',
        apparence,
        debutS: Math.round(curseur * 10) / 10,
        finS: Math.round((curseur + duree) * 10) / 10,
        dureeS: duree,
        media: plan.media,
        cadrage: plan.media ? cadrage(plan.media, { w: taille.w, h: taille.h }) : null,
        voixUrl: voix[plan.id] ?? null,
        couleurs: PALETTE[scene.index % PALETTE.length],
      });
      curseur += duree;
    }
  }

  return {
    filmId: film.id,
    titre: film.titre,
    format: film.format,
    largeur: taille.w,
    hauteur: taille.h,
    fps: FPS,
    segments,
    dureeS: Math.round(curseur * 10) / 10,
  };
}

/** Les frames d'un segment — la conversion se fait ICI, une seule fois. */
export function framesDe(segment: Pick<SegmentMontage, 'debutS' | 'dureeS'>, fps = FPS): { from: number; duree: number } {
  return { from: Math.round(segment.debutS * fps), duree: Math.max(1, Math.round(segment.dureeS * fps)) };
}

/** Duree totale en frames, derivee des segments (jamais une valeur a part). */
export function totalFrames(montage: Pick<MontageFilm, 'segments' | 'fps'>): number {
  const dernier = montage.segments.at(-1);
  if (!dernier) return montage.fps;
  const { from, duree } = framesDe(dernier, montage.fps);
  return from + duree;
}

/** Les segments d'une scene — pour regenerer ou revoir une scene seule. */
export function segmentsDeScene(montage: MontageFilm, sceneId: string): SegmentMontage[] {
  return montage.segments.filter((s) => s.sceneId === sceneId);
}

/**
 * Le montage d'UNE scene, recale a zero.
 *
 * C'est ce qui rend « regenerer une seule scene » possible : chaque scene est
 * rendue dans son propre MP4, puis les MP4 sont recolles. Sans ce recalage,
 * une scene rendue seule commencerait a sa position dans le film et le fichier
 * serait precede de secondes vides.
 */
export function montageDeScene(montage: MontageFilm, sceneId: string): MontageFilm | null {
  const segments = montage.segments.filter((s) => s.sceneId === sceneId);
  if (!segments.length) return null;
  const origine = segments[0].debutS;
  const recales = segments.map((s) => ({
    ...s,
    debutS: Math.round((s.debutS - origine) * 10) / 10,
    finS: Math.round((s.finS - origine) * 10) / 10,
  }));
  return {
    ...montage,
    filmId: `${montage.filmId}-${sceneId}`,
    segments: recales,
    dureeS: Math.round(recales.reduce((t, s) => t + s.dureeS, 0) * 10) / 10,
  };
}
