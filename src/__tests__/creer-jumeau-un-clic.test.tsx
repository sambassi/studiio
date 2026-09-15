/**
 * « Utiliser mon jumeau » — UN SEUL CLIC jusqu'au montage final.
 *
 * Le parcours, en cliquant le vrai CTA « Composer et envoyer » :
 *
 *   garde serveur (POST /api/creer/jumeau)
 *   → solde
 *   → POST /api/creer/jumeau/generer (ElevenLabs + HeyGen, cote serveur)
 *   → GET /api/avatar/status … `completed`, URL re-hebergee
 *   → le rush de la sequence « Video » = cette URL (applyRush)
 *   → reservation → composition → televersement → confirmation → post
 *
 * dans CE clic. Le compositeur recoit l'URL du jumeau et une duree video
 * non nulle ; le post porte cette URL sous `rushUrls`. Sans l'option, pas
 * un appel jumeau, et le parcours est celui d'avant, a l'appel pres.
 *
 * Echec du jumeau (generer refuse, ou statut `failed`) : rien n'est
 * reserve, rien n'est compose, aucun post — et l'ecran le dit. Jamais une
 * video ordinaire livree sous ce nom.
 *
 * Meme harnais que `rendu-preuve-serveur-assistant.test.tsx` : compositeur
 * espionne, reseau double, ordre des appels enregistre.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (cards: unknown) => cards }));

const MONTAGE = () => new Blob([new Uint8Array(2048)], { type: 'video/webm' });
const composeVideoSpy = vi.fn(async (_o?: unknown) => ({ video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) }));
const composeAndUploadSpy = vi.fn(async () => ({ blob: MONTAGE(), url: 'https://cdn/libre.webm', thumbnailUrl: null, composerVersion: 'v1' }));
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: (...a: unknown[]) => composeVideoSpy(...(a as [])),
    composeAndUpload: (...a: unknown[]) => composeAndUploadSpy(...(a as [])),
    uploadRendu: (...a: unknown[]) => composeAndUploadSpy(...(a as [])),
    downloadBlob: async () => {},
  };
});

/**
 * La sonde de duree du rush (`probeRushDuration`) attend `loadedmetadata`,
 * que jsdom n'emet jamais : elle retomberait sur sa duree par defaut apres
 * 15 s. On publie une duree reelle des le `load()` — c'est elle qu'on veut
 * retrouver dans les options du compositeur.
 */
const DUREE_JUMEAU = 8;
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true,
  value(this: HTMLMediaElement) {
    if (!this.getAttribute('src')) return;
    Object.defineProperty(this, 'duration', { configurable: true, value: DUREE_JUMEAU });
    setTimeout(() => this.onloadedmetadata?.(new Event('loadedmetadata')), 0);
  },
});
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });

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
const JOB = 'job-77';
const CLE_SERVEUR = 'https://studiio.pro/storage/v1/object/public/media/u1/rendus/job-77.webm';
const CIBLE = '/api/render/jobs/job-77/upload';
const GENERATION = '55555555-5555-4555-8555-000000000001';
const URL_JUMEAU = `https://studiio.pro/storage/v1/object/public/media/u1/avatar/${GENERATION}.mp4`;
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 3, nom: 'Bassi', valideLe: '2026-09-03' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: true, messageMoteur: null };

interface Scenario {
  /** POST /generer refuse (ElevenLabs ou HeyGen en echec cote serveur, 502). */
  genererRefuse?: boolean;
  /** Le suivi rend `failed` (HeyGen a echoue apres le lancement). */
  statutEchoue?: boolean;
  /** Le garde dit non (moteur indisponible). */
  moteurIndisponible?: boolean;
}

let trace: string[];
let corpsGenerer: unknown;

