import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Unification de « Créer » sous `/dashboard/creer`.
 *
 * Le parcours guidé occupe désormais la route canonique ; l'ancien éditeur
 * avancé (`/dashboard/creer-avance`) a été retiré et son URL redirige vers
 * Créer (permanent).
 *
 * Ce que ces tests verrouillent :
 *
 * 1. **Un seul « Créer » dans le menu**, et `creer-avance` n'y figure pas.
 * 2. **Aucun lien d'édition n'atteint le parcours guidé avec un identifiant
 *    qu'il ne sait pas relire.** `postId` (un post) y va ; `id` (une vidéo)
 *    va à la Bibliothèque — sur le wizard il afficherait un montage
 *    vierge, et l'utilisateur croirait son contenu perdu.
 * 3. **Les quatre routes historiques passent par le mécanisme partagé** et
 *    transportent leur query intégralement.
 */

const h = vi.hoisted(() => ({ cibles: [] as string[] }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { h.cibles.push(url); },
  permanentRedirect: (url: string) => { h.cibles.push(`permanent:${url}`); },
}));

import CreerSimpleLegacyRedirect from '../app/dashboard/creer-simple/page';
import CreatorLegacyRedirect from '../app/dashboard/creator/page';
import InfographieLegacyRedirect from '../app/dashboard/infographie/page';
import CreerAvanceLegacyRedirect from '../app/dashboard/creer-avance/page';

const lire = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');
const sidebar = lire('../components/layout/Sidebar.tsx');
const calendrier = lire('../app/dashboard/calendar/page.tsx');
const bibliotheque = lire('../app/dashboard/library/page.tsx');
const pageCreer = lire('../app/dashboard/creer/page.tsx');

beforeEach(() => { h.cibles.length = 0; });

