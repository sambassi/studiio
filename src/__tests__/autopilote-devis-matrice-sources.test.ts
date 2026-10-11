// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PreparedPost } from '@/lib/autopilot/engine';

/**
 * MATRICE DE PRIX MULTI-SOURCES — GET (devis) = POST (contrôle) = débit réel simulé.
 *
 * Le débit passe par le VRAI `deductCredits` (exemption admin comprise) ; seul
 * l'appel SQL atomique (`debiterOperationAtomique`, la RPC) est doublé et
 * compté. La génération du jumeau débite `avatar.jumeau` par ce même
 * `deductCredits` (cf. `moteur-jumeau.ts`, verrouillé par
 * `autopilote-avatar-devis.test.ts`) : on la rejoue à l'identique.
 *
 * ⚠️ AUCUN FOURNISSEUR, AUCUN RÉSEAU : `fetch` ne répond qu'aux HEAD des
 * médias stock autorisés (200), lève sinon.
 */

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

let configEnBase: Record<string, unknown> | null;
let utilisateur: Record<string, unknown>;
let posts: Array<Record<string, unknown>>;

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const chaine: Record<string, unknown> = {};
    const self = () => chaine;
    Object.assign(chaine, {
      select: self, eq: self, order: self, in: self,
      async limit() {
        if (table === 'autopilot_config') return { data: configEnBase ? [configEnBase] : [], error: null };
        if (table === 'scheduled_posts') return { data: posts, error: null };
        return { data: [], error: null };
      },
      async single() { return table === 'users' ? { data: utilisateur, error: null } : { data: null, error: null }; },
      async maybeSingle() { return table === 'users' ? { data: utilisateur, error: null } : { data: null, error: null }; },
      insert(row: Record<string, unknown>) {
        posts.push({ ...row, id: `p${posts.length + 1}` });
        return { async select() { return { data: [{ id: `p${posts.length}` }], error: null }; } };
      },
      then(onOk: (v: unknown) => unknown) {
        return Promise.resolve({ data: table === 'scheduled_posts' ? posts : [], error: null }).then(onOk);
      },
    });
    return chaine;
  };
  return { supabaseAdmin: { from }, supabase: { from } };
});

/** Grille volontairement différente des défauts : les prix viennent d'elle. */
const GRILLE: Record<string, number> = { 'render.reel': 12, 'avatar.jumeau': 33, 'autopilot.poster_reference': 7 };
vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: async (k: string) => GRILLE[k] ?? 0 }));

/** LA RPC de débit : comptée, jamais exécutée. */
const rpcDebit = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock('@/lib/credits/atomique', async (orig) => {
  const actual = await orig<typeof import('@/lib/credits/atomique')>();
  return { ...actual, debiterOperationAtomique: (...a: unknown[]) => rpcDebit(...a) };
});

const renderAndUpload = vi.fn(async (..._a: unknown[]) => ({ videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 }));
vi.mock('@/lib/autopilot/render', () => ({ renderAndUpload: (...a: unknown[]) => renderAndUpload(...a) }));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async (u: string) => (u.includes('jumeau') ? 20 : 8),
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: (urls: string[]) => urls[0] ?? null,
}));
vi.mock('@/lib/ai/affiche-reference', () => ({ genererAfficheReference: async () => ({ ok: true, url: 'https://cdn.test/affiche-ia.jpg' }) }));
vi.mock('@/lib/autopilot/voice', async (orig) => {
  const actual = await orig<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: async () => ({}) };
});
vi.mock('@/lib/creer/analyse-rush-serveur', async (orig) => {
  const actual = await orig<typeof import('@/lib/creer/analyse-rush-serveur')>();
  return { ...actual, analyserRushServeurCache: async () => null, analyserMusiqueServeur: async () => null };
});
vi.mock('@/lib/render/proxy-rendu', async (orig) => {
  const actual = await orig<typeof import('@/lib/render/proxy-rendu')>();
  return { ...actual, urlRenduPourRush: async (url: string) => ({ url, proxy: false, cree: false }) };
});
const lancerJumeauMontage = vi.fn(async (..._a: unknown[]) => ({ ok: true, generationId: 'g1', attenteId: 'a1', dejaEnFile: false }));
vi.mock('@/lib/autopilot/jumeau-async', () => ({ lancerJumeauMontage: (...a: unknown[]) => lancerJumeauMontage(...a) }));

