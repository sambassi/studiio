/**
 * M3-a PR2 — essai A/B admin dans Créer (wizard monté, réseau simulé).
 *
 * B (« passages ») ne change QUE l'appel à `planMontage` ; le chemin de
 * facturation est identique (corps exact `{ operation, format }`), aucun post,
 * aucun débit après coup, aucun PATCH. Sélecteur absent sans autorisation du
 * serveur et en mode Modifier ; méthode jamais persistée.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

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

const { RUSH_A, RUSH_B } = vi.hoisted(() => ({
  RUSH_A: 'https://studiio.pro/storage/v1/object/public/media/u1/converted_1791985445290.mp4',
  RUSH_B: 'https://studiio.pro/storage/v1/object/public/media/u1/stock-pexels-video-34521342.mp4',
}));
const sp = vi.hoisted(() => ({
  planMontage: vi.fn(),
  composeVideo: vi.fn(),
  downloadBlob: vi.fn(async () => {}),
}));
vi.mock('@/lib/creer/analyse-rush', async () => {
  const fixture = (await import('./fixtures/passages-rushes-reels.json')).default;
  const rushes = (fixture as unknown as { rushes: Array<{ url: string }> }).rushes;
  const parUrl: Record<string, unknown> = {
    [RUSH_A]: { ...rushes[0], url: RUSH_A, pisteAudio: true, silences: [[0, 10.25], [11.9, 12.35], [14.5, 15.25], [15.65, 16.45], [18.75, 19.7], [20.1, 32]], sonContinu: false },
    [RUSH_B]: { ...rushes[2], url: RUSH_B, pisteAudio: false },
  };
  return {
    analyserRushMemo: async (url: string) => parUrl[url] ?? null,
    analyserMusiqueNavigateur: async () => null,
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

const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Danse du matin', subtitle: 'Bouger',
  cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois', value: '3' }, { icon: 'Zap', title: 'Bouger', description: 'Cinq', value: '5' }],
};

let appels: Array<{ m: string; u: string; corps: unknown }>;
let n = 0;
function installerFetch(passages: unknown) {
  appels = []; n = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url); const m = String(init?.method ?? 'GET').toUpperCase();
    let corps: unknown = null;
    try { corps = init?.body ? JSON.parse(String(init.body)) : null; } catch { corps = '<binaire>'; }
    appels.push({ m, u, corps });
    const rep = (c: unknown, status = 200) => ({ ok: status < 300, status, json: async () => c } as Response);
    if (u.includes('/api/creer/montage-config')) return passages instanceof Error ? Promise.reject(passages) : rep(passages);
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'partner_cost_only', balance: null });
    if (u.endsWith('/api/render/jobs') && m === 'POST') { n += 1; return rep({ ok: true, jobId: `job-${n}`, uploadUrl: `/api/render/jobs/job-${n}/upload`, uploadMode: 'relais', publicUrl: `https://studiio.pro/storage/v1/object/public/media/u1/rendus/job-${n}.webm`, cout: 10 }); }
    if (/\/api\/render\/jobs\/job-\d+\/upload/.test(u)) return rep({});
    if (/\/api\/render\/jobs\/job-\d+\/confirm/.test(u)) return rep({ ok: true, politique: 'partner_cost_only', balance: null });
    if (m === 'GET' && /\/api\/social\/(status|zernio\/accounts)$/.test(u.split('?')[0])) return rep({ success: true, platforms: {}, channels: {}, autorise: false, comptes: [] });
    return rep({ success: true });
  }) as unknown as typeof fetch;
}

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
const allerAEnvoi = async (query = '') => {
  urlQuery = new URLSearchParams(query);
  render(<AssistantWizard />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  for (let i = 0; i < 4; i += 1) {
    if (document.querySelector('[data-batch-mode="unique"]')) break;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
  }
  await attendre(10);
};
const choisir = async (m: 'A' | 'B') => { await act(async () => { fireEvent.click(document.querySelector(`[data-methode-choix="${m}"]`)!); }); };
/** Laisse le parcours se dérouler ; accepte la vidéo plus courte (#504) si elle est proposée. */
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
const reservations = () => appels.filter((a) => a.u.endsWith('/api/render/jobs') && a.m === 'POST');
const optionsPlan = () => sp.planMontage.mock.calls.map((c) => c[2] as Record<string, unknown>);

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  sp.planMontage.mockClear(); sp.composeVideo.mockClear(); sp.downloadBlob.mockClear();
});
afterEach(() => { cleanup(); });

