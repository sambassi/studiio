import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';

/**
 * Proxy media files (audio/images) from Supabase storage
 * to avoid CORS issues during client-side video composition.
 * Only allows Supabase storage URLs for security.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = req.nextUrl.searchParams.get('url');
    if (!url) {
      return NextResponse.json({ error: 'URL parameter required' }, { status: 400 });
    }

    // SSRF hardening : on ne fait JAMAIS de match par sous-chaîne sur l'URL
    // brute (contournable : `https://evil.com/storage/v1/object/public/x`).
    // On PARSE l'URL et on compare le `hostname` exact à une allowlist.
    // Les chemins relatifs (`/storage/...` du compositeur) sont résolus
    // contre l'origine CONFIGURÉE (NEXT_PUBLIC_APP_URL), pas le header Host
    // (qui est spoofable), pour empêcher la redirection vers un hôte interne.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
    const hostOf = (u: string): string => {
      try { return new URL(u).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; }
    };
    const appHost = hostOf(appUrl);
    const supabaseHost = hostOf(supabaseUrl);
    const cdnHosts = new Set([
      'images.pexels.com', 'www.pexels.com', 'images.unsplash.com', 'plus.unsplash.com',
    ]);

    // Résolution : base = origine configurée (jamais le header Host).
    const base = appUrl || supabaseUrl || undefined;
    let parsed: URL;
    try { parsed = new URL(url, base); } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    // Validation réutilisable — appliquée à l'URL initiale ET à chaque hop
    // de redirection (schéma, credentials, traversal, host exact + chemin).
    const checkUrl = (u: URL): { ok: true } | { ok: false; status: number; error: string } => {
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return { ok: false, status: 403, error: 'URL scheme not allowed' };
      }
      if (u.username || u.password) {
        return { ok: false, status: 403, error: 'URL must not contain credentials' };
      }
      let dp = u.pathname;
      try { dp = decodeURIComponent(u.pathname); } catch {
        return { ok: false, status: 400, error: 'Invalid URL path' };
      }
      if (dp.includes('..') || dp.includes('\\')) {
        return { ok: false, status: 403, error: 'URL path not allowed' };
      }
      const h = u.hostname.toLowerCase().replace(/\.$/, '');
      let allowed = false;
      if (appHost && h === appHost) allowed = u.pathname.startsWith('/storage/v1/object/public/');
      else if (supabaseHost && h === supabaseHost) allowed = u.pathname.startsWith('/storage/');
      else if (cdnHosts.has(h)) allowed = true;
      return allowed ? { ok: true } : { ok: false, status: 403, error: 'URL domain not allowed' };
    };

    const initial = checkUrl(parsed);
    if (!initial.ok) {
      return NextResponse.json({ error: initial.error }, { status: initial.status });
    }

    // SSRF via redirect : `fetch` suit les redirections par défaut → un hôte
    // autorisé qui renvoie un 3xx vers un hôte interne serait suivi. On suit
    // MANUELLEMENT et on re-valide chaque hop contre la même allowlist.
    const MAX_HOPS = 3;
    let current = parsed;
    let response: Response;
    for (let hop = 0; ; hop++) {
      response = await fetch(current.toString(), {
        redirect: 'manual',
        headers: { 'Accept': '*/*' },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location) break;
      if (hop >= MAX_HOPS) {
        return NextResponse.json({ error: 'Too many redirects' }, { status: 502 });
      }
      let next: URL;
      try { next = new URL(location, current); } catch {
        return NextResponse.json({ error: 'Invalid redirect target' }, { status: 502 });
      }
      const check = checkUrl(next);
      if (!check.ok) {
        return NextResponse.json({ error: 'Redirect target not allowed' }, { status: 403 });
      }
      current = next;
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream fetch failed: ${response.status}` },
        { status: response.status }
      );
    }

    let contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = await response.arrayBuffer();

    // Ensure proper audio MIME type for audio files
    if (contentType === 'application/octet-stream' && (url.includes('.mp3') || url.includes('.m4a') || url.includes('.wav') || url.includes('.ogg'))) {
      if (url.includes('.mp3')) contentType = 'audio/mpeg';
      else if (url.includes('.m4a')) contentType = 'audio/mp4';
      else if (url.includes('.wav')) contentType = 'audio/wav';
      else if (url.includes('.ogg')) contentType = 'audio/ogg';
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Proxy media error:', error);
    return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
  }
}

export const maxDuration = 30;
