/**
 * Proxy route servant les fichiers MinIO via une URL compatible Supabase Storage :
 *   /storage/v1/object/public/{bucket}/{path}
 *
 * Permet de garder les URLs Supabase historiques en DB tout en pointant
 * vers MinIO en backend. Quand `STORAGE_PROVIDER=s3` est désactivé, on
 * laisse Supabase répondre directement (URL absolue lhuqdmlkhezdwzwlpfqo).
 *
 * Stream les objets directement depuis MinIO via le SDK officiel — pas de
 * buffer intermédiaire, supporte les gros fichiers (vidéos).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE NE FAIT PAS : DEMANDER UNE SESSION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Elle est appelée sans cookie par sept chemins recensés — rendus Remotion
 * (Chromium sans session), `/api/proxy-media`, publication YouTube, Zernio,
 * vérification de présence des rushes Autopilote, mesure de durée du rush,
 * vidéo de démo de l'accueil — et, de façon irréductible sans URL présignée,
 * par les serveurs de Meta et de TikTok, qui viennent CHERCHER le fichier
 * eux-mêmes au moment de publier. Fermer par une session ici casserait la
 * publication sociale. Cette fermeture demande une séquence à part (URL
 * présignée sur `MINIO_PUBLIC_ENDPOINT`) et n'appartient pas à ce lot.
 *
 * Ce qui est fermé ici, en revanche, ne dépend d'aucun appelant :
 *
 *   1. Le compartiment vient d'une liste blanche. Il partait tel quel à
 *      `statObject` : n'importe quel compartiment de l'instance était
 *      lisible, y compris un futur compartiment de sauvegarde.
 *   2. Le `Content-Type` est DÉCIDÉ ici, d'après l'extension. Il était lu sur
 *      l'objet (`stat.metaData['content-type']`) — c'est-à-dire choisi par
 *      celui qui envoie. Un compte pouvait déposer `x.html` en `text/html` et
 *      le faire servir depuis la MÊME ORIGINE que la session NextAuth :
 *      un XSS stocké. `nosniff` et `Content-Disposition: inline` ferment les
 *      deux moitiés restantes de la porte.
 *   3. `Access-Control-Allow-Origin: *` disparaît au profit de la seule
 *      origine de l'application (voir `entetesCors`).
 *   4. Le cache devient privé : un intermédiaire partagé n'a rien à faire
 *      d'un média qui n'est pas public.
 *   5. La clé est normalisée avant tout appel au stockage.
 *   6. Le message du SDK ne remonte plus au client.
 *   7. Le namespace `media/<userId>/analyse/<analysisId>/…` — les vignettes
 *      d'analyse Autopilote, dont la cle est DEVINABLE — rend 404 avant tout
 *      appel MinIO, en `GET` comme en `HEAD`. Le seul acces legitime reste
 *      `/api/autopilot/analyses/[id]/vignettes/[n]`, qui exige une session et
 *      relit la cle en base. Voir `cleDansNamespaceAnalyse`.
 *
 * ⚠️ Le bloc `Range` / 206 / 416 et le `HEAD` sont intacts, et doivent le
 * rester : le Calendrier fait un `HEAD` puis lit `Accept-Ranges`, le
 * compositeur cherche dans le rush, et toute l'affaire de l'atome `moov` en
 * fin de MP4 en dépend. Aucun média n'est matérialisé en mémoire.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Client as MinioClient } from 'minio';
import { Readable } from 'stream';
import { bucketAutorise } from '@/lib/storage/buckets';
import {
  cleObjetValide, typeContenuDepuisCle, cleDansNamespaceAnalyse,
} from '@/lib/storage/acces-objet';

// Force the route to run on Node (Edge can't stream from the MinIO SDK) and
// never be statically cached — Range requests must hit the handler every
// time so the right byte slice is served.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'supabase';
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'studiio-minio';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_ACCESS_KEY =
  process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio';
const MINIO_SECRET_KEY =
  process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';

let _client: MinioClient | null = null;
function getClient(): MinioClient {
  if (!_client) {
    _client = new MinioClient({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
  }
  return _client;
}

/**
 * L'origine de l'application, telle qu'elle est CONFIGURÉE.
 *
 * Jamais le header `Host`, qui est fourni par l'appelant.
 */
function origineApplication(): string {
  const brut = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
  if (!brut) return '';
  try { return new URL(brut).origin; } catch { return ''; }
}

