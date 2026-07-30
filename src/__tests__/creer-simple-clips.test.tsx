import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Preview } from '../app/dashboard/creer-simple/AssistantWizard';

/**
 * Chantier 2 — incrément 2 : temps forts + rush visible dans l'aperçu.
 *
 * Le cadrage est vérifié sur le DOM RÉELLEMENT produit par `Preview` (jsdom),
 * pas par lecture du source : c'est la règle « aucune vidéo déformée » qui est
 * en jeu, et elle mérite mieux qu'une expression régulière.
 * Le câblage du modal de découpe, lui, reste vérifié sur le source — il faut
 * un vrai navigateur (Canvas + décodage vidéo) pour l'exécuter.
 */

const wizardSource = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const GENERATED = {
  title: 'Titre',
  subtitle: 'Sous-titre',
  cards: [{ icon: 'Droplet', title: 'Carte', description: 'Description', value: '80%' }],
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
};

const RUSH = 'https://exemple.test/rush.mp4';


/** Réglages typographiques par défaut — identiques à ceux du wizard. */
const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, letterSpacing: 0, lineHeight: 1.2 },
};

function renderPreview(props: Partial<React.ComponentProps<typeof Preview>> = {}) {
  return render(
    <Preview
      generated={GENERATED}
      format="9:16"
      displayScale={0.25}
      activeOrder={['intro', 'cards', 'video', 'cta']}
      gradStart="#7C3AED"
      gradEnd="#EC4899"
      gradientOpacity={0.5}
      accent="#7C3AED"
      text={TEXT}
      rushUrl={RUSH}
      {...props}
    />,
  );
}

const videoEl = (container: HTMLElement) => container.querySelector('video');

afterEach(cleanup);

describe('Aperçu — le rush est affiché sans déformation', () => {
  it('affiche le rush quand la séquence vidéo est active', () => {
    const { container } = renderPreview();
    const vid = videoEl(container);
    expect(vid).not.toBeNull();
    expect(vid!.getAttribute('src')).toBe(RUSH);
  });

  it('cadre le rush en « cover » — jamais d’étirement', () => {
    // `object-fit: cover` applique une échelle UNIFORME aux deux dimensions,
    // exactement comme `drawVideoSeq` (`Math.max(w / srcW, h / srcH)`). Sans
    // lui, un `width/height: 100%` déformerait la source — c'est précisément
    // le bug que la règle absolue du cahier des charges interdit.
    const { container } = renderPreview();
    const style = videoEl(container)!.style;
    expect(style.objectFit).toBe('cover');
    expect(style.width).toBe('100%');
    expect(style.height).toBe('100%');
  });

  it('cadre en « cover » aussi en 16:9 — le format de sortie ne change rien', () => {
    const { container } = renderPreview({ format: '16:9' });
    expect(videoEl(container)!.style.objectFit).toBe('cover');
  });

  it('lit en sourdine et en boucle — politique d’autoplay de Chrome', () => {
    // Un `<video autoPlay>` non muet est bloqué par Chrome : l'aperçu
    // resterait figé sur une image noire.
    const vid = videoEl(renderPreview().container)!;
    expect(vid.muted).toBe(true);
    expect(vid.loop).toBe(true);
    expect(vid.autoplay).toBe(true);
  });

  it('n’affiche aucune vidéo quand la séquence vidéo est masquée', () => {
    const { container } = renderPreview({ activeOrder: ['intro', 'cards', 'cta'] });
    expect(videoEl(container)).toBeNull();
  });

  it('n’affiche aucune vidéo sans rush — état par défaut inchangé', () => {
    const { container } = renderPreview({ rushUrl: null });
    expect(videoEl(container)).toBeNull();
  });

  it('retire le rush illisible au lieu de laisser un cadre noir', () => {
    // Et le fait par un état React, pas par une mutation directe du DOM dans
    // le `onError` — celle-ci survivrait à tous les rendus suivants.
    const { container } = renderPreview();
    fireEvent.error(videoEl(container)!);
    expect(videoEl(container)).toBeNull();
  });

  it('laisse sa chance à un nouveau rush après un échec', () => {
    const { container, rerender } = renderPreview();
    fireEvent.error(videoEl(container)!);
    expect(videoEl(container)).toBeNull();
    rerender(
      <Preview
        generated={GENERATED}
        format="9:16"
        displayScale={0.25}
        activeOrder={['intro', 'cards', 'video', 'cta']}
        gradStart="#7C3AED"
        gradEnd="#EC4899"
        gradientOpacity={0.5}
        accent="#7C3AED"
        text={TEXT}
        rushUrl="https://exemple.test/autre.mp4"
      />,
    );
    expect(videoEl(container)).not.toBeNull();
  });

  it('affiche le titre et les cartes PAR-DESSUS le rush', () => {
    // Le rush est peint en premier dans le DOM : les blocs de texte, qui
    // suivent, restent lisibles au lieu de disparaître sous la vidéo.
    const { container } = renderPreview();
    const plateau = videoEl(container)!.parentElement!;
    const children = Array.from(plateau.children);
    expect(children.indexOf(videoEl(container)!)).toBe(0);
    expect(screen.getByText('Titre')).toBeDefined();
  });
});

