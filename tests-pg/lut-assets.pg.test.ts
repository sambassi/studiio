/**
 * A2 — `lut_assets` sur un VRAI PostgreSQL.
 *
 * Ce que seule la base peut prouver, et que ces tests prouvent sur la
 * migration de production (jamais recopiée) :
 *
 * 1. Le plafond de 40 est ATOMIQUE : 39 fiches, deux imports concurrents de
 *    deux empreintes différentes → exactement 40, un seul « creee ».
 * 2. La déduplication est atomique : la même empreinte importée N fois en
 *    même temps → une seule fiche, un seul « creee ».
 * 3. Les `check` portent le contrat A1 : nature/taille, empreinte, clé du
 *    compte, domaines à trois valeurs, nom non vide.
 * 4. La cascade : supprimer le compte emporte ses fiches.
 * 5. La migration est rejouable.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  connecter, preparerBase, rejouerMigration, creerUtilisateur, enConcurrence,
} from './harness';
import { LUTS_MAX } from '../src/lib/luts/bibliotheque';

let db: Client;
beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });
beforeEach(async () => { await preparerBase(db); });

const E = (n: number) => n.toString(16).padStart(64, '0');
const cle = (u: string, e: string) => `${u}/lut/${e}.cube`;

async function ajouter(
  client: Client, u: string, e: string, over: Partial<{
    nom: string; kind: string; taille: number; cle: string;
    octets: number; domainMin: number[]; domainMax: number[];
  }> = {},
) {
  const { rows } = await client.query<{ issue: string; id: string | null }>(
    `select issue, id from public.lut_assets_ajouter($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      u, e, over.cle ?? cle(u, e), over.nom ?? 'Look', null,
      over.kind ?? '3d', 'cube', over.taille ?? 33, over.octets ?? 1000,
      over.domainMin ?? [0, 0, 0], over.domainMax ?? [1, 1, 1],
    ],
  );
  return rows[0];
}

const SIGNATURE = 'uuid,text,text,text,text,text,text,integer,integer,double precision[],double precision[]';

const compter = async (u: string) => Number(
  (await db.query('select count(*)::int as n from public.lut_assets where user_id = $1', [u])).rows[0].n,
);

async function insererBrut(u: string, over: Record<string, unknown> = {}) {
  const v = {
    empreinte: E(1), cle: cle(u, E(1)), nom: 'Look', kind: '3d', origine: 'cube',
    taille: 33, octets: 1000, domain_min: [0, 0, 0], domain_max: [1, 1, 1], ...over,
  };
  return db.query(
    `insert into public.lut_assets
       (user_id, empreinte, cle, nom, kind, origine, taille, octets, domain_min, domain_max)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [u, v.empreinte, v.cle, v.nom, v.kind, v.origine, v.taille, v.octets, v.domain_min, v.domain_max],
  );
}

describe('0. La migration', () => {
  it('est rejouable sans erreur', async () => {
    await expect(rejouerMigration(db)).resolves.not.toThrow();
  });

  it('⚠️ le plafond est écrit DANS LA BASE, à 40, et vaut LUTS_MAX', async () => {
    const { rows } = await db.query('select public.lut_assets_plafond() as n');
    expect(rows[0].n).toBe(40);
    expect(rows[0].n).toBe(LUTS_MAX);
  });

  it('⚠️ il est IMPOSSIBLE de demander un plafond : la fonction n’a pas ce paramètre', async () => {
    const u = await creerUtilisateur(db, 0);
    await expect(db.query(
      `select * from public.lut_assets_ajouter($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [u, E(1), cle(u, E(1)), 'Look', null, '3d', 'cube', 33, 1000, [0, 0, 0], [1, 1, 1], 100],
    )).rejects.toThrow(/does not exist|no function matches/i);
    // Et l'ancienne signature n'existe sous aucune forme.
    const { rows } = await db.query(
      `select count(*)::int as n from pg_proc where proname = 'lut_assets_ajouter'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('⚠️ même une insertion DIRECTE ne dépasse pas 40 — le déclencheur le refuse', async () => {
    const u = await creerUtilisateur(db, 0);
    for (let i = 1; i <= 40; i++) await ajouter(db, u, E(i));
    await expect(insererBrut(u, { empreinte: E(41), cle: cle(u, E(41)) })).rejects.toThrow(/lut_assets_plafond/);
    expect(await compter(u)).toBe(40);
  });

  it('⚠️ 39 fiches + 2 insertions DIRECTES concurrentes → exactement 40', async () => {
    const u = await creerUtilisateur(db, 0);
    for (let i = 1; i <= 39; i++) await ajouter(db, u, E(i));
    const resultats = await enConcurrence(2, (client, i) => client.query(
      `insert into public.lut_assets (user_id, empreinte, cle, nom, kind, origine, taille, octets)
       values ($1,$2,$3,'Look','3d','cube',33,1000)`,
      [u, E(300 + i), cle(u, E(300 + i))],
    ));
    expect(resultats.filter((r) => r.ok)).toHaveLength(1);
    expect(resultats.filter((r) => !r.ok && /lut_assets_plafond/.test(r.erreur))).toHaveLength(1);
    expect(await compter(u)).toBe(40);
  });
});

describe('0b. Droits d’exécution — la politique de production, reproduite', () => {
  /*
   * Correspondance harnais ↔ production :
   *   - `current_user` (studiio_ci, qui joue la migration) ↔ `studiio`, le rôle
   *     de PGRST_DB_URI / PGRST_DB_ANON_ROLE / JWT `role=studiio`, seul rôle SQL
   *     de production, qui joue aussi les migrations : PROPRIÉTAIRE.
   *   - `role_navigateur`, `anon`, `authenticated` ↔ tout rôle qui ne serait
   *     pas propriétaire (aucun n'existe en production aujourd'hui ; s'ils
   *     apparaissaient, ils n'auraient rien).
   */
  beforeEach(async () => {
    await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$`);
  });

  const peut = async (role: string, fn = `public.lut_assets_ajouter(${SIGNATURE})`) => (
    await db.query(`select has_function_privilege($1, $2, 'execute') as peut`, [role, fn])
  ).rows[0].peut as boolean;

  it('⚠️ public, role_navigateur, anon, authenticated → EXECUTE = false', async () => {
    for (const role of ['role_navigateur', 'anon', 'authenticated']) {
      expect(await peut(role), role).toBe(false);
      expect(await peut(role, 'public.lut_assets_plafond()'), role).toBe(false);
      expect(await peut(role, 'public.lut_assets_verifier_plafond()'), role).toBe(false);
    }
    const { rows } = await db.query(
      `select proacl from pg_proc where proname = 'lut_assets_ajouter'`,
    );
    // Aucune entrée `=X/…` (grant à PUBLIC) dans l'ACL.
    expect(String(rows[0].proacl ?? '')).not.toMatch(/(^|[{,])=X/);
  });

  it('⚠️ le rôle serveur (propriétaire, comme `studiio` en production) → EXECUTE = true', async () => {
    const { rows } = await db.query('select current_user as r');
    expect(await peut(rows[0].r)).toBe(true);
    const { rows: prop } = await db.query(
      `select pg_get_userbyid(proowner) = current_user as proprietaire, prosecdef
         from pg_proc where proname = 'lut_assets_ajouter'`,
    );
    expect(prop[0].proprietaire).toBe(true);
    expect(prop[0].prosecdef).toBe(true); // security definer
  });

  it('un rôle nommé `studiio` reçoit EXECUTE nommément, même s’il n’est pas propriétaire', async () => {
    await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'studiio') then create role studiio nologin; end if;
    end $$`);
    await rejouerMigration(db);
    expect(await peut('studiio')).toBe(true);
    expect(await peut('role_navigateur')).toBe(false);
  });
});

