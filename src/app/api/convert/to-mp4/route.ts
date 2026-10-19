import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { clientMinio } from '@/lib/storage/minio-client';
import { transcodeWebmToMp4WithLadder } from '@/lib/ffmpeg/transcode-to-mp4';
import {
  downloadMediaToFile,
  ErreurTelechargement,
} from '@/lib/storage/fetch-media';
import {
  limiteurConversions,
  MESSAGE_CONVERSION_EN_COURS,
  MESSAGE_SERVEUR_OCCUPE,
  RETRY_AFTER_CONVERSION_S,
  TAILLE_MAX_SOURCE_CONVERSION,
  type JetonConversion,
} from '@/lib/ffmpeg/limiteur-conversions';
import {
  cibleRecevable,
  cleDuCompteStrict,
  extraireCibleStockage,
  originesStockageConfigurees,
} from '@/lib/storage/acces-objet';

// Allow up to 300s for video conversion (Vercel Pro plan)
export const maxDuration = 300;

/**
 * POST /api/convert/to-mp4 — convertit UN objet WebM du compte en MP4.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE REFUSE, ET DANS QUEL ORDRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. Sans session → 401. Rien d'autre ne tourne : ni lecture du corps, ni
 *    résolution de ffmpeg, ni fichier temporaire.
 * 2. `videoUrl` doit être une chaîne bornée → sinon 400.
 * 3. La valeur est RÉDUITE à une cible de stockage (`bucket` + `cle`) par
 *    `extraireCibleStockage`, sur les seules origines configurées. Une URL
 *    étrangère, un schéma exotique, une adresse locale, une requête (`?`),
 *    un compartiment inconnu : tout cela ne donne AUCUNE cible. Puis la
 *    cible doit être recevable (pas d'espace privé : analyse, montages, lut,
 *    source d'avatar) et appartenir STRICTEMENT au compte — le préfixe
 *    partagé `converted/` n'est pas accepté ici : un objet converti n'est
 *    jamais une source de conversion.
 *
 *    ⚠️ LE REFUS EST UN 404 UNIFORME. Un code distinct par motif dirait
 *    « ce compartiment existe », « cette clé est à quelqu'un d'autre ». On
 *    rend exactement ce que rend un objet absent, et on ne dit jamais
 *    pourquoi.
 *
 * 4. Seulement APRÈS ces contrôles : si la CLÉ validée n'est pas un `.webm`,
 *    il n'y a rien à convertir. On rend l'URL publique RECONSTRUITE depuis
 *    la cible validée — jamais l'entrée brute renvoyée en écho.
 *
 * 5. Puis le PLAFOND DE CONCURRENCE (`limiteur-conversions`) : une seule
 *    conversion à la fois par compte, deux par processus → sinon 429 avec
 *    `Retry-After`. Le jeton est pris après les refus gratuits (401/400/404,
 *    raccourci non-webm) et rendu dans le `finally`, sur TOUS les chemins.
 * 6. La source est bornée à `TAILLE_MAX_SOURCE_CONVERSION` (300 Mio) : une
 *    taille annoncée par le stockage au-delà → 413 avant de lire le corps ;
 *    une taille inconnue est coupée au flux par la même borne.
 *
 * `fetch-media` refait ses propres contrôles au téléchargement. Les refaire
 * ici, avant, garantit que le raccourci non-webm et le 404 n'ont jamais
 * touché le stockage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LA RÉPONSE NE CONTIENT JAMAIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni chemin temporaire, ni ligne de commande ffmpeg, ni `stderr`, ni message
 * du SDK de stockage, ni taille de la source. Les corps d'erreur sont des
 * chaînes statiques. Le détail utile au diagnostic va dans le journal
 * serveur, sous `conversionId`, et le journal ne porte jamais l'URL reçue,
 * la clé ni l'URL publique produite.
 */

