/**
 * Zernio fait foi sur l'état des comptes — reproduction de la production
 * (2026-10-08) : Facebook avait deux lignes après reconnexion, l'ancien
 * `accountId` (disconnected) et le nouveau (connected) ; la page affichait
 * « Reconnexion nécessaire ». Instagram restait « Connecté » alors que Zernio
 * refusait le compte (403 ACCOUNT_DISCONNECTED).
 *
 * Aucun appel réel : Zernio et la base sont simulés.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriverEtatReseau } from '@/lib/social/etatReseaux';

type Ligne = Record<string, any>;
const base: { zernio_accounts: Ligne[] } = { zernio_accounts: [] };
vi.mock('@/lib/db/supabase', () => {
  const chaine = (table: 'zernio_accounts') => {
    const filtres: Array<(l: Ligne) => boolean> = [];
    let maj: Ligne | null = null;
    const exec = () => {
      const lignes = base[table].filter((l) => filtres.every((f) => f(l)));
      if (maj) for (const l of lignes) Object.assign(l, maj);
      return { data: lignes.map((l) => ({ ...l })), error: null };
    };
    const b: any = {
      select: () => b,
      update: (v: Ligne) => { maj = v; return b; },
      upsert: (rows: Ligne[]) => {
        for (const r of rows) {
          const l = base[table].find((x) => x.account_id === r.account_id);
          if (l) Object.assign(l, r); else base[table].push({ ...r });
        }
        return Promise.resolve({ error: null });
      },
      eq: (c: string, v: unknown) => { filtres.push((l) => l[c] === v); return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
    };
    return b;
  };
  const client = { from: (t: 'zernio_accounts') => chaine(t) };
  return { supabaseAdmin: client, supabase: client };
});

let distants: Array<Record<string, unknown>> = [];
let santes: Record<string, unknown> = {};
let injoignable = false;
vi.mock('@/lib/social/zernio', () => ({
  zernioConfigured: () => true,
  isZernioPlatform: (p: unknown) => ['instagram', 'facebook', 'tiktok', 'youtube'].includes(String(p)),
  listAccounts: async () => { if (injoignable) throw new Error('Zernio injoignable'); return distants; },
  getAccountHealth: async (id: string) => { if (!(id in santes)) throw new Error('sante indisponible'); return santes[id]; },
}));

const OK = { status: 'healthy', tokenStatus: { valid: true }, permissions: { canPost: true, missingRequired: [] } };
const ligne = (platform: string, account_id: string, status = 'connected'): Ligne =>
  ({ user_id: 'u1', profile_id: 'p1', account_id, platform, username: platform, status });

async function synchro() {
  const m = await import('@/lib/social/synchroComptesZernio');
  m._oublierSynchro();
  return m.synchroniserComptesZernio('u1', 'p1');
}
const statut = (id: string) => base.zernio_accounts.find((l) => l.account_id === id)?.status;

beforeEach(() => {
  injoignable = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  base.zernio_accounts = [
    ligne('tiktok', 'TT'), ligne('youtube', 'YT'), ligne('instagram', 'IG'),
    ligne('facebook', 'FB-ANCIEN', 'disconnected'), ligne('facebook', 'FB-NOUVEAU'),
  ];
  distants = [
    { _id: 'TT', platform: 'tiktok', username: 'tt', isActive: true },
    { _id: 'YT', platform: 'youtube', username: 'yt', isActive: true },
    { _id: 'IG', platform: 'instagram', username: 'ig', isActive: true },
    { _id: 'FB-NOUVEAU', platform: 'facebook', username: 'fb', isActive: true },
  ];
  santes = { TT: OK, YT: OK, IG: OK, 'FB-NOUVEAU': OK };
});

describe('reconnexion : nouvel accountId', () => {
  it('le nouveau Facebook est connecté, l’ancien reste déconnecté et n’est jamais ciblé', async () => {
    const r = await synchro();
    expect(r.ok).toBe(true);
    expect(statut('FB-NOUVEAU')).toBe('connected');
    expect(statut('FB-ANCIEN')).toBe('disconnected');
  });
  it('une ligne CONNECTÉE que Zernio ne rend plus passe déconnectée', async () => {
    base.zernio_accounts.push(ligne('instagram', 'IG-OBSOLETE'));
    await synchro();
    expect(statut('IG-OBSOLETE')).toBe('disconnected');
    expect(statut('IG')).toBe('connected');
  });
  it('un compte actif sur Zernio mais ABSENT de la base n’est PAS ajouté (seul le retour de connexion enregistre)', async () => {
    base.zernio_accounts = base.zernio_accounts.filter((l) => l.account_id !== 'FB-NOUVEAU');
    await synchro();
    expect(statut('FB-NOUVEAU')).toBeUndefined();
  });
});

describe('« Déconnecter » dans Studiio est respecté', () => {
  it('compte déconnecté par l’utilisateur, toujours actif chez Zernio : RESTE déconnecté', async () => {
    base.zernio_accounts.find((l) => l.account_id === 'TT')!.status = 'disconnected';
    await synchro();
    expect(statut('TT')).toBe('disconnected');
  });
});

describe('santé : jamais « Connecté » si Zernio dit le contraire', () => {
  it.each([
    ['jeton expiré', { _id: 'IG', isActive: true }, { ...OK, tokenStatus: { valid: false } }],
    ['canPost=false', { _id: 'IG', isActive: true }, { ...OK, permissions: { canPost: false, missingRequired: ['instagram_content_publish'] } }],
    ['isActive=false', { _id: 'IG', isActive: false }, OK],
  ])('%s → disconnected', async (_cas, compte, sante) => {
    distants = distants.map((d) => (d._id === 'IG' ? { ...d, ...compte } : d));
    santes.IG = sante;
    await synchro();
    expect(statut('IG')).toBe('disconnected');
    expect(statut('TT')).toBe('connected');
  });
  it('santé illisible : seul isActive décide (pas de déconnexion à tort)', async () => {
    delete santes.IG;
    await synchro();
    expect(statut('IG')).toBe('connected');
  });
  it('Zernio injoignable : la base n’est pas touchée', async () => {
    injoignable = true;
    const avant = JSON.stringify(base.zernio_accounts);
    const r = await synchro();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(base.zernio_accounts)).toBe(avant);
  });
});

describe('page Réseaux : le compte connecté gagne', () => {
  it('ancien Facebook déconnecté AVANT le nouveau connecté → « connecté »', () => {
    const e = deriverEtatReseau('facebook', undefined, {
      autorise: true,
      comptes: [
        { accountId: 'FB-ANCIEN', platform: 'facebook', username: 'Afroboost', status: 'disconnected' },
        { accountId: 'FB-NOUVEAU', platform: 'facebook', username: 'Afroboost', status: 'connected' },
      ],
    } as never);
    expect(e.etat).toBe('connecte');
  });
  it('seulement l’ancien, déconnecté → « reconnexion »', () => {
    const e = deriverEtatReseau('facebook', undefined, {
      autorise: true,
      comptes: [{ accountId: 'FB-ANCIEN', platform: 'facebook', username: 'Afroboost', status: 'disconnected' }],
    } as never);
    expect(e.etat).toBe('reconnexion');
  });
});
