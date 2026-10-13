/**
 * SANTÉ DES FOURNISSEURS — lecture du solde, classement, alertes admin,
 * recharges constatées et plafonds, bail anti-concurrence, et l'écriture des
 * alertes de service (qui échouait en silence depuis toujours).
 *
 * Aucun appel réseau : `fetch` est une doublure ; les réponses reprennent les
 * champs DOCUMENTÉS (HeyGen `GET /v3/users/me`, D-ID `GET /credits`,
 * ElevenLabs `GET /v1/user/subscription`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fausseBase } from './helpers/fausse-base';

vi.mock('@/lib/db/supabase', async () => ({ supabaseAdmin: (await import('./helpers/fausse-base')).fausseBase.supabaseAdmin }));
vi.mock('@/lib/email/resend', () => ({ sendEmailSilent: () => {} }));

import {
  lireSolde, evaluerStatut, majEtatDepuisSolde, signalerRefusDeSolde, sousBail, fournisseurDisponible,
  CONFIG_PAR_DEFAUT, assainirConfig, estRefusDeSolde, lireEtats, magasinAppSettings, _reinitialiserSante,
  type Magasin,
} from '@/lib/fournisseurs/sante';
import { reportServiceAlert, getAllAlerts, getActiveAlerts, alertesDepuisValeur } from '@/lib/service-alerts';
import { mapHeyGenFailure, CODE_SOLDE_FOURNISSEUR } from '@/lib/avatar/heygen';
import { economieParMois } from '@/lib/fournisseurs/economie';

const env = { HEYGEN_API_KEY: 'h', DID_API_KEY: 'd', ELEVENLABS_API_KEY: 'e' } as unknown as NodeJS.ProcessEnv;
const reponse = (corps: unknown, status = 200) => async () => new Response(JSON.stringify(corps), { status });
const wallet = (solde: number, auto = true) => ({ data: { billing_type: 'wallet', wallet: { currency: 'usd', remaining_balance: solde, auto_reload: { enabled: auto, threshold_usd: 10, amount_usd: 30 } } } });

function magasinMemoire(): Magasin & { donnees: Map<string, unknown> } {
  const donnees = new Map<string, unknown>();
  return {
    donnees,
    lire: async <T,>(k: string) => (donnees.has(k) ? (structuredClone(donnees.get(k)) as T) : null),
    ecrire: async (k, v) => { donnees.set(k, structuredClone(v)); },
    creerSiAbsente: async (k, v) => { if (donnees.has(k)) return false; donnees.set(k, structuredClone(v)); return true; },
    supprimer: async (k) => { donnees.delete(k); },
  };
}

beforeEach(() => { fausseBase.vider(); _reinitialiserSante(); });

describe('lecture du solde — champs documentés seulement', () => {
  it('HeyGen wallet : solde USD et auto-reload lus', async () => {
    const l = await lireSolde('heygen', { env, fetch: reponse(wallet(42.5)) as typeof fetch });
    expect(l).toEqual({ solde: 42.5, devise: 'usd', autoReload: { active: true, seuil: 10, montant: 30 } });
  });
  it('D-ID `remaining`, ElevenLabs quota de caractères', async () => {
    expect(await lireSolde('did', { env, fetch: reponse({ remaining: 12, total: 40 }) as typeof fetch })).toMatchObject({ solde: 12, devise: 'crédits' });
    expect(await lireSolde('elevenlabs', { env, fetch: reponse({ character_count: 70_000, character_limit: 100_000 }) as typeof fetch })).toMatchObject({ solde: 30_000, devise: 'caractères' });
  });
  it('D-ID : même en-tête d’authentification que le client officiel (clé user:secret en base64)', async () => {
    let entete = '';
    const f = (async (_u: string, init?: RequestInit) => { entete = String((init?.headers as Record<string, string>).Authorization); return new Response(JSON.stringify({ remaining: 1 }), { status: 200 }); }) as typeof fetch;
    await lireSolde('did', { env: { DID_API_KEY: 'moi@x.com:secret' } as unknown as NodeJS.ProcessEnv, fetch: f });
    expect(entete).toBe(`Basic ${Buffer.from('moi@x.com:secret').toString('base64')}`);
  });
  it('Replicate : aucune API de solde — null, jamais une valeur inventée ; clé absente : null', async () => {
    const f = vi.fn();
    expect(await lireSolde('replicate', { env, fetch: f as unknown as typeof fetch })).toBeNull();
    expect(await lireSolde('heygen', { env: {} as NodeJS.ProcessEnv, fetch: f as unknown as typeof fetch })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('HTTP en erreur : lève (une panne de lecture n’est pas un solde nul)', async () => {
    await expect(lireSolde('heygen', { env, fetch: reponse({}, 500) as typeof fetch })).rejects.toThrow(/HTTP 500/);
  });
});

describe('classement et refus', () => {
  it('seuils', () => {
    const c = CONFIG_PAR_DEFAUT.heygen;
    expect(evaluerStatut(null, c)).toBe('inconnu');
    expect(evaluerStatut(0, c)).toBe('bloque');
    expect(evaluerStatut(5, c)).toBe('critique');
    expect(evaluerStatut(20, c)).toBe('faible');
    expect(evaluerStatut(100, c)).toBe('operationnel');
  });
  it('le refus réel de production est classé « solde fournisseur »', () => {
    expect(estRefusDeSolde("Insufficient credit. This operation requires 'api' credits.")).toBe(true);
    expect(estRefusDeSolde('', 402)).toBe(true);
    expect(estRefusDeSolde('avatar not found', 404)).toBe(false);
    const e = mapHeyGenFailure(400, { error: { message: "Insufficient credit. This operation requires 'api' credits." } });
    expect(e.code).toBe(CODE_SOLDE_FOURNISSEUR);
    expect(mapHeyGenFailure(400, { error: { message: 'bad avatar' } }).code).not.toBe(CODE_SOLDE_FOURNISSEUR);
  });
  it('plafonds bornés : pas de négatif, pas d’infini', () => {
    const c = assainirConfig({ seuilBas: -5, maxRechargesJour: 1e9, seuilCritique: 999 }, 'heygen');
    expect(c.seuilBas).toBe(CONFIG_PAR_DEFAUT.heygen.seuilBas);
    expect(c.maxRechargesJour).toBe(50);
    expect(c.seuilCritique).toBeLessThanOrEqual(c.seuilBas);
  });
});

describe('alertes admin', () => {
  const alertes: Array<[string, string]> = [];
  const alerter = async (_id: string, s: string, m: string) => { alertes.push([s, m]); };
  beforeEach(() => { alertes.length = 0; });

  it('INFO « 30 $ ajoutés automatiquement » quand le solde remonte', async () => {
    const m = magasinMemoire();
    await majEtatDepuisSolde('heygen', { magasin: m, alerter, env, fetch: reponse(wallet(40)) as typeof fetch });
    await majEtatDepuisSolde('heygen', { magasin: m, alerter, env, fetch: reponse(wallet(70)) as typeof fetch });
    expect(alertes).toContainEqual(['info', 'HeyGen : 30 $ ajoutés automatiquement.']);
    const e = (await lireEtats(m)).heygen;
    expect(e.derniereRechargeMontant).toBe(30);
    expect(e.rechargesJour.n).toBe(1);
  });
  it('WARNING solde faible ; CRITICAL recharge impossible si l’auto-reload est coupé', async () => {
    await majEtatDepuisSolde('heygen', { magasin: magasinMemoire(), alerter, env, fetch: reponse(wallet(20)) as typeof fetch });
    expect(alertes).toContainEqual(['warning', 'HeyGen : solde fournisseur faible.']);
    alertes.length = 0;
    await majEtatDepuisSolde('heygen', { magasin: magasinMemoire(), alerter, env, fetch: reponse(wallet(3, false)) as typeof fetch });
    expect(alertes).toContainEqual(['critical', 'HeyGen : recharge automatique impossible.']);
  });
  it('recharges au-delà du plafond du jour → CRITICAL (boucle de recharge visible)', async () => {
    const m = magasinMemoire();
    let solde = 10;
    for (let i = 0; i < 5; i += 1) {
      await majEtatDepuisSolde('heygen', { magasin: m, alerter, env, fetch: reponse(wallet(solde)) as typeof fetch });
      solde += 30;
    }
    expect(alertes.filter(([s]) => s === 'info')).toHaveLength(4);
    expect(alertes).toContainEqual(['critical', 'HeyGen : recharges automatiques anormalement fréquentes.']);
  });
  it('CRITICAL « fournisseur bloqué — génération mise en attente » sur un refus', async () => {
    const m = magasinMemoire();
    await signalerRefusDeSolde('heygen', 'Insufficient credit.', { magasin: m, alerter });
    expect(alertes).toEqual([['critical', 'HeyGen : fournisseur bloqué — génération mise en attente.']]);
    expect((await lireEtats(m)).heygen).toMatchObject({ statut: 'bloque', derniereErreur: 'Insufficient credit.' });
  });
});

describe('pré-vérification et concurrence', () => {
  it('jamais bloqué : aucune lecture réseau', async () => {
    const f = vi.fn();
    expect(await fournisseurDisponible('heygen', { magasin: magasinMemoire(), env, fetch: f as unknown as typeof fetch })).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
  it('bloqué puis rechargé : disponible ; toujours vide : indisponible', async () => {
    const m = magasinMemoire();
    await signalerRefusDeSolde('heygen', 'x', { magasin: m, alerter: async () => {} });
    expect(await fournisseurDisponible('heygen', { magasin: m, alerter: async () => {}, env, fetch: reponse(wallet(0)) as typeof fetch })).toBe(false);
    expect(await fournisseurDisponible('heygen', { magasin: m, alerter: async () => {}, env, fetch: reponse(wallet(80)) as typeof fetch })).toBe(true);
  });
  it('bail : deux instances simultanées → une seule exécution ; bail périmé repris', async () => {
    const m = magasinMemoire();
    let n = 0;
    let liberer!: () => void;
    const attente = new Promise<void>((r) => { liberer = r; });
    const a = sousBail('heygen', async () => { n += 1; await attente; return 'a'; }, m);
    const b = await sousBail('heygen', async () => { n += 1; return 'b'; }, m);
    expect(b).toBeNull();
    liberer();
    expect(await a).toBe('a');
    expect(n).toBe(1);
    await m.ecrire('provider_lock:heygen', { jeton: 'mort', expireLe: 0 });
    expect(await sousBail('heygen', async () => 'repris', m)).toBe('repris');
  });
});

describe('alertes de service : enfin écrites (app_settings n’a ni id ni created_at)', () => {
  it('une alerte est persistée puis relue, sans doublon dans l’heure', async () => {
    await reportServiceAlert('heygen', 'critical', 'HeyGen : fournisseur bloqué — génération mise en attente.');
    await reportServiceAlert('heygen', 'critical', 'HeyGen : fournisseur bloqué — génération mise en attente.');
    await reportServiceAlert('heygen', 'info', 'HeyGen : 30 $ ajoutés automatiquement.');
    const lignes = fausseBase.table('app_settings');
    expect(lignes).toHaveLength(1);
    expect(Object.keys(lignes[0]).sort()).toEqual(['key', 'updated_at', 'value']);
    expect((await getAllAlerts()).map((a) => a.severity)).toEqual(['info', 'critical']);
  });
  it('PRODUCTION : la valeur revient en CHAÎNE JSON — relue en tableau, sans plantage ni découpage en caractères', async () => {
    const existante = { id: 'heygen-1', service: 'heygen', severity: 'warning', message: 'HeyGen : solde fournisseur faible.', timestamp: new Date().toISOString(), dismissed: false };
    fausseBase.table('app_settings').push({ key: 'service_alerts', value: JSON.stringify([existante]) });
    expect(await getActiveAlerts()).toEqual([existante]);
    await reportServiceAlert('heygen', 'critical', 'HeyGen : fournisseur bloqué — génération mise en attente.');
    const relues = await getAllAlerts();
    expect(relues.map((a) => a.severity)).toEqual(['critical', 'warning']);
    expect(relues.every((a) => typeof a === 'object' && typeof a.id === 'string')).toBe(true);
  });
  it('valeur illisible ou entrées parasites : écartées, jamais une exception', () => {
    expect(alertesDepuisValeur('{pas du json')).toEqual([]);
    expect(alertesDepuisValeur('"texte"')).toEqual([]);
    expect(alertesDepuisValeur(['[', 'x', null, 3])).toEqual([]);
    expect(alertesDepuisValeur(null)).toEqual([]);
  });
  it('le magasin `app_settings` du module santé relit aussi une valeur écrite en chaîne JSON', async () => {
    fausseBase.table('app_settings').push({ key: 'provider_billing_config', value: JSON.stringify({ heygen: { seuilBas: 77 } }) });
    expect((await magasinAppSettings.lire<{ heygen: { seuilBas: number } }>('provider_billing_config'))?.heygen.seuilBas).toBe(77);
  });
});

describe('économie — un coût non mesuré n’est jamais 0', () => {
  it('agrège par mois et par fournisseur', () => {
    const e = economieParMois([
      { provider: 'heygen', provider_cost_eur: 1.2, studiio_price_eur: 4, created_at: '2026-10-02T10:00:00Z' },
      { provider: 'heygen', provider_cost_eur: 0.8, studiio_price_eur: 4, created_at: '2026-10-05T10:00:00Z' },
      { provider: 'heygen', provider_cost_eur: null, studiio_price_eur: null, created_at: '2026-10-06T10:00:00Z' },
      { provider: 'did', provider_cost_eur: null, created_at: '2026-09-06T10:00:00Z' },
    ]);
    expect(e[0]).toMatchObject({ mois: '2026-10', generations: 3, coutFournisseurEur: 2, coutMoyenVideoEur: 1, prixStudiioEur: 8, margeBruteEur: 6, nonMesurees: 1 });
    expect(e[1]).toMatchObject({ mois: '2026-09', coutFournisseurEur: null, margeBruteEur: null, nonMesurees: 1 });
  });
});
