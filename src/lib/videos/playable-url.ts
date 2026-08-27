/**
 * OU se trouve le fichier a lire, pour une ligne de la table `videos`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La colonne `videos.video_url` n'est plus alimentee depuis le navigateur :
 * `POST /api/videos` la refuse, parce qu'un client pouvait s'y declarer
 * `completed` avec l'URL de son choix. C'est une bonne regle, et elle reste.
 *
 * Mais les deux ecrans qui creent ces lignes — `dashboard/infographic` et
 * `AgentIAModal` — composent leur montage DANS le navigateur puis le
 * televersent : ils sont les seuls a en connaitre l'URL. Ils la posent aussi
 * dans `metadata.renderedVideoUrl`, qui traverse la liste blanche. Sans ce
 * resolveur, la Bibliotheque ne regardait que la colonne, la trouvait nulle,
 * et retombait sur le RUSH BRUT : l'utilisateur voyait sa video source au
 * lieu de son montage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA CLE EST `renderedVideoUrl`, ET ELLE SEULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le piege a connaitre : il existe AUSSI un `metadata.videoUrl` dans ce
 * depot, et il est ambigu — il porte le montage pour les posts d'infographie
 * et de l'autopilote, mais le RUSH pour l'editeur avance
 * (`creer-avance/page.tsx:2272` le lit explicitement comme un rush) et pour
 * l'Assistant. `postMetadata/types.ts` documente cette ambiguite comme une
 * dette assumee, et `cron/publish/route.ts:457` l'exclut nommement de sa
 * priorite : « meta.videoUrl is EXCLUDED from priority because it often
 * contains the raw rush URL ».
 *
 * Sur la table `videos`, la question ne se pose meme pas : personne n'y ecrit
 * `metadata.videoUrl`. Seul `renderedVideoUrl` y existe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE RESOLVEUR NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il LIT. Il ne deplace aucune URL, ne reecrit aucune ligne, ne change aucun
 * statut. Une video reste `draft` : lire son montage n'est pas l'avoir rendue.
 */

/** Ce dont le resolveur a besoin — volontairement plus permissif que `Video`. */
export interface SourceVideo {
  video_url?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Chaine non vide, ou `null`. Une URL vide ne vaut pas mieux qu'une absente. */
function urlOuNull(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
}

function meta(video: SourceVideo | null | undefined): Record<string, unknown> {
  const m = video?.metadata;
  return m && typeof m === 'object' ? m as Record<string, unknown> : {};
}

/**
 * Le MONTAGE, et rien d'autre.
 *
 * 1. `video_url` — la colonne, quand un rendu serveur l'a remplie ;
 * 2. `metadata.renderedVideoUrl` — le montage compose dans le navigateur ;
 * 3. `null` — il n'y a pas de montage. Pas de repli sur le rush ici : rendre
 *    un rush sous le nom de « montage » est exactement la confusion que ce
 *    fichier existe pour supprimer.
 */
export function resolveMontageUrl(video: SourceVideo | null | undefined): string | null {
  return urlOuNull(video?.video_url) ?? urlOuNull(meta(video).renderedVideoUrl);
}

/**
 * Ce qu'on peut LIRE dans un lecteur video.
 *
 * Le montage d'abord ; le rush brut seulement s'il n'y a pas de montage. Ce
 * dernier repli est le comportement historique, conserve tel quel : sans lui,
 * les lignes anterieures a tout montage n'afficheraient plus rien.
 */
export function resolvePlayableVideoUrl(video: SourceVideo | null | undefined): string | null {
  const rushs = meta(video).rushUrls;
  const premierRush = Array.isArray(rushs) ? urlOuNull(rushs[0]) : null;
  return resolveMontageUrl(video) ?? premierRush;
}

/**
 * Ce qu'on peut TELECHARGER ou reposter.
 *
 * Prolonge la lecture par les images d'affiche : une infographie sans montage
 * ni rush reste exportable en image. Cascade reprise a l'identique de
 * `videos/[id]/export` et `videos/[id]/repost`, qui la portaient chacun de
 * leur cote, mot pour mot — a ceci pres qu'elles ignoraient le montage.
 */
export function resolveExportableUrl(video: SourceVideo | null | undefined): string | null {
  const m = meta(video);
  return resolvePlayableVideoUrl(video)
    ?? urlOuNull(m.posterPhotoUrl)
    ?? urlOuNull(m.characterImageUrl);
}
