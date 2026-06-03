import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Client-side Supabase (anon key, respects RLS)
// Only create if we have valid credentials (avoids crash when bundled client-side without env vars)
let _supabaseClient: SupabaseClient | null = null;
export const supabase = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
          if (!_supabaseClient) {
                  if (!supabaseUrl || !supabaseAnonKey) {
                            throw new Error('Supabase client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
                  }
                  _supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
          }
          return (_supabaseClient as any)[prop];
    }
});

// Server-side Supabase with service key (bypasses RLS, for API routes only)
// Lazy-initialized to prevent crash when this module is bundled client-side.
//
// Migration Hetzner : on peut séparer l'URL serveur de l'URL client.
// `SUPABASE_URL` (server only, prioritaire) peut pointer vers notre
// PostgREST self-hosted (http://studiio-postgrest:3000 dans le réseau
// Docker). Sinon fallback sur `NEXT_PUBLIC_SUPABASE_URL` (Supabase).
let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
    if (!_supabaseAdmin) {
          const adminUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
          const key = supabaseServiceKey || supabaseAnonKey;
          if (!adminUrl || !key) {
                  throw new Error('supabaseAdmin requires SUPABASE_URL and SUPABASE_SERVICE_KEY (server-side only)');
          }
          _supabaseAdmin = createClient(adminUrl, key, {
              global: {
                  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
                      fetch(input, { ...init, cache: 'no-store' }),
              },
          });
    }
    return _supabaseAdmin;
}

// Storage provider — when STORAGE_PROVIDER=s3 (migration vers MinIO/Hetzner),
// le proxy `.storage` est redirigé vers notre client S3 compatible Supabase.
// Toutes les autres méthodes (`.from()`, `.auth`, etc.) restent sur Supabase.
const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'supabase';

// Adaptateur storage MinIO compatible `supabaseAdmin.storage`, construit
// DIRECTEMENT à partir du package externe `minio`.
//
// Pourquoi pas `require('@/lib/storage/s3-client')` / `require('../storage/...')` ?
// Dans le bundle serveur standalone de Next, un module INTERNE tiré via un
// `require()` runtime (que webpack ne peut pas analyser statiquement) voit ses
// exports élagués (tree-shaking) → `require(...).s3Storage` revenait `undefined`,
// d'où `supabaseAdmin.storage` undefined puis « .storage.from is not a function ».
// `minio` est un package externe : son `require()` retourne toujours ses exports
// intacts (cf. `fetch-media.ts` qui l'utilise sans souci). On évite donc le
// module interne et on reconstruit ici l'API minimale utilisée par l'app.
let _s3Storage: any = null;
function getS3Storage(): any {
  if (_s3Storage) return _s3Storage;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client: MinioClient } = require('minio');
  const endPoint = process.env.MINIO_ENDPOINT || 'studiio-minio';
  const port = parseInt(process.env.MINIO_PORT || '9000', 10);
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  const accessKey = process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio';
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  const PUBLIC_STORAGE_URL =
    process.env.PUBLIC_STORAGE_URL ||
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/storage/v1/object/public`
      : '/storage/v1/object/public');

  let _client: any = null;
  const client = () => {
    if (!_client) {
      if (!secretKey) throw new Error('MINIO_SECRET_KEY/MINIO_ROOT_PASSWORD manquant (env)');
      _client = new MinioClient({ endPoint, port, useSSL, accessKey, secretKey });
    }
    return _client;
  };

  const toBuffer = async (body: any): Promise<Buffer> => {
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(body);
    if (typeof body === 'string') return Buffer.from(body);
    if (body && typeof body.arrayBuffer === 'function') return Buffer.from(await body.arrayBuffer());
    throw new Error('unsupported upload body type');
  };

  const from = (bucket: string) => ({
    async upload(path: string, body: any, opts?: { contentType?: string; upsert?: boolean }) {
      try {
        const buf = await toBuffer(body);
        const meta: Record<string, string> = {};
        if (opts?.contentType) meta['Content-Type'] = opts.contentType;
        await client().putObject(bucket, path, buf, buf.length, meta);
        return { data: { path }, error: null };
      } catch (err: any) { return { data: null, error: { message: err?.message || String(err) } }; }
    },
    async remove(paths: string[]) {
      try { await Promise.all(paths.map((p) => client().removeObject(bucket, p))); return { data: paths, error: null }; }
      catch (err: any) { return { data: null, error: { message: err?.message || String(err) } }; }
    },
    async list(prefix?: string, opts?: { limit?: number; offset?: number }) {
      try {
        const limit = opts?.limit ?? 100; const offset = opts?.offset ?? 0;
        const minioPrefix = prefix ? (prefix.endsWith('/') ? prefix : `${prefix}/`) : '';
        const items: any[] = [];
        const stream = client().listObjectsV2(bucket, minioPrefix, false);
        return await new Promise((resolve) => {
          stream.on('data', (o: any) => {
            if (o.prefix) { const f = o.prefix.replace(minioPrefix, '').replace(/\/$/, ''); if (f) items.push({ name: f, id: null, metadata: null, created_at: null, updated_at: null }); }
            else if (o.name) { const f = o.name.replace(minioPrefix, ''); items.push({ name: f, id: o.name, metadata: { size: o.size || 0, mimetype: undefined }, created_at: o.lastModified ? o.lastModified.toISOString() : null, updated_at: o.lastModified ? o.lastModified.toISOString() : null }); }
          });
          stream.on('error', (err: any) => resolve({ data: [], error: { message: err.message } }));
          stream.on('end', () => resolve({ data: items.slice(offset, offset + limit), error: null }));
        });
      } catch (err: any) { return { data: [], error: { message: err?.message || String(err) } }; }
    },
    getPublicUrl(path: string) { return { data: { publicUrl: `${PUBLIC_STORAGE_URL}/${bucket}/${path}` } }; },
    async createSignedUrl(path: string, expiresIn: number) {
      try { const signedUrl = await client().presignedGetObject(bucket, path, expiresIn); return { data: { signedUrl }, error: null }; }
      catch (err: any) { return { data: null, error: { message: err?.message || String(err) } }; }
    },
    async createSignedUploadUrl(path: string) {
      try { const signedUrl = await client().presignedPutObject(bucket, path, 3600); return { data: { signedUrl, token: '' }, error: null }; }
      catch (err: any) { return { data: null, error: { message: err?.message || String(err) } }; }
    },
  });

  _s3Storage = { from };
  return _s3Storage;
}

// Proxy so existing code using `supabaseAdmin.from(...)` etc. continues to work
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
          if (prop === 'storage' && STORAGE_PROVIDER === 's3') {
              return getS3Storage();
          }
          return (getSupabaseAdmin() as any)[prop];
    }
});

// Alias for backwards compatibility
export const supabaseServer = () => getSupabaseAdmin();

export const getUser = async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
};

export const getUserCredits = async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data?.credits || 0;
};

export const updateUserCredits = async (userId: string, amount: number) => {
    const { data, error } = await supabase
      .from('users')
      .update({ credits: amount })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
};
