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
 * Clés des rushes INDEXÉS et des vignettes d'analyse — le socle du tournage.
 *
 * ⚠️ POURQUOI CETTE FONCTION EXISTE, ET POURQUOI ELLE EST URGENTE.
 *
 * Un rush indexé par M3-A vit dans `media/<userId>/rush/…`. `getFileType` le
 * classe `video`, donc **24 h de rétention**. Or aucune des deux sources
 * d'exemption existantes ne le connaît : `getProtectedUrls` ne lit que
 * `scheduled_posts`, `autopilotRushKeys` ne lit que `autopilot_config.
 * rush_urls`. Un rush téléversé dans une session de tournage disparaissait
 * donc au bout d'un jour, et toute analyse ultérieure échouait en 404 sur un
 * fichier qui existait la veille.
 *
 * Les vignettes d'analyse posent la même question un cran plus loin : elles
 * sont écrites sous `media/<userId>/analyse/<analysisId>/…`, sont classées
 * `image` (7 jours), et la ligne d'analyse continuerait de les désigner
 * longtemps après leur suppression.
 *
 * ⚠️ `rush_analyses` PEUT NE PAS EXISTER, et ce n'est pas une panne : la
 * migration `2026-09-01-rush-analyses.sql` n'est pas appliquée partout. Une
 * table absente signifie qu'aucune vignette n'existe — un ensemble vide est
 * alors la réponse JUSTE. Une table présente mais illisible est autre chose,
 * et rend `null`.
 */
export const PAGE_LECTURE = 1000;

/**
 * Plafond de sécurité, en lignes.
 *
 * Au-delà, on refuse de conclure plutôt que de rendre une liste dont on ne
 * peut plus garantir la complétude. Sous-protéger, ici, c'est supprimer.
 */
export const LIGNES_MAX = 500_000;

/**
 * Lit une table ENTIÈRE, par tranches.
 *
 * ⚠️ SANS PAGINATION, CETTE LECTURE PEUT ÊTRE TRONQUÉE SANS QUE RIEN NE LE
 * DISE — ET UNE TRONCATURE ICI SUPPRIME DES FICHIERS.
 *
 * PostgREST plafonne le nombre de lignes rendues (`db-max-rows`), et le
 * client n'émet aucun en-tête `Range` tant qu'on ne demande pas de tranche.
 * La réponse tronquée arrive alors en `200`, avec `error === null` et
 * simplement moins de lignes : rien ne distingue « c'est tout » de « il y en
 * avait dix fois plus ». Le repli `NEXT_PUBLIC_SUPABASE_URL` de
 * `src/lib/db/supabase.ts` rend ce cas atteignable dès qu'une variable
 * d'environnement manque.
 *
 * Or tout ce fichier est écrit sur le contrat inverse — « `null` ET NON UN
 * ENSEMBLE VIDE ». Une lecture tronquée EST un ensemble partiel rendu comme
 * s'il était complet : exactement ce que ce contrat existe pour interdire,
 * et le seul chemin qui le contournait.
 *
 * `.range()` force l'émission d'un `Range`, ce qui neutralise `db-max-rows`
 * quelle que soit sa valeur — la correction n'a donc pas besoin qu'on
 * connaisse le plafond.
 *
 * L'ordre stable est OBLIGATOIRE : sans `ORDER BY`, PostgreSQL rend les
 * lignes dans l'ordre physique, qui change entre deux tranches. Deux pages
 * successives pourraient alors répéter une ligne et en omettre une autre.
 *
 * Rend `null` dès que la lecture est incomplète ou impossible.
 */
async function lireTout(
  table: string, colonnes: string, tolererAbsence: boolean,
): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  for (let debut = 0; ; debut += PAGE_LECTURE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(colonnes)
      .order('id', { ascending: true })
      .range(debut, debut + PAGE_LECTURE - 1);

    if (error) {
      // Table absente = socle non appliqué = rien à lire. Ce n'est pas une
      // lecture ratée, c'est une lecture qui n'a rien à lire.
      if (tolererAbsence && tableAbsente(error)) return [];
      console.error(`[Storage] ${table} illisible :`, error.message);
      return null;
    }

    const lot = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...lot);
    // Une page plus courte que demandée est la seule fin de table honnête.
    if (lot.length < PAGE_LECTURE) return out;
    if (out.length > LIGNES_MAX) {
      console.error(`[Storage] ${table} depasse ${LIGNES_MAX} lignes — lecture abandonnee`);
      return null;
    }
  }
}

export async function clesTournageEtAnalyses(): Promise<Set<string> | null> {
  const out = new Set<string>();

  // ── Les rushes indexés ──────────────────────────────────────────────────
  // Même contrat que `autopilotRushKeys` : `null`, et non un ensemble vide.
  // Un nettoyage manqué se rattrape au passage suivant ; un rush supprimé ne
  // revient pas.
  let rushes: Record<string, unknown>[] | null;
  try {
    rushes = await lireTout('rushes', 'id, bucket, cle_objet', true);
  } catch (err) {
    console.error('[Storage] rushes illisibles :', err);
    return null;
  }
  if (!rushes) return null;
  for (const l of rushes) {
    if (typeof l.bucket === 'string' && typeof l.cle_objet === 'string') {
      out.add(`${l.bucket}/${l.cle_objet}`);
    }
  }

  // ── Les vignettes d'analyse ─────────────────────────────────────────────
  let analyses: Record<string, unknown>[] | null;
  try {
    analyses = await lireTout('rush_analyses', 'id, vignettes', true);
  } catch (err) {
    console.error('[Storage] vignettes illisibles :', err);
    return null;
  }
  if (!analyses) return null;
  for (const ligne of analyses) {
    const v = ligne.vignettes;
    if (!Array.isArray(v)) continue;
    for (const brut of v) {
      if (!brut || typeof brut !== 'object') continue;
      const g = brut as { bucket?: unknown; cle?: unknown };
      if (typeof g.bucket === 'string' && typeof g.cle === 'string') {
        out.add(`${g.bucket}/${g.cle}`);
      }
    }
  }

  return out;
}

/** Codes PostgREST qui signifient « la table n'existe pas ». */
function tableAbsente(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
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
