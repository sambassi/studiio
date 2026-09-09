/**
 * CREER_PREMIUM_3D — PLUSIEURS MUSIQUES EN UNE SEULE SÉLECTION.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI COINÇAIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le sélecteur de médias lisait `files[0]` et se fermait aussitôt. Ajouter
 * quatre morceaux demandait donc d'ouvrir le Finder quatre fois.
 *
 * ⚠️ LE PIPELINE N'A PAS CHANGÉ. Chaque fichier passe par `uploadFile`, le même
 * qu'avant, puis par `banque.ajouter` — les règles A_5d de doublon et de
 * capacité s'appliquent inchangées. Le lot n'est qu'une orchestration.
 *
 * ⚠️ ET UN FICHIER REFUSÉ N'EMPORTE PAS LES AUTRES. Sur cinq musiques, il est
 * normal qu'une soit dans un format que le stockage refuse ; annuler les quatre
 * bonnes punirait la personne pour une erreur qui n'en est pas une.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const uploadFile = vi.fn();
vi.mock('@/lib/storage/uploadFile', () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

const { MediaLibrary, CONCURRENCE_IMPORT_MEDIA } =
  await import('@/components/shared/MediaLibrary');

const fichier = (nom: string, type = 'audio/mpeg') =>
  new File([new Uint8Array([1, 2, 3])], nom, { type });

const input = () => document.querySelector('[data-media-input]') as HTMLInputElement;
const lignes = () => [...document.querySelectorAll('[data-media-import]')].map((l) => ({
  nom: l.getAttribute('data-media-import'),
  etat: l.getAttribute('data-media-import-etat'),
}));
const resume = () =>
  document.querySelector('[data-media-imports-resume]')?.textContent?.trim() ?? null;

function poser(over: Record<string, unknown> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <MediaLibrary
      isOpen onClose={onClose} mediaType="audio" onSelect={onSelect}
      multiple {...over}
    />,
  );
  return { onSelect, onClose };
}

/** Dépose une sélection dans le vrai `<input>`, comme le Finder le ferait. */
async function selectionner(fichiers: File[]) {
  const el = input();
  Object.defineProperty(el, 'files', { value: fichiers, configurable: true });
  await act(async () => { fireEvent.change(el); });
}

beforeEach(() => {
  uploadFile.mockReset();
  uploadFile.mockImplementation(async (f: File, o: { onProgress?: (p: number) => void }) => {
    o.onProgress?.(100);
    return { publicUrl: `https://local/media/${f.name}`, mode: 'direct' };
  });
});
afterEach(() => cleanup());

describe('3D — une seule sélection, plusieurs fichiers', () => {
  it('le champ accepte le multiple quand l appelant le demande', () => {
    poser();
    expect(input().multiple).toBe(true);
  });

  it('il RESTE simple quand l appelant ne le demande pas', () => {
    /* Ce sélecteur sert aussi aux logos et aux rushes : leur ouvrir le multiple
       ferait accepter des lots là où l'appelant n'attend qu'un média. */
    cleanup();
    poser({ multiple: false });
    expect(input().multiple).toBe(false);
  });

  it('trois fichiers en une fois → trois envois et trois sélections', async () => {
    const { onSelect } = poser();
    await selectionner([fichier('bulk-A.mp3'), fichier('bulk-B.wav', 'audio/wav'),
      fichier('bulk-C.mp3')]);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(3));
    expect(uploadFile).toHaveBeenCalledTimes(3);
    expect(onSelect.mock.calls.map((c) => c[1]))
      .toEqual(['bulk-A.mp3', 'bulk-B.wav', 'bulk-C.mp3']);
  });

  it('chaque fichier passe par le pipeline EXISTANT', async () => {
    /* Un second chemin d'envoi aurait donné deux façons de téléverser. */
    const { onSelect } = poser();
    await selectionner([fichier('bulk-A.mp3')]);
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(uploadFile.mock.calls[0][1]).toMatchObject({ purpose: 'library' });
  });

  it('l ordre AFFICHÉ est celui de la sélection', async () => {
    poser();
    await selectionner([fichier('un.mp3'), fichier('deux.mp3'), fichier('trois.mp3')]);
    await waitFor(() => expect(lignes()).toHaveLength(3));
    expect(lignes().map((l) => l.nom)).toEqual(['un.mp3', 'deux.mp3', 'trois.mp3']);
  });
});

