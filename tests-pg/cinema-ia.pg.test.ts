/**
 * CINEMA IA — LE STOCKAGE DURABLE, sur un VRAI PostgreSQL derriere un VRAI
 * PostgREST, avec les VRAIS depots TypeScript.
 *
 * Ce que seule la base prouve :
 *   1. la migration s'applique apres le modele de moindre privilege (#533),
 *      se rejoue, et se defait ;
 *   2. `web_anon` ne voit RIEN ; `service_role` (le backend) fait tout ;
 *      les fonctions SECURITY DEFINER ont un `search_path` fige ;
 *   3. UN SEUL travail actif par film, meme sous N creations simultanees ;
 *   4. UN SEUL gagnant a la prise d'un travail, un bail expire se reprend,
 *      un jeton perime est refuse, la limite de prises est tenue ;
 *   5. une ecriture de film sur une version perimee est un conflit — sous
 *      concurrence, une seule passe ;
 *   6. un film d'autrui est introuvable ;
 *   7. de bout en bout : l'executeur produit un film dont l'etat vit en base
 *      et survit a une « mort » du processus.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Client } from 'pg';
import { PostgrestClient } from '@supabase/postgrest-js';
import { connecter, preparerBase, appliquerMigration, creerUtilisateur, urlBase, RACINE } from './harness';
import { depotFilmsPostgres, modifierFilm } from '../src/lib/cinema/stockage/depot-films';
import { depotTravauxPostgres } from '../src/lib/cinema/travaux/depot-travaux';
import { objetsMemoire } from '../src/lib/cinema/stockage/objets';
import { executerTravail, type MoteursProduction } from '../src/lib/cinema/travaux/executeur';
import { BAIL_S, TENTATIVES_MAX, cleTravail } from '../src/lib/cinema/travaux/types';
import { preparerFilm } from '../src/lib/cinema/atelier';
import { scenesAReproduire } from '../src/lib/cinema/empreinte';
import { appliquerPatch } from '../src/lib/cinema/patch';

const m = (f: string) => join(RACINE, 'migrations', f);
const MOINDRE = m('2026-09-29-postgrest-moindre-privilege.sql');
const MOINDRE_ROLLBACK = m('2026-09-29-postgrest-moindre-privilege.rollback.sql');
const CINEMA = m('2026-10-27-cinema-ia.sql');
const CINEMA_ROLLBACK = m('rollback/2026-10-27-cinema-ia.rollback.sql');

const BIN = process.env.POSTGREST_BIN || 'postgrest';
const BINAIRE_PRESENT = spawnSync(BIN, ['--version']).status === 0;
if (process.env.CI && !BINAIRE_PRESENT) throw new Error(`PostgREST introuvable (${BIN}) : l'etape d'installation de la CI a echoue.`);

const SECRET = 'secret-jwt-de-test-seulement-32-caracteres-min';
const MDP = 'authenticator-cinema-test-seulement';
const PORT = 3970 + Math.floor(Math.random() * 5) * 2;
const URL_API = `http://127.0.0.1:${PORT}`;

function jwt(role: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const corps = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role })}`;
  return `${corps}.${createHmac('sha256', SECRET).update(corps).digest('base64url')}`;
}
const clientRole = (role: string) => new PostgrestClient(URL_API, { headers: { apikey: jwt(role), Authorization: `Bearer ${jwt(role)}` } });

let serveur: ChildProcess | null = null;
async function demarrer(): Promise<void> {
  const u = new URL(urlBase()); u.username = 'authenticator'; u.password = MDP;
  serveur = spawn(BIN, [], {
    env: { ...process.env, PGRST_DB_URI: u.toString(), PGRST_DB_ANON_ROLE: 'web_anon', PGRST_DB_SCHEMAS: 'public', PGRST_JWT_SECRET: SECRET,
      PGRST_SERVER_PORT: String(PORT), PGRST_ADMIN_SERVER_PORT: String(PORT + 1), PGRST_DB_POOL: '6', PGRST_LOG_LEVEL: 'crit' },
    stdio: 'ignore',
  });
  const limite = Date.now() + 20_000;
  while (Date.now() < limite) {
    try { if ((await fetch(`http://127.0.0.1:${PORT + 1}/ready`)).status === 200) return; } catch { /* pas pret */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('PostgREST ne demarre pas');
}
async function arreter(): Promise<void> {
  if (!serveur) return;
  const s = serveur; serveur = null;
  await new Promise<void>((resolve) => { s.once('exit', () => resolve()); s.kill('SIGTERM'); setTimeout(resolve, 3000); });
}

