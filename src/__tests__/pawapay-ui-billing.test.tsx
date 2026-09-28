import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

/**
 * Panneau Mobile Money de `/dashboard/billing` (PawaPay).
 *
 * Le navigateur ne décide de rien qui touche à l'argent : il choisit un pack
 * et un pays, envoie `{ pack, pays }` et suit la redirection. Au retour, il
 * interroge `/api/pawapay/status/<id>` jusqu'à un état final. `fetch` est
 * entièrement mocké : aucun appel réel.
 */

const redirectMock = vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); });
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => redirectMock(url),
}));

import {
  MobileMoneyPanel,
  INTERVALLE_INTERROGATION_MS,
  DUREE_MAX_INTERROGATION_MS,
  type PackMobileMoney,
  type PaysMobileMoney,
} from '@/components/billing/MobileMoneyPanel';
import BillingPage from '@/app/dashboard/billing/page';
import { MobileMoneyServeur } from '@/app/dashboard/billing/MobileMoneyServeur';

const PACKS: PackMobileMoney[] = [
  { id: 'small', credits: 50, prixChf: '9.00' },
  { id: 'medium', credits: 200, prixChf: '29.00' },
  { id: 'large', credits: 500, prixChf: '59.00' },
  { id: 'xlarge', credits: 2000, prixChf: '179.00' },
];
const PAYS: PaysMobileMoney[] = [
  { code: 'CIV', nom: "Côte d'Ivoire" },
  { code: 'SEN', nom: 'Sénégal' },
];
const ID = '8917c345-4791-4285-a416-62f24b6982db';

const fetchMock = vi.fn();
const reponse = (status: number, corps: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => corps,
});
const appels = (fragment: string) => fetchMock.mock.calls.filter((c) => String(c[0]).includes(fragment));

