import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Preview } from '@/app/dashboard/creer-simple/AssistantWizard';
import { clampToBox } from '@/lib/creer/dragPosition';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';
import { ICON_LIBRARY, ICON_KEYWORDS, iconMatches, ALL_LUCIDE_NAMES } from '@/lib/icons/library';

/**
 * Éléments libres — Mode simple.
 *
 * La contrainte qui commande tout le reste : en Mode simple, la vidéo est
 * fabriquée en **photographiant le conteneur des cartes** (`[data-cards-grid]`,
 * encart `8 % / 8 % / 30 % / 22 %`), pas le plateau entier. Un élément posé
 * ailleurs serait visible dans l'aperçu et **absent du montage**.
 *
 * Les éléments sont donc rendus DANS ce conteneur, et leurs coordonnées sont
 * en pourcentage de lui.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const generated = {
  title: 'Routine matin',
  subtitle: 'Sous-titre',
  cards: [{ id: 'a', icon: 'Flame', title: 'Matin', description: '', value: '70%' }],
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
};
const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  subtitle: { font: null, color: null, scale: 1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
};
const props = {
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
const elements = [
  { id: 'e1', iconName: 'Sparkles', x: 30, y: 40, size: 64, color: '#7C3AED' },
  { id: 'e2', iconName: 'Heart', x: 70, y: 60, size: 48, color: '#EC4899' },
];

afterEach(cleanup);

const poses = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-free-element]'));

describe('Les éléments vivent DANS la zone photographiée', () => {
  it('ils sont rendus à l intérieur du conteneur des cartes', () => {
    // C'est ce conteneur qui est photographié puis blitté : un élément rendu
    // sur le plateau serait à l'aperçu et pas dans la vidéo.
    render(<Preview {...props} elements={elements} />);
    const host = document.querySelector('[data-cards-grid]')!;
    expect(poses()).toHaveLength(2);
    for (const el of poses()) expect(host.contains(el)).toBe(true);
  });

  it('leurs coordonnées sont posées telles quelles, centrées', () => {
    render(<Preview {...props} elements={elements} />);
    const [a, b] = poses();
    expect(a.style.left).toBe('30%');
    expect(a.style.top).toBe('40%');
    expect(a.style.transform).toBe('translate(-50%, -50%)');
    expect(b.style.left).toBe('70%');
    expect(b.style.top).toBe('60%');
  });

  it('chaque élément rend une icône lucide, jamais un emoji', () => {
    render(<Preview {...props} elements={elements} />);
    for (const el of poses()) expect(el.querySelector('svg')).not.toBeNull();
    expect(wizard).toContain('<CardIcon name={el.iconName}');
  });

  it('ils passent au-dessus des cartes', () => {
    // Un élément déposé sur une carte doit rester saisissable.
    render(<Preview {...props} elements={elements} />);
    expect(poses()[0].style.zIndex).toBe('3');
  });
});

describe('Default-safe : sans élément, rien ne change', () => {
  it('aucun nœud n est rendu quand la liste est absente', () => {
    render(<Preview {...props} />);
    expect(poses()).toHaveLength(0);
  });

  it('une liste vide se comporte comme une liste absente', () => {
    render(<Preview {...props} elements={[]} />);
    expect(poses()).toHaveLength(0);
  });

  it("un aperçu en lecture seule n'annonce pas un glissement impossible", () => {
    render(<Preview {...props} elements={elements} />);
    for (const el of poses()) {
      expect(el.getAttribute('title')).toBeNull();
      expect(el.style.cursor).toBe('');
      expect(el.style.touchAction).toBe('');
    }
  });
});

describe('Les aides d édition n atteignent jamais la vidéo', () => {
  it('le liseré de sélection disparaît pendant la capture', () => {
    render(<Preview {...props} elements={elements} selectedElementId="e1" capturing />);
    expect(poses()[0].style.outline).toBe('');
  });

  it('le bouton de suppression aussi', () => {
    render(
      <Preview {...props} elements={elements} selectedElementId="e1" onElementDelete={() => {}} capturing />,
    );
    expect(poses()[0].querySelector('button')).toBeNull();
  });

  it('hors capture, l élément retenu est cerclé et supprimable', () => {
    render(
      <Preview {...props} elements={elements} selectedElementId="e1" onElementDelete={() => {}} />,
    );
    const [a, b] = poses();
    expect(a.style.outline).toContain('solid');
    expect(a.querySelector('button')).not.toBeNull();
    // Et lui seul.
    expect(b.style.outline).toBe('');
    expect(b.querySelector('button')).toBeNull();
  });

  it('la suppression remonte l identifiant, sans déclencher le glissement', () => {
    const supprimes: string[] = [];
    render(
      <Preview
        {...props}
        elements={elements}
        selectedElementId="e1"
        onElementDelete={(id) => supprimes.push(id)}
        onElementDragStart={() => supprimes.push('DRAG')}
      />,
    );
    poses()[0].querySelector('button')!.click();
    expect(supprimes).toEqual(['e1']);
  });
});

describe('Le glissement est branché', () => {
  it('un handler fourni rend l élément saisissable', () => {
    render(<Preview {...props} elements={elements} onElementDragStart={() => {}} />);
    for (const el of poses()) {
      expect(el.getAttribute('title')).toBe('Glisser pour déplacer l’élément');
      expect(el.style.cursor).toBe('grab');
      expect(el.style.touchAction).toBe('none');
    }
  });

  it('le pointerdown remonte l identifiant', () => {
    const vus: string[] = [];
    render(<Preview {...props} elements={elements} onElementDragStart={(id) => vus.push(id)} />);
    for (const el of poses()) el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(vus).toEqual(['e1', 'e2']);
  });

  it('la fin du glissement est écoutée sous ses trois formes', () => {
    const fins: string[] = [];
    render(
      <Preview {...props} elements={elements} onElementDragStart={() => {}} onDragEnd={() => fins.push('fin')} />,
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      poses()[0].dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
    expect(fins).toHaveLength(3);
  });
});

describe('Bornage : ancrage au CENTRE', () => {
  const box = { width: 20, height: 12 };

  it('l élément ne sort pas du conteneur, ni d un côté ni de l autre', () => {
    // x ET y désignent le centre : les deux demi-côtés doivent tenir.
    expect(clampToBox({ x: 0, y: 0 }, 'center', box)).toEqual({ x: 10, y: 6 });
    expect(clampToBox({ x: 100, y: 100 }, 'center', box)).toEqual({ x: 90, y: 94 });
  });

  it('laisse inchangée une position déjà valide', () => {
    expect(clampToBox({ x: 50, y: 50 }, 'center', box)).toEqual({ x: 50, y: 50 });
  });

  it('un élément plus grand que le conteneur ne produit pas de borne inversée', () => {
    const p = clampToBox({ x: 50, y: 50 }, 'center', { width: 140, height: 200 });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it('le glissement se borne bien au conteneur des cartes', () => {
    expect(wizard).toContain("(drag?.el === 'card' || drag?.el === 'element' ? cardsRef : previewRef)");
    expect(wizard).toContain("clampToBox(raw, 'center', drag.box)");
  });
});

describe('La bibliothèque est partagée, pas dupliquée', () => {
  it('les 24 catégories vivent dans un module commun', () => {
    // Les dupliquer aurait fait une source de vérité de plus : le dépôt en
    // compte déjà deux pour les icônes (`ICON_MAP` et `CARD_ICON_MAP`).
    expect(Object.keys(ICON_LIBRARY).length).toBeGreaterThanOrEqual(20);
    expect(ALL_LUCIDE_NAMES.length).toBeGreaterThan(150);
    expect(wizard).toContain("from '@/lib/icons/library'");
  });

  it("l'éditeur avancé importe le même module au lieu de sa copie", () => {
    const avance = readFileSync(
      resolve(__dirname, '../app/dashboard/creer/page.tsx'),
      'utf-8',
    );
    expect(avance).toContain('from "@/lib/icons/library"');
    expect(avance).not.toContain('const ICON_LIBRARY: Record<string, string[]> = {');
  });

  it('la recherche accepte le nom lucide ET le synonyme français', () => {
    expect(iconMatches('Dumbbell', 'dumb')).toBe(true);
    expect(iconMatches('Dumbbell', ICON_KEYWORDS.Dumbbell?.[0] ?? 'haltère')).toBe(true);
    expect(iconMatches('Dumbbell', 'zzzz')).toBe(false);
  });

  it('une recherche vide laisse tout passer', () => {
    expect(iconMatches('Heart', '')).toBe(true);
    expect(iconMatches('Heart', '   ')).toBe(true);
  });

  it('la recherche ignore la casse', () => {
    expect(iconMatches('Heart', 'HEART')).toBe(true);
  });
});

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
const bon = { id: 'e1', iconName: 'Sparkles', x: 30, y: 40, size: 64, color: '#7C3AED' };

describe('Persistance des éléments', () => {
  it('un brouillon sans éléments se relit comme avant', () => {
    expect(lire({}).elements).toBeUndefined();
  });

  it('relit un élément valide tel quel', () => {
    expect(lire({ elements: [bon] }).elements).toEqual([bon]);
  });

  it('un élément abîmé n emporte pas les autres', () => {
    // Contrairement aux emplacements des cartes, les éléments sont
    // indépendants : en perdre un vaut mieux que de tous les perdre.
    const d = lire({ elements: [bon, { ...bon, id: 'e2', x: 999 }, { ...bon, id: 'e3' }] });
    expect(d.elements!.map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  it('refuse une taille absurde plutôt qu un aplat sur tout le cadre', () => {
    for (const size of [0, -5, 5000, Number.NaN, '64']) {
      expect(lire({ elements: [{ ...bon, size }] }).elements, String(size)).toBeUndefined();
    }
  });

  it('une couleur invalide retombe sur le blanc au lieu de faire disparaître l élément', () => {
    expect(lire({ elements: [{ ...bon, color: 'rouge' }] }).elements![0].color).toBe('#FFFFFF');
  });

  it('refuse une entrée sans identifiant ni nom d icône', () => {
    expect(lire({ elements: [{ ...bon, id: '' }] }).elements).toBeUndefined();
    expect(lire({ elements: [{ ...bon, iconName: '' }] }).elements).toBeUndefined();
  });

  it('borne le nombre d éléments relus', () => {
    const trop = Array.from({ length: 40 }, (_, i) => ({ ...bon, id: `e${i}` }));
    expect(lire({ elements: trop }).elements).toHaveLength(24);
  });

  it('refuse une forme qui n est pas une liste', () => {
    for (const v of [null, 'nope', 42, {}]) {
      expect(lire({ elements: v }).elements, JSON.stringify(v)).toBeUndefined();
    }
  });

  it('les éléments survivent à une régénération du contenu', () => {
    // Ils ne dépendent d'aucune carte, contrairement aux groupes et aux
    // emplacements libres.
    const d = lire({ elements: [bon] });
    expect(d.elements).toHaveLength(1);
    expect(d.cardBoxes).toBeUndefined();
  });
});

describe('Câblage', () => {
  it("l'aperçu reçoit les éléments et leurs actions", () => {
    expect(wizard).toContain('elements={freeElements}');
    expect(wizard).toContain('onElementDragStart={startElementDrag}');
    expect(wizard).toContain('onElementDelete={deleteElement}');
    expect(wizard).toContain('selectedElementId={selectedElementId}');
  });

  it('le brouillon écrit et relit les éléments', () => {
    expect(wizard).toContain('elements: freeElements.length ? freeElements : undefined');
    expect(wizard).toContain('if (draft.elements) setFreeElements(draft.elements);');
  });

  it('les métadonnées du post les portent aussi', () => {
    expect(wizard).toContain('elements: freeElements,');
  });

  it("l'élément est posé au centre de la zone photographiée", () => {
    expect(wizard).toContain('x: 50,');
    expect(wizard).toContain('const ELEMENT_SIZE_RATIO = 64 / 330;');
  });

  it('un nouveau montage repart sans élément', () => {
    const reset = wizard.slice(wizard.indexOf('const reset = ()'), wizard.indexOf('const reset = ()') + 1000);
    expect(reset).toContain('setFreeElements([])');
  });
});
