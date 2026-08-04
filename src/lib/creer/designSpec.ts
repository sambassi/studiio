/**
 * Spécification de montage PARTAGÉE entre les deux moteurs de rendu.
 *
 * Studiio compose de deux façons : dans le navigateur (Canvas +
 * `MediaRecorder`, `video-composer.ts`) et — à partir de la Phase 1 du rendu
 * serveur — dans Remotion, sous Chromium sans tête.
 *
 * Deux moteurs qui décideraient CHACUN de l'ordre des séquences, de leurs
 * durées ou de l'échelle des polices divergeraient au premier réglage ajouté
 * d'un seul côté — et la divergence ne se verrait qu'en comparant deux vidéos
 * image par image. Ce module est la source unique de ces règles-là.
 *
 * Il ne contient QUE des fonctions pures : ni Canvas, ni React, ni DOM. C'est
 * ce qui lui permet d'être importé des deux côtés, et vérifié sur des valeurs.
 */

/** Vocabulaire de l'éditeur → vocabulaire du compositeur. */
export const SEQ_NAME_MAP: Record<string, string> = {
  titre: 'intro', cartes: 'cards', video: 'video', cta: 'cta',
};

/** Et l'inverse. */
export const SEQ_NAME_REVERSE: Record<string, string> = {
  intro: 'titre', cards: 'cartes', video: 'video', cta: 'cta',
};

export type SeqType = 'intro' | 'cards' | 'video' | 'cta';

export interface PlannedSequence {
  type: string;
  duration: number;
}

/** Durées par défaut, en secondes. */
export const DEFAULT_DURATIONS = { intro: 4, cards: 6, video: 10, cta: 4 } as const;

/** Durée du fondu entre deux séquences consécutives. */
export const TRANSITION_SECONDS = 0.8;

/**
 * Largeur de l'aperçu de l'éditeur, en pixels CSS.
 *
 * L'éditeur pose ses tailles de police et ses marges en pixels Tailwind FIXES,
 * quel que soit le format. Les reproduire demande de les mettre à l'échelle
 * par `largeurVidéo / cetteLargeur` — se tromper de viewport rend les polices
 * du 16:9 60 % trop grandes, et les libellés débordent de leur carte.
 */
export function editorViewportPx(isReel: boolean): number {
  return isReel ? 320 : 512;
}

/** Nombre de cartes réellement affichées, selon le format. */
export function maxVisibleCards(isReel: boolean): number {
  return isReel ? 5 : 6;
}

/**
 * Assemble les séquences du montage, dans l'ordre, avec leurs durées.
 *
 * ⚠️ L'ORDRE DES OPÉRATIONS EST PORTEUR DE SENS, et c'est pour cela que cette
 * fonction est partagée plutôt que réécrite de chaque côté :
 *
 * 1. Les conditions d'inclusion et la redistribution de la durée d'une vidéo
 *    morte raisonnent sur l'ordre CANONIQUE — `sequences[0]` reçoit le bonus.
 * 2. Le réordonnancement vient APRÈS. Réordonner avant enverrait ce bonus à la
 *    mauvaise séquence.
 * 3. Le tri est STABLE : les types absents de l'ordre demandé restent à la
 *    fin, dans leur ordre naturel. Il ne peut qu'échanger, jamais insérer une
 *    séquence que les conditions ont exclue.
 *
 * Rend au minimum une séquence : toutes masquées, un montage vide ferait
 * tourner l'enregistreur dans le vide.
 */
