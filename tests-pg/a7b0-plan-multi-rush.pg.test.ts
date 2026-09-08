/**
 * A_7B0 — UN PLAN MULTI-RUSH ET SES SOURCES, OU RIEN.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CES TESTS EXIGENT UN VRAI POSTGRESQL
 * ---------------------------------------------------------------------------
 *
 * Ce qui est mesure ici n'est pas une decision — les decisions se lisent dans
 * le SQL, et une garde statique les tient. C'est un COMPORTEMENT DU MOTEUR :
 * qu'une insertion echouee au milieu ne laisse rien, que deux transactions
 * concurrentes ne produisent pas deux plans, qu'une sous-transaction PL/pgSQL
 * defasse bien l'insertion du plan quand celle des sources echoue.
 *
 * Un faux client rejoue ce qu'on lui programme : il « prouverait » aussi bien
 * une implementation cassee. C'est la meme raison qui a fait ecrire les tests
 * de credits sur une vraie base, et elle vaut mot pour mot ici.
 *
 * ⚠️ AUCUN SQL N'EST RECOPIE. Le fichier de migration destine a la production
 * est joue tel quel ; un test qui reecrirait la fonction ne testerait que sa
 * propre copie.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import { connecter, creerUtilisateur, preparerBaseMontage } from './harness';
import { empreinteJeuxSources, type JeuSource } from '../src/lib/autopilot/analyse/montage-source';

let db: Client;

const IDENTITE = {
  algorithme: 'm3e-v4',
  methode: 'ffmpeg-copy',
  algorithmePlan: 'm3g-v2',
  format: '9:16',
  duree: 25,
};

/** Un jeu de clips complet — session, rush, analyse, candidats, clips. */
async function creerJeuClips(userId: string, rang: number): Promise<string> {
  const { rows: [s] } = await db.query<{ id: string }>(
    `insert into public.shoot_sessions (user_id, titre) values ($1, $2) returning id`,
    [userId, `session ${rang}`],
  );
  const { rows: [r] } = await db.query<{ id: string }>(
    `insert into public.rushes (shoot_session_id, user_id, bucket, cle_objet, rang)
     values ($1, $2, 'media', $3, $4) returning id`,
    [s.id, userId, `${userId}/rush-${rang}-${Date.now()}-${Math.random()}.mp4`, rang],
  );
  const { rows: [a] } = await db.query<{ id: string }>(
    `insert into public.rush_analyses (rush_id, user_id, etat) values ($1, $2, 'reussie') returning id`,
    [r.id, userId],
  );
  const { rows: [c] } = await db.query<{ id: string }>(
    `insert into public.rush_candidate_sets (analysis_id, rush_id, user_id, etat)
     values ($1, $2, $3, 'reussie') returning id`,
    [a.id, r.id, userId],
  );
  const { rows: [j] } = await db.query<{ id: string }>(
    `insert into public.rush_clip_sets
       (candidate_set_id, candidate_set_version, rush_id, analysis_id, user_id,
        algorithme, methode_materialisation, version, etat)
     values ($1, 1, $2, $3, $4, $5, $6, 1, 'reussie') returning id`,
    [c.id, r.id, a.id, userId, IDENTITE.algorithme, IDENTITE.methode],
  );
  return j.id;
}

interface Retour { issue: string; plan_id: string | null; cree: boolean }

/** Appelle LA FONCTION DE PRODUCTION. Aucune logique n'est reimplementee. */
async function creer(
  userId: string, sources: readonly JeuSource[],
  options: { empreinte?: string; duree?: number; format?: string; client?: Client } = {},
): Promise<Retour> {
  const client = options.client ?? db;
  const empreinte = options.empreinte
    ?? empreinteJeuxSources(sources)
    ?? 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const { rows } = await client.query<Retour>(
    `select * from public.creer_plan_montage_multi_rush(
       $1, $2::jsonb, $3, $4, $5, $6, $7, $8, 1080, 1920, 30,
       '[]'::jsonb, 0, 0, 0, '{}'::jsonb)`,
    [
      userId,
      JSON.stringify(sources.map((s) => ({
        clip_set_id: s.clipSetId, clip_set_version: s.clipSetVersion,
      }))),
      empreinte, IDENTITE.algorithme, IDENTITE.methode, IDENTITE.algorithmePlan,
      options.format ?? IDENTITE.format, options.duree ?? IDENTITE.duree,
    ],
  );
  return rows[0];
}

const compterPlans = async (client: Client = db) =>
  Number((await client.query('select count(*)::int as n from public.rush_montage_plans')).rows[0].n);
const compterSources = async (client: Client = db) =>
  Number((await client.query('select count(*)::int as n from public.rush_montage_plan_sources')).rows[0].n);

