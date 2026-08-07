import {
  DEFAULT_SEQUENCE_SECONDS, RUSH_SEQUENCE_SECONDS, DEFAULT_COLORS, VIDEO_SIZE,
} from '@/lib/creer/designSpec';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { DEFAULT_TRANSITION, CURRENT_COMPOSER_VERSION } from '@/lib/video-composer';
import { DEFAULT_TEXT_ANIMATION } from '@/lib/creer/textAnimation';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';
import type { PreparedPost } from '@/lib/autopilot/engine';
import { sequenceSecondsWithVoice, voiceUrls, type VoixParSequence } from '@/lib/autopilot/voice';

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

/**
 * Filigrane et format — RÉ-EXPORTÉS depuis `brand.ts`.
 *
 * ⚠️ ILS ONT DÛ DÉMÉNAGER. L'aperçu du wizard les lit côté NAVIGATEUR, et
 * importer ce fichier-ci y entraîne toute sa chaîne serveur (`voice` →
 * `storage/upload` → `db/supabase` → `minio`) : le build échouait sur
 * « Can't resolve 'fs/promises' ». Ils vivent donc dans un module FEUILLE,
 * qui n'importe rien. Le ré-export garde tous les appelants inchangés.
 */
export { AUTOPILOT_WATERMARK, AUTOPILOT_FORMAT } from '@/lib/autopilot/brand';
import { AUTOPILOT_WATERMARK, AUTOPILOT_FORMAT } from '@/lib/autopilot/brand';

/**
 * Durée de la séquence vidéo pour un rush donné.
 *
 * ⚠️ `probedSeconds` SUPPRIME LE GEL DE FIN DE MONTAGE. Sans elle, la
 * séquence durait une valeur FIXE de repli : un rush plus court laissait
 * `OffthreadVideo` figé sur sa dernière image le temps restant — l'image se
 * bloquait une seconde ou deux, puis le CTA arrivait. C'est exactement ce
 * qui a été observé.
 *
 * Bornée comme dans le Mode simple : une source d'une heure ne doit pas
 * devenir une séquence d'une heure, et une source d'un dixième de seconde ne
 * doit pas produire un clignotement.
 */
export function autopilotVideoSeconds(
  rushUrl: string | null,
  probedSeconds?: number | null,
): number {
  if (!rushUrl) return DEFAULT_SEQUENCE_SECONDS.video;
  if (typeof probedSeconds === 'number' && Number.isFinite(probedSeconds) && probedSeconds > 0) {
    return Math.min(
      RUSH_SEQUENCE_SECONDS.max,
      Math.max(RUSH_SEQUENCE_SECONDS.min, Math.floor(probedSeconds)),
    );
  }
  // Durée illisible : le repli du Mode simple, celui qu'applique l'assistant
  // dans le même cas.
  return RUSH_SEQUENCE_SECONDS.fallback;
}

/**
 * Design de rendu serveur, à partir d'un contenu préparé.
 *
 * Le titre passe en MAJUSCULES comme dans le Mode simple : c'est ce que
 * `SequenceTitle` applique de toute façon (`textTransform: 'uppercase'`), et
 * l'écrire ici garde le post et la vidéo d'accord sur la même chaîne.
 */
