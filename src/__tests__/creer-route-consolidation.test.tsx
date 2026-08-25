import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Consolidation des parcours de création (décision produit du 2026-08-25).
 *
 * `/dashboard/creer` est la SEULE page de création. Le parcours guidé, qui
 * vivait sous `/dashboard/creer-simple`, l'occupe désormais ; l'ancien éditeur
 * a été déplacé sous `/dashboard/creer-avance`, hors du menu, le temps que ses
 * dernières dépendances soient reprises.
 *
 * Trois régressions sont possibles et sont vérifiées ici :
 *  1. un favori `/dashboard/creer-simple` tombe sur un 404, ou perd ses
 *     paramètres d'URL — le parcours repartirait alors de zéro ;
 *  2. deux entrées « Créer » réapparaissent dans le menu ;
 *  3. un lien interne oublié continue de pointer vers `/dashboard/creer-simple`.
 *
 * La redirection est vérifiée en MONTANT la page, pas en lisant son source :
 * c'est l'argument passé à `redirect()` qui compte, pas la présence d'une ligne.
 */

const redirectCalls: string[] = [];

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    // Le vrai `redirect()` lève pour interrompre le rendu. On l'imite : sans
    // cela, le composant continuerait et le test ne verrait pas l'arrêt.
    throw new Error('NEXT_REDIRECT');
  },
  usePathname: () => pathname,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

// La sidebar traduit ses libellés ; on rend la clé telle quelle pour pouvoir
// affirmer qu'il n'existe qu'UNE entrée `create`.
vi.mock('@/i18n/client', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/LanguageSelector', () => ({
  LanguageSelector: () => null,
}));

let pathname = '/dashboard/creer';

import CreerSimpleLegacyRedirect from '../app/dashboard/creer-simple/page';
import { Sidebar } from '../components/layout/Sidebar';

const readSrc = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** Rend la page de redirection et retourne l'URL demandée. */
function redirectTargetFor(searchParams?: Record<string, string | string[] | undefined>) {
  redirectCalls.length = 0;
  expect(() => CreerSimpleLegacyRedirect({ searchParams })).toThrow('NEXT_REDIRECT');
  expect(redirectCalls).toHaveLength(1);
  return redirectCalls[0];
}

beforeEach(() => {
  redirectCalls.length = 0;
  pathname = '/dashboard/creer';
  // La sidebar lit le solde de crédits au montage.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/dashboard/creer-simple redirige vers /dashboard/creer', () => {
  it('redirige sans paramètre', () => {
    expect(redirectTargetFor(undefined)).toBe('/dashboard/creer');
    expect(redirectTargetFor({})).toBe('/dashboard/creer');
  });

  it('conserve les paramètres d’URL', () => {
    const target = redirectTargetFor({ theme: 'fitness', step: '2' });
    expect(target.startsWith('/dashboard/creer?')).toBe(true);
    const params = new URLSearchParams(target.split('?')[1]);
    expect(params.get('theme')).toBe('fitness');
    expect(params.get('step')).toBe('2');
  });

  it('conserve un paramètre répété', () => {
    const target = redirectTargetFor({ tag: ['a', 'b'] });
    const params = new URLSearchParams(target.split('?')[1]);
    expect(params.getAll('tag')).toEqual(['a', 'b']);
  });

  it('ignore un paramètre absent plutôt que d’écrire "undefined"', () => {
    expect(redirectTargetFor({ theme: undefined })).toBe('/dashboard/creer');
  });
});

describe('menu latéral', () => {
  /**
   * La sidebar est rendue DEUX fois : le rail permanent du bureau et le tiroir
   * mobile. Chaque copie a son propre `<nav>` ; on vérifie donc chacune, plutôt
   * que de dédupliquer — un doublon réel resterait ainsi visible.
   */
  const navs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('nav')) as HTMLElement[];

  it('n’expose qu’une seule entrée « Créer », vers /dashboard/creer', () => {
    const { container } = render(<Sidebar />);
    const found = navs(container);
    expect(found.length).toBeGreaterThan(0);
    for (const nav of found) {
      const creerLinks = within(nav)
        .getAllByRole('link')
        .filter((a) => (a.getAttribute('href') || '').startsWith('/dashboard/creer'));
      expect(creerLinks.map((a) => a.getAttribute('href'))).toEqual(['/dashboard/creer']);
      expect(creerLinks[0].textContent).toContain('create');
      expect(creerLinks[0].textContent).not.toContain('createSimple');
    }
  });

  it('n’expose ni l’ancienne route simple ni l’éditeur avancé', () => {
    const { container } = render(<Sidebar />);
    for (const nav of navs(container)) {
      const hrefs = within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'));
      expect(hrefs).not.toContain('/dashboard/creer-simple');
      expect(hrefs).not.toContain('/dashboard/creer-avance');
    }
  });

  it('allume « Créer » sur /dashboard/creer et pas sur /dashboard/creer-avance', () => {
    pathname = '/dashboard/creer';
    const first = render(<Sidebar />);
    for (const nav of navs(first.container)) {
      const active = within(nav)
        .getAllByRole('link')
        .filter((a) => a.className.includes('bg-white/10'))
        .map((a) => a.getAttribute('href'));
      expect(active).toEqual(['/dashboard/creer']);
    }
    first.unmount();

    // `/dashboard/creer` est un préfixe de `/dashboard/creer-avance` : sans la
    // borne de segment, l'entrée « Créer » s'allumerait sur l'ancien éditeur.
    pathname = '/dashboard/creer-avance';
    const second = render(<Sidebar />);
    for (const nav of navs(second.container)) {
      const active = within(nav)
        .getAllByRole('link')
        .filter((a) => a.className.includes('bg-white/10'));
      expect(active).toHaveLength(0);
    }
  });
});

describe('liens internes', () => {
  it('plus aucun lien de navigation ne pointe vers /dashboard/creer-simple', () => {
    const sources = [
      'components/layout/Sidebar.tsx',
      'app/dashboard/page.tsx',
      'app/dashboard/calendar/page.tsx',
      'app/dashboard/library/page.tsx',
      'app/dashboard/audio-studio/page.tsx',
    ];
    for (const file of sources) {
      const src = readSrc(file);
      expect(src, file).not.toMatch(/href=["'`]\/dashboard\/creer-simple/);
      expect(src, file).not.toMatch(/location\.href\s*=\s*[`'"]\/dashboard\/creer-simple/);
    }
  });

  it('le deeplink audio du Calendrier vise l’éditeur qui sait le traiter', () => {
    const calendar = readSrc('app/dashboard/calendar/page.tsx');
    const deeplinks = calendar.match(/\/dashboard\/creer[a-z-]*\?postId=/g) || [];
    expect(deeplinks.length).toBeGreaterThan(0);
    // `?postId=X&tab=audio` n'est implémenté que par l'ancien éditeur : tant
    // que le parcours guidé ne sait pas relire un post, ces boutons doivent
    // continuer d'y mener, sinon ils perdent leur fonction en silence.
    for (const link of deeplinks) expect(link).toContain('/dashboard/creer-avance?postId=');

    const advanced = readSrc('app/dashboard/creer-avance/page.tsx');
    expect(advanced).toContain("searchParams?.get('postId')");
  });
});
