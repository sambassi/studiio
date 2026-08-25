/**
 * Valeurs par defaut du contrat canonique.
 *
 * ⚠️ Ce sont des defauts d'AFFICHAGE, jamais des valeurs enregistrees.
 * `resolveCanonicalDesign` les applique en lecture ; `toPostMetadata` ne les
 * ecrit pas. Sans cette separation, ouvrir un post puis l'enregistrer sans
 * rien changer graverait dans ses metadonnees trente champs que
 * l'utilisateur n'a jamais choisis — et figerait pour toujours des defauts
 * appeles a evoluer.
 *
 * Chaque valeur reproduit le comportement ACTUEL du code, et non ce qui
 * serait souhaitable :
 *
 *   - durees des sequences  -> les replis de `regenerateMontage`
 *                              (`calendar/page.tsx`, `safeDuration`)
 *   - couleurs et textes    -> les replis de la meme fonction
 *   - volumes audio         -> l'etat initial du parcours guide
 *                              (`AssistantWizard`, `useState(0.5)` / `useState(1)`)
 *   - incrustations         -> la documentation de `DesignOptions`
 *                              (`overlayEndTime < 0` = jusqu'a la fin)
 */

import { deepFreeze } from './internal';
import type { ResolvedCanonicalDesign } from './types';

/**
 * Le design entierement resolu, tous champs connus renseignes.
 *
 * Gele en profondeur : un appelant qui muterait ce singleton empoisonnerait
 * toutes les resolutions suivantes du processus.
 */
export const DEFAULT_CANONICAL_DESIGN: ResolvedCanonicalDesign = deepFreeze({
  version: 1,
  source: 'unknown',

  content: {
    subtitle: '',
    salesPhrase: '',
  },

  /**
   * Aucune dimension par defaut — volontairement.
   *
   * Choisir 1080x1920 recadrerait tout montage paysage ou carre dont le post
   * ne porte pas `videoSize`. L'absence est l'information exacte : c'est a
   * l'appelant, qui connait `post.format`, de trancher.
   */
  format: {
    videoSize: null,
  },

  media: {
    posterUrl: null,
    pexelsUrl: null,
    videoUrl: null,
    videoImageUrl: null,
    rushKind: null,
    rushUrls: [],
    rawVideoUrl: null,
    logoUrl: null,
    characterUrl: null,
    renderedVideoUrl: null,
    thumbnailUrl: null,
    composerVersion: null,
  },

  cards: {
    cards: [],
    textCards: [],
    cardGroups: [],
  },

  sequences: {
    intro: 5,
    cards: 6,
    video: 12,
    cta: 5,
    /** Vide = aucun reordonnancement : le compositeur garde intro/cards/video/cta. */
    order: [],
  },

  branding: {
    accentColor: '#D91CD2',
    ctaText: "CHAT POUR PLUS D'INFOS",
    ctaSubText: 'LIEN EN BIO',
    borderEnabled: false,
    borderColor: null,
  },

  audio: {
    musicUrl: null,
    voiceUrl: null,
    musicVolume: 0.5,
    voiceVolume: 1,
    hasAudio: false,
    audioKeyframes: [],
    sequenceVoiceUrls: {},
  },

  overlays: {
    videoOverlayText: null,
    overlays: [],
    overlayTextScale: 1,
    overlayStartTime: 0,
    /** Negatif = l'incrustation joue jusqu'a la fin de la sequence video. */
    overlayEndTime: -1,
    overlayPosition: null,
    overlayColor: null,
  },

  designOptions: {},
} as ResolvedCanonicalDesign);
