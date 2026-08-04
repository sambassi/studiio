import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { boxesFromRects, coversAll, clampToBox, type CardBox } from '@/lib/creer/dragPosition';
import { Preview } from '@/app/dashboard/creer-simple/AssistantWizard';

/**
 * Déplacement libre des cartes — Mode simple.
 *
 * Les règles de placement sont testées **sur des valeurs** (`boxesFromRects`,
 * `coversAll`, `clampToBox`) et le rendu **sur le DOM produit**. Une version
 * antérieure de ce fichier lisait le source du composant : six mutations
 * réelles y passaient inaperçues, dont la suppression pure et simple du
 * câblage — la fonctionnalité entière devenait du code mort sans un seul test
 * rouge.
 */

const host = { left: 100, top: 200, width: 400, height: 800 };
const carte = (id: string, top: number, naturalWidth = 400) => ({
  id,
  rect: { left: 100, top, width: 400, height: 80 },
  naturalWidth,
});

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
  title: {
    font: 'Inter', color: '#FFFFFF', scale: 1,
    bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1,
  },
  subtitle: { font: null, color: null, scale: 1 },
  cta: {
    font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1,
    bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2,
  },
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

const cartesDuDom = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-cards-grid] [data-card-id]'));

describe('Le rendu par défaut est exactement celui d avant', () => {
  it('sans emplacements, aucune carte n est positionnée', () => {
    // C'est la garantie de non-régression : le conteneur est photographié puis
    // blitté dans la vidéo, donc tout style de position injecté par défaut
    // changerait l'export de tous les montages.
    render(<Preview {...previewProps} />);
    const cartes = cartesDuDom();
    expect(cartes).toHaveLength(2);
    for (const el of cartes) {
      expect(el.style.position).toBe('');
      expect(el.style.left).toBe('');
      expect(el.style.top).toBe('');
      expect(el.style.width).toBe('');
      expect(el.style.height).toBe('');
    }
  });

  it('le conteneur garde sa colonne centrée tant que rien n est déplacé', () => {
    render(<Preview {...previewProps} />);
    const host = document.querySelector('[data-cards-grid]') as HTMLElement;
    expect(host.style.flexDirection).toBe('column');
    expect(host.style.justifyContent).toBe('center');
    expect(host.style.gap).not.toBe('');
  });

  it("un aperçu en lecture seule n'annonce pas un glissement impossible", () => {
    render(<Preview {...previewProps} />);
    for (const el of cartesDuDom()) {
      expect(el.getAttribute('title')).toBeNull();
      expect(el.style.cursor).toBe('');
      expect(el.style.touchAction).toBe('');
    }
  });
});

describe('Avec des emplacements, chaque carte est posée où on le demande', () => {
  const boxes: Record<string, CardBox> = {
    a: { x: 10, y: 20, w: 50, h: 9 },
    b: { x: 30, y: 60, w: 40, h: 9 },
  };

  it('les quatre coordonnées atterrissent sur le bon axe', () => {
    // Permuter `left` et `top` — ou lire `box.y` dans `left` — passait
    // inaperçu tant que le test se contentait de chercher « position:absolute »
    // dans le source.
    render(<Preview {...previewProps} cardBoxes={boxes} />);
    const [a, b] = cartesDuDom();
    expect(a.style.position).toBe('absolute');
    expect(a.style.left).toBe('10%');
    expect(a.style.top).toBe('20%');
    expect(a.style.width).toBe('50%');
    expect(a.style.height).toBe('9%');
    expect(b.style.left).toBe('30%');
    expect(b.style.top).toBe('60%');
    expect(b.style.width).toBe('40%');
  });

  it('le conteneur abandonne la colonne et son écart', () => {
    render(<Preview {...previewProps} cardBoxes={boxes} />);
    const host = document.querySelector('[data-cards-grid]') as HTMLElement;
    expect(host.style.flexDirection).not.toBe('column');
    expect(host.style.gap).toBe('');
  });

  it('la carte glissée se distingue des autres', () => {
    render(<Preview {...previewProps} cardBoxes={boxes} draggingCard="b" onCardDragStart={() => {}} />);
    const [a, b] = cartesDuDom();
    expect(b.style.outline).toContain('dashed');
    expect(b.style.cursor).toBe('grabbing');
    expect(b.style.zIndex).toBe('1');
    expect(a.style.outline).toBe('');
    expect(a.style.cursor).toBe('grab');
  });

  it('une carte sans emplacement reste en flux, même si d autres en ont un', () => {
    render(<Preview {...previewProps} cardBoxes={{ a: boxes.a }} />);
    const [, b] = cartesDuDom();
    expect(b.style.position).toBe('');
  });
});