const LONGUEUR_MAX_URL = 2048;
const TAILLE_MIN_OCTETS = 1024;
/** Délai du dépôt de la sortie (≤ 300 Mio sur le réseau interne MinIO). */
const DELAI_DEPOT_MS = 120_000;

const REPONSE_401 = { success: false, error: 'Non autorisé' } as const;
const REPONSE_400 = { success: false, error: 'Requête invalide' } as const;
const REPONSE_404 = { success: false, error: 'Média introuvable' } as const;
const REPONSE_413 = { success: false, error: 'Média trop volumineux' } as const;
const REPONSE_422 = { success: false, error: 'Source vidéo vide ou corrompue' } as const;
const REPONSE_500 = { success: false, error: 'La conversion a échoué' } as const;
const REPONSE_504 = { success: false, error: 'Délai de téléchargement dépassé' } as const;
const REPONSE_429_COMPTE = { success: false, error: MESSAGE_CONVERSION_EN_COURS } as const;
const REPONSE_429_GLOBAL = { success: false, error: MESSAGE_SERVEUR_OCCUPE } as const;

// Resolve FFmpeg binary path — tries multiple locations for Vercel compatibility
async function resolveFFmpegPath(): Promise<string> {
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath) {
      await access(staticPath);
      return staticPath;
    }
  } catch {}

  const candidates = [
    join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    '/var/task/node_modules/ffmpeg-static/ffmpeg',
  ];
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {}
  }

  return 'ffmpeg'; // system fallback
}

/**
 * Dépose la sortie. Sur MinIO (`STORAGE_PROVIDER=s3`, la prod), via un
 * client à ÉCHÉANCE ABSOLUE (`clientMinio({ timeoutMs })`, socket détruite
 * au délai) : le client partagé de `supabaseAdmin.storage` n'est pas borné,
 * et un `putObject` bloqué n'y serait jamais réglé. Hors MinIO, l'adaptateur
 * historique, inchangé. Même forme de résultat dans les deux cas.
 */
