// @vitest-environment node
/**
 * PawaPay — confirmation PAR INTERROGATION, sans dépendre d'aucun callback.
 *
 * Le compte PawaPay est partagé avec d'autres sites et son URL de callback
 * pointe ailleurs : Studiio confirme ses paiements en relisant lui-même
 * `GET /v2/deposits/{id}` — via la route de statut (chemin normal) et le cron
 * de rattrapage. Ces tests appellent les VRAIS gestionnaires, avec une
 * doublure de `fetch` qui joue PawaPay et un store en mémoire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerStoreMemoire } from '@/lib/payment/pawapay/confirmation';
import type { DepotAttendu } from '@/lib/payment/pawapay/types';

const etat = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  store: null as unknown,
  crediter: null as unknown,
  taux: null as null | Record<string, string>,
}));

vi.mock('@/lib/auth/config', () => ({ auth: async () => etat.session }));
vi.mock('@/lib/payment/pawapay/store', () => ({
  obtenirStore: () => etat.store,
  obtenirCrediteur: () => etat.crediter,
  obtenirTauxChf: async () => etat.taux,
  obtenirDependances: () => (etat.store && etat.crediter
    ? { store: etat.store, crediter: etat.crediter } : null),
}));

import { POST as initier } from '@/app/api/pawapay/deposit/route';
import { GET as statut } from '@/app/api/pawapay/status/[id]/route';
import { GET as rattraper } from '@/app/api/cron/pawapay-reconcile/route';
import { POST as callback } from '@/app/api/pawapay/callback/route';
import { viderCachePays } from '@/lib/payment/pawapay/client';

const API = 'https://api.sandbox.pawapay.io';
const SECRET = 'secret-cron-de-test';
const ID = '8917c345-4791-4285-a416-62f24b6982db';
const ID_AUTRE = '4985d482-454d-4ebc-abc9-ad525eef21b6';
const T0 = Date.parse('2026-09-28T10:00:00.000Z');

type Distant = { status: string; amount: string; currency: string } | 'NOT_FOUND' | 'PANNE';

/** Ce que PawaPay répond pour chaque dépôt, et ce qu'on lui a demandé. */
let distants: Map<string, Distant>;
let pagesDemandees: Array<Record<string, unknown>>;
let surPagePaiement: ((corps: Record<string, unknown>) => Response) | null;
const urlsAppelees: string[] = [];

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchPawapay = vi.fn(async (entree: unknown, init?: RequestInit) => {
  const url = String(entree);
  urlsAppelees.push(url);
  if (url === `${API}/v2/active-conf`) {
    return json({ countries: [{ country: 'CIV', providers: [{ currencies: [{ currency: 'XOF' }] }] }] });
  }
  if (url === `${API}/v2/paymentpage`) {
    const corps = JSON.parse(String(init?.body));
    pagesDemandees.push(corps);
    return surPagePaiement ? surPagePaiement(corps) : json({ redirectUrl: 'https://sandbox.paywith.pawapay.io/?token=t' });
  }
  const m = /\/v2\/deposits\/([0-9a-f-]{36})$/.exec(url);
  if (m) {
    const d = distants.get(m[1]) ?? 'NOT_FOUND';
    if (d === 'PANNE') throw new Error('ECONNRESET');
    if (d === 'NOT_FOUND') return json({ status: 'NOT_FOUND' });
    return json({ status: 'FOUND', data: { depositId: m[1], ...d } });
  }
  throw new Error(`URL inattendue : ${url}`);
});

function depot(p: Partial<DepotAttendu> = {}): DepotAttendu {
  return {
    depositId: ID,
    userId: 'alice',
    pack: 'large',
    credits: 500,
    montant: '38645',
    devise: 'XOF',
    statut: 'en_attente',
    creeLe: new Date(T0).toISOString(),
    ...p,
  };
}

function brancher(depots: DepotAttendu[] = []) {
  const store = creerStoreMemoire(depots);
  const crediter = vi.fn(async (_u: string, _c: number, _r: string) => {});
  etat.store = store;
  etat.crediter = crediter;
  return { store, crediter };
}

