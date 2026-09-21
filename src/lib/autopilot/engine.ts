import { generateSmartContent } from '@/lib/smart-content';
import {
  pickRush, statusForMode, sanitizePublishTime, DEFAULT_PUBLISH_TIME, sanitizeBrief, slotDate,
  type AutopilotConfig, type VideoBrief,
} from '@/lib/autopilot/rules';

/**
 * Ce que l'Autopilote prépare à chaque passage.
 *
 * Fonctions PURES : la route ne fait que les appliquer et écrire en base.
 *
 * ⚠️ L'AUTOPILOTE REND DÉSORMAIS LA VIDÉO — et c'est ce qui a changé.
 *
 * Ce fichier expliquait qu'il ne pouvait pas : `composeVideo` est un
 * compositeur de NAVIGATEUR — Canvas, `MediaRecorder`, `document` — qu'une
 * route Next ne peut pas exécuter, et les cartes du Mode simple étaient une
 * photographie du DOM de l'aperçu. La raison était juste ; elle ne l'est
 * plus.
 *
 * La composition Remotion `creer-simple-montage` rend le même montage sous
 * Chromium sans tête, à partir des mêmes composants partagés. Le moteur
 * fabrique donc un design, le fait rendre, téléverse le fichier, et dépose un
 * post qui porte déjà sa vidéo.
 *
 * Deux conséquences directes :
 *
 * - Le statut suit enfin le MODE choisi (`statusForMode`). Il était forcé à
 *   `draft` parce qu'un post sans média est refusé par `/api/cron/publish` :
 *   ce n'est plus le cas, le média existe.
 * - Les crédits sont débités, comme pour un rendu manuel. Ils ne l'étaient
 *   pas parce que rien n'était rendu.
 */

/**
 * Créneau de publication par défaut — début de soirée.
 *
 * ⚠️ RÉEXPORTÉ DEPUIS LES RÈGLES, PAS REDÉFINI. L'écran lit la même
 * constante pour annoncer l'heure ; deux valeurs auraient fini par diverger.
 * Le nom historique reste pour les lecteurs existants (tests, route).
 */
export const DEFAULT_SLOT_TIME = DEFAULT_PUBLISH_TIME;

export interface PreparedPost {
  title: string;
  caption: string;
  scheduledDate: string;
  scheduledTime: string;
  platforms: string[];
  rushUrl: string | null;
  /** Contenu prêt pour le compositeur — cartes, CTA. */
  content: ReturnType<typeof generateSmartContent>;
  /**
   * Le brief récurrent de la configuration, recopié sur chaque montage.
   *
   * C'est lui — et non le sujet seul — qui dit à la narration ce que la
   * vidéo doit transmettre (`voiceTexts`). Absent ou `{}` : textes d'avant.
   */
  brief?: VideoBrief;
}

/**
 * Identifiant de créneau — ce qui rend un cycle IDEMPOTENT.
 *
 * Deux passages du cron le même jour ne doivent pas produire deux fois le
 * même montage. La cadence l'empêche déjà (`isDue` lit `last_run_at`), mais
 * elle ne protège de rien si l'écriture de `last_run_at` échoue APRÈS
 * l'insertion des posts — et c'est précisément l'ordre dans lequel ça se
 * passe. Ce jeton est écrit dans les métadonnées et relu avant d'insérer.
 */
export function slotKey(userId: string, date: string, time: string): string {
  return `${userId}|${date}|${time}`;
}

/**
 * Date du n-ième montage du cycle, en repartant de demain — ou de la date
 * de début si elle est plus tard.
 *
 * ⚠️ DÉFINIE DANS `rules.ts`, RÉEXPORTÉE ICI. L'écran annonce la prochaine
 * publication avec la MÊME fonction que le moteur ; la garder dans un
 * module pur évite une seconde estimation qui finirait par diverger. Les
 * lecteurs existants (`engine.slotDate`) restent servis.
 */
export { slotDate };

/**
 * Sujet envoyé au générateur pour le n-ième montage.
 *
 * La graine varie par passage ET par index : sans elle, deux cycles sur le
 * même thème rendraient exactement le même contenu, et l'Autopilote
 * republierait la même vidéo indéfiniment.
 */
export function contentSeed(now: number, index: number): number {
  return Math.abs(Math.floor(now / 60_000) + index * 7919);
}

/**
 * Prépare les montages d'un passage.
 *
 * `count` est déjà borné par `decideRun` — au nombre voulu ET à ce que le
 * solde permet.
 */
