import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Serie 10 — une tentative refusee pour `solde_insuffisant` ne doit pas
 * rester orpheline en `reserved` : le navigateur connait l'issue, il ferme.
 *
 * Reponses simulees, calquees sur `src/app/api/render/jobs/[id]/confirm/route.ts` :
 *   402 { ok:false, etat:'reserved', motif:'solde_insuffisant', balance }  → cancel
 *   422 { ok:false, motif:'objet_absent' }  (deja `failed` cote serveur)   → pas de cancel
 *   503 { ok:false, motif:'stockage_injoignable' } (laissee ouverte expres) → pas de cancel
 */

type Reponse = { ok: boolean; status?: number; json: () => Promise<unknown> };
type Scenario = {
  confirm: Reponse | (() => Reponse);
  cancel?: Reponse | (() => never);
  jobIds?: string[];
};

const appels: string[] = [];
const vraiFetch = globalThis.fetch;

const reponse = (ok: boolean, status: number, corps: unknown): Reponse =>
  ({ ok, status, json: async () => corps });

function poserFetch(s: Scenario) {
  appels.length = 0;
  const jobIds = [...(s.jobIds ?? ['j1'])];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push(`${String(init?.method ?? 'GET')} ${u}`);
    if (u === '/api/render/jobs') {
      const jobId = jobIds.shift() ?? 'j1';
      return reponse(true, 200, {
        ok: true, jobId, uploadUrl: `https://minio.test/put/${jobId}`,
        publicUrl: `https://cdn.test/${jobId}.webm`, cout: 10,
      }) as Response;
    }
    if (u.includes('/confirm')) {
      const r = typeof s.confirm === 'function' ? s.confirm() : s.confirm;
      return r as Response;
    }
    if (u.includes('/cancel')) {
      const r = s.cancel ?? reponse(true, 200, { ok: true, etat: 'cancelled' });
      return (typeof r === 'function' ? r() : r) as Response;
    }
    return reponse(true, 200, { ok: true }) as Response;
  }) as unknown as typeof fetch;
}

const blob = () => new Blob(['x'.repeat(50_000)], { type: 'video/webm' });
const cancels = () => appels.filter((a) => a.includes('/cancel'));
const confirms = () => appels.filter((a) => a.includes('/confirm'));

const SOLDE_INSUFFISANT = reponse(false, 402, {
  ok: false, etat: 'reserved', motif: 'solde_insuffisant', balance: 3,
});

afterEach(() => { globalThis.fetch = vraiFetch; });

describe('rendreEtFacturer — solde insuffisant : la tentative est fermee', () => {
  it('1. 402 solde_insuffisant → rien de livre, et UN cancel apres la confirmation', async () => {
    poserFetch({ confirm: SOLDE_INSUFFISANT });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });

    expect(r).toEqual({ ok: false, motif: 'solde_insuffisant', jobId: 'j1' });
    expect(r.blob).toBeUndefined();
    expect(r.url).toBeUndefined();

    expect(cancels()).toEqual(['POST /api/render/jobs/j1/cancel']);
    const iConfirm = appels.findIndex((a) => a.includes('/confirm'));
    const iCancel = appels.findIndex((a) => a.includes('/cancel'));
    expect(iConfirm).toBeGreaterThan(-1);
    expect(iCancel).toBeGreaterThan(iConfirm);
  });

  it('2. confirmation ok → montage livre, aucun cancel', async () => {
    poserFetch({ confirm: reponse(true, 200, { ok: true, etat: 'confirmed', balance: 90 }) });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'apercu', format: 'reel', composer: async () => blob() });

    expect(r.ok).toBe(true);
    expect(r.blob).toBeTruthy();
    expect(r.url).toBe('https://cdn.test/j1.webm');
    expect(cancels()).toHaveLength(0);
  });

  it('3. 422 objet_absent → rien de livre ; deja `failed` cote serveur, donc aucun cancel', async () => {
    // La route de confirmation a deja clos la tentative en `failed` et ne
    // renvoie pas d'etat : un cancel ne recolterait qu'un 409. On n'appelle pas.
    poserFetch({ confirm: reponse(false, 422, { ok: false, error: 'Aucun montage valide', motif: 'objet_absent' }) });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });

    expect(r.ok).toBe(false);
    expect(r.motif).toBe('objet_absent');
    expect(r.blob).toBeUndefined();
    expect(cancels()).toHaveLength(0);
  });

  it('4. 503 stockage_injoignable → rien de livre, et la tentative reste ouverte (aucun cancel)', async () => {
    // Meme si un `etat: 'reserved'` accompagnait la reponse : la panne est
    // cote serveur, il laisse la tentative ouverte pour permettre une reprise.
    poserFetch({ confirm: reponse(false, 503, { ok: false, etat: 'reserved', motif: 'stockage_injoignable' }) });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });

    expect(r.ok).toBe(false);
    expect(r.motif).toBe('stockage_injoignable');
    expect(r.blob).toBeUndefined();
    expect(cancels()).toHaveLength(0);
  });

  it('5a. un cancel qui repond 500 ne change ni la livraison ni ne leve', async () => {
    poserFetch({ confirm: SOLDE_INSUFFISANT, cancel: reponse(false, 500, { ok: false, error: 'boom' }) });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });

    expect(r).toEqual({ ok: false, motif: 'solde_insuffisant', jobId: 'j1' });
    expect(cancels()).toHaveLength(1);
  });

  it('5b. un cancel dont le fetch leve ne change ni la livraison ni ne leve', async () => {
    poserFetch({ confirm: SOLDE_INSUFFISANT, cancel: () => { throw new Error('reseau coupe'); } });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });

    expect(r).toEqual({ ok: false, motif: 'solde_insuffisant', jobId: 'j1' });
    expect(cancels()).toHaveLength(1);
  });

  it('6. deux rendus de suite, le premier refuse : un cancel, une reservation chacun, jamais deux confirms pour le meme job', async () => {
    let n = 0;
    poserFetch({
      jobIds: ['j1', 'j2'],
      confirm: () => (n++ === 0
        ? SOLDE_INSUFFISANT
        : reponse(true, 200, { ok: true, etat: 'confirmed', balance: 80 })),
    });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');

    const r1 = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });
    const r2 = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });

    expect(r1).toEqual({ ok: false, motif: 'solde_insuffisant', jobId: 'j1' });
    expect(r2.ok).toBe(true);
    expect(r2.jobId).toBe('j2');

    expect(appels.filter((a) => a === 'POST /api/render/jobs')).toHaveLength(2);
    expect(cancels()).toEqual(['POST /api/render/jobs/j1/cancel']);
    expect(confirms()).toEqual([
      'POST /api/render/jobs/j1/confirm',
      'POST /api/render/jobs/j2/confirm',
    ]);
    // Chaque job n'est confirme qu'une fois.
    expect(new Set(confirms()).size).toBe(confirms().length);
  });

  it('7. messagePour(solde_insuffisant) est inchange', async () => {
    const { messagePour } = await import('@/lib/rendus/client');
    expect(messagePour('solde_insuffisant'))
      .toBe('Crédits insuffisants : le montage n’a pas été débité ni livré.');
  });
});
