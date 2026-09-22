import { describe, it, expect } from 'vitest';
import Replicate from 'replicate';

/**
 * RACINE A — LE CORRECTIF `wait: { mode: 'poll' }`, PROUVÉ SUR LE SDK RÉEL.
 *
 * On instancie le VRAI paquet `replicate` (1.4.0) avec un `fetch` doublé : il
 * simule les réponses de l'API (create + get) selon l'état de la prédiction.
 * Aucun appel réseau réel, aucun fournisseur payant.
 *
 * Ce que ça prouve, cas par cas :
 *  - le BUG en mode `block` : une prédiction encore `processing` (Prefer:wait
 *    expiré) rend `output = null` et `run()` la croit finie → média perdu ;
 *  - le CORRECTIF en mode `poll` : `run()` SONDE jusqu'à `succeeded` et rend le
 *    média ; `failed` LÈVE une erreur fournisseur distincte ; `canceled` rend
 *    null (chez nous, uniquement via l'abort de délai) ; `succeeded` sans média
 *    reste un vrai « aucune image ».
 */

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const URLS = { get: 'https://api.replicate.com/v1/predictions/p1', cancel: 'https://api.replicate.com/v1/predictions/p1/cancel' };

/**
 * `fetch` doublé. `creerRend` = la prédiction rendue par le POST create (en
 * mode block, l'API rend l'état APRÈS le Prefer:wait). `suiteGet` = la
 * séquence rendue par les GET successifs de `wait()`.
 */
function fetchDouble(creerRend: Record<string, unknown>, suiteGet: Array<Record<string, unknown>> = []) {
  let i = 0;
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(typeof url === 'object' && 'url' in url ? (url as Request).url : url);
    const method = (init?.method || (typeof url === 'object' && 'method' in url ? (url as Request).method : 'GET') || 'GET').toUpperCase();
    if (method === 'POST' && u.includes('predictions')) {
      return jsonResp({ id: 'p1', urls: URLS, ...creerRend });
    }
    if (method === 'POST' && u.includes('/cancel')) {
      return jsonResp({ id: 'p1', urls: URLS, status: 'canceled', output: null });
    }
    if (method === 'GET' && u.includes('/predictions/p1')) {
      const etat = suiteGet[Math.min(i, suiteGet.length - 1)] ?? {};
      i += 1;
      return jsonResp({ id: 'p1', urls: URLS, ...etat });
    }
    return jsonResp({ detail: 'not found' }, 404);
  };
}

const MODELE = 'black-forest-labs/flux-schnell';
const MEDIA = 'https://replicate.delivery/xyz/out.webp';

describe('Racine A — wait:poll vs block sur le SDK réel', () => {
  it('BUG (block) : prédiction encore `processing` après Prefer:wait → run() rend null (média perdu)', async () => {
    // En block, le POST create (Prefer:wait) rend l'état courant : ici encore
    // `processing`, output null. `isDone = block && status!=="starting"` = vrai
    // → run() NE sonde pas et rend output (null).
    const rep = new Replicate({ auth: 'test', useFileOutput: false, fetch: fetchDouble({ status: 'processing', output: null }) as unknown as typeof fetch });
    const out = await rep.run(MODELE, { input: { prompt: 'x' }, wait: { mode: 'block' } });
    expect(out).toBeNull();
  });

  it('CAS A (poll) : `processing`+null PUIS `succeeded`+média → run() attend et rend le média', async () => {
    const rep = new Replicate({ auth: 'test', useFileOutput: false, fetch: fetchDouble(
      { status: 'starting', output: null },
      [{ status: 'processing', output: null }, { status: 'succeeded', output: [MEDIA] }],
    ) as unknown as typeof fetch });
    const out = await rep.run(MODELE, { input: { prompt: 'x' }, wait: { mode: 'poll', interval: 1 } });
    expect(out).toEqual([MEDIA]);
  });

  it('CAS B (poll) : `failed` → run() LÈVE une erreur fournisseur explicite', async () => {
    const rep = new Replicate({ auth: 'test', useFileOutput: false, fetch: fetchDouble(
      { status: 'starting', output: null },
      [{ status: 'failed', error: 'NSFW content detected' }],
    ) as unknown as typeof fetch });
    await expect(rep.run(MODELE, { input: { prompt: 'x' }, wait: { mode: 'poll', interval: 1 } }))
      .rejects.toThrow(/Prediction failed: NSFW content detected/);
  });

  it('CAS C (poll) : `canceled` → run() rend null (chez nous, seulement via abort de délai)', async () => {
    const rep = new Replicate({ auth: 'test', useFileOutput: false, fetch: fetchDouble(
      { status: 'starting', output: null },
      [{ status: 'canceled', output: null }],
    ) as unknown as typeof fetch });
    const out = await rep.run(MODELE, { input: { prompt: 'x' }, wait: { mode: 'poll', interval: 1 } });
    expect(out).toBeNull();
  });

  it('CAS D (poll) : `succeeded` SANS média → run() rend null = vrai « aucune image »', async () => {
    const rep = new Replicate({ auth: 'test', useFileOutput: false, fetch: fetchDouble(
      { status: 'starting', output: null },
      [{ status: 'succeeded', output: null }],
    ) as unknown as typeof fetch });
    const out = await rep.run(MODELE, { input: { prompt: 'x' }, wait: { mode: 'poll', interval: 1 } });
    expect(out).toBeNull();
  });

  it('CAS F (poll) : sortie en TABLEAU d’URL (flux-schnell) et URL simple (kontext) toutes deux rendues', async () => {
    const repArr = new Replicate({ auth: 'test', useFileOutput: false, fetch: fetchDouble({ status: 'starting', output: null }, [{ status: 'succeeded', output: [MEDIA] }]) as unknown as typeof fetch });
    expect(await repArr.run(MODELE, { input: {}, wait: { mode: 'poll', interval: 1 } })).toEqual([MEDIA]);
    const repStr = new Replicate({ auth: 'test', useFileOutput: false, fetch: fetchDouble({ status: 'starting', output: null }, [{ status: 'succeeded', output: MEDIA }]) as unknown as typeof fetch });
    expect(await repStr.run('black-forest-labs/flux-kontext-pro', { input: {}, wait: { mode: 'poll', interval: 1 } })).toBe(MEDIA);
  });

  it('CAS E (poll, config RÉELLE de l’app `useFileOutput` par défaut) : rend un FileOutput LISIBLE (getReader/blob), pas null', async () => {
    // L'app instancie `new Replicate({ auth })` sans `useFileOutput` → défaut
    // `true` → les URLs deviennent des FileOutput. `lireOctetsSortie` lit alors
    // via `getReader`/`blob`. On prouve ici que le chemin réel rend bien un
    // objet lisible (et non null) après le poll.
    const rep = new Replicate({ auth: 'test', fetch: fetchDouble(
      { status: 'starting', output: null },
      [{ status: 'succeeded', output: [MEDIA] }],
    ) as unknown as typeof fetch });
    const out = await rep.run(MODELE, { input: {}, wait: { mode: 'poll', interval: 1 } }) as unknown[];
    expect(Array.isArray(out)).toBe(true);
    const premiere = out[0] as { getReader?: unknown; blob?: unknown };
    expect(premiere).not.toBeNull();
    // C'est exactement ce que `lireOctetsSortie` attend d'un FileOutput.
    expect(typeof premiere.getReader === 'function' || typeof premiere.blob === 'function').toBe(true);
  });
});
