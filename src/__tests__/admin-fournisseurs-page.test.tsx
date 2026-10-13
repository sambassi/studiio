import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import FournisseursPage from '@/app/admin/fournisseurs/page';

/**
 * Admin › Fournisseurs : l'écran rend l'état, l'attente et l'économie telles
 * que l'API les donne — un coût non mesuré s'affiche « non mesuré », jamais 0.
 */

const configHeygen = { seuilBas: 30, seuilCritique: 10, autoRechargeAttendue: true, montantRecharge: 30, maxRechargesJour: 3, maxRechargesMois: 20 };
const configReplicate = { seuilBas: 20, seuilCritique: 5, autoRechargeAttendue: true, montantRecharge: 15, maxRechargesJour: 3, maxRechargesMois: 20 };

const etat = (o: Record<string, unknown>) => ({
  statut: 'inconnu', solde: null, devise: 'usd', autoReload: null,
  derniereVerification: null, derniereRecharge: null, derniereRechargeMontant: null,
  rechargesJour: { jour: '', n: 0 }, rechargesMois: { mois: '', n: 0 },
  derniereConsommation: null, derniereErreur: null, bloqueDepuis: null, ...o,
});

const REPONSE = {
  success: true,
  data: {
    fournisseurs: [
      {
        id: 'heygen', nom: 'HeyGen',
        capacites: { soldeApi: true, unite: 'usd', rechargeOfficielle: 'Auto-reload du wallet API HeyGen.' },
        config: configHeygen,
        etat: etat({ statut: 'bloque', solde: 0, derniereErreur: 'Insufficient credit (brut)', bloqueDepuis: '2026-10-12T08:00:00.000Z', autoReload: { active: false, seuil: null, montant: null } }),
        alertes: [{ id: 'a1', severity: 'critical', message: 'HeyGen bloqué : solde épuisé', details: null, timestamp: '2026-10-12T08:00:00.000Z', dismissed: false }],
      },
      {
        id: 'replicate', nom: 'Replicate',
        capacites: { soldeApi: false, unite: 'usd', rechargeOfficielle: 'Aucune API de solde.' },
        config: configReplicate,
        etat: etat({ statut: 'operationnel' }),
        alertes: [],
      },
    ],
    generationsEnAttente: 2,
    economie: [
      {
        mois: '2026-10',
        parFournisseur: { heygen: { generations: 3, mesurees: 0, coutEur: null } },
        generations: 3, coutFournisseurEur: null, coutMoyenVideoEur: null, prixStudiioEur: null, margeBruteEur: null, nonMesurees: 3,
      },
    ],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const methode = init?.method ?? 'GET';
    const corps = methode === 'PATCH'
      ? { success: true, data: { config: configHeygen } }
      : methode === 'POST'
        ? { success: true, data: { etat: REPONSE.data.fournisseurs[0].etat, enCours: false } }
        : REPONSE;
    return { ok: true, json: async () => corps } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const carte = async (nom: string) => {
  const titre = await screen.findByText(nom, { selector: 'h3 span, h3' });
  return titre.closest('.card-base') as HTMLElement;
};

describe('Admin › Fournisseurs', () => {
  it('affiche bloqué, non mesurable, le bandeau d’attente et « non mesuré » en économie', async () => {
    render(<FournisseursPage />);
    expect(await screen.findByTestId('statut-heygen')).toHaveTextContent('bloqué');
    expect(screen.getByText('Non mesurable (aucune API de solde)')).toBeInTheDocument();
    expect(screen.getByText(/2 génération\(s\) en attente du fournisseur — reprise automatique/)).toBeInTheDocument();
    expect(screen.getByText(/Studiio ne déclenche aucun paiement/)).toBeInTheDocument();
    expect(screen.getByText('Insufficient credit (brut)')).toBeInTheDocument();
    expect(screen.getByText('HeyGen bloqué : solde épuisé')).toBeInTheDocument();

    const ligne = screen.getByText('2026-10').closest('tr') as HTMLElement;
    expect(within(ligne).getAllByText('non mesuré').length).toBeGreaterThanOrEqual(4);
    expect(within(ligne).queryByText(/0\.00 €/)).toBeNull();
    expect(screen.getByText(/Seules les générations d’avatar sont mesurées/)).toBeInTheDocument();

    const heygen = await carte('HeyGen');
    expect(within(heygen).getByText('Voir consommation').closest('a')).toHaveAttribute('href', '/admin/avatar-couts');
    const replicate = await carte('Replicate');
    expect(within(replicate).getByText('Voir consommation').closest('a')).toHaveAttribute('href', '#economie');
  });

  it('Configurer puis Enregistrer envoie un PATCH avec la configuration', async () => {
    render(<FournisseursPage />);
    const heygen = await carte('HeyGen');
    fireEvent.click(within(heygen).getByText('Configurer'));
    fireEvent.change(within(heygen).getByLabelText('Seuil bas'), { target: { value: '50' } });
    fireEvent.click(within(heygen).getByText('Enregistrer'));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(url).toBe('/api/admin/fournisseurs');
    expect(JSON.parse(init.body)).toEqual({ fournisseur: 'heygen', config: { ...configHeygen, seuilBas: 50 } });
    // Rechargement après enregistrement.
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => (i?.method ?? 'GET') === 'GET').length).toBe(2));
  });

  it('Vérifier le solde envoie un POST verifier', async () => {
    render(<FournisseursPage />);
    const replicate = await carte('Replicate');
    fireEvent.click(within(replicate).getByText('Vérifier le solde'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(JSON.parse(init.body)).toEqual({ fournisseur: 'replicate', action: 'verifier' });
  });
});
