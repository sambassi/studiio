import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { requireAdmin } from '@/lib/admin';

/**
 * One-shot admin endpoint qui nettoie les duplicates d'utilisateurs ayant
 * le même email. Stratégie :
 *
 * 1. Liste tous les rows `users` matchant l'email (par défaut : email de
 *    l'admin loggé) triés par credits DESC puis created_at ASC.
 * 2. Le premier row = "canonical" (à garder). Les autres = duplicates.
 * 3. Pour chaque table enfant qui référence users(id), réassigne les rows
 *    des duplicates vers le canonical. Pour social_accounts (qui a une
 *    contrainte unique sur user_id+platform), supprime le row dupliqué si
 *    le canonical a déjà cette plateforme.
 * 4. Supprime les rows users dupliqués.
 *
 * Mode "dry-run" par défaut (`?execute=true` pour l'exécution réelle).
 *
 * Usage :
 *   GET /api/admin/cleanup-duplicates                    → dry-run pour ton propre email
 *   GET /api/admin/cleanup-duplicates?execute=true       → exécution réelle
 *   GET /api/admin/cleanup-duplicates?email=x@y.com      → cible un autre email
 */

const CHILD_TABLES: Array<{ table: string; column: string }> = [
  { table: 'social_accounts', column: 'user_id' },
  { table: 'scheduled_posts', column: 'user_id' },
  { table: 'videos', column: 'user_id' },
  { table: 'credit_transactions', column: 'user_id' },
  { table: 'subscriptions', column: 'user_id' },
  { table: 'render_jobs', column: 'user_id' },
  { table: 'objectives', column: 'user_id' },
];

export async function GET(req: NextRequest) {
  const adminCheck = await requireAdmin();
  if (adminCheck.error) return adminCheck.error;

  const { searchParams } = new URL(req.url);
  const targetEmail =
    searchParams.get('email') || adminCheck.session?.user?.email || '';
  const execute = searchParams.get('execute') === 'true';

  if (!targetEmail) {
    return NextResponse.json(
      { ok: false, error: 'no email to clean (provide ?email=...)' },
      { status: 400 },
    );
  }

  const report: any = {
    targetEmail,
    mode: execute ? 'EXECUTE' : 'DRY-RUN',
    steps: [],
  };

  // STEP 1: list users
  const { data: users, error: listErr } = await supabaseAdmin
    .from('users')
    .select('id, email, credits, plan, created_at, name')
    .eq('email', targetEmail)
    .order('credits', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  }

  if (!users || users.length === 0) {
    return NextResponse.json({ ok: true, report: { ...report, found: 0 } });
  }

  report.found = users.length;
  report.users = users;

  if (users.length === 1) {
    report.steps.push('only 1 user — no duplicates to clean');
    return NextResponse.json({ ok: true, report });
  }

  const canonical = users[0];
  const duplicates = users.slice(1);
  const duplicateIds = duplicates.map((d) => d.id);
  report.canonical = { id: canonical.id, credits: canonical.credits };
  report.duplicates = duplicates.map((d) => ({ id: d.id, credits: d.credits }));

  if (!execute) {
    report.steps.push(
      `DRY-RUN: would migrate child rows from ${duplicates.length} duplicate(s) and delete them. Add ?execute=true to apply.`,
    );
    return NextResponse.json({ ok: true, report });
  }

  // STEP 2: migrate child rows
  const migrationLog: any[] = [];
  for (const { table, column } of CHILD_TABLES) {
    const { count, error: countErr } = await supabaseAdmin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in(column, duplicateIds);

    if (countErr) {
      migrationLog.push({ table, skipped: countErr.message });
      continue;
    }

    if (!count) {
      migrationLog.push({ table, migrated: 0 });
      continue;
    }

    // social_accounts has a UNIQUE(user_id, platform) constraint → handle collisions
    if (table === 'social_accounts') {
      const { data: dupRows } = await supabaseAdmin
        .from('social_accounts')
        .select('id, platform, user_id')
        .in('user_id', duplicateIds);

      const { data: canRows } = await supabaseAdmin
        .from('social_accounts')
        .select('platform')
        .eq('user_id', canonical.id);
      const canPlatforms = new Set((canRows || []).map((r: any) => r.platform));

      let migrated = 0;
      let deleted = 0;
      for (const row of dupRows || []) {
        if (canPlatforms.has(row.platform)) {
          const { error: delErr } = await supabaseAdmin
            .from('social_accounts')
            .delete()
            .eq('id', row.id);
          if (delErr) {
            migrationLog.push({ table, row: row.id, error: delErr.message });
          } else {
            deleted++;
          }
        } else {
          const { error: updErr } = await supabaseAdmin
            .from('social_accounts')
            .update({ user_id: canonical.id })
            .eq('id', row.id);
          if (updErr) {
            migrationLog.push({ table, row: row.id, error: updErr.message });
          } else {
            migrated++;
            canPlatforms.add(row.platform);
          }
        }
      }
      migrationLog.push({ table, migrated, deleted });
      continue;
    }

    // Generic re-assignment for other tables
    const { error: updErr } = await supabaseAdmin
      .from(table)
      .update({ [column]: canonical.id })
      .in(column, duplicateIds);
    migrationLog.push({
      table,
      migrated: updErr ? 0 : count,
      ...(updErr ? { error: updErr.message } : {}),
    });
  }
  report.migration = migrationLog;

  // STEP 3: delete duplicate users
  const { error: delErr, count: delCount } = await supabaseAdmin
    .from('users')
    .delete({ count: 'exact' })
    .in('id', duplicateIds);

  if (delErr) {
    report.steps.push(`DELETE error: ${delErr.message}`);
    return NextResponse.json({ ok: false, report }, { status: 500 });
  }

  report.steps.push(`✓ deleted ${delCount} duplicate user(s)`);
  report.canonical_final = canonical;

  return NextResponse.json({ ok: true, report });
}
