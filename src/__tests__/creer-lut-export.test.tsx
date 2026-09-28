/**
 * Le filtre couleur (LUT) importé part au MONTAGE — sur le vrai wizard.
 *
 * Jusqu'ici la référence vivait dans le brouillon et l'écran, mais aucun
 * rendu ne la lisait : la vidéo sortait aux couleurs d'origine. Le wizard lit
 * désormais la table par la route authentifiée et la transmet au compositeur
 * (`rushLut`). Ces tests cliquent le vrai CTA et regardent ce que reçoit
 * `composeVideo` :
 *
 * - avec un filtre et un rush : la table lue et l'intensité sont transmises ;
 * - sans filtre : aucune clé `rushLut`, aucun appel à la bibliothèque —
 *   les options sont celles d'avant ;
 * - filtre illisible ou route en échec : on compose QUAND MÊME, sans
 *   étalonnage, et l'envoi aboutit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

let sessionState: { data: unknown; status: string };
vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({
  preRenderCardIcons: async (cards: unknown) => cards,
}));

const MONTAGE = () => new Blob([new Uint8Array(2048)], { type: 'video/webm' });
const composeVideoSpy = vi.fn(async (_o: unknown) => ({
  video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }),
}));
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: (o: unknown) => composeVideoSpy(o),
    downloadBlob: async () => {},
  };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const CLE = draftKey('a@b.c');
const E = 'd'.repeat(64);
const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/rush.mp4';
const CONTENU = {
  title: 'Yoga du matin',
  subtitle: 'Reveiller le corps',
  cards: [
    { icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' },
    { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' },
  ],
};

/** Cube 2³ qui inverse les couleurs — reconnaissable dans la table transmise. */
const INVERSE_2 = `TITLE "inverse"
LUT_3D_SIZE 2
1 1 1
0 1 1
1 0 1
0 0 1
1 1 0
0 1 0
1 0 0
0 0 0
`;

interface Scenario { lut?: 'ok' | 'illisible' | '404' | 'reseau' }
let lecturesLut: string[];

function installerFetch(sc: Scenario = {}) {
  lecturesLut = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status,
      json: async () => corps,
      text: async () => (typeof corps === 'string' ? corps : JSON.stringify(corps)),
    } as Response);

    if (u.startsWith(`/api/creatif/luts/`) && m === 'GET') {
      lecturesLut.push(u);
      if (sc.lut === 'reseau') throw new TypeError('Failed to fetch');
      if (sc.lut === '404') return rep({ ok: false, error: 'LUT introuvable' }, 404);
      if (sc.lut === 'illisible') return rep('LUT_3D_SIZE 2\n0 0 0\n');
      return rep(INVERSE_2);
    }
    if (u === '/api/creatif/luts' && m === 'GET') {
      return rep({ ok: true, luts: [{
        empreinte: E, cle: `u/lut/${E}.cube`, nom: 'inverse', titre: 'inverse', kind: '3d', origine: 'cube',
        taille: 2, octets: 100, domainMin: [0, 0, 0], domainMax: [1, 1, 1], importeeLe: '2026-09-14T00:00:00.000Z',
      }] });
    }
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      return rep({
        ok: true, jobId: 'job-1', uploadUrl: '/api/render/jobs/job-1/upload', uploadMode: 'relais',
        publicUrl: 'https://studiio.pro/storage/v1/object/public/media/u1/rendus/job-1.webm', cout: 10,
      });
    }
    if (u.includes('/jobs/job-1/upload') && m === 'PUT') return rep({});
    if (u.includes('/api/render/jobs/job-1/confirm')) return rep({ ok: true, politique: 'credits', balance: 4990 });
    if (u.includes('/api/posts') && m === 'POST') return rep({ success: true, post: { id: 'p1' } });
    if (u.includes('/api/upload/signed-url')) {
      return rep({ success: true, signedUrl: 'https://minio/vignette', publicUrl: 'https://cdn/v.jpg' });
    }
    return rep({ success: true, platforms: {}, channels: {}, autorise: false, comptes: [] });
  }) as unknown as typeof fetch;
}

const poser = (avecFiltre: boolean, intensite = 0.6) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
    rushUrl: RUSH, rushName: 'rush.mp4', videoDuration: 6,
    sequences: [
      { key: 'intro', enabled: true }, { key: 'cards', enabled: true },
      { key: 'video', enabled: true }, { key: 'cta', enabled: true },
    ],
    ...(avecFiltre ? { lut: { empreinte: E, nom: 'inverse', intensite } } : {}),
  }));
};

const allerAEnvoi = async () => {
  render(<AssistantWizard />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  for (let i = 0; i < 4; i += 1) {
    if (document.querySelector('[data-batch-mode="unique"]')) break;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
  }
  expect(document.querySelector('[data-batch-mode="unique"]')).not.toBeNull();
};

const envoyer = async () => {
  const b = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0] as HTMLButtonElement;
  expect(b).toBeTruthy();
  await act(async () => { fireEvent.click(b); });
  for (let i = 0; i < 40; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

type Options = { videoUrl?: string; rushLut?: { lut: { kind: string; size: number; table: Float32Array }; intensity: number } };
const options = () => (composeVideoSpy.mock.calls[0] as unknown[])[0] as Options;

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  composeVideoSpy.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('filtre couleur → montage', () => {
  it('⚠️ la table LUE et l’intensité partent au compositeur, avec le rush', async () => {
    installerFetch({ lut: 'ok' }); poser(true, 0.6);
    await allerAEnvoi();
    await envoyer();

    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    const o = options();
    expect(o.videoUrl).toBe(RUSH);
    // Lue par la route authentifiée de CETTE empreinte, une seule fois.
    expect(lecturesLut).toEqual([`/api/creatif/luts/${E}`]);
    expect(o.rushLut?.intensity).toBe(0.6);
    expect(o.rushLut?.lut.kind).toBe('3d');
    expect(o.rushLut?.lut.size).toBe(2);
    // Premier nœud de l'inverse : (0,0,0) → (1,1,1). La table est la vraie.
    expect(Array.from(o.rushLut!.lut.table.slice(0, 3))).toEqual([1, 1, 1]);
  });

  it('⚠️ sans filtre : aucune clé rushLut, aucune lecture de LUT', async () => {
    installerFetch({ lut: 'ok' }); poser(false);
    await allerAEnvoi();
    await envoyer();

    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    const o = options();
    expect(o.videoUrl).toBe(RUSH);
    // Pas `rushLut: undefined` : la clé est ABSENTE, les options sont celles
    // d'avant (et leur signature de cache aussi).
    expect('rushLut' in (o as object)).toBe(false);
    expect(lecturesLut).toEqual([]);
  });

  it.each([
    ['illisible', 'fichier tronqué'],
    ['404', 'filtre disparu de la bibliothèque'],
    ['reseau', 'réseau coupé'],
  ] as const)('⚠️ LUT %s (%s) : on compose quand même, sans étalonnage', async (cas, _description) => {
    installerFetch({ lut: cas }); poser(true);
    await allerAEnvoi();
    await envoyer();

    expect(lecturesLut.length).toBe(1);
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    const o = options();
    expect(o.videoUrl).toBe(RUSH);
    expect('rushLut' in (o as object)).toBe(false);
  });
});
