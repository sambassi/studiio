/**
 * Le mode SERIE, rouvert en PILOTE de deux vidéos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI REMPLACE `creer-serie-fermee`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce fichier prend la suite de celui qui vérifiait la FERMETURE de la série.
 * Son sujet n'existe plus : la série est ouverte. Ce qui reste à protéger a
 * changé de nature — ce n'est plus « rien ne peut partir », c'est « exactement
 * deux tentatives partent, chacune prouvée, et rien n'est enregistré avant sa
 * confirmation ».
 *
 * Les garanties de l'ancien fichier qui survivent sont reprises ici : le mode
 * unitaire par défaut, la normalisation d'un brouillon restauré, la garde
 * avant tout effet de bord.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI L'ÉCRAN EST MONTÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une série met en jeu un ORDRE et un NOMBRE : deux réservations distinctes,
 * deux confirmations, deux brouillons — et rien de tout cela quand une étape
 * échoue. Aucune assertion textuelle ne dit ça. L'écran est donc monté, les
 * vrais boutons cliqués, et la trace réseau lue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BATCH_SERIE_DISPONIBLE, BATCH_SERIE_MAX, BATCH_SERIE_REFUS,
  batchCountAutorise, lotRefuse, nombresProposes,
} from '@/lib/creer/batchDisponible';
import { BATCH_RENDER_DESACTIVE } from '@/lib/render/batch-disabled';
import { bilanSerie, repriseAutorisee } from '@/lib/creer/batchRun';

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

/** Chaque réservation reçoit son propre identifiant : c'est le point. */
const cleServeur = (job: string) =>
  `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${job}.webm`;

interface Scenario {
  politique?: 'credits' | 'partner_cost_only';
  /** Rang (1-based) du montage qui doit échouer, et à quelle étape. */
  echecAu?: { rang: number; etape: 'reservation' | 'televersement' | 'confirmation' };
  /** Ralentit la réservation, pour rendre observable l'instant « pendant ». */
  lent?: number;
}

let trace: string[];
let jobs: string[];
let postsCrees: Array<Record<string, unknown>>;
const ETAPES = ['reservation', 'televersement', 'confirmation', 'annulation', 'post', 'DEBIT_APRES_COUP', 'PUBLICATION', 'BATCH'];
const parcours = () => trace.filter((t) => ETAPES.includes(t));

function installerFetch(sc: Scenario = {}) {
  trace = [];
  jobs = [];
  postsCrees = [];
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
    if (u.includes('/api/render/batch')) { trace.push('BATCH'); return rep({ disabled: true }, 503); }

    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      rang += 1;
      trace.push('reservation');
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
      trace.push('televersement');
      const r = Number(mUp[1].split('-')[1]);
      if (sc.echecAu?.rang === r && sc.echecAu.etape === 'televersement') return rep({ ok: false }, 500);
      return rep({ ok: true });
    }
    const mCf = u.match(/\/api\/render\/jobs\/(job-\d+)\/confirm$/);
    if (mCf) {
      trace.push('confirmation');
      const r = Number(mCf[1].split('-')[1]);
      if (sc.echecAu?.rang === r && sc.echecAu.etape === 'confirmation') {
        return rep({ ok: false, motif: 'objet_absent' }, 422);
      }
      return rep({
        ok: true, politique: sc.politique ?? 'credits',
        balance: sc.politique === 'partner_cost_only' ? null : 4990,
      });
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
    return rep({ success: true, data: [], posts: [], content: {}, images: [] });
  }) as unknown as typeof fetch;
}

const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
    // Une série refuse de partir sans une affiche DISTINCTE par vidéo : deux
    // montages avec la même image sont exactement ce qu'elle existe pour
    // éviter. On les pose, comme un utilisateur les aurait choisies.
    batchPhotoMode: 'manuel',
    batchPhotoUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
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

const envoyer = async (tours = 120) => {
  const b = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0] as HTMLButtonElement;
  expect(b).toBeTruthy();
  await act(async () => { fireEvent.click(b); });
  await attendre(tours);
};

