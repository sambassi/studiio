/**
 * Proxy PUT pour upload vers MinIO.
 * Utilisé en remplacement des signed URLs Supabase quand
 * STORAGE_PROVIDER=s3 (le hostname MinIO interne n'est pas
 * accessible depuis le browser).
 *
 * Flow :
 *   1. Frontend appelle POST /api/upload/signed-url → reçoit
 *      `signedUrl: /api/storage/upload?bucket=X&path=Y`
 *   2. Frontend fait PUT vers ce signedUrl avec le file en body
 *   3. Cette route vérifie l'auth, le path scoping, puis stream
 *      vers MinIO via le SDK officiel.
 *
 * Sécurité : on vérifie que le `path` commence par session.user.id
 * pour qu'un user ne puisse pas écraser les fichiers d'un autre.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { Client as MinioClient } from 'minio';
import { Readable } from 'stream';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

const ALLOWED_BUCKETS = new Set(['media', 'audio', 'videos', 'images']);

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const bucket = searchParams.get('bucket');
    const storagePath = searchParams.get('path');

    if (!bucket || !ALLOWED_BUCKETS.has(bucket)) {
      return NextResponse.json({ success: false, error: 'Invalid bucket' }, { status: 400 });
    }
    if (!storagePath) {
      return NextResponse.json({ success: false, error: 'Missing path' }, { status: 400 });
    }

    // Sécurité : le path doit commencer par session.user.id pour qu'un
    // utilisateur ne puisse pas écraser les fichiers d'un autre.
    if (!storagePath.startsWith(`${session.user.id}/`)) {
      console.warn('[storage/upload] path scope mismatch', { sessionUserId: session.user.id, requestedPath: storagePath });
      return NextResponse.json({ success: false, error: 'Path scope mismatch' }, { status: 403 });
    }

    const contentType = req.headers.get('content-type') || 'application/octet-stream';
    const contentLengthHeader = req.headers.get('content-length');
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

    if (!req.body) {
      return NextResponse.json({ success: false, error: 'Missing body' }, { status: 400 });
    }

    // Convert Web ReadableStream → Node Readable
    const nodeStream = Readable.fromWeb(req.body as any);

    const client = getClient();
    await client.putObject(
      bucket,
      storagePath,
      nodeStream,
      contentLength || undefined,
      { 'Content-Type': contentType },
    );

    return NextResponse.json({
      success: true,
      bucket,
      path: storagePath,
    });
  } catch (err: any) {
    console.error('[storage/upload] error', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Upload failed' },
      { status: 500 },
    );
  }
}
