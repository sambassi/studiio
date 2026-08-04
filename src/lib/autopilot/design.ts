import {
  DEFAULT_SEQUENCE_SECONDS, RUSH_SEQUENCE_SECONDS, DEFAULT_COLORS, VIDEO_SIZE,
} from '@/lib/creer/designSpec';
import { DEFAULT_TRANSITION, CURRENT_COMPOSER_VERSION } from '@/lib/video-composer';
import { DEFAULT_TEXT_ANIMATION } from '@/lib/creer/textAnimation';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';
import type { PreparedPost } from '@/lib/autopilot/engine';

/**
 * Le design que l'Autopilote confie au rendu serveur.
 *
 * Fonctions PURES : rien de React, rien de réseau. C'est ce qui rend
 * vérifiable sur des valeurs ce qui ne se constaterait sinon qu'en regardant
 * une vidéo produite par un cron à trois heures du matin.
 *
 * ⚠️ L'AUTOPILOTE COMPOSE SANS ÉCRAN, donc sans personne pour régler quoi que
 * ce soit. Il doit produire exactement le montage qu'un utilisateur obtient
 * en ouvrant l'assistant et en ne touchant à rien : mêmes durées, mêmes
 * couleurs, même transition, même animation. D'où les constantes importées de
 * `designSpec` plutôt que redites ici — deux jeux de « valeurs par défaut »
 * auraient fini par diverger, et l'écart n'aurait sauté aux yeux de personne.
 *
 * ⚠️ SANS RUSH, ON REND QUAND MÊME. `buildSequences` retire une séquence de
 * durée nulle : un montage sans banque de rushes sort en titre → cartes → CTA,
 * ce qui est un montage valide, pas un montage amputé. Sauter la production
 * aurait été le choix inverse — et le pire des deux, puisque l'utilisateur
 * n'aurait rien vu arriver sans savoir pourquoi.
 */

/** Filigrane par défaut, comme le Mode simple. */
export const AUTOPILOT_WATERMARK = 'Studiio.pro';

/** Format produit par l'Autopilote : le vertical, celui des réseaux. */
export const AUTOPILOT_FORMAT = '9:16' as const;

/**
 * Durée de la séquence vidéo pour un rush donné.
 *
 * L'Autopilote ne décode pas le fichier — un cron n'a pas de lecteur vidéo.
 * Il prend donc le repli du Mode simple, celui qu'applique l'assistant quand
 * la durée du rush est illisible.
 */
export function autopilotVideoSeconds(rushUrl: string | null): number {
  return rushUrl ? RUSH_SEQUENCE_SECONDS.fallback : DEFAULT_SEQUENCE_SECONDS.video;
}

/**
 * Design de rendu serveur, à partir d'un contenu préparé.
 *
 * Le titre passe en MAJUSCULES comme dans le Mode simple : c'est ce que
 * `SequenceTitle` applique de toute façon (`textTransform: 'uppercase'`), et
 * l'écrire ici garde le post et la vidéo d'accord sur la même chaîne.
 */
export function buildAutopilotDesign(post: PreparedPost): CreerSimpleRenderInput {
  const video = autopilotVideoSeconds(post.rushUrl);
  return {
    title: post.title.toUpperCase(),
    subtitle: post.content.subtitle,
    cards: post.content.cards.map((c) => ({
      icon: c.icon,
      title: c.title,
      description: c.description,
      value: c.value,
    })),
    ctaText: post.content.tagLine,
    videoUrl: post.rushUrl,
    introDuration: DEFAULT_SEQUENCE_SECONDS.intro,
    cardsDuration: DEFAULT_SEQUENCE_SECONDS.cards,
    videoDuration: video,
    ctaDuration: DEFAULT_SEQUENCE_SECONDS.cta,
    gradientStart: DEFAULT_COLORS.gradientStart,
    gradientEnd: DEFAULT_COLORS.gradientEnd,
    titleColor: DEFAULT_COLORS.title,
    watermark: AUTOPILOT_WATERMARK,
    transition: DEFAULT_TRANSITION,
    textAnimation: DEFAULT_TEXT_ANIMATION,
    format: AUTOPILOT_FORMAT,
  };
}

