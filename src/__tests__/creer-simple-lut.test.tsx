import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';

/**
 * Import d'un filtre couleur (LUT) dans « Créer (simple) ».
 *
 * Testé sur le VRAI wizard, pas sur son source : la leçon du 2026-07-30 est
 * qu'une expression régulière sur un fichier vérifie la présence de lignes,
 * pas un comportement — et reste verte quand le produit est cassé.
 *
 * Ce que ces tests protègent :
 * - le filtre s'annonce pour ce qu'il est (il n'étalonne QUE le rush) ;
 * - un fichier illisible ne laisse aucune trace ;
 * - seule la référence part dans le brouillon, jamais le fichier.
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

let sessionState: { data: unknown; status: string } = {
  data: { user: { email: 'a@b.c' } },
  status: 'authenticated',
};

vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>(
    '@/lib/fonts/catalog',
  );
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';
import { clearLutCache } from '../lib/luts/load';

const KEY = draftKey('a@b.c');

const IDENTITY_2 = `LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

const cubeFile = (text = IDENTITY_2, name = 'teal.cube') =>
  new File([text], name, { type: 'application/octet-stream' });

/** Flux d'URL signée, tel que le renvoie `/api/upload/signed-url`. */
function stubUpload() {
  const fetchMock = vi.fn(async (url: unknown) => {
    if (String(url).includes('/api/upload/signed-url')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          signedUrl: 'https://minio.example/put',
          publicUrl: 'https://minio.example/luts/teal.cube',
        }),
      } as unknown as Response;
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
  // Le parcours reprend directement à l'étape Style, là où vit le réglage.
  window.localStorage.setItem(
    KEY,
    JSON.stringify({ version: DRAFT_VERSION, savedAt: 1, started: true, step: 1 }),
  );
  stubUpload();
  clearLutCache();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
};

/** Monte le wizard à l'étape Style et déplie la section « Ambiance ». */
async function openAmbiance() {
  render(<AssistantWizard />);
  await settle();
  const header = screen.getByRole('button', { name: /Ambiance/i });
  fireEvent.click(header);
  return header;
}

/** Le champ de fichier est masqué : on le pilote directement. */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"][accept*=".cube"]');
  if (!input) throw new Error('champ de fichier introuvable');
  return input as HTMLInputElement;
}

async function chooseFile(file: File) {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } });
  });
  await settle();
}

describe('Import d’un filtre couleur', () => {
  it('propose l’import et dit que le filtre ne touche que le rush', async () => {
    await openAmbiance();
    const section = within(document.getElementById('section-ambiance')!);
    expect(section.getByText(/Importer un filtre/i)).toBeDefined();
    // Sans cette mention, l'utilisateur attend un étalonnage du montage entier
    // et croit le filtre cassé quand le titre garde ses couleurs.
    expect(section.getByText(/rush/i)).toBeDefined();
  });

  it('n’accepte que les formats lisibles', async () => {
    await openAmbiance();
    expect(fileInput().accept).toMatch(/\.cube/);
    expect(fileInput().accept).toMatch(/\.png/);
  });

  it('affiche le nom du filtre importé et son réglage d’intensité', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());

    await waitFor(() => expect(screen.getByText('teal.cube')).toBeDefined());
    const slider = screen.getByLabelText(/Intensité/i) as HTMLInputElement;
    expect(slider.value).toBe('1');
  });

  it('conserve l’intensité réglée', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(screen.getByText('teal.cube')).toBeDefined());

    const slider = screen.getByLabelText(/Intensité/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.4' } });
    await settle();
    expect((screen.getByLabelText(/Intensité/i) as HTMLInputElement).value).toBe('0.4');
  });

  it('retire le filtre et rend la main à l’import', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(screen.getByText('teal.cube')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Retirer/i }));
    await settle();
    expect(screen.queryByText('teal.cube')).toBeNull();
    expect(screen.getByText(/Importer un filtre/i)).toBeDefined();
  });
});

