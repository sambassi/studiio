import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import { LIBELLES_SUPPORT, supportDeLut } from '@/lib/luts/support';
import type { LutAsset } from '@/lib/luts/types';

/**
 * Import d'un filtre couleur (LUT) dans « Créer avec l'assistant » — sur le
 * VRAI wizard, branché sur l'API commune de la bibliothèque (A2).
 *
 * Ce que ces tests protègent :
 * - le filtre s'annonce pour ce qu'il est (il n'étalonne QUE le rush) et dit
 *   ce qu'il fait AUJOURD'HUI (libellé de support dérivé du socle) ;
 * - un fichier illisible ne coûte aucun appel réseau ;
 * - l'envoi passe par `POST /api/creatif/luts`, jamais par signed-url ;
 * - un PNG part canonicalisé en `.cube` avec `origine=png` ;
 * - seule la référence CANONIQUE (empreinte, nom, intensité) part dans le
 *   brouillon ; elle est restaurée au rechargement ;
 * - les refus de l'API sont dits en français.
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
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

// Le décodeur d'image du navigateur n'existe pas en jsdom : doublé par une
// HALD de niveau 2 (8×8, cube de 4). Le reste du module est le vrai.
vi.mock('@/lib/luts/import', async () => {
  const actual = await vi.importActual<typeof import('@/lib/luts/import')>('@/lib/luts/import');
  return {
    ...actual,
    decodeImageInBrowser: async () => {
      const width = 8; const cube = 4;
      const data = new Uint8ClampedArray(width * width * 4);
      for (let i = 0; i < width * width; i++) {
        data[i * 4] = Math.round(((i % cube) / 3) * 255);
        data[i * 4 + 1] = Math.round(((Math.floor(i / cube) % cube) / 3) * 255);
        data[i * 4 + 2] = Math.round((Math.floor(i / (cube * cube)) / 3) * 255);
        data[i * 4 + 3] = 255;
      }
      return { data, width, height: width };
    },
  };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const KEY = draftKey('a@b.c');
const E = 'c'.repeat(64);

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
const CURVE_1D = 'LUT_1D_SIZE 3\n0 0 0\n0.5 0.5 0.5\n1 1 1\n';

const asset = (over: Partial<LutAsset> = {}): LutAsset => ({
  empreinte: E, cle: `u/lut/${E}.cube`, nom: 'teal', titre: null, kind: '3d', origine: 'cube',
  taille: 2, octets: 100, domainMin: [0, 0, 0], domainMax: [1, 1, 1], importeeLe: '2026-09-14T00:00:00.000Z',
  ...over,
});

const cubeFile = (text = IDENTITY_2, name = 'teal.cube') => new File([text], name, { type: '' });

/** L'API commune doublée : chaque POST est journalisé (fichier lu, origine). */
interface Poste { nom: string; texte: string; origine: string }
let postes: Poste[];
let reponsePost: () => { status: number; corps: unknown };
let bibliotheque: LutAsset[];
let getCasse: boolean;
let signedUrlAppels: number;

function stubApi() {
  postes = [];
  bibliotheque = [];
  getCasse = false;
  signedUrlAppels = 0;
  reponsePost = () => ({ status: 201, corps: { ok: true, issue: 'creee', lut: asset(), avertissement: 'Pour un rendu fidèle, utilisez une LUT conçue pour le profil couleur de votre vidéo.' } });
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/upload/signed-url')) {
      signedUrlAppels += 1;
      return { ok: true, status: 200, json: async () => ({ success: true, signedUrl: 'x', publicUrl: 'y' }) } as unknown as Response;
    }
    if (u.includes('/api/creatif/luts') && init?.method === 'POST') {
      const form = init.body as FormData;
      const f = form.get('fichier') as File;
      postes.push({ nom: f.name, texte: await f.text(), origine: String(form.get('origine')) });
      const r = reponsePost();
      return { ok: r.status < 400, status: r.status, json: async () => r.corps } as unknown as Response;
    }
    if (u.includes('/api/creatif/luts')) {
      if (getCasse) throw new Error('réseau');
      return { ok: true, status: 200, json: async () => ({ ok: true, luts: bibliotheque }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

const styleStepDraft = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: DRAFT_VERSION, savedAt: 1, started: true, step: 1, ...extra });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(KEY, styleStepDraft());
  stubApi();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = async () => {
  await act(async () => { vi.advanceTimersByTime(600); });
};

async function openAmbiance() {
  render(<AssistantWizard />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: /Ambiance/i }));
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"][accept*=".cube"]');
  if (!input) throw new Error('champ de fichier introuvable');
  return input as HTMLInputElement;
}

async function chooseFile(file: File) {
  await act(async () => { fireEvent.change(fileInput(), { target: { files: [file] } }); });
  await settle();
}

