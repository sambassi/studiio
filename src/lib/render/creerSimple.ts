import { renderVideo } from '@/lib/render/worker';
import { buildSequences, totalDurationFrames } from '@/lib/creer/designSpec';
import type { FreeElement } from '@/components/creer/FreeElementsLayer';
import type { TextAnimation } from '@/lib/creer/textAnimation';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';
import type { TransitionStyle } from '@/lib/video-composer';

/**
 * Entree du rendu SERVEUR d'un montage « Créer (simple) ».
 *
 * Prend le meme design que celui envoye au compositeur navigateur et le
 * confie a Remotion. Rien ne remplace le rendu navigateur : c'est un second
 * chemin, ajoute a cote.
 *
 * Les elements libres sont rendus depuis la Phase 5, les transitions depuis
 * la Phase 6, les animations de texte depuis la Phase 7, l'audio — musique,
 * voix par sequence, son du rush — depuis la Phase 8.
 *
 * ⚠️ LES DUREES NE SE RECALCULENT PAS ICI. L'allongement d'une sequence a la
 * duree de sa voix est un effet de l'EDITEUR : il ECRIT la duree dans le
 * design quand la voix est attachee, et l'utilisateur peut la corriger
 * ensuite. Les durees recues sont donc DEJA calees ; les recalculer
 * ecraserait ce reglage manuel et allongerait la video serveur.
 */

/** Sous-ensemble du design qui suffit au rendu serveur de Phase 1. */
export interface CreerSimpleRenderInput {
  title: string;
  subtitle?: string;
  cards?: Array<{ icon?: string; title?: string; label?: string; description?: string; value?: string }>;
  ctaText?: string;
  ctaSubText?: string;
  posterUrl?: string | null;
  /**
   * L'affiche couvre-t-elle toutes les séquences, ou seulement l'intro ?
   *
   * Absent = toutes, comme avant. `false` la restreint à l'intro : cartes,
   * vidéo et CTA retombent sur le dégradé. Même règle que le compositeur
   * canvas (`posterOnAllSequences`).
   */
  posterOnAllSequences?: boolean;
  sequenceBackgrounds?: Record<string, string | null>;
  videoUrl?: string | null;
  musicUrl?: string | null;
  gradientStart?: string;
  gradientEnd?: string;
  gradientOpacity?: number;
  titleColor?: string;
  watermark?: string;
  introDuration?: number;
  cardsDuration?: number;
  videoDuration?: number;
  ctaDuration?: number;
  sequenceOrder?: string[];
  format?: '9:16' | '1:1' | '16:9';
  /** Elements libres, peints sur toutes les sequences. */
  elements?: FreeElement[];
  /** Style joue entre deux sequences — defaut : fondu enchaine. */
  transition?: TransitionStyle;
  /** Animation d'apparition du texte — defaut : aucune. */
  textAnimation?: TextAnimation;
  /**
   * Voix par sequence, par cle d'editeur (`titre`, `cartes`, `video`, `cta`).
   * Prioritaire sur `voiceUrl` : le repli ne joue que si aucune n'est fournie.
   */
  sequenceVoiceUrls?: Record<string, string | null>;
  /** Voix unique — repli historique. */
  voiceUrl?: string | null;
  /** Volumes du mixage. Absents : les defauts du compositeur (0,5 / 0,8 / 1). */
  musicVolume?: number;
  voiceVolume?: number;
  /** Niveau du son du rush. Absent : le defaut du compositeur. */
  rushVolume?: number;
  /** Couper la piste audio du rush. Absent = il garde son son, comme avant. */
  rushMuted?: boolean;
  /** Attenuations posees a la main dans le mixeur. */
  audioKeyframes?: AudioKeyframe[];
}

/** Identifiant de la composition, tel qu'enregistre dans `remotion/index`. */
export const CREER_SIMPLE_COMPOSITION_ID = 'creer-simple-montage';

/**
 * Rend le montage cote serveur.
 *
 * `jobId` sert au suivi de progression, comme pour les autres rendus.
 */
export async function renderCreerSimple(input: {
  jobId: string;
  design: CreerSimpleRenderInput;
  onProgress?: (progress: { progress: number; stage: string }) => void;
}): Promise<{ outputPath: string; durationFrames: number }> {
  const d = input.design;
  const inputProps = {
    ...d,
    introDuration: d.introDuration ?? 4,
    cardsDuration: d.cardsDuration ?? 6,
    videoDuration: d.videoDuration ?? 0,
    ctaDuration: d.ctaDuration ?? 4,
    cards: d.cards ?? [],
  };

  // La duree est recalculee ici pour la journaliser et la rendre a
  // l'appelant ; la composition la recalcule de son cote par
  // `calculateMetadata`, avec la MEME fonction. Deux calculs, une seule regle.
  const sequences = buildSequences({
    introDuration: inputProps.introDuration,
    cardsDuration: inputProps.cardsDuration,
    videoDuration: inputProps.videoDuration,
    ctaDuration: inputProps.ctaDuration,
    cardCount: inputProps.cards.length,
    hasVideoBackground: !!d.videoUrl,
    videoRequested: !!d.videoUrl,
    sequenceOrder: d.sequenceOrder ?? null,
  });
  const durationFrames = totalDurationFrames(sequences, 30);
  console.log(
    `[RenduServeur] ${sequences.map((s) => `${s.type}:${s.duration}s`).join(' -> ')} `
    + `= ${durationFrames} images`,
  );

  const { outputPath } = await renderVideo({
    jobId: input.jobId,
    compositionId: CREER_SIMPLE_COMPOSITION_ID,
    inputProps,
    onProgress: input.onProgress,
  });
  return { outputPath, durationFrames };
}
