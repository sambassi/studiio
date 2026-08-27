/**
 * L'etape Envoi doit dire la verite sur ce qui sera facture.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI ETAIT FAUX, ET VISIBLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La barre superieure affichait deja « Frais partenaires uniquement » a
 * l'administrateur -- le socle de facturation differenciee etait en
 * production. L'etape Envoi, elle, annoncait toujours « 10 credits seront
 * debites » et recapitulait « 1 contenu · 10 credits ». Deux ecrans, deux
 * affirmations contraires, et c'est la derniere qu'on lit avant de cliquer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CES TESTS MONTENT REELLEMENT LE COMPOSANT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une assertion textuelle sur la source dirait seulement que `libelleCout`
 * apparait quelque part dans le fichier. Elle resterait verte si l'appel
 * etait branche sur une constante, sur un mauvais etat, ou place dans une
 * branche jamais rendue. Ce qu'on protege ici est ce que l'oeil lit : on
 * monte l'ecran, on repond comme le serveur, et on lit le DOM.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ET AUCUN EFFET DE BORD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun de ces tests ne doit declencher de rendu ni de debit : c'est verifie
 * explicitement, pas suppose.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  libelleCout, politiqueAffichable, LIBELLE_PARTENAIRES, MENTION_AUCUN_CREDIT,
} from '@/lib/facturation/libelles';
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

/**
 * Repond comme `/api/credits/balance`.
 *
 * `reponse` est le corps EXACT de la route en production : `{ok, politique,
 * balance, libelle}` pour l'administrateur, `{ok, politique, balance}` pour
 * un utilisateur. Les tests qui simulent une reponse degradee passent ce
 * qu'ils veulent.
 */
function installerFetch(reponse: Record<string, unknown>) {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, method: String(init?.method ?? 'GET').toUpperCase() });
    if (u.includes('/api/credits/balance')) {
      return { ok: true, status: 200, json: async () => reponse } as Response;
    }
    return {
      ok: true, status: 200,
      json: async () => ({ success: true, post: { id: 'p1' } }),
    } as Response;
  }) as unknown as typeof fetch;
}

const REPONSE_ADMIN = {
  ok: true, politique: 'partner_cost_only', balance: null, libelle: LIBELLE_PARTENAIRES,
};
const REPONSE_UTILISATEUR = { ok: true, politique: 'credits', balance: 5000 };

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
  // La politique arrive par une promesse : on laisse le re-rendu se poser.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(document.querySelector('[data-batch-mode="unique"]')).not.toBeNull();
};

const annonce = () => document.querySelector('[data-facturation-annonce]')?.textContent ?? '';
const recap = () => document.querySelector('[data-batch-recap]')?.textContent ?? '';
const ecritures = () => appels.filter((a) => a.method !== 'GET');

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  composeAndUploadSpy.mockClear();
  composeVideoSpy.mockClear();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// Le vocabulaire, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('libelleCout — ce qui remplace le prix', () => {
  it('sous credits, le nombre exact du serveur', () => {
    expect(libelleCout('credits', 10)).toBe('10 crédits');
    expect(libelleCout('credits', 15)).toBe('15 crédits');
    expect(libelleCout('credits', 150)).toBe('150 crédits');
  });

  it('sous partner_cost_only, le libelle et AUCUN nombre', () => {
    const t = libelleCout('partner_cost_only', 10);
    expect(t).toBe(LIBELLE_PARTENAIRES);
    expect(t).not.toMatch(/\d/);
  });

  it('le cout partenaire indisponible n est jamais rendu comme un zero', () => {
    // `rendus.cout_partenaire` est nullable et NULL veut dire INDISPONIBLE.
    // Aucun chiffre ne doit sortir d'ici, ni 0, ni le tarif en credits.
    for (const c of [0, 10, 15, 999]) {
      expect(libelleCout('partner_cost_only', c)).not.toMatch(/\d/);
    }
  });
});

