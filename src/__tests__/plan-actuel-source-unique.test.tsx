/**
 * « PLAN ACTUEL » — UNE SEULE SOURCE, ET LE SÉLECTEUR AUX COULEURS STUDIIO.
 *
 * L'écran de facturation lisait l'abonnement dans la TABLE pendant que les
 * cartes de prix lisaient le plan du JETON DE SESSION : le compte s'affichait
 * « Abonnement actuel : Free » et voyait, deux blocs plus bas, « Plan actuel »
 * sur Pro.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SEGMENT_ACTIF, SEGMENT_INACTIF, classesSegment } from '@/lib/ui/etats';

const PLANS = [
  { key: 'free', name: 'Gratuit', price_cents: 0, yearly_price_cents: 0, credits: 10, features: [], popular: false, active: true, watermark: true },
  { key: 'starter', name: 'Starter', price_cents: 1900, yearly_price_cents: 1583, credits: 150, features: [], popular: false, active: true, watermark: false },
  { key: 'pro', name: 'Pro', price_cents: 4900, yearly_price_cents: 4083, credits: 600, features: [], popular: true, active: true, watermark: false },
];

/** La session annonce « pro » — c'est elle qui induisait l'incohérence. */
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { plan: 'pro' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plans: PLANS, packs: [] }), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const marques = () => screen.queryAllByText(/Plan actuel/i).length;

describe('une seule formule marquée « Plan actuel »', () => {
  it('⚠️ l’abonnement passé par l’écran gagne sur le jeton de session', async () => {
    const { PricingCards } = await import('@/components/billing/PricingCards');
    render(<PricingCards planActuel="free" />);
    await waitFor(() => expect(screen.getByText('Gratuit')).toBeInTheDocument());
    // Une seule carte marquée, et c'est Gratuit — pas Pro, que disait la session.
    expect(marques()).toBe(1);
    const cartePro = screen.getByText('Pro').closest('div');
    expect(cartePro?.textContent).not.toMatch(/Plan actuel/i);
  });

  it('sans information de l’écran, on retombe sur la session — comportement d’avant', async () => {
    const { PricingCards } = await import('@/components/billing/PricingCards');
    render(<PricingCards />);
    await waitFor(() => expect(screen.getByText('Pro')).toBeInTheDocument());
    expect(marques()).toBe(1);
  });

  it('la casse ne crée pas une seconde vérité', async () => {
    const { PricingCards } = await import('@/components/billing/PricingCards');
    render(<PricingCards planActuel="PRO" />);
    await waitFor(() => expect(screen.getByText('Pro')).toBeInTheDocument());
    expect(marques()).toBe(1);
  });
});

describe('sélecteur Mensuel / Annuel', () => {
  it('⚠️ le segment choisi est VIOLET, plus rose', () => {
    expect(SEGMENT_ACTIF).toContain('bg-studiio-primary');
    expect(SEGMENT_ACTIF).not.toContain('studiio-accent');
    expect(SEGMENT_ACTIF).toContain('text-white');
  });

  it('le segment au repos reste un ton sombre neutre', () => {
    expect(SEGMENT_INACTIF).toContain('text-gray-400');
    expect(SEGMENT_INACTIF).not.toMatch(/bg-(studiio|pink|purple)-?/);
  });

  it('la règle est unique : les deux états sortent de la même fonction', () => {
    expect(classesSegment(true)).toBe(SEGMENT_ACTIF);
    expect(classesSegment(false)).toBe(SEGMENT_INACTIF);
  });

  it('aucun écran ne recopie la couleur rose pour un segment sélectionné', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    for (const f of ['../components/billing/PricingCards.tsx', '../app/dashboard/billing/PlanPreselectionne.tsx']) {
      const src = readFileSync(resolve(__dirname, f), 'utf-8');
      expect(src, f).not.toContain("'bg-studiio-accent text-white'");
      expect(src, f).toContain('classesSegment(');
    }
  });

  it('la réduction annuelle garde sa couleur sémantique', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(__dirname, '../components/billing/PricingCards.tsx'), 'utf-8');
    expect(src).toContain('text-green-400 ml-1">-17%');
  });
});