describe('Le glissement est réellement branché', () => {
  it('un handler fourni rend chaque carte saisissable', () => {
    // Débrancher `onCardDragStart` au site d'appel rendait la fonctionnalité
    // entièrement morte sans casser un seul test.
    render(<Preview {...previewProps} onCardDragStart={() => {}} />);
    for (const el of cartesDuDom()) {
      expect(el.getAttribute('title')).toBe('Glisser pour déplacer la carte');
      expect(el.style.cursor).toBe('grab');
      expect(el.style.touchAction).toBe('none');
    }
  });

  it('le pointerdown remonte l identifiant de la carte saisie', () => {
    const vus: string[] = [];
    render(<Preview {...previewProps} onCardDragStart={(id) => vus.push(id)} />);
    const [a, b] = cartesDuDom();
    a.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(vus).toEqual(['a', 'b']);
  });

  it('la fin du glissement est écoutée sous ses trois formes', () => {
    const fins: string[] = [];
    render(<Preview {...previewProps} onCardDragStart={() => {}} onDragEnd={() => fins.push('fin')} />);
    const [a] = cartesDuDom();
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      a.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
    // Sans `lostpointercapture`, une capture volée laissait la carte collée au
    // curseur.
    expect(fins).toHaveLength(3);
  });
});

describe('boxesFromRects — la mesure de la disposition en flux', () => {
  it('convertit des rectangles écran en % du conteneur', () => {
    const out = boxesFromRects(host, [carte('a', 200), carte('b', 400)])!;
    expect(out.a).toEqual({ x: 0, y: 0, w: 100, h: 10 });
    expect(out.b).toEqual({ x: 0, y: 25, w: 100, h: 10 });
  });

  it('retient la largeur NATURELLE, pas la largeur étirée', () => {
    // En flux, `align-items: stretch` étire la carte à 100 % : garder cette
    // largeur bornerait `x` à la seule valeur 0, et le déplacement latéral
    // serait écrasé à chaque mouvement.
    const out = boxesFromRects(host, [{ ...carte('a', 200), naturalWidth: 240 }])!;
    expect(out.a.w).toBe(60);
    expect(clampToBox({ x: 90, y: 10 }, 'top-left', { width: out.a.w, height: out.a.h }).x).toBe(40);
  });

  it('une largeur naturelle plus grande que le conteneur est ramenée au cadre', () => {
    const out = boxesFromRects(host, [{ ...carte('a', 200), naturalWidth: 900 }])!;
    expect(out.a.w).toBe(100);
  });

  it('une largeur naturelle absente retombe sur la largeur mesurée', () => {
    const out = boxesFromRects(host, [{ ...carte('a', 200), naturalWidth: 0 }])!;
    expect(out.a.w).toBe(100);
  });

  it('un conteneur non mesuré ne produit aucun emplacement', () => {
    expect(boxesFromRects({ left: 0, top: 0, width: 0, height: 800 }, [carte('a', 0)])).toBeNull();
    expect(boxesFromRects({ left: 0, top: 0, width: 400, height: 0 }, [carte('a', 0)])).toBeNull();
  });

  it('une liste vide ne bascule pas en mode libre', () => {
    expect(boxesFromRects(host, [])).toBeNull();
  });

  it('les axes ne sont pas interchangeables', () => {
    // Le conteneur n'est pas carré : x et y n'ont pas le même diviseur.
    const out = boxesFromRects(host, [
      { id: 'a', rect: { left: 200, top: 400, width: 100, height: 80 }, naturalWidth: 100 },
    ])!;
    expect(out.a.x).toBe(25);
    expect(out.a.y).toBe(25);
    expect(out.a.w).toBe(25);
    expect(out.a.h).toBe(10);
  });
});

