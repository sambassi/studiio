import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SequenceCards from '@/components/creer/SequenceCards';
import { sanitizeDesignStyle } from '@/lib/autopilot/textStyle';
import { sanitizeConfig, DEFAULT_CONFIG } from '@/lib/autopilot/rules';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { pickCustomPoster } from '@/lib/autopilot/poster';
import { FONT_CATALOG } from '@/lib/fonts/catalog';
import type { PreparedPost } from '@/lib/autopilot/engine';

/**
 * Les trois défauts des cartes, et les affiches personnalisées.
 *
 * ⚠️ CES TESTS MONTENT L'APERÇU. C'est l'angle mort qui a laissé passer #329
 * puis #330 : vérifier des fonctions de rendu ne dit rien de ce que l'écran
 * affiche. Le bug 2 en est l'illustration exacte — `SequenceCards` savait
 * retirer le cadre, le rendu vidéo le faisait, et l'aperçu montrait quand même
 * un rectangle parce que le `cardStyle` choisi ne lui parvenait pas.
 *
 * ⚠️ ET LA PARITÉ EST STRUCTURELLE, PAS À RECALER. « Créer simple »
 * PHOTOGRAPHIE le conteneur des cartes (`cardsSnapshot`) et le compositeur
 * blitte l'image telle quelle ; l'Autopilote rend ce même composant sous
 * Remotion. Les deux moteurs lisent donc le même JSX : ce qui est vérifié ici
 * sur `SequenceCards` vaut pour les deux.
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '@/app/dashboard/creer-simple/AssistantWizard';

const CARTES = [
  { id: 'c1', icon: 'Zap', title: 'Carte une', value: '10' },
  { id: 'c2', icon: 'Moon', title: 'Carte deux', value: '20' },
];

const POLICE = FONT_CATALOG[FONT_CATALOG.length - 1].family;

const POST: PreparedPost = {
  title: 'sommeil', caption: '', scheduledDate: '2026-08-08', scheduledTime: '18:00',
  platforms: [], rushUrl: null,
  content: {
    subtitle: 'Sous', tagLine: 'CTA',
    cards: [{ icon: 'Moon', title: 'A', description: 'a', value: '1' }],
  } as PreparedPost['content'],
};

const config = (patch: Record<string, unknown>) => sanitizeConfig({ ...DEFAULT_CONFIG, ...patch });

const carte = () => document.querySelector('[data-card-id]') as HTMLElement;
const libelle = () => carte().querySelectorAll('span')[0] as HTMLElement;

let clientWidthOriginal: PropertyDescriptor | undefined;

beforeEach(() => {
  window.localStorage.clear();
  clientWidthOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true, get() { return 400; },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/pexels')) {
      return { ok: true, json: async () => ({ success: true, photos: [] }) };
    }
    if (String(url).startsWith('/api/autopilot/config')) {
      return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, styleReady: true, postersReady: true, config: {} }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (clientWidthOriginal) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthOriginal);
  }
});

/** Ouvre l'assistant jusqu'à l'étape Style, où l'aperçu est peuplé. */
async function ouvrirStyle() {
  render(<AssistantWizard />);
  fireEvent.click(screen.getByText('Commencer'));
  fireEvent.click(screen.getByText('Continuer'));
  await waitFor(() => expect(document.querySelector('[data-card-id]')).toBeTruthy());
}