beforeEach(() => {
  fetchMock.mockReset();
  redirectMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  delete process.env.PAWAPAY_ENABLED;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function choisir(pack: string, pays: string) {
  fireEvent.click(document.querySelector(`[data-pack="${pack}"]`)!);
  fireEvent.change(screen.getByLabelText('Pays'), { target: { value: pays } });
}

describe('MobileMoneyPanel — initiation', () => {
  it('le bouton reste désactivé tant que pack et pays ne sont pas choisis', () => {
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} />);
    const bouton = screen.getByRole('button', { name: /Payer avec Mobile Money/ });
    expect(bouton).toBeDisabled();
    fireEvent.click(document.querySelector('[data-pack="small"]')!);
    expect(bouton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Pays'), { target: { value: 'SEN' } });
    expect(bouton).not.toBeDisabled();
  });

  it('la sélection envoie pack et pays UNIQUEMENT, sans montant ni crédits', async () => {
    fetchMock.mockResolvedValue(reponse(200, { depositId: ID, redirectUrl: 'https://pay.pawapay.io/x' }));
    const naviguer = vi.fn();
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={naviguer} />);
    choisir('medium', 'CIV');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Payer avec Mobile Money/ }));
    });

    const depots = appels('/api/pawapay/deposit');
    expect(depots).toHaveLength(1);
    expect(depots[0][1].method).toBe('POST');
    const corps = JSON.parse(depots[0][1].body);
    expect(corps).toEqual({ pack: 'medium', pays: 'CIV' });
    expect(Object.keys(corps).sort()).toEqual(['pack', 'pays']);
    for (const interdit of ['montant', 'amount', 'credits', 'devise', 'currency', 'prix', 'taux']) {
      expect(depots[0][1].body).not.toContain(interdit);
    }
  });

  it('redirige vers l\'URL de paiement renvoyée par le serveur', async () => {
    fetchMock.mockResolvedValue(reponse(200, {
      depositId: ID, redirectUrl: 'https://pay.pawapay.io/abc', montant: '5200', devise: 'XOF', credits: 50,
    }));
    const naviguer = vi.fn();
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={naviguer} />);
    choisir('small', 'SEN');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Payer avec Mobile Money/ }));
    });
    expect(naviguer).toHaveBeenCalledWith('https://pay.pawapay.io/abc');
  });

  it('refuse une URL de redirection non https', async () => {
    fetchMock.mockResolvedValue(reponse(200, { depositId: ID, redirectUrl: 'javascript:alert(1)' }));
    const naviguer = vi.fn();
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={naviguer} />);
    choisir('small', 'SEN');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Payer avec Mobile Money/ }));
    });
    expect(naviguer).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de démarrer le paiement.');
  });

  it('503 à l\'initiation : état indisponible', async () => {
    fetchMock.mockResolvedValue(reponse(503, { error: 'Paiement Mobile Money indisponible' }));
    const naviguer = vi.fn();
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={naviguer} />);
    choisir('large', 'CIV');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Payer avec Mobile Money/ }));
    });
    expect(naviguer).not.toHaveBeenCalled();
    expect(container.querySelector('[data-mobile-money]')).toHaveAttribute('data-mobile-money', 'indisponible');
    expect(screen.getByText(/momentanément indisponible/)).toBeInTheDocument();
  });

  it('erreur serveur 400 : message affiché, le formulaire reste utilisable', async () => {
    fetchMock.mockResolvedValue(reponse(400, { error: 'Pays non disponible' }));
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={vi.fn()} />);
    choisir('large', 'CIV');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Payer avec Mobile Money/ }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Pays non disponible');
    expect(screen.getByRole('button', { name: /Payer avec Mobile Money/ })).not.toBeDisabled();
  });

  it('non disponible côté serveur : aucun formulaire, aucun appel', () => {
    const { container } = render(<MobileMoneyPanel disponible={false} packs={PACKS} pays={[]} />);
    expect(container.querySelector('[data-mobile-money]')).toHaveAttribute('data-mobile-money', 'indisponible');
    expect(screen.queryByRole('button', { name: /Payer/ })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('affiche le prix CHF tel que fourni par le serveur, sans montant local inventé', () => {
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} />);
    choisir('xlarge', 'CIV');
    const recap = container.querySelector('[data-recap]')!;
    expect(recap).toHaveTextContent('179.00 CHF');
    expect(recap).toHaveTextContent('page de paiement sécurisée PawaPay');
    expect(recap.textContent).not.toMatch(/XOF|XAF|FCFA/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MobileMoneyPanel — retour et interrogation du statut', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }); });

  const avancer = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const etat = (c: HTMLElement) => c.querySelector('[data-mobile-money]')!.getAttribute('data-mobile-money');

  it('en attente, puis crédité : confirmation, solde rafraîchi, interrogation arrêtée', async () => {
    let n = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/pawapay/status/')) {
        n += 1;
        return reponse(200, { status: n < 2 ? 'pending' : 'credited' });
      }
      if (url === '/api/credits/balance') return reponse(200, { ok: true, balance: 1250 });
      throw new Error(`inattendu ${url}`);
    });
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} depositRetour={ID} />);
    await avancer(0);
    expect(etat(container)).toBe('attente');
    expect(screen.getByText('Paiement en attente de confirmation')).toBeInTheDocument();
    expect(appels(`/api/pawapay/status/${ID}`)).toHaveLength(1);

    await avancer(INTERVALLE_INTERROGATION_MS);
    expect(etat(container)).toBe('credite');
    expect(screen.getByText(/vos crédits ont été ajoutés/)).toBeInTheDocument();
    expect(container.querySelector('[data-solde]')).toHaveTextContent('1');
    expect(container.querySelector('[data-solde]')!.textContent).toMatch(/1.?250 crédits/);

    await avancer(INTERVALLE_INTERROGATION_MS * 5);
    expect(appels('/api/pawapay/status/')).toHaveLength(2);
  });

  it('échoué : état final, interrogation arrêtée', async () => {
    fetchMock.mockResolvedValue(reponse(200, { status: 'failed' }));
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} depositRetour={ID} />);
    await avancer(0);
    expect(etat(container)).toBe('echec');
    expect(screen.getByText(/a échoué ou a été annulé/)).toBeInTheDocument();
    await avancer(INTERVALLE_INTERROGATION_MS * 5);
    expect(appels('/api/pawapay/status/')).toHaveLength(1);
    expect(appels('/api/credits/balance')).toHaveLength(0);
  });

  it('503 au statut : indisponible, interrogation arrêtée', async () => {
    fetchMock.mockResolvedValue(reponse(503, { error: 'Paiement Mobile Money indisponible' }));
    const { container } = render(<MobileMoneyPanel disponible={false} packs={PACKS} pays={[]} depositRetour={ID} />);
    await avancer(0);
    expect(etat(container)).toBe('indisponible');
    await avancer(INTERVALLE_INTERROGATION_MS * 5);
    expect(appels('/api/pawapay/status/')).toHaveLength(1);
  });

  it('404 au statut : introuvable, interrogation arrêtée', async () => {
    fetchMock.mockResolvedValue(reponse(404, { error: 'Not found' }));
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} depositRetour={ID} />);
    await avancer(0);
    expect(etat(container)).toBe('introuvable');
    await avancer(INTERVALLE_INTERROGATION_MS * 3);
    expect(appels('/api/pawapay/status/')).toHaveLength(1);
  });

  it('502 passager : l\'interrogation continue avec un avertissement', async () => {
    let n = 0;
    fetchMock.mockImplementation(async () => {
      n += 1;
      return n === 1 ? reponse(502, { error: 'Vérification impossible, réessayez' }) : reponse(200, { status: 'credited' });
    });
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} depositRetour={ID} />);
    await avancer(0);
    expect(etat(container)).toBe('attente');
    expect(screen.getByText(/nouvel essai automatique/)).toBeInTheDocument();
    await avancer(INTERVALLE_INTERROGATION_MS);
    expect(etat(container)).toBe('credite');
  });

  it('délai dépassé : arrêt, puis « Vérifier à nouveau » relance l\'interrogation', async () => {
    fetchMock.mockResolvedValue(reponse(200, { status: 'pending' }));
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} depositRetour={ID} />);
    await avancer(DUREE_MAX_INTERROGATION_MS + INTERVALLE_INTERROGATION_MS);
    expect(etat(container)).toBe('expire');
    const total = appels('/api/pawapay/status/').length;
    expect(total).toBeGreaterThan(1);
    expect(total).toBeLessThanOrEqual(DUREE_MAX_INTERROGATION_MS / INTERVALLE_INTERROGATION_MS + 2);

    await avancer(INTERVALLE_INTERROGATION_MS * 5);
    expect(appels('/api/pawapay/status/')).toHaveLength(total);

    fetchMock.mockResolvedValue(reponse(200, { status: 'credited' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Vérifier à nouveau/ }));
    });
    await avancer(0);
    expect(etat(container)).toBe('credite');
    expect(appels('/api/pawapay/status/')).toHaveLength(total + 1);
  });

  it('le démontage coupe l\'interrogation', async () => {
    fetchMock.mockResolvedValue(reponse(200, { status: 'pending' }));
    const { unmount } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} depositRetour={ID} />);
    await avancer(0);
    unmount();
    await avancer(INTERVALLE_INTERROGATION_MS * 5);
    expect(appels('/api/pawapay/status/')).toHaveLength(1);
  });
});

