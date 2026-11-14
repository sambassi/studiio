// ⚠️ IDENTIFIANTS PUBLICS NEUTRES. Les listes de voix émettent `vp-` /
// `va-` / `vn-` au lieu de `elevenlabs-` / `heygen-` / `openai-` : un
// identifiant finit en `value=` d'une option, donc il ne doit pas nommer
// le prestataire. Les chemins appelés par le navigateur sont neutres eux
// aussi (`/api/voix/*`). `idVoixInterne` fait le pont avec l'ancienne
// forme, qui reste valide pour toute sélection déjà enregistrée.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { synthesize } from '@/lib/tts/edge-tts-client';

/**
 * `synthesize()` — une voix CLONÉE n'a pas de remplaçante.
 *
 * Observé : quand `/api/voix/premium` échouait (clé absente, voix non
 * autorisée, panne), le client retombait en silence sur OpenAI « nova », et
 * le fichier obtenu était étiqueté « TTS — Bassi (ma voix) ». L'utilisateur
 * entendait une inconnue sous son propre nom, sans aucun signal.
 *
 * Règle : pour un identifiant `vp-*` ou `va-*`, l'échec est une
 * ERREUR explicite ; aucun appel à `/api/voix/naturelle` ni `/api/voix/standard`.
 * Les voix standard (Edge) gardent leur repli OpenAI — c'est ce qui les rend
 * fiables hors Vercel, et rien ici ne doit le casser.
 */

interface Appel { url: string; body: Record<string, unknown> | null }
let appels: Appel[];

/** Une doublure de `fetch` : chaque route répond selon `reponses`. */
function installerFetch(reponses: Record<string, { status: number; octets?: number }>) {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = null; } }
    appels.push({ url: u, body });
    const cle = Object.keys(reponses).find((k) => u.includes(k));
    const rep = cle ? reponses[cle] : { status: 404 };
    const ok = rep.status >= 200 && rep.status < 300;
    return {
      ok,
      status: rep.status,
      json: async () => ({ error: ok ? undefined : `HTTP ${rep.status}` }),
      blob: async () => new Blob([new Uint8Array(rep.octets ?? 0)], { type: 'audio/mpeg' }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const routesAppelees = () => appels.map((a) => a.url);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Voix clonée ElevenLabs — jamais de voix de remplacement', () => {
  it('un 500 de /api/voix/premium rejette avec un message explicite', async () => {
    installerFetch({ '/api/voix/premium': { status: 500 }, '/api/voix/naturelle': { status: 200, octets: 20_000 } });
    await expect(synthesize('Bonjour à tous', 'vp-xyz')).rejects.toThrow(
      /voix clonée n’a pas pu être synthétisée.*Aucune voix de remplacement/,
    );
  });

  it('⚠️ ni /api/voix/naturelle ni /api/voix/standard ne sont appelés', async () => {
    installerFetch({ '/api/voix/premium': { status: 500 }, '/api/voix/naturelle': { status: 200, octets: 20_000 } });
    await synthesize('Bonjour à tous', 'vp-xyz').catch(() => {});
    expect(routesAppelees()).toEqual(['/api/voix/premium']);
    expect(routesAppelees().some((u) => u.includes('/api/voix/naturelle'))).toBe(false);
    expect(routesAppelees().some((u) => u.includes('/api/voix/standard'))).toBe(false);
  });

  it('un 404 (voix non autorisée) est traité de la même façon', async () => {
    installerFetch({ '/api/voix/premium': { status: 404 } });
    await expect(synthesize('Bonjour', 'vp-autrui')).rejects.toThrow(/Aucune voix de remplacement/);
    expect(routesAppelees()).toEqual(['/api/voix/premium']);
  });

  it('un réseau coupé aussi — sans repli', async () => {
    appels = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      appels.push({ url: String(url), body: null });
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(synthesize('Bonjour', 'vp-xyz')).rejects.toThrow(/Aucune voix de remplacement/);
    expect(routesAppelees()).toEqual(['/api/voix/premium']);
  });

  it('le succès rend l audio de la voix clonée, même court', async () => {
    // Un mot lu par ElevenLabs pèse moins que le seuil « fichier suspect »
    // des voix Edge (8 000 octets) : ce seuil ne s'applique pas ici, il n'y a
    // de toute façon rien pour le remplacer.
    installerFetch({ '/api/voix/premium': { status: 200, octets: 3_000 } });
    const blob = await synthesize('Oui', 'vp-xyz');
    expect(blob.size).toBe(3_000);
    expect(routesAppelees()).toEqual(['/api/voix/premium']);
  });
});

describe('Voix clonée HeyGen — même règle', () => {
  it('un échec de /api/voix/avatar rejette sans appeler OpenAI ni Edge', async () => {
    installerFetch({ '/api/voix/avatar': { status: 500 }, '/api/voix/naturelle': { status: 200, octets: 20_000 } });
    await expect(synthesize('Bonjour', 'va-abc')).rejects.toThrow(/Aucune voix de remplacement/);
    expect(routesAppelees()).toEqual(['/api/voix/avatar']);
  });
});

describe('Voix standard — le repli OpenAI est conservé', () => {
  it('Edge en panne → OpenAI prend le relais et l audio est rendu', async () => {
    installerFetch({ '/api/voix/standard': { status: 500 }, '/api/voix/naturelle': { status: 200, octets: 20_000 } });
    const blob = await synthesize('Bonjour', 'fr-FR-DeniseNeural');
    expect(blob.size).toBe(20_000);
    expect(routesAppelees()).toEqual(['/api/voix/standard', '/api/voix/naturelle']);
    // La voix de repli suit le genre de la voix demandée.
    expect(appels[1].body).toMatchObject({ voice: 'nova' });
  });

  it('voix masculine → repli « echo »', async () => {
    installerFetch({ '/api/voix/standard': { status: 500 }, '/api/voix/naturelle': { status: 200, octets: 20_000 } });
    await synthesize('Bonjour', 'fr-FR-HenriNeural');
    expect(appels[1].body).toMatchObject({ voice: 'echo' });
  });

  it('Edge ET OpenAI en panne → une erreur claire, sans fournisseur nommé', async () => {
    installerFetch({ '/api/voix/standard': { status: 500 }, '/api/voix/naturelle': { status: 500 } });
    const erreur = await synthesize('Bonjour', 'fr-FR-DeniseNeural').catch((e: Error) => e);
    expect((erreur as Error).message).toMatch(/^Synthèse vocale indisponible/);
    expect((erreur as Error).message).not.toMatch(/Edge|OpenAI|_API_KEY/);
  });

  it('une voix openai-* en panne ne rejoue pas OpenAI en repli', async () => {
    installerFetch({ '/api/voix/naturelle': { status: 500 }, '/api/voix/standard': { status: 500 } });
    await expect(synthesize('Bonjour', 'vn-nova')).rejects.toThrow();
    expect(routesAppelees().filter((u) => u.includes('/api/voix/naturelle'))).toHaveLength(1);
  });
});
