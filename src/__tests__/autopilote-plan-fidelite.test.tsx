import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * LE PLAN MONTRÉ = LE PLAN RENDU — de l'écran jusqu'à l'entrée du rendu.
 *
 *  1. Sans plan enregistré, l'écran montre la SUGGESTION (`gabaritSuggere`) :
 *     pour chaque combinaison de sources, l'ordre des types affiché est
 *     l'ordre des types des plans rendus (CTA fixe exclu).
 *  2. Après chaque geste (déplacer, supprimer, forcer un type, choisir un
 *     média, rechercher, réinitialiser), le gabarit ENREGISTRÉ par le PUT
 *     (`designStyle.sources.gabarit`, nettoyé par `sanitizeConfig`) pilote le
 *     rendu à l'identique : types ET médias forcés, dans l'ordre.
 *
 * Le panneau réel (`AutopilotPanel`) et le moteur réel (`produireUnMontage`)
 * — seuls le rendu Remotion, les sondes de durée, les voix, l'analyse ffmpeg,
 * la base et les crédits sont doublés. Aucun fournisseur appelé.
 */

let lastDesign: Record<string, unknown> | null = null;
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: async (arg: { design: Record<string, unknown> }) => {
    lastDesign = arg.design;
    return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
  },
}));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async (url: string) => (url.includes('/avatar/') ? 30 : url.includes('stock-') ? 10 : 15),
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));
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
vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: async () => 10 }));
vi.mock('@/lib/credits/system', () => ({ getVideoRenderCost: () => 10, deductCredits: async () => true }));
vi.mock('@/lib/db/supabase', () => {
  const from = () => ({ insert: () => ({ select: async () => ({ data: [{ id: 'p1' }], error: null }) }) });
  return { supabaseAdmin: { from }, supabase: { from } };
});

import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { ConfigSources, MediaStockRetenu, TypeCreneau } from '@/lib/autopilot/sources';
import type { RushSegment } from '@/lib/creer/multi-rush';
import { preparePosts } from '@/lib/autopilot/engine';
import { produireUnMontage } from '@/lib/autopilot/produire';
import { etatSourcesVisuelles, sourcesEffectives as sourcesEcran, validerEtapeRushes } from '@/lib/autopilot/medias-prevus';
import { aUneSourceVisuelle, etatSourcesServeur } from '@/lib/autopilot/sources';

const ORIGINE = 'https://studiio.pro/storage/v1/object/public/media/u';
const A = `${ORIGINE}/a.mp4`;
const B = `${ORIGINE}/b.mp4`;
const IMPORTE = (id: string) => `${ORIGINE}/library/stock-pexels-video-${id}.mp4`;
const U1 = 'https://images.unsplash.com/photo-U1?ixid=x';
const PH1 = 'https://images.pexels.com/PH1/full.jpg';
const AV = 'https://studiio.pro/storage/v1/object/public/videos/u/avatar/gen-1.mp4';

const retenu = (url: string, type: 'video' | 'photo', provider: 'pexels' | 'unsplash', id: string): MediaStockRetenu => ({
  url, type, provider, providerAssetId: id, auteur: `Auteur ${id}`, sourceUrl: `https://www.${provider}.com/x/${id}/`,
  licence: 'Licence', vignetteUrl: `https://cdn.${provider}.test/${id}/thumb.jpg`,
});
const STOCK = [retenu(IMPORTE('V1'), 'video', 'pexels', 'V1'), retenu(U1, 'photo', 'unsplash', 'U1'), retenu(PH1, 'photo', 'pexels', 'PH1')];
const sourcesCfg = (actives: Partial<ConfigSources['actives']>, stock: MediaStockRetenu[] = []): ConfigSources => ({
  actives: { rushes: true, avatar: false, stock: false, ...actives }, stock, gabarit: [],
});

const JUMEAU_PRET = {
  pret: true, motif: null, message: null, moteurDisponible: true, messageMoteur: null,
  jumeau: { avatar: { id: 'av1', version: 2, nom: 'Moi', valideLe: '2026-10-01', fournisseur: 'heygen' }, voix: { id: 'v1', nom: 'Ma voix' }, prononciations: 0 },
};
const AVATARS = { avatars: [{ id: 'av1', nom: 'Moi', parDefaut: true, utilisable: true, type: 'photo', versionActive: { id: 'ver-1', version: 2, source: true, type: 'photo' } }] };

let configServeur: AutopilotConfig;
let envois: AutopilotConfig[];
const horsStudiio: string[] = [];

