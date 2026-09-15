// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le client D-ID : contrat HTTP lu sur docs.d-id.com (2026-09-15), Basic
 * auth, timeouts, erreurs normalisées, et ce qui ne part JAMAIS (clé,
 * script texte, clone de voix). Réseau intercepté au `fetch` ; aucun appel
 * réel.
 */

const appels: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
let reponse: { status: number; body: unknown } = { status: 200, body: {} };
let lent = false;
const fetchDouble = vi.fn(async (url: unknown, init?: RequestInit) => {
  const h = (init?.headers ?? {}) as Record<string, string>;
  appels.push({ url: String(url), method: init?.method ?? 'GET', headers: h, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  if (lent) await new Promise((r) => setTimeout(r, 200));
  if (reponse.status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(reponse.body), { status: reponse.status, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

const {
  DidError, cleDid, didVideoAvatarDisponible, enteteAutorisationDid, creerConsentement, deposerVideoConsentement, lireConsentement,
  creerAvatarDid, lireAvatarDid, supprimerAvatarDid, creerSceneAudio, lireScene, telechargerResultat,
} = await import('@/lib/providers/did/client');

const CLE = 'utilisateur@studiio.pro:secretDID123';
const env = { DID_API_KEY: CLE, DID_VIDEO_AVATAR_ACTIVE: '1' } as unknown as NodeJS.ProcessEnv;
const deps = { env, fetch: fetchDouble };

beforeEach(() => { appels.length = 0; reponse = { status: 200, body: {} }; lent = false; });

describe('disponibilité et authentification', () => {
  it('⚠️ le moteur n’est disponible que si DID_VIDEO_AVATAR_ACTIVE=1 ET DID_API_KEY ; absent par défaut', () => {
    expect(didVideoAvatarDisponible({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(didVideoAvatarDisponible({ DID_API_KEY: CLE } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(didVideoAvatarDisponible({ DID_VIDEO_AVATAR_ACTIVE: '1' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(didVideoAvatarDisponible({ DID_VIDEO_AVATAR_ACTIVE: 'true', DID_API_KEY: CLE } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(didVideoAvatarDisponible(env)).toBe(true);
    expect(cleDid({ DID_API_KEY: '   ' } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it('⚠️ Basic : une clé `username:password` est encodée en base64 ; une clé déjà encodée passe telle quelle', () => {
    expect(enteteAutorisationDid(CLE)).toBe(`Basic ${Buffer.from(CLE).toString('base64')}`);
    expect(enteteAutorisationDid('dXNlcjpwYXNz')).toBe('Basic dXNlcjpwYXNz');
  });

  it('⚠️ sans clé : DidError 503 did_not_configured, AUCUN appel réseau', async () => {
    await expect(creerConsentement('French', { env: {} as unknown as NodeJS.ProcessEnv, fetch: fetchDouble })).rejects.toMatchObject({ httpStatus: 503, code: 'did_not_configured' });
    expect(appels).toEqual([]);
  });

  it('⚠️ la clé ne figure dans aucun message d’erreur', async () => {
    reponse = { status: 401, body: { kind: 'AuthorizationError', description: 'user unauthenticated' } };
    let message = '';
    try { await creerConsentement('French', deps); } catch (e) { message = (e as Error).message + JSON.stringify(e); }
    expect(message).not.toContain('secretDID123');
    expect(message).not.toContain(Buffer.from(CLE).toString('base64'));
  });
});

describe('contrat des appels', () => {
  it('POST /consents { language: French } → { id, texte }', async () => {
    reponse = { status: 201, body: { id: 'cst-1', text: 'pomme vélo nuage', created_at: 'x', created_by: 'y' } };
    const r = await creerConsentement('French', deps);
    expect(r).toEqual({ id: 'cst-1', texte: 'pomme vélo nuage' });
    expect(appels[0]).toMatchObject({ url: 'https://api.d-id.com/consents', method: 'POST', body: { language: 'French' } });
    expect(appels[0].headers.Authorization).toBe(`Basic ${Buffer.from(CLE).toString('base64')}`);
  });

  it('réponse sans texte → did_bad_response (jamais une phrase inventée)', async () => {
    reponse = { status: 201, body: { id: 'cst-1' } };
    await expect(creerConsentement('French', deps)).rejects.toMatchObject({ code: 'did_bad_response' });
  });

  it('POST /consents/{id} { name, source_url } ; source_url doit être HTTPS et finir en .mp4/.mov', async () => {
    reponse = { status: 200, body: { id: 'cst-1' } };
    await deposerVideoConsentement({ consentId: 'cst-1', nom: 'Bassi', sourceUrl: 'https://studiio.pro/api/avatar/media/j/consent-1-a.mp4' }, deps);
    expect(appels[0]).toMatchObject({ url: 'https://api.d-id.com/consents/cst-1', method: 'POST', body: { name: 'Bassi', source_url: 'https://studiio.pro/api/avatar/media/j/consent-1-a.mp4' } });
    await expect(deposerVideoConsentement({ consentId: 'cst-1', nom: 'B', sourceUrl: 'http://x/y.mp4' }, deps)).rejects.toMatchObject({ code: 'did_bad_source_url' });
    await expect(deposerVideoConsentement({ consentId: 'cst-1', nom: 'B', sourceUrl: 'https://x/y.webm' }, deps)).rejects.toMatchObject({ code: 'did_bad_source_url' });
    expect(appels).toHaveLength(1);
  });

  it('GET /consents/{id} → statut parmi validating|created|done|error ; inconnu → validating', async () => {
    reponse = { status: 200, body: { status: 'done' } };
    expect(await lireConsentement('cst-1', deps)).toEqual({ statut: 'done', erreur: null });
    reponse = { status: 200, body: { status: 'error', error: { description: 'audio-text mismatch' } } };
    expect(await lireConsentement('cst-1', deps)).toEqual({ statut: 'error', erreur: 'audio-text mismatch' });
    reponse = { status: 200, body: { status: 'bizarre' } };
    expect((await lireConsentement('cst-1', deps)).statut).toBe('validating');
  });

  it('POST /scenes/avatars { source_url, consent_id, name } → { id, statut }', async () => {
    reponse = { status: 201, body: { id: 'avt-1', status: 'created', object: 'scene_avatar' } };
    const r = await creerAvatarDid({ sourceUrl: 'https://studiio.pro/api/avatar/media/j/source-1-a.mov', consentId: 'cst-1', nom: 'Mon avatar' }, deps);
    expect(r).toEqual({ id: 'avt-1', statut: 'created' });
    expect(appels[0]).toMatchObject({ url: 'https://api.d-id.com/scenes/avatars', body: { source_url: 'https://studiio.pro/api/avatar/media/j/source-1-a.mov', consent_id: 'cst-1', name: 'Mon avatar' } });
  });

  it('GET /scenes/avatars/{id} et DELETE (204 ; 404 = déjà absent)', async () => {
    reponse = { status: 200, body: { status: 'training-started' } };
    expect((await lireAvatarDid('avt-1', deps)).statut).toBe('training-started');
    reponse = { status: 204, body: null };
    expect(await supprimerAvatarDid('avt-1', deps)).toBe(true);
    expect(appels[1]).toMatchObject({ url: 'https://api.d-id.com/scenes/avatars/avt-1', method: 'DELETE' });
    reponse = { status: 404, body: { kind: 'NotFoundError', description: 'not found' } };
    expect(await supprimerAvatarDid('avt-1', deps)).toBe(true);
    reponse = { status: 500, body: {} };
    await expect(supprimerAvatarDid('avt-1', deps)).rejects.toMatchObject({ code: 'did_unavailable' });
  });

  it('⚠️ POST /scenes : avatar_id + script { type: audio, audio_url } — JAMAIS type text, JAMAIS provider/voice', async () => {
    reponse = { status: 201, body: { id: 'scn-1', status: 'created' } };
    const r = await creerSceneAudio({ avatarId: 'avt-1', audioUrl: 'https://studiio.pro/api/avatar/media/j/audio-x.mp3', nom: 'Aperçu' }, deps);
    expect(r).toEqual({ id: 'scn-1', statut: 'created' });
    const corps = appels[0].body as Record<string, unknown>;
    expect(appels[0].url).toBe('https://api.d-id.com/scenes');
    expect(corps).toEqual({ avatar_id: 'avt-1', script: { type: 'audio', audio_url: 'https://studiio.pro/api/avatar/media/j/audio-x.mp3' }, name: 'Aperçu' });
    expect(JSON.stringify(corps)).not.toMatch(/"type":"text"|provider|voice_id|input|elevenlabs/i);
    await expect(creerSceneAudio({ avatarId: 'a', audioUrl: 'http://x/a.mp3', nom: 'n' }, deps)).rejects.toMatchObject({ code: 'did_bad_audio_url' });
  });

  it('GET /scenes/{id} : done + result_url → completed ; error/rejected → failed ; sinon processing', async () => {
    reponse = { status: 200, body: { status: 'done', result_url: 'https://d-id-results.example/scn-1.mp4' } };
    expect(await lireScene('scn-1', deps)).toEqual({ status: 'completed', videoUrl: 'https://d-id-results.example/scn-1.mp4', failureMessage: null });
    reponse = { status: 200, body: { status: 'rejected', error: { description: 'face not found' } } };
    expect(await lireScene('scn-1', deps)).toEqual({ status: 'failed', videoUrl: null, failureMessage: 'face not found' });
    reponse = { status: 200, body: { status: 'started', pending_url: 'https://x' } };
    expect((await lireScene('scn-1', deps)).status).toBe('processing');
    // done sans result_url exploitable : PAS complété (on ne livre pas une vidéo qu'on n'a pas).
    reponse = { status: 200, body: { status: 'done' } };
    expect((await lireScene('scn-1', deps)).status).toBe('processing');
  });
});

describe('erreurs normalisées', () => {
  const cas: Array<[number, string, number]> = [[400, 'did_badrequesterror', 400], [401, 'did_unauthorized', 502], [402, 'did_insufficient_credits', 402], [404, 'did_not_found', 404], [500, 'did_unavailable', 502], [503, 'did_unavailable', 502]];
  for (const [statut, code, http] of cas) {
    it(`fournisseur ${statut} → DidError ${code} (http ${http})`, async () => {
      reponse = { status: statut, body: { kind: 'BadRequestError', description: 'invalid source url' } };
      await expect(lireAvatarDid('avt-1', deps)).rejects.toMatchObject({ name: 'DidError', code, httpStatus: http });
    });
  }

  it('timeout → DidError 504 did_timeout', async () => {
    lent = true;
    const rapide = { env, timeoutMs: 20, fetch: (async (u: unknown, i?: RequestInit) => { await new Promise((_r, rej) => { i?.signal?.addEventListener('abort', () => rej(new Error('aborted'))); }); return (fetchDouble as unknown as (a: unknown, b?: RequestInit) => Promise<Response>)(u, i); }) as unknown as typeof fetch };
    await expect(lireAvatarDid('avt-1', rapide)).rejects.toMatchObject({ code: 'did_timeout', httpStatus: 504 });
    expect(new DidError('x', 1, 'y')).toBeInstanceOf(DidError);
  });

  it('téléchargement du résultat : type vidéo exigé, jamais vide, HTTPS seulement', async () => {
    const f = vi.fn(async () => new Response(Buffer.from('VIDEO'), { status: 200, headers: { 'content-type': 'video/mp4' } })) as unknown as typeof fetch;
    expect((await telechargerResultat('https://r/x.mp4', { env, fetch: f })).toString()).toBe('VIDEO');
    const html = vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    await expect(telechargerResultat('https://r/x.mp4', { env, fetch: html })).rejects.toMatchObject({ code: 'did_bad_result_type' });
    const vide = vi.fn(async () => new Response(Buffer.alloc(0), { status: 200, headers: { 'content-type': 'video/mp4' } })) as unknown as typeof fetch;
    await expect(telechargerResultat('https://r/x.mp4', { env, fetch: vide })).rejects.toMatchObject({ code: 'did_empty_result' });
    await expect(telechargerResultat('http://r/x.mp4', { env, fetch: f })).rejects.toMatchObject({ code: 'did_bad_result_url' });
  });
});
