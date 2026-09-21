/**
 * La SÉRIE et ses affiches : ce qui survit à un rechargement, ce qui bloque
 * l'envoi, et ce qui arrive quand une variation IA échoue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Trois régressions, vues en production, que rien ne protégeait :
 *
 *   1. Un lot de dix affiches, en mode automatique, revenait VIDE après un
 *      rechargement : l'attribution automatique tournait au montage sur une
 *      liste de résultats vide (les résultats de recherche ne sont pas
 *      enregistrés) et écrasait les affiches restaurées du brouillon.
 *   2. Un lot incomplet devait être refusé AVANT toute réservation — et le
 *      message disait « repassez en mode automatique » à quelqu'un qui y
 *      était déjà.
 *   3. Une variation IA en échec reprenait le contenu courant en silence :
 *      deux vidéos identiques, présentées comme une série.
 *
 * L'écran est monté, les vrais boutons cliqués, la trace réseau lue : ce
 * sont des ORDRES et des NOMBRES qu'on vérifie, pas des textes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BATCH_RENDER_DESACTIVE } from '@/lib/render/batch-disabled';
import { batchPhotosReady } from '@/lib/creer/batch';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true, value: () => Promise.resolve(),
});

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;

vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlQuery }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));

const MONTAGE = () => new Blob([new Uint8Array(4096)], { type: 'video/webm' });
const composeVideoSpy = vi.fn(async (_opts?: unknown) => ({
  video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }),
}));
const composeAndUploadSpy = vi.fn(async () => ({
  blob: MONTAGE(), url: 'https://cdn/libre.webm', thumbnailUrl: null, composerVersion: 'v1',
}));
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: (...a: unknown[]) => composeVideoSpy(...(a as [])),
    composeAndUpload: (...a: unknown[]) => composeAndUploadSpy(...(a as [])),
    downloadBlob: async () => {},
  };
});

import AssistantWizard, { reattribuerAffichesAuto, messageAffichesManquantes } from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Yoga du matin',
  subtitle: 'Reveiller le corps',
  cards: [
    { icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' },
    { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' },
  ],
};

/** N affiches distinctes, comme un brouillon les aurait enregistrées. */
const affiches = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn/affiche-${i + 1}.jpg`);

const cleServeur = (job: string) =>
  `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${job}.webm`;

interface Scenario {
  /** Rang (1-based) de l'APPEL de variation IA qui doit échouer. */
  variationEchoueAu?: number;
}

let trace: string[];
let jobs: string[];
let postsCrees: Array<Record<string, unknown>>;
let variations: Array<Record<string, unknown>>;

/**
 * La variation IA est mockée avec un contenu VALIDE et un titre différent à
 * chaque appel : c'est la seule façon pour une série de plus de un de
 * passer, depuis qu'un échec de variation arrête la série.
 */
function installerFetch(sc: Scenario = {}) {
  trace = [];
  jobs = [];
  postsCrees = [];
  variations = [];
  let rang = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps),
    } as unknown as Response);

    if (u.includes('/api/credits/balance')) {
      trace.push('solde');
      return rep({ ok: true, politique: 'credits', balance: 5000 });
    }
    if (u.includes('/api/render/tarifs')) {
      return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    }
    if (u.includes('/api/render/batch')) { trace.push('BATCH'); return rep({ disabled: true }, 503); }

    if (u.includes('/api/content/ai-generate') && m === 'POST') {
      trace.push('variation');
      variations.push(JSON.parse(String(init?.body ?? '{}')));
      const n = variations.length;
      if (sc.variationEchoueAu === n) return rep({ success: false, error: 'provider indisponible' });
      return rep({
        success: true,
        content: {
          title: `Titre ${n}`,
          subtitle: `Sous-titre ${n}`,
          cards: [
            { icon: 'Heart', label: `Carte A ${n}`, description: 'd', value: '1' },
            { icon: 'Zap', label: `Carte B ${n}`, description: 'd', value: '2' },
          ],
        },
      });
    }

    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      rang += 1;
      trace.push('reservation');
      const job = `job-${rang}`;
      jobs.push(job);
      return rep({
        ok: true, jobId: job, uploadUrl: `/api/render/jobs/${job}/upload`,
        uploadMode: 'relais', publicUrl: cleServeur(job), cout: 10,
      });
    }
    if (/\/api\/render\/jobs\/job-\d+\/upload$/.test(u) && m === 'PUT') {
      trace.push('televersement');
      return rep({ ok: true });
    }
    if (/\/api\/render\/jobs\/job-\d+\/confirm$/.test(u)) {
      trace.push('confirmation');
      return rep({ ok: true, politique: 'credits', balance: 4990 });
    }
    if (/\/api\/render\/jobs\/job-\d+\/cancel$/.test(u)) { trace.push('annulation'); return rep({ ok: true }); }
    if (u.includes('/api/upload/signed-url')) {
      return rep({ success: true, signedUrl: 'https://minio.studiio.pro/v', publicUrl: 'https://cdn/v.jpg' });
    }
    if (u.includes('minio.studiio.pro')) return rep({ ok: true });
    if (u.includes('/api/credits/deduct')) { trace.push('DEBIT_APRES_COUP'); return rep({ success: true }); }
    if (/\/api\/(social\/publish|cron\/publish)/.test(u) && m === 'POST') { trace.push('PUBLICATION'); return rep({ ok: true }); }
    if (u.includes('/api/posts') && m === 'POST') {
      trace.push('post');
      postsCrees.push(JSON.parse(String(init?.body ?? '{}')));
      return rep({ success: true, post: { id: `p${postsCrees.length}` } });
    }
    // Aucune recherche de photos n'est déclenchée par le montage : la grille
    // reste vide, comme après un vrai rechargement.
    return rep({ success: true, data: [], posts: [], content: {}, images: [], photos: [] });
  }) as unknown as typeof fetch;
}

const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
    ...extra,
  }));
};

const attendre = async (tours = 60, pas = 0) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, pas)); });
  }
};

const allerAEnvoi = async () => {
  urlQuery = new URLSearchParams('');
  render(<AssistantWizard />);
  await attendre(4);
  for (let i = 0; i < 4; i += 1) {
    if (document.querySelector('[data-batch-mode="unique"]')) break;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
  }
  await attendre(4);
  expect(document.querySelector('[data-batch-mode="unique"]')).not.toBeNull();
};

const envoyer = async (tours = 120) => {
  const b = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0] as HTMLButtonElement;
  expect(b).toBeTruthy();
  await act(async () => { fireEvent.click(b); });
  await attendre(tours);
};

/** Ce que l'écran dit des affiches — les attributs que la garde d'envoi lit. */
const etatAffiches = () => {
  const el = document.querySelector('[data-batch-photos-count]');
  return {
    count: Number(el?.getAttribute('data-batch-photos-count')),
    ready: el?.getAttribute('data-batch-photos-ready'),
  };
};

const posterUrlsComposees = () =>
  composeVideoSpy.mock.calls.map((c) => (c[0] as { posterUrl?: string } | undefined)?.posterUrl);

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  composeVideoSpy.mockClear();
  composeAndUploadSpy.mockClear();
  window.alert = () => {};
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// (a) Dix affiches en automatique survivent au rechargement, et la série part
// ────────────────────────────────────────────────────────────────────────────

describe('(a) Un lot de dix en mode automatique, rechargé', () => {
  it('les dix affiches du brouillon sont encore là — le mode auto ne les efface pas', async () => {
    installerFetch();
    poser({ batchCount: 10, batchPhotoMode: 'auto', batchPhotoUrls: affiches(10) });
    await allerAEnvoi();
    expect(document.querySelector('[data-serie-nombre]')?.textContent).toBe('10 vidéos');
    expect(etatAffiches()).toEqual({ count: 10, ready: 'true' });
    expect(document.body.textContent).toContain('10 affiches retenues');
  });

  it('« Composer et envoyer » ouvre dix réservations, dix confirmations, dix brouillons', async () => {
    installerFetch();
    poser({ batchCount: 10, batchPhotoMode: 'auto', batchPhotoUrls: affiches(10) });
    await allerAEnvoi();
    await envoyer(500);
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(10);
    expect(trace.filter((t) => t === 'confirmation')).toHaveLength(10);
    expect(trace.filter((t) => t === 'post')).toHaveLength(10);
    expect(composeVideoSpy).toHaveBeenCalledTimes(10);
    expect(new Set(jobs).size).toBe(10);
    expect(postsCrees.map((p) => p.media_url)).toEqual(jobs.map(cleServeur));
    expect(trace).not.toContain('BATCH');
    expect(trace).not.toContain('DEBIT_APRES_COUP');
  });

  it('chaque vidéo reçoit SON affiche : dix différentes, dans l ordre du brouillon', async () => {
    installerFetch();
    poser({ batchCount: 10, batchPhotoMode: 'auto', batchPhotoUrls: affiches(10) });
    await allerAEnvoi();
    await envoyer(500);
    expect(posterUrlsComposees()).toEqual(affiches(10));
  });

  it('neuf variations IA, toutes différentes — la première garde le contenu affiché', async () => {
    installerFetch();
    poser({ batchCount: 10, batchPhotoMode: 'auto', batchPhotoUrls: affiches(10) });
    await allerAEnvoi();
    await envoyer(500);
    expect(trace.filter((t) => t === 'variation')).toHaveLength(9);
    const titres = postsCrees.map((p) => String(p.title));
    expect(titres[0]).toContain('YOGA DU MATIN');
    expect(new Set(titres).size).toBe(10);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (b) Six affiches pour dix vidéos : refus AVANT tout effet de bord
// ────────────────────────────────────────────────────────────────────────────

describe('(b) Un lot de dix avec six affiches, en automatique', () => {
  it('l écran annonce 6 / 10 et un lot qui ne peut pas partir', async () => {
    installerFetch();
    poser({ batchCount: 10, batchPhotoMode: 'auto', batchPhotoUrls: affiches(6) });
    await allerAEnvoi();
    expect(etatAffiches()).toEqual({ count: 6, ready: 'false' });
  });

  it('« Composer et envoyer » refuse : zéro réservation, zéro brouillon, zéro composition', async () => {
    installerFetch();
    poser({ batchCount: 10, batchPhotoMode: 'auto', batchPhotoUrls: affiches(6) });
    await allerAEnvoi();
    const avantClic = trace.length;
    await envoyer(40);
    expect(trace).not.toContain('reservation');
    expect(trace).not.toContain('post');
    expect(trace).not.toContain('variation');
    expect(composeVideoSpy).not.toHaveBeenCalled();
    // Le clic n'a déclenché AUCUN appel suivi — pas même la lecture du
    // solde : la garde précède tout.
    expect(trace.slice(avantClic)).toEqual([]);
  });

  it('le refus parle au mode automatique : chercher d autres photos, pas « repasser en auto »', async () => {
    installerFetch();
    poser({ batchCount: 10, batchPhotoMode: 'auto', batchPhotoUrls: affiches(6) });
    await allerAEnvoi();
    await envoyer(40);
    const texte = document.body.textContent ?? '';
    expect(texte).toContain('Recherchez d’autres photos pour obtenir 10 affiches distinctes (6 sur 10)');
    expect(texte).not.toContain('repassez en mode automatique');
    expect(texte).not.toContain('Envoyé au calendrier');
  });

  it('en manuel, le refus dit de compléter — ou de repasser en automatique', async () => {
    installerFetch();
    poser({ batchCount: 10, batchPhotoMode: 'manuel', batchPhotoUrls: affiches(6) });
    await allerAEnvoi();
    await envoyer(40);
    expect(document.body.textContent).toContain('Choisissez autant de photos que de vidéos (6 sur 10), ou repassez en mode automatique');
    expect(trace).not.toContain('reservation');
    expect(composeVideoSpy).not.toHaveBeenCalled();
  });

  it('six affiches dont deux identiques ne font pas dix non plus', async () => {
    installerFetch();
    poser({
      batchCount: 10, batchPhotoMode: 'auto',
      batchPhotoUrls: [...affiches(8), 'https://cdn/affiche-1.jpg', 'https://cdn/affiche-2.jpg'],
    });
    await allerAEnvoi();
    expect(etatAffiches().ready).toBe('false');
    await envoyer(40);
    expect(trace).not.toContain('reservation');
    expect(composeVideoSpy).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (c) Une variation IA échoue : la série s'arrête là, sans doublon
// ────────────────────────────────────────────────────────────────────────────

describe('(c) Série de trois, la deuxième variation échoue', () => {
  const lancer = async () => {
    installerFetch({ variationEchoueAu: 1 });
    poser({ batchCount: 3, batchPhotoMode: 'auto', batchPhotoUrls: affiches(3) });
    await allerAEnvoi();
    await envoyer(200);
  };

  it('une réservation, une confirmation, un brouillon — la première seulement', async () => {
    await lancer();
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(1);
    expect(trace.filter((t) => t === 'confirmation')).toHaveLength(1);
    expect(trace.filter((t) => t === 'post')).toHaveLength(1);
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    expect(postsCrees[0].media_url).toBe(cleServeur('job-1'));
    expect(String(postsCrees[0].title)).toContain('YOGA DU MATIN');
  });

  it('la deuxième n a rien réservé ni enregistré ; la troisième n a jamais demandé de variation', async () => {
    await lancer();
    // Un seul appel de variation : celui de la deuxième, qui a échoué. La
    // troisième n'a pas été tentée.
    expect(trace.filter((t) => t === 'variation')).toHaveLength(1);
    // Le parcours complet : la première livrée de bout en bout, puis la
    // variation de la deuxième — et plus rien après.
    expect(trace.filter((t) => t !== 'solde'))
      .toEqual(['reservation', 'televersement', 'confirmation', 'post', 'variation']);
    expect(trace).not.toContain('annulation');
    expect(trace).not.toContain('DEBIT_APRES_COUP');
  });

  it('le bilan : « 1 réussie · 1 échouée · 1 jamais démarrée »', async () => {
    await lancer();
    expect(document.querySelector('[data-serie-bilan]')?.textContent)
      .toBe('1 réussie · 1 échouée · 1 jamais démarrée');
    expect(document.body.textContent).not.toContain('Envoyé au calendrier');
  });

  it('le message dit ce qui n a PAS eu lieu, et ne prétend pas avoir varié', async () => {
    await lancer();
    const texte = document.body.textContent ?? '';
    expect(texte).toContain('La variation du contenu 2/3 a échoué');
    expect(texte).toContain('rien n’a été composé ni débité pour ce contenu');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La règle d'attribution automatique, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('reattribuerAffichesAuto', () => {
  const pretes = affiches(10);
  it('des résultats suffisants REMPLACENT le lot (sens d une nouvelle recherche)', () => {
    const fraiches = Array.from({ length: 12 }, (_, i) => `https://cdn/new-${i}.jpg`);
    expect(reattribuerAffichesAuto(pretes, fraiches, 10)).toEqual(fraiches.slice(0, 10));
  });
  it('des résultats insuffisants ne dégradent JAMAIS un lot prêt', () => {
    const peu = ['https://cdn/new-1.jpg', 'https://cdn/new-2.jpg'];
    expect(reattribuerAffichesAuto(pretes, peu, 10)).toEqual(pretes);
    expect(batchPhotosReady(reattribuerAffichesAuto(pretes, peu, 10), 10)).toBe(true);
  });
  it('des résultats insuffisants COMPLÈTENT un lot incomplet, sans doublon', () => {
    const six = affiches(6);
    const peu = ['https://cdn/affiche-1.jpg', 'https://cdn/new-1.jpg', 'https://cdn/new-1.jpg', 'https://cdn/new-2.jpg'];
    expect(reattribuerAffichesAuto(six, peu, 10))
      .toEqual([...six, 'https://cdn/new-1.jpg', 'https://cdn/new-2.jpg']);
  });
  it('n atteint jamais le nombre en réutilisant une image', () => {
    const out = reattribuerAffichesAuto(affiches(3), ['https://cdn/affiche-1.jpg'], 10);
    expect(new Set(out).size).toBe(out.length);
    expect(batchPhotosReady(out, 10)).toBe(false);
  });
});

describe('messageAffichesManquantes', () => {
  it('automatique : chercher d autres photos', () => {
    const m = messageAffichesManquantes('auto', 6, 10);
    expect(m).toContain('Recherchez d’autres photos');
    expect(m).toContain('6 sur 10');
    expect(m).not.toContain('repassez en mode automatique');
  });
  it('manuel : compléter, ou repasser en automatique', () => {
    const m = messageAffichesManquantes('manuel', 6, 10);
    expect(m).toContain('repassez en mode automatique');
    expect(m).toContain('6 sur 10');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (d) L'ancien endpoint Batch : jamais référencé, toujours désactivé
// ────────────────────────────────────────────────────────────────────────────

describe('(d) L ancien rendu par lot', () => {
  it('le wizard ne référence jamais /api/render/batch', () => {
    const wizard = readFileSync(
      join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8',
    );
    expect(wizard).not.toContain('/api/render/batch');
  });

  it('et reste désactivé côté serveur', () => {
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });
});
