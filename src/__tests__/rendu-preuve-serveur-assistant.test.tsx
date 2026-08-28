/**
 * Aucune video livree sans preuve serveur — verifie en cliquant les vrais CTA.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI S'ETAIT PASSE EN PRODUCTION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une video a ete composee, enregistree au Calendrier, relue et exportee --
 * et `public.rendus` est restee VIDE. Le socle de facturation existait, les
 * tests etaient verts, et le parcours reellement emprunte ne passait pas par
 * lui : la branche `destination === 'calendrier'` appelait `composeAndUpload`,
 * qui compose et televerse vers une cle choisie par le navigateur. Aucune
 * tentative n'etait ouverte. La seule trace etait un `/api/credits/deduct`
 * tire APRES la livraison, sans blocage et sans preuve que le fichier
 * existait.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CES TESTS ENREGISTRENT L'ORDRE DES APPELS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les tests existants espionnaient `composeAndUpload` et le voyaient bien
 * appele : ils confirmaient le chemin FAUTIF. Un test qui verifie qu'une
 * fonction est appelee ne dit rien de ce qui l'entoure. Ce qui protege ici,
 * c'est la SEQUENCE : reservation, composition, televersement, confirmation,
 * livraison -- dans cet ordre, et rien de livre si l'un manque.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BATCH_SERIE_DISPONIBLE } from '@/lib/creer/batchDisponible';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;

vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlQuery }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

/**
 * Le pre-rendu des icones passe par `new Image()` sur une URL de blob, que
 * jsdom ne charge jamais : la promesse ne se resout pas et le parcours reste
 * bloque AVANT la reservation. Le contourner ici ne masque rien du chemin
 * teste -- il ne fait qu'eviter une attente que le navigateur, lui, honore.
 */
vi.mock('@/lib/icons/prerender', () => ({
  preRenderCardIcons: async (cards: unknown) => cards,
}));

const MONTAGE = () => new Blob([new Uint8Array(2048)], { type: 'video/webm' });

/**
 * Le compositeur, espionne.
 *
 * `composeAndUpload` est volontairement laisse en place et espionne lui
 * aussi : s'il etait rappele, c'est que le chemin non prouve est revenu.
 */
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
/** La cible d'envoi que le serveur rend : le relais same-origin. */
const CIBLE = '/api/render/jobs/job-77/upload';

/** Ce que le scenario veut faire echouer. */
interface Scenario {
  politique?: 'credits' | 'partner_cost_only';
  reservationRefusee?: boolean;
  televersementRefuse?: boolean;
  confirmationRefusee?: boolean;
}

/** La trace, dans l'ordre : c'est elle qu'on assertionne. */
let trace: string[];

function installerFetch(sc: Scenario = {}) {
  trace = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
    } as Response);

    if (u.includes('/api/credits/balance')) {
      trace.push('solde');
      return rep({ ok: true, politique: sc.politique ?? 'credits', balance: 5000 });
    }
    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      trace.push('reservation');
      if (sc.reservationRefusee) return rep({ ok: false, error: 'refus' }, 500);
      return rep({
        ok: true, jobId: JOB, uploadUrl: CIBLE, uploadMode: 'relais',
        publicUrl: CLE_SERVEUR, cout: 10,
      });
    }
    if (u.includes('/jobs/job-77/upload') && m === 'PUT') {
      trace.push('televersement');
      return sc.televersementRefuse ? rep({}, 500) : rep({});
    }
    if (u.includes(`/api/render/jobs/${JOB}/confirm`)) {
      trace.push('confirmation');
      if (sc.confirmationRefusee) return rep({ ok: false, motif: 'objet_absent' }, 422);
      return rep({
        ok: true, politique: sc.politique ?? 'credits',
        balance: sc.politique === 'partner_cost_only' ? null : 4990,
      });
    }
    if (u.includes(`/api/render/jobs/${JOB}/cancel`)) { trace.push('annulation'); return rep({ ok: true }); }
    if (u.includes('/api/upload/signed-url')) {
      trace.push('vignette');
      return rep({ success: true, signedUrl: 'https://minio/vignette', publicUrl: 'https://cdn/v.jpg' });
    }
    if (u.includes('minio/vignette')) return rep({});
    if (u.includes('/api/credits/deduct')) { trace.push('DEBIT_APRES_COUP'); return rep({ success: true }); }
    if (u.includes('/api/posts') && m === 'POST') {
      trace.push('post');
      return rep({ success: true, post: { id: 'p1' } });
    }
    if (/publish|social/.test(u)) { trace.push('PUBLICATION'); return rep({ ok: true }); }
    trace.push(`autre:${m}:${u}`);
    return rep({ success: true });
  }) as unknown as typeof fetch;
}

