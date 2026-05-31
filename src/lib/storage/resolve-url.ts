/**
 * Convert a possibly-relative media URL into an absolute URL fetchable from
 * server-side code (Node's undici fetch refuses relative URLs).
 *
 * Post Hetzner/MinIO migration, new uploads store paths like
 *   /storage/v1/object/public/media/...
 * which work from the browser but throw "Failed to parse URL from /…"
 * when handed to server-side `fetch`. Anything pre-migration was already
 * absolute (Supabase) and passes through unchanged.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_APP_URL  (explicit, deploy-stable)
 *   2. NEXTAUTH_URL         (same shape, often configured)
 *   3. caller-provided origin (e.g. `req.nextUrl.origin`)
 *   4. http://localhost:3000 (last-resort dev fallback)
 */
export function toAbsoluteMediaUrl(url: string, fallbackOrigin?: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith('/')) return url;

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    fallbackOrigin ||
    'http://localhost:3000';

  return `${origin.replace(/\/$/, '')}${url}`;
}
