import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { libraryEditAction } from '../lib/routing/library-edit';
import { readEditTargetFromQuery } from '../lib/creer/editTarget';
import AudioStudioLegacyRedirect from '../app/dashboard/audio-studio/page';

/**
 * Liens d'édition hérités, migrés sans perte vers le parcours guidé.
 *
 * 1. **Bibliothèque « Modifier ».** `GET /api/videos` mêle `scheduled_posts`
 *    (`type: 'infographic'`) et `videos`. Seul un post a un `postId` : il va
 *    sur `/dashboard/creer?postId=`, qui le recharge (owner-scopé) et le
 *    réenregistre par PATCH sur lui-même. Une vidéo ouvre le post relié par
 *    `scheduled_posts.video_id`, ou propose d'en créer un — jamais son
 *    `videos.id` converti en `postId`, jamais un éditeur vide.
 * 2. **Ancien Studio Son.** Il reçoit le `postId` de l'export « studio » de
 *    `/dashboard/infographic` et le jetait : « Aller sur Créer » ouvrait un
 *    montage vierge. Il transmet désormais un `postId` unique et exploitable.
 */

describe('Bibliothèque — bouton « Modifier »', () => {
  it('un post (type infographic) rouvre le parcours guidé sur CE post', () => {
    const action = libraryEditAction({ id: 'post-1', type: 'infographic' });
    expect(action).toEqual({ kind: 'open', href: '/dashboard/creer?postId=post-1' });
    // Le wizard y lit exactement cet identifiant, en mode modification.
    const q = new URL(action.kind === 'open' ? action.href : '', 'https://studiio.pro').searchParams;
    expect(readEditTargetFromQuery(q)).toEqual({ kind: 'edit', postId: 'post-1' });
  });

  it('une vidéo reliée ouvre SON post, jamais son `videos.id`', () => {
    const action = libraryEditAction({ id: 'vid-9', type: 'video', linked_post_id: 'post-7' });
    expect(action).toEqual({ kind: 'open', href: '/dashboard/creer?postId=post-7' });
  });

  it.each([
    [{ id: 'vid-9', type: 'video' }],
    [{ id: 'vid-9', type: 'video', linked_post_id: null }],
    [{ id: 'vid-9', type: 'video', linked_post_id: '' }],
    [{ id: 'vid-9' }],
  ])('une vidéo sans post relié propose la création explicite : %o', (item) => {
    expect(libraryEditAction(item)).toEqual({ kind: 'create-editable', videoId: 'vid-9' });
  });

  it('plus aucune cible vers l’éditeur avancé, ni `videos.id` déguisé en postId', () => {
    for (const item of [
      { id: 'vid-9', type: 'video' },
      { id: 'vid-9', type: 'video', linked_post_id: 'post-7' },
      { id: 'post-1', type: 'infographic' },
    ]) {
      const a = libraryEditAction(item);
      if (a.kind === 'open') {
        expect(a.href).not.toContain('creer-avance');
        expect(a.href).not.toContain('postId=vid-9');
      }
    }
  });

  it('un identifiant hostile reste encodé, sur une route interne', () => {
    for (const item of [
      { id: '../x&postId=autre', type: 'infographic' },
      { id: 'v', type: 'video', linked_post_id: '../x&postId=autre' },
    ]) {
      const a = libraryEditAction(item);
      if (a.kind !== 'open') throw new Error('attendu : open');
      const url = new URL(a.href, 'https://studiio.pro');
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