const reqInitier = (corps: unknown) => new Request('http://localhost/api/pawapay/deposit', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
});
const appelerStatut = (id: string) => statut(new Request(`http://localhost/api/pawapay/status/${id}`), { params: { id } });
const reqCron = (auth?: string, qs = '') => new NextRequest(`http://localhost/api/cron/pawapay-reconcile${qs}`, {
  headers: auth ? { authorization: auth } : {},
});
const appelerCallback = (corps: unknown) => callback(new Request('http://localhost/api/pawapay/callback', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  distants = new Map();
  pagesDemandees = [];
  surPagePaiement = null;
  urlsAppelees.length = 0;
  fetchPawapay.mockClear();
  vi.stubGlobal('fetch', fetchPawapay);
  vi.stubEnv('PAWAPAY_API_TOKEN', 'jeton-de-test');
  vi.stubEnv('PAWAPAY_BASE_URL', API);
  vi.stubEnv('NEXTAUTH_URL', 'https://studiio.pro');
  vi.stubEnv('CRON_SECRET', SECRET);
  etat.session = { user: { id: 'alice' } };
  etat.store = null;
  etat.crediter = null;
  etat.taux = { XOF: '655' };
  viderCachePays();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/pawapay/deposit — initiation', () => {
  it('401 sans session', async () => {
    etat.session = null;
    brancher();
    expect((await initier(reqInitier({ pack: 'small', pays: 'CIV' }))).status).toBe(401);
    expect(fetchPawapay).not.toHaveBeenCalled();
  });

  it('503 sans store, sans appeler PawaPay', async () => {
    const r = await initier(reqInitier({ pack: 'small', pays: 'CIV' }));
    expect(r.status).toBe(503);
    expect(fetchPawapay).not.toHaveBeenCalled();
  });

  it('503 sans taux, sans appeler PawaPay', async () => {
    brancher();
    etat.taux = null;
    expect((await initier(reqInitier({ pack: 'small', pays: 'CIV' }))).status).toBe(503);
    expect(fetchPawapay).not.toHaveBeenCalled();
  });

  it('refuse un pack, un pays ou une devise invalides', async () => {
    brancher();
    expect((await initier(reqInitier({ pack: 'gratuit', pays: 'CIV' }))).status).toBe(400);
    expect((await initier(reqInitier({ pack: 'small', pays: 'ci' }))).status).toBe(400);
    expect((await initier(reqInitier({ pack: 'small', pays: 'GHA' }))).status).toBe(400);
    expect((await initier(reqInitier({ pack: 'small', pays: 'CIV', devise: 'EUR' }))).status).toBe(400);
    etat.taux = { GHS: '16' };
    expect((await initier(reqInitier({ pack: 'small', pays: 'CIV' }))).status).toBe(400);
    expect(pagesDemandees).toHaveLength(0);
  });

  it('prix et crédits calculés côté serveur, ligne enregistrée AVANT PawaPay, métadonnée app=studiio', async () => {
    const { store } = brancher();
    let ligneAuMomentDeLAppel: DepotAttendu | undefined;
    surPagePaiement = (corps) => {
      ligneAuMomentDeLAppel = store.etat(String(corps.depositId));
      return json({ redirectUrl: 'https://sandbox.paywith.pawapay.io/?token=t' });
    };
    // Le client tente d'imposer son prix et ses crédits : ignorés.
    const r = await initier(reqInitier({ pack: 'large', pays: 'CIV', montant: '1', credits: 999999 }));
    expect(r.status).toBe(200);
    const corps = await r.json();
    expect(corps).toMatchObject({ montant: '38645', devise: 'XOF', credits: 500 });
    expect(corps.depositId).toMatch(/^[0-9a-f-]{36}$/);

    expect(ligneAuMomentDeLAppel).toMatchObject({
      depositId: corps.depositId, userId: 'alice', credits: 500, montant: '38645', devise: 'XOF', statut: 'en_attente',
    });
    const page = pagesDemandees[0];
    expect(page.depositId).toBe(corps.depositId);
    expect(page.amountDetails).toEqual({ amount: '38645', currency: 'XOF' });
    expect(page.metadata).toContainEqual({ app: 'studiio' });
    expect(page.returnUrl).toBe(`https://studiio.pro/dashboard/billing?pawapay=${corps.depositId}`);
  });

  it('refus explicite de PawaPay → échec ; panne réseau → reste en attente', async () => {
    const { store } = brancher();
    surPagePaiement = () => json({ status: 'REJECTED', failureReason: { failureCode: 'AMOUNT_OUT_OF_BOUNDS' } });
    const r1 = await initier(reqInitier({ pack: 'small', pays: 'CIV' }));
    expect(r1.status).toBe(502);
    expect(store.etat((await r1.json()).depositId)?.statut).toBe('echec');

    surPagePaiement = () => { throw new Error('ECONNRESET'); };
    const r2 = await initier(reqInitier({ pack: 'small', pays: 'CIV' }));
    expect(r2.status).toBe(502);
    expect(store.etat((await r2.json()).depositId)?.statut).toBe('en_attente');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('GET /api/pawapay/status/[id] — chemin normal par interrogation', () => {
  it('COMPLETED détecté par interrogation directe → credited, un seul crédit', async () => {
    const { crediter } = brancher([depot()]);
    distants.set(ID, { status: 'COMPLETED', amount: '38645.00', currency: 'XOF' });
    const r = await appelerStatut(ID);
    expect(await r.json()).toEqual({ status: 'credited' });
    expect(crediter).toHaveBeenCalledWith('alice', 500, `pawapay:${ID}`);
    expect(urlsAppelees).toEqual([`${API}/v2/deposits/${ID}`]);
    await appelerStatut(ID);
    expect(crediter).toHaveBeenCalledTimes(1);
  });

  it.each(['ACCEPTED', 'PROCESSING', 'IN_RECONCILIATION'])('%s reste pending, sans crédit', async (s) => {
    const { crediter, store } = brancher([depot()]);
    distants.set(ID, { status: s, amount: '38645', currency: 'XOF' });
    expect(await (await appelerStatut(ID)).json()).toEqual({ status: 'pending' });
    expect(crediter).not.toHaveBeenCalled();
    expect(store.etat(ID)?.statut).toBe('en_attente');
  });

  it('FAILED → failed, jamais crédité', async () => {
    const { crediter } = brancher([depot()]);
    distants.set(ID, { status: 'FAILED', amount: '38645', currency: 'XOF' });
    expect(await (await appelerStatut(ID)).json()).toEqual({ status: 'failed' });
    expect(crediter).not.toHaveBeenCalled();
  });

  it('montant ou devise incorrects → refusés, pending, sans crédit', async () => {
    const { crediter } = brancher([depot()]);
    distants.set(ID, { status: 'COMPLETED', amount: '100', currency: 'XOF' });
    expect(await (await appelerStatut(ID)).json()).toEqual({ status: 'pending' });
    distants.set(ID, { status: 'COMPLETED', amount: '38645', currency: 'XAF' });
    expect(await (await appelerStatut(ID)).json()).toEqual({ status: 'pending' });
    expect(crediter).not.toHaveBeenCalled();
  });

  it('refuse le dépôt d’un autre utilisateur (404, aucune relecture)', async () => {
    const { crediter } = brancher([depot({ userId: 'bob' })]);
    distants.set(ID, { status: 'COMPLETED', amount: '38645', currency: 'XOF' });
    expect((await appelerStatut(ID)).status).toBe(404);
    expect(fetchPawapay).not.toHaveBeenCalled();
    expect(crediter).not.toHaveBeenCalled();
  });

  it('404 pour un id inconnu ou invalide, 401 sans session, 503 sans store', async () => {
    brancher([depot()]);
    expect((await appelerStatut(ID_AUTRE)).status).toBe(404);
    expect((await appelerStatut('pas-un-uuid')).status).toBe(404);
    etat.session = null;
    expect((await appelerStatut(ID)).status).toBe(401);
    etat.session = { user: { id: 'alice' } };
    etat.store = null;
    expect((await appelerStatut(ID)).status).toBe(503);
  });

  it('relecture en panne → 502, jamais pending', async () => {
    const { crediter } = brancher([depot()]);
    distants.set(ID, 'PANNE');
    expect((await appelerStatut(ID)).status).toBe(502);
    expect(crediter).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('GET /api/cron/pawapay-reconcile — rattrapage', () => {
  it('401 sans CRON_SECRET valide (absent, faux, ou secret non configuré)', async () => {
    const { crediter } = brancher([depot()]);
    distants.set(ID, { status: 'COMPLETED', amount: '38645', currency: 'XOF' });
    expect((await rattraper(reqCron())).status).toBe(401);
    expect((await rattraper(reqCron('Bearer mauvais'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await rattraper(reqCron('Bearer '))).status).toBe(401);
    expect((await rattraper(reqCron('Bearer undefined'))).status).toBe(401);
    expect(fetchPawapay).not.toHaveBeenCalled();
    expect(crediter).not.toHaveBeenCalled();
  });

  it('store absent → 200 « désactivé », rien fait', async () => {
    const r = await rattraper(reqCron(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'desactive' });
    expect(fetchPawapay).not.toHaveBeenCalled();
  });

  it('ne crédite rien sans COMPLETED', async () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
    const { crediter, store } = brancher(ids.map((depositId) => depot({ depositId })));
    distants.set(ids[0], { status: 'PROCESSING', amount: '38645', currency: 'XOF' });
    distants.set(ids[1], { status: 'FAILED', amount: '38645', currency: 'XOF' });
    // ids[2] : NOT_FOUND
    vi.setSystemTime(T0 + 15 * 60_000);
    const r = await rattraper(reqCron(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect((await r.json()).bilan).toEqual({ en_attente: 1, echec: 1, introuvable: 1 });
    expect(crediter).not.toHaveBeenCalled();
    expect(store.etat(ids[0])?.statut).toBe('en_attente');
    expect(store.etat(ids[1])?.statut).toBe('echec');
    expect(store.etat(ids[2])?.statut).toBe('en_attente');
  });

  it('ne traite que les dépôts plus vieux que N minutes, dans la limite par passage', async () => {
    const vieux = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    const { crediter } = brancher([
      depot({ depositId: vieux[0], creeLe: new Date(T0 - 60 * 60_000).toISOString() }),
      depot({ depositId: vieux[1], creeLe: new Date(T0 - 30 * 60_000).toISOString() }),
      depot({ depositId: ID, creeLe: new Date(T0 - 2 * 60_000).toISOString() }),
    ]);
    for (const id of [...vieux, ID]) distants.set(id, { status: 'COMPLETED', amount: '38645', currency: 'XOF' });
    const r = await rattraper(reqCron(`Bearer ${SECRET}`, '?minutes=10&limite=1'));
    expect((await r.json()).examines).toBe(1);
    expect(crediter).toHaveBeenCalledTimes(1);
    expect(crediter.mock.calls[0][2]).toBe(`pawapay:${vieux[0]}`);
    await rattraper(reqCron(`Bearer ${SECRET}`));
    expect(crediter).toHaveBeenCalledTimes(2); // ID (2 min) toujours ignoré
  });

  it('un dépôt non final après 24 h est journalisé et LAISSÉ en attente', async () => {
    const { crediter, store } = brancher([depot()]);
    distants.set(ID, { status: 'PROCESSING', amount: '38645', currency: 'XOF' });
    vi.setSystemTime(T0 + 25 * 3_600_000);
    const r = await rattraper(reqCron(`Bearer ${SECRET}`));
    expect((await r.json()).bloques).toEqual([ID]);
    expect(console.warn).toHaveBeenCalled();
    expect(store.etat(ID)?.statut).toBe('en_attente');
    expect(crediter).not.toHaveBeenCalled();
  });

  it('une panne sur un dépôt n’empêche pas les autres, et le passage répond 500', async () => {
    const autre = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const { crediter } = brancher([depot(), depot({ depositId: autre })]);
    distants.set(ID, 'PANNE');
    distants.set(autre, { status: 'COMPLETED', amount: '38645', currency: 'XOF' });
    vi.setSystemTime(T0 + 15 * 60_000);
    const r = await rattraper(reqCron(`Bearer ${SECRET}`));
    expect(r.status).toBe(500);
    expect((await r.json()).bilan).toEqual({ erreur: 1, credite: 1 });
    expect(crediter).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('parcours complet SANS aucun callback', () => {
  it('initiation → statut pending → PawaPay COMPLETED → rattrapage crédite → statut credited', async () => {
    const { crediter, store } = brancher();

    const init = await (await initier(reqInitier({ pack: 'medium', pays: 'CIV' }))).json();
    const id = init.depositId as string;
    expect(init).toMatchObject({ montant: '18995', devise: 'XOF', credits: 200 });

    distants.set(id, { status: 'PROCESSING', amount: '18995', currency: 'XOF' });
    expect(await (await appelerStatut(id)).json()).toEqual({ status: 'pending' });

    // Le client ferme son navigateur. PawaPay termine le paiement.
    distants.set(id, { status: 'COMPLETED', amount: '18995.00', currency: 'XOF' });
    vi.setSystemTime(T0 + 15 * 60_000);
    const cron = await (await rattraper(reqCron(`Bearer ${SECRET}`))).json();
    expect(cron.bilan).toEqual({ credite: 1 });

    expect(await (await appelerStatut(id)).json()).toEqual({ status: 'credited' });
    expect(crediter).toHaveBeenCalledTimes(1);
    expect(crediter).toHaveBeenCalledWith('alice', 200, `pawapay:${id}`);
    expect(store.etat(id)?.statut).toBe('credite');

    // Aucune URL autre que l'API PawaPay, aucun callback impliqué.
    expect(urlsAppelees.every((u) => u.startsWith(`${API}/v2/`))).toBe(true);
  });
});

describe('concurrence statut + rattrapage + callback', () => {
  it('le même depositId confirmé en parallèle n’est crédité qu’une fois', async () => {
    vi.stubEnv('PAWAPAY_ENABLED', 'true');
    const { crediter, store } = brancher([depot()]);
    distants.set(ID, { status: 'COMPLETED', amount: '38645', currency: 'XOF' });
    vi.setSystemTime(T0 + 15 * 60_000);
    const [s1, c, cb, s2] = await Promise.all([
      appelerStatut(ID),
      rattraper(reqCron(`Bearer ${SECRET}`)),
      appelerCallback({ depositId: ID, status: 'COMPLETED' }),
      appelerStatut(ID),
    ]);
    expect([s1.status, c.status, cb.status, s2.status]).toEqual([200, 200, 200, 200]);
    expect(await s1.json()).toEqual({ status: 'credited' });
    expect(await s2.json()).toEqual({ status: 'credited' });
    expect(crediter).toHaveBeenCalledTimes(1);
    expect(store.etat(ID)?.statut).toBe('credite');
  });
});
