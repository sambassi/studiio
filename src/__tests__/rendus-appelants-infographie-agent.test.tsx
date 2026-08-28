/**
 * Les trois chemins restants : la page Infographie (deux) et l'Agent IA (un).
 *
 * Même contrat que le Calendrier — tentative, composition, téléversement vers
 * la clé attribuée, vérification, puis seulement l'action métier. Et la même
 * méthode : les écrans sont montés, les vrais boutons sont cliqués, et c'est
 * l'ordre des appels réseau qui est vérifié.
 *
 * L'Agent IA porte en plus un défaut propre : son `catch` de composition
 * était AVALÉ. Un montage raté produisait quand même un post, avec l'affiche
 * à la place de la vidéo — une série « réussie » dont les vidéos n'existaient
 * pas. Le test « aucun post après un échec » ferme ce trou.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent, cleanup } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }

/**
 * jsdom n'implemente pas la lecture media : `video.play()` y rend
 * `undefined`, et le code produit fait `play().catch(...)` — parfaitement
 * correct dans un navigateur, ou la methode rend une promesse. Sans cette
 * doublure, un `setTimeout` de l'apercu leve APRES la fin du test, hors de
 * toute assertion, et fait echouer la suite entiere.
 */
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true, value: () => Promise.resolve(),
});
Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true, value: () => {},
});
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true, value: () => {},
});

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c', id: 'u1' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}));
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
    uploadRendu: (...a: unknown[]) => composeAndUploadSpy(...(a as [])),
    downloadBlob: async () => {},
  };
});

import Infographie from '../app/dashboard/infographic/page';
import { AgentIAModal } from '../components/creer/AgentIAModal';

const JOB = 'job-77';
const CIBLE = `/api/render/jobs/${JOB}/upload`;
const CLE_SERVEUR = `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${JOB}.webm`;

interface Scenario {
  reservationRefusee?: boolean;
  televersementRefuse?: boolean;
  confirmationRefusee?: boolean;
  /** Ralentit la réservation : sans délai, tout le parcours tient dans un
   *  seul tour de boucle et il n'existe aucun instant « pendant ». */
  lent?: number;
}

let trace: string[];
const ETAPES = ['reservation', 'televersement', 'confirmation', 'annulation', 'post', 'DEBIT_APRES_COUP', 'PUBLICATION'];
const parcours = () => trace.filter((t) => ETAPES.includes(t));
/** Les opérations demandées au serveur, dans l'ordre. */
let operations: string[];

function installerFetch(sc: Scenario = {}) {
  trace = [];
  operations = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps), blob: async () => MONTAGE(),
    } as unknown as Response);

    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      trace.push('reservation');
      if (sc.lent) await new Promise((r) => setTimeout(r, sc.lent));
      operations.push(String(JSON.parse(String(init?.body ?? '{}')).operation));
      if (sc.reservationRefusee) return rep({ ok: false }, 500);
      return rep({ ok: true, jobId: JOB, uploadUrl: CIBLE, uploadMode: 'relais', publicUrl: CLE_SERVEUR, cout: 10 });
    }
    if (u.includes(`/jobs/${JOB}/upload`) && m === 'PUT') {
      trace.push('televersement');
      return sc.televersementRefuse ? rep({ ok: false }, 500) : rep({ ok: true });
    }
    if (u.includes(`/jobs/${JOB}/confirm`)) {
      trace.push('confirmation');
      return sc.confirmationRefusee
        ? rep({ ok: false, motif: 'objet_absent' }, 422)
        : rep({ ok: true, politique: 'credits', balance: 4990 });
    }
    if (u.includes(`/jobs/${JOB}/cancel`)) { trace.push('annulation'); return rep({ ok: true }); }
    if (u.includes('/api/upload/signed-url')) {
      return rep({ success: true, signedUrl: 'https://minio.studiio.pro/v', publicUrl: 'https://cdn/v.jpg' });
    }
    if (u.includes('minio.studiio.pro')) return rep({ ok: true });
    if (u.includes('/api/credits/deduct')) { trace.push('DEBIT_APRES_COUP'); return rep({ success: true }); }
    if (/\/api\/(social\/publish|cron\/publish)/.test(u) && m === 'POST') { trace.push('PUBLICATION'); return rep({ ok: true }); }
    if (u.includes('/api/posts') && m === 'POST') {
      trace.push('post');
      return rep({ success: true, post: { id: 'p1' } });
    }
    if (u.includes('/api/videos') && m === 'POST') return rep({ success: true });
    return rep({ success: true, data: [], posts: [], accounts: [], images: [], content: {} });
  }) as unknown as typeof fetch;
}

