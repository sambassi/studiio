import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const typeFilter = searchParams.get('type') || 'all';

    const userId = session.user.id;
    const buckets = typeFilter === 'audio' ? ['audio'] : typeFilter === 'all' ? ['media', 'audio'] : ['media'];

    const files: Array<{
      name: string;
      url: string;
      bucket: string;
      type: 'image' | 'video' | 'audio';
      size: number;
      createdAt: string;
    }> = [];

    for (const bucket of buckets) {
      const { data: folders } = await supabaseAdmin.storage
        .from(bucket)
        .list(userId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

      if (!folders) continue;

      for (const folder of folders) {
        if (!folder.id) {
          const { data: innerFiles } = await supabaseAdmin.storage
            .from(bucket)
            .list(`${userId}/${folder.name}`, { limit: 50, sortBy: { column: 'created_at', order: 'desc' } });

          if (!innerFiles) continue;

          for (const f of innerFiles) {
            if (!f.id || !f.name) continue;
            const path = `${userId}/${folder.name}/${f.name}`;
            const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);

            const ext = f.name.split('.').pop()?.toLowerCase() || '';
            let fileType: 'image' | 'video' | 'audio' = 'image';
            if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) fileType = 'video';
            else if (['mp3', 'wav', 'aac', 'ogg', 'm4a'].includes(ext)) fileType = 'audio';

            if (typeFilter !== 'all' && typeFilter !== fileType) continue;

            files.push({
              name: f.name,
              url: urlData.publicUrl,
              bucket,
              type: fileType,
              size: (f.metadata as any)?.size || 0,
              createdAt: (f as any).created_at || new Date().toISOString(),
            });
          }
        } else {
          const path = `${userId}/${folder.name}`;
          const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);

          const ext = folder.name.split('.').pop()?.toLowerCase() || '';
          let fileType: 'image' | 'video' | 'audio' = 'image';
          if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) fileType = 'video';
          else if (['mp3', 'wav', 'aac', 'ogg', 'm4a'].includes(ext)) fileType = 'audio';

          if (typeFilter !== 'all' && typeFilter !== fileType) continue;

          files.push({
            name: folder.name,
            url: urlData.publicUrl,
            bucket,
            type: fileType,
            size: (folder.metadata as any)?.size || 0,
            createdAt: (folder as any).created_at || new Date().toISOString(),
          });
        }
      }
    }

    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ success: true, files: files.slice(0, 100) });
  } catch (error) {
    console.error('[MediaList] Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to list media' }, { status: 500 });
  }
}
