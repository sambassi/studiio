/**
 * Le mode SERIE est ferme, en fail-closed.
 *
 * Trois chemins pouvaient porter `batchCount` au-dessus de 1 : le bouton
 * « Serie », les boutons du nombre, et — le seul qui ne passe par aucun clic —
 * la RESTAURATION D'UN BROUILLON. Un brouillon enregistre avant la fermeture
 * porte encore `batchCount: 10` dans le `localStorage` de l'utilisateur.
 *
 * Une part de ces tests MONTE le composant et clique reellement, parce que la
 * suite « lot » existante est entierement textuelle : elle resterait verte
 * avec une garde ecrite mais placee apres la composition. C'est le meme
 * constat qui avait impose des tests d'appel a `/api/render/batch`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

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
 * Le compositeur est remplace par des espions.
 *
 * Motif absent du depot jusqu'ici : toutes les assertions sur le compositeur
 * etaient textuelles. Sans cet espion, on ne peut pas distinguer « la garde a
 * arrete le lot » de « la composition a echoue toute seule dans jsdom », ou
 * le canvas ne rend rien.
 */
const composeAndUploadSpy = vi.fn(async () => ({ url: 'https://cdn/x.webm', blob: new Blob() }));
const composeVideoSpy = vi.fn(async () => ({ blob: new Blob(), thumbnail: null }));
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeAndUpload: (...a: unknown[]) => composeAndUploadSpy(...(a as [])),
    composeVideo: (...a: unknown[]) => composeVideoSpy(...(a as [])),
  };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';
import {
  BATCH_SERIE_DISPONIBLE, BATCH_SERIE_BADGE, BATCH_SERIE_EXPLICATION,
  BATCH_SERIE_REFUS, batchCountAutorise, lotRefuse,
} from '../lib/creer/batchDisponible';

const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Yoga du matin',
  subtitle: 'Reveiller le corps',
  cards: [
    { icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' },
    { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' },
  ],
};

let appels: Array<{ url: string; method: string }>;

function installerFetch() {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, method: String(init?.method ?? 'GET').toUpperCase() });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, balance: 5000, data: { credits: 5000 }, post: { id: 'p1' } }),
    } as Response;
  }) as unknown as typeof fetch;
}

const poser = (extra: Record<string, unknown>) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
    ...extra,
  }));
};

const monter = async () => {
  urlQuery = new URLSearchParams('');
  const vue = render(<AssistantWizard />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return vue;
};

/**
 * Monte, puis atteint l'etape « Envoi ».
 *
 * Un brouillon restaure rouvre l'etape « Contenu », pas la derniere : il faut
 * franchir « Continuer ». La boucle s'arrete des que le selecteur de mode est
 * monte, et l'appelant verifie qu'on y est bien arrive.
 */
const allerAEnvoi = async () => {
  await monter();
  for (let i = 0; i < 4; i += 1) {
    if (document.querySelector('[data-batch-mode="unique"]')) return;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
  }
};

const ecritures = () => appels.filter((a) => a.method !== 'GET');

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  composeAndUploadSpy.mockClear();
  composeVideoSpy.mockClear();
  installerFetch();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// Le drapeau et ses fonctions, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('Le drapeau', () => {
  it('la serie est fermee', () => {
    expect(BATCH_SERIE_DISPONIBLE).toBe(false);
  });

  it('dit « Bientôt disponible » et pourquoi', () => {
    expect(BATCH_SERIE_BADGE).toBe('Bientôt disponible');
    expect(BATCH_SERIE_EXPLICATION).toBe('Sécurisation des crédits en cours');
  });

  it('le refus dit la vraie raison, pas une panne passagere', () => {
    expect(BATCH_SERIE_REFUS).toContain('idempotent');
    expect(BATCH_SERIE_REFUS).toContain('aucun crédit');
    expect(BATCH_SERIE_REFUS).toContain('Un seul contenu');
  });
});

describe('4. batchCountAutorise ramene TOUT a 1', () => {
  [2, 3, 10, 999, 1.9, Infinity, NaN, -5, 0].forEach((n) => {
    it(`${n} → 1`, () => {
      expect(batchCountAutorise(n)).toBe(1);
    });
  });
});

