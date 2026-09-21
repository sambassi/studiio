/**
 * La série au PLAFOND : dix vidéos, dans le créateur simple.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE, QUE `creer-serie-pilote` NE PROUVE PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le pilote vérifie une série de DEUX. Deux, c'est le minimum : la boucle y
 * fait un seul tour de variation, et une exécution parallèle par accident
 * (deux réservations avant la première confirmation) y est presque
 * invisible. À dix, tout ce qui compte devient observable :
 *
 *  - dix réservations, dix compositions, dix confirmations, dix posts —
 *    et neuf variations, jamais dix : la première garde le contenu affiché ;
 *  - dix identifiants de tentative, dix clés serveur, dix dates consécutives,
 *    chaque post relié à SA tentative — aucun identifiant écrasé en route ;
 *  - un ordre STRICTEMENT séquentiel : la tentative n+1 n'est ouverte
 *    qu'après le post n ; à aucun instant deux tentatives ne sont ouvertes ;
 *  - un échec au 4e tour arrête la série : trois réussies, une échouée, six
 *    JAMAIS démarrées — donc jamais réservées, jamais débitées ;
 *  - le brouillon porte bien `batchCount: 10` et dix affiches, et les
 *    retrouve après rechargement.
 *
 * L'écran est monté, les vrais boutons cliqués, la trace réseau lue. Les
 * assistants (`installerFetch`, `poser`, `allerAEnvoi`…) sont repris du
 * pilote plutôt qu'importés : un fichier de test n'expose pas d'API, et
 * partager des `let` globaux entre deux fichiers rendrait leur état
 * dépendant de l'ordre d'exécution.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BATCH_SERIE_MAX } from '@/lib/creer/batchDisponible';
import { BATCH_RENDER_DESACTIVE } from '@/lib/render/batch-disabled';
import { repriseAutorisee } from '@/lib/creer/batchRun';

vi.setConfig({ testTimeout: 60000 });

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
const composeVideoSpy = vi.fn(async () => ({
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

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
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
const DIX = 10;
const DATE_DEPART = '2026-09-01';
/** Dix affiches DISTINCTES : la série refuse de partir avec moins. */
const AFFICHES = Array.from({ length: DIX }, (_, i) => `https://cdn/affiche-${i + 1}.jpg`);

/** Chaque réservation reçoit son propre identifiant : c'est le point. */
const cleServeur = (job: string) =>
  `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${job}.webm`;

interface Scenario {
  politique?: 'credits' | 'partner_cost_only';
  /** Rang (1-based) du montage qui doit échouer, et à quelle étape. */
  echecAu?: { rang: number; etape: 'reservation' | 'televersement' | 'confirmation' };
  /**
   * Rang (1-based) de la VIDÉO dont la variation doit échouer : l'appel à
   * `/api/content/ai-generate` correspondant répond `{ success: false }`.
   * La première vidéo n'appelle jamais l'IA : la valeur utile commence à 2.
   */
  variationEchoue?: number;
}

/**
 * La trace porte le RANG de chaque étape (`reservation:3`), pour pouvoir
 * relire l'ordre des tentatives sans le deviner à partir de la position.
 */
let trace: string[];
let jobs: string[];
let postsCrees: Array<Record<string, unknown>>;
let variations: number;
/** Confirmations que le serveur a acceptées. */
let confirmationsOk: number;

const etape = (t: string) => t.split(':')[0];
const rangDe = (t: string) => Number(t.split(':')[1]);
const compter = (nom: string) => trace.filter((t) => etape(t) === nom).length;

const variationValide = (n: number) => ({
  success: true,
  content: {
    title: `Variation ${n}`,
    subtitle: 'sous-titre',
    cta: 'Go',
    ctaSub: '',
    cards: [
      { icon: 'Heart', label: `A${n}`, description: 'd', value: '1' },
      { icon: 'Zap', label: `B${n}`, description: 'd', value: '2' },
    ],
  },
});

