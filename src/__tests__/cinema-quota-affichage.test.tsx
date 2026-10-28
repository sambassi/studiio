/**
 * CINEMA IA — l'indicateur de quota : discret, mais jamais muet sur une limite.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import QuotaCinema from '@/components/cinema/QuotaCinema';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const servir = (corps: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(corps))));
const ABONNE = {
  ok: true, regime: 'abonnement', filmsUtilises: 3, filmsInclus: 30, dureeUtilisee: '4 min', dureeIncluse: '30 min',
  dureeProjet: '1 min 10 s', dureeMaxFilmS: 360, disponible: true, message: null, projetCouvert: true, partBudgetEngagee: 0.2,
};

describe('indicateur de quota', () => {
  it('regime credits : RIEN n’est rendu — l’ecran reste celui d’aujourd’hui', async () => {
    servir({ ok: true, regime: 'credits' });
    const { container } = render(<QuotaCinema filmId="f" version="" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('abonne : films, minutes, duree du projet et disponibilite', async () => {
    servir(ABONNE);
    render(<QuotaCinema filmId="f" version="" />);
    expect(await screen.findByText('3 / 30 films')).toBeTruthy();
    expect(screen.getByText('4 min / 30 min')).toBeTruthy();
    expect(screen.getByText('projet ≈ 1 min 10 s')).toBeTruthy();
    expect(screen.getByText('Disponible')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Detail du quota'));
    expect(screen.getByText(/aucun depassement payant/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it('limite atteinte : le message est visible SANS ouvrir le detail', async () => {
    servir({ ...ABONNE, disponible: false, message: 'Vous avez utilise toutes les minutes incluses ce mois-ci.' });
    render(<QuotaCinema filmId="f" version="" />);
    expect(await screen.findByText('Limite atteinte')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/minutes incluses/);
  });

  it('administrateur : cout fournisseur reel, en dollars', async () => {
    servir({ ok: true, regime: 'cout_reel', devis: { totalUsd: 0.48, imagesUsd: 0.03, animationsUsd: 0.45, dureeProjetS: 70 } });
    render(<QuotaCinema filmId="f" version="" />);
    expect(await screen.findByText(/Cout fournisseur reel · projet estime 0\.48 \$/)).toBeTruthy();
  });

  it('periode non verifiable : message d’indisponibilite', async () => {
    servir({ ok: true, regime: 'indisponible', message: 'La periode de votre abonnement n’a pas pu etre verifiee' });
    render(<QuotaCinema filmId="f" version="" />);
    expect((await screen.findByRole('status')).textContent).toMatch(/periode/);
  });

  it('relu apres chaque generation (changement de version)', async () => {
    servir(ABONNE);
    const { rerender } = render(<QuotaCinema filmId="f" version="a" />);
    await screen.findByText('3 / 30 films');
    rerender(<QuotaCinema filmId="f" version="b" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