function installerFetch(sc: Scenario = {}) {
  trace = [];
  corpsGenerer = undefined;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corps } as Response);

    if (u === '/api/creer/jumeau/generer' && m === 'POST') {
      trace.push('jumeau:generer');
      corpsGenerer = JSON.parse(String(init?.body));
      if (sc.genererRefuse) return rep({ success: false, error: 'Votre voix n’a pas pu être synthétisée.' }, 502);
      return rep({ success: true, data: { generationId: GENERATION, status: 'pending', avatarVersion: 3, dejaEnCours: false, spoken: 'x' } });
    }
    if (u === '/api/creer/jumeau' && m === 'POST') {
      trace.push('jumeau:verif');
      return rep({ success: true, data: sc.moteurIndisponible ? { ...PRET, moteurDisponible: false, messageMoteur: 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.' } : PRET });
    }
    if (u === '/api/creer/jumeau') { trace.push('jumeau:etat'); return rep({ success: true, data: PRET }); }
    if (u.startsWith('/api/avatar/status?generationId=')) {
      trace.push('jumeau:status');
      expect(u).toBe(`/api/avatar/status?generationId=${GENERATION}`);
      if (sc.statutEchoue) return rep({ success: true, data: { status: 'failed', videoUrl: null, error: "Le fournisseur n'a pas pu animer votre avatar." } });
      return rep({ success: true, data: { status: 'completed', videoUrl: URL_JUMEAU, error: null } });
    }
    if (u.includes('/api/credits/balance')) { trace.push('solde'); return rep({ ok: true, politique: 'credits', balance: 5000 }); }
    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      trace.push('reservation');
      return rep({ ok: true, jobId: JOB, uploadUrl: CIBLE, uploadMode: 'relais', publicUrl: CLE_SERVEUR, cout: 10 });
    }
    if (u.includes('/jobs/job-77/upload') && m === 'PUT') { trace.push('televersement'); return rep({}); }
    if (u.includes(`/api/render/jobs/${JOB}/confirm`)) { trace.push('confirmation'); return rep({ ok: true, politique: 'credits', balance: 4990 }); }
    if (u.includes(`/api/render/jobs/${JOB}/cancel`)) { trace.push('annulation'); return rep({ ok: true }); }
    if (u.includes('/api/upload/signed-url')) return rep({ success: true, signedUrl: 'https://minio/vignette', publicUrl: 'https://cdn/v.jpg' });
    if (u.includes('minio/vignette')) return rep({});
    if (u.includes('/api/posts') && m === 'POST') { trace.push('post'); return rep({ success: true, post: { id: 'p1' } }); }
    if (u.includes('/api/autopilot/config')) return rep({ success: true, ready: true, brandingReady: true, config: {} });
    return rep({ success: true, ok: true, sessions: [], luts: [], items: [], voices: [] });
  }) as unknown as typeof fetch;
}

const poser = (useDigitalTwin: boolean) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4, useDigitalTwin,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
  }));
};

