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
    // Rentabilité calculée côté serveur : la page ne la devine pas, elle
    // l'affiche. `grilleConseillee` ne porte QUE les tarifs sous leur prix
    // conseillé — ici les trois avatars, vendus sous leur coût.
    margeCible: 0.4,
    change: { chfParUsd: 0.83, le: '2026-11-11', source: 'BCE' },
    changeLibelle: '1 USD = 0.83 CHF — 2026-11-11 (il y a 1 jour)',
    changePerime: false,
    rentabilite: [
      { cle: 'avatar.avatar_v', prixCredits: 40, revenuChf: 4, coutUsd: 10.32, uniteCout: '1 génération de 86 s (plafond de script)', sourceCout: 'Tarifs API HeyGen', coutAdminChf: 1.5, prixPlancherCredits: 15, prixConseilleCredits: 21, tauxEquilibreChfParUsd: 0.39, margeChf: 2.5, verdict: 'rentable', motif: 'Couvre le coût fournisseur saisi par l’administration.' },
      { cle: 'avatar.avatar_iv', prixCredits: 40, revenuChf: 4, coutUsd: 6.92, uniteCout: '1 génération de 86 s (plafond de script)', sourceCout: 'Tarifs API HeyGen', coutAdminChf: null, prixPlancherCredits: 58, prixConseilleCredits: 81, tauxEquilibreChfParUsd: 0.58, margeChf: -1.74, verdict: 'perte', motif: 'Vendu à perte : 40 crédits = 4 CHF pour 6.92 USD de coût (1 génération de 86 s (plafond de script)).' },
      { cle: 'avatar.avatar_iii', prixCredits: 40, revenuChf: 4, coutUsd: 1.42, uniteCout: '1 génération de 86 s (plafond de script)', sourceCout: 'Tarifs API HeyGen', coutAdminChf: null, prixPlancherCredits: 12, prixConseilleCredits: 17, tauxEquilibreChfParUsd: 2.82, margeChf: 2.82, verdict: 'rentable', motif: 'Couvre le coût fournisseur (1.42 USD).' },
    ],
    resumeRentabilite: {
      pertes: 1, inconnus: 15, rentables: 2,
      clesEnPerte: ['avatar.avatar_iv'],
      clesSansCout: ['audio.full_1000_chars'],
      grilleConseillee: { 'avatar.avatar_iv': 81 },
    },
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
    expect(champ(/^Premium/).value).toBe('40');
    expect(champ(/^Valeur du crédit/).value).toBe('0.1');
    expect(screen.getByText('crédit(s) par 1000 caractères')).toBeInTheDocument();
    // ⚠️ La note « valeur indicative » est remplacée par trois lignes qui
    // NOMMENT les trois notions qui se confondaient : ce que l'abonné paie
    // réellement, la valeur enregistrée (la seule qui sert aux calculs), et
    // les prix Stripe, que ce champ ne touche pas.
    expect(screen.getByText(/Valeur du crédit retenue pour les calculs/)).toBeInTheDocument();
    expect(screen.getByText(/la SEULE qui sert à calculer/)).toBeInTheDocument();
    expect(screen.getByText(/Les prix de vente Stripe/)).toBeInTheDocument();
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
    fireEvent.change(champ(/^Premium/), { target: { value: '60' } });
    expect(boutonEnregistrer()).toBeEnabled();
    fireEvent.click(boutonEnregistrer());
    const dialogue = screen.getByRole('alertdialog');
    expect(within(dialogue).getByText('Passer Premium de 40 à 60 crédits ?')).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
  });

  it('Annuler n’envoie rien', async () => {
    await ouvrir();
    fireEvent.change(champ(/^Premium/), { target: { value: '60' } });
    fireEvent.click(boutonEnregistrer());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(puts()).toHaveLength(0);
    expect(champ(/^Premium/).value).toBe('60'); // la saisie reste
  });

  it('Confirmer envoie un PUT avec les seules clés modifiées', async () => {
    await ouvrir();
    fireEvent.change(champ(/^Premium/), { target: { value: '60' } });
    fireEvent.change(champ(/^OCR/), { target: { value: '2' } });
    fireEvent.click(boutonEnregistrer());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(JSON.parse(String(puts()[0].init!.body))).toEqual({ prix: { 'avatar.avatar_v': 60, 'ai.ocr': 2 } });
    await screen.findByText(/Tarifs enregistrés/);
  });

  it('valeur négative → erreur affichée et enregistrement bloqué', async () => {
    await ouvrir();
    fireEvent.change(champ(/^Premium/), { target: { value: '-3' } });
    expect(screen.getByText('Le tarif ne peut pas être négatif.')).toBeInTheDocument();
    expect(boutonEnregistrer()).toBeDisabled();
    fireEvent.click(boutonEnregistrer());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.change(champ(/^Premium/), { target: { value: '2.5' } });
    expect(screen.getByText('Nombre entier attendu.')).toBeInTheDocument();
    fireEvent.change(champ(/^Premium/), { target: { value: '10001' } });
    expect(screen.getByText(/Maximum/)).toBeInTheDocument();
    expect(boutonEnregistrer()).toBeDisabled();
    expect(puts()).toHaveLength(0);
  });

  /**
   * ⚠️ Remplace « Appliquer les tarifs proposés », qui remplissait 10/25/40 —
   * trois montants FIGÉS dans le catalogue, tous SOUS le coût du fournisseur.
   * Le prix proposé vient maintenant du plancher calculé (coût réel × taux
   * daté + marge visée), et seuls les tarifs réellement sous ce plancher
   * sont proposés à la hausse.
   */
  it('« Appliquer les prix conseillés » remplit les tarifs sous leur coût, sans enregistrer', async () => {
    await ouvrir();
    // Seul Qualité est sous son prix conseillé : lui seul est proposé.
    expect(screen.getByText(/Sous le prix conseillé : Qualité 40 → 81/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Appliquer les prix conseillés/ }));
    expect(champ(/^Qualité/).value).toBe('81');
    expect(champ(/^Standard/).value).toBe('40');
    expect(champ(/^Premium/).value).toBe('40');
    expect(puts()).toHaveLength(0);
    expect(boutonEnregistrer()).toBeEnabled();
    fireEvent.click(boutonEnregistrer());
    const lignes = within(screen.getByRole('alertdialog')).getAllByRole('listitem').map((l) => l.textContent);
    expect(lignes).toEqual(['Passer Qualité de 40 à 81 crédits ?']);
  });

  it('affiche le verdict, le plancher et l’alerte de vente à perte', async () => {
    await ouvrir();
    expect(screen.getByTestId('alerte-vente-a-perte').textContent).toMatch(/Un tarif est vendu/);
    const ligne = screen.getByTestId('verdict-avatar.avatar_iv').textContent ?? '';
    expect(ligne).toContain('Vendu à perte');
    expect(ligne).toContain('plancher 58 · conseillé 81');
    expect(screen.getByTestId('etat-taux').textContent).toContain('1 USD = 0.83 CHF');
  });

  it('la marge visée est modifiable et part en pourcentage converti', async () => {
    await ouvrir();
    expect(champ(/^Marge visée/).value).toBe('40');
    fireEvent.change(champ(/^Marge visée/), { target: { value: '60' } });
    fireEvent.click(boutonEnregistrer());
    const lignes = within(screen.getByRole('alertdialog')).getAllByRole('listitem').map((l) => l.textContent);
    expect(lignes).toEqual(['Passer la marge visée de 40 % à 60 % ?']);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Confirmer/ }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(JSON.parse(String(puts()[0].init?.body))).toEqual({ margeCible: 0.6 });
  });

  it('erreur de validation serveur → affichée sous le champ', async () => {
    reponsePut = { status: 400, corps: { success: false, error: 'Tarifs invalides', erreurs: [{ champ: 'avatar.avatar_v', message: 'Entier entre 0 et 10 000 attendu.' }] } };
    await ouvrir();
    fireEvent.change(champ(/^Premium/), { target: { value: '60' } });
    fireEvent.click(boutonEnregistrer());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Entier entre 0 et 10 000 attendu.')).toBeInTheDocument();
    expect(champ(/^Premium/)).toHaveAttribute('aria-invalid', 'true');
  });
});
