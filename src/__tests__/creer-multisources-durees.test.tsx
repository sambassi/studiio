/**
 * CRÉER MULTI-SOURCES — RÈGLE ABSOLUE des durées (#543).
 *
 * Durée affichée (carte) = chronologie = aperçu du projet = plan passé à
 * `composeVideo` = durée réellement jouée. Aucune exception silencieuse.
 *
 *  - `planDetaille` est le SEUL calcul ; carte, chronologie, aperçu, rendu et
 *    brouillon lisent ses items ;
 *  - avec avatar, la narration est la durée maîtresse : les médias gardent
 *    EXACTEMENT leur durée, l'avatar prend le reste ; un dépassement est
 *    affiché, le réglage est borné, l'envoi est bloqué — jamais de réduction
 *    au rendu ;
 *  - parole RÉELLE plus courte à l'envoi : aucun rendu, message explicite,
 *    jumeau gardé — la relance ne le régénère pas (aucun second débit) ;
 *    plus longue : les créneaux d'avatar l'absorbent, médias inchangés.
 *
 * Aucun fournisseur appelé : `fetch` et le compositeur sont doublés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, ensureFontsLoaded: async () => [], preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));

const MONTAGE = () => new Blob([new Uint8Array(2048)], { type: 'video/webm' });
const composeVideoSpy = vi.fn(async (_o?: unknown) => ({ video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) }));
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: (...a: unknown[]) => composeVideoSpy(...(a as [])),
    composeAndUpload: async () => { throw new Error('composeAndUpload ne doit pas être appelé'); },
    downloadBlob: async () => {},
  };
});

/** Durée MESURÉE de la vidéo du jumeau produite (sonde `loadedmetadata` simulée). */
let dureeJumeau = 20;
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true,
  value(this: HTMLMediaElement) {
    if (!this.getAttribute('src')) return;
    Object.defineProperty(this, 'duration', { configurable: true, value: dureeJumeau });
    setTimeout(() => this.onloadedmetadata?.(new Event('loadedmetadata')), 0);
  },
});
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';
import {
  avecDureeChoisie, bornesDuree, chronologieListe, deplacerMedia, ajouterMedia, estimerDureeParole, itemDuPlan,
  messageNarration, planApercuListe, planDepuisListe, planDetaille, planRenduDepuis, sanitizeMediasVideo,
  AVATAR_CRENEAU_MIN_S, type MediaVideo, type PlanDetaille,
} from '@/lib/creer/medias-video';
import MediasSequenceVideo, { type MediasSequenceVideoProps } from '@/components/creer/MediasSequenceVideo';
import ApercuMontageListe from '@/components/creer/ApercuMontageListe';

const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-plage.mp4';
const STOCK_V = 'https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-123.mp4';
const PHOTO = 'https://studiio.pro/storage/v1/object/public/media/u1/library/photo-plage.jpg';
const AFFICHE = 'https://studiio.pro/storage/v1/object/public/media/u1/affiche.jpg';
const GENERATION = '55555555-5555-4555-8555-000000000009';
const URL_JUMEAU = `https://studiio.pro/storage/v1/object/public/media/u1/avatar/${GENERATION}.mp4`;

const rush = (o: Partial<MediaVideo> = {}): MediaVideo => ({ id: 'r1', source: 'rush', type: 'video', url: RUSH, duree: 4, nom: 'rush-plage.mp4', ...o });
const photo = (o: Partial<MediaVideo> = {}): MediaVideo => ({ id: 'p1', source: 'stock-photo', type: 'image', url: PHOTO, duree: 3, ...o });
const video = (o: Partial<MediaVideo> = {}): MediaVideo => ({ id: 's1', source: 'stock-video', type: 'video', url: STOCK_V, duree: 5, nom: 'Vidéo suggérée', ...o });
const avatar = (o: Partial<MediaVideo> = {}): MediaVideo => ({ id: 'a1', source: 'avatar', type: 'video', duree: null, ...o });
const estimee = (P: number) => ({ dureeParole: P, source: 'estimee' as const });

