/**
 * CRÉER MULTI-SOURCES — finition (#543).
 *
 *  1. « Retirer le rush » ne retire QUE ce rush : les autres médias, leur
 *     ordre et la séquence Vidéo restent ; la séquence ne se masque que s'il
 *     ne reste aucune source visuelle (un rush seul : comportement d'avant).
 *  2. Durée par média : photo 1–30 s (− / +), vidéo raccourcie seulement
 *     (jamais au-delà de sa durée mesurée), avatar « Durée liée à la voix ».
 *     Portée par le média : brouillon, rechargement, réordonnancement.
 *  3. UNE durée : légende, infobulle, chronologie, aperçu et rendu lisent
 *     `dureeEffective` (l'infobulle « · 0:08 » contre « 0:02 » est corrigée).
 *  4-6. Aperçu du montage + chronologie = le plan passé à `composeVideo`
 *     (DURÉE AFFICHÉE = DURÉE APERÇUE = DURÉE RENDUE).
 *
 * Aucun fournisseur appelé : `fetch` et le compositeur sont doublés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;
vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlQuery }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, ensureFontsLoaded: async () => [], preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));

const optionsComposees: Array<Record<string, unknown>> = [];
const MONTAGE = () => new Blob([new Uint8Array(4096)], { type: 'video/webm' });
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: async (o: Record<string, unknown>) => {
      optionsComposees.push(o);
      return { video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) };
    },
    composeAndUpload: async () => { throw new Error('composeAndUpload ne doit pas être appelé'); },
    downloadBlob: async () => {},
  };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION, sanitizeDraft as sanitizeDraftBrut } from '../lib/creer/draft';
import {
  avecDureeChoisie, bornesDuree, chronologieListe, deplacerMedia, dureeEffective, estListeEnrichie, libelleMedia,
  planApercuListe, planDepuisListe, planDetaille, remplacerMedia, retirerMedia, sanitizeMediasVideo, titreMedia,
  DUREE_PHOTO_MAX, DUREE_PHOTO_MIN, type MediaVideo,
} from '@/lib/creer/medias-video';
import MediasSequenceVideo, { type MediasSequenceVideoProps } from '@/components/creer/MediasSequenceVideo';
import ApercuMontageListe from '@/components/creer/ApercuMontageListe';

const CLE = draftKey('a@b.c');
const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-plage.mp4';
const RUSH_B = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-salle.mp4';
const STOCK_V = 'https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-123.mp4';
const PHOTO = 'https://studiio.pro/storage/v1/object/public/media/u1/library/photo-plage.jpg';
const AFFICHE = 'https://studiio.pro/storage/v1/object/public/media/u1/affiche.jpg';
const INTERDIT_RESEAU = /heygen|elevenlabs|pexels\.com|unsplash\.com|api\.pexels|api\.unsplash|\/api\/avatar\/generate|\/api\/avatars?\/.*generate/i;

const rush = (o: Partial<MediaVideo> = {}): MediaVideo => ({ id: 'r1', source: 'rush', type: 'video', url: RUSH, duree: 4, nom: 'rush-plage.mp4', ...o });
const photo = (o: Partial<MediaVideo> = {}): MediaVideo => ({ id: 'p1', source: 'stock-photo', type: 'image', url: PHOTO, duree: 3, ...o });
const video = (o: Partial<MediaVideo> = {}): MediaVideo => ({ id: 's1', source: 'stock-video', type: 'video', url: STOCK_V, duree: 3, nom: 'Vidéo suggérée', ...o });
const avatar = (o: Partial<MediaVideo> = {}): MediaVideo => ({ id: 'a1', source: 'avatar', type: 'video', duree: null, ...o });

// ── 2. Durée par média (pur) ──────────────────────────────────────────────
describe('durée par média', () => {
  it('photo : − / + borné 1–30 s, défaut 3 s', () => {
    expect(dureeEffective(photo())).toBe(3);
    let p = photo();
    for (let i = 0; i < 40; i += 1) p = avecDureeChoisie(p, dureeEffective(p) + 1);
    expect(dureeEffective(p)).toBe(DUREE_PHOTO_MAX);
    for (let i = 0; i < 40; i += 1) p = avecDureeChoisie(p, dureeEffective(p) - 1);
    expect(dureeEffective(p)).toBe(DUREE_PHOTO_MIN);
    expect(avecDureeChoisie(photo(), 6).dureeChoisie).toBe(6);
    expect(bornesDuree(photo())).toMatchObject({ mode: 'photo', min: 1, max: 30, pas: 1 });
  });

  it('vidéo : raccourcie seulement, jamais au-delà de la durée mesurée, jamais sous 1 s', () => {
    const v = rush({ duree: 4 });
    expect(dureeEffective(v)).toBe(4);
    expect(dureeEffective(avecDureeChoisie(v, 2))).toBe(2);
    expect(dureeEffective(avecDureeChoisie(v, 99))).toBe(4);
    // Ramenée à sa mesure : la durée choisie disparaît (retour au défaut).
    expect(avecDureeChoisie(avecDureeChoisie(v, 2), 4).dureeChoisie).toBeUndefined();
    expect(dureeEffective(avecDureeChoisie(v, -5))).toBe(1);
    // Une durée choisie corrompue au-delà de la mesure ne passe jamais.
    expect(dureeEffective({ ...v, dureeChoisie: 50 })).toBe(4);
    expect(bornesDuree(v)).toMatchObject({ mode: 'video', min: 1, max: 4 });
    // Une vidéo raccourcie rend la liste « enrichie » (le plan déterministe la respecte).
    expect(estListeEnrichie([v])).toBe(false);
    expect(estListeEnrichie([avecDureeChoisie(v, 2)])).toBe(true);
  });

  it('avatar : aucune durée libre (« liée à la voix »)', () => {
    expect(bornesDuree(avatar()).mode).toBe('voix');
    const a = avatar({ url: '/m/avatar/g.mp4', duree: 9 });
    expect(avecDureeChoisie(a, 3)).toBe(a);
    expect(dureeEffective(a)).toBe(9);
  });

  it('brouillon : durée choisie gardée (bornée), suit le réordonnancement, le remplacement la remet au défaut', () => {
    const liste = [rush(), avecDureeChoisie(photo(), 6), avecDureeChoisie(video({ duree: 5 }), 3)];
    const relue = sanitizeMediasVideo(JSON.parse(JSON.stringify(liste)))!;
    expect(relue.map((m) => dureeEffective(m))).toEqual([4, 6, 3]);
    // Bornes au relu : photo > 30 s → 30 ; vidéo au-delà de sa mesure → défaut ; avatar → rien.
    const corrompue = sanitizeMediasVideo([
      { ...photo(), dureeChoisie: 99 }, { ...video({ duree: 5 }), dureeChoisie: 50 }, { ...avatar(), dureeChoisie: 4 },
    ])!;
    expect(corrompue[0].dureeChoisie).toBe(30);
    expect(corrompue[1].dureeChoisie).toBeUndefined();
    expect(corrompue[2].dureeChoisie).toBeUndefined();
    // Réordonnée : la durée part avec son média.
    const bougee = deplacerMedia(relue, 1, -1);
    expect(bougee.map((m) => [m.id, dureeEffective(m)])).toEqual([['p1', 6], ['r1', 4], ['s1', 3]]);
    // Remplacée : le neuf a la durée par défaut.
    const remplacee = remplacerMedia(relue, 1, photo({ id: 'p2' }));
    expect(dureeEffective(remplacee[1])).toBe(3);
    // Brouillon complet (sanitizeDraft) : idem.
    const d = sanitizeDraftBrut({ version: DRAFT_VERSION, rushUrl: RUSH, mediasVideo: liste }, {
      themeIds: ['fitness'], toneIds: ['pro'], formats: ['9:16'], maxStep: 3,
      defaults: {
        themeId: 'fitness', toneId: 'pro', format: '9:16', titleStyle: {}, subtitleStyle: {}, ctaStyle: {},
        sequences: [{ key: 'intro', enabled: true }], durations: { intro: 4, cards: 6, video: 8, cta: 4 },
      },
    } as never);
    expect(d?.mediasVideo?.map((m) => dureeEffective(m))).toEqual([4, 6, 3]);
  });
});

// ── 3. Une seule durée ────────────────────────────────────────────────────
describe('une seule durée : légende = infobulle = plan', () => {
  it('le nom posé par la recherche (« · 0:08 ») ne contredit plus la durée mesurée (0:02)', () => {
    const m = video({ duree: 2, nom: 'Vidéo suggérée · 0:08' });
    expect(libelleMedia(m)).toBe('Vidéo suggérée · 0:02');
    expect(titreMedia(m)).toBe('Vidéo suggérée · 0:02');
    const raccourcie = avecDureeChoisie(rush({ duree: 6 }), 4);
    expect(libelleMedia(raccourcie)).toBe('Rush personnel · 0:04');
    expect(titreMedia(raccourcie)).toBe('rush-plage.mp4 · 0:04');
    // Jamais un nom de fournisseur, même au survol.
    expect(titreMedia(video({ nom: 'stock-pexels-video-9.mp4' }))).toBeUndefined();
  });

  it('carte : infobulle et légende portent la même durée', () => {
    const { container } = render(<MediasSequenceVideo {...props({ medias: [video({ duree: 2, nom: 'Vidéo suggérée · 0:08' })] })} />);
    const lib = container.querySelector('[data-media-libelle]')!;
    const duree = /\d+:\d{2}/;
    expect(lib.textContent!.match(duree)![0]).toBe(lib.getAttribute('title')!.match(duree)![0]);
  });
});

// ── 4-6. Plan = chronologie = aperçu = rendu ──────────────────────────────
describe('plan unique', () => {
  const liste = [rush({ duree: 4 }), avecDureeChoisie(photo(), 5), video({ duree: 3 })];

  it('rush 4 s + photo 5 s + vidéo 3 s → 12 s partout ; sans le rush → 8 s', () => {
    const rendu = planDepuisListe(liste);
    expect(rendu.duree).toBe(12);
    const apercu = planApercuListe(planDetaille(liste));
    expect(apercu.etapes.map((e) => [e.url, e.debut, e.fin])).toEqual(rendu.plan.map((s) => [s.url, s.debut, s.fin]));
    const chrono = chronologieListe(planDetaille(liste), { dureeCta: 4 });
    expect(chrono.lignes.map((l) => `${l.libelle} ${l.debut}-${l.fin}`)).toEqual([
      'Rush personnel 0-4', 'Photo suggérée 4-9', 'Vidéo suggérée 9-12', 'CTA 12-16',
    ]);
    expect(chrono.dureeVideo).toBe(12);
    const sans = retirerMedia(liste, 0);
    expect(planDepuisListe(sans).duree).toBe(8);
    expect(chronologieListe(planDetaille(sans)).lignes.map((l) => l.libelle)).toEqual(['Photo suggérée', 'Vidéo suggérée']);
  });

  it('vidéo raccourcie : le plan la coupe à sa durée (entrée 0, sortie = durée choisie)', () => {
    const { plan, duree } = planDepuisListe([avecDureeChoisie(rush({ duree: 6 }), 2), photo()]);
    expect(plan[0]).toMatchObject({ debut: 0, fin: 2, depuis: 0, jusqua: 2 });
    expect(duree).toBe(5);
  });

  it('avatar à produire : l’aperçu prend la parole estimée, sans URL (aucune génération)', () => {
    const l = [avatar(), rush({ duree: 2 }), photo()];
    const { etapes, duree } = planApercuListe(planDetaille(l, { dureeParole: 10, source: 'estimee' }));
    expect(duree).toBe(10);
    expect(etapes[0]).toMatchObject({ source: 'avatar', url: null, debut: 0 });
    expect(etapes.map((e) => e.id)).toEqual(['a1', 'r1', 'p1']);
    // Le rendu, lui, attend l'avatar produit (rien n'est inventé).
    expect(planDepuisListe(l).ignores).toBe(1);
  });
});

// ── Composants ────────────────────────────────────────────────────────────
function props(sur: Partial<MediasSequenceVideoProps> = {}): MediasSequenceVideoProps {
  return {
    medias: [avatar(), rush(), photo()],
    etatAvatar: 'absent',
    onApercu: vi.fn(), onDeplacer: vi.fn(), onRemplacer: vi.fn(), onSupprimer: vi.fn(), onRecadrer: vi.fn(),
    onAjouterMonRush: vi.fn(), onAjouterAvatar: vi.fn(), onAjouterSuggere: vi.fn(), onAjouterMediatheque: vi.fn(),
    ...sur,
    plan: sur.plan ?? planDetaille(sur.medias ?? [avatar(), rush(), photo()], { dureeParole: 30, source: 'estimee' }),
  };
}

describe('MediasSequenceVideo — réglage de durée', () => {
  afterEach(cleanup);
  it('photo − / + ; vidéo : + grisé à sa durée mesurée ; avatar : « Durée liée à la voix » sans réglage', () => {
    const onDuree = vi.fn();
    const { container } = render(<MediasSequenceVideo {...props({ onDuree })} />);
    const [a, r, p] = Array.from(container.querySelectorAll('[data-media-item]'));
    expect(a.querySelector('[data-media-duree="voix"]')!.textContent).toBe('Durée liée à la voix · ≈ 23 s');
    expect(a.querySelector('[data-duree-moins], [data-duree-plus]')).toBeNull();
    expect(p.querySelector('[data-duree-valeur]')!.textContent).toBe('3 s');
    fireEvent.click(p.querySelector('[data-duree-plus]')!);
    expect(onDuree).toHaveBeenLastCalledWith(2, 4);
    fireEvent.click(p.querySelector('[data-duree-moins]')!);
    expect(onDuree).toHaveBeenLastCalledWith(2, 2);
    expect((r.querySelector('[data-duree-plus]') as HTMLButtonElement).disabled).toBe(true);
    expect((r.querySelector('[data-duree-moins]') as HTMLButtonElement).disabled).toBe(false);
  });
  it('bornes : photo à 30 s → + grisé ; à 1 s → − grisé', () => {
    const { container } = render(<MediasSequenceVideo {...props({ onDuree: vi.fn(), medias: [photo({ dureeChoisie: 30 }), photo({ id: 'p2', dureeChoisie: 1 })] })} />);
    const [p30, p1] = Array.from(container.querySelectorAll('[data-media-item]'));
    expect((p30.querySelector('[data-duree-plus]') as HTMLButtonElement).disabled).toBe(true);
    expect((p1.querySelector('[data-duree-moins]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ApercuMontageListe — lecteur local', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('joue la liste dans l’ordre puis le CTA, sans aucun appel réseau', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const liste = [avatar(), rush({ duree: 2 }), photo({ dureeChoisie: 2 })];
    const plan = planDetaille(liste, { dureeParole: 6, source: 'estimee' });
    const { etapes } = planApercuListe(plan);
    const { lignes } = chronologieListe(plan, { dureeCta: 2 });
    const { container } = render(
      <ApercuMontageListe etapes={etapes} lignes={lignes} format="9:16" accent="#7C3AED" ctaTexte="Viens" vignetteAvatar={null} />,
    );
    const racine = container.querySelector('[data-apercu-montage]')!;
    expect(Array.from(container.querySelectorAll('[data-ligne]')).map((e) => e.getAttribute('data-ligne'))).toEqual(['a1', 'r1', 'p1', 'cta']);
    expect(container.textContent).toContain('Votre avatar parlera ici');
    const vus: string[] = [];
    act(() => { fireEvent.click(container.querySelector('[data-apercu-montage-lecture]')!); });
    for (let i = 0; i < 90; i += 1) {
      act(() => { vi.advanceTimersByTime(100); });
      const id = racine.getAttribute('data-etape-courante')!;
      if (vus[vus.length - 1] !== id) vus.push(id);
    }
    expect(vus).toEqual(['a1', 'r1', 'p1', 'cta']);
    expect(racine.getAttribute('data-lecture')).toBe('non');
    expect(fetchSpy).not.toHaveBeenCalled();
    // « Revoir » repart du premier média.
    act(() => { fireEvent.click(container.querySelector('[data-apercu-montage-revoir]')!); });
    expect(racine.getAttribute('data-etape-courante')).toBe('a1');
  });
});

// ── 1 + 6. Le wizard ──────────────────────────────────────────────────────
interface Appel { url: string; method: string }
let appels: Appel[];
let postsCrees: Array<Record<string, unknown>>;

function installerFetch() {
  appels = [];
  postsCrees = [];
  let rang = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    appels.push({ url: u, method: m });
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps, text: async () => JSON.stringify(corps),
    } as unknown as Response);
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      rang += 1;
      const job = `job-${rang}`;
      return rep({ ok: true, jobId: job, uploadUrl: `/api/render/jobs/${job}/upload`, uploadMode: 'relais', publicUrl: `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${job}.webm`, cout: 10 });
    }
    if (/\/api\/render\/jobs\/job-\d+\/upload$/.test(u)) return rep({ ok: true });
    if (/\/api\/render\/jobs\/job-\d+\/confirm$/.test(u)) return rep({ ok: true, politique: 'credits', balance: 4990 });
    if (u.includes('/api/posts') && m === 'POST') {
      postsCrees.push(JSON.parse(String(init?.body ?? '{}')));
      return rep({ success: true, post: { id: `p${postsCrees.length}` } });
    }
    return rep({ success: true, data: [], posts: [], content: {}, images: [] });
  }) as unknown as typeof fetch;
}

const SEQUENCES = [
  { key: 'intro', enabled: true }, { key: 'cards', enabled: true },
  { key: 'video', enabled: true }, { key: 'cta', enabled: true },
];
const poser = (extra: Record<string, unknown>) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1,
    customTopic: 'yoga du matin', scheduledDate: '2026-09-01', posterUrl: AFFICHE,
    generated: {
      title: 'Yoga du matin', subtitle: 'Réveiller le corps',
      cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' }],
      cta: 'Viens', ctaSub: '',
    },
    sequences: SEQUENCES, ctaDuration: 4,
    ...extra,
  }));
};
const attendre = async (tours = 8) => {
  for (let i = 0; i < tours; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const ouvrirSection = async (id: string) => {
  const s = document.querySelector(`button[aria-controls="section-${id}"]`) as HTMLButtonElement;
  expect(s).toBeTruthy();
  if (s.getAttribute('aria-expanded') !== 'true') await act(async () => { fireEvent.click(s); });
};
const items = () => Array.from(document.querySelectorAll('[data-medias-video] [data-media-item]')).map((e) => e.getAttribute('data-media-item'));
const retirerLeRush = async () => {
  await act(async () => { fireEvent.click(document.querySelector('[aria-label="Retirer le rush"]')!); });
  await attendre();
};
const brouillon = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
  return JSON.parse(window.localStorage.getItem(CLE) ?? '{}');
};
const videoActive = (b: { sequences?: Array<{ key: string; enabled: boolean }> }) => !!b.sequences?.find((s) => s.key === 'video')?.enabled;
const chronologie = () => Array.from(document.querySelectorAll('[data-chronologie] [data-ligne]'))
  .map((e) => [e.getAttribute('data-ligne'), Number(e.getAttribute('data-debut')), Number(e.getAttribute('data-fin'))]);

beforeEach(() => {
  window.localStorage.clear();
  optionsComposees.length = 0;
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  urlQuery = new URLSearchParams('');
  window.alert = () => {};
  installerFetch();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const LISTE_3 = [
  { id: 'r1', source: 'rush', type: 'video', url: RUSH, duree: 4, nom: 'rush-plage.mp4' },
  { id: 'p1', source: 'stock-photo', type: 'image', url: PHOTO, duree: 3, dureeChoisie: 5 },
  { id: 's1', source: 'stock-video', type: 'video', url: STOCK_V, duree: 3, nom: 'Vidéo suggérée' },
];
const BROUILLON_3 = {
  rushUrl: RUSH, rushName: 'rush-plage.mp4', rushSecondes: 4,
  rushSuivants: [{ url: STOCK_V, name: 'Vidéo suggérée', secondes: 3 }],
  mediasVideo: LISTE_3, videoDuration: 12,
};

describe('« Retirer le rush » : ce rush seulement', () => {
  it('A — rush + photo : la photo reste, la séquence Vidéo aussi', async () => {
    poser({ rushUrl: RUSH, rushName: 'rush-plage.mp4', rushSecondes: 4, mediasVideo: [LISTE_3[0], LISTE_3[1]], videoDuration: 9 });
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('sequences');
    expect(items()).toEqual(['rush', 'stock-photo']);
    await retirerLeRush();
    expect(items()).toEqual(['stock-photo']);
    const b = await brouillon();
    expect(videoActive(b)).toBe(true);
    expect(b.rushUrl ?? null).toBeNull();
    expect(b.mediasVideo.map((m: MediaVideo) => m.id)).toEqual(['p1']);
    expect(b.videoDuration).toBe(5);
    // L'aperçu du montage est toujours là, sur la photo.
    expect(chronologie().map((l) => l[0])).toEqual(['p1', 'cta']);
  });

  it('B — rush + vidéo suggérée : la vidéo suggérée devient le rush principal, séquence gardée', async () => {
    poser({ rushUrl: RUSH, rushName: 'rush-plage.mp4', rushSecondes: 4, rushSuivants: [{ url: STOCK_V, name: 'Vidéo suggérée', secondes: 3 }], videoDuration: 7 });
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('sequences');
    expect(items()).toEqual(['rush', 'stock-video']);
    await retirerLeRush();
    expect(items()).toEqual(['stock-video']);
    const b = await brouillon();
    expect(videoActive(b)).toBe(true);
    expect(b.rushUrl).toBe(STOCK_V);
    expect(b.rushSuivants ?? []).toEqual([]);
  });

  it('C — rush + avatar + photo : avatar et photo restent, dans l’ordre', async () => {
    poser({
      rushUrl: RUSH, rushName: 'rush-plage.mp4', rushSecondes: 4,
      mediasVideo: [LISTE_3[0], { id: 'a1', source: 'avatar', type: 'video', duree: null }, LISTE_3[1]],
    });
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('sequences');
    expect(items()).toEqual(['rush', 'avatar', 'stock-photo']);
    await retirerLeRush();
    expect(items()).toEqual(['avatar', 'stock-photo']);
    const b = await brouillon();
    expect(videoActive(b)).toBe(true);
    expect(b.mediasVideo.map((m: MediaVideo) => m.source)).toEqual(['avatar', 'stock-photo']);
  });

  it('D — un seul rush : comportement d’avant (séquence masquée, durée nulle)', async () => {
    poser({ rushUrl: RUSH, rushName: 'rush-plage.mp4', rushSecondes: 4, videoDuration: 4 });
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('sequences');
    expect(items()).toEqual(['rush']);
    await retirerLeRush();
    expect(items()).toEqual([]);
    const b = await brouillon();
    expect(videoActive(b)).toBe(false);
    expect(b.rushUrl ?? null).toBeNull();
    expect(document.querySelector('[data-apercu-montage]')).toBeNull();
  });
});

describe('durées dans le wizard', () => {
  it('photo 5 s → 6 s : chronologie, brouillon et rechargement d’accord ; réordonnée, elle garde 6 s', async () => {
    poser(BROUILLON_3);
    const { unmount } = render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('sequences');
    const carte = () => document.querySelectorAll('[data-medias-video] [data-media-item]')[1];
    expect(carte().querySelector('[data-duree-valeur]')!.textContent).toBe('5 s');
    await act(async () => { fireEvent.click(carte().querySelector('[data-duree-plus]')!); });
    expect(carte().querySelector('[data-duree-valeur]')!.textContent).toBe('6 s');
    expect(chronologie()).toEqual([['r1', 0, 4], ['p1', 4, 10], ['s1', 10, 13], ['cta', 13, 17]]);
    // Réordonnée : la photo monte en tête avec ses 6 s.
    await act(async () => { fireEvent.click(document.querySelector('[aria-label="Monter le média 2"]')!); });
    expect(chronologie()).toEqual([['p1', 0, 6], ['r1', 6, 10], ['s1', 10, 13], ['cta', 13, 17]]);
    const b = await brouillon();
    expect(b.mediasVideo.find((m: MediaVideo) => m.id === 'p1').dureeChoisie).toBe(6);
    expect(b.videoDuration).toBe(13);
    // Rechargement : ordre et durées restaurés.
    unmount();
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('sequences');
    expect(items()).toEqual(['stock-photo', 'rush', 'stock-video']);
    expect(chronologie()).toEqual([['p1', 0, 6], ['r1', 6, 10], ['s1', 10, 13], ['cta', 13, 17]]);
    // Aucun appel fournisseur / génération pendant tout cela.
    expect(appels.filter((a) => INTERDIT_RESEAU.test(a.url))).toEqual([]);
  });
});

const envoyer = async () => {
  for (let i = 0; i < 6; i += 1) {
    if (document.querySelector('[data-batch-mode="unique"]')) break;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
  }
  await attendre(4);
  const bouton = document.querySelector('[data-envoi-action]') as HTMLButtonElement;
  expect(bouton).toBeTruthy();
  expect(bouton.disabled).toBe(false);
  await act(async () => { fireEvent.click(bouton); });
  await attendre(120);
};

describe('DURÉE AFFICHÉE = DURÉE APERÇUE = DURÉE RENDUE', () => {
  it('rush 4 s + photo 5 s + vidéo 3 s : 12 s à l’écran, dans l’aperçu et dans le rendu', async () => {
    poser(BROUILLON_3);
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('sequences');
    const ecran = chronologie();
    expect(ecran).toEqual([['r1', 0, 4], ['p1', 4, 9], ['s1', 9, 12], ['cta', 12, 16]]);
    // L'aperçu joue exactement ces étapes (même composant, même plan).
    expect(document.querySelector('[data-apercu-montage]')!.getAttribute('data-etape-courante')).toBe('r1');
    // Lire l'aperçu : aucun appel fournisseur ni génération.
    const avant = appels.length;
    await act(async () => { fireEvent.click(document.querySelector('[data-apercu-montage-lecture]')!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    await act(async () => { fireEvent.click(document.querySelector('[data-apercu-montage-lecture]')!); });
    expect(appels.slice(avant).filter((a) => INTERDIT_RESEAU.test(a.url)).map((a) => a.url)).toEqual([]);
    await envoyer();
    expect(optionsComposees).toHaveLength(1);
    const o = optionsComposees[0] as { videoDuration: number; montage: Array<{ url: string; debut: number; fin: number; kind?: string }> };
    expect(o.videoDuration).toBe(12);
    expect(o.montage.map((s) => [s.url, s.debut, s.fin])).toEqual([[RUSH, 0, 4], [PHOTO, 4, 9], [STOCK_V, 9, 12]]);
    expect(o.montage.map((s) => [s.debut, s.fin])).toEqual(ecran.slice(0, 3).map((l) => [l[1], l[2]]));
  });

  it('après « Retirer le rush » : 8 s à l’écran et au rendu, photo et vidéo gardées', async () => {
    poser(BROUILLON_3);
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('sequences');
    await retirerLeRush();
    expect(items()).toEqual(['stock-photo', 'stock-video']);
    expect(chronologie()).toEqual([['p1', 0, 5], ['s1', 5, 8], ['cta', 8, 12]]);
    await envoyer();
    const o = optionsComposees[0] as { videoDuration: number; montage: Array<{ url: string; debut: number; fin: number }> };
    expect(o.videoDuration).toBe(8);
    expect(o.montage.map((s) => [s.url, s.debut, s.fin])).toEqual([[PHOTO, 0, 5], [STOCK_V, 5, 8]]);
  });
});

describe('projet sans liste enrichie : rien de neuf dans l’aperçu', () => {
  it('rushes seuls : aucun aperçu du montage ni chronologie', async () => {
    poser({ rushUrl: RUSH, rushName: 'rush-plage.mp4', rushSecondes: 4, rushSuivants: [{ url: RUSH_B, name: 'b.mp4', secondes: 3 }] });
    render(<AssistantWizard />);
    await attendre();
    expect(document.querySelector('[data-apercu-montage]')).toBeNull();
    expect(document.querySelector('[data-chronologie]')).toBeNull();
  });
});
