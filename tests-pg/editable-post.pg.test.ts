/**
 * BIBLIOTHÈQUE — « post modifiable » d'une vidéo, sur un VRAI PostgreSQL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE SEULE LA BASE PEUT PROUVER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `POST /api/videos/[id]/editable-post` doit créer AU PLUS UN post par
 * vidéo, même sous requêtes simultanées. L'ancien schéma (« insérer, relire,
 * le plus ancien gagne, le perdant supprime ») échouait sur un entrelacement
 * précis : l'insert daté le PREMIER (`created_at` = début de transaction)
 * validé le DERNIER — l'autre requête, seule à sa relecture, gardait sa ligne,
 * puis la première se désignait gagnante : deux posts.
 *
 * La garantie vient désormais de la CLÉ PRIMAIRE : le post est inséré sous un
 * identifiant déterministe (`editablePostId(user, vidéo)`). Aucune migration :
 * `scheduled_posts.id` est déjà une clé primaire. Ce test rejoue l'entrelacement
 * fautif — une transaction tenue ouverte sur une connexion distincte — et
 * montre qu'une seule ligne survit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST DOUBLÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * - Le transport : `tests-pg/supabase-sql.ts` (une connexion du pool par
 *   instruction, comme PostgREST ; erreurs avec leur SQLSTATE). La colonne
 *   `platforms` est un `text[]` : PostgREST convertit un tableau JSON en
 *   tableau Postgres, l'adaptateur partagé le sérialise en JSON — la
 *   conversion est faite ici, pour cette seule colonne.
 * - La session (`auth`).
 *
 * Les tables `videos` et `scheduled_posts` sont celles de
 * `002_complete_schema.sql` (colonnes, clés, contraintes), sans ses politiques
 * RLS : `002` ne se rejoue pas sur un Postgres nu (voir `schema-prealable.sql`).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Client } from 'pg';
import { connecter, RACINE } from './harness';
import { clientSql, ouvrirPool, fermerPool } from './supabase-sql';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock('@/lib/db/supabase', async () => {
  const base = clientSql();
  const from = (table: string) => {
    const b = base.supabaseAdmin.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
    const insert = b.insert.bind(b);
    b.insert = (v: unknown) => {
      const row = { ...(v as Record<string, unknown>) };
      if (Array.isArray(row.platforms)) {
        row.platforms = `{${(row.platforms as string[]).map((p) => `"${p.replace(/"/g, '\\"')}"`).join(',')}}`;
      }
      return insert(row);
    };
    return b;
  };
  const client = { ...base.supabaseAdmin, from };
  return { supabase: client, supabaseAdmin: client };
});

const { POST } = await import('@/app/api/videos/[id]/editable-post/route');
const { editablePostId } = await import('@/lib/videos/editable-post');

const MOI = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';
const VIDEO = '33333333-3333-4333-8333-333333333333';

const SCHEMA = `
  create table public.videos (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    title varchar(500) not null,
    description text default '',
    format varchar(10) not null default 'reel' check (format in ('reel', 'tv')),
    status varchar(20) not null default 'draft' check (status in ('draft', 'rendering', 'completed', 'published', 'failed')),
    script text,
    thumbnail_url text,
    video_url text,
    credits_used integer default 0,
    metadata jsonb default '{}',
    render_job_id uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table public.scheduled_posts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    title varchar(500) not null default '',
    caption text default '',
    media_url text,
    media_type varchar(10) default 'video' check (media_type in ('video', 'image')),
    format varchar(10) default 'reel' check (format in ('reel', 'tv')),
    platforms text[] default '{}',
    scheduled_date date not null,
    scheduled_time time default '12:00',
    status varchar(20) not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'failed')),
    video_id uuid references public.videos(id) on delete set null,
    agent_plan_id uuid,
    agent_generated boolean default false,
    approved_by uuid references public.users(id),
    approved_at timestamptz,
    published_at timestamptz,
    metadata jsonb default '{}',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
`;

let db: Client;

const appeler = async (id = VIDEO) => {
  const res = await POST({} as never, { params: { id } });
  return { status: res.status, body: await res.json() };
};
const lignes = async () =>
  (await db.query<{ id: string; video_id: string | null }>('select id, video_id from public.scheduled_posts where video_id = $1 or id = $2', [VIDEO, editablePostId(MOI, VIDEO)])).rows;

beforeAll(async () => {
  db = await connecter();
  ouvrirPool(12);
});
afterAll(async () => {
  await fermerPool();
  await db.end();
});

beforeEach(async () => {
  await db.query('drop schema if exists public cascade; create schema public;');
  await db.query(readFileSync(join(RACINE, 'tests-pg/schema-prealable.sql'), 'utf-8'));
  await db.query(SCHEMA);
  await db.query(`insert into public.users (id, email, credits) values ($1, 'moi@test', 100), ($2, 'autre@test', 100)`, [MOI, AUTRE]);
  await db.query(
    `insert into public.videos (id, user_id, title, format, status, metadata)
     values ($1, $2, 'Ma vidéo', 'tv', 'completed', '{"subtitle":"Sous-titre","renderedVideoUrl":"https://cdn/montage.webm"}')`,
    [VIDEO, MOI],
  );
  session.userId = MOI;
});

describe('editable-post — PostgreSQL réel', () => {
  it('⚠️ 10 requêtes SIMULTANÉES : UNE seule ligne, le même postId pour toutes, une seule création', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => appeler()));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(new Set(rs.map((r) => r.body.postId)).size).toBe(1);
    expect(rs.filter((r) => r.body.created)).toHaveLength(1);
    const l = await lignes();
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ id: editablePostId(MOI, VIDEO), video_id: VIDEO });
  });

  it('⚠️ l’entrelacement qui cassait l’ancien schéma — insert daté le premier, validé le dernier — laisse UNE ligne', async () => {
    // Une autre requête a DÉJÀ inséré le post (même clé déterministe) mais n'a
    // pas encore validé : sa transaction est tenue ouverte ici.
    const tardive = await connecter();
    try {
      await tardive.query('begin');
      await tardive.query(
        `insert into public.scheduled_posts (id, user_id, video_id, title, scheduled_date) values ($1, $2, $3, 'Ma vidéo', current_date)`,
        [editablePostId(MOI, VIDEO), MOI, VIDEO],
      );
      // La route démarre pendant ce temps : son insert BLOQUE sur la clé…
      const enCours = appeler();
      await new Promise((r) => setTimeout(r, 300));
      // …jusqu'à la validation de l'autre, puis reçoit 23505 et relit.
      await tardive.query('commit');
      const r = await enCours;
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ postId: editablePostId(MOI, VIDEO), created: false });
    } finally {
      await tardive.end();
    }
    expect(await lignes()).toHaveLength(1);
  });

  it('post déjà relié : renvoyé tel quel, aucune insertion', async () => {
    await db.query(
      `insert into public.scheduled_posts (id, user_id, video_id, title, scheduled_date) values ('44444444-4444-4444-8444-444444444444', $1, $2, 'déjà', current_date)`,
      [MOI, VIDEO],
    );
    const r = await appeler();
    expect(r.body).toMatchObject({ postId: '44444444-4444-4444-8444-444444444444', created: false });
    expect((await db.query('select count(*)::int as n from public.scheduled_posts')).rows[0].n).toBe(1);
  });

  it('mauvais utilisateur : 404, aucune ligne', async () => {
    session.userId = AUTRE;
    expect((await appeler()).status).toBe(404);
    expect((await db.query('select count(*)::int as n from public.scheduled_posts')).rows[0].n).toBe(0);
  });

  it('vidéo inexistante : 404', async () => {
    expect((await appeler('55555555-5555-4555-8555-555555555555')).status).toBe(404);
  });

  it('la vidéo n’est pas modifiée ; aucun crédit, aucune transaction ; le post est un brouillon sans plateforme, au format de la vidéo', async () => {
    const avant = (await db.query('select * from public.videos where id = $1', [VIDEO])).rows[0];
    await appeler();
    const apres = (await db.query('select * from public.videos where id = $1', [VIDEO])).rows[0];
    expect(apres).toEqual(avant);
    expect((await db.query('select credits from public.users where id = $1', [MOI])).rows[0].credits).toBe(100);
    expect((await db.query('select count(*)::int as n from public.credit_transactions')).rows[0].n).toBe(0);
    const post = (await db.query('select status, platforms, format, metadata from public.scheduled_posts')).rows[0];
    expect(post).toMatchObject({ status: 'draft', platforms: [], format: 'tv' });
    expect(post.metadata).toMatchObject({ format: 'tv', videoSize: { w: 1920, h: 1080 }, renderedVideoUrl: 'https://cdn/montage.webm' });
  });
});