// ─────────────────────────────────────────────────────────────────────────
describe('Bug 1 — les cartes ont des poignées de coin', () => {
  it('SANS gestionnaire, aucune poignée — le rendu serveur n en a pas', () => {
    render(
      <SequenceCards cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899" />,
    );
    expect(document.querySelector('[data-card-handle]')).toBeNull();
  });

  it('AVEC gestionnaire, les quatre coins de CHAQUE carte', () => {
    render(
      <SequenceCards
        cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899"
        interaction={{ onCardResizeStart: () => {}, uiPx: (n) => n }}
      />,
    );
    for (const id of ['c1', 'c2']) {
      for (const coin of ['nw', 'ne', 'sw', 'se']) {
        expect(document.querySelector(`[data-card-handle="${id}-${coin}"]`)).toBeTruthy();
      }
    }
  });

  it('la carte devient un contexte de positionnement', () => {
    // ⚠️ SANS CELA, les quatre coins de chaque carte se placeraient sur la
    // GRILLE — donc tous empilés aux quatre coins du bloc.
    render(
      <SequenceCards
        cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899"
        interaction={{ onCardResizeStart: () => {}, uiPx: (n) => n }}
      />,
    );
    expect(carte().style.position).toBe('relative');
  });

  it('les poignées disparaissent pendant la PHOTO', () => {
    // Le conteneur des cartes est ce que `modern-screenshot` capture pour la
    // vidéo : une poignée gravée ne se rattrape pas.
    render(
      <SequenceCards
        cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899"
        interaction={{ onCardResizeStart: () => {}, capturing: true, uiPx: (n) => n }}
      />,
    );
    expect(document.querySelector('[data-card-handle]')).toBeNull();
  });

  it('tirer un coin agrandit le texte — dans l aperçu de l assistant', async () => {
    await ouvrirStyle();
    const avant = libelle().style.fontSize;
    const poignee = document.querySelector('[data-card-handle$="-se"]') as HTMLElement;
    expect(poignee).toBeTruthy();

    const vraiRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function fake() {
      return { x: 0, y: 0, left: 0, top: 0, width: 200, height: 60, right: 200, bottom: 60, toJSON: () => ({}) } as DOMRect;
    };
    try {
      fireEvent.pointerDown(poignee, { button: 0, isPrimary: true, pointerId: 1, clientX: 200, clientY: 60 });
      poignee.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 340, clientY: 120, bubbles: true }));
      poignee.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    } finally {
      HTMLElement.prototype.getBoundingClientRect = vraiRect;
    }

    await waitFor(() => {
      expect(parseFloat(libelle().style.fontSize)).toBeGreaterThan(parseFloat(avant));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Bug 2 — « Sans cadre » atteint enfin l aperçu', () => {
  it('le cardStyle choisi arrive jusqu à `SequenceCards` de l Autopilote', () => {
    // ⚠️ C'ETAIT LE BUG, ET IL TIENT EN DEUX LIGNES. Le selecteur ecrivait
    // `design_style.cardStyle`, le rendu video l'honorait, et l'apercu ne le
    // recevait pas : choisir « Sans cadre » ne changeait rien a l'ecran.
    const wizard = readFileSync(
      resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'), 'utf-8');
    const apercu = wizard.slice(
      wizard.indexOf('function AutopilotPreview('),
      wizard.indexOf('export default function AssistantWizard()'),
    );
    expect(apercu.length).toBeGreaterThan(0);
    expect(apercu).toContain('cardStyle={style.cardStyle}');
    expect(apercu).toContain('cardsTypography={style.cards}');
  });

  it('l aperçu de l assistant retire le rectangle en « Text Only »', async () => {
    await ouvrirStyle();
    expect(carte().style.backgroundColor).toBeTruthy();
    const select = document.querySelector('[data-card-style]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: 'Text Only' } });
    await waitFor(() => expect(carte().style.backgroundColor).toBe(''));
    expect(carte().style.borderRadius).toBe('');
  });

  it('et le rendu montre la même chose — c est le MÊME composant', () => {
    // « Creer simple » PHOTOGRAPHIE ce conteneur et le compositeur blitte
    // l'image ; l'Autopilote le rend sous Remotion. Aucune seconde
    // implementation a recaler.
    const composition = readFileSync(
      resolve(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf-8');
    expect(composition).toContain('cardStyle={props.cardStyle}');
    expect(composition).toContain('typography={props.cardsTypography}');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Bug 3 — le texte des cartes se règle', () => {
  it('SANS typographie, le rendu d aujourd hui — au style près', () => {
    // ⚠️ RETRO-COMPATIBILITE : les cartes n'avaient aucun reglage.
    render(
      <SequenceCards cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899" />,
    );
    const l = libelle();
    expect(l.style.fontWeight).toBe('600');
    expect(l.style.fontFamily).toBe('');
    expect(l.style.textDecoration).toBe('');
    expect(l.style.textTransform).toBe('none');
  });

  it('police, échelle, graisse, casse et décoration s appliquent', () => {
    render(
      <SequenceCards
        cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899"
        typography={{ font: POLICE, scale: 2, bold: false, italic: true, underline: true, strike: true, textCase: 'uppercase' }}
      />,
    );
    const l = libelle();
    expect(l.style.fontFamily).toContain(POLICE);
    expect(l.style.fontWeight).toBe('400');
    expect(l.style.fontStyle).toBe('italic');
    expect(l.style.textTransform).toBe('uppercase');
    expect(l.style.textDecoration).toContain('underline');
    expect(l.style.textDecoration).toContain('line-through');
  });

  it('l échelle double bien la taille — et emporte l icône', () => {
    const { container: sans } = render(
      <SequenceCards cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899" />,
    );
    const taille1 = parseFloat((sans.querySelector('[data-card-id] span') as HTMLElement).style.fontSize);
    const icone1 = Number((sans.querySelector('[data-card-id] svg') as SVGElement).getAttribute('width'));
    cleanup();
    const { container: avec } = render(
      <SequenceCards
        cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899"
        typography={{ scale: 2 }}
      />,
    );
    const taille2 = parseFloat((avec.querySelector('[data-card-id] span') as HTMLElement).style.fontSize);
    const icone2 = Number((avec.querySelector('[data-card-id] svg') as SVGElement).getAttribute('width'));
    expect(taille2).toBeCloseTo(taille1 * 2, 5);
    // ⚠️ L'ICONE SUIT : l'agrandir seul donnerait un pictogramme minuscule a
    // cote d'un texte enorme.
    // A un pixel pres : la taille d'icone est ARRONDIE (`Math.round`), donc
    // doubler 42,5 ne redonne pas exactement le double de 43.
    expect(Math.abs(icone2 - icone1 * 2)).toBeLessThanOrEqual(1);
  });

  it('`bold: false` est un réglage, pas une absence', () => {
    render(
      <SequenceCards
        cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899"
        typography={{ bold: false }}
      />,
    );
    expect(libelle().style.fontWeight).toBe('400');
  });

  it('le panneau de carte de l Autopilote expose police, taille et format', async () => {
    render(<AssistantWizard />);
    const apercu = await waitFor(() =>
      document.querySelector('[data-autopilot-apercu]') as HTMLElement);
    fireEvent.doubleClick(apercu.querySelector('[data-card-id]') as Element);
    await waitFor(() =>
      expect(document.querySelector('[data-autopilot-icone-panneau]')).toBeTruthy());
    expect(document.querySelector('[data-autopilot-font="cards"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-scale="cards"]')).toBeTruthy();
    expect(document.querySelector('[data-format-toolbar="cards"]')).toBeTruthy();
  });

  it('l Autopilote valide et transmet la typographie des cartes', () => {
    const s = sanitizeDesignStyle({ cards: { font: POLICE, scale: 99, bold: false, align: 'center', x: 10 } });
    expect(s.cards?.font).toBe(POLICE);
    expect(s.cards?.scale).toBe(3);           // bornee
    expect(s.cards?.bold).toBe(false);
    expect(s.cards?.align).toBe('center');
    // Pas de position : les cartes se placent en flux, jamais par une ancre.
    expect('x' in (s.cards ?? {})).toBe(false);

    const d = buildAutopilotDesign(POST, { config: config({ designStyle: { cards: { scale: 1.5 } } }) });
    expect(d.cardsTypography?.scale).toBe(1.5);
  });

  it('SANS réglage, le moteur n écrit rien', () => {
    const d = buildAutopilotDesign(POST, { config: config({}) }) as unknown as Record<string, unknown>;
    expect('cardsTypography' in d).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Affiches personnalisées', () => {
  it('le défaut reste « automatique », banque vide', () => {
    expect(DEFAULT_CONFIG.posterMode).toBe('auto');
    expect(DEFAULT_CONFIG.posterUrls).toEqual([]);
  });

  it('un mode inconnu retombe sur « auto » — le seul qui produise une affiche', () => {
    expect(sanitizeConfig({ posterMode: 'aleatoire' }).posterMode).toBe('auto');
    expect(sanitizeConfig({ posterMode: 'custom' }).posterMode).toBe('custom');
  });

  it('les affiches sont des URL http(s), dédupliquées', () => {
    const c = sanitizeConfig({ posterUrls: ['https://x.test/a.jpg', 'https://x.test/a.jpg', 'nope', 42] });
    expect(c.posterUrls).toEqual(['https://x.test/a.jpg']);
  });

  it('la rotation évite la précédente — la MÊME règle que les rushes', () => {
    const A = 'https://x.test/a.jpg';
    const B = 'https://x.test/b.jpg';
    expect(new Set([0, 1].map((i) => pickCustomPoster([A, B], null, i))).size).toBe(2);
    expect(pickCustomPoster([A, B], A, 0)).toBe(B);
    // Une seule affiche : forcement repetee — la limite est annoncee a l'ecran.
    expect(pickCustomPoster([A], A, 1)).toBe(A);
    expect(pickCustomPoster([], null, 0)).toBeNull();
  });

  it('« mes photos » sur une banque VIDE retombe sur la recherche par thème', () => {
    // ⚠️ SINON LE MONTAGE SORTIRAIT SANS AFFICHE : un réglage à moitié posé
    // ne doit pas dégrader le résultat.
    const cron = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');
    expect(cron).toContain("config.posterMode === 'custom' && config.posterUrls.length > 0");
    expect(cron).toContain('pickPosterUrl(post.title');
  });

  it('la migration n ajoute que deux colonnes, avec ses étapes PostgREST', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../migrations/2026-08-07-autopilot-posters.sql'), 'utf-8');
    expect(migration).toContain("add column if not exists poster_urls text[] not null default '{}'");
    expect(migration).toContain("add column if not exists poster_mode text   not null default 'auto'");
    expect(migration).toContain('grant all on table public.autopilot_config to public;');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
    expect(migration).not.toMatch(/drop\s+(table|column)/i);
  });

  it('l écran propose les deux modes et la banque', async () => {
    const panneau = readFileSync(
      resolve(__dirname, '../components/creer/AutopilotPanel.tsx'), 'utf-8');
    expect(panneau).toContain('data-autopilot-poster-mode');
    expect(panneau).toContain('data-autopilot-add-poster');
    expect(panneau).toContain('mediaType="image"');
    // Toujours six etapes.
    const liste = panneau.slice(panneau.indexOf('const ETAPES = ['), panneau.indexOf('] as const;'));
    expect(liste.split('{ titre:').length - 1).toBe(6);
  });
});