function installerFetch(sc: Scenario = {}) {
  trace = [];
  jobs = [];
  postsCrees = [];
  variations = 0;
  confirmationsOk = 0;
  let rang = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps),
    } as unknown as Response);

    if (u.includes('/api/credits/balance')) {
      return rep({ ok: true, politique: sc.politique ?? 'credits', balance: 5000 });
    }
    if (u.includes('/api/render/tarifs')) {
      return sc.politique === 'partner_cost_only'
        ? rep({ ok: true, politique: 'partner_cost_only', tarifs: null, libelle: 'Frais partenaires uniquement' })
        : rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    }
    if (u.includes('/api/render/batch')) { trace.push('BATCH:0'); return rep({ disabled: true }, 503); }
    if (u.includes('/api/content/ai-generate') && m === 'POST') {
      variations += 1;
      // Le n-ième appel prépare la vidéo n+1 : la première ne varie pas.
      trace.push(`variation:${variations + 1}`);
      if (sc.variationEchoue === variations + 1) return rep({ success: false });
      return rep(variationValide(variations));
    }

    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      rang += 1;
      trace.push(`reservation:${rang}`);
      if (sc.echecAu?.rang === rang && sc.echecAu.etape === 'reservation') {
        return rep({ ok: false, error: 'refus' }, 500);
      }
      const job = `job-${rang}`;
      jobs.push(job);
      return rep({
        ok: true, jobId: job, uploadUrl: `/api/render/jobs/${job}/upload`,
        uploadMode: 'relais', publicUrl: cleServeur(job), cout: 10,
      });
    }
    const mUp = u.match(/\/api\/render\/jobs\/(job-\d+)\/upload$/);
    if (mUp && m === 'PUT') {
      const r = Number(mUp[1].split('-')[1]);
      trace.push(`televersement:${r}`);
      if (sc.echecAu?.rang === r && sc.echecAu.etape === 'televersement') return rep({ ok: false }, 500);
      return rep({ ok: true });
    }
    const mCf = u.match(/\/api\/render\/jobs\/(job-\d+)\/confirm$/);
    if (mCf) {
      const r = Number(mCf[1].split('-')[1]);
      trace.push(`confirmation:${r}`);
      if (sc.echecAu?.rang === r && sc.echecAu.etape === 'confirmation') {
        return rep({ ok: false, motif: 'objet_absent' }, 422);
      }
      confirmationsOk += 1;
      return rep({
        ok: true, politique: sc.politique ?? 'credits',
        balance: sc.politique === 'partner_cost_only' ? null : 5000 - 10 * confirmationsOk,
      });
    }
    const mCa = u.match(/\/api\/render\/jobs\/(job-\d+)\/cancel$/);
    if (mCa) { trace.push(`annulation:${Number(mCa[1].split('-')[1])}`); return rep({ ok: true }); }
    if (u.includes('/api/upload/signed-url')) {
      return rep({ success: true, signedUrl: 'https://minio.studiio.pro/v', publicUrl: 'https://cdn/v.jpg' });
    }
    if (u.includes('minio.studiio.pro')) return rep({ ok: true });
    if (u.includes('/api/credits/deduct')) { trace.push('DEBIT_APRES_COUP:0'); return rep({ success: true }); }
    if (/\/api\/(social\/publish|cron\/publish)/.test(u) && m === 'POST') { trace.push('PUBLICATION:0'); return rep({ ok: true }); }
    if (u.includes('/api/posts') && m === 'POST') {
      const corps = JSON.parse(String(init?.body ?? '{}'));
      postsCrees.push(corps);
      // Le rang du post est celui de la clé serveur qu'il porte.
      const r = Number(String(corps.media_url).match(/job-(\d+)\.webm$/)?.[1] ?? 0);
      trace.push(`post:${r}`);
      return rep({ success: true, post: { id: `p${postsCrees.length}` } });
    }
    return rep({ success: true, data: [], posts: [], content: {}, images: [] });
  }) as unknown as typeof fetch;
}

const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: DATE_DEPART,
    batchPhotoMode: 'manuel',
    batchPhotoUrls: AFFICHES,
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

const choisirSerie = async () => {
  const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLButtonElement;
  expect(serie.disabled, 'la carte Série doit être ouverte').toBe(false);
  await act(async () => { fireEvent.click(serie); });
  await attendre(4);
};

