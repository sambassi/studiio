/**
 * CREER_PREMIUM_3D_FIX — LA BANQUE AUDIO NE PERD PLUS DE PISTE.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CES TESTS EXIGENT UN VRAI POSTGRESQL
 * ---------------------------------------------------------------------------
 *
 * Ce qui est mesure ici n'est pas une decision — les decisions se lisent dans
 * le SQL. C'est un COMPORTEMENT DU MOTEUR : qu'un `select … for update` fasse
 * ATTENDRE la seconde transaction, et qu'elle relise ensuite la liste TELLE
 * QU'ELLE EST DEVENUE. Un faux client rejoue ce qu'on lui programme ; il
 * « prouverait » aussi bien une implementation cassee.
 *
 * ⚠️ AUCUN SQL N'EST RECOPIE. Le fichier de migration destine a la production
 * est joue tel quel.
 *
 * ---------------------------------------------------------------------------
 * LE CHEVAUCHEMENT EST FORCE, PAS ESPERE
 * ---------------------------------------------------------------------------
 *
 * Un test qui lancerait deux requetes « en meme temps » et croiserait les
 * doigts passerait la plupart du temps, y compris sur l'implementation
 * fautive. Ici, une transaction tierce PREND le verrou de la ligne et le
 * garde ; l'appel concurrent est alors OBLIGE d'attendre. On observe qu'il
 * attend, puis on relache, puis on observe le resultat. Aucune horloge, aucun
 * `sleep` porte-bonheur.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import { connecter, creerUtilisateur, preparerBaseBanqueAudio } from './harness';

let db: Client;
let userId: string;

/** Une fiche de piste minimale — la forme reelle vient de `PisteAudio`. */
function piste(cle: string, extra: Record<string, unknown> = {}) {
  return {
    cle,
    nom: cle.split('/').pop(),
    moods: [],
    dureeMs: 4000,
    silenceInitialMs: 0,
    octets: 65244,
    empreinte: `e-${cle}`,
    droitsConfirmesLe: '2026-09-09T10:00:00.000Z',
    ...extra,
  };
}

async function ajouter(client: Client, id: string, cle: string, max = 200, extra = {}) {
  const { rows } = await client.query<{ issue: string; pistes: unknown[] }>(
    'select issue, pistes from public.autopilot_banque_audio_ajouter($1, $2, $3)',
    [id, JSON.stringify(piste(cle, extra)), max],
  );
  return rows[0];
}

async function clesPersistees(id: string): Promise<string[]> {
  const { rows } = await db.query<{ cle: string }>(
    `select x->>'cle' as cle
       from public.autopilot_config c,
            jsonb_array_elements(
              coalesce(c.design_style->'bibliothequeCreative'->'audio'->'pistes',
                       '[]'::jsonb)) x
      where c.user_id = $1`,
    [id],
  );
  return rows.map((r) => r.cle);
}

beforeAll(async () => { db = await connecter(); });
afterAll(async () => { await db.end(); });

beforeEach(async () => {
  await preparerBaseBanqueAudio(db);
  userId = await creerUtilisateur(db, 100);
});