function stockRecherche(type: string | null) {
  const m = (provider: 'pexels' | 'unsplash', t: 'video' | 'photo', id: string) => ({
    id: `${provider}-${t}-${id}`, provider, providerAssetId: id, type: t, largeur: 1080, hauteur: 1920, orientation: 'portrait',
    dureeSecondes: t === 'video' ? 10 : undefined, vignetteUrl: `https://cdn.${provider}.test/${id}/thumb.jpg`,
    apercuUrl: `https://cdn.${provider}.test/${id}/apercu.jpg`,
    fichierUrl: t === 'photo' ? `https://images.${provider}.com/${id}/full.jpg` : `https://cdn.${provider}.test/${id}/full.mp4`,
    sourceUrl: `https://www.${provider}.com/${t}/${id}/`, auteur: `Auteur ${id}`, description: 'x', licence: 'L', attribution: 'x',
  });
  return type === 'photo' ? [m('pexels', 'photo', 'PH9')] : [m('pexels', 'video', 'V2')];
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* */ }
  envois = [];
  horsStudiio.length = 0;
  lastDesign = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    // Le MOTEUR sonde les médias stock (HEAD, `redirect: manual`) : 200, sans réseau.
    if (init?.method === 'HEAD') return { status: 200, type: 'basic', headers: new Headers(), body: null };
    if (!u.startsWith('/api/')) horsStudiio.push(u);
    if (u.startsWith('/api/creer/jumeau')) return { ok: true, json: async () => ({ success: true, data: JUMEAU_PRET }) };
    if (u.startsWith('/api/avatars')) return { ok: true, json: async () => ({ success: true, data: AVATARS }) };
    if (u.startsWith('/api/stock/importer')) {
      const corps = JSON.parse(String(init?.body)) as { provider: 'pexels'; type: 'video'; providerAssetId: string };
      return { ok: true, json: async () => ({ success: true, url: IMPORTE(corps.providerAssetId), importe: true, media: stockRecherche('video')[0] }) };
    }
    if (u.startsWith('/api/stock/recherche')) {
      return { ok: true, json: async () => ({ success: true, medias: stockRecherche(new URL(u, 'http://x').searchParams.get('type')), echecs: [] }) };
    }
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        configServeur = sanitizeConfig(JSON.parse(String(init.body)));
        envois.push(configServeur);
        return { ok: true, json: async () => ({ success: true, config: configServeur, jumeauReady: true }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, jumeauReady: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});