const section = () => within(document.getElementById('section-ambiance')!);
const draftLut = () => JSON.parse(window.localStorage.getItem(KEY)!).lut;

describe('Import d’un filtre couleur', () => {
  it('propose l’import, dit que le filtre ne touche que le rush, et n’accepte que .cube/.png', async () => {
    await openAmbiance();
    expect(section().getByText(/Importer un filtre/i)).toBeDefined();
    expect(section().getByText(/rush/i)).toBeDefined();
    expect(fileInput().accept).toMatch(/\.cube/);
    expect(fileInput().accept).toMatch(/\.png/);
  });

  it('⚠️ un .cube 3D part vers l’API commune, jamais vers signed-url ; nom et intensité affichés', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText('teal')).toBeDefined());
    expect(postes).toHaveLength(1);
    expect(postes[0].origine).toBe('cube');
    expect(postes[0].texte).toBe(IDENTITY_2);
    expect(signedUrlAppels).toBe(0);
    expect((screen.getByLabelText(/Intensité du filtre/i) as HTMLInputElement).value).toBe('1');
  });

  it('un .cube 1D est importé', async () => {
    reponsePost = () => ({ status: 201, corps: { ok: true, issue: 'creee', lut: asset({ kind: '1d', nom: 'gamma', taille: 3 }) } });
    await openAmbiance();
    await chooseFile(cubeFile(CURVE_1D, 'gamma.cube'));
    await waitFor(() => expect(section().getByText('gamma')).toBeDefined());
    expect(postes[0].texte).toBe(CURVE_1D);
  });

  it('⚠️ un PNG part canonicalisé en .cube, avec origine png', async () => {
    reponsePost = () => ({ status: 201, corps: { ok: true, issue: 'creee', lut: asset({ nom: 'Cinema', origine: 'png', taille: 4 }) } });
    await openAmbiance();
    await chooseFile(new File([new Uint8Array([1, 2, 3])], 'Cinema.png', { type: 'image/png' }));
    await waitFor(() => expect(section().getByText('Cinema')).toBeDefined());
    expect(postes).toHaveLength(1);
    expect(postes[0].origine).toBe('png');
    expect(postes[0].nom).toBe('Cinema.cube');
    expect(postes[0].texte).toContain('LUT_3D_SIZE 4');
    expect(postes[0].texte).toContain('TITLE "Cinema"');
  });

  it('⚠️ dit ce que le filtre fait aujourd’hui — le libellé vient du socle, pas d’une promesse', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText('teal')).toBeDefined());
    const libelle = document.querySelector('[data-lut-support]')!.textContent;
    expect(libelle).toBe(LIBELLES_SUPPORT[supportDeLut('3d')]);
    // Aujourd'hui aucun moteur ne consomme une LUT importée : pas de « appliquée au montage ».
    expect(libelle).not.toMatch(/^Appliquée au montage/);
  });

  it('« existante » : la fiche de la bibliothèque et son nom sont repris, avec une note', async () => {
    reponsePost = () => ({ status: 200, corps: { ok: true, issue: 'existante', lut: asset({ nom: 'Déjà là' }) } });
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText('Déjà là')).toBeDefined());
    expect(section().getByText(/déjà dans votre bibliothèque/i)).toBeDefined();
  });

  it('conserve l’intensité réglée, puis retire le filtre et rend la main à l’import', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText('teal')).toBeDefined());
    fireEvent.change(screen.getByLabelText(/Intensité du filtre/i), { target: { value: '0.4' } });
    await settle();
    expect((screen.getByLabelText(/Intensité du filtre/i) as HTMLInputElement).value).toBe('0.4');
    expect(draftLut().intensite).toBe(0.4);

    fireEvent.click(screen.getByRole('button', { name: /Retirer/i }));
    await settle();
    expect(section().queryByText('teal')).toBeNull();
    expect(section().getByText(/Importer un filtre/i)).toBeDefined();
    expect(draftLut()).toBeUndefined();
  });

  it('prévient quand aucun rush n’est encore importé', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText(/Aucun rush pour l.instant/i)).toBeDefined());
  });
});

