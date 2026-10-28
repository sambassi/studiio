/**
 * CINEMA IA — l'indicateur de quota et la confirmation du budget du projet : discret,
 * mais jamais muet sur une limite ni sur un budget a confirmer.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import QuotaCinema from '@/components/cinema/QuotaCinema';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Sert `lectures` successives au GET ; enregistre les POST. */
function servir(...lectures: unknown[]) {
  const posts: unknown[] = [];
  let i = 0;
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ok: true })); }
    const corps = lectures[Math.min(i, lectures.length - 1)];
    i++;
    return new Response(JSON.stringify(corps));
  });
  vi.stubGlobal('fetch', f);
  return { f, posts };
}

const ABONNE = {
  ok: true, regime: 'abonnement', filmsUtilises: 3, filmsInclus: 30, dureeUtilisee: '4 min', dureeIncluse: '30 min',
  scenes: 2, plans: 5, dureeProjet: '1 min 10 s', dureeMaxFilmS: 360, disponible: true, message: null,
  partBudgetProjet: { images: 0.02, complet: 0.4 }, partBudgetEngagee: 0.2, budgetApprouve: null,
};
const ADMIN = {
  ok: true, regime: 'cout_reel', plafondFilmUsd: 2, budgetApprouve: null,
  devis: { scenes: 2, plans: 5, dureeProjetS: 70, imagesManquantes: 5, animationsPossibles: 5, perimetres: { images: 0.02, complet: 0.48 }, dejaEngageUsd: 0 },
};

describe('indicateur de quota', () => {
  it('regime credits : RIEN n’est rendu — l’ecran reste celui d’aujourd’hui', async () => {
    const { f } = servir({ ok: true, regime: 'credits' });
    const { container } = render(<QuotaCinema filmId="f" version="" />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('abonne : films, minutes, duree du projet, disponibilite — et aucun dollar', async () => {
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

  it('periode non verifiable : message d’indisponibilite', async () => {
    servir({ ok: true, regime: 'indisponible', message: 'La periode de votre abonnement n’a pas pu etre verifiee' });
    render(<QuotaCinema filmId="f" version="" />);
    expect((await screen.findByRole('status')).textContent).toMatch(/periode/);
  });

  it('relu apres chaque generation (changement de version)', async () => {
    const { f } = servir(ABONNE);
    const { rerender } = render(<QuotaCinema filmId="f" version="a" />);
    await screen.findByText('3 / 30 films');
    rerender(<QuotaCinema filmId="f" version="b" />);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });
});

describe('confirmation du budget du projet', () => {
  it('abonne : a confirmer, en PART du budget restant ; le choix part en POST puis l’ecran relit', async () => {
    const { posts } = servir(ABONNE, { ...ABONNE, budgetApprouve: { perimetre: 'images' } });
    render(<QuotaCinema filmId="f" version="" />);
    expect(await screen.findByText(/Confirmez le budget du projet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Images · 2 % du budget restant/ }));
    expect(await screen.findByText(/Budget du projet confirme \(images\)/)).toBeTruthy();
    expect(posts).toEqual([{ perimetre: 'images' }]);
  });

  it('administrateur : devis en dollars, deja engage, et choix du perimetre', async () => {
    servir(ADMIN);
    render(<QuotaCinema filmId="f" version="" />);
    expect(await screen.findByText(/Cout fournisseur reel · 2 scenes · 5 plans · deja engage 0\.00 \$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Images \+ animations · 0\.48 \$/ })).toBeTruthy();
  });

  it('tarif inconnu : le perimetre ne peut pas etre confirme', async () => {
    servir({ ...ADMIN, devis: { ...ADMIN.devis, perimetres: { images: 0.02, complet: null } } });
    render(<QuotaCinema filmId="f" version="" />);
    const bouton = await screen.findByRole('button', { name: /Images \+ animations · tarif inconnu/ });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
  });

  it('un refus du serveur est affiche', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => new Response(JSON.stringify(
      init?.method === 'POST' ? { ok: false, erreur: 'Ce projet depasse le budget de generation restant' } : ABONNE))));
    render(<QuotaCinema filmId="f" version="" />);
    fireEvent.click(await screen.findByRole('button', { name: /Images · 2 %/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/budget de generation restant/);
  });
});
