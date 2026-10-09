import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';

/**
 * IDENTITÉ AVATAR — à l'écran, la même partout : « Avatar actif · vN ».
 *
 * Mon avatar (validé) :
 *   - carte « Avatar actif » : version, Prêt, type, « utilisé dans Créer et
 *     Autopilote », « Utiliser dans Créer », « Changer d'avatar » ;
 *   - zone : « Rendu récent avec cet avatar » (vidéo de la version active),
 *     ou « Aucun rendu récent disponible. » — JAMAIS la source ;
 *   - « Source de l'avatar » : section à part, repliée.
 * Créer et l'Autopilote affichent la même identité.
 *
 * Tout est mocké : AUCUN fournisseur, AUCUNE génération.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import AvatarPage from '../app/dashboard/avatar/page';
import JumeauPanel from '../components/creer/JumeauPanel';
import JumeauAutopilote from '../components/creer/JumeauAutopilote';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const A = '11111111-1111-4111-8111-000000000001';
const G = '22222222-2222-4222-8222-000000000003';
const URL_RENDU = `https://studiio.pro/storage/v1/object/public/media/${U}/avatar/${G}.mp4`;

const serveur = { renduRecent: null as null | Record<string, unknown> };
const appels: Array<{ url: string; method: string }> = [];
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: A, version: 3, nom: 'Bassi', valideLe: '2026-10-07', fournisseur: 'heygen' }, voix: { id: 'uv1', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: true, messageMoteur: null };

const avatarValide = { id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', created_at: '2026-10-07T00:00:00Z', etat: 'valide', version: 3, validated_at: '2026-10-07T10:00:00Z', provider: 'heygen' };

beforeEach(() => {
  appels.length = 0;
  serveur.renduRecent = null;
  window.localStorage.clear();
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, method: init?.method ?? 'GET' });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
    if (u === '/api/avatar/create') return json(200, { success: true, data: { avatar: avatarValide, voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1' } });
    if (u === '/api/avatar/apercu') return json(200, { success: true, data: { avatarId: A, version: 3, etat: 'valide', apercu: { statut: 'aucun' }, renduRecent: serveur.renduRecent } });
    if (u === '/api/creer/jumeau') return json(200, { success: true, data: PRET });
    if (u === '/api/voice/clone') return json(200, { voices: [{ id: 'elevenlabs-abc', accountVoiceId: 'uv1', name: 'Bassi' }] });
    return json(200, { success: true, data: { generations: [] } });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); });

const zone = () => document.querySelector('[data-apercu]') as HTMLElement;
const carte = () => document.querySelector('[data-avatar-actif]') as HTMLElement;

describe('Mon avatar — avatar validé', () => {
  it('⚠️ carte « Avatar actif » : v3, Prêt, Avatar vidéo, utilisé dans Créer et Autopilote, deux actions', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(carte()).not.toBeNull());
    expect(carte().getAttribute('data-avatar-actif')).toBe('3');
    expect(carte().textContent).toContain('Avatar actif');
    expect(carte().querySelector('[data-avatar-actif-meta]')!.textContent).toMatch(/v3 · Prêt · Avatar vidéo/);
    expect(carte().textContent).toContain('Cet avatar est celui utilisé dans Créer et Autopilote.');
    expect(carte().querySelector('[data-avatar-actif-action="creer"]')!.getAttribute('href')).toBe('/dashboard/creer');
    expect(carte().querySelector('[data-avatar-actif-action="changer"]')!.textContent).toContain('Changer d’avatar');
  });

  it('⚠️ la source n’est JAMAIS présentée comme l’avatar : section « Source de l’avatar » à part, repliée', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(carte()).not.toBeNull());
    const section = document.querySelector('[data-avatar-source-section]') as HTMLDetailsElement;
    expect(section).not.toBeNull();
    expect(section.open).toBe(false);
    expect(section.querySelector('summary')!.textContent).toBe('Source de l’avatar');
    expect(section.textContent).toContain('Cette vidéo a servi à créer votre avatar.');
    expect(section.querySelector('[data-avatar-source-apercu]')).not.toBeNull();
    // La zone principale ne montre pas la source, et rien n'est titré « Votre avatar ».
    expect(zone().querySelector('[data-avatar-source-apercu]')).toBeNull();
    expect(document.querySelectorAll('[data-avatar-source-apercu]')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Votre avatar(?! est| a | doit)/);
    expect(document.querySelector('img[alt="Votre avatar"]')).toBeNull();
  });

  it('⚠️ aucun rendu de la version active : « Aucun rendu récent disponible. », aucune génération lancée', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(zone()?.textContent).toContain('Aucun rendu récent disponible.'));
    expect(zone().textContent).toContain('Rendu récent avec cet avatar');
    expect(zone().querySelector('video')).toBeNull();
    expect(appels.filter((a) => a.method === 'POST')).toEqual([]);
  });

  it('⚠️ rendu récent de la version active : lu dans la zone, nommé « Rendu récent », jamais « Votre avatar »', async () => {
    serveur.renduRecent = { generationId: G, url: URL_RENDU, version: 3, creeLe: '2026-10-08T00:00:00Z' };
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector(`[data-avatar-rendu-recent="${G}"]`)).not.toBeNull());
    const video = document.querySelector(`[data-avatar-rendu-recent="${G}"]`) as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe(URL_RENDU);
    expect(zone().textContent).toContain('Rendu récent avec cet avatar');
    expect(zone().textContent).toContain('Exemple de résultat — Avatar actif · v3.');
    expect(appels.filter((a) => a.method === 'POST')).toEqual([]);
  });
});

describe('Créer et Autopilote — la même identité', () => {
  it('⚠️ Créer : « Avatar actif · v3 »', async () => {
    render(<JumeauPanel mode="aucun" onModeChange={() => {}} textes={{}} onVoixJumeau={() => {}} coutAvatar={40} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-avatar-actif]')).not.toBeNull());
    expect(document.querySelector('[data-jumeau-avatar-actif]')!.textContent).toBe('Avatar actif · v3');
  });
  it('⚠️ Autopilote : « Avatar actif · v3 »', async () => {
    render(<JumeauAutopilote actif={false} onChange={() => {}} voixCompte={[{ id: 'elevenlabs-abc', accountVoiceId: 'uv1' }]} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-avatar-actif]')).not.toBeNull());
    expect(document.querySelector('[data-jumeau-autopilote-avatar-actif]')!.textContent).toBe('Avatar actif · v3');
    expect(screen.queryByText(/validé \(v3\)/)).toBeNull();
  });
});