describe('1. ⚠️ LE PLAFOND EST ATOMIQUE', () => {
  it('39 fiches + 2 imports concurrents d’empreintes différentes → exactement 40, un seul « creee »', async () => {
    const u = await creerUtilisateur(db, 0);
    for (let i = 1; i <= 39; i++) expect((await ajouter(db, u, E(i))).issue).toBe('creee');
    expect(await compter(u)).toBe(39);

    const resultats = await enConcurrence(2, (client, i) => ajouter(client, u, E(100 + i)));
    const issues = resultats.map((r) => (r.ok ? r.valeur.issue : `erreur:${r.erreur}`)).sort();
    expect(issues).toEqual(['creee', 'pleine']);
    expect(await compter(u)).toBe(40);
  });

  it('à 40, un import supplémentaire est refusé « pleine » ; un doublon reste « existante »', async () => {
    const u = await creerUtilisateur(db, 0);
    for (let i = 1; i <= 40; i++) await ajouter(db, u, E(i));
    expect((await ajouter(db, u, E(41))).issue).toBe('pleine');
    // Le doublon est tranché AVANT le plafond : rien n'est ajouté, rien ne déborde.
    expect((await ajouter(db, u, E(7))).issue).toBe('existante');
    expect(await compter(u)).toBe(40);
  });

  it('38 fiches + 8 imports concurrents → exactement 40, deux « creee »', async () => {
    const u = await creerUtilisateur(db, 0);
    for (let i = 1; i <= 38; i++) await ajouter(db, u, E(i));
    const resultats = await enConcurrence(8, (client, i) => ajouter(client, u, E(200 + i)));
    const creees = resultats.filter((r) => r.ok && r.valeur.issue === 'creee').length;
    expect(creees).toBe(2);
    expect(await compter(u)).toBe(40);
  });

  it('le verrou est PAR COMPTE : deux comptes ne s’attendent pas et ne se comptent pas', async () => {
    const a = await creerUtilisateur(db, 0);
    const b = await creerUtilisateur(db, 0);
    for (let i = 1; i <= 40; i++) await ajouter(db, a, E(i));
    expect((await ajouter(db, b, E(1))).issue).toBe('creee');
    expect(await compter(b)).toBe(1);
  });
});