describe('Import d’un filtre — ce qui doit échouer proprement', () => {
  it('refuse un fichier illisible sans rien téléverser', async () => {
    const fetchMock = stubUpload();
    await openAmbiance();
    // `.cube` tronqué : la taille est annoncée, les triplets manquent.
    await chooseFile(cubeFile('LUT_3D_SIZE 2\n0 0 0\n', 'casse.cube'));

    await waitFor(() => expect(screen.getByText(/8 triplets/)).toBeDefined());
    expect(screen.queryByText('casse.cube')).toBeNull();
    const uploads = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/upload/signed-url'),
    );
    expect(uploads).toHaveLength(0);
  });

  it('nomme les formats acceptés quand l’extension est inconnue', async () => {
    await openAmbiance();
    await chooseFile(new File(['x'], 'look.3dl', { type: '' }));
    // Le message doit nommer le fichier fautif ET les formats qui marchent :
    // « format non pris en charge » seul laisse l'utilisateur sans issue.
    await waitFor(() =>
      expect(
        screen.getByText(/Format non pris en charge.*look\.3dl.*\.cube et \.png/),
      ).toBeDefined(),
    );
  });
});

describe('Brouillon', () => {
  it('n’y écrit que la référence, jamais le fichier', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(screen.getByText('teal.cube')).toBeDefined());
    await settle();

    const raw = window.localStorage.getItem(KEY)!;
    expect(raw).not.toContain('LUT_3D_SIZE');
    expect(raw).not.toContain('data:');
    const draft = JSON.parse(raw);
    expect(draft.lut.url).toBe('https://minio.example/luts/teal.cube');
    expect(draft.lut.name).toBe('teal.cube');
    expect(draft.lut.intensity).toBe(1);
  });
});

/**
 * Aperçu.
 *
 * Le réglage ne vaut que s'il se voit AVANT l'export : régler une intensité
 * à l'aveugle puis découvrir le résultat dans une vidéo rendue, c'est
 * demander à l'utilisateur de deviner.
 */
describe('Aperçu étalonné', () => {
  /** Brouillon complet : un rush ET un filtre, comme après la phase 1. */
  const seedWithRushAndLut = () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: DRAFT_VERSION,
        savedAt: 1,
        started: true,
        step: 1,
        rushUrl: 'https://minio.example/rushes/r.mp4',
        rushName: 'r.mp4',
        sequences: [
          { key: 'intro', enabled: true },
          { key: 'cards', enabled: true },
          { key: 'video', enabled: true },
          { key: 'cta', enabled: true },
        ],
        videoDuration: 6,
        lut: { url: 'https://minio.example/luts/teal.cube', name: 'teal.cube', intensity: 1 },
      }),
    );
  };

  /** Le fichier de LUT revient par le proxy — jamais en direct (CORS). */
  function stubLutFetch(body: { ok: boolean; text?: string }) {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/api/proxy-media')) {
        return {
          ok: body.ok,
          status: body.ok ? 200 : 404,
          text: async () => body.text ?? '',
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({}) } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('charge le filtre par le proxy et pose une surface étalonnée sur le rush', async () => {
    seedWithRushAndLut();
    const fetchMock = stubLutFetch({ ok: true, text: IDENTITY_2 });

    render(<AssistantWizard />);
    await settle();

    await waitFor(() => expect(document.querySelector('canvas')).toBeTruthy());
    // En direct sur MinIO, la requête se prendrait le CORS.
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/proxy-media?url=')),
    ).toBe(true);
  });

  it('n’étalonne rien quand le filtre est illisible, et laisse l’aperçu debout', async () => {
    // Un filtre perdu ne doit pas emporter l'aperçu avec lui : le rush
    // continue de s'afficher, simplement sans étalonnage.
    seedWithRushAndLut();
    stubLutFetch({ ok: false });

    render(<AssistantWizard />);
    await settle();
    await settle();

    expect(document.querySelector('canvas')).toBeNull();
    expect(document.querySelector('video')).toBeTruthy();
  });
});
