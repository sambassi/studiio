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
// Lazy-initialized to prevent crash when this module is bundled client-side
let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
    if (!_supabaseAdmin) {
          const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
          const key = supabaseServiceKey || supabaseAnonKey;
          if (!supabaseUrl || !key) {
                  throw new Error('supabaseAdmin requires SUPABASE_URL and SUPABASE_SERVICE_KEY (server-side only)');
          }
          _supabaseAdmin = createClient(supabaseUrl, key);
    }
    return _supabaseAdmin;
}

// Proxy so existing code using `supabaseAdmin.from(...)` etc. continues to work
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
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
