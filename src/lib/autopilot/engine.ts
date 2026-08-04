import { generateSmartContent } from '@/lib/smart-content';
import { pickRush, statusForMode, type AutopilotConfig } from '@/lib/autopilot/rules';

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

/** Créneau de publication par défaut — début de soirée. */
export const DEFAULT_SLOT_TIME = '18:00';

export interface PreparedPost {
  title: string;
  caption: string;
  scheduledDate: string;
  scheduledTime: string;
  platforms: string[];
  rushUrl: string | null;
  /** Contenu prêt pour le compositeur — cartes, CTA. */
  content: ReturnType<typeof generateSmartContent>;
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

/** Date du n-ième montage du cycle, en repartant de demain. */
export function slotDate(base: Date, index: number): string {
  const d = new Date(base.getTime());
  // Demain, puis un jour de plus par montage : deux publications le même jour
  // se feraient concurrence dans le fil de l'utilisateur.
  d.setDate(d.getDate() + 1 + index);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  topic: string;
  count: number;
  now: number;
}): PreparedPost[] {
  const { config, topic, count, now } = input;
  const base = new Date(now);
  const out: PreparedPost[] = [];
  for (let i = 0; i < count; i += 1) {
    const content = generateSmartContent(topic, contentSeed(now, i));
    // `generateSmartContent` rend `subtitle`, `tagLine` et `cards` — pas de
    // titre : c'est le sujet lui-meme qui en tient lieu, comme dans le Mode
    // simple.
    out.push({
      title: topic,
      caption: [content.subtitle, content.tagLine].filter(Boolean).join('\n\n'),
      scheduledDate: slotDate(base, i),
      scheduledTime: DEFAULT_SLOT_TIME,
      platforms: config.platforms,
      rushUrl: pickRush(config.rushUrls, config.lastRushUrl, i),
      content,
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
      slotKey: slotKey(userId, post.scheduledDate, post.scheduledTime),
    } as Record<string, unknown>,
  };
}
