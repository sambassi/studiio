import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Redirections héritées vers `/dashboard/creer`.
 *
 * Le bouton « Modifier » de la Bibliothèque appelle
 * `/dashboard/creator?id=<video>`. La redirection perdait la query : le
 * paramètre disparaissait avant même d'atteindre la destination, sans erreur
 * ni trace. Ces tests vérifient le TRANSPORT, sur l'argument réellement passé
 * à `redirect()` — pas sur la présence d'une ligne dans le source.
 *
 * Ils ne vérifient RIEN sur l'interprétation de `id` : à ce stade, aucune page
 * ne le lit, et c'est délibéré.
 */

const redirectCalls: string[] = [];

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    // Le vrai `redirect()` lève pour interrompre le rendu ; on l'imite.
    throw new Error('NEXT_REDIRECT');
  },
}));

import CreatorLegacyRedirect from '../app/dashboard/creator/page';
import CreerSimpleLegacyRedirect from '../app/dashboard/creer-simple/page';
import { buildQuery, creerRedirectTarget, CREER_ROUTE } from '../lib/routing/legacy-redirect';

type SearchParams = Record<string, string | string[] | undefined>;
type Page = (props: { searchParams?: SearchParams }) => never;

/** Rend une page de redirection et retourne l'URL demandée. */
function cible(page: Page, searchParams?: SearchParams): string {
  redirectCalls.length = 0;
  expect(() => page({ searchParams })).toThrow('NEXT_REDIRECT');
  expect(redirectCalls).toHaveLength(1);
  return redirectCalls[0];
}

const query = (url: string) => new URLSearchParams(url.split('?')[1] || '');
const chemin = (url: string) => url.split('?')[0];

beforeEach(() => {
  redirectCalls.length = 0;
});

describe('/dashboard/creator transporte la query string', () => {
  it('1. redirige sans paramètre', () => {
    expect(cible(CreatorLegacyRedirect as Page, undefined)).toBe('/dashboard/creer');
    expect(cible(CreatorLegacyRedirect as Page, {})).toBe('/dashboard/creer');
  });

  it('2. conserve un identifiant simple', () => {
    const url = cible(CreatorLegacyRedirect as Page, { id: '123' });
    expect(chemin(url)).toBe('/dashboard/creer');
    expect(query(url).get('id')).toBe('123');
  });

  it('3. conserve plusieurs paramètres', () => {
    const url = cible(CreatorLegacyRedirect as Page, { id: '123', tab: 'audio' });
    const q = query(url);
    expect(q.get('id')).toBe('123');
    expect(q.get('tab')).toBe('audio');
  });

  it('4. conserve les paramètres répétés, dans l’ordre', () => {
    const url = cible(CreatorLegacyRedirect as Page, { tag: ['a', 'b'] });
    expect(query(url).getAll('tag')).toEqual(['a', 'b']);
  });

  it('5. conserve les valeurs à espaces et caractères réservés', () => {
    const valeur = 'yoga du matin & soir/100% #1 é';
    const url = cible(CreatorLegacyRedirect as Page, { id: valeur });
    // La valeur ressort ré-encodée dans l'URL…
    expect(url).not.toContain(' ');
    // …et redevient identique une fois relue par le destinataire.
    expect(query(url).get('id')).toBe(valeur);
  });

  it('6. ne reboucle pas sur elle-même', () => {
    for (const params of [undefined, { id: '123' }, { tag: ['a', 'b'] }]) {
      const url = cible(CreatorLegacyRedirect as Page, params);
      expect(chemin(url)).not.toBe('/dashboard/creator');
      expect(chemin(url)).not.toBe('/dashboard/creer-simple');
    }
  });

  it('7. vise toujours /dashboard/creer', () => {
    for (const params of [undefined, {}, { id: '1' }, { a: 'b', c: ['d', 'e'] }]) {
      expect(chemin(cible(CreatorLegacyRedirect as Page, params))).toBe(CREER_ROUTE);
    }
  });

  it('ignore une clé sans valeur plutôt que d’écrire "undefined"', () => {
    const url = cible(CreatorLegacyRedirect as Page, { id: undefined });
    expect(url).toBe('/dashboard/creer');
    expect(url).not.toContain('undefined');
  });
});

describe('/dashboard/creer-simple garde le même comportement', () => {
  it('conserve paramètres simples et répétés', () => {
    const url = cible(CreerSimpleLegacyRedirect as Page, { theme: 'fitness', tag: ['a', 'b'] });
    expect(chemin(url)).toBe(CREER_ROUTE);
    expect(query(url).get('theme')).toBe('fitness');
    expect(query(url).getAll('tag')).toEqual(['a', 'b']);
  });

  it('redirige sans paramètre', () => {
    expect(cible(CreerSimpleLegacyRedirect as Page, undefined)).toBe(CREER_ROUTE);
  });
});

describe('mécanisme partagé', () => {
  it('les deux pages passent par le même calcul de cible', () => {
    const params = { id: '123', tag: ['a', 'b'] };
    expect(cible(CreatorLegacyRedirect as Page, params)).toBe(creerRedirectTarget(params));
    expect(cible(CreerSimpleLegacyRedirect as Page, params)).toBe(creerRedirectTarget(params));
  });

  it('buildQuery rend une chaîne vide quand il n’y a rien à transporter', () => {
    expect(buildQuery(undefined)).toBe('');
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ x: undefined })).toBe('');
  });
});

describe('l’identifiant est transporté, pas interprété', () => {
  it('aucune page de création ne lit encore "id"', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

    // Le wizard n'a aucune lecture d'URL : reprendre une vidéo existante
    // reste un chantier à part. Ce test tombera le jour où on l'ouvrira,
    // et ce sera le signal qu'il faut le couvrir pour de bon.
    expect(lire('app/dashboard/creer/AssistantWizard.tsx')).not.toContain('useSearchParams');
    // Les pages de redirection ne font que passer la query.
    for (const f of ['app/dashboard/creator/page.tsx', 'app/dashboard/creer-simple/page.tsx']) {
      expect(lire(f)).not.toMatch(/searchParams(\?)?\.(get|id)\b/);
    }
  });
});