const envoyerDeuxFois = async () => {
  const b = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0] as HTMLButtonElement;
  await act(async () => { fireEvent.click(b); fireEvent.click(b); });
  await attendre(140);
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
// 1, 2, 3. Le pilote, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('2 & 3. Le plafond du pilote', () => {
  it('la série est ouverte, et plafonnée à deux', () => {
    expect(BATCH_SERIE_DISPONIBLE).toBe(true);
    expect(BATCH_SERIE_MAX).toBe(2);
  });

  it('l écran ne propose que 2', () => {
    expect(nombresProposes()).toEqual([2]);
  });

  it('toute valeur au-dessus du pilote est ramenée à deux', () => {
    for (const n of [3, 5, 10, 20, 999]) expect(batchCountAutorise(n)).toBe(2);
  });

  it('et toute valeur aberrante à un', () => {
    for (const n of [0, -5, 1.4, NaN, Infinity, -Infinity]) expect(batchCountAutorise(n)).toBe(1);
  });

  it('un lancement au-dessus du pilote est REFUSÉ, pas normalisé en silence', () => {
    // Normaliser ici lancerait un rendu que personne n'a demandé sous cette
    // forme : si la valeur a franchi l'entrée, c'est qu'elle l'a contournée.
    expect(lotRefuse(1)).toBe(false);
    expect(lotRefuse(2)).toBe(false);
    for (const n of [3, 10, 20]) expect(lotRefuse(n)).toBe(true);
  });

  it('le refus dit ce qui n a PAS eu lieu', () => {
    expect(BATCH_SERIE_REFUS).toContain('pilote');
    expect(BATCH_SERIE_REFUS).toContain('aucun crédit');
    expect(BATCH_SERIE_REFUS).toContain('Rien n’a été composé');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 1 & 18. L'écran par défaut, et le mode unitaire intact
// ────────────────────────────────────────────────────────────────────────────

describe('1. Le mode unitaire reste sélectionné par défaut', () => {
  it('« Un seul contenu » est le mode initial', async () => {
    installerFetch(); poser();
    await allerAEnvoi();
    expect(document.querySelector('[data-batch-mode="unique"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-batch-mode="serie"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('le sélecteur du nombre n apparaît qu après avoir choisi Série', async () => {
    installerFetch(); poser();
    await allerAEnvoi();
    expect(document.querySelectorAll('[data-batch-count]')).toHaveLength(0);
    await choisirSerie();
    expect(document.querySelectorAll('[data-batch-count]')).toHaveLength(1);
    expect(document.querySelector('[data-batch-count="2"]')).not.toBeNull();
    expect(document.querySelector('[data-batch-count="3"]')).toBeNull();
  });

  it('un brouillon restauré à 10 redescend à deux, sans qu on clique', async () => {
    installerFetch(); poser({ batchCount: 10, batchPhotoMode: 'auto' });
    await allerAEnvoi();
    expect(document.querySelector('[data-serie-nombre]')?.textContent).toBe('2 vidéos');
    expect(document.querySelectorAll('[data-batch-count]')).toHaveLength(1);
  });

  it('18. le mode unitaire compose UNE vidéo, comme avant', async () => {
    installerFetch(); poser();
    await allerAEnvoi();
    await envoyer();
    expect(composeVideoSpy).toHaveBeenCalledTimes(1);
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(1);
    expect(trace.filter((t) => t === 'post')).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4 à 9. Deux vidéos : deux tentatives, deux preuves, deux brouillons
// ────────────────────────────────────────────────────────────────────────────

describe('4 à 8. Une série de deux', () => {
  beforeEach(async () => {
    installerFetch(); poser();
    await allerAEnvoi();
    await choisirSerie();
  });

  it('deux réservations, deux compositions, deux téléversements, deux confirmations', async () => {
    await envoyer();
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(2);
    expect(composeVideoSpy).toHaveBeenCalledTimes(2);
    expect(trace.filter((t) => t === 'televersement')).toHaveLength(2);
    expect(trace.filter((t) => t === 'confirmation')).toHaveLength(2);
  });

  it('les deux tentatives sont INDÉPENDANTES', async () => {
    await envoyer();
    expect(jobs).toEqual(['job-1', 'job-2']);
    expect(new Set(jobs).size).toBe(2);
  });

  it('chaque confirmation précède le brouillon correspondant', async () => {
    await envoyer();
    const p = parcours();
    // reservation, televersement, confirmation, post — deux fois de suite.
    expect(p).toEqual([
      'reservation', 'televersement', 'confirmation', 'post',
      'reservation', 'televersement', 'confirmation', 'post',
    ]);
  });

  it('deux brouillons, chacun avec l URL de SA clé serveur', async () => {
    await envoyer();
    expect(postsCrees).toHaveLength(2);
    expect(postsCrees[0].media_url).toBe(cleServeur('job-1'));
    expect(postsCrees[1].media_url).toBe(cleServeur('job-2'));
  });

  it('8 & 9. status « draft », aucune plateforme, aucune publication', async () => {
    await envoyer();
    for (const post of postsCrees) {
      expect(post.status).toBe('draft');
      expect(post.platforms).toEqual([]);
    }
    expect(trace).not.toContain('PUBLICATION');
  });

  it('le contenu affiché reste celui de la PREMIÈRE vidéo', async () => {
    await envoyer();
    expect(String(postsCrees[0].title).toUpperCase()).toContain('YOGA DU MATIN');
  });

  it('16 & 17. l ancien endpoint Batch n est jamais appelé, et reste désactivé', async () => {
    await envoyer();
    expect(trace).not.toContain('BATCH');
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });

  it('aucun débit après coup', async () => {
    await envoyer();
    expect(trace).not.toContain('DEBIT_APRES_COUP');
  });

  it('aucune requête en http ni vers un hôte interne', async () => {
    await envoyer();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    for (const a of appels) {
      const u = String(a[0]);
      expect(u.startsWith('http://'), u).toBe(false);
      expect(u).not.toContain('studiio-minio');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 10 & 11. Facturation
// ────────────────────────────────────────────────────────────────────────────

describe('10 & 11. Ce que la série annonce et fait payer', () => {
  it('utilisateur normal : le total vient du tarif SERVEUR', async () => {
    installerFetch(); poser();
    await allerAEnvoi();
    await choisirSerie();
    // 2 × 10 crédits, et le 10 vient de `/api/render/tarifs`.
    expect(document.querySelector('[data-facturation-recap]')?.textContent).toBe('20 crédits');
    expect(document.querySelector('[data-serie-nombre]')?.textContent).toBe('2 vidéos');
  });

  it('utilisateur normal : deux confirmations, donc deux débits serveur', async () => {
    installerFetch(); poser();
    await allerAEnvoi();
    await choisirSerie();
    await envoyer();
    expect(trace.filter((t) => t === 'confirmation')).toHaveLength(2);
    expect(trace).not.toContain('DEBIT_APRES_COUP');
  });

  it('administrateur : « 2 vidéos · Frais partenaires uniquement »', async () => {
    installerFetch({ politique: 'partner_cost_only' }); poser();
    await allerAEnvoi();
    await choisirSerie();
    const recap = document.querySelector('[data-batch-recap]')?.textContent ?? '';
    expect(recap).toContain('2 vidéos');
    expect(recap).toContain('Frais partenaires uniquement');
    expect(recap).not.toContain('crédits');
  });

  it('administrateur : aucun débit, et aucun nombre inventé', async () => {
    installerFetch({ politique: 'partner_cost_only' }); poser();
    await allerAEnvoi();
    await choisirSerie();
    await envoyer();
    expect(trace.filter((t) => t === 'confirmation')).toHaveLength(2);
    expect(trace).not.toContain('DEBIT_APRES_COUP');
    // Après l'envoi l'écran passe au récapitulatif de réussite : le libellé
    // de coût n'y est plus. Ce qui compte est qu'aucun montant n'ait été
    // annoncé nulle part, et qu'aucun débit n'ait été tiré.
    expect(document.body.textContent).not.toMatch(/\d+\s+crédits/);
  });

  it('tarif serveur illisible : « Tarif confirmé au rendu », jamais un prix local', async () => {
    installerFetch(); poser();
    const brut = globalThis.fetch as unknown as (u: unknown, i?: RequestInit) => Promise<Response>;
    globalThis.fetch = (async (u: unknown, i?: RequestInit) => {
      if (String(u).includes('/api/render/tarifs')) {
        return { ok: false, status: 503, json: async () => ({ ok: false, tarifs: null }) } as Response;
      }
      return brut(u, i);
    }) as unknown as typeof fetch;
    await allerAEnvoi();
    await choisirSerie();
    expect(document.querySelector('[data-facturation-recap]')?.textContent)
      .toBe('Tarif confirmé au rendu');
    expect(document.body.textContent).not.toContain('20 crédits');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 12. Double clic
// ────────────────────────────────────────────────────────────────────────────

describe('12. Deux clics ne lancent qu une série', () => {
  it('deux tentatives au total, pas quatre', async () => {
    installerFetch(); poser();
    await allerAEnvoi();
    await choisirSerie();
    await envoyerDeuxFois();
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(2);
    expect(composeVideoSpy).toHaveBeenCalledTimes(2);
    expect(trace.filter((t) => t === 'post')).toHaveLength(2);
  });

  it('le bouton est grisé pendant la série', async () => {
    installerFetch({ lent: 0 }); poser();
    await allerAEnvoi();
    await choisirSerie();
    // On garde la RÉFÉRENCE du bouton : son libellé devient « Rendu… »
    // pendant l'envoi, et le chercher par son nom ne le retrouverait plus.
    const b = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0] as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    await act(async () => { fireEvent.click(b); });
    await act(async () => { await Promise.resolve(); });
    expect(b.disabled, 'le bouton doit être grisé pendant la série').toBe(true);
    await attendre(140);
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 13, 14, 15. Échec partiel
// ────────────────────────────────────────────────────────────────────────────

describe('13. La PREMIÈRE échoue : aucun brouillon, et la seconde ne part pas', () => {
  const etapes: Array<'reservation' | 'televersement' | 'confirmation'> =
    ['reservation', 'televersement', 'confirmation'];

  etapes.forEach((etape) => {
    it(`échec en ${etape} → zéro brouillon`, async () => {
      installerFetch({ echecAu: { rang: 1, etape } }); poser();
      await allerAEnvoi();
      await choisirSerie();
      await envoyer();
      expect(trace).not.toContain('post');
      // La seconde n'a jamais démarré : elle n'a donc rien coûté.
      expect(trace.filter((t) => t === 'reservation')).toHaveLength(1);
      expect(trace).not.toContain('DEBIT_APRES_COUP');
    });
  });

  it('l écran ne prétend pas avoir réussi', async () => {
    installerFetch({ echecAu: { rang: 1, etape: 'confirmation' } }); poser();
    await allerAEnvoi();
    await choisirSerie();
    await envoyer();
    expect(document.body.textContent).not.toContain('Envoyé au calendrier');
  });
});

describe('14. La SECONDE échoue : le premier brouillon est conservé', () => {
  it('un seul brouillon, et il n est pas recomposé', async () => {
    installerFetch({ echecAu: { rang: 2, etape: 'confirmation' } }); poser();
    await allerAEnvoi();
    await choisirSerie();
    await envoyer();
    expect(trace.filter((t) => t === 'post')).toHaveLength(1);
    expect(postsCrees[0].media_url).toBe(cleServeur('job-1'));
    // Deux tentatives ouvertes, deux compositions : la première a bien été
    // payée et livrée, la seconde n'a rien produit.
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(2);
    expect(composeVideoSpy).toHaveBeenCalledTimes(2);
  });

  it('le bilan annonce « 1 réussie · 1 échouée »', async () => {
    installerFetch({ echecAu: { rang: 2, etape: 'confirmation' } }); poser();
    await allerAEnvoi();
    await choisirSerie();
    await envoyer();
    expect(document.querySelector('[data-serie-bilan]')?.textContent)
      .toBe('1 réussie · 1 échouée');
  });

  it('15. aucune vidéo n est marquée terminée sans confirmation', async () => {
    installerFetch({ echecAu: { rang: 2, etape: 'televersement' } }); poser();
    await allerAEnvoi();
    await choisirSerie();
    await envoyer();
    // Un seul post, et il porte l'URL de la SEULE clé confirmée.
    expect(postsCrees).toHaveLength(1);
    expect(postsCrees[0].media_url).toBe(cleServeur('job-1'));
    expect(trace).not.toContain('PUBLICATION');
  });
});

describe('bilanSerie, sur des valeurs', () => {
  const item = (etat: string, i: number) => ({ id: `i${i}`, index: i, etat } as never);
  it('une réussie et une échouée', () => {
    expect(bilanSerie([item('pret', 0), item('echoue', 1)])).toBe('1 réussie · 1 échouée');
  });
  it('deux réussies', () => {
    expect(bilanSerie([item('pret', 0), item('pret', 1)])).toBe('2 réussies');
  });
  it('une réussie et une jamais démarrée', () => {
    expect(bilanSerie([item('pret', 0), item('attente', 1)]))
      .toBe('1 réussie · 1 jamais démarrée');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 19. La reprise reste fermée, et le dit honnêtement
// ────────────────────────────────────────────────────────────────────────────

describe('19. La reprise', () => {
  it('reste refusée', () => {
    expect(repriseAutorisee([]).autorisee).toBe(false);
  });

  it('et la raison ne prétend plus que l idempotence n existe pas', () => {
    const { raison } = repriseAutorisee([]);
    // Elle existe — mais par TENTATIVE. Reprendre en ouvrirait une nouvelle,
    // et aucune clé stable par élément n'est persistée côté serveur.
    expect(raison).toContain('idempotent');
    expect(raison).toContain('TENTATIVE');
    expect(raison).toContain('conservés');
  });

  it('aucune clé stable par élément n existe côté serveur', () => {
    // La preuve par le code : la référence idempotente est dérivée du
    // `jobId`, créé À LA RÉSERVATION. Rien ne relie deux tentatives d'un
    // même élément de lot, ni avant ni après un rechargement.
    const service = readFileSync(join(process.cwd(), 'src/lib/rendus/service.ts'), 'utf-8');
    expect(service).toContain('const id = randomUUID();');
    expect(service).not.toMatch(/reprise|resume|batch_item_key/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La garde précède TOUT effet de bord
// ────────────────────────────────────────────────────────────────────────────

describe('La garde et le verrou précèdent tout effet de bord', () => {
  const wizard = readFileSync(
    join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8',
  );

  it('le verrou est pris AVANT le corps du lancement', () => {
    const verrou = wizard.indexOf('if (!prendre(VERROU.serie)) return;');
    const corps = wizard.indexOf('const runRenderInterne = async (destination:');
    expect(verrou).toBeGreaterThan(-1);
    expect(verrou).toBeLessThan(corps);
    expect(wizard).toContain('finally { rendre(VERROU.serie); }');
  });

  it('la garde du plafond précède la lecture du solde', () => {
    const debut = wizard.indexOf('const runRenderInterne = async (destination:');
    const garde = wizard.indexOf('if (lotRefuse(batchCount)) {', debut);
    const solde = wizard.indexOf("fetch('/api/credits/balance')", debut);
    expect(garde).toBeGreaterThan(debut);
    expect(garde).toBeLessThan(solde);
  });

  it('le nombre réellement composé passe par le plafond du pilote', () => {
    expect(wizard).toContain("const total = destination === 'apercu' ? 1 : batchCountAutorise(batchCount);");
  });
});
