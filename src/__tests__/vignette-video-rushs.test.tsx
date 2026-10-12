import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import {
  cleVignette, obtenirVignette, extraireVignetteDom, vignettesPourTests, EXTRACTIONS_MAX, TTL_ECHEC_MS,
  type ExtractionVignette,
} from '@/lib/medias/vignette-video';
import CarteMedia, { GrilleMedias } from '@/components/medias/CarteMedia';
import PlanAvantGeneration from '@/components/creer/PlanAvantGeneration';
import MediasSequenceVideo from '@/components/creer/MediasSequenceVideo';
import type { PlanDetaille } from '@/lib/creer/medias-video';

/**
 * MINIATURES DES RUSHS — extraites une fois, gardées, jamais retéléchargées.
 *
 * Le relais privé (#554) répond `no-store` : chaque `<video preload>` par
 * carte retéléchargeait le rush à chaque affichage. Ici on vérifie le
 * cache (par clé d'objet), la file, l'échec propre et le WebM sans durée.
 */

const OBJET = '/storage/v1/object/public/media/u1/rush-plage.mp4';
const URL_A = `https://studiio.pro${OBJET}`;
const URL_A_AUTRE_HOTE = `https://cdn.autre.test${OBJET}?sr=jeton-1`;
const URL_A_AUTRE_JETON = `${OBJET}?sr=jeton-2`;
const URL_B = 'https://studiio.pro/storage/v1/object/public/media/u1/b.mp4';

const ok = (duree = 12): ExtractionVignette => ({ url: 'blob:vignette', ratio: 9 / 16, duree });

beforeEach(() => {
  vignettesPourTests.reinitialiser();
  vignettesPourTests.desactiverPersistance();
});
afterEach(() => { cleanup(); vignettesPourTests.reinitialiser(); });

describe('Cache des miniatures', () => {
  it('le second appel ne réextrait pas', async () => {
    const extraire = vi.fn(async () => ok());
    vignettesPourTests.definirExtracteur(extraire);
    const a = await obtenirVignette(URL_A);
    const b = await obtenirVignette(URL_A);
    expect(a).toEqual({ url: 'blob:vignette', ratio: 9 / 16, duree: 12 });
    expect(b).toBe(a);
    expect(extraire).toHaveBeenCalledTimes(1);
  });

  it('deux demandes simultanées partagent UNE extraction', async () => {
    const extraire = vi.fn(async () => ok());
    vignettesPourTests.definirExtracteur(extraire);
    await Promise.all([obtenirVignette(URL_A), obtenirVignette(URL_A)]);
    expect(extraire).toHaveBeenCalledTimes(1);
  });

  it('même objet, autre hôte ou autre jeton ?sr= : même clé, aucune réextraction', async () => {
    expect(cleVignette(URL_A_AUTRE_HOTE)).toBe(cleVignette(URL_A));
    expect(cleVignette(URL_A_AUTRE_JETON)).toBe(cleVignette(URL_A));
    expect(cleVignette(URL_B)).not.toBe(cleVignette(URL_A));
    // Hors stockage : le chemin, sans hôte ni requête.
    expect(cleVignette('https://x.test/v/a.mp4?t=1')).toBe(cleVignette('https://y.test/v/a.mp4#f'));
    const extraire = vi.fn(async () => ok());
    vignettesPourTests.definirExtracteur(extraire);
    await obtenirVignette(URL_A);
    await obtenirVignette(URL_A_AUTRE_HOTE);
    await obtenirVignette(URL_A_AUTRE_JETON);
    expect(extraire).toHaveBeenCalledTimes(1);
  });

  it(`au plus ${EXTRACTIONS_MAX} extractions à la fois`, async () => {
    let actives = 0;
    let pic = 0;
    const liberer: Array<() => void> = [];
    vignettesPourTests.definirExtracteur(() => new Promise((resolve) => {
      actives += 1; pic = Math.max(pic, actives);
      liberer.push(() => { actives -= 1; resolve(ok()); });
    }));
    const urls = [1, 2, 3, 4, 5].map((i) => `https://studiio.pro/storage/v1/object/public/media/u1/r${i}.mp4`);
    const tout = Promise.all(urls.map((u) => obtenirVignette(u)));
    for (let i = 0; i < urls.length; i += 1) {
      await waitFor(() => expect(liberer.length).toBeGreaterThan(i));
      expect(actives).toBeLessThanOrEqual(EXTRACTIONS_MAX);
      liberer[i]();
    }
    await tout;
    expect(pic).toBe(EXTRACTIONS_MAX);
  });

  it('un échec est retenu (TTL court), puis retenté', async () => {
    let t = 1_000;
    vignettesPourTests.definirHorloge(() => t);
    const extraire = vi.fn(async (): Promise<ExtractionVignette> => { throw new Error('decodage'); });
    vignettesPourTests.definirExtracteur(extraire);
    expect(await obtenirVignette(URL_A)).toBeNull();
    expect(await obtenirVignette(URL_A)).toBeNull();
    expect(extraire).toHaveBeenCalledTimes(1);
    t += TTL_ECHEC_MS + 1;
    await obtenirVignette(URL_A);
    expect(extraire).toHaveBeenCalledTimes(2);
  });
});

