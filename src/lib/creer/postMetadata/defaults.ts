/**
 * Valeurs par defaut du contrat de metadonnees.
 *
 * ⚠️ Ce sont des defauts d'AFFICHAGE, jamais des valeurs enregistrees.
 * `resolveCanonicalDesign` les applique en lecture ; `toPostMetadata` ne les
 * ecrit pas. Sans cette separation, ouvrir un post puis l'enregistrer sans
 * rien changer graverait dans ses metadonnees trente champs que
 * l'utilisateur n'a jamais choisis — et figerait pour toujours des defauts
 * appeles a evoluer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNE SEULE SOURCE POUR LES DUREES : `designSpec.ts`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les durees de sequence NE SONT PAS redites ici : elles sont derivees de
 * `DEFAULT_DURATIONS` (`lib/creer/designSpec.ts`), deja partagee par les deux
 * moteurs de rendu (`video-composer.ts` et Remotion). Une deuxieme table de
 * durees se serait desynchronisee au premier reglage change d'un seul cote,
 * et la divergence ne se serait vue qu'en comparant deux montages image par
 * image.
 *
 * `DEFAULT_DURATIONS` et non `DEFAULT_SEQUENCE_SECONDS` : cette derniere pose
 * `video: 0` parce qu'elle decrit l'etat INITIAL du Mode simple, ou aucun
 * rush n'a encore ete choisi. Un post deja enregistre qu'on relit sans son
 * bloc `sequences` n'est pas dans cet etat-la : lui appliquer 0 supprimerait
 * sa sequence video (`buildSequences` exclut toute sequence de duree nulle,
 * `designSpec.ts`). `DEFAULT_DURATIONS` est la table du montage, c'est celle
 * qui convient a une LECTURE.
 *
 * ⚠️ A savoir : `src/lib/render/creerSimple.ts` recopie encore, EN DUR, les
 * valeurs de `DEFAULT_SEQUENCE_SECONDS` (`?? 4 / ?? 6 / ?? 0 / ?? 4`) sans
 * les importer, alors qu'il importe deja `designSpec`. Un post sans bloc
 * `sequences` recoit donc 10 s de video de ce contrat et 0 s de ce chemin de
 * rendu. La divergence est ANTERIEURE a ce lot et vit hors de lui ; elle est
 * signalee ici parce que c'est le point de contact, et parce qu'elle devra
 * etre reglee dans `creerSimple.ts` — en important la constante — avant que
 * les deux chemins ne se rencontrent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CHAMPS SANS EQUIVALENT DANS `designSpec.ts` — et pourquoi
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   - `branding.accentColor`  `DEFAULT_COLORS` ne porte que `gradientStart`,
 *                             `gradientEnd`, `title` et `dark` : pas de
 *                             couleur d'accent. La valeur ci-dessous est
 *                             celle de `composeVideo` et du Calendrier.
 *   - `branding.ctaText`      Textes d'appel a l'action : hors du champ de
 *     `branding.ctaSubText`   `designSpec`, qui ne fait que de la geometrie.
 *   - `audio.*`               `designSpec` ne parle pas d'audio. Les volumes
 *                             viennent de l'etat initial du parcours guide
 *                             (`AssistantWizard`, `useState(0.5)` / `(1)`).
 *                             ⚠️ TROIS defauts de volume musique coexistent
 *                             deja sur `main`, et aucun n'est partage :
 *                             ici `0.5` ; `video-composer.ts` applique
 *                             `voix ? 0.5 : 0.8` ; `autopilot/rules.ts`
 *                             (`DEFAULT_VOLUMES.music`) pose `0.8`. Un
 *                             montage sans voix n'a donc pas le meme volume
 *                             selon le chemin. Ecart sans effet tant que ce
 *                             contrat ne parle ni au compositeur ni a
 *                             l'Autopilote ; a trancher — au profit d'une
 *                             constante unique — avant tout branchement.
 *   - `overlays.*`            Viennent de la documentation de `DesignOptions`
 *                             (`overlayEndTime < 0` = jusqu'a la fin).
 *   - `format.videoSize`      `designSpec` expose bien `VIDEO_SIZE`, mais il
 *                             est deliberement NON utilise ici : voir la note
 *                             sur le champ lui-meme.
 */

import { DEFAULT_DURATIONS } from '@/lib/creer/designSpec';
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
   * `designSpec.VIDEO_SIZE` existe, mais y piocher 1080x1920 recadrerait tout
   * montage paysage ou carre dont le post ne porte pas `videoSize`. L'absence
   * est l'information exacte : c'est a l'appelant, qui connait `post.format`,
   * de choisir dans `VIDEO_SIZE`.
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

  /** Derive de `designSpec`, jamais redit. Voir l'en-tete du fichier. */
  sequences: {
    intro: DEFAULT_DURATIONS.intro,
    cards: DEFAULT_DURATIONS.cards,
    video: DEFAULT_DURATIONS.video,
    cta: DEFAULT_DURATIONS.cta,
    /** Vide = aucun reordonnancement : l'ordre canonique intro/cards/video/cta. */
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