describe('12. sans autorisation du serveur : rien ne change', () => {
  for (const reponse of [{ passages: false }, { success: true }, new Error('réseau')]) {
    it(`config ${reponse instanceof Error ? 'injoignable' : JSON.stringify(reponse)} ⇒ sélecteur absent, planMontage appelé comme avant`, async () => {
      installerFetch(reponse); poser();
      await allerAEnvoi();
      expect(document.querySelector('[data-methode-montage]')).toBeNull();
      await telecharger();
      expect(sp.planMontage).toHaveBeenCalledTimes(1);
      expect(Object.keys(optionsPlan()[0]).sort()).toEqual(['contexte', 'rythme']);
      expect(sp.downloadBlob).toHaveBeenCalledTimes(1);
    });
  }
});

describe('13–19. administrateur autorisé', () => {
  it('13. défaut A ; la méthode n\'est jamais persistée (rechargement ⇒ A)', async () => {
    installerFetch({ passages: true }); poser();
    await allerAEnvoi();
    expect(document.querySelector('[data-methode-montage]')?.getAttribute('data-methode-montage')).toBe('A');
    await choisir('B');
    expect(document.querySelector('[data-methode-montage]')?.getAttribute('data-methode-montage')).toBe('B');
    await attendre(5);
    expect(JSON.stringify(Object.fromEntries(Object.keys(window.localStorage).map((k) => [k, window.localStorage.getItem(k)])))).not.toMatch(/methode|passages/i);
    cleanup();
    await allerAEnvoi();
    expect(document.querySelector('[data-methode-montage]')?.getAttribute('data-methode-montage')).toBe('A');
  });

  it('14. Bureau A puis B : 2 réservations au corps EXACT { operation, format }, 2 confirmations, 0 post / débit / PATCH, 2 fichiers', async () => {
    installerFetch({ passages: true }); poser();
    await allerAEnvoi();
    await telecharger();
    await choisir('B');
    await telecharger();
    expect(reservations().map((a) => a.corps)).toEqual([{ operation: 'bureau', format: 'reel' }, { operation: 'bureau', format: 'reel' }]);
    expect(appels.filter((a) => /\/confirm$/.test(a.u)).length).toBe(2);
    expect(appels.filter((a) => a.u.includes('/api/posts')).length).toBe(0);
    expect(appels.filter((a) => a.u.includes('/api/credits/deduct')).length).toBe(0);
    expect(appels.filter((a) => a.m === 'PATCH').length).toBe(0);
    expect(appels.some((a) => JSON.stringify(a.corps ?? '').match(/methode|passages/))).toBe(false);
    expect(sp.downloadBlob).toHaveBeenCalledTimes(2);
    const [a, b] = optionsPlan();
    expect('selection' in a).toBe(false);
    expect(b.selection).toBe('passages');
    expect(Object.keys(b.entreesPassages as object).length).toBe(2);
    // B ne change que la sélection : mêmes rythme et contexte.
    expect(b.contexte).toEqual(a.contexte);
    expect(b.rythme).toEqual(a.rythme);
  });

  it('15. Aperçu en B puis Bureau en A : nouvelle tentative (aucune réutilisation croisée)', async () => {
    installerFetch({ passages: true }); poser();
    await allerAEnvoi();
    await choisir('B');
    const voir = screen.queryAllByRole('button', { name: /Voir le rendu/ })[0];
    expect(voir).toBeTruthy();
    await act(async () => { fireEvent.click(voir); });
    await derouler();
    expect(reservations().map((a) => a.corps)).toEqual([{ operation: 'apercu', format: 'reel' }]);
    const avant = reservations().length;
    await choisir('A');
    await telecharger();
    expect(reservations().length).toBe(avant + 1);
  });

  it('16. B : « Composer et envoyer » (Calendrier) désactivé, aucun POST /api/posts possible', async () => {
    installerFetch({ passages: true }); poser();
    await allerAEnvoi();
    await choisir('B');
    const envoi = document.querySelector('[data-envoi-action]') as HTMLButtonElement;
    expect(envoi.disabled).toBe(true);
    await act(async () => { fireEvent.click(envoi); });
    await attendre(20);
    expect(appels.filter((a) => a.u.includes('/api/posts')).length).toBe(0);
    expect(reservations().length).toBe(0);
  });

  it('18. double clic sur l\'export B : une seule tentative', async () => {
    installerFetch({ passages: true }); poser();
    await allerAEnvoi();
    await choisir('B');
    const b = document.querySelector('[data-export-bureau]')!;
    await act(async () => { fireEvent.click(b); fireEvent.click(b); });
    await derouler();
    expect(sp.downloadBlob).toHaveBeenCalledTimes(1);
    expect(reservations().length).toBe(1);
  });
});

