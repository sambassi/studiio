/**
 * Les quatre chemins de composition du Calendrier, montés et cliqués.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ILS FAISAIENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Régénérer, Planifier, Publier et Exporter appelaient `composeAndUpload` :
 * composition, puis téléversement vers une clé demandée par le navigateur.
 * Aucune tentative serveur, aucune preuve de stockage, aucune facturation.
 * Une vidéo pouvait donc être régénérée, enregistrée, programmée et publiée
 * sans qu'une seule ligne n'existe dans `public.rendus`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CES TESTS MONTENT LA PAGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce qui compte n'est pas qu'un appel existe, c'est l'ORDRE et l'ARRÊT : la
 * tentative avant la composition, la confirmation avant l'action métier, et
 * rien d'enregistré, programmé ni publié quand une étape échoue. Une
 * assertion textuelle laisserait passer un `catch` qui poursuit — c'est
 * exactement le défaut qu'on ferme côté Agent IA dans le même lot.
 *
 * La page est donc montée, le jour est ouvert, l'aperçu complet aussi, et
 * les vrais boutons sont cliqués.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent, cleanup } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c', id: 'u1' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/lib/icons/prerender', () => ({
  preRenderCardIcons: async (c: unknown) => c,
}));

const MONTAGE = () => new Blob([new Uint8Array(4096)], { type: 'video/webm' });
const composeVideoSpy = vi.fn(async () => ({
  video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }),
}));
/** Le chemin non prouvé : s'il est rappelé, c'est que la régression est là. */
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

import Calendar from '../app/dashboard/calendar/page';

const JOB = 'job-77';
const CIBLE = `/api/render/jobs/${JOB}/upload`;
const CLE_SERVEUR =
  `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${JOB}.webm`;

const AUJOURDHUI = new Date();
const JOUR = String(AUJOURDHUI.getDate());
const DATE_ISO = `${AUJOURDHUI.getFullYear()}-${String(AUJOURDHUI.getMonth() + 1).padStart(2, '0')}-${String(AUJOURDHUI.getDate()).padStart(2, '0')}`;

/** Un post SANS montage : chacun des quatre chemins devra en composer un. */
const POST = {
  id: 'p1', user_id: 'u1', title: 'YOGA', caption: 'legende', status: 'draft',
  format: 'reel', media_type: 'video', media_url: null,
  scheduled_date: DATE_ISO, scheduled_time: '12:00', platforms: ['instagram'],
  metadata: {
    type: 'infographic',
    posterUrl: 'https://cdn/p.jpg',
    // Rend le bouton « Exporter » visible sans fournir de montage deja rendu.
    characterUrl: 'https://cdn/c.jpg',
    cards: [{ emoji: 'Heart', label: 'a', value: '1', color: '#ffffff' }],
    sequences: { intro: 5, cards: 8, video: 0, cta: 5, order: ['intro', 'cards', 'cta'] },
    branding: { watermarkText: 'AB', ctaText: 'GO' },
    design: {},
  },
};

interface Scenario {
  reservationRefusee?: boolean;
  televersementRefuse?: boolean;
  confirmationRefusee?: boolean;
}

let trace: string[];
const ETAPES = [
  'reservation', 'televersement', 'confirmation', 'annulation',
  'patch', 'programmation', 'conversion', 'DEBIT_APRES_COUP', 'PUBLICATION',
];
const parcours = () => trace.filter((t) => ETAPES.includes(t));
/** Les corps envoyés à `PUT /api/posts` — c'est là que se joue la programmation. */
let programmations: Array<Record<string, unknown>>;

