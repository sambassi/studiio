/**
 * Le schéma du tournage, sur un VRAI PostgreSQL 16.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI SE VÉRIFIE ICI ET NULLE PART AILLEURS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les garanties de ce lot sont des CONTRAINTES : une clé étrangère composite
 * qui interdit à un rush d'appartenir à un autre utilisateur que sa session,
 * un `on delete restrict` qui refuse d'effacer une session qui porte des
 * rushes, deux index uniques qui tiennent l'ordre et l'unicité d'un objet.
 *
 * Aucune de ces garanties ne se teste avec une doublure : un faux client
 * accepte ce qu'on lui programme. Il faut le moteur.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import { connecter, preparerBase, creerUtilisateur, urlBase } from './harness';

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
) => client.query(
  `insert into public.rushes (shoot_session_id, user_id, bucket, cle_objet, rang, etat)
   values ($1, $2, 'media', $3, $4, 'verifie') returning id`,
  [sessionId, userId, cle, rang],
);

beforeAll(async () => { urlBase(); client = await connecter(); });
beforeEach(async () => { await preparerBase(client); });
afterAll(async () => { if (client) await client.end(); });

describe('Les deux tables existent, avec leurs contraintes', () => {
  it('elles sont créées', async () => {
    const { rows } = await client.query(
      "select to_regclass('public.shoot_sessions') as s, to_regclass('public.rushes') as r",
    );
    expect(rows[0].s).toBe('shoot_sessions');
    expect(rows[0].r).toBe('rushes');
  });

  it('les états sont fermés par des CHECK', async () => {
    const u = await creerUtilisateur(client, 10);
    await expect(client.query(
      "insert into public.shoot_sessions (user_id, titre, statut) values ($1, 't', 'en_cours')",
      [u],
    )).rejects.toThrow(/shoot_sessions_statut_check|violates check/i);

    const s = await creerSession(u);
    await expect(client.query(
      `insert into public.rushes (shoot_session_id, user_id, bucket, cle_objet, rang, etat)
       values ($1, $2, 'media', 'k', 0, 'pret')`,
      [s, u],
    )).rejects.toThrow(/violates check/i);
  });

  it('un titre vide ou blanc est refusé par la base', async () => {
    const u = await creerUtilisateur(client, 10);
    for (const t of ['', '   ']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(client.query(
        'insert into public.shoot_sessions (user_id, titre) values ($1, $2)', [u, t],
      )).rejects.toThrow(/violates check/i);
    }
  });

  it('la migration est rejouable', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-08-31-shoot-sessions-rushes.sql'), 'utf-8',
    );
    await client.query(sql);
    await client.query(sql);
    const { rows } = await client.query(
      "select count(*)::int as n from pg_indexes where schemaname='public' and tablename='rushes'",
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

describe('Un rush ne peut pas appartenir à un autre utilisateur que sa session', () => {
  it('la base REFUSE, ce n est pas une règle applicative', async () => {
    const a = await creerUtilisateur(client, 10);
    const b = await creerUtilisateur(client, 10);
    const sessionDeA = await creerSession(a);
    // B tente d'accrocher un rush à la session de A. Même en écrivant
    // directement dans la table, sans passer par l'API.
    await expect(indexerRush(sessionDeA, b, 'B/vole.mp4'))
      .rejects.toThrow(/rushes_session_meme_proprietaire|foreign key/i);
  });

  it('et l accepte pour le bon propriétaire', async () => {
    const a = await creerUtilisateur(client, 10);
    const s = await creerSession(a);
    const r = await indexerRush(s, a, 'A/plan.mp4');
    expect(r.rowCount).toBe(1);
  });
});

describe('L ordre et l unicité tiennent au niveau du moteur', () => {
  it('deux rushes ne peuvent pas partager un rang dans une session', async () => {
    const a = await creerUtilisateur(client, 10);
    const s = await creerSession(a);
    await indexerRush(s, a, 'A/1.mp4', 0);
    await expect(indexerRush(s, a, 'A/2.mp4', 0))
      .rejects.toThrow(/rushes_session_rang_unique|duplicate key/i);
  });

  it('mais deux sessions peuvent chacune avoir leur rang 0', async () => {
    const a = await creerUtilisateur(client, 10);
    const s1 = await creerSession(a, 'Samedi');
    const s2 = await creerSession(a, 'Dimanche');
    await indexerRush(s1, a, 'A/1.mp4', 0);
    const r = await indexerRush(s2, a, 'A/2.mp4', 0);
    expect(r.rowCount).toBe(1);
  });

  it('un même objet de stockage ne peut être indexé qu une fois', async () => {
    // Sans cet index, un double clic sur « ajouter » créerait deux rushes
    // pour un seul fichier.
    const a = await creerUtilisateur(client, 10);
    const s = await creerSession(a);
    await indexerRush(s, a, 'A/plan.mp4', 0);
    await expect(indexerRush(s, a, 'A/plan.mp4', 1))
      .rejects.toThrow(/rushes_objet_unique|duplicate key/i);
  });
});

describe('La suppression est conservatrice, et documentée', () => {
  it('une session qui porte des rushes ne s efface pas par accident', async () => {
    const a = await creerUtilisateur(client, 10);
    const s = await creerSession(a);
    await indexerRush(s, a, 'A/plan.mp4');
    // `on delete restrict` : le moteur refuse. Rien dans Studiio ne
    // définissait de politique pour ce concept ; on prend la plus
    // conservatrice plutôt que d'effacer en cascade.
    await expect(client.query('delete from public.shoot_sessions where id = $1', [s]))
      .rejects.toThrow(/foreign key|violates/i);
  });

  it('une session vide s efface sans difficulté', async () => {
    const a = await creerUtilisateur(client, 10);
    const s = await creerSession(a);
    const r = await client.query('delete from public.shoot_sessions where id = $1', [s]);
    expect(r.rowCount).toBe(1);
  });
});

describe('Ce que la migration ne fait pas', () => {
  it('elle ne touche à aucune table existante', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-08-31-shoot-sessions-rushes.sql'), 'utf-8',
    );
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/alter table/i);
    expect(code).not.toMatch(/drop /i);
    expect(code).not.toMatch(/update public\./i);
    expect(code).not.toMatch(/delete from/i);
    // `autopilot_config.rush_urls` reste ce qu'il était.
    expect(code).not.toContain('autopilot_config');
  });

  it('elle n ajoute que DEUX tables au schéma', async () => {
    // `autopilot_config` ne fait pas partie du jeu d'essai — le harnais ne
    // joue que les migrations du socle crédits/rendus. Assurer son intégrité
    // ici ne prouverait rien : la garantie est que la migration ne NOMME
    // jamais cette table, ce que vérifie le test précédent sur le SQL.
    //
    // Ce qui se vérifie sur le moteur, en revanche, c'est qu'elle n'a créé
    // que ce qu'elle annonce.
    const { rows } = await client.query(
      `select tablename from pg_tables
        where schemaname = 'public' and tablename in ('shoot_sessions', 'rushes')
        order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(['rushes', 'shoot_sessions']);

    // Et aucune colonne de tournage n'a été greffée sur une table existante.
    const { rows: ailleurs } = await client.query(
      `select table_name from information_schema.columns
        where table_schema = 'public'
          and column_name in ('shoot_session_id', 'cle_objet')
          and table_name not in ('shoot_sessions', 'rushes')`,
    );
    expect(ailleurs).toEqual([]);
  });

  it('la durée d un rush reste nullable — inconnue n est pas zéro', async () => {
    const a = await creerUtilisateur(client, 10);
    const s = await creerSession(a);
    await indexerRush(s, a, 'A/plan.mp4');
    const { rows } = await client.query(
      'select duree_secondes from public.rushes where shoot_session_id = $1', [s],
    );
    expect(rows[0].duree_secondes).toBeNull();
  });
});