/** [id, debut, fin] de chaque item. */
const positions = (p: PlanDetaille) => p.items.map((it) => [it.id, it.debut, it.fin]);

function props(plan: PlanDetaille, sur: Partial<MediasSequenceVideoProps> = {}): MediasSequenceVideoProps {
  return {
    medias: plan.items.map((it) => it.media), plan,
    etatAvatar: 'pret',
    onApercu: vi.fn(), onDeplacer: vi.fn(), onRemplacer: vi.fn(), onSupprimer: vi.fn(), onRecadrer: vi.fn(), onDuree: vi.fn(),
    onAjouterMonRush: vi.fn(), onAjouterAvatar: vi.fn(), onAjouterSuggere: vi.fn(), onAjouterMediatheque: vi.fn(),
    ...sur,
  };
}
/** Ce que chaque carte AFFICHE : la valeur du réglage (« 4 s », « ≈ 5 s ») en secondes. */
const dureesCartes = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-media-item]')).map((li) => {
  const t = li.querySelector('[data-duree-valeur]')?.textContent ?? '';
  return Number(t.replace('≈', '').replace(/\s*s$/, '').replace(',', '.').trim());
});
/** La durée lue dans la LÉGENDE (« Photo suggérée · 0:06 ») en secondes, `null` sans durée. */
const dureesLegendes = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-media-libelle]')).map((e) => {
  const m = (e.textContent ?? '').match(/(\d+):(\d{2})(?:,(\d))?/);
  return m ? Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0) : null;
});

