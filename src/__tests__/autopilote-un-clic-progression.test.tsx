import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

/**
 * Autopilote — UN CLIC = UNE GÉNÉRATION, et UNE progression honnête.
 *
 * 1. Avec avatar (compte « frais partenaires ») : le coût HeyGen est affiché
 *    dans le cadre « Lancer le rendu » ; ce clic le confirme. Avant : la
 *    requête partait sans confirmation, le serveur répondait 428 et une
 *    seconde fenêtre redemandait le même accord (2e clic).
 * 2. Jamais deux pourcentages contradictoires ; 100 % réservé au MP4 livré ;
 *    avec avatar, l'avancement RÉEL du montage final est montré dans le suivi
 *    « avatar » (y compris après rechargement).
 *
 * Le VRAI panneau est monté, l'API est doublée : aucun appel fournisseur.
 */

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
// La fenêtre « Coût fournisseur estimé » : elle ne doit plus s'ouvrir dans le cas nominal.
const demanderConfirmationCout = vi.fn(async () => 'continuer');
vi.mock('@/components/fournisseurs/ConfirmationCoutFournisseur', () => ({ demanderConfirmationCout: (...a: unknown[]) => demanderConfirmationCout(...(a as [])) }));

import AutopilotPanel, { devisFournisseurProduction } from '../components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, type AutopilotConfig } from '../lib/autopilot/rules';
import { CHAMP_CONFIRMATION_COUT, CODE_CONFIRMATION_COUT } from '../lib/fournisseurs/devis-fournisseur';
import { pourcentageMontageAffiche, affichageProduction } from '../lib/autopilot/progression';
import { lireProgressionServeur } from '../lib/autopilot/etat-production-manuelle';
import ProgressStatus from '../components/ux/ProgressStatus';

const DEVIS = {
  fournisseur: 'heygen', operation: 'video_avatar', libelleOperation: 'Vidéo avatar', moteur: 'avatar_iii', moteurImplicite: false,
  typeAvatar: 'twin', dureeSecondes: { min: 28, max: 32 }, origineDuree: 'texte', tarifUsdParSeconde: 0.01,
  coutUsd: { min: 0.28, max: 0.32 }, creditsStudiio: 0, prixConnu: true,
};

let enBase: AutopilotConfig;
let posts: Array<Record<string, unknown>>;
let moteurServeur: string;
let progressionServeur: Record<string, unknown> | null;
let suivi: Record<string, unknown> | null;

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const ok = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps }) as unknown as Response;
    if (u.includes('/api/autopilot/config')) {
      return ok({ success: true, ready: true, brandingReady: true, publishTimeReady: true, startDateReady: true, config: enBase });
    }
    if (u.includes('/produire-maintenant/progression')) return ok({ success: true, progression: progressionServeur, resultat: null, jumeau: suivi });
    if (u.includes('/api/autopilot/produire-maintenant')) {
      if (init?.method === 'POST') {
        const corps = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        posts.push(corps);
        // La garde serveur : confirmation + MÊME moteur, sinon 428 + devis.
        const confirme = corps[CHAMP_CONFIRMATION_COUT] === true && (corps.moteurConfirme === undefined || corps.moteurConfirme === moteurServeur);
        if (!confirme) return ok({ success: false, code: CODE_CONFIRMATION_COUT, devis: { ...DEVIS, moteur: moteurServeur } }, 428);
        suivi = { etat: 'en_preparation', jobId: 'autopilote-manuel-u-2026-10-21-1200', statut: 'en_attente' };
        return ok({ success: true, jumeau: 'en_preparation', jobId: 'autopilote-manuel-u-2026-10-21-1200', scheduledDate: '2026-10-21', scheduledTime: '12:00', timezone: 'Europe/Paris', status: 'draft', platforms: [] });
      }
      return ok({ success: true, politique: 'partner_cost_only', cout: 0, solde: null, enCours: false, fournisseur: { devisParVideo: DEVIS } });
    }
    return ok({ ok: true, success: true, sessions: [], luts: [], items: [], voices: [], avatars: [] });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  enBase = { ...DEFAULT_CONFIG, rushUrls: ['https://x/a.mp4'], runTimezone: 'Europe/Paris', jumeauAvatar: true } as AutopilotConfig;
  posts = [];
  moteurServeur = 'avatar_iii';
  progressionServeur = null;
  suivi = null;
  demanderConfirmationCout.mockClear();
  stubApi();
});
afterEach(() => { cleanup(); });

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;

async function ouvrirConfirmation() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('De quoi Studiio doit-il parler ?')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="3"]')!);
  await waitFor(() => expect(q('[data-autopilot-produire-maintenant]')).not.toBeNull());
  fireEvent.click(q('[data-autopilot-produire-maintenant]')!);
  await waitFor(() => expect(q('[data-autopilot-produire-confirmer]')).not.toBeNull());
}