/**
 * Les en-têtes CORS — et pourquoi ce n'est plus `*`.
 *
 * L'ancien commentaire justifiait l'étoile par le `crossOrigin="anonymous"`
 * du compositeur. Ce n'est plus vrai pour la vidéo : depuis la migration
 * MinIO, `video-composer.ts` OMET volontairement `crossOrigin` sur les
 * chemins same-origin (« Rule: omit crossOrigin for same-origin paths »).
 *
 * Il reste un cas réel : `PUBLIC_STORAGE_URL` peut désigner un autre hôte que
 * l'application (`https://cdn.studiio.pro/public` dans les tests de
 * `upload-rendu-https`), et `loadImage`, lui, pose toujours
 * `crossOrigin='anonymous'`. Une page servie par l'application qui charge une
 * image depuis cet autre hôte a donc besoin d'un `Allow-Origin` — mais de
 * celui de l'application, pas de tous.
 *
 * D'où : on n'émet l'en-tête que si l'`Origin` de la requête est EXACTEMENT
 * l'origine configurée. Sans `Origin` (chargement no-cors, Remotion, fetch
 * serveur, Meta/TikTok), aucun en-tête n'est émis — et aucun n'est nécessaire,
 * la vérification CORS ne s'applique pas à ces requêtes. `Vary: Origin` est
 * obligatoire : sans lui, un cache servirait à une origine la réponse
 * calculée pour une autre.
 */
function entetesCors(req: NextRequest): Record<string, string> {
  const entetes: Record<string, string> = { Vary: 'Origin' };
  const origine = req.headers.get('origin');
  const attendue = origineApplication();
  if (!origine || !attendue || origine !== attendue) return entetes;
  entetes['Access-Control-Allow-Origin'] = attendue;
  entetes['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
  entetes['Access-Control-Allow-Headers'] = 'Range, Content-Type';
  entetes['Access-Control-Expose-Headers'] =
    'Content-Range, Content-Length, Accept-Ranges';
  return entetes;
}

/**
 * Les en-têtes qui empêchent un média d'être interprété.
 *
 * `Content-Type` décidé par nous, `nosniff` pour que le navigateur ne
 * cherche pas à faire mieux, `Content-Disposition: inline` pour qu'un type
 * inconnu ne devienne pas un document. `private, no-store` parce que ces
 * objets ne sont pas publics : un cache partagé n'a pas à les garder.
 */
function entetesMedia(storagePath: string): Record<string, string> {
  return {
    'Content-Type': typeContenuDepuisCle(storagePath),
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
  };
}

/**
 * Une seule et même réponse pour « compartiment inconnu », « chemin refusé »
 * et « objet absent ». Un 403 distinct confirmerait l'existence de ce qu'on
 * refuse, et laisserait énumérer les compartiments de l'instance.
 */
function introuvable(): NextResponse {
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

/**
 * La cible est-elle recevable, sans avoir rien demandé au stockage ?
 *
 * Trois refus, une seule réponse (`introuvable`) : compartiment hors liste,
 * chemin malformé, et — depuis M3-B3.2a — namespace privé des analyses.
 *
 * L'ordre compte. La normalisation de chemin (`cleObjetValide` : `..`, antislash,
 * `://`, caractères de contrôle, sur la valeur brute ET décodée) passe AVANT
 * le refus du namespace, de sorte qu'aucune forme tordue ne puisse à la fois
 * échapper au motif `analyse/` et désigner malgré tout l'objet. Et la garde
 * de namespace relit elle-même les formes décodées, donc elle ne dépend pas
 * de l'ordre pour être juste — elle en dépend seulement pour rester lisible.
 *
 * ⚠️ `media/<userId>/analyse/<analysisId>/vignette-NN.jpg` est une clé
 * DEVINABLE (voir `lib/storage/acces-objet.ts`). Le seul accès légitime aux
 * vignettes est `/api/autopilot/analyses/[id]/vignettes/[n]`, authentifié.
 * Ici, c'est 404 — pas 401, pas 403 : un code distinct signalerait que le
 * namespace existe.
 */
function cibleRecevable(bucket: string, storagePath: string): boolean {
  if (!bucketAutorise(bucket)) return false;
  if (!cleObjetValide(storagePath)) return false;
  if (cleDansNamespaceAnalyse(bucket, storagePath)) return false;
  return true;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ bucket: string; path: string[] }> },
) {
  if (STORAGE_PROVIDER !== 's3') {
    return NextResponse.json(
      { error: 'storage proxy disabled (STORAGE_PROVIDER != s3)' },
      { status: 404 },
    );
  }

  const { bucket, path } = await ctx.params;
  const storagePath = Array.isArray(path) ? path.join('/') : '';

  // AVANT tout appel MinIO : un compartiment hors liste ou un chemin douteux
  // ne doit pas coûter une requête au stockage, et surtout ne doit pas
  // permettre d'en SONDER l'existence.
  if (!cibleRecevable(bucket, storagePath)) return introuvable();

  const cors = entetesCors(req);

  try {
    const client = getClient();
    const stat = await client.statObject(bucket, storagePath);
    const size = stat.size;

    // Parse Range header (RFC 7233). Without true range support, Chrome can't
    // seek video and any interruption forces a full re-download — fatal for
    // big files.
    const rangeHeader = req.headers.get('range');
    let start = 0;
    let end = size - 1;
    let isPartial = false;

    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (m) {
        const s = m[1] ? parseInt(m[1], 10) : NaN;
        const e = m[2] ? parseInt(m[2], 10) : NaN;
        if (!isNaN(s) && !isNaN(e)) {
          start = s; end = Math.min(e, size - 1);
        } else if (!isNaN(s)) {
          start = s; end = size - 1;
        } else if (!isNaN(e)) {
          start = Math.max(0, size - e); end = size - 1;
        }
        if (start > end || start >= size) {
          return new NextResponse(null, {
            status: 416,
            headers: { ...cors, 'Content-Range': `bytes */${size}` },
          });
        }
        isPartial = true;
      }
    }

    const length = end - start + 1;
    const stream: Readable = isPartial
      ? await client.getPartialObject(bucket, storagePath, start, length)
      : await client.getObject(bucket, storagePath);

    // Convert Node Readable → Web ReadableStream. Use the native Readable.toWeb
    // when available (Node 18+) — it forwards backpressure properly and avoids
    // the JS event-loop overhead of our manual wrapper, ~2× throughput on
    // large videos.
    const webStream: ReadableStream<Uint8Array> =
      typeof (Readable as any).toWeb === 'function'
        ? (Readable as any).toWeb(stream)
        : new ReadableStream({
            start(controller) {
              stream.on('data', (chunk) => {
                try { controller.enqueue(new Uint8Array(chunk)); }
                catch { try { stream.destroy(); } catch {} }
              });
              stream.on('end', () => { try { controller.close(); } catch {} });
              stream.on('error', (err) => { try { controller.error(err); } catch {} });
            },
            cancel() { try { stream.destroy(); } catch {} },
          });

    const headers: Record<string, string> = {
      ...entetesMedia(storagePath),
      'Content-Length': String(length),
      ...cors,
    };
    if (isPartial) {
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }

    return new NextResponse(webStream, {
      status: isPartial ? 206 : 200,
      headers,
    });
  } catch (err: any) {
    if (err?.code === 'NoSuchKey' || err?.code === 'NotFound') {
      return introuvable();
    }
    // Le message du SDK décrivait l'instance de stockage (compartiment,
    // endpoint, cause). Il reste dans les journaux du serveur ; il ne
    // redescend plus au client.
    console.error('[storage proxy] error', err);
    return NextResponse.json({ error: 'storage error' }, { status: 500 });
  }
}

