import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { libraryEditHref } from '../lib/routing/library-edit';
import { readEditTargetFromQuery } from '../lib/creer/editTarget';
import AudioStudioLegacyRedirect from '../app/dashboard/audio-studio/page';

/**
 * Liens d'édition hérités, migrés sans perte vers le parcours guidé.
 *
 * 1. **Bibliothèque « Modifier ».** `GET /api/videos` mêle `scheduled_posts`
 *    (`type: 'infographic'`) et `videos`. Seul un post a un `postId` : il va
 *    sur `/dashboard/creer?postId=`, qui le recharge (owner-scopé) et le
 *    réenregistre par PATCH sur lui-même. Une vidéo garde son lien `?id=` vers
 *    l'éditeur avancé — jamais convertie en `postId`.
 * 2. **Ancien Studio Son.** Il reçoit le `postId` de l'export « studio » de
 *    `/dashboard/infographic` et le jetait : « Aller sur Créer » ouvrait un
 *    montage vierge. Il transmet désormais un `postId` unique et exploitable.
 */

describe('Bibliothèque — bouton « Modifier »', () => {
  it('un post (type infographic) rouvre le parcours guidé sur CE post', () => {
    const href = libraryEditHref({ id: 'post-1', type: 'infographic' });
    expect(href).toBe('/dashboard/creer?postId=post-1');
    // Le wizard y lit exactement cet identifiant, en mode modification.
    const q = new URL(href, 'https://studiio.pro').searchParams;
    expect(readEditTargetFromQuery(q)).toEqual({ kind: 'edit', postId: 'post-1' });
  });

  it.each([
    ['video'],
    [undefined],
    ['creator'],
  ])('une ligne `videos` (type %s) garde l’éditeur avancé et son `id`', (type) => {
    const href = libraryEditHref({ id: 'vid-9', type });
    expect(href).toBe('/dashboard/creer-avance?id=vid-9');
    expect(href).not.toContain('postId');
  });

  it('un identifiant hostile reste encodé, sur une route interne', () => {
    for (const type of ['infographic', 'video']) {
      const href = libraryEditHref({ id: '../x&postId=autre', type });
      const url = new URL(href, 'https://studiio.pro');
      expect(url.origin).toBe('https://studiio.pro');
      expect([...url.searchParams.keys()]).toHaveLength(1);
    }
  });
});

describe('ancien Studio Son — transmission du `postId`', () => {
  const lien = (searchParams?: Record<string, string | string[] | undefined>) => {
    const html = renderToStaticMarkup(AudioStudioLegacyRedirect({ searchParams }));
    return /href="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
  };

  it('sans paramètre, « Aller sur Créer » ouvre une création', () => {
    expect(lien()).toBe('/dashboard/creer');
  });

  it('avec un `postId`, rouvre CE post dans le parcours guidé', () => {
    expect(lien({ postId: 'p-42' })).toBe('/dashboard/creer?postId=p-42');
  });

  it('plusieurs posts (`postIds=`) : pas d’édition multiple, simple entrée', () => {
    expect(lien({ postIds: 'a,b' })).toBe('/dashboard/creer');
  });

  it('un `postId` vide ou répété n’est pas transmis', () => {
    expect(lien({ postId: '' })).toBe('/dashboard/creer');
    expect(lien({ postId: ['a', 'b'] })).toBe('/dashboard/creer');
  });

  it('encode l’identifiant', () => {
    expect(lien({ postId: 'a&b' })).toBe('/dashboard/creer?postId=a%26b');
  });
});
