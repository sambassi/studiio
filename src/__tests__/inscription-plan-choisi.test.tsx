import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * Bug P2 — le plan choisi sur la landing était perdu à l'inscription :
 * `callbackUrl` visait `/dashboard?plan=…` (que personne ne lit) et le résumé
 * du plan appelait `/api/admin/landing`, bloqué par le middleware pour un
 * visiteur non connecté.
 */

let params = new URLSearchParams();
const redirectMock = vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); });
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  redirect: (url: string) => redirectMock(url),
}));

const signInMock = vi.fn();
vi.mock('next-auth/react', () => ({ signIn: (...a: unknown[]) => signInMock(...a) }));

vi.mock('@/i18n/client', () => ({
  useTranslations: () => (k: string) => k,
}));

import {
  normaliserPlan,
  normaliserFacturation,
  destinationApresConnexion,
  resumePlan,
  centimesEnFrancs,
} from '@/lib/billing/plan-choisi';
import SignupPage from '@/app/auth/signup/page';
import LoginPage from '@/app/auth/login/page';
import BillingPage from '@/app/dashboard/billing/page';
import { PlanPreselectionne } from '@/app/dashboard/billing/PlanPreselectionne';

const fetchMock = vi.fn();

beforeEach(() => {
  params = new URLSearchParams();
  signInMock.mockReset();
  redirectMock.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ plans: [] }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const urlsAppelees = () => fetchMock.mock.calls.map(c => String(c[0]));

describe('normaliserPlan — liste fermée', () => {
  it('accepte les clés payantes, quelle que soit la casse', () => {
    expect(normaliserPlan('starter')).toBe('starter');
    expect(normaliserPlan('Pro')).toBe('pro');
    expect(normaliserPlan(' ENTERPRISE ')).toBe('enterprise');
  });

  it('rejette free, l’inconnu, le vide et toute tentative d’injection', () => {
    for (const v of [
      null, undefined, '', 'free', 'gratuit', 'platinum',
      '//evil.com', 'https://evil.com', 'pro&billing=yearly', 'pro/../admin',
      '<script>', 'pro%0d%0a', 'p'.repeat(200),
    ]) {
      expect(normaliserPlan(v as any)).toBeNull();
    }
  });

  it('facturation : yearly ou monthly, rien d’autre', () => {
    expect(normaliserFacturation('yearly')).toBe('yearly');
    expect(normaliserFacturation('monthly')).toBe('monthly');
    expect(normaliserFacturation('javascript:alert(1)')).toBe('monthly');
    expect(normaliserFacturation(null)).toBe('monthly');
  });
});

describe('destinationApresConnexion', () => {
  it('plan connu → facturation avec plan présélectionné (URL relative)', () => {
    expect(destinationApresConnexion('pro', 'yearly')).toBe('/dashboard/billing?plan=pro&billing=yearly');
    expect(destinationApresConnexion('Starter', null)).toBe('/dashboard/billing?plan=starter&billing=monthly');
  });

  it('plan absent ou inconnu → tableau de bord, jamais le paramètre brut', () => {
    expect(destinationApresConnexion(null, null)).toBe('/dashboard');
    expect(destinationApresConnexion('https://evil.com', 'yearly')).toBe('/dashboard');
    expect(destinationApresConnexion('free', 'monthly')).toBe('/dashboard');
  });

  it('résumé lu dans les constantes publiques', () => {
    const r = resumePlan('pro');
    expect(r.nom).toBe('Pro');
    expect(r.credits).toBeGreaterThan(0);
    expect(centimesEnFrancs(1583)).toBe('15,83');
    expect(centimesEnFrancs(4900)).toBe('49');
  });
});

describe('Page d’inscription', () => {
  it('ne dépend plus de /api/admin/landing (bloqué pour un visiteur)', () => {
    const src = readFileSync(resolve(__dirname, '../app/auth/signup/page.tsx'), 'utf-8');
    expect(src).not.toContain('/api/admin/landing');
  });

  it('plan connu : résumé affiché, prix publics, callback vers la facturation', async () => {
    params = new URLSearchParams('plan=pro&billing=yearly');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ plans: [{ key: 'pro', price_cents: 5500, yearly_price_cents: 4500, credits: 700 }] }),
    });
    const { container } = render(<SignupPage />);
    expect(container.querySelector('[data-plan-choisi="pro"]')).not.toBeNull();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('45 CHF')).toBeInTheDocument());
    expect(urlsAppelees()).toEqual(['/api/pricing']);

    fireEvent.click(screen.getByText('signup.google'));
    expect(signInMock).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard/billing?plan=pro&billing=yearly' });
  });

  it('prix de repli lus dans les constantes si /api/pricing échoue', () => {
    params = new URLSearchParams('plan=starter');
    fetchMock.mockRejectedValue(new Error('réseau'));
    render(<SignupPage />);
    expect(screen.getByText(`${centimesEnFrancs(resumePlan('starter').prixMensuelCentimes)} CHF`)).toBeInTheDocument();
  });

  it('le lien « Se connecter » transmet le plan validé', () => {
    params = new URLSearchParams('plan=enterprise&billing=monthly');
    render(<SignupPage />);
    expect(screen.getByText('signup.login').closest('a')?.getAttribute('href'))
      .toBe('/auth/login?plan=enterprise&billing=monthly');
  });

  it('plan inconnu : ignoré, aucun appel réseau, callback vers le tableau de bord', () => {
    params = new URLSearchParams('plan=https://evil.com&billing=yearly');
    const { container } = render(<SignupPage />);
    expect(container.querySelector('[data-plan-choisi]')).toBeNull();
    expect(container.innerHTML).not.toContain('evil.com');
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('signup.facebook'));
    expect(signInMock).toHaveBeenCalledWith('facebook', { callbackUrl: '/dashboard' });
  });

  it('sans plan : comportement historique inchangé', () => {
    render(<SignupPage />);
    fireEvent.click(screen.getByText('signup.google'));
    expect(signInMock).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard' });
    expect(screen.getByText('signup.login').closest('a')?.getAttribute('href')).toBe('/auth/login');
  });
});

