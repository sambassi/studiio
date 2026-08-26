import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Unification de « Créer » sous `/dashboard/creer`.
 *
 * Le parcours guidé occupe désormais la route canonique ; l'ancien éditeur
 * est relégué sous `/dashboard/creer-avance`, hors du menu, le temps que le
 * parcours guidé sache relire un contenu existant.
 *
 * Ce que ces tests verrouillent :
 *
 * 1. **Un seul « Créer » dans le menu**, et `creer-avance` n'y figure pas.
 * 2. **Aucun lien d'édition ne peut atteindre le parcours guidé.** Un lien
 *    porteur d'un identifiant qui arriverait sur le wizard afficherait un
 *    montage vierge : l'utilisateur croirait son contenu perdu, sans la
 *    moindre erreur à l'écran. C'est le risque central de cette bascule.
 * 3. **Les trois routes historiques passent par le mécanisme partagé** et
 *    transportent leur query intégralement.
 */

const h = vi.hoisted(() => ({ cibles: [] as string[] }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { h.cibles.push(url); },
}));

import CreerSimpleLegacyRedirect from '../app/dashboard/creer-simple/page';
import CreatorLegacyRedirect from '../app/dashboard/creator/page';
import InfographieLegacyRedirect from '../app/dashboard/infographie/page';

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
describe('aucun lien d’édition n’atteint le parcours guidé', () => {
  it('les trois deeplinks du Calendrier visent l’éditeur qui sait les traiter', () => {
    const cibles = [...calendrier.matchAll(/\/dashboard\/creer[a-z-]*\?postId=/g)].map((m) => m[0]);
    expect(cibles).toHaveLength(3);
    expect(new Set(cibles)).toEqual(new Set(['/dashboard/creer-avance?postId=']));
  });

  it('le Calendrier ne pointe plus jamais `postId` vers le parcours guidé', () => {
    expect(calendrier).not.toContain('/dashboard/creer?postId=');
  });

  it('les deux boutons « ajouter audio » gardent leur onglet', () => {
    const audio = [...calendrier.matchAll(/\/dashboard\/creer-avance\?postId=\$\{[^}]+\}&tab=audio/g)];
    expect(audio).toHaveLength(2);
  });

  it('le bouton « Modifier » de la Bibliothèque vise l’éditeur avancé', () => {
    expect(bibliotheque).toContain('/dashboard/creer-avance?id=${video.id}');
    expect(bibliotheque).not.toContain('/dashboard/creator?id=');
  });

  it('aucun fichier de navigation ne pointe encore vers /dashboard/creer-simple', () => {
    for (const source of [sidebar, calendrier, bibliotheque, pageCreer]) {
      expect(source).not.toContain('/dashboard/creer-simple');
    }
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

  it.each(pages)('/dashboard/%s avec `postId` mène à l’éditeur avancé', (_nom, Page) => {
    Page({ searchParams: { postId: 'p1' } });
    expect(h.cibles).toEqual(['/dashboard/creer-avance?postId=p1']);
  });

  it.each(pages)('/dashboard/%s avec `id` mène à l’éditeur avancé', (_nom, Page) => {
    Page({ searchParams: { id: 'v9' } });
    expect(h.cibles).toEqual(['/dashboard/creer-avance?id=v9']);
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

  it('/dashboard/creer-avance conserve l’éditeur complet', () => {
    const avance = lire('../app/dashboard/creer-avance/page.tsx');
    // Repere de taille : l'editeur ne doit pas avoir ete ampute par la bascule.
    expect(avance.split('\n').length).toBeGreaterThan(12000);
    // Et il reste seul a savoir relire un contenu existant.
    expect(avance).toContain("searchParams?.get('postId')");
    expect(avance).toContain("searchParams?.get('tab')");
  });

  it('les en-têtes COOP/COEP suivent l’ancien éditeur', () => {
    const config = readFileSync(resolve(__dirname, '../../next.config.js'), 'utf-8');
    expect(config).toContain("source: '/dashboard/creer-avance'");
    expect(config).not.toContain("source: '/dashboard/creer',");
  });
});