describe('5. lotRefuse — la garde, sur des valeurs', () => {
  it('laisse passer un contenu unique', () => {
    expect(lotRefuse(1)).toBe(false);
    expect(lotRefuse(0)).toBe(false);
    expect(lotRefuse(NaN)).toBe(false);
  });

  it('refuse tout lot', () => {
    expect(lotRefuse(2)).toBe(true);
    expect(lotRefuse(10)).toBe(true);
    expect(lotRefuse(999)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// L'ecran, monte et clique
// ────────────────────────────────────────────────────────────────────────────

describe('1 & 2. L ecran par defaut', () => {
  it('« Un seul contenu » est selectionne', async () => {
    poser({});
    await allerAEnvoi();
    const unique = document.querySelector('[data-batch-mode="unique"]');
    expect(unique?.getAttribute('aria-pressed')).toBe('true');
  });

  it('la carte « Série » reste VISIBLE', async () => {
    poser({});
    await allerAEnvoi();
    expect(document.querySelector('[data-batch-mode="serie"]')).not.toBeNull();
  });

  it('mais elle est desactivee, avec les attributs d accessibilite', async () => {
    poser({});
    await allerAEnvoi();
    const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLButtonElement;
    expect(serie.disabled).toBe(true);
    expect(serie.getAttribute('aria-disabled')).toBe('true');
    expect(serie.getAttribute('aria-pressed')).toBe('false');
  });

  it('elle porte le badge et l explication', async () => {
    poser({});
    await allerAEnvoi();
    expect(document.querySelector('[data-batch-serie-badge]')?.textContent).toBe(BATCH_SERIE_BADGE);
    const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLElement;
    expect(serie.textContent).toContain(BATCH_SERIE_EXPLICATION);
  });

  it('le selecteur du nombre n est pas monte', async () => {
    poser({});
    await allerAEnvoi();
    expect(document.querySelectorAll('[data-batch-count]')).toHaveLength(0);
  });
});

describe('3. Ni le clic ni le clavier ne l activent', () => {
  it('un clic ne fait pas apparaitre le selecteur du nombre', async () => {
    poser({});
    await allerAEnvoi();
    const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(serie); await Promise.resolve(); });
    expect(document.querySelectorAll('[data-batch-count]')).toHaveLength(0);
    expect(serie.getAttribute('aria-pressed')).toBe('false');
  });

  it('Entree et Espace ne l activent pas non plus', async () => {
    poser({});
    await allerAEnvoi();
    const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.keyDown(serie, { key: 'Enter' });
      fireEvent.keyDown(serie, { key: ' ' });
      await Promise.resolve();
    });
    expect(document.querySelectorAll('[data-batch-count]')).toHaveLength(0);
  });

  it("elle est retiree de l'ordre de tabulation", async () => {
    poser({});
    await allerAEnvoi();
    const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLButtonElement;
    // Un `<button disabled>` natif n'est pas focusable.
    serie.focus();
    expect(document.activeElement).not.toBe(serie);
  });
});

describe('4. Un ancien brouillon en serie est ramene a un seul contenu', () => {
  it('batchCount: 10 restaure ne rouvre PAS le mode serie', async () => {
    poser({ batchCount: 10, batchPhotoMode: 'auto' });
    await allerAEnvoi();
    expect(document.querySelectorAll('[data-batch-count]')).toHaveLength(0);
    const unique = document.querySelector('[data-batch-mode="unique"]');
    expect(unique?.getAttribute('aria-pressed')).toBe('true');
  });

  it('le recapitulatif annonce bien UN contenu', async () => {
    poser({ batchCount: 10, batchPhotoMode: 'auto' });
    await allerAEnvoi();
    const recap = document.querySelector('[data-batch-recap]');
    expect(recap?.textContent).toContain('1 contenu');
    expect(recap?.textContent).not.toContain('10 contenus');
  });

  it('le bloc « Affiches du lot » ne se monte pas', async () => {
    poser({ batchCount: 10, batchPhotoMode: 'auto' });
    await allerAEnvoi();
    expect(document.body.textContent).not.toContain('Pas assez de photos distinctes');
  });
});

describe('6, 7, 8. Aucun effet de bord tant que la serie est fermee', () => {
  it('monter avec un brouillon en serie n ecrit rien', async () => {
    poser({ batchCount: 10, batchPhotoMode: 'auto' });
    await allerAEnvoi();
    expect(ecritures()).toEqual([]);
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
  });

  it('cliquer la carte fermee ne declenche ni composition ni ecriture', async () => {
    poser({ batchCount: 10, batchPhotoMode: 'auto' });
    await allerAEnvoi();
    const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(serie); await Promise.resolve(); });
    expect(ecritures()).toEqual([]);
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
    expect(composeVideoSpy).not.toHaveBeenCalled();
  });

  it('aucun debit ni aucune route de rendu n est jamais appelee', async () => {
    poser({ batchCount: 10, batchPhotoMode: 'auto' });
    await allerAEnvoi();
    const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(serie); await Promise.resolve(); });
    const interdits = appels.filter((a) => a.url.includes('credits/deduct') || a.url.includes('render'));
    expect(interdits).toEqual([]);
  });
});

