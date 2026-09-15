/**
 * USER_SETTINGS — la table que le code lit depuis toujours, sur un VRAI
 * PostgreSQL.
 *
 * Ce que seule la base peut prouver :
 *   1. la migration s'applique sur une base SANS `user_settings`, et se rejoue ;
 *   2. une ligne par compte (PK `user_id`), FK vers `users` avec cascade ;
 *   3. les défauts JSONB : une ligne insérée avec le seul `user_id` est saine ;
 *   4. les requêtes RÉELLEMENT faites par `lib/voice/profil.ts`,
 *      `/api/user/preferences` et `/api/social/settings` fonctionnent sur ce
 *      schéma — modules réels, transport SQL (voir `supabase-sql.ts`) ;
 *   5. le scénario qui bloquait : un compte avec une voix ElevenLabs et
 *      AUCUNE ligne `user_settings` lit un profil vide sain, sans 500, et
 *      `resoudreJumeauDuCompte` résout le jumeau (une seule voix utilisable →
 *      elle, sans choix enregistré : le resolver est inchangé) ;
 *   6. aucune autre table ni donnée n'est touchée par la migration.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { join } from 'node:path';
import type { Client } from 'pg';
import { NextRequest } from 'next/server';
import { connecter, preparerBase, appliquerMigration, creerUtilisateur, RACINE } from './harness';
import { clientSql, ouvrirPool, fermerPool } from './supabase-sql';

vi.mock('@/lib/db/supabase', () => clientSql());
const session = vi.hoisted(() => ({ courante: null as null | { user: { id: string; email?: string } } }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

const { lireProfilVoix, choisirVoix, enregistrerPrononciations, resoudreVoixDuCompte } = await import('@/lib/voice/profil');
const { resoudreJumeauDuCompte } = await import('@/lib/avatar/jumeau');
const preferences = await import('@/app/api/user/preferences/route');
const social = await import('@/app/api/social/settings/route');

const MIGRATIONS_PREALABLES = [
  join(RACINE, 'migrations/2026-07-28-user-avatars.sql'),
  join(RACINE, 'migrations/2026-07-28-avatar-type.sql'),
  join(RACINE, 'migrations/2026-08-04-user-voices.sql'),
  join(RACINE, 'migrations/2026-09-15-avatar-schema-foundation.sql'),
];
const MIGRATION = join(RACINE, 'migrations/2026-09-15-user-settings.sql');

let db: Client;
beforeAll(async () => { db = await connecter(); ouvrirPool(); });
afterAll(async () => { await fermerPool(); if (db) await db.end(); });

/** La base de production telle qu'elle est : socle + avatar + voix, SANS user_settings. */
async function baseSansUserSettings() {
  await preparerBase(db);
  for (const m of MIGRATIONS_PREALABLES) await appliquerMigration(db, m);
}
const tables = async () => (await db.query<{ t: string }>("select table_name as t from information_schema.tables where table_schema = 'public' order by 1")).rows.map((r) => r.t);
const comptes = async () => (await db.query<{ u: string; v: string }>('select (select count(*) from public.users) as u, (select count(*) from public.user_voices) as v')).rows[0];

async function compteAvecVoix(): Promise<{ userId: string; voixId: string }> {
  const userId = await creerUtilisateur(db, 100);
  const { rows: [v] } = await db.query<{ id: string }>(
    `insert into public.user_voices (user_id, provider, provider_voice_id, name, lang, consent_at, consent_text)
     values ($1, 'elevenlabs', $2, 'Bassi', 'fr', now(), 'x') returning id`,
    [userId, `pvid_${userId.slice(0, 8)}`],
  );
  return { userId, voixId: v.id };
}
const requete = (url: string, corps?: unknown) => new NextRequest(`https://studiio.pro${url}`, corps === undefined
  ? { method: 'GET' }
  : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });
const ligne = async (userId: string) => (await db.query('select * from public.user_settings where user_id = $1', [userId])).rows[0];

