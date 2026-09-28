import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import {
  metadataPourEnregistrement,
  montageEstPerime,
  CLE_MONTAGE_PERIME,
  type ValeursWizard,
} from '../lib/creer/postMetadata/from-wizard';
import { mergePostMetadata } from '../lib/creer/postMetadata';

/**
 * « Enregistrer » dans Modifier : la modification doit pouvoir atteindre la
 * vidéo publiée, et un retour arrière ne doit pas se perdre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES DEUX DÉFAUTS QUE CES TESTS FERMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. L'enregistrement n'écrit que la metadata. Le montage rendu
 *    (`renderedVideoUrl`) — celui que l'aperçu joue et que le cron publie —
 *    restait l'ancien, et le Calendrier jugeait le post « à jour » : aucun
 *    « Régénérer » proposé. La modification n'atteignait jamais la vidéo.
 *
 * 2. La référence de comparaison (`valeursChargees`) n'était jamais remise à
 *    jour après un enregistrement réussi. Un champ passé de A à B, enregistré,
 *    puis remis à A était jugé « inchangé » face au PREMIER chargement : rien
 *    ne partait, et la base restait à B.
 */

const EXISTANT = {
  subtitle: 'sous-titre',
  theme: 'sport',
  renderedVideoUrl: 'https://exemple.test/montage.mp4',
  thumbnailUrl: 'https://exemple.test/vignette.jpg',
  composerVersion: 'v9',
  branding: { accentColor: '#111111' },
  design: { gradientColor1: '#111111' },
};

const CHARGEES: ValeursWizard = {
  title: 'TITRE',
  subtitle: 'sous-titre',
  theme: 'sport',
  accentColor: '#111111',
  gradientColor1: '#111111',
  videoSize: { w: 1080, h: 1920 },
  hasAudio: false,
};

describe('un champ visuel changé périme le montage', () => {
  const cas: Array<[string, Partial<ValeursWizard>]> = [
    ['le sous-titre', { subtitle: 'autre' }],
    ['le titre (hors metadata, mais peint dans la vidéo)', { title: 'AUTRE TITRE' }],
    ['la couleur d\'accent', { accentColor: '#EC4899' }],
    ['le dégradé (design)', { gradientColor1: '#7C3AED' }],
    ['le format', { videoSize: { w: 1080, h: 1080 } }],
    ['les cartes', { cards: [{ label: 'x' }] }],
    ['le rush', { rushUrls: ['https://exemple.test/rush.mp4'] }],
    ['les durées', { sequences: { intro: 4, cards: 9, cta: 3 } }],
  ];
  for (const [nom, delta] of cas) {
    it(nom, () => {
      const envoi = metadataPourEnregistrement(EXISTANT, { ...CHARGEES, ...delta }, CHARGEES);
      expect(envoi[CLE_MONTAGE_PERIME]).toBe(true);
    });
  }

  it('le montage rendu lui-même n\'est toujours pas touché', () => {
    const envoi = metadataPourEnregistrement(EXISTANT, { ...CHARGEES, subtitle: 'autre' }, CHARGEES);
    expect(envoi.renderedVideoUrl).toBeUndefined();
    expect(envoi.thumbnailUrl).toBeUndefined();
    expect(envoi.composerVersion).toBeUndefined();
  });

  it('le drapeau traverse la fusion serveur', () => {
    const envoi = metadataPourEnregistrement(EXISTANT, { ...CHARGEES, subtitle: 'autre' }, CHARGEES);
    const fusionne = mergePostMetadata(EXISTANT, envoi);
    expect(montageEstPerime(fusionne)).toBe(true);
    expect(fusionne.renderedVideoUrl).toBe(EXISTANT.renderedVideoUrl);
  });
});

describe('un champ non visuel ne périme rien', () => {
  it('rien de changé : rien n\'est envoyé, pas même le drapeau', () => {
    expect(metadataPourEnregistrement(EXISTANT, CHARGEES, CHARGEES)).toEqual({});
  });

  it('la légende et la date ne passent pas par la metadata : aucun drapeau', () => {
    // `caption` et `scheduled_date` partent dans les colonnes du post, à côté
    // de la metadata. Tant que l'écran visuel n'a pas bougé, l'envoi est vide.
    const envoi = metadataPourEnregistrement(EXISTANT, { ...CHARGEES }, { ...CHARGEES });
    expect(envoi[CLE_MONTAGE_PERIME]).toBeUndefined();
  });

  it('`hasAudio` seul (simple résumé) ne périme pas', () => {
    const envoi = metadataPourEnregistrement(EXISTANT, { ...CHARGEES, hasAudio: true }, CHARGEES);
    expect(envoi.hasAudio).toBe(true);
    expect(envoi[CLE_MONTAGE_PERIME]).toBeUndefined();
  });
});

