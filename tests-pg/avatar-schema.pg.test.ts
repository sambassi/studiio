/**
 * AVATAR-1A — le schema du clone video, sur un VRAI PostgreSQL.
 *
 * La migration est jouee TELLE QU'ELLE PARTIRA EN PRODUCTION, sur le schema
 * de `main` (les deux migrations avatar de 2026-07-28), avec des donnees
 * existantes posees AVANT — c'est le seul cas qui se produira reellement.
 *
 * Ce que seule la base peut prouver :
 * 1. elle s'applique sur une base actuelle, et se rejoue sans erreur ;
 * 2. les colonnes ont le bon type, la bonne nullabilite, le bon defaut ;
 * 3. `provider_avatar_id` NULL est accepte (enrolement sans fournisseur) ;
 * 4. `intention` n'accepte que ses deux valeurs, un apercu exige une
 *    version, un seul apercu vivant par (avatar, version) ;
 * 5. RIEN N'EST PERDU : lignes, `provider_avatar_id`, credits ; le report de
 *    `subject_type` ne dit que ce que le consentement dit ;
 * 6. supprimer un avatar ne supprime plus ses videos ; supprimer le compte,
 *    si (la cascade `users` est intacte).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import type { Client } from 'pg';
import { connecter, preparerBase, appliquerMigration, creerUtilisateur, RACINE } from './harness';

const AVATAR_BASE = [
  join(RACINE, 'migrations/2026-07-28-user-avatars.sql'),
  join(RACINE, 'migrations/2026-07-28-avatar-type.sql'),
];
const MIGRATION = join(RACINE, 'migrations/2026-09-15-avatar-schema-foundation.sql');

const CONSENT_PHOTO = "Je certifie etre la personne visible sur l'image et j'autorise Studiio a en creer un avatar anime.";
const CONSENT_VIDEO = "Je certifie être la personne visible dans la vidéo et j'autorise Studiio et HeyGen à l'utiliser pour entraîner un avatar à mon effigie.";
const CONSENT_INCONNU = 'Texte importé d’ailleurs, sans certification de la personne.';

let db: Client;
beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });

/** La base de `main` : socle du harnais + les deux migrations avatar d'origine. */
async function baseActuelle() {
  await preparerBase(db);
  for (const m of AVATAR_BASE) await appliquerMigration(db, m);
}

async function avatarExistant(userId: string, consent: string, providerId = 'hg-1') {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.user_avatars (user_id, provider_avatar_id, status, consent_at, consent_text)
     values ($1, $2, 'completed', now(), $3) returning id`,
    [userId, providerId, consent],
  );
  return rows[0].id;
}

async function generationExistante(userId: string, avatarId: string | null, extra: Record<string, unknown> = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.avatar_generations (user_id, user_avatar_id, script, status, credits_charged, intention, avatar_version)
     values ($1, $2, 'Bonjour', $3, $4, $5, $6) returning id`,
    [userId, avatarId, extra.status ?? 'completed', extra.credits ?? 25, extra.intention ?? 'normale', extra.avatar_version ?? null],
  );
  return rows[0].id;
}

