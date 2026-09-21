import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { transcodeWebmToMp4WithLadder } from '@/lib/ffmpeg/transcode-to-mp4';
import {
  downloadMediaToFile,
  ErreurTelechargement,
  MAX_MEDIA_DOWNLOAD_BYTES,
} from '@/lib/storage/fetch-media';
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

const REPONSE_401 = { success: false, error: 'Non autorisé' } as const;
const REPONSE_400 = { success: false, error: 'Requête invalide' } as const;
const REPONSE_404 = { success: false, error: 'Média introuvable' } as const;
const REPONSE_413 = { success: false, error: 'Média trop volumineux' } as const;
const REPONSE_422 = { success: false, error: 'Source vidéo vide ou corrompue' } as const;
const REPONSE_500 = { success: false, error: 'La conversion a échoué' } as const;
const REPONSE_504 = { success: false, error: 'Délai de téléchargement dépassé' } as const;

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

    console.log('[CONVERT-API]', { conversionId, etape: 'debut', userId: userId.slice(0, 8), bucket });

    // 5. Téléchargement borné, dans un fichier temporaire propre à cette conversion.
    let sizeBytes: number;
    try {
      ({ sizeBytes } = await downloadMediaToFile(videoUrl, inputPath, {
        userId,
        maxBytes: MAX_MEDIA_DOWNLOAD_BYTES,
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

    // 6. Conversion via l'échelle partagée (1080p → 720p → 540p, délais par
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

    // 7. Dépôt sous le compte, sous un nom unique — jamais d'écrasement.
    const fileName = `${conversionId}.mp4`;
    const storagePath = `${userId}/converted/${fileName}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('media')
      .upload(storagePath, mp4Buffer, {
        contentType: 'video/mp4',
        upsert: false,
      });

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
    // Au mieux, sur TOUS les chemins — y compris après un téléchargement
    // partiel interrompu (413, 504) ou une conversion tuée.
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