describe('Page de connexion', () => {
  it('plan connu → callback vers la facturation', () => {
    params = new URLSearchParams('plan=starter&billing=yearly');
    render(<LoginPage />);
    fireEvent.click(screen.getByText('login.google'));
    expect(signInMock).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard/billing?plan=starter&billing=yearly' });
  });

  it('sans plan ou plan inconnu → /dashboard', () => {
    params = new URLSearchParams('plan=//evil.com');
    render(<LoginPage />);
    fireEvent.click(screen.getByText('login.google'));
    expect(signInMock).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard' });
  });
});

describe('Page de facturation', () => {
  it('sans plan ou plan inconnu : redirection historique vers l’onglet Abonnement', () => {
    expect(() => BillingPage({ searchParams: {} })).toThrow('NEXT_REDIRECT:/dashboard/settings?tab=abonnement');
    expect(() => BillingPage({ searchParams: { plan: 'free' } })).toThrow('NEXT_REDIRECT:/dashboard/settings?tab=abonnement');
    expect(() => BillingPage({ searchParams: { plan: ['pro', 'pro'] } })).toThrow('NEXT_REDIRECT');
  });

  it('plan connu : présélection sans redirection', () => {
    const el = BillingPage({ searchParams: { plan: 'Pro', billing: 'yearly' } }) as any;
    expect(redirectMock).not.toHaveBeenCalled();
    expect(el.props).toEqual({ plan: 'pro', billing: 'yearly' });
  });

  it('présélection : AUCUN paiement lancé au montage, seulement au clic', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/stripe/create-checkout') return { ok: true, json: async () => ({ error: 'price not configured' }) };
      return { ok: true, json: async () => ({ plans: [] }) };
    });
    const { container } = render(<PlanPreselectionne plan="pro" billing="monthly" />);
    expect(container.querySelector('[data-plan-preselectionne="pro"]')).not.toBeNull();
    await waitFor(() => expect(urlsAppelees()).toEqual(['/api/pricing']));

    fireEvent.click(screen.getByText('Annuel'));
    fireEvent.click(screen.getByText('Continuer vers le paiement'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('price not configured'));
    const appel = fetchMock.mock.calls.find(c => c[0] === '/api/stripe/create-checkout');
    expect(JSON.parse(appel![1].body)).toEqual({ plan: 'pro', billingCycle: 'yearly' });
  });
});