describe('montageEstPerime — default safe', () => {
  it('un post sans drapeau (tous les posts existants) est à jour', () => {
    expect(montageEstPerime(EXISTANT)).toBe(false);
    expect(montageEstPerime(undefined)).toBe(false);
    expect(montageEstPerime(null)).toBe(false);
    expect(montageEstPerime('abîmé')).toBe(false);
  });

  it('seul `true` compte', () => {
    expect(montageEstPerime({ montagePerime: true })).toBe(true);
    expect(montageEstPerime({ montagePerime: false })).toBe(false);
    expect(montageEstPerime({ montagePerime: 'true' })).toBe(false);
  });
});

describe('aller-retour A → B → A (fonction pure)', () => {
  const A = CHARGEES;
  const B: ValeursWizard = { ...CHARGEES, subtitle: 'B' };

  it('la référence remise à jour après enregistrement : le retour à A part', () => {
    const premier = metadataPourEnregistrement(EXISTANT, B, A);
    expect(premier.subtitle).toBe('B');
    const second = metadataPourEnregistrement(mergePostMetadata(EXISTANT, premier), A, B);
    expect(second.subtitle).toBe('sous-titre');
    expect(second[CLE_MONTAGE_PERIME]).toBe(true);
  });

  it('témoin du défaut : comparé au PREMIER chargement, le retour à A était perdu', () => {
    const second = metadataPourEnregistrement(EXISTANT, A, A);
    expect(second.subtitle).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Le même aller-retour, sur le VRAI wizard
// ────────────────────────────────────────────────────────────────────────────

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

let urlQuery: URLSearchParams;
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => urlQuery,
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';

const POST = {
  id: 'post-42',
  title: 'MON TITRE',
  caption: 'ma legende',
  status: 'draft',
  scheduled_date: '2026-09-01',
  platforms: ['instagram'],
  metadata: {
    subtitle: 'sous-titre',
    theme: 'sport',
    videoSize: { w: 1080, h: 1920 },
    renderedVideoUrl: 'https://exemple.test/montage.mp4',
  },
};

let patchs: Array<Record<string, unknown>>;

function installerFetch() {
  patchs = [];
  let courant: Record<string, unknown> = { ...POST };
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    if (u === '/api/posts/post-42' && m === 'PATCH') {
      const corps = JSON.parse(String(init?.body ?? '{}'));
      patchs.push(corps);
      courant = {
        ...courant,
        metadata: mergePostMetadata(courant.metadata, corps.metadata ?? {}),
      };
    }
    const data = u.startsWith('/api/posts/post-42') ? courant : null;
    return {
      ok: true, status: 200, json: async () => ({ success: true, data }),
    } as Response;
  }) as unknown as typeof fetch;
}

async function laisserTourner() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const format = (f: string) => Array.from(document.querySelectorAll('button[aria-pressed]'))
  .find((b) => (b.textContent || '').startsWith(f)) as HTMLButtonElement | undefined;

const cliquer = async (b: HTMLElement) => {
  await act(async () => { fireEvent.click(b); await Promise.resolve(); });
  await laisserTourner();
};

beforeEach(() => {
  urlQuery = new URLSearchParams('postId=post-42');
  window.localStorage.clear();
  installerFetch();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('wizard — Enregistrer', () => {
  it('A → B → A : le second enregistrement remet bien A en base', async () => {
    render(<AssistantWizard />);
    await laisserTourner();
    const enregistrer = () => screen.getByRole('button', { name: /Enregistrer les modifications/i });

    // Le format se regle a l'etape Style, section « Ton et format ».
    const versStyle = screen.queryByRole('button', { name: /Continuer vers Style/i });
    if (versStyle) await cliquer(versStyle);
    if (!format('1:1')) {
      const section = screen.queryByRole('button', { name: /Ton et format/i });
      if (section) await cliquer(section);
    }
    const carre = format('1:1');
    expect(carre, 'le choix du format doit être atteignable').toBeTruthy();
    await cliquer(carre!);
    await cliquer(enregistrer());
    expect(patchs).toHaveLength(1);
    const m1 = patchs[0].metadata as Record<string, unknown>;
    expect(m1.videoSize).toEqual({ w: 1080, h: 1080 });
    expect(m1[CLE_MONTAGE_PERIME]).toBe(true);

    await cliquer(format('9:16')!);
    await cliquer(enregistrer());
    expect(patchs).toHaveLength(2);
    const m2 = patchs[1].metadata as Record<string, unknown>;
    expect(m2.videoSize).toEqual({ w: 1080, h: 1920 });
    expect(m2[CLE_MONTAGE_PERIME]).toBe(true);
  });

  it('enregistrer sans rien toucher ne périme pas le montage', async () => {
    render(<AssistantWizard />);
    await laisserTourner();
    await cliquer(screen.getByRole('button', { name: /Enregistrer les modifications/i }));
    expect(patchs).toHaveLength(1);
    const m = (patchs[0].metadata ?? {}) as Record<string, unknown>;
    expect(m[CLE_MONTAGE_PERIME]).toBeUndefined();
  });
});
