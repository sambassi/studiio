import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * Storage cleanup helpers — extract bucket/path from a public Supabase URL
 * and delete files in batches.
 *
 * Used by:
 *  - DELETE /api/posts (cascade delete media when a post is removed)
 *  - POST /api/admin/cleanup-orphans (one-shot orphan sweep)
 *
 * The Supabase public URL format is:
 *   https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
 * Signed URLs use `/sign/` instead of `/public/` and end with `?token=...`.
 */

export function extractStoragePath(url: string | null | undefined): { bucket: string; path: string } | null {
  if (!url || typeof url !== 'string') return null;
  // Match both /public/ and /sign/ variants. Stop at `?` to ignore query
  // strings (signed URL tokens).
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (!m) return null;
  return { bucket: m[1], path: m[2] };
}

/**
 * Clé de stockage d'une URL — `<bucket>/<chemin>`, ou `null`.
 *
 * ⚠️ COMPARER DES URL BRUTES NE MARCHE PAS DE FAÇON FIABLE. La même
 * ressource s'écrit de plusieurs façons selon qui l'a produite :
 * `https://studiio.pro/storage/v1/object/public/media/u/library/x.mp4`,
 * la même sans hôte, ou une variante signée `/sign/…?token=`. Deux formes
 * différentes du MÊME fichier ne se reconnaissent pas, et une exemption
 * fondée sur l'égalité de chaînes laisse alors passer la suppression.
 *
 * La clé, elle, est unique : c'est ce que MinIO indexe.
 */
export function storageKey(url: string | null | undefined): string | null {
  const p = extractStoragePath(url);
  return p ? `${p.bucket}/${p.path}` : null;
}

/**
 * Clés des rushes appartenant à un Autopilote ACTIF.
 *
 * ⚠️ CES FICHIERS SONT PARTAGÉS. Un même rush sert à tous les montages d'un
 * cycle, et il est référencé à la fois par la banque (`rush_urls`) et par le
 * `metadata.rushUrls` de chaque post produit. Supprimer un post ne doit donc
 * PAS emporter le rush : il appartient à la banque, pas au post.
 */
export async function autopilotRushKeys(): Promise<Set<string> | null> {
  const out = new Set<string>();
  try {
    const { data, error } = await supabaseAdmin
      .from('autopilot_config')
      .select('rush_urls')
      .eq('enabled', true);
    // ⚠️ `null` ET NON UN ENSEMBLE VIDE. Un ensemble vide se lit « aucun rush
    // à protéger » et laisserait l'appelant supprimer. Un nettoyage manqué se
    // rattrape au passage suivant ; un rush supprimé ne revient pas.
    if (error) {
      console.error('[Storage] banque de rushes illisible :', error.message);
      return null;
    }
    for (const ligne of data ?? []) {
      const rushes = (ligne as { rush_urls?: unknown }).rush_urls;
      if (!Array.isArray(rushes)) continue;
      for (const u of rushes) {
        const k = storageKey(typeof u === 'string' ? u : null);
        if (k) out.add(k);
      }
    }
  } catch (err) {
    console.error('[Storage] banque de rushes illisible :', err);
    return null;
  }
  return out;
}

/**
 * Pull every URL out of a post's metadata that points to Supabase Storage.
 * Order: video assets first (largest), then audio, then images. Logo URLs
 * are intentionally NOT included — a logo is typically reused across many
 * posts, so we'd need a reference-count check before safely deleting it.
 *
 * Note: pexelsUrl points to pexels.com (not our storage), so it's filtered
 * out by extractStoragePath returning null. Same for any external URL.
 */
export function collectStorageUrlsFromPost(meta: Record<string, unknown> | null | undefined): string[] {
  if (!meta) return [];
  const out: string[] = [];
  const pushIfString = (v: unknown) => { if (typeof v === 'string' && v.length > 0) out.push(v); };

  pushIfString(meta.videoUrl);
  pushIfString(meta.renderedVideoUrl);
  pushIfString(meta.thumbnailUrl);
  pushIfString(meta.rawVideoUrl);
  pushIfString(meta.posterUrl);
  pushIfString(meta.musicUrl);
  pushIfString(meta.voiceUrl);
  pushIfString(meta.characterUrl);
  pushIfString((meta as { audioMusicUrl?: unknown }).audioMusicUrl);
  pushIfString((meta as { audioVoiceUrl?: unknown }).audioVoiceUrl);

  // rushUrls is an array of objects { url, name, ... } in some posts and
  // a flat array of strings in others. Handle both.
  const rushUrls = (meta as { rushUrls?: unknown }).rushUrls;
  if (Array.isArray(rushUrls)) {
    for (const r of rushUrls) {
      if (typeof r === 'string') pushIfString(r);
      else if (r && typeof r === 'object' && 'url' in r) pushIfString((r as { url?: unknown }).url);
    }
  }

  return out;
}

/**
 * Delete a batch of Supabase Storage files grouped by bucket. Returns the
 * number of files successfully removed and a list of errors. Never throws —
 * the call site is expected to fire-and-forget so a slow/failing storage
 * delete doesn't block the row delete.
 */
export async function deleteStorageFiles(
  urls: string[],
  logPrefix: string = '[Storage]'
): Promise<{ removed: number; failed: Array<{ bucket: string; path: string; error: string }> }> {
  const grouped: Record<string, string[]> = {};
  for (const url of urls) {
    const parsed = extractStoragePath(url);
    if (!parsed) continue;
    grouped[parsed.bucket] ??= [];
    if (!grouped[parsed.bucket].includes(parsed.path)) {
      grouped[parsed.bucket].push(parsed.path);
    }
  }

  let removed = 0;
  const failed: Array<{ bucket: string; path: string; error: string }> = [];

  await Promise.all(
    Object.entries(grouped).map(async ([bucket, paths]) => {
      try {
        const { data, error } = await supabaseAdmin.storage.from(bucket).remove(paths);
        if (error) {
          console.warn(`${logPrefix} bucket=${bucket} remove failed:`, error.message, '— paths:', paths);
          for (const p of paths) failed.push({ bucket, path: p, error: error.message });
        } else {
          const successCount = data?.length || 0;
          removed += successCount;
          console.log(`${logPrefix} bucket=${bucket} removed ${successCount}/${paths.length} files`);
        }
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        console.error(`${logPrefix} bucket=${bucket} unexpected error:`, msg);
        for (const p of paths) failed.push({ bucket, path: p, error: msg });
      }
    })
  );

  return { removed, failed };
}