beforeAll(async () => { db = await connecter(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await preparerBaseMontage(db); });

describe('A_7B0 — creation atomique', () => {
  it('cree un plan et ses DEUX sources, dans l ordre', async () => {
    const u = await creerUtilisateur(db, 100);
    const a = await creerJeuClips(u, 1);
    const b = await creerJeuClips(u, 2);

    const r = await creer(u, [
      { clipSetId: a, clipSetVersion: 1 }, { clipSetId: b, clipSetVersion: 1 },
    ]);

    expect(r.issue).toBe('cree');
    expect(r.cree).toBe(true);
    expect(await compterPlans()).toBe(1);

    const { rows } = await db.query(
      `select ordinal, clip_set_id from public.rush_montage_plan_sources
        where plan_id = $1 order by ordinal`, [r.plan_id],
    );
    expect(rows.map((x) => x.clip_set_id)).toEqual([a, b]);
    expect(rows.map((x) => x.ordinal)).toEqual([0, 1]);
  });

  it('cree un plan et ses TROIS sources, dans l ordre donne', async () => {
    const u = await creerUtilisateur(db, 100);
    const [a, b, c] = [await creerJeuClips(u, 1), await creerJeuClips(u, 2), await creerJeuClips(u, 3)];

    const r = await creer(u, [
      { clipSetId: c, clipSetVersion: 1 },
      { clipSetId: a, clipSetVersion: 1 },
      { clipSetId: b, clipSetVersion: 1 },
    ]);

    expect(r.issue).toBe('cree');
    const { rows } = await db.query(
      `select clip_set_id from public.rush_montage_plan_sources
        where plan_id = $1 order by ordinal`, [r.plan_id],
    );
    expect(rows.map((x) => x.clip_set_id)).toEqual([c, a, b]);
  });

  it('les scalaires historiques restent NULS, l empreinte est posee', async () => {
    const u = await creerUtilisateur(db, 100);
    const a = await creerJeuClips(u, 1);
    const b = await creerJeuClips(u, 2);
    const sources = [{ clipSetId: a, clipSetVersion: 1 }, { clipSetId: b, clipSetVersion: 1 }];

    const r = await creer(u, sources);
    const { rows: [p] } = await db.query(
      `select clip_set_id, clip_set_version, candidate_set_id, analysis_id,
              source_set_fingerprint, version
         from public.rush_montage_plans where id = $1`, [r.plan_id],
    );

    // ⚠️ Y METTRE LA PREMIERE SOURCE FERAIT PARLER UNE COLONNE D'IDENTITE AU
    // NOM DE TOUTES LES AUTRES — voir A_7M.
    expect(p.clip_set_id).toBeNull();
    expect(p.clip_set_version).toBeNull();
    expect(p.candidate_set_id).toBeNull();
    expect(p.analysis_id).toBeNull();
    expect(p.source_set_fingerprint).toBe(empreinteJeuxSources(sources));
    expect(p.version).toBe(1);
  });

  it('A,B,C et B,A,C sont DEUX plans distincts', async () => {
    const u = await creerUtilisateur(db, 100);
    const [a, b, c] = [await creerJeuClips(u, 1), await creerJeuClips(u, 2), await creerJeuClips(u, 3)];
    const A = { clipSetId: a, clipSetVersion: 1 };
    const B = { clipSetId: b, clipSetVersion: 1 };
    const C = { clipSetId: c, clipSetVersion: 1 };

    expect(empreinteJeuxSources([A, B, C])).not.toBe(empreinteJeuxSources([B, A, C]));

    expect((await creer(u, [A, B, C])).issue).toBe('cree');
    expect((await creer(u, [B, A, C])).issue).toBe('cree');
    expect(await compterPlans()).toBe(2);
  });
});

describe('A_7B0 — idempotence et concurrence', () => {
  it('le meme appel deux fois ne fait qu UN plan', async () => {
    const u = await creerUtilisateur(db, 100);
    const sources = [
      { clipSetId: await creerJeuClips(u, 1), clipSetVersion: 1 },
      { clipSetId: await creerJeuClips(u, 2), clipSetVersion: 1 },
    ];

    const un = await creer(u, sources);
    const deux = await creer(u, sources);

    expect(un.issue).toBe('cree');
    expect(deux.issue).toBe('existant');
    expect(deux.cree).toBe(false);
    expect(deux.plan_id).toBe(un.plan_id);
    expect(await compterPlans()).toBe(1);
    expect(await compterSources()).toBe(2);
  });

  /**
   * ⚠️ LE CAS QUI JUSTIFIE L'INDEX, ET NON LA LECTURE PREALABLE.
   *
   * Les deux transactions passent le `select` de deduplication avant qu'aucune
   * n'ait ecrit. C'est `rush_montage_plans_identite_sources_unique` qui
   * tranche : la seconde est bloquee jusqu'au `commit` de la premiere, puis
   * refusee, puis rattrapee par le gestionnaire d'exception.
   */
  it('deux transactions concurrentes ne produisent pas deux plans', async () => {
    const u = await creerUtilisateur(db, 100);
    const sources = [
      { clipSetId: await creerJeuClips(u, 1), clipSetVersion: 1 },
      { clipSetId: await creerJeuClips(u, 2), clipSetVersion: 1 },
    ];

    const autre = await connecter();
    try {
      await db.query('begin');
      await autre.query('begin');

      const premier = await creer(u, sources, { client: db });
      const seconde = creer(u, sources, { client: autre });

      await db.query('commit');
      const r2 = await seconde;
      await autre.query('commit');

      expect(premier.issue).toBe('cree');
      expect(r2.issue).toBe('existant');
      expect(r2.plan_id).toBe(premier.plan_id);
      expect(await compterPlans()).toBe(1);
      expect(await compterSources()).toBe(2);
    } finally {
      await autre.end();
    }
  });
});

describe('A_7B0 — aucun plan partiel', () => {
  /**
   * ⚠️ L'ECHEC EST INJECTE PAR UN DECLENCHEUR, ET C'EST VOLONTAIRE.
   *
   * Les refus que la fonction sait nommer — propriete, doublon, version —
   * arrivent AVANT toute ecriture : ils ne prouveraient donc rien sur le
   * rollback. Il faut un echec que la fonction ne peut pas anticiper, survenant
   * APRES l'insertion du plan et AU MILIEU de celle des sources. Un declencheur
   * qui refuse la troisieme ligne reproduit exactement cela.
   */
  it('une erreur sur la 3e source ne laisse ni plan ni source', async () => {
    const u = await creerUtilisateur(db, 100);
    const sources = [
      { clipSetId: await creerJeuClips(u, 1), clipSetVersion: 1 },
      { clipSetId: await creerJeuClips(u, 2), clipSetVersion: 1 },
      { clipSetId: await creerJeuClips(u, 3), clipSetVersion: 1 },
    ];

    await db.query(`
      create or replace function public.__refus_3e() returns trigger
      language plpgsql as $t$
      begin
        if new.ordinal = 2 then raise exception 'panne simulee sur la 3e source'; end if;
        return new;
      end; $t$;
      create trigger __refus_3e before insert on public.rush_montage_plan_sources
        for each row execute function public.__refus_3e();
    `);

    await expect(creer(u, sources)).rejects.toThrow(/panne simulee/);

    expect(await compterPlans()).toBe(0);
    expect(await compterSources()).toBe(0);
  });

  it('un plan refuse par la base ne laisse aucune source', async () => {
    const u = await creerUtilisateur(db, 100);
    const sources = [
      { clipSetId: await creerJeuClips(u, 1), clipSetVersion: 1 },
      { clipSetId: await creerJeuClips(u, 2), clipSetVersion: 1 },
    ];

    // `duree_cible_secondes <= 120` est un `check` de M3-G que la fonction ne
    // duplique pas : l'insertion du plan echoue, et rien ne subsiste.
    await expect(creer(u, sources, { duree: 500 })).rejects.toThrow();

    expect(await compterPlans()).toBe(0);
    expect(await compterSources()).toBe(0);
  });
});

describe('A_7B0 — les refus, avant toute ecriture', () => {
  it('une source appartenant a autrui fait tout echouer', async () => {
    const u = await creerUtilisateur(db, 100);
    const autre = await creerUtilisateur(db, 100);
    const sources = [
      { clipSetId: await creerJeuClips(u, 1), clipSetVersion: 1 },
      { clipSetId: await creerJeuClips(autre, 2), clipSetVersion: 1 },
    ];

    const r = await creer(u, sources);

    expect(r.issue).toBe('source_inconnue');
    expect(r.plan_id).toBeNull();
    expect(await compterPlans()).toBe(0);
    expect(await compterSources()).toBe(0);
  });

  it('une version de jeu qui n existe pas est refusee', async () => {
    const u = await creerUtilisateur(db, 100);
    const sources = [
      { clipSetId: await creerJeuClips(u, 1), clipSetVersion: 1 },
      { clipSetId: await creerJeuClips(u, 2), clipSetVersion: 7 },
    ];
    expect((await creer(u, sources)).issue).toBe('source_inconnue');
    expect(await compterPlans()).toBe(0);
  });

  it('le meme jeu deux fois est refuse', async () => {
    const u = await creerUtilisateur(db, 100);
    const a = await creerJeuClips(u, 1);
    const r = await creer(u, [
      { clipSetId: a, clipSetVersion: 1 }, { clipSetId: a, clipSetVersion: 1 },
    ]);
    expect(r.issue).toBe('source_dupliquee');
    expect(await compterPlans()).toBe(0);
  });

  it('une seule source est refusee — le mono-rush garde son chemin', async () => {
    const u = await creerUtilisateur(db, 100);
    const a = await creerJeuClips(u, 1);
    const r = await creer(u, [{ clipSetId: a, clipSetVersion: 1 }]);
    expect(r.issue).toBe('sources_insuffisantes');
    expect(await compterPlans()).toBe(0);
  });

  it('une empreinte malformee est refusee avant toute lecture', async () => {
    const u = await creerUtilisateur(db, 100);
    const sources = [
      { clipSetId: await creerJeuClips(u, 1), clipSetVersion: 1 },
      { clipSetId: await creerJeuClips(u, 2), clipSetVersion: 1 },
    ];
    expect((await creer(u, sources, { empreinte: 'court' })).issue).toBe('empreinte_invalide');
    expect((await creer(u, sources, { empreinte: 'PAS-DU-HEXA-DU-TOUT!!' })).issue)
      .toBe('empreinte_invalide');
    expect(await compterPlans()).toBe(0);
  });

  it('deux ordinaux identiques sont refuses PAR LA BASE', async () => {
    const u = await creerUtilisateur(db, 100);
    const sources = [
      { clipSetId: await creerJeuClips(u, 1), clipSetVersion: 1 },
      { clipSetId: await creerJeuClips(u, 2), clipSetVersion: 1 },
    ];
    const r = await creer(u, sources);
    // La cle primaire `(plan_id, ordinal)` porte l'ordre : l'appelant n'a
    // aucune verification a ne pas oublier.
    await expect(db.query(
      `insert into public.rush_montage_plan_sources
         (plan_id, user_id, ordinal, clip_set_id, clip_set_version)
       values ($1, $2, 0, $3, 1)`,
      [r.plan_id, u, sources[0].clipSetId],
    )).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('A_7B0 — le passe ne bouge pas', () => {
  it('un plan mono-rush historique s ecrit toujours par le chemin direct', async () => {
    const u = await creerUtilisateur(db, 100);
    const a = await creerJeuClips(u, 1);
    const { rows: [jeu] } = await db.query(
      'select candidate_set_id, analysis_id from public.rush_clip_sets where id = $1', [a],
    );

    const { rows: [p] } = await db.query(
      `insert into public.rush_montage_plans
         (user_id, clip_set_id, clip_set_version, candidate_set_id, analysis_id,
          algorithme, methode_materialisation, algorithme_plan, format,
          duree_cible_secondes, largeur_cible, hauteur_cible, fps)
       values ($1, $2, 1, $3, $4, $5, $6, $7, '9:16', 25, 1080, 1920, 30)
       returning id, source_set_fingerprint`,
      [u, a, jeu.candidate_set_id, jeu.analysis_id,
       IDENTITE.algorithme, IDENTITE.methode, IDENTITE.algorithmePlan],
    );

    // ⚠️ EMPREINTE NULLE : il reste gouverne par l'index d'identite historique,
    // et ses rendus deja produits restent trouvables.
    expect(p.source_set_fingerprint).toBeNull();
    expect(await compterPlans()).toBe(1);
  });

  it('la politique de suppression d A_7M2 tient sur les lignes nouvelles', async () => {
    const u = await creerUtilisateur(db, 100);
    const a = await creerJeuClips(u, 1);
    const b = await creerJeuClips(u, 2);
    await creer(u, [{ clipSetId: a, clipSetVersion: 1 }, { clipSetId: b, clipSetVersion: 1 }]);

    // Supprimer un jeu de clips reference ne doit pas amputer le montage.
    await expect(db.query('delete from public.rush_clip_sets where id = $1', [a]))
      .rejects.toThrow();
    expect(await compterSources()).toBe(2);
  });

  it('la suppression du compte reste possible — contraintes differees', async () => {
    const u = await creerUtilisateur(db, 100);
    const a = await creerJeuClips(u, 1);
    const b = await creerJeuClips(u, 2);
    await creer(u, [{ clipSetId: a, clipSetVersion: 1 }, { clipSetId: b, clipSetVersion: 1 }]);

    await db.query('delete from public.users where id = $1', [u]);
    expect(await compterPlans()).toBe(0);
    expect(await compterSources()).toBe(0);
  });
});