// ─────────────────────────────────────────────────────────────────────────
describe('menu latéral', () => {
  it('n’expose qu’une seule entrée « Créer », vers /dashboard/creer', () => {
    const entrees = [...sidebar.matchAll(/href: '(\/dashboard\/creer[^']*)'/g)].map((m) => m[1]);
    expect(entrees).toEqual(['/dashboard/creer']);
  });

  it('n’expose ni l’ancienne route simple ni l’éditeur avancé', () => {
    expect(sidebar).not.toContain("href: '/dashboard/creer-simple'");
    expect(sidebar).not.toContain("href: '/dashboard/creer-avance'");
    expect(sidebar).not.toContain("key: 'createSimple'");
  });

  it('la comparaison d’état actif reste bornée sur un segment complet', () => {
    // Sans la borne, `/dashboard/creer` etant un prefixe de
    // `/dashboard/creer-avance`, « Créer » s'allumerait sur l'ancien éditeur.
    expect(sidebar).toContain("pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`))");
  });

  it('la clé de traduction « createSimple » a disparu des trois langues', () => {
    for (const langue of ['fr', 'en', 'de']) {
      const messages = readFileSync(resolve(__dirname, `../../messages/${langue}.json`), 'utf-8');
      expect(JSON.parse(messages).sidebar.createSimple).toBeUndefined();
      expect(JSON.parse(messages).sidebar.create).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('tous les liens d’édition du Calendrier passent par le parcours guidé', () => {
  it('les trois deeplinks du Calendrier visent le nouveau parcours `/dashboard/creer`', () => {
    const cibles = [...calendrier.matchAll(/\/dashboard\/creer[a-z-]*\?postId=/g)].map((m) => m[0]);
    expect(cibles).toHaveLength(3);
    expect(new Set(cibles)).toEqual(new Set(['/dashboard/creer?postId=']));
  });

  it('le Calendrier ne renvoie plus jamais `postId` vers l’ancien éditeur', () => {
    expect(calendrier).not.toContain('/dashboard/creer-avance?postId=');
  });

  it('les boutons « ajouter audio » passent aussi par le parcours guidé, sans onglet forcé', () => {
    // Le parcours guidé lit `postId` SEULEMENT (voir editTarget.ts) : plus de
    // `&tab=audio` à traîner. Il restaure l'audio du post et laisse l'ajouter.
    expect(calendrier).not.toContain('&tab=audio');
    const audio = [...calendrier.matchAll(/window\.location\.href = `\/dashboard\/creer\?postId=\$\{[^}]+\}`;/g)];
    // Les deux boutons audio + le bouton « Modifier le montage » = trois entrées.
    expect(audio.length).toBeGreaterThanOrEqual(2);
  });

  it('le bouton « Modifier » de la Bibliothèque passe par `libraryEditAction`', () => {
    // Le partage post / vidéo reliée / vidéo seule est testé dans
    // `bibliotheque-modifier-routage` et `bibliotheque-video-post-modifiable`.
    expect(bibliotheque).toContain('libraryEditAction(video)');
    expect(bibliotheque).not.toContain('/dashboard/creer-avance');
    expect(bibliotheque).not.toContain('/dashboard/creer-avance?id=${video.id}');
    expect(bibliotheque).not.toContain('/dashboard/creator?id=');
  });

  it('aucun fichier de navigation ne pointe encore vers /dashboard/creer-simple', () => {
    for (const source of [sidebar, calendrier, bibliotheque, pageCreer]) {
      expect(source).not.toContain('/dashboard/creer-simple');
    }
  });

  it('⚠️ l’accueil n’envoie plus sur /dashboard/audio-studio : la tuile « Studio Son » ouvre Créer', () => {
    const accueil = lire('../app/dashboard/page.tsx');
    expect(accueil).not.toContain("href: '/dashboard/audio-studio'");
    expect(accueil).toMatch(/\{ href: '\/dashboard\/creer', icon: Music,/);
    // Deux tuiles mènent à Créer : la clé React ne peut plus être `href`.
    expect(accueil).toContain('key={label}');
  });

  it('⚠️ l’export « Studio Son » de /dashboard/infographic ouvre Créer (un post) ou le Calendrier (plusieurs), jamais audio-studio', () => {
    const infographic = lire('../app/dashboard/infographic/page.tsx');
    expect(infographic).not.toContain('/dashboard/audio-studio');
    expect(infographic).toContain('`/dashboard/creer?postId=${encodeURIComponent(allCreatedPostIds[0])}`');
    expect(infographic).not.toContain('postIds=');
  });

  it('⚠️ l’assistant de chat ne cite plus /dashboard/creer-avance comme chemin', () => {
    const prompts = lire('../lib/chat/system-prompts.ts');
    expect(prompts).not.toContain('/dashboard/creer-avance');
    // L'éditeur avancé a été retiré : l'assistant ne doit plus le proposer.
    expect(prompts).not.toContain('Ouvrir l\'éditeur avancé');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('routes historiques : redirection et transport', () => {
  const pages = [
    ['creer-simple', CreerSimpleLegacyRedirect],
    ['creator', CreatorLegacyRedirect],
    ['infographie', InfographieLegacyRedirect],
  ] as const;

  it.each(pages)('/dashboard/%s sans paramètre mène au parcours guidé', (_nom, Page) => {
    Page({});
    expect(h.cibles).toEqual(['/dashboard/creer']);
  });

  it.each(pages)('/dashboard/%s avec `postId` mène au parcours guidé', (_nom, Page) => {
    Page({ searchParams: { postId: 'p1' } });
    expect(h.cibles).toEqual(['/dashboard/creer?postId=p1']);
  });

  it.each(pages)('/dashboard/%s avec `id` (une vidéo) mène à la Bibliothèque, pas à un éditeur vide', (_nom, Page) => {
    Page({ searchParams: { id: 'v9' } });
    expect(h.cibles).toEqual(['/dashboard/library']);
  });

  it.each(pages)('/dashboard/%s conserve les paramètres répétés', (_nom, Page) => {
    Page({ searchParams: { tag: ['a', 'b'] } });
    expect(h.cibles).toEqual(['/dashboard/creer?tag=a&tag=b']);
  });

  it.each(pages)('/dashboard/%s conserve une valeur vide et un accent', (_nom, Page) => {
    Page({ searchParams: { vide: '', titre: 'été' } });
    expect(h.cibles).toEqual(['/dashboard/creer?vide=&titre=%C3%A9t%C3%A9']);
  });

  it.each(pages)('/dashboard/%s ne reboucle jamais sur elle-même', (nom, Page) => {
    Page({ searchParams: { postId: 'p', tab: 'audio' } });
    expect(h.cibles[0]).not.toContain(`/dashboard/${nom}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('les deux parcours sont bien à leur place', () => {
  it('/dashboard/creer monte l’assistant', () => {
    expect(pageCreer).toContain("import AssistantWizard from './AssistantWizard'");
    expect(pageCreer).toContain('<AssistantWizard />');
  });

  it('l’assistant embarque l’Autopilote', () => {
    const wizard = lire('../app/dashboard/creer/AssistantWizard.tsx');
    expect(wizard).toContain("import AutopilotPanel from '@/components/creer/AutopilotPanel'");
    expect(wizard).toMatch(/<AutopilotPanel\s/);
  });

  it('/dashboard/creer-avance ne porte plus d’éditeur : il redirige, de façon permanente', () => {
    const avance = lire('../app/dashboard/creer-avance/page.tsx');
    expect(avance.split('\n').length).toBeLessThan(60);
    expect(avance).toContain("import { permanentRedirect } from 'next/navigation'");
    expect(avance).toContain('creerRedirectTarget(searchParams)');
    CreerAvanceLegacyRedirect({ searchParams: {} });
    CreerAvanceLegacyRedirect({ searchParams: { postId: 'p1', tab: 'audio' } });
    CreerAvanceLegacyRedirect({ searchParams: { id: 'v1' } });
    expect(h.cibles).toEqual([
      'permanent:/dashboard/creer',
      'permanent:/dashboard/creer?postId=p1&tab=audio',
      'permanent:/dashboard/library',
    ]);
  });

  it('next.config redirige l’ancienne URL et ses sous-chemins (308), et ses en-têtes COOP/COEP ont disparu', () => {
    const config = readFileSync(resolve(__dirname, '../../next.config.js'), 'utf-8');
    expect(config).toContain("source: '/dashboard/creer-avance/:path+'");
    expect(config).toContain("source: '/dashboard/creer-avance',");
    expect(config).toContain("destination: '/dashboard/creer'");
    // `?id=` (une vidéo) sans `postId` → la Bibliothèque, comme `legacy-redirect`.
    expect(config).toContain("has: [{ type: 'query', key: 'id' }],");
    expect(config).toContain("missing: [{ type: 'query', key: 'postId' }],");
    expect(config).toContain("destination: '/dashboard/library'");
    // Les en-têtes COOP/COEP de l'ancien éditeur sont partis avec lui.
    expect(config).not.toContain('Cross-Origin-Opener-Policy');
    expect(config).not.toContain("source: '/dashboard/creer',");
  });

  it('plus aucun lien « Ouvrir l’éditeur avancé » dans Créer', () => {
    const wizard = lire('../app/dashboard/creer/AssistantWizard.tsx');
    expect(wizard).not.toContain('/dashboard/creer-avance');
    expect(wizard).not.toContain('data-editeur-avance');
    expect(wizard).not.toContain('Ouvrir l’éditeur avancé');
  });
});
