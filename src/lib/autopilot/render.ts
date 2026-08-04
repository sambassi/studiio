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

export interface RenderedMontage {
  /** URL publique du fichier téléversé. */
  videoUrl: string;
  /** Nombre d'images rendues — utile au journal du cycle. */
  durationFrames: number;
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

  // `uploadToStorage` supprime le fichier temporaire une fois en ligne : sans
  // ça, un cron quotidien remplirait le disque du serveur en quelques mois.
  const videoUrl = await uploadToStorage({
    filePath: outputPath,
    bucket: RENDER_BUCKET,
    storagePath: `${input.userId}/autopilote-${input.jobId}.mp4`,
  });

  return { videoUrl, durationFrames };
}
