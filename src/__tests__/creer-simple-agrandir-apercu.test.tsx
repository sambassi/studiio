import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import FloatingPanel from '@/components/ui/FloatingPanel';
import { Preview } from '@/app/dashboard/creer-simple/AssistantWizard';

/**
 * « Agrandir » — l'aperçu dans une fenêtre déplaçable et redimensionnable.
 *
 * Deux exigences se tiennent, et la seconde est la moins évidente :
 *
 * 1. **Default-safe des deux côtés.** La fenêtre est fermée tant qu'on ne
 *    l'ouvre pas, et `FloatingPanel` — utilisé par une douzaine de panneaux de
 *    l'éditeur avancé — garde exactement son comportement quand on ne demande
 *    ni redimensionnement ni maintien à l'ouverture.
 *
 * 2. **La fenêtre est un MIROIR, pas un second éditeur.** `previewRef`,
 *    `cardsRef` et `frameRef` ne sont pas de simples accessoires : ils
 *    désignent le nœud que `downloadPoster` photographie et celui dont la
 *    photo est blittée dans la vidéo par le compositeur. Deux `Preview` qui
 *    les partageraient laisseraient gagner le dernier monté — la vidéo
 *    exportée montrerait alors le contenu de la fenêtre flottante. La
 *    synchronisation passe donc par les ÉTATS, jamais par les refs.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);
const panel = readFileSync(resolve(__dirname, '../components/ui/FloatingPanel.tsx'), 'utf-8');

afterEach(cleanup);

const corps = () => document.querySelector('[data-panel-body]') as HTMLElement;
const poignee = () => document.querySelector('[data-panel-resize]') as HTMLElement | null;
const cadre = () => document.querySelector('[data-panel-body]')!.parentElement as HTMLElement;

describe('FloatingPanel — les panneaux existants ne bougent pas', () => {
  it('sans demande, aucune poignée de redimensionnement', () => {
    render(
      <FloatingPanel title="Élément" isOpen onClose={() => {}}>
        <p>contenu</p>
      </FloatingPanel>,
    );
    expect(poignee()).toBeNull();
  });

  it('sans demande, le corps garde sa borne à 60 % de la hauteur d écran', () => {
    render(
      <FloatingPanel title="Élément" isOpen onClose={() => {}}>
        <p>contenu</p>
      </FloatingPanel>,
    );
    expect(corps().className).toContain('max-h-[60vh]');
    expect(corps().className).not.toContain('flex-1');
  });

  it('sans demande, la largeur reste contrainte à 220-300 px', () => {
    render(
      <FloatingPanel title="Élément" isOpen onClose={() => {}}>
        <p>contenu</p>
      </FloatingPanel>,
    );
    expect(cadre().style.maxWidth).toBe('300px');
    expect(cadre().style.width).toBe('');
  });

  it('sans demande, un clic extérieur ferme toujours', async () => {
    const onClose = vi.fn();
    render(
      <FloatingPanel title="Élément" isOpen onClose={onClose}>
        <p>contenu</p>
      </FloatingPanel>,
    );
    // L'écouteur n'est posé qu'après 50 ms, pour ne pas se fermer sur le clic
    // qui vient de l'ouvrir.
    await new Promise((r) => setTimeout(r, 80));
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('FloatingPanel — la fenêtre redimensionnable', () => {
  const ouvrir = (props: Record<string, unknown> = {}) =>
    render(
      <FloatingPanel
        title="Aperçu"
        isOpen
        onClose={() => {}}
        resizable
        initialX={0}
        initialY={0}
        initialWidth={300}
        initialHeight={300}
        {...props}
      >
        <p>contenu</p>
      </FloatingPanel>,
    );

  it('la poignée de coin existe et se dit', () => {
    ouvrir();
    const p = poignee()!;
    expect(p).not.toBeNull();
    expect(p.getAttribute('aria-label')).toBe('Redimensionner la fenêtre');
    expect(p.className).toContain('cursor-nwse-resize');
  });

  it('la taille de départ est celle demandée', () => {
    ouvrir();
    expect(cadre().style.width).toBe('300px');
    expect(cadre().style.height).toBe('300px');
  });

  it('tirer la poignée agrandit la fenêtre', () => {
    ouvrir();
    fireEvent.mouseDown(poignee()!, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 420, clientY: 380 });
    expect(cadre().style.width).toBe('420px');
    expect(cadre().style.height).toBe('380px');
  });

  it('la fenêtre ne se réduit pas jusqu à disparaître', () => {
    ouvrir();
    fireEvent.mouseDown(poignee()!, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: -900, clientY: -900 });
    expect(parseFloat(cadre().style.width)).toBe(240);
    expect(parseFloat(cadre().style.height)).toBe(200);
  });

  it('la poignée ne peut pas sortir de l écran', () => {
    // Sinon elle deviendrait impossible à reprendre : la fenêtre resterait
    // géante sans aucun moyen de la réduire à la souris.
    ouvrir();
    fireEvent.mouseDown(poignee()!, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 99999, clientY: 99999 });
    expect(parseFloat(cadre().style.width)).toBeLessThanOrEqual(window.innerWidth);
    expect(parseFloat(cadre().style.height)).toBeLessThanOrEqual(window.innerHeight);
  });

  it('tirer la poignée redimensionne — cela ne DÉPLACE pas la fenêtre', () => {
    // Le geste part du cadre, hors du corps : sans garde explicite, il serait
    // pris pour une prise d'en-tête et la fenêtre suivrait le curseur.
    ouvrir();
    const conteneur = cadre().parentElement as HTMLElement;
    fireEvent.mouseDown(poignee()!, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 500 });
    expect(conteneur.style.left).toBe('0px');
    expect(conteneur.style.top).toBe('0px');
  });

  it('le relâchement arrête le suivi du curseur', () => {
    ouvrir();
    fireEvent.mouseDown(poignee()!, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 400 });
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 800, clientY: 800 });
    expect(cadre().style.width).toBe('400px');
  });

  it('le corps occupe la hauteur restante, sans borne à 60 vh', () => {
    ouvrir();
    expect(corps().className).toContain('flex-1');
    expect(corps().className).not.toContain('max-h-[60vh]');
  });

  it('on peut la garder ouverte pendant qu on agit ailleurs', async () => {
    const onClose = vi.fn();
    ouvrir({ closeOnClickOutside: false, onClose });
    await new Promise((r) => setTimeout(r, 80));
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('la géométrie est rapportée à la FIN du geste, pas à chaque frame', () => {
    const onGeometryChange = vi.fn();
    ouvrir({ onGeometryChange });
    onGeometryChange.mockClear();
    fireEvent.mouseDown(poignee()!, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 400 });
    fireEvent.mouseMove(window, { clientX: 420, clientY: 410 });
    // Pendant le geste : rien — sinon le localStorage serait écrit des
    // dizaines de fois par seconde.
    expect(onGeometryChange).not.toHaveBeenCalled();
    fireEvent.mouseUp(window);
    expect(onGeometryChange).toHaveBeenCalledWith({ x: 0, y: 0, w: 420, h: 410 });
  });

  it('aucune transition pendant le geste — elle transformerait le suivi en glissade', () => {
    ouvrir();
    const conteneur = cadre().parentElement as HTMLElement;
    expect(conteneur.className).toContain('transition-all');
    fireEvent.mouseDown(poignee()!, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 400 });
    expect(conteneur.className).not.toContain('transition-all');
  });
});

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

describe('Preview — l en-tête est masquable', () => {
  it('par défaut, l en-tête « Aperçu » est là', () => {
    render(<Preview {...props} />);
    expect(screen.getByText('Aperçu')).toBeTruthy();
  });

  it('masqué, il disparaît — la barre de la fenêtre porte déjà ce titre', () => {
    render(<Preview {...props} hideHeader />);
    expect(screen.queryByText('Aperçu')).toBeNull();
  });

  it('masquer l en-tête ne touche pas aux onglets', () => {
    render(<Preview {...props} hideHeader onFocusChange={() => {}} />);
    expect(document.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
  });
});


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

/** Le bloc JSX de la fenêtre flottante, isolé du reste du fichier. */
const debutFenetre = wizard.indexOf('<FloatingPanel', DEBUT_WIZARD);
const fenetre = wizard.slice(debutFenetre, wizard.indexOf('</FloatingPanel>', debutFenetre));