async function colonne(table: string, nom: string) {
  const { rows } = await db.query(
    `select data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, nom],
  );
  return rows[0] as { data_type: string; is_nullable: 'YES' | 'NO'; column_default: string | null } | undefined;
}

describe('1. Application et rejeu', () => {
  beforeEach(baseActuelle);

  it('s’applique sur une base actuelle, puis se rejoue sans erreur ni doublon', async () => {
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    const { rows } = await db.query(
      `select count(*)::int as n from pg_constraint
        where conrelid = 'public.avatar_generations'::regclass
          and conname in ('avatar_generations_intention_check', 'avatar_generations_apercu_versionne_check', 'avatar_generations_user_avatar_id_fkey')`,
    );
    expect(rows[0].n).toBe(3);
  });
});

describe('2. Les colonnes — types, nullabilité, défauts', () => {
  beforeEach(async () => { await baseActuelle(); await appliquerMigration(db, MIGRATION); });

  it('user_avatars : source_object_key, subject_type, consent_version, validated_at, version, deleted_at', async () => {
    expect(await colonne('user_avatars', 'source_object_key')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(await colonne('user_avatars', 'subject_type')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(await colonne('user_avatars', 'consent_version')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(await colonne('user_avatars', 'validated_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
    expect(await colonne('user_avatars', 'deleted_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
    const version = await colonne('user_avatars', 'version');
    expect(version).toMatchObject({ data_type: 'integer', is_nullable: 'NO' });
    expect(version!.column_default).toBe('1');
  });

  it('⚠️ provider_avatar_id devient nullable — sans que l’existant change', async () => {
    expect((await colonne('user_avatars', 'provider_avatar_id'))!.is_nullable).toBe('YES');
  });

  it('avatar_generations : avatar_version nullable, intention non nulle à défaut « normale », user_avatar_id nullable', async () => {
    expect(await colonne('avatar_generations', 'avatar_version')).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
    const intention = await colonne('avatar_generations', 'intention');
    expect(intention).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(intention!.column_default).toBe("'normale'::text");
    expect((await colonne('avatar_generations', 'user_avatar_id'))!.is_nullable).toBe('YES');
  });

  it('les colonnes historiques sont intactes', async () => {
    for (const c of ['provider', 'status', 'consent_at', 'consent_text', 'avatar_type', 'training_error']) {
      expect(await colonne('user_avatars', c), c).toBeDefined();
    }
    expect((await colonne('user_avatars', 'consent_text'))!.is_nullable).toBe('NO');
  });
});

describe('3. Ce que la base accepte et refuse', () => {
  let u: string;
  beforeEach(async () => { await baseActuelle(); await appliquerMigration(db, MIGRATION); u = await creerUtilisateur(db, 0); });

  it('⚠️ un avatar SANS fournisseur (provider_avatar_id NULL) est accepté, version 1', async () => {
    const { rows } = await db.query(
      `insert into public.user_avatars (user_id, provider_avatar_id, status, consent_at, consent_text, subject_type, source_object_key)
       values ($1, null, 'source_ready', now(), $2, 'self', $3) returning version, validated_at, deleted_at, provider_avatar_id`,
      [u, CONSENT_VIDEO, `${u}/avatar/source-1.mp4`],
    );
    expect(rows[0]).toEqual({ version: 1, validated_at: null, deleted_at: null, provider_avatar_id: null });
  });

  it('version < 1 et subject_type inconnu sont refusés', async () => {
    await expect(db.query(
      `insert into public.user_avatars (user_id, provider_avatar_id, status, consent_at, consent_text, version)
       values ($1, null, 'source_ready', now(), $2, 0)`, [u, CONSENT_VIDEO],
    )).rejects.toThrow(/user_avatars_version_check/);
    await expect(db.query(
      `insert into public.user_avatars (user_id, provider_avatar_id, status, consent_at, consent_text, subject_type)
       values ($1, null, 'source_ready', now(), $2, 'robot')`, [u, CONSENT_VIDEO],
    )).rejects.toThrow(/user_avatars_subject_type_check/);
  });

  it('⚠️ intention : seulement « apercu » ou « normale »', async () => {
    const a = await avatarExistant(u, CONSENT_VIDEO);
    await expect(generationExistante(u, a, { intention: 'brouillon' })).rejects.toThrow(/avatar_generations_intention_check/);
    await expect(generationExistante(u, a, { intention: 'normale' })).resolves.toBeDefined();
  });

  it('⚠️ un aperçu sans version ne prouve rien : refusé', async () => {
    const a = await avatarExistant(u, CONSENT_VIDEO);
    await expect(generationExistante(u, a, { intention: 'apercu', avatar_version: null }))
      .rejects.toThrow(/avatar_generations_apercu_versionne_check/);
    await expect(generationExistante(u, a, { intention: 'apercu', avatar_version: 1 })).resolves.toBeDefined();
  });

  it('⚠️ un seul aperçu VIVANT par (avatar, version) ; un aperçu échoué libère la place ; une autre version passe', async () => {
    const a = await avatarExistant(u, CONSENT_VIDEO);
    await generationExistante(u, a, { intention: 'apercu', avatar_version: 1, status: 'processing' });
    await expect(generationExistante(u, a, { intention: 'apercu', avatar_version: 1, status: 'pending' }))
      .rejects.toThrow(/avatar_generations_apercu_unique/);
    // Une génération NORMALE n'est pas concernée par l'unicité de l'aperçu.
    await expect(generationExistante(u, a, { intention: 'normale', avatar_version: 1 })).resolves.toBeDefined();
    await expect(generationExistante(u, a, { intention: 'apercu', avatar_version: 2 })).resolves.toBeDefined();
    await db.query(`update public.avatar_generations set status = 'failed' where user_avatar_id = $1 and avatar_version = 1 and intention = 'apercu'`, [a]);
    await expect(generationExistante(u, a, { intention: 'apercu', avatar_version: 1 })).resolves.toBeDefined();
  });
});

describe('4. ⚠️ RIEN N’EST PERDU — données posées AVANT la migration', () => {
  let u: string; let aPhoto: string; let aVideo: string; let aInconnu: string;
  const gens: string[] = [];

  beforeEach(async () => {
    await baseActuelle();
    u = await creerUtilisateur(db, 0);
    aPhoto = await avatarExistant(u, CONSENT_PHOTO, 'hg-photo');
    aVideo = await avatarExistant(u, CONSENT_VIDEO, 'hg-video');
    aInconnu = await avatarExistant(u, CONSENT_INCONNU, 'hg-x');
    gens.length = 0;
    // Trois générations payées sur l'avatar photo — posées AVANT `intention`
    // et `avatar_version` : insertion sans ces colonnes.
    for (let i = 0; i < 3; i++) {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.avatar_generations (user_id, user_avatar_id, script, status, credits_charged)
         values ($1, $2, $3, 'completed', 25) returning id`, [u, aPhoto, `Script ${i}`],
      );
      gens.push(rows[0].id);
    }
    await appliquerMigration(db, MIGRATION);
  });

  it('les lignes, les identifiants fournisseur et les crédits sont intacts', async () => {
    const { rows } = await db.query(`select id, provider_avatar_id, status, version, validated_at, deleted_at from public.user_avatars where user_id = $1 order by created_at`, [u]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.provider_avatar_id).sort()).toEqual(['hg-photo', 'hg-video', 'hg-x']);
    expect(rows.every((r) => r.version === 1 && r.validated_at === null && r.deleted_at === null)).toBe(true);
    const { rows: g } = await db.query(`select id, script, credits_charged, intention, avatar_version from public.avatar_generations where user_id = $1 order by created_at`, [u]);
    expect(g.map((r) => r.id)).toEqual(gens);
    expect(g.every((r) => r.credits_charged === 25 && r.intention === 'normale' && r.avatar_version === null)).toBe(true);
  });

  it('⚠️ subject_type est reporté SEULEMENT là où le consentement le dit', async () => {
    const { rows } = await db.query(`select id, subject_type from public.user_avatars where user_id = $1`, [u]);
    const par = Object.fromEntries(rows.map((r) => [r.id, r.subject_type]));
    expect(par[aPhoto]).toBe('self');
    expect(par[aVideo]).toBe('self');
    expect(par[aInconnu]).toBeNull();
  });

  it('⚠️ supprimer un avatar ne supprime plus ses vidéos — le lien passe à NULL', async () => {
    await db.query(`delete from public.user_avatars where id = $1`, [aPhoto]);
    const { rows } = await db.query(`select id, user_avatar_id, credits_charged from public.avatar_generations where user_id = $1 order by created_at`, [u]);
    expect(rows.map((r) => r.id)).toEqual(gens);
    expect(rows.every((r) => r.user_avatar_id === null && r.credits_charged === 25)).toBe(true);
  });

  it('supprimer le COMPTE emporte toujours avatars et générations (cascade users intacte)', async () => {
    await db.query(`delete from public.users where id = $1`, [u]);
    expect((await db.query(`select count(*)::int as n from public.user_avatars where user_id = $1`, [u])).rows[0].n).toBe(0);
    expect((await db.query(`select count(*)::int as n from public.avatar_generations where user_id = $1`, [u])).rows[0].n).toBe(0);
  });

  it('l’index des avatars vivants ne voit pas un avatar supprimé logiquement', async () => {
    await db.query(`update public.user_avatars set deleted_at = now() where id = $1`, [aInconnu]);
    const { rows } = await db.query(`select count(*)::int as n from public.user_avatars where user_id = $1 and deleted_at is null`, [u]);
    expect(rows[0].n).toBe(2);
    const { rows: idx } = await db.query(`select indexname from pg_indexes where tablename = 'user_avatars' and indexname = 'user_avatars_actifs_idx'`);
    expect(idx).toHaveLength(1);
  });
});
