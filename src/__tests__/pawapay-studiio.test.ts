// @vitest-environment node
/**
 * PawaPay — intégration INDÉPENDANTE de Studiio.
 *
 * Aucun appel réel : `fetch` est remplacé par une doublure dans chaque test.
 * Couvre : relecture v2 (bug « FOUND »), verdict pur, anti double crédit
 * (y compris concurrent), conversion CHF sans taux figé, route de callback
 * (corps ignoré, 404/503, 5xx sur relecture en échec), et garde « aucune URL
 * d'un autre site » dans le code PawaPay.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PawapayErreur, type DepotAttendu, type DepotDistant } from '@/lib/payment/pawapay/types';

const mocksStore = vi.hoisted(() => ({
  store: null as unknown,
}));
vi.mock('@/lib/payment/pawapay/store', () => ({
  pawapayActif: () => process.env.PAWAPAY_ENABLED === 'true',
  obtenirStore: () => mocksStore.store,
  obtenirTauxChf: async () => null,
  obtenirDependances: () => (mocksStore.store ? { store: mocksStore.store } : null),
}));

import {
  confirmerDepot,
  creerStoreMemoire,
  evaluerDepot,
  normaliserMontant,
} from '@/lib/payment/pawapay/confirmation';
import {
  type ArgsPagePaiement,
  DELAI_APPEL_PAWAPAY_MS,
  creerPagePaiement,
  lireDepot,
  paysActifs,
  viderCachePays,
} from '@/lib/payment/pawapay/client';
import { DeviseSansTauxErreur, PACKS_PAWAPAY, prixLocal } from '@/lib/payment/pawapay/tarifs';
import { POST } from '@/app/api/pawapay/callback/route';

const ID = '8917c345-4791-4285-a416-62f24b6982db';
const ID2 = '4985d482-454d-4ebc-abc9-ad525eef21b6';

function attendu(p: Partial<DepotAttendu> = {}): DepotAttendu {
  return {
    depositId: ID,
    userId: 'user-1',
    pack: 'large',
    credits: 500,
    montant: '38645',
    devise: 'XOF',
    statut: 'en_attente',
    creeLe: '2026-09-28T10:00:00.000Z',
    ...p,
  };
}

function distant(statut: string, p: Partial<{ montant: string; devise: string }> = {}): DepotDistant {
  return { trouve: true, depositId: ID, statut, montant: p.montant ?? '38645.00', devise: p.devise ?? 'XOF' };
}

function reponseJson(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('PAWAPAY_API_TOKEN', 'jeton-de-test');
  vi.stubEnv('PAWAPAY_BASE_URL', 'https://api.sandbox.pawapay.io');
  mocksStore.store = null;
  viderCachePays();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ───────────────────────────────────────────────────────────────────────────
describe('evaluerDepot — verdict pur', () => {
  it('COMPLETED avec le bon montant et la bonne devise → crediter', () => {
    expect(evaluerDepot(attendu(), distant('COMPLETED'))).toBe('crediter');
  });

  it.each(['FAILED'])('%s → echec', (s) => {
    expect(evaluerDepot(attendu(), distant(s))).toBe('echec');
  });

  it.each(['ACCEPTED', 'PROCESSING', 'IN_RECONCILIATION', 'FOUND', ''])('%s → en_attente', (s) => {
    expect(evaluerDepot(attendu(), distant(s))).toBe('en_attente');
  });

  it('NOT_FOUND → introuvable', () => {
    expect(evaluerDepot(attendu(), { trouve: false, depositId: ID })).toBe('introuvable');
  });

  it('montant incorrect → montant_invalide', () => {
    expect(evaluerDepot(attendu(), distant('COMPLETED', { montant: '38644' }))).toBe('montant_invalide');
    expect(evaluerDepot(attendu(), distant('COMPLETED', { montant: '38645.01' }))).toBe('montant_invalide');
    expect(evaluerDepot(attendu(), distant('COMPLETED', { montant: '' }))).toBe('montant_invalide');
    expect(evaluerDepot(attendu(), distant('COMPLETED', { montant: '3.8645e4' }))).toBe('montant_invalide');
  });

  it('devise incorrecte → devise_invalide', () => {
    expect(evaluerDepot(attendu(), distant('COMPLETED', { devise: 'XAF' }))).toBe('devise_invalide');
    expect(evaluerDepot(attendu(), distant('COMPLETED', { devise: 'xof' }))).toBe('devise_invalide');
  });

  it('normalise les montants en chaîne, sans flottant', () => {
    expect(normaliserMontant('0123.500')).toBe('123.5');
    expect(normaliserMontant('123.00')).toBe('123');
    expect(normaliserMontant('0')).toBe('0');
    expect(normaliserMontant('-1')).toBeNull();
    expect(normaliserMontant('1,5')).toBeNull();
    expect(normaliserMontant(0.1 + 0.2)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('confirmerDepot — anti double crédit, crédit atomique', () => {
  function deps(statut: string, store = creerStoreMemoire([attendu()])) {
    const lireDepotDistant = vi.fn(async () => distant(statut));
    const maintenant = () => new Date('2026-09-28T12:00:00.000Z');
    return { store, lireDepotDistant, maintenant };
  }
  /** Invariant : un dépôt « credite » a TOUJOURS sa transaction, et réciproquement. */
  function coherent(store: ReturnType<typeof creerStoreMemoire>, id = ID) {
    const aTransaction = store.transactions().some((t) => t.referenceId === `pawapay:${id}`);
    expect(store.etat(id)?.statut === 'credite').toBe(aTransaction);
  }

  it('COMPLETED → crédite une fois, avec la référence pawapay:<id>, et note la vérification', async () => {
    const d = deps('COMPLETED');
    const r = await confirmerDepot(ID, d);
    expect(r.issue).toBe('credite');
    expect(d.store.transactions()).toEqual([{ referenceId: `pawapay:${ID}`, userId: 'user-1', credits: 500 }]);
    expect(d.store.etat(ID)?.statut).toBe('credite');
    expect(d.store.etat(ID)?.verifieLe).toBe('2026-09-28T12:00:00.000Z');
    coherent(d.store);
  });

  it.each([
    ['FAILED', 'echec'],
    ['PROCESSING', 'en_attente'],
    ['ACCEPTED', 'en_attente'],
  ])('%s ne crédite pas (%s)', async (statut, issue) => {
    const d = deps(statut);
    expect((await confirmerDepot(ID, d)).issue).toBe(issue);
    expect(d.store.transactions()).toHaveLength(0);
    expect(d.store.etat(ID)?.verifieLe).toBeTruthy();
  });

  it('NOT_FOUND ne crédite pas', async () => {
    const d = deps('COMPLETED');
    d.lireDepotDistant.mockResolvedValue({ trouve: false, depositId: ID });
    expect((await confirmerDepot(ID, d)).issue).toBe('introuvable');
    expect(d.store.transactions()).toHaveLength(0);
  });

  it('dépôt inconnu de Studiio → aucun crédit, aucune relecture', async () => {
    const d = deps('COMPLETED', creerStoreMemoire([]));
    expect((await confirmerDepot(ID, d)).issue).toBe('inconnu_local');
    expect(d.lireDepotDistant).not.toHaveBeenCalled();
  });

  it('montant ou devise incorrects → refusés, sans crédit', async () => {
    const d = deps('COMPLETED');
    d.lireDepotDistant.mockResolvedValueOnce(distant('COMPLETED', { montant: '1' }));
    expect((await confirmerDepot(ID, d)).issue).toBe('montant_invalide');
    d.lireDepotDistant.mockResolvedValueOnce(distant('COMPLETED', { devise: 'GHS' }));
    expect((await confirmerDepot(ID, d)).issue).toBe('devise_invalide');
    expect(d.store.transactions()).toHaveLength(0);
  });

  it('même depositId confirmé deux fois de suite → un seul crédit', async () => {
    const d = deps('COMPLETED');
    expect((await confirmerDepot(ID, d)).issue).toBe('credite');
    expect((await confirmerDepot(ID, d)).issue).toBe('deja_credite');
    expect(d.store.transactions()).toHaveLength(1);
  });

  it('même depositId confirmé en Promise.all concurrent → un seul crédit', async () => {
    const d = deps('COMPLETED');
    const r = await Promise.all(Array.from({ length: 8 }, () => confirmerDepot(ID, d)));
    expect(r.filter((x) => x.issue === 'credite')).toHaveLength(1);
    expect(r.filter((x) => x.issue === 'deja_credite')).toHaveLength(7);
    expect(d.store.transactions()).toHaveLength(1);
    coherent(d.store);
  });

  it('base en panne pendant le crédit → erreur propagée, AUCUN état « crédité sans crédit », un rejeu crédite', async () => {
    let panne = true;
    const store = creerStoreMemoire([attendu()], { echouerCredit: () => panne });
    const d = deps('COMPLETED', store);
    await expect(confirmerDepot(ID, d)).rejects.toThrow(/Panne/);
    expect(store.etat(ID)?.statut).toBe('en_attente');
    expect(store.transactions()).toHaveLength(0);
    coherent(store);
    panne = false;
    expect((await confirmerDepot(ID, d)).issue).toBe('credite');
    expect(store.transactions()).toHaveLength(1);
    coherent(store);
  });

  it('pannes intermittentes sous concurrence → jamais d’incohérence, au plus un crédit', async () => {
    let n = 0;
    const store = creerStoreMemoire([attendu()], { echouerCredit: () => (n++ % 2 === 0) });
    const d = deps('COMPLETED', store);
    await Promise.allSettled(Array.from({ length: 10 }, () => confirmerDepot(ID, d)));
    expect(store.transactions().length).toBeLessThanOrEqual(1);
    coherent(store);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('client — lireDepot (API v2)', () => {
  it('non-régression : {status:"FOUND", data:{status:"COMPLETED"}} → COMPLETED', async () => {
    fetchMock.mockResolvedValue(reponseJson({
      status: 'FOUND',
      data: { depositId: ID, status: 'COMPLETED', amount: '38645.00', currency: 'XOF', country: 'CIV' },
    }));
    const d = await lireDepot(ID);
    expect(d.trouve).toBe(true);
    if (d.trouve) {
      expect(d.statut).toBe('COMPLETED');
      expect(d.statut).not.toBe('FOUND');
      expect(d.montant).toBe('38645.00');
      expect(d.devise).toBe('XOF');
    }
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.sandbox.pawapay.io/v2/deposits/${ID}`);
  });

  it('{status:"NOT_FOUND"} → introuvable', async () => {
    fetchMock.mockResolvedValue(reponseJson({ status: 'NOT_FOUND' }));
    expect(await lireDepot(ID)).toEqual({ trouve: false, depositId: ID });
  });

  it('HTTP 500 ou panne réseau → erreur, jamais un verdict', async () => {
    fetchMock.mockResolvedValueOnce(reponseJson({}, 500));
    await expect(lireDepot(ID)).rejects.toThrow();
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(lireDepot(ID)).rejects.toThrow();
  });

  it('sans jeton → erreur, aucun appel', async () => {
    vi.stubEnv('PAWAPAY_API_TOKEN', '');
    await expect(lireDepot(ID)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('client — creerPagePaiement', () => {
  const args: ArgsPagePaiement = {
    depositId: ID,
    montant: '38645',
    devise: 'XOF',
    pays: 'CIV',
    motif: 'Studiio — pack 500 crédits',
    urlRetour: 'https://studiio.pro/dashboard/billing?pawapay=retour',
    telephone: '+225 07 00 00 00 00',
    metadata: [{ userId: 'user-1' }, { pack: 'large' }],
  };

  it('envoie le schéma v2 et renvoie redirectUrl', async () => {
    fetchMock.mockResolvedValue(reponseJson({ redirectUrl: 'https://sandbox.paywith.pawapay.io/?token=x' }));
    const r = await creerPagePaiement(args);
    expect(r.redirectUrl).toBe('https://sandbox.paywith.pawapay.io/?token=x');
    const corps = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corps).toMatchObject({
      depositId: ID,
      returnUrl: args.urlRetour,
      amountDetails: { amount: '38645', currency: 'XOF' },
      country: 'CIV',
      phoneNumber: '2250700000000',
      metadata: [{ userId: 'user-1' }, { pack: 'large' }],
    });
    expect(corps).not.toHaveProperty('amount');
  });

  it('INVALID_PHONE_NUMBER → une relance sans téléphone', async () => {
    fetchMock
      .mockResolvedValueOnce(reponseJson({ status: 'REJECTED', failureReason: { failureCode: 'INVALID_PHONE_NUMBER' } }))
      .mockResolvedValueOnce(reponseJson({ paymentPageUrl: 'https://paywith.pawapay.io/?token=y' }));
    const r = await creerPagePaiement(args);
    expect(r.redirectUrl).toBe('https://paywith.pawapay.io/?token=y');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second).not.toHaveProperty('phoneNumber');
    expect(second.amountDetails).toEqual({ amount: '38645', currency: 'XOF' });
  });

  it('failureReason avec HTTP 200 → refus', async () => {
    fetchMock.mockResolvedValue(reponseJson({ failureReason: { failureCode: 'AMOUNT_OUT_OF_BOUNDS' } }));
    await expect(creerPagePaiement(args)).rejects.toThrow(/AMOUNT_OUT_OF_BOUNDS/);
  });

  it('depositId non UUID → refus avant tout appel', async () => {
    await expect(creerPagePaiement({ ...args, depositId: 'commande-42' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('client — liste blanche des hôtes PawaPay', () => {
  it.each([
    'https://evil.example',
    'https://api.pawapay.io.evil.example',
    'http://api.pawapay.io',
    'https://user:pw@api.pawapay.io',
    'https://api.pawapay.io/proxy',
    'https://api.pawapay.io?x=1',
    'pas une url',
  ])('PAWAPAY_BASE_URL=%s → refusée, le jeton ne part jamais', async (base) => {
    vi.stubEnv('PAWAPAY_BASE_URL', base);
    await expect(lireDepot(ID)).rejects.toThrow(/PAWAPAY_BASE_URL refusée/);
    await expect(paysActifs()).rejects.toThrow(/PAWAPAY_BASE_URL refusée/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['https://api.pawapay.io', 'https://api.sandbox.pawapay.io/', 'https://API.PAWAPAY.IO'])(
    'PAWAPAY_BASE_URL=%s → acceptée', async (base) => {
      vi.stubEnv('PAWAPAY_BASE_URL', base);
      fetchMock.mockResolvedValue(reponseJson({ status: 'NOT_FOUND' }));
      await lireDepot(ID);
      expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/api(\.sandbox)?\.pawapay\.io\/v2\/deposits\//);
    },
  );

  it.each([
    'https://evil.example/?token=x',
    'https://pawapay.io.evil.example/',
    'http://paywith.pawapay.io/?token=x',
    'javascript:alert(1)',
  ])('redirectUrl %s → refusée', async (url) => {
    fetchMock.mockResolvedValue(reponseJson({ redirectUrl: url }));
    await expect(creerPagePaiement({
      depositId: ID, montant: '1', devise: 'XOF', urlRetour: 'https://studiio.pro/x',
    })).rejects.toThrow(/sans URL PawaPay valide/);
  });
});

describe('client — délai maximal sur chaque appel PawaPay', () => {
  it('chaque fetch porte un AbortSignal de délai (relecture, Payment Page, active-conf)', async () => {
    expect(DELAI_APPEL_PAWAPAY_MS).toBe(10_000);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/v2/active-conf')) return reponseJson({ countries: [] });
      if (url.endsWith('/v2/paymentpage')) return reponseJson({ redirectUrl: 'https://paywith.pawapay.io/?t=1' });
      return reponseJson({ status: 'NOT_FOUND' });
    });
    await lireDepot(ID);
    await creerPagePaiement({ depositId: ID, montant: '1', devise: 'XOF', urlRetour: 'https://studiio.pro/x' });
    await paysActifs();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal.aborted).toBe(false);
    }
  });

  it('délai dépassé (TimeoutError) → PawapayErreur, jamais un verdict', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(lireDepot(ID)).rejects.toBeInstanceOf(PawapayErreur);
    await expect(paysActifs()).rejects.toBeInstanceOf(PawapayErreur);
    await expect(creerPagePaiement({ depositId: ID, montant: '1', devise: 'XOF', urlRetour: 'https://studiio.pro/x' }))
      .rejects.toBeInstanceOf(PawapayErreur);
  });
});

describe('client — paysActifs', () => {
  it('lit /v2/active-conf et met en cache', async () => {
    fetchMock.mockImplementation(async () => reponseJson({
      countries: [
        { country: 'CIV', providers: [{ currencies: [{ currency: 'XOF' }] }, { currencies: [{ currency: 'XOF' }] }] },
        { country: 'BEN', providers: [{ currencies: [{ currency: 'XOF' }] }] },
      ],
    }));
    const a = await paysActifs(1000);
    const b = await paysActifs(2000);
    expect(a).toEqual([{ pays: 'BEN', devises: ['XOF'] }, { pays: 'CIV', devises: ['XOF'] }]);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await paysActifs(1000 + 6 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('tarifs — CHF canonique, taux passés en paramètre', () => {
  it('packs canoniques', () => {
    expect(PACKS_PAWAPAY.small).toMatchObject({ credits: 50, prixCentimesChf: 900 });
    expect(PACKS_PAWAPAY.medium).toMatchObject({ credits: 200, prixCentimesChf: 2900 });
    expect(PACKS_PAWAPAY.large).toMatchObject({ credits: 500, prixCentimesChf: 5900 });
    expect(PACKS_PAWAPAY.xlarge).toMatchObject({ credits: 2000, prixCentimesChf: 17900 });
  });

  it('convertit sans flottant, arrondi à l’unité supérieure', () => {
    expect(prixLocal('small', 'XOF', { XOF: '655' })).toBe('5895');
    expect(prixLocal('large', 'XOF', { XOF: '655.957' })).toBe('38702'); // 38701.463 → 38702
    expect(prixLocal('medium', 'GHS', { GHS: 16 })).toBe('464');
  });

  it('refuse une devise sans taux', () => {
    expect(() => prixLocal('small', 'XAF', { XOF: '655' })).toThrow(DeviseSansTauxErreur);
    expect(() => prixLocal('small', 'XOF', { XOF: '0' })).toThrow(DeviseSansTauxErreur);
    expect(() => prixLocal('small', 'XOF', { XOF: 'abc' })).toThrow(DeviseSansTauxErreur);
    expect(() => prixLocal('small', 'XOF', {})).toThrow(DeviseSansTauxErreur);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('route POST /api/pawapay/callback', () => {
  beforeEach(() => { vi.stubEnv('PAWAPAY_ENABLED', 'true'); });
  function requete(corps: unknown) {
    return new Request('http://localhost/api/pawapay/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });
  }

  it('store absent + PAWAPAY_ENABLED=true → 503', async () => {
    vi.stubEnv('PAWAPAY_ENABLED', 'true');
    const r = await POST(requete({ depositId: ID, status: 'COMPLETED' }));
    expect(r.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PawaPay désactivé → 404, même avec un store, sans relecture', async () => {
    vi.stubEnv('PAWAPAY_ENABLED', 'false');
    expect((await POST(requete({ depositId: ID, status: 'COMPLETED' }))).status).toBe(404);
    mocksStore.store = creerStoreMemoire([attendu()]);
    expect((await POST(requete({ depositId: ID, status: 'COMPLETED' }))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignore un « COMPLETED » dans le corps quand la relecture dit FAILED', async () => {
    const store = creerStoreMemoire([attendu()]);
    mocksStore.store = store;
    fetchMock.mockResolvedValue(reponseJson({
      status: 'FOUND',
      data: { depositId: ID, status: 'FAILED', amount: '38645', currency: 'XOF' },
    }));
    const r = await POST(requete({ depositId: ID, status: 'COMPLETED', amount: '38645', currency: 'XOF' }));
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('echec');
    expect(store.transactions()).toHaveLength(0);
    expect(store.etat(ID)?.statut).toBe('echec');
  });

  it('relecture COMPLETED → crédite une seule fois malgré deux callbacks', async () => {
    const store = creerStoreMemoire([attendu()]);
    mocksStore.store = store;
    fetchMock.mockImplementation(async () => reponseJson({
      status: 'FOUND',
      data: { depositId: ID, status: 'COMPLETED', amount: '38645.00', currency: 'XOF' },
    }));
    const [a, b] = await Promise.all([POST(requete({ depositId: ID })), POST(requete({ depositId: ID }))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(store.transactions()).toHaveLength(1);
  });

  it('relecture en échec → 5xx, jamais 200', async () => {
    mocksStore.store = creerStoreMemoire([attendu()]);
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const r = await POST(requete({ depositId: ID }));
    expect(r.status).toBeGreaterThanOrEqual(500);
    fetchMock.mockResolvedValue(reponseJson({}, 503));
    const r2 = await POST(requete({ depositId: ID }));
    expect(r2.status).toBeGreaterThanOrEqual(500);
  });

  it('dépôt pas encore final à la relecture → 503 (rejeu)', async () => {
    mocksStore.store = creerStoreMemoire([attendu()]);
    fetchMock.mockResolvedValue(reponseJson({ status: 'FOUND', data: { status: 'PROCESSING', amount: '1', currency: 'XOF' } }));
    expect((await POST(requete({ depositId: ID }))).status).toBe(503);
  });

  it('depositId absent ou invalide → 400', async () => {
    mocksStore.store = creerStoreMemoire([attendu()]);
    expect((await POST(requete({ status: 'COMPLETED' }))).status).toBe(400);
    expect((await POST(requete({ depositId: '../admin' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dépôt inconnu de Studiio → 200 ignoré, aucune relecture', async () => {
    mocksStore.store = creerStoreMemoire([attendu()]);
    const r = await POST(requete({ depositId: ID2 }));
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('inconnu_local');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('garde — Studiio est indépendant', () => {
  const racine = path.resolve(__dirname, '..');
  const fichiers = [
    ...readdirSync(path.join(racine, 'lib/payment/pawapay')).map((f) => path.join(racine, 'lib/payment/pawapay', f)),
    path.join(racine, 'app/api/pawapay/callback/route.ts'),
    path.join(racine, 'app/api/pawapay/deposit/route.ts'),
    path.join(racine, 'app/api/pawapay/status/[id]/route.ts'),
    path.join(racine, 'app/api/cron/pawapay-reconcile/route.ts'),
  ];

  it.each(fichiers.map((f) => [path.relative(racine, f), f]))('%s ne contient aucune URL afroboost', (_nom, f) => {
    const contenu = readFileSync(f, 'utf8');
    expect(contenu).not.toMatch(/https?:\/\/[^\s'"`)]*afroboost/i);
    expect(contenu).not.toMatch(/afroboost\.(com|ch|io)/i);
  });

  it('couvre au moins client, confirmation, tarifs, types, store et la route', () => {
    const noms = fichiers.map((f) => path.basename(f));
    for (const n of ['client.ts', 'confirmation.ts', 'tarifs.ts', 'types.ts', 'store.ts', 'route.ts']) {
      expect(noms).toContain(n);
    }
  });
});
