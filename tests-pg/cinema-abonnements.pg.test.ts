/**
 * `reserver_quota_cinema` / `confirmer_quota_cinema` sur un VRAI PostgreSQL 16.
 *
 * L'atomicite (deux generations simultanees ne depassent jamais le quota) est une
 * propriete du MOTEUR : seules de vraies connexions distinctes peuvent la prouver.
 * La migration testee est celle destinee a la production, jamais recopiee.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import type { Client } from 'pg';
import {
  connecter, preparerBase, appliquerMigration, creerUtilisateur, enConcurrence, urlBase, RACINE,
} from './harness';

const MIGRATION = join(RACINE, 'migrations/2026-11-01-cinema-abonnements.sql');
const ROLLBACK = join(RACINE, 'migrations/rollback/2026-11-01-cinema-abonnements.rollback.sql');

let db: Client;
beforeAll(async () => { urlBase(); db = await connecter(); });
beforeEach(async () => { await preparerBase(db); await appliquerMigration(db, MIGRATION); });
afterAll(async () => { if (db) await db.end(); });

const JOUR = 86_400_000;
const DEBUT = new Date(Date.now() - JOUR).toISOString();
const FIN = new Date(Date.now() + 29 * JOUR).toISOString();

/** L'exemple de la demande : 30 films, 30 minutes, 10 $ de budget fournisseur. */
const LIMITES = { films: 30, secondes: 1800, usd: 10 };

interface Resa { ok: boolean; motif: string | null; deja_reservee: boolean; films: number; secondes: number; usd_engages: string }

/** `dureeFilm` : duree TOTALE du film apres l'operation (la base en deduit l'ajout). */
async function reserver(
  c: Client, u: string, ref: string, film: string, dureeFilm: number, usd = 0.1,
  l = LIMITES, debut = DEBUT, fin = FIN,
): Promise<Resa> {
  const { rows } = await c.query<Resa>(
    'select * from public.reserver_quota_cinema($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [u, debut, fin, ref, film, dureeFilm, usd, l.films, l.secondes, l.usd],
  );
  return rows[0];
}

async function confirmer(c: Client, u: string, ref: string, statut: string) {
  const { rows } = await c.query<{ ok: boolean; motif: string | null }>(
    'select * from public.confirmer_quota_cinema($1,$2,$3)', [u, ref, statut]);
  return rows[0];
}

async function conso(u: string) {
  const { rows } = await db.query(
    'select films, secondes, usd_engages::float as usd, tentatives from public.cinema_quota_consommation where user_id = $1', [u]);
  return rows[0] as { films: number; secondes: number; usd: number; tentatives: number } | undefined;
}

describe('1. La migration', () => {
  it('se rejoue sans erreur, et n’inclut Cinema dans AUCUNE formule', async () => {
    await appliquerMigration(db, MIGRATION);
    const { rows } = await db.query('select count(*)::int as n from public.cinema_formules');
    expect(rows[0].n).toBe(0);
  });

  it('refuse une formule incluse incoherente (duree max > duree mensuelle)', async () => {
    await expect(db.query(`insert into public.cinema_formules
      (plan_key, inclus, films_par_mois, secondes_par_mois, duree_max_film_s, qualites, fonctionnalites, budget_usd_par_mois, renouvellement)
      values ('pro', true, 30, 600, 900, '{standard}', '{image_ia}', 10, 'mois_civil')`)).rejects.toThrow();
  });

  it('les fonctions sont retirees a public', async () => {
    const { rows } = await db.query(`select has_function_privilege('public',
      'public.reserver_quota_cinema(uuid,timestamptz,timestamptz,text,text,integer,numeric,integer,integer,numeric)',
      'EXECUTE') as r`);
    expect(rows[0].r).toBe(false);
  });

  it('le rollback retire tout, et la migration se rejoue ensuite', async () => {
    await appliquerMigration(db, ROLLBACK);
    const { rows } = await db.query("select to_regclass('public.cinema_quota_journal') as t");
    expect(rows[0].t).toBeNull();
    await appliquerMigration(db, MIGRATION);
  });
});

