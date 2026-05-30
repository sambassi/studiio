import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Facebook from 'next-auth/providers/facebook';
import { supabaseAdmin } from '@/lib/db/supabase';
import { sendWelcomeEmailDirect } from '@/lib/email/notifications';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the Supabase user UUID for a given email. Looks up first, INSERTs
 * if missing (with a retry-lookup if the INSERT loses to a race). Returns
 * `null` if every attempt fails so the caller can decide what to do.
 *
 * Why this exists: the previous JWT/session callbacks relied on `.single()`
 * which throws when 0 rows match — but if the underlying Supabase client
 * returns `{ data: null, error }` *without* throwing (which can happen with
 * some error codes), the catch never fires, `token.id` stays `undefined`,
 * and every protected API route then returns 401 "Unauthorized" with no
 * way for the user to recover (logout/login doesn't fix it).
 */
type ResolvedUser = { id: string; isNew: boolean };

async function resolveSupabaseUserId(
  email: string,
  fallbackName?: string | null,
  fallbackAvatar?: string | null,
): Promise<ResolvedUser | null> {
  try {
    const { data: existing, error: lookupErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (lookupErr) {
      console.error('[auth] users lookup error:', lookupErr);
    }
    if (existing?.id) return { id: existing.id, isNew: false };

    // Not found → create
    const { data: created, error: insertErr } = await supabaseAdmin
      .from('users')
      .insert({
        email,
        name: fallbackName || '',
        avatar_url: fallbackAvatar || '',
        credits: 10,
        plan: 'free',
      })
      .select('id')
      .maybeSingle();
    if (created?.id) return { id: created.id, isNew: true };
    if (insertErr) {
      console.error('[auth] users insert error:', insertErr);
    }

    // Insert failed → maybe a parallel request created it. One more lookup.
    const { data: retry } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (retry?.id) return { id: retry.id, isNew: false };
  } catch (err) {
    console.error('[auth] resolveSupabaseUserId threw:', err);
  }
  return null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_SECRET!,
    }),
    Facebook({
      clientId: process.env.FACEBOOK_CLIENT_ID || process.env.FACEBOOK_ID!,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET || process.env.FACEBOOK_SECRET!,
    }),
  ],
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, account }) {
      // First-login branch: sync user to Supabase and store its UUID on
      // the token. After this, subsequent requests reuse the same token
      // (which already has `id`) without hitting Supabase again.
      if (user && account) {
        token.accessToken = account.access_token;

        const resolved = await resolveSupabaseUserId(
          user.email!,
          user.name,
          user.image,
        );
        if (resolved) {
          token.id = resolved.id;
          if (resolved.isNew) {
            // Brand-new account → fire-and-forget welcome email
            sendWelcomeEmailDirect(user.email!, user.name || 'Utilisateur', 10);
          } else {
            // Existing account → refresh name/avatar best-effort
            supabaseAdmin
              .from('users')
              .update({
                name: user.name || '',
                avatar_url: user.image || '',
                updated_at: new Date().toISOString(),
              })
              .eq('id', resolved.id)
              .then(({ error }) => {
                if (error) console.error('[auth] users update error:', error);
              });
          }
        } else {
          // Last-resort fallback so the session is not completely broken.
          console.error(
            '[auth] CRITICAL: could not resolve supabase user.id, falling back to NextAuth user.id',
            { email: user.email },
          );
          token.id = user.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;

      // Primary path: token already has a valid Supabase UUID.
      let resolvedId: string | undefined =
        typeof token.id === 'string' && UUID_RE.test(token.id)
          ? token.id
          : undefined;

      // Recovery path: legacy JWTs (issued before the jwt-callback fix)
      // may have an invalid or missing `token.id`. Re-lookup by email so
      // existing sessions self-heal without forcing a logout/login.
      if (!resolvedId && session.user.email) {
        const supa = await resolveSupabaseUserId(
          session.user.email,
          session.user.name,
          session.user.image,
        );
        if (supa) resolvedId = supa.id;
      }

      if (resolvedId) {
        session.user.id = resolvedId;
        try {
          const { data: u } = await supabaseAdmin
            .from('users')
            .select('plan')
            .eq('id', resolvedId)
            .maybeSingle();
          (session.user as any).plan = u?.plan || 'free';
        } catch {
          (session.user as any).plan = 'free';
        }
      } else {
        (session.user as any).plan = 'free';
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/login',
  },
});
