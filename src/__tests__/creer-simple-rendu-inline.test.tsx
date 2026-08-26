import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Preview } from '@/app/dashboard/creer/AssistantWizard';

/**
 * Le rendu joue DANS le cadre d'aperçu — fin du deuxième écran.
 *
 * ⚠️ IL Y AVAIT DEUX IMAGES DU MÊME MONTAGE, EMPILÉES. L'aperçu figé avec ses
 * onglets (Titre / Cartes / Vidéo / CTA / Tout), puis, en dessous, un second
 * panneau avec sa bordure, sa légende de facturation et son bouton
 * « Fermer ». Sur une colonne collée en haut de page, le lecteur passait sous
 * la ligne de flottaison : on cliquait « Voir le rendu » et il ne se passait
 * rien de visible.
 *
 * ⚠️ CE QUI SE VÉRIFIE ICI EST UNE POSITION, PAS UNE PRÉSENCE. « La vidéo
 * existe quelque part dans le DOM » était déjà vrai AVANT ce correctif — un
 * test qui se contenterait de ça ne pourrait pas distinguer le bug de sa
 * correction. On vérifie donc que le lecteur est un DESCENDANT du cadre, et
 * que le cadre n'a pas de frère qui lui vole la place.
 */

// jsdom ne connait pas `ResizeObserver`, dont l'apercu se sert pour mesurer
// son plateau.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

afterEach(cleanup);

const GENERATED = {
  title: 'MON TITRE',
  subtitle: 'Un sous-titre',
  cards: [{ id: 'c1', icon: 'Zap', title: 'Carte', description: 'Desc', value: '10' }],
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
};

const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  subtitle: { font: null, color: null, scale: 1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
};

/** L'aperçu, monté nu — avec ou sans calque. */
function monter(overlay: React.ReactNode = null) {
  const frameRef = { current: null } as React.RefObject<HTMLDivElement>;
  return render(
    <Preview
      generated={GENERATED}
      format="9:16"
      frameRef={frameRef}
      displayScale={0.25}
      activeOrder={['intro', 'cards', 'cta']}
      gradStart="#7C3AED"
      gradEnd="#EC4899"
      gradientOpacity={0.3}
      accent="#7C3AED"
      text={TEXT}
      overlay={overlay}
    />,
  );
}

