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

type Routeur = {
  quote?: (params: URLSearchParams) => ReturnType<typeof reponse>;
  deposit?: (corps: Record<string, unknown>) => ReturnType<typeof reponse>;
};
const DEVIS_OK = (p: URLSearchParams) => reponse(200, {
  pack: p.get('pack'), credits: 200, prixChf: '29.00', montant: '19040', devise: p.get('devise') ?? 'XOF',
});
function routeur({ quote = DEVIS_OK, deposit }: Routeur = {}) {
  fetchMock.mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url.startsWith('/api/pawapay/quote?')) return quote(new URLSearchParams(url.split('?')[1]));
    if (url === '/api/pawapay/deposit' && deposit) return deposit(JSON.parse(init?.body ?? '{}'));
    throw new Error(`inattendu ${url}`);
  });
}
const devisAppels = () => appels('/api/pawapay/quote?').map((c) => new URLSearchParams(String(c[0]).split('?')[1]));
const cliquerPayer = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Payer avec Mobile Money/ }));
  });
};
const INTERDITS = ['montant', 'amount', 'credits', 'prix', 'taux', 'rate', 'price'];

describe('MobileMoneyPanel — devis serveur', () => {
  it('affiche le montant local et la devise renvoyés par le devis, à côté du CHF', async () => {
    routeur();
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} />);
    await act(async () => { choisir('medium', 'CIV'); });
    const recap = container.querySelector('[data-recap]')!;
    expect(recap).toHaveTextContent('29.00 CHF');
    expect(container.querySelector('[data-montant-local]')).toHaveTextContent('19040 XOF');
    expect(recap).not.toHaveTextContent('page de paiement');
    const [p] = devisAppels();
    expect(Object.fromEntries(p)).toEqual({ pack: 'medium', pays: 'CIV' });
  });

  it('pendant le chargement, le bouton reste désactivé et un indicateur est affiché', async () => {
    let resoudre: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((r) => { resoudre = r; }));
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} />);
    await act(async () => { choisir('small', 'SEN'); });
    expect(container.querySelector('[data-recap]')).toHaveAttribute('data-recap', 'chargement');
    expect(screen.getByText(/Calcul du montant local/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Payer avec Mobile Money/ })).toBeDisabled();
    await act(async () => { resoudre(reponse(200, { prixChf: '9.00', montant: '5920', devise: 'XOF' })); });
    expect(screen.getByRole('button', { name: /Payer avec Mobile Money/ })).not.toBeDisabled();
  });

  it('changer de pack relance le devis', async () => {
    routeur();
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} />);
    await act(async () => { choisir('small', 'CIV'); });
    await act(async () => { fireEvent.click(document.querySelector('[data-pack="xlarge"]')!); });
    expect(devisAppels().map((p) => p.get('pack'))).toEqual(['small', 'xlarge']);
  });

  it('changer de pays relance le devis', async () => {
    routeur();
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} />);
    await act(async () => { choisir('small', 'CIV'); });
    await act(async () => { fireEvent.change(screen.getByLabelText('Pays'), { target: { value: 'SEN' } }); });
    expect(devisAppels().map((p) => p.get('pays'))).toEqual(['CIV', 'SEN']);
  });

  it('503 au devis : état indisponible', async () => {
    routeur({ quote: () => reponse(503, { error: 'Paiement Mobile Money indisponible' }) });
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} />);
    await act(async () => { choisir('small', 'CIV'); });
    expect(container.querySelector('[data-mobile-money]')).toHaveAttribute('data-mobile-money', 'indisponible');
    expect(screen.getByText(/momentanément indisponible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Payer/ })).toBeNull();
  });

  it('400 au devis : message affiché, paiement impossible', async () => {
    routeur({ quote: () => reponse(400, { error: 'Pays non disponible' }) });
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} />);
    await act(async () => { choisir('small', 'CIV'); });
    expect(screen.getByRole('alert')).toHaveTextContent('Pays non disponible');
    expect(screen.getByRole('button', { name: /Payer avec Mobile Money/ })).toBeDisabled();
  });

  it('pays à plusieurs devises : choix parmi la liste serveur, transmis au devis ET au dépôt', async () => {
    const naviguer = vi.fn();
    routeur({
      quote: (p) => (p.get('pays') !== 'COD' || p.get('devise')
        ? DEVIS_OK(p)
        : reponse(400, { error: 'Devise à préciser', devises: ['CDF', 'USD'] })),
      deposit: () => reponse(200, { depositId: ID, redirectUrl: 'https://pay.pawapay.io/cd' }),
    });
    const pays = [...PAYS, { code: 'COD', nom: 'RD Congo' }];
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={pays} naviguer={naviguer} />);
    await act(async () => { choisir('medium', 'COD'); });
    expect(container.querySelector('[data-recap]')).toHaveAttribute('data-recap', 'devise');
    const select = screen.getByLabelText('Devise') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'CDF', 'USD']);
    expect(screen.getByRole('button', { name: /Payer avec Mobile Money/ })).toBeDisabled();

    await act(async () => { fireEvent.change(select, { target: { value: 'USD' } }); });
    expect(Object.fromEntries(devisAppels()[1])).toEqual({ pack: 'medium', pays: 'COD', devise: 'USD' });
    expect(container.querySelector('[data-montant-local]')).toHaveTextContent('19040 USD');

    await cliquerPayer();
    const corps = JSON.parse(appels('/api/pawapay/deposit')[0][1].body);
    expect(corps).toEqual({ pack: 'medium', pays: 'COD', devise: 'USD' });
    expect(naviguer).toHaveBeenCalledWith('https://pay.pawapay.io/cd');

    // Changer de pays efface la devise choisie.
    await act(async () => { fireEvent.change(screen.getByLabelText('Pays'), { target: { value: 'CIV' } }); });
    expect(screen.queryByLabelText('Devise')).toBeNull();
    expect(devisAppels().at(-1)!.get('devise')).toBeNull();
  });
});

