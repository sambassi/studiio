/**
 * A_8f (correctif Gap-1) — DEUX APERÇUS SIMULTANÉS, UNE SEULE RÉSERVATION. SUR UN VRAI POSTGRESQL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER NE SE CONTENTE PAS D'UN SIMULACRE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La garantie « un seul aperçu non échoué par version » ne vient d'aucune
 * lecture applicative : elle vient de l'index unique partiel de la migration
 * `2026-09-14-avatar-generations-intention-apercu.sql`. Un test qui rejouerait
 * cet index en mémoire prouverait le simulacre, pas la base. Ici, deux
 * connexions distinctes insèrent la même réservation ; PostgreSQL tranche.
 *
 * ⚠️ IL S'EXÉCUTE SUR LE SOCLE LOCAL (`scripts/dev/studiio-local-stack.sh`),
 * par le socket Unix, et se déclare ignoré quand ce socle est absent (CI).
 * Il ne pointe jamais vers une base distante : pas d'URL, pas de mot de passe,
 * seulement le répertoire de socket de la boucle locale.
 *
 * Il ne touche qu'à des lignes qu'il crée, sous un compte de test jetable,
 * et les retire en sortant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const RACINE = process.env.STUDIIO_LOCAL_ROOT ?? path.join(homedir(), '.studiio-local');
const CONNEXION = {
  host: path.join(RACINE, 'run'),
  port: Number(process.env.STUDIIO_LOCAL_PGPORT ?? 5433),
  user: 'studiio',
  database: 'studiio_local',
  connectionTimeoutMillis: 1500,
};

async function ouvrir(): Promise<Client | null> {
  const c = new Client(CONNEXION);
  try { await c.connect(); return c; } catch { return null; }
}

const sonde = await ouvrir();
const disponible = sonde !== null;
if (sonde) await sonde.end();

const MIGRATION = readFileSync(path.join(
  process.cwd(), 'migrations/2026-09-14-avatar-generations-intention-apercu.sql',
), 'utf8');

describe.skipIf(!disponible)('A_8f — l’index unique d’aperçu, sur PostgreSQL', () => {
  let a: Client; let b: Client;
  const USER = randomUUID();
  const AVATAR = randomUUID();
  const crees: string[] = [];

  const reservation = (c: Client, version: number | null, intention = 'apercu', status = 'pending') => c.query(
    `insert into public.avatar_generations
       (user_id, user_avatar_id, avatar_version, intention, script, status)
     values ($1, $2, $3, $4, 'test', $5) returning id`,
    [USER, AVATAR, version, intention, status],
  ).then((r) => { crees.push(r.rows[0].id); return r; });

  beforeAll(async () => {
    a = (await ouvrir())!; b = (await ouvrir())!;
    /* La migration est idempotente : la rejouer prouve qu'elle l'est. */
    await a.query(MIGRATION);
    await a.query(
      `insert into public.users (id, email) values ($1, $2) on conflict (id) do nothing`,
      [USER, `a8f-test-${USER}@local.invalid`],
    );
    await a.query(
      `insert into public.user_avatars
         (id, user_id, provider_avatar_id, status, consent_at, consent_text, version)
       values ($1, $2, 'hg_test', 'completed', now(), 'test', 1)`,
      [AVATAR, USER],
    );
  });

  afterAll(async () => {
    try {
      await a.query(`delete from public.avatar_generations where user_id = $1`, [USER]);
      await a.query(`delete from public.user_avatars where user_id = $1`, [USER]);
      await a.query(`delete from public.users where id = $1`, [USER]);
    } finally {
      await a.end(); await b.end();
    }
  });

  const nettoyer = async () => {
    await a.query(`delete from public.avatar_generations where user_id = $1`, [USER]);
  };

  it('1 la migration est en place : colonne, contrainte, index', async () => {
    const col = await a.query(
      `select column_default, is_nullable from information_schema.columns
        where table_name = 'avatar_generations' and column_name = 'intention'`,
    );
    expect(col.rows[0]).toEqual({ column_default: "'normale'::text", is_nullable: 'NO' });
    const idx = await a.query(
      `select indexdef from pg_indexes where indexname = 'avatar_generations_apercu_unique'`,
    );
    expect(idx.rows[0].indexdef).toMatch(/UNIQUE INDEX .* WHERE \(\(intention = 'apercu'::text\) AND \(status <> 'failed'::text\)\)/);
  });

  it('2 ⚠️ DEUX INSERTIONS SIMULTANÉES : EXACTEMENT UNE PASSE', async () => {
    await nettoyer();
    const issues = await Promise.allSettled([reservation(a, 1), reservation(b, 1)]);
    const reussies = issues.filter((i) => i.status === 'fulfilled');
    const refusees = issues.filter((i) => i.status === 'rejected') as PromiseRejectedResult[];
    expect(reussies).toHaveLength(1);
    expect(refusees).toHaveLength(1);
    expect(refusees[0].reason.code).toBe('23505');
    expect(refusees[0].reason.constraint).toBe('avatar_generations_apercu_unique');
  });

  it('3 ⚠️ MÊME AVEC UNE TRANSACTION OUVERTE : le second attend, puis est refusé', async () => {
    /* A insère sans valider ; B tente la même clé et BLOQUE sur le verrou
       d'index. Quand A valide, B reçoit 23505. C'est le scénario « deux
       instances qui ont lu "aucun aperçu" au même instant », sans fenêtre. */
    await nettoyer();
    await a.query('begin');
    await reservation(a, 1);
    let bTerminee = false;
    const bPromesse = reservation(b, 1).then(
      () => { bTerminee = true; return 'passee'; },
      (e: { code?: string }) => { bTerminee = true; return e.code; },
    );
    await new Promise((r) => { setTimeout(r, 150); });
    expect(bTerminee).toBe(false);          // B est bien en attente du verrou
    await a.query('commit');
    expect(await bPromesse).toBe('23505');
  });

  it('4 un aperçu échoué libère la place', async () => {
    await nettoyer();
    await reservation(a, 1, 'apercu', 'failed');
    await expect(reservation(b, 1)).resolves.toBeTruthy();
  });

  it('5 un aperçu terminé la garde', async () => {
    await nettoyer();
    await reservation(a, 1, 'apercu', 'completed');
    await expect(reservation(b, 1)).rejects.toMatchObject({ code: '23505' });
  });

  it('6 la version suivante a sa propre place', async () => {
    await nettoyer();
    await reservation(a, 1, 'apercu', 'completed');
    await expect(reservation(b, 2)).resolves.toBeTruthy();
  });

  it('7 les générations normales ne sont pas limitées', async () => {
    await nettoyer();
    await reservation(a, 1, 'normale');
    await expect(reservation(b, 1, 'normale')).resolves.toBeTruthy();
  });

  it('8 ⚠️ UN APERÇU SANS VERSION EST REFUSÉ PAR LA BASE', async () => {
    await nettoyer();
    await expect(reservation(a, null)).rejects.toMatchObject({ code: '23514' });
  });

  it('9 une intention inconnue est refusée par la base', async () => {
    await nettoyer();
    await expect(reservation(a, 1, 'preview')).rejects.toMatchObject({ code: '23514' });
  });
});
