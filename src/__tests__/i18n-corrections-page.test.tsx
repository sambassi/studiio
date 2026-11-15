// Page d'administration « Traductions » : liste, filtres, correction, validation, import, export.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TraductionsAdminPage from '@/app/admin/traductions/page';

const ligne = (cle: string, fr: string, texte: string, statut: string, extra = {}) => ({ cle, ns: cle.split('.')[0], fr, texte, statut, confiance: '', source: '', ...extra });
const LIGNES = [
  ligne('common.close', 'Fermer', 'Kokanga', 'non_validee_a_verifier', { source: 'savoir' }),
  ligne('common.save', 'Enregistrer', 'Kobómbisa', 'non_validee_attestee', { source: 'corpus:mw-core' }),
  ligne('sidebar.dashboard', 'Tableau de bord', '', 'manquante'),
  ligne('auth.login', 'Connexion', 'Kokɔta', 'validee', { par: 'admin@x' }),
];
const compteurs = { total: 4, traduites: 3, validees: 1, attestees: 1, aVerifier: 1, nonValidees: 2, manquantes: 1, pourcentTraduit: 75 };

let appels: Array<{ url: string; init?: RequestInit }>;
let patchReponse: (corps: Record<string, unknown>) => unknown;

beforeEach(() => {
  appels = [];
  patchReponse = (c) => ({ success: true, ligne: ligne(String(c.cle), 'x', String(c.texte ?? 'Kokanga'), c.valider ? 'validee' : 'non_validee'), compteurs: { ...compteurs, validees: 2 } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({ url: String(url), init });
    if (init?.method === 'PATCH') return new Response(JSON.stringify(patchReponse(JSON.parse(String(init.body)))), { status: 200 });
    if (init?.method === 'POST') return new Response(JSON.stringify({ success: true, rapport: { importees: 2, inchangees: 1, vides: 3, refusees: [{ cle: 'a.b', raison: 'Clé inconnue' }], refuseesTotal: 1 }, compteurs }), { status: 200 });
    return new Response(JSON.stringify({ success: true, locale: 'ln', statutAffiche: 'partial', compteurs, lignes: LIGNES }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('page admin Traductions', () => {
  it('charge le lingala, affiche la mention « Partiel », les compteurs et par défaut les NON VALIDÉES', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    expect(appels[0].url).toBe('/api/admin/traductions?locale=ln');
    expect(screen.getByTestId('tr-mention').textContent).toBe('Partiel');
    expect(within(screen.getByTestId('tr-compteurs')).getByText('Non validées').nextSibling?.textContent).toBe('2');
    expect(screen.getByTestId('tr-ligne-common.close')).toBeTruthy();
    expect(screen.getByTestId('tr-ligne-common.save')).toBeTruthy();
    expect(screen.queryByTestId('tr-ligne-auth.login')).toBeNull();                // validée : filtrée
    expect(screen.queryByTestId('tr-ligne-sidebar.dashboard')).toBeNull();         // manquante : filtrée
    // Badge COURT (une ligne) ; le détail de la source vit en ligne de description, pas dans le badge.
    expect(screen.getByTestId('tr-statut-common.close').textContent).toBe('À vérifier');
    expect(screen.getByTestId('tr-statut-common.close').getAttribute('title')).toMatch(/à vérifier en priorité/);
    expect(screen.getByTestId('tr-ligne-common.close').textContent).toMatch(/Source à vérifier · savoir/);
    expect(screen.getByTestId('tr-ligne-common.save').textContent).toMatch(/Source attestée · corpus:mw-core/);
  });

  it('les filtres Validées / Manquantes / Toutes et la recherche', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    fireEvent.click(screen.getByTestId('tr-filtre-validees'));
    expect(screen.getByTestId('tr-ligne-auth.login')).toBeTruthy();
    expect(screen.queryByTestId('tr-ligne-common.close')).toBeNull();
    fireEvent.click(screen.getByTestId('tr-filtre-manquantes'));
    expect(screen.getByTestId('tr-statut-sidebar.dashboard').textContent).toMatch(/Manquante/);
    fireEvent.click(screen.getByTestId('tr-filtre-toutes'));
    expect(screen.getByTestId('tr-nb').textContent).toContain('4');
    fireEvent.change(screen.getByTestId('tr-recherche'), { target: { value: 'kokɔta' } });
    expect(screen.getByTestId('tr-nb').textContent).toContain('1 ');
  });

  it('changer de langue recharge la table de CETTE langue', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    fireEvent.click(screen.getByTestId('tr-langue-wo'));
    await waitFor(() => expect(appels.some((a) => a.url === '/api/admin/traductions?locale=wo')).toBe(true));
  });

  it('Modifier → Enregistrer et valider : envoie texte + valider, met la ligne à jour', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    fireEvent.click(screen.getByTestId('tr-modifier-common.close'));
    fireEvent.change(screen.getByTestId('tr-edition'), { target: { value: 'Kokanga ya sika' } });
    fireEvent.click(screen.getByTestId('tr-enregistrer-valider'));
    // La ligne validée QUITTE la liste « Non validées » (on traite la file au fur et à mesure)…
    await waitFor(() => expect(screen.queryByTestId('tr-ligne-common.close')).toBeNull());
    // …et se retrouve parmi les « Validées ».
    fireEvent.click(screen.getByTestId('tr-filtre-validees'));
    expect(screen.getByTestId('tr-statut-common.close').textContent).toBe('Validée');
    const patch = appels.find((a) => a.init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch.init!.body))).toEqual({ locale: 'ln', cle: 'common.close', texte: 'Kokanga ya sika', valider: true });
  });

  it('Enregistrer (non validée) ne demande PAS la validation', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    fireEvent.click(screen.getByTestId('tr-modifier-common.save'));
    fireEvent.change(screen.getByTestId('tr-edition'), { target: { value: 'Kobómbisa 2' } });
    fireEvent.click(screen.getByTestId('tr-enregistrer'));
    await waitFor(() => expect(appels.some((a) => a.init?.method === 'PATCH')).toBe(true));
    expect(JSON.parse(String(appels.find((a) => a.init?.method === 'PATCH')!.init!.body))).toEqual({ locale: 'ln', cle: 'common.save', texte: 'Kobómbisa 2' });
  });

  it('le bouton Valider envoie seulement valider:true', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    fireEvent.click(screen.getByTestId('tr-valider-common.close'));
    await waitFor(() => expect(appels.some((a) => a.init?.method === 'PATCH')).toBe(true));
    expect(JSON.parse(String(appels.find((a) => a.init?.method === 'PATCH')!.init!.body))).toEqual({ locale: 'ln', cle: 'common.close', valider: true });
  });

  it('un refus du serveur (variables) est affiché, la ligne reste inchangée', async () => {
    patchReponse = () => ({ success: false, error: 'Variables à conserver exactement : {n}' });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Response(JSON.stringify(patchReponse({})), { status: 422 });
      return new Response(JSON.stringify({ success: true, statutAffiche: 'partial', compteurs, lignes: LIGNES }), { status: 200 });
    }));
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    fireEvent.click(screen.getByTestId('tr-modifier-common.close'));
    fireEvent.click(screen.getByTestId('tr-enregistrer'));
    expect((await screen.findByRole('status')).textContent).toMatch(/Variables à conserver/);
    expect(screen.getByTestId('tr-statut-common.close').textContent).toBe('À vérifier');
  });

  it('import : envoie le CSV et l\'option « validées », affiche le rapport', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    const f = new File(['cle;francais;traduction\ncommon.close;Fermer;Kokanga'], 'ln.csv', { type: 'text/csv' });
    Object.defineProperty(f, 'text', { value: async () => 'cle;francais;traduction\ncommon.close;Fermer;Kokanga' });
    fireEvent.change(screen.getByTestId('tr-fichier'), { target: { files: [f] } });
    fireEvent.click(screen.getByTestId('tr-validees'));
    fireEvent.click(screen.getByTestId('tr-importer'));
    const rapport = await screen.findByTestId('tr-rapport');
    expect(rapport.textContent).toMatch(/2 importée\(s\) · 1 inchangée\(s\) · 3 vide\(s\) ignorée\(s\) · 1 refusée\(s\)/);
    expect(rapport.textContent).toMatch(/Clé inconnue/);
    const post = appels.find((a) => a.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ locale: 'ln', csv: 'cle;francais;traduction\ncommon.close;Fermer;Kokanga', validees: true });
  });

  it('l\'export est un lien vers le CSV de la langue courante', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    expect(screen.getByTestId('tr-export').getAttribute('href')).toBe('/api/admin/traductions?locale=ln&format=csv');
  });

  it('une réponse réseau qui arrive APRÈS un clic n’écrase pas le filtre choisi', async () => {
    let debloquer: () => void = () => {};
    const attente = new Promise<void>((r) => { debloquer = r; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await attente;
      return new Response(JSON.stringify({ success: true, locale: 'ln', statutAffiche: 'partial', compteurs: { ...compteurs, propositionsIA: 3 }, lignes: LIGNES }), { status: 200 });
    }));
    render(<TraductionsAdminPage />);
    // Pendant le chargement, l'utilisateur choisit « Validées ».
    fireEvent.click(screen.getByTestId('tr-filtre-validees'));
    expect(screen.getByTestId('tr-filtre-validees').getAttribute('aria-pressed')).toBe('true');
    debloquer();
    await screen.findByTestId('tr-table');
    // La réponse portait des propositions IA : sans garde, elle aurait basculé le filtre.
    expect(screen.getByTestId('tr-filtre-validees').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tr-filtre-propositions').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('tr-ligne-auth.login')).toBeTruthy();
  });

  it('le double rendu de React en mode strict ne remet pas le filtre à zéro', async () => {
    // En mode strict, l'effet de chargement part DEUX fois. On retarde la seconde réponse pour
    // qu'elle arrive après le clic de l'utilisateur : c'est exactement le défaut observé au banc.
    let debloquer: () => void = () => {};
    const attente = new Promise<void>((r) => { debloquer = r; });
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      if (n >= 2) await attente;
      return new Response(JSON.stringify({ success: true, locale: 'ln', statutAffiche: 'partial', compteurs: { ...compteurs, propositionsIA: 3 }, lignes: LIGNES }), { status: 200 });
    }));
    render(<StrictMode><TraductionsAdminPage /></StrictMode>);
    await screen.findByTestId('tr-table');
    expect(n, 'le mode strict déclenche bien deux chargements').toBe(2);
    fireEvent.click(screen.getByTestId('tr-filtre-manquantes'));
    debloquer();
    await waitFor(() => expect(screen.getByTestId('tr-ligne-sidebar.dashboard')).toBeTruthy());
    expect(screen.getByTestId('tr-filtre-manquantes').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tr-filtre-propositions').getAttribute('aria-pressed')).toBe('false');
  });

  it('choisir une langue à corriger NE change PAS la langue de l’administrateur', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    expect(screen.getByTestId('tr-langue-admin').textContent).toMatch(/Votre interface reste en Français/);
    fireEvent.click(screen.getByTestId('tr-langue-wo'));
    await waitFor(() => expect(appels.some((a) => a.url === '/api/admin/traductions?locale=wo')).toBe(true));
    // Aucun cookie `locale` posé, aucun appel aux préférences : le seul mécanisme i18n reste celui de Studiio.
    expect(document.cookie).not.toMatch(/\blocale=/);
    expect(appels.some((a) => a.url.includes('/api/user/preferences'))).toBe(false);
    expect(screen.getByTestId('tr-langue-admin').textContent).toMatch(/Votre interface reste en Français/);
  });

  it('une traduction manquante affiche « Français affiché » et propose « Traduire »', async () => {
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    fireEvent.click(screen.getByTestId('tr-filtre-manquantes'));
    const ligne = screen.getByTestId('tr-ligne-sidebar.dashboard');
    expect(ligne.textContent).toMatch(/Français affiché/);
    expect(screen.getByTestId('tr-modifier-sidebar.dashboard').textContent).toBe('Traduire');
  });

  it('modifier une traduction VALIDÉE demande confirmation', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    fireEvent.click(screen.getByTestId('tr-filtre-validees'));
    fireEvent.click(screen.getByTestId('tr-modifier-auth.login'));
    expect(confirmer).toHaveBeenCalled();
    expect(screen.queryByTestId('tr-edition')).toBeNull();       // refus : rien ne s'ouvre
    confirmer.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('tr-modifier-auth.login'));
    expect(screen.getByTestId('tr-edition')).toBeTruthy();
    confirmer.mockRestore();
  });

  it('une proposition IA s’ouvre par « Examiner », puis s’approuve ou se corrige', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({ url: String(url), init });
      if (init?.method === 'PATCH') return new Response(JSON.stringify(patchReponse(JSON.parse(String(init.body)))), { status: 200 });
      return new Response(JSON.stringify({
        success: true, locale: 'ln', statutAffiche: 'partial',
        compteurs: { ...compteurs, propositionsIA: 1 },
        lignes: [ligne('common.loading', 'Chargement...', '', 'proposee_ia', { proposition: 'Ezali kozela...' })],
      }), { status: 200 });
    }));
    render(<TraductionsAdminPage />);
    await screen.findByTestId('tr-table');
    expect(screen.getByTestId('tr-statut-common.loading').textContent).toBe('Proposition IA');
    expect(screen.queryByTestId('tr-approuver-common.loading')).toBeNull();   // rien ne s'approuve sans examen
    fireEvent.click(screen.getByTestId('tr-examiner-common.loading'));
    expect((screen.getByTestId('tr-edition') as HTMLTextAreaElement).value).toBe('Ezali kozela...');
    fireEvent.click(screen.getByTestId('tr-approuver-common.loading'));
    await waitFor(() => expect(appels.some((a) => a.init?.method === 'PATCH')).toBe(true));
    expect(JSON.parse(String(appels.find((a) => a.init?.method === 'PATCH')!.init!.body))).toEqual({ locale: 'ln', cle: 'common.loading', texte: 'Ezali kozela...', valider: true });
  });

  it('une erreur de chargement est annoncée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'Lecture des corrections impossible (base indisponible)' }), { status: 503 })));
    render(<TraductionsAdminPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/base indisponible/);
  });
});