/**
 * Métadonnées du post, dans la forme que le Calendrier sait relire.
 *
 * ⚠️ C'EST LE FORMAT DU MODE SIMPLE QUI FAIT FOI, et il n'est pas décoratif :
 * le Calendrier reconstruit son aperçu et toute régénération à partir de ces
 * clés. En écrire d'autres produirait un post lisible par personne.
 *
 * Ce qui est volontairement ABSENT ici — positions libres du titre et du CTA,
 * cartes déplacées à la main, éléments posés, fonds par séquence — n'a pas de
 * valeur à donner : l'Autopilote ne dispose de rien de tout cela, et écrire
 * des positions inventées ferait diverger l'aperçu du Calendrier de la vidéo
 * réellement rendue. Les lecteurs retombent sur leurs défauts, qui sont
 * exactement ceux qu'a utilisés le rendu.
 */
export function buildAutopilotMetadata(input: {
  post: PreparedPost;
  design: CreerSimpleRenderInput;
  videoUrl: string;
  thumbnailUrl?: string | null;
  mode: string;
}): Record<string, unknown> {
  const { post, design, videoUrl, thumbnailUrl, mode } = input;
  const taille = VIDEO_SIZE[AUTOPILOT_FORMAT];
  const total = (design.introDuration ?? 0) + (design.cardsDuration ?? 0)
    + (design.videoDuration ?? 0) + (design.ctaDuration ?? 0);
  return {
    source: 'autopilote',
    autopilotMode: mode,
    // Le montage EST rendu : plus rien n'attend le navigateur. Le champ reste
    // écrit — à `false` — parce que l'écran l'a lu tant qu'il valait `true`,
    // et qu'un champ disparu se lit `undefined`, donc faux par accident
    // plutôt que par décision.
    pendingRender: false,
    // Les DEUX clés que le Calendrier interroge, dans cet ordre, pour
    // retrouver le montage.
    videoUrl,
    renderedVideoUrl: videoUrl,
    /**
     * ⚠️ CES TROIS CHAMPS EMPÊCHENT UNE RECOMPOSITION DESTRUCTRICE.
     *
     * Le Calendrier propose « Régénérer le montage » dès qu'un post n'a pas
     * de `thumbnailUrl`, ou dont le `composerVersion` n'est pas le courant.
     * Cette régénération recompose DANS LE NAVIGATEUR, en mode rapide — donc
     * un WebM aux métadonnées temporelles cassées — puis ÉCRASE `media_url`,
     * `videoUrl` et `renderedVideoUrl`. Un montage serveur parfaitement
     * lisible se retrouvait remplacé par un fichier illisible, et c'est
     * exactement ce qui a été observé en production.
     *
     * `serverRendered` dit la vérité que les deux autres ne disent pas : ce
     * montage ne vient pas du compositeur navigateur. Le Calendrier s'en sert
     * pour ne jamais proposer de le refaire, même après une montée de
     * version du compositeur.
     */
    thumbnailUrl: thumbnailUrl || undefined,
    posterUrl: thumbnailUrl || undefined,
    composerVersion: CURRENT_COMPOSER_VERSION,
    serverRendered: true,
    hasAudio: false,
    videoSize: { w: taille.w, h: taille.h },
    cards: post.content.cards,
    subtitle: design.subtitle,
    cta: design.ctaText,
    // Le rush reste noté : c'est lui que relit une régénération depuis le
    // Calendrier. Sans lui, elle produirait le même montage AMPUTÉ de sa
    // séquence vidéo.
    rushUrls: post.rushUrl ? [post.rushUrl] : [],
    rawVideoUrl: post.rushUrl ?? undefined,
    sequences: {
      intro: design.introDuration,
      cards: design.cardsDuration,
      video: design.videoDuration,
      cta: design.ctaDuration,
      total,
      order: ['intro', 'cards', 'video', 'cta'],
    },
    branding: {
      accentColor: DEFAULT_COLORS.gradientStart,
      ctaText: design.ctaText,
      watermarkText: design.ctaText,
      borderEnabled: false,
      borderColor: null,
    },
    design: {
      textAnimation: design.textAnimation,
      transition: design.transition,
      titleColor: design.titleColor,
      titleAlign: 'left',
      gradientColor1: design.gradientStart,
      gradientColor2: design.gradientEnd,
      ctaMainText: design.ctaText,
      siteText: { enabled: true, text: AUTOPILOT_WATERMARK },
    },
  };
}
