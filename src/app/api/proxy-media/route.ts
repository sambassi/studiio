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

    // Security: only allow trusted media URLs (Supabase storage + Pexels CDN)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const allowedDomains = [
      '.supabase.co/storage/',
      'images.pexels.com',
      'www.pexels.com',
    ];
    const isAllowed = url.startsWith(supabaseUrl) || allowedDomains.some(d => url.includes(d));
    if (!isAllowed) {
      return NextResponse.json({ error: 'URL domain not allowed' }, { status: 403 });
    }

    const response = await fetch(url, {
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
