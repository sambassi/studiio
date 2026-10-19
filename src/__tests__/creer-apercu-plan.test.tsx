/**
 * M3-a PR3 — aperçu rapide du plan, wizard monté (réseau simulé).
 *
 * - Interrupteur ÉTEINT : options du compositeur, `renderSignature` et appels
 *   à `planMontage` IDENTIQUES à c3f2302 (instantané enregistré sur la base,
 *   `fixtures/apercu-plan-off-c3f2302.json`, 6 projets).
 * - Allumé (admin) : le plan de l'aperçu est REJOUÉ par l'export à clé
 *   identique (1 seul `planMontage`), et l'export produit EXACTEMENT les
 *   mêmes options que sans aperçu. Plan en calcul / modifié ⇒ recalcul.
 * - L'aperçu ne fait aucune requête de rendu, de crédits ni de facturation.
 *
 * Enregistrer l'instantané (sur la base uniquement) : ENREGISTRER_APERCU_PLAN=1.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { existsSync, readFileSync, writeFileSync } from 'fs';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;
vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlQuery }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (cards: unknown) => cards }));

const { RUSH_A, RUSH_B, RUSH_C, RUSH_X, MUSIQUE } = vi.hoisted(() => ({
  RUSH_A: 'https://studiio.pro/storage/v1/object/public/media/u1/converted_1791985445290.mp4',
  RUSH_B: 'https://studiio.pro/storage/v1/object/public/media/u1/stock-pexels-video-34521342.mp4',
  RUSH_C: 'https://studiio.pro/storage/v1/object/public/media/u1/rush-c.mp4',
  RUSH_X: 'https://studiio.pro/storage/v1/object/public/media/u1/rush-illisible.mp4',
  MUSIQUE: 'https://studiio.pro/storage/v1/object/public/media/u1/musique.mp3',
}));
const sp = vi.hoisted(() => ({
  planMontage: vi.fn(),
  composeVideo: vi.fn(),
  downloadBlob: vi.fn(async () => {}),
  analyses: 0,
}));
vi.mock('@/lib/creer/analyse-rush', async () => {
  const fixture = (await import('./fixtures/passages-rushes-reels.json')).default;
  const danse = (await import('./fixtures/conseiller-danse.json')).default as unknown as { rythme: unknown };
  const rushes = (fixture as unknown as { rushes: Array<{ url: string }> }).rushes;
  // Objets STABLES par URL : c'est la mémoïsation réelle (même analyse pour l'aperçu et l'export).
  const parUrl: Record<string, unknown> = {
    [RUSH_A]: { ...rushes[0], url: RUSH_A, pisteAudio: true, silences: [[0, 10.25], [11.9, 12.35], [14.5, 15.25], [15.65, 16.45], [18.75, 19.7], [20.1, 32]], sonContinu: false },
    [RUSH_B]: { ...rushes[2], url: RUSH_B, pisteAudio: false },
    [RUSH_C]: { ...rushes[1], url: RUSH_C, pisteAudio: false },
  };
  return {
    analyserRushMemo: async (url: string) => { sp.analyses += 1; return parUrl[url] ?? null; },
    analyserMusiqueNavigateur: async (url: string) => (url === MUSIQUE ? danse.rythme : null),
    AUDIO_OCTETS_MAX: 1, DUREE_ANALYSEE_MAX: 180,
  };
});
vi.mock('@/lib/creer/smart-montage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/creer/smart-montage')>('@/lib/creer/smart-montage');
  sp.planMontage.mockImplementation((...a: unknown[]) => (actual.planMontage as (...x: unknown[]) => unknown)(...a));
  return { ...actual, planMontage: (...a: unknown[]) => sp.planMontage(...a) };
});
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  sp.composeVideo.mockImplementation(async () => ({ video: new Blob([new Uint8Array(2048)], { type: 'video/webm' }), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) }));
  return {
    ...actual,
    composeVideo: (...a: unknown[]) => sp.composeVideo(...a),
    composeAndUpload: async () => { throw new Error('chemin non prouvé'); },
    uploadRendu: async () => { throw new Error('chemin non prouvé'); },
    downloadBlob: (...a: unknown[]) => sp.downloadBlob(...(a as [])),
  };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';
import { renderSignature } from '../lib/creer/renderSignature';

const INSTANTANE = 'src/__tests__/fixtures/apercu-plan-off-c3f2302.json';
const ENREGISTRER = process.env.ENREGISTRER_APERCU_PLAN === '1';
const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Danse du matin', subtitle: 'Bouger',
  cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois', value: '3' }, { icon: 'Zap', title: 'Bouger', description: 'Cinq', value: '5' }],
};

let appels: Array<{ m: string; u: string }>;
let n = 0;
function installerFetch(config: { passages?: boolean; apercuPlan?: boolean }) {
  appels = []; n = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url); const m = String(init?.method ?? 'GET').toUpperCase();
    appels.push({ m, u });
    const rep = (c: unknown, status = 200) => ({ ok: status < 300, status, json: async () => c, headers: new Headers() } as Response);
    if (u.includes('/api/creer/montage-config')) return rep({ passages: !!config.passages });
    if (u.includes('/api/creer/apercu-config')) return rep({ apercuPlan: !!config.apercuPlan });
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'partner_cost_only', balance: null });
    if (u.endsWith('/api/render/jobs') && m === 'POST') { n += 1; return rep({ ok: true, jobId: `job-${n}`, uploadUrl: `/api/render/jobs/job-${n}/upload`, uploadMode: 'relais', publicUrl: `https://studiio.pro/storage/v1/object/public/media/u1/rendus/job-${n}.webm`, cout: 10 }); }
    if (/\/api\/render\/jobs\/job-\d+\/upload/.test(u)) return rep({});
    if (/\/api\/render\/jobs\/job-\d+\/confirm/.test(u)) return rep({ ok: true, politique: 'partner_cost_only', balance: null });
    if (m === 'GET' && /\/api\/social\/(status|zernio\/accounts)$/.test(u.split('?')[0])) return rep({ success: true, platforms: {}, channels: {}, autorise: false, comptes: [] });
    return rep({ success: true });
  }) as unknown as typeof fetch;
}

const PROJETS: Record<string, Record<string, unknown>> = {
  'P1 2 rushes A': {},
  'P2 3 rushes + musique': { musicUrl: MUSIQUE, rushSuivants: [{ url: RUSH_B, name: 'b', secondes: 12 }, { url: RUSH_C, name: 'c', secondes: 9 }] },
  'P3 raccourci (vidéo 60 s)': { videoDuration: 60 },
  'P4 1 rush (aucun plan)': { rushSuivants: [] },
  'P5 rush illisible (plan nul, enchaînement)': { rushSuivants: [{ url: RUSH_X, name: 'x', secondes: 10 }] },
  'P6 plein écran 16:9 (thème non dynamique)': { customTopic: 'finances personnelles', format: '16:9' },
};
const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
    customTopic: 'danse afro cardio', generated: CONTENU, scheduledDate: '2026-09-01',
    rushUrl: RUSH_A, rushSecondes: 32, rushSuivants: [{ url: RUSH_B, name: 'b', secondes: 12 }],
    sequences: [{ key: 'intro', enabled: true }, { key: 'cards', enabled: true }, { key: 'video', enabled: true }, { key: 'cta', enabled: true }],
    introDuration: 2, cardsDuration: 2, videoDuration: 12, ctaDuration: 2,
    ...extra,
  }));
};

const attendre = async (k = 40) => { for (let i = 0; i < k; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const patienter = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await attendre(10); };
const continuer = async () => {
  for (let i = 0; i < 4; i += 1) {
    if (document.querySelector('[data-batch-mode="unique"]')) break;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
  }
  await attendre(10);
};
const allerAEnvoi = async () => {
  urlQuery = new URLSearchParams('');
  render(<AssistantWizard />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await continuer();
};
const derouler = async () => {
  for (let k = 0; k < 4; k += 1) {
    await attendre(30);
    const c = document.querySelector('[data-raccourci-continuer]');
    if (c) await act(async () => { fireEvent.click(c); });
  }
  await attendre(30);
};
const telecharger = async () => {
  await act(async () => { fireEvent.click(document.querySelector('[data-export-bureau]')!); });
  await derouler();
};
/** Ce qui doit être identique : options du compositeur + appels du moteur de plan. */
const empreinte = () => ({
  options: sp.composeVideo.mock.calls.map((c) => renderSignature(c[0])),
  plans: sp.planMontage.mock.calls.map((c) => renderSignature([(c[0] as Array<{ url: string }>).map((a) => a.url), c[1], c[2]])),
});
const facturation = () => appels.filter((a) => /\/api\/(rendus|credits|render)/.test(a.u));

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  sp.planMontage.mockClear(); sp.composeVideo.mockClear(); sp.downloadBlob.mockClear(); sp.analyses = 0;
});
afterEach(() => { cleanup(); });

