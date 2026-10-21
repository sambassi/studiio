/**
 * STYLES VIDÉO — des PRÉRÉGLAGES de montage, rien d'autre.
 *
 * Un style ne crée aucun moteur : il POSE, en une fois, des réglages que
 * Créer sait déjà appliquer à l'aperçu ET au MP4 (compositeur navigateur) :
 *
 *   - rythme       → profil de montage EXISTANT (`REGLES_PROFILS`), imposé
 *                    au plan (`planMontage({ profil })`) au lieu d'être déduit
 *                    du thème ;
 *   - transition   → une clé de `TRANSITION_KEYS` (durée fixe du moteur :
 *                    `TRANSITION_SECONDS`, 0,8 s — elle n'est pas réglable) ;
 *   - animation    → une clé de `TEXT_ANIMATION_KEYS` ;
 *   - typographie  → police (parmi les 5 polices `next/font`), casse, graisse,
 *                    interlettrage, interligne, taille relative du titre, du
 *                    CTA et des cartes ;
 *   - habillage    → mode d'habillage de la séquence Vidéo + intensité du
 *                    voile (`gradientOpacity`) — JAMAIS les couleurs, qui
 *                    restent celles du kit de marque ;
 *   - cartes       → un style de `CARD_STYLES`.
 *
 * Ce que le style NE touche PAS : le texte, la voix, la musique et le mixage
 * (qualité sonore validée), la durée des séquences (dictée par la voix), les
 * positions (zones sûres), les couleurs, les médias, la LUT.
 *
 * Module PUR (aucun React, DOM ni réseau) : l'Autopilote pourra le lire plus
 * tard sans changer de forme. Il n'est PAS branché sur l'Autopilote ici.
 *
 * DEFAULT SAFE : aucun style choisi (`null`) = aucun réglage posé, aucun
 * profil imposé — le rendu d'avant, à l'identique.
 */
import type { TransitionStyle } from '@/lib/video-composer';
import type { TextAnimation } from '@/lib/creer/textAnimation';
import type { ProfilMontage } from '@/lib/creer/smart-montage';
import type { ModeHabillage } from '@/lib/creer/habillageVideo';
import type { TextCase } from '@/lib/creer/textFormat';

/** Les 5 polices servies par `next/font` — la seule liste qu'un style peut viser. */
export const POLICES_STYLE = ['Anton', 'Syne', 'Bebas Neue', 'Poppins', 'Space Grotesk'] as const;
export type PoliceStyle = typeof POLICES_STYLE[number];

export type StyleVideoId = 'minimaliste' | 'sport' | 'cinematique';

/** Traitement d'un bloc de texte (titre ou CTA) — champs que les deux moteurs lisent déjà. */
export interface TraitementTexte {
  font: PoliceStyle;
  textCase: TextCase;
  bold: boolean;
  letterSpacing: number;
  lineHeight: number;
  /**
   * Échelle posée. ⚠️ 1 = la taille AUTOMATIQUE lisible (titre ajusté à son
   * cadre selon la police, CTA ×1,5 en 9:16 — `ajustementCta.ts`) : toute
   * autre valeur couperait cet ajustement. Les trois styles gardent donc 1 ;
   * la présence du texte vient de la police, de la casse et de l'interlettrage.
   */
  scale: number;
}

export interface StyleVideo {
  id: StyleVideoId;
  libelle: string;
  /** Une ligne, affichée sous le nom. */
  description: string;
  /** Le détail, derrière l'icône d'information. */
  detail: string[];
  rythme: {
    /** Profil EXISTANT du moteur de plan (`REGLES_PROFILS`). */
    profil: Exclude<ProfilMontage, 'STANDARD'>;
    /** Libellé lisible des bornes de durée de plan de ce profil (s). */
    plans: string;
  };
  transition: {
    cle: TransitionStyle;
    /** Durée du moteur (fixe) — rappelée ici, jamais réglée par le style. */
    secondes: number;
  };
  animationTexte: TextAnimation;
  titre: TraitementTexte;
  cta: TraitementTexte;
  cartes: {
    /** Libellé de `CARD_STYLES`. */
    style: string;
    font: PoliceStyle;
    /** Échelle du texte des cartes (1 = départ). */
    scale: number;
  };
  habillage: {
    mode: ModeHabillage;
    /** Intensité du voile (0–1), `gradientOpacity`. */
    voile: number;
  };
}