describe('Extraction — WebM MediaRecorder sans durée', () => {
  /** Une vidéo factice : durée `Infinity` jusqu'au saut à 1e101. */
  function videoFactice(dureeReelle: number) {
    const cibles = new EventTarget();
    const sauts: number[] = [];
    let duree = Infinity;
    const v = {
      muted: false, playsInline: false, preload: '', videoWidth: 1080, videoHeight: 1920,
      get duration() { return duree; },
      set src(_u: string) { queueMicrotask(() => cibles.dispatchEvent(new Event('loadedmetadata'))); },
      get currentTime() { return sauts[sauts.length - 1] ?? 0; },
      set currentTime(x: number) {
        sauts.push(x);
        if (x >= 1e100) {
          duree = dureeReelle;
          queueMicrotask(() => cibles.dispatchEvent(new Event('durationchange')));
        } else {
          queueMicrotask(() => cibles.dispatchEvent(new Event('seeked')));
        }
      },
      addEventListener: cibles.addEventListener.bind(cibles),
      removeEventListener: cibles.removeEventListener.bind(cibles),
      removeAttribute: () => {},
    };
    return { v: v as unknown as HTMLVideoElement, sauts };
  }

  function canvasFactice() {
    const dessin = vi.fn();
    const c = {
      width: 0, height: 0,
      getContext: () => ({ drawImage: dessin }),
      toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => { cb(new Blob(['x'], { type })); expect(q).toBe(0.7); },
    };
    return { c: c as unknown as HTMLCanvasElement, dessin };
  }

  it('force le calcul de la durée (1e101), puis vise min(1 s, durée/2)', async () => {
    const { v, sauts } = videoFactice(12);
    const { c, dessin } = canvasFactice();
    const r = await extraireVignetteDom('blob:rush.webm', { creerVideo: () => v, creerCanvas: () => c, creerUrl: () => 'blob:jpeg' });
    expect(sauts).toEqual([1e101, 1]);
    expect(r.duree).toBe(12);
    expect(r.url).toBe('blob:jpeg');
    expect(r.ratio).toBeCloseTo(1080 / 1920);
    // ~240 px de large, ratio de la source conservé.
    expect(c.width).toBe(240);
    expect(c.height).toBe(Math.round(240 / (1080 / 1920)));
    expect(dessin).toHaveBeenCalledTimes(1);
  });

  it('vidéo courte : vise la moitié de la durée', async () => {
    const { v, sauts } = videoFactice(1.2);
    const { c } = canvasFactice();
    await extraireVignetteDom('blob:court.webm', { creerVideo: () => v, creerCanvas: () => c, creerUrl: () => 'blob:j' });
    expect(sauts[sauts.length - 1]).toBeCloseTo(0.6);
  });

  it('délai dépassé : lève (jamais d’attente éternelle)', async () => {
    const cibles = new EventTarget();
    const v = {
      set src(_u: string) { /* aucune métadonnée, jamais */ },
      addEventListener: cibles.addEventListener.bind(cibles),
      removeEventListener: cibles.removeEventListener.bind(cibles),
      removeAttribute: () => {},
    } as unknown as HTMLVideoElement;
    await expect(extraireVignetteDom('blob:x', { creerVideo: () => v, delaiMs: 20 })).rejects.toThrow('delai');
  });
});

