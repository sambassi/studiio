/**
 * Une ligne `videos` s'édite à travers UN `scheduled_posts` relié.
 *
 * Le lien est la colonne existante `scheduled_posts.video_id → videos.id`
 * (`002_complete_schema.sql`, ON DELETE SET NULL). Aucune migration : on s'en
 * sert, on n'en invente pas d'autre. Un `videos.id` n'est JAMAIS utilisé comme
 * `postId` : les deux tables n'ont pas les mêmes identifiants.
 *
 * Pourquoi un post et pas la vidéo elle-même : le parcours guidé ne sait
 * enregistrer que par `PATCH /api/posts/[id]`, et `videos.metadata` ne porte ni
 * cartes, ni séquences, ni design — de quoi reconstruire un brouillon, pas un
 * montage.
 *
 * Ce module est PUR : il ne lit ni n'écrit aucune base.
 */

interface LinkedCandidate {
  id: string;
  created_at?: string | null;
}

/**
 * Le post qui fait foi quand plusieurs pointent la même vidéo.
 *
 * Aucune contrainte d'unicité n'existe sur `video_id` (et on n'en ajoute pas).
 * Deux clics concurrents peuvent donc insérer deux posts ; la règle doit être
 * DÉTERMINISTE pour que chaque requête désigne le même gagnant et supprime le
 * sien s'il a perdu : le plus ANCIEN, puis le plus petit `id`.
 */
export function pickLinkedPost<T extends LinkedCandidate>(posts: readonly T[]): T | null {
  let best: T | null = null;
  for (const p of posts) {
    if (!best) { best = p; continue; }
    const a = p.created_at ?? '';
    const b = best.created_at ?? '';
    if (a < b || (a === b && p.id < best.id)) best = p;
  }
  return best;
}

/** `videos.id` → id du post qui fait foi, pour une liste de posts d'UN utilisateur. */
export function linkedPostIdByVideo(
  posts: readonly (LinkedCandidate & { video_id?: string | null })[],
): Map<string, string> {
  const groups = new Map<string, LinkedCandidate[]>();
  for (const p of posts) {
    if (typeof p.video_id !== 'string' || !p.video_id) continue;
    const g = groups.get(p.video_id) ?? [];
    g.push(p);
    groups.set(p.video_id, g);
  }
  const out = new Map<string, string>();
  for (const [videoId, g] of groups) {
    const winner = pickLinkedPost(g);
    if (winner) out.set(videoId, winner.id);
  }
  return out;
}

interface SourceVideo {
  id: string;
  title?: string | null;
  format?: string | null;
  metadata?: unknown;
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Metadata du post, traduite depuis `videos.metadata` (formes de
 * `dashboard/infographic` et `AgentIAModal`).
 *
 * Seules les clés PRÉSENTES et bien typées sont recopiées, sous le nom que lit
 * le parcours guidé (`toWizardDraft`). Rien n'est déduit : une vidéo rendue par
 * Remotion (`compositionId`, `inputProps`…) donne une metadata vide, et le
 * brouillon s'ouvre sobre plutôt que faux.
 */
function toPostMetadata(raw: unknown): Record<string, unknown> {
  const m = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  if (isString(m.subtitle)) out.subtitle = m.subtitle;
  if (isString(m.salesPhrase)) out.salesPhrase = m.salesPhrase;
  if (isString(m.objective)) out.objective = m.objective;
  if (isString(m.posterPhotoUrl)) out.posterUrl = m.posterPhotoUrl;
  if (Array.isArray(m.rushUrls)) {
    const rushs = m.rushUrls.filter(isString);
    if (rushs.length > 0) out.rushUrls = rushs;
  }
  if (isString(m.musicUrl)) out.musicUrl = m.musicUrl;
  if (isString(m.voiceUrl)) out.voiceUrl = m.voiceUrl;
  // Le montage déjà rendu : conservé tel quel, pour que la publication et
  // l'aperçu du Calendrier lisent la même vidéo que la Bibliothèque.
  if (isString(m.renderedVideoUrl)) out.renderedVideoUrl = m.renderedVideoUrl;
  return out;
}

/** Date du jour à Paris, `YYYY-MM-DD` — même fuseau que le cron de publication. */
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * Ligne `scheduled_posts` à insérer pour rendre une vidéo modifiable.
 *
 * Brouillon, sans plateforme : rien ne peut partir en publication tant que
 * l'utilisateur ne l'a pas planifié. `media_url` est le montage exportable de la
 * vidéo (même cascade que `repost` et l'export), calculé par l'appelant.
 */
export function buildEditablePostRow(
  video: SourceVideo,
  userId: string,
  scheduledDate: string,
  mediaUrl: string | null = null,
) {
  const metadata = toPostMetadata(video.metadata);
  return {
    user_id: userId,
    video_id: video.id,
    title: isString(video.title) ? video.title : '',
    caption: (metadata.salesPhrase as string | undefined) ?? (metadata.subtitle as string | undefined) ?? '',
    media_url: mediaUrl,
    media_type: 'video' as const,
    format: video.format === 'tv' ? 'tv' : 'reel',
    platforms: [] as string[],
    scheduled_date: scheduledDate,
    scheduled_time: '12:00',
    status: 'draft' as const,
    metadata,
  };
}
