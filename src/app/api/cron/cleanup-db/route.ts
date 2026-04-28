import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily DB-only cleanup. Storage is already cleaned every 3 h by
 * cleanup-media (which has retention-aware per-type rules), so this
 * route focuses on table rows that pile up forever otherwise — failed
 * posts, old published posts, abandoned drafts, finished render jobs,
 * and stale audit/credit logs.
 *
 * Retention rules (chosen to fit the Supabase free tier 500 MB DB
 * quota with comfortable headroom for normal usage):
 *  • scheduled_posts.status='failed'         → 7 days
 *  • scheduled_posts.status='published'      → 90 days
 *  • scheduled_posts.status='draft'          → 30 days
 *  • render_jobs (any status)                → 7 days
 *  • credit_transactions                     → 365 days  (compliance)
 *  • audit_log                               → 30 days
 *
 * Schedule: 3 AM daily (vercel.json). Auth via the same Bearer
 * CRON_SECRET pattern used by /api/cron/publish + cleanup-media.
 */

function verifyCronSecret(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  return !!authHeader && authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const cutoff = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

type DeleteResult = { table: string; count: number; error?: string };

async function deleteOlderThan(
  table: string,
  days: number,
  filter?: (q: any) => any,
): Promise<DeleteResult> {
  let query = supabaseAdmin
    .from(table)
    .delete({ count: 'exact' })
    .lt('created_at', cutoff(days));
  if (filter) query = filter(query);
  const { error, count } = await query;
  if (error) {
    console.error(`[CLEANUP-DB] ${table} delete failed:`, error.message);
    return { table, count: 0, error: error.message };
  }
  return { table, count: count ?? 0 };
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const results: DeleteResult[] = [];

  // scheduled_posts: per-status retention. Run them sequentially so
  // each result is independently logged even if one fails.
  results.push(
    await deleteOlderThan('scheduled_posts', 7, (q) => q.eq('status', 'failed')),
  );
  results.push({
    ...(await deleteOlderThan('scheduled_posts', 90, (q) => q.eq('status', 'published'))),
    table: 'scheduled_posts.published',
  });
  results.push({
    ...(await deleteOlderThan('scheduled_posts', 30, (q) => q.eq('status', 'draft'))),
    table: 'scheduled_posts.draft',
  });

  // Single-rule tables.
  results.push(await deleteOlderThan('render_jobs', 7));
  results.push(await deleteOlderThan('credit_transactions', 365));
  results.push(await deleteOlderThan('audit_log', 30));

  const total = results.reduce((n, r) => n + r.count, 0);
  const errors = results.filter((r) => r.error);
  const durationMs = Date.now() - startedAt;

  console.log(
    `[CLEANUP-DB] Done in ${durationMs}ms — total=${total}`,
    results.map((r) => `${r.table}=${r.count}${r.error ? '(err)' : ''}`).join(' '),
  );

  return NextResponse.json({
    success: errors.length === 0,
    durationMs,
    total,
    breakdown: results.reduce<Record<string, number>>((acc, r) => {
      acc[r.table] = r.count;
      return acc;
    }, {}),
    errors: errors.length > 0 ? errors : undefined,
  });
}
