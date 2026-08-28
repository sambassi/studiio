/**
 * Le schéma des analyses de rush, sur un VRAI PostgreSQL 16.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI SE VÉRIFIE ICI ET NULLE PART AILLEURS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les garanties de ce lot sont des CONTRAINTES : une clé étrangère composite
 * qui interdit à une analyse d'appartenir à un autre utilisateur que son
 * rush, et surtout un INDEX UNIQUE PARTIEL qui interdit deux analyses
 * actives sur un même rush tout en autorisant dix analyses terminées.
 *
 * Aucune de ces garanties ne se teste avec une doublure : un faux client
 * accepte ce qu'on lui programme, et « pas de doublon » est précisément ce
 * qu'un faux client ne peut pas prouver. Il faut le moteur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE SCÉNARIO RÉALISTE, ET POURQUOI IL EST INDISPENSABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En production, cette migration ne s'appliquera PAS sur une base vide : il y
 * a déjà une session de tournage et un rush réel. Un test qui ne jouerait
 * jamais que « base neuve → toutes les migrations » validerait le seul cas
 * qui ne se produira jamais.
 *
 * Le premier bloc part donc du socle M3-A, y pose des données, PUIS applique
 * M3-B1 — et vérifie que rien de ce qui existait n'a bougé.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  connecter, preparerBase, preparerBaseSocle, appliquerMigration,
  creerUtilisateur, urlBase, MIGRATION_ANALYSES,
} from './harness';

let client: Client;

const creerSession = async (userId: string, titre = 'Cours du samedi') => {
  const { rows } = await client.query<{ id: string }>(
    'insert into public.shoot_sessions (user_id, titre) values ($1, $2) returning id',
    [userId, titre],
  );
  return rows[0].id;
};

const indexerRush = async (
  sessionId: string, userId: string, cle: string, rang = 0,
) => {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.rushes (shoot_session_id, user_id, bucket, cle_objet, rang, etat)
     values ($1, $2, 'media', $3, $4, 'verifie') returning id`,
    [sessionId, userId, cle, rang],
  );
  return rows[0].id;
};

const creerAnalyse = async (
  rushId: string, userId: string, etat = 'en_attente', version = 1,
) => client.query(
  `insert into public.rush_analyses (rush_id, user_id, version, etat)
   values ($1, $2, $3, $4) returning id`,
  [rushId, userId, version, etat],
);

/** Un rush réel prêt à être analysé, sur une base déjà migrée. */
const rushPret = async () => {
  const u = await creerUtilisateur(client, 10);
  const s = await creerSession(u);
  const r = await indexerRush(s, u, `${u}/rush/plan.mp4`);
  return { u, s, r };
};

beforeAll(async () => { urlBase(); client = await connecter(); });
afterAll(async () => { if (client) await client.end(); });