describe('2. ⚠️ LA DÉDUPLICATION EST ATOMIQUE', () => {
  it('la même empreinte importée 6 fois en même temps → une fiche, un seul « creee »', async () => {
    const u = await creerUtilisateur(db, 0);
    const resultats = await enConcurrence(6, (client) => ajouter(client, u, E(42)));
    const issues = resultats.map((r) => (r.ok ? r.valeur.issue : `erreur:${r.erreur}`));
    expect(issues.filter((i) => i === 'creee')).toHaveLength(1);
    expect(issues.filter((i) => i === 'existante')).toHaveLength(5);
    expect(await compter(u)).toBe(1);
    // Tous rendent le MÊME identifiant : une seule ressource logique.
    const ids = new Set(resultats.map((r) => (r.ok ? r.valeur.id : null)));
    expect(ids.size).toBe(1);
  });

  it('même empreinte chez deux comptes = deux fiches (la clé est par compte)', async () => {
    const a = await creerUtilisateur(db, 0);
    const b = await creerUtilisateur(db, 0);
    expect((await ajouter(db, a, E(5))).issue).toBe('creee');
    expect((await ajouter(db, b, E(5))).issue).toBe('creee');
  });

  it('l’index unique refuse aussi une insertion directe en doublon', async () => {
    const u = await creerUtilisateur(db, 0);
    await insererBrut(u);
    await expect(insererBrut(u)).rejects.toThrow(/lut_assets_user_empreinte_key|duplicate key/i);
  });
});