const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Marco hoche la tete. Le jour se leve sur la salle vide.';
const unFilm = (id: string) => preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }], idFilm: id, maintenant: () => new Date('2026-10-26T09:00:00Z') });
// Le serveur de test peut parler francais : on accepte les deux langues.
const REFUS = /permission denied|not allowed|droit refus/i;
const FOREIGN_KEY = /foreign key|cl[ée]\s+[ée]trang/i;
const CHECK = /check|contrainte/i;
/** N appels simultanes au meme PostgREST (pool de connexions reel). */
const enConcurrence = <T,>(n: number, f: (i: number) => Promise<T>): Promise<T[]> => Promise.all(Array.from({ length: n }, (_, i) => f(i)));

let db: Client;
let A: string;
let B: string;
const base = () => clientRole('service_role') as never;
const films = depotFilmsPostgres(base);
const travaux = depotTravauxPostgres(base);

const describeSiBinaire = BINAIRE_PRESENT ? describe : describe.skip;

describeSiBinaire('Cinema IA — PostgreSQL + PostgREST reels', () => {
  beforeAll(async () => {
    db = await connecter();
    await db.query('drop schema if exists public cascade; create schema public;');
    await appliquerMigration(db, MOINDRE_ROLLBACK);
    await preparerBase(db);
    await db.query('grant usage on schema public to public');
    await appliquerMigration(db, MOINDRE);
    await appliquerMigration(db, CINEMA);
    A = await creerUtilisateur(db, 100);
    B = await creerUtilisateur(db, 100);
    await db.query(`alter role authenticator login password '${MDP}'`);
    await demarrer();
  }, 90_000);

  afterAll(async () => {
    await arreter();
    if (!db) return;
    await db.query("do $$ begin if exists (select 1 from pg_roles where rolname = 'authenticator') then alter role authenticator nologin password null; end if; end $$").catch(() => undefined);
    await appliquerMigration(db, CINEMA_ROLLBACK).catch(() => undefined);
    await appliquerMigration(db, MOINDRE_ROLLBACK).catch(() => undefined);
    await db.query(`do $$ declare r text; begin
      foreach r in array array['anon','authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then execute format('drop owned by %I', r); execute format('drop role %I', r); end if;
      end loop; end $$`).catch(() => undefined);
    await db.query('drop schema if exists public cascade; create schema public; grant usage on schema public to public;');
    await db.end();
  }, 60_000);

  describe('migration et droits', () => {
    it('se rejoue sans erreur, et se defait puis se refait', async () => {
      await expect(appliquerMigration(db, CINEMA)).resolves.not.toThrow();
      await appliquerMigration(db, CINEMA_ROLLBACK);
      expect((await db.query("select to_regclass('public.cinema_films') as t")).rows[0].t).toBeNull();
      await appliquerMigration(db, CINEMA);
      await arreter(); await demarrer();   // schema recharge : le cache de PostgREST est reparti de zero
    }, 60_000);

    it('⚠️ fonctions SECURITY DEFINER : search_path fige, fermees a PUBLIC et web_anon, ouvertes a service_role', async () => {
      const { rows } = await db.query(`
        select p.proname, p.prosecdef as secdef,
          exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as sp,
          has_function_privilege('web_anon', p.oid, 'EXECUTE') as anon,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
          exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as public
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'cinema_travail_%' order by 1`);
      expect(rows).toEqual([
        { proname: 'cinema_travail_creer', secdef: true, sp: true, anon: false, svc: true, public: false },
        { proname: 'cinema_travail_reclamer', secdef: true, sp: true, anon: false, svc: true, public: false },
      ]);
    });

    it('⚠️ web_anon ne lit ni n\'ecrit les tables ; service_role a le DML', async () => {
      const commeRole = async <T>(role: string, f: () => Promise<T>) => { await db.query('begin'); try { await db.query(`set local role ${role}`); return await f(); } finally { await db.query('rollback'); } };
      await expect(commeRole('web_anon', () => db.query('select * from public.cinema_films'))).rejects.toThrow(REFUS);
      await expect(commeRole('web_anon', () => db.query('select * from public.cinema_travaux'))).rejects.toThrow(REFUS);
      const { rows } = await db.query(`select
        has_table_privilege('service_role', 'public.cinema_films', 'SELECT,INSERT,UPDATE,DELETE') as f,
        has_table_privilege('service_role', 'public.cinema_travaux', 'SELECT,INSERT,UPDATE,DELETE') as t,
        has_table_privilege('web_anon', 'public.cinema_films', 'SELECT') as fa`);
      expect(rows[0]).toEqual({ f: true, t: true, fa: false });
    });

    it('⚠️ par HTTP : sans jeton, rien (401) ; un jeton web_anon, rien non plus', async () => {
      expect((await fetch(`${URL_API}/cinema_films?select=id`)).status).toBe(401);
      const anon = await fetch(`${URL_API}/cinema_travaux?select=id`, { headers: { Authorization: `Bearer ${jwt('web_anon')}` } });
      expect([401, 403]).toContain(anon.status);
      const rpc = await fetch(`${URL_API}/rpc/cinema_travail_creer`, { method: 'POST', headers: { Authorization: `Bearer ${jwt('web_anon')}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_film_id: 'film-x', p_proprietaire: A, p_cle: 'c', p_scenes: [], p_progression: {}, p_max_actifs: 2 }) });
      expect([401, 403]).toContain(rpc.status);
    });

    it('les contraintes de la base refusent un identifiant de film hors forme et un film non-objet', async () => {
      await expect(db.query("insert into public.cinema_films (id, proprietaire, film) values ('../evasion', $1, '{}')", [A])).rejects.toThrow(CHECK);
      await expect(db.query("insert into public.cinema_films (id, proprietaire, film) values ('film-ok', $1, '[]')", [A])).rejects.toThrow(CHECK);
      await expect(db.query("insert into public.cinema_films (id, proprietaire, film) values ('film-ok', $1, '{}')", ['00000000-0000-0000-0000-000000000000'])).rejects.toThrow(FOREIGN_KEY);
    });
  });

  describe('films', () => {
    it('cree, relit, liste — isole par compte', async () => {
      const f = unFilm('film-pg-1');
      expect(await films.creer(f, A)).toEqual({ ok: true, version: 1 });
      expect(await films.creer(f, A)).toEqual({ ok: false, raison: 'existe' });
      expect(await films.creer(f, B)).toEqual({ ok: false, raison: 'existe' });
      const lu = (await films.lire('film-pg-1', A))!;
      expect(lu.film.scenes.length).toBe(f.scenes.length);
      expect(lu.film.proprietaire).toBe(A);
      expect(await films.lire('film-pg-1', B)).toBeNull();
      expect(await films.lire('../../etc/passwd', A)).toBeNull();
      expect((await films.lister(A)).map((x) => x.id)).toEqual(['film-pg-1']);
      expect(await films.lister(B)).toEqual([]);
    });

    it('le proprietaire de la ligne vient de l\'appelant, jamais du contenu du film', async () => {
      await films.creer({ ...unFilm('film-pg-2'), proprietaire: B }, A);
      expect(await films.lire('film-pg-2', B)).toBeNull();
      expect((await films.lire('film-pg-2', A))!.film.proprietaire).toBe(A);
      expect((await db.query("select proprietaire from public.cinema_films where id = 'film-pg-2'")).rows[0].proprietaire).toBe(A);
    });

    it('⚠️ conflit de version : N ecritures simultanees sur la meme version, UNE seule passe', async () => {
      await films.creer(unFilm('film-pg-3'), A);
      const lu = (await films.lire('film-pg-3', A))!;
      const r = await enConcurrence(8, (i) => films.remplacer({ ...lu.film, titre: `concurrent ${i}` }, A, lu.version));
      expect(r.filter((x) => x.ok)).toHaveLength(1);
      expect(r.filter((x) => !x.ok).every((x) => !x.ok && x.raison === 'conflit')).toBe(true);
      expect((await films.lire('film-pg-3', A))!.version).toBe(2);
      expect(await films.remplacer(lu.film, B, 2)).toEqual({ ok: false, raison: 'absent' });
    });

    it('modifierFilm rejoue sous concurrence : aucune modification perdue', async () => {
      await films.creer({ ...unFilm('film-pg-4'), histoire: '' }, A);
      await Promise.all(Array.from({ length: 6 }, (_, i) => modifierFilm(films, 'film-pg-4', A, (f) => ({ ...f, histoire: `${f.histoire}[${i}]` }), 20)));
      const h = (await films.lire('film-pg-4', A))!.film.histoire;
      for (let i = 0; i < 6; i++) expect(h).toContain(`[${i}]`);
      expect((await films.lire('film-pg-4', A))!.version).toBe(7);
    });

    it('un film disparait avec son compte (cascade)', async () => {
      const C = await creerUtilisateur(db, 1);
      await films.creer(unFilm('film-pg-cascade'), C);
      await db.query('delete from public.users where id = $1', [C]);
      expect((await db.query("select count(*)::int as n from public.cinema_films where id = 'film-pg-cascade'")).rows[0].n).toBe(0);
    });

    it('⚠️ supprimer : seulement le film du compte ; un autre compte ou un id hors forme ne supprime rien', async () => {
      await films.creer(unFilm('film-pg-suppr'), A);
      expect(await films.supprimer('film-pg-suppr', B)).toBe(false);
      expect(await films.supprimer('../film-pg-suppr', A)).toBe(false);
      expect(await films.supprimer('film-pg-inexistant', A)).toBe(false);
      expect(await films.lire('film-pg-suppr', A)).not.toBeNull();
      expect(await films.supprimer('film-pg-suppr', A)).toBe(true);
      expect(await films.lire('film-pg-suppr', A)).toBeNull();
      expect(await films.supprimer('film-pg-suppr', A)).toBe(false);
    });

    it('supprimer emporte les travaux du film (cascade), oublierDuFilm garde les travaux actifs', async () => {
      await db.query("update public.cinema_travaux set statut = 'annule', bail_jusqua = null where proprietaire = $1 and statut in ('en_attente', 'en_cours')", [A]);
      await films.creer(unFilm('film-pg-suppr2'), A);
      const dem = { film: unFilm('film-pg-suppr2'), proprietaire: A, cle: 'cle', scenesDemandees: [] as string[], maxActifs: 2 };
      const t1 = (await travaux.creerOuRetrouver(dem)).travail!;
      await travaux.oublierDuFilm('film-pg-suppr2', A);                       // actif : conserve
      expect(await travaux.lire(t1.id, A)).not.toBeNull();
      const p = (await travaux.reclamer(t1.id, BAIL_S))!;
      await travaux.annuler(t1.id, p.tentatives);
      await travaux.oublierDuFilm('film-pg-suppr2', B);                       // autre compte : rien
      expect(await travaux.lire(t1.id, A)).not.toBeNull();
      await travaux.oublierDuFilm('film-pg-suppr2', A);                       // termine : oublie
      expect(await travaux.lire(t1.id, A)).toBeNull();

      const t2 = (await travaux.creerOuRetrouver(dem)).travail!;
      expect(await films.supprimer('film-pg-suppr2', A)).toBe(true);
      expect((await db.query('select count(*)::int as n from public.cinema_travaux where id = $1', [t2.id])).rows[0].n).toBe(0);
    });

    it('supprimerFilm de bout en bout : base reelle + objets fictifs, un travail actif refuse', async () => {
      const { supprimerFilm } = await import('../src/lib/cinema/stockage/suppression');
      const { cleScene } = await import('../src/lib/cinema/stockage/cles');
      const objets = objetsMemoire();
      await db.query("update public.cinema_travaux set statut = 'annule', bail_jusqua = null where proprietaire = $1 and statut in ('en_attente', 'en_cours')", [A]);
      await films.creer(unFilm('film-pg-suppr3'), A);
      const mienne = cleScene(A, 'film-pg-suppr3', 's1', 'aaaaaaaa')!;
      const autre = cleScene(B, 'film-pg-suppr3', 's1', 'aaaaaaaa')!;
      for (const k of [mienne, autre]) await objets.deposerOctets(k, new Uint8Array([1]), 'video/mp4');
      const t = (await travaux.creerOuRetrouver({ film: unFilm('film-pg-suppr3'), proprietaire: A, cle: 'cle', scenesDemandees: [], maxActifs: 2 })).travail!;
      expect(await supprimerFilm({ films, travaux, objets }, A, 'film-pg-suppr3')).toEqual({ ok: false, motif: 'travail_en_cours' });
      expect(await supprimerFilm({ films, travaux, objets }, B, 'film-pg-suppr3')).toEqual({ ok: false, motif: 'inconnu' });
      await travaux.demanderAnnulation(t.id, A);
      expect(await supprimerFilm({ films, travaux, objets }, A, 'film-pg-suppr3')).toEqual({ ok: true, objetsSupprimes: 1, objetsIgnores: 0 });
      expect(objets.contenu(mienne)).toBeUndefined();
      expect(objets.contenu(autre)).toBeDefined();
      expect(await films.lire('film-pg-suppr3', A)).toBeNull();
    });
  });

  describe('travaux', () => {
    /** Libere le compte : les tests suivants ne butent pas sur le plafond de travaux actifs. */
    const liberer = (u: string) => db.query("update public.cinema_travaux set statut = 'annule', bail_jusqua = null where proprietaire = $1 and statut in ('en_attente', 'en_cours')", [u]);
    const demande = (filmId: string, proprietaire: string, max = 2) => ({
      film: unFilm(filmId), proprietaire, cle: 'cle', scenesDemandees: [] as string[], maxActifs: max,
    });

    it('⚠️ UN SEUL travail actif par film, meme sous 8 creations simultanees', async () => {
      await films.creer(unFilm('film-pg-t1'), A);
      const r = await enConcurrence(8, () => travaux.creerOuRetrouver(demande('film-pg-t1', A)));
      expect(r.filter((x) => x.cree)).toHaveLength(1);
      expect(new Set(r.map((x) => x.travail!.id)).size).toBe(1);
      expect((await db.query("select count(*)::int as n from public.cinema_travaux where film_id = 'film-pg-t1'")).rows[0].n).toBe(1);
      expect(r[0].travail!.progression.scenes).toBeTruthy();
    });

    it('l\'index unique partiel refuse un second actif meme en insertion directe', async () => {
      await expect(db.query("insert into public.cinema_travaux (film_id, proprietaire, cle) values ('film-pg-t1', $1, 'x')", [A])).rejects.toThrow(/unique|duplicate|doublon/i);
    });

    it('film d\'un autre compte : film_absent ; film inconnu : film_absent', async () => {
      expect(await travaux.creerOuRetrouver(demande('film-pg-t1', B))).toMatchObject({ cree: false, motif: 'film_absent', travail: null });
      expect(await travaux.creerOuRetrouver(demande('film-fantome', A))).toMatchObject({ motif: 'film_absent' });
    });

    it('⚠️ plafond de travaux actifs par compte, tenu sous concurrence', async () => {
      const D = await creerUtilisateur(db, 1);
      for (let i = 0; i < 5; i++) await films.creer(unFilm(`film-pg-plafond-${i}`), D);
      const r = await enConcurrence(5, (i) => travaux.creerOuRetrouver(demande(`film-pg-plafond-${i}`, D, 2)));
      expect(r.filter((x) => x.cree)).toHaveLength(2);
      expect(r.filter((x) => x.motif === 'trop_de_travaux')).toHaveLength(3);
    });

    it('un plafond hors bornes est refuse par la base', async () => {
      await expect(travaux.creerOuRetrouver(demande('film-pg-t1', A, 0))).rejects.toThrow(/plafond/);
      await expect(travaux.creerOuRetrouver(demande('film-pg-t1', A, 21))).rejects.toThrow(/plafond/);
    });

    it('⚠️ prise : N executeurs en meme temps, UN seul gagnant', async () => {
      await films.creer(unFilm('film-pg-t2'), A);
      const t = (await travaux.creerOuRetrouver(demande('film-pg-t2', A))).travail!;
      const r = await enConcurrence(8, () => travaux.reclamer(t.id, BAIL_S));
      expect(r.filter(Boolean)).toHaveLength(1);
      expect(r.find(Boolean)!.tentatives).toBe(1);
      expect(r.find(Boolean)!.statut).toBe('en_cours');
    });

    it('bail vivant protege, bail expire se reprend, jeton perime refuse', async () => {
      await liberer(A);
      await films.creer(unFilm('film-pg-t3'), A);
      const t = (await travaux.creerOuRetrouver(demande('film-pg-t3', A))).travail!;
      const p1 = (await travaux.reclamer(t.id, BAIL_S))!;
      expect(await travaux.reclamer(t.id, BAIL_S)).toBeNull();
      expect((await travaux.noter(t.id, p1.tentatives, { ...p1.progression, etape: 'voix' }, BAIL_S)).perdu).toBe(false);
      expect((await travaux.lire(t.id, A))!.progression.etape).toBe('voix');

      await db.query("update public.cinema_travaux set bail_jusqua = now() - interval '1 minute' where id = $1", [t.id]);
      expect((await travaux.aReprendre()).map((x) => x.id)).toContain(t.id);
      const p2 = (await travaux.reclamer(t.id, BAIL_S))!;
      expect(p2.tentatives).toBe(2);
      // L'executeur 1 est perime : tout ce qu'il tente est refuse.
      expect((await travaux.noter(t.id, p1.tentatives, p1.progression, BAIL_S)).perdu).toBe(true);
      expect(await travaux.echouer(t.id, p1.tentatives, 'x', null)).toBe(false);
      expect(await travaux.terminer(t.id, p1.tentatives, {} as never, p1.progression)).toBe(false);
      expect(await travaux.terminer(t.id, p2.tentatives, { cleMp4: null } as never, p2.progression)).toBe(true);
      expect((await travaux.lire(t.id, A))!.statut).toBe('termine');
      expect((await travaux.aReprendre()).map((x) => x.id)).not.toContain(t.id);
    });

    it('au-dela de la limite de prises : echec, pas de boucle', async () => {
      await liberer(A);
      await films.creer(unFilm('film-pg-t4'), A);
      const t = (await travaux.creerOuRetrouver(demande('film-pg-t4', A))).travail!;
      for (let i = 0; i < TENTATIVES_MAX; i++) {
        expect(await travaux.reclamer(t.id, BAIL_S)).not.toBeNull();
        await db.query("update public.cinema_travaux set bail_jusqua = now() - interval '1 minute' where id = $1", [t.id]);
      }
      expect(await travaux.reclamer(t.id, BAIL_S)).toBeNull();
      const fin = (await travaux.lire(t.id, A))!;
      expect(fin.statut).toBe('echec');
      expect(fin.erreur).toMatch(/tentatives/);
      await expect(db.query('update public.cinema_travaux set tentatives = 6 where id = $1', [t.id])).rejects.toThrow(CHECK);
    });

    it('annulation : immediate en attente, par drapeau en cours ; un autre compte ne peut pas', async () => {
      await liberer(A);
      await films.creer(unFilm('film-pg-t5'), A);
      const t = (await travaux.creerOuRetrouver(demande('film-pg-t5', A))).travail!;
      expect(await travaux.demanderAnnulation(t.id, B)).toBeNull();
      const p = (await travaux.reclamer(t.id, BAIL_S))!;
      expect((await travaux.demanderAnnulation(t.id, A))!.annulationDemandee).toBe(true);
      expect((await travaux.noter(t.id, p.tentatives, p.progression, BAIL_S)).annulation).toBe(true);
      expect(await travaux.annuler(t.id, p.tentatives)).toBe(true);

      await films.creer(unFilm('film-pg-t6'), A);
      const t2 = (await travaux.creerOuRetrouver(demande('film-pg-t6', A))).travail!;
      expect((await travaux.demanderAnnulation(t2.id, A))!.statut).toBe('annule');
      // Le film est de nouveau libre : un nouveau travail peut etre cree.
      expect((await travaux.creerOuRetrouver(demande('film-pg-t6', A))).cree).toBe(true);
    });

    it('un travail n\'est lisible que par son proprietaire', async () => {
      const t = (await travaux.dernierDuFilm('film-pg-t1', A))!;
      expect(await travaux.lire(t.id, A)).not.toBeNull();
      expect(await travaux.lire(t.id, B)).toBeNull();
      expect(await travaux.dernierDuFilm('film-pg-t1', B)).toBeNull();
    });
  });

  describe('de bout en bout — executeur sur les vrais depots', () => {
    it('produit, relance sans rien refaire, ne refait que la scene modifiee, et reprend apres une « mort »', async () => {
      const racine = await mkdtemp(join(tmpdir(), 'cinema-pg-'));
      try {
        const objets = objetsMemoire();
        const rendus: string[] = [];
        let crash = false;
        const controle = async (fichier: string) => ({ fichier, octets: (await stat(fichier)).size, dureeS: 9, largeur: 1920, hauteur: 1080, codecVideo: 'h264', codecAudio: 'aac' });
        const moteurs: MoteursProduction = {
          synthetiser: async () => ({ voix: {}, details: [], echecs: [], moteur: 'edge', motifRepli: null }),
          mesurerVoix: async () => ({}),
          preparerRendu: async () => async (t) => {
            const id = (t.sortie.split('/').pop() ?? '').replace('.mp4', '');
            if (crash && rendus.length >= 1 && !rendus.includes('mort')) { rendus.push('mort'); throw Object.assign(new Error('processus tue'), { fatal: true }); }
            rendus.push(id);
            await mkdir(join(t.sortie, '..'), { recursive: true });
            await writeFile(t.sortie, `mp4:${id}`);
            return controle(t.sortie);
          },
          concatener: async (fichiers, sortie) => { const { readFile } = await import('node:fs/promises'); await writeFile(sortie, (await Promise.all(fichiers.map((f) => readFile(f, 'utf-8')))).join('+')); return controle(sortie); },
          controler: controle,
        };
        const dep = { films, travaux, objets, moteurs, racine, dossierTravail: join(racine, 'travail'), plafondUsd: 2, ressources: { seuils: { ramMinMo: 0 } } };
        const lancer = async (demandees: string[] = []) => {
          const lu = (await films.lire('film-pg-e2e', A))!;
          return (await travaux.creerOuRetrouver({ film: lu.film, proprietaire: A, cle: cleTravail(lu.film, demandees), scenesDemandees: demandees, maxActifs: 2 })).travail!;
        };

        await db.query("update public.cinema_travaux set statut = 'annule', bail_jusqua = null where proprietaire = $1 and statut in ('en_attente', 'en_cours')", [A]);
        const f = unFilm('film-pg-e2e');
        await films.creer(f, A);
        const t1 = await lancer();
        expect(await executerTravail(t1.id, A, dep)).toBe('termine');
        const fin1 = (await travaux.lire(t1.id, A))!;
        expect(fin1.statut).toBe('termine');
        expect(fin1.resultat!.scenesRendues).toHaveLength(f.scenes.length);
        expect(fin1.progression.pourcent).toBe(100);
        expect(scenesAReproduire((await films.lire('film-pg-e2e', A))!.film)).toEqual([]);   // scellage persiste en base

        // Relance : rien n'est refait.
        const avant = rendus.length;
        const t2 = await lancer();
        expect(await executerTravail(t2.id, A, dep)).toBe('termine');
        expect(rendus.length).toBe(avant);

        // Une scene modifiee : elle seule est refaite.
        const cible = f.scenes[1];
        await modifierFilm(films, 'film-pg-e2e', A, (x) => appliquerPatch(x, { plans: [{ id: cible.plans[0].id, texte: 'Une description neuve de ce plan' }] }));
        rendus.length = 0;
        const t3 = await lancer();
        expect(await executerTravail(t3.id, A, dep)).toBe('termine');
        expect(rendus).toEqual([cible.id]);

        // Interruption : le processus meurt apres la 1ere scene d'une nouvelle version complete.
        await modifierFilm(films, 'film-pg-e2e', A, (x) => ({ ...x, scenes: x.scenes.map((s) => ({ ...s, plans: s.plans.map((p, i) => i ? p : { ...p, description: `${p.description} (v2)` }) })) }));
        rendus.length = 0; crash = true;
        const t4 = await lancer();
        expect(await executerTravail(t4.id, A, dep)).toBe('echec');   // l'executeur a ete tue en cours de route : la scene 1 est rendue, le travail echoue
        const apresCrash = (await travaux.lire(t4.id, A))!;
        expect(apresCrash.statut).toBe('echec');
        expect(apresCrash.erreur).toMatch(/reference/);
        crash = false; rendus.length = 0;
        const t5 = await lancer();
        expect(await executerTravail(t5.id, A, dep)).toBe('termine');
        // La scene deja rendue avant la mort n'est pas refaite.
        expect(rendus).toHaveLength(f.scenes.length - 1);
        expect((await travaux.lire(t5.id, A))!.resultat!.scenesReutilisees).toHaveLength(1);
      } finally {
        await rm(racine, { recursive: true, force: true });
      }
    }, 60_000);
  });
});