const S = 'https://studiio.pro/storage/v1/object/public/media/u1/';
const R = [`${S}rush-a.mp4`, `${S}rush-b.mp4`];
const PHOTO = { url: 'https://images.pexels.com/photos/1/a.jpeg', type: 'photo', provider: 'pexels', providerAssetId: '1', auteur: 'A', sourceUrl: '', licence: 'Pexels', vignetteUrl: '' };
const VIDEO_STOCK = { url: `${S}stock-pexels-video-9.mp4`, type: 'video', provider: 'pexels', providerAssetId: '9', auteur: 'B', sourceUrl: '', licence: 'Pexels', vignetteUrl: '' };
const JUMEAU = 'https://cdn.test/jumeau/gen-1.mp4';

const sources = (actives: Record<string, boolean>, stock: unknown[] = []) => ({ sources: { actives, stock, gabarit: [] } });
const ligne = (extra: Record<string, unknown> = {}) => ({
  user_id: 'u1', enabled: true, mode: 'review', platforms: [], cadence: 'daily', count_per_cycle: 1,
  credit_floor: 0, rush_urls: [], topics: ['yoga'], run_hour: 8, run_timezone: 'Europe/Paris',
  voice_enabled: false, jumeau_avatar: false, ...extra,
});

beforeEach(() => {
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  utilisateur = { credits: 500, email: 'client@test.fr', role: 'user' };
  posts = [];
  rpcDebit.mockClear();
  renderAndUpload.mockClear();
  lancerJumeauMontage.mockClear();
  globalThis.fetch = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    if (init?.method === 'HEAD' && (url.startsWith(S) || url.startsWith('https://images.pexels.com/'))) return new Response(null, { status: 200 });
    throw new Error(`aucun appel réseau attendu : ${url}`);
  }) as unknown as typeof fetch;
});
afterEach(() => { vi.resetModules(); });

async function modules() {
  vi.resetModules();
  const route = await import('@/app/api/autopilot/produire-maintenant/route');
  const produire = await import('@/lib/autopilot/produire');
  const credits = await import('@/lib/credits/system');
  return { ...route, ...produire, ...credits };
}

/** Somme réellement débitée par la RPC (montant = 2e argument). */
const debiteRpc = () => rpcDebit.mock.calls.reduce((t, c) => t + Number(c[1]), 0);

async function attendre(cond: () => boolean) {
  for (let i = 0; i < 600 && !cond(); i += 1) await new Promise((ok) => setTimeout(ok, 5));
}

interface Cas { nom: string; ligne: Record<string, unknown>; avatar: boolean; attendu: { rendu: number; avatar: number; affiche: number } }

const AFFICHE_REF = { poster_mode: 'reference', poster_urls: ['https://cdn.test/moi.jpg'] };
const CAS: Cas[] = [
  { nom: 'rushes seuls', ligne: ligne({ rush_urls: R }), avatar: false, attendu: { rendu: 12, avatar: 0, affiche: 0 } },
  { nom: 'avatar seul', ligne: ligne({ jumeau_avatar: true }), avatar: true, attendu: { rendu: 12, avatar: 33, affiche: 0 } },
  {
    nom: 'avatar + stock', avatar: true, attendu: { rendu: 12, avatar: 33, affiche: 0 },
    ligne: ligne({ jumeau_avatar: true, design_style: sources({ avatar: true, rushes: false, stock: true }, [PHOTO]) }),
  },
  {
    nom: 'avatar + rush + stock', avatar: true, attendu: { rendu: 12, avatar: 33, affiche: 0 },
    ligne: ligne({ jumeau_avatar: true, rush_urls: R, design_style: sources({ avatar: true, rushes: true, stock: true }, [PHOTO, VIDEO_STOCK]) }),
  },
  {
    nom: 'stock seul', avatar: false, attendu: { rendu: 12, avatar: 0, affiche: 0 },
    ligne: ligne({ design_style: sources({ avatar: false, rushes: false, stock: true }, [PHOTO, VIDEO_STOCK]) }),
  },
  { nom: 'rushes seuls + affiche de référence', ligne: ligne({ rush_urls: R, ...AFFICHE_REF }), avatar: false, attendu: { rendu: 12, avatar: 0, affiche: 7 } },
  { nom: 'avatar + stock + affiche de référence', avatar: true, attendu: { rendu: 12, avatar: 33, affiche: 7 },
    ligne: ligne({ jumeau_avatar: true, ...AFFICHE_REF, design_style: sources({ avatar: true, rushes: false, stock: true }, [PHOTO]) }) },
  { nom: 'affiche « mes photos » (pas référence)', ligne: ligne({ rush_urls: R, poster_mode: 'custom', poster_urls: ['https://cdn.test/moi.jpg'] }), avatar: false, attendu: { rendu: 12, avatar: 0, affiche: 0 } },
];

/**
 * Un parcours complet : GET → POST (refus à total-1, accepté à total) → débit.
 * Avatar : le POST lance le jumeau (rien débité par lui), puis la génération
 * débite `avatar.jumeau` et la finalisation le rendu.
 */