describe('la course que corrige la migration', () => {
  /**
   * ⚠️ CE TEST DECRIT L'ANCIENNE IMPLEMENTATION, ET IL DOIT RESTER VERT.
   *
   * Il ne teste pas le correctif : il PROUVE que le defaut existait, en
   * rejouant exactement ce que faisait la route — lire, calculer la liste en
   * memoire, reecrire la liste entiere. Aucune concurrence hasardeuse : les
   * deux lectures ont lieu avant les deux ecritures, ce qui est precisement
   * l'entrelacement que deux imports simultanes produisent.
   *
   * Sans lui, rien ne distinguerait « le correctif marche » de « la course ne
   * s'est pas produite pendant le test ».
   */
  it('lire-modifier-ecrire perd une piste, de facon deterministe', async () => {
    await db.query(
      `insert into public.autopilot_config (user_id, design_style)
       values ($1, jsonb_build_object('bibliothequeCreative',
                jsonb_build_object('audio', jsonb_build_object('pistes', '[]'::jsonb))))`,
      [userId],
    );

    // Les deux requetes lisent la MEME liste — c'est l'etat de depart commun.
    const lue = await db.query<{ pistes: unknown[] }>(
      `select coalesce(design_style->'bibliothequeCreative'->'audio'->'pistes','[]'::jsonb)
              as pistes from public.autopilot_config where user_id = $1`,
      [userId],
    );
    const depart = lue.rows[0].pistes as unknown[];
    expect(depart).toHaveLength(0);

    // Puis chacune ecrit SA version, calculee depuis cette lecture.
    for (const cle of [`${userId}/library/A.mp3`, `${userId}/library/B.mp3`]) {
      await db.query(
        `update public.autopilot_config
            set design_style = jsonb_set(design_style,
                  '{bibliothequeCreative,audio,pistes}', $2::jsonb, true)
          where user_id = $1`,
        [userId, JSON.stringify([...depart, piste(cle)])],
      );
    }

    // Deux ecritures, deux succes, UNE SEULE piste : la perte silencieuse.
    expect(await clesPersistees(userId)).toEqual([`${userId}/library/B.mp3`]);
  });
});