describe('MobileMoneyPanel — initiation', () => {
  it('le bouton reste désactivé tant que pack, pays et devis ne sont pas prêts', async () => {
    routeur();
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} />);
    const bouton = screen.getByRole('button', { name: /Payer avec Mobile Money/ });
    expect(bouton).toBeDisabled();
    await act(async () => { fireEvent.click(document.querySelector('[data-pack="small"]')!); });
    expect(bouton).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { fireEvent.change(screen.getByLabelText('Pays'), { target: { value: 'SEN' } }); });
    expect(bouton).not.toBeDisabled();
  });

  it('pays à devise unique : le dépôt n\'envoie que pack et pays, jamais montant ni crédits', async () => {
    routeur({ deposit: () => reponse(200, { depositId: ID, redirectUrl: 'https://pay.pawapay.io/x' }) });
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={vi.fn()} />);
    await act(async () => { choisir('medium', 'CIV'); });
    await cliquerPayer();

    const depots = appels('/api/pawapay/deposit');
    expect(depots).toHaveLength(1);
    expect(depots[0][1].method).toBe('POST');
    const corps = JSON.parse(depots[0][1].body);
    expect(corps).toEqual({ pack: 'medium', pays: 'CIV' });
    for (const interdit of [...INTERDITS, 'devise']) expect(depots[0][1].body).not.toContain(interdit);
    // Le montant affiché (19040) n'est jamais renvoyé au serveur.
    expect(depots[0][1].body).not.toContain('19040');
    for (const p of devisAppels()) {
      for (const k of p.keys()) expect(['pack', 'pays', 'devise']).toContain(k);
    }
  });

  it('redirige vers l\'URL de paiement renvoyée par le serveur', async () => {
    routeur({ deposit: () => reponse(200, {
      depositId: ID, redirectUrl: 'https://pay.pawapay.io/abc', montant: '5200', devise: 'XOF', credits: 50,
    }) });
    const naviguer = vi.fn();
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={naviguer} />);
    await act(async () => { choisir('small', 'SEN'); });
    await cliquerPayer();
    expect(naviguer).toHaveBeenCalledWith('https://pay.pawapay.io/abc');
  });

  it('refuse une URL de redirection non https', async () => {
    routeur({ deposit: () => reponse(200, { depositId: ID, redirectUrl: 'javascript:alert(1)' }) });
    const naviguer = vi.fn();
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={naviguer} />);
    await act(async () => { choisir('small', 'SEN'); });
    await cliquerPayer();
    expect(naviguer).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de démarrer le paiement.');
  });

  it('503 à l\'initiation : état indisponible', async () => {
    routeur({ deposit: () => reponse(503, { error: 'Paiement Mobile Money indisponible' }) });
    const naviguer = vi.fn();
    const { container } = render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={naviguer} />);
    await act(async () => { choisir('large', 'CIV'); });
    await cliquerPayer();
    expect(naviguer).not.toHaveBeenCalled();
    expect(container.querySelector('[data-mobile-money]')).toHaveAttribute('data-mobile-money', 'indisponible');
    expect(screen.getByText(/momentanément indisponible/)).toBeInTheDocument();
  });

  it('erreur serveur 400 à l\'initiation : message affiché, le formulaire reste utilisable', async () => {
    routeur({ deposit: () => reponse(400, { error: 'Pays non disponible' }) });
    render(<MobileMoneyPanel disponible packs={PACKS} pays={PAYS} naviguer={vi.fn()} />);
    await act(async () => { choisir('large', 'CIV'); });
    await cliquerPayer();
    expect(screen.getByRole('alert')).toHaveTextContent('Pays non disponible');
    expect(screen.getByRole('button', { name: /Payer avec Mobile Money/ })).not.toBeDisabled();
  });

  it('non disponible côté serveur : aucun formulaire, aucun appel', () => {
    const { container } = render(<MobileMoneyPanel disponible={false} packs={PACKS} pays={[]} />);
    expect(container.querySelector('[data-mobile-money]')).toHaveAttribute('data-mobile-money', 'indisponible');
    expect(screen.queryByRole('button', { name: /Payer/ })).toBeNull();
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
