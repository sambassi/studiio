/**
 * La politique de facturation, côté serveur — et l'impossibilité de la
 * décider depuis le navigateur.
 *
 * Le défaut que ces tests ferment a été trouvé en production : l'écran
 * affichait `999 999 999` crédits à l'administrateur, une valeur inventée en
 * TypeScript. Depuis que le débit passe par le socle atomique — qui lit la
 * vraie colonne `users.credits` et ne connaît aucune exception —, ce nombre
 * ne correspondait plus à rien. Un rendu réel aurait décrémenté le solde
 * réel, éventuellement jusqu'au refus, pendant que l'écran promettait
 * l'infini.
 *
 * L'exemption existe toujours, mais c'est désormais une POLITIQUE, résolue
 * depuis le rôle lu en base — jamais depuis une liste d'e-mails codée dans le
 * bundle, jamais depuis le corps d'une requête.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  politiquePourRole, coutPartenaireVerifiable, consommeDesCredits,
  CHAMPS_INTERDITS_FACTURATION, LIBELLE_PARTENAIRES, ROLE_ADMIN,
} from '@/lib/facturation/politique';

const authMock = vi.fn();
const rpcAppels: Array<{ nom: string; args: Record<string, unknown> }> = [];
const tablesLues: string[] = [];
let ligneUser: Record<string, unknown> | null = null;
let lignePost: Record<string, unknown> | null = null;
let reponseRpc: unknown = null;

function makeQuery(table: string) {
  tablesLues.push(table);
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    insert: () => { throw new Error('insert interdit'); },
    update: () => { throw new Error('update interdit'); },
    maybeSingle: async () => ({
      data: table === 'users' ? ligneUser : lignePost, error: null,
    }),
    single: async () => ({
      data: table === 'users' ? ligneUser : lignePost, error: null,
    }),
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => makeQuery(t),
    rpc: async (nom: string, args: Record<string, unknown>) => {
      rpcAppels.push({ nom, args });
      return { data: reponseRpc, error: null };
    },
  },
  supabase: { from: (t: string) => makeQuery(t) },
}));

const { POST: DEDUIRE } = await import('@/app/api/credits/deduct/route');
const { GET: SOLDE } = await import('@/app/api/credits/balance/route');

const deduire = async (body: unknown) => {
  const res = await DEDUIRE({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};
const lireSolde = async () => {
  const res = await SOLDE({} as never);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  rpcAppels.length = 0;
  tablesLues.length = 0;
  ligneUser = { id: 'moi', credits: 42, role: 'user' };
  lignePost = { id: 'post-1', format: 'reel', user_id: 'moi' };
  reponseRpc = [{ ok: true, solde: 32, deja_debite: false, motif: null }];
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'moi' } });
});

// ════════════════════════════════════════════════════════════════════════════

describe('Le résolveur — fermé par défaut', () => {
  it("seul « admin » exact ouvre partner_cost_only", () => {
    expect(politiquePourRole('admin')).toBe('partner_cost_only');
    expect(ROLE_ADMIN).toBe('admin');
  });

  it('tout le reste retombe sur credits', () => {
    const autres: unknown[] = [
      'user', '', null, undefined, 'moderateur', 'administrateur',
      42, true, {}, [], 'super-admin', 'admins', 'admin-adjoint',
    ];
    for (const v of autres) expect(politiquePourRole(v)).toBe('credits');
  });

  it('la casse et les espaces sont tolérés, mais rien d autre', () => {
    // `Admin` et ` admin ` désignent bien le rôle : on normalise.
    expect(politiquePourRole('Admin')).toBe('partner_cost_only');
    expect(politiquePourRole(' admin ')).toBe('partner_cost_only');
    // Mais un rôle voisin n'est pas le rôle.
    expect(politiquePourRole('adminx')).toBe('credits');
  });

  it('consommeDesCredits dit la même chose, dans l autre sens', () => {
    expect(consommeDesCredits('credits')).toBe(true);
    expect(consommeDesCredits('partner_cost_only')).toBe(false);
  });
});

describe('Le coût partenaire n est jamais inventé', () => {
  it('une valeur absente ou illisible devient null, pas zéro', () => {
    for (const v of [undefined, null, 'gratuit', NaN, Infinity, -1, {}, []]) {
      expect(coutPartenaireVerifiable(v)).toBeNull();
    }
  });

  it('un nombre exact est conservé, zéro compris', () => {
    expect(coutPartenaireVerifiable(0.1875)).toBeCloseTo(0.1875);
    // `0` vérifié n'est pas `null` : gratuit et inconnu ne se confondent pas.
    expect(coutPartenaireVerifiable(0)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('1 & 10. Le rôle vient de la BASE, jamais du client', () => {
  it('administrateur en base → aucun débit', async () => {
    ligneUser = { id: 'moi', credits: 42, role: 'admin' };
    const r = await deduire({ postId: 'post-1' });
    expect(r.status).toBe(200);
    expect(r.body.politique).toBe('partner_cost_only');
    expect(r.body.balance).toBeNull();
    // Aucun appel à la fonction de débit.
    expect(rpcAppels).toEqual([]);
  });

  it('utilisateur en base → débit normal', async () => {
    ligneUser = { id: 'moi', credits: 42, role: 'user' };
    const r = await deduire({ postId: 'post-1' });
    expect(r.status).toBe(200);
    expect(r.body.politique).toBe('credits');
    expect(rpcAppels[0].nom).toBe('debiter_credits');
  });

  CHAMPS_INTERDITS_FACTURATION.forEach((champ) => {
    it(`10 & 11. « ${champ} » envoyé par le client est refusé`, async () => {
      const r = await deduire({ postId: 'post-1', [champ]: 'admin' });
      expect(r.status).toBe(422);
      expect(rpcAppels).toEqual([]);
    });
  });

  it("un faux rôle admin dans le corps ne dispense PAS du débit", async () => {
    // Le test décisif : le corps ment, la base dit `user`.
    ligneUser = { id: 'moi', credits: 42, role: 'user' };
    const r = await deduire({ postId: 'post-1', role: 'admin' });
    expect(r.status).toBe(422);
    expect(rpcAppels).toEqual([]);
  });

  it('un rôle absent en base est facturé comme un utilisateur', async () => {
    ligneUser = { id: 'moi', credits: 42 };
    const r = await deduire({ postId: 'post-1' });
    expect(r.body.politique).toBe('credits');
    expect(rpcAppels[0].nom).toBe('debiter_credits');
  });

  it('un utilisateur introuvable est facturé comme un utilisateur', async () => {
    ligneUser = null;
    lignePost = { id: 'post-1', format: 'reel', user_id: 'moi' };
    const r = await deduire({ postId: 'post-1' });
    // Fermé par défaut : ne pas savoir lire un rôle n'exempte personne.
    expect(r.body.politique).toBe('credits');
  });

  it("le rôle n'est jamais lu depuis la session", async () => {
    // Même si la session prétend le contraire, c'est la base qui décide.
    authMock.mockResolvedValue({ user: { id: 'moi', role: 'admin' } });
    ligneUser = { id: 'moi', credits: 42, role: 'user' };
    const r = await deduire({ postId: 'post-1' });
    expect(r.body.politique).toBe('credits');
    expect(rpcAppels[0].nom).toBe('debiter_credits');
  });

  it('aucun e-mail administrateur codé en dur dans la politique', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/lib/facturation/politique.ts', 'utf-8');
    expect(src).not.toContain('@gmail.com');
    // `isAdmin` apparait dans la liste des champs INTERDITS au client : c'est
    // l'inverse d'une dependance. Ce qu'on interdit, c'est de s'en servir.
    expect(src).not.toContain("from '@/lib/admin'");
    expect(src).not.toMatch(/isAdmin\s*\(/);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('13 & 14. Ce que le solde affiche', () => {
  it('administrateur : un libellé honnête, aucun nombre', async () => {
    ligneUser = { id: 'moi', credits: 42, role: 'admin' };
    const r = await lireSolde();
    expect(r.status).toBe(200);
    expect(r.body.balance).toBeNull();
    expect(r.body.libelle).toBe(LIBELLE_PARTENAIRES);
    expect(r.body.libelle).toBe('Frais partenaires uniquement');
    expect(r.body.politique).toBe('partner_cost_only');
  });

  it('administrateur : le vrai solde n est PAS divulgué', async () => {
    ligneUser = { id: 'moi', credits: 42, role: 'admin' };
    const r = await lireSolde();
    expect(JSON.stringify(r.body)).not.toContain('42');
  });

  it('utilisateur : son vrai solde, celui de la base', async () => {
    ligneUser = { id: 'moi', credits: 137, role: 'user' };
    const r = await lireSolde();
    expect(r.body.balance).toBe(137);
    expect(r.body.politique).toBe('credits');
    expect(r.body.libelle).toBeUndefined();
  });

  it('12. plus aucun 999999999 nulle part dans la réponse', async () => {
    for (const role of ['admin', 'user']) {
      ligneUser = { id: 'moi', credits: 42, role };
      const r = await lireSolde();
      expect(JSON.stringify(r.body)).not.toContain('999999999');
    }
  });

  it('solde illisible : indisponible, jamais un zéro inventé', async () => {
    ligneUser = null;
    const r = await lireSolde();
    // Un `0` enverrait l'utilisateur acheter des crédits qu'il possède.
    expect(r.status).toBe(503);
    expect(r.body.balance).toBeNull();
    expect(r.body.ok).toBe(false);
  });

  it('401 sans session, sans solde inventé', async () => {
    authMock.mockResolvedValue(null);
    const r = await lireSolde();
    expect(r.status).toBe(401);
    expect(r.body.balance).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('15. Les quatre parcours passent par la même porte', () => {
  it('les cinq opérations restent déclarées côté serveur', async () => {
    const { OPERATIONS } = await import('@/lib/rendus/service');
    expect([...OPERATIONS]).toEqual(
      ['apercu', 'bureau', 'calendrier', 'avance-brouillon', 'avance-bureau'],
    );
  });

  it('la confirmation choisit la fonction SQL selon la politique', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/app/api/render/jobs/[id]/confirm/route.ts', 'utf-8');
    expect(src).toContain('politiqueDeLUtilisateur(session.user.id)');
    expect(src).toContain('confirmerRenduSansDebit');
    // La politique figée à la réservation est croisée avec celle du moment :
    // le plus restrictif l'emporte.
    expect(src).toContain("rendu.politique !== 'partner_cost_only'");
  });

  it('la réservation fige la politique sur la ligne', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/lib/rendus/service.ts', 'utf-8');
    expect(src).toContain('politiqueDeLUtilisateur(userId)');
    expect(src).toContain('politique,');
  });
});

describe('18. Le reste du système est intact', () => {
  it('le mode Série reste fermé', async () => {
    const { BATCH_SERIE_DISPONIBLE } = await import('@/lib/creer/batchDisponible');
    expect(BATCH_SERIE_DISPONIBLE).toBe(false);
  });

  it('/api/render/batch reste désactivée', async () => {
    const { BATCH_RENDER_DESACTIVE } = await import('@/lib/render/batch-disabled');
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });

  it('les prix ne bougent pas dans ce lot', async () => {
    const { RENDER_COSTS } = await import('@/lib/stripe/constants');
    expect(RENDER_COSTS).toEqual({ reel: 10, tv: 15 });
  });

  it('la session porte le rôle, pour AFFICHER seulement', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/lib/auth/config.ts', 'utf-8');
    expect(src).toContain("select('plan, role')");
    expect(src).toContain('(session.user as any).role');
  });
});
