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
  /** Son réellement mesuré dans le MP4 final ; `null` si la mesure a échoué. */
  audio?: import('@/lib/render/audio-fichier').MesureAudioFichier | null;
  /** Moteur réellement utilisé : `hybride` (ffmpeg) ou `remotion` (complet). */
  moteur?: 'hybride' | 'remotion';
  /** Durées du rendu hybride (images fixes, copie des sources, ffmpeg). */
  mesuresHybride?: Record<string, number> | null;
  /** Conseiller : taille, fond et zones mesurés des textes (rendu hybride seulement). */
  mesuresTextes?: import('@/lib/creer/conseiller/lisibilite').ElementLisibilite[] | null;
}

/**
 * Chemin du binaire ffmpeg — paquet embarqué, sinon celui du système.
 *
 * ⚠️ `require('ffmpeg-static')` rend un CHEMIN même quand le binaire n'a
 * jamais été téléchargé (installation sans scripts, image qui ne l'a pas
 * copié) : la vignette échouait alors en ENOENT alors que le ffmpeg système
 * était là. Sans vignette, le Calendrier propose une régénération navigateur
 * qui écrase le montage serveur — d'où le contrôle d'existence.
 */
function ffmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string | null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (p && require('fs').existsSync(p)) return p;
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
  /** Avancement réel de la composition (0..1). Facultatif. */
  onComposition?: (fraction: number) => void;
  /** Début du dépôt de la vidéo. Facultatif. */
  onEnvoi?: () => void;
}): Promise<RenderedMontage> {
  const { renderCreerSimple } = await import('@/lib/render/creerSimple');
  const { uploadToStorage } = await import('@/lib/storage/upload');

  // Le worker rapporte 20 → 95 % : ramené à 0..1.
  const onProgress = input.onComposition
    ? ({ progress }: { progress: number }) => input.onComposition!(Math.min(1, Math.max(0, (progress - 20) / 75)))
    : undefined;

  // ── RENDU HYBRIDE d'abord (ffmpeg + images fixes), quand il s'applique ──
  // Même plan, mêmes textes, même musique ; Chromium ne voit plus la vidéo.
  // Au moindre échec : le rendu Remotion complet, comme avant.
  const { estEligibleHybride, rendreHybride } = await import('@/lib/render/hybride/rendu');
  let rendu: { outputPath: string; durationFrames: number } | null = null;
  let moteur: 'hybride' | 'remotion' = 'remotion';
  let mesuresHybride: Record<string, number> | null = null;
  let mesuresTextes: RenderedMontage['mesuresTextes'] = null;
  if (estEligibleHybride(input.design)) {
    try {
      const h = await rendreHybride({ jobId: input.jobId, design: input.design, onProgress });
      rendu = h;
      moteur = 'hybride';
      mesuresHybride = { ...h.mesures };
      mesuresTextes = h.textes;
    } catch (err) {
      console.warn(`[Autopilote/Rendu] ${input.jobId} — rendu hybride impossible, rendu Remotion complet :`, err instanceof Error ? err.message : err);
    }
  }
  if (!rendu) {
    rendu = await renderCreerSimple({ jobId: input.jobId, design: input.design, onProgress });
  }
  const { outputPath, durationFrames } = rendu;
  input.onEnvoi?.();

  // La vignette AVANT le téléversement de la vidéo : `uploadToStorage`
  // supprime le fichier temporaire une fois en ligne, et il n'y aurait plus
  // rien à photographier ensuite.
  const thumbnailUrl = await extraireVignette(outputPath, input.userId, input.jobId);
  // Le son RÉEL du fichier rendu, avant qu'il ne quitte le disque.
  const { mesurerAudioFichier } = await import('@/lib/render/audio-fichier');
  const audio = await mesurerAudioFichier(outputPath, ffmpegPath());
  if (audio?.silencieux) {
    console.warn(`[Autopilote/Rendu] ${input.jobId} — fichier final SANS SON audible (piste ${audio.piste ? 'présente' : 'absente'}, crête ${audio.maxDb} dB)`);
  }

  // `uploadToStorage` supprime le fichier temporaire une fois en ligne : sans
  // ça, un cron quotidien remplirait le disque du serveur en quelques mois.
  const videoUrl = await uploadToStorage({
    filePath: outputPath,
    bucket: RENDER_BUCKET,
    storagePath: `${input.userId}/autopilote-${input.jobId}.mp4`,
  });

  return { videoUrl, thumbnailUrl, durationFrames, audio, moteur, mesuresHybride, mesuresTextes };
}
