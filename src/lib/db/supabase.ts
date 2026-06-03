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

// Proxy so existing code using `supabaseAdmin.from(...)` etc. continues to work
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
          if (prop === 'storage' && STORAGE_PROVIDER === 's3') {
              // Lazy require (server-only) pour éviter de charger `minio` dans le
              // bundle client.
              //
              // IMPORTANT : utiliser un chemin RELATIF, surtout PAS l'alias `@/`.
              // Dans un `require()` exécuté au runtime, l'alias `@/` n'est pas
              // résolu correctement par le bundle serveur standalone de Next :
              // le module revenait sans `s3Storage`, donc `supabaseAdmin.storage`
              // était `undefined` → toutes les opérations storage plantaient avec
              // « Cannot read properties of undefined (reading 'from') »
              // (upload to-mp4, cleanup remove, etc.). Le chemin relatif est
              // résolu/bundlé de façon fiable par webpack.
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const mod = require('../storage/s3-client');
              return mod.s3Storage || mod.default || mod;
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
