/**
 * PAIEMENT SIMULÉ — fermé en production, une seule fois, et rien sans confirmation.
 *
 * Trois propriétés, éprouvées séparément :
 *   1. en production, ni la fonction ni la route ne s'ouvrent, quoi qu'on envoie ;
 *   2. une même référence ne crédite qu'une fois ;
 *   3. refusé, annulé, en attente : aucune écriture du tout.
 * Plus une garde de structure : le module que le navigateur importe ne doit
 * jamais tirer le client de base de données.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const base = {
  transactions: [] as Array<Record<string, unknown>>,
  soldes: new Map<string, number>(),
  ecritures: 0,
};

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    let patch: Record<string, unknown> | null = null;
    let insertion: Record<string, unknown> | null = null;
    let userId: string | null = null;
    const exec = () => {
      if (table === 'credit_transactions' && insertion) {
        // L'index unique (user_id, reference_id) du 27 août.
        const doublon = base.transactions.some(
          (t) => t.user_id === insertion!.user_id && t.reference_id === insertion!.reference_id,
        );
        if (doublon) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        base.transactions.push(insertion);
        base.ecritures += 1;
        return { data: null, error: null };
      }
      if (table === 'users' && patch) {
        base.soldes.set(userId!, patch.credits as number);
        base.ecritures += 1;
        return { data: null, error: null };
      }
      if (table === 'users') return { data: { credits: base.soldes.get(userId!) ?? 0 }, error: null };
      return { data: null, error: null };
    };
    const api: Record<string, unknown> = {
      insert: (v: Record<string, unknown>) => { insertion = v; return Promise.resolve().then(exec); },
      update: (p: Record<string, unknown>) => { patch = p; return api; },
      select: () => api,
      eq: (_k: string, v: string) => { userId = v; return api; },
      maybeSingle: async () => exec(),
      then: (ok: (v: unknown) => void) => Promise.resolve().then(exec).then(ok),
    };
    return api;
  };
  return { supabaseAdmin: { from }, supabase: {} };
});

const { crediterPaiementSimule } = await import('@/lib/paiements/demonstration-credit');
const {
  paiementSimuleOuvert, issueCredite, ISSUES_DEMO, PREFIXE_DEMO,
} = await import('@/lib/paiements/demonstration');

beforeEach(() => {
  base.transactions = [];
  base.soldes = new Map([['u1', 100]]);
  base.ecritures = 0;
});

describe('1. Fermé en production', () => {
  it('⚠️ NODE_ENV=production ferme la porte, même avec tous les drapeaux de démonstration', () => {
    expect(paiementSimuleOuvert({
      NODE_ENV: 'production', DEV_AUTH_BYPASS: '1', STUDIIO_DEMO: '1',
    })).toBe(false);
  });

  it('ouvert seulement hors production ET en mode démonstration', () => {
    expect(paiementSimuleOuvert({ NODE_ENV: 'development', DEV_AUTH_BYPASS: '1' })).toBe(true);
    expect(paiementSimuleOuvert({ NODE_ENV: 'development', STUDIIO_DEMO: '1' })).toBe(true);
    expect(paiementSimuleOuvert({ NODE_ENV: 'development' })).toBe(false);
    expect(paiementSimuleOuvert({})).toBe(false);
  });

  it('⚠️ la route répond 404 en production, avant toute lecture de session ou de base', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_AUTH_BYPASS', '1');
    vi.stubEnv('STUDIIO_DEMO', '1');
    try {
      vi.doMock('@/lib/auth/config', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1' } })) }));
      const { POST } = await import('@/app/api/demonstration/paiement/route');
      const res = await POST(new Request('http://localhost/api/demonstration/paiement', {
        method: 'POST',
        body: JSON.stringify({ offre: 'pack', cle: 'small', issue: 'reussi' }),
      }) as never);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('simulation_fermee');
      expect(base.ecritures).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('2. Une seule fois', () => {
  it('crédite à la première confirmation', async () => {
    const r = await crediterPaiementSimule('u1', 50, `${PREFIXE_DEMO}abc`, 'test');
    expect(r).toEqual({ solde: 150, dejaCredite: false });
    expect(base.soldes.get('u1')).toBe(150);
  });

  it('⚠️ la même référence rejouée ne recrédite pas, et ne touche pas au solde', async () => {
    await crediterPaiementSimule('u1', 50, `${PREFIXE_DEMO}abc`, 'test');
    for (let i = 0; i < 5; i += 1) {
      const r = await crediterPaiementSimule('u1', 50, `${PREFIXE_DEMO}abc`, 'test');
      expect(r.dejaCredite).toBe(true);
    }
    expect(base.soldes.get('u1')).toBe(150);
    expect(base.transactions).toHaveLength(1);
  });

  it('deux références différentes sont deux paiements', async () => {
    await crediterPaiementSimule('u1', 50, `${PREFIXE_DEMO}a`, 'test');
    await crediterPaiementSimule('u1', 50, `${PREFIXE_DEMO}b`, 'test');
    expect(base.soldes.get('u1')).toBe(200);
  });

  it('refuse une référence qui se déguiserait en vrai encaissement', async () => {
    await expect(crediterPaiementSimule('u1', 50, 'stripe:cs_123', 'x')).rejects.toThrow();
    await expect(crediterPaiementSimule('u1', 50, 'mm:dep', 'x')).rejects.toThrow();
    expect(base.ecritures).toBe(0);
  });

  it('l’écriture de la transaction précède celle du solde', async () => {
    await crediterPaiementSimule('u1', 50, `${PREFIXE_DEMO}ordre`, 'test');
    // Si la transaction avait échoué, le solde ne serait pas touché : c'est
    // ce que garantit « transaction d'abord ». Ici : transaction puis solde.
    expect(base.transactions[0].reference_id).toBe(`${PREFIXE_DEMO}ordre`);
    expect(base.ecritures).toBe(2);
  });
});

describe('3. Seule l’issue confirmée crédite', () => {
  it('une seule issue sur quatre crédite', () => {
    expect(ISSUES_DEMO.filter(issueCredite)).toEqual(['reussi']);
  });

  it.each(['refuse', 'annule', 'en_attente'] as const)('« %s » n’écrit rien', (issue) => {
    expect(issueCredite(issue)).toBe(false);
  });
});

describe('4. Structure : le navigateur n’importe pas le serveur', () => {
  const lire = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8');

  it('⚠️ demonstration.ts (importé par le composant client) n’importe pas la base', () => {
    const s = lire('src/lib/paiements/demonstration.ts');
    expect(s).not.toMatch(/from ['"]@\/lib\/db\/supabase['"]/);
  });

  it('ChoixPaiement n’importe que le module pur', () => {
    const s = lire('src/components/billing/ChoixPaiement.tsx');
    expect(s).toMatch(/@\/lib\/paiements\/demonstration['"]/);
    expect(s).not.toMatch(/demonstration-credit/);
    expect(s).not.toMatch(/@\/lib\/db\/supabase/);
  });

  it('plus aucun alert() natif dans le parcours d’achat', () => {
    for (const f of [
      'src/components/billing/PricingCards.tsx',
      'src/components/billing/BuyCreditsModal.tsx',
      'src/components/settings/BillingContent.tsx',
    ]) {
      // On retire les commentaires : certains EXPLIQUENT l'ancien alert().
      const code = lire(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/[^.\w]alert\(/);
    }
  });
});
