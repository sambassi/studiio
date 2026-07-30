import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FONT_CATALOG,
  FONT_GROUPS,
  findFont,
  fontStack,
  googleFontsUrl,
} from '../lib/fonts/catalog';

/**
 * Catalogue de polices.
 *
 * Le défaut qui a motivé ce module est SILENCIEUX : `document.fonts.load()`
 * appelé juste après avoir inséré la balise `<link>` ne trouve encore aucune
 * `@font-face` — la feuille n'est pas analysée — et résout sur un tableau
 * vide, immédiatement. Pire, `document.fonts.check()` renvoie `true` par
 * spécification quand rien ne correspond. Un chargement qui ne charge rien se
 * déclarait donc réussi en quelques millisecondes, et le canvas dessinait en
 * police système pendant que l'aperçu affichait la bonne police.
 *
 * Ces tests exercent ce scénario précis : feuille non encore analysée,
 * `check()` menteur, `load()` qui rend un tableau vide.
 */

describe('Les graisses demandées', () => {
  it('couvrent celles que la famille publie, et rien de plus', () => {
    // L'API Google tolère les graisses surnuméraires — elle les rabat sur les
    // plus proches — et ne répond 400 que si AUCUNE n'existe. Ne demander que
    // les publiées allège la feuille et permet surtout de VÉRIFIER le
    // chargement sur les bonnes : contrôler le 900 d'une Pacifico qui n'a que
    // le 400 faisait conclure à tort à un échec.
    for (const f of FONT_CATALOG) {
      expect(f.weights.length).toBeGreaterThan(0);
      // Le 400 est la seule graisse que toute famille publie : sans lui, une
      // URL ne contenant que des graisses absentes ferait bien répondre 400.
      expect(f.weights, f.family).toContain(400);
      for (const w of f.weights) {
        expect(w % 100, `${f.family} ${w}`).toBe(0);
        expect(w).toBeGreaterThanOrEqual(100);
        expect(w).toBeLessThanOrEqual(900);
      }
    }
  });

  it('encode les noms composés', () => {
    expect(googleFontsUrl('Dancing Script', [400, 700])).toBe(
      'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;700&display=swap',
    );
  });

  it('trie et dédoublonne les graisses', () => {
    expect(googleFontsUrl('X', [700, 400, 700])).toContain('wght@400;700');
  });
});