describe('1. La migration', () => {
  it('⚠️ base sans user_settings → succès ; second passage → succès ; seule cette table apparaît, aucune donnée touchée', async () => {
    await baseSansUserSettings();
    expect(await tables()).not.toContain('user_settings');
    await compteAvecVoix();
    const avant = { tables: await tables(), comptes: await comptes() };
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    const apres = { tables: await tables(), comptes: await comptes() };
    expect(apres.tables.filter((t) => !avant.tables.includes(t))).toEqual(['user_settings']);
    expect(apres.comptes).toEqual(avant.comptes);
  });

  it('colonnes, types, nullabilité, défauts — exactement ce que le code écrit et lit', async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'user_settings' order by ordinal_position",
    );
    expect(rows.map((r) => r.column_name)).toEqual(['user_id', 'creator_preferences', 'social_settings', 'updated_at']);
    expect(rows[0]).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(rows[1]).toMatchObject({ data_type: 'jsonb', is_nullable: 'NO', column_default: "'{}'::jsonb" });
    expect(rows[2]).toMatchObject({ data_type: 'jsonb', is_nullable: 'NO', column_default: "'{}'::jsonb" });
    expect(rows[3]).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' });
    const { rows: [pk] } = await db.query<{ d: string }>("select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.user_settings'::regclass and contype = 'p'");
    expect(pk.d).toBe('PRIMARY KEY (user_id)');
    const { rows: [fk] } = await db.query<{ d: string }>("select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.user_settings'::regclass and contype = 'f'");
    expect(fk.d).toBe('FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
  });

  it('⚠️ une ligne par compte (23505), FK (23503), cascade à la suppression du compte, défauts JSONB', async () => {
    const { userId } = await compteAvecVoix();
    await db.query('insert into public.user_settings (user_id) values ($1)', [userId]);
    await expect(db.query('insert into public.user_settings (user_id) values ($1)', [userId])).rejects.toMatchObject({ code: '23505' });
    await expect(db.query('insert into public.user_settings (user_id) values (gen_random_uuid())')).rejects.toMatchObject({ code: '23503' });
    const l = await ligne(userId);
    expect(l.creator_preferences).toEqual({});
    expect(l.social_settings).toEqual({});
    expect(l.updated_at).toBeTruthy();
    await db.query('delete from public.users where id = $1', [userId]);
    expect(await ligne(userId)).toBeUndefined();
  });
});