/** Lit l'aperçu (horloge simulée) et relève quand chaque étape commence / finit. */
function calendrierJoue(plan: PlanDetaille, dureeCta = 2): Array<[string, number, number]> {
  vi.useFakeTimers();
  try {
    const { etapes } = planApercuListe(plan);
    const { lignes } = chronologieListe(plan, { dureeCta });
    const { container } = render(<ApercuMontageListe etapes={etapes} lignes={lignes} format="9:16" accent="#7C3AED" ctaTexte="Viens" vignetteAvatar={null} />);
    const racine = container.querySelector('[data-apercu-montage]')!;
    const vus: Array<[string, number, number]> = [];
    let t = 0;
    act(() => { fireEvent.click(container.querySelector('[data-apercu-montage-lecture]')!); });
    let courant = racine.getAttribute('data-etape-courante')!;
    vus.push([courant, 0, 0]);
    const pas = 50;
    while (racine.getAttribute('data-lecture') === 'oui' && t < 120000) {
      act(() => { vi.advanceTimersByTime(pas); });
      t += pas;
      const id = racine.getAttribute('data-etape-courante')!;
      if (id !== courant) { vus[vus.length - 1][2] = t / 1000; vus.push([id, t / 1000, t / 1000]); courant = id; }
    }
    vus[vus.length - 1][2] = t / 1000;
    cleanup();
    return vus;
  } finally { vi.useRealTimers(); }
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

// ── A. Sans avatar : 4 + 5 + 3 = 12 s partout ─────────────────────────────
describe('A — sans avatar : aucune limite de narration', () => {
  const liste = [rush({ duree: 4 }), avecDureeChoisie(photo(), 5), video({ duree: 3 })];
  const plan = planDetaille(liste);

  it('carte = chronologie = aperçu joué = plan rendu : 4 + 5 + 3 = 12 s', () => {
    expect(plan.avecAvatar).toBe(false);
    expect(plan.depassement).toBe(0);
    expect(plan.dureeRestante).toBeNull();
    expect(positions(plan)).toEqual([['r1', 0, 4], ['p1', 4, 9], ['s1', 9, 12]]);
    expect(plan.duree).toBe(12);
    // Carte : réglage ET légende.
    const { container } = render(<MediasSequenceVideo {...props(plan)} />);
    expect(dureesCartes(container)).toEqual([4, 5, 3]);
    expect(dureesLegendes(container)).toEqual([4, 5, 3]);
    expect(container.querySelector('[data-narration]')).toBeNull();
    cleanup();
    // Chronologie.
    expect(chronologieListe(plan).lignes.map((l) => [l.id, l.debut, l.fin])).toEqual(positions(plan));
    // Aperçu joué (horloge simulée, pas de 50 ms).
    const joue = calendrierJoue(plan);
    expect(joue.map(([id]) => id)).toEqual(['r1', 'p1', 's1', 'cta']);
    joue.slice(0, 3).forEach(([, d, f], k) => {
      expect(d).toBeCloseTo(plan.items[k].debut, 1);
      expect(f).toBeCloseTo(plan.items[k].fin, 1);
    });
    // Entrée du rendu.
    const r = planDepuisListe(liste);
    expect(r.plan.map((s) => [s.debut, s.fin])).toEqual(plan.items.map((it) => [it.debut, it.fin]));
    expect(r.duree).toBe(12);
    expect(r.depassement).toBe(0);
  });

  it('photo 1–30 s et vidéo ≤ sa durée mesurée, sans autre borne', () => {
    expect(bornesDuree(liste[1], plan)).toMatchObject({ max: 30, limiteParNarration: false });
    expect(bornesDuree(liste[0], plan)).toMatchObject({ max: 4, limiteParNarration: false });
    expect(avecDureeChoisie(liste[1], 25, plan).dureeChoisie).toBe(25);
  });
});

// ── B. Avatar 20 s, 4 + 6 + 5 ─────────────────────────────────────────────
describe('B — avatar 20 s avec 4 + 6 + 5 : chaque média exact, le reste affiché', () => {
  const liste = [avatar(), rush({ duree: 4 }), avecDureeChoisie(photo(), 6), video({ duree: 5 })];
  const plan = planDetaille(liste, estimee(20));

  it('médias à leur durée, avatar = le reste, « 3,5 s disponibles »', () => {
    expect(plan.items.filter((it) => it.source !== 'avatar').map((it) => it.dureeEffective)).toEqual([4, 6, 5]);
    expect(positions(plan)).toEqual([['a1', 0, 5], ['r1', 5, 9], ['p1', 9, 15], ['s1', 15, 20]]);
    expect(plan.dureeMediasPlanifiee).toBe(15);
    expect(plan.dureeDisponible).toBe(20 - AVATAR_CRENEAU_MIN_S);
    expect(plan.dureeRestante).toBe(3.5);
    expect(plan.depassement).toBe(0);
    expect(messageNarration(plan)).toEqual({ depasse: false, texte: '3,5 s disponibles' });
    const { container } = render(<MediasSequenceVideo {...props(plan)} />);
    expect(container.querySelector('[data-narration]')!.textContent).toBe('Narration estimée : 20 s · 3,5 s disponibles');
    expect(dureesCartes(container)).toEqual([5, 4, 6, 5]);
    expect(dureesLegendes(container)).toEqual([null, 4, 6, 5]); // avatar : « produit à l'envoi »
    cleanup();
    expect(chronologieListe(plan).lignes.map((l) => [l.id, l.debut, l.fin])).toEqual(positions(plan));
    const joue = calendrierJoue(plan);
    expect(joue.map(([id]) => id)).toEqual(['a1', 'r1', 'p1', 's1', 'cta']);
    joue.slice(0, 4).forEach(([, d, f], k) => {
      expect(d).toBeCloseTo(plan.items[k].debut, 1);
      expect(f).toBeCloseTo(plan.items[k].fin, 1);
    });
  });

  it('photo [+] s’arrête au temps libre (6 + 3,5 = 9,5 s) ; vidéo ≤ min(mesure, place)', () => {
    expect(bornesDuree(liste[2], plan)).toMatchObject({ max: 9.5, limiteParNarration: true });
    expect(bornesDuree(liste[3], plan)).toMatchObject({ max: 5, limiteParNarration: false });
    // 15 s demandées → ramenées à 9,5 s AVANT l'enregistrement.
    const p15 = avecDureeChoisie(liste[2], 15, plan);
    expect(p15.dureeChoisie).toBe(9.5);
    const apres = planDetaille([liste[0], liste[1], p15, liste[3]], estimee(20));
    expect(apres.depassement).toBe(0);
    expect(itemDuPlan(apres, 'a1')!.dureeEffective).toBe(AVATAR_CRENEAU_MIN_S);
  });
});

// ── C. Avatar 10 s : rush 4 + photo 5, puis vidéo 4 ───────────────────────
describe('C — avatar 10 s : dépassement détecté, réglage borné, jamais enregistré', () => {
  it('photo 3 → 5 ramenée à 4,5 s ; la vidéo ajoutée déborde : signalée, [+] bloqué, aucune durée qui déborde n’est enregistrée', () => {
    let liste: MediaVideo[] = [avatar(), rush({ duree: 4 }), photo()];
    // 10 − 1,5 = 8,5 s pour les médias : 4 + 3 = 7 → 1,5 s libres.
    let plan = planDetaille(liste, estimee(10));
    expect(plan.dureeRestante).toBe(1.5);
    liste = [liste[0], liste[1], avecDureeChoisie(liste[2], 4, plan)];
    plan = planDetaille(liste, estimee(10));
    expect(itemDuPlan(plan, 'p1')!.dureeEffective).toBe(4);
    // 5 s demandées : seulement 4,5 s valides.
    const p5 = avecDureeChoisie(liste[2], 5, plan);
    expect(p5.dureeChoisie).toBe(4.5);
    liste = [liste[0], liste[1], p5];
    plan = planDetaille(liste, estimee(10));
    expect(plan.depassement).toBe(0);
    expect(plan.dureeRestante).toBe(0);
    expect(bornesDuree(p5, plan).max).toBe(4.5);
    // Ajouter une vidéo de 4 s : elle ne tient plus.
    liste = ajouterMedia(liste, video({ duree: 4 }));
    plan = planDetaille(liste, estimee(10));
    expect(plan.depassement).toBe(4);
    expect(plan.items.map((it) => it.horsNarration)).toEqual([false, false, false, true]);
    // Rien n'est raccourci : les médias gardent leur durée, l'avatar son minimum.
    expect(plan.items.map((it) => it.dureeEffective)).toEqual([AVATAR_CRENEAU_MIN_S, 4, 4.5, 4]);
    expect(messageNarration(plan)).toEqual({ depasse: true, texte: 'La durée totale dépasse la narration de 4 s' });
    // Réglages : [+] grisé sur la photo ET la vidéo ; un allongement ne s'enregistre pas.
    expect(avecDureeChoisie(liste[2], 6, plan).dureeChoisie).toBe(4.5);
    const { container } = render(<MediasSequenceVideo {...props(plan)} />);
    const cartes = Array.from(container.querySelectorAll('[data-media-item]'));
    expect((cartes[2].querySelector('[data-duree-plus]') as HTMLButtonElement).disabled).toBe(true);
    expect((cartes[3].querySelector('[data-duree-plus]') as HTMLButtonElement).disabled).toBe(true);
    expect((cartes[3].querySelector('[data-duree-moins]') as HTMLButtonElement).disabled).toBe(false);
    expect(cartes[3].getAttribute('data-hors-narration')).toBe('oui');
    expect(cartes[3].querySelector('[data-media-hors-narration]')!.textContent).toContain('Ne tient pas dans la narration');
    expect(container.querySelector('[data-narration]')!.getAttribute('data-narration')).toBe('depasse');
    expect(container.querySelector('[data-narration]')!.textContent).toContain('La durée totale dépasse la narration de 4 s');
    // Le rendu refuserait : le plan porte le dépassement.
    expect(planRenduDepuis(plan).depassement).toBe(4);
    // Raccourcir la vidéo à 0 s n'existe pas (1 s min) ; la retirer règle tout.
    const sans = planDetaille(liste.slice(0, 3), estimee(10));
    expect(sans.depassement).toBe(0);
  });

  it('estimation qui baisse (texte raccourci) : dépassement immédiat sur l’item, sans correction silencieuse', () => {
    const liste = [avatar(), rush({ duree: 4 }), avecDureeChoisie(photo(), 6)];
    expect(planDetaille(liste, estimee(15)).depassement).toBe(0);
    const p = planDetaille(liste, estimee(9));
    expect(p.depassement).toBe(2.5);
    expect(p.items.map((it) => it.horsNarration)).toEqual([false, false, true]);
    expect(itemDuPlan(p, 'p1')!.dureeEffective).toBe(6);
  });
});

// ── D. Réordonner après un changement de durée ────────────────────────────
describe('D — réordonner : debut / fin recalculés, cohérents partout', () => {
  it('photo 3 → 6, puis montée en tête : carte, chronologie, aperçu, rendu d’accord', () => {
    let liste = [avatar({ url: URL_JUMEAU, duree: 20 }), rush({ duree: 4 }), photo(), video({ duree: 5 })];
    let plan = planDetaille(liste);
    expect(plan.sourceParole).toBe('reelle');
    liste = liste.map((m) => (m.id === 'p1' ? avecDureeChoisie(m, 6, plan) : m));
    liste = deplacerMedia(liste, 2, -2);
    plan = planDetaille(liste);
    expect(positions(plan)).toEqual([['p1', 0, 6], ['a1', 6, 11], ['r1', 11, 15], ['s1', 15, 20]]);
    const rendu = planRenduDepuis(plan);
    expect(rendu.plan.map((s) => [s.url, s.debut, s.fin])).toEqual([[PHOTO, 0, 6], [URL_JUMEAU, 6, 11], [RUSH, 11, 15], [STOCK_V, 15, 20]]);
    // Lip-sync : l'avatar part de sa position dans la parole.
    expect(rendu.plan[1].depuis).toBe(6);
    expect(planApercuListe(plan).etapes.map((e) => [e.id, e.debut, e.fin])).toEqual(positions(plan));
    expect(chronologieListe(plan).lignes.map((l) => [l.id, l.debut, l.fin])).toEqual(positions(plan));
    const { container } = render(<MediasSequenceVideo {...props(plan)} />);
    expect(dureesCartes(container)).toEqual([6, 5, 4, 5]);
    expect(dureesLegendes(container)).toEqual([6, 5, 4, 5]);
  });
});

// ── E. Brouillon ──────────────────────────────────────────────────────────
describe('E — brouillon : seule la durée choisie (bornée) est écrite ; relue, le plan est identique', () => {
  it('aller-retour JSON → même plan, même entrée de rendu', () => {
    const base = [avatar(), rush({ duree: 4 }), photo(), video({ duree: 5 })];
    const plan0 = planDetaille(base, estimee(20));
    const liste = base.map((m) => (m.id === 'p1' ? avecDureeChoisie(m, 6, plan0) : m));
    const relue = sanitizeMediasVideo(JSON.parse(JSON.stringify(liste)))!;
    expect(relue.find((m) => m.id === 'p1')!.dureeChoisie).toBe(6);
    expect(Object.keys(relue.find((m) => m.id === 'p1')!)).not.toContain('debut');
    const a = planDetaille(liste, estimee(20));
    const b = planDetaille(relue, estimee(20));
    expect(positions(b)).toEqual(positions(a));
    expect(planRenduDepuis(b).plan).toEqual(planRenduDepuis(a).plan);
  });
});

// ── F / G + jumeau : le wizard ────────────────────────────────────────────
const CLE = draftKey('a@b.c');
/** 52 mots ≈ 20 s de parole estimée (2,6 mots/s). */
const TEXTE_20S = Array.from({ length: 52 }, (_, i) => `mot${i}`).join(' ');
/** La voix de la séquence Vidéo, reprise à la main (le remplissage automatique ne la remplace pas). */
const VOIX_20S = {
  sequenceVoices: { video: { text: TEXTE_20S } },
  sequenceVoicesUserEdited: { titre: true, cartes: true, video: true, cta: true },
};
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 3, nom: 'Bassi', valideLe: '2026-09-03' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: true, messageMoteur: null };