const choisirNombre = async (n: number) => {
  const b = document.querySelector(`[data-batch-count="${n}"]`) as HTMLButtonElement;
  expect(b, `le bouton ${n} doit exister`).toBeTruthy();
  await act(async () => { fireEvent.click(b); });
  await attendre(4);
};

/** Le bouton du nombre n'a pas d'`aria-pressed` : sa sélection est sa bordure. */
const nombreSelectionne = (n: number) => {
  const b = document.querySelector(`[data-batch-count="${n}"]`);
  if (!b) return false;
  const pressed = b.getAttribute('aria-pressed');
  if (pressed !== null) return pressed === 'true';
  return b.className.includes('border-purple-500');
};

/**
 * Lance l'envoi, puis attend que la trace ne bouge plus.
 *
 * Dix tours font beaucoup de micro-tâches : un nombre fixe de rondes serait
 * soit trop court (série coupée en pleine course, fausse alerte), soit trop
 * long (temps perdu). On attend la STABILITÉ : `calme` rondes sans une
 * nouvelle entrée, et l'écran sorti de l'état « envoi en cours ».
 */
const envoyer = async (maxTours = 1500, calme = 40) => {
  const b = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0] as HTMLButtonElement;
  expect(b).toBeTruthy();
  await act(async () => { fireEvent.click(b); });
  let stable = 0;
  let precedent = -1;
  for (let i = 0; i < maxTours; i += 1) {
    await attendre(1);
    if (trace.length === precedent) stable += 1;
    else { stable = 0; precedent = trace.length; }
    const termine = document.body.textContent?.includes('Envoyé au calendrier')
      || document.querySelector('[data-batch-report]') !== null;
    if (stable >= calme && termine) break;
  }
};

/** Le brouillon tel qu'il est écrit — après la pause du débounce (400 ms). */
const lireBrouillon = async (): Promise<Record<string, unknown>> => {
  await attendre(1, 600);
  return JSON.parse(window.localStorage.getItem(CLE) ?? '{}');
};

const jourSuivant = (iso: string, plus: number) => {
  const d = new Date(`${iso}T12:00:00`);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus, 12);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  composeVideoSpy.mockClear();
  composeAndUploadSpy.mockClear();
  window.alert = () => {};
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// 1. Dix vidéos, nominal
// ────────────────────────────────────────────────────────────────────────────

describe('1. Le plafond', () => {
  it('est dix', () => {
    expect(BATCH_SERIE_MAX).toBe(DIX);
  });
});

