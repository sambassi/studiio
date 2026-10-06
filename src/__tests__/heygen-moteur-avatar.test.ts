/**
 * Le moteur de rendu est EXPLICITE : Avatar III par défaut (le fournisseur
 * choisirait sinon Avatar IV, bien plus cher). Mon jumeau parle avec MA voix
 * (audio_asset_id), jamais `script` ni `voice_id` du fournisseur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateAvatarVideoFromAudio, moteurAvatar } from '@/lib/avatar/heygen';

let corps: Record<string, unknown> | null = null;
beforeEach(() => {
  corps = null;
  vi.stubEnv('HEYGEN_API_KEY', 'cle-test');
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    corps = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({ data: { video_id: 'v-1', status: 'pending' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('moteur de rendu de l’avatar', () => {
  it('Avatar III par défaut ; valeur inconnue ignorée', () => {
    expect(moteurAvatar({} as NodeJS.ProcessEnv)).toBe('avatar_iii');
    expect(moteurAvatar({ HEYGEN_AVATAR_ENGINE: 'avatar_iv' } as unknown as NodeJS.ProcessEnv)).toBe('avatar_iv');
    expect(moteurAvatar({ HEYGEN_AVATAR_ENGINE: 'n_importe_quoi' } as unknown as NodeJS.ProcessEnv)).toBe('avatar_iii');
  });
  it('la vidéo part avec engine Avatar III, MA voix en audio, sans script ni voice_id', async () => {
    await generateAvatarVideoFromAudio({ avatarId: 'look-1', audioAssetId: 'as-1' });
    expect(corps).toMatchObject({ type: 'avatar', avatar_id: 'look-1', audio_asset_id: 'as-1', engine: { type: 'avatar_iii' } });
    expect(corps).not.toHaveProperty('script');
    expect(corps).not.toHaveProperty('voice_id');
  });
});
