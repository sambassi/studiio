import { renderVideo } from '@/lib/render/worker';
import { buildSequences, totalDurationFrames } from '@/lib/creer/designSpec';
import type { FreeElement } from '@/components/creer/FreeElementsLayer';
import type { TextAnimation } from '@/lib/creer/textAnimation';
import type { TransitionStyle } from '@/lib/video-composer';

/**
 * Entree du rendu SERVEUR d'un montage « Créer (simple) ».
 *
 * Prend le meme design que celui envoye au compositeur navigateur et le
 * confie a Remotion. Rien ne remplace le rendu navigateur : c'est un second
 * chemin, ajoute a cote.
 *
 * ⚠️ La composition ne rend pas encore les voix par sequence. Le champ est
 * accepte et transmis — la phase suivante n'aura pas a changer cette
 * signature. Les elements libres sont rendus depuis la Phase 5, les
 * transitions depuis la Phase 6, les animations de texte depuis la Phase 7.
 */

/** Sous-ensemble du design qui suffit au rendu serveur de Phase 1. */
export interface CreerSimpleRenderInput {
  title: string;
  subtitle?: string;
  cards?: Array<{ icon?: string; title?: string; label?: string; description?: string; value?: string }>;
  ctaText?: string;
  ctaSubText?: string;
  posterUrl?: string | null;
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