function installerFetch(sc: Scenario = {}) {
  trace = [];
  programmations = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps), blob: async () => MONTAGE(),
    } as unknown as Response);

    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      trace.push('reservation');
      if (sc.reservationRefusee) return rep({ ok: false, error: 'refus' }, 500);
      return rep({
        ok: true, jobId: JOB, uploadUrl: CIBLE, uploadMode: 'relais',
        publicUrl: CLE_SERVEUR, cout: 10,
      });
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
    if (u.includes('/api/convert/to-mp4')) { trace.push('conversion'); return rep({ success: true, mp4Url: 'https://cdn/x.mp4' }); }
    // Une PUBLICATION est un envoi, pas une lecture : le Calendrier lit les
    // comptes sociaux au montage, ce qui ne publie rien. Seul un POST vers
    // une route de publication compte.
    if (/\/api\/(social\/publish|cron\/publish)/.test(u) && m === 'POST') {
      trace.push('PUBLICATION'); return rep({ ok: true });
    }
    if (u.includes('/api/social')) return rep({ success: true, accounts: [], data: [] });
    if (u.startsWith('/api/posts/') && m === 'PATCH') {
      trace.push('patch');
      return rep({ success: true, post: { ...POST } });
    }
    if (u.endsWith('/api/posts') && m === 'PUT') {
      const corps = JSON.parse(String(init?.body ?? '{}'));
      programmations.push(corps);
      trace.push('programmation');
      return rep({ success: true, post: corps });
    }
    if (u.includes('/api/posts')) return rep({ success: true, posts: [POST], data: [POST], post: POST });
    return rep({ success: true, data: [], posts: [] });
  }) as unknown as typeof fetch;
}

const attendre = async (tours = 40) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

/** Monte, ouvre le jour du post, puis son aperçu complet. */
const ouvrirApercu = async () => {
  render(<Calendar />);
  await attendre(5);
  const jour = Array.from(document.querySelectorAll('*')).find(
    (e) => (e.textContent || '').trim().startsWith(JOUR)
      && e.querySelectorAll('*').length < 6,
  );
  expect(jour, 'la case du jour doit exister').toBeTruthy();
  await act(async () => { fireEvent.click(jour!); await Promise.resolve(); });
  await attendre(5);
  const fp = bouton('fullPreview');
  expect(fp, "l'aperçu complet doit être atteignable").toBeTruthy();
  await act(async () => { fireEvent.click(fp!); await Promise.resolve(); });
  await attendre(5);
};

function bouton(motif: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (b) => ((b.getAttribute('title') || '') + (b.textContent || '')).includes(motif),
  ) as HTMLButtonElement | undefined;
}

const cliquer = async (motif: string) => {
  const b = bouton(motif);
  expect(b, `bouton « ${motif} » introuvable`).toBeTruthy();
  await act(async () => { fireEvent.click(b!); });
  await attendre(60);
};

/** Les quatre chemins, par le libellé de leur bouton. */
const CHEMINS: Array<{ nom: string; bouton: string; action: string }> = [
  { nom: 'Régénérer', bouton: 'Re-générer le montage', action: 'patch' },
  { nom: 'Planifier', bouton: 'fullPreview.schedule', action: 'programmation' },
  { nom: 'Publier maintenant', bouton: 'fullPreview.publishNow', action: 'programmation' },
  { nom: 'Exporter', bouton: 'actions.exportDesktop', action: 'conversion' },
];

