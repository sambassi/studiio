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
    // Lookup with explicit list (NOT .single/.maybeSingle) because
    // historical data may contain DUPLICATES with the same email — the
    // previous code path created one duplicate per login attempt because
    // .maybeSingle() returned `null` when >1 rows matched, triggering the
    // INSERT branch indefinitely. Sort by credits DESC so we always pick
    // the user with the most credits (the original, real account).
    const { data: matches, error: lookupErr } = await supabaseAdmin
      .from('users')
      .select('id, credits, created_at')
      .eq('email', email)
      .order('credits', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(5);
    if (lookupErr) {
      console.error('[auth] users lookup error:', lookupErr);
    }
    if (matches && matches.length > 0) {
      if (matches.length > 1) {
        console.warn('[auth] duplicate users detected for email', {
          email,
          count: matches.length,
          ids: matches.map((m: any) => m.id),
          picked: matches[0].id,
          pickedCredits: matches[0].credits,
        });
      }
      return { id: matches[0].id, isNew: false };
    }

    // No existing row → create one
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
    const { data: retryRows } = await supabaseAdmin
      .from('users')
      .select('id, credits')
      .eq('email', email)
      .order('credits', { ascending: false, nullsFirst: false })
      .limit(1);
    if (retryRows && retryRows.length > 0) {
      return { id: retryRows[0].id, isNew: false };
    }
  } catch (err) {
    console.error('[auth] resolveSupabaseUserId threw:', err);
  }
  return null;
}

/**
 * ── Contournement d'authentification, DÉVELOPPEMENT LOCAL UNIQUEMENT ──
 *
 * Sert à ce qu'un agent puisse ouvrir `/dashboard/*` en local pour VOIR l'UI
 * et attraper les défauts visuels lui-même. Plusieurs correctifs de cette
 * base ont dû être repris parce que le rendu n'avait pas pu être ouvert.
 *
 * DEUX verrous, tous deux CÔTÉ SERVEUR, tous deux obligatoires :
 *   1. `NODE_ENV !== 'production'` — une image de production est bâtie avec
 *      `NODE_ENV=production`, le contournement y est mort quoi qu'il arrive ;
 *   2. `DEV_AUTH_BYPASS === '1'` — opt-in explicite, absent de `.env.example`
 *      et des variables Coolify.
 *
 * Rien ici ne lit un cookie, un en-tête, un paramètre d'URL ni quoi que ce
 * soit d'autre venant du client : aucune requête ne peut activer le
 * contournement. La valeur est figée au chargement du module.
 */
export function isDevAuthBypassEnabled(
  env: { NODE_ENV?: string; DEV_AUTH_BYPASS?: string } = process.env,
): boolean {
  return env.NODE_ENV !== 'production' && env.DEV_AUTH_BYPASS === '1';
}

/** Évalué UNE fois, au chargement — jamais recalculé par requête. */
export const DEV_AUTH_BYPASS = isDevAuthBypassEnabled();

/** Identité factice servie quand le contournement est actif. */
export const DEV_SESSION = {
  user: {
    id: '00000000-0000-4000-8000-000000000000',
    email: 'dev@localhost',
    name: 'Développement local',
    plan: 'pro',
  },
  expires: '2999-12-31T23:59:59.000Z',
} as const;

if (DEV_AUTH_BYPASS) {
  console.warn(
    '[auth] ⚠️  DEV_AUTH_BYPASS actif : toute session est acceptée. ' +
    'Développement local uniquement — impossible en production.',
  );
}

const nextAuth = NextAuth({
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

export const { handlers, signIn, signOut } = nextAuth;

/**
 * `auth()` de NextAuth, sauf en développement local avec `DEV_AUTH_BYPASS=1`,
 * où une session factice est renvoyée pour que les pages protégées
 * s'affichent. En production, `DEV_AUTH_BYPASS` vaut `false` : c'est le
 * `nextAuth.auth` d'origine qui est exporté, à l'identique.
 */
export const auth: typeof nextAuth.auth = DEV_AUTH_BYPASS
  ? ((...args: unknown[]) => {
      // Appel direct `await auth()` → session factice.
      if (args.length === 0) return Promise.resolve(DEV_SESSION as never);
      // Usage middleware `auth((req) => …)` → on injecte la session factice
      // dans la requête avant de passer la main au gestionnaire.
      const [handler] = args;
      if (typeof handler === 'function') {
        // `as never` : les surcharges de `auth()` ne modelisent pas cet
        // enveloppement ; le comportement, lui, est identique — on ajoute
        // seulement `req.auth` avant d'appeler le gestionnaire d'origine.
        const wrapped = (req: { auth?: unknown }) => {
          req.auth = DEV_SESSION;
          return (handler as (r: unknown) => unknown)(req);
        };
        return (nextAuth.auth as unknown as (h: unknown) => unknown)(wrapped);
      }
      return (nextAuth.auth as unknown as (...a: unknown[]) => unknown)(...args);
    }) as never
  : nextAuth.auth;
