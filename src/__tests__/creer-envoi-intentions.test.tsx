/**
 * Étape « Envoi » de l'Assistant : trois intentions, dites explicitement.
 *
 *   1. Garder en brouillon      → `draft`, aucune plateforme (le défaut, l'envoi
 *                                  historique au caractère près) ;
 *   2. Programmer la publication → `scheduled` + réseaux CONNECTÉS choisis, le
 *                                  cron publie à la date et l'heure saisies ;
 *   3. Télécharger la vidéo      → aucun post ; rendu facturé, coût affiché.
 *
 * ⚠️ LE VRAI ÉCRAN EST MONTÉ ET LE VRAI PARCOURS D'ENVOI EST JOUÉ, jusqu'au
 * `POST /api/posts` — c'est le corps de cette requête qu'on lit. Le rendu
 * (tentative, téléversement, confirmation) est doublé au niveau de `fetch`,
 * comme dans `creer-serie-pilote` ; aucun fournisseur social n'est appelé,
 * et un test le vérifie.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

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
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: async () => ({ video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) }),
    composeAndUpload: async () => ({ blob: MONTAGE(), url: 'https://cdn/libre.webm', thumbnailUrl: null, composerVersion: 'v1' }),
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

let postsCrees: Array<Record<string, unknown>>;
let publications: string[];
/** Les réseaux que `/api/social/status` dit connectés. */
let connectes: string[];

function installerFetch() {
  postsCrees = [];
  publications = [];
  let rang = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps),
    } as unknown as Response);

    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    if (u.includes('/api/social/status')) {
      const platforms: Record<string, unknown> = {};
      for (const p of ['instagram', 'tiktok', 'facebook', 'youtube']) {
        platforms[p] = { connected: connectes.includes(p), username: connectes.includes(p) ? `@${p}` : null };
      }
      return rep({ success: true, platforms, channels: { email: { available: true } } });
    }
    if (u.includes('/api/social/zernio/accounts')) return rep({ success: true, autorise: false, raison: null, comptes: [] });
    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      rang += 1;
      const job = `job-${rang}`;
      return rep({
        ok: true, jobId: job, uploadUrl: `/api/render/jobs/${job}/upload`, uploadMode: 'relais',
        publicUrl: `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${job}.webm`, cout: 10,
      });
    }
    if (/\/api\/render\/jobs\/job-\d+\/upload$/.test(u) && m === 'PUT') return rep({ ok: true });
    if (/\/api\/render\/jobs\/job-\d+\/confirm$/.test(u)) return rep({ ok: true, politique: 'credits', balance: 4990 });
    if (/\/api\/render\/jobs\/job-\d+\/cancel$/.test(u)) return rep({ ok: true });
    if (u.includes('/api/upload/signed-url')) return rep({ success: true, signedUrl: 'https://minio.studiio.pro/v', publicUrl: 'https://cdn/v.jpg' });
    if (u.includes('minio.studiio.pro')) return rep({ ok: true });
    if (/\/api\/(social\/publish|cron\/publish)/.test(u)) { publications.push(u); return rep({ ok: true }); }
    if (u.includes('/api/posts') && m === 'POST') {
      postsCrees.push(JSON.parse(String(init?.body ?? '{}')));
      return rep({ success: true, post: { id: `p${postsCrees.length}` } });
    }
    return rep({ success: true, data: [], posts: [], content: {}, images: [] });
  }) as unknown as typeof fetch;
}

const poser = () => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
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

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const heure = () => q<HTMLInputElement>('#lot-heure')!;
const envoi = () => q<HTMLButtonElement>('[data-envoi-action]')!;