async function deposerSortie(
  storagePath: string,
  mp4Buffer: Buffer,
): Promise<{ error: { message: string } | null }> {
  if ((process.env.STORAGE_PROVIDER || '').toLowerCase() === 's3') {
    try {
      await clientMinio({ timeoutMs: DELAI_DEPOT_MS })
        .putObject('media', storagePath, mp4Buffer, mp4Buffer.length, { 'Content-Type': 'video/mp4' });
      return { error: null };
    } catch (err) {
      return { error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }
  const { error } = await supabaseAdmin.storage
    .from('media')
    .upload(storagePath, mp4Buffer, { contentType: 'video/mp4', upsert: false });
  return { error: error ? { message: error.message } : null };
}

type StatutTelechargement = 404 | 413 | 500 | 504;

/** Le statut HTTP que mérite un échec de téléchargement, par catégorie. */
function statutTelechargement(code: ErreurTelechargement['code'] | undefined): StatutTelechargement {
  switch (code) {
    case 'trop_volumineux': return 413;
    case 'delai': return 504;
    case 'introuvable':
    case 'acces_refuse':
    case 'cible_invalide': return 404;
    default: return 500;
  }
}

function reponseTelechargement(statut: StatutTelechargement) {
  const corps = statut === 404 ? REPONSE_404
    : statut === 413 ? REPONSE_413
    : statut === 504 ? REPONSE_504
    : REPONSE_500;
  return NextResponse.json(corps, { status: statut });
}

export async function POST(req: NextRequest) {
  // 1. La session d'abord. Rien d'autre ne tourne sans elle.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(REPONSE_401, { status: 401 });
  }

  const conversionId = randomUUID();
  const inputPath = join(tmpdir(), `convert_${conversionId}.webm`);
  const outputPath = join(tmpdir(), `convert_${conversionId}.mp4`);
  let jeton: JetonConversion | null = null;
  /** Vrai quand un dépôt en retard rendra lui-même le jeton à son règlement. */
  let liberationDifferee = false;

  try {
    // 2. Un corps borné.
    let videoUrl: unknown;
    try {
      ({ videoUrl } = (await req.json()) ?? {});
    } catch {
      return NextResponse.json(REPONSE_400, { status: 400 });
    }
    if (typeof videoUrl !== 'string' || videoUrl.length === 0 || videoUrl.length > LONGUEUR_MAX_URL) {
      return NextResponse.json(REPONSE_400, { status: 400 });
    }

    // 3. La cible, réduite et contrôlée AVANT tout accès au stockage.
    const cible = extraireCibleStockage(videoUrl, { origines: originesStockageConfigurees() });
    if (
      !cible
      || !cibleRecevable(cible.bucket, cible.cle)
      || !cleDuCompteStrict(cible.cle, userId)
    ) {
      return NextResponse.json(REPONSE_404, { status: 404 });
    }
    const { bucket, cle } = cible;

    // 4. Rien à convertir : l'URL est RECONSTRUITE depuis la cible validée.
    if (!cle.toLowerCase().endsWith('.webm')) {
      const { data: { publicUrl } } = supabaseAdmin.storage.from(bucket).getPublicUrl(cle);
      return NextResponse.json({ success: true, mp4Url: publicUrl, skipped: true });
    }

    // 5. Plafond de concurrence — AVANT tout téléchargement ou ffmpeg.
    jeton = limiteurConversions().acquerir(userId);
    if (!jeton.ok) {
      console.warn('[CONVERT-API]', { conversionId, etape: 'refus_concurrence', motif: jeton.motif });
      return NextResponse.json(
        jeton.motif === 'compte' ? REPONSE_429_COMPTE : REPONSE_429_GLOBAL,
        { status: 429, headers: { 'Retry-After': String(RETRY_AFTER_CONVERSION_S) } },
      );
    }

    console.log('[CONVERT-API]', { conversionId, etape: 'debut', userId: userId.slice(0, 8), bucket });

    // 6. Téléchargement borné, dans un fichier temporaire propre à cette conversion.
    let sizeBytes: number;
    try {
      ({ sizeBytes } = await downloadMediaToFile(videoUrl, inputPath, {
        userId,
        maxBytes: TAILLE_MAX_SOURCE_CONVERSION,
      }));
    } catch (err) {
      const code = err instanceof ErreurTelechargement ? err.code : undefined;
      const statut = statutTelechargement(code);
      console.error('[CONVERT-API]', { conversionId, etape: 'telechargement', code: code ?? 'inconnu', statut });
      return reponseTelechargement(statut);
    }
    console.log('[CONVERT-API]', { conversionId, etape: 'telecharge', sizeBytes });

    // Guard: refuse to feed FFmpeg a suspiciously small file.
    if (sizeBytes < TAILLE_MIN_OCTETS) {
      console.warn('[CONVERT-API]', { conversionId, etape: 'source_trop_petite', sizeBytes });
      return NextResponse.json(REPONSE_422, { status: 422 });
    }

    // 7. Conversion via l'échelle partagée (1080p → 720p → 540p, délais par
    //    palier). Le détail d'un échec — ligne de commande, stderr — reste
    //    dans le journal serveur ; il ne porte pas l'URL.
    const ffmpegPath = await resolveFFmpegPath();
    let stderr = '';
    let attempt = '';
    try {
      ({ stderr, attempt } = await transcodeWebmToMp4WithLadder(ffmpegPath, inputPath, outputPath, '[CONVERT-API]'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[CONVERT-API]', { conversionId, etape: 'ffmpeg', stderrTail: message.slice(-500) });
      return NextResponse.json(REPONSE_500, { status: 500 });
    }

    // Output validation — FFmpeg may exit 0 yet produce a near-empty file
    // when the input has issues that didn't trigger an outright error
    // (corrupted timestamps, etc.).
    const mp4Buffer = await readFile(outputPath);
    if (mp4Buffer.length < TAILLE_MIN_OCTETS) {
      console.error('[CONVERT-API]', {
        conversionId, etape: 'sortie_trop_petite', attempt, outputBytes: mp4Buffer.length,
        stderrTail: stderr.slice(-500),
      });
      return NextResponse.json(REPONSE_500, { status: 500 });
    }

    // 8. Dépôt sous le compte, sous un nom unique — jamais d'écrasement.
    const fileName = `${conversionId}.mp4`;
    const storagePath = `${userId}/converted/${fileName}`;
    // Borné dans le temps pour la RÉPONSE, pas pour le jeton. Le client de
    // stockage n'offre pas d'annulation : un dépôt qui dépasse le délai
    // continue en mémoire (le buffer MP4 reste tenu). Au délai, on répond
    // 500, mais le jeton n'est rendu qu'au RÈGLEMENT réel du dépôt — sinon
    // N requêtes lentes garderaient N buffers en vol hors plafond. Un dépôt
    // qui aboutit en retard est supprimé : la réponse a déjà dit « échec ».
    // En prod (MinIO), le dépôt passe par un client BORNÉ au même délai,
    // qui détruit la socket à l'échéance : la promesse se règle donc
    // toujours, et le jeton ne peut pas rester pris indéfiniment.
    // (ffmpeg et le téléchargement, eux, sont attendus jusqu'au bout : tués
    // ou interrompus par leurs propres délais AVANT que la route ne rende.)
    const televersement = deposerSortie(storagePath, mp4Buffer);
    let minuteurDepot: ReturnType<typeof setTimeout> | undefined;
    const delaiDepot = new Promise<'delai'>((resoudre) => {
      minuteurDepot = setTimeout(() => resoudre('delai'), DELAI_DEPOT_MS);
    });
    const issueDepot = await Promise.race([televersement, delaiDepot])
      .finally(() => clearTimeout(minuteurDepot));

    if (issueDepot === 'delai') {
      console.error('[CONVERT-API]', { conversionId, etape: 'depot_delai', outputBytes: mp4Buffer.length });
      if (jeton.ok) {
        const jetonDepot = jeton;
        liberationDifferee = true;
        // Le jeton est rendu au RÈGLEMENT du dépôt — pas après la suppression
        // de l'orphelin, qui ne retient plus de buffer et ne doit pas pouvoir
        // retenir le jeton.
        void televersement
          .then((r) => r, () => ({ error: { message: 'rejet' } }))
          .then((r) => {
            jetonDepot.liberer();
            if (!r?.error) {
              void supabaseAdmin.storage.from('media').remove([storagePath])
                .then(() => console.warn('[CONVERT-API]', { conversionId, etape: 'depot_tardif_supprime' }))
                .catch(() => undefined);
            }
          })
          .catch(() => jetonDepot.liberer());
      }
      return NextResponse.json(REPONSE_500, { status: 500 });
    }
    const uploadError = issueDepot.error;

    if (uploadError) {
      console.error('[CONVERT-API]', { conversionId, etape: 'depot', outputBytes: mp4Buffer.length });
      return NextResponse.json(REPONSE_500, { status: 500 });
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('media')
      .getPublicUrl(storagePath);

    console.log('[CONVERT-API]', { conversionId, etape: 'fin', attempt, outputBytes: mp4Buffer.length });
    return NextResponse.json({ success: true, mp4Url: publicUrl, attempt, conversionId });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[CONVERT-API]', { conversionId, etape: 'inattendu', name, message: message.slice(0, 200) });
    return NextResponse.json(REPONSE_500, { status: 500 });
  } finally {
    // Le jeton d'abord : rien ci-dessous ne doit pouvoir le retenir — sauf
    // un dépôt encore en vol, qui le rendra lui-même à son règlement.
    if (jeton?.ok && !liberationDifferee) jeton.liberer();
    // Au mieux, sur TOUS les chemins — y compris après un téléchargement
    // partiel interrompu (413, 504) ou une conversion tuée.
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