let trace: string[];
function installerFetch() {
  trace = [];
  let rang = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corps, text: async () => JSON.stringify(corps) } as Response);
    if (u === '/api/creer/jumeau/generer' && m === 'POST') {
      trace.push('jumeau:generer');
      return rep({ success: true, data: { generationId: GENERATION, status: 'pending', avatarVersion: 3, dejaEnCours: false, spoken: 'x' } });
    }
    if (u === '/api/creer/jumeau' && m === 'POST') { trace.push('jumeau:verif'); return rep({ success: true, data: PRET }); }
    if (u === '/api/creer/jumeau') return rep({ success: true, data: PRET });
    if (u.startsWith('/api/avatar/status?generationId=')) {
      trace.push('jumeau:status');
      return rep({ success: true, data: { status: 'completed', videoUrl: URL_JUMEAU, error: null } });
    }
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      trace.push('reservation');
      rang += 1;
      const job = `job-${rang}`;
      return rep({ ok: true, jobId: job, uploadUrl: `/api/render/jobs/${job}/upload`, uploadMode: 'relais', publicUrl: `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${job}.webm`, cout: 10 });
    }
    if (/\/api\/render\/jobs\/job-\d+\/upload$/.test(u)) return rep({ ok: true });
    if (/\/api\/render\/jobs\/job-\d+\/confirm$/.test(u)) return rep({ ok: true, politique: 'credits', balance: 4990 });
    if (u.includes('/api/posts') && m === 'POST') { trace.push('post'); return rep({ success: true, post: { id: 'p1' } }); }
    return rep({ success: true, ok: true, data: [], posts: [], sessions: [], luts: [], items: [], voices: [] });
  }) as unknown as typeof fetch;
}