describe('3D — un fichier refusé n emporte pas les autres', () => {
  it('deux réussites et un échec : les deux bonnes passent', async () => {
    uploadFile.mockImplementation(async (f: File, o: { onProgress?: (p: number) => void }) => {
      if (f.name.endsWith('.txt')) throw new Error('type refusé');
      o.onProgress?.(100);
      return { publicUrl: `https://local/media/${f.name}`, mode: 'direct' };
    });
    const { onSelect } = poser();
    await selectionner([
      fichier('bon-A.mp3'), fichier('invalide.txt', 'text/plain'), fichier('bon-C.wav', 'audio/wav'),
    ]);
    await waitFor(() => expect(lignes().filter((l) => l.etat === 'importe')).toHaveLength(2));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(lignes().find((l) => l.nom === 'invalide.txt')?.etat).toBe('erreur');
  });

  it('le compte-rendu dit combien sont passées et combien non', async () => {
    uploadFile.mockImplementation(async (f: File) => {
      if (f.name.includes('ko')) throw new Error('panne');
      return { publicUrl: `https://local/${f.name}`, mode: 'direct' };
    });
    poser();
    await selectionner([fichier('ok-1.mp3'), fichier('ko-2.mp3'), fichier('ok-3.mp3')]);
    await waitFor(() => expect(resume()).toContain('2 / 3'));
    expect(resume()).toContain('non ajouté');
  });

  it('le motif est LISIBLE — ni MinIO, ni trace, ni code', async () => {
    uploadFile.mockRejectedValue(new Error(
      'MinIO S3Error: PUT https://studiio-minio:9000/... 500 InternalError',
    ));
    poser();
    await selectionner([fichier('mauvais.pdf', 'application/pdf')]);
    await waitFor(() => expect(lignes()[0].etat).toBe('erreur'));
    const texte = document.querySelector('[data-media-imports]')?.textContent ?? '';
    for (const interdit of ['MinIO', 'S3Error', '500', 'studiio-minio', 'https://']) {
      expect(texte, `« ${interdit} » ne doit pas remonter`).not.toContain(interdit);
    }
    expect(texte).toContain('Format non pris en charge');
  });
});

describe('3D — la fenêtre et la concurrence', () => {
  it('en mode lot, la fenêtre NE se ferme PAS toute seule', async () => {
    /* Fermer au premier fichier escamotait le compte-rendu au moment précis où
       il devient utile : celui où l'un des morceaux n'est pas passé. */
    const { onClose } = poser();
    await selectionner([fichier('a.mp3'), fichier('b.mp3')]);
    await waitFor(() => expect(lignes().filter((l) => l.etat === 'importe')).toHaveLength(2));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('en mode simple, elle se ferme comme avant', async () => {
    cleanup();
    const { onClose } = poser({ multiple: false });
    await selectionner([fichier('seul.mp3')]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('les envois sont BORNÉS — jamais tout le lot d un coup', async () => {
    /* Dix fichiers lancés ensemble saturent la liaison, et chaque barre avance
       alors trop lentement pour dire quoi que ce soit. */
    let simultanes = 0;
    let maximum = 0;
    uploadFile.mockImplementation(async (f: File) => {
      simultanes += 1; maximum = Math.max(maximum, simultanes);
      await new Promise((r) => { setTimeout(r, 8); });
      simultanes -= 1;
      return { publicUrl: `https://local/${f.name}`, mode: 'direct' };
    });
    poser();
    await selectionner(Array.from({ length: 6 }, (_, i) => fichier(`t${i}.mp3`)));
    await waitFor(() => expect(lignes().filter((l) => l.etat === 'importe')).toHaveLength(6),
      { timeout: 3000 });
    expect(maximum).toBeLessThanOrEqual(CONCURRENCE_IMPORT_MEDIA);
    expect(CONCURRENCE_IMPORT_MEDIA).toBe(2);
  });

  it('une sélection vide ne déclenche rien', async () => {
    const { onSelect } = poser();
    await selectionner([]);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('3D — la banque A_5d garde ses règles', () => {
  const lire = (rel: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:fs').readFileSync(`${process.cwd()}/${rel}`, 'utf8');
  };

  it('chaque fichier entre par `banque.ajouter`, pas par une route parallèle', () => {
    const src = lire('src/components/creer/ReglagesAudio.tsx');
    expect(src).toContain('banque.ajouter(cle, nom)');
    expect(src).toContain('multiple');
    /* Aucune seconde banque, aucun second catalogue. */
    expect(src).not.toContain('bulkAudio');
    expect(src).not.toContain('useBanqueAudioV2');
  });

  it('le sélecteur ne connaît ni la banque, ni sa capacité', () => {
    /* Deux endroits qui décideraient de la capacité finiraient par se
       contredire : le sélecteur téléverse, la banque décide. */
    const src = lire('src/components/shared/MediaLibrary.tsx');
    expect(src).not.toContain('banque');
    /* La capacité de la banque n'est pas son affaire : elle téléverse, la
       banque décide. */
    expect(src).not.toContain('AUDIO_BANK_MAX');
    expect(src).not.toContain('useBanqueAudio');
  });

  it('l import ne sélectionne PAS la musique active', () => {
    /* Règle A_5d : importer n'est pas choisir. */
    const src = lire('src/components/creer/ReglagesAudio.tsx');
    const i = src.indexOf('multiple');
    const bloc = src.slice(i, i + 700);
    expect(bloc).not.toContain('majuscule({ musique');
    expect(bloc).not.toContain('setNomMusique(');
  });
});
