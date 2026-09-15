/**
 * D-ID — les colonnes du second fournisseur, sur un VRAI PostgreSQL.
 *
 * La migration est jouée TELLE QU'ELLE PARTIRA EN PRODUCTION, sur le schéma
 * avatar actuel (1A + un-actif + jumeau-en-vol), avec des données HeyGen
 * posées AVANT. Ce que seule la base prouve : elle s'applique et se rejoue ;
 * les colonnes ont le bon type et le bon défaut ; RIEN N'EST PERDU (lignes
 * HeyGen intactes, `provider` = 'heygen' partout, générations à 'heygen') ;
 * les CHECK nomment les seuls fournisseurs câblés ; le prévol s'arrête sur
 * une valeur inconnue sans rien corriger ; l'index « un aperçu vivant par
 * version » vaut aussi pour une génération D-ID ; l'index du jumeau en vol
 * n'est pas touché.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import type { Client } from 'pg';
import { connecter, preparerBase, appliquerMigration, creerUtilisateur, RACINE } from './harness';

const AVATAR_BASE = [
  join(RACINE, 'migrations/2026-07-28-user-avatars.sql'),
  join(RACINE, 'migrations/2026-07-28-avatar-type.sql'),
  join(RACINE, 'migrations/2026-09-15-avatar-schema-foundation.sql'),
  join(RACINE, 'migrations/2026-09-15-avatar-one-active-per-user.sql'),
  join(RACINE, 'migrations/2026-09-15-avatar-jumeau-en-vol.sql'),
];
const MIGRATION = join(RACINE, 'migrations/2026-09-15-avatar-fournisseur-did.sql');

let db: Client;
beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });

async function baseActuelle() {
  await preparerBase(db);
  for (const m of AVATAR_BASE) await appliquerMigration(db, m);
}
async function avatarHeygen(userId: string) {
  const { rows: [a] } = await db.query<{ id: string }>(
    `insert into public.user_avatars (user_id, provider_avatar_id, status, consent_at, consent_text, avatar_type, version, validated_at)
     values ($1, 'hg-1', 'completed', now(), 'x', 'photo', 1, now()) returning id`, [userId],
  );
  await db.query(
    `insert into public.avatar_generations (user_id, user_avatar_id, script, status, credits_charged, intention, avatar_version)
     values ($1, $2, 'Bonjour', 'completed', 40, 'normale', 1)`, [userId, a.id],
  );
  return a.id;
}
const colonne = async (table: string, nom: string) => (await db.query(
  "select data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2", [table, nom],
)).rows[0];

describe('1. La migration sur la base actuelle, avec des avatars HeyGen existants', () => {
  it('⚠️ s’applique, se rejoue, et ne perd rien : lignes HeyGen intactes, provider = heygen partout, générations à heygen', async () => {
    await baseActuelle();
    const u = await creerUtilisateur(db, 100);
    const id = await avatarHeygen(u);
    const avant = (await db.query('select * from public.user_avatars where id = $1', [id])).rows[0];
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    const apres = (await db.query('select * from public.user_avatars where id = $1', [id])).rows[0];
    for (const k of Object.keys(avant)) expect(apres[k], k).toEqual(avant[k]);
    expect(apres).toMatchObject({ provider: 'heygen', provider_consent_id: null, provider_consent_text: null, provider_consent_status: null, consent_object_key: null });
    const { rows: gens } = await db.query('select provider, status, credits_charged from public.avatar_generations where user_id = $1', [u]);
    expect(gens).toEqual([{ provider: 'heygen', status: 'completed', credits_charged: 40 }]);
  });

  it('colonnes : quatre text nullables sur user_avatars, provider text not null default heygen sur avatar_generations', async () => {
    for (const c of ['provider_consent_id', 'provider_consent_text', 'provider_consent_status', 'consent_object_key']) {
      expect(await colonne('user_avatars', c), c).toMatchObject({ data_type: 'text', is_nullable: 'YES', column_default: null });
    }
    expect(await colonne('avatar_generations', 'provider')).toMatchObject({ data_type: 'text', is_nullable: 'NO', column_default: "'heygen'::text" });
  });

  it('⚠️ les CHECK : heygen et did seulement, sur les deux tables (23514 sinon)', async () => {
    const u = await creerUtilisateur(db, 100);
    await expect(db.query(
      `insert into public.user_avatars (user_id, provider, provider_avatar_id, status, consent_at, consent_text, version) values ($1, 'synthesia', 'x', 'completed', now(), 'x', 1)`, [u],
    )).rejects.toMatchObject({ code: '23514' });
    const { rows: [a] } = await db.query<{ id: string }>(
      `insert into public.user_avatars (user_id, provider, provider_avatar_id, status, consent_at, consent_text, avatar_type, version, provider_consent_id, provider_consent_text, provider_consent_status, consent_object_key)
       values ($1, 'did', 'avt-1', 'completed', now(), 'x', 'video', 1, 'cst-1', 'pomme vélo nuage', 'done', $2) returning id`,
      [u, `${u}/avatar/consent-1-${'a'.repeat(32)}.mp4`],
    );
    await expect(db.query(
      `insert into public.avatar_generations (user_id, user_avatar_id, script, status, credits_charged, intention, avatar_version, provider) values ($1, $2, 'x', 'pending', 0, 'apercu', 1, 'synthesia')`, [u, a.id],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('⚠️ un seul aperçu vivant par version — aussi pour une génération D-ID ; l’index du jumeau en vol est intact', async () => {
    const u = await creerUtilisateur(db, 100);
    const { rows: [a] } = await db.query<{ id: string }>(
      `insert into public.user_avatars (user_id, provider, provider_avatar_id, status, consent_at, consent_text, avatar_type, version) values ($1, 'did', 'avt-2', 'completed', now(), 'x', 'video', 1) returning id`, [u],
    );
    const apercu = () => db.query(
      `insert into public.avatar_generations (user_id, user_avatar_id, script, status, credits_charged, intention, avatar_version, provider, voice_id) values ($1, $2, 'x', 'pending', 0, 'apercu', 1, 'did', 'jumeau:v')`, [u, a.id],
    );
    await apercu();
    await expect(apercu()).rejects.toMatchObject({ code: '23505' });
    const { rows } = await db.query("select indexname from pg_indexes where schemaname = 'public' and indexname in ('avatar_generations_apercu_unique', 'avatar_generations_jumeau_en_vol_uidx', 'user_avatars_one_active_per_user_uidx') order by 1");
    expect(rows.map((r) => r.indexname)).toEqual(['avatar_generations_apercu_unique', 'avatar_generations_jumeau_en_vol_uidx', 'user_avatars_one_active_per_user_uidx']);
  });
});

describe('2. Le prévol s’arrête sur une valeur de fournisseur inconnue — sans rien corriger', () => {
  beforeEach(async () => { await baseActuelle(); });

  it('⚠️ une ligne provider=autre → la migration échoue, la ligne est intacte, aucune colonne ajoutée', async () => {
    const u = await creerUtilisateur(db, 100);
    await db.query(
      `insert into public.user_avatars (user_id, provider, provider_avatar_id, status, consent_at, consent_text, version) values ($1, 'autre', 'x', 'completed', now(), 'x', 1)`, [u],
    );
    await expect(appliquerMigration(db, MIGRATION)).rejects.toThrow(/valeur inconnue/);
    expect((await db.query('select provider from public.user_avatars where user_id = $1', [u])).rows[0].provider).toBe('autre');
    expect(await colonne('user_avatars', 'provider_consent_id')).toBeUndefined();
  });

  it('sans la fondation 1A → refus explicite', async () => {
    await preparerBase(db);
    await appliquerMigration(db, AVATAR_BASE[0]);
    await expect(appliquerMigration(db, MIGRATION)).rejects.toThrow(/version absente/);
  });
});
