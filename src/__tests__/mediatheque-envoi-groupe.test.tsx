import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import type { UploadResult } from '@/lib/storage/uploadFile';

/**
 * La Médiathèque envoie PLUSIEURS fichiers — et les remet en un seul appel.
 *
 * ⚠️ CE TEST MONTE LE COMPOSANT. Le helper d'envoi est remplacé par un faux
 * qui rejoue la forme que la prod renvoie réellement : une URL publique
 * RELATIVE (`STORAGE_PROVIDER=s3`), celle que le filtre strict de
 * l'Autopilote écarterait si elle sortait telle quelle.
 */

const uploadFileMock = vi.fn<(file: File, o?: { onProgress?: (p: number) => void }) => Promise<UploadResult>>();
vi.mock('@/lib/storage/uploadFile', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/storage/uploadFile')>();
  return { ...reel, uploadFile: (file: File, o?: { onProgress?: (p: number) => void }) => uploadFileMock(file, o) };
});

function fichier(nom: string, taille = 10, type = 'video/mp4'): File {
  return new File([new Uint8Array(taille)], nom, { type });
}

function reussite(file: File): UploadResult {
  return { publicUrl: `/storage/v1/object/public/media/u/${file.name}`, path: `u/${file.name}`, bucket: 'media', mode: 'direct' };
}

let listes = 0;