const allerAEnvoi = async () => {
  render(<AssistantWizard />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  for (let i = 0; i < 4; i += 1) {
    if (document.querySelector('[data-batch-mode="unique"]')) break;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
  }
  expect(document.querySelector('[data-batch-mode="unique"]')).not.toBeNull();
};

/** UN clic, puis on laisse le parcours entier se derouler. */
const envoyerUneFois = async () => {
  const b = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0] as HTMLButtonElement;
  expect(b).toBeTruthy();
  await act(async () => { fireEvent.click(b); });
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

/** Le brouillon s'ecrit 400 ms apres le dernier changement. */
const pauseDeFrappe = () => act(async () => { await new Promise((r) => setTimeout(r, 500)); });

const ETAPES = ['jumeau:verif', 'jumeau:generer', 'jumeau:status', 'reservation', 'televersement', 'confirmation', 'annulation', 'post'];
const parcours = () => trace.filter((t) => ETAPES.includes(t));
const optionsCompositeur = () => (composeVideoSpy.mock.calls[0] as unknown[])[0] as { videoUrl?: string; videoDuration?: number; sequenceOrder?: string[] };

beforeEach(() => { window.localStorage.clear(); composeVideoSpy.mockClear(); composeAndUploadSpy.mockClear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('useDigitalTwin=true — un seul clic jusqu’au montage final', () => {
  it('⚠️ garde → generer → status → reservation → composition → televersement → confirmation → post, dans CE clic', async () => {
    installerFetch(); poser(true);
    await allerAEnvoi();
    await envoyerUneFois();
    expect(parcours()).toEqual(['jumeau:verif', 'jumeau:generer', 'jumeau:status', 'reservation', 'televersement', 'confirmation', 'post']);
    // Le solde est relu AVANT de produire le jumeau (celui du montage est
    // lu une premiere fois a l'ouverture de l'ecran : c'est la DERNIERE
    // lecture qui ordonne) : rien n'est paye sans couverture.
    expect(trace.lastIndexOf('solde')).toBeGreaterThan(trace.indexOf('jumeau:verif'));
    expect(trace.lastIndexOf('solde')).toBeLessThan(trace.indexOf('jumeau:generer'));
    // Le navigateur n'envoie que textes et format — aucun identifiant.
    expect(Object.keys(corpsGenerer as object).sort()).toEqual(['aspectRatio', 'textes']);
    expect((corpsGenerer as { textes: string[] }).textes.length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('Envoyé au calendrier');
  });

  it('⚠️ le compositeur recoit l’URL du jumeau comme rush, la sequence « Video » active et sa duree mesuree', async () => {
    installerFetch(); poser(true);
    await allerAEnvoi();
    await envoyerUneFois();
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    const o = optionsCompositeur();
    expect(o.videoUrl).toBe(URL_JUMEAU);
    expect(o.videoDuration).toBe(DUREE_JUMEAU);
    expect(o.sequenceOrder).toContain('video');
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
  });

  it('le post porte l’URL du jumeau sous rushUrls et une duree video non nulle', async () => {
    installerFetch(); poser(true);
    await allerAEnvoi();
    await envoyerUneFois();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const post = appels.find((a) => String(a[0]).includes('/api/posts'));
    const corps = JSON.parse(String((post?.[1] as RequestInit)?.body));
    expect(corps.media_url).toBe(CLE_SERVEUR);
    expect(corps.metadata.rushUrls).toEqual([URL_JUMEAU]);
    expect(corps.metadata.sequences.video).toBe(DUREE_JUMEAU);
    expect(corps.metadata.sequences.order).toContain('video');
    // L'intention est honoree et levee : le brouillon ne la porte plus, le rush reste.
    await pauseDeFrappe();
    const brouillon = JSON.parse(window.localStorage.getItem(CLE)!);
    expect(brouillon.useDigitalTwin).toBe(false);
    expect(brouillon.rushUrl).toBe(URL_JUMEAU);
  });

  it('⚠️ generer refuse (ElevenLabs/HeyGen en echec) → aucune reservation, aucune composition, aucun post ; l’ecran le dit', async () => {
    installerFetch({ genererRefuse: true }); poser(true);
    await allerAEnvoi();
    await envoyerUneFois();
    expect(parcours()).toEqual(['jumeau:verif', 'jumeau:generer']);
    expect(composeVideoSpy).not.toHaveBeenCalled();
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Votre voix n’a pas pu être synthétisée.');
    expect(document.body.textContent).not.toContain('Envoyé au calendrier');
  });

  it('⚠️ statut `failed` (HeyGen apres lancement) → aucun repli vers une video ordinaire', async () => {
    installerFetch({ statutEchoue: true }); poser(true);
    await allerAEnvoi();
    await envoyerUneFois();
    expect(parcours()).toEqual(['jumeau:verif', 'jumeau:generer', 'jumeau:status']);
    expect(composeVideoSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Le fournisseur n'a pas pu animer votre avatar.");
    expect(document.body.textContent).not.toContain('Envoyé au calendrier');
    // L'intention reste posee : rien n'a ete honore.
    await pauseDeFrappe();
    expect(JSON.parse(window.localStorage.getItem(CLE)!).useDigitalTwin).toBe(true);
  });

  it('moteur indisponible → le garde arrete tout avant le solde ; rien n’est genere ni compose', async () => {
    installerFetch({ moteurIndisponible: true }); poser(true);
    await allerAEnvoi();
    await envoyerUneFois();
    expect(parcours()).toEqual(['jumeau:verif']);
    // Aucune lecture de solde APRES le garde : on s'est arrete la.
    expect(trace.slice(trace.indexOf('jumeau:verif') + 1)).not.toContain('solde');
    expect(composeVideoSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('n’est pas encore disponible');
  });
});

describe('useDigitalTwin=false — le parcours normal, inchange', () => {
  it('⚠️ aucun appel jumeau ; reservation → composition → televersement → confirmation → post ; pas de rush', async () => {
    installerFetch(); poser(false);
    await allerAEnvoi();
    await envoyerUneFois();
    expect(parcours()).toEqual(['reservation', 'televersement', 'confirmation', 'post']);
    expect(trace.filter((t) => t.startsWith('jumeau:'))).toEqual([]);
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    const o = optionsCompositeur();
    expect(o.videoUrl).toBeUndefined();
    expect(o.videoDuration).toBe(0);
    expect(o.sequenceOrder).not.toContain('video');
  });
});