export function preparePosts(input: {
  config: AutopilotConfig;
  /**
   * Sujet de chaque montage.
   *
   * ⚠️ UN PAR MONTAGE, ET NON UN POUR TOUS. Un sujet unique produisait des
   * vidéos identiques : titre, cartes, CTA et jusqu'à la photo d'affiche en
   * découlent. Une chaîne reste acceptée — elle vaut alors pour tous, ce que
   * faisait l'ancien appel.
   */
  topic: string | string[];
  count: number;
  now: number;
}): PreparedPost[] {
  const { config, count, now } = input;
  const sujets = Array.isArray(input.topic) ? input.topic : [input.topic];
  const base = new Date(now);
  // L'heure choisie, minutes comprises — relue par `sanitizePublishTime`
  // parce qu'une configuration construite à la main (tests, anciens appels)
  // peut ne pas porter le champ : on retombe alors sur 18:00, comme avant.
  const heure = sanitizePublishTime(config.publishTime);
  // Relu ici aussi : une configuration construite à la main (tests, anciens
  // appels) peut ne pas porter le champ — `{}` alors, comme avant.
  const brief = sanitizeBrief(config.brief);
  const out: PreparedPost[] = [];
  for (let i = 0; i < count; i += 1) {
    // Le sujet du rang, ou le dernier disponible : jamais `undefined`, qui
    // ferait générer un contenu vide.
    const topic = sujets[i % Math.max(1, sujets.length)] || sujets[0] || 'motivation';
    const content = generateSmartContent(topic, contentSeed(now, i));
    // `generateSmartContent` rend `subtitle`, `tagLine` et `cards` — pas de
    // titre : c'est le sujet lui-meme qui en tient lieu, comme dans le Mode
    // simple.
    out.push({
      title: topic,
      caption: [content.subtitle, content.tagLine].filter(Boolean).join('\n\n'),
      // « Demain » chez l'utilisateur, pas chez le serveur — ou la date de
      // début si elle est plus tard ; et l'heure de publication choisie, pas
      // 18:00 en dur.
      scheduledDate: slotDate(base, i, config.runTimezone, config.startDate),
      scheduledTime: heure,
      platforms: config.platforms,
      rushUrl: pickRush(config.rushUrls, config.lastRushUrl, i),
      content,
      brief,
    });
  }
  return out;
}

/**
 * Ligne à insérer dans `scheduled_posts`, montage déjà rendu.
 *
 * Le statut suit le MODE : `review` dépose un brouillon que l'utilisateur
 * relit, `auto` programme la publication — que le cron de publication prendra
 * en charge, puisque le post porte enfin son média.
 *
 * `media_url` ET `metadata.videoUrl` portent la même URL : le Calendrier lit
 * l'une ou l'autre selon l'écran, et n'en renseigner qu'une donne un post qui
 * s'affiche à un endroit et pas à l'autre.
 */
export function toPostRow(input: {
  userId: string;
  post: PreparedPost;
  config: AutopilotConfig;
  videoUrl: string;
  metadata: Record<string, unknown>;
  /**
   * Jeton de créneau à écrire, quand l'appelant en a un qui n'est PAS celui
   * du cycle — la production manuelle (`manuel:…`), qui ne doit ni compter
   * comme un créneau du cron ni être bloquée par lui. Absent : le jeton du
   * cycle, comme avant.
   */
  slotKey?: string;
}) {
  const { userId, post, config, videoUrl, metadata } = input;
  return {
    user_id: userId,
    // MAJUSCULES, comme le Mode simple : une regeneration depuis le
    // Calendrier repart de `post.title`, et `SequenceTitle` met de toute
    // facon le titre en capitales. Les laisser differer ferait un post et une
    // video qui ne disent pas la meme chose.
    title: post.title.toUpperCase(),
    caption: post.caption,
    media_url: videoUrl,
    media_type: 'video' as const,
    platforms: post.platforms,
    scheduled_date: post.scheduledDate,
    scheduled_time: post.scheduledTime,
    status: statusForMode(config.mode),
    agent_generated: true,
    metadata: {
      ...metadata,
      // Jeton de créneau : relu avant insertion pour ne pas produire deux
      // fois le même montage si un passage a échoué à mi-course.
      slotKey: input.slotKey ?? slotKey(userId, post.scheduledDate, post.scheduledTime),
    } as Record<string, unknown>,
  };
}
