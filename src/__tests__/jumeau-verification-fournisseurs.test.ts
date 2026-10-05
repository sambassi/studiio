/**
 * Vérification NON PAYANTE du jumeau chez les fournisseurs : lecture d'état
 * D-ID et de la voix ElevenLabs — jamais une génération ni une synthèse.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { verifierVoixElevenLabs, verifierAvatarDid } from '@/lib/avatar/verification-fournisseurs';

const reponse = (status: number, corps: unknown = {}) => ({ ok: status < 300, status, text: async () => JSON.stringify(corps), json: async () => corps }) as unknown as Response;

describe('ElevenLabs : GET /v1/voices/{id}', () => {
  const env = { ELEVENLABS_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv;
  it('voix présente → pret, et UNIQUEMENT une lecture GET', async () => {
    const appels: Array<[string, RequestInit | undefined]> = [];
    const f = (async (u: string, i?: RequestInit) => { appels.push([u, i]); return reponse(200); }) as unknown as typeof fetch;
    expect(await verifierVoixElevenLabs('abc12345678', { env, fetch: f })).toBe('pret');
    expect(appels).toHaveLength(1);
    expect(appels[0][0]).toBe('https://api.elevenlabs.io/v1/voices/abc12345678');
    expect(appels[0][1]?.method).toBe('GET');
  });
  it('voix inconnue → introuvable ; clé refusée → refuse ; sans clé → non_verifiable, aucun appel', async () => {
    expect(await verifierVoixElevenLabs('x1234567', { env, fetch: (async () => reponse(404)) as unknown as typeof fetch })).toBe('introuvable');
    expect(await verifierVoixElevenLabs('x1234567', { env, fetch: (async () => reponse(401)) as unknown as typeof fetch })).toBe('refuse');
    let appele = false;
    expect(await verifierVoixElevenLabs('x1234567', { env: {} as unknown as NodeJS.ProcessEnv, fetch: (async () => { appele = true; return reponse(200); }) as unknown as typeof fetch })).toBe('non_verifiable');
    expect(appele).toBe(false);
  });
});

describe('D-ID : GET /scenes/avatars/{id}', () => {
  const env = { DID_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv;
  it('done → pret ; entraînement → non_pret ; 404 → introuvable ; 401 → refuse', async () => {
    const f = (corps: unknown, status = 200) => (async (u: string, i?: RequestInit) => {
      expect(u).toBe('https://api.d-id.com/scenes/avatars/avt_1');
      expect(i?.method).toBe('GET');
      return reponse(status, corps);
    }) as unknown as typeof fetch;
    expect(await verifierAvatarDid('avt_1', { env, fetch: f({ status: 'done' }) })).toBe('pret');
    expect(await verifierAvatarDid('avt_1', { env, fetch: f({ status: 'training-started' }) })).toBe('non_pret');
    expect(await verifierAvatarDid('avt_1', { env, fetch: f({}, 404) })).toBe('introuvable');
    expect(await verifierAvatarDid('avt_1', { env, fetch: f({}, 401) })).toBe('refuse');
  });
});

describe('Autopilote : voix enregistrée périmée → dit à l’écran', () => {
  it('message visible quand voiceId ne correspond plus à une voix du compte', () => {
    const p = readFileSync(resolve(process.cwd(), 'src/components/creer/AutopilotPanel.tsx'), 'utf-8');
    expect(p).toContain('data-autopilot-voix-perimee');
    expect(p).toContain('voixChargees && !!config.voiceId && !voixDeConfig(voixClonees, config.voiceId)');
  });
});
