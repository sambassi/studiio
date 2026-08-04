import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';

/**
 * Rendu serveur d'un montage d'Autopilote, puis mise en ligne.
 *
 * ⚠️ IMPORTS DYNAMIQUES OBLIGATOIRES. `@remotion/bundler` et
 * `@remotion/renderer` sont externalisés dans `next.config.js` : les importer
 * en tête de module casse le build, et c'est le premier piège de tout code
 * qui touche au rendu. Le chemin manuel (`/api/render`) fait exactement
 * pareil, pour la même raison.
 *
 * ⚠️ CE MODULE NE TOURNE QUE CÔTÉ SERVEUR. Il écrit un fichier temporaire,
 * lance un Chromium sans tête, puis téléverse. Rien de tout cela n'existe
 * dans un navigateur.
 */

/** Compartiment de stockage des montages — le même que le chemin manuel. */
export const RENDER_BUCKET = 'videos';

/** Compartiment des vignettes. */
export const THUMBNAIL_BUCKET = 'images';

export interface RenderedMontage {
  /** URL publique du fichier téléversé. */
  videoUrl: string;
  /**
   * Vignette extraite du montage, ou `null` si l'extraction a échoué.
   *
   * ⚠️ ELLE N'EST PAS DÉCORATIVE. Le Calendrier propose « Régénérer le
   * montage » dès qu'un post n'a pas de `thumbnailUrl`, et cette
   * régénération recompose DANS LE NAVIGATEUR, en mode rapide : elle produit
   * un WebM aux métadonnées temporelles cassées (`duration=N/A`), puis
   * ÉCRASE `media_url`, `videoUrl` et `renderedVideoUrl` du post. Un montage
   * serveur parfaitement lisible se retrouve alors remplacé par un fichier
   * que le navigateur ne sait pas lire.
   *
   * La vignette n'est donc pas un agrément : c'est ce qui empêche l'offre de
   * régénération d'apparaître.
   */
  thumbnailUrl: string | null;
  /** Nombre d'images rendues — utile au journal du cycle. */
  durationFrames: number;
}

/** Chemin du binaire ffmpeg — paquet embarqué, sinon celui du système. */
function ffmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static');
    if (p) return p as string;
  } catch { /* paquet absent : on tente le binaire système */ }
  return 'ffmpeg';
}

/**
 * Extrait une vignette JPEG du montage rendu.
 *
 * Prise à UNE SECONDE, pas à zéro : la première image d'un montage est
 * souvent une transition ou un fond nu, et donne une vignette qui ne
 * ressemble à rien.
 *
 * Rend `null` en cas d'échec — un montage livré sans vignette vaut mieux
 * qu'un cycle interrompu. L'appelant journalise.
 */
async function extraireVignette(videoPath: string, userId: string, jobId: string): Promise<string | null> {
  const { promisify } = await import('util');
  const { execFile } = await import('child_process');
  const os = await import('os');
  const path = await import('path');
  const { uploadToStorage } = await import('@/lib/storage/upload');

  const sortie = path.join(os.tmpdir(), `studiio-vignette-${jobId}.jpg`);
  try {
    await promisify(execFile)(ffmpegPath(), [
      '-ss', '1', '-i', videoPath, '-frames:v', '1', '-q:v', '4', '-y', sortie,
    ], { timeout: 60_000 });
    return await uploadToStorage({
      filePath: sortie,
      bucket: THUMBNAIL_BUCKET,
      storagePath: `${userId}/autopilote-${jobId}.jpg`,
    });
  } catch (err) {
    console.error('[Autopilote/Rendu] vignette non extraite :', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Rend le montage et le téléverse, puis rend son URL.
 *
 * `jobId` sert au suivi dans `render_jobs`. L'Autopilote n'y crée pas de
 * ligne : `updateJobStatus` avale ses propres erreurs, si bien qu'un
 * identifiant sans ligne correspondante n'interrompt pas le rendu. C'est
 * assumé — un cron n'a pas d'écran de progression à alimenter, et créer une
 * ligne de suivi que personne ne regarde n'apporterait qu'une écriture de
 * plus à échouer.
 */
export async function renderAndUpload(input: {
  userId: string;
  jobId: string;
  design: CreerSimpleRenderInput;
}): Promise<RenderedMontage> {
  const { renderCreerSimple } = await import('@/lib/render/creerSimple');
  const { uploadToStorage } = await import('@/lib/storage/upload');

  const { outputPath, durationFrames } = await renderCreerSimple({
    jobId: input.jobId,
    design: input.design,
  });

  // La vignette AVANT le téléversement de la vidéo : `uploadToStorage`
  // supprime le fichier temporaire une fois en ligne, et il n'y aurait plus
  // rien à photographier ensuite.
  const thumbnailUrl = await extraireVignette(outputPath, input.userId, input.jobId);

  // `uploadToStorage` supprime le fichier temporaire une fois en ligne : sans
  // ça, un cron quotidien remplirait le disque du serveur en quelques mois.
  const videoUrl = await uploadToStorage({
    filePath: outputPath,
    bucket: RENDER_BUCKET,
    storagePath: `${input.userId}/autopilote-${input.jobId}.mp4`,
  });

  return { videoUrl, thumbnailUrl, durationFrames };
}