const envoyer = async (tours = 120) => {
  const b = envoi();
  expect(b.disabled, 'le bouton d’envoi doit être actif').toBe(false);
  await act(async () => { fireEvent.click(b); });
  await attendre(tours);
};

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  connectes = ['instagram', 'tiktok'];
  installerFetch();
  window.alert = () => {};
  poser();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('L heure', () => {
  it('se saisit à la minute (step=60) et part telle quelle', async () => {
    await allerAEnvoi();
    expect(heure().type).toBe('time');
    expect(heure().step).toBe('60');
    await act(async () => { fireEvent.change(heure(), { target: { value: '18:45' } }); });
    expect(q('[data-batch-recap]')!.textContent).toContain('18:45');
    await envoyer();
    expect(postsCrees).toHaveLength(1);
    expect(postsCrees[0].scheduled_time).toBe('18:45');
    expect(postsCrees[0].scheduled_date).toBe('2026-09-01');
  });

  it('le fuseau de saisie accompagne le post', async () => {
    await allerAEnvoi();
    await envoyer();
    const meta = postsCrees[0].metadata as Record<string, unknown>;
    expect(typeof meta.timezone).toBe('string');
    expect(meta.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris');
  });
});

describe('Intention 1 — brouillon (défaut)', () => {
  it('⚠️ par défaut : draft, aucune plateforme — et le récapitulatif le dit', async () => {
    await allerAEnvoi();
    expect(q('[data-envoi-intention="brouillon"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-envoi-recap="brouillon"]')!.textContent).toMatch(/Aucune publication/);
    expect(envoi().textContent).toMatch(/Composer et envoyer/);
    await envoyer();
    expect(postsCrees).toHaveLength(1);
    expect(postsCrees[0].status).toBe('draft');
    expect(postsCrees[0].platforms).toEqual([]);
    expect(publications).toEqual([]);
    expect(q('[data-envoi-confirmation="brouillon"]')).not.toBeNull();
  });
});

describe('Intention 2 — programmer', () => {
  it('⚠️ deux réseaux connectés choisis : scheduled + platforms, cron seul publie', async () => {
    await allerAEnvoi();
    const prog = q<HTMLButtonElement>('[data-envoi-intention="programmer"]')!;
    expect(prog.disabled).toBe(false);
    await act(async () => { fireEvent.click(prog); });
    // Seuls les réseaux CONNECTÉS sont proposés.
    expect(q('[data-envoi-reseau="instagram"]')).not.toBeNull();
    expect(q('[data-envoi-reseau="tiktok"]')).not.toBeNull();
    expect(q('[data-envoi-reseau="facebook"]')).toBeNull();
    expect(q('[data-envoi-reseau="youtube"]')).toBeNull();
    // Sans réseau retenu : rien à programmer, le bouton attend.
    expect(q('[data-envoi-reseaux-vides]')).not.toBeNull();
    expect(envoi().disabled).toBe(true);

    await act(async () => { fireEvent.click(q('[data-envoi-reseau="instagram"]')!); });
    await act(async () => { fireEvent.click(q('[data-envoi-reseau="tiktok"]')!); });
    await act(async () => { fireEvent.change(heure(), { target: { value: '19:15' } }); });
    const recap = q('[data-envoi-recap="programmer"]')!.textContent!;
    expect(recap).toContain('19:15');
    expect(recap).toContain('Instagram, TikTok');
    expect(recap).toMatch(/publication\s+automatique par le cron/);
    expect(envoi().textContent).toMatch(/Composer et programmer/);

    await envoyer();
    expect(postsCrees).toHaveLength(1);
    expect(postsCrees[0].status).toBe('scheduled');
    expect(postsCrees[0].platforms).toEqual(['instagram', 'tiktok']);
    expect(postsCrees[0].scheduled_time).toBe('19:15');
    // Aucune publication depuis l'écran : c'est le cron, plus tard.
    expect(publications).toEqual([]);
    expect(q('[data-envoi-confirmation="programmer"]')!.textContent).toContain('Instagram, TikTok');
  });

  it('revenir au brouillon après avoir choisi des réseaux : draft, aucune plateforme', async () => {
    await allerAEnvoi();
    await act(async () => { fireEvent.click(q('[data-envoi-intention="programmer"]')!); });
    await act(async () => { fireEvent.click(q('[data-envoi-reseau="instagram"]')!); });
    await act(async () => { fireEvent.click(q('[data-envoi-intention="brouillon"]')!); });
    expect(q('[data-envoi-reseaux]')).toBeNull();
    await envoyer();
    expect(postsCrees[0].status).toBe('draft');
    expect(postsCrees[0].platforms).toEqual([]);
  });

  it('⚠️ aucun réseau connecté : programmer est impossible, on reste en brouillon', async () => {
    connectes = [];
    await allerAEnvoi();
    const prog = q<HTMLButtonElement>('[data-envoi-intention="programmer"]')!;
    expect(prog.disabled).toBe(true);
    expect(q('[data-envoi-aucun-reseau]')!.textContent).toMatch(/Aucun réseau connecté/);
    expect(q('[data-envoi-aucun-reseau] a')!.getAttribute('href')).toBe('/dashboard/social');
    await envoyer();
    expect(postsCrees[0].status).toBe('draft');
    expect(postsCrees[0].platforms).toEqual([]);
  });
});

describe('Intention 3 — télécharger', () => {
  it('le coût est affiché sur le bouton, le même que l envoi au calendrier', async () => {
    await allerAEnvoi();
    const bouton = q<HTMLButtonElement>('[data-export-bureau]')!;
    expect(bouton.textContent).toContain('Télécharger la vidéo');
    expect(q('[data-export-bureau-cout]')!.textContent).toBe('10 crédits');
    expect(q('[data-facturation-recap]')!.textContent).toBe('10 crédits');
    // Jamais « Bureau » : le navigateur propose un enregistrement.
    expect(bouton.title).toContain('sur votre ordinateur');
    expect(bouton.title).toContain('sans créer de post');
    expect(bouton.title).not.toContain('Bureau');
  });

  it('il ne crée aucun post et ne publie rien', async () => {
    await allerAEnvoi();
    await act(async () => { fireEvent.click(q('[data-export-bureau]')!); });
    await attendre(120);
    expect(postsCrees).toEqual([]);
    expect(publications).toEqual([]);
  });
});