describe('9 & 12. Le mode unitaire est intact', () => {
  it('ses commandes sont toutes presentes', async () => {
    poser({});
    await allerAEnvoi();
    expect(screen.queryAllByRole('button', { name: /Composer et envoyer/i }).length)
      .toBeGreaterThan(0);
    expect(document.querySelector('[data-export-bureau]')).not.toBeNull();
  });

  it('le CTA reste au singulier, et actif', async () => {
    poser({});
    await allerAEnvoi();
    const cta = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0] as HTMLButtonElement;
    expect(cta.textContent).toContain('Composer et envoyer');
    expect(cta.textContent).not.toMatch(/\d+\s+vidéos/);
    expect(cta.disabled).toBe(false);
  });

  it('le bouton de telechargement reste au singulier', async () => {
    poser({});
    await allerAEnvoi();
    const bureau = document.querySelector('[data-export-bureau]') as HTMLElement;
    expect(bureau.textContent).toContain('Télécharger la vidéo');
    expect(bureau.textContent).not.toContain('.zip');
  });

  it('« Un seul contenu » reste selectionnable', async () => {
    poser({});
    await allerAEnvoi();
    const unique = document.querySelector('[data-batch-mode="unique"]') as HTMLButtonElement;
    expect(unique.disabled).toBe(false);
    await act(async () => { fireEvent.click(unique); await Promise.resolve(); });
    expect(unique.getAttribute('aria-pressed')).toBe('true');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La garde est bien AVANT tout effet de bord
// ────────────────────────────────────────────────────────────────────────────

describe('5. La garde precede TOUT effet de bord', () => {
  const wizard = readFileSync(
    join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'),
    'utf-8',
  );
  const debut = wizard.indexOf("const runRender = async (destination:");
  const garde = wizard.indexOf('if (lotRefuse(batchCount)) {', debut);
  const chargement = wizard.indexOf('setSending(true);', debut);
  const solde = wizard.indexOf("fetch('/api/credits/balance')", debut);

  it('la garde existe dans le gestionnaire', () => {
    expect(debut).toBeGreaterThan(-1);
    expect(garde).toBeGreaterThan(debut);
  });

  it("elle precede meme l'etat de chargement", () => {
    expect(garde).toBeLessThan(chargement);
  });

  it('elle precede la lecture du solde, premier appel reseau du gestionnaire', () => {
    expect(solde).toBeGreaterThan(-1);
    expect(garde).toBeLessThan(solde);
  });

  it('elle rend la main immediatement', () => {
    const bloc = wizard.slice(garde, garde + 160);
    expect(bloc).toContain('setError(BATCH_SERIE_REFUS)');
    expect(bloc).toContain('return;');
  });

  it('le code du lot est CONSERVE, pas supprime', () => {
    // La fermeture doit pouvoir etre levee en repassant un seul drapeau.
    expect(wizard).toContain('const total = destination === \'apercu\' ? 1 : clampBatchCount(batchCount);');
    expect(wizard).toContain('for (let b = 0; b < total; b += 1) {');
    expect(wizard).toContain("{modeLot === 'serie' && (");
  });
});

describe('13. L accueil annonce cinq etapes', () => {
  it('le texte est corrige', async () => {
    window.localStorage.clear();
    await monter();
    expect(document.body.textContent)
      .toContain('Cinq étapes — sujet, style, audio, contenu, envoi.');
  });

  it('il n annonce plus quatre etapes', async () => {
    window.localStorage.clear();
    await monter();
    expect(document.body.textContent).not.toContain('Quatre étapes');
  });
});
