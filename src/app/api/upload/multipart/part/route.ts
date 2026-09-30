/**
 * Relais d'UN morceau d'envoi découpé, quand MinIO n'a pas d'endpoint public.
 *
 * Le navigateur y dépose 8 Mio au plus ; la route les écrit dans MinIO par
 * une URL présignée INTERNE et rend l'`ETag` du morceau, que
 * `completeMultipartUpload` réclame. Une requête courte par morceau : le
 * proxy n'a plus de connexion longue à couper, et une coupure ne coûte que
 * le morceau en cours (reprise dans `uploadFile.ts`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { Client as MinioClient } from 'minio';
import { ALLOWED_BUCKETS as BUCKETS } from '@/lib/storage/buckets';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ALLOWED_BUCKETS = new Set<string>(BUCKETS);
/** Un morceau fait 8 Mio (`PART_SIZE`) ; marge pour les en-têtes près. */
const MORCEAU_MAX = 16 * 1024 * 1024;

function clientInterne(): MinioClient | null {
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  if (!secretKey) return null;
  return new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT || 'studiio-minio',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio',
    secretKey,
    region: process.env.MINIO_REGION || 'us-east-1',
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  const bucket = q.get('bucket') || '';
  const key = q.get('key') || '';
  const uploadId = q.get('uploadId') || '';
  const partNumber = Number(q.get('partNumber'));
  if (!ALLOWED_BUCKETS.has(bucket) || !key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    return NextResponse.json({ success: false, error: 'Paramètres invalides' }, { status: 400 });
  }
  // Même garde que la route multipart : on ne poursuit que SON envoi.
  if (!key.startsWith(`${session.user.id}/`) || key.includes('..')) {
    return NextResponse.json({ success: false, error: 'Path scope mismatch' }, { status: 403 });
  }
  const client = clientInterne();
  if (!client) {
    return NextResponse.json({ success: false, error: 'Stockage non configuré' }, { status: 500 });
  }

  const corps = Buffer.from(await req.arrayBuffer());
  if (corps.length === 0 || corps.length > MORCEAU_MAX) {
    return NextResponse.json({ success: false, error: 'Morceau de taille invalide' }, { status: 413 });
  }

  try {
    const url = await client.presignedUrl('PUT', bucket, key, 600, { uploadId, partNumber: String(partNumber) });
    const rep = await fetch(url, { method: 'PUT', body: corps });
    const etag = rep.headers.get('etag');
    if (!rep.ok || !etag) {
      console.error('[upload/multipart/part] MinIO a refusé le morceau', { partNumber, status: rep.status });
      return NextResponse.json({ success: false, error: `MinIO ${rep.status}` }, { status: 502 });
    }
    return new NextResponse(null, { status: 200, headers: { ETag: etag } });
  } catch (err) {
    console.error('[upload/multipart/part] relais échoué :', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Relais du morceau échoué' }, { status: 502 });
  }
}