describe('1. Choisir dix à l écran, et le retrouver', () => {
  it('cliquer « 10 » après Série sélectionne dix, et le brouillon le porte avec ses dix affiches', async () => {
    installerFetch(); poser();
    await allerAEnvoi();
    expect(document.querySelector('[data-batch-mode="unique"]')?.getAttribute('aria-pressed')).toBe('true');
    await choisirSerie();
    expect(nombreSelectionne(DIX)).toBe(false);
    await choisirNombre(DIX);

    expect(nombreSelectionne(DIX)).toBe(true);
    for (let n = 2; n < DIX; n += 1) expect(nombreSelectionne(n), `${n} ne doit pas être sélectionné`).toBe(false);
    expect(document.querySelector('[data-serie-nombre]')?.textContent).toBe('10 vidéos');
    expect(document.querySelector('[data-facturation-recap]')?.textContent).toBe('100 crédits');

    const brouillon = await lireBrouillon();
    expect(brouillon.batchCount).toBe(DIX);
    expect(brouillon.batchPhotoUrls).toEqual(AFFICHES);
    expect(brouillon.batchPhotoMode).toBe('manuel');
  });

  it('un brouillon posé à dix rouvre la série à dix, sans clic', async () => {
    installerFetch(); poser({ batchCount: DIX });
    await allerAEnvoi();
    expect(document.querySelector('[data-batch-mode="serie"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(nombreSelectionne(DIX)).toBe(true);
    expect(document.querySelectorAll('[data-batch-count]')).toHaveLength(9);
    expect(document.querySelector('[data-serie-nombre]')?.textContent).toBe('10 vidéos');
  });

  it('après rechargement (démontage + remontage), dix est restauré et la série part bien à dix', async () => {
    installerFetch(); poser();
    await allerAEnvoi();
    await choisirSerie();
    await choisirNombre(DIX);
    const avant = await lireBrouillon();
    expect(avant.batchCount).toBe(DIX);

    // Rechargement simulé : le composant est démonté (ce qui écrit aussi le
    // brouillon), puis remonté depuis le SEUL stockage local.
    cleanup();
    const relu = JSON.parse(window.localStorage.getItem(CLE) ?? '{}');
    expect(relu.batchCount).toBe(DIX);
    expect(relu.batchPhotoUrls).toHaveLength(DIX);

    await allerAEnvoi();
    expect(nombreSelectionne(DIX)).toBe(true);
    expect(document.querySelector('[data-serie-nombre]')?.textContent).toBe('10 vidéos');

    await envoyer();
    expect(compter('reservation')).toBe(DIX);
    expect(compter('post')).toBe(DIX);
  });
});

describe('1. Une série de dix : dix tentatives, dix preuves, dix brouillons', () => {
  beforeEach(async () => {
    installerFetch(); poser({ batchCount: DIX });
    await allerAEnvoi();
    expect(nombreSelectionne(DIX)).toBe(true);
    await envoyer();
  });

  it('dix réservations, dix compositions, dix téléversements, dix confirmations, dix posts', () => {
    expect(compter('reservation')).toBe(DIX);
    expect(composeVideoSpy).toHaveBeenCalledTimes(DIX);
    expect(compter('televersement')).toBe(DIX);
    expect(compter('confirmation')).toBe(DIX);
    expect(confirmationsOk).toBe(DIX);
    expect(compter('post')).toBe(DIX);
    expect(postsCrees).toHaveLength(DIX);
  });

  it('neuf variations, jamais dix : la première garde le contenu affiché', () => {
    expect(variations).toBe(DIX - 1);
    expect(compter('variation')).toBe(DIX - 1);
    expect(String(postsCrees[0].title)).toBe('YOGA DU MATIN');
    for (let i = 1; i < DIX; i += 1) expect(String(postsCrees[i].title)).toBe(`VARIATION ${i}`);
  });

  it('dix tentatives DISTINCTES, dix clés distinctes, dix titres distincts', () => {
    expect(jobs).toEqual(Array.from({ length: DIX }, (_, i) => `job-${i + 1}`));
    expect(new Set(jobs).size).toBe(DIX);
    const urls = postsCrees.map((p) => String(p.media_url));
    expect(new Set(urls).size).toBe(DIX);
    const titres = postsCrees.map((p) => String(p.title));
    expect(new Set(titres).size).toBe(DIX);
  });

  it('chaque post porte l URL de SA tentative, dans l ordre — aucun identifiant écrasé', () => {
    for (let i = 0; i < DIX; i += 1) {
      expect(postsCrees[i].media_url, `post ${i + 1}`).toBe(cleServeur(`job-${i + 1}`));
      expect(postsCrees[i].media_url).toBe(cleServeur(jobs[i]));
    }
  });

  it('dix dates distinctes, un jour après l autre à partir du 1er septembre', () => {
    const dates = postsCrees.map((p) => String(p.scheduled_date));
    expect(new Set(dates).size).toBe(DIX);
    expect(dates[0]).toBe(DATE_DEPART);
    for (let i = 0; i < DIX; i += 1) expect(dates[i], `date ${i + 1}`).toBe(jourSuivant(DATE_DEPART, i));
    // Relues comme des jours civils : chaque écart fait exactement 24 h.
    for (let i = 1; i < DIX; i += 1) {
      const a = new Date(`${dates[i - 1]}T12:00:00`).getTime();
      const b = new Date(`${dates[i]}T12:00:00`).getTime();
      expect(b - a).toBe(24 * 3600 * 1000);
    }
  });

  it('pas de onzième, pas de Batch, pas de débit après coup, pas de publication', () => {
    expect(compter('reservation')).toBe(DIX);
    expect(trace.some((t) => rangDe(t) > DIX)).toBe(false);
    expect(compter('BATCH')).toBe(0);
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
    expect(compter('DEBIT_APRES_COUP')).toBe(0);
    expect(compter('PUBLICATION')).toBe(0);
    for (const post of postsCrees) {
      expect(post.status).toBe('draft');
      expect(post.platforms).toEqual([]);
    }
  });

  it('STRICTEMENT séquentiel : la tentative n+1 n ouvre qu après le post n', () => {
    const index = (nom: string, r: number) => trace.indexOf(`${nom}:${r}`);
    for (let r = 1; r < DIX; r += 1) {
      expect(index('reservation', r + 1), `réservation ${r + 1} vs post ${r}`).toBeGreaterThan(index('post', r));
      expect(index('reservation', r + 1), `réservation ${r + 1} vs confirmation ${r}`).toBeGreaterThan(index('confirmation', r));
      expect(index('confirmation', r)).toBeGreaterThan(index('televersement', r));
      expect(index('televersement', r)).toBeGreaterThan(index('reservation', r));
      expect(index('post', r)).toBeGreaterThan(index('confirmation', r));
    }
    // Et la variation d'une vidéo précède sa propre réservation.
    for (let r = 2; r <= DIX; r += 1) {
      expect(index('variation', r)).toBeGreaterThan(index('post', r - 1));
      expect(index('variation', r)).toBeLessThan(index('reservation', r));
    }
  });

  it('jamais deux tentatives ouvertes en même temps', () => {
    let ouvertes = 0;
    let pic = 0;
    for (const t of trace) {
      if (etape(t) === 'reservation') ouvertes += 1;
      if (etape(t) === 'confirmation') ouvertes -= 1;
      pic = Math.max(pic, ouvertes);
      expect(ouvertes, `à « ${t} »`).toBeLessThanOrEqual(1);
      expect(ouvertes).toBeGreaterThanOrEqual(0);
    }
    expect(pic).toBe(1);
    expect(ouvertes).toBe(0);
  });

  it('l écran annonce les dix, et aucun rapport d échec partiel', () => {
    expect(document.body.textContent).toContain('Envoyé au calendrier');
    expect(document.body.textContent).toContain('Les 10 vidéos sont composées');
    expect(document.querySelector('[data-batch-report]')).toBeNull();
    expect(document.querySelector('[data-serie-bilan]')).toBeNull();
  });
});

describe('1. La boucle, dans le code', () => {
  it('ne contient aucun Promise.all entre son ouverture et son finally', () => {
    const wizard = readFileSync(
      join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8',
    );
    const debut = wizard.indexOf('for (let b = 0; b < total; b += 1)');
    expect(debut).toBeGreaterThan(-1);
    // Le `finally` de la BOUCLE, pas celui de la capture d'écran à
    // l'intérieur d'un tour : c'est celui qui ferme le `try {` juste
    // au-dessus du `for`, à la même indentation.
    const debutLigne = wizard.lastIndexOf('\n', debut) + 1;
    const indentFor = wizard.slice(debutLigne, debut);
    const indentTry = indentFor.slice(0, -2);
    const ligneTry = `${indentTry}try {\n`;
    expect(wizard.slice(debutLigne - ligneTry.length, debutLigne)).toBe(ligneTry);
    const fin = wizard.indexOf(`\n${indentTry}} finally {`, debut);
    expect(fin).toBeGreaterThan(debut);
    const boucle = wizard.slice(debut, fin);
    // Le tour complet est bien dans la tranche : variation, réservation, post.
    expect(boucle).toContain("fetch('/api/posts'");
    expect(boucle).not.toContain('Promise.all(');
    expect(boucle).not.toContain('Promise.allSettled(');
    // Et la variation y est bien attendue AVANT toute réservation.
    expect(boucle).toContain('await generateBatchVariation(b, titresDejaVus)');
    expect(boucle.indexOf('await generateBatchVariation')).toBeLessThan(boucle.indexOf('composerEtFacturer('));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Échec au 4e tour
// ────────────────────────────────────────────────────────────────────────────

const BILAN_4_SUR_10 = '3 réussies · 1 échouée · 6 jamais démarrées';

describe('2. La quatrième échoue à la confirmation : trois gagnées, six jamais démarrées', () => {
  beforeEach(async () => {
    installerFetch({ echecAu: { rang: 4, etape: 'confirmation' } });
    poser({ batchCount: DIX });
    await allerAEnvoi();
    await envoyer();
  });

  it('quatre tentatives au plus, trois confirmées, trois posts, quatre compositions', () => {
    expect(compter('reservation')).toBe(4);
    expect(compter('confirmation')).toBe(4);
    expect(confirmationsOk).toBe(3);
    expect(trace.filter((t) => etape(t) === 'confirmation' && rangDe(t) <= 3)).toHaveLength(3);
    expect(compter('post')).toBe(3);
    expect(composeVideoSpy).toHaveBeenCalledTimes(4);
  });

  it('les six suivantes n ont JAMAIS démarré', () => {
    for (let r = 5; r <= DIX; r += 1) {
      expect(trace).not.toContain(`reservation:${r}`);
      expect(trace).not.toContain(`post:${r}`);
    }
    expect(jobs).toEqual(['job-1', 'job-2', 'job-3', 'job-4']);
    // La variation de la 5e n'a même pas été demandée : trois appels (2, 3, 4).
    expect(variations).toBe(3);
    expect(trace).not.toContain('variation:5');
    expect(trace).not.toContain('post:4');
    expect(postsCrees.map((p) => p.media_url)).toEqual([cleServeur('job-1'), cleServeur('job-2'), cleServeur('job-3')]);
  });

  it(`le bilan dit « ${BILAN_4_SUR_10} »`, () => {
    expect(document.querySelector('[data-serie-bilan]')?.textContent).toBe(BILAN_4_SUR_10);
    expect(document.querySelectorAll('[data-batch-item-state="pret"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-batch-item-state="echoue"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-batch-item-state="attente"]')).toHaveLength(6);
    expect(document.body.textContent).not.toContain('Envoyé au calendrier');
  });

  it('aucune reprise : refusée dans le code, grisée à l écran, et un clic ne réserve rien', async () => {
    expect(repriseAutorisee([]).autorisee).toBe(false);
    const reprise = document.querySelector('[data-batch-retry]') as HTMLButtonElement | null;
    expect(reprise, 'le bouton de reprise doit exister sur un lot').not.toBeNull();
    expect(reprise!.disabled).toBe(true);
    const avant = compter('reservation');
    await act(async () => { fireEvent.click(reprise!); });
    await attendre(20);
    expect(compter('reservation')).toBe(avant);
    expect(compter('reservation')).toBe(4);
  });

  it('aucun débit après coup, aucune publication, aucun Batch', () => {
    expect(compter('DEBIT_APRES_COUP')).toBe(0);
    expect(compter('PUBLICATION')).toBe(0);
    expect(compter('BATCH')).toBe(0);
  });
});

describe('2 bis. La VARIATION de la quatrième échoue : rien n est réservé pour elle', () => {
  beforeEach(async () => {
    installerFetch({ variationEchoue: 4 });
    poser({ batchCount: DIX });
    await allerAEnvoi();
    await envoyer();
  });

  it('exactement trois tentatives, trois confirmations, trois posts, trois compositions', () => {
    expect(variations).toBe(3);
    expect(trace).toContain('variation:4');
    expect(trace).not.toContain('variation:5');
    expect(compter('reservation')).toBe(3);
    expect(compter('confirmation')).toBe(3);
    expect(confirmationsOk).toBe(3);
    expect(compter('post')).toBe(3);
    expect(composeVideoSpy).toHaveBeenCalledTimes(3);
    expect(jobs).toEqual(['job-1', 'job-2', 'job-3']);
  });

  it(`le bilan dit « ${BILAN_4_SUR_10} »`, () => {
    expect(document.querySelector('[data-serie-bilan]')?.textContent).toBe(BILAN_4_SUR_10);
    expect(document.querySelectorAll('[data-batch-item-state="attente"]')).toHaveLength(6);
    expect(document.body.textContent).not.toContain('Envoyé au calendrier');
  });

  it('la reprise reste fermée', () => {
    expect(repriseAutorisee([]).autorisee).toBe(false);
    const reprise = document.querySelector('[data-batch-retry]') as HTMLButtonElement | null;
    expect(reprise?.disabled).toBe(true);
    expect(compter('DEBIT_APRES_COUP')).toBe(0);
  });
});