describe('2. Repartir 30 minutes comme on veut', () => {
  it('30 films d’une minute passent, le 31e est refuse (films epuises)', async () => {
    const u = await creerUtilisateur(db, 0);
    for (let i = 0; i < 30; i++) expect((await reserver(db, u, `r${i}`, `f${i}`, 60)).ok).toBe(true);
    const r = await reserver(db, u, 'r30', 'f30', 1);
    expect(r).toMatchObject({ ok: false, motif: 'films_epuises' });
    expect(await conso(u)).toMatchObject({ films: 30, secondes: 1800 });
  });

  it('10 films de 3 minutes passent, puis plus une seconde', async () => {
    const u = await creerUtilisateur(db, 0);
    for (let i = 0; i < 10; i++) expect((await reserver(db, u, `r${i}`, `f${i}`, 180)).ok).toBe(true);
    expect(await reserver(db, u, 'rx', 'fx', 1)).toMatchObject({ ok: false, motif: 'minutes_epuisees' });
  });

  it('5 films de 6 minutes passent ; un 6e est refuse sur les minutes, pas sur les films', async () => {
    const u = await creerUtilisateur(db, 0);
    for (let i = 0; i < 5; i++) expect((await reserver(db, u, `r${i}`, `f${i}`, 360)).ok).toBe(true);
    expect(await reserver(db, u, 'r5', 'f5', 360)).toMatchObject({ ok: false, motif: 'minutes_epuisees' });
    expect((await conso(u))!.films).toBe(5);
  });

  it('les regenerations d’un MEME film ne consomment ni film ni minute, mais le budget', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'premiere', 'film-a', 120, 0.4);
    await reserver(db, u, 'regen-1', 'film-a', 120, 0.4);
    await reserver(db, u, 'regen-2', 'film-a', 90, 0.4); // raccourci : ne rend rien, ne prend rien
    expect(await conso(u)).toMatchObject({ films: 1, secondes: 120, tentatives: 3 });
    expect((await conso(u))!.usd).toBeCloseTo(1.2, 4);
  });

  it('le budget fournisseur arrete AVANT le depassement, meme avec des minutes restantes', async () => {
    const u = await creerUtilisateur(db, 0);
    const l = { films: 30, secondes: 1800, usd: 1 };
    expect((await reserver(db, u, 'a', 'f', 60, 0.6, l)).ok).toBe(true);
    expect(await reserver(db, u, 'b', 'f', 60, 0.6, l)).toMatchObject({ ok: false, motif: 'budget_fournisseur_atteint' });
    expect((await conso(u))!.usd).toBeCloseTo(0.6, 4);
  });

  it('un film qui S’ALLONGE ne consomme que la difference — refusee si elle depasse les minutes', async () => {
    const u = await creerUtilisateur(db, 0);
    const l = { films: 30, secondes: 300, usd: 10 };
    expect((await reserver(db, u, 'a', 'film', 120, 0.1, l)).ok).toBe(true);
    expect((await reserver(db, u, 'b', 'film', 200, 0.1, l)).ok).toBe(true);
    expect(await conso(u)).toMatchObject({ films: 1, secondes: 200 });
    expect(await reserver(db, u, 'c', 'film', 320, 0.1, l)).toMatchObject({ ok: false, motif: 'minutes_epuisees' });
    expect(await conso(u)).toMatchObject({ films: 1, secondes: 200, tentatives: 2 });
  });
});

describe('3. Concurrence, idempotence, gardes', () => {
  it('8 generations SIMULTANEES pour 3 films restants : exactement 3 passent', async () => {
    const u = await creerUtilisateur(db, 0);
    const l = { films: 3, secondes: 1800, usd: 10 };
    const r = await enConcurrence(8, (c, i) => reserver(c, u, `c${i}`, `film-${i}`, 60, 0.1, l));
    const acceptees = r.filter((x) => x.ok && x.valeur.ok);
    expect(acceptees).toHaveLength(3);
    expect(await conso(u)).toMatchObject({ films: 3, secondes: 180, tentatives: 3 });
  });

  it('la MEME reference rejouee en concurrence ne reserve qu’une fois', async () => {
    const u = await creerUtilisateur(db, 0);
    const r = await enConcurrence(6, (c) => reserver(c, u, 'meme-ref', 'film', 60, 0.5));
    expect(r.every((x) => x.ok && x.valeur.ok)).toBe(true);
    expect(await conso(u)).toMatchObject({ films: 1, secondes: 60, tentatives: 1 });
    expect((await conso(u))!.usd).toBeCloseTo(0.5, 4);
  });

  it('un montant absurde, une periode echue ou des limites invalides sont refuses sans rien ecrire', async () => {
    const u = await creerUtilisateur(db, 0);
    expect((await reserver(db, u, 'a', 'f', 60, 50)).motif).toBe('montant_invalide');
    expect((await reserver(db, u, 'b', 'f', 60, 0)).motif).toBe('montant_invalide');
    expect((await reserver(db, u, 'b2', 'f', 0, 0.1)).motif).toBe('secondes_invalides');
    const passe = new Date(Date.now() - 40 * JOUR).toISOString();
    const finPasse = new Date(Date.now() - 10 * JOUR).toISOString();
    expect((await reserver(db, u, 'c', 'f', 60, 0.1, LIMITES, passe, finPasse)).motif).toBe('periode_invalide');
    expect((await reserver(db, u, 'd', 'f', 60, 0.1, { films: -1, secondes: 1, usd: 1 })).motif).toBe('limites_invalides');
    expect(await conso(u)).toBeUndefined();
  });
});