const SEQUENCES = [{ key: 'video', enabled: true }, { key: 'cta', enabled: true }];
const LISTE_AVATAR = [
  { id: 'a1', source: 'avatar', type: 'video', duree: null },
  { id: 'r1', source: 'rush', type: 'video', url: RUSH, duree: 4, nom: 'rush-plage.mp4' },
  { id: 'p1', source: 'stock-photo', type: 'image', url: PHOTO, duree: 3, dureeChoisie: 6 },
  { id: 's1', source: 'stock-video', type: 'video', url: STOCK_V, duree: 5, nom: 'Vidéo suggérée' },
];
const poser = (extra: Record<string, unknown>) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1,
    customTopic: 'yoga du matin', scheduledDate: '2026-09-01', posterUrl: AFFICHE,
    generated: { title: 'Yoga du matin', subtitle: 'Réveiller le corps', cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' }], cta: 'Viens', ctaSub: '' },
    sequences: SEQUENCES, ctaDuration: 2,
    rushUrl: RUSH, rushName: 'rush-plage.mp4', rushSecondes: 4,
    rushSuivants: [{ url: STOCK_V, name: 'Vidéo suggérée', secondes: 5 }],
    ...extra,
  }));
};
const attendre = async (tours = 8) => {
  for (let i = 0; i < tours; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const ouvrirSequences = async () => {
  const s = document.querySelector('button[aria-controls="section-sequences"]') as HTMLButtonElement | null;
  if (s && s.getAttribute('aria-expanded') !== 'true') await act(async () => { fireEvent.click(s); });
};
const cartes = () => Array.from(document.querySelectorAll('[data-medias-video] [data-media-item]')) as HTMLElement[];
const chronologie = () => Array.from(document.querySelectorAll('[data-chronologie] [data-ligne]'))
  .map((e) => [e.getAttribute('data-ligne'), Number(e.getAttribute('data-debut')), Number(e.getAttribute('data-fin'))]);
const brouillon = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
  return JSON.parse(window.localStorage.getItem(CLE) ?? '{}');
};
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
  await act(async () => { fireEvent.click(bouton); });
  await attendre(150);
};
type Seg = { url: string; debut: number; fin: number; depuis?: number; kind?: string };
const montage = (k = 0) => ((composeVideoSpy.mock.calls[k] as unknown[])[0] as { montage: Seg[]; videoDuration: number });