export function buildSequences(input: {
  introDuration: number;
  cardsDuration: number;
  videoDuration: number;
  ctaDuration: number;
  cardCount: number;
  /** Le rush est-il réellement chargé et jouable ? */
  hasVideoBackground: boolean;
  /** Une vidéo était-elle demandée ? (rush ou image de remplacement) */
  videoRequested: boolean;
  /** Ordre voulu, dans l'un ou l'autre vocabulaire. */
  sequenceOrder?: string[] | null;
}): PlannedSequence[] {
  const {
    introDuration, cardsDuration, videoDuration, ctaDuration,
    cardCount, hasVideoBackground, videoRequested, sequenceOrder,
  } = input;

  const sequences: PlannedSequence[] = [];
  if (introDuration > 0) sequences.push({ type: 'intro', duration: introDuration });
  if (cardCount > 0 && cardsDuration > 0) sequences.push({ type: 'cards', duration: cardsDuration });

  if (hasVideoBackground && videoDuration > 0) {
    sequences.push({ type: 'video', duration: videoDuration });
  } else if (videoRequested && videoDuration > 0) {
    // Vidéo demandée mais illisible : sa durée est redistribuée plutôt que
    // perdue — le montage garderait sinon un trou de dix secondes.
    if (sequences[0]) sequences[0].duration += Math.floor(videoDuration / 2);
  }

  const ctaExtraFromDeadVideo = (!hasVideoBackground && videoRequested && videoDuration > 0)
    ? Math.ceil(videoDuration / 2)
    : 0;
  if (ctaDuration + ctaExtraFromDeadVideo > 0) {
    sequences.push({ type: 'cta', duration: ctaDuration + ctaExtraFromDeadVideo });
  }

  const normalizedOrder = sequenceOrder?.length
    ? sequenceOrder.map((s) => SEQ_NAME_MAP[String(s).toLowerCase()] || s)
    : null;
  if (normalizedOrder) {
    const rank = (t: string) => {
      const i = normalizedOrder.indexOf(t);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    sequences.sort((a, b) => rank(a.type) - rank(b.type));
  }

  if (sequences.length === 0) {
    sequences.push({ type: 'intro', duration: 1 });
  }
  return sequences;
}

/** Durée totale du montage, en secondes. */
export function totalDurationSeconds(sequences: PlannedSequence[]): number {
  return sequences.reduce((s, seq) => s + Math.max(0, seq.duration), 0);
}

/** Durée totale en images — ce que Remotion attend. */
export function totalDurationFrames(sequences: PlannedSequence[], fps: number): number {
  const f = Number.isFinite(fps) && fps > 0 ? fps : 30;
  // Au moins une image : Remotion refuse une composition de durée nulle.
  return Math.max(1, Math.round(totalDurationSeconds(sequences) * f));
}

/** Début de chaque séquence, en images cumulées. */
export function sequenceFrameOffsets(sequences: PlannedSequence[], fps: number): number[] {
  const f = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const out: number[] = [];
  let cumul = 0;
  for (const seq of sequences) {
    out.push(Math.round(cumul * f));
    cumul += Math.max(0, seq.duration);
  }
  return out;
}

/** Dimensions natives d'un format. */
export const VIDEO_SIZE = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
} as const;

export type DesignFormat = keyof typeof VIDEO_SIZE;

/** Le format est-il « reel » ? Le carré est rangé du côté non-vertical. */
export function isReelFormat(width: number, height: number): boolean {
  return height > width;
}

/** Couleurs par défaut, celles du kit de marque neutre. */
export const DEFAULT_COLORS = {
  gradientStart: '#7C3AED',
  gradientEnd: '#EC4899',
  title: '#FFFFFF',
  dark: '#0A0A0F',
} as const;

/**
 * Voile de dégradé peint PAR-DESSUS le fond.
 *
 * Le compositeur peint la photo puis ce voile ; l'aperçu fait pareil. Y
 * laisser un dégradé plein cacherait la photo à l'écran alors que la vidéo la
 * montrerait.
 */
export function gradientOverlayCss(
  start: string,
  end: string,
  opacity: number,
): string {
  const o = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.3;
  return `linear-gradient(180deg, ${hexToRgba(start, o)} 0%, rgba(0,0,0,0) 40%, `
    + `rgba(0,0,0,0) 60%, ${hexToRgba(end, o)} 100%)`;
}

/** `#RRGGBB` + opacité → `rgba(...)`. Rend du noir si la couleur est illisible. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Ratios de carte — mesures de l'éditeur, exprimées en fraction de la largeur
 * vidéo. Elles vivaient dans l'écran ; elles sont ici parce que la
 * composition Remotion doit dessiner les MÊMES cartes.
 *
 * Les dénominateurs (512, 330, 320) ne sont pas interchangeables : ce sont les
 * largeurs de référence sur lesquelles chaque mesure a été calée face au
 * compositeur Canvas. Les uniformiser décalerait le rendu.
 */
export const CARD_RATIO_LANDSCAPE = {
  text: 7 / 512,        // labelSize = fontPx(7)
  value: 9 / 512,       // valueSize = fontPx(9)
  icon: 18 / 512,       // emojiSizeLocal = fixedFontPx(18)
  gap: 6 / 512,         // gap-1.5
  padX: 6 / 512,        // px-1.5
  padY: 6 / 512,        // py-1.5
  radius: 8 / 512,
  /** Interlignes du compositeur : `lineMul` pour le texte, `emojiLineMul` pour l'icone. */
  line: 1.5,
} as const;

