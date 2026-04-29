import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';
import { collectStorageUrlsFromPost, extractStoragePath } from '@/lib/storage/cleanup';

// Allow up to 300s — listing all storage objects + DB metadata can be slow
// on a busy project.
export const maxDuration = 300;

/**
 * POST /api/admin/cleanup-orphans
 * Body (optional): { dryRun?: boolean }   // defaults to true — explicit
 *                                          // opt-in required for actual delete
 *
 * Lists every file in our Supabase Storage buckets, builds the set of files
 * referenced by a row in the DB, and deletes the difference. Files that are
 * referenced but missing in storage are ignored — that's a separate problem.
 *
 * Buckets scanned: media (default for video/audio/images uploaded by the
 * composer + signed URL endpoint), thumbnails (pre-rendered montage thumbs),
 * voiceover (TTS-generated audio), characters (uploaded portraits).
 *
 * DB tables scanned for references:
 *  - scheduled_posts.metadata     → all the URLs collected by
 *                                    collectStorageUrlsFromPost
 *  - users.profile_image_url       → user avatars (kept even when no posts)
 *  - logos referenced in branding settings
 *
 * Always pass `?dryRun=false` (or { dryRun: false } in the body) to actually
 * delete. The default dry-run prints what would be removed without touching
 * anything — paste the output before running for real.
 */
const SCANNED_BUCKETS = ['media', 'thumbnails', 'voiceover', 'characters', 'images', 'audio', 'videos'];

export async function POST(req: NextRequest) {
  const { error: adminError } = await requireAdmin();
  if (adminError) return adminError as NextResponse;

  // Parse optional body { dryRun: boolean }. Default true to avoid an
  // accidental mass-delete on first invocation.
  let dryRun = true;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.dryRun === 'boolean') dryRun = body.dryRun;
  } catch { /* no body, keep default */ }

  // ── 1. Build the set of referenced file paths from the DB ─────────────
  // Group by bucket so we can dedupe per-bucket and avoid scanning all
  // buckets to find a single file.
  const referenced: Record<string, Set<string>> = {};
  const recordReference = (url: string | null | undefined) => {
    const parsed = extractStoragePath(url);
    if (!parsed) return;
    referenced[parsed.bucket] ??= new Set<string>();
    referenced[parsed.bucket].add(parsed.path);
  };

  // scheduled_posts metadata — paginate to avoid loading 10k rows in one go
  let postsCursor = 0;
  const PAGE = 500;
  for (;;) {
    const { data: posts, error } = await supabaseAdmin
      .from('scheduled_posts')
      .select('metadata')
      .range(postsCursor, postsCursor + PAGE - 1);
    if (error) {
      return NextResponse.json({ success: false, error: `scheduled_posts read failed: ${error.message}` }, { status: 500 });
    }
    if (!posts || posts.length === 0) break;
    for (const p of posts) {
      const urls = collectStorageUrlsFromPost(p.metadata as Record<string, unknown> | null);
      for (const u of urls) recordReference(u);
    }
    if (posts.length < PAGE) break;
    postsCursor += PAGE;
  }

  // users.profile_image_url — keep avatars even if user has no posts
  try {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('profile_image_url, branding')
      .not('profile_image_url', 'is', null);
    if (users) {
      for (const u of users) {
        recordReference((u as { profile_image_url?: string | null }).profile_image_url);
        // Branding logo is shared across many posts — protect it
        const branding = (u as { branding?: { logoUrl?: string } }).branding;
        if (branding?.logoUrl) recordReference(branding.logoUrl);
      }
    }
  } catch (err) {
    console.warn('[CLEANUP-ORPHANS] users read failed (non-fatal):', err);
  }

  // ── 2. List every file in each bucket ──────────────────────────────────
  // supabase.storage.from(bucket).list(path, { limit, offset }) returns at
  // most 100 files per call. Recurse into directories.
  type FileEntry = { bucket: string; path: string; size: number };
  const allFiles: FileEntry[] = [];

  async function listRecursive(bucket: string, prefix: string) {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) {
        // Non-existent bucket → skip silently. Other errors → log + continue.
        if (!String(error.message || '').toLowerCase().includes('not found')) {
          console.warn(`[CLEANUP-ORPHANS] bucket=${bucket} prefix=${prefix} list error:`, error.message);
        }
        return;
      }
      if (!data || data.length === 0) break;
      for (const entry of data) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Folders have no `id` (or metadata.size === undefined). Recurse.
        if (entry.id === null || entry.metadata == null) {
          await listRecursive(bucket, fullPath);
        } else {
          const size = (entry.metadata as { size?: number }).size ?? 0;
          allFiles.push({ bucket, path: fullPath, size });
        }
      }
      if (data.length < 100) break;
      offset += data.length;
    }
  }

  for (const bucket of SCANNED_BUCKETS) {
    await listRecursive(bucket, '');
  }

  // ── 3. Compute orphans = files in storage NOT referenced in DB ─────────
  const orphans: FileEntry[] = [];
  let referencedCount = 0;
  for (const f of allFiles) {
    if (referenced[f.bucket]?.has(f.path)) {
      referencedCount++;
    } else {
      orphans.push(f);
    }
  }

  const orphanSize = orphans.reduce((sum, f) => sum + f.size, 0);

  console.log(`[CLEANUP-ORPHANS] scanned=${allFiles.length} referenced=${referencedCount} orphans=${orphans.length} (${(orphanSize / 1024 / 1024).toFixed(1)} MB) dryRun=${dryRun}`);

  // ── 4. Delete (unless dryRun) ──────────────────────────────────────────
  let removed = 0;
  const failed: Array<{ bucket: string; path: string; error: string }> = [];
  if (!dryRun && orphans.length > 0) {
    // Group by bucket for batched .remove()
    const byBucket: Record<string, string[]> = {};
    for (const o of orphans) {
      byBucket[o.bucket] ??= [];
      byBucket[o.bucket].push(o.path);
    }
    for (const [bucket, paths] of Object.entries(byBucket)) {
      // Supabase remove() handles up to ~1000 paths in one call — chunk to
      // be safe on really big sweeps.
      const CHUNK = 200;
      for (let i = 0; i < paths.length; i += CHUNK) {
        const chunk = paths.slice(i, i + CHUNK);
        const { data, error } = await supabaseAdmin.storage.from(bucket).remove(chunk);
        if (error) {
          console.warn(`[CLEANUP-ORPHANS] bucket=${bucket} chunk-remove failed:`, error.message);
          for (const p of chunk) failed.push({ bucket, path: p, error: error.message });
        } else {
          removed += data?.length || 0;
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    dryRun,
    scanned: allFiles.length,
    referenced: referencedCount,
    orphans: orphans.length,
    orphanSizeBytes: orphanSize,
    orphanSizeMB: parseFloat((orphanSize / 1024 / 1024).toFixed(2)),
    removed,
    failed,
    // First 50 orphan paths for a quick eyeball, in case dryRun
    sampleOrphans: orphans.slice(0, 50).map((o) => `${o.bucket}/${o.path} (${(o.size / 1024).toFixed(1)} KB)`),
  });
}
