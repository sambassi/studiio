/**
 * ADMIN — ecran « Cinema IA — formules » : le prix se lit, il ne s'edite pas ici.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import CinemaFormulesPage from '@/app/admin/cinema-formules/page';

const NON_INCLUSE = {
  planKey: 'pro', inclus: false, filmsParMois: 0, secondesParMois: 0, dureeMaxFilmS: 0,
  qualites: [], fonctionnalites: [], budgetUsdParMois: 0, renouvellement: 'periode_abonnement',
};

let migration = true;
let reponsePut: unknown = { success: true };
let corpsEnvoye: Record<string, unknown> | null = null;

beforeEach(() => {
  migration = true; corpsEnvoye = null; reponsePut = { success: true };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      corpsEnvoye = JSON.parse(String(init.body));
      const r = reponsePut as { success: boolean };
      return new Response(JSON.stringify(r.success ? { success: true, formule: corpsEnvoye } : r));
    }
    return new Response(JSON.stringify({
      success: true,
      data: {
        migrationAppliquee: migration,
        formules: [{ planKey: 'pro', nom: 'Pro', prixMensuelCentimes: 4990, configuree: false, formule: NON_INCLUSE }],
      },
    }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ecran des formules Cinema', () => {
  it('le prix CHF est affiche en lecture, sans champ pour le modifier', async () => {
    render(<CinemaFormulesPage />);
    expect(await screen.findByText('49,90 CHF / mois')).toBeTruthy();
    expect(screen.queryByDisplayValue('49.9')).toBeNull();
    expect(screen.getByText(/Jamais configuree/)).toBeTruthy();
  });

  it('les minutes se saisissent en minutes et partent en secondes', async () => {
    render(<CinemaFormulesPage />);
    await screen.findByText('Pro');
    fireEvent.click(screen.getByLabelText('Cinema IA inclus dans cette formule'));
    const [films, minutes, dureeMax, budget] = screen.getAllByRole('spinbutton');
    fireEvent.change(films, { target: { value: '30' } });
    fireEvent.change(minutes, { target: { value: '30' } });
    fireEvent.change(dureeMax, { target: { value: '6' } });
    fireEvent.change(budget, { target: { value: '10' } });
    fireEvent.click(screen.getByLabelText('standard'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(corpsEnvoye).not.toBeNull());
    expect(corpsEnvoye).toMatchObject({
      planKey: 'pro', inclus: true, filmsParMois: 30, secondesParMois: 1800, dureeMaxFilmS: 360,
      budgetUsdParMois: 10, qualites: ['standard'],
    });
  });

  it('les erreurs du serveur sont toutes affichees', async () => {
    reponsePut = { success: false, erreurs: ['formule incluse sans aucun film', 'budget fournisseur : de 0 a 1000 $'] };
    render(<CinemaFormulesPage />);
    await screen.findByText('Pro');
    fireEvent.click(screen.getByText('Enregistrer'));
    expect(await screen.findByText('formule incluse sans aucun film')).toBeTruthy();
    expect(screen.getByText('budget fournisseur : de 0 a 1000 $')).toBeTruthy();
  });

  it('migration absente : avertissement, et rien n’est modifiable', async () => {
    migration = false;
    render(<CinemaFormulesPage />);
    expect(await screen.findByText(/non appliquee : lecture seule/)).toBeTruthy();
    expect((screen.getByText('Enregistrer').closest('button') as HTMLButtonElement).disabled).toBe(true);
    for (const champ of screen.getAllByRole('spinbutton')) expect((champ as HTMLInputElement).disabled).toBe(true);
  });
});
