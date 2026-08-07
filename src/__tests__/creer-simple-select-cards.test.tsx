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

/**
 * ⚠️ LES TRANCHES DE SOURCE PARTENT DU CORPS DU WIZARD.
 *
 * `AssistantWizard.tsx` porte desormais PLUSIEURS composants — l'apercu de
 * l'Autopilote y declare ses propres `startDrag`, `moveDrag` et
 * `<FloatingPanel>`, PLUS HAUT dans le fichier. Un `indexOf` sans point de
 * depart trouvait donc les siens, la tranche devenait vide, et le test
 * echouait sur un fichier parfaitement correct. Pire : une tranche vide
 * comparee a du vide serait passee sur un fichier casse.
 */
const DEBUT_WIZARD = wizard.indexOf('export default function AssistantWizard()');


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

  it('une carte sélectionnée porte un trait plein contrasté', () => {
    // Blanc, et non l'accent : le fond du plateau EST le dégradé d'accent par
    // défaut, un liseré accent y serait invisible.
    render(<Preview {...previewProps} selectedCards={new Set(['b'])} />);
    const [a, b] = cartes();
    // Epaisseur exprimee en pixels ECRAN : le plateau est reduit a 25 %, un
    // « 2px » nu y deviendrait un demi-pixel.
    expect(b.style.outline).toBe('8px solid #FFFFFF');
    expect(b.style.boxShadow).toContain('rgba(0,0,0,0.5)');
    expect(b.style.outline).not.toContain(ACCENT);
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

  it('le vrai gestionnaire arrête la propagation AVANT tout retour anticipé', () => {
    // Un test qui fournirait son propre `onCardDragStart` avec un
    // `stopPropagation()` testerait son propre bouchon. Ce qui compte est que
    // le gestionnaire de production le fasse en TÊTE : sinon un multi-touch,
    // une capture refusée ou un aperçu non mesuré videraient la sélection —
    // y compris la carte en cours de glissement.
    const corps = wizard.slice(
      wizard.indexOf('const startCardDrag', DEBUT_WIZARD),
      wizard.indexOf('const startDrag', wizard.indexOf('const startCardDrag', DEBUT_WIZARD)),
    );
    const stop = corps.indexOf('e.stopPropagation();');
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(corps.indexOf('return;'));
    // Même exigence pour le titre et le CTA.
    const debutTitre = wizard.indexOf('const startDrag', DEBUT_WIZARD);
    const titre = wizard.slice(debutTitre, wizard.indexOf('const moveDrag', debutTitre));
    expect(titre.length).toBeGreaterThan(0);
    expect(titre.indexOf('e.stopPropagation();')).toBeLessThan(titre.indexOf('return;'));
  });

  it('la touche Échap est écoutée, mais pas au détriment des champs de saisie', () => {
    // Échap dans un champ appartient au champ : il ferme une liste déroulante,
    // annule une saisie. Le détourner viderait la sélection en pleine frappe.
    expect(wizard).toContain("if (e.key !== 'Escape') return;");
    expect(wizard).toContain("if (cible?.isContentEditable) return;");
    expect(wizard).toContain("/^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName)");
    expect(wizard).toContain("window.addEventListener('keydown', onKey)");
    expect(wizard).toContain("window.removeEventListener('keydown', onKey)");
  });
});