describe('4. Confirmer, liberer, reconcilier', () => {
  it('liberee : tout ce que la reservation avait pris est rendu', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'a', 'f', 90, 0.4);
    expect((await confirmer(db, u, 'a', 'liberee')).ok).toBe(true);
    expect(await conso(u)).toMatchObject({ films: 0, secondes: 0, tentatives: 0 });
    expect((await conso(u))!.usd).toBeCloseTo(0, 4);
  });

  it('liberer la PREMIERE reservation d’un film encore utilise : le film reste compte', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'premiere', 'film', 120, 0.4);
    await reserver(db, u, 'regen', 'film', 120, 0.4);
    await confirmer(db, u, 'premiere', 'liberee');
    expect(await conso(u)).toMatchObject({ films: 1, secondes: 120, tentatives: 1 });
    // Et si la seconde est liberee a son tour, le film disparait vraiment.
    await confirmer(db, u, 'regen', 'liberee');
    expect(await conso(u)).toMatchObject({ films: 0, secondes: 0, tentatives: 0 });
  });

  it('incertaine reste comptee, puis peut etre reclassee ; une finalisee ne change plus', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'a', 'f', 60, 0.4);
    expect((await confirmer(db, u, 'a', 'incertaine')).ok).toBe(true);
    expect((await conso(u))!.usd).toBeCloseTo(0.4, 4);
    expect((await confirmer(db, u, 'a', 'confirmee')).ok).toBe(true);
    expect(await confirmer(db, u, 'a', 'liberee')).toMatchObject({ ok: false, motif: 'deja_finalisee' });
    expect((await confirmer(db, u, 'a', 'confirmee')).ok).toBe(true); // rejeu identique : sans effet
    expect((await conso(u))!.usd).toBeCloseTo(0.4, 4);
  });

  it('deux liberations simultanees ne rendent qu’une fois', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'a', 'f', 60, 0.4);
    await reserver(db, u, 'b', 'g', 60, 0.4);
    await enConcurrence(5, (c) => confirmer(c, u, 'a', 'liberee'));
    expect(await conso(u)).toMatchObject({ films: 1, secondes: 60, tentatives: 1 });
    expect((await conso(u))!.usd).toBeCloseTo(0.4, 4);
  });

  it('une reference liberee rejouee n’est jamais declaree reservee', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'a', 'f', 60, 0.4);
    await confirmer(db, u, 'a', 'liberee');
    expect(await reserver(db, u, 'a', 'f', 60, 0.4)).toMatchObject({ ok: false, motif: 'reference_liberee' });
    expect((await conso(u))!.films).toBe(0);
  });
});

async function produire(c: Client, u: string, ref: string, film: string, duree: number, max = LIMITES.secondes) {
  const { rows } = await c.query<{ ok: boolean; motif: string | null; concerne: boolean; ajustement: number }>(
    'select * from public.reserver_production_cinema($1,$2,$3,$4,$5,$6)', [u, DEBUT, ref, film, duree, max]);
  return rows[0];
}
async function finaliser(c: Client, u: string, ref: string, duree: number) {
  const { rows } = await c.query<{ ok: boolean; motif: string | null; ajustement: number }>(
    'select * from public.finaliser_production_cinema($1,$2,$3)', [u, ref, duree]);
  return rows[0];
}

