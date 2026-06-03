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

    // Schéma + credentials : bloque file:/gopher:/data: et `user:pass@host`.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return NextResponse.json({ error: 'URL scheme not allowed' }, { status: 403 });
    }
    if (parsed.username || parsed.password) {
      return NextResponse.json({ error: 'URL must not contain credentials' }, { status: 403 });
    }
    // Anti-traversal sur le chemin décodé.
    let decodedPath = parsed.pathname;
    try { decodedPath = decodeURIComponent(parsed.pathname); } catch {
      return NextResponse.json({ error: 'Invalid URL path' }, { status: 400 });
    }
    if (decodedPath.includes('..') || decodedPath.includes('\\')) {
      return NextResponse.json({ error: 'URL path not allowed' }, { status: 403 });
    }

    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    let isAllowed = false;
    if (appHost && host === appHost) {
      // Notre propre proxy storage MinIO — uniquement le chemin public.
      isAllowed = parsed.pathname.startsWith('/storage/v1/object/public/');
    } else if (supabaseHost && host === supabaseHost) {
      isAllowed = parsed.pathname.startsWith('/storage/');
    } else if (cdnHosts.has(host)) {
      isAllowed = true;
    }
    if (!isAllowed) {
      return NextResponse.json({ error: 'URL domain not allowed' }, { status: 403 });
    }

    const fetchUrl = parsed.toString();
    const response = await fetch(fetchUrl, {
      headers: {
        'Accept': '*/*',
      },
    });

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