const poser = () => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
  }));
};

const allerAEnvoi = async () => {
  urlQuery = new URLSearchParams('');
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

/** Clique le CTA et laisse le parcours entier se derouler. */
const cliquer = async (motif: RegExp) => {
  const b = screen.queryAllByRole('button', { name: motif })[0] as HTMLButtonElement;
  expect(b).toBeTruthy();
  await act(async () => { fireEvent.click(b); });
  for (let i = 0; i < 40; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

const envoyer = () => cliquer(/Composer et envoyer/i);

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  composeVideoSpy.mockClear();
  composeAndUploadSpy.mockClear();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** La trace, sans les lectures de solde qui n'ordonnent rien. */
const ETAPES = ['reservation', 'televersement', 'confirmation', 'annulation', 'post'];
const parcours = () => trace.filter((t) => ETAPES.includes(t));

// ────────────────────────────────────────────────────────────────────────────
// 1, 2, 3. L'ordre, sur le CTA reellement utilise en production
// ────────────────────────────────────────────────────────────────────────────

describe('1. « Composer et envoyer » ouvre une tentative AVANT de composer', () => {
  it('reservation → composition → televersement → confirmation → post', async () => {
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    await envoyer();
    expect(parcours()).toEqual([
      'reservation', 'televersement', 'confirmation', 'post',
    ]);
  });

  it('le compositeur n est appele qu APRES la reservation', async () => {
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    await envoyer();
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    // Le chemin non prouve ne doit plus exister nulle part.
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
  });

  it('le montage part vers la CLE DU SERVEUR, pas vers une cle du navigateur', async () => {
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    await envoyer();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const put = appels.find((a) => String((a[1] as RequestInit)?.method).toUpperCase() === 'PUT');
    expect(String(put?.[0])).toBe(CIBLE);
  });

  it('le post porte l URL verifiee par le serveur', async () => {
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    await envoyer();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const post = appels.find((a) => String(a[0]).includes('/api/posts'));
    const corps = JSON.parse(String((post?.[1] as RequestInit)?.body));
    expect(corps.media_url).toBe(CLE_SERVEUR);
    expect(corps.status).toBe('draft');
  });
});

describe('2. Administrateur — ligne confirmee, aucun debit de credits', () => {
  beforeEach(() => { installerFetch({ politique: 'partner_cost_only' }); poser(); });

  it('le parcours est le meme, confirmation comprise', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(parcours()).toEqual(['reservation', 'televersement', 'confirmation', 'post']);
  });

  it('aucun debit apres coup n est tire', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(trace).not.toContain('DEBIT_APRES_COUP');
  });
});

describe('3. Utilisateur — une seule confirmation, aucun second debit', () => {
  it('exactement une reservation et une confirmation', async () => {
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    await envoyer();
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(1);
    expect(trace.filter((t) => t === 'confirmation')).toHaveLength(1);
    expect(trace).not.toContain('DEBIT_APRES_COUP');
  });

  it('le debit apres coup a disparu du code, pas seulement de la trace', () => {
    const wizard = readFileSync(
      join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8',
    );
    expect(wizard).not.toMatch(/fetch\('\/api\/credits\/deduct'/);
    expect(wizard).not.toMatch(/debiterRendu\s*\(/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4, 5, 6. Fail-closed : chaque echec arrete tout ce qui suit
// ────────────────────────────────────────────────────────────────────────────

describe('4. Reservation refusee → on ne compose meme pas', () => {
  beforeEach(() => { installerFetch({ reservationRefusee: true }); poser(); });

  it('le compositeur n est jamais appele', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(composeVideoSpy).not.toHaveBeenCalled();
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
  });

  it('rien n est televerse, rien n est confirme, aucun post', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(parcours()).toEqual(['reservation']);
  });

  it('l ecran le dit, il ne fait pas semblant d avoir reussi', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(document.body.textContent).not.toContain('Envoyé au calendrier');
    expect(document.body.textContent).toMatch(/indisponible|échou/i);
  });
});

describe('5. Televersement refuse → aucune confirmation, aucune livraison', () => {
  beforeEach(() => { installerFetch({ televersementRefuse: true }); poser(); });

  it('la confirmation n est jamais demandee', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(trace).not.toContain('confirmation');
  });

  it('aucun post n est cree', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(trace).not.toContain('post');
    expect(document.body.textContent).not.toContain('Envoyé au calendrier');
  });

  it('la tentative est refermee, elle ne reste pas ouverte', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(trace).toContain('annulation');
  });
});

describe('6. Confirmation refusee → rien n est livre', () => {
  beforeEach(() => { installerFetch({ confirmationRefusee: true }); poser(); });

  it('aucun post n est cree', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(parcours()).toEqual(['reservation', 'televersement', 'confirmation']);
  });

  it('l ecran n annonce pas un envoi reussi', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(document.body.textContent).not.toContain('Envoyé au calendrier');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Les autres destinations de l'Assistant, et l'editeur avance
// ────────────────────────────────────────────────────────────────────────────

describe('8. Telechargement — meme parcours, et rien n arrive au disque sans preuve', () => {
  it('reservation → televersement → confirmation, puis seulement le fichier', async () => {
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    await cliquer(/Télécharger la vidéo/i);
    expect(parcours()).toEqual(['reservation', 'televersement', 'confirmation']);
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
  });

  it('televersement refuse → aucun telechargement', async () => {
    installerFetch({ televersementRefuse: true }); poser();
    await allerAEnvoi();
    await cliquer(/Télécharger la vidéo/i);
    expect(trace).not.toContain('confirmation');
    expect(document.body.textContent).not.toContain('Téléchargé.');
  });
});

describe('8. Editeur avance — passe par le meme socle', () => {
  const avance = readFileSync(
    join(process.cwd(), 'src/app/dashboard/creer-avance/page.tsx'), 'utf-8',
  );
  it('il appelle composerEtFacturer et non composeAndUpload', () => {
    expect(avance).toContain("import { composerEtFacturer } from \"@/lib/rendus/composer\"");
    expect(avance).not.toMatch(/composeAndUpload\s*\(/);
  });
});

describe('8. L Assistant n a plus aucun chemin de composition non prouve', () => {
  const wizard = readFileSync(
    join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8',
  );
  it('ni composeAndUpload ni uploadRendu ne sont importes', () => {
    expect(wizard).not.toMatch(/^\s*composeAndUpload,/m);
    expect(wizard).not.toMatch(/uploadRendu\s*\(/);
    expect(wizard).not.toMatch(/composeAndUpload\s*\(/);
  });

  it('les trois destinations passent par le socle', () => {
    expect(wizard).toContain("composerEtFacturer('calendrier', renderFormat, optionsRendu)");
    expect(wizard).toContain('rendreEtFacturer({');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9, 10. Rien d'autre n'a bouge
// ────────────────────────────────────────────────────────────────────────────

describe('9 & 10. Aucune publication, Batch toujours ferme', () => {
  it('aucune route de publication n est appelee', async () => {
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    await envoyer();
    expect(trace).not.toContain('PUBLICATION');
  });

  it('le post est cree en brouillon, sans plateforme', async () => {
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    await envoyer();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const post = appels.find((a) => String(a[0]).includes('/api/posts'));
    const corps = JSON.parse(String((post?.[1] as RequestInit)?.body));
    expect(corps.status).toBe('draft');
    expect(corps.platforms).toEqual([]);
  });

  it('le mode Serie est ouvert en pilote, mais l unitaire reste par defaut', async () => {
    expect(BATCH_SERIE_DISPONIBLE).toBe(true);
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLButtonElement;
    expect(serie.disabled).toBe(false);
    const unique = document.querySelector('[data-batch-mode="unique"]');
    expect(unique?.getAttribute('aria-pressed')).toBe('true');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// L'envoi lui-même : HTTPS, même clé, et ce qu'on dit quand il échoue
// ────────────────────────────────────────────────────────────────────────────

describe('1 & 2. Depuis une page HTTPS, aucune cible non chiffrée ni interne', () => {
  beforeEach(() => { installerFetch({ politique: 'credits' }); poser(); });

  it('aucune requête ne vise http:// ni un nom interne', async () => {
    await allerAEnvoi();
    await envoyer();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    for (const a of appels) {
      const u = String(a[0]);
      expect(u.startsWith('http://'), u).toBe(false);
      expect(u).not.toContain('studiio-minio');
      expect(u).not.toContain(':9000');
      expect(u).not.toMatch(/\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.)/);
    }
  });

  it("l'envoi part vers la cible rendue par le serveur, telle quelle", async () => {
    await allerAEnvoi();
    await envoyer();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const put = appels.find((a) => String((a[1] as RequestInit)?.method).toUpperCase() === 'PUT');
    expect(String(put?.[0])).toBe(CIBLE);
  });

  it('le relais same-origin reçoit bien le cookie de session', async () => {
    await allerAEnvoi();
    await envoyer();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const put = appels.find((a) => String((a[1] as RequestInit)?.method).toUpperCase() === 'PUT');
    expect((put?.[1] as RequestInit)?.credentials).toBe('include');
  });
});

describe('4. La clé est la même de la réservation à la confirmation', () => {
  it("l'envoi et la confirmation portent le même jobId, et le post l'URL de cette clé", async () => {
    installerFetch({ politique: 'credits' }); poser();
    await allerAEnvoi();
    await envoyer();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const put = appels.find((a) => String((a[1] as RequestInit)?.method).toUpperCase() === 'PUT');
    const confirm = appels.find((a) => String(a[0]).includes('/confirm'));
    expect(String(put?.[0])).toContain(JOB);
    expect(String(confirm?.[0])).toContain(JOB);
    const post = appels.find((a) => String(a[0]).includes('/api/posts'));
    const corps = JSON.parse(String((post?.[1] as RequestInit)?.body));
    // Le navigateur n'invente aucun chemin : il repose l'URL du serveur.
    expect(corps.media_url).toBe(CLE_SERVEUR);
  });
});

describe('12. Un seul contenu : « Création interrompue »', () => {
  beforeEach(() => { installerFetch({ televersementRefuse: true }); poser(); });

  it('le titre ne parle plus de série', async () => {
    await allerAEnvoi();
    await envoyer();
    expect(document.querySelector('[data-interruption-titre]')?.textContent)
      .toBe('Création interrompue');
    expect(document.body.textContent).not.toContain('Série interrompue');
  });

  it("il dit ce qui s'est passé : rien débité, rien enregistré, relançable", async () => {
    await allerAEnvoi();
    await envoyer();
    const msg = document.querySelector('[data-interruption-message]')?.textContent ?? '';
    expect(msg).toContain('Aucun crédit n’a été débité');
    expect(msg).toContain('aucun contenu n’a été enregistré');
    expect(msg).toContain('relancer la création');
  });

  it("il n'affirme plus que l'idempotence n'existe pas", async () => {
    await allerAEnvoi();
    await envoyer();
    expect(document.body.textContent).not.toContain('clé d’idempotence');
    expect(document.body.textContent).not.toContain('facturer deux fois');
  });

  it("et ne propose pas de « reprendre » ce qui n'est pas une série", async () => {
    await allerAEnvoi();
    await envoyer();
    expect(document.querySelector('[data-batch-retry]')).toBeNull();
  });
});