describe('Temps forts — découpe d’un extrait du rush', () => {
  it('réutilise ClipDetectorModal tel quel', () => {
    expect(wizardSource).toContain(
      "import ClipDetectorModal, { type ClipSource } from '@/components/media/ClipDetectorModal'",
    );
    // Le modal est piloté par l'IDENTITÉ de `clipSource`, comme sur
    // /dashboard/media : c'est ce qui relance l'analyse au changement de rush.
    expect(wizardSource).toMatch(/isOpen=\{clipSource !== null\}/);
    expect(wizardSource).toMatch(/source=\{clipSource\}/);
  });

  it('n’ouvre les temps forts que sur un rush réellement importé', () => {
    expect(wizardSource).toMatch(/setClipSource\(\{ url: rushUrl, name: rushName \|\| 'rush' \}\)/);
  });

  it('fait du clip extrait le nouveau rush — donc celui qui part au montage', () => {
    const handler = wizardSource.slice(
      wizardSource.indexOf('onExtracted={(clips, failure)'),
      wizardSource.indexOf('</ClipDetectorModal>') > -1
        ? wizardSource.indexOf('</ClipDetectorModal>')
        : wizardSource.indexOf('</div>', wizardSource.indexOf('onExtracted={(clips, failure)')),
    );
    expect(handler).toMatch(/const clip = clips\[0\]/);
    // `applyRush` est le point unique : il met à jour l'aperçu, active la
    // séquence et fixe sa durée. Un `setRushUrl` direct sauterait tout cela.
    expect(handler).toMatch(/void applyRush\(clip\.url, clip\.name, true\)/);
  });

  it('remonte un échec partiel d’extraction à l’utilisateur', () => {
    // En cas d'échec le modal RESTE ouvert sur son propre encart ; ce message
    // prend le relais une fois qu'il est fermé, sans quoi l'échec ne
    // laisserait aucune trace.
    expect(wizardSource).toMatch(/if \(failure\) setError\(failure\)/);
    expect(wizardSource).toMatch(/if \(!failure\) setClipSource\(null\)/);
  });

  it('n’impose pas un extrait quand le rush a été retiré entre-temps', () => {
    // « Interrompre » ferme le modal immédiatement ; l'utilisateur pouvait
    // alors supprimer le rush et le voir revenir quand les clips déjà
    // téléversés étaient remontés.
    const handler = wizardSource.slice(
      wizardSource.indexOf('onExtracted={(clips, failure)'),
      wizardSource.indexOf('void applyRush(clip.url, clip.name, true)'),
    );
    expect(handler).toMatch(/if \(!rushUrl\) \{/);
  });

  it('survit au changement d’étape pendant l’extraction', () => {
    // Monté dans `{step === S.style && …}`, le modal se démontait sans
    // interrompre sa boucle : elle continuait à téléverser puis remplaçait le
    // rush alors que l'utilisateur était deux étapes plus loin.
    const styleStep = wizardSource.slice(
      wizardSource.indexOf('{step === S.style &&'),
      wizardSource.indexOf('{step === S.audio &&'),
    );
    expect(styleStep).not.toContain('<ClipDetectorModal');
    expect(wizardSource).toContain('<ClipDetectorModal');
  });

  it('ne relance pas la détection sur un extrait — elle ne peut qu’échouer', () => {
    // Un WebM `MediaRecorder` n'a pas de durée dans son en-tête, et
    // `detectClips` abandonne sur une durée non finie (clip-detector.ts) en
    // affichant « la vidéo est peut-être trop courte ou illisible ».
    expect(wizardSource).toMatch(/\{rushUrl && !rushIsClip && \(/);
    expect(wizardSource).toMatch(/void applyRush\(clip\.url, clip\.name, true\)/);
  });

  it('mesure la durée d’un extrait malgré l’en-tête WebM sans durée', () => {
    // C'est LE bug de #224 : `duration === Infinity` renvoyait `null`, donc
    // la durée de repli pour tout extrait — image figée ou clip tronqué.
    const probe = wizardSource.slice(
      wizardSource.indexOf('function probeRushDuration'),
      wizardSource.indexOf('* Les 4 sequences'),
    );
    // Le rattrapage : seek au-delà de la fin, puis relecture de la durée.
    expect(probe).toMatch(/vid\.currentTime = 1e101/);
    expect(probe).toMatch(/Number\.isFinite\(vid\.duration\) \? vid\.duration : vid\.currentTime/);
    // …tenté UNIQUEMENT sur une durée non finie : un MP4 normal reste mesuré
    // sur son seul en-tête, sans télécharger le fichier entier.
    expect(probe).toMatch(/if \(Number\.isFinite\(d\)\) \{\s*finish\(d\);\s*return;/);
  });
});
