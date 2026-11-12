/**
 * LES ÉCRANS COMMERCIAUX NE PRÉSENTENT PLUS DE CHIFFRE INVENTÉ COMME RÉEL.
 *
 * L'écran Paiements annonçait « 18 450 € » de revenus mensuels et cinq
 * paiements nominatifs en euros, tous écrits dans le code. Rien ne le disait,
 * et c'était vrai en production aussi.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MENTION_DEMO, MENTION_EXEMPLES } from '@/lib/apercu/mode-demo';

vi.mock('@/i18n/client', () => ({
  useTranslations: () => (cle: string) => cle,
  useLocale: () => 'fr',
  useFormattedDate: () => (d: unknown) => String(d),
  useFormattedNumber: () => (n: number) => String(n),
}));

let demo = false;
beforeEach(() => {
  demo = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/mode')) {
      return new Response(JSON.stringify({ success: true, demonstration: demo }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('écran Paiements', () => {
  it('⚠️ annonce en permanence que ses chiffres sont des exemples', async () => {
    const { default: Page } = await import('@/app/admin/payments/page');
    render(<Page />);
    expect(screen.getByTestId('bandeau-exemples').textContent).toContain(MENTION_EXEMPLES);
  });

  it('les montants sont en CHF, plus en euros', async () => {
    const { default: Page } = await import('@/app/admin/payments/page');
    render(<Page />);
    const texte = document.body.textContent ?? '';
    expect(texte).not.toContain('€');
    expect(texte).not.toContain('18,450');
    expect(texte).toContain('901 CHF');
  });

  it('les ordres de grandeur correspondent aux offres Studiio', async () => {
    const { PaymentTable } = await import('@/components/admin/PaymentTable');
    render(<PaymentTable />);
    const texte = document.body.textContent ?? '';
    for (const montant of ['49,00 CHF', '149,00 CHF', '19,00 CHF', '29,00 CHF', '9,00 CHF']) {
      expect(texte, montant).toContain(montant);
    }
    // Aucune référence qui pourrait passer pour une vraie transaction.
    expect(texte).not.toMatch(/pi_\d/);
  });

  it('les deux filtres portent un intitulé', async () => {
    const { default: Page } = await import('@/app/admin/payments/page');
    render(<Page />);
    expect(screen.getByText('Type de paiement')).toBeInTheDocument();
    expect(screen.getByText('État du paiement')).toBeInTheDocument();
  });
});

describe('bandeau de prévisualisation', () => {
  it('absent quand la base est réelle', async () => {
    const { BandeauDemo } = await import('@/components/ui/BandeauDemo');
    render(<BandeauDemo />);
    await waitFor(() => expect(screen.queryByTestId('bandeau-demonstration')).toBeNull());
  });

  it('présent quand la base est un double de prévisualisation', async () => {
    demo = true;
    const { BandeauDemo } = await import('@/components/ui/BandeauDemo');
    render(<BandeauDemo />);
    await waitFor(() => expect(screen.getByTestId('bandeau-demonstration').textContent).toContain(MENTION_DEMO));
  });

  it('une erreur de lecture ne fait PAS apparaître le bandeau — ni l’inverse', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('reseau'); }));
    const { BandeauDemo } = await import('@/components/ui/BandeauDemo');
    render(<BandeauDemo />);
    await waitFor(() => expect(screen.queryByTestId('bandeau-demonstration')).toBeNull());
  });
});