describe('2. Les modules réels sur ce schéma', () => {
  beforeEach(() => { session.courante = null; });

  it('⚠️ LE SCÉNARIO BLOQUANT : voix ElevenLabs, aucune ligne user_settings → profil vide sain, voix résolue, jumeau résolu ; pas de 500', async () => {
    const { userId, voixId } = await compteAvecVoix();
    expect(await ligne(userId)).toBeUndefined();
    const profil = await lireProfilVoix(userId);
    expect(profil.ok).toBe(true);
    if (!profil.ok) return;
    expect(profil.profil.choix).toBeNull();
    expect(profil.profil.prononciations).toEqual([]);
    // Une seule voix utilisable, aucun choix : elle parle — la règle du resolver, inchangée.
    expect(profil.profil.resolution).toMatchObject({ ok: true, voix: { id: voixId, fournisseur: 'elevenlabs', utilisable: true } });
    const voix = await resoudreVoixDuCompte(userId);
    expect(voix.ok && voix.voix.id).toBe(voixId);
    expect(voix.ok && voix.prononciations).toEqual([]);
    // Aucune ligne n'a été créée par une simple lecture.
    expect(await ligne(userId)).toBeUndefined();

    // Avec un avatar validé, le jumeau se résout — c'est ce que /api/creer/jumeau demande.
    await db.query(
      `insert into public.user_avatars (user_id, provider_avatar_id, status, consent_at, consent_text, avatar_type, subject_type, validated_at, version)
       values ($1, 'hg-1', 'completed', now(), 'x', 'photo', 'self', now(), 1)`, [userId],
    );
    const jumeau = await resoudreJumeauDuCompte(userId);
    expect(jumeau.ok, JSON.stringify(jumeau)).toBe(true);
    if (!jumeau.ok) return;
    expect(jumeau.jumeau.voix.id).toBe(voixId);
    expect(jumeau.jumeau.prononciations).toBe(0);
    expect(jumeau.prive.prononciations).toEqual([]);

    // Les deux routes historiques, sans ligne : 200, état vide, jamais 500.
    session.courante = { user: { id: userId } };
    const p = await preferences.GET(requete('/api/user/preferences'));
    expect(p.status).toBe(200);
    expect(await p.json()).toEqual({ success: true, preferences: null });
    const s = await social.GET(requete('/api/social/settings'));
    expect(s.status).toBe(200);
    expect(await s.json()).toEqual({ success: true, settings: null });
  });

  it('⚠️ profil voix : choisir la voix, enregistrer des prononciations — relus tels quels, dans creator_preferences.voixPersonnelle', async () => {
    const { userId, voixId } = await compteAvecVoix();
    const choix = await choisirVoix(userId, voixId);
    expect(choix.ok && choix.profil.choix).toBe(voixId);
    const pron = await enregistrerPrononciations(userId, [{ affiche: 'Afroboost', prononce: 'Afro-boust' }]);
    expect(pron.ok && pron.profil.prononciations).toEqual([{ affiche: 'Afroboost', prononce: 'Afro-boust' }]);
    const l = await ligne(userId);
    expect(l.creator_preferences).toEqual({ voixPersonnelle: { userVoiceId: voixId, prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }] } });
    const voix = await resoudreVoixDuCompte(userId);
    expect(voix.ok && voix.prononciations).toEqual([{ affiche: 'Afroboost', prononce: 'Afro-boust' }]);
    // Effacer le choix : `null` → la voix unique parle toujours.
    const efface = await choisirVoix(userId, null);
    expect(efface.ok && efface.profil.choix).toBeNull();
    expect(efface.ok && efface.profil.resolution.ok).toBe(true);
  });

  it('⚠️ /api/user/preferences : POST crée la ligne, GET la relit, un second POST FUSIONNE sans écraser voixPersonnelle', async () => {
    const { userId, voixId } = await compteAvecVoix();
    session.courante = { user: { id: userId } };
    expect((await preferences.POST(requete('/api/user/preferences', { accentColor: '#7C3AED', musicVolume: 0.4 }))).status).toBe(200);
    const g1 = await (await preferences.GET(requete('/api/user/preferences'))).json();
    expect(g1).toEqual({ success: true, preferences: { accentColor: '#7C3AED', musicVolume: 0.4 } });
    // La voix personnelle écrit SA clé ; les préférences créateur restent.
    await choisirVoix(userId, voixId);
    expect((await preferences.POST(requete('/api/user/preferences', { musicVolume: 0.7 }))).status).toBe(200);
    const g2 = await (await preferences.GET(requete('/api/user/preferences'))).json();
    expect(g2.preferences).toEqual({ accentColor: '#7C3AED', musicVolume: 0.7, voixPersonnelle: { userVoiceId: voixId, prononciations: [] } });
    const voix = await resoudreVoixDuCompte(userId);
    expect(voix.ok && voix.voix.id).toBe(voixId);
    // Toujours une seule ligne.
    expect((await db.query('select count(*)::int as n from public.user_settings where user_id = $1', [userId])).rows[0].n).toBe(1);
  });

  it('/api/social/settings : POST upsert, GET relit ; ne touche pas creator_preferences', async () => {
    const { userId } = await compteAvecVoix();
    session.courante = { user: { id: userId } };
    expect((await social.POST(requete('/api/social/settings', { autoPublish: true, platforms: ['instagram'] }))).status).toBe(200);
    expect(await (await social.GET(requete('/api/social/settings'))).json()).toEqual({ success: true, settings: { autoPublish: true, platforms: ['instagram'] } });
    expect((await social.POST(requete('/api/social/settings', { autoPublish: false }))).status).toBe(200);
    expect(await (await social.GET(requete('/api/social/settings'))).json()).toEqual({ success: true, settings: { autoPublish: false } });
    const l = await ligne(userId);
    expect(l.creator_preferences).toEqual({});
    expect((await db.query('select count(*)::int as n from public.user_settings where user_id = $1', [userId])).rows[0].n).toBe(1);
  });

  it('sans session, les deux routes répondent 401 sans toucher la base', async () => {
    const avant = (await db.query('select count(*)::int as n from public.user_settings')).rows[0].n;
    expect((await preferences.GET(requete('/api/user/preferences'))).status).toBe(401);
    expect((await preferences.POST(requete('/api/user/preferences', { a: 1 }))).status).toBe(401);
    expect((await social.GET(requete('/api/social/settings'))).status).toBe(401);
    expect((await social.POST(requete('/api/social/settings', { a: 1 }))).status).toBe(401);
    expect((await db.query('select count(*)::int as n from public.user_settings')).rows[0].n).toBe(avant);
  });
});
