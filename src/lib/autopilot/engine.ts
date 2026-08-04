import { generateSmartContent } from '@/lib/smart-content';
import { pickRush, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * Ce que l'Autopilote prépare à chaque passage.
 *
 * Fonctions PURES : la route ne fait que les appliquer et écrire en base.
 *
 * ⚠️ L'AUTOPILOTE NE COMPOSE PAS LA VIDÉO, et ce n'est pas un choix.
 *
 * `composeVideo` est un compositeur de NAVIGATEUR — Canvas, `MediaRecorder`,
 * `document.createElement`. Une route Next tourne dans Node : elle ne peut
 * pas l'exécuter. Et les cartes du Mode simple sont une PHOTOGRAPHIE du DOM
 * de l'aperçu (`cardsSnapshot`), qui n'existe pas dans un cron.
 *
 * Le moteur prépare donc tout ce qui peut l'être sans navigateur — contenu,
 * rush, créneau, réglages — et dépose le post en BROUILLON. Le montage se
 * compose à l'ouverture, dans le navigateur, là où le compositeur tourne.
 *
 * Conséquences assumées, expliquées dans la PR :
 *
 * - Le statut est TOUJOURS `draft`, y compris en mode « publier
 *   automatiquement » : `/api/cron/publish` refuse un post sans média sur une
 *   plateforme sociale. Programmer une publication vouée à échouer serait
 *   pire que d'annoncer qu'il reste une étape.
 * - AUCUN crédit n'est débité : rien n'a été rendu. Débiter ici ferait payer
 *   deux fois le même montage, puisque la composition débitera à son tour.
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
 * Lignes à insérer dans `scheduled_posts`.
 *
 * `status: 'draft'` sans condition — voir l'en-tête de fichier. Le mode
 * choisi est conservé dans les métadonnées : c'est lui que l'écran lira pour
 * savoir s'il doit programmer la publication une fois le montage composé.
 */
export function toPostRow(userId: string, post: PreparedPost, config: AutopilotConfig) {
  return {
    user_id: userId,
    title: post.title,
    caption: post.caption,
    media_type: 'video' as const,
    platforms: post.platforms,
    scheduled_date: post.scheduledDate,
    scheduled_time: post.scheduledTime,
    status: 'draft' as const,
    agent_generated: true,
    metadata: {
      source: 'autopilote',
      // Le mode voulu, conservé pour l'après-composition.
      autopilotMode: config.mode,
      // Ce qui reste à faire, dit explicitement plutôt que deviné à l'écran.
      pendingRender: true,
      cards: post.content.cards,
      cta: post.content.tagLine,
      subtitle: post.content.subtitle,
      // Le rush choisi devient la séquence Vidéo à la composition.
      rushUrls: post.rushUrl ? [post.rushUrl] : [],
      rawVideoUrl: post.rushUrl ?? undefined,
    },
  };
}