beforeEach(() => {
  listes = 0;
  uploadFileMock.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/media/list')) {
      listes += 1;
      return { ok: true, json: async () => ({ success: true, files: [] }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function monter(props: Partial<React.ComponentProps<typeof MediaLibrary>> = {}) {
  const onSelect = vi.fn();
  const onSelectMany = vi.fn();
  const onClose = vi.fn();
  render(
    <MediaLibrary
      isOpen
      onClose={onClose}
      mediaType="video"
      onSelect={onSelect}
      onSelectMany={onSelectMany}
      {...props}
    />,
  );
  return { onSelect, onSelectMany, onClose };
}

function choisir(files: File[]) {
  const input = document.querySelector('[data-mediatheque-input]') as HTMLInputElement;
  expect(input.multiple).toBe(true);
  expect(input.accept).toBe('video/*');
  fireEvent.change(input, { target: { files } });
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — plusieurs fichiers, un seul appel', () => {
  it('trois fichiers → `onSelectMany` UNE fois avec trois URL ABSOLUES, puis fermeture', async () => {
    uploadFileMock.mockImplementation(async (file) => reussite(file));
    const { onSelectMany, onSelect, onClose } = monter();
    const listesAvant = listes;

    choisir([fichier('a.mp4'), fichier('b.mp4'), fichier('c.mp4')]);

    await waitFor(() => expect(onSelectMany).toHaveBeenCalledTimes(1));
    const items = onSelectMany.mock.calls[0][0] as Array<{ url: string; name: string; type?: string }>;
    expect(items.map((i) => i.name)).toEqual(['a.mp4', 'b.mp4', 'c.mp4']);
    for (const i of items) {
      expect(i.url).toMatch(/^http:\/\/localhost(:\d+)?\/storage\/v1\/object\/public\/media\/u\//);
      expect(i.type).toBe('video');
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(uploadFileMock).toHaveBeenCalledTimes(3);
    // La grille a été relue après le lot, et la fenêtre s'est fermée.
    expect(listes).toBeGreaterThan(listesAvant);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('sans `onSelectMany`, l appelant attend UN fichier : input non multiple, un seul `onSelect` (compatibilité affiche/musique)', async () => {
    uploadFileMock.mockImplementation(async (file) => reussite(file));
    const { onSelect, onClose } = monter({ onSelectMany: undefined });
    const input = document.querySelector('[data-mediatheque-input]') as HTMLInputElement;
    expect(input.multiple).toBe(false);
    // Un dépôt de deux fichiers ne fait pas « gagner » le dernier en silence :
    // seul le premier part.
    fireEvent.change(input, { target: { files: [fichier('a.mp4'), fichier('b.mp4')] } });
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][1]).toBe('a.mp4');
    expect(onSelect.mock.calls[0][0]).toMatch(/^http:\/\//);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(uploadFileMock).toHaveBeenCalledTimes(1);
  });

  it('le dépôt (drag & drop) de plusieurs fichiers fait la même chose', async () => {
    uploadFileMock.mockImplementation(async (file) => reussite(file));
    const { onSelectMany } = monter();
    const zone = document.querySelector('[data-mediatheque-depot]') as HTMLElement;
    fireEvent.dragOver(zone);
    expect(screen.getByText('Déposez vos fichiers ici')).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer: { files: [fichier('x.mp4'), fichier('y.mp4')] } });
    await waitFor(() => expect(onSelectMany).toHaveBeenCalledTimes(1));
    expect((onSelectMany.mock.calls[0][0] as Array<{ name: string }>).map((i) => i.name)).toEqual(['x.mp4', 'y.mp4']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — un échec n emporte pas les autres', () => {
  it('le fichier en erreur est listé avec « Réessayer », les réussites sont remises, la fenêtre reste ouverte', async () => {
    uploadFileMock.mockImplementation(async (file) => {
      if (file.name === 'b.mp4') throw new Error('Upload échoué (HTTP 502) — la connexion a été coupée avant la fin');
      return reussite(file);
    });
    const { onSelectMany, onClose } = monter();
    choisir([fichier('a.mp4'), fichier('b.mp4'), fichier('c.mp4')]);

    await waitFor(() => expect(onSelectMany).toHaveBeenCalledTimes(1));
    expect((onSelectMany.mock.calls[0][0] as Array<{ name: string }>).map((i) => i.name)).toEqual(['a.mp4', 'c.mp4']);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/HTTP 502/)).toBeTruthy();
    expect(document.querySelectorAll('[data-mediatheque-envoi="ok"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-mediatheque-envoi="erreur"]')).toHaveLength(1);
    expect(document.querySelector('[data-mediatheque-reessayer-echecs]')).toBeTruthy();
  });

  it('« Réessayer les échecs » ne relance QUE l échec, le remet, puis ferme', async () => {
    let tentativesB = 0;
    uploadFileMock.mockImplementation(async (file) => {
      if (file.name === 'b.mp4') {
        tentativesB += 1;
        if (tentativesB === 1) throw new Error('Upload interrompu (connexion perdue)');
      }
      return reussite(file);
    });
    const { onSelectMany, onClose } = monter();
    choisir([fichier('a.mp4'), fichier('b.mp4')]);
    await waitFor(() => expect(document.querySelector('[data-mediatheque-reessayer-echecs]')).toBeTruthy());
    expect(uploadFileMock).toHaveBeenCalledTimes(2);

    fireEvent.click(document.querySelector('[data-mediatheque-reessayer-echecs]') as Element);

    await waitFor(() => expect(onSelectMany).toHaveBeenCalledTimes(2));
    // Un seul envoi de plus : `a` n'est pas reparti.
    expect(uploadFileMock).toHaveBeenCalledTimes(3);
    expect((onSelectMany.mock.calls[1][0] as Array<{ name: string }>).map((i) => i.name)).toEqual(['b.mp4']);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('un fichier hors type ou trop gros est refusé à part, sans bloquer les autres', async () => {
    uploadFileMock.mockImplementation(async (file) => reussite(file));
    const { onSelectMany, onClose } = monter();
    const trop = fichier('enorme.mp4');
    Object.defineProperty(trop, 'size', { value: 500 * 1024 * 1024 + 1 });
    choisir([fichier('ok.mp4'), fichier('photo.jpg', 10, 'image/jpeg'), trop]);

    await waitFor(() => expect(onSelectMany).toHaveBeenCalledTimes(1));
    expect((onSelectMany.mock.calls[0][0] as Array<{ name: string }>).map((i) => i.name)).toEqual(['ok.mp4']);
    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-mediatheque-envoi="refuse"]')).toHaveLength(2);
    expect(screen.getByText(/non accepté/)).toBeTruthy();
    expect(screen.getByText(/maximum 500 Mo/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — la progression groupée', () => {
  it('le bouton dit « Envoi n/N · p % » pendant l envoi', async () => {
    const liberer: Array<() => void> = [];
    uploadFileMock.mockImplementation((file) => new Promise<UploadResult>((ok) => {
      liberer.push(() => ok(reussite(file)));
    }));
    monter();
    choisir([fichier('a.mp4', 100), fichier('b.mp4', 100)]);
    await waitFor(() => expect(screen.getByText(/Envoi 0\/2 · 0 %/)).toBeTruthy());
    liberer[0]();
    await waitFor(() => expect(screen.getByText(/Envoi 1\/2 · 50 %/)).toBeTruthy());
    liberer[1]();
    await waitFor(() => expect(screen.queryByText(/Envoi \d\/2/)).toBeNull());
  });
});
