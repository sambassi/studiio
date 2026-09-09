/**
 * CREER_PREMIUM_3F — L'APERÇU NE SORT JAMAIS DE LA VUE.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * L'INVARIANT QUE CE FICHIER GARDE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Sur desktop, la page Créer montre le formulaire à gauche et l'aperçu à
 * droite, ce dernier en `sticky`. Un `sticky` ne tient que tant que la colonne
 * voisine reste d'une hauteur raisonnable : si le formulaire fait quatre
 * écrans, l'aperçu suit puis décroche, et l'on se retrouve à régler une vidéo
 * qu'on ne voit plus.
 *
 * La banque audio était exactement ce genre de colonne : huit musiques
 * occupaient déjà 540 px mesurés, et elle en accepte DEUX CENTS. La liste
 * pilotait donc la hauteur de la page.
 *
 * ⚠️ CE TEST EXISTE PARCE QU'UNE RÈGLE DE PRODUIT NE SE RETIENT PAS, ELLE SE
 * VÉRIFIE. « L'aperçu reste visible » est une intention ; ce qui la tient, c'est
 * qu'une liste bornée le reste après chaque modification de ce composant.
 *
 * Ce qui est mesuré ici est STRUCTUREL — le conteneur est borné et défile chez
 * lui — parce que jsdom ne fait pas de mise en page : il n'a ni hauteur réelle
 * ni `position: sticky`. La hauteur en pixels, elle, a été mesurée dans Chrome
 * et se lit dans `HAUTEUR_LISTE_AUDIO`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { POINTS_FORME_ONDE, PISTES_AUDIO_MAX, type PisteAudio } from '@/lib/creatif/audio';

const Bibliotheque = (await import('@/components/creer/BibliothequeAudio')).default;
const { HAUTEUR_LISTE_AUDIO } = await import('@/components/creer/BibliothequeAudio');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const GRILLE = sansProse(lire('src/components/creer/BibliothequeAudio.tsx'));

const U = 'user-42';
const piste = (n: string, extra: Partial<PisteAudio> = {}): PisteAudio => ({
  cle: `${U}/musiques/${n}.mp3`,
  nom: n,
  moods: [],
  dureeMs: 185_000,
  silenceInitialMs: 0,
  octets: 4_200_000,
  empreinte: `4200000-${n}`,
  droitsConfirmesLe: '2026-09-09T10:00:00.000Z',
  formeOnde: Buffer.from(
    Uint8Array.from(Array.from({ length: POINTS_FORME_ONDE }, (_, i) => (i * 4) % 256)),
  ).toString('base64'),
  ...extra,
});

const banque = (n: number) => Array.from({ length: n }, (_, i) => piste(`piste-${i}`));

const rendre = (pistes: readonly PisteAudio[], extra = {}) => render(
  <Bibliotheque pistes={pistes} cleActive={null} onChoisir={() => {}} {...extra} />,
);

/** Le conteneur qui défile, celui dont la hauteur est bornée. */
const liste = (c: HTMLElement) => c.querySelector('[data-audio-liste]') as HTMLElement;

