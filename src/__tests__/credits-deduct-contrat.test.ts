/**
 * `/api/credits/deduct` : le contrat serveur.
 *
 * La route lisait `{ cost }` dans le corps et débitait ce montant. Le
 * navigateur choisissait donc ce qu'il payait — `cost: 1` pour un rendu TV
 * facturé 15 — et rien ne reliait ce nombre à un travail effectué.
 *
 * Ces tests APPELLENT la route. Grepper le source ne suffirait pas : la liste
 * des champs interdits pourrait être présente, importée, et jamais consultée.
 *
 * L'atomicité et l'idempotence, elles, ne se testent pas ici : ce sont des
 * propriétés du moteur, prouvées sur un vrai PostgreSQL dans
 * `tests-pg/credits-atomiques.pg.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CHAMPS_INTERDITS, referenceRendu } from '@/lib/credits/atomique';

const authMock = vi.fn();

/** Ce que le serveur a réellement demandé à la base. */
const rpcAppels: Array<{ nom: string; args: Record<string, unknown> }> = [];
const tablesLues: string[] = [];
let post: Record<string, unknown> | null = null;
let reponseRpc: unknown = [{ ok: true, solde: 90, deja_debite: false, motif: null }];
let erreurRpc: unknown = null;

function makeQuery(table: string) {
  tablesLues.push(table);
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    insert: () => { throw new Error('insert interdit'); },
    update: () => { throw new Error('update interdit'); },
    delete: () => { throw new Error('delete interdit'); },
    maybeSingle: async () => ({ data: post, error: null }),
    single: async () => ({ data: post, error: null }),
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => makeQuery(t),
    rpc: async (nom: string, args: Record<string, unknown>) => {
      rpcAppels.push({ nom, args });
      return { data: reponseRpc, error: erreurRpc };
    },
  },
  supabase: { from: (t: string) => makeQuery(t) },
}));

const { POST } = await import('@/app/api/credits/deduct/route');

const appeler = async (body: unknown) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  rpcAppels.length = 0;
  tablesLues.length = 0;
  post = { id: 'post-1', format: 'reel', user_id: 'moi' };
  // La route relit `users.role` : sans role explicite, la politique retombe
  // sur `credits`, ce que ces tests attendent.
  reponseRpc = [{ ok: true, solde: 90, deja_debite: false, motif: null }];
  erreurRpc = null;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'moi' } });
});

describe('Accès', () => {
  it('401 sans session, sans toucher la base', async () => {
    authMock.mockResolvedValue(null);
    const r = await appeler({ postId: 'post-1' });
    expect(r.status).toBe(401);
    expect(tablesLues).toEqual([]);
    expect(rpcAppels).toEqual([]);
  });
});

describe('1 & 2 & 3. Aucun montant, aucune identité venus du client', () => {
  CHAMPS_INTERDITS.forEach((champ) => {
    it(`refuse « ${champ} », sans rien débiter`, async () => {
      const r = await appeler({ postId: 'post-1', [champ]: 1 });
      expect(r.status).toBe(422);
      expect(r.body.error).toContain(champ);
      expect(rpcAppels).toEqual([]);
    });
  });

  it('la liste des champs interdits reste complète', () => {
    expect([...CHAMPS_INTERDITS]).toEqual(
      ['cost', 'amount', 'credits', 'user_id', 'userId', 'reference', 'reference_id'],
    );
  });

  it('un cost à 0 est refusé comme les autres — c est le CHAMP qui est interdit', async () => {
    const r = await appeler({ postId: 'post-1', cost: 0 });
    expect(r.status).toBe(422);
  });

  it('le corps ne porte plus que postId', async () => {
    const r = await appeler({ postId: 'post-1' });
    expect(r.status).toBe(200);
  });
});

describe('4. Le prix et l identité sont décidés par le serveur', () => {
  it("passe l'identifiant de la SESSION, jamais celui du corps", async () => {
    await appeler({ postId: 'post-1' });
    expect(rpcAppels[0].args.p_user_id).toBe('moi');
  });

  it('lit le format SUR LE POST, pas dans le corps', async () => {
    post = { id: 'post-1', format: 'tv', user_id: 'moi' };
    await appeler({ postId: 'post-1' });
    expect(rpcAppels[0].args.p_format).toBe('tv');
  });

  it('un format inconnu sur le post retombe sur reel, jamais sur du client', async () => {
    post = { id: 'post-1', format: 'carre', user_id: 'moi' };
    await appeler({ postId: 'post-1' });
    expect(rpcAppels[0].args.p_format).toBe('reel');
  });

  it('ne transmet AUCUN montant à la base', async () => {
    await appeler({ postId: 'post-1' });
    const args = rpcAppels[0].args;
    expect(Object.keys(args).sort()).toEqual(['p_format', 'p_reference', 'p_user_id']);
    expect(Object.values(args).some((v) => typeof v === 'number')).toBe(false);
  });
});

describe('Référence idempotente construite par le serveur', () => {
  it('dérive de l identifiant du post', async () => {
    await appeler({ postId: 'post-1' });
    expect(rpcAppels[0].args.p_reference).toBe(referenceRendu('post-1'));
    expect(rpcAppels[0].args.p_reference).toBe('rendu:post-1');
  });

  it("utilise l'identifiant relu en base, pas celui du corps", async () => {
    // Le post rendu par la base fait autorité : c'est lui qui a été vérifié.
    post = { id: 'post-verifie', format: 'reel', user_id: 'moi' };
    await appeler({ postId: 'post-1' });
    expect(rpcAppels[0].args.p_reference).toBe('rendu:post-verifie');
  });
});

