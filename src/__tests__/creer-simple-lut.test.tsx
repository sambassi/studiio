import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';

/**
 * Import d'un filtre couleur (LUT) dans « Créer avec l'assistant ».
 *
 * Testé sur le VRAI wizard, pas sur son source : une expression régulière
 * sur un fichier vérifie la présence de lignes, pas un comportement — et
 * reste verte quand le produit est cassé.
 *
 * Ce que ces tests protègent :
 * - le filtre s'annonce pour ce qu'il est (il n'étalonne QUE le rush) ;
 * - un fichier illisible ne laisse aucune trace ;
 * - seule la référence part dans le brouillon, jamais le fichier ;
 * - le réglage survit à un rafraîchissement.
 *
 * Phase 1 : le réglage est enregistré et restauré, rien de plus. Ni l'aperçu
 * ni l'export ne le lisent encore.
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

const sessionState: { data: unknown; status: string } = {
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

const KEY = draftKey('a@b.c');
const PUBLIC_URL = '/storage/v1/object/public/media/u/lut/1-teal.cube';

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
  new File([text], name, { type: '' });

/**
 * Flux d'URL signée, tel que le renvoie `/api/upload/signed-url`, et le PUT
 * XHR qui suit (`uploadFile` passe par `XMLHttpRequest` pour la progression).
 */
function stubUpload() {
  const fetchMock = vi.fn(async (url: unknown) => {
    if (String(url).includes('/api/upload/signed-url')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          signedUrl: 'https://minio.example/put',
          publicUrl: PUBLIC_URL,
          path: 'u/lut/1-teal.cube',
          bucket: 'media',
          mode: 'proxy',
        }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  globalThis.XMLHttpRequest = class {
    upload = { onprogress: null };
    status = 200;
    responseText = '';
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    withCredentials = false;
    open() {}
    setRequestHeader() {}
    send() {
      setTimeout(() => this.onload?.(), 0);
    }
  } as unknown as typeof XMLHttpRequest;
  return fetchMock;
}

/** Brouillon minimal, à l'étape Style, là où vit le réglage. */
const styleStepDraft = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: DRAFT_VERSION, savedAt: 1, started: true, step: 1, ...extra });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(KEY, styleStepDraft());
  stubUpload();
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

const section = () => within(document.getElementById('section-ambiance')!);

describe('Import d’un filtre couleur', () => {
  it('propose l’import et dit que le filtre ne touche que le rush', async () => {
    await openAmbiance();
    expect(section().getByText(/Importer un filtre/i)).toBeDefined();
    // Sans cette mention, l'utilisateur attend un étalonnage du montage entier
    // et croit le filtre cassé quand le titre garde ses couleurs.
    expect(section().getByText(/rush/i)).toBeDefined();
  });

  it('n’accepte que les formats lisibles', async () => {
    await openAmbiance();
    expect(fileInput().accept).toMatch(/\.cube/);
    expect(fileInput().accept).toMatch(/\.png/);
  });

  it('affiche le nom du filtre importé et son réglage d’intensité', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());

    await waitFor(() => expect(section().getByText('teal.cube')).toBeDefined());
    const slider = screen.getByLabelText(/Intensité du filtre/i) as HTMLInputElement;
    expect(slider.value).toBe('1');
  });

  it('conserve l’intensité réglée', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText('teal.cube')).toBeDefined());

    const slider = screen.getByLabelText(/Intensité du filtre/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.4' } });
    await settle();
    expect((screen.getByLabelText(/Intensité du filtre/i) as HTMLInputElement).value).toBe('0.4');
  });

  it('retire le filtre et rend la main à l’import', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText('teal.cube')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Retirer/i }));
    await settle();
    expect(section().queryByText('teal.cube')).toBeNull();
    expect(section().getByText(/Importer un filtre/i)).toBeDefined();
  });

  it('prévient quand aucun rush n’est encore importé', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText(/Aucun rush pour l.instant/i)).toBeDefined());
  });
});

describe('Import d’un filtre — ce qui doit échouer proprement', () => {
  it('refuse un fichier illisible sans rien téléverser', async () => {
    const fetchMock = stubUpload();
    await openAmbiance();
    // `.cube` tronqué : la taille est annoncée, les triplets manquent.
    await chooseFile(cubeFile('LUT_3D_SIZE 2\n0 0 0\n', 'casse.cube'));

    await waitFor(() => expect(screen.getByText(/8 triplets/)).toBeDefined());
    expect(section().queryByText('casse.cube')).toBeNull();
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
    await waitFor(() => expect(section().getByText('teal.cube')).toBeDefined());
    await settle();

    const raw = window.localStorage.getItem(KEY)!;
    expect(raw).not.toContain('LUT_3D_SIZE');
    expect(raw).not.toContain('data:');
    const draft = JSON.parse(raw);
    expect(draft.lut).toEqual({ url: PUBLIC_URL, name: 'teal.cube', intensity: 1 });
  });

  it('restaure le filtre et son intensité au rechargement', async () => {
    window.localStorage.setItem(
      KEY,
      styleStepDraft({ lut: { url: PUBLIC_URL, name: 'teal.cube', intensity: 0.35 } }),
    );
    await openAmbiance();

    expect(section().getByText('teal.cube')).toBeDefined();
    expect((screen.getByLabelText(/Intensité du filtre/i) as HTMLInputElement).value).toBe('0.35');
  });

  it('un brouillon sans filtre n’en fait pas apparaître', async () => {
    await openAmbiance();
    await settle();
    expect(section().getByText(/Importer un filtre/i)).toBeDefined();
    expect(JSON.parse(window.localStorage.getItem(KEY)!).lut).toBeUndefined();
  });

  it('le retrait du filtre l’efface aussi du brouillon', async () => {
    window.localStorage.setItem(
      KEY,
      styleStepDraft({ lut: { url: PUBLIC_URL, name: 'teal.cube', intensity: 1 } }),
    );
    await openAmbiance();
    fireEvent.click(screen.getByRole('button', { name: /Retirer/i }));
    await settle();
    expect(JSON.parse(window.localStorage.getItem(KEY)!).lut).toBeUndefined();
  });
});
