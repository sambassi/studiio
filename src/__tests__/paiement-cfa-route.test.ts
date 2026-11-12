/**
 * `/api/paiements/cfa/devis` — le prix d'une recharge en franc CFA.
 *
 * Deux points vérifiés par APPEL de la route : le montant vient de la BASE et
 * jamais du navigateur, et sans taux daté la route refuse plutôt que
 * d'afficher un prix injustifiable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

let offre: { amount: number; price_cents: number };
vi.mock('@/lib/stripe/prix', () => ({ offrePack: async () => offre }));

let config: { changeEur: { eurParChf: number; le: string; source: string } | null };
vi.mock('@/lib/tarifs/serveur', () => ({ lireTarifs: async () => config }));

const { POST } = await import('@/app/api/paiements/cfa/devis/route');

const appel = (corps: unknown) => POST(new Request('http://localhost/x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
}) as never);

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'u-1' } });
  offre = { amount: 200, price_cents: 2900 };
  config = { changeEur: { eurParChf: 1.083, le: '2026-11-11', source: 'BCE' } };
});

describe('devis en franc CFA', () => {
  it('sans session : 401, aucun calcul', async () => {
    authMock.mockResolvedValue(null);
    expect((await appel({ pack: 'medium', devise: 'XOF' })).status).toBe(401);
  });

  it('convertit le prix DE LA BASE, pas un montant envoyé par le client', async () => {
    const res = await appel({ pack: 'medium', devise: 'XOF', chfCentimes: 1, montant: 1 });
    expect(res.status).toBe(200);
    const { devis } = await res.json();
    // 29 CHF × 1,083 × 655,957 = 20 601,6 → 20 602 XOF.
    expect(devis.chfCentimes).toBe(2900);
    expect(devis.montant).toBe(20602);
    expect(devis.credits).toBe(200);
    expect(devis.tauxLe).toBe('2026-11-11');
  });

  it('l’annonce dit le montant, les crédits, le prix CHF et la date du taux', async () => {
    const { devis } = await (await appel({ pack: 'medium', devise: 'XAF' })).json();
    expect(devis.annonce).toMatch(/XAF pour 200 crédits/);
    expect(devis.annonce).toContain('29,00 CHF');
    expect(devis.annonce).toContain('2026-11-11');
    expect(devis.annonce).toContain('Aucun frais ajouté');
  });

  it('sans taux enregistré : 409, et le motif est dit', async () => {
    config = { changeEur: null };
    const res = await appel({ pack: 'medium', devise: 'XOF' });
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.code).toBe('taux_absent');
    expect(j.error).toContain('ne peut pas être affiché');
  });

  it('devise hors franc CFA, ou recharge inconnue : 400', async () => {
    expect((await appel({ pack: 'medium', devise: 'NGN' })).status).toBe(400);
    expect((await appel({ pack: 'inexistant', devise: 'XOF' })).status).toBe(400);
  });

  it('prix invalide en base : 503, jamais un prix inventé', async () => {
    offre = { amount: 200, price_cents: 0 };
    expect((await appel({ pack: 'medium', devise: 'XOF' })).status).toBe(503);
  });
});