/** Durée d'une transition dans le moteur (`TRANSITION_SECONDS`, designSpec). */
const DUREE_TRANSITION_MOTEUR = 0.8;

export const STYLES_VIDEO: readonly StyleVideo[] = Object.freeze([
  {
    id: 'minimaliste',
    libelle: 'Minimaliste premium',
    description: 'Épuré, aéré, des plans qui prennent leur temps.',
    detail: [
      'Rythme posé : plans de 1,5 à 3 s.',
      'Fondus enchaînés doux, texte sans animation.',
      'Space Grotesk fin, casse d’origine, cartes sans cadre.',
      'Voile léger, aucun habillage sur la vidéo.',
    ],
    rythme: { profil: 'LIFESTYLE_BRAND', plans: '1,5–3 s' },
    transition: { cle: 'crossfade', secondes: DUREE_TRANSITION_MOTEUR },
    animationTexte: 'none',
    titre: { font: 'Space Grotesk', textCase: 'none', bold: false, letterSpacing: 1, lineHeight: 1.15, scale: 1 },
    cta: { font: 'Space Grotesk', textCase: 'none', bold: false, letterSpacing: 1, lineHeight: 1.2, scale: 1 },
    cartes: { style: 'Text Only', font: 'Space Grotesk', scale: 0.95 },
    habillage: { mode: 'aucun', voile: 0.3 },
  },
  {
    id: 'sport',
    libelle: 'Sport dynamique',
    description: 'Coupes courtes sur le rythme, titres forts.',
    detail: [
      'Rythme nerveux : plans de 0,8 à 2 s, coupes sur les percussions de la musique quand elle est analysée.',
      'Transitions franches (balayage rapide), texte qui surgit (Pop).',
      'Anton en capitales ; cartes chiffrées.',
      'Voile appuyé et dégradé sur la vidéo.',
    ],
    rythme: { profil: 'CARDIO_DANCE', plans: '0,8–2 s' },
    transition: { cle: 'whip-pan', secondes: DUREE_TRANSITION_MOTEUR },
    animationTexte: 'pop',
    titre: { font: 'Anton', textCase: 'uppercase', bold: false, letterSpacing: 0.5, lineHeight: 1.05, scale: 1 },
    cta: { font: 'Anton', textCase: 'uppercase', bold: false, letterSpacing: 1, lineHeight: 1.1, scale: 1 },
    cartes: { style: 'Stats Bold', font: 'Poppins', scale: 1.05 },
    habillage: { mode: 'degrade', voile: 0.6 },
  },
  {
    id: 'cinematique',
    libelle: 'Cinématique',
    description: 'Plans qui respirent, fondus discrets, typo élégante.',
    detail: [
      'Rythme ample : plans de 2,5 à 5 s.',
      'Fondus avec flou, texte qui apparaît en fondu.',
      'Bebas Neue très espacé ; CTA en Syne ; cartes au filet fin.',
      'Voile cinéma léger, aucun habillage sur la vidéo.',
    ],
    rythme: { profil: 'TUTORIAL_EDUCATION', plans: '2,5–5 s' },
    transition: { cle: 'blur-dissolve', secondes: DUREE_TRANSITION_MOTEUR },
    animationTexte: 'fade',
    titre: { font: 'Bebas Neue', textCase: 'uppercase', bold: false, letterSpacing: 6, lineHeight: 1.1, scale: 1 },
    cta: { font: 'Syne', textCase: 'uppercase', bold: true, letterSpacing: 1.5, lineHeight: 1.2, scale: 1 },
    cartes: { style: 'Minimal Line', font: 'Syne', scale: 1 },
    habillage: { mode: 'aucun', voile: 0.45 },
  },
] as StyleVideo[]);

export const STYLE_VIDEO_IDS: readonly StyleVideoId[] = Object.freeze(STYLES_VIDEO.map((s) => s.id));

/** Le style de cet identifiant, ou `null` (absent, inconnu, ancien projet). */
export function styleVideoParId(id: unknown): StyleVideo | null {
  return typeof id === 'string' ? STYLES_VIDEO.find((s) => s.id === id) ?? null : null;
}