describe('5. Production : les minutes REELLEMENT produites', () => {
  it('film plus court que prevu : l’excedent prevu est rendu, le budget reste consomme', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'g1', 'film', 180, 0.4);
    await confirmer(db, u, 'g1', 'confirmee');
    expect(await produire(db, u, 'p1', 'film', 100)).toMatchObject({ ok: true, concerne: true, ajustement: -80 });
    expect((await finaliser(db, u, 'p1', 95)).ajustement).toBe(-85);
    expect(await conso(u)).toMatchObject({ films: 1, secondes: 95 });
    expect((await conso(u))!.usd).toBeCloseTo(0.4, 4); // budget fournisseur : inchange
  });

  it('film plus long que reserve : la difference est reservee AVANT le rendu, refusee si elle depasse', async () => {
    const u = await creerUtilisateur(db, 0);
    const max = 200;
    await reserver(db, u, 'g1', 'film', 120, 0.1, { ...LIMITES, secondes: max });
    expect(await produire(db, u, 'p-trop', 'film', 260, max)).toMatchObject({ ok: false, motif: 'minutes_epuisees' });
    expect((await conso(u))!.secondes).toBe(120);
    expect(await produire(db, u, 'p-ok', 'film', 190, max)).toMatchObject({ ok: true, ajustement: 70 });
    expect((await conso(u))!.secondes).toBe(190);
  });

  it('la finalisation ne prend JAMAIS plus que reserve, meme si la mesure reelle est plus longue', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'g1', 'film', 100, 0.1);
    await produire(db, u, 'p1', 'film', 100);
    expect((await finaliser(db, u, 'p1', 130)).ajustement).toBe(0);
    expect((await conso(u))!.secondes).toBe(100);
  });

  it('rendu non abouti : la production est liberee, les minutes prevues reviennent', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'g1', 'film', 180, 0.1);
    await produire(db, u, 'p1', 'film', 60);
    expect((await conso(u))!.secondes).toBe(60);
    expect((await confirmer(db, u, 'p1', 'liberee')).ok).toBe(true);
    expect((await conso(u))!.secondes).toBe(180);
  });

  it('un film deja livre ne rend pas ses minutes en etant raccourci ensuite', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'g1', 'film', 120, 0.1);
    await produire(db, u, 'p1', 'film', 120);
    await finaliser(db, u, 'p1', 120);
    await produire(db, u, 'p2', 'film', 30);
    await finaliser(db, u, 'p2', 30);
    expect((await conso(u))!.secondes).toBe(120);
  });

  it('regeneration apres production raccourcie : seules les minutes en plus sont reprises', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'g1', 'film', 180, 0.1);
    await produire(db, u, 'p1', 'film', 60);
    await finaliser(db, u, 'p1', 60);
    // Scene remplacee : regeneration, le projet fait maintenant 90 s.
    await reserver(db, u, 'g2', 'film', 90, 0.1);
    expect(await conso(u)).toMatchObject({ films: 1, secondes: 90, tentatives: 2 });
  });

  it('film sans aucune generation dans la periode : non concerne, le rendu reste libre', async () => {
    const u = await creerUtilisateur(db, 0);
    expect(await produire(db, u, 'p0', 'film-libre', 300)).toMatchObject({ ok: true, concerne: false });
    await reserver(db, u, 'g1', 'autre', 60, 0.1);
    expect(await produire(db, u, 'p1', 'film-libre', 300)).toMatchObject({ ok: true, concerne: false });
    expect((await conso(u))!.secondes).toBe(60);
  });

  it('finalisations et liberations concurrentes de la meme production : un seul effet', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'g1', 'film', 180, 0.1);
    await produire(db, u, 'p1', 'film', 100);
    await enConcurrence(6, (c, i) => (i % 2 ? finaliser(c, u, 'p1', 90) : confirmer(c, u, 'p1', 'liberee')));
    const s = (await conso(u))!.secondes;
    expect([90, 180]).toContain(s); // finalisee (90) OU liberee (180) — jamais un melange
  });

  it('reussie apres interruption : incertaine, puis reclassee confirmee — une seule fois', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'g1', 'film', 60, 0.4);
    await confirmer(db, u, 'g1', 'incertaine'); // la reconciliation a vu le bail expirer
    expect((await confirmer(db, u, 'g1', 'confirmee')).ok).toBe(true); // l'executeur conclut
    expect((await confirmer(db, u, 'g1', 'incertaine')).motif).toBe('deja_finalisee');
    expect((await conso(u))!.usd).toBeCloseTo(0.4, 4);
  });

  it('interrompue puis echec PROUVE non facture : incertaine → liberee, tout est rendu', async () => {
    const u = await creerUtilisateur(db, 0);
    await reserver(db, u, 'g1', 'film', 60, 0.4);
    await confirmer(db, u, 'g1', 'incertaine');
    expect((await confirmer(db, u, 'g1', 'liberee')).ok).toBe(true);
    expect(await conso(u)).toMatchObject({ films: 0, secondes: 0, tentatives: 0 });
  });
});