describe('Un choix réellement généreux, et classé', () => {
  it('propose plusieurs dizaines de polices', () => {
    // Le retour était « beaucoup trop peu pour faire des affiches » : on
    // partait de 6.
    expect(FONT_CATALOG.length).toBeGreaterThanOrEqual(40);
  });

  it('couvre les trois usages, scriptes comprises', () => {
    const byGroup = Object.fromEntries(FONT_GROUPS.map((g) => [g.group, g.fonts]));
    expect(byGroup.display.length).toBeGreaterThanOrEqual(10);
    expect(byGroup.text.length).toBeGreaterThanOrEqual(10);
    // Indispensables pour les affiches — c'est le groupe qui manquait.
    expect(byGroup.script.length).toBeGreaterThanOrEqual(8);
    for (const f of ['Pacifico', 'Dancing Script', 'Caveat']) {
      expect(byGroup.script).toContain(f);
    }
    for (const f of ['Oswald', 'Archivo Black', 'Teko', 'Righteous', 'Anton', 'Bebas Neue']) {
      expect(byGroup.display).toContain(f);
    }
  });

  it('garde les polices d’avant, dans le même groupe qu’avant', () => {
    // Rétro-compat : un post existant réglé sur l'une d'elles doit continuer
    // de la trouver.
    for (const f of ['Inter', 'Poppins', 'Space Grotesk']) {
      expect(findFont(f)?.group).toBe('text');
    }
    for (const f of ['Anton', 'Bebas Neue', 'Syne']) {
      expect(findFont(f)?.group).toBe('display');
    }
  });

  it('ne contient aucun doublon', () => {
    const names = FONT_CATALOG.map((f) => f.family);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('Pile CSS', () => {
  it('sert la variable next/font en premier pour les six familles de la page', () => {
    // Elles sont déjà chargées : aucun téléchargement, et surtout le rendu
    // d'avant ce catalogue est préservé au caractère près.
    expect(fontStack('Inter')).toBe("var(--font-inter), 'Inter', sans-serif");
    expect(fontStack('Anton')).toBe("var(--font-anton), 'Anton', sans-serif");
  });

  it('utilise le nom brut pour les nouvelles — le seul que le canvas comprenne', () => {
    expect(fontStack('Pacifico')).toBe("'Pacifico', sans-serif");
    expect(fontStack('Archivo Black')).toBe("'Archivo Black', sans-serif");
  });

  it('ne casse pas sur une famille hors catalogue', () => {
    // Métadonnée d'un ancien post, ou saisie manuelle.
    expect(fontStack('Comic Sans MS')).toBe("'Comic Sans MS', sans-serif");
  });
});

describe('Chargement à la demande', () => {
  /** Feuilles « analysées » — c'est ce qui décide si `load()` rend des faces. */
  let parsed: Set<string>;
  let loadCalls: string[];
  /** Si vrai, la balise ne déclenche jamais `load` (CDN injoignable). */
  let sheetFails: boolean;

  beforeEach(() => {
    parsed = new Set();
    loadCalls = [];
    sheetFails = false;
    document.head.replaceChildren();
    vi.resetModules();

    // Une balise <link> qui se comporte comme dans un navigateur : elle
    // n'émet `load` qu'après un tour de boucle, et c'est SEULEMENT à ce
    // moment que les @font-face existent.
    // La methode du PROTOTYPE, pas celle de l'instance : celle-ci est deja
    // remplacee par l'espion du test precedent, et s'y rappeler recursait.
    vi.restoreAllMocks();
    const realAppend = Node.prototype.appendChild;
    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      const out = realAppend.call(document.head, node);
      const link = node as HTMLLinkElement;
      if (link.tagName === 'LINK') {
        setTimeout(() => {
          if (sheetFails) {
            link.dispatchEvent(new Event('error'));
            return;
          }
          const m = /family=([^:&]+)/g;
          let hit: RegExpExecArray | null;
          while ((hit = m.exec(link.href))) parsed.add(decodeURIComponent(hit[1]).replace(/\+/g, ' '));
          link.dispatchEvent(new Event('load'));
        }, 0);
      }
      return out;
    }) as typeof document.head.appendChild);

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        // Rend des `FontFace` UNIQUEMENT si la feuille est analysée — c'est
        // exactement ce que fait un navigateur, et c'est ce que l'ancienne
        // version ignorait.
        load: (spec: string) => {
          loadCalls.push(spec);
          const fam = /"([^"]+)"/.exec(spec)?.[1] ?? '';
          return Promise.resolve(parsed.has(fam) ? [{ family: fam }] : []);
        },
        // Menteur, comme la vraie API : `true` quand rien ne correspond.
        check: () => true,
        ready: Promise.resolve(),
      },
    });
  });

  it('attend que la feuille soit ANALYSÉE avant de demander la police', async () => {
    // Le cœur du correctif. Sans cette attente, `load()` rendait un tableau
    // vide en ~5 ms et le chargement se déclarait réussi.
    const { ensureFontLoaded } = await import('../lib/fonts/catalog');
    expect(await ensureFontLoaded('Pacifico')).toBe(true);
    expect(loadCalls).toEqual(['400 48px "Pacifico"']);
    const links = document.head.querySelectorAll('link[data-font="Pacifico"]');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(
      'https://fonts.googleapis.com/css2?family=Pacifico:wght@400&display=swap',
    );
  });

  it('ne se fie PAS à `check()`, qui répond vrai sur une police absente', async () => {
    // `check()` renvoie `true` par spécification quand aucune @font-face ne
    // correspond : s'y fier faisait passer tout échec pour un succès.
    sheetFails = true;
    const { ensureFontLoaded } = await import('../lib/fonts/catalog');
    expect(await ensureFontLoaded('Lobster')).toBe(false);
  });

  it('ne met PAS l’échec en cache — le prochain export doit pouvoir réussir', async () => {
    // L'ancien compositeur rattrapait au second export ; mémoriser l'échec
    // aurait figé la police de repli pour toute la session.
    const { ensureFontLoaded } = await import('../lib/fonts/catalog');
    sheetFails = true;
    expect(await ensureFontLoaded('Satisfy')).toBe(false);
    sheetFails = false;
    document.head.replaceChildren();
    expect(await ensureFontLoaded('Satisfy')).toBe(true);
  });

  it('mémorise en revanche les succès — une seule feuille par famille', async () => {
    const { ensureFontLoaded } = await import('../lib/fonts/catalog');
    await ensureFontLoaded('Caveat');
    await ensureFontLoaded('Caveat');
    await ensureFontLoaded('Caveat');
    expect(document.head.querySelectorAll('link[data-font="Caveat"]')).toHaveLength(1);
    expect(loadCalls.filter((c) => c.includes('Caveat'))).toHaveLength(4); // 4 graisses, un seul passage
  });

  it('ne charge que ce qu’on lui demande', async () => {
    const { ensureFontLoaded } = await import('../lib/fonts/catalog');
    await ensureFontLoaded('Teko');
    expect(document.head.querySelectorAll('link[data-font]')).toHaveLength(1);
  });

  it('ignore les valeurs qui ne désignent pas une police', async () => {
    const { ensureFontLoaded } = await import('../lib/fonts/catalog');
    expect(await ensureFontLoaded('')).toBe(false);
    expect(await ensureFontLoaded('sans-serif')).toBe(false);
    expect(document.head.querySelectorAll('link[data-font]')).toHaveLength(0);
  });

  it('demande le seul 400 pour une famille inconnue', async () => {
    // Une URL ne contenant que des graisses absentes ferait répondre 400.
    const { ensureFontLoaded } = await import('../lib/fonts/catalog');
    await ensureFontLoaded('Comic Sans MS');
    expect(loadCalls).toEqual(['400 48px "Comic Sans MS"']);
  });

  it('précharge tout le catalogue en UNE requête pour le sélecteur', async () => {
    // Sans feuille, les 52 noms s'affichent dans la même police système —
    // pour un catalogue dont la variété est l'intérêt, c'est le plus visible
    // des défauts. 52 requêtes seraient un remède pire que le mal.
    const { preloadCatalogPreview, FONT_CATALOG: cat } = await import('../lib/fonts/catalog');
    expect(await preloadCatalogPreview()).toBe(true);
    const links = document.head.querySelectorAll('link[data-font="__catalog-preview"]');
    expect(links).toHaveLength(1);
    const href = links[0].getAttribute('href')!;
    expect((href.match(/family=/g) || []).length).toBe(cat.length);
    // Uniquement la graisse normale : l'aperçu du sélecteur n'a pas besoin
    // des autres, et elles tripleraient le poids.
    expect(href).not.toMatch(/wght@400;/);
  });

  it('ne réinjecte pas le préchargement', async () => {
    const { preloadCatalogPreview } = await import('../lib/fonts/catalog');
    await preloadCatalogPreview();
    await preloadCatalogPreview();
    expect(document.head.querySelectorAll('link[data-font="__catalog-preview"]')).toHaveLength(1);
  });
});

describe('Le compositeur attend les polices AVANT de dessiner', () => {
  it('charge, puis seulement ensuite les médias et le rendu', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
    const load = composer.indexOf("await import('@/lib/fonts/catalog')");
    const media = composer.indexOf('// Load visual media');
    const draw = composer.indexOf('function drawIntro');
    expect(load).toBeGreaterThan(-1);
    // L'ordre importe : une police arrivée après le premier `ctx.fillText`
    // laisse les premières frames en police système.
    expect(load).toBeLessThan(media);
    expect(draw).toBeLessThan(load); // drawIntro est déclarée plus haut, appelée plus bas
    expect(composer).toMatch(/await ensureFontsLoaded\(\[/);
  });

  it('couvre toutes les polices qu’un design peut porter', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
    const call = composer.slice(
      composer.indexOf('await ensureFontsLoaded(['),
      composer.indexOf(']);', composer.indexOf('await ensureFontsLoaded([')),
    );
    for (const field of [
      'design?.font',
      'design?.titleFont',
      'design?.subtitleFont',
      'design?.ctaFont',
      'design?.overlayFont',
      'design?.watermarkFont',
      'design?.cardsFont',
    ]) {
      expect(call).toContain(field);
    }
  });
});
