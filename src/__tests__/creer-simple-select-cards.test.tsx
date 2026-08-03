import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Preview } from '@/app/dashboard/creer-simple/AssistantWizard';

/**
 * Sélection des cartes — Mode simple.
 *
 * Deux exigences dominent tout le reste :
 *
 * 1. **La sélection ne doit jamais atteindre la vidéo.** Le conteneur des
 *    cartes est photographié (`modern-screenshot`) puis blitté par le
 *    compositeur : un liseré resté à l'écran au moment de la capture se
 *    retrouverait gravé dans le montage.
 * 2. **Cliquer n'est pas glisser.** Le mode libre restructure la disposition ;
 *    l'activer sur un simple clic ferait rétrécir toutes les cartes à chaque
 *    tentative de sélection.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

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

const ACCENT = '#7C3AED';
const previewProps = {
  generated,
  format: '9:16' as const,
  displayScale: 0.25,
  activeOrder: ['intro', 'cards', 'cta'],
  gradStart: '#7C3AED',
  gradEnd: '#EC4899',
  gradientOpacity: 0.5,
  accent: ACCENT,
  watermark: 'Studiio.pro',
  text: TEXT,
};

afterEach(cleanup);

const cartes = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-cards-grid] [data-card-id]'));

describe('Le liseré ne paraît que si on le demande', () => {
  it('sans sélection, aucune carte n est cerclée', () => {
    render(<Preview {...previewProps} />);
    for (const el of cartes()) expect(el.style.outline).toBe('');
  });

  it('une carte sélectionnée porte un trait plein à l accent', () => {
    render(<Preview {...previewProps} selectedCards={new Set(['b'])} />);
    const [a, b] = cartes();
    expect(b.style.outline).toBe(`2px solid ${ACCENT}`);
    expect(a.style.outline).toBe('');
  });

  it('plusieurs cartes peuvent l être en même temps', () => {
    render(<Preview {...previewProps} selectedCards={new Set(['a', 'b'])} />);
    for (const el of cartes()) expect(el.style.outline).toContain('solid');
  });

  it('le glissement l emporte sur la sélection — on doit voir ce qu on tient', () => {
    // Trait plein « retenue » et pointillé « je la tiens » ne doivent pas se
    // superposer en un seul liseré illisible.
    render(<Preview {...previewProps} selectedCards={new Set(['a'])} draggingCard="a" />);
    expect(cartes()[0].style.outline).toContain('dashed');
  });

  it("une sélection vide se comporte comme pas de sélection", () => {
    render(<Preview {...previewProps} selectedCards={new Set()} />);
    for (const el of cartes()) expect(el.style.outline).toBe('');
  });
});

describe('Désélectionner', () => {
  it('un appui dans le vide du plateau désélectionne', () => {
    let vides = 0;
    const { container } = render(
      <Preview {...previewProps} selectedCards={new Set(['a'])} onClearSelection={() => { vides += 1; }} />,
    );
    const plateau = container.querySelector('[style*="scale"]') as HTMLElement;
    plateau.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(vides).toBe(1);
  });

  it('un appui sur une carte ne compte pas comme un appui dans le vide', () => {
    // Les cartes arrêtent la propagation ; sans cela, sélectionner
    // déclencherait aussitôt la désélection.
    let vides = 0;
    render(
      <Preview
        {...previewProps}
        selectedCards={new Set(['a'])}
        onCardDragStart={(_id, e) => e.stopPropagation()}
        onClearSelection={() => { vides += 1; }}
      />,
    );
    cartes()[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(vides).toBe(0);
  });

  it('la touche Échap est écoutée', () => {
    expect(wizard).toContain("if (e.key === 'Escape') clearSelection();");
    expect(wizard).toContain("window.addEventListener('keydown', onKey)");
    expect(wizard).toContain("window.removeEventListener('keydown', onKey)");
  });
});

describe('La sélection n atteint JAMAIS la vidéo', () => {
  it('elle est vidée avant la photo des cartes, avec flushSync', () => {
    // `flushSync` et non un `setState` ordinaire : la capture part dans la
    // même tâche, le rendu doit donc être déjà appliqué.
    expect(wizard).toContain('const selectionBeforeCapture = selectedCards;');
    expect(wizard).toContain(
      'if (selectionBeforeCapture.size > 0) flushSync(() => setSelectedCards(new Set()));',
    );
    const capture = wizard.indexOf('const canvas = await domToCanvas');
    const vidage = wizard.indexOf('flushSync(() => setSelectedCards(new Set()))');
    expect(vidage).toBeGreaterThan(0);
    expect(vidage).toBeLessThan(capture);
  });

  it('elle est rendue à l utilisateur même si la capture échoue', () => {
    const finallyBloc = wizard.slice(wizard.indexOf('} finally {', wizard.indexOf('domToCanvas')));
    expect(finallyBloc.slice(0, 400)).toContain('setSelectedCards(selectionBeforeCapture)');
  });

  it("elle n'est ni enregistrée dans le brouillon ni écrite dans les métadonnées", () => {
    // C'est une intention d'édition, pas une propriété du montage.
    expect(wizard).not.toContain('selectedCards:');
    expect(wizard).not.toContain('selection:');
  });
});

describe('Cliquer sélectionne, glisser déplace', () => {
  const startCardDrag = wizard.slice(
    wizard.indexOf('const startCardDrag'),
    wizard.indexOf('const startDrag'),
  );
  const moveCarte = wizard.slice(
    wizard.indexOf("if (drag.el === 'card')"),
    wizard.indexOf("const current = drag.el === 'title'"),
  );

  it('un simple appui ne bascule PAS en mode libre', () => {
    // Le mode libre fait rétrécir les cartes à leur largeur naturelle : le
    // déclencher au clic rendrait la sélection visuellement brutale.
    expect(startCardDrag).not.toContain('measureCards()');
    expect(startCardDrag).not.toContain('setCardBoxes(');
    expect(startCardDrag).toContain('armed: false');
  });

  it('le mode libre s arme au premier mouvement franc, au-delà d un seuil', () => {
    expect(moveCarte).toContain('if (!drag.armed)');
    expect(moveCarte).toContain('Math.hypot(dx, dy) < DRAG_THRESHOLD_PX');
    expect(moveCarte).toContain('drag.armed = true;');
    expect(wizard).toContain('const DRAG_THRESHOLD_PX = 4;');
  });

  it("l'écart de saisie part du point d'APPUI, pas du seuil franchi", () => {
    // Sinon la carte saute de quelques pixels à l'instant où le glissement
    // commence.
    expect(moveCarte).toContain(
      'grabOffset(drag.startX!, drag.startY!, rect, { x: start.x, y: start.y })',
    );
  });

  it('Maj, Cmd et Ctrl ajoutent ou retirent de la sélection', () => {
    expect(startCardDrag).toContain('e.shiftKey || e.metaKey || e.ctrlKey');
    expect(startCardDrag).toContain('if (next.has(id)) next.delete(id);');
  });

  it('un clic simple sur une carte déjà retenue conserve le lot', () => {
    // Sans cela, saisir une carte d'un ensemble le déferait dès l'appui — et
    // déplacer un groupe deviendrait impossible.
    expect(startCardDrag).toContain('if (prev.has(id)) return prev;');
    expect(startCardDrag).toContain('return new Set([id]);');
  });
});

describe('Une sélection ne survit pas à son objet', () => {
  it('les cartes disparues sont retirées de la sélection', () => {
    expect(wizard).toContain('const kept = new Set([...prev].filter((id) => cardIds.includes(id)));');
    // Référence conservée si rien ne change : sinon l'effet se redéclencherait
    // en boucle à chaque rendu.
    expect(wizard).toContain('return kept.size === prev.size ? prev : kept;');
  });

  it('un nouveau montage et un rétablissement repartent sans sélection', () => {
    const reset = wizard.slice(wizard.indexOf('const reset = ()'), wizard.indexOf('const reset = ()') + 800);
    expect(reset).toContain('setSelectedCards(new Set())');
    const resetLayout = wizard.slice(
      wizard.indexOf('const resetLayout'),
      wizard.indexOf('const resetLayout') + 400,
    );
    expect(resetLayout).toContain('setSelectedCards(new Set())');
  });
});