export function buildAutopilotDesign(
  post: PreparedPost,
  options: {
    /** Photo de fond, ou `null` : le dégradé tient alors lieu de fond. */
    posterUrl?: string | null;
    /** Durée RÉELLE du rush, si elle a pu être sondée. */
    rushSeconds?: number | null;
    /** Voix off par séquence, si elles ont pu être générées. */
    voices?: VoixParSequence;
    /**
     * L'identité CONSTANTE du compte.
     *
     * ⚠️ ABSENTE = LES DÉFAUTS, qui sont exactement les valeurs jusqu'ici en
     * dur ici même. Un appelant qui ne la passe pas — un test, un chemin plus
     * ancien — obtient donc le montage d'avant, à l'octet près.
     */
    config?: AutopilotConfig;
  } = {},
): CreerSimpleRenderInput {
  const voix = options.voices ?? {};
  const identite = options.config ?? DEFAULT_CONFIG;
  // La séquence vidéo suit le rush ; si elle est narrée, elle suit aussi sa
  // voix — la plus longue des deux gagne, pour ne couper ni l'un ni l'autre.
  const video = sequenceSecondsWithVoice(
    voix, 'video', autopilotVideoSeconds(post.rushUrl, options.rushSeconds),
  );
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
    // La photo d'affiche du Mode simple : le MÊME champ, rendu au même
    // endroit par `CreerSimpleMontage` — un `<Img>` en fond de séquence,
    // sous le titre, les cartes et le CTA. Absente, le dégradé reprend sa
    // place, comme avant.
    //
    // ⚠️ ELLE VARIE D'UNE VIDÉO À L'AUTRE — c'est la partie mobile de
    // l'Autopilote, tirée du thème par `pickPosterUrl`.
    posterUrl: options.posterUrl ?? null,
    // ⚠️ ET ELLE NE COUVRE PAS FORCÉMENT TOUT. `cardsShowPoster` décide si
    // les CARTES (et le CTA) s'affichent par-dessus cette photo ou sur les
    // couleurs du compte. Faux par défaut : les cartes se lisent mal sur une
    // photo, et l'identité du compte est ce qui doit rester reconnaissable.
    // La séquence titre garde l'affiche dans tous les cas.
    posterOnAllSequences: identite.cardsShowPoster,
    // ⚠️ LE CALAGE A LA VOIX SE FAIT ICI. La Phase 8 avait etabli que cette
    // regle est un effet de l'EDITEUR, qui ecrit la duree dans le design ;
    // l'Autopilote n'a pas d'editeur, personne d'autre ne l'ecrira. La regle
    // (`voiceSequenceSeconds`) est la meme, seul l'endroit change.
    introDuration: sequenceSecondsWithVoice(voix, 'titre', DEFAULT_SEQUENCE_SECONDS.intro),
    cardsDuration: sequenceSecondsWithVoice(voix, 'cartes', DEFAULT_SEQUENCE_SECONDS.cards),
    videoDuration: video,
    ctaDuration: sequenceSecondsWithVoice(voix, 'cta', DEFAULT_SEQUENCE_SECONDS.cta),
    // Voix par sequence : le rendu serveur les joue depuis la Phase 8, au
    // debut NOMINAL de chaque sequence.
    sequenceVoiceUrls: voiceUrls(voix),

    // ── L'IDENTITÉ CONSTANTE ────────────────────────────────────────────
    // Réglée une fois, héritée par toutes les vidéos suivantes. C'est ce qui
    // fait qu'une chaîne produite en pilote automatique se reconnaît d'un
    // post à l'autre, alors même que l'affiche, les textes et le rush
    // changent à chaque fois.
    gradientStart: identite.cardGradientStart,
    gradientEnd: identite.cardGradientEnd,
    titleColor: identite.titleColor,
    // La musique du compte, sur tous les montages.
    musicUrl: identite.musicUrl,
    // Les trois niveaux du mixeur, indépendants.
    musicVolume: identite.musicVolume,
    voiceVolume: identite.voiceVolume,
    rushVolume: identite.rushVolume,
    // ⚠️ LA COUPURE EST EXPLICITE, PAS UN VOLUME À ZÉRO. `rushVolume` reste
    // transmis même quand le son est coupé : rallumer « garder le son du
    // rush » doit rendre le niveau que l'utilisateur avait réglé, pas un
    // niveau perdu en route.
    rushMuted: !identite.keepRushAudio,
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
    // L'affiche du montage si elle existe, sinon la vignette : c'est ce que
    // le Calendrier montre en aperçu statique.
    posterUrl: design.posterUrl || thumbnailUrl || undefined,
    composerVersion: CURRENT_COMPOSER_VERSION,
    serverRendered: true,
    // ⚠️ CE CHAMP ÉTAIT ÉCRIT `false` EN DUR, ce qui était vrai tant que
    // l'Autopilote ne posait ni musique ni voix. Il en pose maintenant : le
    // laisser à `false` ferait annoncer au Calendrier une vidéo muette qui
    // parle, et son bouton « ajouter du son » proposerait de corriger un
    // défaut qui n'existe pas.
    hasAudio: !!design.musicUrl
      || Object.values(design.sequenceVoiceUrls ?? {}).some(Boolean)
      || (!!design.videoUrl && design.rushMuted !== true),
    // La musique du compte, relue par une régénération depuis le Calendrier.
    // Sans elle, le montage regénéré sortirait muet.
    musicUrl: design.musicUrl ?? undefined,
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
      // La couleur du COMPTE, plus celle du dépôt. Écrire `DEFAULT_COLORS`
      // ici faisait diverger l'aperçu du Calendrier de la vidéo réellement
      // rendue dès que l'utilisateur choisissait ses couleurs.
      accentColor: design.gradientStart ?? DEFAULT_COLORS.gradientStart,
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
      // ⚠️ CES CINQ CHAMPS SONT CE QU'UNE RÉGÉNÉRATION DOIT RETROUVER. Le
      // Calendrier reconstruit le design à partir d'ici ; sans eux, un
      // montage regénéré remettrait la photo derrière les cartes, rallumerait
      // le son du rush et perdrait les niveaux du mixeur — l'identité du
      // compte s'effacerait au premier clic sur « Régénérer ».
      posterOnAllSequences: design.posterOnAllSequences,
      musicUrl: design.musicUrl ?? null,
      audioMusicVolume: design.musicVolume,
      audioVoiceVolume: design.voiceVolume,
      audioRushVolume: design.rushMuted ? 0 : design.rushVolume,
    },
  };
}