/** Le cadre : le conteneur au ratio vidéo, celui qui porte le plateau. */
function cadre(): HTMLElement {
  const el = document.querySelector('[data-preview-overlay]')?.parentElement;
  // Sans calque, on le retrouve par son style de ratio.
  return (el ?? document.querySelector('.rounded-xl.overflow-hidden.relative')) as HTMLElement;
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — le calque vit DANS le cadre', () => {
  it('sans calque, rien n est ajouté — l aperçu est celui d avant', () => {
    // ⚠️ LE DÉFAUT DOIT ÊTRE INERTE. `AutopilotPreview` et la fenêtre
    // agrandie n'en passent pas : elles doivent rendre exactement ce qu'elles
    // rendaient avant l'ajout de cette prop.
    monter(null);
    expect(document.querySelector('[data-preview-overlay]')).toBeNull();
    expect(screen.getByText('MON TITRE')).toBeTruthy();
  });

  it('le calque est un DESCENDANT du cadre, pas un frère posé dessous', () => {
    // C'est LA différence entre le bug et sa correction : un `<video>` monté
    // en dessous du cadre serait « présent » lui aussi.
    monter(<video data-play-lecteur src="blob:x" controls />);
    const calque = document.querySelector('[data-preview-overlay]') as HTMLElement;
    const video = document.querySelector('[data-play-lecteur]') as HTMLElement;
    expect(calque).toBeTruthy();
    expect(calque.contains(video)).toBe(true);
    expect(cadre().contains(calque)).toBe(true);
  });

  it('il couvre le cadre entier — même position, même ratio', () => {
    monter(<video data-play-lecteur src="blob:x" controls />);
    const calque = document.querySelector('[data-preview-overlay]') as HTMLElement;
    expect(calque.className).toContain('absolute');
    expect(calque.className).toContain('inset-0');
  });

  it('il est HORS du plateau — sinon il finirait dans la vidéo exportée', () => {
    // ⚠️ Le plateau est ce que `modern-screenshot` photographie pour
    // l'export : un lecteur posé dedans serait blitté dans le montage.
    const previewRef = { current: null } as React.RefObject<HTMLDivElement>;
    render(
      <Preview
        generated={GENERATED}
        format="9:16"
        previewRef={previewRef}
        displayScale={0.25}
        activeOrder={['intro', 'cards', 'cta']}
        gradStart="#7C3AED"
        gradEnd="#EC4899"
        gradientOpacity={0.3}
        accent="#7C3AED"
        text={TEXT}
        overlay={<video data-play-lecteur src="blob:x" controls />}
      />,
    );
    const plateau = previewRef.current as HTMLElement;
    const video = document.querySelector('[data-play-lecteur]') as HTMLElement;
    expect(plateau).toBeTruthy();
    expect(plateau.contains(video)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — le calque n empêche pas de travailler', () => {
  it('les onglets restent cliquables pendant que la vidéo joue', () => {
    // Le retour à l'édition passe par eux : les recouvrir enfermerait
    // l'utilisateur devant sa vidéo.
    const onFocusChange = vi.fn();
    render(
      <Preview
        generated={GENERATED}
        format="9:16"
        displayScale={0.25}
        activeOrder={['intro', 'cards', 'cta']}
        gradStart="#7C3AED"
        gradEnd="#EC4899"
        gradientOpacity={0.3}
        accent="#7C3AED"
        text={TEXT}
        focus="all"
        onFocusChange={onFocusChange}
        overlay={<video data-play-lecteur src="blob:x" controls />}
      />,
    );
    fireEvent.click(screen.getByText('Titre'));
    expect(onFocusChange).toHaveBeenCalledWith('intro');
  });

  it('un calque de chargement se pose au même endroit', () => {
    // L'attente se passait sous l'aperçu, dans un bouton qui disait
    // « Rendu… » : rien n'indiquait où le résultat allait apparaître.
    monter(<div data-play-chargement>Composition du montage…</div>);
    const calque = document.querySelector('[data-preview-overlay]') as HTMLElement;
    expect(calque.contains(document.querySelector('[data-play-chargement]'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — le câblage de l assistant', () => {
  // Ces vérifications-ci portent sur le SOURCE : le déclenchement d'un vrai
  // rendu passerait par le compositeur, MediaRecorder et un débit de crédits,
  // qu'aucun test d'interface n'a à exécuter. Le comportement du calque, lui,
  // est vérifié sur le DOM dans les sections A et B.
  const wizard = readFileSync(
    resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');

  it('l aperçu de l assistant reçoit le calque', () => {
    expect(wizard).toContain('overlay={renduDansLeCadre}');
  });

  it('le montage ne joue que sur l onglet « Tout »', () => {
    // ⚠️ LES AUTRES ONGLETS ISOLENT UN ÉLÉMENT POUR LE RÉGLER DE PRÈS. Y
    // substituer la vidéo entière retirerait à l'utilisateur la seule vue qui
    // lui sert à travailler.
    expect(wizard).toContain("const renduJoue = !!previewUrl && previewFocus === 'all';");
  });

  it('il n y a plus qu UN SEUL lecteur dans tout l écran', () => {
    // C'est la fin du deuxième écran : deux occurrences signifieraient que le
    // bloc du bas est revenu à côté du calque.
    expect(wizard.split('data-play-lecteur').length - 1).toBe(1);
  });

  it('l état de chargement du cadre ne se déclenche QUE pour l aperçu', () => {
    // `sending` vaut `true` pour les trois destinations : sans cette
    // distinction, un envoi au calendrier recouvrirait le plateau d'un voile
    // « Composition du montage… » qui ne le concerne pas.
    expect(wizard).toContain("const rendPourApercu = sending && renderTarget === 'apercu';");
  });

  it('l indicateur de destination est remis à zéro sur TOUS les chemins', () => {
    // Un retour anticipé hors du `try` laisserait le cadre bloqué sur
    // « Composition du montage… » sans que rien ne tourne.
    expect(wizard.split('setRenderTarget(null)').length - 1).toBe(2);
  });

  it('l aperçu de l Autopilote ne reçoit AUCUN calque', () => {
    // Il partage `Preview` : le régresser ferait apparaître un lecteur dans
    // un aperçu qui n'a rien à jouer.
    const autopilote = wizard.slice(
      wizard.indexOf('function AutopilotPreview('),
      wizard.indexOf('export default function AssistantWizard()'),
    );
    expect(autopilote.length).toBeGreaterThan(0);
    expect(autopilote).not.toContain('overlay=');
  });
});
