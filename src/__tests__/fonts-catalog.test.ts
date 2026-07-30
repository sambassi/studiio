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
 * Le défaut qui a motivé ce module n'est pas un manque de polices, c'est une
 * URL : l'API CSS de Google répond **400 Bad Request** dès qu'on lui demande
 * une graisse qu'une famille ne possède pas. Le repli générique du compositeur
 * réclamait `wght@400;…;900` à toute famille inconnue — donc aucune feuille
 * pour Pacifico, Anton, Bebas et l'écrasante majorité des display et des
 * scriptes, qui n'existent qu'en 400. La police n'arrivait jamais, le canvas
 * retombait en silence sur une police système, et la vidéo sortait dans une
 * autre typographie que l'aperçu.
 *
 * C'est ce que ces tests surveillent en premier.
 */

describe('Les graisses demandées sont celles qui existent', () => {
  it('n’écrit jamais une URL qui ferait répondre 400 à Google', () => {
    for (const f of FONT_CATALOG) {
      const url = googleFontsUrl(f.family, f.weights);
      const asked = /wght@([\d;]+)/.exec(url)![1].split(';').map(Number);
      // Chaque graisse demandée doit être déclarée pour CETTE famille.
      for (const w of asked) expect(f.weights).toContain(w);
      expect(asked).toEqual([...f.weights].sort((a, b) => a - b));
    }
  });

  it('déclare des graisses plausibles, et le 400 partout', () => {
    // Le 400 est la seule graisse que toute famille Google publie : sans lui,
    // une famille pourrait n'avoir aucune graisse chargeable.
    for (const f of FONT_CATALOG) {
      expect(f.weights.length).toBeGreaterThan(0);
      expect(f.weights).toContain(400);
      for (const w of f.weights) {
        expect(w).toBeGreaterThanOrEqual(100);
        expect(w).toBeLessThanOrEqual(900);
        expect(w % 100).toBe(0);
      }
    }
  });

  it('les familles à graisse unique ne demandent QUE le 400', () => {
    // Anton, Bebas Neue, Pacifico… : leur demander 900 suffisait à ce que
    // rien ne se charge.
    for (const family of ['Anton', 'Bebas Neue', 'Pacifico', 'Archivo Black', 'Lobster']) {
      const def = findFont(family);
      expect(def, family).toBeDefined();
      expect(def!.weights).toEqual([400]);
      expect(googleFontsUrl(family, def!.weights)).toContain('wght@400&');
    }
  });

  it('encode les noms composés', () => {
    expect(googleFontsUrl('Dancing Script', [400, 700])).toBe(
      'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;700&display=swap',
    );
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
  let loaded: string[];
  let check: (spec: string) => boolean;

  beforeEach(() => {
    loaded = [];
    check = () => true;
    document.head.replaceChildren();
    vi.resetModules();
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        load: (spec: string) => {
          loaded.push(spec);
          return Promise.resolve([]);
        },
        check: (spec: string) => check(spec),
        ready: Promise.resolve(),
      },
    });
  });

  it('injecte UNE feuille, avec les bonnes graisses', async () => {
    const { ensureFontLoaded: fresh } = await import('../lib/fonts/catalog');
    await fresh('Pacifico');
    const links = document.head.querySelectorAll('link[data-font="Pacifico"]');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(
      'https://fonts.googleapis.com/css2?family=Pacifico:wght@400&display=swap',
    );
    // Et on n'attend QUE la graisse qui existe.
    expect(loaded).toEqual(['400 48px "Pacifico"']);
  });

  it('ne recharge pas une famille déjà demandée', async () => {
    const { ensureFontLoaded: fresh } = await import('../lib/fonts/catalog');
    await fresh('Caveat');
    await fresh('Caveat');
    await fresh('Caveat');
    expect(document.head.querySelectorAll('link[data-font="Caveat"]')).toHaveLength(1);
  });

  it('ne charge que ce qu’on lui demande', async () => {
    // Charger les 52 familles plomberait la page pour n'en servir qu'une.
    const { ensureFontLoaded: fresh } = await import('../lib/fonts/catalog');
    await fresh('Teko');
    expect(document.head.querySelectorAll('link[data-font]')).toHaveLength(1);
  });

  it('dit franchement qu’une police n’est pas arrivée', async () => {
    // Sans ce retour, l'utilisateur réglerait sa typo sur un rendu de repli
    // et l'export sortirait pareil, sans un mot.
    check = () => false;
    const { ensureFontLoaded: fresh } = await import('../lib/fonts/catalog');
    expect(await fresh('Lobster')).toBe(false);
    check = () => true;
    expect(await fresh('Satisfy')).toBe(true);
  });

  it('ne vérifie que les graisses publiées par la famille', async () => {
    // Vérifier le 900 d'une Pacifico qui n'existe qu'en 400 ferait conclure à
    // tort à un échec — c'est le faux avertissement qu'on voyait en prod sur
    // Anton et Bebas Neue.
    check = (spec) => spec.startsWith('400 ');
    const { ensureFontLoaded: fresh } = await import('../lib/fonts/catalog');
    expect(await fresh('Anton')).toBe(true);
  });

  it('ignore les valeurs qui ne désignent pas une police', async () => {
    const { ensureFontLoaded: fresh } = await import('../lib/fonts/catalog');
    expect(await fresh('')).toBe(false);
    expect(await fresh('sans-serif')).toBe(false);
    expect(document.head.querySelectorAll('link[data-font]')).toHaveLength(0);
  });

  it('demande le seul 400 pour une famille inconnue', async () => {
    // Réclamer 900 ferait répondre 400 à l'API et ne chargerait rien.
    const { ensureFontLoaded: fresh } = await import('../lib/fonts/catalog');
    await fresh('Comic Sans MS');
    expect(loaded).toEqual(['400 48px "Comic Sans MS"']);
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