describe('ajout atomique', () => {
  it('deux ajouts distincts concurrents laissent DEUX pistes', async () => {
    const autre = await connecter();
    const bloqueur = await connecter();
    try {
      await ajouter(db, userId, `${userId}/library/socle.mp3`);

      // ── Le chevauchement, force ────────────────────────────────────────
      // Une transaction tierce prend le verrou de la ligne et le GARDE.
      await bloqueur.query('begin');
      await bloqueur.query(
        'select 1 from public.autopilot_config where user_id = $1 for update', [userId],
      );

      // L'ajout de A part maintenant : il ne peut PAS avancer.
      const a = ajouter(autre, userId, `${userId}/library/A.mp3`);
      let termine = false;
      void a.then(() => { termine = true; });
      // Une attente courte suffit a montrer qu'il est bloque — et si le verrou
      // ne tenait pas, `termine` passerait a vrai ici, ce que l'assertion voit.
      await new Promise((r) => { setTimeout(r, 250); });
      expect(termine).toBe(false);

      // Le verrou tombe : A passe, puis B, qui relit la liste APRES A.
      await bloqueur.query('commit');
      expect((await a).issue).toBe('creee');
      expect((await ajouter(db, userId, `${userId}/library/B.mp3`)).issue).toBe('creee');

      const cles = await clesPersistees(userId);
      expect(cles).toHaveLength(3);
      expect(cles).toContain(`${userId}/library/A.mp3`);
      expect(cles).toContain(`${userId}/library/B.mp3`);
    } finally {
      await autre.end();
      await bloqueur.end();
    }
  });

  it('dix ajouts distincts lances ensemble persistent tous', async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, () => connecter()));
    try {
      const issues = await Promise.all(
        clients.map((c, i) => ajouter(c, userId, `${userId}/library/p${i}.mp3`)),
      );
      expect(issues.every((r) => r.issue === 'creee')).toBe(true);

      // ⚠️ ON COMPTE CE QUI EST PERSISTE, PAS LES REPONSES. Dix `200` au-dessus
      // d'une banque a deux pistes, c'est exactement le defaut d'origine.
      const cles = await clesPersistees(userId);
      expect(new Set(cles).size).toBe(10);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it('dix ajouts de LA MEME piste ne font qu'
    + ' une seule fiche', async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, () => connecter()));
    try {
      const cle = `${userId}/library/meme.mp3`;
      const issues = await Promise.all(clients.map((c) => ajouter(c, userId, cle)));
      // Le contrat : une seule cree, les autres existantes — jamais deux fiches.
      expect(issues.filter((r) => r.issue === 'creee')).toHaveLength(1);
      expect(issues.filter((r) => r.issue === 'existante')).toHaveLength(9);
      expect(await clesPersistees(userId)).toEqual([cle]);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it('la date de confirmation des droits survit a une remise a jour', async () => {
    const cle = `${userId}/library/droits.mp3`;
    await ajouter(db, userId, cle, 200, { droitsConfirmesLe: '2026-01-01T00:00:00.000Z' });
    await ajouter(db, userId, cle, 200, { droitsConfirmesLe: '2026-12-31T00:00:00.000Z' });
    const { rows } = await db.query<{ d: string }>(
      `select (design_style->'bibliothequeCreative'->'audio'->'pistes'->0->>'droitsConfirmesLe') as d
         from public.autopilot_config where user_id = $1`,
      [userId],
    );
    expect(rows[0].d).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('capacite', () => {
  it('deux ajouts concurrents sur une banque a max-1 ne la font pas deborder', async () => {
    const MAX = 5;
    for (let i = 0; i < MAX - 1; i += 1) {
      await ajouter(db, userId, `${userId}/library/plein${i}.mp3`, MAX);
    }
    const a = await connecter();
    const b = await connecter();
    const bloqueur = await connecter();
    try {
      await bloqueur.query('begin');
      await bloqueur.query(
        'select 1 from public.autopilot_config where user_id = $1 for update', [userId],
      );
      const pa = ajouter(a, userId, `${userId}/library/derniere.mp3`, MAX);
      const pb = ajouter(b, userId, `${userId}/library/detrop.mp3`, MAX);
      await new Promise((r) => { setTimeout(r, 250); });
      await bloqueur.query('commit');

      const issues = [(await pa).issue, (await pb).issue];
      expect(issues.filter((x) => x === 'creee')).toHaveLength(1);
      expect(issues.filter((x) => x === 'pleine')).toHaveLength(1);
      expect(await clesPersistees(userId)).toHaveLength(MAX);
    } finally {
      await a.end(); await b.end(); await bloqueur.end();
    }
  });
});

describe('retrait et renommage', () => {
  it('un retrait concurrent d\'un ajout ne perd pas la piste ajoutee', async () => {
    const garde = `${userId}/library/garde.mp3`;
    const jete = `${userId}/library/jete.mp3`;
    await ajouter(db, userId, jete);

    const a = await connecter();
    const bloqueur = await connecter();
    try {
      await bloqueur.query('begin');
      await bloqueur.query(
        'select 1 from public.autopilot_config where user_id = $1 for update', [userId],
      );
      const ajout = ajouter(a, userId, garde);
      await new Promise((r) => { setTimeout(r, 250); });
      await bloqueur.query('commit');
      await ajout;

      await db.query(
        'select issue from public.autopilot_banque_audio_muter($1, $2, true, null, null)',
        [userId, jete],
      );

      // ⚠️ LE CŒUR DU §19 : le retrait relit la liste APRES l'ajout. Avec
      // l'ancienne reecriture globale, il l'aurait reposee sans `garde`.
      expect(await clesPersistees(userId)).toEqual([garde]);
    } finally {
      await a.end(); await bloqueur.end();
    }
  });

  it('retirer une piste la retire aussi des favoris et des autorisations', async () => {
    const cle = `${userId}/library/f.mp3`;
    await ajouter(db, userId, cle);
    await db.query(
      `update public.autopilot_config
          set design_style = jsonb_set(jsonb_set(design_style,
                '{bibliothequeCreative,favoris}',
                jsonb_build_object('audio', jsonb_build_array($2::text)), true),
                '{bibliothequeCreative,automatisation}',
                jsonb_build_object('autorises',
                  jsonb_build_object('audio', jsonb_build_array($2::text))), true)
        where user_id = $1`,
      [userId, cle],
    );

    await db.query(
      'select issue from public.autopilot_banque_audio_muter($1, $2, true, null, null)',
      [userId, cle],
    );

    const { rows } = await db.query<{ fav: unknown[]; aut: unknown[] }>(
      `select design_style->'bibliothequeCreative'->'favoris'->'audio' as fav,
              design_style->'bibliothequeCreative'->'automatisation'->'autorises'->'audio' as aut
         from public.autopilot_config where user_id = $1`,
      [userId],
    );
    expect(rows[0].fav).toEqual([]);
    expect(rows[0].aut).toEqual([]);
    expect(await clesPersistees(userId)).toEqual([]);
  });

  it('renommer ne touche qu\'a la piste visee', async () => {
    const un = `${userId}/library/un.mp3`;
    const deux = `${userId}/library/deux.mp3`;
    await ajouter(db, userId, un);
    await ajouter(db, userId, deux);

    const { rows } = await db.query<{ issue: string }>(
      'select issue from public.autopilot_banque_audio_muter($1, $2, false, $3, null)',
      [userId, un, 'Nouveau nom'],
    );
    expect(rows[0].issue).toBe('renommee');

    const { rows: noms } = await db.query<{ nom: string; cle: string }>(
      `select x->>'nom' as nom, x->>'cle' as cle
         from public.autopilot_config c,
              jsonb_array_elements(
                c.design_style->'bibliothequeCreative'->'audio'->'pistes') x
        where c.user_id = $1`,
      [userId],
    );
    expect(noms.find((n) => n.cle === un)?.nom).toBe('Nouveau nom');
    expect(noms.find((n) => n.cle === deux)?.nom).toBe('deux.mp3');
  });

  it('muter une cle absente ne cree rien', async () => {
    await ajouter(db, userId, `${userId}/library/seule.mp3`);
    const { rows } = await db.query<{ issue: string }>(
      'select issue from public.autopilot_banque_audio_muter($1, $2, true, null, null)',
      [userId, `${userId}/library/fantome.mp3`],
    );
    expect(rows[0].issue).toBe('absente');
    expect(await clesPersistees(userId)).toHaveLength(1);
  });
});

describe('cloisonnement des comptes', () => {
  it('un ajout n\'ecrit que dans la banque du compte vise', async () => {
    const autreUser = await creerUtilisateur(db, 100);
    await ajouter(db, userId, `${userId}/library/a-moi.mp3`);
    await ajouter(db, autreUser, `${autreUser}/library/a-lui.mp3`);

    expect(await clesPersistees(userId)).toEqual([`${userId}/library/a-moi.mp3`]);
    expect(await clesPersistees(autreUser)).toEqual([`${autreUser}/library/a-lui.mp3`]);
  });

  it('un compte inconnu ne fait rien ecrire nulle part', async () => {
    await ajouter(db, userId, `${userId}/library/a-moi.mp3`);
    const { rows } = await db.query<{ issue: string }>(
      'select issue from public.autopilot_banque_audio_ajouter(null, $1, 200)',
      [JSON.stringify(piste('x/library/y.mp3'))],
    );
    expect(rows[0].issue).toBe('argument_invalide');
    expect(await clesPersistees(userId)).toHaveLength(1);
  });
});

describe('la migration est rejouable', () => {
  it('l\'appliquer deux fois ne change rien au contenu', async () => {
    await ajouter(db, userId, `${userId}/library/avant.mp3`);
    const { readFileSync } = await import('fs');
    const { MIGRATION_BANQUE_AUDIO } = await import('./harness');
    await db.query(readFileSync(MIGRATION_BANQUE_AUDIO, 'utf-8'));
    expect(await clesPersistees(userId)).toEqual([`${userId}/library/avant.mp3`]);
    expect((await ajouter(db, userId, `${userId}/library/apres.mp3`)).issue).toBe('creee');
  });
});
