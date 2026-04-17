import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getFileType, getExpiresAt } from '@/lib/storage/retention';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function verifyCronSecret(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

async function getProtectedUrls(): Promise<Set<string>> {
  const urls = new Set<string>();

  const { data: posts } = await supabaseAdmin
    .from('scheduled_posts')
    .select('media_url, metadata')
    .in('status', ['scheduled', 'published', 'draft']);

  if (!posts) return urls;

  for (const post of posts) {
    if (post.media_url) urls.add(post.media_url);

    const meta = post.metadata as Record<string, any> | null;
    if (!meta) continue;

    const urlFields = [
      'videoUrl', 'rawVideoUrl', 'posterUrl',
      'musicUrl', 'voiceUrl', 'renderedVideoUrl',
    ];
    for (const field of urlFields) {
      if (meta[field]) urls.add(meta[field]);
    }
    if (Array.isArray(meta.rushUrls)) {
      for (const u of meta.rushUrls) {
        if (u) urls.add(u);
      }
    }
  }

  return urls;
}

function isProtected(publicUrl: string, protectedUrls: Set<string>): boolean {
  for (const pUrl of protectedUrls) {
    if (publicUrl === pUrl || pUrl.includes(publicUrl) || publicUrl.includes(pUrl)) {
      return true;
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const protectedUrls = await getProtectedUrls();
  const now = new Date();
  const buckets = ['media', 'audio'];
  const breakdown = { video: 0, audio: 0, image: 0 };
  let deleted = 0;
  let kept = 0;
  let preserved = 0;
  const errors: string[] = [];

  for (const bucket of buckets) {
    const { data: topLevel } = await supabaseAdmin.storage
      .from(bucket)
      .list('', { limit: 500 });

    if (!topLevel) continue;

    for (const userFolder of topLevel) {
      if (userFolder.id) continue;

      const { data: subFolders } = await supabaseAdmin.storage
        .from(bucket)
        .list(userFolder.name, { limit: 100 });

      if (!subFolders) continue;

      for (const sub of subFolders) {
        if (sub.id) {
          const path = `${userFolder.name}/${sub.name}`;
          await processFile(bucket, path, sub, now, protectedUrls, breakdown, errors);
          continue;
        }

        const { data: files } = await supabaseAdmin.storage
          .from(bucket)
          .list(`${userFolder.name}/${sub.name}`, { limit: 200 });

        if (!files) continue;

        for (const file of files) {
          if (!file.id) continue;
          const path = `${userFolder.name}/${sub.name}/${file.name}`;
          await processFile(bucket, path, file, now, protectedUrls, breakdown, errors);
        }
      }
    }
  }

  async function processFile(
    bucket: string,
    path: string,
    file: any,
    now: Date,
    protectedUrls: Set<string>,
    breakdown: Record<string, number>,
    errors: string[],
  ) {
    const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    if (isProtected(publicUrl, protectedUrls)) {
      preserved++;
      return;
    }

    const type = getFileType(file.name);
    const createdAt = new Date((file as any).created_at || now.toISOString());
    const expiresAt = getExpiresAt(createdAt, type);

    if (now < expiresAt) {
      kept++;
      return;
    }

    const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);
    if (error) {
      errors.push(`${path}: ${error.message}`);
      kept++;
    } else {
      deleted++;
      breakdown[type]++;
    }
  }

  console.log(
    `[CLEANUP-MEDIA] Deleted ${deleted} (video=${breakdown.video}, audio=${breakdown.audio}, image=${breakdown.image}), kept ${kept}, preserved ${preserved}`,
  );

  return NextResponse.json({
    success: true,
    deleted,
    kept,
    preserved,
    breakdown,
    errors: errors.length > 0 ? errors : undefined,
  });
}