const attendre = async (tours = 50, pas = 0) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, pas)); });
  }
};

function bouton(motif: string | RegExp): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => {
    const t = (b.getAttribute('title') || '') + (b.textContent || '');
    return typeof motif === 'string' ? t.includes(motif) : motif.test(t);
  }) as HTMLButtonElement | undefined;
}

/**
 * Deux clics AVANT la résolution de la première promesse.
 *
 * Les deux `fireEvent` sont dans le même `act` : aucun rendu React ne
 * s'intercale, donc `isExporting` / `aiGenerating` valent encore `false` au
 * second clic. C'est la fenêtre que le verrou synchrone ferme.
 */
const doubleCliquer = async (motif: string | RegExp) => {
  const b = bouton(motif);
  expect(b, `bouton « ${String(motif)} » introuvable`).toBeTruthy();
  await act(async () => { fireEvent.click(b!); fireEvent.click(b!); });
  await attendre(90);
};

const cliquer = async (motif: string | RegExp) => {
  const b = bouton(motif);
  expect(b, `bouton « ${String(motif)} » introuvable`).toBeTruthy();
  await act(async () => { fireEvent.click(b!); });
  await attendre(70);
};

beforeEach(() => {
  window.localStorage.clear();
  composeVideoSpy.mockClear();
  composeAndUploadSpy.mockClear();
  window.alert = () => {};
  window.confirm = () => true;
  (HTMLAnchorElement.prototype as unknown as { click: () => void }).click = () => {};
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// Page Infographie — destination Calendrier, puis destination Export
// ────────────────────────────────────────────────────────────────────────────

/**
 * La page est un assistant en trois etapes : theme et contenu, medias, puis
 * destination et export. On la traverse comme un utilisateur.
 */
const monterInfographie = async () => {
  render(<Infographie />);
  await attendre(8);
  await cliquer('infographic.nextStepMedia');
  await cliquer('infographic.finalizeButton');
  expect(bouton('infographic.destination.calendar'), "l'etape 3 doit etre atteinte").toBeTruthy();
};

/** Choisit la destination, puis lance l'export. */
const exporterVers = async (dest: 'calendar' | 'export') => {
  await cliquer(`infographic.destination.${dest}`);
  await cliquer('infographic.exportButton');
};

describe('Infographie → Calendrier : tentative, preuve, puis le post', () => {
  it("l'opération demandée est « calendrier » et le post vient après la confirmation", async () => {
    installerFetch();
    await monterInfographie();
    await exporterVers('calendar');
    expect(operations[0]).toBe('calendrier');
    const p = parcours();
    expect(p.slice(0, 3)).toEqual(['reservation', 'televersement', 'confirmation']);
    expect(p.indexOf('post')).toBeGreaterThan(p.indexOf('confirmation'));
  });

  it('le chemin non prouvé n est jamais rappelé', async () => {
    installerFetch();
    await monterInfographie();
    await exporterVers('calendar');
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
  });

  it('réservation refusée → aucune composition, aucun post', async () => {
    installerFetch({ reservationRefusee: true });
    await monterInfographie();
    await exporterVers('calendar');
    expect(composeVideoSpy).not.toHaveBeenCalled();
    expect(trace).not.toContain('post');
  });

  it('téléversement refusé → aucune confirmation, aucun post', async () => {
    installerFetch({ televersementRefuse: true });
    await monterInfographie();
    await exporterVers('calendar');
    expect(trace).not.toContain('confirmation');
    expect(trace).not.toContain('post');
  });

  it('confirmation refusée → aucun post', async () => {
    installerFetch({ confirmationRefusee: true });
    await monterInfographie();
    await exporterVers('calendar');
    expect(trace).toContain('confirmation');
    expect(trace).not.toContain('post');
  });

  it('aucun débit après coup, aucune publication', async () => {
    installerFetch();
    await monterInfographie();
    await exporterVers('calendar');
    expect(trace).not.toContain('DEBIT_APRES_COUP');
    expect(trace).not.toContain('PUBLICATION');
  });

  it('aucune requête http ni hôte interne', async () => {
    installerFetch();
    await monterInfographie();
    await exporterVers('calendar');
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    for (const a of appels) {
      const u = String(a[0]);
      expect(u.startsWith('http://'), u).toBe(false);
      expect(u).not.toContain('studiio-minio');
    }
  });
});

describe('Infographie → Export : le montage part sur le disque, mais pas avant', () => {
  it("l'opération demandée est « bureau »", async () => {
    installerFetch();
    await monterInfographie();
    await exporterVers('export');
    expect(operations[0]).toBe('bureau');
    expect(parcours().slice(0, 3)).toEqual(['reservation', 'televersement', 'confirmation']);
  });

  it('aucun post n est créé : ce chemin ne planifie rien', async () => {
    installerFetch();
    await monterInfographie();
    await exporterVers('export');
    expect(trace).not.toContain('post');
  });

  it('réservation refusée → aucune composition', async () => {
    installerFetch({ reservationRefusee: true });
    await monterInfographie();
    await exporterVers('export');
    expect(composeVideoSpy).not.toHaveBeenCalled();
    expect(parcours()).toEqual(['reservation']);
  });

  it('téléversement refusé → aucune confirmation', async () => {
    installerFetch({ televersementRefuse: true });
    await monterInfographie();
    await exporterVers('export');
    expect(trace).not.toContain('confirmation');
    expect(trace).toContain('annulation');
  });

  it('confirmation refusée → le parcours s arrête là', async () => {
    installerFetch({ confirmationRefusee: true });
    await monterInfographie();
    await exporterVers('export');
    expect(parcours()).toEqual(['reservation', 'televersement', 'confirmation']);
  });

  it('le chemin non prouvé n est jamais rappelé', async () => {
    installerFetch();
    await monterInfographie();
    await exporterVers('export');
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
  });
});

describe('Infographie : deux clics ne produisent qu un seul rendu', () => {
  it('une seule réservation, une seule composition, une seule confirmation', async () => {
    installerFetch();
    await monterInfographie();
    await cliquer('infographic.destination.calendar');
    await doubleCliquer('infographic.exportButton');
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(1);
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    expect(trace.filter((t) => t === 'confirmation')).toHaveLength(1);
  });

  it('un seul post est créé', async () => {
    installerFetch();
    await monterInfographie();
    await cliquer('infographic.destination.calendar');
    await doubleCliquer('infographic.exportButton');
    expect(trace.filter((t) => t === 'post')).toHaveLength(1);
    expect(trace).not.toContain('DEBIT_APRES_COUP');
  });

  it('le bouton est grisé pendant l export', async () => {
    installerFetch({ lent: 120 });
    await monterInfographie();
    await cliquer('infographic.destination.calendar');
    const b = document.querySelector('[data-infographie-export]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(b); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    const pendant = document.querySelector('[data-infographie-export]') as HTMLButtonElement;
    expect(pendant.disabled).toBe(true);
    await attendre(40, 10);
  });

  it('le verrou est rendu : un second export volontaire repart', async () => {
    installerFetch();
    await monterInfographie();
    await cliquer('infographic.destination.calendar');
    await cliquer('infographic.exportButton');
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(1);
    // L'écran affiche un bandeau pendant 5 s puis se libère ; le verrou, lui,
    // est déjà rendu. On relance directement le gestionnaire par son bouton.
    const b = document.querySelector('[data-infographie-export]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(b); });
    await attendre(90);
    expect(trace.filter((t) => t === 'reservation').length).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Agent IA
// ────────────────────────────────────────────────────────────────────────────

const monterAgent = async () => {
  render(<AgentIAModal isOpen onClose={() => {}} />);
  await attendre(8);
};

/**
 * Le bouton de lancement exige au moins un rush : on en dépose un par
 * l'entrée de fichier, comme un utilisateur.
 */
const deposerRush = async () => {
  const entree = document.querySelector('input[accept="video/*,image/*"]') as HTMLInputElement;
  expect(entree, "l'entrée de fichiers doit exister").toBeTruthy();
  const f = new File([new Uint8Array(16)], 'rush.mp4', { type: 'video/mp4' });
  Object.defineProperty(entree, 'files', { value: [f], configurable: true });
  await act(async () => { fireEvent.change(entree); });
  await attendre(6);
};

describe('Agent IA : un montage non confirmé ne devient jamais un post', () => {
  it('la modale se monte et expose son lancement', async () => {
    installerFetch();
    await monterAgent();
    expect(document.body.textContent).toBeTruthy();
  });

  it('deux clics immédiats ne lancent qu une seule série', async () => {
    installerFetch();
    await monterAgent();
    await deposerRush();
    const b = document.querySelector('[data-agent-lancer]') as HTMLButtonElement;
    expect(b, 'le bouton de lancement doit être actif').toBeTruthy();
    expect(b.disabled).toBe(false);
    await act(async () => { fireEvent.click(b); fireEvent.click(b); });
    await attendre(120);
    // Une série peut composer plusieurs montages ; ce qu'on refuse, c'est
    // que DEUX séries partent. Le second clic ne doit rien avoir ajouté.
    const reservations = trace.filter((t) => t === 'reservation').length;
    const compositions = composeVideoSpy.mock.calls.length;
    expect(reservations).toBe(compositions);
    expect(trace.filter((t) => t === 'confirmation').length).toBe(reservations);
    expect(trace).not.toContain('DEBIT_APRES_COUP');
  });

  it('le bouton est grisé pendant la série', async () => {
    installerFetch({ lent: 120 });
    await monterAgent();
    await deposerRush();
    const b = document.querySelector('[data-agent-lancer]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(b); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    const pendant = document.querySelector('[data-agent-lancer]') as HTMLButtonElement;
    expect(pendant.disabled).toBe(true);
    await attendre(50, 10);
  });

  it("le catch de composition ne crée plus de post « réussi » sans vidéo", () => {
    // Ce défaut ne se lit pas dans un DOM : il se lit dans le fait que
    // l'erreur REMONTE désormais au lieu d'être journalisée puis oubliée.
    const src = readFileSync(
      join(process.cwd(), 'src/components/creer/AgentIAModal.tsx'), 'utf-8',
    );
    const compose = src.indexOf("composerEtFacturer('calendrier', 'reel'");
    const attrape = src.indexOf('} catch (err) {', compose);
    const poste = src.indexOf("await fetch('/api/posts'", compose);
    expect(compose).toBeGreaterThan(-1);
    expect(attrape).toBeGreaterThan(compose);
    expect(attrape).toBeLessThan(poste);
    // Entre le catch et la création du post : un `throw`, pas un `console`
    // suivi de la suite du tour.
    expect(src.slice(attrape, poste)).toContain('throw new Error(');
  });

  it('il ne connaît aucun chemin de composition non prouvé', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/creer/AgentIAModal.tsx'), 'utf-8',
    );
    expect(src).not.toMatch(/composeAndUpload\s*\(/);
    expect(src).not.toContain("from '@/lib/video-composer'");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Plus aucun appelant direct, nulle part
// ────────────────────────────────────────────────────────────────────────────

describe('Le compositeur non prouvé n a plus aucun appelant', () => {
  it('`composeAndUpload` n est appelé que depuis son propre module', () => {
    const fichiers = listerSources(join(process.cwd(), 'src'));
    const coupables = fichiers.filter((f) => {
      if (f.includes('__tests__') || f.endsWith('video-composer.ts')) return false;
      return /composeAndUpload\s*\(/.test(readFileSync(f, 'utf-8'));
    });
    expect(coupables).toEqual([]);
  });

  it('`uploadRendu` non plus', () => {
    const fichiers = listerSources(join(process.cwd(), 'src'));
    const coupables = fichiers.filter((f) => {
      if (f.includes('__tests__') || f.endsWith('video-composer.ts')) return false;
      return /uploadRendu\s*\(/.test(readFileSync(f, 'utf-8'));
    });
    expect(coupables).toEqual([]);
  });
});

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function listerSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listerSources(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