describe('politiqueAffichable — ferme par defaut', () => {
  it('seule la chaine exacte ouvre la politique partenaires', () => {
    expect(politiqueAffichable('partner_cost_only')).toBe('partner_cost_only');
  });

  it('role absent, null, inconnu ou reponse illisible → credits', () => {
    for (const v of [
      undefined, null, '', 'credits', 'admin', 'Partner_Cost_Only', ' partner_cost_only ',
      true, 1, {}, [], 'partner', 'partner_cost_only_x',
    ]) {
      expect(politiqueAffichable(v)).toBe('credits');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// L'ecran, monte, avec la reponse du serveur
// ────────────────────────────────────────────────────────────────────────────

describe('1, 2, 3. Administrateur — aucun credit annonce', () => {
  beforeEach(() => { installerFetch(REPONSE_ADMIN); poser(); });

  it('l annonce dit « Frais partenaires uniquement »', async () => {
    await allerAEnvoi();
    expect(annonce()).toContain(LIBELLE_PARTENAIRES);
  });

  it('elle precise qu aucun credit Studiio ne sera debite', async () => {
    await allerAEnvoi();
    expect(document.body.textContent).toContain(MENTION_AUCUN_CREDIT);
  });

  it('« seront débités » a disparu de l ecran', async () => {
    await allerAEnvoi();
    expect(document.body.textContent).not.toContain('seront débités');
  });

  it('aucun « 10 crédits » nulle part', async () => {
    await allerAEnvoi();
    expect(document.body.textContent).not.toContain('10 crédits');
    expect(document.body.textContent).not.toContain('15 crédits');
  });

  it('le recapitulatif dit le libelle, pas un nombre de credits', async () => {
    await allerAEnvoi();
    expect(recap()).toContain('1 contenu');
    expect(recap()).toContain(LIBELLE_PARTENAIRES);
    expect(recap()).not.toContain('crédits');
  });

  it('aucun faux cout numerique n est invente dans le recapitulatif', async () => {
    await allerAEnvoi();
    const cout = document.querySelector('[data-facturation-recap]')?.textContent ?? '';
    expect(cout).toBe(LIBELLE_PARTENAIRES);
    expect(cout).not.toMatch(/\d/);
  });
});

describe('4, 5. Utilisateur normal — rien ne change', () => {
  beforeEach(() => { installerFetch(REPONSE_UTILISATEUR); poser(); });

  it('« 10 crédits seront débités » est intact', async () => {
    await allerAEnvoi();
    expect(annonce()).toContain('10 crédits');
    expect(document.body.textContent).toContain('seront débités une fois le rendu terminé.');
  });

  it('le recapitulatif « 1 contenu · 10 crédits » est intact', async () => {
    await allerAEnvoi();
    expect(recap()).toContain('1 contenu');
    expect(recap()).toContain('10 crédits');
  });

  it('il ne voit jamais le libelle partenaires', async () => {
    await allerAEnvoi();
    expect(document.body.textContent).not.toContain(LIBELLE_PARTENAIRES);
    expect(document.body.textContent).not.toContain(MENTION_AUCUN_CREDIT);
  });
});

describe('6. Politique absente, nulle ou illisible → credits', () => {
  const degradees: Array<[string, Record<string, unknown>]> = [
    ['champ absent', { ok: true, balance: 5000 }],
    ['politique nulle', { ok: true, politique: null, balance: 5000 }],
    ['politique inconnue', { ok: true, politique: 'gratuit', balance: 5000 }],
    ['role renvoye a la place', { ok: true, politique: 'admin', balance: 5000 }],
    ['solde indisponible', { ok: false, politique: 'credits', balance: null }],
    ['reponse vide', {}],
  ];

  degradees.forEach(([nom, reponse]) => {
    it(`${nom} → le prix normal reste annonce`, async () => {
      installerFetch(reponse); poser();
      await allerAEnvoi();
      expect(annonce()).toContain('10 crédits');
      expect(document.body.textContent).not.toContain(LIBELLE_PARTENAIRES);
    });
  });
});

describe('Le navigateur ne decide rien', () => {
  const wizard = readFileSync(
    join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'),
    'utf-8',
  );
  const libelles = readFileSync(
    join(process.cwd(), 'src/lib/facturation/libelles.ts'),
    'utf-8',
  );

  it('l affichage ne consulte ni isAdmin ni une adresse e-mail', () => {
    expect(wizard).not.toMatch(/isAdmin\s*\(/);
    expect(wizard).not.toContain("from '@/lib/admin'");
    expect(libelles).not.toMatch(/isAdmin/);
    expect(libelles).not.toContain('@gmail.com');
    expect(libelles).not.toMatch(/email/i);
  });

  it('la session ne sert pas a choisir la politique du wizard', () => {
    // Le role porte par la session est fait pour l'affichage d'un libelle,
    // pas pour trancher : le wizard lit la reponse du serveur.
    expect(wizard).not.toMatch(/session[^\n]{0,40}\.role/);
    expect(wizard).toContain('politiqueAffichable(d?.politique)');
  });

  it('le module de libelles ne tire aucune dependance serveur', () => {
    // `politique.ts` importe `supabaseAdmin` ; seul le TYPE en est repris.
    expect(libelles).toContain("import type { Politique } from './politique'");
    expect(libelles).not.toMatch(/^import \{/m);
  });

  it('un utilisateur ne peut pas se declarer administrateur', async () => {
    // La session ment : elle se dit admin. Le serveur dit `credits`.
    sessionState = {
      data: { user: { email: 'a@b.c', role: 'admin', isAdmin: true } },
      status: 'authenticated',
    };
    installerFetch(REPONSE_UTILISATEUR); poser();
    await allerAEnvoi();
    expect(annonce()).toContain('10 crédits');
    expect(document.body.textContent).not.toContain(LIBELLE_PARTENAIRES);
  });
});

describe('7, 8. Rien d autre n a bouge', () => {
  it('le mode Serie reste ferme', async () => {
    expect(BATCH_SERIE_DISPONIBLE).toBe(false);
    installerFetch(REPONSE_ADMIN); poser();
    await allerAEnvoi();
    const serie = document.querySelector('[data-batch-mode="serie"]') as HTMLButtonElement;
    expect(serie.disabled).toBe(true);
    expect(document.querySelectorAll('[data-batch-count]')).toHaveLength(0);
  });

  it('les commandes de l etape Envoi sont toutes la', async () => {
    installerFetch(REPONSE_ADMIN); poser();
    await allerAEnvoi();
    expect(screen.queryAllByRole('button', { name: /Composer et envoyer/i }).length)
      .toBeGreaterThan(0);
    expect(document.querySelector('[data-export-bureau]')).not.toBeNull();
  });

  it('aucun rendu, aucun debit, aucune ecriture pendant ces tests', async () => {
    installerFetch(REPONSE_ADMIN); poser();
    await allerAEnvoi();
    expect(ecritures()).toEqual([]);
    expect(composeAndUploadSpy).not.toHaveBeenCalled();
    expect(composeVideoSpy).not.toHaveBeenCalled();
    expect(appels.filter((a) => /credits\/deduct|\/render/.test(a.url))).toEqual([]);
  });
});