describe('F / G — wizard : écran = aperçu = entrée du rendu', () => {
  beforeEach(() => { window.localStorage.clear(); composeVideoSpy.mockClear(); installerFetch(); dureeJumeau = 20; window.alert = () => {}; });

  it('sans avatar 4 + 5 + 3 : 12 s sur les cartes, la chronologie et le plan reçu par composeVideo', async () => {
    poser({
      rushSuivants: [{ url: STOCK_V, name: 'Vidéo suggérée', secondes: 3 }],
      mediasVideo: [LISTE_AVATAR[1], { ...LISTE_AVATAR[2], dureeChoisie: 5 }, { ...LISTE_AVATAR[3], duree: 3 }],
    });
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSequences();
    const ecran = cartes().map((c) => [c.getAttribute('data-media-id'), Number(c.getAttribute('data-debut')), Number(c.getAttribute('data-fin'))]);
    expect(ecran).toEqual([['r1', 0, 4], ['p1', 4, 9], ['s1', 9, 12]]);
    expect(cartes().map((c) => c.querySelector('[data-duree-valeur]')?.textContent)).toEqual(['4 s', '5 s', '3 s']);
    expect(chronologie()).toEqual([...ecran, ['cta', 12, 14]]);
    await envoyer();
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    expect(montage().montage.map((s) => [s.url, s.debut, s.fin])).toEqual([[RUSH, 0, 4], [PHOTO, 4, 9], [STOCK_V, 9, 12]]);
    expect(montage().videoDuration).toBe(12);
  });

  it('avatar estimé 20 s + 4 + 6 + 5 : « 3,5 s disponibles », puis photo → 15 s demandée : ramenée et jamais affichée au-delà', async () => {
    poser({ mediasVideo: LISTE_AVATAR, jumeauMode: 'avatar', ...VOIX_20S });
    expect(estimerDureeParole([TEXTE_20S])).toBe(20);
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSequences();
    const tete = document.querySelector('[data-medias-video] [data-narration]')!;
    expect(tete.textContent).toBe('Narration estimée : 20 s · 3,5 s disponibles');
    expect(cartes().map((c) => [c.getAttribute('data-media-id'), Number(c.getAttribute('data-debut')), Number(c.getAttribute('data-fin'))]))
      .toEqual([['a1', 0, 5], ['r1', 5, 9], ['p1', 9, 15], ['s1', 15, 20]]);
    expect(chronologie().slice(0, 4)).toEqual([['a1', 0, 5], ['r1', 5, 9], ['p1', 9, 15], ['s1', 15, 20]]);
    expect(document.querySelector('[data-chronologie-narration]')!.getAttribute('data-chronologie-narration')).toBe('estimee');
    // [+] × 9 sur la photo : 6 → 9,5 s au plus (7, 8, 9, puis 9,5 ramené), jamais au-delà.
    const plus = () => cartes()[2].querySelector('[data-duree-plus]') as HTMLButtonElement;
    const vus: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      if (!plus().disabled) await act(async () => { fireEvent.click(plus()); });
      vus.push(cartes()[2].querySelector('[data-duree-valeur]')!.textContent!);
    }
    expect(vus.every((v) => Number(v.replace(' s', '').replace(',', '.')) <= 9.5)).toBe(true);
    expect(vus.at(-1)).toBe('9,5 s');
    expect(plus().disabled).toBe(true);
    expect(document.querySelector('[data-media-note-duree]')?.textContent ?? '').toMatch(/narration de votre avatar/);
    expect(tete.textContent).toBe('Narration estimée : 20 s · 0 s disponibles');
    const b = await brouillon();
    expect(b.mediasVideo.find((m: MediaVideo) => m.id === 'p1').dureeChoisie).toBe(9.5);
    expect(b.videoDuration).toBe(20);
  });

  it('dépassement à l’estimation : l’envoi est bloqué AVANT tout appel (garde, jumeau, rendu)', async () => {
    poser({ mediasVideo: [...LISTE_AVATAR.slice(0, 3), { ...LISTE_AVATAR[3], duree: 12 }], rushSuivants: [{ url: STOCK_V, name: 'Vidéo suggérée', secondes: 12 }], jumeauMode: 'avatar', ...VOIX_20S });
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSequences();
    expect(document.querySelector('[data-medias-video] [data-narration]')!.getAttribute('data-narration')).toBe('depasse');
    expect(cartes()[3].getAttribute('data-hors-narration')).toBe('oui');
    await envoyer();
    expect(document.body.textContent).toContain('La durée totale dépasse la narration estimée de votre avatar (20 s) de 3,5 s');
    expect(trace).toEqual([]);
    expect(composeVideoSpy).not.toHaveBeenCalled();
  });
});