describe('12 & 13. Propriété de la ressource', () => {
  it('un post introuvable ou appartenant à autrui est refusé', async () => {
    post = null;
    const r = await appeler({ postId: 'post-dautrui' });
    expect(r.status).toBe(404);
    expect(rpcAppels).toEqual([]);
  });

  it('la recherche filtre bien sur scheduled_posts', async () => {
    await appeler({ postId: 'post-1' });
    expect(tablesLues).toContain('scheduled_posts');
  });

  it('postId absent → 400 sans rien débiter', async () => {
    const r = await appeler({});
    expect(r.status).toBe(400);
    expect(rpcAppels).toEqual([]);
  });

  it('postId non textuel → 400', async () => {
    expect((await appeler({ postId: 42 })).status).toBe(400);
    expect((await appeler({ postId: '' })).status).toBe(400);
    expect(rpcAppels).toEqual([]);
  });

  it('corps non-objet → 422 sans rien débiter', async () => {
    expect((await appeler('bonjour')).status).toBe(422);
    expect((await appeler([{ postId: 'x' }])).status).toBe(422);
    expect(rpcAppels).toEqual([]);
  });
});

describe('Rejeu — même résultat métier, sans second débit', () => {
  it('rend 200 et signale que le débit avait déjà eu lieu', async () => {
    reponseRpc = [{ ok: true, solde: 90, deja_debite: true, motif: null }];
    const r = await appeler({ postId: 'post-1' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.dejaDebite).toBe(true);
    expect(r.body.balance).toBe(90);
  });

  it('solde insuffisant → 402 avec le motif', async () => {
    reponseRpc = [{ ok: false, solde: 5, deja_debite: false, motif: 'solde_insuffisant' }];
    const r = await appeler({ postId: 'post-1' });
    expect(r.status).toBe(402);
    expect(r.body.motif).toBe('solde_insuffisant');
  });
});

describe('Migration non appliquée — on le dit, on n invente pas', () => {
  it('répond 503 plutôt que 500 quand la fonction est absente', async () => {
    erreurRpc = { code: '42883', message: 'function public.debiter_credits does not exist' };
    const r = await appeler({ postId: 'post-1' });
    expect(r.status).toBe(503);
    expect(r.body.error).toContain('migration');
  });

  it('reconnaît aussi le cache de schéma PostgREST', async () => {
    erreurRpc = { code: 'PGRST202', message: 'Could not find the function in the schema cache' };
    expect((await appeler({ postId: 'post-1' })).status).toBe(503);
  });
});

describe('Aucun effet de bord', () => {
  it("n'écrit dans aucune table depuis la route", async () => {
    // Tout passe par la fonction SQL : la route ne fait que lire le post.
    await appeler({ postId: 'post-1' });
    expect(rpcAppels).toHaveLength(1);
    expect(rpcAppels[0].nom).toBe('debiter_credits');
  });

  it('ne lit users QUE pour resoudre la politique, et n y ecrit jamais', async () => {
    // La route lit desormais `users.role` : c'est la base, et elle seule, qui
    // decide si ce compte paie en credits. Le faux client leve sur toute
    // ecriture, donc une modification ferait tomber ce test.
    await appeler({ postId: 'post-1' });
    expect(tablesLues).toContain('users');
    expect(tablesLues).not.toContain('credit_transactions');
  });

  it('ne touche jamais credit_transactions directement', async () => {
    // Le journal n'est ecrit que par la fonction SQL, dans sa transaction.
    await appeler({ postId: 'post-1' });
    expect(tablesLues).not.toContain('credit_transactions');
    expect(rpcAppels[0].nom).toBe('debiter_credits');
  });
});

describe('15 & 16 & 17. Le reste du système est intact', () => {
  it('le mode Série est ouvert en PILOTE, et plafonné à 2', async () => {
    // Il a ete rouvert une fois les credits securises. Ce qui doit rester
    // verifie ici, c'est le PLAFOND : le pilote ne va pas au-dela de deux.
    const { BATCH_SERIE_DISPONIBLE, BATCH_SERIE_MAX, batchCountAutorise } =
      await import('@/lib/creer/batchDisponible');
    expect(BATCH_SERIE_DISPONIBLE).toBe(true);
    expect(BATCH_SERIE_MAX).toBe(2);
    expect(batchCountAutorise(10)).toBe(2);
  });

  it('/api/render/batch reste désactivée', async () => {
    const { BATCH_RENDER_DESACTIVE } = await import('@/lib/render/batch-disabled');
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });

  it('la source canonique du prix est inchangée', async () => {
    const { RENDER_COSTS } = await import('@/lib/stripe/constants');
    expect(RENDER_COSTS).toEqual({ reel: 10, tv: 15 });
  });

  it('la route ne publie rien', async () => {
    await appeler({ postId: 'post-1' });
    expect(tablesLues).not.toContain('social_accounts');
    expect(tablesLues).not.toContain('publishing_history');
  });
});
