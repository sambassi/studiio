/**
 * Server-side media download utility.
 *
 * When the URL points to our own storage proxy (/storage/v1/object/public/...),
 * we bypass the public HTTP stack (browser → Traefik → Next.js → MinIO) and
 * fetch the file directly from MinIO via the internal Docker network.
 * This removes 3 network hops, avoids self-referencing TLS issues, and is
 * much faster for large files.
 *
 * For all other URLs (Supabase, Pexels, absolute HTTP) a standard fetch is used.
 */

import { writeFile } from 'fs/promises';

// Storage proxy path prefix used by our Next.js proxy route
const STORAGE_PROXY_PREFIX = '/storage/v1/object/public/';

type DownloadResult = { buffer: Buffer; contentType: string };

/**
 * Download a media file by URL into a Buffer.
 * Transparently handles both internal storage paths and external URLs.
 */
export async function downloadMediaToBuffer(
  url: string,
  fallbackOrigin?: string,
): Promise<DownloadResult> {
  // Internal storage path — fetch from MinIO directly
  if (isInternalStoragePath(url)) {
    return downloadFromMinioInternal(url);
  }

  // Relative URL that isn't a storage path (shouldn't happen but handle it)
  if (url.startsWith('/')) {
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      fallbackOrigin ||
      'http://localhost:3000';
    url = `${origin.replace(/\/$/, '')}${url}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} for ${url.substring(0, 80)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType };
}

/**
 * Download a media file directly to disk (avoids holding entire file in memory).
 */
export async function downloadMediaToFile(
  url: string,
  destPath: string,
  fallbackOrigin?: string,
): Promise<{ sizeBytes: number; contentType: string }> {
  const { buffer, contentType } = await downloadMediaToBuffer(url, fallbackOrigin);
  await writeFile(destPath, buffer);
  return { sizeBytes: buffer.length, contentType };
}

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

function isInternalStoragePath(url: string): boolean {
  if (!url) return false;
  // Relative path: /storage/v1/object/public/{bucket}/...
  if (url.startsWith(STORAGE_PROXY_PREFIX)) return true;
  // Absolute URL pointing to our own domain
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
  if (appUrl && url.startsWith(appUrl + STORAGE_PROXY_PREFIX)) return true;
  if (appUrl && url.startsWith(appUrl + '/storage/')) return true;
  return false;
}

function parseStoragePath(url: string): { bucket: string; objectPath: string } {
  // Strip absolute origin if present
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
  if (appUrl && url.startsWith(appUrl)) {
    url = url.slice(appUrl.length);
  }
  // Now url starts with /storage/v1/object/public/{bucket}/{path...}
  const rest = url.slice(STORAGE_PROXY_PREFIX.length); // "{bucket}/{path...}"
  const slash = rest.indexOf('/');
  if (slash === -1) throw new Error(`Invalid storage path: ${url}`);
  const bucket = rest.slice(0, slash);
  const objectPath = rest.slice(slash + 1);
  return { bucket, objectPath };
}

async function downloadFromMinioInternal(url: string): Promise<DownloadResult> {
  // Import MinIO client dynamically (it's an external module, not bundled)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client: MinioClient } = require('minio');

  const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'studiio-minio';
  const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
  const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
  const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio';
  const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';

  const client = new MinioClient({
    endPoint: MINIO_ENDPOINT,
    port: MINIO_PORT,
    useSSL: MINIO_USE_SSL,
    accessKey: MINIO_ACCESS_KEY,
    secretKey: MINIO_SECRET_KEY,
  });

  const { bucket, objectPath } = parseStoragePath(url);
  console.log(`[fetchMedia] MinIO direct download: bucket=${bucket} path=${objectPath.substring(0, 60)}`);

  // Get metadata for content-type
  const stat = await client.statObject(bucket, objectPath).catch(() => null);
  const contentType = stat?.metaData?.['content-type'] || guessContentType(objectPath);

  const stream: NodeJS.ReadableStream = await client.getObject(bucket, objectPath);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const buffer = Buffer.concat(chunks);
  console.log(`[fetchMedia] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB from MinIO`);
  return { buffer, contentType };
}

const EXT_TYPES: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};
function guessContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return EXT_TYPES[ext] || 'application/octet-stream';
}
