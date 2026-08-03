import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';
import { samePos } from '@/lib/creer/dragPosition';

/**
 * Persistance du PLACEMENT dans le brouillon — Mode simple.
 *
 * Positions du titre et du CTA, emplacements libres des cartes et groupes ne
 * vivaient qu'en mémoire : un F5 rendait tout le rangement.
 *
 * Le danger propre à ces trois données est qu'elles pilotent le rendu d'un
 * bloc **photographié puis blitté dans la vidéo**. Une valeur à moitié valide
 * relue depuis le stockage ne produirait pas un aperçu approximatif : elle
 * produirait un montage faux. D'où la règle qui traverse tout ce fichier —
 * **tout ou rien, et en cas de doute le placement d'origine**.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'],
  toneIds: ['punchy'],
  formats: ['9:16', '1:1', '16:9'],
  maxStep: 3,
  defaults: {
    themeId: 'sommeil',
    toneId: 'punchy',
    format: '9:16',
    titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
    sequences: [
      { key: 'intro', enabled: true },
      { key: 'cards', enabled: true },
      { key: 'video', enabled: false },
      { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};

const lire = (extra: Record<string, unknown>) =>
  sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, ...extra }, DEPS)!;

const boite = (x = 10, y = 10, w = 40, h = 9) => ({ x, y, w, h });

describe('Default-safe : un brouillon sans placement se relit comme avant', () => {
  it('les trois champs restent absents', () => {
    const d = lire({});
    expect(d.titlePos).toBeUndefined();
    expect(d.ctaPos).toBeUndefined();
    expect(d.cardBoxes).toBeUndefined();
    expect(d.cardGroups).toBeUndefined();
  });

  it('un brouillon écrit AVANT cette fonctionnalité se relit intégralement', () => {
    // Le reste du brouillon ne doit pas être affecté par l'ajout des champs.
    const d = lire({ customTopic: 'yoga', format: '16:9' });
    expect(d.customTopic).toBe('yoga');
    expect(d.format).toBe('16:9');
    expect(d.titlePos).toBeUndefined();
  });
});

describe('Positions du titre et du CTA', () => {
  it('relit une position valide telle quelle', () => {
    const d = lire({ titlePos: { x: 12.5, y: 40 }, ctaPos: { x: 50, y: 92 } });
    expect(d.titlePos).toEqual({ x: 12.5, y: 40 });
    expect(d.ctaPos).toEqual({ x: 50, y: 92 });
  });

  it('accepte les bornes exactes', () => {
    expect(lire({ titlePos: { x: 0, y: 0 } }).titlePos).toEqual({ x: 0, y: 0 });
    expect(lire({ titlePos: { x: 100, y: 100 } }).titlePos).toEqual({ x: 100, y: 100 });
  });

  it('refuse TOUTE position hors cadre — sans repli approché', () => {
    // Restaurer un `x` valide avec un `y` inventé poserait le titre à un
    // endroit que l'utilisateur n'a jamais choisi.
    for (const p of [
      { x: -1, y: 10 }, { x: 10, y: 101 }, { x: 10 }, { y: 10 },
      { x: '10', y: 10 }, { x: NaN, y: 10 }, { x: Infinity, y: 0 },
      null, 'nope', 42, [],
    ]) {
      expect(lire({ titlePos: p }).titlePos, JSON.stringify(p)).toBeUndefined();
    }
  });

  it('les deux positions sont indépendantes', () => {
    const d = lire({ titlePos: { x: 5, y: 5 }, ctaPos: { x: 999, y: 5 } });
    expect(d.titlePos).toEqual({ x: 5, y: 5 });
    expect(d.ctaPos).toBeUndefined();
  });
});

describe('Emplacements libres des cartes — tout ou rien', () => {
  it('relit un ensemble valide, avec son format de mesure', () => {
    const d = lire({ cardBoxes: { format: '16:9', boxes: { a: boite(), b: boite(50, 20) } } });
    expect(d.cardBoxes).toEqual({ format: '16:9', boxes: { a: boite(), b: boite(50, 20) } });
  });

  it('UNE boîte abîmée invalide TOUT l ensemble', () => {
    // Une carte sans emplacement dans une disposition libre se rendrait sans
    // position, empilée dans un coin avec les autres.
    const d = lire({ cardBoxes: { format: '9:16', boxes: { a: boite(), b: { x: 1, y: 1, w: 1 } } } });
    expect(d.cardBoxes).toBeUndefined();
  });

  it('refuse une carte de largeur ou de hauteur nulle', () => {
    // Invisible et insaisissable : irrattrapable sans repartir de zéro.
    expect(lire({ cardBoxes: { format: '9:16', boxes: { a: boite(10, 10, 0, 9) } } }).cardBoxes).toBeUndefined();
    expect(lire({ cardBoxes: { format: '9:16', boxes: { a: boite(10, 10, 40, 0) } } }).cardBoxes).toBeUndefined();
  });

  it('refuse un format inconnu', () => {
    // `h` est un % de la hauteur du conteneur : rejoué à la mauvaise échelle,
    // il écrase les cartes les unes sur les autres, dans la vidéo comprise.
    expect(lire({ cardBoxes: { format: '4:5', boxes: { a: boite() } } }).cardBoxes).toBeUndefined();
    expect(lire({ cardBoxes: { boxes: { a: boite() } } }).cardBoxes).toBeUndefined();
  });

  it('refuse un ensemble vide ou déraisonnable', () => {
    expect(lire({ cardBoxes: { format: '9:16', boxes: {} } }).cardBoxes).toBeUndefined();
    const trop: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) trop[`c${i}`] = boite();
    expect(lire({ cardBoxes: { format: '9:16', boxes: trop } }).cardBoxes).toBeUndefined();
  });

  it('refuse une forme qui n est pas un ensemble d emplacements', () => {
    for (const v of [null, 'nope', 42, [], { format: '9:16' }, { format: '9:16', boxes: 'x' }]) {
      expect(lire({ cardBoxes: v }).cardBoxes, JSON.stringify(v)).toBeUndefined();
    }
  });
});

describe('Groupes — les invariants sont rétablis à la lecture', () => {
  it('relit des groupes valides', () => {
    const d = lire({ cardGroups: [{ id: 'g1', cardIds: ['a', 'b'] }] });
    expect(d.cardGroups).toEqual([{ id: 'g1', cardIds: ['a', 'b'] }]);
  });

  it('jette un groupe de moins de deux cartes', () => {
    // Un groupe d'une carte est invisible, et aucune action de l'écran ne sait
    // le défaire.
    expect(lire({ cardGroups: [{ id: 'g1', cardIds: ['a'] }] }).cardGroups).toBeUndefined();
    expect(lire({ cardGroups: [{ id: 'g1', cardIds: [] }] }).cardGroups).toBeUndefined();
  });

  it('une carte ne peut appartenir qu à UN groupe', () => {
    const d = lire({
      cardGroups: [
        { id: 'g1', cardIds: ['a', 'b'] },
        { id: 'g2', cardIds: ['b', 'c'] },
      ],
    });
    // `b` reste dans le premier ; `g2` tombe alors sous le seuil et disparaît.
    expect(d.cardGroups).toEqual([{ id: 'g1', cardIds: ['a', 'b'] }]);
  });

  it('dédoublonne à l intérieur d un même groupe', () => {
    const d = lire({ cardGroups: [{ id: 'g1', cardIds: ['a', 'a', 'b'] }] });
    expect(d.cardGroups).toEqual([{ id: 'g1', cardIds: ['a', 'b'] }]);
  });

  it('ignore les entrées mal formées sans jeter les bonnes', () => {
    const d = lire({
      cardGroups: [null, { cardIds: ['a', 'b'] }, { id: 'g2', cardIds: ['x', 'y'] }, 'nope'],
    });
    expect(d.cardGroups).toEqual([{ id: 'g2', cardIds: ['x', 'y'] }]);
  });

  it('borne le nombre de groupes relus', () => {
    const trop = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, cardIds: [`a${i}`, `b${i}`] }));
    expect(lire({ cardGroups: trop }).cardGroups).toHaveLength(12);
  });

  it('refuse une forme qui n est pas une liste', () => {
    for (const v of [null, 'nope', 42, {}]) {
      expect(lire({ cardGroups: v }).cardGroups, JSON.stringify(v)).toBeUndefined();
    }
  });
});

describe('Aller-retour : ce qu on écrit est ce qu on relit', () => {
  it('un placement complet survit au passage par le stockage', () => {
    const ecrit = {
      titlePos: { x: 22, y: 61 },
      ctaPos: { x: 44, y: 88 },
      cardBoxes: { format: '9:16', boxes: { a: boite(3, 4, 60, 9), b: boite(30, 40, 60, 9) } },
      cardGroups: [{ id: 'g1', cardIds: ['a', 'b'] }],
    };
    const relu = sanitizeDraft(
      JSON.parse(JSON.stringify({ version: DRAFT_VERSION, savedAt: 1, ...ecrit })),
      DEPS,
    )!;
    expect(relu.titlePos).toEqual(ecrit.titlePos);
    expect(relu.ctaPos).toEqual(ecrit.ctaPos);
    expect(relu.cardBoxes).toEqual(ecrit.cardBoxes);
    expect(relu.cardGroups).toEqual(ecrit.cardGroups);
  });
});

describe('samePos — « rien n a bougé » se juge sur les VALEURS', () => {
  it('deux objets distincts de mêmes coordonnées sont la même position', () => {
    // L'état part de la constante `DESIGN`, mais tout `setState` en fabrique un
    // nouvel objet : comparer les références déclarerait « déplacé » un titre
    // revenu exactement à sa place, et écrirait une position inutile.
    expect(samePos({ x: 8, y: 8 }, { x: 8, y: 8 })).toBe(true);
  });

  it('distingue un écart sur chaque axe', () => {
    expect(samePos({ x: 8, y: 8 }, { x: 9, y: 8 })).toBe(false);
    expect(samePos({ x: 8, y: 8 }, { x: 8, y: 9 })).toBe(false);
  });
});

describe('Câblage', () => {
  it("n'écrit rien tant que rien n'a bougé", () => {
    // Un brouillon d'un utilisateur qui n'a rien déplacé reste exactement
    // celui d'avant cette PR.
    expect(wizard).toContain('titlePos: samePos(titlePos, DESIGN.titlePos) ? undefined : titlePos');
    expect(wizard).toContain('ctaPos: samePos(ctaPos, DESIGN.ctaPos) ? undefined : ctaPos');
    expect(wizard).toContain('cardBoxes: cardBoxes ?? undefined');
    expect(wizard).toContain('cardGroups: cardGroups.length ? cardGroups : undefined');
  });

  it('les quatre champs déclenchent une réécriture du brouillon', () => {
    // Absents des dépendances, `buildDraft` resterait figé sur l'ancien
    // placement et l'autosave n'écrirait jamais le nouveau.
    const debut = wizard.indexOf('  }), [', wizard.indexOf('const buildDraft'));
    const deps = wizard.slice(debut, wizard.indexOf(']);', debut));
    expect(deps).toContain('titlePos, ctaPos, cardBoxes, cardGroups,');
  });

  it('chaque champ absent laisse le défaut en place à la relecture', () => {
    expect(wizard).toContain('if (draft.titlePos) setTitlePos(draft.titlePos);');
    expect(wizard).toContain('if (draft.ctaPos) setCtaPos(draft.ctaPos);');
    expect(wizard).toContain('if (draft.cardBoxes) {');
    expect(wizard).toContain('if (draft.cardGroups) setCardGroups(draft.cardGroups);');
  });

  it('la ref des emplacements est restaurée avec l état', () => {
    // Elle seule est lue par le gestionnaire de glissement, mémoïsé sans
    // dépendances : sans elle, la première prise remesurerait la disposition
    // et effacerait ce qu'on vient de restaurer.
    const bloc = wizard.slice(wizard.indexOf('if (draft.cardBoxes) {'), wizard.indexOf('if (draft.cardBoxes) {') + 600);
    expect(bloc).toContain('cardBoxesRef.current = free;');
    expect(bloc).toContain('setCardBoxes(free);');
  });

  it('la restauration annonce le placement retrouvé', () => {
    expect(wizard).toContain(
      "draft.titlePos || draft.ctaPos || draft.cardBoxes || draft.cardGroups ? 'placement' : null",
    );
  });
});
