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
 */

import { NextRequest, NextResponse } from 'next/server';
import { Client as MinioClient } from 'minio';
import { Readable } from 'stream';

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

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  json: 'application/json',
};

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
  const storagePath = path.join('/');

  try {
    const client = getClient();
    const stat = await client.statObject(bucket, storagePath);
    const size = stat.size;

    const ext = storagePath.split('.').pop()?.toLowerCase() || '';
    const contentType =
      stat.metaData?.['content-type'] ||
      EXT_TO_CONTENT_TYPE[ext] ||
      'application/octet-stream';

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
            headers: { 'Content-Range': `bytes */${size}` },
          });
        }
        isPartial = true;
      }
    }

    const length = end - start + 1;
    const stream: Readable = isPartial
      ? await client.getPartialObject(bucket, storagePath, start, length)
      : await client.getObject(bucket, storagePath);

    // Convert Node Readable → Web ReadableStream. Hook cancel + cleanup so a
    // client disconnect (closed tab, seek) tears down the MinIO stream
    // instead of leaking the socket.
    const webStream = new ReadableStream({
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
      'Content-Type': contentType,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
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
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    console.error('[storage proxy] error', err);
    return NextResponse.json(
      { error: err?.message || 'storage error' },
      { status: 500 },
    );
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
  const storagePath = path.join('/');
  try {
    const stat = await getClient().statObject(bucket, storagePath);
    const ext = storagePath.split('.').pop()?.toLowerCase() || '';
    const contentType =
      stat.metaData?.['content-type'] ||
      EXT_TO_CONTENT_TYPE[ext] ||
      'application/octet-stream';
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: any) {
    if (err?.code === 'NoSuchKey' || err?.code === 'NotFound') {
      return new NextResponse(null, { status: 404 });
    }
    return new NextResponse(null, { status: 500 });
  }
}
