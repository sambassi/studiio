/**
 * AUTOPILOTE — un seul post par créneau, sur un VRAI PostgreSQL.
 *
 * Joue les fichiers RÉELS : `migrations/2026-10-29-scheduled-posts-creneau-unique.sql`, son retour
 * arrière et son contrôle préalable. La table `scheduled_posts` est celle de
 * `src/lib/db/migrations/002_complete_schema.sql` (colonnes utiles, sans la clé étrangère vers `videos`).
 *
 * Ce que cela prouve : l'unicité tient sous insertions SIMULTANÉES, laisse passer les cas légitimes
 * (plusieurs réseaux dans une ligne, posts dupliqués à la main, autres comptes) et la migration refuse
 * — sans rien modifier — de s'appliquer sur des doublons existants.
 * Ce que cela NE prouve PAS : le comportement de PostgREST (le code d'erreur 23505 y est relayé tel quel).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'fs';
import { Pool } from 'pg';
import type { Client } from 'pg';
import { connecter, preparerBase, appliquerMigration, RACINE, urlBase } from './harness';

const MIGRATION = join(RACINE, 'migrations/2026-10-29-scheduled-posts-creneau-unique.sql');
const ROLLBACK = join(RACINE, 'migrations/rollback/2026-10-29-scheduled-posts-creneau-unique.rollback.sql');
const CONTROLE = join(RACINE, 'migrations/controles/2026-10-29-scheduled-posts-creneau-unique.controle.sql');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = uuid(1);
const B = uuid(2);
const INDEX = 'scheduled_posts_autopilote_creneau_uniq';

let db: Client;
let pool: Pool;

const jeton = (u: string, h = '09:00') => `${u}|2026-10-27|${h}`;
async function inserer(
  user: string, slot: string | null,
  o: { agent?: boolean; source?: string; plateformes?: string[]; client?: Pool | Client } = {},
) {
  const metadata: Record<string, unknown> = { source: o.source ?? 'autopilote' };
  if (slot !== null) metadata.slotKey = slot;
  return (o.client ?? pool).query(
    `insert into public.scheduled_posts (user_id, title, platforms, scheduled_date, scheduled_time, agent_generated, metadata)
     values ($1, 'T', $2, '2026-10-27', '09:00', $3, $4) returning id`,
    [user, o.plateformes ?? ['instagram'], o.agent ?? true, JSON.stringify(metadata)],
  );
}
const nbPosts = async () => Number((await db.query('select count(*) from public.scheduled_posts')).rows[0].count);
const indexPresent = async () => (await db.query('select 1 from pg_indexes where indexname = $1', [INDEX])).rowCount === 1;

beforeAll(async () => {
  db = await connecter();
  await preparerBase(db);
  await db.query(`
    create table public.scheduled_posts (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.users(id) on delete cascade,
      title varchar(500) not null default '',
      media_url text,
      platforms text[] default '{}',
      scheduled_date date not null,
      scheduled_time time default '12:00',
      status varchar(20) not null default 'draft',
      agent_generated boolean default false,
      metadata jsonb default '{}',
      created_at timestamptz default now()
    )`);
  await appliquerMigration(db, MIGRATION);
  pool = new Pool({ connectionString: urlBase(), max: 24 });
});
afterAll(async () => { await pool.end(); await db.end(); });
beforeEach(async () => {
  if (!(await indexPresent())) await appliquerMigration(db, MIGRATION);
  await db.query('delete from public.scheduled_posts');
  await db.query('delete from public.users');
  for (const [i, id] of [A, B].entries()) await db.query('insert into public.users (id, email) values ($1, $2)', [id, `c${i}@test.invalid`]);
});

describe('unicité sous concurrence réelle', () => {
  it('20 générations SIMULTANÉES du même créneau : exactement un post, les 19 autres reçoivent 23505', async () => {
    const res = await Promise.allSettled(Array.from({ length: 20 }, () => inserer(A, jeton(A))));
    const ok = res.filter((r) => r.status === 'fulfilled');
    const ko = res.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(19);
    expect(ko.every((r) => (r.reason as { code?: string }).code === '23505')).toBe(true);
    expect(await nbPosts()).toBe(1);
  });

  it('publication déjà existante : une seconde insertion du même créneau est refusée (23505), l’existante est intacte', async () => {
    const { rows } = await inserer(A, jeton(A));
    await expect(inserer(A, jeton(A))).rejects.toMatchObject({ code: '23505' });
    expect((await db.query('select id from public.scheduled_posts')).rows).toEqual([{ id: rows[0].id }]);
  });

  it('reprise après panne : le créneau supprimé (ou jamais déposé) peut être produit, une seule fois', async () => {
    const { rows } = await inserer(A, jeton(A));
    await db.query('delete from public.scheduled_posts where id = $1', [rows[0].id]);
    await expect(inserer(A, jeton(A))).resolves.toBeTruthy();
    await expect(inserer(A, jeton(A))).rejects.toMatchObject({ code: '23505' });
  });
});

describe('cas légitimes préservés', () => {
  it('plusieurs réseaux sociaux = UNE ligne portant plusieurs plateformes : aucun conflit', async () => {
    const { rows } = await inserer(A, jeton(A), { plateformes: ['instagram', 'tiktok', 'facebook', 'youtube'] });
    expect(rows).toHaveLength(1);
    expect((await db.query('select platforms from public.scheduled_posts')).rows[0].platforms).toHaveLength(4);
  });

  it('autre heure, autre jour, autre compte : autorisés ; production manuelle (jeton « manuel: ») distincte du cron', async () => {
    await inserer(A, jeton(A, '09:00'));
    await inserer(A, jeton(A, '18:00'));
    await inserer(A, `${A}|2026-10-28|09:00`);
    await inserer(B, jeton(B, '09:00'));
    await inserer(A, `manuel:${jeton(A)}`);
    expect(await nbPosts()).toBe(5);
  });

  it('un post dupliqué ou créé à la main (agent_generated faux), même avec le jeton copié : autorisé', async () => {
    await inserer(A, jeton(A));
    await expect(inserer(A, jeton(A), { agent: false })).resolves.toBeTruthy();
    await expect(inserer(A, jeton(A), { agent: false })).resolves.toBeTruthy();
    expect(await nbPosts()).toBe(3);
  });

  it('anciens posts sans jeton, et autre source que « autopilote » : jamais bloqués', async () => {
    await inserer(A, null);
    await inserer(A, null);
    await inserer(A, jeton(A), { source: 'agent-ia' });
    await inserer(A, jeton(A), { source: 'agent-ia' });
    expect(await nbPosts()).toBe(4);
  });
});

describe('migration, contrôle préalable et retour arrière', () => {
  it('le contrôle préalable est en LECTURE SEULE et ne renvoie rien sur une base saine', async () => {
    const sql = readFileSync(CONTROLE, 'utf8');
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|create)\b/i);
    await inserer(A, jeton(A));
    const res = await db.query(sql);
    const [doublons, couverts] = res as unknown as Array<{ rows: Array<Record<string, unknown>> }>;
    expect(doublons.rows).toHaveLength(0);
    expect(Number(couverts.rows[0].posts_couverts)).toBe(1);
  });

  it('avec des doublons existants : le contrôle les liste, la migration REFUSE (23505), n’efface rien, ne crée pas l’index', async () => {
    await appliquerMigration(db, ROLLBACK);
    expect(await indexPresent()).toBe(false);
    await inserer(A, jeton(A));
    await inserer(A, jeton(A));
    await inserer(B, jeton(B));
    const avant = await db.query('select id, metadata from public.scheduled_posts order by id');
    const ctrl = (await db.query(readFileSync(CONTROLE, 'utf8'))) as unknown as Array<{ rows: Array<Record<string, unknown>> }>;
    expect(ctrl[0].rows).toHaveLength(1);
    expect(Number(ctrl[0].rows[0].nb_posts)).toBe(2);
    await expect(appliquerMigration(db, MIGRATION)).rejects.toMatchObject({ code: '23505' });
    await db.query('rollback'); // psql ferme la transaction fautive en fin de script ; ici la connexion est réutilisée
    expect(await indexPresent()).toBe(false);
    expect((await db.query('select id, metadata from public.scheduled_posts order by id')).rows).toEqual(avant.rows);
    // Le doublon réglé à la main : la migration passe.
    await db.query('delete from public.scheduled_posts where id = (select id from public.scheduled_posts where user_id = $1 limit 1)', [A]);
    await appliquerMigration(db, MIGRATION);
    expect(await indexPresent()).toBe(true);
  });

  it('migration rejouable ; retour arrière : l’index disparaît, aucune ligne n’est touchée', async () => {
    await appliquerMigration(db, MIGRATION);
    await appliquerMigration(db, MIGRATION);
    await inserer(A, jeton(A));
    await appliquerMigration(db, ROLLBACK);
    expect(await indexPresent()).toBe(false);
    expect(await nbPosts()).toBe(1);
    await expect(inserer(A, jeton(A))).resolves.toBeTruthy(); // sans l'index, le doublon repasse : c'est l'état d'avant
  });
});
