import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';

/**
 * AVATAR-2C — le bouton « Supprimer mon avatar » sur /dashboard/avatar.
 *
 * Deux clics (armer, confirmer), aucun dialogue navigateur ; l'appel est
 * `DELETE /api/avatar` sans corps ni paramètre ; après succès l'écran revient
 * à l'état « aucun avatar » et répète ce que le serveur dit : vidéos
 * conservées, source retirée (ou à retirer), fournisseur non supprimé.
 * L'UX existante (« Changer de source », aperçu privé) reste intacte.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import AvatarPage from '../app/dashboard/avatar/page';

const A = '11111111-1111-4111-8111-000000000001';
const appels: Array<{ url: string; init?: RequestInit }> = [];

function stubApi(reponseSuppression: { status: number; body: unknown }) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, init });
    if (u.includes('/api/avatar/create')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { avatar: { id: A, name: 'Mon avatar', status: 'completed', avatar_type: 'photo', created_at: '2026-09-01T00:00:00Z' }, voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1' } }) } as unknown as Response;
    }
    if (u === '/api/avatar' && init?.method === 'DELETE') {
      return { ok: reponseSuppression.status < 400, status: reponseSuppression.status, json: async () => reponseSuppression.body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: { generations: [] } }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { appels.length = 0; window.localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('/dashboard/avatar — supprimer mon avatar', () => {
  it('⚠️ deux clics : armer puis confirmer → DELETE /api/avatar sans corps, écran vidé, message fidèle au serveur', async () => {
    stubApi({ status: 200, body: { success: true, data: { avatarId: A, version: 1, dejaSupprime: false, sourceRetiree: true, fournisseur: 'non_disponible' } } });
    render(<AvatarPage />);
    const armer = await waitFor(() => screen.getByRole('button', { name: /Supprimer mon avatar/ }));
    // « Changer de source » est toujours là.
    expect(screen.getByRole('button', { name: /Changer de source/ })).toBeTruthy();
    // Un seul clic ne supprime rien.
    fireEvent.click(armer);
    expect(appels.filter((a) => a.init?.method === 'DELETE')).toHaveLength(0);
    const confirmer = screen.getByRole('button', { name: /Confirmer la suppression/ });
    fireEvent.click(confirmer);
    await waitFor(() => expect(appels.filter((a) => a.init?.method === 'DELETE')).toHaveLength(1));
    const appel = appels.find((a) => a.init?.method === 'DELETE')!;
    expect(appel.url).toBe('/api/avatar');
    expect(appel.init?.body).toBeUndefined();
    await waitFor(() => expect(document.querySelector('[data-avatar-source-apercu]')).toBeNull());
    const texte = document.body.textContent ?? '';
    expect(texte).toMatch(/Avatar supprimé/);
    expect(texte).toMatch(/vidéos déjà générées sont conservées/);
    expect(texte).toMatch(/fichier source a été retiré/);
    expect(texte).toMatch(/n'est pas supprimé automatiquement chez notre fournisseur/);
  });

  it('source non retirée (sourceRetiree:false) : l’écran le dit sans prétendre le contraire', async () => {
    stubApi({ status: 200, body: { success: true, data: { avatarId: A, version: 1, dejaSupprime: false, sourceRetiree: false, fournisseur: 'non_disponible' } } });
    render(<AvatarPage />);
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Supprimer mon avatar/ })));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la suppression/ }));
    const avis = await waitFor(() => {
      const el = document.querySelector('[data-avatar-notice]');
      expect(el).not.toBeNull();
      return el!.textContent ?? '';
    });
    expect(avis).toMatch(/n'a pas pu être retiré automatiquement du stockage/);
    expect(avis).toMatch(/n'est plus accessible via l'avatar supprimé/);
    // Aucune promesse de nettoyage futur dans l'avis lui-même.
    expect(avis).not.toMatch(/sous peu|bientôt|prochainement|sera retiré|plus tard|ultérieurement/);
    expect(avis).not.toMatch(/fichier source a été retiré/);
  });

  it('échec serveur (409 remplacé) : l’avatar reste affiché, l’erreur est montrée, le bouton se désarme', async () => {
    stubApi({ status: 409, body: { success: false, error: 'Votre avatar vient d’être remplacé. Rechargez la page.', code: 'avatar_superseded' } });
    render(<AvatarPage />);
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Supprimer mon avatar/ })));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la suppression/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/vient d’être remplacé/));
    expect(document.querySelector('[data-avatar-source-apercu]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Supprimer mon avatar/ })).toBeTruthy();
  });
});