/** Identifiant valide, sinon `undefined` — pour le brouillon et la metadata. */
export function lireStyleVideoId(brut: unknown): StyleVideoId | undefined {
  return styleVideoParId(brut)?.id;
}

/** Profil de montage imposé par le style ; `null` sans style = profil déduit du thème, comme avant. */
export function profilDuStyle(id: unknown): Exclude<ProfilMontage, 'STANDARD'> | null {
  return styleVideoParId(id)?.rythme.profil ?? null;
}

/**
 * L'état de Créer qu'un style sait régler. Les objets de texte portent
 * d'autres champs (couleur, italique, alignement…) : ils sont CONSERVÉS.
 */
export interface EtatStylable {
  transition: TransitionStyle;
  textAnimation: TextAnimation;
  titleStyle: { font: string; scale: number; bold: boolean; letterSpacing: number; lineHeight: number; textCase?: TextCase } & Record<string, unknown>;
  ctaStyle: { font: string; scale: number; bold: boolean; letterSpacing: number; lineHeight: number; textCase?: TextCase } & Record<string, unknown>;
  cardStyle: string;
  cardsTypography: { font?: string; scale?: number } & Record<string, unknown>;
  gradientOpacity: number;
  habillageVideoMode: ModeHabillage;
}

/**
 * Pose les réglages du style sur l'état. Pur : renvoie un NOUVEL état, ne
 * touche à rien d'autre (couleurs, italique, alignement, textes, audio…).
 */
export function appliquerStyle<E extends EtatStylable>(etat: E, style: StyleVideo): E {
  const texte = <T extends EtatStylable['titleStyle']>(courant: T, t: TraitementTexte): T => ({
    ...courant,
    font: t.font,
    textCase: t.textCase,
    bold: t.bold,
    letterSpacing: t.letterSpacing,
    lineHeight: t.lineHeight,
    scale: t.scale,
  });
  return {
    ...etat,
    transition: style.transition.cle,
    textAnimation: style.animationTexte,
    titleStyle: texte(etat.titleStyle, style.titre),
    ctaStyle: texte(etat.ctaStyle, style.cta),
    cardStyle: style.cartes.style,
    cardsTypography: { ...etat.cardsTypography, font: style.cartes.font, scale: style.cartes.scale },
    gradientOpacity: style.habillage.voile,
    habillageVideoMode: style.habillage.mode,
  };
}

/** Réglages de l'état qui ne sont PLUS ceux du style (retouches de l'utilisateur), en libellés. */
export function retouchesAuStyle(etat: EtatStylable, style: StyleVideo): string[] {
  const attendu = appliquerStyle(etat, style);
  const ecarts: string[] = [];
  const diff = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const champsTexte = ['font', 'textCase', 'bold', 'letterSpacing', 'lineHeight', 'scale'] as const;
  const texteDiffere = (x: Record<string, unknown>, y: Record<string, unknown>) => champsTexte.some((k) => diff(x[k], y[k]));
  if (diff(etat.transition, attendu.transition)) ecarts.push('Transition');
  if (diff(etat.textAnimation, attendu.textAnimation)) ecarts.push('Animation du texte');
  if (texteDiffere(etat.titleStyle, attendu.titleStyle)) ecarts.push('Titre');
  if (texteDiffere(etat.ctaStyle, attendu.ctaStyle)) ecarts.push('CTA');
  if (diff(etat.cardStyle, attendu.cardStyle)
    || diff(etat.cardsTypography.font, attendu.cardsTypography.font)
    || diff(etat.cardsTypography.scale, attendu.cardsTypography.scale)) ecarts.push('Cartes');
  if (Math.abs(etat.gradientOpacity - attendu.gradientOpacity) > 1e-6 || etat.habillageVideoMode !== attendu.habillageVideoMode) ecarts.push('Habillage');
  return ecarts;
}

/** Ressources statiques de la galerie (rendues par le vrai compositeur, `e2e/banc/rendus/styles-video.sh`). */
export function exempleStyle(id: StyleVideoId): { video: string; poster: string } {
  return { video: `/styles-video/${id}.mp4`, poster: `/styles-video/${id}.jpg` };
}
