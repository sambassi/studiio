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
  /**
   * Contrôle qualité du MP4 final (`controle-qualite-mp4.ts`), mesuré sur le fichier avant
   * téléversement ; `null` si ffmpeg n'a pas pu le juger. Un fichier INUTILISABLE n'arrive
   * jamais ici : le rendu échoue avant le dépôt.
   */
  controleMp4?: import('@/lib/render/controle-qualite-mp4').ResultatControleMp4 | null;
  /**
   * Moteur réellement utilisé : `HYBRID` (ffmpeg + images fixes),
   * `REMOTION_FALLBACK` (hybride tenté, échoué, Remotion complet) ou
   * `REMOTION` (hybride non applicable à ce montage).
   */
  moteur?: 'HYBRID' | 'REMOTION_FALLBACK' | 'REMOTION';
  /** Pourquoi le rendu hybride n'a pas servi (échec exact ou non-applicabilité). */
  hybrideRaison?: string | null;
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
  /**
   * Contrôle qualité du MP4 final (`controle-qualite-mp4.ts`) — « montage amélioré », compte
   * administrateur seulement (`montage-ameliore-config.ts`, décidé par `produireUnMontage`).
   * Absent ou faux : AUCUN contrôle, rendu et dépôt exactement comme en production.
   */
  controleMp4Actif?: boolean;
}): Promise<RenderedMontage> {
  const { renderCreerSimple } = await import('@/lib/render/creerSimple');
  const { uploadToStorage } = await import('@/lib/storage/upload');

  // ── SSRF / TOCTOU : le moteur de rendu ne lit QUE notre stockage ──────
  // Remotion (`OffthreadVideo`, `Img`, `Audio`), ffmpeg (hybride) et
  // `parseMedia` relisent eux-mêmes les URL qu'on leur donne, redirections
  // et DNS compris. Tout média externe est donc copié AVANT, par le fetch sûr
  // (`medias-externes.ts`), et le rendu ne reçoit que des URL de notre
  // stockage. Un refus (adresse interne, redirection hors liste) fait
  // échouer le rendu — jamais de repli sur l'URL d'origine.
  const { localiserEntreesRendu } = await import('@/lib/securite/medias-externes');
  input = { ...input, design: await localiserEntreesRendu(input.design) };

  // Le worker rapporte 20 → 95 % : ramené à 0..1.
  const onProgress = input.onComposition
    ? ({ progress }: { progress: number }) => input.onComposition!(Math.min(1, Math.max(0, (progress - 20) / 75)))
    : undefined;

  // ── RENDU HYBRIDE d'abord (ffmpeg + images fixes), quand il s'applique ──
  // Même plan, mêmes textes, même musique ; Chromium ne voit plus la vidéo.
  // Au moindre échec : le rendu Remotion complet, comme avant.
  const { raisonNonEligibleHybride, rendreHybride } = await import('@/lib/render/hybride/rendu');
  let rendu: { outputPath: string; durationFrames: number } | null = null;
  let mesuresHybride: Record<string, number> | null = null;
  let mesuresTextes: RenderedMontage['mesuresTextes'] = null;
  let hybrideRaison = raisonNonEligibleHybride(input.design);
  let moteur: NonNullable<RenderedMontage['moteur']> = 'REMOTION';
  if (hybrideRaison === null) {
    const t0 = Date.now();
    try {
      const h = await rendreHybride({ jobId: input.jobId, userId: input.userId, design: input.design, onProgress });
      rendu = h;
      moteur = 'HYBRID';
      mesuresHybride = { ...h.mesures };
      mesuresTextes = h.textes;
    } catch (err) {
      moteur = 'REMOTION_FALLBACK';
      hybrideRaison = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      mesuresHybride = { tentativeMs: Date.now() - t0 };
      console.warn(`[Autopilote/Rendu] ${input.jobId} — MOTEUR_RENDU=REMOTION_FALLBACK — HYBRID_FALLBACK_REASON=${hybrideRaison}`);
    }
  } else {
    console.log(`[Autopilote/Rendu] ${input.jobId} — MOTEUR_RENDU=REMOTION — hybride non applicable : ${hybrideRaison}`);
  }
  if (!rendu) {
    rendu = await renderCreerSimple({ jobId: input.jobId, userId: input.userId, design: input.design, onProgress });
  }
  const { outputPath, durationFrames } = rendu;
  input.onEnvoi?.();

  // Contrôle qualité du fichier final, AVANT la vignette (un fichier rejeté ne laisse rien en ligne) :
  // observe, ne modifie rien. Seul un fichier illisible, sans vidéo ou vide échoue ICI (gestion d'erreur
  // du rendu), jamais livré. Les défauts
  // mineurs partent en avertissements ; une panne du contrôle lui-même ne bloque jamais.
  let controleMp4: import('@/lib/render/controle-qualite-mp4').ResultatControleMp4 | null = null;
  try {
    if (input.controleMp4Actif === true) {
      const { controlerMp4 } = await import('@/lib/render/controle-qualite-mp4');
      controleMp4 = await controlerMp4(outputPath, { son: 'inconnu' }, { ffmpeg: ffmpegPath() });
    }
  } catch (err) {
    console.warn(`[Autopilote/Rendu] ${input.jobId} — contrôle qualité du MP4 indisponible :`, err instanceof Error ? err.message : err);
  }
  if (controleMp4?.niveau === 'inutilisable') {
    const { unlink } = await import('fs/promises');
    await unlink(outputPath).catch(() => {});
    throw new Error(`Montage final inutilisable : ${controleMp4.problemes.map((p) => p.message).join(' ')}`);
  }
  if (controleMp4?.problemes.length) {
    console.warn(`[Autopilote/Rendu] ${input.jobId} — CONTROLE_MP4 ${JSON.stringify(controleMp4.problemes.map((p) => p.code))}`);
  }

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

  return { videoUrl, thumbnailUrl, durationFrames, audio, controleMp4, moteur, hybrideRaison, mesuresHybride, mesuresTextes };
}