describe('Ce qui doit échouer proprement', () => {
  it('⚠️ un fichier illisible est refusé AVANT tout appel réseau', async () => {
    await openAmbiance();
    await chooseFile(cubeFile('LUT_3D_SIZE 2\n0 0 0\n', 'casse.cube'));
    await waitFor(() => expect(screen.getByText(/8 triplets/)).toBeDefined());
    expect(section().queryByText('casse.cube')).toBeNull();
    expect(postes).toHaveLength(0);
    expect(signedUrlAppels).toBe(0);
  });

  it('> 8 Mio est refusé avant tout appel', async () => {
    await openAmbiance();
    const big = cubeFile('x', 'gros.cube');
    Object.defineProperty(big, 'size', { value: 8 * 1024 * 1024 + 1 });
    await chooseFile(big);
    await waitFor(() => expect(screen.getByText(/trop lourd/i)).toBeDefined());
    expect(postes).toHaveLength(0);
  });

  it('nomme les formats acceptés quand l’extension est inconnue', async () => {
    await openAmbiance();
    await chooseFile(new File(['x'], 'look.3dl', { type: '' }));
    await waitFor(() => expect(screen.getByText(/Format non pris en charge.*look\.3dl.*\.cube et \.png/)).toBeDefined());
  });

  it('bibliothèque pleine (409) : message clair, aucun filtre retenu', async () => {
    reponsePost = () => ({ status: 409, corps: { ok: false, motif: 'bibliotheque_pleine', error: 'Votre bibliothèque contient déjà 40 LUT. Supprimez-en une pour en importer une autre.' } });
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(screen.getByText(/déjà 40 LUT/)).toBeDefined());
    expect(section().getByText(/Importer un filtre/i)).toBeDefined();
    expect(draftLut()).toBeUndefined();
  });

  it('erreur serveur (500) : message en français, rien de retenu', async () => {
    reponsePost = () => ({ status: 500, corps: { ok: false, motif: 'ecriture_impossible' } });
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(screen.getByText(/Réessayez/)).toBeDefined());
    expect(draftLut()).toBeUndefined();
  });

  it('après un refus, le même fichier peut être resélectionné et réussir', async () => {
    let n = 0;
    reponsePost = () => (n++ === 0
      ? { status: 500, corps: { ok: false } }
      : { status: 201, corps: { ok: true, issue: 'creee', lut: asset() } });
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(screen.getByText(/Réessayez/)).toBeDefined());
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText('teal')).toBeDefined());
    expect(postes).toHaveLength(2);
  });
});

describe('Brouillon', () => {
  it('⚠️ n’y écrit que la référence canonique : ni table, ni URL, ni clé', async () => {
    await openAmbiance();
    await chooseFile(cubeFile());
    await waitFor(() => expect(section().getByText('teal')).toBeDefined());
    await settle();
    const raw = window.localStorage.getItem(KEY)!;
    expect(raw).not.toContain('LUT_3D_SIZE');
    expect(raw).not.toMatch(/data:|https?:\/\/|\/lut\//);
    expect(draftLut()).toEqual({ empreinte: E, nom: 'teal', intensite: 1 });
  });

  it('restaure la référence, retrouve sa nature dans la bibliothèque, et affiche le support', async () => {
    bibliotheque = [asset({ kind: '1d', nom: 'gamma' })];
    window.localStorage.setItem(KEY, styleStepDraft({ lut: { empreinte: E, nom: 'gamma', intensite: 0.35 } }));
    await openAmbiance();
    expect(section().getByText('gamma')).toBeDefined();
    expect((screen.getByLabelText(/Intensité du filtre/i) as HTMLInputElement).value).toBe('0.35');
    await waitFor(() => expect(document.querySelector('[data-lut-support]')!.textContent)
      .toBe(LIBELLES_SUPPORT[supportDeLut('1d')]));
  });

  it('une référence dont la LUT a disparu de la bibliothèque est retirée', async () => {
    bibliotheque = [];
    window.localStorage.setItem(KEY, styleStepDraft({ lut: { empreinte: E, nom: 'fantôme', intensite: 1 } }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await openAmbiance();
    await waitFor(() => expect(section().queryByText('fantôme')).toBeNull());
    expect(section().getByText(/Importer un filtre/i)).toBeDefined();
    warn.mockRestore();
  });

  it('bibliothèque injoignable : la référence est gardée, avec le statut le plus prudent', async () => {
    getCasse = true;
    window.localStorage.setItem(KEY, styleStepDraft({ lut: { empreinte: E, nom: 'teal', intensite: 1 } }));
    await openAmbiance();
    await settle();
    expect(section().getByText('teal')).toBeDefined();
    expect(document.querySelector('[data-lut-support]')!.textContent).toBe(LIBELLES_SUPPORT['unsupported-render']);
  });

  it('⚠️ un ancien brouillon { url, name, intensity } ne fait apparaître aucun filtre', async () => {
    window.localStorage.setItem(KEY, styleStepDraft({ lut: { url: 'https://minio.example/luts/teal.cube', name: 'teal.cube', intensity: 1 } }));
    await openAmbiance();
    await settle();
    expect(section().getByText(/Importer un filtre/i)).toBeDefined();
    expect(draftLut()).toBeUndefined();
  });

  it('un brouillon sans filtre n’en fait pas apparaître', async () => {
    await openAmbiance();
    await settle();
    expect(section().getByText(/Importer un filtre/i)).toBeDefined();
    expect(draftLut()).toBeUndefined();
  });
});