describe('parole RÉELLE à l’envoi (jumeau produit UNE fois)', () => {
  beforeEach(() => { window.localStorage.clear(); composeVideoSpy.mockClear(); installerFetch(); window.alert = () => {}; });

  it('plus courte (12 s) : aucun composeVideo, message, jumeau gardé ; raccourcir puis relancer → aucune seconde génération', async () => {
    dureeJumeau = 12;
    poser({ mediasVideo: LISTE_AVATAR, jumeauMode: 'avatar', ...VOIX_20S });
    const { unmount } = render(<AssistantWizard />);
    await attendre();
    await envoyer();
    expect(trace.filter((t) => t === 'jumeau:generer')).toHaveLength(1);
    expect(composeVideoSpy).not.toHaveBeenCalled();
    expect(trace).not.toContain('reservation');
    expect(document.body.textContent).toContain('Votre narration dure 12 s : réduisez vos médias de 4,5 s, puis relancez — votre avatar est déjà prêt, il ne sera pas regénéré.');
    // Le jumeau est dans la liste ET le brouillon, avec sa durée RÉELLE.
    const b = await brouillon();
    const a = b.mediasVideo.find((m: MediaVideo) => m.source === 'avatar');
    expect([a.url, a.duree]).toEqual([URL_JUMEAU, 12]);
    expect(b.jumeauMode).toBe('aucun');
    // Rechargement (revenu à l'étape Style) : l'écran dit « réelle » et le dépassement.
    unmount();
    window.localStorage.setItem(CLE, JSON.stringify({ ...b, step: 1 }));
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSequences();
    const tete = document.querySelector('[data-medias-video] [data-narration]')!;
    expect(tete.getAttribute('data-narration-source')).toBe('reelle');
    expect(tete.textContent).toContain('La durée totale dépasse la narration de 4,5 s');
    // Raccourcir la photo 6 → 1 s (− × 5) : 4 + 1 + 5 = 10 ≤ 10,5.
    const photoCarte = () => cartes().find((c) => c.getAttribute('data-media-id') === 'p1')!;
    for (let i = 0; i < 5; i += 1) await act(async () => { fireEvent.click(photoCarte().querySelector('[data-duree-moins]')!); });
    expect(tete.textContent).toBe('Narration réelle : 12 s · 0,5 s disponibles');
    await envoyer();
    // Toujours UNE génération : la relance réutilise le jumeau.
    expect(trace.filter((t) => t === 'jumeau:generer')).toHaveLength(1);
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    expect(montage().montage.map((s) => [s.url, s.debut, s.fin])).toEqual([[URL_JUMEAU, 0, 2], [RUSH, 2, 6], [PHOTO, 6, 7], [STOCK_V, 7, 12]]);
    expect(montage().montage[0].depuis).toBe(0);
    expect(montage().videoDuration).toBe(12);
  });

  it('plus longue (26 s) : les créneaux d’avatar absorbent, médias inchangés', async () => {
    dureeJumeau = 26;
    poser({ mediasVideo: LISTE_AVATAR, jumeauMode: 'avatar', ...VOIX_20S });
    render(<AssistantWizard />);
    await attendre();
    await envoyer();
    expect(trace.filter((t) => t === 'jumeau:generer')).toHaveLength(1);
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    expect(montage().montage.map((s) => [s.url, s.debut, s.fin])).toEqual([[URL_JUMEAU, 0, 11], [RUSH, 11, 15], [PHOTO, 15, 21], [STOCK_V, 21, 26]]);
    expect(montage().videoDuration).toBe(26);
  });
});
