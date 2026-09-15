import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';

/**
 * VALIDATION DU CLONE — l'écran /dashboard/avatar n'affiche que ce que le
 * serveur dit : préparation, aperçu réel (ou son absence), « Voir mon
 * avatar » → jeton délivré par le serveur → « Valider mon avatar » →
 * « Avatar validé ». Aucune vidéo inventée, aucun bouton au-dessus d'un vide.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));

import AvatarPage from '../app/dashboard/avatar/page';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const A = '11111111-1111-4111-8111-000000000001';
const G = '22222222-2222-4222-8222-000000000001';
const URL_APERCU = `https://studiio.pro/storage/v1/object/public/media/${U}/avatar/${G}.mp4`;

const etatServeur = { avatar: {} as Record<string, unknown>, apercu: { statut: 'aucun' } as Record<string, unknown> };
const appels: Array<{ url: string; method: string; body?: string }> = [];

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
    if (u === '/api/avatar/create') return json(200, { success: true, data: { avatar: etatServeur.avatar, voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1' } });
    if (u === '/api/avatar/apercu') return json(200, { success: true, data: { avatarId: A, version: 2, etat: etatServeur.avatar.etat, apercu: etatServeur.apercu } });
    if (u === '/api/avatar/apercu/ouverture') {
      if (etatServeur.apercu.statut !== 'pret') return json(409, { success: false, error: "L'aperçu réel de votre avatar n'est pas encore disponible.", code: `apercu_${etatServeur.apercu.statut}` });
      return json(200, { success: true, data: { avatarId: A, version: 2, generationId: G, url: URL_APERCU, jeton: 'JETON-SERVEUR' } });
    }
    if (u === '/api/avatar/validation') {
      const corps = JSON.parse(String(init?.body ?? '{}'));
      if (corps.jeton !== 'JETON-SERVEUR') return json(409, { success: false, error: 'Ouvrez d’abord l’aperçu.', code: 'apercu_non_ouvert' });
      etatServeur.avatar = { ...etatServeur.avatar, etat: 'valide', validated_at: '2026-09-16T00:00:00Z' };
      return json(200, { success: true, data: { avatarId: A, version: 2, validatedAt: '2026-09-16T00:00:00Z', dejaValide: false, etat: 'valide' } });
    }
    return json(200, { success: true, data: { generations: [] } });
  }) as unknown as typeof fetch;
}

const avatar = (over: Record<string, unknown> = {}) => ({
  id: A, name: 'Mon avatar', status: 'completed', avatar_type: 'video', created_at: '2026-09-01T00:00:00Z', etat: 'entraine_non_valide', version: 2, validated_at: null, ...over,
});

beforeEach(() => { appels.length = 0; window.localStorage.clear(); etatServeur.avatar = avatar(); etatServeur.apercu = { statut: 'aucun' }; stubApi(); });
afterEach(() => { cleanup(); });

describe('/dashboard/avatar — validation du clone', () => {
  it('entraînement en cours : « Votre avatar est en cours de préparation. », aucun bouton de validation', async () => {
    etatServeur.avatar = avatar({ status: 'processing', etat: 'entrainement' });
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-validation="entrainement"]')).not.toBeNull());
    expect(document.body.textContent).toMatch(/Votre avatar est en cours de préparation\./);
    expect(document.querySelector('[data-avatar-apercu="valider"]')).toBeNull();
    expect(document.querySelector('[data-avatar-apercu="voir"]')).toBeNull();
  });

  it('entraîné, aucun aperçu : proposer de GÉNÉRER l’aperçu réel ; aucune vidéo, aucun « Valider »', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-apercu="generer"]')).not.toBeNull());
    expect(document.querySelector('video[data-avatar-apercu="video"]')).toBeNull();
    expect(document.querySelector('[data-avatar-apercu="valider"]')).toBeNull();
    expect(document.querySelector('[data-avatar-apercu="voir"]')).toBeNull();
  });

  it('aperçu « indisponible » : phrase explicite, aucun bouton Voir/Valider', async () => {
    etatServeur.apercu = { statut: 'indisponible', generationId: G };
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-apercu="indisponible"]')).not.toBeNull());
    expect(document.body.textContent).toMatch(/L’aperçu réel de votre avatar n’est pas encore disponible\.|L'aperçu réel de votre avatar n'est pas encore disponible\./);
    expect(document.querySelector('[data-avatar-apercu="voir"]')).toBeNull();
    expect(document.querySelector('[data-avatar-apercu="valider"]')).toBeNull();
    expect(document.querySelector('video[data-avatar-apercu="video"]')).toBeNull();
  });

  it('⚠️ aperçu prêt : « Voir mon avatar » d’abord ; « Valider » n’apparaît qu’après l’ouverture (jeton serveur) ; puis « Avatar validé »', async () => {
    etatServeur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    render(<AvatarPage />);
    const voir = await waitFor(() => screen.getByRole('button', { name: /Voir mon avatar/ }));
    // Avant l'ouverture : ni vidéo, ni « Valider ».
    expect(document.querySelector('video[data-avatar-apercu="video"]')).toBeNull();
    expect(document.querySelector('[data-avatar-apercu="valider"]')).toBeNull();
    fireEvent.click(voir);
    await waitFor(() => expect(document.querySelector('video[data-avatar-apercu="video"]')).not.toBeNull());
    expect(appels.some((a) => a.url === '/api/avatar/apercu/ouverture' && a.method === 'POST')).toBe(true);
    expect((document.querySelector('video[data-avatar-apercu="video"]') as HTMLVideoElement).getAttribute('src')).toBe(URL_APERCU);
    const valider = screen.getByRole('button', { name: /Valider mon avatar/ });
    fireEvent.click(valider);
    await waitFor(() => expect(document.querySelector('[data-avatar-validation="valide"]')).not.toBeNull());
    const validation = appels.find((a) => a.url === '/api/avatar/validation')!;
    expect(JSON.parse(validation.body!)).toEqual({ jeton: 'JETON-SERVEUR' });
    expect(document.body.textContent).toMatch(/Avatar validé/);
    expect(document.querySelector('[data-avatar-apercu="valider"]')).toBeNull();
  });

  it('déjà validé : « Avatar validé », rien d’autre à faire ; Changer de source et Supprimer restent là', async () => {
    etatServeur.avatar = avatar({ etat: 'valide', validated_at: '2026-09-03T00:00:00Z' });
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-validation="valide"]')).not.toBeNull());
    expect(document.querySelector('[data-avatar-apercu="generer"]')).toBeNull();
    expect(screen.getByRole('button', { name: /Changer de source/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Supprimer mon avatar/ })).toBeTruthy();
    expect(document.querySelector('[data-avatar-source-apercu]')).not.toBeNull();
  });

  it('⚠️ le code de la page ne fabrique aucune URL d’aperçu : la seule source est la réponse du serveur', async () => {
    const src = (await import('node:fs')).readFileSync((await import('node:path')).resolve(__dirname, '../app/dashboard/avatar/page.tsx'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/placeholder\.(mp4|webm|gif)|\/demo\/|sample\.mp4/);
    expect(code).toMatch(/src=\{apercuOuvert\.url\}/);
  });
});