describe('coversAll — le mode libre ne vaut que s il couvre tout', () => {
  const boxes = { a: { x: 0, y: 0, w: 10, h: 10 }, b: { x: 0, y: 0, w: 10, h: 10 } };

  it('accepte une couverture complète', () => {
    expect(coversAll(boxes, ['a', 'b'])).toBe(true);
    expect(coversAll(boxes, ['a'])).toBe(true);
  });

  it('refuse dès qu une carte manque — le cas de la régénération', () => {
    expect(coversAll(boxes, ['a', 'c'])).toBe(false);
  });

  it('refuse une liste vide : [].every() vaut true et déclarerait valide un vide', () => {
    expect(coversAll(boxes, [])).toBe(false);
  });

  it('refuse l absence d emplacements', () => {
    expect(coversAll(null, ['a'])).toBe(false);
    expect(coversAll(undefined, ['a'])).toBe(false);
  });
});

describe('Le format fait partie de l état — sinon l export est écrasé', () => {
  const wizard = readFileSync(
    resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
    'utf-8',
  );

  it('les emplacements sont mémorisés AVEC leur format de mesure', () => {
    // `h` est un % de la hauteur du conteneur ; celle-ci suit la hauteur vidéo
    // alors que la taille des cartes suit la LARGEUR. Rejouer une mesure 9:16
    // en 16:9 écrase les cartes les unes sur les autres, à l'écran comme dans
    // la vidéo puisque ce bloc est photographié puis blitté.
    expect(wizard).toContain('interface FreeCards {');
    expect(wizard).toContain('function validFree(');
    expect(wizard).toContain("if (!f || f.format !== fmt) return false;");
    expect(wizard).toContain('validFree(cardBoxes, cardIds, format)');
  });

  it('un changement de format ou de contenu purge l état et le dit', () => {
    expect(wizard).toContain('if (cardBoxes && !validFree(cardBoxes, cardIds, format))');
    expect(wizard).toContain('setLayoutDropped(true)');
    expect(wizard).toContain('Disposition des cartes réinitialisée');
  });

  it('le câblage passe par l état VALIDE, jamais par l état brut', () => {
    expect(wizard).toContain('cardBoxes: effectiveCardBoxes,');
    expect(wizard).toContain('onCardDragStart={startCardDrag}');
    expect(wizard).toContain('draggingCard={draggingCard}');
  });
});

describe('Invariants du gestionnaire de glissement', () => {
  const wizard = readFileSync(
    resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
    'utf-8',
  );
  const startCardDrag = wizard.slice(
    wizard.indexOf('const startCardDrag'),
    wizard.indexOf('const moveDrag'),
  );
  const brancheCarte = wizard.slice(
    wizard.indexOf("if (drag.el === 'card')"),
    wizard.indexOf("const current = drag.el === 'title'"),
  );

  /*
   * Ces quatre invariants vivent dans les gestionnaires du composant parent,
   * qu'on ne peut pas monter seuls (3 800 lignes, appels réseau). Ils sont donc
   * vérifiés sur le source — un pis-aller assumé, et la raison pour laquelle
   * toute la GÉOMÉTRIE a été sortie dans `dragPosition.ts` où elle se teste sur
   * des valeurs.
   */

  it("l'écart de saisie est conservé : la carte ne se recentre pas sous le curseur", () => {
    // Calcule a l'ARMEMENT du glissement, depuis le point d'appui memorise —
    // le mode libre ne s'active qu'au premier mouvement franc.
    expect(brancheCarte).toContain(
      'grabOffset(drag.startX!, drag.startY!, rect, { x: start.x, y: start.y })',
    );
  });

  it('la branche « carte » se termine — sinon glisser une carte déplace le CTA', () => {
    expect(brancheCarte.trimEnd().endsWith('return;\n    }')).toBe(true);
  });

  it('une carte inconnue interrompt la prise au lieu de produire des NaN', () => {
    expect(brancheCarte).toContain('if (!measured || !start) {');
    expect(brancheCarte).toContain('releasePointerCapture');
    expect(brancheCarte).toContain('if (!boxes || !box) return;');
  });

  it("une capture refusée relâche le verrou de glissement", () => {
    // Sans cette remise à zéro, `if (dragRef.current) return;` bloquerait TOUT
    // glissement ultérieur jusqu'au rechargement de la page.
    const bloc = startCardDrag.slice(startCardDrag.indexOf('} catch {'));
    expect(bloc).toContain('dragRef.current = null;');
    expect(bloc).toContain('setDraggingCard(null);');
  });
});