beforeEach(() => {
  window.localStorage.clear();
  composeVideoSpy.mockClear();
  composeAndUploadSpy.mockClear();
  // jsdom ne sait pas ouvrir de boîte de dialogue : sans ce remplacement, un
  // chemin d'erreur ferait échouer le test pour une raison sans rapport.
  window.alert = () => {};
  window.confirm = () => true;
  (HTMLAnchorElement.prototype as unknown as { click: () => void }).click = () => {};
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// Le parcours nominal, chemin par chemin
// ────────────────────────────────────────────────────────────────────────────

describe('Les quatre chemins ouvrent une tentative AVANT de composer', () => {
  CHEMINS.forEach(({ nom, bouton: b, action }) => {
    it(`${nom} : réservation → téléversement → confirmation → ${action}`, async () => {
      installerFetch();
      await ouvrirApercu();
      await cliquer(b);
      const p = parcours();
      expect(p.slice(0, 3)).toEqual(['reservation', 'televersement', 'confirmation']);
      expect(p).toContain(action);
      expect(p.indexOf(action)).toBeGreaterThan(p.indexOf('confirmation'));
    });

    it(`${nom} : le compositeur non prouvé n'est jamais rappelé`, async () => {
      installerFetch();
      await ouvrirApercu();
      await cliquer(b);
      expect(composeAndUploadSpy).not.toHaveBeenCalled();
      expect(composeVideoSpy).toHaveBeenCalled();
    });

    it(`${nom} : aucun débit après coup, aucune publication directe`, async () => {
      installerFetch();
      await ouvrirApercu();
      await cliquer(b);
      expect(trace).not.toContain('DEBIT_APRES_COUP');
      expect(trace).not.toContain('PUBLICATION');
    });

    it(`${nom} : aucune requête en http ni vers un hôte interne`, async () => {
      installerFetch();
      await ouvrirApercu();
      await cliquer(b);
      const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      for (const a of appels) {
        const u = String(a[0]);
        expect(u.startsWith('http://'), u).toBe(false);
        expect(u).not.toContain('studiio-minio');
        expect(u).not.toContain(':9000');
      }
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Fail-closed, chemin par chemin
// ────────────────────────────────────────────────────────────────────────────

describe('Réservation refusée : on ne compose même pas', () => {
  CHEMINS.forEach(({ nom, bouton: b, action }) => {
    it(`${nom} : ni composition, ni ${action}`, async () => {
      installerFetch({ reservationRefusee: true });
      await ouvrirApercu();
      await cliquer(b);
      expect(composeVideoSpy).not.toHaveBeenCalled();
      expect(parcours()).toEqual(['reservation']);
    });
  });
});

describe('Téléversement refusé : aucune confirmation, aucune action métier', () => {
  CHEMINS.forEach(({ nom, bouton: b, action }) => {
    it(`${nom} : ni confirmation, ni ${action}`, async () => {
      installerFetch({ televersementRefuse: true });
      await ouvrirApercu();
      await cliquer(b);
      expect(trace).not.toContain('confirmation');
      expect(trace).not.toContain(action);
      // La tentative est refermée : elle ne reste pas confirmable.
      expect(trace).toContain('annulation');
    });
  });
});

describe('Confirmation refusée : rien n est livré', () => {
  CHEMINS.forEach(({ nom, bouton: b, action }) => {
    it(`${nom} : aucun ${action}`, async () => {
      installerFetch({ confirmationRefusee: true });
      await ouvrirApercu();
      await cliquer(b);
      expect(parcours()).toEqual(['reservation', 'televersement', 'confirmation']);
      expect(trace).not.toContain(action);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Ce que le post reçoit
// ────────────────────────────────────────────────────────────────────────────

describe('Le post porte l URL vérifiée par le serveur', () => {
  it('Régénérer enregistre la clé attribuée, pas une clé du navigateur', async () => {
    installerFetch();
    await ouvrirApercu();
    await cliquer('Re-générer le montage');
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const patch = appels.find((a) => String((a[1] as RequestInit)?.method).toUpperCase() === 'PATCH');
    const corps = JSON.parse(String((patch?.[1] as RequestInit)?.body));
    expect(corps.media_url).toBe(CLE_SERVEUR);
    expect(corps.metadata.renderedVideoUrl).toBe(CLE_SERVEUR);
  });

  it('Publier maintenant programme le post, il ne publie pas lui-même', async () => {
    installerFetch();
    await ouvrirApercu();
    await cliquer('fullPreview.publishNow');
    expect(programmations.length).toBeGreaterThan(0);
    expect(programmations[0].status).toBe('scheduled');
    expect(trace).not.toContain('PUBLICATION');
  });
});