describe('Les liserés n atteignent JAMAIS la vidéo', () => {
  it('aucune aide d édition n est peinte pendant la capture', () => {
    render(
      <Preview
        {...previewProps}
        selectedCards={new Set(['a', 'b'])}
        draggingCard="a"
        capturing
      />,
    );
    for (const el of cartes()) {
      expect(el.style.outline).toBe('');
      expect(el.style.boxShadow).toBe('');
    }
  });

  it('le plateau devient inerte pendant la capture', () => {
    // Un vidage d'état ne suffisait pas : entre lui et `domToCanvas` il y a un
    // import dynamique et l'attente des polices, pendant lesquels l'aperçu
    // restait cliquable — un clic y reposait la sélection juste à temps pour
    // qu'elle soit gravée dans le montage.
    let vides = 0;
    const { container } = render(
      <Preview {...previewProps} selectedCards={new Set(['a'])} capturing onClearSelection={() => { vides += 1; }} />,
    );
    const plateau = container.querySelector('[style*="scale"]') as HTMLElement;
    expect(plateau.style.pointerEvents).toBe('none');
    plateau.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(vides).toBe(0);
  });

  it('le drapeau tient pour TOUTE la durée de la capture', () => {
    const debut = wizard.indexOf('flushSync(() => setCapturing(true))');
    const capture = wizard.indexOf('const canvas = await domToCanvas');
    const fin = wizard.indexOf('setCapturing(false)');
    expect(debut).toBeGreaterThan(0);
    expect(debut).toBeLessThan(capture);
    expect(fin).toBeGreaterThan(capture);
    // Dans le `finally` : rendu même si la capture échoue.
    const finallyBloc = wizard.slice(wizard.indexOf('} finally {', capture));
    expect(finallyBloc.slice(0, 400)).toContain('setCapturing(false)');
  });

  it("la sélection n'est ni enregistrée dans le brouillon ni écrite dans les métadonnées", () => {
    // C'est une intention d'édition, pas une propriété du montage.
    expect(wizard).not.toContain('selectedCards:');
    expect(wizard).not.toContain('selection:');
  });
});

describe('Le câblage ne peut pas disparaître en silence', () => {
  it('les deux props de sélection sont bien passées à l aperçu', () => {
    // Remplacer `selectedCards={selectedCards}` par un Set vide rendait la
    // fonctionnalité entièrement morte sans un seul test rouge.
    expect(wizard).toContain('selectedCards,');
    expect(wizard).toContain('onClearSelection={clearSelection}');
    expect(wizard).toContain('capturing,');
  });

  it('le seuil de glissement est mesuré sur le VRAI déplacement', () => {
    // `const dx = 0` figeait le seuil et le glissement ne démarrait jamais.
    expect(wizard).toContain('const dx = e.clientX - (drag.startX ?? e.clientX);');
    expect(wizard).toContain('const dy = e.clientY - (drag.startY ?? e.clientY);');
  });
});

describe('Cliquer sélectionne, glisser déplace', () => {
  const debutCarte = wizard.indexOf('const startCardDrag', DEBUT_WIZARD);
  const startCardDrag = wizard.slice(
    debutCarte,
    wizard.indexOf('const startDrag', debutCarte),
  );
  const moveCarte = wizard.slice(
    wizard.indexOf("if (drag.el === 'card')", DEBUT_WIZARD),
    wizard.indexOf("const current = drag.el === 'title'", DEBUT_WIZARD),
  );

  it('les tranches de source ne sont pas vides', () => {
    // Sans ce garde, une tranche vide comparee a du vide PASSERAIT sur un
    // fichier casse — c'est ce qui a failli arriver quand un second composant
    // du fichier a declare ses propres `startDrag` / `moveDrag`.
    expect(startCardDrag.length).toBeGreaterThan(0);
    expect(moveCarte.length).toBeGreaterThan(0);
  });

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

  it('Maj, Cmd et Ctrl passent la règle en mode additif', () => {
    // La règle elle-même est testée sur valeurs dans
    // `creer-simple-selection-rules.test.ts` ; ici on vérifie seulement quels
    // modificateurs l'activent.
    expect(startCardDrag).toContain(
      'nextSelection(prev, id, e.shiftKey || e.metaKey || e.ctrlKey)',
    );
  });

  it('un clic droit ne sélectionne ni ne saisit', () => {
    expect(startCardDrag).toContain('if (e.button !== 0 || !e.isPrimary) return;');
  });
});

describe('Une sélection ne survit pas à son objet', () => {
  it('les cartes disparues sont retirées de la sélection', () => {
    // La règle est testée sur valeurs dans `creer-simple-selection-rules`.
    expect(wizard).toContain('setSelectedCards((prev) => pruneSelection(prev, cardIds));');
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