describe('/dashboard/billing — aiguillage Mobile Money', () => {
  it('sans plan ni PawaPay activé : redirection historique inchangée', () => {
    expect(() => BillingPage({ searchParams: {} })).toThrow('NEXT_REDIRECT:/dashboard/settings?tab=abonnement');
  });

  it('retour ?pawapay=<id> : panneau en mode suivi, sans redirection', () => {
    const el = BillingPage({ searchParams: { pawapay: ID } }) as any;
    expect(redirectMock).not.toHaveBeenCalled();
    expect(el.type).toBe(MobileMoneyServeur);
    expect(el.props).toEqual({ depositRetour: ID });
  });

  it('PawaPay activé, sans plan : panneau d\'achat', () => {
    process.env.PAWAPAY_ENABLED = 'true';
    const el = BillingPage({ searchParams: {} }) as any;
    expect(el.type).toBe(MobileMoneyServeur);
    expect(el.props).toEqual({ depositRetour: null });
  });

  it('un plan présent garde la présélection Stripe', () => {
    const el = BillingPage({ searchParams: { plan: 'pro', pawapay: ID } }) as any;
    expect(el.props).toEqual({ plan: 'pro', billing: 'monthly' });
  });

  it('préparation serveur : prix CHF formatés côté serveur, indisponible sans persistance', async () => {
    const el = (await MobileMoneyServeur({ depositRetour: null })) as any;
    const panneau = el.props.children;
    expect(panneau.type).toBe(MobileMoneyPanel);
    expect(panneau.props.disponible).toBe(false);
    expect(panneau.props.pays).toEqual([]);
    expect(panneau.props.packs).toEqual(PACKS);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Conventions', () => {
  const EMOJI = /\p{Extended_Pictographic}/u;
  for (const f of [
    'src/components/billing/MobileMoneyPanel.tsx',
    'src/app/dashboard/billing/MobileMoneyServeur.tsx',
  ]) {
    it(`aucun emoji dans ${f}`, () => {
      expect(readFileSync(resolve(process.cwd(), f), 'utf8')).not.toMatch(EMOJI);
    });
  }

  it('le composant client ne calcule ni prix ni taux et n\'importe rien du module serveur PawaPay', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/billing/MobileMoneyPanel.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/@\/lib\/payment/);
    expect(src).not.toMatch(/prixCentimesChf|prixLocal|\btaux\b|\/\s*100\b|\.toFixed\(/);
  });
});
