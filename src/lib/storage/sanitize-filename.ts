/**
 * Normalize a filename so it can safely be used as a Supabase Storage
 * object key. Supabase rejects keys containing non-ASCII characters
 * ("Invalid key" error), and spaces/parentheses/slashes break the
 * signed-URL round trip on some edge regions.
 *
 * Strips diacritics (é → e, à → a), replaces every non-word character
 * with "_", collapses runs of underscores, and lowercases the result.
 * Keeps the extension intact.
 *
 * Example:
 *   "Témoignages (final) v2.mp4"
 *   → "temoignages_final_v2.mp4"
 */
export function sanitizeStorageFilename(name: string): string {
  const normalized = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cleaned = normalized
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return cleaned || 'file';
}
