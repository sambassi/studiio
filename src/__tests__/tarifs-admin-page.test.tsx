/**
 * Page `/admin/tarifs` — rendu, saisie, confirmation, envoi des seuls champs modifiés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import TarifsAdminPage from '@/app/admin/tarifs/page';
import { CATALOGUE_TARIFS, TARIFS_DEFAUT, TARIFS_GRATUITS } from '@/lib/tarifs/catalogue';

function reponseGet(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    catalogue: CATALOGUE_TARIFS,
    gratuits: TARIFS_GRATUITS,
    max: 10_000,
    prix: { ...TARIFS_DEFAUT, 'render.reel': 12 },
    valeurCreditChf: 0.1,
    coutsFournisseur: { 'avatar.avatar_v': { chf: 1.5, unite: '/ génération' } },
    source: 'configuration',
    historique: [{ cle: 'render.reel', ancien: 10, nouveau: 12, admin: 'contact.artboost@gmail.com', le: '2026-10-09T08:30:00.000Z' }],
    ...extra,
  };
}

let appels: Array<{ url: string; init?: RequestInit }>;
let get: Record<string, unknown>;
let reponsePut: { status: number; corps: unknown };

beforeEach(() => {
  appels = [];
  get = reponseGet();
  reponsePut = { status: 200, corps: { success: true, changements: [] } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({ url, init });
    if (init?.method === 'PUT') return new Response(JSON.stringify(reponsePut.corps), { status: reponsePut.status });
    return new Response(JSON.stringify(get), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const puts = () => appels.filter((a) => a.init?.method === 'PUT');
const champ = (libelle: RegExp) => screen.getByLabelText(libelle) as HTMLInputElement;
const boutonEnregistrer = () => screen.getByRole('button', { name: /Enregistrer les modifications/ });

async function ouvrir() {
  render(<TarifsAdminPage />);
  await screen.findByRole('heading', { name: /Tarifs & crédits/ });
}

describe('/admin/tarifs', () => {
  it('rend les sections et les valeurs lues', async () => {
    await ouvrir();
    for (const titre of ['Audio', 'Vidéo', 'Avatar', 'IA image', 'Autres']) {
      expect(screen.getByRole('heading', { name: titre })).toBeInTheDocument();
    }
    expect(champ(/^Reel \(9:16\)/).value).toBe('12');
    expect(champ(/^Premium — Avatar V/).value).toBe('40');
    expect(champ(/^Valeur du crédit/).value).toBe('0.1');
    expect(screen.getByText('crédit(s) par 1000 caractères')).toBeInTheDocument();
    expect(screen.getByText(/ne modifie pas les packs de paiement Stripe/)).toBeInTheDocument();
    expect(screen.getByText(/Pexels/)).toBeInTheDocument();
    expect(screen.getByText(/Pré-écoute voix/)).toBeInTheDocument();
    // 40 × 0,10 = 4 CHF client, coût 1,5 → marge 2,5
    expect(screen.getByText(/≈ 4,00 CHF client · marge ≈/)).toBeInTheDocument();
    const h = screen.getByTestId('historique-tarifs');
    expect(within(h).getByText(/Reel \(9:16\)/)).toBeInTheDocument();
    expect(within(h).getByText(/contact\.artboost@gmail\.com/)).toBeInTheDocument();
    expect(boutonEnregistrer()).toBeDisabled();
    expect(screen.queryByText(/Configuration illisible/)).not.toBeInTheDocument();
  });

  it('source « defaut » → bandeau', async () => {
    get = reponseGet({ source: 'defaut' });
    await ouvrir();
    expect(screen.getByText('Configuration illisible — prix de repli affichés.')).toBeInTheDocument();
  });

  it('modifier une valeur active Enregistrer ; la confirmation liste « de 40 à 60 »', async () => {
    await ouvrir();
    fireEvent.change(champ(/^Premium — Avatar V/), { target: { value: '60' } });
    expect(boutonEnregistrer()).toBeEnabled();
    fireEvent.click(boutonEnregistrer());
    const dialogue = screen.getByRole('alertdialog');
    expect(within(dialogue).getByText('Passer Premium — Avatar V de 40 à 60 crédits ?')).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
  });

  it('Annuler n’envoie rien', async () => {
    await ouvrir();
    fireEvent.change(champ(/^Premium — Avatar V/), { target: { value: '60' } });
    fireEvent.click(boutonEnregistrer());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(puts()).toHaveLength(0);
    expect(champ(/^Premium — Avatar V/).value).toBe('60'); // la saisie reste
  });

  it('Confirmer envoie un PUT avec les seules clés modifiées', async () => {
    await ouvrir();
    fireEvent.change(champ(/^Premium — Avatar V/), { target: { value: '60' } });
    fireEvent.change(champ(/^OCR/), { target: { value: '2' } });
    fireEvent.click(boutonEnregistrer());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(JSON.parse(String(puts()[0].init!.body))).toEqual({ prix: { 'avatar.avatar_v': 60, 'ai.ocr': 2 } });
    await screen.findByText(/Tarifs enregistrés/);
  });

  it('valeur négative → erreur affichée et enregistrement bloqué', async () => {
    await ouvrir();
    fireEvent.change(champ(/^Premium — Avatar V/), { target: { value: '-3' } });
    expect(screen.getByText('Le tarif ne peut pas être négatif.')).toBeInTheDocument();
    expect(boutonEnregistrer()).toBeDisabled();
    fireEvent.click(boutonEnregistrer());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.change(champ(/^Premium — Avatar V/), { target: { value: '2.5' } });
    expect(screen.getByText('Nombre entier attendu.')).toBeInTheDocument();
    fireEvent.change(champ(/^Premium — Avatar V/), { target: { value: '10001' } });
    expect(screen.getByText(/Maximum/)).toBeInTheDocument();
    expect(boutonEnregistrer()).toBeDisabled();
    expect(puts()).toHaveLength(0);
  });

  it('« Appliquer les tarifs proposés » remplit 10/25/40 sans enregistrer', async () => {
    await ouvrir();
    fireEvent.click(screen.getByRole('button', { name: /Appliquer les tarifs proposés/ }));
    expect(champ(/^Standard — Avatar III/).value).toBe('10');
    expect(champ(/^Qualité — Avatar IV/).value).toBe('25');
    expect(champ(/^Premium — Avatar V/).value).toBe('40');
    expect(puts()).toHaveLength(0);
    expect(boutonEnregistrer()).toBeEnabled();
    fireEvent.click(boutonEnregistrer());
    const lignes = within(screen.getByRole('alertdialog')).getAllByRole('listitem').map((l) => l.textContent);
    expect(lignes).toEqual([
      'Passer Standard — Avatar III de 40 à 10 crédits ?',
      'Passer Qualité — Avatar IV de 40 à 25 crédits ?',
    ]);
  });

  it('erreur de validation serveur → affichée sous le champ', async () => {
    reponsePut = { status: 400, corps: { success: false, error: 'Tarifs invalides', erreurs: [{ champ: 'avatar.avatar_v', message: 'Entier entre 0 et 10 000 attendu.' }] } };
    await ouvrir();
    fireEvent.change(champ(/^Premium — Avatar V/), { target: { value: '60' } });
    fireEvent.click(boutonEnregistrer());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Entier entre 0 et 10 000 attendu.')).toBeInTheDocument();
    expect(champ(/^Premium — Avatar V/)).toHaveAttribute('aria-invalid', 'true');
  });
});