// ───────────────────────────────────────────────────────────────────────────
describe('La migration s applique sur une base qui contient DEJA des rushes', () => {
  // Ce bloc ne veut PAS de la base déjà migrée : il applique M3-B1 lui-même.
  beforeEach(async () => { await preparerBaseSocle(client); });

  it('elle passe, et le rush préexistant est intact', async () => {
    const u = await creerUtilisateur(client, 10);
    const s = await creerSession(u, 'Tournage du 30 août');
    const r = await indexerRush(s, u, `${u}/rush/reel.mp4`);

    const { rows: avant } = await client.query(
      `select id, shoot_session_id, user_id, bucket, cle_objet, rang, etat,
              duree_secondes, metadata, created_at, updated_at
         from public.rushes where id = $1`, [r],
    );
    const { rows: sessionAvant } = await client.query(
      'select * from public.shoot_sessions where id = $1', [s],
    );

    // La table n'existe pas encore : c'est le point de départ réel.
    const { rows: absente } = await client.query(
      "select to_regclass('public.rush_analyses') as t",
    );
    expect(absente[0].t).toBeNull();

    await appliquerMigration(client, MIGRATION_ANALYSES);

    const { rows: apres } = await client.query(
      `select id, shoot_session_id, user_id, bucket, cle_objet, rang, etat,
              duree_secondes, metadata, created_at, updated_at
         from public.rushes where id = $1`, [r],
    );
    const { rows: sessionApres } = await client.query(
      'select * from public.shoot_sessions where id = $1', [s],
    );

    // Octet pour octet. Une migration additive ne touche à aucune donnée.
    expect(apres[0]).toEqual(avant[0]);
    expect(sessionApres[0]).toEqual(sessionAvant[0]);
    expect(apres[0].duree_secondes).toBeNull();
  });

  it('elle ne modifie AUCUNE colonne des tables existantes', async () => {
    const colonnes = async () => {
      const { rows } = await client.query(
        `select table_name, column_name, data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public'
            and table_name in ('rushes', 'shoot_sessions', 'users',
                               'credit_transactions', 'rendus')
          order by table_name, column_name`,
      );
      return rows;
    };
    const avant = await colonnes();
    await appliquerMigration(client, MIGRATION_ANALYSES);
    expect(await colonnes()).toEqual(avant);
  });

  it('elle n ajoute qu UNE table et UN index sur une table existante', async () => {
    const tables = async () => {
      const { rows } = await client.query(
        "select tablename from pg_tables where schemaname = 'public' order by tablename",
      );
      return rows.map((r) => r.tablename as string);
    };
    const indexRushes = async () => {
      const { rows } = await client.query(
        `select indexname from pg_indexes
          where schemaname = 'public' and tablename = 'rushes' order by indexname`,
      );
      return rows.map((r) => r.indexname as string);
    };

    const tablesAvant = await tables();
    const indexAvant = await indexRushes();
    await appliquerMigration(client, MIGRATION_ANALYSES);

    expect((await tables()).filter((t) => !tablesAvant.includes(t)))
      .toEqual(['rush_analyses']);
    expect((await indexRushes()).filter((i) => !indexAvant.includes(i)))
      .toEqual(['rushes_id_user_key']);
  });

  it('les témoins métier ne bougent pas', async () => {
    const u = await creerUtilisateur(client, 500);
    const s = await creerSession(u);
    await indexerRush(s, u, `${u}/rush/a.mp4`, 0);
    await indexerRush(s, u, `${u}/rush/b.mp4`, 1);

    const temoins = async () => {
      const { rows } = await client.query(
        `select (select count(*) from public.users)               as utilisateurs,
                (select coalesce(sum(credits), 0) from public.users) as credits,
                (select count(*) from public.credit_transactions) as transactions,
                (select count(*) from public.rendus)              as rendus,
                (select count(*) from public.rushes)              as rushes,
                (select count(*) from public.shoot_sessions)      as sessions`,
      );
      return rows[0];
    };
    const avant = await temoins();
    await appliquerMigration(client, MIGRATION_ANALYSES);
    expect(await temoins()).toEqual(avant);
  });

  it('appliquée en TRANSACTION UNIQUE sur une base qui porte des rushes', async () => {
    // C'est le mode EXACT de la production : `psql -v ON_ERROR_STOP=1
    // --single-transaction`. Le test qui suivait ne jouait la transaction que
    // sur une base DÉJÀ migrée — il prouvait la ré-application, pas
    // l'application. Celui-ci part du socle M3-A avec des données réelles.
    const { readFileSync } = await import('fs');
    const u = await creerUtilisateur(client, 10);
    const s = await creerSession(u, 'Tournage du 30 août');
    const r = await indexerRush(s, u, `${u}/rush/reel.mp4`);

    const ligneRush = async () => {
      const { rows } = await client.query(
        `select id, shoot_session_id, user_id, bucket, cle_objet, nom_origine,
                content_type, taille_octets, duree_secondes, rang, etat,
                metadata, created_at, updated_at
           from public.rushes where id = $1`, [r],
      );
      return rows[0];
    };
    const avant = await ligneRush();

    await client.query('begin');
    await client.query(readFileSync(MIGRATION_ANALYSES, 'utf-8'));
    await client.query('commit');

    // 1. La table est là.
    const { rows: presente } = await client.query(
      "select to_regclass('public.rush_analyses') as t",
    );
    expect(presente[0].t).toBe('rush_analyses');

    // 2. Le rush préexistant est intact, colonne par colonne.
    expect(await ligneRush()).toEqual(avant);

    // 3. L'index qui rend la clé étrangère composite possible.
    const { rows: idx } = await client.query(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'rushes_id_user_key'`,
    );
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/unique/i);

    // 4. Les quatre index attendus sur la nouvelle table, nommément.
    const { rows: index } = await client.query(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'rush_analyses'
        order by indexname`,
    );
    expect(index.map((l) => l.indexname)).toEqual([
      'rush_analyses_active_unique',
      'rush_analyses_pkey',
      'rush_analyses_rush_version_unique',
      'rush_analyses_user_idx',
    ]);

    // 5. `public` n'a aucun privilège — par les ACL, jamais par un nom de rôle.
    const { rows: acl } = await client.query(
      `select count(*)::int as n
         from pg_class c
         left join lateral aclexplode(c.relacl) a on true
        where c.oid = 'public.rush_analyses'::regclass and a.grantee = 0`,
    );
    expect(acl[0].n).toBe(0);
  });

  it('elle est rejouable sur une base qui porte déjà des analyses', async () => {
    const u = await creerUtilisateur(client, 10);
    const s = await creerSession(u);
    const r = await indexerRush(s, u, `${u}/rush/plan.mp4`);

    await appliquerMigration(client, MIGRATION_ANALYSES);
    await creerAnalyse(r, u, 'reussie', 1);
    // Rejouée, elle ne doit rien casser ni rien effacer.
    await appliquerMigration(client, MIGRATION_ANALYSES);

    const { rows } = await client.query(
      'select count(*)::int as n from public.rush_analyses where rush_id = $1', [r],
    );
    expect(rows[0].n).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('La table et ses garanties, une fois la migration appliquée', () => {
  beforeEach(async () => { await preparerBase(client); });

  it('elle est créée, et `rushes` porte enfin `(id, user_id)`', async () => {
    const { rows } = await client.query(
      "select to_regclass('public.rush_analyses') as t",
    );
    expect(rows[0].t).toBe('rush_analyses');

    // Sans cet index unique, PostgreSQL refuserait la FK composite. Ce n'est
    // donc pas une optimisation : c'est ce qui rend la garantie possible.
    const { rows: idx } = await client.query(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'rushes_id_user_key'`,
    );
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/unique/i);
    expect(idx[0].indexdef).toMatch(/\(id, user_id\)/);
  });

  it('les états et les étapes sont fermés par des CHECK', async () => {
    const { u, r } = await rushPret();
    await expect(creerAnalyse(r, u, 'terminee')).rejects.toThrow(/violates check/i);
    await expect(client.query(
      `insert into public.rush_analyses (rush_id, user_id, etape)
       values ($1, $2, 'montage')`, [r, u],
    )).rejects.toThrow(/violates check/i);
  });

  it('une version inférieure à 1 est refusée', async () => {
    const { u, r } = await rushPret();
    await expect(creerAnalyse(r, u, 'en_attente', 0)).rejects.toThrow(/violates check/i);
  });

  it('les colonnes JSON refusent la mauvaise forme', async () => {
    const { u, r } = await rushPret();
    // Un tableau là où un objet est attendu — `jsonb` l'accepterait, la
    // contrainte non : `technique[0]` n'a aucun sens.
    await expect(client.query(
      `insert into public.rush_analyses (rush_id, user_id, technique)
       values ($1, $2, '[]'::jsonb)`, [r, u],
    )).rejects.toThrow(/violates check/i);
    // Et l'inverse.
    await expect(client.query(
      `insert into public.rush_analyses (rush_id, user_id, vignettes)
       values ($1, $2, '{}'::jsonb)`, [r, u],
    )).rejects.toThrow(/violates check/i);
  });

  it('une URL dans `vignettes` est refusée par la base', async () => {
    // La règle « on stocke des clés, jamais des URL » n'est pas une
    // convention de code : une URL permanente stockée ici survivrait à la
    // signature qui l'a produite.
    const { u, r } = await rushPret();
    await expect(client.query(
      `insert into public.rush_analyses (rush_id, user_id, vignettes)
       values ($1, $2, $3::jsonb)`,
      [r, u, JSON.stringify([{ bucket: 'media', cle: 'https://exemple/v.jpg', seconde: 0 }])],
    )).rejects.toThrow(/violates check/i);

    // Une clé, elle, passe.
    const ok = await client.query(
      `insert into public.rush_analyses (rush_id, user_id, vignettes)
       values ($1, $2, $3::jsonb) returning id`,
      [r, u, JSON.stringify([{ bucket: 'media', cle: `${u}/analyse/0.jpg`, seconde: 0 }])],
    );
    expect(ok.rowCount).toBe(1);
  });

  it('la durée mesurée reste nullable — inconnue n est pas zéro', async () => {
    const { u, r } = await rushPret();
    const { rows: ins } = await client.query<{ id: string }>(
      'insert into public.rush_analyses (rush_id, user_id) values ($1, $2) returning id',
      [r, u],
    );
    const { rows } = await client.query(
      'select duree_secondes, etape, motif_echec from public.rush_analyses where id = $1',
      [ins[0].id],
    );
    expect(rows[0].duree_secondes).toBeNull();
    expect(rows[0].etape).toBeNull();
    expect(rows[0].motif_echec).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Une analyse ne peut pas appartenir à un autre utilisateur que son rush', () => {
  beforeEach(async () => { await preparerBase(client); });

  it('la base REFUSE, ce n est pas une règle applicative', async () => {
    const a = await creerUtilisateur(client, 10);
    const b = await creerUtilisateur(client, 10);
    const sessionDeA = await creerSession(a);
    const rushDeA = await indexerRush(sessionDeA, a, `${a}/rush/plan.mp4`);

    // B tente d'accrocher une analyse au rush de A. Même en écrivant
    // directement dans la table, sans passer par le service.
    await expect(creerAnalyse(rushDeA, b))
      .rejects.toThrow(/rush_analyses_rush_meme_proprietaire|foreign key/i);
  });

  it('et l accepte pour le bon propriétaire', async () => {
    const { u, r } = await rushPret();
    const res = await creerAnalyse(r, u);
    expect(res.rowCount).toBe(1);
  });

  it('un rush inexistant est refusé', async () => {
    const u = await creerUtilisateur(client, 10);
    const { rows } = await client.query<{ id: string }>('select gen_random_uuid() as id');
    await expect(creerAnalyse(rows[0].id, u))
      .rejects.toThrow(/rush_analyses_rush_meme_proprietaire|foreign key/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Au plus UNE analyse active par rush — et autant d historiques qu on veut', () => {
  beforeEach(async () => { await preparerBase(client); });

  it('deux analyses actives simultanées sont refusées', async () => {
    const { u, r } = await rushPret();
    await creerAnalyse(r, u, 'en_attente', 1);
    // C'est le double clic sur « Analyser », les deux onglets ouverts, le
    // rejeu de requête. Le moteur refuse : l'appelant n'a aucune
    // vérification à ne pas oublier.
    await expect(creerAnalyse(r, u, 'en_cours', 2))
      .rejects.toThrow(/rush_analyses_active_unique|duplicate key/i);
  });

  it('`en_attente` et `en_cours` comptent tous deux comme actifs', async () => {
    const { u, r } = await rushPret();
    await creerAnalyse(r, u, 'en_cours', 1);
    await expect(creerAnalyse(r, u, 'en_attente', 2))
      .rejects.toThrow(/rush_analyses_active_unique|duplicate key/i);
  });

  it('une analyse terminée libère la place pour une nouvelle', async () => {
    const { u, r } = await rushPret();
    const { rows } = await creerAnalyse(r, u, 'en_cours', 1) as { rows: Array<{ id: string }> };
    await client.query(
      "update public.rush_analyses set etat = 'reussie' where id = $1", [rows[0].id],
    );
    const suivante = await creerAnalyse(r, u, 'en_attente', 2);
    expect(suivante.rowCount).toBe(1);
  });

  it('plusieurs analyses terminées coexistent sans se gêner', async () => {
    const { u, r } = await rushPret();
    for (const [v, etat] of [[1, 'reussie'], [2, 'echouee'], [3, 'annulee']] as const) {
      // eslint-disable-next-line no-await-in-loop
      await creerAnalyse(r, u, etat, v);
    }
    const { rows } = await client.query(
      'select count(*)::int as n from public.rush_analyses where rush_id = $1', [r],
    );
    expect(rows[0].n).toBe(3);
    // Et une quatrième, active, reste possible.
    expect((await creerAnalyse(r, u, 'en_attente', 4)).rowCount).toBe(1);
  });

  it('deux rushes peuvent chacun avoir leur analyse active', async () => {
    const u = await creerUtilisateur(client, 10);
    const s = await creerSession(u);
    const r1 = await indexerRush(s, u, `${u}/rush/1.mp4`, 0);
    const r2 = await indexerRush(s, u, `${u}/rush/2.mp4`, 1);
    await creerAnalyse(r1, u);
    expect((await creerAnalyse(r2, u)).rowCount).toBe(1);
  });

  it('deux fois la même version d un rush est refusée', async () => {
    const { u, r } = await rushPret();
    const { rows } = await creerAnalyse(r, u, 'reussie', 1) as { rows: Array<{ id: string }> };
    expect(rows[0].id).toBeTruthy();
    await expect(creerAnalyse(r, u, 'reussie', 1))
      .rejects.toThrow(/rush_analyses_rush_version_unique|duplicate key/i);
  });

  it('mais deux rushes peuvent chacun avoir leur version 1', async () => {
    const u = await creerUtilisateur(client, 10);
    const s = await creerSession(u);
    const r1 = await indexerRush(s, u, `${u}/rush/1.mp4`, 0);
    const r2 = await indexerRush(s, u, `${u}/rush/2.mp4`, 1);
    await creerAnalyse(r1, u, 'reussie', 1);
    expect((await creerAnalyse(r2, u, 'reussie', 1)).rowCount).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('La suppression suit le choix documenté', () => {
  beforeEach(async () => { await preparerBase(client); });

  it('supprimer un rush emporte ses analyses — elles sont dérivées', async () => {
    // `cascade` ici, et non `restrict` comme entre session et rushes : une
    // analyse n'a aucune valeur propre une fois son rush disparu. La retenir
    // ferait échouer la suppression d'un rush pour protéger un résultat que
    // plus rien ne concerne.
    const { u, r } = await rushPret();
    await creerAnalyse(r, u, 'reussie', 1);
    const del = await client.query('delete from public.rushes where id = $1', [r]);
    expect(del.rowCount).toBe(1);
    const { rows } = await client.query(
      'select count(*)::int as n from public.rush_analyses where rush_id = $1', [r],
    );
    expect(rows[0].n).toBe(0);
  });

  it('une session qui porte des rushes reste protégée — M3-A intact', async () => {
    const { u, s, r } = await rushPret();
    await creerAnalyse(r, u, 'reussie', 1);
    // M3-B1 n'a pas assoupli la règle de M3-A.
    await expect(client.query('delete from public.shoot_sessions where id = $1', [s]))
      .rejects.toThrow(/foreign key|violates/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Les privilèges : rien à `public`, tout au propriétaire', () => {
  beforeEach(async () => { await preparerBase(client); });

  it('`public` n a AUCUN privilège sur `rush_analyses`', async () => {
    // Vérifié par les ACL (`grantee` = pseudo-rôle d'OID 0), et non par
    // `has_table_privilege('public', …)` : `public` y serait résolu comme un
    // nom de rôle, ce qui n'est pas la même question.
    const { rows } = await client.query(
      `select count(*)::int as n
         from pg_class c
         left join lateral aclexplode(c.relacl) a on true
        where c.oid = 'public.rush_analyses'::regclass and a.grantee = 0`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('le propriétaire, lui, garde tous ses droits', async () => {
    const { rows } = await client.query(
      `select has_table_privilege(current_user, 'public.rush_analyses', 'SELECT') as lit,
              has_table_privilege(current_user, 'public.rush_analyses', 'INSERT') as ecrit,
              (select tableowner from pg_tables
                where schemaname = 'public' and tablename = 'rush_analyses') = current_user as possede`,
    );
    expect(rows[0].lit).toBe(true);
    expect(rows[0].ecrit).toBe(true);
    expect(rows[0].possede).toBe(true);
  });

  it('la migration ne contient ni grant, ni RLS, ni opération destructive', async () => {
    const { readFileSync } = await import('fs');
    const sql = readFileSync(MIGRATION_ANALYSES, 'utf-8');
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/grant\s/i);
    expect(code).not.toMatch(/revoke\s/i);
    expect(code).not.toMatch(/row level security/i);
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/alter table/i);
    expect(code).not.toMatch(/drop /i);
    expect(code).not.toMatch(/truncate/i);
    expect(code).not.toMatch(/delete from/i);
    expect(code).not.toMatch(/update public\./i);
    // `concurrently` rendrait la migration incompatible avec
    // `--single-transaction`, la façon dont elle sera appliquée.
    expect(code).not.toMatch(/concurrently/i);
  });

  it('elle s applique dans UNE transaction, comme elle partira en production', async () => {
    const { readFileSync } = await import('fs');
    const sql = readFileSync(MIGRATION_ANALYSES, 'utf-8');
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    const { rows } = await client.query("select to_regclass('public.rush_analyses') as t");
    expect(rows[0].t).toBe('rush_analyses');
  });
});
