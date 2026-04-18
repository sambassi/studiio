import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      return NextResponse.json({ success: false, configured: false }, { status: 200 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query') || 'fitness';
    const count = Math.min(parseInt(searchParams.get('count') || '6'), 12);

    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=portrait`,
      { headers: { Authorization: `Client-ID ${accessKey}` } },
    );

    if (!res.ok) {
      return NextResponse.json({ success: false, error: 'Unsplash API error' }, { status: 502 });
    }

    const data = await res.json();
    const photos = (data.results || []).map((p: any) => ({
      id: p.id,
      url: p.urls?.regular || p.urls?.full,
      medium: p.urls?.small,
      small: p.urls?.thumb,
      photographer: p.user?.name || 'Unsplash',
      alt: p.alt_description || p.description || '',
      source: 'unsplash',
    }));

    return NextResponse.json({ success: true, configured: true, photos });
  } catch (error) {
    console.error('Unsplash API error:', error);
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}