async function parcours(c: Cas) {
  configEnBase = c.ligne;
  const m = await modules();
  const devis = await (await m.GET()).json();
  const total = c.attendu.rendu + c.attendu.avatar + c.attendu.affiche;

  utilisateur = { ...utilisateur, credits: devis.cout - 1 };
  const refus = await m.POST();
  const refusStatut = refus.status;
  utilisateur = { ...utilisateur, credits: devis.cout };
  const res = await m.POST();
  const corps = await res.json();
  if (c.avatar) {
    const snap = lancerJumeauMontage.mock.calls[0][0] as { config: never; post: PreparedPost; jobId: string; slotKey: string };
    // `genererVideoJumeau` : UN débit avatar.jumeau, référence jumeau:<id>.
    await m.deductCredits('u1', GRILLE['avatar.jumeau'], 'avatar', 'jumeau:g1');
    await m.produireUnMontage({ userId: 'u1', config: snap.config, post: snap.post, rang: 0, now: Date.now(), jobId: snap.jobId, slotKey: snap.slotKey, jumeauVideoUrl: JUMEAU });
  } else {
    await attendre(() => posts.length > 0);
    await attendre(() => rpcDebit.mock.calls.length >= (c.attendu.affiche ? 2 : 1) || utilisateur.role === 'admin');
  }
  return { devis, total, refusStatut, statut: res.status, corps };
}

describe('matrice GET = POST = débit, par combinaison de sources', () => {
  for (const c of CAS) {
    it(c.nom, async () => {
      const { devis, total, refusStatut, statut, corps } = await parcours(c);
      expect(devis.detail).toEqual(c.attendu);
      expect(devis.cout).toBe(total);
      expect(devis.politique).toBe('credits');
      // POST : contrôle LE MÊME total (402 à un crédit près).
      expect(refusStatut).toBe(402);
      expect(statut).toBe(c.avatar ? 200 : 202);
      if (c.avatar) expect(corps.cout).toBe(total);
      // Débit réel (RPC) = devis.
      expect(debiteRpc()).toBe(total);
      expect(renderAndUpload).toHaveBeenCalledTimes(1);
      // Un débit de rendu, référencé par le jobId ; aucun débit pour le stock.
      const refs = rpcDebit.mock.calls.map((x) => String(x[3]));
      expect(refs.filter((r) => r.startsWith('autopilote:'))).toHaveLength(1);
      expect(refs.filter((r) => r.startsWith('jumeau:'))).toHaveLength(c.avatar ? 1 : 0);
      expect(refs.filter((r) => r.startsWith('autopilote-affiche:'))).toHaveLength(c.attendu.affiche ? 1 : 0);
      expect(rpcDebit.mock.calls).toHaveLength(1 + (c.avatar ? 1 : 0) + (c.attendu.affiche ? 1 : 0));
    });
  }

  it('le stock coûte 0 : même devis stock ON ou OFF', async () => {
    const { devisMontage, configDepuisLigne } = await modules();
    const avec = configDepuisLigne(ligne({ rush_urls: R, design_style: sources({ rushes: true, stock: true }, [PHOTO, VIDEO_STOCK]) }));
    const sans = configDepuisLigne(ligne({ rush_urls: R, design_style: sources({ rushes: true, stock: false }, [PHOTO, VIDEO_STOCK]) }));
    expect(await devisMontage(avec)).toEqual(await devisMontage(sans));
    expect((await devisMontage(avec)).total).toBe(12);
  });
});

describe('administrateur : 0 crédit débité, aucune RPC', () => {
  for (const c of CAS) {
    it(`admin — ${c.nom}`, async () => {
      utilisateur = { credits: 0, email: 'admin@test.fr', role: 'admin' };
      configEnBase = c.ligne;
      const m = await modules();
      const devis = await (await m.GET()).json();
      expect(devis.politique).toBe('partner_cost_only');
      const res = await m.POST();
      expect(res.status).toBe(c.avatar ? 200 : 202);
      if (c.avatar) {
        const snap = lancerJumeauMontage.mock.calls[0][0] as { config: never; post: PreparedPost; jobId: string; slotKey: string };
        expect(await m.deductCredits('u1', GRILLE['avatar.jumeau'], 'avatar', 'jumeau:g1')).toBe(true);
        await m.produireUnMontage({ userId: 'u1', config: snap.config, post: snap.post, rang: 0, now: Date.now(), jobId: snap.jobId, slotKey: snap.slotKey, jumeauVideoUrl: JUMEAU });
      } else {
        await attendre(() => posts.length > 0);
        await new Promise((ok) => setTimeout(ok, 20));
      }
      expect(renderAndUpload).toHaveBeenCalledTimes(1);
      expect(rpcDebit).not.toHaveBeenCalled();
    });
  }
});