describe('La fenêtre est un MIROIR, pas un second éditeur', () => {
  it('elle ne reçoit AUCUNE des refs de l aperçu principal', () => {
    // C'est l'invariant central : `previewRef` désigne le nœud photographié
    // par « Télécharger l'affiche », `cardsRef` celui dont la photo part dans
    // la vidéo. Partagés, le dernier monté gagnerait — donc la fenêtre.
    for (const ref of ['previewRef={previewRef}', 'cardsRef={cardsRef}', 'frameRef={frameRef}']) {
      expect(fenetre, ref).not.toContain(ref);
    }
  });

  it('elle mesure son propre cadre', () => {
    expect(fenetre).toContain('frameRef={enlargedFrameRef}');
    expect(fenetre).toContain('displayScale={enlargedScale}');
  });

  it('les poignées d édition restent sur le seul aperçu principal', () => {
    for (const poigneeEdition of [
      'onCardDragStart',
      'onElementDragStart',
      'onElementResizeStart',
      'onPosterPanStart',
      'onPhotoDrop',
      'onDragStart',
    ]) {
      expect(fenetre, poigneeEdition).not.toContain(poigneeEdition);
    }
  });

  it('un seul objet de props nourrit les DEUX aperçus', () => {
    // Deux listes recopiées divergeraient à la première évolution.
    expect(wizard).toContain('const previewShared = {');
    expect(wizard.split('{...previewShared}').length - 1).toBe(2);
  });

  it('ses onglets pilotent l état partagé — ils marchent des deux côtés', () => {
    expect(fenetre).toContain('onFocusChange={setPreviewFocus}');
    expect(wizard).toContain('focus: previewFocus,');
  });

  it('l aperçu principal garde toutes ses refs', () => {
    const principal = wizard.slice(wizard.indexOf('<Preview\n          {...previewShared}', DEBUT_WIZARD));
    expect(principal.slice(0, 900)).toContain('previewRef={previewRef}');
    expect(principal.slice(0, 900)).toContain('cardsRef={cardsRef}');
    expect(principal.slice(0, 900)).toContain('frameRef={frameRef}');
  });
});

