/**
 * Wrapper MinIO/S3 compatible avec l'API Supabase Storage.
 *
 * Ce module exporte un objet qui mime la shape de `supabaseAdmin.storage` mais
 * stocke les fichiers sur MinIO (déployé sur le serveur Hetzner via Coolify).
 *
 * Activation : variable d'env `STORAGE_PROVIDER=s3`. Sinon retombe sur Supabase.
 *
 * API supportée :
 *   .from(bucket).upload(path, body, { contentType?, upsert? })
 *   .from(bucket).remove(paths[])
 *   .from(bucket).list(prefix?, { limit?, offset? })
 *   .from(bucket).getPublicUrl(path)
 *   .from(bucket).createSignedUrl(path, expiresIn)
 *
 * URL publique : `${PUBLIC_STORAGE_URL}/{bucket}/{path}` — pour que le code app
 * continue d'utiliser des URLs absolues comme avant. Configurable via env.
 */

import { Client as MinioClient } from 'minio';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'studiio-minio';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_ACCESS_KEY =
  process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio';
const MINIO_SECRET_KEY =
  process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';

// URL publique utilisée pour les `getPublicUrl()`. Doit pointer vers une route
// (proxy Next.js ou domaine MinIO public) qui sert les fichiers.
// Par défaut: route Next.js `/storage/v1/object/public/{bucket}/{path}` qui
// proxy MinIO en interne (cf. `src/app/storage/v1/object/public/[bucket]/[...path]/route.ts`).
const PUBLIC_STORAGE_URL =
  process.env.PUBLIC_STORAGE_URL ||
  (process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/storage/v1/object/public`
    : '/storage/v1/object/public');

let _client: MinioClient | null = null;

function getClient(): MinioClient {
  if (!_client) {
    if (!MINIO_SECRET_KEY) {
      throw new Error('MINIO_SECRET_KEY missing (env)');
    }
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

// ─────────────────────────────────────────────────────────────────────────
// Storage-from API (mimics supabaseAdmin.storage.from(bucket))
// ─────────────────────────────────────────────────────────────────────────

type UploadBody = Buffer | Uint8Array | Blob | File | ArrayBuffer | string;

async function toBuffer(body: UploadBody): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  // Blob / File (web)
  if (typeof (body as any).arrayBuffer === 'function') {
    const ab = await (body as Blob).arrayBuffer();
    return Buffer.from(ab);
  }
  throw new Error('unsupported upload body type');
}

function from(bucket: string) {
  return {
    async upload(
      storagePath: string,
      body: UploadBody,
      opts?: { contentType?: string; upsert?: boolean },
    ): Promise<{ data: { path: string } | null; error: { message: string } | null }> {
      try {
        const client = getClient();
        const buf = await toBuffer(body);
        const meta: Record<string, string> = {};
        if (opts?.contentType) meta['Content-Type'] = opts.contentType;
        await client.putObject(bucket, storagePath, buf, buf.length, meta);
        return { data: { path: storagePath }, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err?.message || String(err) } };
      }
    },

    async remove(
      paths: string[],
    ): Promise<{ data: any; error: { message: string } | null }> {
      try {
        const client = getClient();
        await Promise.all(paths.map((p) => client.removeObject(bucket, p)));
        return { data: paths, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err?.message || String(err) } };
      }
    },

    async list(
      prefix?: string,
      opts?: { limit?: number; offset?: number },
    ): Promise<{ data: any[]; error: { message: string } | null }> {
      try {
        const client = getClient();
        const limit = opts?.limit ?? 100;
        const offset = opts?.offset ?? 0;
        // Supabase Storage list() utilise le pattern : prefix = "folder"
        // (sans trailing slash) retourne les entries directes (sous-dossiers
        // + fichiers). MinIO listObjectsV2 fait pareil mais exige un
        // trailing "/" pour bien grouper par delimiter.
        const minioPrefix = prefix ? (prefix.endsWith('/') ? prefix : `${prefix}/`) : '';
        const items: any[] = [];
        const stream = client.listObjectsV2(bucket, minioPrefix, false);
        return await new Promise((resolve) => {
          stream.on('data', (o) => {
            // o.prefix = sub-dossier virtuel (delimiter "/")
            // o.name  = fichier réel
            // On mime l'API Supabase : { name, id, metadata:{size}, created_at }
            // avec id=null pour les dossiers (utilisé par le code app pour
            // discriminer via `if (!folder.id)`)
            if (o.prefix) {
              // Sub-folder. Retire le prefix parent et le "/" final.
              const folderName = o.prefix.replace(minioPrefix, '').replace(/\/$/, '');
              if (folderName) {
                items.push({
                  name: folderName,
                  id: null,
                  metadata: null,
                  created_at: null,
                  updated_at: null,
                });
              }
            } else if (o.name) {
              const fileName = o.name.replace(minioPrefix, '');
              items.push({
                name: fileName,
                id: o.name, // full key, non-null = c'est un fichier
                metadata: { size: o.size || 0, mimetype: undefined },
                created_at: o.lastModified ? o.lastModified.toISOString() : null,
                updated_at: o.lastModified ? o.lastModified.toISOString() : null,
              });
            }
          });
          stream.on('error', (err) => resolve({ data: [], error: { message: err.message } }));
          stream.on('end', () => {
            const sliced = items.slice(offset, offset + limit);
            resolve({ data: sliced, error: null });
          });
        });
      } catch (err: any) {
        return { data: [], error: { message: err?.message || String(err) } };
      }
    },

    getPublicUrl(storagePath: string): { data: { publicUrl: string } } {
      const url = `${PUBLIC_STORAGE_URL}/${bucket}/${storagePath}`;
      return { data: { publicUrl: url } };
    },

    async createSignedUrl(
      storagePath: string,
      expiresInSeconds: number,
    ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> {
      try {
        const client = getClient();
        // MinIO presigned URL — pointe directement vers le hostname interne.
        // Pour qu'elle marche depuis l'extérieur, il faut une route public ou
        // un alias MinIO. En attendant on retourne l'URL publique qui passe
        // par notre proxy Next.js (déjà signée via session cookie côté handler).
        const signedUrl = await client.presignedGetObject(
          bucket,
          storagePath,
          expiresInSeconds,
        );
        return { data: { signedUrl }, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err?.message || String(err) } };
      }
    },

    async createSignedUploadUrl(
      storagePath: string,
    ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> {
      try {
        const client = getClient();
        const signedUrl = await client.presignedPutObject(bucket, storagePath, 3600);
        return { data: { signedUrl }, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err?.message || String(err) } };
      }
    },
  };
}

export const s3Storage = { from };
export type S3Storage = typeof s3Storage;
