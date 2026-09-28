/**
 * `creerStorePostgrest` — correspondance contrat `DepotsStore` ↔ requêtes
 * PostgREST, sur un faux client qui ENREGISTRE les appels (aucun réseau).
 * Le comportement SQL lui-même est prouvé sur un vrai Postgres dans
 * `tests-pg/pawapay-deposits.pg.test.ts`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { creerStorePostgrest } from '@/lib/payment/pawapay/store-postgrest';

type Appel = [string, ...unknown[]];

function fauxClient(reponse: { data?: unknown; error?: unknown } = {}) {
  const appels: Appel[] = [];
  const resultat = { data: reponse.data ?? null, error: reponse.error ?? null };
  const chaine: Record<string, unknown> = {};
  for (const m of ['insert', 'select', 'update', 'eq', 'neq', 'lte', 'gte', 'order', 'limit', 'maybeSingle']) {
    chaine[m] = (...args: unknown[]) => { appels.push([m, ...args]); return chaine; };
  }
  chaine.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resultat).then(ok, ko);
  const client = {
    from: (t: string) => { appels.push(['from', t]); return chaine; },
    rpc: (nom: string, args: unknown) => { appels.push(['rpc', nom, args]); return Promise.resolve(resultat); },
  };
  return { client: client as unknown as SupabaseClient, appels };
}

const LIGNE = {
  deposit_id: 'd1', user_id: 'u1', pack: 'small', credits: 50, montant: '6500', devise: 'XOF',
  pays: 'CIV', statut: 'en_attente', cree_le: '2026-09-28T10:00:00+00:00', verifie_le: null,
};

describe('creerStorePostgrest', () => {
  it('enregistrer : colonnes du contrat + prix CHF du pack', async () => {
    const { client, appels } = fauxClient();
    await creerStorePostgrest(client).enregistrer({
      depositId: 'd1', userId: 'u1', pack: 'medium', credits: 200, montant: '19000', devise: 'XOF',
      pays: 'CIV', statut: 'en_attente', creeLe: '2026-09-28T10:00:00.000Z',
    });
    expect(appels[0]).toEqual(['from', 'pawapay_deposits']);
    expect(appels[1]).toEqual(['insert', {
      deposit_id: 'd1', user_id: 'u1', pack: 'medium', credits: 200, montant_chf_centimes: 2900,
      montant: '19000', devise: 'XOF', pays: 'CIV', statut: 'en_attente',
      cree_le: '2026-09-28T10:00:00.000Z', verifie_le: null,
    }]);
  });

  it('lire : ligne → DepotAttendu, horodatage ISO, montant relu en chaîne', async () => {
    const { client, appels } = fauxClient({ data: LIGNE });
    const d = await creerStorePostgrest(client).lire('d1');
    expect(appels).toContainEqual(['eq', 'deposit_id', 'd1']);
    expect(String(appels.find((a) => a[0] === 'select')?.[1])).toContain('montant::text');
    expect(d).toEqual({
      depositId: 'd1', userId: 'u1', pack: 'small', credits: 50, montant: '6500', devise: 'XOF',
      pays: 'CIV', statut: 'en_attente', creeLe: '2026-09-28T10:00:00.000Z', verifieLe: null,
    });
  });

  it('lire : absent → null', async () => {
    const { client } = fauxClient({ data: null });
    expect(await creerStorePostgrest(client).lire('x')).toBeNull();
  });

  it('listerEnAttente : bornes incluses, verifie_le NULLS FIRST puis cree_le, limite', async () => {
    const { client, appels } = fauxClient({ data: [LIGNE] });
    const r = await creerStorePostgrest(client).listerEnAttente({
      creeAvant: '2026-09-28T11:00:00.000Z', creeApres: '2026-09-27T11:00:00.000Z', limite: 20,
    });
    expect(r).toHaveLength(1);
    expect(appels).toContainEqual(['eq', 'statut', 'en_attente']);
    expect(appels).toContainEqual(['lte', 'cree_le', '2026-09-28T11:00:00.000Z']);
    expect(appels).toContainEqual(['gte', 'cree_le', '2026-09-27T11:00:00.000Z']);
    const ordres = appels.filter((a) => a[0] === 'order');
    expect(ordres).toEqual([
      ['order', 'verifie_le', { ascending: true, nullsFirst: true }],
      ['order', 'cree_le', { ascending: true }],
    ]);
    expect(appels).toContainEqual(['limit', 20]);
  });

  it('listerEnAttente : limite 0 → aucune requête', async () => {
    const { client, appels } = fauxClient();
    expect(await creerStorePostgrest(client).listerEnAttente({ creeAvant: 'x', limite: 0 })).toEqual([]);
    expect(appels).toHaveLength(0);
  });

  it('marquerEchec : sans effet sur un dépôt crédité (filtre statut ≠ credite)', async () => {
    const { client, appels } = fauxClient();
    await creerStorePostgrest(client).marquerEchec('d1');
    expect(appels).toContainEqual(['update', { statut: 'echec' }]);
    expect(appels).toContainEqual(['neq', 'statut', 'credite']);
  });

  it('noterVerification : met à jour verifie_le', async () => {
    const { client, appels } = fauxClient();
    await creerStorePostgrest(client).noterVerification('d1', '2026-09-28T12:00:00.000Z');
    expect(appels).toContainEqual(['update', { verifie_le: '2026-09-28T12:00:00.000Z' }]);
    expect(appels).toContainEqual(['eq', 'deposit_id', 'd1']);
  });

  it('crediterSiNonCredite : appelle la RPC avec les paramètres du contrat', async () => {
    const { client, appels } = fauxClient({ data: 'credite' });
    const r = await creerStorePostgrest(client).crediterSiNonCredite({
      depositId: 'd1', userId: 'u1', credits: 50, referenceId: 'pawapay:d1',
    });
    expect(r).toBe('credite');
    expect(appels).toEqual([['rpc', 'crediter_depot_pawapay', {
      p_deposit_id: 'd1', p_user_id: 'u1', p_credits: 50, p_reference: 'pawapay:d1',
    }]]);
  });

  it('crediterSiNonCredite : erreur ou réponse inattendue → lève', async () => {
    const dem = { depositId: 'd1', userId: 'u1', credits: 50, referenceId: 'pawapay:d1' };
    await expect(creerStorePostgrest(fauxClient({ error: { message: 'boom' } }).client)
      .crediterSiNonCredite(dem)).rejects.toThrow(/boom/);
    await expect(creerStorePostgrest(fauxClient({ data: 'autre' }).client)
      .crediterSiNonCredite(dem)).rejects.toThrow(/inattendue/);
  });

  it('toute erreur PostgREST remonte (enregistrer)', async () => {
    const { client } = fauxClient({ error: { code: '23505', message: 'duplicate key' } });
    await expect(creerStorePostgrest(client).enregistrer({
      depositId: 'd1', userId: 'u1', pack: 'small', credits: 50, montant: '1', devise: 'XOF',
      statut: 'en_attente', creeLe: 'x',
    })).rejects.toThrow(/duplicate key/);
  });
});

describe('obtenirStore — interrupteur', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('PAWAPAY_ENABLED absent : null (comportement inchangé)', async () => {
    vi.stubEnv('PAWAPAY_ENABLED', '');
    const { obtenirStore, obtenirDependances } = await import('@/lib/payment/pawapay/store');
    expect(obtenirStore()).toBeNull();
    expect(obtenirDependances()).toBeNull();
  });

  it('PAWAPAY_ENABLED="true" : un store PostgREST', async () => {
    vi.stubEnv('PAWAPAY_ENABLED', 'true');
    const { obtenirStore } = await import('@/lib/payment/pawapay/store');
    const s = obtenirStore();
    expect(s).not.toBeNull();
    expect(typeof s?.crediterSiNonCredite).toBe('function');
  });
});