// HEAD: some clients probe with HEAD before issuing the Range GET. Mirror GET
// headers without a body so file size and Accept-Ranges are visible.
export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ bucket: string; path: string[] }> },
) {
  if (STORAGE_PROVIDER !== 's3') {
    return new NextResponse(null, { status: 404 });
  }
  const { bucket, path } = await ctx.params;
  const storagePath = Array.isArray(path) ? path.join('/') : '';
  if (!cibleRecevable(bucket, storagePath)) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const stat = await getClient().statObject(bucket, storagePath);
    return new NextResponse(null, {
      status: 200,
      headers: {
        ...entetesMedia(storagePath),
        'Content-Length': String(stat.size),
        ...entetesCors(req),
      },
    });
  } catch (err: any) {
    if (err?.code === 'NoSuchKey' || err?.code === 'NotFound') {
      return new NextResponse(null, { status: 404 });
    }
    console.error('[storage proxy] head error', err);
    return new NextResponse(null, { status: 500 });
  }
}

// OPTIONS: browsers send preflight for CORS requests (e.g. crossOrigin=anonymous)
//
// Le prévol n'ouvre AUCUN accès au contenu et n'en révèle aucun : il ne lit ni
// le compartiment ni la clé, ne touche jamais MinIO, et répond 204 sans corps.
// Sa réponse est donc identique pour `media/u1/analyse/…` et pour n'importe
// quelle autre cible — rien n'y distingue le namespace refusé.
export async function OPTIONS(req: NextRequest) {
  const cors = entetesCors(req);
  return new NextResponse(null, {
    status: 204,
    headers: cors['Access-Control-Allow-Origin']
      ? { ...cors, 'Access-Control-Max-Age': '86400' }
      : cors,
  });
}
