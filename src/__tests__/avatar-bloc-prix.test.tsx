import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';

/**
 * MON AVATAR — le prix au-dessus de « Générer la vidéo ».
 *
 * Avant : « Générer la vidéo — prix public 40 crédits · votre coût : 0 » dans
 * un bouton insécable (`.button-base` = `whitespace-nowrap`), qui débordait
 * de la colonne d'aperçu. Maintenant : un bloc prix (1 ligne utilisateur,
 * 2 lignes administrateur) et un bouton qui dit seulement « Générer la vidéo ».
 *
 * Ici `useTarifs()` est le VRAI : il lit `GET /api/tarifs` (simulé). Aucun
 * fournisseur appelé.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import AvatarPage from '../app/dashboard/avatar/page';
import { reinitialiserTarifsEcran } from '@/lib/tarifs/client';

const A = '11111111-1111-4111-8111-000000000001';
const avatarValide = { id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', created_at: '2026-10-07T00:00:00Z', etat: 'valide', version: 3, validated_at: '2026-10-07T10:00:00Z', provider: 'heygen' };
const QUALITES = [
  { qualite: 'standard', libelle: 'Standard', ouverte: true },
  { qualite: 'qualite', libelle: 'Qualité', ouverte: true, recommandee: true },
  { qualite: 'premium', libelle: 'Premium', ouverte: true, meilleure: true },
];

const serveur = { prix: {} as Record<string, number>, exempte: false };

beforeEach(() => {
  reinitialiserTarifsEcran();
  serveur.prix = { 'avatar.avatar_iii': 10, 'avatar.avatar_iv': 25, 'avatar.avatar_v': 40 };
  serveur.exempte = false;
  window.localStorage.clear();
  window.history.replaceState(null, '', '/dashboard/avatar');
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as unknown as Response);
    if (u === '/api/tarifs') return json({ success: true, prix: serveur.prix, exempte: serveur.exempte });
    if (u === '/api/avatar/create') return json({ success: true, data: { avatar: avatarValide, voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', qualites: QUALITES, qualiteParDefaut: 'qualite' } });
    return json({ success: true, data: { generations: [] } });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); });

const lignes = () => [...document.querySelectorAll('[data-avatar-prix] [data-bloc-prix-ligne]')].map((l) => l.textContent);
const bouton = () => document.querySelector('[data-avatar-generer] button') as HTMLButtonElement;
const qualite = () => document.querySelector('[data-avatar-qualite-choix]') as HTMLSelectElement;

describe('Mon avatar — bloc prix (grille lue sur /api/tarifs)', () => {
  it('utilisateur : « Prix : N crédits » suit la grille ET la qualité ; bouton exactement « Générer la vidéo »', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(lignes()).toEqual(['Prix : 25 crédits']));
    expect(bouton().textContent).toBe(' Générer la vidéo');
    expect(bouton().textContent!.trim()).toBe('Générer la vidéo');
    fireEvent.change(qualite(), { target: { value: 'standard' } });
    expect(lignes()).toEqual(['Prix : 10 crédits']);
    fireEvent.change(qualite(), { target: { value: 'premium' } });
    expect(lignes()).toEqual(['Prix : 40 crédits']);
    expect(bouton().textContent!.trim()).toBe('Générer la vidéo');
  });

  it('administrateur (exempté) : deux lignes « Prix public : 40 crédits » / « Votre coût : 0 crédit »', async () => {
    serveur.exempte = true;
    serveur.prix = { 'avatar.avatar_iv': 40 };
    render(<AvatarPage />);
    await waitFor(() => expect(lignes()).toEqual(['Prix public : 40 crédits', 'Votre coût : 0 crédit']));
    expect(bouton().textContent!.trim()).toBe('Générer la vidéo');
    // Le bloc est AU-DESSUS du bouton, dans le même conteneur.
    const bloc = document.querySelector('[data-avatar-prix]')!;
    expect(bloc.compareDocumentPosition(bouton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bloc.parentElement).toBe(bouton().parentElement);
  });

  it('le bouton garde son geste : un clic sans texte reste désactivé (aucune génération lancée)', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(lignes()).toEqual(['Prix : 25 crédits']));
    expect(bouton().disabled).toBe(true);
  });
});

describe('#562 bis — la qualité choisie : prix, moteur et coût fournisseur recalculés, choix enregistré', () => {
  const cout = () => document.querySelector('[data-avatar-cout-fournisseur]');
  const appels = () => (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } }).mock.calls;

  it('⚠️ admin : Standard / Qualité / Premium → Avatar III / IV / V, coût recalculé sur le MÊME texte', async () => {
    serveur.exempte = true;
    render(<AvatarPage />);
    await waitFor(() => expect(cout()).not.toBeNull());
    const zone = document.querySelector('textarea') as HTMLTextAreaElement;
    // 26 mots ≈ 10 s → 8–12 s.
    fireEvent.change(zone, { target: { value: Array.from({ length: 26 }, (_, i) => `mot${i}`).join(' ') } });
    const lire = () => ({ moteur: cout()!.getAttribute('data-avatar-cout-fournisseur'), texte: cout()!.textContent });
    fireEvent.change(qualite(), { target: { value: 'standard' } });
    expect(lire().moteur).toBe('avatar_iii');
    expect(lire().texte).toContain('Avatar III');
    expect(lire().texte).toContain('8–12 s');
    expect(lire().texte).toContain('≈ 0,08–0,12 $');
    fireEvent.change(qualite(), { target: { value: 'qualite' } });
    expect(lire().moteur).toBe('avatar_iv');
    expect(lire().texte).toContain('≈ 0,64–0,97 $');
    fireEvent.change(qualite(), { target: { value: 'premium' } });
    expect(lire().moteur).toBe('avatar_v');
    expect(lire().texte).toContain('≈ 0,96–1,44 $');
    expect(lire().texte).toContain('crédits Studiio : 0');
  });

  it('utilisateur : aucun coût fournisseur affiché (le prix en crédits seulement)', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(lignes()).toEqual(['Prix : 25 crédits']));
    expect(cout()).toBeNull();
  });

  it('⚠️ le choix est ENREGISTRÉ pour cet avatar (Créer et l’Autopilote l’utilisent) et rechargé', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(lignes()).toEqual(['Prix : 25 crédits']));
    expect(document.querySelector('[data-avatar-qualite-portee]')?.textContent).toContain('tant qu’aucune qualité n’est choisie ici');
    fireEvent.change(qualite(), { target: { value: 'standard' } });
    const sauve = appels().find(([u]) => u === '/api/avatar/qualite');
    expect(sauve).toBeTruthy();
    expect(JSON.parse(String(sauve![1]!.body))).toEqual({ avatarId: A, qualite: 'standard' });
    await waitFor(() => expect(document.querySelector('[data-avatar-qualite-portee]')?.textContent).toContain('Créer et l’Autopilote l’utilisent aussi'));
  });

  it('une qualité déjà enregistrée est la sélection au chargement', async () => {
    const avant = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === '/api/avatar/create') {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { avatar: avatarValide, voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', qualites: QUALITES, qualiteParDefaut: 'qualite', qualiteSauvegardee: 'premium' } }) } as unknown as Response;
      }
      return (avant as typeof fetch)(url as string, init);
    }) as unknown as typeof fetch;
    render(<AvatarPage />);
    await waitFor(() => expect(lignes()).toEqual(['Prix : 40 crédits']));
    expect(qualite().value).toBe('premium');
  });
});