async function exporterOff(nom: string, methode: 'A' | 'B' = 'A') {
  installerFetch({ passages: methode === 'B', apercuPlan: false });
  poser(PROJETS[nom]);
  await allerAEnvoi();
  if (methode === 'B') await act(async () => { fireEvent.click(document.querySelector('[data-methode-choix="B"]')!); });
  await patienter(500);
  await telecharger();
  return empreinte();
}

const cas: Array<[string, 'A' | 'B']> = [...Object.keys(PROJETS).map((k) => [k, 'A'] as [string, 'A']), ['P1 2 rushes A', 'B']];
const nomCas = (k: string, m: string) => `${k} [${m}]`;

describe('interrupteur ÉTEINT : identique à c3f2302', () => {
  const instantane: Record<string, unknown> = !ENREGISTRER && existsSync(INSTANTANE) ? JSON.parse(readFileSync(INSTANTANE, 'utf8')) : {};
  const releves: Record<string, unknown> = {};
  for (const [k, m] of cas) {
    it(nomCas(k, m), async () => {
      const e = await exporterOff(k, m);
      expect(e.options.length, 'un rendu').toBe(1);
      releves[nomCas(k, m)] = e;
      if (!ENREGISTRER) expect(e).toEqual(instantane[nomCas(k, m)]);
      // Éteint : aucun aperçu rapide, aucun bandeau.
      expect(document.querySelector('[data-apercu-plan-bandeau]')).toBeNull();
      expect(document.querySelector('[data-apercu-canvas]')).toBeNull();
    }, 20000);
  }
  it('instantané', () => {
    if (ENREGISTRER) writeFileSync(INSTANTANE, `${JSON.stringify(releves, null, 1)}\n`);
    expect(Object.keys(ENREGISTRER ? releves : instantane)).toHaveLength(cas.length);
  });
});