describe('Écrans', () => {
  it('CarteMedia : miniature extraite, durée affichée, ratio de la source', async () => {
    vignettesPourTests.definirExtracteur(async () => ok(75));
    render(<ul><li><CarteMedia url={URL_A} type="video" origine="rush" /></li></ul>);
    await waitFor(() => expect(document.querySelector('[data-miniature-video="pret"] img')?.getAttribute('src')).toBe('blob:vignette'));
    expect(document.querySelector('[data-carte-duree]')!.textContent).toBe('1:15');
    // (jsdom ignore `aspect-ratio` : le ratio appliqué est exposé en attribut.)
    expect(document.querySelector('[data-carte-vignette]')!.getAttribute('data-carte-ratio')).toBe(String(9 / 16));
  });

  it('échec : placeholder « Aperçu indisponible », la liste reste entière', async () => {
    vignettesPourTests.definirExtracteur(async (url) => {
      if (url === URL_B) throw new Error('decodage');
      return ok();
    });
    render(
      <GrilleMedias>
        <li><CarteMedia url={URL_A} type="video" origine="rush" /></li>
        <li><CarteMedia url={URL_B} type="video" origine="rush" /></li>
      </GrilleMedias>,
    );
    await waitFor(() => expect(document.querySelector('[data-miniature-video="echec"]')).toBeTruthy());
    const cartes = document.querySelectorAll('[data-carte-media]');
    expect(cartes.length).toBe(2);
    expect(cartes[1].textContent).toContain('Aperçu indisponible');
    expect(cartes[1].querySelector('svg')).toBeTruthy();
    await waitFor(() => expect(cartes[0].querySelector('[data-miniature-video="pret"]')).toBeTruthy());
  });

  it('Plan avant génération : la ligne d’un rush choisi montre sa miniature et sa durée', async () => {
    vignettesPourTests.definirExtracteur(async () => ok(8));
    render(
      <PlanAvantGeneration
        gabarit={[{ id: 's1', type: 'rush', media: URL_A }, { id: 's2', type: 'rush' }]}
        suggestion={[]}
        rushesPerso={[URL_A]}
        stock={[]}
        vignetteAvatar={null}
        avatarDisponible={false}
        onChange={() => {}}
        onRechercher={() => {}}
      />,
    );
    const ligne = document.querySelector('[data-plan-ligne="0"]') as HTMLElement;
    await waitFor(() => expect(ligne.querySelector('[data-plan-vignette-rush] img')).toBeTruthy());
    await waitFor(() => expect(ligne.querySelector('[data-plan-duree]')?.textContent).toContain('0:08'));
    expect(ligne.querySelector('[data-plan-infos-rush]')!.textContent).toContain('rush-plage.mp4');
    // « Au choix à chaque montage » : aucune miniature inventée.
    expect(document.querySelector('[data-plan-ligne="1"] [data-plan-vignette-rush]')).toBeNull();
  });

  it('Médias de la séquence Vidéo : miniature extraite, plus de <video>', async () => {
    vignettesPourTests.definirExtracteur(async () => ok(4));
    const plan = { items: [], duree: 4, dureeRestante: null } as unknown as PlanDetaille;
    render(
      <MediasSequenceVideo
        medias={[{ id: 'r1', source: 'rush', type: 'video', url: URL_A, duree: 4 }]}
        plan={plan}
        etatAvatar="inconnu"
        onApercu={() => {}}
        onDeplacer={() => {}}
        onRemplacer={() => {}}
        onSupprimer={() => {}}
        onRecadrer={() => {}}
        onAjouterMonRush={() => {}}
        onAjouterAvatar={() => {}}
        onAjouterSuggere={() => {}}
        onAjouterMediatheque={() => {}}
      />,
    );
    const case_ = document.querySelector('[data-vignette="video"]') as HTMLElement;
    await waitFor(() => expect(case_.querySelector('[data-miniature-video="pret"] img')).toBeTruthy());
    expect(case_.querySelector('video')).toBeNull();
  });
});
