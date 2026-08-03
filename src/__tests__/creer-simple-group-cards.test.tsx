import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  groupCards, ungroupCards, pruneGroups, expandSelection, groupOf, newGroupId, MIN_GROUP,
  type CardGroup,
} from '@/lib/creer/selection';
import { Preview } from '@/app/dashboard/creer-simple/AssistantWizard';

/**
 * Groupes de cartes — Mode simple.
 *
 * Un groupe est une aide d'ÉDITION : deux cartes groupées s'exportent
 * exactement comme deux cartes non groupées. Le montage et les métadonnées du
 * post n'en savent rien, et le repère visuel ne doit jamais être photographié.
 *
 * L'invariant qui porte tout le reste : **une carte appartient à au plus un
 * groupe**, et un groupe compte au moins deux cartes. Sans lui, on accumule
 * des groupes fantômes d'une seule carte, invisibles et impossibles à défaire.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const g = (id: string, ...cardIds: string[]): CardGroup => ({ id, cardIds });
const ids = () => {
  let n = 0;
  return () => `g${++n}`;
};

describe('groupCards', () => {
  it('crée un groupe à partir de deux cartes', () => {
    const out = groupCards([], ['a', 'b'], ids());
    expect(out).toEqual([{ id: 'g1', cardIds: ['a', 'b'] }]);
  });

  it('refuse un groupe d une seule carte', () => {
    const avant: CardGroup[] = [];
    expect(groupCards(avant, ['a'], ids())).toBe(avant);
    expect(MIN_GROUP).toBe(2);
  });

  it('une carte n appartient qu à UN groupe : elle quitte le précédent', () => {
    const out = groupCards([g('g0', 'a', 'b', 'c')], ['a', 'z'], ids());
    expect(out).toHaveLength(2);
    expect(out[0].cardIds).toEqual(['b', 'c']);
    expect(out[1].cardIds).toEqual(['a', 'z']);
  });

  it('un groupe vidé sous le seuil disparaît au lieu de rester fantôme', () => {
    // `g0` perdrait `a` et n'aurait plus que `b` : un groupe d'une carte est
    // invisible et impossible à défaire.
    const out = groupCards([g('g0', 'a', 'b')], ['a', 'z'], ids());
    expect(out).toHaveLength(1);
    expect(out[0].cardIds).toEqual(['a', 'z']);
  });

  it('ne mute pas l entrée', () => {
    const avant = [g('g0', 'a', 'b', 'c')];
    groupCards(avant, ['a', 'z'], ids());
    expect(avant[0].cardIds).toEqual(['a', 'b', 'c']);
  });

  it('les identifiants de groupe sont distincts', () => {
    expect(newGroupId()).not.toBe(newGroupId());
  });
});

describe('ungroupCards', () => {
  it('retire les cartes indiquées de leur groupe', () => {
    const out = ungroupCards([g('g0', 'a', 'b', 'c')], new Set(['a']));
    expect(out[0].cardIds).toEqual(['b', 'c']);
  });

  it('le groupe disparaît quand il tombe sous le seuil', () => {
    expect(ungroupCards([g('g0', 'a', 'b')], new Set(['a']))).toEqual([]);
  });

  it('rend la MÊME référence quand rien ne change', () => {
    // Un tableau neuf à chaque appel relancerait les effets qui en dépendent.
    const avant = [g('g0', 'a', 'b')];
    expect(ungroupCards(avant, new Set(['inconnu']))).toBe(avant);
    expect(ungroupCards(avant, new Set())).toBe(avant);
  });

  it('ne touche pas aux groupes non concernés', () => {
    const out = ungroupCards([g('g0', 'a', 'b'), g('g1', 'c', 'd')], new Set(['a', 'b']));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('g1');
  });
});

describe('pruneGroups — un groupe ne survit pas à ses cartes', () => {
  it('oublie les cartes disparues', () => {
    const out = pruneGroups([g('g0', 'a', 'b', 'c')], ['a', 'b']);
    expect(out[0].cardIds).toEqual(['a', 'b']);
  });

  it('jette un groupe qui tombe sous le seuil', () => {
    expect(pruneGroups([g('g0', 'a', 'b')], ['a'])).toEqual([]);
    expect(pruneGroups([g('g0', 'a', 'b')], [])).toEqual([]);
  });

  it('rend la MÊME référence quand rien ne change', () => {
    const avant = [g('g0', 'a', 'b')];
    expect(pruneGroups(avant, ['a', 'b', 'c'])).toBe(avant);
  });
});

describe('expandSelection — un groupe se prend en bloc', () => {
  const groupes = [g('g0', 'a', 'b', 'c'), g('g1', 'x', 'y')];

  it('désigner un membre prend tout le groupe', () => {
    expect(expandSelection(new Set(['b']), groupes)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('deux groupes touchés sont pris tous les deux', () => {
    expect(expandSelection(new Set(['b', 'x']), groupes)).toEqual(new Set(['a', 'b', 'c', 'x', 'y']));
  });

  it('une carte sans groupe reste seule', () => {
    const sel = new Set(['z']);
    expect(expandSelection(sel, groupes)).toBe(sel);
  });

  it('rend la MÊME référence quand rien ne s ajoute', () => {
    const sel = new Set(['a', 'b', 'c']);
    expect(expandSelection(sel, groupes)).toBe(sel);
    const vide = new Set<string>();
    expect(expandSelection(vide, groupes)).toBe(vide);
    expect(expandSelection(sel, [])).toBe(sel);
  });
});

describe('groupOf', () => {
  it('retrouve le groupe d une carte', () => {
    expect(groupOf([g('g0', 'a', 'b')], 'b')?.id).toBe('g0');
  });

  it('rend undefined pour une carte libre', () => {
    expect(groupOf([g('g0', 'a', 'b')], 'z')).toBeUndefined();
  });
});

// ── Rendu ────────────────────────────────────────────────────────────────

const generated = {
  title: 'Routine matin',
  subtitle: 'Quand s entraîner ?',
  cards: [
    { id: 'a', icon: 'Flame', title: 'Matin', description: 'Le matin', value: '70%' },
    { id: 'b', icon: 'Moon', title: 'Soir', description: 'Le soir', value: '30%' },
  ],
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
};
const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  subtitle: { font: null, color: null, scale: 1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
};
const previewProps = {
  generated,
  format: '9:16' as const,
  displayScale: 0.25,
  activeOrder: ['intro', 'cards', 'cta'],
  gradStart: '#7C3AED',
  gradEnd: '#EC4899',
  gradientOpacity: 0.5,
  accent: '#7C3AED',
  watermark: 'Studiio.pro',
  text: TEXT,
};
afterEach(cleanup);
const cartes = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-cards-grid] [data-card-id]'));

describe('Le repère de groupe dans l aperçu', () => {
  it('marque les cartes groupées, et elles seules', () => {
    render(<Preview {...previewProps} groupedCards={{ a: 'g0' }} />);
    const [a, b] = cartes();
    expect(a.style.boxShadow).toContain('inset');
    expect(b.style.boxShadow).toBe('');
  });

  it('sans groupe, aucune carte n est marquée', () => {
    render(<Preview {...previewProps} />);
    for (const el of cartes()) expect(el.style.boxShadow).toBe('');
  });

  it('la sélection l emporte sur le repère de groupe', () => {
    // Deux marques concurrentes sur la même carte seraient illisibles.
    render(<Preview {...previewProps} groupedCards={{ a: 'g0' }} selectedCards={new Set(['a'])} />);
    expect(cartes()[0].style.boxShadow).not.toContain('inset');
  });

  it('rien n est marqué pendant la capture', () => {
    // Sinon le filet serait blitté dans la vidéo.
    render(<Preview {...previewProps} groupedCards={{ a: 'g0' }} capturing />);
    for (const el of cartes()) expect(el.style.boxShadow).toBe('');
  });
});

describe('Câblage', () => {
  it('la sélection est étendue au groupe à chaque appui', () => {
    expect(wizard).toContain('expandSelection(');
    expect(wizard).toContain('groupsRef.current');
  });

  it('les groupes sont purgés en même temps que la sélection', () => {
    expect(wizard).toContain('setCardGroups((prev) => pruneGroups(prev, cardIds));');
  });

  it('le bouton Grouper exige deux cartes, et dit pourquoi', () => {
    expect(wizard).toContain('disabled={selectedCards.size < MIN_GROUP}');
    expect(wizard).toContain("'Sélectionnez au moins deux cartes'");
  });

  it('Dégrouper remplace Grouper quand la sélection touche un groupe', () => {
    expect(wizard).toContain('selectionGrouped ? (');
    expect(wizard).toContain('const selectionGrouped = [...selectedCards].some((id) => !!groupOf(cardGroups, id));');
  });

  it("un groupe ne change RIEN à l'export", () => {
    // Ni le compositeur ni les métadonnées ne reçoivent les groupes.
    const envoi = wizard.slice(wizard.indexOf('const composerCards'), wizard.indexOf('setRenderStage(\'Rendu du montage'));
    expect(envoi).not.toContain('cardGroups');
    expect(envoi).not.toContain('groupedByCard');
  });

  it('utilise des icônes lucide, pas des emojis', () => {
    expect(wizard).toContain('<Combine className="w-3.5 h-3.5" />');
    expect(wizard).toContain('<Ungroup className="w-3.5 h-3.5" />');
  });

  it('un nouveau montage repart sans groupe', () => {
    const reset = wizard.slice(wizard.indexOf('const reset = ()'), wizard.indexOf('const reset = ()') + 900);
    expect(reset).toContain('setCardGroups([])');
  });
});