describe('3. Les CHECK portent le contrat A1', () => {
  it('3D : 65 accepté, 66 refusé ; 1D : 65536 accepté, 65537 refusé', async () => {
    const u = await creerUtilisateur(db, 0);
    expect((await ajouter(db, u, E(1), { kind: '3d', taille: 65 })).issue).toBe('creee');
    await expect(ajouter(db, u, E(2), { kind: '3d', taille: 66 })).rejects.toThrow(/lut_assets_taille_par_nature/);
    expect((await ajouter(db, u, E(3), { kind: '1d', taille: 65536 })).issue).toBe('creee');
    await expect(ajouter(db, u, E(4), { kind: '1d', taille: 65537 })).rejects.toThrow(/lut_assets_taille_par_nature/);
    await expect(ajouter(db, u, E(5), { kind: '3d', taille: 1 })).rejects.toThrow(/lut_assets_taille_par_nature/);
    await expect(ajouter(db, u, E(6), { kind: '2d', taille: 8 })).rejects.toThrow(/check/i);
  });

  it('octets : 0 et > 8 Mio refusés', async () => {
    const u = await creerUtilisateur(db, 0);
    await expect(ajouter(db, u, E(1), { octets: 0 })).rejects.toThrow(/check/i);
    await expect(ajouter(db, u, E(2), { octets: 8388609 })).rejects.toThrow(/check/i);
    expect((await ajouter(db, u, E(3), { octets: 8388608 })).issue).toBe('creee');
  });

  it('empreinte : exactement 64 hexadécimaux minuscules', async () => {
    const u = await creerUtilisateur(db, 0);
    await expect(insererBrut(u, { empreinte: 'A'.repeat(64), cle: cle(u, 'A'.repeat(64)) })).rejects.toThrow(/check/i);
    await expect(insererBrut(u, { empreinte: 'a'.repeat(63), cle: cle(u, 'a'.repeat(63)) })).rejects.toThrow(/check/i);
  });

  it('⚠️ la clé est EXACTEMENT celle du compte — autrui, traversée, URL, extension refusés', async () => {
    const a = await creerUtilisateur(db, 0);
    const b = await creerUtilisateur(db, 0);
    await expect(insererBrut(a, { cle: cle(b, E(1)) })).rejects.toThrow(/lut_assets_cle_du_compte/);
    await expect(insererBrut(a, { cle: `${a}/lut/../rush/x.mp4` })).rejects.toThrow(/lut_assets_cle_du_compte/);
    await expect(insererBrut(a, { cle: `https://x/${a}/lut/${E(1)}.cube` })).rejects.toThrow(/lut_assets_cle/);
    await expect(insererBrut(a, { cle: `${a}/lut/${E(1)}.png` })).rejects.toThrow(/lut_assets_cle_du_compte/);
    await expect(insererBrut(a, { cle: `${a}/rush/${E(1)}.cube` })).rejects.toThrow(/lut_assets_cle_du_compte/);
    await expect(insererBrut(a)).resolves.toBeDefined();
  });

  it('⚠️ domain_min / domain_max : exactement trois valeurs, une dimension', async () => {
    const u = await creerUtilisateur(db, 0);
    await expect(insererBrut(u, { domain_min: [0, 0] })).rejects.toThrow(/lut_assets_domain_min_3/);
    await expect(insererBrut(u, { domain_max: [1, 1, 1, 1] })).rejects.toThrow(/lut_assets_domain_max_3/);
    // Le tableau VIDE est le piège : `array_length('{}')` est NULL, et un CHECK
    // NULL passe. Ce cas a réellement traversé une première rédaction.
    await expect(insererBrut(u, { domain_min: [] })).rejects.toThrow(/lut_assets_domain_min_3/);
    await expect(insererBrut(u, { domain_max: [] })).rejects.toThrow(/lut_assets_domain_max_3/);
    await expect(insererBrut(u, { empreinte: E(9), cle: cle(u, E(9)), domain_min: [0, 0, 0], domain_max: [4, 4, 4] })).resolves.toBeDefined();
  });

  it('nom : vide ou blanc refusé, 100 accepté, 101 refusé', async () => {
    const u = await creerUtilisateur(db, 0);
    await expect(ajouter(db, u, E(1), { nom: '' })).rejects.toThrow(/check/i);
    await expect(ajouter(db, u, E(2), { nom: '   ' })).rejects.toThrow(/check/i);
    expect((await ajouter(db, u, E(3), { nom: 'x'.repeat(100) })).issue).toBe('creee');
    await expect(ajouter(db, u, E(4), { nom: 'x'.repeat(101) })).rejects.toThrow(/check/i);
  });

  it('un compte inconnu est refusé par la clé étrangère', async () => {
    await expect(ajouter(db, '00000000-0000-4000-8000-000000000000', E(1))).rejects.toThrow(/foreign key|violates/i);
  });
});

describe('4. Propriété et cascade', () => {
  it('supprimer le compte emporte ses fiches, et seulement les siennes', async () => {
    const a = await creerUtilisateur(db, 0);
    const b = await creerUtilisateur(db, 0);
    await ajouter(db, a, E(1));
    await ajouter(db, b, E(2));
    await db.query('delete from public.users where id = $1', [a]);
    expect(await compter(a)).toBe(0);
    expect(await compter(b)).toBe(1);
  });

  it('une suppression filtrée par le compte ne touche jamais la fiche d’autrui', async () => {
    const a = await creerUtilisateur(db, 0);
    const b = await creerUtilisateur(db, 0);
    await ajouter(db, a, E(1));
    await ajouter(db, b, E(1));
    const { rowCount } = await db.query(
      'delete from public.lut_assets where user_id = $1 and empreinte = $2', [a, E(1)],
    );
    expect(rowCount).toBe(1);
    expect(await compter(b)).toBe(1);
  });
});