export const CARD_RATIO = {
  text: 9 / 330,
  icon: 13 / 330,
  gap: 6 / 330,
  padX: 8 / 330,
  padY: 6 / 330,
  radius: 8 / 330,
} as const;

/** Marge titre/sous-titre et CTA : le compositeur utilise w * 4/320. */
export const GAP_RATIO = 4 / 320;

/**
 * Cadre occupé par les cartes dans le plateau, en pourcentages.
 *
 * C'est ce cadre qui est PHOTOGRAPHIÉ côté navigateur puis blitté dans la
 * vidéo : le rendu serveur doit occuper exactement le même.
 */
export const CARDS_FRAME = { left: '8%', right: '8%', top: '30%', bottom: '22%' } as const;

/** Ratios effectifs selon le format. Le paysage a sa propre table. */
export function cardRatios(landscape: boolean) {
  return landscape
    ? CARD_RATIO_LANDSCAPE
    : { ...CARD_RATIO, value: CARD_RATIO.text };
}

/**
 * Tailles de police, en fraction de la largeur vidéo.
 *
 * ⚠️ Le carré reprend les ratios du 16:9, et ce n'est pas un choix
 * esthétique : le compositeur ne connaît pas les formats, il teste
 * `isReel = h > w`. Pour un canvas 1080×1080 cette condition est FAUSSE — il
 * applique donc les métriques du paysage. Y mettre des valeurs « mieux
 * adaptées au carré » ferait diverger l'aperçu de l'export : ce serait plus
 * joli à l'écran et faux dans la vidéo.
 */
export const FONT_RATIO = {
  '9:16': { title: 0.04375, subtitle: 0.028, cta: 0.0375, ctaSub: 0.028 },
  '1:1': { title: 0.035, subtitle: 0.0215, cta: 0.031, ctaSub: 0.023 },
  '16:9': { title: 0.035, subtitle: 0.0215, cta: 0.031, ctaSub: 0.023 },
} as const;

/** Placement et largeurs par défaut du titre et du CTA. */
export const TEXT_LAYOUT = {
  /** Titre : bord gauche à 8 %, haut à 8 %. Nécessite `titleAlign: 'left'`. */
  titlePos: { x: 8, y: 8 },
  titleWidth: 84,
  /** CTA : bas-centre. Le défaut du compositeur est y=97 ; on fixe 92. */
  ctaPos: { x: 50, y: 92 },
  ctaWidth: 70,
} as const;

/**
 * Ombres du compositeur, en fraction de la largeur vidéo.
 * `dropShadowLgFilter` vaut 4/320 et 10/320 ; `dropShadowBaseFilter` 2.5/320.
 */
export function titleShadow(w: number): string {
  const px = (r: number) => Math.max(1, Math.round(w * r));
  return `drop-shadow(0 ${px(4 / 320)}px ${px(3 / 320)}px rgba(0,0,0,0.1)) drop-shadow(0 ${px(10 / 320)}px ${px(8 / 320)}px rgba(0,0,0,0.04))`;
}

export function subtitleShadow(w: number): string {
  const px = (r: number) => Math.max(1, Math.round(w * r));
  return `drop-shadow(0 ${px(2.5 / 320)}px ${px(2 / 320)}px rgba(0,0,0,0.1))`;
}

/**
 * Compense l'interligne pour que la boîte du texte colle aux glyphes.
 *
 * Le canvas dessine à partir de la LIGNE DE BASE ; le DOM, lui, centre le
 * glyphe dans sa boîte de ligne et ajoute donc `(L-1)·F/2` en haut comme en
 * bas. À l'interligne par défaut l'écart est de deux pixels ; à 2,0 il atteint
 * 24 px sur le titre. Les marges négatives rendent la boîte au ras des
 * glyphes, comme le canvas.
 */
export function leadingTrim(fontSizePx: number, lineHeight: number): { marginTop: number; marginBottom: number } {
  const half = ((lineHeight - 1) * fontSizePx) / 2;
  return { marginTop: -half, marginBottom: -half };
}

/** Espacement des lettres : l'éditeur le donne en pixels d'une base 320. */
export function letterSpacingPx(value: number, vw: number): number {
  return (value * vw) / 320;
}