describe('1. Un clic = une génération (avec avatar)', () => {
  it('le coût HeyGen est visible dans le cadre ; « Lancer le rendu » part confirmé : UN seul POST, aucune 2e fenêtre', async () => {
    await ouvrirConfirmation();
    const cout = q('[data-autopilot-produire-cout-fournisseur]');
    expect(cout?.textContent).toContain('HeyGen');
    expect(cout?.textContent).toMatch(/0[.,]28/);
    await act(async () => { fireEvent.click(q('[data-autopilot-produire-confirmer]')!); });
    await waitFor(() => expect(q('[data-autopilot-produire-jumeau]')).not.toBeNull());
    expect(posts).toHaveLength(1);
    expect(posts[0][CHAMP_CONFIRMATION_COUT]).toBe(true);
    expect(posts[0].moteurConfirme).toBe('avatar_iii');
    expect(demanderConfirmationCout).not.toHaveBeenCalled();
  });

  it('un double clic ne lance jamais deux générations', async () => {
    await ouvrirConfirmation();
    const bouton = q('[data-autopilot-produire-confirmer]')!;
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton); });
    await waitFor(() => expect(q('[data-autopilot-produire-jumeau]')).not.toBeNull());
    expect(posts).toHaveLength(1);
  });

  it('moteur changé depuis l’affichage : le serveur redemande (428), la fenêtre de coût s’ouvre — jamais un devis non montré', async () => {
    moteurServeur = 'avatar_iv';
    await ouvrirConfirmation();
    await act(async () => { fireEvent.click(q('[data-autopilot-produire-confirmer]')!); });
    await waitFor(() => expect(demanderConfirmationCout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].moteurConfirme).toBe('avatar_iv');
  });

  it('sans avatar ou sans devis fournisseur : rien n’est confirmé d’office', () => {
    expect(devisFournisseurProduction({ fournisseur: { devisParVideo: DEVIS as never } }, { ...enBase, jumeauAvatar: false })).toBeNull();
    expect(devisFournisseurProduction({ fournisseur: null }, enBase)).toBeNull();
    expect(devisFournisseurProduction(null, enBase)).toBeNull();
  });
});

describe('2. Progression honnête', () => {
  it('jamais deux pourcentages : avec un pourcentage réel, le pourcentage du workflow se tait', () => {
    render(<ProgressStatus titre="Production" statut="en_cours" pourcentage={0} etapes={[
      { libelle: 'A', etat: 'terminee' }, { libelle: 'B', etat: 'terminee' }, { libelle: 'C', etat: 'courante' }, { libelle: 'D', etat: 'a_venir' }, { libelle: 'E', etat: 'a_venir' },
    ]} />);
    expect(document.querySelectorAll('[data-progress-pourcentage]')).toHaveLength(1);
    expect(q('[data-progress-workflow]')).toBeNull();
    expect(document.body.textContent).not.toContain('40 %');
  });

  it('100 % réservé au MP4 livré : la composition plafonne à 99 %, aucune mesure = aucun chiffre', () => {
    expect(pourcentageMontageAffiche(1)).toBe(99);
    expect(pourcentageMontageAffiche(0.4)).toBe(40);
    expect(pourcentageMontageAffiche(null)).toBeUndefined();
    expect(affichageProduction({ etape: 'composition', avancement: 1 }).pourcentage).toBe(99);
    expect(affichageProduction({ etape: 'envoi', avancement: null }).pourcentage).toBeUndefined();
  });

  it('avec avatar : la file en préparation l’emporte sur la progression (le suivi « avatar » est retrouvé au rechargement)', () => {
    expect(lireProgressionServeur({ progression: { pourcent: 50, etape: 'composition' }, jumeau: { etat: 'en_preparation' } })).toEqual({ cas: 'jumeau' });
    expect(lireProgressionServeur({ progression: { pourcent: 50, etape: 'composition' }, jumeau: null })).toEqual({ cas: 'progression' });
  });

  it('avec avatar, pendant le montage final : l’avancement RÉEL est affiché, un seul pourcentage', async () => {
    await ouvrirConfirmation();
    await act(async () => { fireEvent.click(q('[data-autopilot-produire-confirmer]')!); });
    await waitFor(() => expect(q('[data-autopilot-produire-jumeau]')).not.toBeNull());
    // Le finaliseur rend le montage : il publie l'avancement des images rendues.
    suivi = { etat: 'en_preparation', jobId: 'autopilote-manuel-u-2026-10-21-1200', statut: 'en_cours' };
    progressionServeur = { pourcent: 49, etape: 'composition', libelle: 'Composition de la vidéo…', avancement: 0.4 };
    await waitFor(() => expect(q('[data-autopilot-produire-jumeau] [data-progress-pourcentage]')?.textContent).toBe('40 %'), { timeout: 4000 });
    expect(q('[data-autopilot-produire-jumeau] [data-progress-workflow]')).toBeNull();
  });
});
