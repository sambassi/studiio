// @vitest-environment node
/**
 * PawaPay — taux FIXES lus dans `PAWAPAY_RATES`, calcul côté serveur.
 *
 * Toutes les valeurs de taux ici sont FICTIVES (123, 123.457…) : aucun taux
 * réel n'apparaît dans le dépôt. Aucun appel réseau : `fetch` est une
 * doublure qui ne connaît que l'API PawaPay.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { creerStoreMemoire } from '@/lib/payment/pawapay/confirmation';
import { DeviseSansTauxErreur, analyserTauxChf, prixLocal } from '@/lib/payment/pawapay/tarifs';

// Store réel (obtenirTauxChf lit vraiment l'environnement) ; seule la
// persistance est remplacée, puisqu'elle n'existe pas encore.
const etat = vi.hoisted(() => ({ deps: null as unknown, session: null as null | { user: { id: string } } }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => etat.session }));
vi.mock('@/lib/payment/pawapay/store', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/payment/pawapay/store')>();
  return { ...reel, obtenirDependances: () => etat.deps };
});

import { obtenirTauxChf } from '@/lib/payment/pawapay/store';
import { POST as initier } from '@/app/api/pawapay/deposit/route';
import { viderCachePays } from '@/lib/payment/pawapay/client';

const API = 'https://api.sandbox.pawapay.io';
let pages: Array<Record<string, unknown>>;
const fetchPawapay = vi.fn(async (entree: unknown, init?: RequestInit) => {
  const url = String(entree);
  if (url === `${API}/v2/active-conf`) {
    return new Response(JSON.stringify({ countries: [
      { country: 'CIV', providers: [{ currencies: [{ currency: 'XOF' }] }] },
      { country: 'CMR', providers: [{ currencies: [{ currency: 'XAF' }] }] },
      { country: 'GHA', providers: [{ currencies: [{ currency: 'GHS' }] }] },
    ] }), { status: 200 });
  }
  if (url === `${API}/v2/paymentpage`) {
    pages.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ redirectUrl: 'https://sandbox.paywith.pawapay.io/?token=t' }), { status: 200 });
  }
  throw new Error(`URL inattendue : ${url}`);
});

let erreurs: ReturnType<typeof vi.spyOn>;
let avertissements: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  pages = [];
  fetchPawapay.mockClear();
  vi.stubGlobal('fetch', fetchPawapay);
  vi.stubEnv('PAWAPAY_API_TOKEN', 'jeton-de-test');
  vi.stubEnv('PAWAPAY_BASE_URL', API);
  vi.stubEnv('NEXTAUTH_URL', 'https://studiio.pro');
  vi.stubEnv('PAWAPAY_ENABLED', 'true');
  etat.session = { user: { id: 'alice' } };
  etat.deps = null;
  viderCachePays();
  erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
  avertissements = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function journaux(): string {
  return [...erreurs.mock.calls, ...avertissements.mock.calls].flat().map(String).join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
describe('obtenirTauxChf — lecture stricte de PAWAPAY_RATES', () => {
  it('XOF et XAF disponibles', async () => {
    vi.stubEnv('PAWAPAY_RATES', '{"XOF":123,"XAF":"123.457"}');
    const taux = await obtenirTauxChf();
    expect(taux).toEqual({ XOF: 123, XAF: '123.457' });
    expect(prixLocal('small', 'XOF', taux!)).toBe('1107');
    expect(prixLocal('small', 'XAF', taux!)).toBe('1112'); // 1111,113 → 1112
  });

  it('devise inconnue ou taux manquant → devise indisponible', async () => {
    vi.stubEnv('PAWAPAY_RATES', '{"XOF":123}');
    const taux = (await obtenirTauxChf())!;
    expect(() => prixLocal('small', 'XAF', taux)).toThrow(DeviseSansTauxErreur); // taux manquant
    expect(() => prixLocal('small', 'ZZZ', taux)).toThrow(DeviseSansTauxErreur); // devise inconnue
  });

  it('variable absente ou vide → null, sans bruit', async () => {
    vi.stubEnv('PAWAPAY_RATES', '');
    expect(await obtenirTauxChf()).toBeNull();
    expect(erreurs).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON invalide', '{"XOF":123,', 'json_invalide'],
    ['tableau', '[123]', 'pas_un_objet'],
    ['nombre', '123', 'pas_un_objet'],
    ['null', 'null', 'pas_un_objet'],
  ])('%s → configuration refusée en bloc, valeur jamais journalisée', async (_n, brut, erreur) => {
    vi.stubEnv('PAWAPAY_RATES', brut);
    expect(await obtenirTauxChf()).toBeNull();
    expect(analyserTauxChf(brut).erreur).toBe(erreur);
    expect(journaux()).toContain(erreur);
    expect(journaux()).not.toContain(brut);
  });

  it.each([
    ['négatif', -123],
    ['zéro', 0],
    ['zéro en chaîne', '0'],
    ['NaN en chaîne', 'NaN'],
    ['Infinity en chaîne', 'Infinity'],
    ['-Infinity en chaîne', '-Infinity'],
    ['non numérique', 'abc'],
    ['notation exponentielle', '1e3'],
    ['booléen', true],
    ['null', null],
    ['objet', { v: 123 }],
  ])('taux %s → CETTE devise est refusée, les autres restent', async (_n, valeur) => {
    const brut = JSON.stringify({ XOF: valeur, XAF: 123 });
    vi.stubEnv('PAWAPAY_RATES', brut);
    const taux = await obtenirTauxChf();
    expect(taux).toEqual({ XAF: 123 });
    expect(() => prixLocal('small', 'XOF', taux!)).toThrow(DeviseSansTauxErreur);
    expect(journaux()).toContain('XOF');
    expect(journaux()).not.toContain(brut);
  });

  it('aucune devise valide → configuration refusée en bloc', async () => {
    vi.stubEnv('PAWAPAY_RATES', '{"XOF":-1,"XAF":"NaN"}');
    expect(await obtenirTauxChf()).toBeNull();
    expect(analyserTauxChf('{"XOF":-1,"XAF":"NaN"}').erreur).toBe('aucun_taux_valide');
  });

  it('clés normalisées en majuscules, limitées aux codes ISO à 3 lettres', () => {
    const a = analyserTauxChf('{"xof":123," xaf ":123,"CFA-F":1,"EURO":1,"X1F":1}');
    expect(a.taux).toEqual({ XOF: 123, XAF: 123 });
    expect(a.clesIgnorees).toBe(3);
  });

  it('clé en double après normalisation → ambiguë, devise écartée', () => {
    const a = analyserTauxChf('{"xof":123,"XOF":124,"XAF":123}');
    expect(a.taux).toEqual({ XAF: 123 });
    expect(a.devisesRefusees).toEqual(['XOF']);
  });
});

describe('calcul CHF → devise locale (arrondi à l’unité supérieure)', () => {
  const taux = { XOF: 123, XAF: '123.457', GHS: '1.5' };
  it.each([
    ['small', 'XOF', '1107'], //   9 × 123      = 1107 (exact)
    ['medium', 'XOF', '3567'], //  29 × 123     = 3567
    ['large', 'XOF', '7257'], //   59 × 123     = 7257
    ['xlarge', 'XOF', '22017'], // 179 × 123    = 22017
    ['large', 'XAF', '7284'], //   59 × 123.457 = 7283,963 → 7284
  ] as const)('%s en %s', (pack, devise, attendu) => {
    expect(prixLocal(pack, devise, taux)).toBe(attendu);
  });

  it('un résultat déjà entier n’est pas arrondi ; une fraction l’est au supérieur', () => {
    expect(prixLocal('small', 'GHS', taux)).toBe('14'); // 13,5 → 14
    expect(prixLocal('medium', 'GHS', taux)).toBe('44'); // 43,5 → 44
    expect(prixLocal('large', 'GHS', { GHS: '2' })).toBe('118'); // 118 exact
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('route deposit — le client ne peut rien falsifier', () => {
  function brancher() {
    const store = creerStoreMemoire();
    etat.deps = { store };
    return store;
  }
  const req = (corps: unknown) => new Request('http://localhost/api/pawapay/deposit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
  });

  it('montant, prix et taux envoyés par le client sont ignorés', async () => {
    vi.stubEnv('PAWAPAY_RATES', '{"XOF":123}');
    const store = brancher();
    const r = await initier(req({
      pack: 'large', pays: 'CIV',
      montant: '1', prix: 1, amount: '1', amountDetails: { amount: '1', currency: 'XOF' },
      taux: { XOF: 1 }, rates: { XOF: 1 },
    }));
    expect(r.status).toBe(200);
    const corps = await r.json();
    expect(corps.montant).toBe('7257');
    expect(pages[0].amountDetails).toEqual({ amount: '7257', currency: 'XOF' });
    expect(store.etat(corps.depositId)?.montant).toBe('7257');
  });

  it('les crédits envoyés par le client sont ignorés', async () => {
    vi.stubEnv('PAWAPAY_RATES', '{"XOF":123}');
    const store = brancher();
    const r = await initier(req({ pack: 'small', pays: 'CIV', credits: 999999, pack_credits: 999999 }));
    const corps = await r.json();
    expect(corps.credits).toBe(50);
    expect(store.etat(corps.depositId)?.credits).toBe(50);
  });

  it('XAF disponible via PAWAPAY_RATES', async () => {
    vi.stubEnv('PAWAPAY_RATES', '{"XOF":123,"XAF":123}');
    brancher();
    const r = await initier(req({ pack: 'small', pays: 'CMR' }));
    expect(await r.json()).toMatchObject({ montant: '1107', devise: 'XAF' });
  });

  it('pays ouvert mais devise sans taux → 400, aucune page de paiement', async () => {
    vi.stubEnv('PAWAPAY_RATES', '{"XOF":123}');
    brancher();
    expect((await initier(req({ pack: 'small', pays: 'GHA' }))).status).toBe(400);
    expect(pages).toHaveLength(0);
  });

  it('PAWAPAY_RATES invalide → 503, sans appeler PawaPay', async () => {
    vi.stubEnv('PAWAPAY_RATES', 'pas du json');
    brancher();
    expect((await initier(req({ pack: 'small', pays: 'CIV' }))).status).toBe(503);
    expect(fetchPawapay).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('gardes', () => {
  const racine = path.resolve(__dirname, '..');
  const lib = path.join(racine, 'lib/payment/pawapay');

  it('aucune API de taux : tarifs.ts et store.ts ne font aucun appel réseau', () => {
    for (const f of ['tarifs.ts', 'store.ts']) {
      const code = readFileSync(path.join(lib, f), 'utf8');
      expect(code, f).not.toMatch(/\bfetch\s*\(/);
      expect(code, f).not.toMatch(/https?:\/\//);
      expect(code, f).not.toMatch(/axios|XMLHttpRequest|node:https?|from ['"]https?['"]/);
    }
  });

  it('le code PawaPay ne cite aucun autre domaine que pawapay.io', () => {
    for (const f of readdirSync(lib)) {
      const code = readFileSync(path.join(lib, f), 'utf8');
      for (const [url] of code.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
        expect(new URL(url).hostname, `${f} : ${url}`).toMatch(/(^|\.)pawapay\.io$/);
      }
    }
  });

  it('aucun composant client n’importe le code PawaPay (tarifs, store…)', () => {
    const fautifs: string[] = [];
    const parcourir = (dir: string) => {
      for (const nom of readdirSync(dir)) {
        const p = path.join(dir, nom);
        if (statSync(p).isDirectory()) { if (nom !== '__tests__') parcourir(p); continue; }
        if (!/\.(tsx?|jsx?)$/.test(nom)) continue;
        const code = readFileSync(p, 'utf8');
        if (/^\s*['"]use client['"]/m.test(code) && /payment\/pawapay/.test(code)) fautifs.push(path.relative(racine, p));
      }
    };
    parcourir(racine);
    expect(fautifs).toEqual([]);
  });
});