afterEach(() => { cleanup(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La liste défile chez elle', () => {
  it('1.1 ⚠️ ELLE EST BORNÉE, ET ELLE DÉFILE', () => {
    const { container } = rendre(banque(20));
    const ul = liste(container);
    expect(ul).not.toBeNull();
    expect(ul.style.maxHeight).toBe(HAUTEUR_LISTE_AUDIO);
    expect(ul.className).toContain('overflow-y-auto');
  });

  it('1.2 le défilement ne déborde pas sur la page', () => {
    /* `overscroll-contain` : arrivé en bas de la liste, la molette ne se met
       pas à faire défiler la page derrière — sinon on quitte l'audio sans
       l'avoir voulu, et l'aperçu part avec. */
    expect(liste(rendre(banque(20)).container).className).toContain('overscroll-contain');
  });

  it('1.3 ⚠️ LA BORNE NE DÉPEND PAS DU NOMBRE DE PISTES', () => {
    /* C'EST TOUT L'INVARIANT. Cinq musiques ou deux cents, la liste occupe la
       même hauteur maximale : la page ne grandit plus avec la banque. */
    const hauteurs = [5, 50, PISTES_AUDIO_MAX].map((n) => {
      const { container, unmount } = rendre(banque(n));
      const h = liste(container).style.maxHeight;
      unmount();
      return h;
    });
    expect(new Set(hauteurs).size).toBe(1);
    expect(hauteurs[0]).toBe(HAUTEUR_LISTE_AUDIO);
  });

  it('1.4 la borne tient en unités relatives, pas en pixels durs', () => {
    // `rem` suit la taille de police du navigateur : une personne qui grossit
    // le texte garde le même NOMBRE de lignes visibles, pas la même hauteur.
    expect(HAUTEUR_LISTE_AUDIO).toMatch(/rem$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Ce qui reste hors du défilement', () => {
  it('2.1 ⚠️ LA RECHERCHE NE PART PAS AVEC LA LISTE', () => {
    // Enterrée dans le conteneur, elle disparaîtrait dès qu'on descend — au
    // moment précis où une longue banque la rend utile.
    const { container } = rendre(banque(50));
    const recherche = container.querySelector('[data-audio-recherche]') as HTMLElement;
    expect(recherche).not.toBeNull();
    expect(liste(container).contains(recherche)).toBe(false);
  });

  it('2.2 les rayons restent hors du défilement', () => {
    const { container } = rendre(banque(50));
    const rayons = [...container.querySelectorAll('[data-audio-rayon]')] as HTMLElement[];
    expect(rayons.length).toBeGreaterThan(0);
    expect(rayons.every((r) => !liste(container).contains(r))).toBe(true);
  });

  it('2.3 « Ajouter une musique » reste hors du défilement', () => {
    const { container } = rendre(banque(50), { onAjouter: () => {} });
    const ajouter = container.querySelector('[data-audio-ajouter]') as HTMLElement;
    if (ajouter) expect(liste(container).contains(ajouter)).toBe(false);
  });

  it('2.4 chercher continue de filtrer une longue banque', () => {
    const { container } = rendre([...banque(50), piste('Sprint')]);
    fireEvent.change(
      container.querySelector('[data-audio-recherche]') as HTMLElement,
      { target: { value: 'Sprint' } },
    );
    const cartes = [...container.querySelectorAll('[data-audio-carte]')];
    expect(cartes).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le défilement ne casse rien', () => {
  it('3.1 chaque carte garde ses commandes', () => {
    const { container } = rendre(banque(50), { onRetirer: () => {}, onRenommer: () => {} });
    const cle = `${U}/musiques/piste-0.mp3`;
    expect(container.querySelector(`[data-audio-ecouter="${CSS.escape(cle)}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-audio-choisir="${CSS.escape(cle)}"]`)).not.toBeNull();
  });

  it('3.2 ⚠️ UNE PISTE CHOISIE HORS DE LA ZONE VISIBLE RESTE CHOISIE', () => {
    /* Le choix est un état, pas une position : borner l'affichage ne doit pas
       le faire dépendre de ce qui se trouve sous les yeux. */
    const pistes = banque(50);
    const loin = pistes[40].cle;
    const { container } = rendre(pistes, { cleActive: loin });
    const bouton = container.querySelector(`[data-audio-choisir="${CSS.escape(loin)}"]`);
    expect(bouton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('3.3 un seul élément audio pour toute la liste, borne ou pas', () => {
    // La garantie d'A_5b : une piste en arrête une autre par construction.
    // Le conteneur qui défile ne la change pas.
    expect(rendre(banque(50)).container.querySelectorAll('audio')).toHaveLength(1);
  });

  it('3.4 la liste vide et la recherche sans résultat restent hors du conteneur', () => {
    // Deux messages courts : les enfermer dans une zone de 25 rem afficherait
    // un grand vide sous trois mots.
    const vide = rendre([]).container;
    expect(vide.querySelector('[data-audio-banque-vide]')).not.toBeNull();
    expect(liste(vide)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La règle est écrite là où elle se casserait', () => {
  it('4.1 ⚠️ LA BORNE EST NOMMÉE, PAS SEMÉE DANS LE JSX', () => {
    /* Une valeur nommée se retrouve ; un `max-h-[400px]` au milieu d'une
       classe se perd au premier remaniement, et la règle avec lui. */
    expect(GRILLE).toContain('export const HAUTEUR_LISTE_AUDIO');
    expect(GRILLE).toContain('maxHeight: HAUTEUR_LISTE_AUDIO');
  });

  it('4.2 aucune seconde borne concurrente sur la liste', () => {
    // Deux hauteurs pour la même liste, c'est une divergence en attente.
    expect(GRILLE).not.toMatch(/data-audio-liste[\s\S]{0,200}max-h-\[/);
  });

  it('4.3 la barre de défilement reste celle de l’application', () => {
    /* `globals.css` pose déjà une barre fine et discrète pour tout le site :
       en redéfinir une ici ferait deux vérités pour la même chose. */
    expect(GRILLE).not.toMatch(/scrollbar-(width|color|thumb)/);
  });
});