afterEach(() => {
  expect(horsStudiio).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

async function ouvrir() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('Sujets')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
  await waitFor(() => expect(document.querySelector('[data-autopilot-plan]')).toBeTruthy());
  await waitFor(() => expect(document.querySelector('[data-avatar-pret="oui"]')).toBeTruthy());
}
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const typesAffiches = () => Array.from(document.querySelectorAll('[data-plan-ligne]')).map((l) => l.getAttribute('data-plan-type') as TypeCreneau);
const dernier = () => envois[envois.length - 1];

/** Le type d'un plan rendu, dans le vocabulaire de l'écran. */
// (Chemin d'avant des rushes seuls : les extraits n'ont pas de `source` — ce sont des rushes.)
const typeSegment = (s: RushSegment): TypeCreneau => (s.kind === 'avatar' ? 'avatar'
  : s.kind === 'image' || s.source === 'stock' || s.source === 'photo' ? 'stock' : 'rush');
const compacter = <T,>(l: T[]) => l.filter((x, i) => i === 0 || x !== l[i - 1]);

/** Le moteur réel, sur la configuration que le serveur a ENREGISTRÉE. */
async function rendre(c: AutopilotConfig): Promise<{ types: TypeCreneau[]; urls: string[] }> {
  const post = preparePosts({ config: c, topic: 'yoga', count: 1, now: Date.parse('2026-10-10T09:00:00Z') })[0];
  await produireUnMontage({
    userId: 'u1', config: c, post, rang: 0, now: Date.parse('2026-10-10T09:00:00Z'), jobId: 'job',
    jumeauVideoUrl: c.jumeauAvatar ? AV : null,
  });
  const d = lastDesign!;
  const montage = (d.montage as RushSegment[] | undefined) ?? null;
  // Chemins d'avant (une seule source) : la séquence Vidéo est `videoUrl`, ou les extraits de rushes.
  if (!montage) return { types: [d.videoUrl === AV ? 'avatar' : 'rush'], urls: [String(d.videoUrl)] };
  return { types: montage.map(typeSegment), urls: montage.map((s) => s.url) };
}

describe('sans plan enregistré : la suggestion affichée = les types rendus', () => {
  const combis: Array<[string, Partial<AutopilotConfig>, TypeCreneau[]]> = [
    ['rushes seuls', { rushUrls: [A, B], designStyle: { sources: sourcesCfg({}) } }, ['rush', 'rush', 'rush']],
    ['avatar seul', { jumeauAvatar: true, rushUrls: [], designStyle: { sources: sourcesCfg({ avatar: true, rushes: false }) } }, ['avatar']],
    ['stock seul', { rushUrls: [IMPORTE('V1')], designStyle: { sources: sourcesCfg({ rushes: false, stock: true }, STOCK) } }, ['stock', 'stock', 'stock']],
    ['avatar + rushes', { jumeauAvatar: true, rushUrls: [A, B], designStyle: { sources: sourcesCfg({ avatar: true }) } }, ['avatar', 'rush', 'rush', 'avatar']],
    ['rushes + stock', { rushUrls: [A, B, IMPORTE('V1')], designStyle: { sources: sourcesCfg({ stock: true }, STOCK) } }, ['rush', 'stock', 'rush', 'stock']],
    ['avatar + stock', { jumeauAvatar: true, rushUrls: [IMPORTE('V1')], designStyle: { sources: sourcesCfg({ avatar: true, rushes: false, stock: true }, STOCK) } }, ['avatar', 'stock', 'stock', 'avatar']],
    ['avatar + rushes + stock', { jumeauAvatar: true, rushUrls: [A, B, IMPORTE('V1')], designStyle: { sources: sourcesCfg({ avatar: true, stock: true }, STOCK) } }, ['avatar', 'rush', 'stock', 'rush', 'avatar']],
  ];
  for (const [nom, p, attendu] of combis) {
    it(nom, async () => {
      configServeur = { ...DEFAULT_CONFIG, topics: ['yoga'], ...p } as AutopilotConfig;
      await ouvrir();
      await waitFor(() => expect(typesAffiches()).toEqual(attendu));
      expect(q('[data-plan-suggere]')).toBeTruthy();
      expect(envois).toEqual([]);
      const { types } = await rendre(configServeur);
      // Multi-sources : plan rendu = suggestion, créneau par créneau. Une source
      // seule (chemin d'avant) : la même nature de bout en bout.
      if (new Set(attendu).size > 1) expect(types).toEqual(attendu);
      else expect(compacter(types)).toEqual(compacter(attendu));
    });
  }
});

describe('après chaque geste : le gabarit ENREGISTRÉ pilote le rendu à l’identique', () => {
  beforeEach(() => {
    configServeur = {
      ...DEFAULT_CONFIG, topics: ['yoga'], jumeauAvatar: true, rushUrls: [A, B, IMPORTE('V1')],
      designStyle: { sources: sourcesCfg({ avatar: true, stock: true }, STOCK) },
    } as AutopilotConfig;
  });

  async function verifier(attenduTypes: TypeCreneau[], forces: Record<number, string> = {}) {
    const g = dernier().designStyle.sources!.gabarit;
    expect(g.map((c) => c.type)).toEqual(attenduTypes);
    for (const [i, url] of Object.entries(forces)) expect(g[Number(i)].media).toBe(url);
    await waitFor(() => expect(typesAffiches()).toEqual(attenduTypes));
    const { types, urls } = await rendre(dernier());
    expect(types).toEqual(attenduTypes);
    for (const [i, url] of Object.entries(forces)) expect(urls[Number(i)]).toBe(url);
  }

  it('déplacer, supprimer, forcer Avatar / Rush / Stock, choisir un média, rechercher, réinitialiser', async () => {
    await ouvrir();
    await waitFor(() => expect(typesAffiches()).toEqual(['avatar', 'rush', 'stock', 'rush', 'avatar']));

    // Déplacer : la séquence 1 descend.
    fireEvent.click(q('[data-plan-descendre="0"]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    await verifier(['rush', 'avatar', 'stock', 'rush', 'avatar']);

    // Supprimer la séquence 4.
    fireEvent.click(q('[data-plan-supprimer="3"]')!);
    await waitFor(() => expect(envois.length).toBe(2));
    await verifier(['rush', 'avatar', 'stock', 'avatar']);

    // Forcer Stock sur la séquence 1, puis y choisir la photo Unsplash.
    fireEvent.change(q('[data-plan-forcer="0"]')!, { target: { value: 'stock' } });
    await waitFor(() => expect(envois.length).toBe(3));
    await verifier(['stock', 'avatar', 'stock', 'avatar']);
    fireEvent.change(q('[data-plan-media="0"]')!, { target: { value: U1 } });
    await waitFor(() => expect(envois.length).toBe(4));
    // Séquence 3 : la photo Pexels.
    fireEvent.change(q('[data-plan-media="2"]')!, { target: { value: PH1 } });
    await waitFor(() => expect(envois.length).toBe(5));
    await verifier(['stock', 'avatar', 'stock', 'avatar'], { 0: U1, 2: PH1 });

    // Forcer Rush sur la séquence 2 et y choisir le rush B.
    fireEvent.change(q('[data-plan-forcer="1"]')!, { target: { value: 'rush' } });
    await waitFor(() => expect(envois.length).toBe(6));
    fireEvent.change(q('[data-plan-media="1"]')!, { target: { value: B } });
    await waitFor(() => expect(envois.length).toBe(7));
    await verifier(['stock', 'rush', 'stock', 'avatar'], { 0: U1, 1: B, 2: PH1 });

    // Forcer Avatar sur la séquence 1.
    fireEvent.change(q('[data-plan-forcer="0"]')!, { target: { value: 'avatar' } });
    await waitFor(() => expect(envois.length).toBe(8));
    await verifier(['avatar', 'rush', 'stock', 'avatar'], { 1: B, 2: PH1 });

    // Rechercher un autre média pour la séquence 3 : la vidéo V2 la remplit.
    fireEvent.click(q('[data-plan-rechercher="2"]')!);
    const zone = await waitFor(() => { const z = q('[data-autopilot-stock-recherche^="ligne-"]'); expect(z).toBeTruthy(); return z!; });
    fireEvent.click(zone.querySelector('[data-autopilot-stock-mode="video"]')!);
    fireEvent.click(zone.querySelector('[data-autopilot-stock-lancer]')!);
    await waitFor(() => expect(zone.querySelector('[data-autopilot-stock-retenir="pexels-video-V2"]')).toBeTruthy());
    fireEvent.click(zone.querySelector('[data-autopilot-stock-retenir="pexels-video-V2"]')!);
    await waitFor(() => expect(envois.length).toBe(9));
    await verifier(['avatar', 'rush', 'stock', 'avatar'], { 1: B, 2: IMPORTE('V2') });

    // Remplacer (même ligne, autre média retenu) : la vidéo V1.
    fireEvent.change(q('[data-plan-media="2"]')!, { target: { value: IMPORTE('V1') } });
    await waitFor(() => expect(envois.length).toBe(10));
    await verifier(['avatar', 'rush', 'stock', 'avatar'], { 1: B, 2: IMPORTE('V1') });

    // Réinitialiser : retour à la suggestion — et toujours identique au moteur.
    fireEvent.click(q('[data-plan-reinitialiser]')!);
    await waitFor(() => expect(envois.length).toBe(11));
    expect(dernier().designStyle.sources!.gabarit).toEqual([]);
    await waitFor(() => expect(q('[data-plan-suggere]')).toBeTruthy());
    const suggestion = typesAffiches();
    expect(suggestion).toEqual(['avatar', 'rush', 'stock', 'rush', 'avatar']);
    expect((await rendre(dernier())).types).toEqual(suggestion);
  }, 30_000);

  it('rushes SEULS avec un plan enregistré : l’ordre forcé des rushes est rendu (avant : ignoré)', async () => {
    configServeur = {
      ...DEFAULT_CONFIG, topics: ['yoga'], rushUrls: [A, B],
      designStyle: { sources: { ...sourcesCfg({}), gabarit: [{ id: 's1', type: 'rush', media: B }, { id: 's2', type: 'rush', media: A }] } },
    } as AutopilotConfig;
    const { types, urls } = await rendre(configServeur);
    expect(types).toEqual(['rush', 'rush']);
    expect(urls).toEqual([B, A]);
  });
});

describe('« source possible » : l’écran et le serveur disent la même chose', () => {
  const ecranPossible = (c: AutopilotConfig) => {
    const e = etatSourcesVisuelles(c.rushUrls, sourcesEcran(c), true, !!c.designStyle.sources);
    return !validerEtapeRushes({ nbRushes: e.rushesPersonnels, avatarDemande: e.avatarActif, avatarPret: true, stockRetenus: e.stockRetenus, bibliotheque: e.bibliotheque }).bloque;
  };
  const serveurPossible = (c: AutopilotConfig) => aUneSourceVisuelle(etatSourcesServeur(c));

  it.each<[string, Partial<AutopilotConfig>]>([
    ['banque = vidéo stock importée, SANS clé (montée, comme avant)', { rushUrls: [IMPORTE('V1')] }],
    ['banque = vidéo stock importée, clé + stock éteint (écartée par le moteur)', { rushUrls: [IMPORTE('V1')], designStyle: { sources: sourcesCfg({}) } }],
    ['banque = vidéo stock importée, clé + stock allumé', { rushUrls: [IMPORTE('V1')], designStyle: { sources: sourcesCfg({ stock: true }) } }],
    ['rushes éteints, rush perso seul', { rushUrls: [A], designStyle: { sources: sourcesCfg({ rushes: false }) } }],
    ['rien', { rushUrls: [], designStyle: { sources: sourcesCfg({ stock: true }) } }],
    ['avatar seul', { rushUrls: [], jumeauAvatar: true, designStyle: { sources: sourcesCfg({ avatar: true, rushes: false }) } }],
  ])('%s', (_nom, p) => {
    const c = { ...DEFAULT_CONFIG, topics: ['yoga'], ...p } as AutopilotConfig;
    expect(ecranPossible(c)).toBe(serveurPossible(c));
  });
});