describe('Le bouton et la fenêtre', () => {
  it('fermée par défaut : ne rien faire ne change rien', () => {
    expect(wizard).toContain('const [enlargedOpen, setEnlargedOpen] = useState(false);');
  });

  it('le bouton bascule, et n apparaît qu avec un contenu à montrer', () => {
    expect(wizard).toContain('onClick={() => setEnlargedOpen((v) => !v)}');
    expect(wizard).toContain("enlargedOpen ? 'Fermer la fenêtre' : 'Agrandir'");
    expect(fenetre).toContain('isOpen={enlargedOpen && !!generated}');
  });

  it('une icône lucide, jamais un emoji', () => {
    expect(wizard).toContain('<Maximize2 className="w-3.5 h-3.5" />');
  });

  it('elle reste ouverte pendant qu on règle les couleurs à gauche', () => {
    // Sans cela, le premier clic dans le panneau de réglages la refermerait —
    // et elle ne servirait plus à rien.
    expect(fenetre).toContain('closeOnClickOutside={false}');
  });

  it('elle est déplaçable et redimensionnable', () => {
    expect(fenetre).toContain('resizable');
    expect(fenetre).toContain('initialWidth={enlargedGeometry.w}');
    expect(fenetre).toContain('initialHeight={enlargedGeometry.h}');
  });
});

describe('Le plateau tient dans la fenêtre', () => {
  it('il est borné sur les DEUX dimensions, pas seulement la largeur', () => {
    // Borné sur la seule largeur, un 9:16 déborderait en hauteur : élargir la
    // fenêtre montrerait de moins en moins d'image.
    expect(wizard).toContain('Math.min(body.clientWidth, Math.max(0, body.clientHeight - chrome) * ratio)');
  });

  it('le chrome est MESURÉ, pas écrit en dur', () => {
    // Une marge modifiée dans `Preview` rendrait une constante fausse en
    // silence.
    expect(wizard).toContain('Math.max(0, carte.offsetHeight - frame.offsetHeight)');
  });

  it('un seuil empêche mesure et largeur de se relancer sans fin', () => {
    expect(wizard).toContain('Math.abs(prev - large) > 1 ? large : prev');
  });
});

describe('Persistance de la géométrie', () => {
  it('elle passe par localStorage — un réglage d ergonomie survit à l onglet', () => {
    expect(wizard).toContain("const ENLARGED_GEOMETRY_KEY = 'studiio.creer-simple.apercu-agrandi';");
    expect(wizard).toContain('window.localStorage.setItem(ENLARGED_GEOMETRY_KEY');
    expect(wizard).not.toContain('sessionStorage.');
  });

  it('la lecture est gardée : SSR et stockage refusé', () => {
    const bloc = wizard.slice(wizard.indexOf('const [enlargedGeometry'), wizard.indexOf('const rememberEnlargedGeometry'));
    expect(bloc).toContain("typeof window === 'undefined'");
    expect(bloc).toContain('} catch {');
    expect(bloc).toContain('const repli = { x: 120, y: 90, w: 420, h: 640 };');
  });

  it('un quota plein ne casse pas la fenêtre', () => {
    const bloc = wizard.slice(wizard.indexOf('const rememberEnlargedGeometry'), wizard.indexOf('const rememberEnlargedGeometry') + 700);
    expect(bloc).toContain('} catch {');
  });

  it('un JSON corrompu retombe sur le repli, il ne fait pas planter la page', () => {
    expect(wizard).toContain('JSON.parse(brut) as typeof repli');
  });
});

describe('FloatingPanel — le composant lui-même', () => {
  it('les trois nouveaux réglages ont un défaut qui reproduit l existant', () => {
    expect(panel).toContain('resizable = false,');
    expect(panel).toContain('closeOnClickOutside = true,');
  });

  it('la poignée est hors du corps — sinon son clic serait avalé', () => {
    // Le corps arrête `mousedown` pour ne pas déclencher le déplacement : une
    // poignée placée dedans ne recevrait jamais rien.
    const corpsIndex = panel.indexOf('data-panel-body');
    const poigneeIndex = panel.indexOf('data-panel-resize', panel.indexOf('{resizable && ('));
    expect(poigneeIndex).toBeGreaterThan(corpsIndex);
    expect(panel).toContain("cible.closest('[data-panel-body]') || cible.closest('[data-panel-resize]')");
  });
});