describe('17. mode Modifier', () => {
  it('sélecteur absent et aucune demande de configuration', async () => {
    installerFetch({ passages: true }); poser();
    await allerAEnvoi('postId=post-1');
    expect(document.querySelector('[data-methode-montage]')).toBeNull();
    expect(appels.filter((a) => a.u.includes('/api/creer/montage-config')).length).toBe(0);
  });
});

describe('17 bis & 19. réutilisation à l\'enregistrement et clé du plan (sources)', () => {
  it('cleMontage : A = clé d\'avant à l\'identique, B = clé distincte', async () => {
    const { cleMontage } = await vi.importActual<typeof import('@/lib/creer/smart-montage')>('@/lib/creer/smart-montage');
    expect(cleMontage([RUSH_A, RUSH_B], 12)).toBe(`${RUSH_A}|${RUSH_B}@12`);
    expect(cleMontage([RUSH_A, RUSH_B], 12, 'A')).toBe(cleMontage([RUSH_A, RUSH_B], 12));
    expect(cleMontage([RUSH_A, RUSH_B], 12, 'B')).not.toBe(cleMontage([RUSH_A, RUSH_B], 12));
  });
  it('les 2 occurrences de cleMontage( portent la méthode ; l\'enregistrement ne réutilise QU\'un plan A ; runRender bloque Calendrier en B et tout rendu en Modifier', async () => {
    const { readFileSync } = await import('fs');
    const aw = readFileSync('src/app/dashboard/creer/AssistantWizard.tsx', 'utf8');
    const occ = aw.split('\n').filter((l) => l.includes('cleMontage(') && !l.includes('import '));
    expect(occ).toHaveLength(2);
    expect(occ[0]).toMatch(/cibleEcran, methodeB \? 'B' : 'A'\)/);
    expect(occ[1]).toMatch(/seqDuration\('video'\), 'A'\)/);
    expect(aw).toMatch(/planMontageRef\.current\?\.methode === 'A' && planMontageRef\.current\.cle === cleMontage\(/);
    expect(aw).toMatch(/if \(editPostId\) return;\s*if \(!generated \|\| sending\) return;\s*\/\/[^\n]*\n\s*if \(methodeB && destination === 'calendrier'\) return;/);
    expect(aw).toMatch(/const methodeB = methodeBDisponible && !editPostId && methodeMontage === 'B';/);
    expect(aw).not.toMatch(/montage-passages-config|montagePassagesActif|NEXT_PUBLIC_STUDIIO_MONTAGE/);
  });
});