describe('interrupteur ALLUMÉ (admin) : plan de l’aperçu rejoué à l’export', () => {
  const instantane: Record<string, { options: string[]; plans: string[] }> = existsSync(INSTANTANE) ? JSON.parse(readFileSync(INSTANTANE, 'utf8')) : {};
  for (const k of ['P1 2 rushes A', 'P2 3 rushes + musique', 'P3 raccourci (vidéo 60 s)', 'P6 plein écran 16:9 (thème non dynamique)']) {
    it(`${k} : 1 seul planMontage (aperçu + export), options IDENTIQUES à l’export sans aperçu, 0 requête de facturation pendant l’aperçu`, async () => {
      if (ENREGISTRER) return;
      installerFetch({ apercuPlan: true });
      poser(PROJETS[k]);
      await allerAEnvoi();
      // Lectures d'affichage de la page (solde, grille), identiques interrupteur éteint.
      const avantApercu = facturation().length;
      await patienter(500);
      expect(sp.planMontage).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[data-apercu-plan-bandeau]')?.getAttribute('data-apercu-plan-bandeau')).toBe('plan');
      expect(document.body.textContent).toContain('Aperçu rapide — son, filtre couleur et rendu exact des textes appliqués à l’export.');
      if (k.startsWith('P3')) expect(document.querySelector('[data-apercu-raccourci]')).not.toBeNull();
      // Le calcul et l'affichage de l'aperçu : AUCUNE requête de rendu / crédits / facturation, aucun POST.
      expect(facturation().slice(avantApercu), JSON.stringify(facturation())).toEqual([]);
      expect(appels.filter((x) => x.m !== 'GET' && /\/api\/(rendus|credits|render)/.test(x.u))).toEqual([]);
      // Le raccourci ne touche ni la durée de l'écran ni le brouillon.
      expect(JSON.parse(window.localStorage.getItem(CLE) ?? '{}').videoDuration).toBe((PROJETS[k].videoDuration as number | undefined) ?? 12);
      await telecharger();
      expect(sp.planMontage).toHaveBeenCalledTimes(1);
      const e = empreinte();
      expect(e.options).toEqual(instantane[nomCas(k, 'A')].options);
      expect(e.plans).toEqual(instantane[nomCas(k, 'A')].plans);
    }, 20000);
  }

  it('retour arrière puis retour à l’Envoi sans rien changer : aucun recalcul', async () => {
    installerFetch({ apercuPlan: true });
    poser();
    await allerAEnvoi();
    await patienter(500);
    expect(sp.planMontage).toHaveBeenCalledTimes(1);
    const retour = screen.queryAllByRole('button', { name: /Retour/ }).at(-1);
    expect(retour).toBeTruthy();
    await act(async () => { fireEvent.click(retour!); });
    await attendre(10);
    await continuer();
    await patienter(500);
    expect(sp.planMontage).toHaveBeenCalledTimes(1);
  }, 20000);

  it('modification APRÈS l’aperçu (méthode A → B) : clé caduque, recalcul ; export immédiat (plan en calcul) ⇒ l’export recalcule, mêmes options que sans aperçu', async () => {
    if (ENREGISTRER) return;
    installerFetch({ apercuPlan: true, passages: true });
    poser();
    await allerAEnvoi();
    await patienter(500);
    expect(sp.planMontage).toHaveBeenCalledTimes(1); // aperçu A
    await act(async () => { fireEvent.click(document.querySelector('[data-methode-choix="B"]')!); });
    await telecharger(); // avant les 400 ms : le plan B de l'aperçu n'existe pas encore
    const exportB = sp.planMontage.mock.calls.findIndex((c) => (c[2] as { selection?: string }).selection === 'passages');
    expect(exportB).toBeGreaterThanOrEqual(1);
    expect(empreinte().options).toEqual(instantane[nomCas('P1 2 rushes A', 'B')].options);
  }, 20000);

  it('rush illisible : aperçu SIMPLIFIÉ annoncé, jamais le montage complet ; l’export recalcule comme avant', async () => {
    if (ENREGISTRER) return;
    installerFetch({ apercuPlan: true });
    poser(PROJETS['P5 rush illisible (plan nul, enchaînement)']);
    await allerAEnvoi();
    await patienter(500);
    expect(document.querySelector('[data-apercu-simplifie]')).not.toBeNull();
    expect(document.body.textContent).toContain('le montage complet n’est visible qu’à l’export');
    await telecharger();
    expect(empreinte().options).toEqual(instantane[nomCas('P5 rush illisible (plan nul, enchaînement)', 'A')].options);
  }, 20000);

  it('Play (rendu payant) puis Bureau à clé identique : réutilisation existante, UNE réservation, un seul planMontage', async () => {
    if (ENREGISTRER) return;
    installerFetch({ apercuPlan: true });
    poser();
    await allerAEnvoi();
    await patienter(500);
    await act(async () => { fireEvent.click(document.querySelector('[data-play-rendu]')!); });
    await derouler();
    expect(sp.composeVideo).toHaveBeenCalledTimes(1);
    await telecharger();
    expect(sp.composeVideo).toHaveBeenCalledTimes(1); // réutilisé, pas recomposé
    expect(appels.filter((x) => x.u.endsWith('/api/render/jobs') && x.m === 'POST')).toHaveLength(1);
    expect(sp.planMontage).toHaveBeenCalledTimes(1);
    expect(sp.downloadBlob).toHaveBeenCalledTimes(1);
  }, 20000);

  const FINANCE = { customTopic: 'finances personnelles', generated: { title: 'Épargner chaque mois', subtitle: 'Budget simple', cards: [{ icon: 'Wallet', title: 'Un budget', description: 'Clair', value: '10 %' }] } };
  for (const [k, fmt] of [['P1 2 rushes A', '9:16'], ['FINANCE', '16:9'], ['P1 2 rushes A', '1:1']] as const) {
    it(`lecture ${fmt} : canvas ≤ 540 px + filigrane DOM sur CHAQUE couche jouée (titre, cartes, vidéo, CTA, surimpressions)`, async () => {
      if (ENREGISTRER) return;
      installerFetch({ apercuPlan: true });
      poser({ ...(k === 'FINANCE' ? FINANCE : PROJETS[k]), format: fmt });
      await allerAEnvoi();
      await patienter(500);
      const lire = document.querySelector('[data-play-sequences]') as HTMLElement;
      expect(lire).not.toBeNull();
      await act(async () => { fireEvent.click(lire); });
      const vus = new Set<string>();
      let vuCanvas = false;
      let vuEntrante = false;
      for (let i = 0; i < 70; i += 1) {
        await patienter(60);
        const couches = Array.from(document.querySelectorAll('[data-playback-layer]'));
        if (!couches.length) break;
        for (const c of couches) {
          vus.add(c.getAttribute('data-playback-sequence') ?? '?');
          // Le filigrane DOM est le DERNIER enfant de la couche : au-dessus de tout.
          expect(c.lastElementChild?.hasAttribute('data-apercu-filigrane'), c.getAttribute('data-playback-sequence') ?? '').toBe(true);
        }
        // Pendant la lecture : aucun <video> dans la scène (les lecteurs sont hors DOM, peints dans le canvas).
        expect(document.querySelector('[data-playback-stage] video')).toBeNull();
        const canvas = document.querySelector('[data-apercu-canvas]') as HTMLCanvasElement | null;
        // Transition VERS la Vidéo : le compositeur n'a pas lancé le plan — premier extrait, figé (s = 0).
        const entrante = document.querySelector('[data-playback-layer="b"][data-playback-sequence="video"] [data-apercu-canvas]');
        if (entrante) { vuEntrante = true; expect(entrante.getAttribute('data-plan-lecture')).toBe('non'); expect(entrante.getAttribute('data-plan-s')).toBe('0.000'); }
        if (canvas) { vuCanvas = true; expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(540); }
      }
      expect(vuCanvas, 'la séquence Vidéo est peinte dans le canvas d’aperçu').toBe(true);
      if (k === 'FINANCE') expect(vuEntrante, 'transition Cartes → Vidéo observée').toBe(true);
      expect(vus.has('video')).toBe(true);
      // Plein écran (profil non dynamique) : titre, cartes, vidéo… ; surimpression (danse) : la vidéo seule.
      expect(vus.size).toBeGreaterThanOrEqual(k === 'FINANCE' ? 3 : 1);
    }, 30000);
  }

  it('compte non admin (serveur : false) : rien ne change', async () => {
    installerFetch({ apercuPlan: false });
    poser();
    await allerAEnvoi();
    await patienter(500);
    expect(document.querySelector('[data-apercu-plan-bandeau]')).toBeNull();
    expect(sp.planMontage).not.toHaveBeenCalled();
  }, 20000);
});
