import React from 'react';
import { textAnimationState, type TextAnimation } from '@/lib/creer/textAnimation';

/**
 * L'animation d'apparition, appliquee a un bloc — composant PARTAGE.
 *
 * Les regles vivent deja dans `textAnimation.ts`, que le compositeur canvas
 * appelle aussi : ce composant n'est que la traduction en CSS de ce que
 * `applyTextAnimation` fait au contexte 2D. Une seule table de verite, deux
 * moteurs.
 *
 * ⚠️ L'ECHELLE EST PRISE AU CENTRE DU CADRE, PAS AU CENTRE DU TEXTE.
 *
 * Le canvas fait `translate(w/2, h/2)` → `scale` → `translate(-w/2, -h/2)` :
 * le repere entier est mis a l'echelle, si bien qu'un titre pose en haut a
 * gauche se rapproche du centre en grandissant. Reproduire cela demande une
 * enveloppe qui couvre TOUT le cadre — c'est pourquoi l'animation n'habite
 * pas dans `SequenceTitle` ni dans `SequenceCta`, qui ne couvrent que leur
 * propre bloc : un `scale` applique la ferait grandir sur place, et le titre
 * ne bougerait pas.
 *
 * ⚠️ A ENVELOPPER LE TEXTE, JAMAIS LE FOND. `applyTextAnimation` est appelee
 * apres le fond dans les trois fonctions du compositeur : un fond en fondu
 * laisserait voir le noir, un fond qui glisse decouvrirait une bande vide.
 *
 * A l'etat neutre — `'none'`, style inconnu, ou animation terminee — le
 * composant rend ses enfants SANS enveloppe. Aucun noeud en plus, aucun
 * contexte d'empilement cree : le rendu est alors au pixel celui d'avant, et
 * l'adopter quelque part ne peut rien changer tant qu'aucune animation n'est
 * demandee.
 */
export default function TextAnimationLayer({
  style,
  progress,
  children,
}: {
  style: TextAnimation | undefined;
  /** Avancement de la SEQUENCE, de 0 a 1 — pas celui de l'animation. */
  progress: number;
  children: React.ReactNode;
}) {
  const a = textAnimationState(style, progress);
  // Meme test que `applyTextAnimation`, qui sort sans rien toucher.
  if (a.alpha === 1 && a.translateY === 0 && a.scale === 1) return <>{children}</>;

  const transformations: string[] = [];
  // `translateY` est une FRACTION de la hauteur du cadre : l'enveloppe la
  // couvrant, un pourcentage CSS dit exactement la meme chose, sans avoir a
  // connaitre la resolution.
  if (a.translateY !== 0) transformations.push(`translateY(${a.translateY * 100}%)`);
  if (a.scale !== 1) transformations.push(`scale(${a.scale})`);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        opacity: a.alpha,
        transform: transformations.length ? transformations.join(' ') : undefined,
        // Le centre du CADRE, comme le canvas.
        transformOrigin: 'center center',
      }}
    >
      {children}
    </div>
  );
}
